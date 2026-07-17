---
id: note-sp-ai-011
difficulty: L2
category: ai
subcategory: LLM
tags:
- Shopee
- 面经
- Transformer
- 注意力
feynman:
  essence: 每个词跟所有词做相关性打分，按分数加权聚合——每个词都能看到全句
  analogy: 自注意力像会议室讨论——每个人(Q)提出自己关心的点，和其他人的标签(K)匹配，匹配度高的就听谁说(V)
  first_principle: 注意力的本质是信息检索——Q是查询，K是索引，V是内容，用Q和K的相似度决定从V中取多少
  key_points:
  - Q=查询向量(我要找什么)，K=键向量(我有什么标签)，V=值向量(我的内容)
  - 计算流程：Q·K^T→scale→softmax→×V
  - 多头=并行8组，不同头关注不同模式
  - 除以√d防止内积过大导致softmax梯度消失
first_principle:
  essence: 自注意力是一种软性信息检索——用Query和Key的相似度决定从Value中加权提取信息
  derivation: Q·K点积=相似度→softmax归一化=权重→权重×V=加权聚合。本质上是一个可微分的"查表"操作
  conclusion: QKV注意力的本质是"根据相关性聚合信息"
follow_up:
- 为什么除以根号d？
- 多头注意力的"多头"怎么理解？
- 注意力复杂度O(n²)怎么优化？
memory_points:
- QKV本质：Q是搜索词，K是匹配标签，V是实际内容。
- 计算四步口诀：算内积（Q乘K转置）→缩放（除以根号d）→归一化→加权聚合（乘V）。
- 缩放原因：因为内积过大会导致Softmax进入饱和区引起梯度消失，所以需除以根号d。
- 多头机制：因为多组并行计算能捕捉不同子空间特征，所以融合后表达力更强。
---

# 自注意力机制的计算过程是怎样的？Q、K、V分别是什么？

## Q、K、V 的本质

```
类比图书馆找书：

Query (Q) = 你的搜索词      "我想找关于Python的书"
Key   (K) = 书的标签/关键词  "Python, 编程, 入门"
Value (V) = 书的内容         《Python编程：从入门到实践"

Q·K相似度 → 决定你关注哪些书 → 按关注度加权取内容(V)
```

| 向量 | 来源 | 作用 |
|------|------|------|
| **Q (Query)** | X × W_Q | "我要找什么" |
| **K (Key)** | X × W_K | "我有什么标签可匹配" |
| **V (Value)** | X × W_V | "我的实际内容" |

## 完整计算流程

```
输入 X = [x₁, x₂, x₃]  (3个词的嵌入向量)
     │
     ├──→ X · W_Q → Q = [q₁, q₂, q₃]
     ├──→ X · W_K → K = [k₁, k₂, k₃]
     └──→ X · W_V → V = [v₁, v₂, v₃]
     
Step 1: 计算注意力分数（Q·K^T）
     ┌─────────────────────────┐
     │ Score = Q · K^T         │
     │                        │
     │  q₁·k₁  q₁·k₂  q₁·k₃ │ ← 词1对词1,2,3的注意力
     │  q₂·k₁  q₂·k₂  q₂·k₃ │ ← 词2对词1,2,3的注意力
     │  q₃·k₁  q₃·k₂  q₃·k₃ │ ← 词3对词1,2,3的注意力
     └─────────────────────────┘

Step 2: 缩放（除以√d_k）
     Scaled_Score = Score / √d_k
     
     为什么？→ 防止内积过大→softmax进入饱和区→梯度消失

Step 3: Softmax归一化
     ┌─────────────────────────┐
     │     softmax(每行)        │
     │                        │
     │  0.7    0.2    0.1     │ ← 词1的注意力分配
     │  0.1    0.8    0.1     │ ← 词2的注意力分配
     │  0.15   0.15   0.7     │ ← 词3的注意力分配
     └─────────────────────────┘
     每行之和=1，表示注意力权重分配

Step 4: 加权聚合（权重 × V）
     Output = Attention_Weights · V
     
     词1的输出 = 0.7×v₁ + 0.2×v₂ + 0.1×v₃
     → 词1融合了全句信息，但主要关注自己(0.7)
```

## 代码实现

```python
import torch
import torch.nn.functional as F
import math

class SelfAttention(nn.Module):
    def __init__(self, d_model=512):
        super().__init__()
        self.W_Q = nn.Linear(d_model, d_model)
        self.W_K = nn.Linear(d_model, d_model)
        self.W_V = nn.Linear(d_model, d_model)
        self.d_k = d_model
    
    def forward(self, x, mask=None):
        # x: (batch, seq_len, d_model)
        
        Q = self.W_Q(x)  # (batch, seq_len, d_model)
        K = self.W_K(x)
        V = self.W_V(x)
        
        # Step 1: 注意力分数 Q·K^T / √d_k
        scores = torch.matmul(Q, K.transpose(-2, -1)) / math.sqrt(self.d_k)
        # scores: (batch, seq_len, seq_len)
        
        # 可选：应用mask（Decoder的causal mask）
        if mask is not None:
            scores = scores.masked_fill(mask == 0, float('-inf'))
        
        # Step 2: Softmax归一化
        attention_weights = F.softmax(scores, dim=-1)
        
        # Step 3: 加权聚合
        output = torch.matmul(attention_weights, V)
        # output: (batch, seq_len, d_model)
        
        return output
```

