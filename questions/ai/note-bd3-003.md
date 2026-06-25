---
id: note-bd3-003
difficulty: L3
category: ai
subcategory: LLM
tags:
  - 字节跳动
  - 面经
  - 二面
feynman:
  essence: MHA每个头有独立的Q/K/V，MQA所有头共享一组K/V，GQA介于两者之间——分组共享K/V
  analogy: '像一个公司开会——MHA是每个部门各派翻译（贵但精准），MQA是所有人共用一个翻译（省资源但可能不够精准），GQA是几个相近部门共用一个翻译（性价比最优）'
  first_principle: 注意力头的多样性来自Query的差异化，而Key/Value更多是共享的信息载体，因此可以减少K/V头数而不显著损失效果
  key_points:
    - 'MHA: N个Q头 + N个K/V头 → 效果最好但KV Cache最大'
    - 'MQA: N个Q头 + 1个K/V头 → KV Cache最小但效果下降'
    - 'GQA: N个Q头 + G个K/V头 → 效果接近MHA，KV Cache大幅减少'
first_principle:
  essence: 多头注意力的核心价值是让模型从不同子空间关注不同信息
  derivation: '不同头的Query投影到不同子空间是关键，而K/V本质是信息存储，相邻头的K/V高度相似。GQA利用这一冗余性，让每组Q头共享K/V，在保持表征多样性的同时减少存储'
  conclusion: GQA是MHA和MQA的最优折中，已成为主流大模型的标准配置
follow_up:
  - GQA中分组数G应该怎么选？
  - 为什么MQA效果下降明显但GQA几乎无损？
  - KV Cache大小对推理延迟的影响有多大？
---

# 请对比MHA、MQA、GQA三种注意力机制的区别

> 来源：字节跳动大模型技术面试二面

## 架构图解

```
┌─────────────────────────────────────────────────────────┐
│                    MHA (Multi-Head Attention)           │
│                                                         │
│  Q:  [Q₁] [Q₂] [Q₃] [Q₄] [Q₅] [Q₆] [Q₇] [Q₈]        │
│  K:  [K₁] [K₂] [K₃] [K₄] [K₅] [K₆] [K₇] [K₈]        │
│  V:  [V₁] [V₂] [V₃] [V₄] [V₅] [V₆] [V₇] [V₈]        │
│       ↓     ↓     ↓     ↓     ↓     ↓     ↓     ↓       │
│     head₁  head₂ head₃ head₄ head₅ head₆ head₇ head₈  │
│                                                         │
│  特点: 每个头独立K/V → KV Cache = 2 × N_heads × d × L   │
└─────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────┐
│                    MQA (Multi-Query Attention)          │
│                                                         │
│  Q:  [Q₁] [Q₂] [Q₃] [Q₄] [Q₅] [Q₆] [Q₇] [Q₈]        │
│  K:  [────────── K_shared ──────────]                   │
│  V:  [────────── V_shared ──────────]                   │
│       ↓     ↓     ↓     ↓     ↓     ↓     ↓     ↓       │
│              全部头共享同一组K/V                         │
│                                                         │
│  特点: 所有头共享1组K/V → KV Cache = 2 × 1 × d × L     │
└─────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────┐
│                    GQA (Grouped-Query Attention)        │
│                                                         │
│  Q:  [Q₁] [Q₂] [Q₃] [Q₄] [Q₅] [Q₆] [Q₇] [Q₈]        │
│  K:  [K_A] [K_A] [K_B] [K_B] [K_C] [K_C] [K_D] [K_D]  │
│  V:  [V_A] [V_A] [V_B] [V_B] [V_C] [V_C] [V_D] [V_D]  │
│       ↓     ↓     ↓     ↓     ↓     ↓     ↓     ↓       │
│     grp₁──────  grp₂──────  grp₃──────  grp₄──────     │
│                                                         │
│  特点: G组K/V，每组服务N/G个Q头                          │
│  KV Cache = 2 × G × d × L                              │
└─────────────────────────────────────────────────────────┘
```

## Trade-off 对比

| 维度 | MHA | GQA (G=8) | MQA |
|------|-----|-----------|-----|
| KV头数 | N (如32) | G (如8) | 1 |
| KV Cache大小 | 1× (基准) | ~1/4 | ~1/32 |
| 推理速度 | 慢 | 快 | 最快 |
| 模型效果 | **最好** | **接近MHA** | 明显下降 |
| 显存占用 | 最高 | 低 | 最低 |
| 代表模型 | GPT-3, BERT | LLaMA-2-70B | PaLM, Falcon |

