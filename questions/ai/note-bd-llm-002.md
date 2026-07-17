---
id: note-bd-llm-002
difficulty: L3
category: ai
subcategory: RAG
tags:
- 字节
- 面经
- Embedding
- 模型选型
feynman:
  essence: Embedding选型要看语言支持、维度、速度、MTEB榜单表现，必须在自己的业务数据上做A/B评测。
  analogy: 就像选相机镜头——不能只看参数表，要在实际拍摄场景中对比样片才能知道哪个最适合你的需求。
  first_principle: Embedding质量 = 语义表达能力 × 领域适配度 × 推理效率。
  key_points:
  - MTEB榜单排名参考
  - 中英文双语支持(bge-m3等)
  - 维度与存储成本权衡
  - 业务数据Recall@K评测
first_principle:
  essence: Embedding是RAG系统信息瓶颈的入口，质量上限决定了整个系统的天花板
  derivation: Embedding差→向量空间语义不准确→检索召回错误→LLM生成幻觉→全链路失败
  conclusion: Embedding选型必须在自己业务数据上做量化评测
follow_up:
- 如何构建Embedding评测数据集？
- bge-m3和text-embedding-3-large怎么选？
- 领域适配的Embedding怎么微调？
memory_points:
- 第一定律：因为Embedding是系统的第一道信息瓶颈，所以质量差会导致后续模块彻底失效(Garbage In)
- 榜单避坑：MTEB榜单与业务数据有分布差异，所以选型必须在私有数据上做量化评测
- 模型首选：中英双语首选bge-m3，因开源可私有部署且支持多语言与多模式检索
- 维度权衡：维度越高精度越好，但因为存储和检索成本呈线性甚至指数增加，所以需按需取舍
- 降维技术：bge-m3和text-embedding-3支持截断降维，因为保留前N维仍含大部分语义，所以兼顾了精度与成本
---

# 【字节面经】不同的 Embedding 模型对检索质量影响很大，你是如何选型的？有没有做过对比评测？

## 一、为什么Embedding选型是RAG的"生死线"

Embedding模型是RAG系统的**第一道信息瓶颈**。索引阶段的每一条文档、检索阶段的每一次查询都要经过Embedding模型向量化。如果Embedding质量差，向量空间中语义相近的内容距离不够近、语义无关的内容距离不够远，那么后续的重排序、Prompt工程再优秀也无法弥补检索阶段的召回损失——这就是**"Garbage In, Garbage Out"在RAG中的体现**。

选型不能只看公开榜单，**必须在自己的业务数据上做量化评测**。原因有三：
1. 公开榜单（MTEB）的评测数据与业务领域存在分布差异
2. 不同模型在不同语言/长度/粒度上的表现差异巨大
3. 维度和速度直接影响系统成本和用户体验

## 二、主流Embedding模型对比

### 2.1 核心模型对比表

| 模型 | 维度 | 语言支持 | MTEB平均 | 开源 | 特点 | 适用场景 |
|------|------|----------|----------|------|------|----------|
| **bge-m3** | 1024 | 100+语言（中英强） | ~64.7 | ✅ (MIT) | 多语言/多功能（稠密+稀疏+ColBERT） | **中英双语RAG首选** |
| **bge-large-zh-v1.5** | 1024 | 中文为主 | ~64（C-MTEB） | ✅ (MIT) | 中文专精，C-MTEB榜首 | 纯中文场景 |
| **text-embedding-3-small** | 1536（可降维） | 多语言 | ~62.3 | ❌ (API) | OpenAI出品，性价比高 | 英文为主+成本敏感 |
| **text-embedding-3-large** | 3072（可降维） | 多语言 | ~64.6 | ❌ (API) | OpenAI最强Embedding | 英文为主+追求精度 |
| **jina-embeddings-v3** | 1024 | 89语言 | ~65.5 | ✅ (CC-BY) | 支持任务前缀（Task-Type） | 多任务场景 |
| **gte-large-zh** | 1024 | 中文为主 | ~63.5（C-MTEB） | ✅ (Apache-2.0) | 阿里达摩院，中文表现强 | 纯中文替代方案 |
| **voyage-3** | 1024 | 多语言 | ~66.0 | ❌ (API) | MTEB顶级表现 | 高精度英文场景 |
| **Cohere embed-v4** | 1024 | 多语言+多模态 | ~65+ | ❌ (API) | 支持图片Embedding | 多模态RAG |

