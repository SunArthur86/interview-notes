---
id: note-ai-001
difficulty: L3
category: ai
subcategory: LLM
tags:
- Transformer
- Attention
- LLM
feynman:
  essence: 除以根号d_k = 把点积的方差从d_k缩回1，防止softmax进饱和区导致梯度消失。
  analogy: 就像考试分数标准化——100道题的总分（方差大）除以根号100=10，变成标准分（方差1）。
  key_points:
  - 点积方差=d_k
  - 除以根号d_k后方差=1
  - 防止softmax饱和
  - 保证梯度有效传播
first_principle: null
follow_up:
- 为什么是根号d_k不是d_k？
- Multi-Head Attention中每个head的d_k怎么算？
memory_points:
- 因为点积方差随$d_k$线性增长，导致Softmax进入饱和区引发梯度消失，所以需除以根号$d_k$。
- 除以根号$d_k$刚好使点积方差缩放回1，而除以$d_k$会导致区分度不足退化为均值。
- 口诀：根号缩放保方差，大维不惧梯度降。
---

# Self-Attention 为什么除以根号 d_k？

## 一句话回答

> 当 Query 和 Key 的维度 $d_k$ 较大时，点积 $QK^\top$ 的方差会随 $d_k$ 线性增长，导致 Softmax 输出进入饱和区（梯度趋近于零）。除以 $\sqrt{d_k}$ 将方差缩放回 1，使梯度能够有效传播。

---

## 一、技术原理详解

### 1.1 从 Attention 的计算公式说起

Scaled Dot-Product Attention 的核心公式为：

$$\text{Attention}(Q, K, V) = \text{Softmax}\left(\frac{QK^\top}{\sqrt{d_k}}\right) V$$

其中 $Q \in \mathbb{R}^{n \times d_k}$，$K \in \mathbb{R}^{m \times d_k}$，$V \in \mathbb{R}^{m \times d_v}$。问题的关键就在分母 $\sqrt{d_k}$ 上。

### 1.2 为什么需要缩放——方差推导

假设 Query 和 Key 的每个分量都是独立同分布（i.i.d.）的随机变量，均值为 0，方差为 1：

$$q_i \sim (0, 1), \quad k_i \sim (0, 1), \quad i = 1, 2, \ldots, d_k$$

则点积 $S = Q \cdot K^\top = \sum_{i=1}^{d_k} q_i \cdot k_i$ 的期望和方差为：

$$E[S] = E\left[\sum_{i=1}^{d_k} q_i k_i\right] = \sum_{i=1}^{d_k} E[q_i k_i] = 0$$

$$\text{Var}(S) = \text{Var}\left(\sum_{i=1}^{d_k} q_i k_i\right) = \sum_{i=1}^{d_k} \text{Var}(q_i k_i) = \sum_{i=1}^{d_k} E[q_i^2] \cdot E[k_i^2] = d_k$$

**结论：点积的标准差为 $\sqrt{d_k}$，且随维度线性增长。** 当 $d_k = 64$ 时标准差为 8；$d_k = 512$ 时标准差约为 22.6。

### 1.3 为什么大点积值会导致梯度消失

Softmax 的公式为 $\text{Softmax}(x_i) = \frac{e^{x_i}}{\sum_j e^{x_j}}$，其关于输入的雅可比矩阵为：

$$\frac{\partial s_i}{\partial x_j} = s_i (\delta_{ij} - s_j)$$

当某个 $x_i$ 远大于其他值时，$s_i \to 1$，其余 $s_j \to 0$。此时：

- 对角项：$\frac{\partial s_i}{\partial x_i} = s_i(1 - s_i) \to 1 \times 0 = 0$
- 非对角项：$\frac{\partial s_j}{\partial x_i} = s_j(0 - s_i) \to 0 \times (-1) = 0$

**梯度全部趋近于零——这就是 Softmax 饱和区**。在 Transformer 中，Attention 权重的梯度消失会导致 Q、K、V 的投影矩阵无法有效学习。

### 1.4 除以 $\sqrt{d_k}$ 的效果

$$\text{Var}\left(\frac{S}{\sqrt{d_k}}\right) = \frac{1}{d_k} \cdot \text{Var}(S) = \frac{d_k}{d_k} = 1$$

缩放后，点积的标准差恒为 1，与 $d_k$ 无关。这确保了无论模型维度多大，Attention 权重的分布都保持稳定。

### 1.5 为什么是 $\sqrt{d_k}$ 而不是 $d_k$？

这是一个高频追问点。核心原因：