## 多头注意力（Multi-Head Attention）

```
单头注意力：一个视角看全句
多头注意力：8个不同视角同时看全句，再拼接

         输入 X
           │
     ┌─────┼─────┬─────┬─────┐
     │     │     │     │     │
   Head1 Head2 Head3 ... Head8
     │     │     │     │
     Q₁K₁V₁ Q₂K₂V₂ Q₃K₃V₃  Q₈K₈V₈
     │     │     │     │
     └─────┴─────┴──┬──┴─────┘
                    │
              Concat(拼接)
                    │
              Linear(线性变换)
                    │
                  输出

不同头学到的模式：
Head1: 语法关系（主谓宾）
Head2: 指代消解（"他"指谁）
Head3: 语义相似（近义词）
Head4: 位置关系（前后文）
...
```

```python
class MultiHeadAttention(nn.Module):
    def __init__(self, d_model=512, nhead=8):
        super().__init__()
        self.d_k = d_model // nhead  # 每个头的维度=64
        self.nhead = nhead
        
        self.W_Q = nn.Linear(d_model, d_model)
        self.W_K = nn.Linear(d_model, d_model)
        self.W_V = nn.Linear(d_model, d_model)
        self.W_O = nn.Linear(d_model, d_model)
    
    def forward(self, x):
        batch, seq_len, _ = x.shape
        
        # 分成nhead个头
        Q = self.W_Q(x).view(batch, seq_len, self.nhead, self.d_k).transpose(1, 2)
        K = self.W_K(x).view(batch, seq_len, self.nhead, self.d_k).transpose(1, 2)
        V = self.W_V(x).view(batch, seq_len, self.nhead, self.d_k).transpose(1, 2)
        # 每个Q/K/V: (batch, nhead, seq_len, d_k)
        
        # 每个头独立做注意力
        scores = torch.matmul(Q, K.transpose(-2, -1)) / math.sqrt(self.d_k)
        attention = F.softmax(scores, dim=-1)
        heads_output = torch.matmul(attention, V)
        # (batch, nhead, seq_len, d_k)
        
        # 拼接所有头
        concat = heads_output.transpose(1, 2).contiguous().view(batch, seq_len, -1)
        
        # 最终线性变换
        return self.W_O(concat)
```

## 为什么除以√d_k？

```
当d_k很大时，Q·K的点积值很大：
→ softmax输入很大 → 输出接近one-hot(一个1，其余0)
→ 梯度趋近于零 → 训练停滞

除以√d_k将方差归一化到1：
Var(Q·K) = d_k  →  Var(Q·K/√d_k) = 1

示例：d_k=64
  原始点积可能=100 → softmax([100, 20, 5]) → [1.0, 0.0, 0.0]
  缩放后=12.5 → softmax([12.5, 2.5, 0.6]) → [0.9999, 0.0001, 0.0]
  还是太大？不，实际中Q和K的分布使得缩放后更平滑
```

## 面试加分点

1. **QKV本质**：不是三个独立的输入，而是同一个X经过三个不同线性变换得到
2. **缩放原因**：防止softmax饱和，数学上是方差归一化
3. **多头直觉**：不同头学习不同子空间的模式（语法/语义/指代等）
4. **复杂度**：O(n²·d)，n是序列长度——这是FlashAttention等优化的动机

## 记忆要点

- QKV本质：Q是搜索词，K是匹配标签，V是实际内容。
- 计算四步口诀：算内积（Q乘K转置）→缩放（除以根号d）→归一化→加权聚合（乘V）。
- 缩放原因：因为内积过大会导致Softmax进入饱和区引起梯度消失，所以需除以根号d。
- 多头机制：因为多组并行计算能捕捉不同子空间特征，所以融合后表达力更强。


## 苏格拉底式面试追问

> 这组追问模拟面试官层层逼问，每一问先回答"为什么"，再回答"怎么做"，最后回答"如何证明"。

### 第一层：目标与动机

**Q：Self-Attention 为什么要做 softmax 归一化？不归一化直接用原始点积会怎样？**

softmax 做两件事：1) 把注意力分数压到 [0,1] 且和为 1，让输出是 value 的加权平均（凸组合），数值稳定；2) 放大最大值的权重、抑制小值，让模型聚焦最相关的 key。不归一化直接用点积的话，输出是 value 的加权求和（权重无界），数值会爆炸或消失，且失去"概率分配"的语义。更关键的是 softmax 的可微性——它的梯度能正确反向传播，原始点积的梯度行为差。

### 第二层：证据与定位

**Q：模型训练时 Attention 矩阵出现 NaN，怎么定位是 softmax 数值溢出还是输入 embedding 异常？**

