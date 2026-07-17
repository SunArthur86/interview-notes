---
id: note-bd3-004
difficulty: L4
category: ai
subcategory: 微调
tags:
- 字节跳动
- 面经
- 二面
feynman:
  essence: SFT教模型"说什么"，RLHF/DPO教模型"说更好的"。DPO是RLHF的数学简化版——无需训练奖励模型，直接从偏好数据优化策略
  analogy: SFT像跟读课本（模仿标准答案），RLHF像老师打分+学生改进（先训练打分器再优化），DPO像直接给学生看好作文和差作文对比（跳过打分器一步到位）
  first_principle: 人类偏好学习的本质是让模型输出概率偏好高分回答。RLHF通过奖励模型间接实现，DPO通过数学推导发现可以直接用偏好数据计算梯度
  key_points:
  - 'SFT: 监督学习，用标准答案做交叉熵损失'
  - 'RLHF: 训练RM → PPO优化策略，流程复杂但效果好'
  - 'DPO: 直接用偏好对(pair)优化，无需RM和PPO，更稳定'
first_principle:
  essence: 人类偏好优化可以建模为最大化奖励的KL约束优化问题
  derivation: RLHF的目标是max E[r(x,y)] - β·KL(π||π_ref)。DPO的数学贡献是证明这个目标可以重写为只依赖偏好数据的闭式解，无需显式的奖励模型
  conclusion: DPO在数学上等价于RLHF的简化，但在实践中更稳定、更易实现
follow_up:
- DPO为什么在很多场景下取代PPO？
- RLHF的奖励模型如何训练？reward hacking问题怎么解决？
- KTO和ORPO等新方法与DPO有什么区别？
memory_points:
- SFT打基础：指令微调学格式，算交叉熵，是所有后训练必经的第一步。
- RLHF最复杂：训奖励模型+PPO强化学习，效果上限高但流程长、极不稳定。
- DPO最优雅：无需RM和PPO，直接用偏好对通过交叉熵优化策略，简单稳定。
---

# 详细说明SFT、RLHF和DPO三种后训练方法的核心流程、适用场景和优缺点

> 来源：字节跳动大模型技术面试二面

## 整体流程对比

```
┌─────────────────────────────────────────────────────────────┐
│                     后训练方法全景图                         │
│                                                             │
│  预训练模型                                                   │
│      │                                                      │
│      ▼                                                      │
│  ┌─────────┐                                                │
│  │   SFT   │  阶段1: 监督微调                                │
│  │ (指令对) │  输入: prompt → 标签: 高质量回答                │
│  └────┬────┘                                                │
│       │                                                     │
│       ├──→ 直接使用 (如Alpaca, Vicuna)                      │
│       │                                                     │
│       ▼                                                     │
│  ┌──────────────────────────────┐                           │
│  │        RLHF (三阶段)          │                           │
│  │  ① SFT                       │                           │
│  │  ② 训练Reward Model (RM)     │  人工标注偏好对             │
│  │  ③ PPO优化策略(最大化奖励)    │  指标: reward↑, KL↓       │
│  └──────────────────────────────┘                           │
│                                                             │
│  ┌──────────────────────────────┐                           │
│  │         DPO (两阶段)          │                           │
│  │  ① SFT                       │                           │
│  │  ② 直接偏好优化               │  人工标注偏好对             │
│  │     (跳过RM和PPO)             │  指标: chosen↑, rejected↓ │
│  └──────────────────────────────┘                           │
└─────────────────────────────────────────────────────────────┘
```

## 1. SFT (Supervised Fine-Tuning)

```python
# SFT: 标准的监督学习
loss = CrossEntropyLoss(model_output, target_tokens)

# 数据格式
{"instruction": "解释什么是RAG", "output": "RAG是检索增强生成..."}

# 计算方式: 对output部分计算交叉熵
# 只对回答部分计算loss, prompt部分不计算
```

| 维度 | 说明 |
|------|------|
| 数据需求 | 高质量指令-回答对（1K-100K条） |
| 计算成本 | 低（标准交叉熵） |
| 训练稳定性 | **最高**（梯度直接、明确） |
| 效果 | 让模型学会跟随指令，但不一定输出"最优"回答 |
| 适用场景 | 后训练的第一步，所有方法的必经阶段 |

