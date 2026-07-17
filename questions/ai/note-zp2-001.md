---
id: note-zp2-001
difficulty: L4
category: ai
subcategory: LLM
tags:
- 智谱
- 面经
- SFT
- 后训练
feynman:
  essence: 判断SFT是否做到头不能只看loss，而要看继续训练是否还能提升hard set、OOD set和真实任务指标，以及pass@k多样性和RL probe gain
  analogy: SFT像健身练基础体能——当你力量不再增长但柔韧性/爆发力还能提升时，说明基础训练够了，该转专项训练(RL)了
  first_principle: SFT的目标不是训练成最终最优策略，而是获得格式稳定、能力不退化、适合继续RL优化的初始策略
  key_points:
  - 不能只看train/validation loss下降
  - '关键信号: OOD/hard set不涨 + 输出模板化 = SFT进入低收益区'
  - pass@k高但pass@1低 → 应优先RL而非继续堆SFT
  - 过度SFT压缩策略分布，削弱后续RL探索空间
  - 最终checkpoint选RL probe gain明确的版本，而非SFT分数最高的
first_principle:
  essence: SFT解决会不会按正确方式做，RL解决多个可行行为中哪个更优
  derivation: SFT是模仿学习(imitation) → 能学到格式和能力 → 但只能复刻样本 → 遇到样本没覆盖的场景就退化 → 需要RL探索更优策略 → 过度SFT会压缩策略分布 → 削弱RL探索空间
  conclusion: SFT的停止时机是在RL收益开始超过SFT收益的拐点
follow_up:
- SFT数据按能力分桶怎么构建？
- pass@k中k取多少合适？
- RL probe gain具体怎么测？
memory_points:
- 核心认知：SFT只为求初始策略，并非最终最优，切莫死磕Loss下降
- 停止信号1：Loss虽降，但困难题(Hard)和OOD泛化集准确率不再提升
- 停止信号2：输出模板化(Distinct-2下降)，pass@1不高但pass@16高
- 判断金标准：从当前权重做100步RL/DPO，收益明显说明SFT该停了
---

# 如何判断 SFT 已经做到头了？

## 核心认知

```
SFT 的目标 ≠ 训练成最终最优策略
SFT 的目标 = 获得一个适合继续RL优化的初始策略
           = 格式稳定 + 能力不退化 + 具备泛化能力
```

## 判断维度：五个关键信号

```
┌──────────────────────────────────────────────────┐
│           SFT 训练监控仪表盘                      │
├──────────────────────────────────────────────────┤
│                                                  │
│  Signal 1: Loss曲线                              │
│  Train Loss ████████████↓ (持续下降)             │
│  Val Loss   ████████━━━━━ (已平台期)             │
│  ⚠️ loss下降≠能力提升，可能只是更好拟合标注       │
│                                                  │
│  Signal 2: 泛化指标                              │
│  Easy Set   ████████████ (稳定)                  │
│  Hard Set   ██████━━━━━━ (不再提升) ← 关键!      │
│  OOD Set    █████━━━━━━━ (开始下降) ← 危险!      │
│                                                  │
│  Signal 3: 输出多样性                             │
│  pass@1     ████━━━━━━━━ (不高)                  │
│  pass@16    ████████████ (高) ← 说明潜力在RL     │
│  Distinct-2 ↓↓↓↓↓ (模板化严重) ← 过度SFT信号    │
│                                                  │
│  Signal 4: 格式稳定性                             │
│  JSON合规率 ████████████ (99%+) ← SFT该停了      │
│  Schema准确 ████████████ (98%+)                  │
│                                                  │
│  Signal 5: RL Probe Gain                         │
│  从当前ckpt做100步RL → gain明显 → SFT该停了      │
│  从当前ckpt做100步RL → gain微弱 → 继续SFT        │
│                                                  │
└──────────────────────────────────────────────────┘
```

## 五个关键信号详解

### Signal 1：Loss下降但泛化不涨

```python
# 每轮SFT后评估
for checkpoint in sft_checkpoints:
    metrics = {
        'train_loss': eval_loss(train_set, checkpoint),
        'val_loss': eval_loss(val_set, checkpoint),
        'hard_acc': eval_accuracy(hard_set, checkpoint),  # 困难题
        'ood_acc': eval_accuracy(ood_set, checkpoint),    # 分布外
    }

    # 判定: loss还在降，但hard/ood不涨 → SFT进入低收益区
    if metrics['train_loss'] < prev_train_loss and \
       metrics['hard_acc'] <= prev_hard_acc:
        print("⚠️ SFT收益递减，考虑停止")
```

### Signal 2：pass@k 分析

