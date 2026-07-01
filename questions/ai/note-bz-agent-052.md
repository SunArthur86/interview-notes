---
id: note-bz-agent-052
difficulty: L3
category: ai
subcategory: RAG
tags:
- B站面经
- Embedding
- 向量检索
feynman:
  essence: Embedding策略=选对模型(语言/领域)+优化分块+构建多级索引+查询时改写。核心是让"语义相近的文本向量也相近"。
  analogy: 像给每本书编条码——编得好（同类书条码相近），找书时扫一下就能找到相似的。
  first_principle: Embedding把文本映射到高维空间，相似语义→相近向量。策略优化=提升这个映射的质量。
  key_points:
  - 选模型：中文BGE/英文OpenAI/领域微调
  - 分块：大小/重叠/语义分块
  - 索引：多粒度/父子分块
  - 查询：改写/HyDE对齐语义
first_principle:
  essence: Embedding质量决定向量检索的上限。
  derivation: 检索本质是比较向量相似度。如果Embedding把同义文本映射得远、不同义映射得近，检索必然差。所以Embedding模型选择和优化是基础。
  conclusion: 高精度向量检索 = 好的Embedding模型 + 合理的分块 + 优化的查询
follow_up:
- Embedding维度越高越好吗？——不一定，768/1024通常够用
- 怎么评估Embedding质量？——用领域测试集算召回率
- 中文用什么模型好？——BGE/Qwen系列表现优秀
memory_points:
- 四大要素：模型选型是基础，分块策略是关键，索引构建提效率，查询优化保召回。
- 模型选型：中文首选BGE/Qwen，英文OpenAI，专业领域必须用对比学习微调。
- 分块策略：固定大小易切断语义，最推荐递归分块保边界，语义分块最精准。
- 进阶索引：多建多粒度索引，父子分块用小块精准命中，用大块返回完整上下文。
---

# Embedding 策略怎么定？如何构建高精度向量检索体系？

## 一、Embedding 策略四要素

```
┌──────────────────────────────────────────────────┐
│            高精度向量检索四要素                      │
├──────────────────────────────────────────────────┤
│                                                    │
│  1. 模型选择（基础）                                │
│     语言匹配 / 领域适配 / 维度合适                   │
│                                                    │
│  2. 分块策略（关键）                                │
│     大小 / 重叠 / 语义分块                          │
│                                                    │
│  3. 索引构建（效率）                                │
│     多粒度 / 父子分块 / HNSW参数                    │
│                                                    │
│  4. 查询优化（召回）                                │
│     改写 / HyDE / 多查询                            │
│                                                    │
└──────────────────────────────────────────────────┘
```

## 二、Embedding 模型选择

```python
# 按语言选择
model_options = {
    "中文为主": {
        "BGE-large-zh": "智源，中文SOTA，免费",
        "Qwen-embedding": "阿里，中英双语好",
        "m3e-base": "中文社区流行",
    },
    "英文为主": {
        "OpenAI-text-embedding-3": "最强通用，收费",
        "Cohere-embed": "多语言好",
        "all-MiniLM": "轻量免费",
    },
    "多语言": {
        "BGE-m3": "多语言+多粒度，推荐",
        "multilingual-e5": "支持100+语言",
    },
    "领域专用": {
        "医疗/法律/代码": "用领域数据微调通用模型",
    }
}

# 选择原则
principles = [
    "语言匹配：中文文档用中文Embedding",
    "领域适配：通用模型在专业领域效果差，需微调",
    "维度平衡：768-1536维够用，更高收益递减",
    "成本考虑：本地模型免费但需GPU，API方便但收费",
]
```

## 三、分块策略

```python
# 分块直接影响检索粒度
chunking_strategies = {
    "固定大小": {
        "size": 500, "overlap": 50,
        "优点": "简单",
        "缺点": "可能切断语义",
    },
    "递归分块": {
        "按 段落→句子→字符 递归",
        "优点": "平衡语义和大小",
        "推荐": "最常用",
    },
    "语义分块": {
        "用Embedding检测语义边界",
        "优点": "最尊重语义",
        "缺点": "慢",
    },
    "文档结构": {
        "按标题/章节/段落",
        "优点": "保留逻辑结构",
        "适合": "结构化文档(手册/论文)",
    },
}

# 父子分块（推荐）
class ParentChildIndex:
    """检索小块，返回大块"""
    def build(self, docs):
        for doc in docs:
            parent = split(doc, size=2000)     # 大块（上下文全）
            for p in parent:
                children = split(p, size=200)  # 小块（匹配精准）
                for c in children:
                    self.index(c, parent_id=p.id)  # 小块建索引
```

