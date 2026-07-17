---
id: note-bg-004
difficulty: L4
category: ai
subcategory: 强化学习
tags:
- 八股总结
- 面经
- PPO
- GRPO
- DPO
- DAPO
- 强化学习
feynman:
  essence: PPO是用"裁剪的比率"约束策略更新幅度的on-policy算法；GRPO是PPO的简化版（去掉Critic，用组内相对优势）；DPO是直接用偏好对训练（省略Reward Model）；DAPO是GRPO的改进版（动态采样+解耦裁剪）。
  analogy: PPO像一个"小心翼翼的登山者"——每步都用ratio裁剪防止走太远。GRPO像"登山小组投票"——不用单独的向导(Critic)，组内成员比较谁高谁低决定方向。DPO像"直接学评委的品味"——不学打分模型，直接从偏好对学。DAPO像"聪明的登山小组"——根据难度动态调整探索，且对正确和错误的处理分开。
  first_principle: RLHF的核心是"用人类偏好优化策略"。PPO通过RM间接学偏好（RM打分→PPO优化）；DPO证明了"偏好学习可以被转化为策略的对比学习"，省略RM。GRPO/DAPO针对PPO的工程痛点（Critic显存大、优势估计难）做了简化。
  key_points:
  - PPO：on-policy，ratio裁剪，需要Critic估计value
  - GRPO：无Critic，组内G个样本相对排名做优势
  - DPO：无RM无RL，直接用偏好对的对比loss
  - DAPO：动态采样(过滤全对全错)+解耦裁剪(正面负面分开)
first_principle:
  essence: 偏好优化的数学本质是"让被偏好的输出概率相对上升，被拒绝的相对下降"
  derivation: RLHF的目标是最大化 E[r(x,y)] 同时不偏离参考策略。PPO用RM近似r，用KL约束不偏离。DPO通过推导发现，最优解 π*/π_ref = exp(r/β)，把r用π表示后，偏好对的对比loss可以直接优化π，无需显式RM。GRPO发现，用"组内均值做baseline"代替Critic估计的value，效果相当且省一半显存。
  conclusion: PPO→GRPO(省Critic)→DAPO(动态采样)是on-policy线的演进；DPO是另一条off-policy路线
follow_up:
- GRPO去掉Critic后，优势估计的方差会变大吗？
- DPO和PPO在什么场景下各有优劣？
- DAPO的动态采样具体怎么过滤？为什么能提升效率？
memory_points:
- 四者对比：PPO需Critic四模型，GRPO组内相对去Critic，DAPO动态采样解耦，DPO离线无需RM
- PPO原理：用概率比值计算，限制在[1-ε, 1+ε]内裁剪，悲观更新保稳定
- GRPO原理：同prompt采样G个回答，组内分数标准化作为优势值，免去价值网络
- DAPO优化：因全对全错样本梯度为0，故动态剔除以提升有效梯度密度
- DPO本质：直接偏好优化，通过构造闭式解跳过RL和RM，全离线训练
---

# 【八股总结】PPO、GRPO、DPO、DAPO 的基本原理

## 一、四者关系总览

```
RLHF方法谱系：

RLHF（人类反馈强化学习）
├── On-policy 系列（需要在线采样）
│   ├── PPO (2017)     ── 经典方法，需要Critic
│   ├── GRPO (2024)    ── DeepSeek，去Critic，组内相对
│   └── DAPO (2025)    ── GRPO改进，动态采样+解耦裁剪
│
└── Off-policy 系列（用离线数据）
    └── DPO (2023)     ── 直接偏好优化，无RM无RL
```

## 二、PPO：经典RLHF方法

### 2.1 PPO的核心机制

```python
# PPO = Proximal Policy Optimization（近端策略优化）
# 核心思想：限制策略更新幅度，防止"一步走太远"导致崩溃

def ppo_objective(policy, old_policy, advantage):
    """PPO的Clipped Surrogate Objective"""
    # 1. 计算新旧策略的概率比
    ratio = exp(log_prob_policy(a) - log_prob_old(a))
    # ratio > 1: 新策略比旧策略更倾向选a
    # ratio < 1: 新策略比旧策略更不倾向选a

    # 2. 裁剪ratio，限制在[1-ε, 1+ε]
    clipped_ratio = clip(ratio, 1-ε, 1+ε)

    # 3. 取min（悲观更新，保证稳定）
    objective = min(ratio * advantage, clipped_ratio * advantage)
    return -objective  # 最大化→最小化负值
```

