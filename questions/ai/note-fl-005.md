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
  - 查询改写 + 混合检索（BM25+向量）+ Rerank + 动态Top-K
  - 召回用 bi-encoder（query/doc 分别编码算余弦），精排用 cross-encoder（拼一起进模型）
  - 召回 K 大（50-100）保 Recall，Rerank 选 top-5 保 Precision
  - Top-K 按 query 长度 + chunk 大小 + Rerank 分数阈值动态算
  - BM25 词面命中强，向量同义近义强，hybrid 用 RRF 融合
first_principle:
  essence: RAG = 召回（高 Recall）+ 精排（高 Precision）两阶段
  derivation: 单阶段无法同时优化 Recall 和 Precision → 拆成两阶段 → 召回用便宜模型宁多勿漏 → 精排用贵模型宁少勿滥 → 两阶段配合达成"不漏 + 不噪"
  conclusion: RAG 优化不是单点调参，而是"召回宽进 + 精排严出"的两阶段协同
follow_up:
- Late Interaction（ColBERT v2）相比 bi-encoder 和 cross-encoder 优势在哪？
- chunk 策略（按语义切 vs 按 token 切）对 RAG 上限的影响？
- 怎么算 Recall@K 和 Precision@K？需要什么标注数据？
memory_points:
- RAG四件套：Query Rewrite改写、混合检索(BM25+向量)、Rerank精排、动态Top-K
- 加Rerank因模型架构不同：召回用Bi-encoder保Recall，精排用Cross-encoder保Precision
- 召回保Recall防漏，Rerank保Precision防噪，矛盾时大K召回小K精排
- BM25擅长精确词面匹配(代码/专名)，向量擅长语义泛化，混合用RRF算法融合排名
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

## 记忆要点

- RAG四件套：Query Rewrite改写、混合检索(BM25+向量)、Rerank精排、动态Top-K
- 加Rerank因模型架构不同：召回用Bi-encoder保Recall，精排用Cross-encoder保Precision
- 召回保Recall防漏，Rerank保Precision防噪，矛盾时大K召回小K精排
- BM25擅长精确词面匹配(代码/专名)，向量擅长语义泛化，混合用RRF算法融合排名

## 苏格拉底式面试追问

> 这组追问模拟面试官层层逼问，每一问先回答"为什么"，再回答"怎么做"，最后回答"如何证明"。

### 第一层：目标与动机

**Q：BM25 已经是经过几十年验证的检索方法，效果不差。你为什么非要加向量检索搞 hybrid，多一套向量库的维护成本图什么？**

因为 BM25 有盲区——词面不匹配就召不回来。"VPN 连不上"和"网络连接异常"字面完全不同，BM25 召回率为 0，但向量模型能把这俩语义对齐。工程上 BM25 漏掉的恰恰是高频的自然语言问法（用户不会用文档里的术语提问）。加向量检索的代价是维护一个向量库（如 Milvus）+ embedding 计算，但召回率提升的收益（解决语义泛化场景）远大于成本。hybrid 用 RRF 融合排名而不是选其一，是因为两者是互补关系不是替代——BM25 强在专有名词/代码/SKU 的精确匹配，向量强在同义/跨语言/概念查询，单用任何一个都有盲区。

### 第二层：证据与定位

**Q：你说 Rerank 能提升 Precision。你怎么知道是 Rerank 的功劳，而不是本来召回的 top-5 就是对的？**

必须离线评测对比。需要一份标注数据集（query + 相关文档的 ground truth），跑两个 pipeline：A 是召回直接取 top-5，B 是召回 top-50 + Rerank 取 top-5。对比两者的 Precision@5 和 nDCG@5。如果 B 显著高于 A（比如 Precision@5 从 0.6 提到 0.85），证明 Rerank 有增益。另一个证据是看 Rerank 后的排名变化——如果 top-5 里有 2-3 条是召回排名靠后（rank 20-50）但 Rerank 提上来的，且这 2-3 条确实是相关文档（ground truth 验证），说明 Rerank 在召回的噪声里捞回了真金。

### 第三层：根因深挖

**Q：你用 RRF 融合 BM25 和向量的排名，k 取 60。为什么是 60 不是 6 或 600？这个数怎么来的？**

RRF 公式 `1/(k+rank)` 里的 k 控制头部和尾部排名的权重差异。k 太小（如 6）意味着 rank 1 和 rank 50 的权重差异极大（1/7 vs 1/56，差 8 倍），头部排名主导融合，相当于只信各检索器的第一名；k 太大（如 600）意味着 rank 1 和 rank 50 权重几乎相等（1/601 vs 1/650，差 8%），融合退化成平均，失去区分度。k=60 是经验值，源自原始 RRF 论文（Cormack 2009）在大规模 TREC 数据上的实验——它在"尊重头部排名"和"给尾部机会"之间取得平衡。实际工程里 k 不是死的，要在自己的标注集上做网格搜索（试 10/30/60/100），选 nDCG 最高的。

**Q：那如果 Rerank 模型本身有偏差（比如偏好长文档），为什么不用大模型（GPT-4）直接做 Rerank，精度不是更高吗？**

因为成本和延迟。cross-encoder Rerank（如 BGE-Reranker）跑 50 条 query-doc 对是毫秒级，而用 GPT-4 Rerank 50 条意味着 50 次 LLM 调用，延迟秒级、成本是 cross-encoder 的几百倍。大模型 Rerank 精度确实更高，但只在 top-N 极小（如从 5 选 1）且精度要求极高的场景才值得。常规 RAG pipeline 里 Rerank 处理的是 top-50，用 cross-encoder 是性价比最优解。至于偏差问题，解法是评测时分析 Rerank 对长/短文档的分数分布，如果系统性偏好长文档，加长度归一化（分数除以 doc 长度的某个函数）而不是换大模型。

