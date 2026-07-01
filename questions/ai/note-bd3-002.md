---
id: note-bd3-002
difficulty: L3
category: ai
subcategory: LLM
tags:
- 字节跳动
- 面经
- 二面
feynman:
  essence: 除以√d_k是为了控制点积结果的方差，防止softmax落入梯度消失的饱和区
  analogy: 就像调音量的旋钮——如果原始信号太大（高维点积），softmax会把所有注意力集中在一个位置（一个音符震耳欲聋，其余完全静音），除以√d_k就是把音量调到合适范围
  first_principle: 两个独立的随机向量做点积，结果方差与维度d成正比。维度越高方差越大，softmax输入越大越接近one-hot，梯度趋近于零
  key_points:
  - 点积方差 = d_k × σ²，维度越高方差越大
  - softmax在大输入时梯度趋近零（饱和区），导致训练停滞
  - 除以√d_k将方差归一化为1，保持梯度健康
first_principle:
  essence: 自注意力中Q·K^T的数学性质在高维下会导致softmax饱和
  derivation: 假设Q和K的每个元素是独立同分布的，均值0方差1。点积Q·K = Σq_i·k_i，期望=0，方差=d_k。不缩放时softmax输入的标准差=√d_k，当d_k=128时，输入可达±10+量级，softmax输出接近one-hot
  conclusion: 缩放因子1/√d_k将方差从d_k恢复到1，使softmax始终在梯度敏感区工作
follow_up:
- 除了缩放，还有哪些方法解决softmax饱和问题？
- 为什么不用d_k而是√d_k作为缩放因子？
- 在低维度（如d_k=8）时还需要缩放吗？
memory_points:
- 核心原因防饱和：高维点积方差大(d_k)，导致Softmax输出逼近one-hot引发梯度消失。
- 数学推导记方差：Q和K点积方差为d_k，除以根号d_k刚好把方差缩放回1。
- 除以d_k不可取：若除d_k方差变1/d_k，分布过度平滑导致注意力退化为均值池化。
---

# 自注意力机制中为什么要除以√d_k？

> 来源：字节跳动大模型技术面试二面

## 核心问题：高维点积导致Softmax饱和

### 数学推导

假设 Query 向量 Q 和 Key 向量 K 的每个分量独立同分布，均值为0，方差为1：

```
点积: S = Q · K = Σ(i=1 to d_k) q_i · k_i

期望: E[S] = Σ E[q_i · k_i] = Σ E[q_i]·E[k_i] = 0
方差: Var[S] = Σ Var[q_i · k_i] = Σ E[q_i²]·E[k_i²] = d_k
```

**当 d_k = 128 时**（GPT-3的head维度）：
- 点积的标准差 = √128 ≈ 11.3
- 点积值范围可达 ±30 以上
- softmax(z) 其中 z 有一个值为30，其余为-30：

```
softmax([30, -30, -30, ...]) ≈ [1.0, 0.0, 0.0, ...]  ← 几乎是one-hot！
```

### 为什么one-hot有害？

```
softmax梯度 = p_i × (1 - p_i) × ∂z_i/∂θ

当 p_i ≈ 1 或 p_i ≈ 0 时：
    p_i × (1 - p_i) ≈ 0  ← 梯度消失！

┌──────────────────────────────────────────────┐
│            Softmax 梯度 vs 输入               │
│                                              │
│ 梯度  ↑     ╱╲                               │
│      │    ╱    ╲      ← 梯度敏感区           │
│      │  ╱        ╲                            │
│      │╱            ╲___                      │
│      └────┬────┬────┬────→ 输入值            │
│          -10    0   +10                      │
│       饱和区  健康   饱和区                    │
└──────────────────────────────────────────────┘
```

### 缩放的效果

```
缩放前: scores = Q·K^T        → Var = d_k = 128
缩放后: scores = Q·K^T / √d_k → Var = 1

softmax输入从 ±30 降到 ±3 左右 → 梯度健康！
```

## 代码实现

```python
import torch
import torch.nn.functional as F

def scaled_dot_product_attention(Q, K, V, mask=None):
    """
    Scaled Dot-Product Attention
    Q: (batch, heads, seq_len, d_k)
    K: (batch, heads, seq_len, d_k)
    V: (batch, heads, seq_len, d_v)
    """
    d_k = Q.size(-1)
    
    # ★ 关键：除以√d_k 进行缩放
    scores = torch.matmul(Q, K.transpose(-2, -1)) / torch.sqrt(torch.tensor(d_k, dtype=torch.float32))
    
    if mask is not None:
        scores = scores.masked_fill(mask == 0, float('-inf'))
    
    attn_weights = F.softmax(scores, dim=-1)
    output = torch.matmul(attn_weights, V)
    
    return output, attn_weights
```

## 为什么是√d_k而不是d_k？

**直觉**：我们需要把方差从 d_k 降到 1，标准差从 √d_k 降到 1，所以除以标准差 √d_k。

**验证**：
```
Var[S/√d_k] = Var[S] / d_k = d_k / d_k = 1  ✓
```

如果除以 d_k：`Var[S/d_k] = d_k/d_k² = 1/d_k` → 方差过小，softmax输出过于均匀（所有token权重接近），注意力退化为平均池化。

## 除了缩放还有哪些方法？

| 方法 | 原理 | 优缺点 |
|------|------|--------|
| **√d_k 缩放** | 归一化点积方差 | ✅ 标准方法，计算简单 |
| **温度参数τ** | softmax(z/τ)，τ可学习 | ✅ 更灵活；❌ 增加参数 |
| **L2归一化** | 先对Q、K做L2归一化再点积 | ✅ 稳定；❌ 改变注意力分布 |
| **相对位置编码** | 用相对位置替代绝对位置 | 缓解但不解决方差问题 |
| **RMSNorm注意力** | 用RMS替代缩放 | ✅ 计算更快；效果接近 |

## 实际影响对比

```
不缩放 (d_k=128):
  → 训练初期loss剧烈震荡
  → 梯度范数极小
  → 需要极小的学习率才能收敛
  → 最终效果显著下降

正确缩放:
  → 训练稳定
  → 可以使用较大的学习率
  → 收敛速度快10倍以上
```

**面试加分点**：提到这是Transformer原论文（Attention is All You Need, 2017）提出的标准做法；提到在低维度（d_k ≤ 64）时缩放影响较小，但在高维度（d_k ≥ 128）时至关重要；提到Flash Attention等高效实现中也保留了这一缩放。

## 记忆要点

- 核心原因防饱和：高维点积方差大(d_k)，导致Softmax输出逼近one-hot引发梯度消失。
- 数学推导记方差：Q和K点积方差为d_k，除以根号d_k刚好把方差缩放回1。
- 除以d_k不可取：若除d_k方差变1/d_k，分布过度平滑导致注意力退化为均值池化。

