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
memory_points:
- 问题根因：全对或全错导致组内方差为0，Advantage和梯度随之变0，算力被白白浪费
- 解决策略：DAPO通过动态采样过滤掉无梯度信号的无效样本，凑满有效batch
- 代价体现：当前模型完全答不出的超难全错样本被丢弃，丧失学习机会
- 能力限制：因困难样本被剔除，故模型的能力天花板会被永久锁死
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

## 记忆要点

- 问题根因：全对或全错导致组内方差为0，Advantage和梯度随之变0，算力被白白浪费
- 解决策略：DAPO通过动态采样过滤掉无梯度信号的无效样本，凑满有效batch
- 代价体现：当前模型完全答不出的超难全错样本被丢弃，丧失学习机会
- 能力限制：因困难样本被剔除，故模型的能力天花板会被永久锁死


## 苏格拉底式面试追问

> 这组追问模拟面试官层层逼问，每一问先回答"为什么"，再回答"怎么做"，最后回答"如何证明"。

### 第一层：目标与动机

**Q：DAPO 的"动态采样"剔除全对/全错样本，这个设计是为了解决什么问题？为什么要主动丢掉一部分训练数据？**

全对/全错样本在 GRPO 里是"零梯度样本"——G 个回答 reward 全相同，组内归一化 std=0，优势值 A=(r-mean)/std 无定义（或为 0），梯度为 0。这些样本消耗了采样和 forward 的算力却贡献零梯度，是纯浪费。DAPO 剔除它们是为了提升"有效梯度密度"——单位算力产出的有效梯度信号。实测在数学推理任务里，困难 prompt 全错样本能占 30-50%，不剔除的话一半算力在做无用功。

### 第二层：证据与定位

**Q：你怎么知道训练 batch 里有多少比例是零梯度样本？怎么监控这个指标？**

在训练循环里加统计：每个 batch 算完组内 reward 后，统计 reward 方差为 0（全对或全错）的 prompt 数量占比。把这个比例打到 tensorboard/wandb，正常健康值应该 <30%。如果持续 >50%，说明任务难度和模型能力严重错配——要么数据太难（模型全错），要么太简单（模型全对）。还可以进一步拆分：分别统计"全对占比"和"全错占比"，前者说明 prompt 太简单要换更难的，后者说明太难要降难度或加提示。

### 第三层：根因深挖

**Q：DAPO 剔除全错样本后，模型的能力天花板会被锁死——那些超难的题模型永远学不会，这个代价你怎么衡量？**

这是 DAPO 的核心 trade-off。全错样本确实包含"模型当前完全不会的难题"，剔除它们意味着这部分能力永远学不到，能力天花板被锁在"模型至少能做对 G 个回答里的 1 个"的难度区间。衡量代价的方法：保留一版"不剔除全错样本"的对照组（用原始 GRPO），在超难 benchmark（如 AIME、IMO 级别）上对比——如果 DAPO 版本在超难题上比对照组低 10+ 个点，说明代价显著；如果持平，说明这些全错样本本来就学不到（梯度为 0 学不到），剔除它们无损。

**Q：既然剔除全错样本有锁死天花板的代价，为什么不直接增加采样数 G（如 G=8 调到 G=32），让全错的难题也能采到至少一个对的？**

增加 G 确实能让更多难题从"全错"变成"有对有错"（采到正确答案的概率随 G 上升）。但 G 翻 4 倍，每个 prompt 的 forward 成本也翻 4 倍，训练吞吐量降到 1/4，工程上不划算。而且对于真正超难的题（模型能力差几个数量级），G=32 也可能全错。实务折中：G=16（DeepSeek R1 的配置），配合 DAPO 动态剔除剩余的全错样本，用节省的算力多训几步覆盖更多 prompt，比死磕少数超难题收益高。超难题留给 PRM（过程奖励）或 SFT 阶段的 imitation learning 解决。

### 第四层：方案权衡

**Q：除了 DAPO 的动态采样，解决零梯度样本还有什么其他方案？各有什么取舍？**

