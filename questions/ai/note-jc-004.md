---
id: note-jc-004
difficulty: L4
category: ai
subcategory: 强化学习
tags:
- 阶跃星辰
- 字节
- 面经
- GRPO
- 优势函数
- baseline
feynman:
  essence: GRPO（Group Relative Policy Optimization）的优势值 A_i = (R_i - mean(R)) / std(R)，即"组内相对优势"——对同一 prompt 采样 G 个回答，用组内回报的均值和标准差归一化。baseline 就是组均值 mean(R)，作用是降方差（减去平均回报，让正负优势对称分布）。相比 PPO 不需要 Critic 网络（用组内统计代替 V），省一半显存。
  analogy: 像班级排名——同一份卷子（prompt）全班（G个回答）一起考，你的分数减去班级平均分再除以标准差就是你的"相对排名优势"。不用知道"满分多少"（不需要 Critic 估绝对价值），只看你在班里相对位置。baseline 是平均分，减去它让正负分数对称。
  first_principle: 策略梯度需要 A=Q-V 降方差。PPO 用 Critic 网络估 V（准但贵），GRPO 用组内平均回报代替 V（粗糙但免费）。baseline=mean(R) 减去它保证"比平均好的正、差的负"，是 REINFORCE 降方差技巧的组内版本。
  key_points:
  - 'GRPO 优势: A_i = (R_i - mean(R_group)) / std(R_group)'
  - baseline = 组均值 mean(R)，降方差让正负优势对称
  - 对同一 prompt 采样 G 个回答，组内归一化
  - 相比 PPO 不需要 Critic（用组统计代替 V），省一半显存
  - 除 std 进一步归一化，让优势尺度稳定
first_principle:
  essence: GRPO 优势 = 组内相对排名
  derivation: 策略梯度需 A 降方差 → PPO 用 Critic 估 V（贵）→ GRPO 用组内 mean(R) 当 V → 组内归一化得相对优势 → 省 Critic
  conclusion: GRPO 的核心创新是用"组内统计"代替"Critic 网络"，牺牲一点精度换巨大显存节省
follow_up:
- GRPO 的 G（组大小）怎么选？
- GRPO 相比 PPO 训练更稳还是更不稳？
- 为什么 GRPO 适合 RLHF？
memory_points:
- GRPO优势计算：同prompt采G个回答，A=(R-组均值)/组标准差
- 核心创新：用组内统计代替Critic网络，显存省一半
- Baseline作用：减均值不改梯度期望，但有效降低方差
- RLHF优势：省显存训大模型，且避免Critic难收敛问题
- DAPO是改进版，DeepSeek-R1标志性应用
---

# 【阶跃星辰/字节面经】GRPO 里的优势值是什么？怎么计算？baseline 起什么作用

## 一、GRPO 优势值定义

GRPO 对**同一个 prompt 采样 G 个回答**，用组内回报统计计算优势：

```
对 prompt q，采样 G 个回答 o_1, o_2, ..., o_G
每个回答算奖励 R_1, R_2, ..., R_G

组内统计：
  mean_R = (1/G) Σ R_i
  std_R  = sqrt((1/G) Σ (R_i - mean_R)²)

优势值：
  A_i = (R_i - mean_R) / std_R
```

**直觉**：A_i 衡量"这个回答在组内是相对好还是相对差"。
- A_i > 0：比组平均好（应鼓励）
- A_i < 0：比组平均差（应抑制）
- |A_i|：相对程度（除 std 归一化）

## 二、baseline 是什么：组均值 mean_R

```
baseline = mean_R = (1/G) Σ R_i

A_i = R_i - baseline   （减去 baseline）
    = R_i - mean_R
```

**baseline 的作用：降方差**

### 为什么减 baseline 能降方差

```
不减 baseline（直接用 R_i）：
  R_i 都是正数（如奖励范围 0.5~0.9）
  → 所有优势都正 → 所有回答都被鼓励 → 梯度方向混乱（方差大）

减 baseline（用 R_i - mean_R）：
  好回答 R_i > mean_R → A_i > 0（鼓励）
  差回答 R_i < mean_R → A_i < 0（抑制）
  → 正负对称 → 梯度方向清晰（方差小）
```

**数学保证**：baseline 不改变梯度的期望（E[R_i - b] = E[R_i] - b，只要 b 不依赖动作），但能降低方差。这是 REINFORCE with baseline 的经典技巧。

## 三、GRPO vs PPO：优势计算对比