### 2.2 MTEB榜单解读

**MTEB（Massive Text Embedding Benchmark）** 是HuggingFace维护的最权威Embedding评测基准，涵盖8类任务（检索、分类、聚类、重排、STS等）、58个数据集。

**使用MTEB的注意事项**：
- **关注Retrieval子榜**：RAG场景主要看Retrieval任务分数，而非MTEB平均分。检索任务与QA、分类差异很大。
- **C-MTEB**：中文场景应看C-MTEB（中文版MTEB），涵盖T2Retrieval、MMarcoReranking等中文数据集。
- **版本时效性**：MTEB排行榜更新很快，每1-2个月就有新模型登顶，选型时应查看**最新**数据。
- **榜单≠生产**：榜单数据集通常是百科/新闻类，企业私有领域（如法律、医疗、金融）的排名可能与榜单不同。

### 2.3 中英双语场景选型

对于国内业务（字节/阿里/腾讯场景），文档通常中英混合，选型核心考量：

| 考量维度 | 推荐 |
|----------|------|
| 中英混合文档 | **bge-m3**（多语言SOTA，开源可私有部署） |
| 纯中文 + 数据合规 | **bge-large-zh-v1.5** 或 **gte-large-zh** |
| 英文为主 + 快速接入 | **text-embedding-3-large**（API即用） |
| 成本敏感 | **text-embedding-3-small** 或 **bge-small-zh** |
| 多模态（文+图） | **bge-m3**（文本）+ **CLIP**（图像），或 **Cohere embed-v4** |

**个人首选推荐**：生产环境优先 **bge-m3**——开源、多语言强、支持稠密+稀疏+ColBERT三种检索模式、1024维兼顾精度与效率，且可私有化部署满足数据合规。

### 2.4 维度与存储成本权衡

Embedding维度直接影响存储成本和检索速度：

```
存储估算（100万条文档）：
  768维  float32 → 3.0 GB
  1024维 float32 → 4.0 GB
  1536维 float32 → 6.0 GB
  3072维 float32 → 12.0 GB

检索延迟（HNSW, ef=128）：
  768维  → ~2ms / query
  1024维 → ~3ms / query
  3072维 → ~8ms / query
```

**降维技术（Matryoshka Representation Learning）**：`text-embedding-3` 系列和 `bge-m3` 支持截断降维——3072维的向量截取前1024维仍保留大部分语义信息。这允许在精度和成本之间灵活权衡：

```python
# text-embedding-3 降维示例
response = openai.embeddings.create(
    model="text-embedding-3-large",
    input=query,
    dimensions=256  # 从3072降维到256
)
```

## 三、业务数据评测方法论

### 3.1 评测数据集构建

这是**最关键也最容易被忽视**的一步。需要构建 `(query, relevant_doc_ids)` 标注数据集：

| 来源 | 方法 | 质量 |
|------|------|------|
| 真实用户日志 | 从搜索日志中提取高频Query + 点击文档 | ⭐⭐⭐⭐⭐ |
| 人工标注 | 领域专家标注 Query-Document 相关性 | ⭐⭐⭐⭐ |
| LLM合成 | 用GPT-4根据文档生成问答对 | ⭐⭐⭐ |
| 公开数据集 | MTEB子集 / MS-MARCO | ⭐⭐ |

推荐做法：**从真实日志中提取200-500条Query，人工标注每条Query对应的Top-10相关文档**（二分类：相关/不相关，或细粒度0-3分）。

### 3.2 核心评测指标

| 指标 | 含义 | 适用场景 |
|------|------|----------|
| **Recall@K** | Top-K结果中包含正确文档的比例 | **首选指标**，衡量召回能力 |
| **MRR (Mean Reciprocal Rank)** | 第一个正确文档排名倒数的均值 | 衡量排序质量 |
| **NDCG@K** | 考虑位置折扣和分级相关性的指标 | 细粒度相关性场景 |
| **Precision@K** | Top-K中正确文档的比例 | 衡量精确率 |

**RAG场景为什么首选Recall@K**：RAG系统通过Top-K检索获取候选文档，再交由LLM理解和生成。如果正确的文档**不在Top-K中**，LLM根本无法利用它。因此召回率是第一位的——**Recall@5 > 90% 是一个不错的目标线**。

### 3.3 对比评测代码

