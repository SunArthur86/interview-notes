---
id: note-sp-ai-012
difficulty: L2
category: ai
subcategory: LLM
tags:
- Shopee
- 面经
- Transformer
- 位置编码
feynman:
  essence: 自注意力不关心顺序，不加位置编码"我爱你"和"你爱我"一模一样
  analogy: 注意力像失忆的读者——能认出每个字但不记得字的顺序。位置编码像给每个字贴上页码标签
  first_principle: 注意力计算是集合操作(set operation)，天然置换不变(permutation invariant)，需要额外注入位置信息
  key_points:
  - 正弦位置编码：正余弦函数生成固定向量
  - 可学习位置编码：位置当可训练参数
  - RoPE旋转编码：旋转矩阵注入Q/K点积，主流方案
first_principle:
  essence: 注意力机制的排列不变性使其无法区分词序，必须通过位置编码显式注入顺序信息
  derivation: softmax(Q·K^T)·V中交换任意两个位置的输入→输出对应交换→不改变语义→需要位置编码打破对称性
  conclusion: 位置编码 = 让注意力机制"知道"每个词在序列中的位置
follow_up:
- RoPE为什么能表示相对位置？
- ALiBi位置编码是什么？
- 长度外推问题怎么解决？
memory_points:
- 因注意力机制具排列不变性，模型无法区分词序，故需位置编码注入位置信息
- 正弦编码无需训练且可外推；可学习编码需训练但长度固定且属绝对位置
- 主流RoPE通过旋转矩阵作用于Q和K，因点积自带相对位置信息故天然支持外推
---

# 为什么需要位置编码？Transformer的位置编码是怎么做的？

## 为什么需要位置编码？

```
没有位置编码的注意力：

输入: "我爱你" → Q,K,V → 注意力计算 → 输出
输入: "你爱我" → Q,K,V → 注意力计算 → 输出

因为注意力是集合操作(每个词独立看其他词)：
→ "我爱你"和"你爱我"的注意力分布完全一样
→ 模型无法区分词序！

类比：
集合 {我, 爱, 你} vs {你, 爱, 我}
→ 作为集合它们是同一个集合
→ 但作为句子含义完全不同
```

**数学本质**：注意力计算 `softmax(Q·K^T)·V` 是排列不变的(permutation invariant)。交换输入中任意两个位置，输出只是对应交换，不产生新信息。

## 三种位置编码方案

### 1. 正弦位置编码（原论文方案）

```
PE(pos, 2i)   = sin(pos / 10000^(2i/d))
PE(pos, 2i+1) = cos(pos / 10000^(2i/d))

pos = 词在序列中的位置 (0, 1, 2, ...)
2i, 2i+1 = 嵌入向量的维度索引
d = 嵌入维度 (如512)
```

```
位置0: [sin(0), cos(0), sin(0), cos(0), ...]     = [0, 1, 0, 1, ...]
位置1: [sin(1), cos(1), sin(0.01), cos(0.01), ...]
位置2: [sin(2), cos(2), sin(0.02), cos(0.02), ...]
...

特点：
✅ 不需要训练
✅ 理论上可外推到比训练更长的序列
✅ sin/cos的线性组合可以表示相对位置

使用方式：PE直接加到Token Embedding上
  input = TokenEmbedding(token) + PositionalEncoding(pos)
```

### 2. 可学习位置编码（BERT/GPT-2方案）

```python
class LearnedPositionalEncoding(nn.Module):
    def __init__(self, max_len=512, d_model=512):
        super().__init__()
        # 位置嵌入是可训练参数
        self.pe = nn.Parameter(torch.randn(max_len, d_model))
    
    def forward(self, x):
        # x: (batch, seq_len, d_model)
        return x + self.pe[:x.size(1)]

特点：
✅ 灵活，模型自己学最优的位置表示
❌ 最大长度固定(max_len)，超出需要截断
❌ 需要额外参数
```

### 3. RoPE旋转位置编码（LLaMA/Qwen主流方案）⭐

```
核心思想：通过对Q和K施加旋转矩阵来注入位置信息

        旋转矩阵
Q_rot = R(pos) · Q
K_rot = R(pos') · K

注意力分数 = Q_rot · K_rot^T
           = Q · R(pos)^T · R(pos') · K^T
           = Q · R(pos' - pos) · K^T    ← 自动变成相对位置！

不同位置的旋转角度不同：
pos=0: 不旋转
pos=1: 旋转θ
pos=2: 旋转2θ
...

结果：Q·K的点积自然包含了相对位置信息
```

```python
import torch

def apply_rope(q, k, positions):
    """RoPE旋转位置编码"""
    d = q.size(-1)
    half = d // 2
    
    # 构造旋转角度
    freqs = 1.0 / (10000 ** (torch.arange(0, half).float() / half))
    angles = positions.unsqueeze(-1) * freqs  # (seq_len, half)
    
    cos = torch.cos(angles)
    sin = torch.sin(angles)
    
    # 对Q和K的每对维度施加旋转
    q_rot = torch.cat([q[..., :half] * cos - q[..., half:] * sin,
                        q[..., :half] * sin + q[..., half:] * cos], dim=-1)
    k_rot = torch.cat([k[..., :half] * cos - k[..., half:] * sin,
                        k[..., :half] * sin + k[..., half:] * cos], dim=-1)
    
    return q_rot, k_rot
```

## 三种方案对比

| 方案 | 代表模型 | 训练 | 外推 | 相对位置 | 复杂度 |
|------|---------|------|------|---------|--------|
| **正弦编码** | 原Transformer | ❌ 无需训练 | ✅ 理论可外推 | ⚠️ 隐式 | O(1) |
| **可学习编码** | BERT/GPT-2 | ✅ 需训练 | ❌ 固定max_len | ❌ 绝对位置 | O(N·d) |
| **RoPE** | LLaMA/Qwen | ❌ 无需训练 | ✅ 可外推 | ✅ 天然相对位置 | O(d) |

## RoPE为什么成为主流？

```
1. 天然支持相对位置
   → 注意力分数 = f(Q, K, pos_q - pos_k)
   → 模型自然学到"距离"概念

2. 长度外推
   → 旋转角度按频率衰减
   → 训练2K长度可以外推到4K-8K
   → 配合YaRN/NTK等技术可外推到100K+

3. 计算高效
   → 只需矩阵乘法，无额外参数
   → 不增加模型参数量
```

## 面试加分点

1. **排列不变性**：能解释为什么注意力需要位置编码（数学本质）
2. **RoPE核心**：旋转矩阵让Q·K点积自动包含相对位置信息
3. **外推能力**：RoPE比可学习编码更适合长文本场景
4. **最新趋势**：提到YaRN/NTK-aware等RoPE长度外推技术

## 记忆要点

- 因注意力机制具排列不变性，模型无法区分词序，故需位置编码注入位置信息
- 正弦编码无需训练且可外推；可学习编码需训练但长度固定且属绝对位置
- 主流RoPE通过旋转矩阵作用于Q和K，因点积自带相对位置信息故天然支持外推

