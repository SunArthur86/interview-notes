---
id: note-fl-005
difficulty: L4
category: ai
subcategory: RAG
tags:
- 字节
- 飞连
- 面经
- RAG
- Rerank
feynman:
  essence: RAG 优化四件事——查询改写、混合检索（BM25+向量）、Rerank、动态 Top-K。Rerank 用 cross-encoder 把召回阶段追求的 Recall 转成精排的 Precision；Top-K 按 query 长度+chunk 大小+Rerank 分数阈值动态算；BM25 强在词面命中（专有名词、代码、数字），向量强在同义/近义/跨语言，两者是互补不是替代。
  analogy: 就像图书馆找书——先用书名关键词（BM25）+ 内容相似度（向量）各扫一遍把候选搬出来（召回，宁多勿漏），再请馆员逐本翻看挑出真正相关的（Rerank，精排，宁少勿滥）。最终给读者几本精选的。
  first_principle: 召回和精排的目标相反。召回阶段优先 Recall@K（漏了后面救不回来），精排阶段优先 Precision@K（LLM context 有限，喂进去的每条都该有用）。两阶段模型架构也不同：召回用 bi-encoder（省算力），精排用 cross-encoder（精度高但贵）。
  key_points:
  - '查询改写 + 混合检索（BM25+向量）+ Rerank + 动态Top-K'
  - '召回用 bi-encoder（query/doc 分别编码算余弦），精排用 cross-encoder（拼一起进模型）'
  - '召回 K 大（50-100）保 Recall，Rerank 选 top-5 保 Precision'
  - 'Top-K 按 query 长度 + chunk 大小 + Rerank 分数阈值动态算'
  - 'BM25 词面命中强，向量同义近义强，hybrid 用 RRF 融合'
first_principle:
  essence: RAG = 召回（高 Recall）+ 精排（高 Precision）两阶段
  derivation: 单阶段无法同时优化 Recall 和 Precision → 拆成两阶段 → 召回用便宜模型宁多勿漏 → 精排用贵模型宁少勿滥 → 两阶段配合达成"不漏 + 不噪"
  conclusion: RAG 优化不是单点调参，而是"召回宽进 + 精排严出"的两阶段协同
follow_up:
- Late Interaction（ColBERT v2）相比 bi-encoder 和 cross-encoder 优势在哪？
- chunk 策略（按语义切 vs 按 token 切）对 RAG 上限的影响？
- 怎么算 Recall@K 和 Precision@K？需要什么标注数据？
---

# 【字节飞连面经】RAG 做过哪些优化？为什么加 Rerank？BM25 够好向量还有必要吗？

## 一、四件优化

```
[1] 查询改写（Query Rewrite）
    │  同义词扩展 / 去停用词 / 多 query 并发
    ▼
[2] 混合检索（BM25 + 向量）
    │  BM25 词面命中 + 向量语义相似
    │  RRF（Reciprocal Rank Fusion）融合
    ▼
[3] Rerank（cross-encoder 精排）
    │  召回 50 条 → Rerank 选 top-5
    ▼
[4] 动态 Top-K
       按 query 长度 + chunk 大小 + Rerank 分数阈值算
```

## 二、为什么加 Rerank：两阶段模型架构差异

| 阶段 | 模型 | 做法 | 特点 |
|------|------|------|------|
| 召回 | bi-encoder | query 和 doc 分别编码再算余弦 | 省算力，doc 可预编码，但精度有限 |
| 精排 | cross-encoder | query+doc 拼一起进模型 | 精度高，但只能跑 top-N（贵） |

**一句话**：召回 50 条 → Rerank 选 top-5 → 喂给 LLM。

**为什么必须 Rerank**：向量召回追求 Recall，会把"语义相似但答非所问"的塞进来（如"VPN 连不上"召回"VPN 是什么"的文档）。Rerank 用 cross-encoder 重新精排提升 Precision。

## 三、Recall@K vs Precision@K 取舍

- **召回阶段优先 Recall@K**：宁可多召回噪声，不能漏掉正确答案（漏了后面无论怎么排都救不回来）
- **Rerank/最终阶段优先 Precision@K**：LLM context 有限，喂进去的每一条都该有用
- **矛盾时**：召回 K 调大（50→100）保 Recall，Rerank 严格保 Precision

## 四、Top-K 怎么动态调整

| 因素 | 规则 |
|------|------|
| query 长度 | 单实体查询 K=3-5，多实体/对比类 K=10+ |
| chunk 大小 | chunk 短 K 调大，chunk 长 K 调小（不爆 context） |
| **Rerank 分数阈值** | 分数低于 τ 的不要（即使位列 top-K）—— 这是动态 K 的精华 |

## 五、BM25 够好向量还有必要吗？有，但不是所有场景

| 维度 | BM25 强项 | 向量强项 |
|------|----------|---------|
| 精确词面匹配 | ✅ 专有名词、代码、数字、SKU | ❌ |
| 同义/近义 | ❌ | ✅ "VPN 连不上"↔"网络连接异常" |
| 跨语言 | ❌ | ✅ |
| 概念查询 | ❌ | ✅ |

**工程推荐**：hybrid 检索（BM25 + Vector）用 **RRF（Reciprocal Rank Fusion）** 合并：

```
RRF_score(d) = Σ 1 / (k + rank_i(d))   # k 通常取 60
```

把两个检索器的排名融合，避免单点失败。

## 六、加分点

- **Late Interaction（ColBERT v2）**：bi-encoder 和 cross-encoder 的折中——doc 编码成 token 级向量，query 也编码成 token 级，做 max-sim。精度接近 cross-encoder，速度接近 bi-encoder。
- **chunk 策略**：按语义切（用 NLP 分句）vs 按 token 切（固定窗口）。chunk 策略对 RAG 上限有决定性影响——垃圾 chunk 再好的检索也救不回来。

## 七、雷区

- ❌ "我们用了 Rerank 但没看 Recall/Precision 数据" → 被追问"那你怎么知道有用"
- ❌ "只用向量检索就够了" → 专有名词、代码、数字场景必漏

## 八、扩展

- **Rerank 模型当前事实标准**：BGE-Reranker（开源）、Cohere Rerank-v3（商用）
- **混合检索权重**：除了 RRF，还可以加权（`α·BM25 + (1-α)·Vector`），α 按场景调
- **多跳查询**：复杂问题（"A 公司的 CEO 的母校在哪"）需要拆成子问题分别检索，即 Agentic RAG