## 四、索引构建

```python
class HighPrecisionIndex:
    def build(self, chunks):
        # 1. 多粒度索引
        self.sentence_index = build_index(chunks, granularity="sentence")
        self.paragraph_index = build_index(chunks, granularity="paragraph")
        
        # 2. HNSW参数调优
        index_params = {
            "M": 16,              # 每个节点的连接数（大=精度高/内存多）
            "ef_construction": 200,  # 建索引时搜索宽度
            "ef_search": 50,      # 查询时搜索宽度（大=精度高/慢）
        }
        
        # 3. 量化（省内存）
        # PQ压缩：精度略降但内存省8倍
        # 适合大规模场景
```

## 五、查询优化

```python
class QueryOptimizer:
    def embed_query(self, query):
        """优化查询的向量化"""
        # 1. 改写查询
        rewritten = self.rewrite(query)
        
        # 2. HyDE
        hypothetical = self.llm.generate(f"假设答案: {query}")
        
        # 3. 多查询
        variants = self.llm.variants(query, n=3)
        
        # 4. 分别向量化
        embeddings = [
            self.embedder.embed(rewritten),
            self.embedder.embed(hypothetical),
        ] + [self.embedder.embed(v) for v in variants]
        
        # 5. 平均/加权融合（提升召回）
        return np.mean(embeddings, axis=0)
```

## 六、Embedding 微调（进阶）

```python
# 当通用Embedding在领域效果差时，微调
from sentence_transformers import InputExample, losses

# 构造训练数据（同义对/正负样本对）
train_examples = [
    # 正样本对（语义相同）
    InputExample(texts=["咋安装", "安装方法"], label=1.0),
    InputExample(texts=["AI", "人工智能"], label=1.0),
    # 负样本对（语义不同）
    InputExample(texts=["安装方法", "卸载步骤"], label=0.0),
]

# 对比学习训练
model = SentenceTransformer('bge-large-zh')
train_dataloader = DataLoader(train_examples, batch_size=32)
train_loss = losses.MultipleNegativesRankingLoss(model)
model.fit(train_objectives=[(train_dataloader, train_loss)], epochs=3)

# 微调后：同义文本向量更近，不同义更远
```

## 七、评估向量检索质量

```python
def evaluate_embedding(test_cases, embedder, vector_db):
    """
    test_cases: [{query, positive_docs, negative_docs}]
    """
    metrics = {}
    
    for case in test_cases:
        query_emb = embedder.embed(case["query"])
        results = vector_db.search(query_emb, k=10)
        
        # 召回率：相关文档是否被检索到
        positive_ids = {d.id for d in case["positive_docs"]}
        retrieved_ids = {d.id for d in results}
        metrics["recall"] = len(positive_ids & retrieved_ids) / len(positive_ids)
        
        # 精度：检索到的是否相关
        metrics["precision"] = len(positive_ids & retrieved_ids) / len(retrieved_ids)
        
        # MRR：相关文档的排名
        for rank, doc in enumerate(results):
            if doc.id in positive_ids:
                metrics["mrr"] = 1 / (rank + 1)
                break
    
    return metrics
```

## 八、面试加分点

1. **选模型按语言/领域**：中文用 BGE，英文用 OpenAI，领域需微调——体现务实
2. **父子分块**：检索小块精准，返回大块上下文全——这是 RAG 进阶技巧
3. **Embedding 可微调**：通用模型在专业领域效果差，微调是终极优化手段

## 记忆要点

- 四大要素：模型选型是基础，分块策略是关键，索引构建提效率，查询优化保召回。
- 模型选型：中文首选BGE/Qwen，英文OpenAI，专业领域必须用对比学习微调。
- 分块策略：固定大小易切断语义，最推荐递归分块保边界，语义分块最精准。
- 进阶索引：多建多粒度索引，父子分块用小块精准命中，用大块返回完整上下文。