| 维度 | PPO | GRPO |
|------|-----|------|
| 优势来源 | Critic 网络 V(s) | 组内统计 mean(R) |
| 需要的网络 | Actor + **Critic** | **只有 Actor** |
| 显存 | 2 个网络 | 1 个网络（省一半） |
| 估计精度 | 高（V 学得好） | 中（组内统计粗糙） |
| 采样成本 | 每状态 1 次 | 每 prompt G 次 |

**PPO 优势**：A_t = GAE(用 V 算)，需要训练 Critic。
**GRPO 优势**：A_i = (R_i - mean(R))/std(R)，无需 Critic。

## 四、为什么 GRPO 不需要 Critic

```
PPO 的 Critic 作用：估 V(s)，用来算 A = Q - V 降方差。
  → V(s) 是"状态 s 的期望回报"，需要单独网络学。

GRPO 的洞察：对同一 prompt，组内 mean(R) 就是 V 的天然估计！
  → 同一 prompt 下 G 个回答的回报均值 ≈ V(prompt)
  → 直接用 mean(R) 代替 V，省 Critic 网络。

代价：
  - 需要 G 倍采样（每 prompt 采 G 个回答）
  - 组内统计比 Critic 粗糙（G 有限时）
```

## 五、完整 GRPO 训练流程

```
1. 对每个 prompt q，采样 G 个回答 {o_1, ..., o_G}
2. 用奖励模型/RM 算每个回答的奖励 {R_1, ..., R_G}
3. 算组内优势 A_i = (R_i - mean_R) / std_R
4. 算 PPO 风格的 clipped 损失：
     L = E[ min(ratio_i · A_i, clip(ratio_i, 1±ε) · A_i) ]
   其中 ratio_i = π_new(o_i|q) / π_old(o_i|q)
5. 更新 Actor（无 Critic 更新）
```

## 六、GRPO 适合 RLHF 的原因

1. **省显存**：大模型 RLHF 显存紧张，省 Critic 意味着能训更大模型
2. **无需 Critic 的稳定性问题**：Critic 学不好会导致 A 估计差，训练崩；GRPO 用组统计规避
3. **适合偏好数据**：RLHF 的奖励是序列级（整个回答一个 R），组内比较天然适合

**DeepSeek-R1 / DeepSeek-V3 用 GRPO** 做 RLHF，是 GRPO 的标志性应用。

## 七、加分点

- 说出 **baseline 降方差的数学原理**：E[A] = E[R-b] = E[R]（b 不依赖动作时不改期望），但 Var(R-b) < Var(R)
- 说出 **GRPO 省 Critic 是核心创新**：用组内统计代替 V 网络，显存省一半
- 说出 **DeepSeek-R1 用 GRPO**：让 GRPO 在 2024-2025 年成为 RLHF 主流

## 八、雷区

- ❌ "GRPO 的优势是绝对优势" → 是组内相对优势
- ❌ "baseline 改变梯度期望" → 只降方差，不改期望（数学保证）
- ❌ "GRPO 完全替代 PPO" → GRPO 牺牲 V 精度，某些场景 PPO 更稳

## 九、扩展

- **G 的选择**：通常 4-16，太小（如2）统计不稳，太大（如64）采样成本高
- **GRPO 的 KL 惩罚**：和 PPO 一样需要 KL 约束防止偏离参考模型太远
- **DAPO**：GRPO 的改进版（字节），针对 RLHF 场景优化（动态采样、长度归一化）

## 记忆要点

- GRPO优势计算：同prompt采G个回答，A=(R-组均值)/组标准差
- 核心创新：用组内统计代替Critic网络，显存省一半
- Baseline作用：减均值不改梯度期望，但有效降低方差
- RLHF优势：省显存训大模型，且避免Critic难收敛问题
- DAPO是改进版，DeepSeek-R1标志性应用

## 苏格拉底式面试追问

> 这组追问模拟面试官层层逼问，每一问先回答"为什么"，再回答"怎么做"，最后回答"如何证明"。

### 第一层：目标与动机

**Q：GRPO 用组内均值 mean(R) 代替 Critic 的 V。但 mean(R) 只反映"这个 prompt 的平均水平"，丢失了状态级的细粒度（不同 token/步骤的价值）。GRPO 为什么愿意接受这个精度损失？**

