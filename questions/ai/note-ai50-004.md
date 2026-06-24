---
id: note-ai50-004
difficulty: L3
category: ai
subcategory: RAG
tags:
  - 某厂
  - 面经
  - RAG
  - Reranker
  - 检索优化
feynman:
  essence: '向量检索是粗筛，Reranker是精排，两阶段pipeline用不同模型各司其职'
  analogy: '就像招聘——HR先按简历关键词海选(向量检索)，然后技术面试官逐个深入评估(Reranker)。两步都不可少'
  first_principle: '双塔模型(向量检索)速度快但精度低因为Query和Doc独立编码无法交互；Cross-Encoder(Reranker)精度高因为能建模Query-Doc的深层交互但速度慢'
  key_points:
    - '向量检索用Bi-Encoder: Query和Doc分别编码，速度快可离线计算'
    - 'Reranker用Cross-Encoder: Query和Doc拼接后联合编码，精度高但只能在线计算'
    - '工业标准: 向量召回Top-50~100 → Reranker精排Top-5~10'
    - '主流Reranker: BGE-Reranker, Cohere Rerank, bce-reranker'
first_principle:
  essence: '检索质量 = 召回率 × 精确率，Bi-Encoder保证召回率，Cross-Encoder提升精确率'
  derivation: 'Bi-Encoder将Query和Doc独立映射到向量空间，无法捕获细粒度的Query-Doc交互信息。Cross-Encoder让两者在attention层交互，能判断"这个段落是否真的回答了这个问题"'
  conclusion: '两阶段检索是计算成本和信息精度的最优权衡'
follow_up:
  - 'Reranker的延迟通常是多少？如何优化？'
  - '如果向量检索的召回率本身很低，加Reranker有用吗？'
  - '可以自己训练Reranker吗？需要什么数据？'
---

# 为什么要加Reranker重排？直接拿向量检索结果给模型会有什么问题？

## 问题：向量检索的盲区

```python
# 向量检索(Bi-Encoder)的问题示例

query = "Python怎么读取文件的最后一行"

# 向量检索Top-3结果 (可能的问题):
# 1. "Python文件操作完整指南"     ← 相关但不精确，没有直接答案
# 2. "Java如何读取文件最后一行"    ← 语义相似但语言错误！
# 3. "Python文件读取性能优化"      ← 相关但不是具体方法

# Reranker重排后:
# 1. "Python读取文件最后一行的3种方法"  ← Cross-Encoder精确匹配
# 2. "Python file.readline()用法详解"
# 3. "Python文件操作完整指南"
```

## Bi-Encoder vs Cross-Encoder

```
┌─── Bi-Encoder (向量检索) ──────────────────────────┐
│                                                     │
│  Query ──→ Encoder ──→ [Q向量]                      │
│                            ↕ cos similarity          │
│  Doc   ──→ Encoder ──→ [D向量]  (离线预计算)        │
│                                                     │
│  特点: Query和Doc独立编码，无交互                     │
│  速度: 极快 (向量内积)                               │
│  精度: 中等 (无法建模细粒度交互)                      │
└─────────────────────────────────────────────────────┘

┌─── Cross-Encoder (Reranker) ───────────────────────┐
│                                                     │
│  [Query, Doc] ──→ Encoder ──→ 相关性分数             │
│                                                     │
│  特点: Query和Doc拼接后联合编码，深层交互             │
│  速度: 慢 (每对Q-D都要前向传播)                      │
│  精度: 高 (Self-Attention建模交互)                   │
└─────────────────────────────────────────────────────┘
```

## 工业标准Pipeline

```python
from sentence_transformers import SentenceTransformer, CrossEncoder

class HybridRetrievalPipeline:
    def __init__(self):
        # Stage 1: 向量召回 (Bi-Encoder)
        self.bi_encoder = SentenceTransformer('BAAI/bge-large-zh-v1.5')
        # Stage 2: 重排 (Cross-Encoder)
        self.cross_encoder = CrossEncoder('BAAI/bge-reranker-large')
    
    def retrieve(self, query, top_k=5):
        # Stage 1: 粗排 - 向量检索Top-50
        query_vec = self.bi_encoder.encode(query)
        candidates = vector_store.search(query_vec, top_k=50)
        
        # Stage 2: 精排 - Cross-Encoder重排
        pairs = [(query, doc['content']) for doc in candidates]
        rerank_scores = self.cross_encoder.predict(pairs)
        
        # 组合排序
        for doc, score in zip(candidates, rerank_scores):
            doc['rerank_score'] = float(score)
        
        candidates.sort(key=lambda x: -x['rerank_score'])
        return candidates[:top_k]
```

## 不加Reranker的具体问题

| 问题类型 | 表现 | 影响 |
|---------|------|------|
| 语义相近但答非所问 | 检索到相关主题但不包含答案 | 模型生成错误回答 |
| 跨语言混淆 | 中文Query匹配到英文文档 | 模型输入语言不一致 |
| 专有名词混淆 | "Java Spring"匹配到"Python Spring" | 技术栈错误 |
| 长文档截断 | 大文档只取了一部分，关键信息在另一部分 | 信息不完整 |
| 排序不合理 | 最相关结果排第5而非第1 | 模型上下文浪费在低质量内容上 |

## 主流Reranker对比

| 模型 | 特点 | 延迟(ms/对) | 适用场景 |
|------|------|------------|---------|
| BGE-Reranker-Large | 开源，中英文效果好 | ~20 | 通用首选 |
| BGE-Reranker-Base | 更轻量 | ~10 | 低延迟场景 |
| Cohere Rerank | API调用，效果好 | ~50(网络) | 不想自建 |
| bce-reranker-base | 中文效果好 | ~15 | 中文为主 |
| GPT-4 Reranker | 用LLM打分 | ~500 | 极致精度，成本高 |

## 延迟优化

```python
# 1. 批量预测
scores = cross_encoder.predict(pairs, batch_size=32)

# 2. 减少候选数 (50→20)
# 向量检索Top-50 → 初步过滤Top-20 → Reranker精排

# 3. 截断Doc长度
pairs = [(query, doc['content'][:512]) for doc in candidates]
# Cross-Encoder的max_length通常512，超出部分被截断

# 4. ONNX量化加速
# 将PyTorch模型转ONNX，推理速度提升2-3倍
```

## 效果提升实测

| 配置 | Recall@5 | 端到端准确率 | 延迟(P99) |
|------|---------|-------------|----------|
| 仅向量检索 | 72% | 65% | 50ms |
| 向量+Reranker | 89% | 82% | 120ms |
| 向量+Reranker+RAGAS调优 | 93% | 88% | 120ms |

**结论**: Reranker通常能提升15-20个百分点的Recall@5，是RAG系统从60分到80分的关键组件。