看三处：1) 输入 embedding 的统计——是否有 inf 或极端值（norm > 100），如果有是输入异常；2) Q·K 的点积值——如果 max 值 > 1000，softmax 前的 exp 会溢出（exp(1000) = inf），是数值稳定性问题；3) 是否用了 scaled dot-product——`Q·K / sqrt(d_k)` 的缩放能防止点积过大。解法：检查是否漏了 `/sqrt(d_k)`，以及 softmax 是否用了 numerically stable 实现（减去 max 再 exp）。

### 第三层：根因深挖

**Q：Scaled Dot-Product Attention 为什么要除以 sqrt(d_k)，根因是什么？**

根因是"点积的方差随 d_k 增长"。假设 Q 和 K 的每个元素是均值 0、方差 1 的独立分布，点积 Q·K 是 d_k 个独立乘积之和，方差是 d_k。d_k=64 时点积标准差是 8，d_k=512 时是 22。大点积会让 softmax 进入饱和区（梯度趋零，训练停滞）。除以 sqrt(d_k) 把方差拉回 1，让 softmax 工作在梯度健康的区间。这是数值稳定性的刚需，不是经验技巧。

**Q：那为什么不直接用加性注意力（additive attention，Bahdanau 那种），它天然不受 d_k 影响？**

加性注意力用 `tanh(W_q·q + W_k·k)` 计算分数，确实数值更稳，但有两个代价：1) 计算量——加性注意力是 O(d) 的逐元素运算，无法用矩阵乘法高效并行，而点积注意力是一次矩阵乘 GEMM，GPU 极度优化；2) 表达能力——经验上点积注意力在 d_k 大时表现不输加性注意力（"Attention is All You Need" 论文验证）。权衡后，点积 + scaling 是计算效率和稳定性的最优组合，所以成为主流。

### 第四层：方案权衡

**Q：Multi-Head Attention 的 head 数（8 vs 16 vs 32）怎么选？多了好还是少了好？**

head 数决定"注意力的多样性"。每个 head 学习不同的注意力模式（有的学语法依赖、有的学语义关联）。head 太少（如 2）——模式覆盖不足，模型能力受限；head 太多（如 64）——每个 head 维度太小（d_model / num_heads），表达能力下降，且计算开销线性增长。经验最优是 d_head = 64-128，所以 d_model=512 用 8 头、d_model=4096 用 32 头。不是越多越好，是 d_head 不能太小。

**Q：为什么不直接用 Single-Head 大注意力（d_head = d_model），而要拆成 Multi-Head？**

Single-Head 只能学一种注意力模式，表达能力受限。Multi-Head 让模型从不同子空间做注意力，每个 head 关注不同方面（类似 CNN 的多通道）。经验上 Multi-Head 在翻译、推理等任务上显著优于 Single-Head（论文 ablation 验证）。本质是"分而治之"——把高维注意力分解成多个低维注意力，既保留总信息量又增加模式多样性。Single-Head 是 Multi-Head 的退化情形（num_heads=1），但不是最优。

### 第五层：验证与沉淀

**Q：怎么验证 Attention 机制真的学到了有意义的模式？**

两个方法：1) 注意力可视化——取训练好的模型，对特定输入画 attention weights 热力图，看是否有可解释的模式（如 head 0 关注前一个 token、head 5 关注句末标点、head 12 做长距离依赖）；2) Probing 实验——冻结 attention 层，训练线性探针预测语法特征（词性、依存关系），如果某些 head 的探针准确率高，说明该 head 学到了对应特征。沉淀为模型 interpretability 报告：每个 head 的功能标注，帮助调参和 debug。

## 结构化回答

**30 秒电梯演讲：** 每个词跟所有词做相关性打分，按分数加权聚合——每个词都能看到全句——自注意力像会议室讨论。

**展开框架：**
1. **Q** — Q=查询向量(我要找什么)，K=键向量(我有什么标签)，V=值向量(我的内容)
2. **计算流程** — Q·K^T→scale→softmax→×V
3. **多头** — 多头=并行8组，不同头关注不同模式

**收尾：** 您想深入聊：为什么除以根号d？


## 视频脚本

> 预计时长：3 分钟 | 由浅入深


| 时间 | 画面/字幕 | 口播台词 | 讲解要点 |
|------|----------|----------|----------|
| 0:00 | 标题卡：自注意力机制的计算过程是怎样的？Q、K、V分别是… | "自注意力像会议室讨论——每个人(Q)提出自己关心的点，和其他人的标签(K)匹配，匹配度高的…" | 开场钩子 |
| 0:20 | 核心概念图 | "每个词跟所有词做相关性打分，按分数加权聚合——每个词都能看到全句" | 核心定义 |
| 0:55 | Q示意图 | "Q——Q=查询向量(我要找什么)，K=键向量(我有什么标签)，V=值向量(我的内容)" | 要点拆解1 |
| 1:30 | 对比/实战案例图 | "对比一下常见误区和工程实践，看真实场景里怎么取舍。" | 实战与对比 |