因为 Critic 的"精度优势"在 RLHF 里常是理论上的，实际训不好反而有害。一是 Critic 难训：RLHF 的 reward 是序列级（整段回答一个 R），Critic 要从序列级 reward 反推 token 级 V，信用分配难，V 常学不准（value loss 不收敛）。V 不准则 GAE 的优势 A 估计也错，策略梯度方向被带偏，训练崩。二是组统计免费且鲁棒：mean(R) 是 G 个样本的无偏估计（不依赖额外网络），对 reward 噪声天然鲁棒（组内归一化平滑），无需调 Critic 超参。三是显存：Critic 与 Actor 同规模（7B Actor + 7B Critic + 参考模型 + reward 模型），省 Critic 直接省一半 Actor 显存，能训更大模型或用更大 batch。四是 RLHF 的 reward 信号本就粗糙（RM 打分是序列级），用 token 级 Critic 是"伪精度"——V 估到 token 级但 reward 是序列级，信用分配的精度提升有限。所以 GRPO 的权衡是"放弃不可靠的 token 级 V，用可靠的组内统计"，在 RLHF 场景下净收益为正。DeepSeek-R1 的成功证明这个取舍对——省 Critic 反而训得稳、训得大。

### 第二层：证据与定位

**Q：你说 baseline（组均值）降方差。但训练日志里怎么观测"方差确实降了"？baseline 前后梯度方差的具体差异怎么量化？**

观测几路信号。一是优势值 A_i 的分布：减 baseline 前，A_i = R_i 全正（reward 都 > 0），梯度全为正方向混乱；减 baseline 后，A_i = R_i - mean_R 有正有负，正负对称，梯度方向清晰。量化指标是 A_i 均值（减前 > 0，减后 ≈ 0）和正负比例（减前 100% 正，减后约 50/50）。二是梯度方差：用 grad_norm（梯度范数）的方差或 batch 间 grad_norm 波动度量化。减 baseline 后梯度方差应显著下降（REINFORCE with baseline 理论保证 Var(R-b) < Var(R) when b 接近 E[R]）。三是训练稳定性：reward 曲线/loss 曲线的平滑度，方差大则抖动剧烈，方差小则平滑。四是收敛速度：方差小收敛快（梯度方向清晰，更快到最优），对比有无 baseline 的 step-to-reward 曲线。实证方法是"同任务同 seed，只切换 A = R vs A = R - mean_R，比 grad 方差和 reward 平滑度"，baseline 应全面更优。注意 baseline 不改梯度期望（数学保证 E[R-b] = E[R] when b 不依赖动作），所以最终 reward 不变，只是收敛更稳更快。

### 第三层：根因深挖

**Q：baseline = mean(R) 在数学上为什么能降方差而不改期望？严格证明一下。为什么必须 b 不依赖动作 a？如果 b 依赖 a 会怎样？**

数学证明。策略梯度 ∇J = E[A·∇log π(a|s)]，其中 A = R - b。期望 E[A·∇log π] = E[(R-b)·∇log π] = E[R·∇log π] - E[b·∇log π]。关键是第二项 E[b·∇log π]：如果 b 不依赖 a（只依赖 s 或常数），则 E_s[E_a[b·∇log π(a|s)]] = E_s[b·E_a[∇log π(a|s)]]，而 E_a[∇log π(a|s)] = ∫ π(a|s)·∇log π da = ∫ ∇π(a|s) da = ∇∫ π da = ∇1 = 0（概率归一化）。所以 E[b·∇log π] = 0，梯度期望不变 E[A·∇log π] = E[R·∇log π]。方差方面，Var(A·∇log π) = Var(R·∇log π) - 2·Cov(R·∇log π, b·∇log π) + Var(b·∇log π)，当 b 接近 E[R]（如 mean(R)）时，Cov 项为负（b 与 R 正相关），总方差降低。所以 baseline 降方差不改期望，且 b 越接近 E[R|s] 方差降越多。b 依赖 a 的后果：E_a[b(a)·∇log π(a|s)] ≠ 0（因为 b(a) 不能提出积分外），第二项不为 0，梯度期望被改变——这引入了偏差，策略梯度不再正确（可能收敛到错误方向）。所以 baseline 必须不依赖动作（如 mean(R) 只依赖 prompt 和组内 reward，不依赖具体哪个回答的动作选择）。GRPO 的 mean(R) 满足这个条件（它用的是全组平均，对每个 A_i 是固定值，不依赖 i 的"动作"）。

**Q：那如果 b 不依赖 a 是数学要求，为什么不用一个更复杂的、依赖 s（状态）但不依赖 a 的 baseline？比如学一个 b(s) 函数，比常数/组均值更接近 E[R|s]，方差降更多？为什么不这么做？**

