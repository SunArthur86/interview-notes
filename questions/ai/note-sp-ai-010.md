---
id: note-sp-ai-010
difficulty: L2
category: ai
subcategory: LLM
tags:
  - Shopee
  - 面经
  - Transformer
feynman:
  essence: Transformer是纯注意力机制的编码器-解码器架构，抛弃了RNN
  analogy: 'Encoder像阅读理解——通读全文做笔记。Decoder像写作文——看着笔记一个字一个字写出来'
  first_principle: '自注意力让每个词看到全句上下文，比RNN的顺序处理更高效且能并行'
  key_points:
    - Encoder读完整输入，每个词融合全句上下文
    - Decoder逐词自回归生成，多一层交叉注意力
    - 每层结构：自注意力+前馈+残差+LayerNorm
    - N层堆叠（原论文N=6）
first_principle:
  essence: '用注意力机制替代RNN的递归——O(1)路径长度让任意两词直接交互，且可并行计算'
  derivation: 'RNN→O(n)路径长度→远距离信息衰减。注意力→O(1)路径→任意距离直接交互。代价是O(n²)计算量'
  conclusion: Transformer用自注意力实现全局感受野，并行计算解决RNN的训练瓶颈
follow_up:
  - '为什么Encoder可以并行而Decoder不能？'
  - 'Pre-LN和Post-LN有什么区别？'
  - 'Decoder-only和Encoder-only分别适合什么任务？'
---

# Transformer的整体结构是怎样的？Encoder和Decoder分别做什么？

## 整体架构

```
                    输入序列                    输出序列(已生成)
                       │                            │
                       ▼                            ▼
              ┌────────────────┐          ┌────────────────┐
              │   Embedding    │          │   Embedding    │
              │   + 位置编码    │          │   + 位置编码    │
              └───────┬────────┘          └───────┬────────┘
                      │                           │
                      ▼                           ▼
              ┌──────────────────┐      ┌──────────────────┐
              │     Encoder      │      │     Decoder      │
              │  ┌────────────┐  │      │  ┌────────────┐  │
              │  │ Self-Attn  │  │      │  │Masked       │  │
              │  │ (看全句)    │  │      │  │Self-Attn   │  │
              │  └──────┬─────┘  │      │  │(只看前面)   │  │
              │         ▼        │      │  └──────┬─────┘  │
              │  ┌────────────┐  │      │         ▼        │
              │  │ Feed-Forward│  │      │  ┌────────────┐  │
              │  │ +残差+LN   │  │      │  │Cross-Attn  │  │
              │  └────────────┘  │      │  │(看Encoder) │  │
              │  × N层(6层)     │      │  └──────┬─────┘  │
              └────────┬─────────┘      │         ▼        │
                       │                │  ┌────────────┐  │
                       └───────────────→│  │Feed-Forward│  │
                                        │  │ +残差+LN   │  │
                                        │  └──────┬─────┘  │
                                        │  × N层(6层)     │
                                        └────────┬─────────┘
                                                 ▼
                                        ┌────────────────┐
                                        │  Linear+Softmax│
                                        │  →输出概率分布   │
                                        └────────────────┘
```

## Encoder详解

**职责**：读完整输入序列，每个词融合全句上下文信息

```python
class EncoderLayer(nn.Module):
    def __init__(self, d_model=512, nhead=8, d_ff=2048):
        super().__init__()
        self.self_attn = MultiHeadAttention(d_model, nhead)
        self.ffn = FeedForward(d_model, d_ff)
        self.norm1 = nn.LayerNorm(d_model)
        self.norm2 = nn.LayerNorm(d_model)
    
    def forward(self, x):
        # 1. 多头自注意力（每个词看全句）
        attn_out = self.self_attn(x, x, x)  # Q=K=V=x
        x = self.norm1(x + attn_out)  # 残差+LayerNorm
        
        # 2. 前馈网络（每个位置独立变换）
        ffn_out = self.ffn(x)
        x = self.norm2(x + ffn_out)  # 残差+LayerNorm
        
        return x
```

**关键特点**：
- 自注意力：每个词可以看到所有其他词（双向）
- 并行计算：所有位置同时处理
- N层堆叠：低层学语法，高层学语义

## Decoder详解

**职责**：逐词自回归生成，通过交叉注意力参考Encoder输出

```python
class DecoderLayer(nn.Module):
    def __init__(self, d_model=512, nhead=8, d_ff=2048):
        super().__init__()
        self.masked_self_attn = MultiHeadAttention(d_model, nhead)
        self.cross_attn = MultiHeadAttention(d_model, nhead)
        self.ffn = FeedForward(d_model, d_ff)
        self.norm1 = nn.LayerNorm(d_model)
        self.norm2 = nn.LayerNorm(d_model)
        self.norm3 = nn.LayerNorm(d_model)
    
    def forward(self, x, encoder_output):
        # 1. Masked自注意力（只看当前位置及之前）
        attn_out = self.masked_self_attn(x, x, x, mask=causal_mask)
        x = self.norm1(x + attn_out)
        
        # 2. 交叉注意力（Q来自Decoder，K=V来自Encoder）
        cross_out = self.cross_attn(
            query=x,           # Q: Decoder当前状态
            key=encoder_output,  # K: Encoder输出
            value=encoder_output  # V: Encoder输出
        )
        x = self.norm2(x + cross_out)
        
        # 3. 前馈网络
        ffn_out = self.ffn(x)
        x = self.norm3(x + ffn_out)
        
        return x
```

**关键特点**：
- Masked自注意力：防止看到未来的词（自回归）
- 交叉注意力：Decoder的Query去查Encoder的Key和Value
- 逐词生成：每次生成一个token，然后作为下一步输入

## Encoder vs Decoder对比

| 维度 | Encoder | Decoder |
|------|---------|---------|
| **注意力** | 双向(看全句) | 单向(只看前面) + 交叉(看Encoder) |
| **并行性** | 全并行 | 训练时并行(teacher forcing)，推理时逐词 |
| **输出** | 上下文表示 | 生成概率分布 |
| **层数** | N层(原论文6层) | N层(原论文6层) |
| **角色** | 理解输入 | 生成输出 |

## 架构变体

```
┌──────────────┬──────────────────┬─────────────────┐
│ Encoder-only │ Encoder-Decoder  │ Decoder-only    │
├──────────────┼──────────────────┼─────────────────┤
│ BERT         │ T5, BART         │ GPT, LLaMA, Qwen│
│ 理解任务     │ 翻译/摘要        │ 生成任务         │
│ 双向注意力   │ 交叉注意力       │ 单向注意力       │
│ 适合分类/NER │ 适合seq2seq      │ 适合对话/创作    │
└──────────────┴──────────────────┴─────────────────┘

当前主流大模型(LLaMA/Qwen/GPT)都是Decoder-only架构
```

## 面试加分点

1. **三层结构**：Encoder=自注意力+FFN+残差，Decoder多一层交叉注意力
2. **Mask的作用**：Decoder的causal mask防止"偷看"未来词
3. **为什么Decoder-only成为主流**：统一架构、scaling简单、零样本能力强
4. **训练vs推理**：训练时teacher forcing可并行，推理时逐词自回归
