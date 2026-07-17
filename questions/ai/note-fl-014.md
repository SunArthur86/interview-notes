---
id: note-fl-014
difficulty: L3
category: ai
subcategory: LLM
tags:
- 字节
- 飞连
- 面经
- Transformer
- Attention
feynman:
  essence: Self-Attention 每个 token 算 Q/K/V 三向量，注意力分数 = softmax(Q·K^T/√d_k)·V，除√d_k 防止大 d_k 下梯度消失。Multi-Head 把 Q/K/V 切 h 份并行做注意力，让模型在不同子空间关注不同信息（句法/语义/位置），最后 concat+线性层融合。GPT 是 Decoder-only+因果mask 适合生成；BERT 是 Encoder-only+双向 适合理解分类抽取。现代主流全是 Decoder-only。
  analogy: Self-Attention 像开会时每个人同时听所有人说话并决定关注谁（Q=我想问什么，K=别人能答什么，V=别人实际说的）。Multi-Head 像派多个分身同时关注不同方面（一个听内容、一个听语气、一个看位置）。GPT 像只能听前面人说话（因果mask），BERT 像能听到全场。
  first_principle: 注意力的本质是"加权聚合信息"。Q/K 决定权重（谁和谁相关），V 决定聚合内容。多头让模型在不同子空间学不同关系，提升表达力。
  key_points:
  - 'Self-Attention: softmax(Q·K^T/√d_k)·V，除√d_k 防梯度消失'
  - 'Multi-Head: 切h份并行注意力，不同子空间关注不同信息，concat+线性融合'
  - 'GPT: Decoder-only+因果mask，next token prediction，适合生成'
  - 'BERT: Encoder-only+双向，MLM+NSP，适合理解/分类/抽取'
  - 现代主流(Claude/GPT/豆包)全 Decoder-only，生成上限高且能 zero-shot 理解
first_principle:
  essence: 注意力 = 加权聚合信息
  derivation: 序列建模需让每个 token 看到其他 token → 全连接参数爆炸 → 用 Q·K 算相关性权重 → 用 V 聚合 → 多头并行提升表达力
  conclusion: Transformer 的核心创新是用注意力替代 RNN 的递归，实现并行 + 长距离依赖
follow_up:
- 为什么除√d_k 不除d_k？方差推导
- Multi-Head 每个 head 的 d_k 怎么算？head 数怎么选？
- Decoder-only 为什么能 zero-shot 做理解任务？
memory_points:
- 公式核心：Attention = softmax(Q·K^T / √d_k) · V，除以√d_k是为防点积过大导致梯度消失。
- 多头机制：把 Q/K/V 切成 h 份（如 8 头）并行算，让模型在不同子空间学不同特征。
- GPT vs BERT：GPT 是 Decoder 做单向生成（续写），BERT 是 Encoder 做双向理解（完形填空）。
- 主流原因：现代大模型全用 Decoder-only，因其生成上限高、支持 Zero-shot 理解且 Scaling 表现好。
---

# 【字节飞连面经】Transformer 基础：Self-Attention / 多头 / GPT vs BERT

## 一、Self-Attention

每个 token 算 Q / K / V 三个向量：

```
注意力分数 = softmax(Q · K^T / √d_k) · V
                ↑           ↑          ↑
            query-key相似度  缩放    加权聚合value
```

**为什么除√d_k**：防止大 d_k 下点积过大导致 softmax 进饱和区，梯度消失。
- 假设 Q、K 分量是均值0、方差1的独立随机变量
- 点积 `Q·K^T = Σ q_i·k_i`，方差 = d_k
- d_k 大 → 点积方差大 → softmax 饱和 → 梯度消失
- 除√d_k 把方差缩回1

## 二、Multi-Head Attention

把 Q/K/V 切成 h 份并行做注意力：

```
d_model = 512, h = 8
  → 每个 head: d_k = d_v = 512/8 = 64
  → 8 个 head 并行算 attention
  → concat 8 个 head 输出 → 线性层融合回 512
```

**为什么多头**：让模型在不同子空间关注不同信息——
- 有的 head 学句法关系（主谓宾）
- 有的 head 学语义关系（同义/反义）
- 有的 head 学位置关系（相邻/远距离）

