---
id: note-sp-ai-009
difficulty: L2
category: ai
subcategory: 微调
tags:
- Shopee
- 面经
- 对齐
- RLHF
- DPO
feynman:
  essence: 对齐让模型说人想要的、安全的、有用的，核心方法是RLHF和DPO
  analogy: 对齐像教小孩礼仪——不是改他的智商(预训练)，而是教他什么场合说什么话(SFT+偏好学习)
  first_principle: 预训练让模型学会语言能力，对齐让模型的行为符合人类期望
  key_points:
  - RLHF：偏好排序→训奖励模型→PPO微调
  - DPO：直接从偏好对学习，省掉奖励模型
  - RLHF效果好但流程复杂
  - DPO简单稳定，省掉奖励模型
first_principle:
  essence: 预训练模型会生成各种内容(包括有害的)，对齐通过人类偏好信号约束输出空间
  derivation: 预训练=学会说话→SFT=学会对话→RLHF/DPO=学会说"好"话(有用+无害+诚实)
  conclusion: 对齐 = SFT(监督微调) + 偏好学习(RLHF或DPO)
follow_up:
- PPO算法的核心思想是什么？
- DPO为什么不需要奖励模型？
- 什么是对齐税(alignment tax)？
memory_points:
- 大模型训练三阶段：预训练学知识，SFT学指令格式，对齐学人类偏好。
- 对齐双雄：RLHF是两阶段经典法，DPO是无强化学习的直推法。
- RLHF核心：先训练奖励模型打分，再用PPO最大化奖励，同时用KL散度约束防偏离。
- DPO对比RLHF：DPO省去奖励模型和强化学习，直接用偏好对数据优化策略，更简单稳定。
---

# 简单讲一下大模型训练的对齐操作？

## 大模型训练三阶段

```
┌─────────────────────────────────────────────────────┐
│              大模型训练完整流程                       │
├─────────────────────────────────────────────────────┤
│                                                      │
│  Stage 1: 预训练 (Pre-training)                     │
│  ─────────────────────────────                      │
│  海量文本 → Next Token Prediction                    │
│  学会语言能力和世界知识                               │
│  产出：基座模型(Base Model)                          │
│                                                      │
│  Stage 2: 监督微调 (SFT)                            │
│  ─────────────────────────────                      │
│  高质量问答对 → 指令跟随学习                         │
│  学会按指令格式回答                                  │
│  产出：指令模型(SFT Model)                           │
│                                                      │
│  Stage 3: 对齐 (Alignment) ← 本题重点               │
│  ─────────────────────────────                      │
│  人类偏好数据 → RLHF 或 DPO                          │
│  学会说有用、安全、诚实的回答                         │
│  产出：对齐模型(Chat Model)                          │
│                                                      │
└─────────────────────────────────────────────────────┘
```

## RLHF（基于人类反馈的强化学习）

```
┌─────────────────────────────────────────────────────┐
│                   RLHF 流程                          │
├─────────────────────────────────────────────────────┤
│                                                      │
│  Step 1: 训练奖励模型 (Reward Model)                │
│  ───────────────────────────────────────            │
│  人类标注偏好对: (prompt, chosen, rejected)          │
│  训练RM: 给response打分                              │
│                                                      │
│  Step 2: PPO强化学习                                 │
│  ───────────────────────────────────────            │
│  SFT模型生成response → RM打分                        │
│  → PPO优化模型参数 → 最大化奖励                       │
│  → KL散度约束防止偏离太远                             │
│                                                      │
└─────────────────────────────────────────────────────┘
```

### RLHF详细步骤

