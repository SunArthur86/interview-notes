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

## 苏格拉底式面试追问

> 这组追问模拟面试官层层逼问，每一问先回答"为什么"，再回答"怎么做"，最后回答"如何证明"。

### 第一层：目标与动机

**Q：主流大模型（GPT/Llama）都用 Decoder-only，不用 Encoder-Decoder（如 T5）。为什么 Decoder-only 训练效率最高？**

训练效率看"token 利用率"。Decoder-only 做 Causal Language Modeling（CLM），每个 token 都参与预测下一个 token（如"今天天气真好"里"今天"预测"天气"、"天气"预测"真好"），100% 的 token 都算 loss，训练信号密集。Encoder 做 Masked Language Modeling（MLM，如 BERT），随机 mask 15% 的 token 让模型预测，只有 15% 的 token 参与 loss，85% 的 token 是"上下文"不算 loss，训练信号稀疏（同样的数据，Encoder 学到的有效信号是 Decoder 的 1/6）。Encoder-Decoder（如 T5）虽然有 target 侧的 100% 利用率，但 Encoder 侧仍浪费，且架构复杂（两套 attention），参数效率低。Decoder-only 用最简架构（一套 causal attention）榨干每个 token 的训练信号，Scaling Law 最优。

### 第二层：证据与定位

**Q：你训了一个 Decoder-only 模型，loss 下降正常但生成质量差（如重复、不连贯）。你怎么定位是训练数据问题、架构问题、还是超参问题？**

三步定位。一是看生成 bad case 的模式——如果是"重复"（如"我想想去去去"），多是 decoding 策略问题（temperature 太低/重复 penalty 没加）或模型没学好长程依赖（attention 覆盖不够）；如果是"不连贯"（逻辑断裂），可能是训练数据质量差（噪声多）或模型容量不足（太小）。二是看训练曲线——loss 是否正常收敛（如果 loss 卡住不降，是学习率/优化器问题；如果 loss 正常但 eval loss 涨，是过拟合）。三是对比 baseline——用相同数据训一个已知好用的架构（如 Llama），如果 baseline 也差，是数据问题；如果 baseline 好而你的差，是架构/超参问题。关键看 eval loss（在高质量验证集上），eval loss 低但生成差说明"评估指标和生成质量不相关"（loss 衡量的是 perplexity，不直接反映连贯性）。

### 第三层：根因深挖

**Q：Decoder-only 的 causal mask 让每个 token 只看前面的 token（不能看后面）。这对生成没影响吗？双向上下文不比单向好？**

双向确实信息更全，但单向（causal）和生成任务天然契合。生成时模型只能看到已生成的内容（前面的 token），看不到未来（后面的 token 还没生成），causal mask 正好模拟了这个约束，训练和推理一致。Encoder 的双向 attention 在"理解"任务（如分类、NER）上有优势（能看到全句），但生成任务用 Encoder-Decoder 时，Encoder 编码完整输入、Decoder 自回归生成，两套机制复杂。Decoder-only 的洞察是"生成任务天然是单向的，单向模型足够"——虽然单向信息少于双向，但通过 Scaling Law（堆参数和数据），单向模型的理解能力能逼近双向，且架构更简、训练更高效。实验证明（GPT-3/Llama），Decoder-only 在 few-shot 理解任务上不输 Encoder-Decoder，统一了"理解 + 生成"。

**Q：那为什么不用 Prefix-LM（前缀部分双向，生成部分单向，如 GLM），既有双向理解又有单向生成？**

Prefix-LM 理论上"两全其美"但工程复杂且收益不显著。Prefix-LM 在前缀部分用双向 attention（如输入"翻译这句话："），生成部分用 causal mask（如输出生成的译文），需要在 attention mask 上区分"前缀区"和"生成区"，实现复杂。且实验显示 Prefix-LM（如 GLM）的性能提升不显著（相比纯 Decoder-only 在 benchmark 上差 1-3%，但架构复杂度增加），Scaling Law 的收益（堆参数）远大于架构微调。工业界选择"最简架构 + 堆规模"（Decoder-only + 大数据大参数），而非"复杂架构 + 小规模"（Prefix-LM）。GPT/Llama 的成功证明了 Decoder-only 足够，Prefix-LM 的额外复杂度不值得。

### 第四层：方案权衡

**Q：Decoder-only 你说 Scaling Law 最优。但训练大模型极贵（如 Llama-2-70B 训练成本百万美元级）。为什么不直接用 Encoder-Decoder（参数效率高，用小模型达到同样效果）？**