单头注意力表达力有限，多头并行提升模型容量。

## 三、GPT vs BERT

| 维度 | GPT | BERT |
|------|-----|------|
| 架构 | Decoder-only | Encoder-only |
| 注意力 | **因果 mask**（只能看前文） | **双向 attention**（看全句） |
| 训练目标 | next token prediction | MLM（遮盖词预测）+ NSP（句子连贯） |
| 适合 | **生成**（对话、续写） | **理解**（分类、抽取、相似度） |

**为什么现代主流（Claude / GPT / 豆包）全是 Decoder-only**：
1. **生成能力上限更高**：因果 mask + next token prediction 是通用生成范式
2. **能 zero-shot 做理解任务**：把分类/抽取转成生成（"这段话的情感是[正/负]"）
3. **Scaling law 友好**：Decoder-only 架构在 scale up 时收益更稳定
4. **训练效率高**：next token prediction 天然适合自回归并行训练

## 四、加分点

- 说出 **Decoder-only 能 zero-shot 理解的原因**：把理解任务转成"生成答案"，比如分类 → "这段话的情感标签是 ___"，抽取 → "实体有 ___"
- 说出 **MLM vs next token 的本质差异**：MLM 是"完形填空"（双向但破坏原始分布），next token 是"续写"（保序且通用）

## 五、扩展

- **RoPE 位置编码**（某讯笔试考点）：用旋转矩阵编码相对位置，支持长上下文外推
- **Flash Attention**：通过分块计算减少 HBM 读写，把 attention 速度提升 2-4 倍（不改变数学结果）
- **MQA / GQA**：Multi-Query Attention / Grouped-Query Attention，多个 head 共享 K/V，减少 KV cache 内存，提升推理速度
- **KV Cache**：自回归生成时缓存已计算的 K/V，避免重复计算，是 LLM 推理优化的核心

## 记忆要点

- 公式核心：Attention = softmax(Q·K^T / √d_k) · V，除以√d_k是为防点积过大导致梯度消失。
- 多头机制：把 Q/K/V 切成 h 份（如 8 头）并行算，让模型在不同子空间学不同特征。
- GPT vs BERT：GPT 是 Decoder 做单向生成（续写），BERT 是 Encoder 做双向理解（完形填空）。
- 主流原因：现代大模型全用 Decoder-only，因其生成上限高、支持 Zero-shot 理解且 Scaling 表现好。

## 苏格拉底式面试追问

> 这组追问模拟面试官层层逼问，每一问先回答"为什么"，再回答"怎么做"，最后回答"如何证明"。

### 第一层：目标与动机

**Q：你说除以 √d_k 是防止点积过大导致 softmax 饱和。但为什么不干脆用加性注意力（additive attention，`tanh(W·q + U·k)`），它天然没有点积过大问题，为什么 Transformer 偏要点积？**

因为点积可以用矩阵乘法高度并行化（`Q·K^T` 一次算完所有位置对的相似度），而加性注意力要逐位置过 tanh 非线性，无法合并成单次矩阵乘，计算效率低。在大规模训练（GPU 并行）时，矩阵乘法能吃满 GPU 算力，加性注意力的逐元素计算成为瓶颈。除 √d_k 是用"一个除法"解决了点积的数值问题，同时保留了矩阵乘的效率优势——这是工程上更优的权衡。原始 Attention Is All You Need 论文也提到"点积注意力在实践中更快更省空间"，additive 虽然在 d_k 大时数值更稳，但计算开销让它在大规模场景不划算。

### 第二层：证据与定位

**Q：你说多头让模型"在不同子空间学不同特征"（句法、语义、位置）。这是有实证支持的，还是你的推测？怎么证明多头真的学了不同东西？**

有实证支持，通过注意力可视化（attention visualization）和探针实验（probing）验证。经典方法：训练完后取出每个 head，看它在不同输入上的 attention pattern。研究发现（如 Clark 2019 的 BERT 分析）：某些 head 确实关注句法依赖（如 head 经常 attend 到动词的主语），某些 head 关注相邻 token，某些关注分隔符。另一种证据是"head 剪枝实验"——把某些 head 去掉模型性能几乎不变（冗余 head），去掉另一些性能大幅下降（关键 head），说明 head 之间确实学到了不同重要性的功能。但也有研究指出很多 head 是冗余的（学的东西高度重叠），所以才有 GQA/MQA 这种"共享 K/V 降冗余"的优化。所以"多头学不同特征"是统计趋势，不是每个 head 都严格分工。