```python
"""
Embedding 模型对比评测框架
评估指标: Recall@K, MRR, NDCG@K
依赖: pip install sentence-transformers openai numpy scikit-learn
"""
import time
import numpy as np
from dataclasses import dataclass, field
from typing import Optional


# ============================================================
# 评测数据结构
# ============================================================
@dataclass
class EvalDataset:
    """评测数据集：query列表、doc列表、相关性标注"""
    queries: list[str]                              # Query文本列表
    documents: list[str]                            # 候选文档列表
    relevance: dict[int, dict[int, int]]            # {query_idx: {doc_idx: 相关性分(0-3)}}


@dataclass
class EvalResult:
    model_name: str
    recall_at_k: dict[int, float] = field(default_factory=dict)
    mrr: float = 0.0
    ndcg_at_k: dict[int, float] = field(default_factory=dict)
    latency_ms: float = 0.0
    dim: int = 0


# ============================================================
# Embedding 接口封装
# ============================================================
class EmbeddingBackend:
    """统一接口：支持本地模型和API模型"""

    def __init__(self, model_name: str, backend: str = "local"):
        self.model_name = model_name
        self.backend = backend
        if backend == "local":
            from sentence_transformers import SentenceTransformer
            self.model = SentenceTransformer(model_name)
            self.dim = self.model.get_sentence_embedding_dimension()
        elif backend == "openai":
            from openai import OpenAI
            self.client = OpenAI()
            self.dim = 1536  # text-embedding-3-small

    def encode(self, texts: list[str]) -> np.ndarray:
        if self.backend == "local":
            vecs = self.model.encode(
                texts, normalize_embeddings=True, batch_size=64
            )
            return np.array(vecs)
        else:
            import math
            all_vecs = []
            for i in range(0, len(texts), 256):
                batch = texts[i:i+256]
                resp = self.client.embeddings.create(
                    model=self.model_name, input=batch
                )
                all_vecs.extend([d.embedding for d in resp.data])
            return np.array(all_vecs)


# ============================================================
# 评测指标计算
# ============================================================
def compute_recall_at_k(sim_matrix: np.ndarray, relevance: dict,
                         k: int) -> float:
    """
    Recall@K: Top-K中至少包含一个相关文档的query比例
    sim_matrix: [num_queries, num_docs] 相似度矩阵
    relevance: {query_idx: {doc_idx: score}}，score > 0 即为相关
    """
    recalls = []
    for q_idx, rel_docs in relevance.items():
        if not rel_docs:
            continue
        relevant_set = {d for d, s in rel_docs.items() if s > 0}
        # 取Top-K文档索引
        top_k_idx = np.argsort(sim_matrix[q_idx])[::-1][:k]
        hit = len(relevant_set & set(top_k_idx.tolist()))
        recalls.append(hit / len(relevant_set) if relevant_set else 0)
    return float(np.mean(recalls))


def compute_mrr(sim_matrix: np.ndarray, relevance: dict) -> float:
    """MRR: 第一个相关文档排名的倒数的均值"""
    rrs = []
    for q_idx, rel_docs in relevance.items():
        relevant_set = {d for d, s in rel_docs.items() if s > 0}
        if not relevant_set:
            continue
        ranked = np.argsort(sim_matrix[q_idx])[::-1]
        for rank, doc_idx in enumerate(ranked, 1):
            if doc_idx in relevant_set:
                rrs.append(1.0 / rank)
                break
        else:
            rrs.append(0.0)
    return float(np.mean(rrs))


def compute_ndcg_at_k(sim_matrix: np.ndarray, relevance: dict,
                      k: int) -> float:
    """NDCG@K: 归一化折损累积增益（支持分级相关性）"""
    ndcgs = []
    for q_idx, rel_docs in relevance.items():
        if not rel_docs:
            continue
        ranked = np.argsort(sim_matrix[q_idx])[::-1][:k]
        # DCG
        dcg = sum(
            (2 ** rel_docs.get(doc_idx, 0) - 1) / np.log2(i + 2)
            for i, doc_idx in enumerate(ranked)
        )
        # IDCG (理想排序)
        ideal_scores = sorted(rel_docs.values(), reverse=True)[:k]
        idcg = sum(
            (2 ** s - 1) / np.log2(i + 2)
            for i, s in enumerate(ideal_scores)
        )
        ndcgs.append(dcg / idcg if idcg > 0 else 0.0)
    return float(np.mean(ndcgs))


# ============================================================
# 评测主流程
# ============================================================
def evaluate_embedding(
    backend: EmbeddingBackend,
    dataset: EvalDataset,
    k_values: list[int] = [1, 3, 5, 10],
) -> EvalResult:
    """
    完整评测流程：Embedding → 相似度矩阵 → 指标计算
    """
    # Step 1: 文档和Query向量化
    t0 = time.time()
    doc_vecs = backend.encode(dataset.documents)
    query_vecs = backend.encode(dataset.queries)
    latency = (time.time() - t0) / len(dataset.queries) * 1000

    # Step 2: 计算余弦相似度矩阵（已归一化，直接点积）
    sim_matrix = query_vecs @ doc_vecs.T  # [Q, D]

    # Step 3: 计算各指标
    result = EvalResult(
        model_name=backend.model_name,
        dim=backend.dim,
        latency_ms=latency,
    )
    for k in k_values:
        result.recall_at_k[k] = compute_recall_at_k(sim_matrix, dataset.relevance, k)
        result.ndcg_at_k[k] = compute_ndcg_at_k(sim_matrix, dataset.relevance, k)
    result.mrr = compute_mrr(sim_matrix, dataset.relevance)

    return result


def print_comparison(results: list[EvalResult]):
    """打印对比结果表"""
    print(f"\n{'='*80}")
    print(f"{'模型':<30} {'维度':<8} {'R@1':<8} {'R@5':<8} {'R@10':<8} "
          f"{'MRR':<8} {'延迟ms':<8}")
    print(f"{'='*80}")
    for r in results:
        print(f"{r.model_name:<30} {r.dim:<8} "
              f"{r.recall_at_k.get(1,0):<8.4f} "
              f"{r.recall_at_k.get(5,0):<8.4f} "
              f"{r.recall_at_k.get(10,0):<8.4f} "
              f"{r.mrr:<8.4f} {r.latency_ms:<8.1f}")
    print(f"{'='*80}")


# ============================================================
# 运行评测
# ============================================================
if __name__ == "__main__":
    # 示例评测数据集（实际应从业务数据构建）
    dataset = EvalDataset(
        queries=[
            "向量数据库有哪些？",
            "RAG系统的检索阶段包括什么？",
            "Embedding维度如何选择？",
            # ... 200-500条真实Query
        ],
        documents=[
            "Milvus是开源的分布式向量数据库...",
            "Qdrant使用Rust编写，性能优秀...",
            "RAG检索阶段包括Query向量化、相似度搜索和重排序...",
            "Embedding维度影响存储成本，常见768到3072维...",
            # ... 全量文档chunk
        ],
        relevance={
            0: {0: 3, 1: 3},           # query 0 -> doc 0,1 强相关
            1: {2: 3},                  # query 1 -> doc 2
            2: {3: 2},                  # query 2 -> doc 3 中等相关
        },
    )

    # 候选模型列表
    models_to_eval = [
        ("BAAI/bge-m3", "local"),
        ("BAAI/bge-large-zh-v1.5", "local"),
        ("text-embedding-3-small", "openai"),
        ("text-embedding-3-large", "openai"),
    ]

    results = []
    for model_name, backend_type in models_to_eval:
        print(f"\n正在评测: {model_name} ...")
        backend = EmbeddingBackend(model_name, backend_type)
        result = evaluate_embedding(backend, dataset, k_values=[1, 3, 5, 10])
        results.append(result)

    print_comparison(results)

    # 选型决策：综合 Recall@5 和 延迟 排序
    best = max(results, key=lambda r: r.recall_at_k[5])
    print(f"\n✅ 推荐模型: {best.model_name} (Recall@5={best.recall_at_k[5]:.4f})")
```