### 第四层：方案权衡

**Q：动态 Top-K 你说按 Rerank 分数阈值 τ 截断。但 τ 设高了 Precision 高但可能召回太少答不全，设低了又回到噪声多。这个 τ 怎么定？**

τ 不能拍脑袋，要在标注集上画 Precision-Recall 曲线找拐点。具体做法：在标注集上跑完整 pipeline，记录每个 query 的 Rerank 分数分布和相关/不相关标签，按不同 τ 阈值统计整体 Precision 和 Recall，画 P-R 曲线。τ 选曲线上"Precision 下降前 Recall 已较高"的拐点（通常是分数分布的双峰分界点——相关文档分数集中在 0.8+，不相关集中在 0.5-，τ 取 0.7 左右）。更稳健的做法是分场景设 τ：单实体查询（如"公司地址"）τ 设高（只要最相关的 1-2 条），多实体对比查询（如"对比 A 和 B 产品"）τ 设低（要召回足够多覆盖两方）。

**Q：那如果 query 改写（Query Rewrite）把原意改偏了，导致召回的文档全是基于改错后的 query，Rerank 再准也救不回来。为什么不跳过 Query Rewrite 直接用原 query 检索？**

跳过 Query Rewrite 会丢掉两个收益：一是同义词扩展（用户说"账号"但文档写"账户"），二是多 query 并发提高召回鲁棒性。改写偏的风险确实存在，解法不是跳过，而是加校验。具体做法：Query Rewrite 产出 N 个改写 query 后，分别召回，用 RRF 融合所有改写 query 的召回结果——即使某条改写偏了，其他改写和原 query 的召回会稀释它的影响。另一个保险是：原 query 始终参与召回（不丢弃），改写 query 是补充而非替代。最后在 Rerank 阶段用原 query 做精排输入（不是改写后的），这样精排的"相关性判断"始终忠于用户原意。

### 第五层：验证与沉淀

**Q：你怎么证明这一整套 RAG 优化（四件套）比"只用向量检索"效果好？业务上怎么衡量？**

离线指标：在标注集上对比"纯向量检索"vs"四件套 pipeline"的 Recall@10、Precision@5、nDCG@5、MRR。四件套应全面优于纯向量（如 Recall 从 0.7 提到 0.9，Precision 从 0.6 提到 0.85）。线上业务指标：端到端看"LLM 回答的准确率"（用 LLM-as-a-Judge 或人工抽样评分）、"用户点踩率"、"人工兜底转人工率"。如果四件套 pipeline 下回答准确率从 70% 提到 88%、转人工率从 15% 降到 8%，证明效果。关键是离线和线上指标都要有基线对比，不能只报绝对值。

**Q：怎么让团队后续优化 RAG 时不破坏现有效果（比如有人换了 chunk 策略导致 Recall 掉了没发现）？**

把回归测试做进 CI。具体：维护一份 frozen 的评测集（200-500 条 query + ground truth），任何 RAG 链路的变更（chunk 策略、embedding 模型、Rerank 模型、检索参数）触发 CI 跑评测集，对比变更前后的 Recall/Precision/nDCG，掉点超过阈值（如 Recall 降 > 3%）block 合并。评测集要覆盖多场景（单实体、多实体、对比类、跨语言），避免某类 query 被优化但另一类被牺牲。再配合线上监控——按天统计召回命中率、Rerank 分数分布、点踩率，异常波动告警。让 RAG 的质量可量化、可回归，而不是"感觉换了更好"。

## 结构化回答

**30 秒电梯演讲：** RAG 优化四件事——查询改写、混合检索（BM25+向量）、Rerank、动态 Top-K。Rerank 用 cross-encoder 把召回阶段追求的 Recall 转成精排的 Precision。

**展开框架：**
1. **查询改写** — 查询改写 + 混合检索（BM25+向量）+ Rerank + 动态Top-K
2. **召回用** — 召回用 bi-encoder（query/doc 分别编码算余弦），精排用 cross-encoder（拼一起进模型）
3. **召回** — 召回 K 大（50-100）保 Recall，Rerank 选 top-5 保 Precision

**收尾：** 您想深入聊：Late Interaction（ColBERT v2）相比 bi-encoder 和 cross-encoder 优势在哪？


## 视频脚本

> 预计时长：5 分钟 | 由浅入深


| 时间 | 画面/字幕 | 口播台词 | 讲解要点 |
|------|----------|----------|----------|
| 0:00 | 标题卡：RAG 做过哪些优化？为什么加 Rerank？… | "就像图书馆找书——先用书名关键词（BM25）+ 内容相似度（向量）各扫一遍把候选搬出来（召…" | 开场钩子 |
| 0:20 | 核心概念图 | "RAG 优化四件事——查询改写、混合检索（BM25+向量）、Rerank、动态 Top-K。Rerank 用 cross…" | 核心定义 |
| 0:50 | 查询改写示意图 | "查询改写——查询改写 + 混合检索（BM25+向量）+ Rerank + 动态Top-K" | 要点拆解1 |
| 1:30 | 召回用示意图 | "召回用——召回用 bi-encoder（query/doc 分别编码算余弦），精排用 cross-encoder（拼一起进模型）" | 要点拆解2 |
| 2:20 | 对比/实战案例图 | "对比一下常见误区和工程实践，看真实场景里怎么取舍。" | 实战与对比 |
| 3:10 | 总结卡 | "记住核心要点。下期我们追问：Late Interaction（ColBERT v2）相比？" | 收尾与钩子 |
