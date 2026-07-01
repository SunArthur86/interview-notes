---
id: note-bg-007
difficulty: L4
category: ai
subcategory: Agentic RL
tags:
- 八股总结
- 面经
- Agentic RL
- rollout
- 长尾轨迹
- 异步处理
feynman:
  essence: 多轮Agentic RL何时停止rollout：当模型输出final answer、达到max_turns、或陷入死循环时停止。长尾轨迹（极长的推理链）是核心挑战，解法是截断+异步处理+复用部分轨迹。
  analogy: 像考试限时——学生可能2分钟交卷（短轨迹），也可能死磕到打铃（长尾）。如果等最慢的学生，全班效率被拖垮。解法是设时限（max_turns）、慢的先交部分卷（截断）、并行批改（异步）。
  first_principle: RL训练的吞吐量 = rollout速度 × GPU利用率。Agentic rollout的特点是轨迹长度方差极大（短的2轮，长的50轮），导致同步训练时GPU空等。第一性原理是"消除长度方差对吞吐的影响"——异步化、截断、轨迹复用。
  key_points:
  - 停止条件：final answer / max_turns / 死循环检测
  - 长尾问题：少数超长轨迹拖慢整体同步训练
  - 解法1：异步rollout（不等慢的）
  - 解法2：合理截断（保留部分reward信号）
  - 解法3：轨迹复用（长轨迹拆成多个训练样本）
first_principle:
  essence: 分布式RL的效率受限于"最慢的rollout"（类似MapReduce的长尾task）
  derivation: 同步PPO/GRPO需要等一个batch内所有rollout完成才能更新参数。当轨迹长度方差大（10x差异），GPU利用率从90%降到30%。解法是把"同步等待"改为"异步流水线"，或对超长轨迹做特殊处理（截断、降级）。
  conclusion: Agentic RL的训练效率优化 = 异步架构 + 长尾处理策略
follow_up:
- 截断轨迹后，如何计算部分reward？
- 异步rollout如何处理参数更新的staleness问题？
- 如何判断长轨迹是"深度推理"还是"死循环"？
memory_points:
- 停止条件：给出最终答案(正常奖)、触发最大轮数/主动放弃(轻惩)、检测到死循环(重惩-0.5)
- 长尾分类：好长尾有深度多步推理(保留奖励)，坏长尾是低效死循环(截断惩罚)
- 死循环检测：通过计算信息增益或新颖度，区分有效推理与无效冗余步骤
- 同步训练缺陷：因需等待最长轨迹，导致99%的GPU空等，必须改用异步提升利用率
---

# 【八股总结】多轮 Agentic RL 何时停止 rollout？长尾轨迹如何处理？

## 一、Rollout 停止条件

### 1.1 三种正常停止条件

```python
class AgentRollout:
    def should_stop(self, state, turn):
        # 条件1：模型输出了最终答案
        if self.is_final_answer(state.generated):
            return "final_answer"

        # 条件2：达到最大轮数
        if turn >= self.max_turns:
            return "max_turns_reached"

        # 条件3：检测到死循环
        if self.detect_loop(state.history):
            return "loop_detected"

        # 条件4（补充）：模型主动说"我无法解决"
        if self.is_give_up(state.generated):
            return "give_up"

        return None  # 继续rollout
```

### 1.2 各停止条件的reward处理

```python
def assign_reward_by_stop_reason(trajectory, stop_reason, task):
    if stop_reason == "final_answer":
        # 正常完成：根据答案正确性给分
        return reward_model(task, trajectory.final_answer)
        # 正确：+1，错误：-0.2（鼓励尝试但不奖励错误）

    elif stop_reason == "max_turns_reached":
        # 超时：轻惩罚（不应该拖太久）
        # 但如果有部分进展，给部分分
        partial = estimate_progress(trajectory)
        return 0.3 * partial - 0.1  # 最多0.2，最少-0.1

    elif stop_reason == "loop_detected":
        # 死循环：明确惩罚
        return -0.5

    elif stop_reason == "give_up":
        # 放弃：中性或轻微负
        return -0.1
```

## 二、长尾轨迹问题

### 2.1 什么是长尾轨迹

```python
# Agentic rollout的轨迹长度分布（典型）
trajectory_lengths = [2, 3, 2, 4, 3, 2, 5, 3, 2, 4,   # 大多数2-5轮
                      3, 2, 4, 3, 6, 2, 3, 5, 4, 3,
                      2, 3, 2, 45, 3, 4, 2, 3, 2, 4]  # 偶尔有45轮的！

# 统计：
mean_len = 4.2
p50_len = 3
p99_len = 45  # 长尾！

# 问题：同步训练时，GPU要等最长的45轮那个完成
# 99%的轨迹3-5轮就完成，但都在空等那1个长轨迹
# GPU利用率从理论100%降到实际~20%
```

### 2.2 长尾的两种类型