### 3.4 评测结果解读与决策框架

拿到评测数据后，按以下框架决策：

```
决策树:
├── Recall@5 差距 < 2%?
│   ├── Yes → 选维度更低/速度更快的模型（降低成本）
│   └── No  → 选 Recall@5 最高的模型
├── 是否需要私有化部署（数据合规）?
│   ├── Yes → 排除API模型，仅考虑开源模型
│   └── No  → API和开源都可选
├── 是否多语言?
│   ├── Yes → 优先 bge-m3 / jina-v3
│   └── No  → 单语言专精模型
└── 延迟要求 < 10ms?
    ├── Yes → 选 ≤1024维模型
    └── No  → 可选高维模型
```

## 四、面试加分点

1. **Embedding是可迭代优化的**：如果预训练模型在业务数据上效果不佳，可以用对比学习（Contrastive Learning）在领域数据上做**微调**（如使用 `sentence-transformers` 的 `MultipleNegativesRankingLoss`），通常Recall@5可提升5-15%。
2. **BGE-M3的三合一特性**：bge-m3同时输出稠密向量（Dense）、稀疏向量（Sparse/词级权重）和ColBERT向量（多向量交互），可以做**混合检索融合**，在多项评测中超过纯稠密检索。
3. **Query和Document的Embedding不对等**：部分模型（如bge）要求Query添加指令前缀（如 `"Represent this sentence for searching relevant passages: "`），评测和部署时务必遵循官方用法。
4. **版本锁定**：生产环境务必锁定Embedding模型版本。一旦更换模型，所有历史向量必须全量重新编码，否则新旧向量不在同一语义空间。
5. **评测的统计显著性**：当评测集较小时（<100条Query），各模型间的指标差异可能在统计噪声范围内。建议报告95%置信区间（Bootstrap重采样），避免过度解读微小差异。

