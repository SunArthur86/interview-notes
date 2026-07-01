---
id: note-bz-agent-048
difficulty: L3
category: ai
subcategory: RAG
tags:
- B站面经
- RAG优化
- 检索召回
feynman:
  essence: RAG召回率优化=全链路：查询改写(查得对)+混合检索(查得全)+Rerank(排得准)+分块优化(切得好)+参数调优。十种技巧覆盖检索前中后。
  analogy: 像钓鱼——选对鱼饵(查询改写)、多撒几竿(多路召回)、挑大鱼(重排)、选好钓点(分块)。
  first_principle: 召回率低要么是"没查对"(查询问题)要么是"查不到"(索引/检索方法问题)。全链路优化每个环节。
  key_points:
  - 十种技巧：查询改写/HyDE/多查询/混合检索/Rerank/分块/元数据/参数/上下文扩展/反馈
  - 分检索前/中/后三类
  - 核心思想：多路召回+精排
  - 评估驱动优化
first_principle:
  essence: 召回率=该找到的有没有找到。受查询质量、检索方法、数据组织三方面影响。
  derivation: 查询表达不全→查不到(改写查询)。单一检索方法有盲区→漏召回(混合检索)。分块不当→语义被切断(优化分块)。全链路优化才能最大化召回。
  conclusion: 召回率优化 = 查询优化（查得对） + 多路检索（查得全） + 精排序（排得准）
follow_up:
- 召回率怎么衡量？——有标注数据算recall，无标注用LLM评估
- 召回率和精度冲突吗？——会，先保召回再优化精度
- 极限能到多少？——视任务而定，通常>80%算好
memory_points:
- 框架口诀：前改写、中混合、后重排、底分块（查前优化、查中召回、查后精排、基础数据）。
- 检索前：用查询改写或HyDE（生假设答案）对齐文档语义，多查询广撒网。
- 检索中：核心是混合检索（向量加BM25），外加元数据过滤缩小范围。
- 检索后：必做Rerank重排精选上下文，并配合去重压缩降噪音。
- 数据层：分块决定上限，推荐父子分块（小块检索，大块返回保留上下文）。
---

# RAG 有哪些优化技巧？（十种）

## 一、十种优化技巧总览

```
┌──────────────────────────────────────────────────┐
│          RAG 召回率优化十技                          │
├──────────────────────────────────────────────────┤
│                                                    │
│  【检索前：查询优化】                                │
│  1. 查询改写（Query Rewriting）                    │
│  2. HyDE（假设答案检索）                           │
│  3. 多查询融合（Multi-Query）                      │
│  4. 查询扩展（Query Expansion）                    │
│                                                    │
│  【检索中：方法优化】                                │
│  5. 混合检索（向量+BM25）                          │
│  6. 多路召回（不同chunk_size/不同模型）             │
│  7. 元数据过滤（缩小搜索范围）                      │
│                                                    │
│  【检索后：结果优化】                                │
│  8. Rerank重排序                                   │
│  9. 上下文扩展（Context Expansion）                │
│  10. 去重与压缩                                    │
│                                                    │
│  【数据层：基础优化】                                │
│  + 分块策略优化（父子分块/语义分块）                │
│                                                    │
└──────────────────────────────────────────────────┘
```

## 二、检索前：查询优化

### 技巧 1：查询改写

```python
def rewrite_query(query):
    """把口语化查询改成检索友好的形式"""
    return llm.rewrite(f"把以下查询改成更适合检索的关键词形式: {query}")
    # "那个做AI的很火的公司" → "OpenAI 人工智能 公司"
```

### 技巧 2：HyDE（假设答案检索）

```python
def hyde_retrieve(query):
    """先生成假设答案，用答案检索"""
    # 假设答案的语义更接近文档（而非问题）
    hypothetical = llm.generate(f"假设回答: {query}")
    # "Agent是什么" → "Agent是能自主行动的AI系统，具有规划能力..."
    docs = vector_db.search(embed(hypothetical))
    return docs
```

### 技巧 3：多查询融合

```python
def multi_query(query):
    """生成多个角度的查询，分别检索后合并"""
    variants = llm.generate(f"用3种不同表述: {query}")
    # ["AI智能体", "autonomous agent", "自主代理系统"]
    
    all_docs = []
    for v in variants:
        all_docs.extend(vector_db.search(v, k=5))
    
    # 去重+排序
    return deduplicate(all_docs)
```

### 技巧 4：查询扩展

```python
def expand_query(query):
    """加同义词/相关词扩大匹配"""
    synonyms = llm.get_synonyms(query)
    # "Agent" → ["Agent", "智能体", "autonomous", "代理"]
    expanded = query + " " + " ".join(synonyms)
    return expanded
```

