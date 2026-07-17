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
  essence: 投机解码用一个小的draft模型快速生成候选token，再用大target模型并行验证，把自回归的串行过程变成并行验证，实现2-3倍加速
  analogy: 写文章时先用AI生成初稿(draft模型快)，再人工审核修改(target模型准)——比逐字手写快得多，质量有保证
  first_principle: 大模型推理慢是因为自回归(逐token生成)，如果能预判多个token再批量验证，就能把串行变并行
  key_points:
  - 'Draft模型: 小模型，快速生成k个候选token'
  - 'Target模型: 大模型，并行验证k个token'
  - '接受规则: 拒绝采样，保证输出分布与target模型完全一致'
  - '加速比: 2-3x，取决于draft模型准确率和k值'
first_principle:
  essence: 自回归生成的瓶颈是每步只产生1个token，投机解码通过预判+验证实现每步产生多个token
  derivation: '大模型逐token生成慢 → 小模型生成快但不够准 → 用小模型预判k个token → 大模型并行验证 → 接受正确的、拒绝错误的 → 净效果: 多token并行验证'
  conclusion: 投机解码是一种无损加速方法，输出分布与纯大模型完全一致
follow_up:
- Draft模型怎么选？一定要小模型吗？
- k值(投机长度)怎么确定最优？
- Medusa/EAGLE和普通投机解码有什么区别？
memory_points:
- 一句话原理：小模型串行快速猜Draft，大模型一次并行验Target，以时间换吞吐。
- 无损加速机制：基于拒绝采样（接受率=min(1, 目标概率/草稿概率)），绝不损失大模型生成质量。
- 因为大模型解码是计算密集的串行访存，所以投机解码能把多次串行转化为一次并行验证。
- 速度关键：草稿模型必须极小且与目标模型分布相近，猜对率越高，加速比越大。
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

## 记忆要点

- 一句话原理：小模型串行快速猜Draft，大模型一次并行验Target，以时间换吞吐。
- 无损加速机制：基于拒绝采样（接受率=min(1, 目标概率/草稿概率)），绝不损失大模型生成质量。
- 因为大模型解码是计算密集的串行访存，所以投机解码能把多次串行转化为一次并行验证。
- 速度关键：草稿模型必须极小且与目标模型分布相近，猜对率越高，加速比越大。


## 苏格拉底式面试追问

> 这组追问模拟面试官层层逼问，每一问先回答"为什么"，再回答"怎么做"，最后回答"如何证明"。

### 第一层：目标与动机

**Q：投机解码为什么能做到无损加速？无损的前提是什么？**

无损的前提是"draft 模型输出的 token 分布是 target 模型的真子集"。验证阶段 target 模型并行计算所有 draft token 的概率分布，接受概率 >= target 分布的 token，对第一个分歧点做拒绝采样。数学上，只要验证时的接受/拒绝采样遵循 target 模型的分布，最终输出的分布和 target 模型自回归完全一致。无损性来自拒绝采样的正确性，不是近似。前提是 draft 模型不能太差（accept rate 至少 > 50%）才有加速收益。

### 第二层：证据与定位

**Q：线上开了投机解码但吞吐反而下降了，怎么定位是 draft 模型选错了还是 batch 策略的问题？**

看两个核心指标：1) accept_rate（draft token 被接受的比例）——如果 < 30%，说明 draft 模型和 target 模型分布差异太大，加速无效；2) draft_length（每次生成的候选长度）——如果固定在 2-3 但接受率低，说明 draft 模型只在前几个 token 准。对比 batch 策略：关掉投机解码用纯 target 模型，在相同 QPS 下测吞吐，如果纯 target 更高，确认是 draft 模型拖累。profile 看 GPU 利用率——投机解码验证阶段 GPU 利用率应该更高，如果反而更低说明 draft 阶段空转太多。

### 第三层：根因深挖

**Q：accept_rate 只有 20%，根因是 draft 模型太小还是和 target 模型不匹配？**

要看 draft 模型和 target 模型的"分布相似度"。1) 如果 draft 是 1B、target 是 70B，分布差异大是必然的，根因是模型规模差距；2) 如果 draft 和 target 同架构但训练数据不同，根因是数据分布不匹配。验证方法：取 1000 条 prompt，分别用 draft 和 target 生成下一个 token 的概率分布，算 KL 散度——KL 散度大说明分布差异大。解法：draft 模型最好从 target 模型蒸馏而来，而不是独立训练。