## 记忆要点

- 第一定律：因为Embedding是系统的第一道信息瓶颈，所以质量差会导致后续模块彻底失效(Garbage In)
- 榜单避坑：MTEB榜单与业务数据有分布差异，所以选型必须在私有数据上做量化评测
- 模型首选：中英双语首选bge-m3，因开源可私有部署且支持多语言与多模式检索
- 维度权衡：维度越高精度越好，但因为存储和检索成本呈线性甚至指数增加，所以需按需取舍
- 降维技术：bge-m3和text-embedding-3支持截断降维，因为保留前N维仍含大部分语义，所以兼顾了精度与成本

## 苏格拉底式面试追问

> 这组追问模拟面试官层层逼问，每一问先回答"为什么"，再回答"怎么做"，最后回答"如何证明"。

### 第一层：目标与动机

**Q：Embedding 选型你说"不能只看 MTEB 榜单，要在业务数据上评测"，为什么榜单不可信？**

因为 MTEB 榜单的评测数据和业务数据分布不同。MTEB 是通用语料（Wikipedia、新闻、问答），如果你的业务是法律/医疗/代码，通用 embedding 对专业术语和领域语义的表达力可能很弱，但通用榜单上看不出来。典型现象：某模型在 MTEB 排前 3，但在你的法律文档检索上 Recall@5 只有 0.5（而排第 10 的领域模型有 0.8）。动机是"通用榜单衡量通用能力，业务需要的是领域能力"，必须在自己的数据上验证。

### 第二层：证据与定位

**Q：你换了 embedding 模型后检索 Recall 反而降了，怎么定位是新模型不适合还是接入有 bug？**

两步验证。一是跑 sanity check——用几个已知的"query-正确文档"对，看新模型的 cosine 分数是否合理（正确对应 >0.7，错误对应 <0.4），如果分数混乱（正确对分数低）是接入 bug（如没归一化、维度对不上）；如果分数合理但 Recall 低，是模型不适合业务数据。二是对比新旧模型在固定评测集上的 Recall@5，如果新模型在你的数据上显著差，确认不适合。注意检查向量维度和索引参数是否匹配新模型（换模型通常要重建索引）。

### 第三层：根因深挖

**Q：bge-m3 在你的法律文档上 Recall 不如 OpenAI text-embedding-3，但你倾向用 bge-m3（可私有部署）。根因矛盾怎么解？**

根因是"通用能力 vs 领域适配"的矛盾。bge-m3 通用能力强但没见过你的法律语料，OpenAI 可能预训练里含更多法律文本。解法有二：一是用法律语料微调 bge-m3（LoRA 或对比学习微调），让它在保留通用能力的同时适配法律领域，微调后通常能追上甚至超过 OpenAI；二是如果微调成本太高，接受 OpenAI（如果数据可出境）。更关键的是评测——在法律评测集上对比"bge-m3 微调版"vs"OpenAI 原版"，数据说话而非先入为主。

**Q：那为什么不直接用领域预训练的 embedding（如 LawGPT 的 embedding、BioBERT），省得自己微调？**

