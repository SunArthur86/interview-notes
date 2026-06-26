---
id: note-bz-agent-045
difficulty: L2
category: ai
subcategory: RAG
tags:
  - B站面经
  - RAG
  - 检索增强
feynman:
  essence: RAG=检索增强生成。先从知识库检索相关文档，再让LLM基于检索结果生成答案。解决LLM知识过时和幻觉问题，像"开卷考试"。
  analogy: 像开卷考试——LLM是考生，知识库是课本，RAG让考生先翻书找相关内容再答题，而非凭记忆(可能记错)。
  first_principle: LLM训练数据有截止日期，无法知道私有/最新信息。RAG通过"检索+生成"结合，让LLM能基于外部知识回答。
  key_points:
    - 核心：检索(Retrieval)+增强(Augmented)+生成(Generation)
    - 解决：知识过时/幻觉/无法访问私有数据
    - 流程：文档处理→向量化→检索→注入Prompt→生成
    - 优势：无需微调/知识可更新/可溯源
first_principle:
  essence: RAG把"知识"从模型参数中外部化，实现知识与推理能力的解耦。
  derivation: '微调把知识烧进参数（更新难/贵）。RAG把知识放外部库（更新易/便宜），推理时检索注入。能力(推理)靠模型，知识(事实)靠检索，各司其职。'
  conclusion: RAG = 外部知识检索 + LLM推理生成，知识与能力解耦
follow_up:
  - RAG和微调怎么选？——事实知识用RAG，能力风格用微调
  - RAG会完全替代微调吗？——不会，互补关系
  - RAG的最大瓶颈？——检索质量（召回率和精度）
---

# 什么是 RAG？整体流程是怎样的？

## 一、RAG 核心定义

**RAG** = **R**etrieval **A**ugmented **G**eneration（检索增强生成）

**核心思想：** 在 LLM 生成答案前，先从外部知识库**检索**相关信息，把检索结果作为上下文**增强**Prompt，让 LLM 基于检索结果**生成**答案。

```
传统LLM（闭卷考试）：
  用户问题 → LLM（凭训练记忆）→ 答案
  问题：知识过时/幻觉/不知道私有数据

RAG（开卷考试）：
  用户问题 → 检索知识库 → 相关文档 → 增强Prompt → LLM → 答案
  优势：知识最新/可溯源/可访问私有数据
```

## 二、RAG 完整流程

```
┌──────────────────────────────────────────────────────┐
│              RAG 两阶段流程                             │
├──────────────────────────────────────────────────────┤
│                                                        │
│  阶段1: 数据准备（离线，一次性或定期更新）              │
│                                                        │
│  原始文档 → 加载 → 分块(Chunking) → 向量化(Embedding) │
│              ↓                              ↓          │
│         PDF/Word/网页              每块转成向量         │
│         DB/API数据                         ↓          │
│                                   存入向量数据库       │
│                                                        │
├──────────────────────────────────────────────────────┤
│                                                        │
│  阶段2: 查询回答（在线，每次提问）                     │
│                                                        │
│  用户问题 → 向量化 → 向量检索(top-k) → Rerank        │
│                                ↓                       │
│                         最相关的文档块                  │
│                                ↓                       │
│  组装Prompt: [系统指令 + 检索到的文档 + 用户问题]      │
│                                ↓                       │
│                    LLM生成答案                         │
│                                ↓                       │
│                    返回答案+来源引用                    │
│                                                        │
└──────────────────────────────────────────────────────┘
```

## 三、各环节详解

### 1. 文档加载（Loading）

```python
from langchain.document_loaders import (
    PyPDFLoader,        # PDF
    WebBaseLoader,      # 网页
    NotionLoader,       # Notion
    CSVLoader,          # 表格
)

docs = PyPDFLoader("manual.pdf").load()
# 每个文档: {page_content: "...", metadata: {source, page}}
```

### 2. 文档分块（Chunking）

```python
from langchain.text_splitter import RecursiveCharacterTextSplitter

splitter = RecursiveCharacterTextSplitter(
    chunk_size=500,      # 每块500字符
    chunk_overlap=50,    # 块间重叠50字符（防切断语义）
)
chunks = splitter.split_documents(docs)
# 一个100页PDF → 拆成几百个小块
```

### 3. 向量化（Embedding）

```python
from langchain.embeddings import OpenAIEmbeddings

embedder = OpenAIEmbeddings()
vector = embedder.embed_query("什么是Agent")
# → [0.1, -0.3, 0.5, ...]  # 1536维向量
# 语义相近的文本，向量也相近
```

### 4. 存储（Vector Store）

```python
from langchain.vectorstores import Chroma

db = Chroma.from_documents(
    chunks, 
    embedder,
    persist_directory="./vector_db"
)
# 文档块+向量存入向量数据库，支持相似度检索
```

### 5. 检索（Retrieval）

```python
# 用户提问
query = "Agent怎么选工具"

# 向量化查询 → 检索最相似的文档块
relevant = db.similarity_search(query, k=5)
# 返回5个最相关的文档块
```

### 6. 生成（Generation）

```python
prompt = f"""
基于以下参考文档回答问题。如果文档中没有答案，说"我不知道"。

参考文档:
{format_docs(relevant)}

问题: {query}
"""
answer = llm(prompt)
```

## 四、RAG 解决的核心问题

```
┌──────────────────┬──────────────────────────────┐
│ 问题              │ RAG如何解决                    │
├──────────────────┼──────────────────────────────┤
│ 知识过时          │ 知识库可随时更新，无需重训模型  │
│ 幻觉              │ 基于检索文档回答，可溯源       │
│ 私有数据无法访问  │ 把私有文档建索引，检索注入     │
│ 微调成本高        │ RAG无需训练，接入即用          │
│ 知识更新频繁      │ 只更新知识库，模型不变         │
│ 需要引用来源      │ 检索结果自带来源              │
└──────────────────┴──────────────────────────────┘
```

## 五、RAG vs 微调

| 维度 | RAG | 微调 |
|------|-----|------|
| **适合** | 事实知识/动态数据 | 能力/风格/格式 |
| **更新成本** | 低（更新知识库） | 高（重新训练） |
| **时效性** | 实时 | 训练时固定 |
| **可溯源** | 是 | 否 |
| **计算成本** | 推理时检索 | 训练时高 |
| **知识量** | 无限（看库大小） | 有限（参数容量） |

```
最佳实践：RAG + 微调结合
  - 微调：让模型学会"怎么回答"（风格/格式/领域推理）
  - RAG：提供"回答什么"（最新事实/私有知识）
```

## 六、RAG 的演进

```
Naive RAG（基础）→ Advanced RAG（优化）→ Agentic RAG（智能）

Naive RAG:  查询→检索→生成（固定流程）
Advanced RAG: + 查询改写/重排序/混合检索/分块优化
Agentic RAG: Agent自主决策检索策略（何时/查什么/查几次）
```

## 七、面试加分点

1. **"开卷考试"类比**：最直观解释 RAG 的价值
2. **强调知识与能力解耦**：RAG 的本质是把知识外部化，这是区别于微调的核心
3. **提可溯源**：RAG 能给出来处，这是比纯 LLM 重要的优势（尤其企业场景）