```python
# 伪代码
# Step 1: 收集偏好数据
preference_data = [
    {"prompt": "如何写Python函数？",
     "chosen": "def函数定义+详细解释",      # 人类选为好的
     "rejected": "Python没有函数概念"}       # 人类选为差的
]

# Step 2: 训练奖励模型
reward_model = train_reward_model(preference_data)
# RM学会: 好回答→高分，差回答→低分

# Step 3: PPO强化学习
for epoch in range(N):
    # 1. 用当前策略生成回答
    responses = policy_model.generate(prompts)
    
    # 2. RM给回答打分
    rewards = reward_model.score(prompts, responses)
    
    # 3. PPO更新策略（最大化奖励）
    # 同时用KL散度约束不偏离SFT模型太远
    policy_model = ppo_update(
        policy_model, 
        rewards, 
        reference_model=sft_model,  # KL约束
        kl_penalty=0.1
    )
```

## DPO（直接偏好优化）

```
┌─────────────────────────────────────────────────────┐
│                    DPO 流程                          │
├─────────────────────────────────────────────────────┤
│                                                      │
│  直接从偏好对学习，不需要训练奖励模型！               │
│                                                      │
│  数学洞察：                                          │
│  最优奖励函数 = 最优策略的对数比                     │
│  → 可以直接用偏好数据优化策略，跳过RM                 │
│                                                      │
│  Loss = -log σ(β·[log π(chosen)/π_ref(chosen)      │
│                    - log π(rejected)/π_ref(rejected)])│
│                                                      │
│  含义：增大chosen概率，减小rejected概率               │
│        同时参考ref模型防止偏离                        │
│                                                      │
└─────────────────────────────────────────────────────┘
```

### DPO代码

```python
import torch.nn.functional as F

def dpo_loss(policy_logps_chosen, policy_logps_rejected,
             ref_logps_chosen, ref_logps_rejected, beta=0.1):
    """
    policy_logps: 策略模型对response的对数概率
    ref_logps: 参考模型(SFT)对response的对数概率
    beta: KL约束强度
    """
    # 计算相对概率比
    chosen_ratio = policy_logps_chosen - ref_logps_chosen
    rejected_ratio = policy_logps_rejected - ref_logps_rejected
    
    # DPO loss
    logits = beta * (chosen_ratio - rejected_ratio)
    loss = -F.logsigmoid(logits).mean()
    
    return loss
```

## RLHF vs DPO 对比

| 维度 | RLHF | DPO |
|------|------|-----|
| **奖励模型** | 需要(额外训练) | 不需要 |
| **流程复杂度** | 高(RM+PPO+KL) | 低(直接训练) |
| **稳定性** | 较差(PPO超参敏感) | 较好(简单loss) |
| **效果** | 上限较高 | 略低于RLHF |
| **计算成本** | 高(RM+PPO两阶段) | 低(单阶段) |
| **适用场景** | 追求最佳效果 | 快速迭代 |

## 对齐的三个目标

```
HHH 框架：
┌──────────────────────────────────┐
│  H - Helpful  (有用)             │
│  → 回答切题、信息准确             │
│  → 不敷衍、不拒绝合理请求          │
│                                   │
│  H - Harmless (无害)             │
│  → 不生成有害/违法/歧视内容       │
│  → 不教危险操作                   │
│                                   │
│  H - Honest  (诚实)              │
│  → 不编造事实(减少幻觉)           │
│  → 不确定时说"我不知道"           │
└──────────────────────────────────┘
```

## 面试加分点

1. **三阶段理解**：预训练→SFT→对齐，能说清每个阶段的目标
2. **DPO的数学直觉**：不需要RM因为最优奖励=最优策略的对数比
3. **KL约束**：无论RLHF还是DPO都需要KL散度防止模型偏离太远
4. **对齐税**：对齐后模型能力可能下降(为了安全牺牲部分能力)

## 记忆要点

- 大模型训练三阶段：预训练学知识，SFT学指令格式，对齐学人类偏好。
- 对齐双雄：RLHF是两阶段经典法，DPO是无强化学习的直推法。
- RLHF核心：先训练奖励模型打分，再用PPO最大化奖励，同时用KL散度约束防偏离。
- DPO对比RLHF：DPO省去奖励模型和强化学习，直接用偏好对数据优化策略，更简单稳定。

