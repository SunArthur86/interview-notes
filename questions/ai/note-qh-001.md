---
id: note-qh-001
difficulty: L4
category: ai
subcategory: 推理优化
tags:
  - 群核
  - 面经
  - 推理加速
  - Speculative Decoding
feynman:
  essence: "投机解码用一个小的draft模型快速生成候选token，再用大target模型并行验证，把自回归的串行过程变成并行验证，实现2-3倍加速"
  analogy: "写文章时先用AI生成初稿(draft模型快)，再人工审核修改(target模型准)——比逐字手写快得多，质量有保证"
  first_principle: "大模型推理慢是因为自回归(逐token生成)，如果能预判多个token再批量验证，就能把串行变并行"
  key_points:
    - 'Draft模型: 小模型，快速生成k个候选token'
    - 'Target模型: 大模型，并行验证k个token'
    - '接受规则: 拒绝采样，保证输出分布与target模型完全一致'
    - '加速比: 2-3x，取决于draft模型准确率和k值'
first_principle:
  essence: "自回归生成的瓶颈是每步只产生1个token，投机解码通过预判+验证实现每步产生多个token"
  derivation: "大模型逐token生成慢 → 小模型生成快但不够准 → 用小模型预判k个token → 大模型并行验证 → 接受正确的、拒绝错误的 → 净效果: 多token并行验证"
  conclusion: "投机解码是一种无损加速方法，输出分布与纯大模型完全一致"
follow_up:
  - "Draft模型怎么选？一定要小模型吗？"
  - "k值(投机长度)怎么确定最优？"
  - "Medusa/EAGLE和普通投机解码有什么区别？"
---

# 什么是投机解码(Speculative Decoding)？

## 核心原理

```
传统自回归解码 (串行, 慢):
  Token1 → Token2 → Token3 → Token4 → ...
  每步一次大模型forward, 无法并行

投机解码 (预判+验证, 快):
  ┌─ Draft模型 ──────────┐
  │ 快速生成k个候选:       │
  │ tok1 → tok2 → tok3   │  (3步小模型forward)
  └──────────┬───────────┘
             ▼
  ┌─ Target模型 ─────────┐
  │ 并行验证k+1个位置:     │
  │ [tok1][tok2][tok3][?] │  (1步大模型forward)
  │  ✅     ✅     ❌      │
  └──────────┬───────────┘
             ▼
  接受tok1,tok2,拒绝tok3
  从tok3位置重新生成
  → 1步大模型forward产出了2个token!
```

## 接受/拒绝规则(无损保证)

```python
import torch
import torch.distributions as D

def speculative_decode(target_model, draft_model, prefix, max_new_tokens):
    generated = prefix
    k = 4  # 投机长度

    while len(generated) < max_new_tokens:
        # Step 1: Draft模型快速生成k个token
        draft_tokens = []
        draft_probs = []
        context = generated
        for _ in range(k):
            logits = draft_model(context)
            prob = D.Categorical(logits=logits[:, -1])
            token = prob.sample()
            draft_tokens.append(token)
            draft_probs.append(prob.probs)
            context = torch.cat([context, token], dim=-1)

        # Step 2: Target模型并行验证k+1个位置
        target_logits = target_model(context)  # 一次forward
        target_probs = D.Categorical(logits=target_logits[:, -(k+1):-1])

        # Step 3: 拒绝采样
        accepted = 0
        for i in range(k):
            # 接受概率 = min(1, target_prob / draft_prob)
            ratio = target_probs.probs[:, i, draft_tokens[i]] / \
                    draft_probs[i].probs[:, 0, draft_tokens[i]]
            if torch.rand(1) < ratio:
                accepted += 1  # 接受
            else:
                break  # 拒绝，停止

        # 接受的token加入结果
        generated = torch.cat([
            generated,
            *[draft_tokens[i] for i in range(accepted)]
        ])

        # 从拒绝点用target分布重新采样
        if accepted < k:
            # 残差分布: (target - draft)+ / Z
            residual = (target_probs.probs[:, accepted] -
                       draft_probs[accepted].probs[:, 0]).clamp(min=0)
            residual = residual / residual.sum()
            new_token = D.Categorical(residual).sample()
            generated = torch.cat([generated, new_token])
        else:
            # 全部接受，用target模型对最后位置采样
            last_logits = target_logits[:, -1]
            generated = torch.cat([generated, D.Categorical(logits=last_logits).sample()])

    return generated
```

## 加速比分析

```
假设:
  - Draft模型forward时间: t_d (小, ~5ms)
  - Target模型forward时间: t_t (大, ~50ms)
  - Draft准确率(每token): p (如0.7)

期望每轮接受token数: E = p + p² + p³ + ... + p^k ≈ p/(1-p) (k足够大)
  p=0.7 → E ≈ 2.3 tokens/轮

传统: 每个token需要 t_t = 50ms
投机: 每轮耗时 = k*t_d + t_t = 4*5 + 50 = 70ms, 产出E+1≈3.3个token
  → 每个≈21ms

加速比: 50/21 ≈ 2.4x
```

## 变体

### Medusa (自投机)
```
不使用独立draft模型，而是在target模型的隐藏层上
训练额外的预测头，预测后续多个token
优点: 不需要额外小模型，单模型搞定
```

### EAGLE (改进版)
```
Draft模型不直接生成token，而是预测target模型的隐藏状态
准确率更高 → 接受率更高 → 加速比更大
可达3-5x加速
```

### 投机解码 vs 其他加速方案

| 方案 | 原理 | 加速比 | 无损 |
|------|------|--------|------|
| **投机解码** | 小模型预判+大模型验证 | 2-3x | ✅ |
| **Medusa** | 多头并行预测 | 2-3x | ✅ |
| **量化** | FP16→INT8/INT4 | 2-4x | ⚠️有损 |
| **KV Cache** | 缓存历史Key/Value | 2-5x | ✅ |
| **Continuous Batching** | 动态拼batch | 5-10x | ✅ |