### 2.2 PPO的完整组件

```python
class PPOTrainer:
    """PPO需要4个模型："""
    def __init__(self):
        self.policy_model = ...     # 1. 策略模型（训练）
        self.reference_model = ...  # 2. 参考模型（冻结，算KL）
        self.reward_model = ...     # 3. 奖励模型（打分）
        self.critic_model = ...     # 4. 价值模型（估计baseline）
        # → 显存占用 = 4 × 模型大小（最大开销）

    def compute_advantage(self, prompt):
        """优势函数：衡量某回答比平均水平好多少"""
        # 1. 用policy生成回答
        response = self.policy.generate(prompt)

        # 2. reward打分
        reward = self.reward_model(prompt, response)

        # 3. KL惩罚（防偏离reference）
        kl = KL(self.policy, self.reference, prompt, response)
        penalized_reward = reward - β * kl

        # 4. Critic估计value（baseline）
        value = self.critic_model(prompt)

        # 5. 优势 = reward - baseline
        advantage = penalized_reward - value
        return advantage
```

### 2.3 PPO的痛点

```
PPO的问题：
1. 显存大：需要4个模型（policy+reference+reward+critic）
2. Critic难训：value估计不准，advantage噪声大
3. 超参敏感：ε、β、学习率都需要细调
4. 工程复杂：rollout、优势估计、裁剪，链路长
```

## 三、GRPO：去掉Critic的简化

### 3.1 GRPO的核心创新

```python
# GRPO = Group Relative Policy Optimization（DeepSeek 2024）
# 关键洞察：用"组内相对排名"代替Critic的value估计

def grpo_advantage(prompt, policy, reward_model, group_size=8):
    """组内相对优势"""
    # 1. 对同一个prompt，采样G个不同回答
    responses = [policy.generate(prompt) for _ in range(group_size)]
    # 例如G=8：同一个问题生成8个不同答案

    # 2. 对每个回答打分
    rewards = [reward_model(prompt, r) for r in responses]
    # [0.8, 0.3, 0.9, 0.1, 0.5, 0.7, 0.2, 0.6]

    # 3. 组内标准化：减均值除标准差
    mean_r = mean(rewards)  # 0.5125
    std_r = std(rewards)    # 0.27
    advantages = [(r - mean_r) / std_r for r in rewards]
    # [1.06, -0.79, 1.43, -1.53, -0.05, 0.69, -1.16, 0.32]

    # 4. 这就是advantage！不需要Critic
    return responses, advantages
```

### 3.2 GRPO vs PPO 对比

```
┌────────────┬───────────────────┬───────────────────┐
│            │ PPO               │ GRPO              │
├────────────┼───────────────────┼───────────────────┤
│ Critic     │ 需要（估计value） │ 不需要（组内均值）│
│ 模型数量   │ 4个               │ 3个（省Critic）   │
│ 显存       │ 4×模型            │ 3×模型            │
│ 优势估计   │ reward - value    │ (r - mean) / std  │
│ 采样方式   │ 1个prompt 1个回答 │ 1个prompt G个回答 │
│ 适用场景   │ 通用              │ 数学/代码（明确对错）│
└────────────┴───────────────────┴───────────────────┘

GRPO的优势：
- 省一个Critic模型的显存和计算
- 组内对比天然适合"有标准答案"的任务（数学、代码）
  - 因为可以明确判断8个回答谁好谁差
- DeepSeek-R1用GRPO训练，效果出色
```

### 3.3 GRPO的loss

```python
def grpo_loss(policy, old_policy, responses, advantages):
    """GRPO的loss（类似PPO但用组内优势）"""
    total_loss = 0
    for response, adv in zip(responses, advantages):
        ratio = exp(logπ_policy(response) - logπ_old(response))
        clipped = clip(ratio, 1-ε, 1+ε)
        loss = -min(ratio * adv, clipped * adv)

        # 可选：加KL正则（GRPO直接在loss里加KL，不用reward里减）
        loss += β * KL(policy, reference)
        total_loss += loss
    return total_loss / len(responses)
```