```
pass@k 的含义: 采样k次，至少1次正确的概率

pass@1 = 0.45 (单次生成准确率不高)
pass@16 = 0.82 (多次采样有较高覆盖)

这说明: 模型有正确答案的能力，但单次选择不够好
结论: 应该用RL/DPO优化选择策略，而不是继续SFT
```

### Signal 3：输出模板化

```python
# 计算输出多样性
def distinct_n(generations, n=2):
    """n-gram多样性指标"""
    all_ngrams = []
    for gen in generations:
        tokens = gen.split()
        ngrams = list(zip(*[tokens[i:] for i in range(n)]))
        all_ngrams.extend(ngrams)
    return len(set(all_ngrams)) / len(all_ngrams)

# distinct_2从0.85降到0.45 → 严重模板化
# 意味着SFT让模型输出趋于单一模板，丧失了多样性
```

### Signal 4：协议类能力已稳定

```
SFT最擅长解决的:
- Chat template格式
- JSON Schema输出
- 工具调用格式
- Role consistency
- 拒答格式

当这些指标达到99%+ → 协议类SFT使命完成
```

### Signal 5：RL Probe Gain

```python
def rl_probe(sft_checkpoint, steps=100):
    """从SFT checkpoint做少量RL，测试收益"""
    # 方案A: 从当前SFT checkpoint做100步RL
    model = load(sft_checkpoint)
    rl_result = rl_train(model, steps=steps)

    # 方案B: 继续SFT 100步
    sft_result = sft_train(model, steps=steps)

    # 比较
    if rl_result.gain > sft_result.gain * 2:
        return "SFT应该停止，转入RL"
    else:
        return "SFT还有收益，继续训练"
```

## SFT vs RL 边界

| 维度 | SFT | RL |
|------|-----|-----|
| **解决的问题** | 会不会按正确方式做 | 多个可行方案中哪个更优 |
| **训练信号** | 标准答案(模仿) | 偏好/奖励(探索) |
| **效果** | 格式稳定、基础能力注入 | 优化决策质量、提升pass@1 |
| **何时停止** | 格式稳定+泛化不涨+模板化 | pass@1和RL reward收敛 |

## Checkpoint选择策略

```
❌ 错误: 选SFT分数最高的checkpoint
✅ 正确: 选满足以下条件的checkpoint
  - 协议稳定性: JSON格式合规率 > 99%
  - OOD不退化: OOD accuracy ≥ SFT前的80%
  - pass@k保持: pass@16没有显著下降
  - RL probe gain: 做100步RL后reward有明显提升
```

## 记忆要点

- 核心认知：SFT只为求初始策略，并非最终最优，切莫死磕Loss下降
- 停止信号1：Loss虽降，但困难题(Hard)和OOD泛化集准确率不再提升
- 停止信号2：输出模板化(Distinct-2下降)，pass@1不高但pass@16高
- 判断金标准：从当前权重做100步RL/DPO，收益明显说明SFT该停了


## 苏格拉底式面试追问

> 这组追问模拟面试官层层逼问，每一问先回答"为什么"，再回答"怎么做"，最后回答"如何证明"。

### 第一层：目标与动机

**Q：判断 SFT 是否做到头，为什么不只看 loss，要看 hard set 和 OOD set？loss 收敛不就够了吗？**

loss 收敛说明模型在"训练分布"上学到了，但不代表"学到位"。SFT 的目标是泛化（在没见过的数据上表现好），loss 只反映训练集拟合。1) hard set——训练集里难的样本，如果 hard set 的准确率还能提升，说明模型还没学到难模式（虽然整体 loss 收敛）；2) OOD set——分布外数据，如果 OOD 还能提升，说明模型的泛化能力还在增强。动机是"loss 收敛是必要不充分条件"，要看"是否还能在更难的、没见过的数据上提升"。

### 第二层：证据与定位

**Q：SFT 训练 loss 已经收敛（变化 < 0.01），但 eval loss 仍在下降，这是过拟合还是正常？**

通常是正常的"泛化仍在提升"。train loss 收敛说明训练集学到了，eval loss 下降说明模型在验证集上还在进步（泛化变好）。如果 train loss 收敛且 eval loss 上升，才是过拟合（模型开始记训练集、泛化变差）。所以 train 收敛 + eval 下降，应该继续训练（泛化还在提升）。但要监控 hard set 和 OOD——如果它们也提升，继续；如果它们停滞或下降，是"指标级别的过拟合"（整体 eval 好但难样本差）。

### 第三层：根因深挖

**Q：继续训练 SFT 后，hard set 提升但 OOD 下降，根因是什么？**