可以用 b(s) 函数降更多方差，这正是 Critic V(s) 的角色——V(s) ≈ E[R|s]，是最优 baseline。PPO/Actor-Critic 就是这么做的：A = R - V(s)，V 是学习的 baseline（Critic）。GRPO 不用 V(s) 的原因是成本权衡。一是训练成本：学 V(s) 要单独网络 + 训练（value loss + 反向传播），每步多一个网络的 forward/backward，显存和计算翻倍。二是 RLHF 的 V 难训（如前述信用分配问题），V 学不好反而比 mean(R) 差（baseline 不准则方差降得少甚至增加）。三是 GRPO 的洞察：对同一 prompt s（组内 G 个回答共享 s），mean(R) 就是 E[R|s] 的无偏估计（G 个样本的平均），已经是最优 baseline 的样本估计——不需要额外学 V(s)。所以 GRPO 用"组内平均"直接估计 E[R|s]，省了 Critic。代价是"组内平均"是粗糙估计（G 有限），且对每个 prompt 要采 G 个样本（采样成本）。当 G 足够大（8-16）时，mean(R) 已接近 E[R|s]，方差降低接近 V(s) 的效果，但成本远低。所以 GRPO 是"用采样成本换 Critic 成本"的工程取舍，在 RLHF（采样相对便宜，Critic 显存贵）下划算。

### 第四层：方案权衡

**Q：GRPO 省了 Critic，但每 prompt 要采 G 个回答（采样成本 G 倍）。这个 G 倍采样和 Critic 的计算成本，到底哪个更贵？GRPO 真的更省吗？**

分阶段看成本。采样阶段（rollout）：GRPO 每 prompt 采 G 个回答（G=8-16），PPO 每 prompt 采 1 个（但跑更多 prompt）。GRPO 的 rollout 成本是 PPO 的约 G 倍（同 prompt 采样多次）。但 rollout 主要是 LLM 生成（forward only），比训练（forward+backward）便宜 3-5 倍。训练阶段（update）：GRPO 只有 Actor 一个网络反向传播，PPO 有 Actor + Critic 两个网络。训练成本 PPO 是 GRPO 的约 2 倍（Critic 的反向传播）。显存：PPO 要同时驻留 Actor + Critic + 参考模型 + RM（4 个大模型），GRPO 省 Critic（3 个），显存省 25%。综合权衡：rollout 是 G 倍但单次便宜，训练是 2 倍且单次贵，总成本取决于 rollout/update 比例。RLHF 通常 rollout 占 30-40% 时间，训练占 60-70%，所以 GRPO 的"Critic 节省"（训练侧 50%）大于"G 倍 rollout"（采样侧 G×便宜），净成本 GRPO 略低或持平。但真正的优势是显存——RLHF 显存紧张是首要瓶颈（4 个 7B 模型 + 优化器状态），省 Critic 让能训的模型规模翻倍，这是 GRPO 在大模型 RLHF 取代 PPO 的根本原因。

**Q：GRPO 优势 A = (R - mean_R)/std_R。这个除 std_R 是为什么？不除会怎样？为什么不除 mean_R 或用其他归一化？**

除 std_R 的作用是"尺度归一化"，让 A 的尺度稳定（不随 reward 范围变化）。不除 std_R 的话 A = R - mean_R，尺度依赖 reward 范围——如果某 batch 的 reward 方差大（R 从 0.1 到 0.9），A 的尺度大，梯度大，策略更新剧烈；如果方差小（R 从 0.4 到 0.6），A 的尺度小，梯度小，更新缓慢。这种尺度不一致让 learning rate 难调（一个 batch 太大另一个太小）。除 std_R 后 A ≈ N(0, 1)（标准化），尺度一致，learning rate 对所有 batch 统一，训练稳定。为什么不除 mean_R：mean_R 是位置参数（反映平均 reward），除它会破坏正负对称性（如 R > mean_R 的优势被错误缩放），且 mean_R 可能接近 0 导致除以小数爆炸。为什么不用其他归一化（如 max-min）：max-min 对异常值敏感（一个极端 R 会压缩其他优势），std_R 更鲁棒（基于全部样本的二阶统计）。std_R 还提供"相对难度"信息——std_R 小（组内回答质量接近）说明 prompt 难区分，优势小（弱更新）；std_R 大（质量差异大）说明 prompt 有区分度，优势大（强更新），这种自适应很合理。实践中 std_R 加一个小 epsilon（1e-8）防除零。

### 第五层：验证与沉淀