## 2. RLHF (Reinforcement Learning from Human Feedback)

### 三阶段流程

```
阶段1: SFT                    阶段2: 训练RM               阶段3: PPO优化
┌──────────┐                 ┌──────────┐               ┌──────────┐
│ Prompt   │                 │ Prompt   │               │ Prompt   │
│    ↓     │                 │    ↓     │               │    ↓     │
│ SFT模型  │                 │ 生成2个  │               │ 当前策略π │
│    ↓     │                 │ 回答A,B  │               │    ↓     │
│ 回答     │ ────→           │    ↓     │ ────→        │ 生成回答  │
│          │                 │ 人工标注  │               │    ↓     │
│          │                 │ A > B    │               │ RM打分   │
│          │                 │    ↓     │               │    ↓     │
│          │                 │ 训练RM   │               │ PPO更新  │
└──────────┘                 └──────────┘               │ +KL惩罚  │
                                                        └──────────┘
```

### Reward Model 训练

```python
# RM训练: 偏好数据 (chosen, rejected)
# Bradley-Terry模型: P(chosen > rejected) = σ(r(chosen) - r(rejected))

def rm_loss(reward_model, chosen_rewards, rejected_rewards):
    """Reward Model的损失函数"""
    # r_chosen和r_rejected是RM输出的标量奖励值
    loss = -torch.log(
        torch.sigmoid(chosen_rewards - rejected_rewards)
    ).mean()
    return loss
```

### PPO 优化

```python
def ppo_step(policy_model, reward_model, ref_model, prompts):
    # 1. 当前策略生成回答
    responses = policy_model.generate(prompts)
    
    # 2. RM打分
    rewards = reward_model(prompts, responses)
    
    # 3. 参考模型计算KL惩罚 (防止偏离太远)
    ref_logprobs = ref_model.logprob(prompts, responses)
    policy_logprobs = policy_model.logprob(prompts, responses)
    kl_penalty = beta * (policy_logprobs - ref_logprobs).mean()
    
    # 4. 最终奖励 = RM分数 - KL惩罚
    final_reward = rewards - kl_penalty
    
    # 5. PPO clipped objective
    loss = -min(ratio * advantage, clip(ratio, 1-ε, 1+ε) * advantage)
```

| 优缺点 | 说明 |
|--------|------|
| ✅ 优点 | 效果最好，能学习细粒度偏好，ChatGPT验证有效 |
| ❌ 缺点 | 流程复杂（3阶段）、训练不稳定（PPO超参敏感）、RM可能reward hacking |
| ❌ 缺点 | 需要维护4个模型在显存中（policy, ref, reward, critic） |

## 3. DPO (Direct Preference Optimization)

### 核心数学推导

DPO的突破在于：**RLHF的优化目标可以直接用偏好数据求解，无需显式训练RM**。

```
RLHF目标:  max E[r(x,y)] - β·KL[π || π_ref]

DPO推导:  最优策略的闭式解 → r*(x,y) = β·log(π*(y|x)/π_ref(y|x)) + const

代入Bradley-Terry模型:
  P(y_w > y_l) = σ(β·log[π(y_w|x)/π_ref(y_w|x)] - β·log[π(y_l|x)/π_ref(y_l|x)])

最终DPO损失:
  L_DPO = -log σ(β·log[π(y_w|x)/π_ref(y_w|x)] - β·log[π(y_l|x)/π_ref(y_l|x)])
```

```python
def dpo_loss(policy, ref, chosen_ids, rejected_ids, beta=0.1):
    """DPO: 直接从偏好数据计算损失"""
    # 计算log概率
    policy_chosen_logps = get_logps(policy, chosen_ids)
    policy_rejected_logps = get_logps(policy, rejected_ids)
    ref_chosen_logps = get_logps(ref, chosen_ids)
    ref_rejected_logps = get_logps(ref, rejected_ids)
    
    # DPO核心公式
    chosen_ratio = policy_chosen_logps - ref_chosen_logps
    rejected_ratio = policy_rejected_logps - ref_rejected_logps
    
    logits = beta * (chosen_ratio - rejected_ratio)
    loss = -F.logsigmoid(logits).mean()
    
    return loss
```