## 四、DPO：直接偏好优化（无RM无RL）

### 4.1 DPO的核心洞察

```python
# DPO = Direct Preference Optimization
# 关键推导：RLHF的最优解可以解析表示

# RLHF的目标：max E[r(x,y)] - β·KL(π || π_ref)
# 求解后得到最优策略：
#   π*(y|x) / π_ref(y|x) = exp(r(x,y) / β)
# 反解出reward：
#   r(x,y) = β · log(π*(y|x) / π_ref(y|x))

# 这意味着：reward可以用policy表示！
# 代入Bradley-Terry偏好模型：
#   P(y_w > y_l | x) = σ(r(x,y_w) - r(x,y_l))
#                   = σ(β·log(π(y_w)/π_ref(y_w)) - β·log(π(y_l)/π_ref(y_l)))

# 于是得到DPO的loss：
def dpo_loss(policy, reference, chosen, rejected):
    """直接用偏好对训练，无需Reward Model"""
    # log-ratio
    log_ratio_chosen = logπ(policy, chosen) - logπ(reference, chosen)
    log_ratio_rejected = logπ(policy, rejected) - logπ(reference, rejected)

    # DPO loss
    loss = -log_sigmoid(
        β * (log_ratio_chosen - log_ratio_rejected)
    )
    return loss
    # 直觉：让chosen的log-ratio上升，rejected的下降
```

### 4.2 DPO的流程对比

```
RLHF (PPO) 流程：
Base → SFT → [训练RM] → [PPO训练] → 对齐模型
         2步训练，需要4个模型在线

DPO 流程：
Base → SFT → [DPO直接训练] → 对齐模型
         1步训练，只需2个模型（policy + reference）

DPO的优势：
- 省略Reward Model训练
- 省略Critic
- 不需要在线rollout（用离线偏好对）
- 工程简单，稳定性好
- 一个loss搞定
```

### 4.3 DPO的局限

```python
# DPO的问题：
# 1. 依赖离线数据质量
#    - 偏好对必须高质量，否则学不好
#    - 无法像PPO那样通过rollout探索新策略

# 2. 分布偏移
#    - 训练数据是旧策略生成的，policy更新后分布变了
#    - off-policy的根本问题

# 3. 容易过拟合
#    - 简单的对比loss，容易把rejected概率压到0
#    - 需要早停

# 4. 难以处理细粒度偏好
#    - 只有"chosen vs rejected"的二元信号
#    - 不如RM的连续分数信息丰富
```

## 五、DAPO：GRPO的改进

### 5.1 DAPO的两个核心改进

```python
# DAPO = Decoupled clip and dynamic sAmpling Policy Optimization
# 两个关键改进：

# 改进1：动态采样（Dynamic Sampling）
def dynamic_sampling(prompt, policy, reward_model, group_size=8):
    """过滤掉"全对"或"全错"的prompt"""
    responses = [policy.generate(prompt) for _ in range(group_size)]
    rewards = [reward_model(prompt, r) for r in responses]

    # 如果8个回答全对（rewards全1）→ 没有梯度信号（都一样好）
    if all(r == 1 for r in rewards):
        return None  # 丢弃，不参与训练

    # 如果8个回答全错（rewards全0）→ 也没有信号（都一样差）
    if all(r == 0 for r in rewards):
        return None  # 丢弃

    # 只有"有对有错"的prompt才有学习价值
    return responses, rewards
    # 效果：训练效率提升（不浪费在无信号的batch上）
```

