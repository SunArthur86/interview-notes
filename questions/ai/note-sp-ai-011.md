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