| 维度 | DPO | RLHF |
|------|-----|------|
| 训练阶段 | 2（SFT + DPO） | 3（SFT + RM + PPO） |
| 模型数量 | 2（policy + ref） | 4（policy + ref + RM + critic） |
| 显存需求 | 低 | 高 |
| 超参敏感度 | **低** | 高（PPO的ε, clip等） |
| 训练稳定性 | **高** | 中（可能崩溃） |
| 效果上限 | 接近RLHF | 略高于DPO |

## 为什么DPO正在取代PPO？

1. **实现简单**：无需PPO的actor-critic架构，标准交叉熵式训练
2. **稳定性好**：无value function估计误差，无on-policy采样需求
3. **计算高效**：只需2个模型（policy+ref）vs RLHF的4个
4. **效果接近**：在大多数任务上DPO ≈ RLHF（差距 < 2%）
5. **开源生态**：Zephyr、Llama-3、Qwen-2等主流模型后训练均采用DPO

**面试加分点**：提到DPO的β参数控制偏离参考模型的程度；提到IPO（Identity Preference Optimization）解决DPO过拟合问题；提到KTO（Kahneman-Tversky Optimization）只需要二元反馈（好/坏）而非偏好对；提到RLHF在复杂多轮对话中仍有优势。

## 记忆要点

- SFT打基础：指令微调学格式，算交叉熵，是所有后训练必经的第一步。
- RLHF最复杂：训奖励模型+PPO强化学习，效果上限高但流程长、极不稳定。
- DPO最优雅：无需RM和PPO，直接用偏好对通过交叉熵优化策略，简单稳定。

## 苏格拉底式面试追问

> 这组追问模拟面试官层层逼问，每一问先回答"为什么"，再回答"怎么做"，最后回答"如何证明"。

### 第一层：目标与动机

**Q：对齐流程你说是"SFT → RLHF/DPO"。为什么不直接用 SFT（监督微调），省得搞复杂的 RLHF？**

SFT 教模型"说什么"（学习指令格式和基础能力），但不教"说更好的"。SFT 的数据是"指令-答案"对（如"写一首诗"→"..."），模型学的是"模仿答案"，但答案质量参差不齐（人工标注的答案不一定最优，且标注者偏好不同）。RLHF/DPO 教模型"说更好的"——用人类偏好数据（如"答案 A 比答案 B 好"）训练模型生成"人类更喜欢"的答案，优化方向是"偏好"而非"模仿"。RLHF/DPO 能提升 SFT 后的模型质量（如更有用、更无害、更诚实），是 SFT 无法替代的。且 SFT 对"没有标准答案"的场景（如创意写作、对话）效果有限（答案不唯一），偏好优化能处理这类开放任务。生产级对齐必须 SFT + RLHF/DPO，只有 SFT 的模型质量有天花板。

### 第二层：证据与定位

**Q：DPO 训练后模型的"有用性"（helpfulness）分数没涨，但"无害性"（harmlessness）涨了。怎么定位是偏好数据问题、还是 DPO 超参问题？**

看偏好数据的分布和 DPO 的训练动态。一是偏好数据——训练数据里"无害性"的偏好对是否远多于"有用性"的偏好对（如果数据偏无害，模型往无害方向优化，有用性没涨），检查数据的任务类型分布。二是 reward margin（偏好对的差距）——有用性偏好对的"chosen 和 rejected 的质量差距"是否足够大（如果差距小，如 chosen 答案只比 rejected 好一点，DPO 学不到明显信号），差距小的数据对训练贡献低。三是 DPO 超参——$\beta$（KL 散度约束系数）是否太大（太大则模型不敢偏离 SFT 策略，学不到新偏好）或太小（太小则过度偏离 SFT，可能灾难性遗忘）。四是训练动态——DPO 训练过程中"有用性 reward"是否在涨（如果 reward 涨但 benchmark 没涨，是 reward hacking，reward 模型和真实偏好不一致）。

### 第三层：根因深挖