```python
# 类型1：深度推理（好长尾）
# 模型在进行复杂的多步推理，每步都合理
# 例：数学证明需要20步推导
# 处理：应该保留并奖励（这是模型能力的体现）

# 类型2：低效/死循环（坏长尾）
# 模型在反复尝试同一方法，或陷入无意义的探索
# 例：连续调用同一工具10次，每次结果一样
# 处理：应该截断或惩罚（这是低效行为）

# 区分方法：分析轨迹的"信息增益"
def classify_trajectory(trajectory):
    if is_looping(trajectory):
        return "bad_tail"  # 死循环

    # 计算每轮的"新信息量"
    info_gains = [compute_novelty(step, trajectory[:i])
                  for i, step in enumerate(trajectory)]

    if all(g > threshold for g in info_gains):
        return "good_tail"  # 每步都有新信息，是深度推理
    else:
        return "bad_tail"   # 有冗余步骤
```

## 三、长尾轨迹的处理策略

### 3.1 策略1：异步rollout（核心方案）

```python
# 同步训练（传统方式）的问题
def sync_training(batch_size=32):
    """所有rollout同步完成，等最慢的"""
    trajectories = []
    for task in tasks[:batch_size]:
        traj = rollout(task)  # 长度不一
        trajectories.append(traj)
    # ← 这里要等最长的轨迹完成
    train_step(trajectories)  # 才能更新参数
    # GPU利用率低：短轨迹完成后空等


# 异步训练：rollout和训练解耦
class AsyncAgenticTrainer:
    def __init__(self, num_workers=8):
        self.rollout_queue = AsyncQueue()
        self.train_queue = AsyncQueue()
        self.workers = [RolloutWorker() for _ in range(num_workers)]

    async def run(self):
        # 1. 多个worker并行rollout
        for worker in self.workers:
            asyncio.create_task(self.rollout_worker(worker))

        # 2. 训练进程独立消费已完成的轨迹
        while training:
            batch = []
            while len(batch) < train_batch_size:
                traj = await self.train_queue.get()
                batch.append(traj)
            # 凑够一批就训练，不等所有rollout
            self.train_step(batch)
            # 关键：短的轨迹先训练，长的慢慢来

    async def rollout_worker(self, worker):
        while True:
            task = await self.rollout_queue.get()
            traj = await worker.rollout(task)
            await self.train_queue.put(traj)  # 完成就送训练队列
```

### 3.2 策略2：智能截断

```python
def smart_truncate(trajectory, max_length=15):
    """智能截断超长轨迹，保留有价值的部分"""
    if len(trajectory) <= max_length:
        return trajectory, "no_truncation"

    # 检测轨迹中是否有"关键转折点"
    key_points = find_key_transitions(trajectory)
    # 如：首次调用正确工具、首次得到有用信息

    if len(key_points) >= 3:
        # 保留到第三个关键点后截断
        cutoff = key_points[2]
        truncated = trajectory[:cutoff]
        return truncated, "truncated_with_progress"

    else:
        # 没有足够进展，截断到max_length
        return trajectory[:max_length], "hard_truncation"


def truncated_reward(truncated_traj, full_reward_estimate):
    """截断轨迹的reward打折"""
    progress = estimate_progress(truncated_traj)
    return full_reward_estimate * progress * 0.7  # 截断惩罚30%
    # 既保留部分信号，又鼓励模型更高效
```

### 3.3 策略3：轨迹复用（数据增强）

```python
def reuse_long_trajectory(long_traj):
    """把一条长轨迹拆成多个训练样本"""
    samples = []

    # 方法1：截断到不同长度，每个都是训练样本
    for cutoff in [3, 5, 10, len(long_traj)]:
        partial = long_traj[:cutoff]
        # 部分轨迹也有训练价值（credit assignment）
        samples.append(partial)

    # 方法2：提取子任务
    subtasks = extract_subgoals(long_traj)
    for subtask_traj in subtasks:
        samples.append(subtask_traj)

    return samples
    # 一条45轮的长轨迹 → 4-6个训练样本
    # 提升数据利用率
```

### 3.4 策略4：动态max_turns

```python
def adaptive_max_turns(task, model_level):
    """根据任务难度和模型能力动态调整max_turns"""
    base_turns = 10

    # 简单任务（如单轮问答）：减少max_turns
    if task.type == "simple_qa":
        return 3

    # 复杂任务（如多步推理）：增加max_turns
    if task.type == "complex_reasoning":
        return 20

    # 根据模型当前能力调整
    if model_level == "early_training":
        return 5  # 早期模型能力弱，长轨迹多是死循环
    elif model_level == "late_training":
        return 15  # 后期模型可能有深度推理

    return base_turns
```

## 四、推理耗时优化

### 4.1 长尾轨迹的推理成本

