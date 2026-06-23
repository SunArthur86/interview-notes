---
id: note-bg-005
difficulty: L4
category: ai
subcategory: 强化学习
tags:
- 八股总结
- 面经
- DAPO
- 动态采样
- 零奖励样本
- GRPO
feynman:
  essence: DAPO动态采样过滤"全对/全错"的prompt（无梯度信号），提升训练效率。剔除零奖励样本确实可能限制困难样本学习，解法是降低任务难度梯度、增加采样数、或用过程奖励(PRM)替代结果奖励。
  analogy: 像老师出题——如果全班都做对（题太简单）或全班都做错（题太难），这道题没有区分度，白出了。但只出"有区分度"的中等题，又会让差生永远学不会难题。解法是循序渐进地加难度、给差生多几次尝试机会、或把难题拆成步骤分步给分。
  first_principle: 强化学习的有效梯度要求"同一个状态下不同动作的reward有差异"。全对（reward全1）或全错（reward全0）时，advantage全为0，梯度为零。剔除这些样本提升了"有效梯度密度"，但代价是困难样本（模型当前全错的）得不到训练机会。
  key_points:
  - 动态采样：跳过advantage全为0的prompt，只训有信号的
  - 零奖励样本剔除的代价：困难样本（全错）学不到
  - 解法1：课程学习，先易后难，让模型逐步能做对部分
  - 解法2：增加group_size，提高"部分做对"概率
  - 解法3：用PRM（过程奖励），分步给分，避免全0
first_principle:
  essence: 有效学习需要"可学习的难度区间"——既不是全对（无新知）也不是全错（无梯度）
  derivation: 维果茨基的"最近发展区"理论：学习在"稍微超出当前能力但可达"的区域最有效。全对=已掌握（无学习），全错=远超能力（无梯度）。动态采样把训练聚焦在"发展区"，但需要课程学习让发展区不断前移，否则永远学不会更难的。
  conclusion: 动态采样+课程学习+过程奖励，三者结合才能既高效又覆盖困难样本
follow_up:
  - 如何判断一个prompt对当前模型是"太难了"？
  - PRM（过程奖励模型）如何解决"全错"问题？
  - 课程学习的难度如何量化？
---

# 【八股总结】DAPO 动态采样提升效率 & 零奖励样本剔除的代价

## 一、动态采样（Dynamic Sampling）原理

### 1.1 问题：无梯度信号的样本浪费算力

```python
# GRPO对每个prompt采样G个回答，计算组内相对优势
def grpo_sampling(prompt, policy, reward_model, G=8):
    responses = [policy.generate(prompt) for _ in range(G)]
    rewards = [reward_model(prompt, r) for r in responses]

    # 组内标准化
    mean_r = mean(rewards)
    std_r = std(rewards)
    advantages = [(r - mean_r) / (std_r + ε) for r in rewards]

    return responses, advantages
```

```python
# 场景1：prompt太简单，8个回答全对
rewards = [1, 1, 1, 1, 1, 1, 1, 1]
mean_r = 1.0, std_r = 0.0
advantages = [(1-1.0)/(0.0+ε), ...] = [0, 0, 0, 0, 0, 0, 0, 0]
# advantage全为0 → 梯度为0 → 这个prompt白采样了

# 场景2：prompt太难，8个回答全错
rewards = [0, 0, 0, 0, 0, 0, 0, 0]
mean_r = 0.0, std_r = 0.0
advantages = [(0-0.0)/(0.0+ε), ...] = [0, 0, 0, 0, 0, 0, 0, 0]
# advantage全为0 → 梯度为0 → 同样浪费

# 场景3：有对有错（理想）
rewards = [1, 0, 1, 0, 1, 0, 0, 1]
mean_r = 0.5, std_r = 0.5
advantages = [1, -1, 1, -1, 1, -1, -1, 1]  # 有效梯度信号！
```

### 1.2 DAPO的动态采样策略

```python
def dapo_dynamic_sampling(prompts, policy, reward_model, G=8):
    """动态采样：跳过全对/全错的prompt"""
    valid_batches = []

    for prompt in prompts:
        responses = [policy.generate(prompt) for _ in range(G)]
        rewards = [reward_model(prompt, r) for r in responses]

        # 核心过滤逻辑
        has_positive = any(r > 0 for r in rewards)
        has_negative = any(r <= 0 for r in rewards)

        if has_positive and has_negative:
            # 有对有错：有效样本，保留
            advantages = compute_group_advantage(rewards)
            valid_batches.append((responses, advantages))
        else:
            # 全对或全错：丢弃，不浪费算力
            continue

    return valid_batches
    # 效果：每个batch都是有信号的样本，训练效率提升
```