**Q：RLHF 你说"流程长、极不稳定"。不稳定具体指什么？为什么不稳定？**

RLHF 的 PPO 阶段不稳定。具体表现：一是 reward hacking——策略模型找到 reward 模型的漏洞（如 reward 模型偏好长答案，策略就疯狂生成冗长答案），reward 分数涨但真实质量降；二是策略崩溃——PPO 的策略更新过激，模型输出变成乱码或重复（如一直输出"the the the..."）；三是 KL 散度爆炸——策略模型偏离参考模型（SFT 版本）太远，生成内容失去语言能力。根因：PPO 是 on-policy 强化学习，需要"生成 → 打分 → 更新"的循环，每次更新都改变策略，策略改变又影响下一轮生成的分布，正反馈容易失控（特别是 reward 模型有偏差时，策略往错误方向优化）。且 PPO 有多个超参（clip ratio、KL coef、value function coef、learning rate），调参敏感，稍有不慎就崩。DPO 的优势是绕过了 PPO（直接用偏好对优化策略），稳定性大幅提升。

**Q：那为什么还有人用 RLHF（而非全转 DPO）？DPO 更简单稳定，RLHF 的价值在哪？**

RLHF 的"在线"特性有独特价值。DPO 是"离线"的——用预先标注的偏好对训练，数据是静态的（标注时是什么样就什么样）。RLHF 是"在线"的——PPO 训练时策略生成新答案，reward 模型实时打分，能用"当前策略生成的"数据训练（而非静态数据）。这有两个优势：一是"探索"——RLHF 能发现 DPO 静态数据没覆盖的好答案（策略探索新区域，reward 模型评价）；二是"适应性"——如果部署后用户反馈新的偏好（如"更喜欢简洁答案"），RLHF 能快速调整（reward 模型更新，PPO 重新跑），DPO 要重新标注偏好对（成本高）。所以 RLHF 的上限更高（适合追求 SOTA 的场景），DPO 更实用（适合快速迭代）。当前趋势是"DPO 为主，RLHF 为辅"——先用 DPO 快速对齐，有特殊需求（如极致质量、在线适应）再上 RLHF。

### 第四层：方案权衡

**Q：DPO 你说"无需 reward 模型"。但 DPO 的损失函数里隐含了一个 reward（$r = \beta \log(\pi/\pi_{ref})$）。这和 RLHF 的显式 reward 模型有什么本质区别？**

区别是"reward 从哪来"。RLHF 的 reward 是"训练的"——用偏好数据训一个 reward 模型（神经网络），它能对任意输入输出打分，是显式的、独立的模型。DPO 的 reward 是"推导的"——从偏好数据数学推导出"最优 reward 等于 $\beta \log(\pi/\pi_{ref})$"（$\pi$ 是当前策略，$\pi_{ref}$ 是参考策略），reward 直接从策略的 log 概率算出，不需要训练独立的 reward 模型。区别的影响：一是 DPO 不能"单独使用 reward 模型"（如 RLHF 的 reward 模型可用于打分、筛选、其他下游任务，DPO 的隐式 reward 只在训练时用）；二是 DPO 的 reward 受限于策略表达能力（如果策略模型容量小，reward 表达也受限），RLHF 的 reward 模型可以独立调规模；三是 DPO 训练更简单（少训一个模型），但"reward 与策略耦合"，RLHF 的 reward 独立（可换不同策略）。本质上 DPO 是 RLHF 的数学简化（证明了无需显式 reward 模型也能优化偏好），但牺牲了灵活性。

**Q：为什么不直接用 SFT + 偏好数据筛选（只用 chosen 答案做 SFT，丢弃 rejected），省得搞 DPO？**