| 缩放因子 | 缩放后方差 | Softmax 输出特性 | 效果 |
|----------|-----------|-----------------|------|
| 不缩放 | $d_k$ | 尖峰分布（one-hot like） | 梯度消失 |
| $\sqrt{d_k}$ | $1$ | 适中区分度 | ✅ 最佳 |
| $d_k$ | $1/d_k$ | 接近均匀分布 | 区分度不足，attention 退化为均值 |

除以 $d_k$ 会过度缩放，使得 Softmax 输出接近均匀分布 $\frac{1}{n}$，模型几乎无法区分不同位置的注意力权重，表达能力大幅下降。$\sqrt{d_k}$ 是保证方差为 1 的**恰好**缩放因子。

---

## 二、代码示例

### 2.1 PyTorch 实现

```python
import torch
import torch.nn.functional as F
import math

def scaled_dot_product_attention(Q, K, V, mask=None):
    """
    Q: (batch, num_heads, seq_len, d_k)
    K: (batch, num_heads, seq_len, d_k)
    V: (batch, num_heads, seq_len, d_v)
    """
    d_k = Q.size(-1)
    
    # 1. 计算点积注意力分数
    scores = torch.matmul(Q, K.transpose(-2, -1))  # (batch, heads, seq, seq)
    
    # 2. ★ 核心步骤：缩放 ★
    scores = scores / math.sqrt(d_k)
    
    # 3. 应用mask（如因果mask用于解码器）
    if mask is not None:
        scores = scores.masked_fill(mask == 0, float('-inf'))
    
    # 4. Softmax归一化得到注意力权重
    attn_weights = F.softmax(scores, dim=-1)
    
    # 5. 加权求和
    output = torch.matmul(attn_weights, V)
    
    return output, attn_weights


# === 实验验证：缩放前后方差对比 ===
import numpy as np

d_k_values = [16, 64, 128, 512, 768]
print(f"{'d_k':>6} | {'缩放前std':>12} | {'缩放后std':>12} | {'理论sqrt(d_k)':>14}")
print("-" * 55)

for d_k in d_k_values:
    q = torch.randn(10000, d_k)
    k = torch.randn(10000, d_k)
    
    raw_scores = (q * k).sum(dim=-1)           # 未缩放
    scaled_scores = raw_scores / math.sqrt(d_k)  # 缩放后
    
    print(f"{d_k:>6} | {raw_scores.std():>12.3f} | {scaled_scores.std():>12.3f} | {math.sqrt(d_k):>14.3f}")

# 输出示例：
#    d_k |    缩放前std |    缩放后std | 理论sqrt(d_k)
# -------------------------------------------------------
#     16 |        4.012 |        1.003 |          4.000
#     64 |        8.021 |        1.003 |          8.000
#    128 |       11.314 |        1.000 |         11.314
#    512 |       22.627 |        1.000 |         22.627
#    768 |       27.713 |        1.000 |         27.713
```

### 2.2 Attention 计算流程图

```
        Input Embeddings (batch, seq_len, d_model)
                        │
           ┌────────────┼────────────┐
           ▼            ▼            ▼
     ┌──────────┐ ┌──────────┐ ┌──────────┐
     │  W_Q     │ │  W_K     │ │  W_V     │
     │ (d_model │ │ (d_model │ │ (d_model │
     │  × d_k)  │ │  × d_k)  │ │  × d_v)  │
     └────┬─────┘ └────┬─────┘ └────┬─────┘
          │            │            │
          Q            K            V
          │            │            │
          │    ┌───────┘            │
          ▼    ▼                    │
     ┌─────────────┐                │
     │ Q · K^T     │  点积得分       │
     │ (seq × seq) │                │
     └──────┬──────┘                │
            │                       │
     ┌──────▼──────┐                │
     │  ÷ √d_k     │  ★ 方差归一化 ★ │
     └──────┬──────┘                │
            │                       │
     ┌──────▼──────┐                │
     │  Softmax    │  注意力权重     │
     │  (逐行)     │  (seq × seq)   │
     └──────┬──────┘                │
            │                       │
            └───────┬───────────────┘
                    ▼
            ┌──────────────┐
            │  Attn × V    │  加权求和
            │ (seq × d_v)  │
            └──────┬───────┘
                   ▼
              Output (seq_len, d_v)
```

---

## 三、面试高频追问点

### Q1: 为什么是 $\sqrt{d_k}$ 不是 $d_k$？

**答：** 除以 $d_k$ 会过度缩放，使点积方差变为 $1/d_k$，Softmax 输出接近均匀分布，模型无法区分不同 token 的重要性。$\sqrt{d_k}$ 是使方差恰好为 1 的唯一正确缩放因子。

### Q2: Multi-Head Attention 中每个 head 的 $d_k$ 怎么算？

**答：** $d_k = d_{\text{model}} / h$，其中 $h$ 是 head 数量。例如 $d_{\text{model}} = 512$，8 个 head，则 $d_k = 64$，$\sqrt{d_k} = 8$。**每个 head 独立计算缩放**，因为缩放因子与该 head 的注意力维度对应。

