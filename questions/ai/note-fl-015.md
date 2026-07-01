---
id: note-fl-015
difficulty: L4
category: ai
subcategory: LLM
tags:
- 字节
- 飞连
- 面经
- SFT
- RLHF
- DPO
feynman:
  essence: SFT 监督微调让模型学会"指令→答案"格式；RLHF 用人类偏好训 Reward Model 再用 PPO 优化策略；DPO 直接用偏好数据优化策略跳过 RM。为什么 SFT 后还要偏好优化？SFT 只会"模仿"标注答案格式，不会区分"哪个回答更好"——偏好优化让模型学到 helpful/harmless/honest 排序信号，对话体验质变。工业主流是 SFT→DPO（PPO 太贵少用）。
  analogy: SFT 像教小孩照着范文抄写（学会格式），RLHF/DPO 像老师批改"这个回答比那个好"（学会排序）。只会抄写的小孩不会分辨好坏，需要批改反馈才能进步。
  first_principle: SFT 学的是"模仿"，偏好优化学的是"排序"。模仿只能达到标注数据上限，排序能让模型学到超越标注的偏好信号（什么回答更 helpful/harmless）。
  key_points:
  - 'SFT: 监督微调学"指令→答案"格式，答案质量上限决定模型上限'
  - 'RLHF: 用人类偏好训RM再用PPO优化，训练不稳定超参敏感贵'
  - 'DPO: 直接用偏好数据优化策略跳过RM，稳定便宜效果接近PPO'
  - SFT后还要偏好优化：SFT只模仿不排序，偏好优化让模型学到3H(helpful/harmless/honest)
  - 工业主流：SFT→DPO(或ORPO/KTO变体)，PPO太贵少用
first_principle:
  essence: 模型训练 = 模仿(SFT) + 排序(偏好优化)
  derivation: 预训练模型只会续写 → SFT 教会指令跟随格式 → 但不会区分好坏 → 偏好优化教排序 → 模型学会 3H → 对话体验质变
  conclusion: SFT 决定下限（格式对不对），偏好优化决定上限（回答好不好）
follow_up:
- DPO 的损失函数推导？为什么跳过 RM 等价于 RLHF？
- ORPO / KTO / SimPO 这些变体相比 DPO 改进了什么？
- RM 怎么标注？标注一致性怎么保证？
memory_points:
- SFT 学格式模仿：数据是(指令, 答案)，难点在答案质量决定模型上限，但无法区分好坏。
- RLHF 学偏好排序：训 RM+PPO，能实现3H(有用无害诚实)，但4个模型同跑导致显存爆炸且不稳。
- DPO 主流替代：跳过显式训 RM，直接用偏好对数据一步优化策略，更稳定省钱。
- 加分项：说出 DPO 基于 Bradley-Terry 模型将最优 RM 与策略建立解析关系。
---

# 【字节飞连面经】SFT vs RLHF vs DPO：做什么 / 数据形态 / 难点

## 一、三阶段对比

| 阶段 | 做什么 | 数据形态 | 难点 |
|------|--------|---------|------|
| **SFT** | 监督微调，让模型学会"指令→答案"的格式 | (prompt, response) | 答案质量上限决定模型上限 |
| **RLHF** | 用人类偏好训 Reward Model，再用 PPO 优化 | (prompt, response_A, response_B, 谁更好) | 训练不稳定、超参敏感、贵 |
| **DPO** | 直接用偏好数据优化策略，**跳过 RM** | 同 RLHF 偏好对 | 稳定、便宜、效果接近 PPO |

## 二、完整训练流程

```
[1] Pretrain（预训练）
    │  海量无标注文本，next token prediction
    │  学会语言能力（续写）
    ▼
[2] SFT（监督微调）
    │  人工标注 (指令, 高质量答案)
    │  学会"指令跟随"格式
    ▼
[3] 偏好优化（RLHF 或 DPO）
    │  人工标注 (指令, 好答案, 坏答案)
    │  学会"哪个回答更好"
    │  → helpful / harmless / honest
```

## 三、为什么 SFT 后还要偏好优化

**SFT 只会"模仿"，不会"排序"**：
- SFT 学的是"给定指令，输出类似标注答案的内容"
- 但**不会区分"哪个回答更好"**
- 比如两个回答都格式正确，但一个更 helpful、一个更啰嗦——SFT 分不出来

**偏好优化让模型学到 3H**：
- **Helpful**：真正解决问题
- **Harmless**：不输出有害内容
- **Honest**：不编造（减少幻觉）

这些是排序信号，SFT 给不了。

## 四、RLHF 怎么做（已被 DPO 替代但要知道）

```
[1] 训 Reward Model（RM）
    │  人工标注 (prompt, response_A, response_B, A比B好)
    │  训一个分类器：给 (prompt, response) 打分
    ▼
[2] PPO 优化策略
    │  让 LLM 生成回答 → RM 打分 → 用分数做强化学习
    │  最大化 RM 分数 + KL 惩罚（防止偏离 SFT 模型太远）
```

**RLHF 的痛点**：
- 训练不稳定（PPO 超参敏感）
- 需要 4 个模型同时跑（policy / ref / reward / value）→ 显存爆炸
- RM 容易被 reward hacking（模型钻 RM 漏洞刷分）

## 五、DPO 怎么做（工业主流）

```
直接用偏好数据优化策略，跳过 RM：

  L_DPO = -log σ(β·[log π(y_win|x)/π_ref(y_win|x) 
                     - log π(y_lose|x)/π_ref(y_lose|x)])
```

**核心思想**：数学上可以证明，最优策略可以用偏好数据直接推导，不需要显式训 RM。DPO 把 RLHF 的两步（训RM+PPO）合并成一步（直接用偏好对训策略）。

**DPO 优势**：
- 稳定（无 PPO 的方差问题）
- 便宜（只需 2 个模型：policy + ref）
- 效果接近 PPO

## 六、加分点

- 说出 **DPO 数学推导的关键**：通过 Bradley-Terry 模型，把"最优 RM"和"最优策略"建立解析关系，从而跳过显式 RM
- 说出 **变体**：
  - **ORPO**：把 SFT 和偏好优化合并成一步（不需要单独 SFT）
  - **KTO**：只需要（prompt, response, 好坏标签），不需要成对偏好数据
  - **SimPO**：去掉 ref model，用长度归一化，更省显存

## 七、扩展

- **RM 标注一致性**：多人标注偏好会有分歧，用 Cohen's Kappa 衡量一致性，低一致性的数据要剔除
- **Reward Hacking**：模型钻 RM 漏洞刷分（如输出 RM 偏好的特定词）→ 用 KL 惩罚 + 多 RM 集成缓解
- **RLAIF**（Constitutional AI）：用 AI 代替人工标注偏好（Anthropic 的方法），降低标注成本

## 记忆要点

- SFT 学格式模仿：数据是(指令, 答案)，难点在答案质量决定模型上限，但无法区分好坏。
- RLHF 学偏好排序：训 RM+PPO，能实现3H(有用无害诚实)，但4个模型同跑导致显存爆炸且不稳。
- DPO 主流替代：跳过显式训 RM，直接用偏好对数据一步优化策略，更稳定省钱。
- 加分项：说出 DPO 基于 Bradley-Terry 模型将最优 RM 与策略建立解析关系。

