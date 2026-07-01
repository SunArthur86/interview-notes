---
id: note-bz-agent-085
difficulty: L3
category: ai
subcategory: RAG
tags:
- B站面经
- 文档问答
- 召回率
feynman:
  essence: 文档问答召回率提升=查询优化(改写/HyDE)+混合检索(向量+BM25)+Rerank+分块优化+元数据过滤。全链路优化，检索是核心。
  analogy: 像图书馆找书——好的检索词(查询优化)、多种索引方式(混合检索)、让馆员帮你挑(Rerank)、合理分类摆放(分块)。
  first_principle: 召回率=该找到的有没有找到。受查询质量、检索方法、数据组织三方面影响，需全链路优化。
  key_points:
  - 查询：改写/HyDE/多查询
  - 检索：混合(向量+BM25)
  - 排序：Rerank精选
  - 数据：分块/元数据/父子
first_principle:
  essence: 召回率取决于"查询与文档的匹配质量"，需多维度提升。
  derivation: 查询表达差→匹配不到(改写)。单一检索有盲区→漏召回(混合)。分块不当→语义断(优化分块)。多管齐下才能最大化召回。
  conclusion: 文档问答召回 = 查询优化 + 混合检索 + Rerank + 数据优化的全链路
follow_up:
- 召回率多少算好？——>85%算优秀
- 召回和精度冲突怎么办？——先保召回再Rerank提精度
- 怎么评估？——标注relevant docs算recall@k
memory_points:
- 提升召回五步走：查询改写优化、多路混合检索、Rerank精排、优化分块、调参
- HyDE反向假设：先让大模型生成假设答案，再拿答案去向量库做相似度检索
- 多路融合检索：向量搜语义，BM25搜关键词，RRF算法融合去重提升长尾覆盖
- 精排保精准：粗筛后用交叉编码器Rerank，解决向量检索的噪音问题
---

# 文档问答系统的检索召回率如何提升？

## 一、文档问答的检索挑战

```
文档问答(Document QA) vs 普通搜索：
  - 答案藏在文档的某一段落，需精准定位
  - 用户问法多样，与文档表述有语义鸿沟
  - 文档可能很长，关键信息占比小
  - 需要高召回（漏了就答不出）+高精度（噪音干扰生成）

核心指标：
  recall@k: 应该检索到的是否都在前k个结果里
  precision@k: 检索到的是否都相关
```

## 二、全链路优化方案

```
┌──────────────────────────────────────────────────┐
│            召回率提升全链路                           │
├──────────────────────────────────────────────────┤
│                                                    │
│  1. 查询优化层                                     │
│     改写 / HyDE / 多查询 / 扩展                    │
│                                                    │
│  2. 检索方法层                                     │
│     向量 + BM25混合 + 多路召回                     │
│                                                    │
│  3. 排序优化层                                     │
│     Rerank / 上下文扩展                            │
│                                                    │
│  4. 数据组织层                                     │
│     分块策略 / 元数据 / 父子分块                   │
│                                                    │
│  5. 参数调优层                                     │
│     top_k / 阈值 / chunk_size                     │
│                                                    │
└──────────────────────────────────────────────────┘
```

## 三、查询优化（缩小语义鸿沟）

```python
class QueryOptimizer:
    def optimize(self, query):
        queries = [query]
        
        # 1. 改写：口语→规范
        queries.append(self.rewrite(query))
        
        # 2. HyDE：用假设答案检索
        hyde = self.llm.generate(f"简要回答: {query}")
        queries.append(hyde)
        
        # 3. 多查询：不同角度
        queries.extend(self.llm.variants(query, n=3))
        
        # 4. 子问题分解（复杂问题）
        if self.is_complex(query):
            queries.extend(self.decompose(query))
        
        return queries  # 一个查询变多个，扩大覆盖
```

## 四、混合检索（多路覆盖）

```python
class HybridDocRetriever:
    def retrieve(self, query, top_k=20):
        results = []
        
        # 路径1: 向量检索（语义匹配）
        results += self.vector_db.search(embed(query), k=20)
        
        # 路径2: BM25（关键词/专有名词）
        results += self.bm25.search(query, k=20)
        
        # 路径3: 元数据过滤后检索
        if self.has_metadata_hint(query):
            results += self.filtered_search(query)
        
        # 路径4: 多查询分别检索（每个查询都查）
        for variant in self.query_variants(query):
            results += self.vector_db.search(variant, k=5)
        
        # 去重融合
        return self.rrf_merge(results)[:top_k]
```

