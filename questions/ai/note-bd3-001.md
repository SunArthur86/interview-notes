---
id: note-bd3-001
difficulty: L4
category: ai
subcategory: LLM
tags:
- 字节跳动
- 面经
- 二面
feynman:
  essence: Decoder-only通过因果掩码实现自回归语言建模，每个token都参与梯度计算，训练效率最高
  analogy: 就像写作文：Encoder-Decoder像先列提纲再写正文（两阶段），Decoder-only像边想边写一气呵成（单阶段），后者更自然也更高效
  first_principle: 语言建模的本质是预测下一个token，Decoder-only架构天然适配这一目标，无需额外编码阶段
  key_points:
  - 训练效率：因果掩码让序列中每个位置都参与loss计算，样本利用率100%
  - 生成能力：自回归解码天然适配文本生成任务
  - Scaling Law验证：GPT系列实证表明Decoder-only在同等参数下效果最优
first_principle:
  essence: 语言模型的核心目标是在给定前文的条件下预测下一个token，即建模P(x_t|x_{<t})
  derivation: 从最大似然估计出发，训练目标是对数似然之和。Decoder-only的因果掩码让所有位置的token都能同时参与训练，不存在Encoder中被mask掉的token浪费
  conclusion: Decoder-only在训练效率、生成能力和扩展性三个维度上全面优于其他架构
follow_up:
- Encoder-only架构（如BERT）在哪些场景仍然有优势？
- 为什么Encoder-Decoder架构在机器翻译任务中仍然被使用？
- Prefix-LM和Causal-LM有什么区别？
memory_points:
- 训练效率最高：Decoder做CLM是100%预测利用率，而Encoder的MLM仅15%参与Loss计算。
- 生成能力最强：因果自回归天然契合next-token prediction，直接支持Few-shot。
- Scaling Law最优：随参数规模扩大，性能提升曲线最平滑，理解能力可通过规模弥补。
---

# 为什么当前主流生成式大模型几乎都采用Decoder-only架构？

> 来源：字节跳动大模型技术面试二面

## 三个角度分析

### 1. 训练效率

```
┌─────────────────────────────────────────────────┐
│           三种架构的Token利用率对比              │
├──────────────┬──────────┬──────────┬────────────┤
│    架构       │ 训练方式 │ 参与loss  │ 利用率     │
├──────────────┼──────────┼──────────┼────────────┤
│ Encoder-only │ MLM(15%) │ ~15%     │  ❌ 低     │
│ Enc-Dec      │ Denoising│ ~50%     │  ⚠️ 中    │
│ Decoder-only │ CLM(100%)│ 100%     │  ✅ 最高   │
└──────────────┴──────────┴──────────┴────────────┘
```

**Encoder-only（BERT）** 使用Masked Language Modeling，只mask掉约15%的token参与预测，其余85%的token不直接贡献loss。这意味着同样算力下，有效训练信号只有Decoder-only的约1/7。

**Encoder-Decoder（T5）** 使用Span Corruption，随机mask连续片段让Decoder恢复。虽然比BERT好，但Encoder部分的表示学习仍然是辅助任务，训练信号密度低于纯Decoder。

**Decoder-only（GPT）** 使用Causal Language Modeling，序列中每个位置都预测下一个token：

```
输入:  [BOS]  我   爱   编   程
预测:    我    爱   编   程   [EOS]
loss:   ✓     ✓    ✓    ✓    ✓     ← 每个位置都有梯度信号！
```

通过因果掩码（Causal Mask），一个长度为N的序列产生N个训练样本，**零浪费**。

### 2. 生成能力

Decoder-only架构通过自回归方式逐token生成：

```
Step 1: [Prompt] → 模型 → 预测token_1
Step 2: [Prompt + token_1] → 模型 → 预测token_2  
Step 3: [Prompt + token_1 + token_2] → 模型 → 预测token_3
...
```

这种**next-token prediction**范式具有天然的生成能力。而Encoder-only架构（如BERT）通过双向注意力理解上下文，擅长理解类任务（分类、NER），但不擅长开放式生成。Encoder-Decoder虽然能生成，但需要先编码再解码，推理时存在两次前向传播的开销。

### 3. 上下文理解与Scaling

GPT-3的论文和后续的Scaling Law研究表明，Decoder-only架构在参数规模扩大时表现出最平滑的性能提升曲线：

```
性能
 ↑        Decoder-only ────── (最优scaling)
 │       /
 │      /  Encoder-Decoder ── 
 │     /
 │    /
 │   / Encoder-only ──── (快速饱和)
 │  /
 └──────────────────────→ 参数规模(log)
```

**Zero-shot/Few-shot能力**：Decoder-only架构可以通过Prompt直接适配各种任务，无需微调。这种in-context learning能力在GPT-3之后被广泛验证，是Encoder-only架构无法实现的。

## 工程实现细节

Decoder-only的核心是因果自注意力：

```python
import torch
import torch.nn.functional as F

def causal_self_attention(Q, K, V):
    """
    Q, K, V: (batch, seq_len, d_model)
    """
    d_k = Q.size(-1)
    scores = torch.matmul(Q, K.transpose(-2, -1)) / (d_k ** 0.5)
    
    # 因果掩码：上三角为-inf，防止"偷看"未来token
    seq_len = Q.size(1)
    mask = torch.triu(torch.ones(seq_len, seq_len), diagonal=1).bool()
    scores = scores.masked_fill(mask, float('-inf'))
    
    attn = F.softmax(scores, dim=-1)
    return torch.matmul(attn, V)
```

## 总结对比

| 维度 | Encoder-only | Encoder-Decoder | Decoder-only |
|------|-------------|-----------------|--------------|
| 训练效率 | 低(15%token) | 中(~50%) | **高(100%)** |
| 生成能力 | 弱 | 中 | **强** |
| 理解能力 | **强** | 中 | 中→强(规模补偿) |
| Few-shot | 不支持 | 弱 | **强** |
| 推理速度 | 快 | 慢(双阶段) | 中(KV Cache) |
| Scaling效果 | 早饱和 | 中 | **最优** |

**面试加分点**：提到GPT-4技术报告确认使用Decoder-only；提到LLaMA、Qwen、DeepSeek等主流开源模型全部采用Decoder-only；提到Prefix-LM（如GLM）作为Decoder-only的变体，在理解+生成混合任务上的折中方案。

## 记忆要点

- 训练效率最高：Decoder做CLM是100%预测利用率，而Encoder的MLM仅15%参与Loss计算。
- 生成能力最强：因果自回归天然契合next-token prediction，直接支持Few-shot。
- Scaling Law最优：随参数规模扩大，性能提升曲线最平滑，理解能力可通过规模弥补。

