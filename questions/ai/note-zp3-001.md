---
id: note-zp3-001
difficulty: L3
category: ai
subcategory: LLM
tags:
  - 智谱
  - 面经
  - RoPE
  - 位置编码
feynman:
  essence: "RoPE(旋转位置编码)通过对Query和Key施加旋转变换，用绝对位置编码实现相对位置关系，兼顾外推性和计算效率"
  analogy: "想象时钟的指针——绝对位置是时分针的角度，两个指针的夹角差(相对位置)才是我们关心的。RoPE就是把token放到时钟表盘上，通过旋转角度差自然表达相对距离"
  first_principle: "Attention的核心是Q·K点积，RoPE在点积前旋转Q和K，使得点积结果只依赖它们的相对位置"
  key_points:
    - 'RoPE = 绝对位置编码 + 自然得到相对位置关系'
    - '通过旋转矩阵实现，不引入额外参数'
    - '支持长度外推(配合NTK-aware scaling)'
    - '主流模型: LLaMA/Qwen/GLM/DeepSeek都用RoPE'
first_principle:
  essence: "Attention只关心token间的相对位置，不关心绝对位置"
  derivation: "需要Q·K只依赖m-n(相对位置) → 对Q_m旋转θm、K_n旋转θn → Q_m·K_n = g(x_m, x_n, m-n) → 点积自然包含相对位置信息"
  conclusion: "RoPE用绝对位置的旋转变换巧妙实现了相对位置编码"
follow_up:
  - "RoPE怎么实现长度外推？NTK-aware是什么？"
  - "ALiBi和RoPE有什么区别？"
  - "RoPE的base(10000)怎么调？"
---

# 详细讲讲 RoPE 旋转位置编码？还有哪些位置编码？为什么用 RoPE？

## 为什么需要位置编码

Transformer的Self-Attention本身是**位置无关**的(Permutation Equivariant)——打乱输入顺序，输出只是对应的打乱。所以必须额外注入位置信息。

## 位置编码演进

| 方案 | 类型 | 代表模型 | 特点 | 缺点 |
|------|------|---------|------|------|
| **Sinusoidal** | 绝对、固定 | Transformer(原版) | 无参数、简单 | 不支持外推 |
| **Learned PE** | 绝对、可学 | BERT/GPT-2 | 灵活 | 外推差、参数 |
| **ALiBi** | 相对、固定 | BLOOM | 无参数、外推好 | 性能略逊RoPE |
| **RoPE** | 绝对形式+相对效果 | LLaMA/Qwen/GLM | ⭐外推+无参数+高效 | 实现稍复杂 |

## RoPE 原理推导

### 核心目标

```
我们希望: <q_m, k_n> = g(x_m, x_n, m-n)
即: 位置m的Q和位置n的K的点积，只依赖它们的相对距离(m-n)
```

### 2D情形

```python
# 对2维向量，旋转变换可以实现这个目标
import numpy as np

def rotate_2d(vec, angle):
    """2D旋转变换"""
    cos_a, sin_a = np.cos(angle), np.sin(angle)
    return np.array([vec[0]*cos_a - vec[1]*sin_a,
                     vec[0]*sin_a + vec[1]*cos_a])

# 位置m的旋转角度 = m * θ
theta = 10000 ** (-2 * np.arange(d//2) / d)  # 频率基

# 对位置m:
q_rotated = rotate_2d(q, m * theta)  # 旋转角度 = m * θ
k_rotated = rotate_2d(k, n * theta)

# 点积结果:
# <q_rotated, k_rotated> = Re(q * k* * e^{i(m-n)θ})
# 自然包含了相对位置 (m-n)!
```

### D维推广

```python
def apply_rope(x, positions, base=10000):
    """
    x: [batch, seq_len, d]
    positions: [seq_len] 位置索引
    """
    d = x.shape[-1]
    # 频率: θ_i = base^(-2i/d), i = 0,1,...,d/2-1
    freqs = 1.0 / (base ** (torch.arange(0, d, 2).float() / d))
    # 角度: position * freq
    angles = positions[:, None] * freqs[None, :]  # [seq_len, d/2]

    cos = angles.cos()  # [seq_len, d/2]
    sin = angles.sin()

    # 将x的相邻两维视为复数的实部/虚部
    x1, x2 = x[..., ::2], x[..., 1::2]  # 偶数位和奇数位

    # 旋转
    rotated = torch.stack([
        x1 * cos - x2 * sin,  # 实部
        x1 * sin + x2 * cos,  # 虚部
    ], dim=-1).flatten(-2)

    return rotated
```

### 直观理解

```
d=8维向量，分成4组2D子空间:

[x0,x1] → 旋转 θ₀·m (高频，捕捉局部位置)
[x2,x3] → 旋转 θ₁·m
[x4,x5] → 旋转 θ₂·m
[x6,x7] → 旋转 θ₃·m (低频，捕捉全局位置)

不同子空间用不同频率的旋转，类似多尺度位置感知
```

## 为什么选 RoPE

### 1. 相对位置特性
```
不用显式编码相对位置，但Q·K点积自动包含相对信息
→ 比显式相对位置编码(如T5 bias)更高效
```

### 2. 长度外推
```
配合NTK-aware scaling:
  base从10000调大到更大的值
  → 高频分量不变(近距离精度不降)
  → 低频分量频率降低(远距离覆盖增大)
  → 支持更长上下文

LLaMA: 原生2048 → RoPE scaling → 32K/128K/1M
```

### 3. 无额外参数
```
RoPE是固定的数学变换，不需要学习位置embedding
→ 参数量少、训练快
```

### 4. 计算高效
```
只需cos/sin乘法，可预计算缓存
→ 对比Learned PE少一次embedding lookup
```

## ALiBi 作为对比

```
ALiBi: 不给输入加位置编码，而是在attention score上加偏置:

Attention[i,j] = softmax(Q_i·K_j / √d - m·|i-j|)
                                          ↑
                                    线性距离惩罚

优点: 极简、外推天然好
缺点: 线性衰减假设太强，远距离token信息丢失严重
```
