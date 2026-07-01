---
id: note-tx2-006
difficulty: L3
category: ai
subcategory: RAG
tags:
- 腾讯
- 面经
- 混合检索
- BM25
- 向量检索
feynman:
  essence: BM25 关键词检索 + 向量检索混合的优势是互补——BM25 强在精确词面匹配(专有名词/代码/数字/SKU)，向量强在语义相似(同义/近义/跨语言)。只单向量的问题：①专有名词漏召回("VPN连不上"匹配不到"虚拟专网异常")②数字/代码场景弱③跨语言不如BM25+向量配合。融合用 RRF(Reciprocal Rank Fusion)合并排名，简单有效。
  analogy: BM25 像查字典(精确匹配字词)，向量像问语义(意思相近的都找)。查"iPhone 15 Pro Max 256G"用字典准(精确型号)，查"手机内存不够怎么办"用语义准(意思相近)。两个一起用最全。
  first_principle: 两种检索器的召回分布不同——BM25 偏词面精确，向量偏语义泛化。混合检索覆盖两者的召回空间，降低单点失败概率。
  key_points:
  - 'BM25强项: 精确词面匹配(专有名词/代码/数字/SKU)'
  - '向量强项: 语义相似(同义/近义/跨语言/概念)'
  - '单向量问题: 专有名词漏召回/数字代码弱/长尾词差'
  - '融合用RRF: score=Σ1/(k+rank)，k通常60'
  - '或加权融合: α·BM25+(1-α)·Vector'
first_principle:
  essence: 混合检索 = 覆盖互补的召回空间
  derivation: BM25偏词面，向量偏语义 → 召回分布互补 → 混合降低单点失败 → 用RRF或加权融合排名
  conclusion: 单一检索器都有盲区，混合检索是 RAG 召回率的标配
follow_up:
- RRF 的 k 为什么取 60？
- BM25 和向量的权重怎么调？
- 什么时候只用向量就够了？
memory_points:
- BM25重字面精确匹配（专有名词/数字），向量重语义近似匹配（同义/跨语言），两者互补
- 单向量短板：因为靠语义匹配，所以遇到精确代码、罕见长尾词、特定数字时极易漏召回
- 融合方案首选RRF：因为只用排名计算无需校准分数量纲，k常取60，比加权融合更简单鲁棒
- 工业级完整链路：双路召回Top-50 -> RRF融合 -> Cross-encoder重排Top-5 -> 喂给LLM
---

# 【某讯面经】BM25 关键词检索 + 向量检索混合检索优势，只单向量会有什么问题

## 一、两种检索器的互补性

| 维度 | BM25 强项 | 向量检索强项 |
|------|----------|------------|
| 精确词面匹配 | ✅ 专有名词、代码、数字、SKU | ❌ |
| 同义/近义 | ❌ | ✅ "VPN连不上"↔"虚拟专网异常" |
| 跨语言 | ❌ | ✅ 中英文互检 |
| 概念查询 | ❌ | ✅ "怎么提速"↔"性能优化" |
| 拼写错误容忍 | ❌ | ✅（一定程度） |
| 长尾词 | ✅ | ❌（训练数据少） |

**核心互补**：BM25 抓"字面一样"，向量抓"意思相近"。

## 二、只单向量会有什么问题

### 问题1：专有名词漏召回
```
Query: "VPN 连不上怎么办"
向量可能召回: "网络连接异常的排查方法"（语义近）
但漏掉: "VPN 配置指南"（字面含 VPN，但语义距离可能远）

BM25 能召回: "VPN 配置指南"（字面匹配 VPN）
```

### 问题2：数字/代码场景弱
```
Query: "错误码 5002 怎么解决"
向量: 可能召回各种"错误"相关文档，但 5002 这个具体数字权重低
BM25: 精确匹配 "5002"，直接命中
```

### 问题3：长尾词/罕见术语
```
Query: "K8s NodeAffinity 配置"
向量: "K8s NodeAffinity" 是技术长尾词，embedding 训练数据少，表示不准
BM25: 精确匹配 "NodeAffinity"，稳
```

### 问题4：跨语言不如配合
```
Query: "如何 use Function Calling"
向量: 中英混杂，表示可能漂移
BM25: "Function Calling" 精确匹配英文文档
```

## 三、混合检索怎么融合

### 方案1：RRF（Reciprocal Rank Fusion）—— 推荐简单有效

```
RRF_score(d) = Σ 1 / (k + rank_i(d))

  d: 文档
  rank_i(d): 文档 d 在第 i 个检索器中的排名（第1名rank=1）
  k: 平滑常数，通常取 60
```

```python
def rrf(bm25_results, vector_results, k=60):
    scores = {}
    for rank, doc in enumerate(bm25_results, 1):
        scores[doc.id] = scores.get(doc.id, 0) + 1 / (k + rank)
    for rank, doc in enumerate(vector_results, 1):
        scores[doc.id] = scores.get(doc.id, 0) + 1 / (k + rank)
    return sorted(scores.items(), key=lambda x: -x[1])
```

**RRF 优点**：
- 不需要校准分数（BM25 和向量分数量纲不同，直接加权难）
- 只用排名，鲁棒
- 简单，工业界常用

**k 为什么取 60**：经验值，平衡"头部权重"和"长尾权重"。k 大→排名差异被平滑，k 小→头部权重高。

### 方案2：加权融合
```
final_score = α · normalize(bm25_score) + (1 - α) · normalize(vector_score)

α: 按场景调
  - 词面查询多（代码/型号）→ α 大（如 0.7）
  - 语义查询多（自然语言）→ α 小（如 0.3）
```

**缺点**：需要校准两个分数到同一量纲（normalize），调 α 麻烦。

## 四、完整混合检索流程

```
Query 进入
  │
  ├─ BM25 检索 → top-50（按词面）
  │
  ├─ 向量检索 → top-50（按语义）
  │       └─ query embedding（用 BGE / OpenAI embedding）
  │
  ▼
RRF 融合 → top-100 排名
  │
  ▼
Rerank（cross-encoder）→ top-5（精排）
  │
  ▼
喂给 LLM 生成答案
```

## 五、加分点

- 说出 **RRF 不需要分数校准**，比加权融合简单
- 说出 **BM25 的变体**：BM25F（字段加权，标题权重高于正文）、BM25+（处理长文档惩罚）
- 说出 **向量检索的过滤**：先按元数据过滤（如"只查2024年文档"）再向量检索，提升精度和速度

## 六、雷区

- ❌ "向量检索一定能替代 BM25" → 专有名词/数字/代码场景必漏
- ❌ 加权融合不 normalize → 分数量纲不同，加权无意义
- ❌ 只混合不 Rerank → 召回多但精度不够

## 七、扩展

- **Sparse Vector（稀疏向量）**：如 SPLADE，结合了 BM25 的精确性和向量的语义性，用学习的稀疏向量替代 BM25
- **Multi-vector**：ColBERT 风格，每个 token 一个向量，做 late interaction，精度更高
- **混合检索的工程实现**：Milvus/Qdrant/Weaviate 都原生支持混合检索（一个 API 同时查 BM25 + 向量）

## 记忆要点

- BM25重字面精确匹配（专有名词/数字），向量重语义近似匹配（同义/跨语言），两者互补
- 单向量短板：因为靠语义匹配，所以遇到精确代码、罕见长尾词、特定数字时极易漏召回
- 融合方案首选RRF：因为只用排名计算无需校准分数量纲，k常取60，比加权融合更简单鲁棒
- 工业级完整链路：双路召回Top-50 -> RRF融合 -> Cross-encoder重排Top-5 -> 喂给LLM