```python
# 改进2：解耦裁剪（Clip-Higher，上下界不对称）
def dapo_clip(ratio, ε_high=0.28, ε_low=0.04):
    """
    传统PPO/GRPO：上下界对称 clip(ratio, 1-ε, 1+ε)，常用ε=0.2
    DAPO：抬高上界、压低下界，两端用不同的ε
    """
    # 上界放宽（ε_high=0.28）：允许ratio到1.28
    # → 好样本（正advantage）能被更充分地强化，不被裁剪限制
    # 下界收紧（ε_low=0.04）：ratio最低到0.96
    # → 差样本（负advantage）的下降幅度受限，防止策略过早坍缩
    return clip(ratio, 1-ε_low, 1+ε_high)
    # 直觉：好样本多学一点（上界放宽），差样本适度抑制（下界收紧保稳）
```

### 5.2 DAPO为什么有效

```
传统GRPO的问题：
1. 全对/全错的prompt浪费算力（动态采样解决）
2. 对称裁剪对"好样本"限制太死（解耦裁剪解决）

DAPO的效果（论文报告）：
- 在AIME数学竞赛上，训练效率提升40%+
- 同样算力下，模型成绩更高
- 适合"有明确对错"的推理任务
```

## 六、四者对比总结

```
┌──────────┬──────────┬──────────┬──────────┬──────────┐
│          │ PPO      │ GRPO     │ DPO      │ DAPO     │
├──────────┼──────────┼──────────┼──────────┼──────────┤
│ 年份     │ 2017     │ 2024     │ 2023     │ 2025     │
│ 来源     │ OpenAI   │ DeepSeek │ Stanford │ 字节/Qwen│
│ on/off   │ on       │ on       │ off      │ on       │
│ RM       │ 需要     │ 需要     │ 不需要   │ 需要     │
│ Critic   │ 需要     │ 不需要   │ 不需要   │ 不需要   │
│ 模型数   │ 4        │ 3        │ 2        │ 3        │
│ 采样     │ 1:1      │ 1:G      │ 离线     │ 1:G+过滤 │
│ 稳定性   │ 中       │ 中高     │ 高       │ 高       │
│ 适用     │ 通用     │ 推理     │ 通用     │ 推理     │
│ 代表模型 │ GPT-4    │ R1       │ LLaMA2   │ Qwen3?   │
└──────────┴──────────┴──────────┴──────────┴──────────┘
```

### 选型建议

```python
def choose_method(task_type, resources, data):
    if task_type == "reasoning_math_code":
        # 有明确对错的推理任务
        return "DAPO"  # 或 GRPO，效果最好
    elif resources == "limited":
        # 资源有限
        return "DPO"  # 最省，无需在线采样
    elif data == "offline_preference_pairs":
        # 只有偏好对，无RM
        return "DPO"
    else:
        return "PPO"  # 通用场景的稳妥选择
```

## 加分点

1. **知道GRPO是DeepSeek提出的**：R1训练的核心算法，体现对前沿跟进
2. **能解释DPO的数学推导**：从RLHF目标推导出π*/π_ref=exp(r/β)，是DPO的理论基础
3. **理解DAPO动态采样的直觉**："全对全错无信号"是个很实用的工程洞察

## 雷区

- **混淆on-policy和off-policy**：PPO/GRPO/DAPO是在线采样，DPO用离线数据
- **以为DPO完全优于PPO**：DPO简单但有分布偏移问题，PPO在复杂场景仍占优
- **忽视KL约束的作用**：所有方法都有reference约束，去掉会reward hacking

## 扩展

- **GRPO论文**：DeepSeekMath，提出GRPO并验证数学推理效果
- **DAPO论文**：字节跳动2025，动态采样+解耦裁剪，刷新AIME记录
- **DPO论文**：Stanford 2023，RLHF的偏好直接优化理论
- **其他变体**：KTO（Kahneman-Tversky，只需好/坏标签无需成对）、IPO、ORPO

## 记忆要点

- 四者对比：PPO需Critic四模型，GRPO组内相对去Critic，DAPO动态采样解耦，DPO离线无需RM
- PPO原理：用概率比值计算，限制在[1-ε, 1+ε]内裁剪，悲观更新保稳定
- GRPO原理：同prompt采样G个回答，组内分数标准化作为优势值，免去价值网络
- DAPO优化：因全对全错样本梯度为0，故动态剔除以提升有效梯度密度
- DPO本质：直接偏好优化，通过构造闭式解跳过RL和RM，全离线训练


## 苏格拉底式面试追问

