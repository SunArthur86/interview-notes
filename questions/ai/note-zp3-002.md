---
id: note-zp3-002
difficulty: L3
category: ai
subcategory: LLM
tags:
  - 智谱
  - 面经
  - DPO
  - SFT
  - 对齐
feynman:
  essence: "SFT只能教模型模仿标注答案，无法区分好和更好的回答；DPO通过偏好对比让模型学会在多个可行回答中选出更优的，解决SFT的优化天花板"
  analogy: "SFT是教小孩写对字(模仿)，DPO是教他写好作文(在多个正确写法中选更好的)——会写字不等于写得好"
  first_principle: "SFT的本质是最大似然(模仿)，DPO的本质是偏好优化(比较)，两个优化目标不同"
  key_points:
    - 'SFT局限: 只有一个标准答案，无法学习偏好'
    - 'DPO原理: 直接用偏好对(chosen vs rejected)优化，无需训练Reward Model'
    - 'DPO公式: 让chosen概率/ rejected概率的比值增大'
    - 'SFT后接DPO: SFT打底能力，DPO优化质量'
first_principle:
  essence: "偏好对齐是从模仿到优化的跃迁"
  derivation: "SFT数据是(输入→标准答案) → 模型学到了基本能力 → 但同一问题有多个好答案 → SFT只学一个 → 需要对比学习哪个更好 → DPO直接从偏好对学习"
  conclusion: "SFT解决'能不能做对'，DPO解决'能不能做好'"
follow_up:
  - "DPO和RLHF/PPO的区别？各自优缺点？"
  - "DPO训练数据怎么构造？需要多少对？"
  - "什么情况下DPO会让模型变差？"
---

# 为什么做了 SFT 还要做 DPO？

## SFT 的天花板

```
SFT训练目标: P(标准答案 | 输入) → 最大

问题: 标准答案只有一个，但同一个问题有多种回答方式
  - 有些回答更安全
  - 有些回答更详细
  - 有些回答更简洁
  - 有些回答更有帮助

SFT无法表达"回答A比回答B更好"这种偏好信息
→ 需要DPO/RLHF来学习偏好
```

## SFT vs DPO vs RLHF 对比

```
┌────────────────────────────────────────────────┐
│                                                │
│  SFT (监督微调)                                 │
│  数据: (输入, 标准答案)                          │
│  目标: 模仿标准答案                              │
│  类比: 抄写课文                                 │
│  能力: ✅ 学会格式和基础能力                      │
│        ❌ 不知道什么回答更好                      │
│                                                │
│  RLHF (人类反馈强化学习)                         │
│  数据: (输入, 多个回答) → 人工排序 → 训练RM      │
│  流程: SFT → 训练Reward Model → PPO优化         │
│  类比: 老师打分 → 学生根据打分改进                │
│  能力: ✅ 学会人类偏好                           │
│        ❌ 训练复杂、不稳定(PPO超参敏感)            │
│                                                │
│  DPO (直接偏好优化)                              │
│  数据: (输入, 好答案, 坏答案) 偏好对              │
│  流程: SFT → 直接用偏好对优化(无需RM)            │
│  类比: 红蓝对比 → 直接告诉哪个好                 │
│  能力: ✅ 学会偏好                               │
│        ✅ 训练简单(类似SFT)、稳定                │
│                                                │
└────────────────────────────────────────────────┘
```

## DPO 原理

### 偏好对数据

```python
preference_data = {
    "prompt": "如何学习机器学习？",
    "chosen": "建议从基础数学(线代/概率)开始，然后看Andrew Ng的课程...", # 有条理
    "rejected": "随便看看书就行了，不用太认真。" # 敷衍
}
```

### DPO 目标函数

```
L_DPO = -E[log σ(β · (log π(y_w|x)/π_ref(y_w|x) - log π(y_l|x)/π_ref(y_l|x)))]

解读:
  π: 当前模型 (训练中)
  π_ref: SFT模型 (固定参考)
  y_w: 好答案 (chosen)
  y_l: 坏答案 (rejected)
  β: 控制偏离参考模型的程度

直觉:
  让 π(好答案) / π_ref(好答案) > π(坏答案) / π_ref(坏答案)
  即: 相比SFT模型，当前模型更倾向于输出好答案
```

### 为什么 DPO 不需要 Reward Model

```
RLHF流程: 数据 → Reward Model → PPO优化 → Policy
  问题: RM可能过拟合, PPO训练不稳定

DPO的数学推导:
  RL的目标 = 最大化 reward - KL(π, π_ref)
  → 最优解: π*(y|x) = π_ref(y|x) * exp(r(x,y)) / Z(x)
  → 反解: r(x,y) = β * log(π*(y|x) / π_ref(y|x)) + const
  → 代入偏好概率: P(y_w > y_l) = σ(r(y_w) - r(y_l))
  → 最终: 不需要显式r，直接用log-ratio!
```

## 什么时候 DPO 会让模型变差

```
⚠️ DPO的已知问题:

1. 过度优化(Over-optimization)
   → DPO训练太多步 → 模型变得过于保守
   → 所有回答趋于模板化 → 多样性下降

2. 分布外偏好(Distribution Mismatch)
   → 偏好数据来自GPT-4的输出
   → 但训练的是7B小模型
   → 小模型模仿不了GPT-4的风格 → 训练信号无效

3. 在线vs离线
   → 标准DPO是离线的(用固定数据集)
   → 模型不探索新的好答案
   → 改进: Online DPO / Iterative DPO

4. 简单被拒绝的答案
   → 如果rejected答案太差(如乱码)
   → 模型学到的是"不要乱码"而非"要更好"
   → 偏好对质量 > 数量
```

## 工业界实践

```
典型训练流程:
  1. 预训练 (Pre-training): 海量文本, ~1T tokens
  2. SFT (Supervised Fine-Tuning): 5万-50万条高质量对话
  3. DPO (Direct Preference Optimization): 1万-10万偏好对
  4. (可选) RLHF/PPO: 更精细的在线优化

DPO数据量经验:
  - 1万对: 可见效果
  - 5万对: 明显提升
  - 10万对: 收益递减
  - 质量远比数量重要
```