**Q：既然要从 target 蒸馏 draft，为什么不直接用 target 模型自己当 draft（用 Medusa 头）？**

这正是 Medusa 的思路——在 target 模型上加多个预测头，分别预测未来第 1、2、3 个 token，避免维护独立 draft 模型。好处是分布天然一致（同一个模型权重），坏处是 target 模型要额外训练 Medusa 头（轻量但需要数据）。独立 draft 模型的好处是可以独立部署、独立扩展（draft 可以用更激进的量化），坏处是分布对齐难。选型：如果 target 模型可重新训练，用 Medusa；如果是调用第三方 API 模型只能外挂 draft，用投机解码。

### 第四层：方案权衡

**Q：投机解码的加速比通常是 2-3x，但 draft 模型本身也要算力，这个收益在什么场景会被吃掉？**

在"高并发 batch 推理"场景会被吃掉。投机解码的本质是用 draft 的串行生成换 target 的并行验证，batch=1 时收益最大（target 的并行能力没被充分利用）。但当 batch size > 32 时，target 模型的并行能力已经被多请求填满，额外加 draft token 反而挤占 batch 空间，吞吐可能不升反降。权衡：投机解码适合低并发低延迟场景（< 8 并发），高并发场景应该用 Continuous Batching 优化吞吐，而不是投机解码。

**Q：为什么不直接用更大的 batch size 提升吞吐，而要靠投机解码？**

两者优化目标不同。大 batch 优化的是吞吐（单位时间处理的 token 数），但会增加单请求延迟（每个请求要等 batch 凑齐）；投机解码优化的是单请求延迟（一个请求自己就能并行验证多个 token）。对交互式 Agent（用户等待回复），延迟比吞吐重要，投机解码更合适；对离线批量生成（没人等），吞吐优先，大 batch 更合适。两者不是互斥，但实现上有冲突（投机解码要求小 batch 才有收益）。

### 第五层：验证与沉淀

**Q：怎么证明投机解码真的无损——不能只看延迟下降，怎么验证输出分布一致？**

两个验证：1) 确定性验证——固定 temperature=0，用投机解码和纯 target 模型分别生成 1000 条输出，做严格字符串比对，应该 100% 一致；2) 概率验证——固定 temperature>0，各采样 10000 次，对比输出 token 的经验分布，做卡方检验，p-value 应该 > 0.05（无法拒绝分布一致假设）。沉淀为上线 checklist：accept_rate > 50%、无损性测试通过、延迟下降 > 1.5x，三个条件都满足才上线。

## 结构化回答

**30 秒电梯演讲：** 投机解码用一个小的draft模型快速生成候选token，再用大target模型并行验证，把自回归的串行过程变成并行验证，实现2-3倍加速。

**展开框架：**
1. **Draft模型** — 小模型，快速生成k个候选token
2. **Target模型** — 大模型，并行验证k个token
3. **接受规则** — 拒绝采样，保证输出分布与target模型完全一致

**收尾：** 您想深入聊：Draft模型怎么选？一定要小模型吗？


## 视频脚本

> 预计时长：5 分钟 | 由浅入深


| 时间 | 画面/字幕 | 口播台词 | 讲解要点 |
|------|----------|----------|----------|
| 0:00 | 标题卡：什么是投机解码(Speculative… | "写文章时先用AI生成初稿(draft模型快)，再人工审核修改(target模型准)——比逐…" | 开场钩子 |
| 0:20 | 核心概念图 | "投机解码用一个小的draft模型快速生成候选token，再用大target模型并行验证，把自回归的串行过程变成并行验证…" | 核心定义 |
| 0:50 | Draft模型示意图 | "Draft模型——小模型，快速生成k个候选token" | 要点拆解1 |
| 1:30 | Target模型示意图 | "Target模型——大模型，并行验证k个token" | 要点拆解2 |
| 2:20 | 对比/实战案例图 | "对比一下常见误区和工程实践，看真实场景里怎么取舍。" | 实战与对比 |
| 3:10 | 总结卡 | "记住核心要点。下期我们追问：Draft模型怎么选？一定要小模型吗？" | 收尾与钩子 |
