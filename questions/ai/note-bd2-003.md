---
id: note-bd2-003
difficulty: L2
category: ai
subcategory: RAG
tags:
- 字节
- 面经
- RAG
- Embedding
- 向量检索
feynman:
  essence: Embedding把文本变成高维向量，让语义相近的文本在向量空间中距离也近，检索就是找空间中最近的向量
  analogy: 就像把每本书按"主题坐标"放在书架上——同主题的书挨着放。找书时不需要看书名，只需要说"我要这附近主题的书"，空间距离近的就是相关的
  first_principle: 语义相似性可以表示为向量空间中的距离。Embedding模型学习了从离散文本到连续向量空间的映射，保留了语义关系
  key_points:
  - 'Embedding: 文本→高维向量(768/1536维)，语义相近→距离近'
  - '检索过程: Query向量化→在向量库中找最近邻→返回对应原文'
  - '相似度度量: 余弦相似度(最常用)、内积、欧氏距离'
  - '向量库: FAISS(Meta)、Milvus、Pinecone、Chroma'
first_principle:
  essence: Embedding实现了从符号空间(文字)到度量空间(向量)的映射，使语义相似性可计算
  derivation: '"猫"和"狗"的Embedding向量距离近(都是动物)，"猫"和"汽车"距离远(语义不相关)。这种空间结构是Embedding模型在数十亿文本上通过对比学习训练出来的'
  conclusion: RAG向量检索的本质是在语义空间中做最近邻搜索
follow_up:
- 不同Embedding模型的维度为什么不同？维度越高越好吗？
- 向量检索的近似算法(ANN)是怎么工作的？
- 中文Embedding模型选哪个比较好？
memory_points:
- 本质：将文本映射为高维稠密向量，使语义相近在空间中距离相近。
- 离线建库：文档切分为Chunk→批量Embedding→L2归一化→存入向量库。
- 在线检索：Query向量化→近似最近邻(ANN)检索→召回Top-K。
- 关键点：FAISS等库用内积IP等价计算余弦相似度，需提前做归一化。
---

# Embedding原理和RAG向量检索过程

## Embedding 是什么

```
文本: "Python是一门编程语言"
  │
  ▼  Embedding Model (如: text-embedding-3-small)
  │
向量: [0.21, -0.45, 0.89, 0.12, ..., -0.33]  (1536维)
       │
       │  在向量空间中:
       │
       │  "Python编程" ●  ← 距离=0.12 (很近)
       │  "Java开发"   ●  ← 距离=0.35 (较近)
       │  "烹饪教程"   ●  ← 距离=0.87 (很远)
```

## RAG向量检索完整流程

```
┌──────────────────────────────────────────────┐
│              离线建库阶段                      │
│                                              │
│  文档 → 切分 → Embedding → 存入向量库         │
│  ┌─────┐  ┌────┐  ┌────────┐  ┌──────────┐ │
│  │ PDF │→│切分│→│向量化   │→│ 向量库    │ │
│  │ Word│  │Chunk│ │[0.1,...]│  │FAISS/    │ │
│  │ Web │  │    │ │[0.3,...]│  │Milvus    │ │
│  └─────┘  └────┘  └────────┘  └──────────┘ │
│                                  ↑           │
├──────────────────────────────────────────────┤
│              在线检索阶段                      │
│                                  │           │
│  用户Query → Embedding → 相似度计算 → Top-K   │
│  ┌──────┐   ┌────────┐  ┌──────┐ ┌────────┐│
│  │Query │→ │向量化   │→ │ANN   │→│结果    ││
│  │"怎么 │  │[0.2,...]│  │搜索  │ │Doc1    ││
│  │安装?"│  └────────┘  └──────┘ │Doc2    ││
│  └──────┘                       │Doc3    ││
│                                 └────────┘│
└──────────────────────────────────────────────┘
```

## 代码实现

### Step 1: 离线建库

```python
from openai import OpenAI
import faiss
import numpy as np

client = OpenAI()

def embed_text(text, model="text-embedding-3-small"):
    """调用Embedding API"""
    response = client.embeddings.create(
        model=model,
        input=text
    )
    return response.data[0].embedding

def build_vector_store(documents):
    """构建向量库"""
    # 1. 文本切分
    chunks = []
    for doc in documents:
        chunks.extend(split_text(doc, chunk_size=500))
    
    # 2. 批量向量化
    embeddings = []
    for i in range(0, len(chunks), 100):  # 批量100个
        batch = chunks[i:i+100]
        response = client.embeddings.create(
            model="text-embedding-3-small",
            input=batch
        )
        embeddings.extend([d.embedding for d in response.data])
    
    # 3. 存入FAISS
    dim = len(embeddings[0])  # 1536维
    index = faiss.IndexFlatIP(dim)  # 内积(等价于归一化后的余弦相似度)
    
    # L2归一化(使内积=余弦相似度)
    embeddings_np = np.array(embeddings).astype('float32')
    faiss.normalize_L2(embeddings_np)
    index.add(embeddings_np)
    
    # 4. 保存映射关系
    chunk_store = {i: chunk for i, chunk in enumerate(chunks)}
    
    return index, chunk_store
```