## 五、Rerank 精选

```python
def retrieve_and_rerank(query, top_k=5):
    # 广召回（top-30）
    candidates = hybrid_retrieve(query, top_k=30)
    
    # Cross-Encoder精排
    reranked = cross_encoder.rerank(query, candidates)
    
    # 上下文扩展（找到相邻段落）
    expanded = []
    for doc in reranked[:top_k]:
        expanded.append(doc)
        # 加入前后相邻段落（补全被切断的语义）
        expanded += self.get_neighbors(doc, window=1)
    
    return deduplicate(expanded)
```

## 六、数据组织优化

```python
# 父子分块：检索小块精准，返回大块完整
class ParentChildDocIndex:
    def build(self, documents):
        for doc in documents:
            # 大块（保留完整上下文）
            parents = semantic_split(doc, target_size=2000)
            for parent in parents:
                # 小块（精准匹配）
                children = split(parent, size=300)
                for child in children:
                    child.metadata["parent"] = parent.id
                    self.index(child)  # 小块建索引
    
    def retrieve(self, query):
        # 检索小块
        small_hits = self.search(query, k=10)
        # 返回对应的大块
        parent_ids = {h.metadata["parent"] for h in small_hits}
        return [self.get_parent(pid) for pid in parent_ids]

# 元数据增强
def enrich_metadata(doc):
    doc.metadata.update({
        "section": extract_section(doc),      # 所属章节
        "doc_type": classify(doc),             # 文档类型
        "keywords": extract_keywords(doc),     # 关键词
        "summary": llm.summarize(doc),         # 摘要（用于另一路检索）
    })
```

## 七、参数调优

```python
# A/B测试找最优参数
param_experiments = [
    {"chunk_size": 300, "overlap": 50, "top_k": 5},
    {"chunk_size": 500, "overlap": 50, "top_k": 10},
    {"chunk_size": 300, "overlap": 100, "top_k": 5},
    {"chunk_size": 800, "overlap": 100, "top_k": 3},
]

for params in param_experiments:
    recall = evaluate_recall(test_set, **params)
    print(f"{params}: recall@5 = {recall}")

# 经验最优：
# chunk_size: 300-500（中文）
# overlap: 50-100
# recall top_k: 20（广召回）
# final top_k: 5（精排后）
```

## 八、效果评估

```python
def evaluate_recall(test_cases):
    """
    test_cases = [
        {query, relevant_doc_ids: [...]},
        ...
    ]
    """
    recalls = []
    for case in test_cases:
        retrieved = retrieve(case["query"], k=20)
        retrieved_ids = {d.id for d in retrieved}
        relevant_ids = set(case["relevant_doc_ids"])
        
        recall = len(retrieved_ids & relevant_ids) / len(relevant_ids)
        recalls.append(recall)
    
    avg_recall = sum(recalls) / len(recalls)
    
    # 分层分析
    by_difficulty = {
        "简单(事实查询)": avg,
        "中等(需理解)": avg,
        "复杂(多跳/推理)": avg,
    }
    
    return {"overall": avg_recall, "breakdown": by_difficulty}
```

## 九、优化效果（经验值）

```
优化路径与效果：

基线(向量检索top-5)           recall: 60%
+增大top_k到20               recall: 72% (+12%)
+混合检索(向量+BM25)         recall: 82% (+10%)
+查询改写                    recall: 86% (+4%)
+Rerank                     recall: 85% (-1%,但precision↑)
+父子分块                    recall: 88% (+3%)
+多查询融合                  recall: 90% (+2%)

结论：混合检索+增大top_k是最大提升
      Rerank可能recall微降但precision大幅提升（值得）
```

## 十、面试加分点

1. **全链路优化**：查询+检索+排序+数据+参数，系统性
2. **混合检索+Rerank 是黄金组合**：先广召回(混合)再精选(Rerank)
3. **父子分块**：解决"精准检索"和"上下文完整"的矛盾——进阶技巧

## 记忆要点

- 提升召回五步走：查询改写优化、多路混合检索、Rerank精排、优化分块、调参
- HyDE反向假设：先让大模型生成假设答案，再拿答案去向量库做相似度检索
- 多路融合检索：向量搜语义，BM25搜关键词，RRF算法融合去重提升长尾覆盖
- 精排保精准：粗筛后用交叉编码器Rerank，解决向量检索的噪音问题