### 第三层：根因深挖

**Q：现代大模型全用 Decoder-only，理由之一是"Scaling law 友好"。但 BERT 这种 Encoder-only 在理解任务（分类、抽取）上效果不是更好吗？为什么 Scaling law 会偏好 Decoder？**

因为 Scaling law 衡量的是"参数量/数据量增加时，loss 下降的稳定性"。Decoder-only 的 next token prediction 是一个稠密训练目标（每个 token 都贡献 loss），而 BERT 的 MLM 是稀疏目标（只对 15% 被 mask 的 token 算 loss），同样数据下 Decoder 的有效训练信号是 BERT 的 ~6 倍。这意味着 scale up 时 Decoder 的 loss 下降更高效，单位算力换更多能力提升。BERT 在理解任务上的"更好"是小规模（亿级参数）时的现象，当参数到千亿级，Decoder-only 的 zero-shot/few-shot 能力涌现，把理解任务转成生成（"情感是___"）就能做，且效果不输甚至超过专门的 Encoder。所以不是"Encoder 不擅长理解"，而是"Decoder 在大规模下理解能力也够强，且生成能力 Encoder 做不了"，统一架构的收益超过了专项优化的损失。

**Q：那如果理解任务用 Decoder-only 是"够强"，为什么不保留 BERT 做理解任务 + GPT 做生成任务的混合架构，各取所长？**

因为混合架构的工程成本和协同收益不划算。统一架构的好处：一套训练框架、一套推理框架、一套部署运维；理解任务和生成任务可以共享同一个模型（如 Agent 系统里分类意图和生成回复用同一模型），省显存和调用成本。混合架构要维护两套模型，且理解结果要传给生成模型，中间有信息损失。唯一适合混合的场景是"理解任务量极大且对延迟极敏感"（如搜索排序里的 BERT 做 query-doc 相关性，每秒百万次），这时专项 Encoder 的小模型更快更便宜。但通用 Agent 场景（对话、Tool Calling）用 Decoder-only 统一更划算。工业界的趋势也是统一：连搜索都在用 Decoder 做相关性（如 LLM-based reranker），BERT 的份额在缩小。

### 第四层：方案权衡

**Q：Multi-Head Attention 把 Q/K/V 切成 h 份并行。但 head 数 h 怎么选？为什么常见是 8 或 16，不是 2 或 64？太少和太多各有什么问题？**

h 的选择是"子空间表达力"和"每头维度足够"的权衡。每个 head 的维度 `d_k = d_model / h`，d_k 太小（如 h=64 且 d_model=512 时 d_k=8）会让单个 head 的注意力表达力不足（Q·K^T 只是 8 维点积，区分度低）；d_k 太大（如 h=2 时 d_k=256）则头数少，无法捕获多种关系。经验上 d_k 在 64-128 时单头注意力效果较好，所以 d_model=512 配 h=8（d_k=64）、d_model=4096 配 h=32（d_k=128）是常见配置。h 太多（如 h=64 配 d_model=512 → d_k=8）会导致每个 head 学不到东西（维度太低），且计算开销线性增长（h 个线性投影）。h 太少（如 h=2）相当于退化成接近单头，表达力不够。选择依据是"保持 d_k ≥ 64 且 h 覆盖足够多的关系类型"，不是拍脑袋。

**Q：Decoder-only 用因果 mask 只能看前文。但理解任务（如"这句话的摘要"）需要看全句，因果 mask 不就吃亏了吗？为什么不针对理解任务去掉 mask？**