### Step 2: 在线检索

```python
def vector_search(query, index, chunk_store, top_k=5):
    """向量检索"""
    # 1. Query向量化
    query_vec = embed_text(query)
    query_np = np.array([query_vec]).astype('float32')
    faiss.normalize_L2(query_np)
    
    # 2. ANN搜索
    scores, indices = index.search(query_np, top_k)
    
    # 3. 返回结果
    results = []
    for score, idx in zip(scores[0], indices[0]):
        if idx >= 0:
            results.append({
                "content": chunk_store[idx],
                "score": float(score),  # 余弦相似度 (0~1)
                "index": int(idx)
            })
    
    return results
```

### Step 3: 完整RAG Pipeline

```python
def rag_pipeline(query, index, chunk_store, llm_client):
    """完整RAG流程"""
    
    # 1. 向量检索
    retrieved = vector_search(query, index, chunk_store, top_k=5)
    
    # 2. 构建增强Prompt
    context = "\n\n".join([r["content"] for r in retrieved])
    
    prompt = f"""基于以下参考资料回答问题。

参考资料:
{context}

问题: {query}

请根据参考资料回答，如果资料中没有答案请说明。"""
    
    # 3. LLM生成回答
    response = llm_client.chat.completions.create(
        model="gpt-4",
        messages=[{"role": "user", "content": prompt}],
        temperature=0.1
    )
    
    return response.choices[0].message.content
```

## 相似度度量

```python
# 三种常用相似度度量

import numpy as np

def cosine_similarity(a, b):
    """余弦相似度: 关注方向，忽略大小 (最常用)"""
    return np.dot(a, b) / (np.linalg.norm(a) * np.linalg.norm(b))

def dot_product(a, b):
    """内积: 同时考虑方向和大小"""
    return np.dot(a, b)

def euclidean_distance(a, b):
    """欧氏距离: 关注绝对距离"""
    return np.sqrt(np.sum((a - b) ** 2))

# 结论: 文本检索场景用余弦相似度最合适
# 因为文本向量的大小(范数)没有语义意义
```

## Embedding模型选型

| 模型 | 维度 | 特点 | 中文效果 | 价格 |
|------|------|------|---------|------|
| text-embedding-3-small | 1536 | OpenAI, 性价比高 | 中 | $0.02/M |
| text-embedding-3-large | 3072 | OpenAI, 效果最好 | 中高 | $0.13/M |
| BGE-large-zh-v1.5 | 1024 | 开源, 中文最强 | 高 | 免费 |
| BGE-M3 | 1024 | 开源, 多语言 | 高 | 免费 |
| gte-large-zh | 1024 | 开源, 阿里达摩 | 高 | 免费 |
| jina-embeddings-v3 | 1024 | 开源, 长文本好 | 中高 | 免费 |

## ANN近似最近邻算法

```python
# 精确搜索(O(n))在小数据集可行，大数据集需要ANN(O(log n))

# FAISS支持的索引类型:
# 1. IndexFlatIP: 精确搜索, 适合<100万向量
index = faiss.IndexFlatIP(1536)

# 2. IndexIVFFlat: 聚类加速, 适合100万-1000万
quantizer = faiss.IndexFlatIP(1536)
index = faiss.IndexIVFFlat(quantizer, 1536, nlist=100)  # 100个聚类

# 3. IndexHNSWFlat: 图索引, 适合大规模+高召回
index = faiss.IndexHNSWFlat(1536, M=32)  # M=图的连接度

# 4. IndexIVFPQ: 乘积量化, 适合超大规模+低内存
quantizer = faiss.IndexFlatIP(1536)
index = faiss.IndexIVFPQ(quantizer, 1536, nlist=100, m=8, nbits=8)
```

| 索引类型 | 召回率 | 速度 | 内存 | 适用规模 |
|---------|--------|------|------|---------|
| FlatIP | 100% | 慢 | 大 | <10万 |
| IVFFlat | ~95% | 快 | 中 | 10万-1000万 |
| HNSW | ~98% | 很快 | 中大 | 100万-1亿 |
| IVFPQ | ~90% | 最快 | 最小 | >1亿 |

## 记忆要点

- 本质：将文本映射为高维稠密向量，使语义相近在空间中距离相近。
- 离线建库：文档切分为Chunk→批量Embedding→L2归一化→存入向量库。
- 在线检索：Query向量化→近似最近邻(ANN)检索→召回Top-K。
- 关键点：FAISS等库用内积IP等价计算余弦相似度，需提前做归一化。