### 1.3 为什么能提升训练效率

```
传统GRPO（不过滤）：
  100个prompt × 8个采样 = 800次前向
  其中30个prompt全对、20个全错 → 50个prompt×8=400次采样无梯度
  有效梯度密度 = 50%

DAPO（动态采样）：
  100个prompt采样后，丢弃50个无信号的
  重新采样50个新prompt，直到凑满100个有效
  有效梯度密度 = 100%（但总采样次数增加）
  净效果：单位算力的有效梯度翻倍
```

## 二、零奖励样本剔除的代价

### 2.1 问题：困难样本被忽视

```python
# 动态采样过滤了"全错"的prompt
# 但这些prompt恰恰是模型最该学的（当前完全不会）

# 举例：
# prompt = "证明哥德巴赫猜想" （数学未解之谜）
# 模型8次采样全错 → reward全0 → 被丢弃
# → 模型永远学不会这类问题

# 更现实的例子：
# prompt = "解决这道AIME竞赛难题"
# 当前模型能力不足，8次采样全错
# → 被动态采样丢弃
# → 模型在这个难度水平永远得不到训练
# → 能力天花板被锁死
```

### 2.2 代价的量化

```
训练数据难度分布：
┌─────────────────────────────────────────────────┐
│ 难度    │ 占比  │ 动态采样后  │ 影响           │
├─────────┼───────┼────────────┼────────────────┤
│ 简单    │ 30%   │ 全对→丢弃  │ ✓ 合理（已掌握）│
│ 中等    │ 50%   │ 保留       │ ✓ 核心训练区   │
│ 困难    │ 20%   │ 全错→丢弃  │ ✗ 丧失学习机会 │
└─────────────────────────────────────────────────┘

后果：模型在中等难度上精进，但困难题始终突破不了
     "舒适区训练"陷阱
```

## 三、解决思路

### 3.1 思路1：课程学习（Curriculum Learning）

```python
# 核心思想：从简单到困难循序渐进，让模型逐步具备做难题的能力

class CurriculumScheduler:
    def __init__(self, all_prompts):
        # 按难度排序
        self.prompts_by_difficulty = self.sort_by_difficulty(all_prompts)
        self.current_level = 0

    def get_batch(self, policy, reward_model):
        """根据模型当前能力，选合适难度的prompt"""
        # 测试各难度水平的通过率
        pass_rates = {}
        for level in range(self.current_level, self.current_level + 3):
            sample_prompts = self.prompts_by_difficulty[level][:10]
            pass_rate = self.estimate_pass_rate(policy, sample_prompts)
            pass_rates[level] = pass_rate

        # 选"通过率在20%-80%"的难度（有学习价值）
        target_level = max(
            [l for l, r in pass_rates.items() if 0.2 < r < 0.8],
            default=self.current_level,
        )
        self.current_level = target_level
        return self.prompts_by_difficulty[target_level]

# 效果：模型先掌握简单题，能力提升后中等题变"部分对"
# 原本全错的困难题，随能力提升变成"有对有错"，重新进入训练
```

### 3.2 思路2：增加采样数（增大group_size）

```python
# 全错的根源之一：采样数太少，没采到对的
# 增大G可以提升"部分做对"的概率

def adaptive_group_size(prompt, policy, base_G=8, max_G=32):
    """自适应采样数"""
    G = base_G
    while G <= max_G:
        responses = [policy.generate(prompt) for _ in range(G)]
        rewards = [reward_model(prompt, r) for r in responses]

        if any(r > 0 for r in rewards):
            # 有对了，停止增加
            return responses, rewards
        G *= 2  # 加倍采样

    return None  # 即使max_G也全错，确实太难了
    # 权衡：采样越多越费算力，但能挽救部分困难样本
```

### 3.3 思路3：过程奖励（PRM替代ORM）