```python
# Agent rollout的推理成本分析
def rollout_cost(trajectory):
    """单条轨迹的GPU计算成本"""
    total_tokens = sum(len(t.tokens) for t in trajectory)
    # 每轮需要重新计算整个context（KV-cache可优化但仍有成本）
    cost = sum(
        len(trajectory[:i].tokens)  # 第i轮要看前面所有
        for i in range(len(trajectory))
    )
    # 轨迹长度n → 成本O(n²)
    # 45轮轨迹的成本 ≈ 45² = 2025
    # 3轮轨迹的成本 ≈ 3² = 9
    # 长轨迹的成本是短轨迹的200倍！
    return cost
```

### 4.2 KV-Cache优化

```python
class KVCacheRollout:
    """利用KV-Cache避免重复计算"""
    def __init__(self, model):
        self.model = model
        self.kv_cache = None  # 复用前几轮的KV

    def generate_turn(self, context, new_observation):
        if self.kv_cache is None:
            # 首轮：全量计算
            output, self.kv_cache = self.model(context, use_cache=True)
        else:
            # 后续轮：只计算新observation的KV
            new_kv = self.model.compute_kv(new_observation)
            self.kv_cache.append(new_kv)
            output = self.model.generate_with_cache(self.kv_cache)
        return output
        # 45轮轨迹的成本从O(n²)降到O(n)
```

### 4.3 批处理中的padding问题

```python
# 同步训练时的padding浪费
# batch内轨迹长度不一，需要padding到最长

trajectories = [
    [t1, t2, t3],                    # 3轮
    [t1, t2, t3, t4, t5, t6, t7],   # 7轮
    [t1, t2, t3, t4, t5, t6, t7, t8, t9, t10, ...t45],  # 45轮
]
# padding后：3条都变成45轮长度
# 有效token占比：(3+7+45)/(45×3) = 55/135 ≈ 41%
# 59%的算力浪费在padding上（短轨迹的空位）

# 解决：按长度分桶(batch by length)
def bucketed_batch(trajectories, bucket_ranges=[(1,5), (5,10), (10,20), (20,+∞)]):
    """按轨迹长度分桶，桶内组batch"""
    buckets = {r: [] for r in bucket_ranges}
    for traj in trajectories:
        for (lo, hi) in bucket_ranges:
            if lo <= len(traj) < hi:
                buckets[(lo,hi)].append(traj)
                break

    batches = []
    for rng, trajs in buckets.items():
        for i in range(0, len(trajs), batch_size):
            batches.append(trajs[i:i+batch_size])
    # 同桶内padding浪费小，整体利用率提升到60%+
    return batches
```

## 五、综合方案

```python
class ProductionAgenticTrainer:
    """生产级Agentic RL训练器"""

    def __init__(self):
        self.async_rollout = AsyncRolloutEngine(num_workers=16)
        self.kv_cache = True
        self.bucketed_batch = True
        self.adaptive_max_turns = True

    def train_epoch(self, tasks):
        # 1. 异步rollout（不等慢的）
        all_trajectories = self.async_rollout.run(tasks)

        # 2. 分类处理长尾
        processed = []
        for traj in all_trajectories:
            if len(traj) > 20:  # 长尾
                if classify(traj) == "good_tail":
                    # 深度推理：复用为多个样本
                    processed.extend(reuse_trajectory(traj))
                else:
                    # 死循环：截断+惩罚
                    processed.append(smart_truncate(traj))
            else:
                processed.append(traj)

        # 3. 按长度分桶组batch
        batches = bucketed_batch(processed)

        # 4. 训练
        for batch in batches:
            self.train_step(batch)
```

## 加分点

1. **区分"好长尾"和"坏长尾"**：深度推理要保留，死循环要截断——不是一刀切
2. **异步架构**：解决长尾的核心是解耦rollout和训练，类似MapReduce的长尾处理
3. **KV-Cache**：Agent rollout的O(n²)成本用KV-Cache降到O(n)，是工程必备

## 雷区

- **简单粗暴截断**：把深度推理也截了，损失有价值的训练信号
- **同步训练等长尾**：GPU利用率极低，训练成本翻倍
- **忽视padding浪费**：batch内长度差异大会浪费大量算力

## 扩展

- **vLLM/SGLang的连续批处理**：解决推理时长尾请求的工程方案
- **VeRL框架**：字节开源的RL训练框架，原生支持Agentic RL的异步rollout
- **OpenAI o1的推理时长优化**：如何平衡"长推理链"和"推理成本"

## 记忆要点

- 停止条件：给出最终答案(正常奖)、触发最大轮数/主动放弃(轻惩)、检测到死循环(重惩-0.5)
- 长尾分类：好长尾有深度多步推理(保留奖励)，坏长尾是低效死循环(截断惩罚)
- 死循环检测：通过计算信息增益或新颖度，区分有效推理与无效冗余步骤
- 同步训练缺陷：因需等待最长轨迹，导致99%的GPU空等，必须改用异步提升利用率

