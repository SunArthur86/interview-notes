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