因为"看全句"在生成时可以用"先读完输入再生成输出"的方式实现，不需要架构层面双向。具体到摘要任务：prompt 是"请总结以下文本：[全文]"，模型生成摘要时每个 token 的注意力能看到 prompt 里的全部输入（因为 prompt 在生成 token 之前），所以是"单向生成但输入完整可见"，等价于理解。真正吃亏的是"对输入中间的某个 token 做双向编码"的任务（如 BERT 的 MLM），但这类任务可以转成生成（"被 mask 的词是___"）。因果 mask 的代价是"输入表示不如双向充分"（理论上 Encoder 的双向表示更丰富），但实践上 Decoder-only 在足够大时这个差距被 scale 弥补，且换来了生成能力和训练效率。所以不是"不吃亏"，而是"吃亏的代价小于统一架构的收益"。

### 第五层：验证与沉淀

**Q：你提到 Flash Attention、KV Cache、GQA 这些推理优化。你怎么证明它们有效，而不是只听论文说？**

看推理延迟和显存的实测对比。Flash Attention：跑相同序列长度的注意力计算，对比标准实现和 Flash 实现的延迟和显存峰值——Flash 应在长序列（如 8K+）时延迟快 2-4 倍、显存从 O(N^2) 降到 O(N)。KV Cache：对比开启和关闭 KV Cache 的自回归生成延迟，长序列生成（如生成 500 token）时 KV Cache 应让每 token 延迟恒定（不随已生成长度增长），关闭则线性增长。GQA：对比全 MHA 和 GQA 的推理吞吐和显存，GQA 应在显存降 30-50% 的同时精度损失 < 1%（在评测集上验证）。验证方法是在自己的硬件和模型上跑 benchmark，而不是只信论文数字（硬件/模型不同结果会变）。如果实测收益不明显（如序列不长时 Flash 优势小），可以不急着用，按实际场景决策。

**Q：怎么让团队在做模型推理优化时（如选 Flash Attention vs 标准、MHA vs GQA）有统一的判断标准，而不是各试各的？**

沉淀基准测试和决策矩阵。一是建立 benchmark 套件：团队固定的一组测试场景（短/中/长序列、batch=1/batch=64），每次引入新优化（Flash Attention、GQA、量化）跑 benchmark，记录延迟/显存/精度三指标到知识库。二是决策矩阵：按场景给推荐配置——短序列（< 512）用标准 attention 够（Flash 优势小）、长序列用 Flash、显存紧张用 GQA、延迟极敏感用 KV Cache + PagedAttention。新项目按矩阵选默认配置，偏离要 review 说明理由。三是回归验证：优化配置变更后跑模型评测集，精度掉点超阈值（如 2%）不能上线。让优化决策靠 benchmark 数据和场景矩阵，不靠"论文说好就用"或"感觉快了"。

## 结构化回答

**30 秒电梯演讲：** Self-Attention 每个 token 算 Q/K/V 三向量，注意力分数 = softmax(Q·K^T/√d_k)·V，除√d_k 防止大 d_k 下梯度消失。

**展开框架：**
1. **Self-Attention** — softmax(Q·K^T/√d_k)·V，除√d_k 防梯度消失
2. **Multi-Head** — 切h份并行注意力，不同子空间关注不同信息，concat+线性融合
3. **GPT** — Decoder-only+因果mask，next token prediction，适合生成

**收尾：** 您想深入聊：为什么除√d_k 不除d_k？方差推导？


## 视频脚本

> 预计时长：4 分钟 | 由浅入深


| 时间 | 画面/字幕 | 口播台词 | 讲解要点 |
|------|----------|----------|----------|
| 0:00 | 标题卡：Transformer 基础：Self… | "Self-Attention 像开会时每个人同时听所有人说话并决定关注谁（Q=我想问什么…" | 开场钩子 |
| 0:20 | 核心概念图 | "Self-Attention 每个 token 算 Q/K/V 三向量，注意力分数 = softmax(Q·K^T/√d…" | 核心定义 |
| 0:50 | Self-Attention示意图 | "Self-Attention——softmax(Q·K^T/√d_k)·V，除√d_k 防梯度消失" | 要点拆解1 |
| 1:30 | 对比/实战案例图 | "对比一下常见误区和工程实践，看真实场景里怎么取舍。" | 实战与对比 |
| 2:20 | 总结卡 | "记住核心要点。下期我们追问：为什么除√d_k 不除d_k？方差推导？" | 收尾与钩子 |
