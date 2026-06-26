---
id: note-bz-agent-053
difficulty: L3
category: ai
subcategory: RAG
tags:
  - B站面经
  - Rerank
  - 重排序
feynman:
  essence: Rerank=用更精确(但更慢)的模型对召回结果重新排序。召回阶段用快的向量检索找top-20，Rerank用Cross-Encoder精选top-5，兼顾速度和精度。
  analogy: 像招聘——HR快速筛简历召回top-20(快但粗)，技术面试精挑top-5(慢但准)。
  first_principle: 向量检索(Bi-Encoder)快但粗，Cross-Encoder慢但准。两阶段=先用快的广召回，再用慢的精选。
  key_points:
    - 两阶段：召回(Bi-Encoder快)→重排(Cross-Encoder准)
    - Bi-Encoder是query和doc分别编码
    - Cross-Encoder是query和doc拼接后一起编码
    - 提升精度5-15%
first_principle:
  essence: 精度和速度的权衡——Bi-Encoder快但精度低，Cross-Encoder准但慢。
  derivation: 'Bi-Encoder：query和doc分别编码成向量比相似度（可预计算，快）。Cross-Encoder：query+doc拼接输入模型，交互式计算（无法预计算，慢但准）。两阶段结合取长补短。'
  conclusion: Rerank = 召回用快的(Bi-Encoder)，精排用准的(Cross-Encoder)
follow_up:
  - Rerank用什么模型？——Cross-Encoder(如bge-reranker)
  - Rerank多少个合适？——召回top-20，重排选top-5
  - Rerank延迟高怎么办？——并行+缓存+异步
---

# 重排算法（Rerank）如何提升检索匹配精度？

## 一、为什么需要 Rerank

```
向量检索（Bi-Encoder）的问题：
  query和doc分别编码成向量，算cosine相似度
  优点：doc向量可预计算，检索快（O(logn)）
  缺点：query和doc没有"交互"，精度有限
  
  例：
    query="苹果手机怎么样"
    doc1="苹果公司的手机产品"  ← 相关
    doc2="苹果(水果)的营养"    ← 不相关但向量可能相近
    
    Bi-Encoder可能把两者排得接近（因为都有"苹果"）

Rerank（Cross-Encoder）解决：
  query和doc拼接后一起输入模型，深度交互
  能区分"苹果手机"和"苹果水果"
  精度高，但慢（无法预计算，每次都要前向传播）
```

## 二、Bi-Encoder vs Cross-Encoder

```
┌──────────────┬──────────────────┬──────────────────────┐
│ 维度          │ Bi-Encoder          │ Cross-Encoder           │
├──────────────┼──────────────────┼──────────────────────┤
│ 计算方式      │ query和doc分别编码   │ query+doc拼接后编码     │
│ 交互          │ 无（只比向量距离）   │ 有（Attention交互）    │
│ 预计算        │ doc向量可预存        │ 不可（依赖query）       │
│ 速度          │ 快（向量检索）       │ 慢（每个doc一次推理）   │
│ 精度          │ 中                  │ 高                      │
│ 适用阶段      │ 召回（从百万中选百）│ 重排（从百中选十）      │
└──────────────┴──────────────────┴──────────────────────┘

两阶段Pipeline：
  百万文档 --Bi-Encoder(快)--> top-20 --Cross-Encoder(准)--> top-5
```

## 三、Rerank 实现

```python
from sentence_transformers import CrossEncoder

class Reranker:
    def __init__(self):
        # 加载Cross-Encoder模型
        self.model = CrossEncoder('BAAI/bge-reranker-large')
    
    def rerank(self, query, documents, top_k=5):
        """对召回的文档重排序"""
        # 构造(query, doc)对
        pairs = [(query, doc.content) for doc in documents]
        
        # Cross-Encoder打分（query和doc深度交互）
        scores = self.model.predict(pairs)
        
        # 按分数排序
        ranked = sorted(zip(documents, scores), 
                       key=lambda x: x[1], reverse=True)
        
        return [doc for doc, score in ranked[:top_k]]

# 使用
candidates = vector_db.search(query, k=20)  # 召回20个
reranked = reranker.rerank(query, candidates, top_k=5)  # 重排选5个
```

## 四、Rerank 在 RAG 中的位置

```python
class RAGWithRerank:
    def retrieve(self, query):
        # Stage 1: 召回（快，广撒网）
        candidates = self.hybrid_retrieve(query, top_k=20)
        
        # Stage 2: Rerank（准，精选）
        refined = self.reranker.rerank(query, candidates, top_k=5)
        
        # Stage 3: 后处理
        final = self.post_process(refined)
        
        return final
```

## 五、Rerank 模型选择

```python
rerank_models = {
    "bge-reranker-large": {
        "语言": "中英",
        "效果": "SOTA开源",
        "推荐": "首选"
    },
    "bge-reranker-base": {
        "语言": "中英",
        "效果": "略低于large",
        "优点": "更快更轻"
    },
    "cohere-rerank": {
        "语言": "多语言",
        "效果": "很好",
        "缺点": "收费API"
    },
    "LLM as Reranker": {
        "方法": "让GPT-4/Claude给文档打分",
        "效果": "最好",
        "缺点": "最贵最慢"
    },
}
```

## 六、效果与成本

```
Rerank对RAG效果提升（经验值）：

基线（无Rerank，向量top-5）     准确率 70%
+Rerank(bge-reranker)          准确率 82%  (+12%)

成本：
  召回20个 + Rerank → 增加约200ms延迟
  每次Rerank需20次Cross-Encoder推理

优化延迟：
  - 并行打分（GPU批量）
  - 减少Rerank数量（top-10而非top-20）
  - 缓存（相同query+doc的分数缓存）
  - 异步（先返回部分结果，后台Rerank）
```

## 七、面试加分点

1. **两阶段是经典模式**：召回(快/广)→重排(慢/准)，这是信息检索的标准做法
2. **解释 Bi vs Cross**：Bi-Encoder 无交互快但不准，Cross-Encoder 有交互准但慢
3. **效果显著**：Rerank 通常能提升 10%+ 准确率，是 RAG 优化性价比最高的手段