> 这组追问模拟面试官层层逼问，每一问先回答"为什么"，再回答"怎么做"，最后回答"如何证明"。

### 第一层：目标与动机

**Q：PPO 已经是 RLHF 的主流，为什么 DeepSeek 还要搞 GRPO？它解决了 PPO 的什么核心痛点？**

PPO 要训一个 Critic（Value Network）估计 baseline，意味着除了 Policy、Reference、Reward Model，还要再加载一个 Critic 模型——4 个 7B 模型同时驻留显存，单卡根本放不下。Critic 还要单独训，收敛慢、不稳。GRPO 的核心洞察是：与其学一个 Critic 估 baseline，不如对同一个 prompt 采 G 个回答，用组内 reward 的均值/标准差做归一化作为优势值 A=(r-mean)/std，免掉 Critic。这样显存砍掉 25%，训练成本大幅下降，这是 DeepSeekMath/R1 能训起来的关键工程优化。

### 第二层：证据与定位

**Q：你说 GRPO 去掉 Critic 更省显存，但采样 G 个回答（通常 G=8 或 16）不是增加了采样成本吗？怎么算总账？**

算总账：PPO 每个 prompt 采 1 个回答但要 forward Policy+Critic+RM+Ref 四个模型；GRPO 每个 prompt 采 G=8 个回答，但只 forward Policy+RM+Ref 三个模型（无 Critic）。单 prompt 的 forward 次数：PPO 是 4×1=4，GRPO 是 3×8=24。表面看 GRPO 多了，但 GRPO 的 G 个回答共享同一 prompt 的 KV-Cache（prefix 复用），实际 forward 成本是 1+8（prompt 算一次 + 8 个回答）。而且 GRPO 不用训 Critic 的反向传播，省掉 Critic 的优化器状态（Adafactor 状态约等于模型参数量）。实测 DeepSeek 的报告：GRPO 总训练成本比 PPO 低 30-40%。

### 第三层：根因深挖

**Q：GRPO 用组内 reward 归一化当优势值，这有什么隐患？在什么场景下会失效？**

失效场景：当 G 个回答的 reward 全相同时（全对或全错），std=0，归一化除零，优势值无定义——这就是 DAPO 要解决的"零奖励样本"问题。另一个隐患：组内归一化丢失了"绝对质量"信息。比如一个简单 prompt，8 个回答 reward 都是 0.9，归一化后优势值都接近 0，模型学不到"这个 prompt 本来就简单，已经做得不错了"；反过来一个超难 prompt 8 个回答都是 0.1，归一化后优势值也接近 0，模型学不到"这个 prompt 难，需要更多探索"。这就是 GRPO 在极端难度分布上不如 PPO 的原因。

**Q：既然 GRPO 在全对/全错场景失效，为什么不直接回到 PPO，而要搞 DAPO 这个中间方案？**

因为 PPO 的 Critic 成本太高（回到第一层的问题），DAPO 是在 GRPO 基础上做最小改动解决失效：1）动态采样——检测到一批 prompt 的 G 个回答 reward 方差为 0（全对/全错）就丢弃这批，重新采样直到拿到有梯度的 prompt；2）解耦裁剪——把 PPO 的 clip 上界 ε_high 和下界 ε_low 解耦，上界放宽（鼓励探索高 reward 回答），下界收紧（快速淘汰低 reward）。这样既保住 GRPO 无 Critic 的成本优势，又解决了零梯度样本问题。

### 第四层：方案权衡

**Q：PPO、GRPO、DPO、DAPO 这四个，实际项目里怎么选？有决策树吗？**

按"数据 + 算力"决策：1）只有偏好对数据（chosen-rejected pair），没有在线 reward signal → 选 DPO（全离线，最省）；2）有 reward model + 算力充足 + 追求 SOTA → PPO（最稳但有 Critic 成本）；3）有 reward model + 算力紧张 + 工程能力强 → GRPO（DeepSeek 路线，省 Critic）；4）GRPO 跑通后发现大量零梯度样本 → 升级 DAPO。实务上 80% 的中小团队用 DPO（数据好搞、训练简单），大厂追求极致上 PPO/GRPO，DAPO 是 GRPO 的进阶版。