领域预训练模型有但成熟度参差。LawGPT/BioBERT 这类是研究性质，工程成熟度（多语言支持、维度选择、推理速度、维护）远不如 bge-m3/OpenAI。且它们的预训练语料可能和你的具体领域不完全匹配（如 BioBERT 是生物医学，你是临床医学，术语分布有差异）。更稳的路径是"通用强模型（bge-m3）+ 领域微调"，通用模型提供扎实的基础表示，微调适配具体领域，比直接用小众领域模型可控。除非有经过工业验证的领域 SOTA，否则通用+微调更稳。

### 第四层：方案权衡

**Q：bge-m3 支持"截断降维"（如从 1024 维截到 512 维），你用这个功能吗？降维会丢多少精度？**

用，但要看精度损失。bge-m3 和 OpenAI text-embedding-3 的前 N 维含主要语义信息（训练时就设计成可截断），截到 512 维通常 Recall 降 <3%，但存储和检索成本降一半。工程上先全维度跑基线，再测截断到 768/512/256 的 Recall 曲线，找精度损失可接受（<5%）的截断点。注意截断后要重新归一化（模长变了）。如果截断到 256 维 Recall 降 10%，不值；降 512 维降 2%，划算。

**Q：为什么不直接用 PCA 做降维（把 1024 维降到 256 维），省得依赖模型支持截断？**

PCA 是通用的线性降维，对 embedding 这种高维稠密向量效果不一定好。embedding 的维度是模型学习出的"语义特征"，各维度有复杂非线性关系，PCA 的线性投影可能破坏这些特征。模型原生支持的截断（如 bge-m3 的 Matryoshka representation）是训练时就优化的——模型学会把最重要信息放前几维，截断是有损最小的。PCA 是"事后压缩"，截断是"训练时就考虑压缩"，后者更优。只有在不支持截断的模型上才考虑 PCA，且要验证精度损失。

### 第五层：验证与沉淀

**Q：你怎么做 embedding 选型的 A/B 评测，确保选出的模型真的最优？**

构建业务评测集（500-1000 条 query-document 对，人工标注相关性），对比候选模型（如 bge-m3/OpenAI-3/E5-large）的 Recall@5 和 nDCG@5。注意三点：一是评测集要覆盖业务的 query 类型分布（事实型/概念型/混合），不能偏；二是评估要包含"冷启动"场景（query 和文档表述差异大），这才是 embedding 的瓶颈；三是如果考虑微调，评测"微调后"而非"原始"模型（公平比较）。结果沉淀成选型报告，附各模型的 Recall/nDCG/延迟/成本对比表。

**Q：embedding 选型和维护经验怎么沉淀成团队规范？**

固化成"embedding 模型选型指南"：按场景（通用/法律/医疗/代码）推荐模型，附评测基线。沉淀"评测集构建 SOP"（如何标注、标注多少、如何分层）、"微调流程"（数据准备/训练/验证）、"模型升级流程"（换模型时如何重建索引、如何 A/B 灰度）。配套 embedding 质量监控看板（线上 Recall 通过点击反馈隐式计算），Recall 下降触发模型重评估。

## 结构化回答




**30 秒电梯演讲：** 就像选相机镜头——不能只看参数表，要在实际拍摄场景中对比样片才能知道哪个最适合你的需求。

**展开框架：**
1. **MTEB** — MTEB榜单排名参考
2. **中英文双语支** — 中英文双语支持(bge-m3等)
3. **维度与存储成** — 维度与存储成本权衡

**收尾：** 如何构建Embedding评测数据集？





## 视频脚本

> 预计时长：4 分钟 | 由浅入深


| 时间 | 画面/字幕 | 口播台词 | 讲解要点 |
|------|----------|----------|----------|
| 0:00 | 标题卡：不同的 Embedding 模型对检索质量影响很… | "就像选相机镜头——不能只看参数表，要在实际拍摄场景中对比样片才能知道哪个最适合你的需求。" | 开场钩子 |
| 0:20 | 核心概念图 | "Embedding选型要看语言支持、维度、速度、MTEB榜单表现，必须在自己的业务数据上做A/B评测。" | 核心定义 |
| 0:50 | MTEB示意图 | "MTEB——MTEB榜单排名参考" | 要点拆解1 |
| 1:30 | 对比/实战案例图 | "对比一下常见误区和工程实践，看真实场景里怎么取舍。" | 实战与对比 |
| 2:20 | 总结卡 | "记住核心要点。下期我们追问：如何构建Embedding评测数据集？" | 收尾与钩子 |
