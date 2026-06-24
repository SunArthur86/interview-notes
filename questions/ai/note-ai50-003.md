---
id: note-ai50-003
difficulty: L3
category: ai
subcategory: RAG
tags:
  - 某厂
  - 面经
  - RAG
  - 混合检索
  - 向量检索
feynman:
  essence: '向量检索擅长语义匹配，关键词检索擅长精确匹配，两者互补才能覆盖所有查询场景'
  analogy: '就像找文件——有时候记得文件名（关键词检索准），有时候只记得大概内容（向量检索准），两个搜索引擎一起用最靠谱'
  first_principle: '向量检索基于语义相似度，对同义词和表述变化鲁棒但对专有名词和精确数值弱；关键词检索基于字面匹配，对专有名词精确但无法理解同义替换'
  key_points:
    - '向量检索: 语义相似，适合模糊查询、概念查询'
    - '关键词检索(BM25): 精确匹配，适合专有名词、ID、代码、数值'
    - '混合检索 = 向量召回 + BM25召回 + RRF/加权融合'
    - '工业实践通常用ES做BM25 + Milvus/Pinecone做向量'
first_principle:
  essence: '单一检索方式存在覆盖盲区，向量检索和关键词检索的错误模式不重叠'
  derivation: '查询"GPT-4的上下文窗口"时，向量检索可能召回"LLM的输入长度限制"（语义近但不准）；BM25精确命中"GPT-4"但可能漏掉"大语言模型的窗口大小"（同义替换）。两者并集覆盖率最高'
  conclusion: '混合检索是工程上的必然选择，通过互补消除单一检索的盲区'
follow_up:
  - 'RRF(Reciprocal Rank Fusion)和加权融合哪个更好？'
  - '向量检索的top_k和BM25的top_k分别设多少合适？'
  - '如果向量库和ES中数据不同步怎么办？'
---

# 向量检索和关键词检索各适合什么场景？为什么做混合检索？

## 两种检索的本质区别

```
┌─────────────────────────────────────────────────┐
│              用户Query: "怎么提高模型准确率"        │
│                                                   │
│  ┌─── 向量检索 ───┐    ┌─── 关键词检索 ───┐     │
│  │ 匹配语义相似度   │    │ 匹配字面关键词     │     │
│  │                 │    │                   │     │
│  │ ✅ "提升LLM精度" │    │ ❌ (不含"准确率")  │     │
│  │ ✅ "优化模型效果" │    │ ❌ (不含关键词)    │     │
│  │ ❌ "准确率定义"   │    │ ✅ "准确率评估方法" │     │
│  └─────────────────┘    └───────────────────┘    │
│                                                   │
│  混合检索 = 两者结果合并 → 覆盖最全面               │
└─────────────────────────────────────────────────┘
```

## 适用场景对比

| 维度 | 向量检索 | 关键词检索(BM25) |
|------|---------|-----------------|
| 语义匹配 | ✅ 同义词、近义词都能命中 | ❌ 只能字面匹配 |
| 精确匹配 | ❌ 专有名词、ID容易漏 | ✅ 精确命中 |
| 数值/代码 | ❌ 不擅长 | ✅ 精确匹配 |
| 长尾词 | ❌ 训练数据少时效果差 | ✅ 不依赖训练 |
| 多语言 | ✅ 跨语言匹配 | ❌ 需要分词器支持 |
| 实时性 | ⚠️ 新文档需要重新embedding | ✅ 倒排索引即时生效 |
| 可解释性 | ❌ 黑盒相似度 | ✅ 可以看到匹配了哪些词 |

### 典型适用场景

**向量检索更适合:**
- "怎么做情感分析" → 召回"文本情感分类方法"
- "性能优化方案" → 召回"系统提速策略"
- 概念性、开放性查询

**关键词检索更适合:**
- "Elasticsearch 7.17" → 精确版本号
- "ERROR_CODE_4096" → 精确错误码
- "SELECT * FROM" → 代码片段
- 精确性、特定性查询

## 混合检索实现

### 标准流水线

```python
def hybrid_retrieval(query, top_k=10):
    """向量+关键词混合检索"""
    
    # Step 1: 双路独立召回
    vector_results = vector_store.search(
        embedding_model.encode(query),
        top_k=top_k * 3  # 扩大召回
    )
    
    keyword_results = es_client.search(
        index="documents",
        body={
            "query": {"match": {"content": query}},
            "size": top_k * 3
        }
    )['hits']['hits']
    
    # Step 2: RRF融合
    return rrf_fusion(vector_results, keyword_results, top_k)

def rrf_fusion(*result_lists, k=60, top_k=10):
    """
    Reciprocal Rank Fusion
    k: 平滑常数，通常60
    """
    scores = {}
    doc_sources = {}  # 记录每篇文档来自哪路检索
    
    for list_idx, results in enumerate(result_lists):
        source_name = ['vector', 'keyword'][list_idx]
        for rank, doc in enumerate(results):
            doc_id = doc['id']
            if doc_id not in scores:
                scores[doc_id] = 0
                doc_sources[doc_id] = []
            scores[doc_id] += 1.0 / (k + rank + 1)
            doc_sources[doc_id].append(source_name)
    
    # 按RRF分数排序
    ranked = sorted(scores.items(), key=lambda x: -x[1])[:top_k]
    return [(doc_id, score, doc_sources[doc_id]) for doc_id, score in ranked]
```

### 为什么选RRF而不是加权融合？

| 方法 | 公式 | 优点 | 缺点 |
|------|------|------|------|
| 加权融合 | `α·s_vec + (1-α)·s_kw` | 直观，可调权重 | 两路分数分布不同，不公平 |
| RRF | `Σ 1/(k+rank)` | 无需归一化，对分数分布不敏感 | 忽略了分数的绝对值 |
| CombSUM | `Σ normalize(s)` | 考虑了绝对分数 | 依赖归一化质量 |

**工程结论**: RRF是最稳健的选择，不需要调参，在大多数场景下效果优于或接近加权融合。

## 工程架构

```
┌──────────┐
│  Query   │
└────┬─────┘
     ├──→ Embedding Model ──→ Milvus/Pinecone ──→ Top-30
     │                                              │
     └──→ ES Analyzer ─────→ Elasticsearch ─────→ Top-30
                                                    │
                                           ┌────────┘
                                           ▼
                                    RRF Fusion
                                           │
                                           ▼
                                     Top-10 结果
                                           │
                                           ▼
                                    Reranker (可选)
                                           │
                                           ▼
                                    Final Top-5
```

## 工程实践要点

1. **双写一致性**: 文档入库时同时写ES和向量库，用消息队列保证最终一致
2. **Embedding版本管理**: 换embedding模型时需要重新构建整个向量库
3. **分词器选择**: 中文用IK分词器，代码用标准分词器
4. **召回量**: 一般取top_k的3-5倍做初始召回，给RRF足够的候选池