**Q：为什么不直接用 DPO 跑所有场景？它最省事，不需要 RM 也不需要 PPO。**

DPO 有三个硬伤：1）离线——它用静态偏好对训练，无法在线探索新的"更好回答"，上限被偏好数据质量锁死；2）对偏好对质量极敏感——标注噪声（标反了的 pair）会让 DPO 学反，而 PPO/GRPO 在线采样有自我纠正能力；3）分布漂移——DPO 训练时模型分布会偏离 SFT 初始化，没有 KL 约束到 ref 会越训越偏（虽然有 β 正则但弱）。所以追求 SOTA 的场景（如 R1 级推理能力）还是用 GRPO/PPO 在线 RL，DPO 适合快速迭代和资源受限。

### 第五层：验证与沉淀

**Q：你怎么证明 GRPO 训出来的模型确实比 PPO 好，而不是"省了钱但效果也差了"？**

对照实验：同样的 SFT 初始化、同样的 reward model、同样的数据，分别跑 PPO 和 GRPO 到同样步数，在三个维度对比：1）能力——AlpacaEval/MMLU/GSM8K 分数；2）稳定性——reward 曲线方差、KL 是否平稳；3）效率——达到 PPO 同等效果（如 AlpacaEval 持平）用了多少 GPU 小时。如果 GRPO 能力持平甚至更高、稳定性不差、GPU 小时少 30%，就证明 GRPO 在该任务上优于 PPO。DeepSeekMath 论文就是这套对照，GRPO 在 MATH 上超 PPO 2-4 个点且成本更低。

**Q：这次 GRPO/DAPO 的选型经验怎么沉淀成团队默认方案？**

整理成一份"RLHF 算法决策 SOP"：1）场景分类表——任务类型（对话/推理/代码）× 数据类型（在线 reward/离线偏好对）× 算力预算，每个格子推荐一个算法；2）默认配方——中小项目默认 DPO，大项目默认 GRPO+DAPO，标注了为什么不用 PPO（Critic 成本）和 DPO（离线上限）；3）对照实验模板——固定 SFT init、RM、eval set 的实验脚本，新人切换算法时一键复现对照。再配一个训练监控 dashboard，自动检测零梯度样本比例（GRPO/DAPO 的关键健康指标），超过阈值告警。

## 结构化回答

**30 秒电梯演讲：** PPO是用"裁剪的比率"约束策略更新幅度的on-policy算法；GRPO是PPO的简化版（去掉Critic，用组内相对优势）；DPO是直接用偏好对训练（省略Reward Model）。

**展开框架：**
1. **PPO** — on-policy，ratio裁剪，需要Critic估计value
2. **GRPO** — 无Critic，组内G个样本相对排名做优势
3. **DPO** — 无RM无RL，直接用偏好对的对比loss

**收尾：** 您想深入聊：GRPO去掉Critic后，优势估计的方差会变大吗？


## 视频脚本

> 预计时长：5 分钟 | 由浅入深


| 时间 | 画面/字幕 | 口播台词 | 讲解要点 |
|------|----------|----------|----------|
| 0:00 | 标题卡：PPO、GRPO、DPO、DAPO 的基本原理 | "PPO像一个"小心翼翼的登山者"——每步都用ratio裁剪防止走太远。GRPO像"登山小组…" | 开场钩子 |
| 0:20 | 核心概念图 | "PPO是用"裁剪的比率"约束策略更新幅度的on-policy算法；GRPO是PPO的简化版（去掉Critic，用组内相对…" | 核心定义 |
| 0:50 | PPO示意图 | "PPO——on-policy，ratio裁剪，需要Critic估计value" | 要点拆解1 |
| 1:30 | GRPO示意图 | "GRPO——无Critic，组内G个样本相对排名做优势" | 要点拆解2 |
| 2:20 | 对比/实战案例图 | "对比一下常见误区和工程实践，看真实场景里怎么取舍。" | 实战与对比 |
| 3:10 | 总结卡 | "记住核心要点。下期我们追问：GRPO去掉Critic后，优势估计的方差会变大吗？" | 收尾与钩子 |