## 三、检索中：方法优化

### 技巧 5：混合检索

```python
def hybrid_retrieve(query):
    """向量检索 + BM25 关键词检索 融合"""
    # 向量：语义匹配（"开心"≈"快乐"）
    dense = vector_db.search(embed(query), k=10)
    
    # BM25：精确匹配（专有名词/代码）
    sparse = bm25.search(query, k=10)
    
    # RRF融合
    return rrf_merge(dense, sparse)

def rrf_merge(list_a, list_b, k=60):
    """Reciprocal Rank Fusion"""
    scores = {}
    for rank, doc in enumerate(list_a):
        scores[doc.id] = scores.get(doc.id, 0) + 1/(k + rank)
    for rank, doc in enumerate(list_b):
        scores[doc.id] = scores.get(doc.id, 0) + 1/(k + rank)
    return sorted(scores, key=scores.get, reverse=True)
```

### 技巧 6：多路召回

```python
def multi_path_retrieve(query):
    """不同参数/模型多路召回"""
    results = []
    # 不同chunk_size
    results += vector_db_small.search(query, k=5)   # 小块(精准)
    results += vector_db_large.search(query, k=5)   # 大块(上下文)
    # 不同embedding模型
    results += openai_db.search(query, k=5)
    results += bge_db.search(query, k=5)
    return merge(results)
```

### 技巧 7：元数据过滤

```python
def filtered_retrieve(query, filters):
    """先过滤再检索，缩小范围"""
    return vector_db.search(
        embed(query),
        filter={
            "version": "latest",      # 只要最新版
            "doc_type": "manual",     # 只要手册
            "date": {"$gte": "2026"}  # 2026年以后的
        },
        k=10
    )
```

## 四、检索后：结果优化

### 技巧 8：Rerank 重排序

```python
def rerank(query, docs, top_k=5):
    """Cross-Encoder精排"""
    # 召回top-20，精排选top-5
    pairs = [(query, doc.content) for doc in docs]
    scores = cross_encoder.predict(pairs)
    ranked = sorted(zip(docs, scores), key=lambda x: -x[1])
    return [d for d, s in ranked[:top_k]]
```

### 技巧 9：上下文扩展

```python
def expand_context(docs):
    """找到相邻块，补充上下文"""
    for doc in docs:
        # 找到前后相邻的块
        prev = vector_db.get(doc.id - 1)
        next_ = vector_db.get(doc.id + 1)
        doc.context = [prev, doc, next_]
    # 防止关键信息被分块切断
```

### 技巧 10：去重与压缩

```python
def dedup_and_compress(docs):
    """去重+压缩"""
    # 去重（多路召回会有重复）
    unique = deduplicate_by_similarity(docs, threshold=0.9)
    # 压缩（长文档提取关键句）
    for doc in unique:
        if len(doc.content) > 500:
            doc.content = llm.extract_keypoints(doc.content)
    return unique
```

## 五、数据层：分块优化

```python
# 父子分块：检索小块，返回大块
class ParentChildRetriever:
    def retrieve(self, query):
        # 用小块精准检索
        small_chunks = self.small_index.search(query, k=5)
        # 返回对应的父块（上下文更全）
        parent_ids = [c.metadata["parent_id"] for c in small_chunks]
        return [self.parent_store.get(pid) for pid in parent_ids]
```

## 六、效果对比（经验值）

```
以基础RAG为基线(假设recall=60%)：

技巧                     recall提升
─────────────────────────────────
基础(向量检索top-5)       60% (基线)
+查询改写                 65% (+5%)
+混合检索(向量+BM25)      75% (+15%)  ← 效果显著
+Rerank                   80% (+20%)  ← 效果显著
+HyDE                     78% (+18%)
+多查询融合               82% (+22%)
+上下文扩展               80% (+20%)
+全部组合                 88% (+28%)

结论：混合检索+Rerank 是性价比最高的两个技巧
```

## 七、面试加分点

1. **全链路视角**：检索前(查询)+检索中(方法)+检索后(排序)，系统性
2. **强调混合检索+Rerank**：这两个是性价比最高的，必提
3. **多路召回思想**：召回阶段宁多勿少（先召回再精排），体现"召回率优先"原则

## 记忆要点

- 框架口诀：前改写、中混合、后重排、底分块（查前优化、查中召回、查后精排、基础数据）。
- 检索前：用查询改写或HyDE（生假设答案）对齐文档语义，多查询广撒网。
- 检索中：核心是混合检索（向量加BM25），外加元数据过滤缩小范围。
- 检索后：必做Rerank重排精选上下文，并配合去重压缩降噪音。
- 数据层：分块决定上限，推荐父子分块（小块检索，大块返回保留上下文）。