### Q3: 加性 Attention（Additive Attention）需要缩放吗？

**答：** 不需要。加性注意力 $\text{score}(q, k) = v^\top \tanh(W_q q + W_k k)$ 通过一层 MLP 计算，$\tanh$ 激活函数的输出范围限制在 $[-1, 1]$，分数本身有界，不存在维度增大导致方差爆炸的问题。这也是原论文中点积注意力在 $d_k$ 较大时表现不如加性注意力的原因——直到加入缩放因子才解决。

### Q4: 实际训练中 Q、K 的分布是否满足均值 0、方差 1 的假设？

**答：** 不严格满足。训练初期，经过 LayerNorm 后的 Q、K 分布接近该假设；但随着训练进行，学到的投影矩阵 $W_Q, W_K$ 会改变分布。但 $\sqrt{d_k}$ 缩放作为一个**保守的启发式**（heuristic），在实践中表现良好，因此被广泛采用。

### Q5: 除以 $\sqrt{d_k}$ 之后，还会遇到 Attention 分布过于尖锐的问题吗？

**答：** 可能会。一些研究发现某些层/某些 head 的 Attention 分布仍然非常尖锐（几乎只关注一个位置）。解决方案包括：使用 Temperature 参数调节 $\text{Softmax}(x/T)$；或者 Sparse Attention、Linear Attention 等变体。

---

## 四、实战经验

1. **面试答题策略：** 先说「防止 softmax 饱和」，再做方差推导（$q_i, k_i$ 独立分布 → 点积方差 = $d_k$），最后画 Softmax 梯度曲线说明为什么饱和区梯度为零。这个三段式回答能拿到满分。

2. **维度对齐：** 在实现 Multi-Head Attention 时，最常见的 bug 是 $d_k$ 和 $d_v$ 不一致导致的维度错误。标准做法是 $d_k = d_v = d_{\text{model}} / h$。

3. **数值稳定性：** 在 FP16 混合精度训练中，点积 $QK^\top$ 在 Softmax 前可能溢出。最佳实践是先用 FP32 计算 Softmax（即使用 `torch.nn.functional.scaled_dot_product_attention`），再转回 FP16。Flash Attention 内部也做了类似的数值稳定性处理。

4. **Llama / GPT-4 等模型的选择：** 现代大模型（GPT、LLaMA、Qwen 等）无一例外都保留了 $\sqrt{d_k}$ 缩放，说明这个设计经受住了大规模实践的检验。但一些变体如 MQA（Multi-Query Attention）、GQA（Grouped-Query Attention）虽然改变了 K/V 的 head 结构，但缩放因子仍然是 $\sqrt{d_k}$。

5. **从第一性原理理解：** 面试官追问深层问题时，可以从信息论角度补充——Softmax 温度参数和 $\sqrt{d_k}$ 缩放在数学上等价，都是调节输出分布的"锐度"。注意力分布的熵应在适当范围内：太尖锐（退化为 hard attention）则梯度差，太平坦（退化为 mean pooling）则表达力弱。

## 记忆要点

- 因为点积方差随$d_k$线性增长，导致Softmax进入饱和区引发梯度消失，所以需除以根号$d_k$。
- 除以根号$d_k$刚好使点积方差缩放回1，而除以$d_k$会导致区分度不足退化为均值。
- 口诀：根号缩放保方差，大维不惧梯度降。

## 苏格拉底式面试追问

> 这组追问模拟面试官层层逼问，每一问先回答"为什么"，再回答"怎么做"，最后回答"如何证明"。

### 第一层：目标与动机

**Q：Self-Attention 里这个 $\sqrt{d_k}$ 你能不背公式，讲清楚它到底在防什么、不防会怎样吗？**

它防的是大 $d_k$ 下点积值发散导致 Softmax 进入饱和区。$d_k=512$ 时点积标准差约 22.6，Softmax 输出会有一项接近 1、其余接近 0，梯度 $\frac{\partial}{\partial s_i}\text{Softmax}$ 里的 $p_i(1-p_i)$ 在 $p_i\to 1$ 时趋于 0，反向传播几乎没信号，训练停滞。动机不是"让数值好看"，是让梯度能回传。

### 第二层：证据与定位

**Q：你怎么在实验里观察到"Softmax 饱和导致梯度消失"，而不是人云亦云？**

两个可观测信号：一是 dump 出训练前几百步的 attention logits，看其标准差是否随 $d_k$ 线性增长、是否远超 1；二是记录每层 attention 权重矩阵的最大值，若长期贴近 1.0 且对应 token 位置几乎不变，说明 attention 退化成 hard attention。再做对照实验：去掉 $\sqrt{d_k}$ 训练相同步数，观察 loss 曲线是否早期就 plateau、梯度范数是否趋近 0。

