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
  - 'baseline = 组均值 mean(R)，降方差让正负优势对称'
  - '对同一 prompt 采样 G 个回答，组内归一化'
  - '相比 PPO 不需要 Critic（用组统计代替 V），省一半显存'
  - '除 std 进一步归一化，让优势尺度稳定'
first_principle:
  essence: GRPO 优势 = 组内相对排名
  derivation: 策略梯度需 A 降方差 → PPO 用 Critic 估 V（贵）→ GRPO 用组内 mean(R) 当 V → 组内归一化得相对优势 → 省 Critic
  conclusion: GRPO 的核心创新是用"组内统计"代替"Critic 网络"，牺牲一点精度换巨大显存节省
follow_up:
- GRPO 的 G（组大小）怎么选？
- GRPO 相比 PPO 训练更稳还是更不稳？
- 为什么 GRPO 适合 RLHF？
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