**Q：怎么证明 GRPO 比 PPO 更适合 RLHF？不只是"DeepSeek 用了"，而是有对照实验的数据支撑？**

对照实验设计。一是固定 benchmark（如 RLHF on GSM8K 或 MATH），同 base 模型（如 Qwen-7B），同 reward 模型，只改优化器（PPO+GAE vs GRPO），对比 final reward / pass rate。二是对比维度：final reward（谁高）、收敛速度（达到 90% final reward 的 step 数）、训练稳定性（reward 曲线方差、KL 超限频率）、显存占用（峰值 GPU 内存）、Critic 收敛性（PPO 的 value loss 是否收敛）。三是预期结果：GRPO final reward 略低或持平 PPO（Critic 精度优势），但收敛更稳（无 Critic 崩溃风险）、显存少 25%（能训更大模型或更大 batch）。四是关键证据：DeepSeek-R1 技术报告和 GRPO 论文（DeepSeekMath）有这类对比，显示 GRPO 在数学推理 RLHF 上匹配或超过 PPO，且训练更稳。五是 ablation：分别去掉 std_R 归一化、改变 G（4/8/16/32）、对比有/无 KL 惩罚，验证每个设计选择的贡献。证明逻辑是"同条件只改方法，多维度对比"，用数据而非"大厂用了就是好"。

**Q：怎么让团队从 PPO 迁移到 GRPO 时不踩坑？沉淀一套迁移 checklist。**

沉淀迁移 checklist 和踩坑库。一是迁移 checklist：基础设施（去掉 Critic 网络、改 rollout 逻辑支持 G 路采样、改 advantage 计算为组内归一化）；超参（G=8-16 起步、ε=0.2 clip 保持、KL 系数 0.04 保持、learning rate 可能需调——GRPO 的 A 尺度与 PPO 不同）；监控（新增组内 std_R 曲线、A 分布、G 路采样的 reward 方差；移除 value loss 监控）；回归测试（小规模任务验证 final reward 持平 PPO，再扩大）。二是踩坑库：G 太小（如 2）导致组统计不稳，reward 抖动——G 至少 8；std_R 接近 0（组内 reward 全相同，prompt 无区分度）导致 A 爆炸——加 epsilon 或跳过该 prompt；KL 惩罚未调（GRPO 的 A 尺度变，KL 系数可能需重调）导致策略漂移；长序列的采样成本（长回答 G 路采样贵）——考虑动态 G（短 prompt 用大 G，长 prompt 用小 G）。三是渐进迁移：先在 PPO 代码里加 GRPO 的 advantage 计算作为可选模式，A/B 对比，确认稳定再全面切换。让迁移是"checklist + 踩坑库 + A/B 验证"的工程过程，不靠"直接换代码试试"。

## 结构化回答

**30 秒电梯演讲：** GRPO（Group Relative Policy Optimization）的优势值 A_i = (R_i - mean(R)) / std(R)，即"组内相对优势"——对同一 prompt 采样 G 个回答。

**展开框架：**
1. **GRPO 优势** — A_i = (R_i - mean(R_group)) / std(R_group)
2. **baseline** — baseline = 组均值 mean(R)，降方差让正负优势对称
3. **对同一** — 对同一 prompt 采样 G 个回答，组内归一化

**收尾：** 您想深入聊：GRPO 的 G（组大小）怎么选？


## 视频脚本

> 预计时长：5 分钟 | 由浅入深


| 时间 | 画面/字幕 | 口播台词 | 讲解要点 |
|------|----------|----------|----------|
| 0:00 | 标题卡：GRPO 里的优势值是什么？怎么计算？… | "像班级排名——同一份卷子（prompt）全班（G个回答）一起考，你的分数减去班级平均分再除…" | 开场钩子 |
| 0:20 | 核心概念图 | "GRPO（Group Relative Policy Optimization）的优势值 A_i = (R_i…" | 核心定义 |
| 0:50 | GRPO 优势示意图 | "GRPO 优势——A_i = (R_i - mean(R_group)) / std(R_group)" | 要点拆解1 |
| 1:30 | baseline示意图 | "baseline——baseline = 组均值 mean(R)，降方差让正负优势对称" | 要点拆解2 |
| 2:20 | 对比/实战案例图 | "对比一下常见误区和工程实践，看真实场景里怎么取舍。" | 实战与对比 |
| 3:10 | 总结卡 | "记住核心要点。下期我们追问：GRPO 的 G（组大小）怎么选？" | 收尾与钩子 |