### KV Cache 影响量化

以 LLaMA-2-70B 为例（80层, 64头, d=128, 序列长度4096）：

```
MHA:  KV Cache = 2 × 80 × 64 × 128 × 4096 × 2(fp16) ≈ 21 GB
GQA:  KV Cache = 2 × 80 ×  8 × 128 × 4096 × 2(fp16) ≈ 2.6 GB  (↓87%)
MQA:  KV Cache = 2 × 80 ×  1 × 128 × 4096 × 2(fp16) ≈ 0.33 GB (↓98%)
```

**在长序列推理场景（如32K context），KV Cache差异可达数十GB**，直接决定能否在单卡上运行。

## 代码实现对比

```python
import torch
import torch.nn as nn

class MultiHeadAttention(nn.Module):
    """标准MHA: N个独立的Q/K/V头"""
    def __init__(self, d_model, n_heads):
        super().__init__()
        self.n_heads = n_heads
        self.d_k = d_model // n_heads
        self.W_q = nn.Linear(d_model, d_model)  # d_model = n_heads × d_k
        self.W_k = nn.Linear(d_model, d_model)
        self.W_v = nn.Linear(d_model, d_model)

class GroupedQueryAttention(nn.Module):
    """GQA: N个Q头, G组K/V (G ≤ N)"""
    def __init__(self, d_model, n_heads, n_kv_heads):
        super().__init__()
        self.n_heads = n_heads          # Q头数 (如32)
        self.n_kv_heads = n_kv_heads    # K/V头数 (如8)
        self.n_rep = n_heads // n_kv_heads  # 每组K/V服务的Q头数 (如4)
        self.d_k = d_model // n_heads
        
        # Q投影: 输出 n_heads × d_k
        self.W_q = nn.Linear(d_model, n_heads * self.d_k)
        # K/V投影: 只输出 n_kv_heads × d_k (参数量更少!)
        self.W_k = nn.Linear(d_model, n_kv_heads * self.d_k)
        self.W_v = nn.Linear(d_model, n_kv_heads * self.d_k)
    
    def forward(self, x):
        B, L, _ = x.shape
        q = self.W_q(x).view(B, L, self.n_heads, self.d_k)
        k = self.W_k(x).view(B, L, self.n_kv_heads, self.d_k)
        v = self.W_v(x).view(B, L, self.n_kv_heads, self.d_k)
        
        # ★ 关键: 将K/V重复扩展到与Q相同的头数
        k = k.repeat_interleave(self.n_rep, dim=1)  # (B, L, n_heads, d_k)
        v = v.repeat_interleave(self.n_rep, dim=1)
        
        # 后续attention计算与MHA相同
        scores = torch.matmul(q, k.transpose(-2, -1)) / (self.d_k ** 0.5)
        # ... softmax, matmul with V
```

## 为什么GQA效果接近MHA？

**关键洞察**：不同注意力头的K/V投影矩阵存在高度相似性。研究表明，MHA中约60-80%的头的K/V表示是冗余的。GQA通过分组共享，恰好去除了这些冗余，同时保持了Query端的多样性。

```
MHA头间K/V相似度矩阵 (LLaMA-2实验):
     H1   H2   H3   H4   H5   H6
H1 [ 1.0  0.82 0.79 0.31 0.28 0.25 ]
H2 [ 0.82 1.0  0.85 0.33 0.30 0.27 ]  ← H1-H3高度相似
H3 [ 0.79 0.85 1.0  0.35 0.29 0.26 ]  ← 可合并为同一组
H4 [ 0.31 0.33 0.35 1.0  0.80 0.78 ]  ← H4-H6高度相似
H5 [ 0.28 0.30 0.29 0.80 1.0  0.82 ]  ← 可合并为同一组
```

## 实际应用选择

| 场景 | 推荐方案 | 原因 |
|------|---------|------|
| 追求最高精度 | MHA | 效果上限最高 |
| 通用大模型 | GQA (G=N/4) | 性价比最优，LLaMA/Qwen/DeepSeek均采用 |
| 极致推理速度 | MQA | KV Cache最小，适合边缘部署 |
| 长文本(32K+) | GQA (G=N/8) | KV Cache节省至关重要 |

**面试加分点**：提到LLaMA-2 70B使用GQA(num_kv_heads=8)而7B/13B仍用MHA；提到vLLM和TensorRT-LLM对GQA做了专门优化；提到GQA是当前开源大模型的事实标准（LLaMA-3、Qwen-2、Mistral、DeepSeek-V2等全部采用）。