Encoder-Decoder 的"参数效率"优势在小规模显著，大规模被 Decoder-only 的 Scaling Law 追平。小模型（<1B）时，Encoder-Decoder 的双向理解确实比 Decoder-only 强（同样参数下 T5 > GPT）；但规模上去（>10B），Decoder-only 的性能提升曲线更平滑（继续加参数持续提升），而 Encoder-Decoder 提升饱和（架构限制）。所以"要么用小规模 Encoder-Decoder 省钱，要么用大规模 Decoder-only 榨性能"。工业界的 LLM 路线是"一次性投入训大模型，长期复用"——Llama-2-70B 虽然训练贵，但训完后所有人都能用（开源），边际成本为零。且 Decoder-only 架构简单，推理优化（KV Cache、PagedAttention）更成熟，部署成本低。综合看，大规模 Decoder-only 的"训练贵但推理便宜 + 性能强"比小规模 Encoder-Decoder 更划算。

**Q：为什么不直接用现成的开源 Decoder-only 模型（如 Llama），省得自己从头训？**

从头训模型只在特定场景值得。大多数场景用开源模型（Llama/Qwen）+ 微调（SFT/LoRA）足够，成本低。从头训的场景：一是数据敏感（如金融、医疗的私有数据不能外泄给开源模型厂商）；二是领域极特殊（如代码、生物，通用开源模型效果差，需要领域数据从头训）；三是极致性能（如追求 SOTA，开源模型不够）。其他场景用开源模型 + 微调更经济。选型看"成本收益"——微调成本是从头训的 1/100，性能能达到 80-90%，大多数业务够用。只有当"开源模型 + 微调"的性能不达标且无法通过 prompt 工程弥补时，才考虑从头训。

### 第五层：验证与沉淀

**Q：你怎么证明 Decoder-only 是对的选型，而不是 Encoder-Decoder？**

做"架构对比实验"。在相同数据集和相同参数量（如 1B）下，训 Decoder-only（CLM）vs Encoder-Decoder（T5-style）vs Prefix-LM，在统一 benchmark（如 MMLU + 生成任务）上对比。预期：小规模（1B）Encoder-Decoder 在理解任务上略优，大规模（7B+）Decoder-only 追平或超越。验证"Scaling Law 优势"——从 1B 到 7B 到 70B，Decoder-only 的性能提升曲线是否平滑且持续。同时看推理效率——Decoder-only 的 KV Cache 优化是否让推理吞吐高于 Encoder-Decoder。综合"性能 + 推理效率 + 架构简洁度"判断。如果业务是"纯理解"（如分类），Encoder-Decoder 可能够用；如果是"理解 + 生成"，Decoder-only 更通用。

**Q：模型架构选型怎么沉淀成团队决策规范？**

固化成"架构选型决策树"：场景是"纯理解"（分类/抽取）→ 小规模 Encoder 或 Encoder-Decoder（BERT/T5-small）；场景是"理解 + 生成"（对话/写作）→ Decoder-only（Llama/Qwen）；场景是"领域特殊"（代码/生物）→ 领域数据从头训 Decoder-only；其他 → 开源 Decoder-only + 微调。沉淀"各架构的性能/成本对照表"（参数量、训练成本、推理延迟、benchmark 分数）、"Scaling Law 的拐点经验"（1B 以下 Encoder-Decoder 优、7B 以上 Decoder-only 优）。把"Decoder-only 为默认，特殊场景选其他"作为团队共识，避免每次重复论证。

## 结构化回答

**30 秒电梯演讲：** Decoder-only通过因果掩码实现自回归语言建模，每个token都参与梯度计算，训练效率最高——就像写作文。

**展开框架：**
1. **训练效率** — 因果掩码让序列中每个位置都参与loss计算，样本利用率100%
2. **生成能力** — 自回归解码天然适配文本生成任务
3. **Scaling Law验证** — GPT系列实证表明Decoder-only在同等参数下效果最优

**收尾：** 您想深入聊：Encoder-only架构（如BERT）在哪些场景仍然有优势？


## 视频脚本

> 预计时长：5 分钟 | 由浅入深


| 时间 | 画面/字幕 | 口播台词 | 讲解要点 |
|------|----------|----------|----------|
| 0:00 | 标题卡：为什么当前主流生成式大模型几乎都采用… | "就像写作文：Encoder-Decoder像先列提纲再写正文（两阶段），Decoder…" | 开场钩子 |
| 0:20 | 核心概念图 | "Decoder-only通过因果掩码实现自回归语言建模，每个token都参与梯度计算，训练效率最高" | 核心定义 |
| 0:50 | 训练效率示意图 | "训练效率——因果掩码让序列中每个位置都参与loss计算，样本利用率100%" | 要点拆解1 |
| 1:30 | 生成能力示意图 | "生成能力——自回归解码天然适配文本生成任务" | 要点拆解2 |
| 2:20 | 对比/实战案例图 | "对比一下常见误区和工程实践，看真实场景里怎么取舍。" | 实战与对比 |
| 3:10 | 总结卡 | "记住核心要点。下期我们追问：Encoder-only架构（如BERT）在哪些场景仍然有优？" | 收尾与钩子 |
