---
id: note-sp-ai-008
difficulty: L2
category: ai
subcategory: RAG
tags:
  - Shopee
  - 面经
  - RAG
  - 检索增强
feynman:
  essence: RAG是给大模型外挂知识库——先检索相关文档拼进Prompt，让模型照着回答降低幻觉
  analogy: 'RAG像开卷考试——不是背下所有知识(训练)，而是带着参考书(知识库)查着答(检索+生成)'
  first_principle: 'LLM知识更新成本高(需重训练)，RAG用检索方式动态注入知识，实现零成本更新'
  key_points:
    - 文档加载→切分→向量化→入库→检索→增强生成
    - 评价维度有检索命中率、答案忠实度、答案相关性
    - 不能确保100%准确率
first_principle:
  essence: '将知识检索和文本生成解耦——知识库可独立更新，模型不需要重新训练'
  derivation: 'LLM参数化知识(权重)更新成本极高→RAG用非参数化知识(向量库)→检索后拼入Prompt→模型只需理解推理'
  conclusion: RAG本质是把"记忆"从模型权重转移到外部向量库
follow_up:
  - 'Embedding模型怎么选？'
  - 'chunk_size对检索效果的影响？'
  - '混合检索(向量+关键词)怎么做？'
---

# RAG是什么？怎么构建？评价体系是什么？能不能确保100%准确率？

## RAG构建流程

```
┌─────────────────────────────────────────────────────┐
│                    RAG Pipeline                      │
├──────────────────────────────────────────────────────┤
│                                                      │
│  ┌─ 离线构建 ──────────────────────────────────────┐ │
│  │                                                  │ │
│  │  1.文档加载    PDF/网页/数据库                    │ │
│  │      ↓                                           │ │
│  │  2.文本切分    按语义/chunk_size切小块             │ │
│  │      ↓                                           │ │
│  │  3.向量化      Embedding模型转向量                │ │
│  │      ↓                                           │ │
│  │  4.向量入库    向量+原文存入向量库                 │ │
│  │                                                  │ │
│  └──────────────────────────────────────────────────┘ │
│                                                      │
│  ┌─ 在线检索生成 ───────────────────────────────────┐ │
│  │                                                  │ │
│  │  5.查询向量化   用户提问→Embedding                │ │
│  │      ↓                                           │ │
│  │  6.向量检索     找top-k最相似文本块               │ │
│  │      ↓                                           │ │
│  │  7.重排序       Cross-encoder精排                 │ │
│  │      ↓                                           │ │
│  │  8.上下文组装   检索结果+用户问题→Prompt          │ │
│  │      ↓                                           │ │
│  │  9.LLM生成     根据上下文回答                     │ │
│  │                                                  │ │
│  └──────────────────────────────────────────────────┘ │
│                                                      │
└──────────────────────────────────────────────────────┘
```

## 各步骤详解

### 1. 文档加载
```python
from langchain.document_loaders import PyPDFLoader, WebPageLoader

# PDF
docs = PyPDFLoader("handbook.pdf").load()
# 网页
docs = WebPageLoader("https://example.com").load()
```

### 2. 文本切分
```python
from langchain.text_splitter import RecursiveCharacterTextSplitter

splitter = RecursiveCharacterTextSplitter(
    chunk_size=500,       # 每块500字符
    chunk_overlap=50,     # 块间重叠50字符
    separators=["\n\n", "\n", "。", "！", "？"]  # 中文友好
)
chunks = splitter.split_documents(docs)
```

### 3. 向量化+入库
```python
from langchain.embeddings import HuggingFaceEmbeddings
from langchain.vectorstores import Chroma

embeddings = HuggingFaceEmbeddings(model_name="BAAI/bge-large-zh")
vectorstore = Chroma.from_documents(chunks, embeddings)
```

### 4. 检索+生成
```python
from langchain.chains import RetrievalQA

qa = RetrievalQA.from_chain_type(
    llm=ChatOpenAI(model="gpt-4"),
    retriever=vectorstore.as_retriever(search_kwargs={"k": 5}),
    return_source_documents=True  # 返回来源
)

result = qa({"query": "公司的年假政策是什么？"})
print(result["result"])
print(result["source_documents"])  # 引用来源
```

## 评价体系

```
┌────────────────────────────────────────────┐
│             RAG 评价维度                    │
├──────────────┬─────────────────────────────┤
│ 检索质量      │ 评估"找得准不准"             │
├──────────────┼─────────────────────────────┤
│ 命中率       │ Top-k中是否包含正确文档       │
│ MRR          │ 正确文档的排名倒数           │
│ Recall@k     │ 前k个结果覆盖率              │
├──────────────┼─────────────────────────────┤
│ 生成质量      │ 评估"答得好不好"             │
├──────────────┼─────────────────────────────┤
│ 忠实度       │ 答案是否基于检索内容(不幻觉)  │
│ 相关性       │ 答案是否切题                 │
│ 完整性       │ 答案是否覆盖了所有要点       │
├──────────────┼─────────────────────────────┤
│ 端到端        │ 检索+生成的整体效果          │
├──────────────┼─────────────────────────────┤
│ 准确率       │ 最终答案的正确性             │
│ 引用准确率    │ 引用的来源是否正确           │
└──────────────┴─────────────────────────────┘
```

## 能不能确保100%准确率？

**不能。** 原因：

1. **检索可能遗漏**：向量相似度≠语义相关，可能召回错误文档
2. **模型可能幻觉**：即使检索到正确文档，模型也可能编造信息
3. **切分可能割裂**：chunk_size不合理导致上下文断裂
4. **Embedding有损**：文本转向量必然丢失部分信息

**降低错误率的策略**：

| 策略 | 效果 |
|------|------|
| 混合检索(向量+BM25) | 召回率+10-20% |
| 重排序(Cross-encoder) | 精确率+15% |
| Prompt约束"只基于上下文回答" | 幻觉率-30% |
| 增大top-k | 召回率+ |
| 多路召回+去重 | 召回率+ |

## 面试加分点

1. **全流程理解**：能画出完整的离线+在线pipeline
2. **知道不能100%**：解释检索召回率和模型幻觉的固有局限
3. **优化策略**：混合检索、重排序、Prompt约束等具体手段
4. **评价维度**：不只是端到端准确率，还要评估检索和生成各环节