三个主流方案：1）DAPO 动态采样——剔除零梯度样本重新采样，治标但简单有效，代价是超难题永远学不到（如前述）；2）PRM（过程奖励）——不给最终对错，而是对推理每一步打分，全错的题中间步骤也有梯度信号，治本但需要标注步骤级 reward（成本极高）；3）降低难度梯度——把超难题拆成子问题或给 hint，让模型从"全错"进入"可学习区间"，但要人工设计难度梯度（费力）。实务上：先用 DAPO（低成本），观察天花板损失，如果损失大再补 PRM（高成本高收益）。

**Q：为什么不直接给全错样本一个小的负奖励（比如 -0.1）而不是 0，这样它们就有梯度了？**

给全错样本负奖励确实能让它们产生梯度（A 变成负值，降低这些回答的概率）。但问题是：全错意味着模型对这道题"完全没概念"，强行降低所有错误回答的概率，会同时压低那些"思路对但算错"的部分正确推理——模型学不到"对的部分"反而被惩罚，会陷入更乱的策略。更糟的是 reward hacking 风险——模型可能学会输出固定模板（如"我无法解答"）来回避所有负 reward 的难题。所以 DAPO 选择剔除而非惩罚，是更保守但更稳的做法。

### 第五层：验证与沉淀

**Q：你怎么证明 DAPO 的动态采样确实提升了训练效率，而不是"省了样本但模型变差了"？**

对照实验：固定算力预算（如 256 GPU×24h），分别跑 GRPO（不剔除）和 DAPO（剔除+补采），对比：1）有效梯度步数——DAPO 应该显著多于 GRPO（剔除浪费后多训了真梯度步）；2）同等步数下的能力——GSM8K/MATH 分数，DAPO 应持平或更高；3）同等算力下的能力——这是关键，DAPO 在固定 GPU 小时下达到的最终分数应高于 GRPO。如果 DAPO 在"固定算力"下分数高 3-5 个点，就证明动态采样的效率收益真实存在。

**Q：DAPO 的零梯度样本监控和剔除策略，怎么沉淀成团队 RLHF pipeline 的默认能力？**

集成到训练框架：1）零梯度样本比例监控——训练循环里自动统计并上报到 dashboard，配告警阈值（>50% 触发）；2）动态剔除+补采做成开关——`--dynamic_sampling=True` 一键启用，默认 G=16 上限，剔除后自动补采直到 batch 凑满；3）难度分布分析工具——自动统计训练数据在各难度区间的样本分布，输出"可学习区间（部分对部分错）"占比，帮助数据团队调整训练 prompt 的难度配比。这套能力写入团队 RLHF SOP，新人开 RL 任务默认启用。

## 结构化回答

**30 秒电梯演讲：** DAPO动态采样过滤"全对/全错"的prompt（无梯度信号），提升训练效率。剔除零奖励样本确实可能限制困难样本学习，解法是降低任务难度梯度、增加采样数、或用过程奖励(PRM)替代结果奖励。

**展开框架：**
1. **动态采样** — 跳过advantage全为0的prompt，只训有信号的
2. **零奖励样本剔除的代价** — 困难样本（全错）学不到
3. **解法1** — 课程学习，先易后难，让模型逐步能做对部分

**收尾：** 您想深入聊：如何判断一个prompt对当前模型是"太难了"？


## 视频脚本

> 预计时长：5 分钟 | 由浅入深


| 时间 | 画面/字幕 | 口播台词 | 讲解要点 |
|------|----------|----------|----------|
| 0:00 | 标题卡：DAPO 动态采样提升效率 & 零奖励样本剔除的… | "像老师出题——如果全班都做对（题太简单）或全班都做错（题太难），这道题没有区分度，白出了。…" | 开场钩子 |
| 0:20 | 核心概念图 | "DAPO动态采样过滤"全对/全错"的prompt（无梯度信号），提升训练效率。剔除零奖励样本确实可能限制困难样本学习，解…" | 核心定义 |
| 0:50 | 动态采样示意图 | "动态采样——跳过advantage全为0的prompt，只训有信号的" | 要点拆解1 |
| 1:30 | 零奖励样本剔除的代价示意图 | "零奖励样本剔除的代价——困难样本（全错）学不到" | 要点拆解2 |
| 2:20 | 对比/实战案例图 | "对比一下常见误区和工程实践，看真实场景里怎么取舍。" | 实战与对比 |
| 3:10 | 总结卡 | "记住核心要点。下期我们追问：如何判断一个prompt对当前模型是"太难了"？" | 收尾与钩子 |
