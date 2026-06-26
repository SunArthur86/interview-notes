---
id: note-bz-agent-049
difficulty: L3
category: ai
subcategory: RAG
tags:
  - B站面经
  - RAG
  - 召回率
  - 全链路优化
feynman:
  essence: 提升RAG召回率=全链路优化：查询改写(查得准)+混合检索(查得全)+多路召回(查得广)+参数调优(查得精)。核心思想是"先广撒网再精选"。
  analogy: 像大海捞针——用更好的探测器(查询改写)、多艘船一起捞(多路)、大网眼捞全(高召回)、再挑出真货(重排)。
  first_principle: 召回率=相关文档被检索到的比例。提升途径：让查询更匹配文档、用多种方法覆盖、调大召回量。
  key_points:
    - 全链路：索引→查询→检索→后处理
    - 核心：多路召回+混合检索
    - 参数：增大top_k、降低阈值
    - 评估：用标注数据量化recall
first_principle:
  essence: 召回率受"查询-文档匹配质量"和"检索方法覆盖度"双重影响。
  derivation: '查询表达不佳→匹配不到(改写查询)。单一检索有盲区→漏掉相关文档(混合检索)。top_k太小→排靠后的相关文档被截断(增大k)。三者叠加提升召回。'
  conclusion: 召回率 = 查询匹配度 × 检索覆盖度 × 召回窗口大小
follow_up:
  - 召回率多少算好？——视任务，一般>80%
  - 召回太多会不会降低精度？——会，用Rerank弥补
  - 怎么知道召回率低？——有标注数据算recall，或LLM评估
---

# 如何提升 RAG 的检索召回率？（全链路优化）

## 一、全链路优化框架

```
┌──────────────────────────────────────────────────────┐
│              召回率全链路优化                            │
├──────────────────────────────────────────────────────┤
│                                                        │
│  索引层：分块优化 + Embedding选型 + 元数据              │
│    → 让文档更好地被"表示"                               │
│                                                        │
│  查询层：改写 + 扩展 + HyDE + 分解                      │
│    → 让查询更好地"匹配"文档                             │
│                                                        │
│  检索层：混合检索 + 多路召回 + 参数调优                  │
│    → 用多种方法"广撒网"                                 │
│                                                        │
│  后处理：Rerank + 上下文扩展                            │
│    → "精选"最相关的                                     │
│                                                        │
└──────────────────────────────────────────────────────┘
```

## 二、索引层优化

```python
# 1. 分块优化：父子分块
# 小块索引（精准匹配），命中后返回父块（上下文全）
# 避免关键信息被分块切断

# 2. Embedding选型
# 中文用BGE/Qwen嵌入，英文用OpenAI/text-embedding
# 领域数据可微调Embedding模型

# 3. 多粒度索引
# 同一文档建多个索引：段落级 + 句子级 + 关键词级
# 检索时多粒度召回
```

## 三、查询层优化

```python
class QueryOptimizer:
    def optimize(self, query):
        queries = [query]  # 原始
        
        # 1. 改写
        queries.append(self.rewrite(query))
        
        # 2. HyDE（假设答案）
        hyde = self.llm.generate(f"假设答案: {query}")
        queries.append(hyde)
        
        # 3. 多角度变体
        queries.extend(self.llm.variants(query, n=3))
        
        # 4. 子问题分解
        if self.is_complex(query):
            queries.extend(self.decompose(query))
        
        return queries  # 一个查询变成多个
```

## 四、检索层优化（核心）

### 混合检索

```python
class HybridRetriever:
    def retrieve(self, query, top_k=20):
        # 向量检索（语义）
        dense = self.vector_db.search(embed(query), k=top_k)
        
        # BM25（关键词，擅长专有名词/代码/数字）
        sparse = self.bm25.search(query, k=top_k)
        
        # 融合
        fused = self.rrf_merge(dense, sparse)
        return fused[:top_k]
```

### 多路召回

```python
def multi_route_retrieve(query, top_k=20):
    results = []
    
    # 路径1：原始查询 + 向量检索
    results += vector_db.search(query, k=10)
    
    # 路径2：改写查询 + 向量检索
    rewritten = rewrite(query)
    results += vector_db.search(rewritten, k=10)
    
    # 路径3：BM25关键词
    results += bm25.search(query, k=10)
    
    # 路径4：元数据过滤后检索（如限定文档类型）
    results += vector_db.search(query, filter={"type": "faq"}, k=5)
    
    # 去重合并
    return dedup(results)[:top_k]
```

### 参数调优

```python
# 增大召回窗口
config = {
    "top_k": 20,        # 从5提到20（多召回）
    "similarity_threshold": 0.5,  # 降低阈值（从0.7→0.5）
    "max_context": 4000  # 允许更多上下文
}
# 召回多→精度可能降→用Rerank弥补
```

## 五、后处理：Rerank 精选

```python
def retrieve_with_rerank(query, top_k_recall=20, top_k_final=5):
    # 1. 广召回（top-20）
    candidates = hybrid_retrieve(query, top_k=top_k_recall)
    
    # 2. 精排序（Cross-Encoder）
    reranked = cross_encoder.rerank(query, candidates)
    
    # 3. 取top-5
    return reranked[:top_k_final]
    
# 策略：召回阶段宁多勿少，排序阶段精挑细选
```

## 六、召回率评估

```python
def evaluate_recall(test_cases):
    """
    test_cases: [{query, relevant_doc_ids}, ...]
    """
    total_recall = 0
    for case in test_cases:
        retrieved = retrieve(case["query"], k=20)
        retrieved_ids = {doc.id for doc in retrieved}
        relevant_ids = set(case["relevant_doc_ids"])
        
        # recall = 检索到的相关文档 / 所有相关文档
        recall = len(retrieved_ids & relevant_ids) / len(relevant_ids)
        total_recall += recall
    
    return total_recall / len(test_cases)

# 目标：recall@20 > 85%
```

## 七、优化效果叠加

```
各技巧对召回率的贡献（累积）：

基线（向量top-5）         60%
+增大top_k到20            72%  (+12%)
+混合检索(向量+BM25)      82%  (+10%)
+查询改写                 87%  (+5%)
+多路召回                 90%  (+3%)
+HyDE                    91%  (+1%)

结论：增大top_k和混合检索是最大的两个提升
```

## 八、面试加分点

1. **"广撒网再精选"**：召回阶段多召回（宁滥勿缺），排序阶段精排（宁缺勿滥）
2. **混合检索是关键**：向量+BM25 互补，能覆盖单一方法的盲区
3. **量化评估**：用 recall@k 指标衡量，而非凭感觉