### 第三层：根因深挖

**Q：你说除以 $\sqrt{d_k}$ 是因为点积方差 $\text{Var}(QK^\top)=d_k$。这个推导依赖什么假设？假设不成立会怎样？**

依赖 Q、K 各分量独立、均值 0、方差 1 的 i.i.d. 假设。训练初期权重接近随机初始化时成立，但训练中后期 $W_Q$、$W_K$ 学到的分布方差远不是 1，某些 head 的 key 会塌缩到低秩子空间。这时固定 $\sqrt{d_k}$ 缩放就不再最优——这也是为什么有些工作（如 Reformer、NUQA）改用可学习缩放因子或按 head 自适应缩放。

**Q：那为什么不干脆除以 $d_k$（线性缩放）或 $d_k^{1.5}$，$\sqrt{d_k}$ 凭什么是最优？**

数学上是刚好把方差压回 1：$\text{Var}(S/\sqrt{d_k})=\text{Var}(S)/d_k=d_k/d_k=1$。除以 $d_k$ 会把方差压到 $1/d_k$，logits 全挤在 0 附近，Softmax 输出接近均匀分布，attention 退化为 mean pooling，丧失选择性。$\sqrt{d_k}$ 是"既消除维度膨胀、又保留区分度"的唯一点，从方差归一化目标反推出来的，不是调参调出来的。

### 第四层：方案权衡

**Q：除以 $\sqrt{d_k}$ 之后仍有数值问题（FP16 下点积溢出），你怎么处理？**

用 FP32 做 Softmax 计算（即 `torch.nn.functional.scaled_dot_product_attention` 的内部实现），或直接上 Flash Attention——它把 $QK^\top$ 分块在 SRAM 里算，避免在 HBM 里实例化大矩阵，同时内部做了数值稳定的 online Softmax。如果用线性 attention 或把 Softmax 换成 ReLU 核（如 Performer），可以彻底绕开这个问题，但表达力会下降，权衡是精度换稳定与速度。

**Q：为什么不直接用加性 attention（$\text{score}(q,k)=v^\top \tanh(Wq+Uk)$）规避点积方差问题？**

加性 attention（Bahdanau 原始版）确实没有方差随维度爆炸的问题，但它无法写成矩阵乘法，无法用 GPU 的 tensor core 加速，复杂度常数大。点积 attention 配 $\sqrt{d_k}$ + Flash Attention 在 GPU 上快一个数量级，这才是 Transformer 能 scale 到百亿参数的工程前提。理论优雅要让位于可大规模并行。

### 第五层：验证与沉淀

**Q：如果有人质疑你"$\sqrt{d_k}$ 只是经验技巧"，你怎么用实验反驳？**

设计三组对照实验，固定模型与数据：A 组不缩放、B 组除以 $\sqrt{d_k}$、C 组除以可学习标量（初始化为 $\sqrt{d_k}$）。对比三组的收敛步数到目标 loss、attention 熵分布、各 head 的有效 rank。预期 B 和 C 接近且显著优于 A，证明缩放是数学必需而非玄学；C 略优于 B 说明可学习缩放在长训练里有边际收益。结果沉淀成内部实验报告，附 attention logits 直方图作为可视化证据。

## 结构化回答




**30 秒电梯演讲：** 就像考试分数标准化——100道题的总分（方差大）除以根号100=10，变成标准分（方差1）。

**展开框架：**
1. **点积方差=d** — 点积方差=d_k
2. **除以根号d_** — 除以根号d_k后方差=1
3. **防止soft** — 防止softmax饱和

**收尾：** 为什么是根号d_k不是d_k？





## 视频脚本

> 预计时长：4 分钟 | 由浅入深


| 时间 | 画面/字幕 | 口播台词 | 讲解要点 |
|------|----------|----------|----------|
| 0:00 | 标题卡：Self-Attention 为什么除以根号 d… | "就像考试分数标准化——100道题的总分（方差大）除以根号100=10，变成标准分（方差1）…" | 开场钩子 |
| 0:20 | 核心概念图 | "除以根号d_k = 把点积的方差从d_k缩回1，防止softmax进饱和区导致梯度消失。" | 核心定义 |
| 0:50 | 点积方差示意图 | "点积方差——点积方差=d_k" | 要点拆解1 |
| 1:30 | 对比/实战案例图 | "对比一下常见误区和工程实践，看真实场景里怎么取舍。" | 实战与对比 |
| 2:20 | 总结卡 | "记住核心要点。下期我们追问：为什么是根号d_k不是d_k？" | 收尾与钩子 |