```python
# ORM（Outcome Reward Model）：只看最终结果对错
# 问题：推理题即使最终答案错，中间步骤可能部分对

# PRM（Process Reward Model）：分步骤打分
def process_reward(prompt, response):
    """对推理过程的每一步打分"""
    steps = parse_reasoning_steps(response)
    step_rewards = []
    for i, step in enumerate(steps):
        # 每步独立打分
        r = prm.score_step(prompt, steps[:i+1], step)
        step_rewards.append(r)
    return step_rewards  # [0.1, 0.3, 0.2, 0.1, 0.0]
    # 即使最终答案错(0)，中间步骤有部分奖励
    # → 困难样本不再是"全0"，有了梯度信号
```

```python
# PRM解决"全错"的效果
# 传统ORM：
#   困难题8次采样：rewards = [0, 0, 0, 0, 0, 0, 0, 0] → 全0 → 丢弃

# PRM（过程奖励）：
#   困难题8次采样，每步打分后求和：
#   rewards = [0.3, 0.1, 0.4, 0.2, 0.3, 0.5, 0.1, 0.4]
#   不全为0 → 有梯度信号 → 可以训练
#   模型从"部分步骤做对"开始，逐步学会完整推理
```

### 3.4 思路4：辅助任务分解

```python
# 把困难问题拆成子问题，先学子问题
def decompose_hard_problem(hard_prompt):
    """把难题拆成子问题"""
    sub_problems = decomposer.decompose(hard_prompt)
    # "证明AIME难题" → ["理解题意", "建立方程", "代数化简", "求解验证"]

    # 每个子问题作为独立训练样本
    for sub in sub_problems:
        # 子问题难度更低，模型可能部分做对
        if model_can_partially_solve(sub):
            yield sub  # 作为有效训练样本
```

## 四、综合方案

```python
class EnhancedDAPO:
    """DAPO + 课程学习 + PRM 的综合方案"""

    def __init__(self):
        self.curriculum = CurriculumScheduler()
        self.prm = ProcessRewardModel()  # 过程奖励
        self.base_G = 16  # 较大的group_size

    def sample_and_train(self):
        # 1. 课程学习选难度
        prompts = self.curriculum.get_batch()

        for prompt in prompts:
            # 2. 自适应采样
            G = self.adaptive_group_size(prompt, base=self.base_G)
            responses = [self.policy.generate(prompt) for _ in range(G)]

            # 3. PRM打分（而非ORM）
            rewards = [self.prm.process_reward(prompt, r) for r in responses]

            # 4. 动态过滤（但现在PRM让全0更少）
            if has_signal(rewards):
                # 5. 训练
                self.train_step(prompt, responses, rewards)
            else:
                # 6. 真正太难的，降级为子问题
                sub_problems = decompose(prompt)
                self.curriculum.add(sub_problems, level=current+1)
```

## 五、效果对比

```
方法对比（在AIME数学竞赛训练上）：

┌──────────────────────┬──────────┬──────────┬──────────┐
│ 方法                 │ 训练效率 │ 困难题   │ 最终成绩 │
├──────────────────────┼──────────┼──────────┼──────────┤
│ GRPO（无动态采样）   │ 基准     │ 能学但慢 │ 30%      │
│ DAPO（动态采样）     │ +40%     │ 学不到   │ 35%      │
│ DAPO + 课程学习      │ +30%     │ 逐步学   │ 42%      │
│ DAPO + PRM           │ +20%     │ 有效学   │ 45%      │
│ DAPO + 课程 + PRM    │ +25%     │ 最有效   │ 48%      │
└──────────────────────┴──────────┴──────────┴──────────┘

结论：动态采样提升效率，但必须配合课程学习/PRM防止困难样本被抛弃
```

## 加分点

1. **用"最近发展区"类比**：教育学理论完美映射RL难度选择，体现跨学科思维
2. **提到PRM**：过程奖励是解决"全错"的根本方案，OpenAI的Q*、DeepSeek-R1都用类似思路
3. **量化"全错"的比例**：实际训练中15-25%的prompt会全错，不是小问题

## 雷区

- **认为动态采样"纯粹是好事"**：提升效率的同时有副作用（困难样本被弃），需要权衡
- **忽视PRM的标注成本**：过程奖励需要逐步骤标注，比ORM贵很多
- **课程学习难度设置不当**：跨度太大效果差，需要细粒度分级

## 扩展

- **DAPO论文**：字节2025，动态采样+解耦裁剪，验证了在推理任务的效果
- **PRM（Let's Verify Step by Step）**：OpenAI 2023，过程奖励的奠基工作
- **Self-Play / SPIN**：模型自我对弈，从自身错误中学习，也能缓解困难样本问题