根因是"模型在 hard set 上过拟合了"。hard set 是训练集里的难样本，继续训练让模型"记住"这些难样本的具体特征，hard set 准确率升，但这种"记忆"不泛化到 OOD（分布外），甚至牺牲了 OOD 的泛化能力（模型容量被 hard set 占用）。这和"整体 eval 下降"是同一类问题的不同表现。解法：1) 加入 OOD 数据到训练集（让模型见过更多分布）；2) 早停（在 OOD 开始下降时停）；3) 正则化（dropout、weight decay）防过拟合。

**Q：那为什么不直接在 OOD set 上早停，避免 OOD 下降？**

可以，但要小心"用测试集调参"的陷阱。如果 OOD set 是用来"选停止点"的，它实质上成了验证集（参与了模型选择），真正的泛化能力要用另一个独立的测试集评估。正确做法：把数据分成 train/validation/hard_set/ood_set/test，validation 用于调超参（如停止点），hard 和 ood 用于监控，test 只在最后评估一次。如果数据量小做不到这么多分集，用交叉验证。

### 第四层：方案权衡

**Q：判断 SFT 到头要用 hard set、OOD、pass@k、RL probe gain 多个指标，为什么不简化？**

因为每个指标反映不同维度，缺一会误判。1) 只看 loss——可能过拟合（loss 好但泛化差）；2) 只看 eval accuracy——可能遗漏难样本（整体好但 hard 差）；3) 只看 hard set——可能 OOD 泛化不足；4) 不看 pass@k——可能错过"多样性提升"（模型虽然 greedy 准确率没升，但采样多样性升了，对 RL 阶段有益）；5) 不看 RL probe gain——可能不知道"SFT 是否给 RL 留了空间"。多指标是"多维度判断"，避免单一指标的盲区。

**Q：为什么不直接进 RL 阶段，让 RL 来判断 SFT 是否到头（RL 没提升就是到头）？**

RL 成本高，不适合做"探测"。RL 训练要奖励模型、在线采样、PPO/GRPO 优化，算力和时间成本是 SFT 的 5-10 倍。如果 SFT 还没到头就进 RL，是浪费 RL 的算力（SFT 能挤的提升用便宜的 SFT 挤完）。所以先用便宜的 SFT 探测（hard/OOD/pass@k/probe gain），确认 SFT 到头再进贵的 RL。RL probe gain 是"用小的 RL 实验测试 SFT 是否还有提升空间"，不是完整 RL 训练。

### 第五层：验证与沉淀

**Q：怎么系统化判断 SFT 到头，做成可复用的流程？**

建立"SFT 完成度检查清单"：1) train loss 收敛（变化 < 阈值，连续 N 步）；2) eval accuracy 不再提升（连续 M 个 checkpoint 没上升）；3) hard set accuracy 不再提升；4) OOD accuracy 不再提升（或开始下降）；5) pass@k 多样性不再提升；6) RL probe gain 趋于 0（小规模 RL 实验 yield < 阈值）。六个条件全满足才判定"SFT 到头"，可以进 RL。沉淀为训练 SOP：每个指标的测量方法、阈值、checkpoint 策略。

## 结构化回答

**30 秒电梯演讲：** 判断SFT是否做到头不能只看loss，而要看继续训练是否还能提升hard set、OOD set和真实任务指标，以及pass@k多样性和RL probe gain。

**展开框架：**
1. **不能只看** — 不能只看train/validation loss下降
2. **关键信号** — OOD/hard set不涨 + 输出模板化 = SFT进入低收益区
3. **pass** — pass@k高但pass@1低 → 应优先RL而非继续堆SFT

**收尾：** 您想深入聊：SFT数据按能力分桶怎么构建？


## 视频脚本

> 预计时长：5 分钟 | 由浅入深


| 时间 | 画面/字幕 | 口播台词 | 讲解要点 |
|------|----------|----------|----------|
| 0:00 | 标题卡：如何判断 SFT 已经做到头了？ | "SFT像健身练基础体能——当你力量不再增长但柔韧性/爆发力还能提升时，说明基础训练够了，该…" | 开场钩子 |
| 0:20 | 核心概念图 | "判断SFT是否做到头不能只看loss，而要看继续训练是否还能提升hard set、OOD set和真实任务指标，以及…" | 核心定义 |
| 0:50 | 不能只看示意图 | "不能只看——不能只看train/validation loss下降" | 要点拆解1 |
| 1:30 | 关键信号示意图 | "关键信号——OOD/hard set不涨 + 输出模板化 = SFT进入低收益区" | 要点拆解2 |
| 2:20 | 对比/实战案例图 | "对比一下常见误区和工程实践，看真实场景里怎么取舍。" | 实战与对比 |
| 3:10 | 总结卡 | "记住核心要点。下期我们追问：SFT数据按能力分桶怎么构建？" | 收尾与钩子 |