偏好数据筛选丢掉了"为什么 chosen 比 rejected 好"的信息。用 chosen 做 SFT，模型只学"chosen 答案长什么样"（模仿），但不知道"chosen 比 rejected 好在哪"（偏好对比）。DPO 的核心是用"对比"信号——损失函数同时看 chosen 和 rejected，拉近 chosen 的概率、推远 rejected 的概率，模型学到的是"好坏的区分"而非"好答案的模仿"。区别在于：SFT 只学"好的"（单向），DPO 学"好 vs 坏"（双向对比），对比信号更强（明确告诉模型"不要生成 rejected 那样的"）。实验证明 DPO 比偏好数据 SFT 效果好 5-10%（在人类评估上）。且 DPO 的 rejected 数据是"负反馈"（告诉模型避免什么），SFT 无法利用（只用好数据）。所以 DPO 的价值是"充分利用偏好对比信号"，而非简单筛选。

### 第五层：验证与沉淀

**Q：你怎么衡量对齐方案（SFT + DPO）的效果，证明比单纯 SFT 好？**

定义指标：一是自动评估（用 reward 模型或 LLM-as-judge 对生成答案打分，对比 SFT-only 和 SFT+DPO 的分数，DPO 应更高）；二是 benchmark（如 MT-Bench、AlpacaEval，对比"模型答案 vs 参考答案"的胜率，DPO 应 >50%）；三是人工评估（盲测，让标注员对比 SFT-only 和 SFT+DPO 的答案，选更好的，DPO 胜率应 >60%）；四是对齐目标（helpfulness/harmlessness/honesty 三个维度分别评，验证 DPO 优化了目标维度）。关键验证"没有 reward hacking"——reward 涨的同时人工评估也涨（如果 reward 涨但人工评估降，是 hacking，reward 模型有偏差）。做消融：SFT-only vs SFT+RLHF vs SFT+DPO，在相同 base 模型上对比，证明 DPO 的"性价比"（简单 + 有效）。

**Q：对齐方案怎么沉淀成团队标配？**

固化成"对齐流水线"：SFT（指令数据，学格式和基础能力）→ DPO（偏好数据，优化好坏判断）→ 评估（自动 + 人工）。沉淀"各阶段的数据规范"（SFT 数据要覆盖任务类型、DPO 偏好对要有明确 chosen/rejected 差距）、"超参经验"（DPO 的 $\beta=0.1$、learning rate 比 SFT 小一个数量级）、"评估流程"（自动评估快速回归 + 人工评估定期验证）。配套监控（reward 趋势、benchmark 分数、人工胜率），reward 涨但 benchmark 降告警（hacking）。把"SFT + DPO"作为对齐的默认流水线（简单有效），特殊场景（极致质量/在线适应）加 RLHF。新模型对齐走标准流水线，保证质量。

## 结构化回答

**30 秒电梯演讲：** SFT教模型"说什么"，RLHF/DPO教模型"说更好的"。DPO是RLHF的数学简化版——无需训练奖励模型，直接从偏好数据优化策略。

**展开框架：**
1. **SFT** — 监督学习，用标准答案做交叉熵损失
2. **RLHF** — 训练RM → PPO优化策略，流程复杂但效果好
3. **DPO** — 直接用偏好对(pair)优化，无需RM和PPO，更稳定

**收尾：** 您想深入聊：DPO为什么在很多场景下取代PPO？


## 视频脚本

> 预计时长：5 分钟 | 由浅入深


| 时间 | 画面/字幕 | 口播台词 | 讲解要点 |
|------|----------|----------|----------|
| 0:00 | 标题卡：详细说明SFT、RLHF和DPO三种后训练方法的… | "SFT像跟读课本（模仿标准答案），RLHF像老师打分+学生改进（先训练打分器再优化）…" | 开场钩子 |
| 0:20 | 核心概念图 | "SFT教模型"说什么"，RLHF/DPO教模型"说更好的"。DPO是RLHF的数学简化版——无需训练奖励模型，直接从偏好…" | 核心定义 |
| 0:50 | SFT示意图 | "SFT——监督学习，用标准答案做交叉熵损失" | 要点拆解1 |
| 1:30 | RLHF示意图 | "RLHF——训练RM → PPO优化策略，流程复杂但效果好" | 要点拆解2 |
| 2:20 | 对比/实战案例图 | "对比一下常见误区和工程实践，看真实场景里怎么取舍。" | 实战与对比 |
| 3:10 | 总结卡 | "记住核心要点。下期我们追问：DPO为什么在很多场景下取代PPO？" | 收尾与钩子 |
