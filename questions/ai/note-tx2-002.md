---
id: note-tx2-002
difficulty: L4
category: ai
subcategory: Agent
tags:
- 腾讯
- 面经
- 推理范式
- CoT
- ReAct
- ToT
feynman:
  essence: 四种推理范式——CoT(链式思维，线性逐步推理)适合简单推理题；ReAct(推理+行动循环)适合需要调工具的任务，边想边查；ToT(树状思维，多路径探索+回溯)适合需要探索多方案的复杂问题；Plan&Execute(先全局规划后执行)适合步骤明确的长任务。选型按"任务复杂度+是否需探索+步骤确定性"三维度。
  analogy: CoT像走直线（一条路走到黑），ReAct像边走边问路（想一步做一步），ToT像走迷宫（多条路试探，错了回溯），Plan&Execute像先看地图规划路线再出发。
  first_principle: 推理范式 = 在"规划深度"和"执行灵活性"之间权衡。CoT 最简单但僵硬，ReAct 灵活但可能发散，ToT 全面但昂贵，Plan&Execute 结构化但规划可能过时。
  key_points:
  - 'CoT: 链式逐步推理，简单推理题，无工具调用'
  - 'ReAct: Thought-Action-Observation循环，边推理边调工具'
  - 'ToT: 树状多路径探索+回溯，复杂问题需探索多方案'
  - 'Plan&Execute: 先全局规划再执行，步骤明确的长任务'
  - '选型：简单→CoT；需工具→ReAct；需探索→ToT；步骤明确→Plan&Execute'
first_principle:
  essence: 推理范式 = 规划深度 × 执行灵活性的权衡
  derivation: 简单任务一条链够(CoT) → 需调工具加循环(ReAct) → 需探索多方案加分支回溯(ToT) → 步骤明确先规划(Plan&Execute) → 复杂度递增，成本递增
  conclusion: 没有最好的范式，只有最匹配任务复杂度的范式
follow_up:
- ReAct 怎么防止"想太多"无限循环？
- ToT 的分支评估函数怎么设计？
- Plan&Execute 规划过时怎么动态调整？
---

# 【某讯面经】CoT / ReAct / ToT / Plan&Verify 适用场景对比，项目怎么选型

## 一、四种范式对比

| 范式 | 结构 | 适合 | 成本 |
|------|------|------|------|
| **CoT** | Thought → Thought → ... → Answer | 简单推理题（数学/逻辑） | 低 |
| **ReAct** | Thought → Action → Observation → ... → Answer | 需要调工具的任务 | 中 |
| **ToT** | 多分支探索 + 评估 + 回溯 | 需探索多方案的复杂问题 | 高 |
| **Plan&Execute** | 先出完整 Plan，再逐步 Execute | 步骤明确的长任务 | 中 |

## 二、CoT（Chain-of-Thought）链式思维

```
Prompt: 让我们一步一步思考...
Thought 1: 题目要求...
Thought 2: 根据条件...
Thought 3: 所以答案是...
Answer: X
```

**特点**：线性、无工具调用、纯推理。
**适合**：数学题、逻辑推理、常识问答。
**局限**：无法获取外部信息（不能调工具）。

**Zero-shot CoT**：加"Let's think step by step"。
**Few-shot CoT**：给几个带推理过程的例子。

## 三、ReAct（Reasoning + Acting）推理+行动

```
Question: 北京今天的天气怎么样？

Thought 1: 我需要查询北京今天的天气
Action 1: search_weather("北京")
Observation 1: 北京今天晴，25℃
Thought 2: 我得到了答案
Answer: 北京今天晴，气温25℃
```

**特点**：Thought-Action-Observation 循环，边推理边调工具。
**适合**：需要调工具的任务（搜索、查DB、计算）。
**优势**：灵活，能根据观察结果调整下一步。
**局限**：可能"想太多"无限循环（要设步数上限）。

**防循环**：
- 硬上限（最多 N 步）
- 去重（同工具同参数不重复调）
- 早停（置信度够就停）

## 四、ToT（Tree-of-Thoughts）树状思维

```
问题：策划一个营销方案

        [初始状态]
       /     |     \
  [方案A] [方案B] [方案C]    ← 多分支探索
   /  \     |      
 [A1][A2]  [B1]               ← 继续展开
 评估 评估   评估               ← 每个节点评估
   ↓
 选最优路径（回溯差的分支）     ← 剪枝+回溯
```

**特点**：多路径并行探索 + 评估函数 + 回溯剪枝。
**适合**：需要探索多方案的复杂问题（创意策划、博弈、24点游戏）。
**优势**：能找到全局最优解（不像 CoT 一条路走到黑）。
**局限**：成本高（LLM 调用次数 = 节点数）。

**评估函数设计**：让 LLM 给每个候选打分（"这个方案可行性 0-10 分"），选高分继续展开。

## 五、Plan&Execute（先规划后执行）

```
[Plan 阶段]
  LLM 一次性生成完整计划：
    Step 1: 查销售数据
    Step 2: 算同比
    Step 3: 分析异常
    Step 4: 生成建议

[Execute 阶段]
  逐步执行每个 Step（可能用 ReAct 执行单步）
  执行后检查：是否需要重新规划？
```

**特点**：先全局规划，再逐步执行。
**适合**：步骤明确的长任务（数据分析、报告生成、多步流程）。
**优势**：结构化，可中途断点续传。
**局限**：规划可能过时（执行中发现计划错了，要动态调整）。

**动态调整**：执行每步后，Critic 评估"剩余计划还合理吗"，不合理就重新 Plan。

## 六、选型决策树

```
任务需要调工具吗？
├─否 → 简单推理题？
│      ├─是 → CoT
│      └─否 → 需要探索多方案？
│             ├─是 → ToT
│             └─否 → CoT
└─是 → 步骤明确且长？
       ├─是 → Plan&Execute
       └─否 → 需要边想边查？
              ├─是 → ReAct
              └─否 → Plan&Execute（先规划再 ReAct 执行）
```

## 七、项目实战选型

| 场景 | 选谁 | 理由 |
|------|------|------|
| 客服问答（查知识库） | **ReAct** | 边问边查，灵活 |
| 数学题求解 | **CoT** | 纯推理 |
| 营销方案策划 | **ToT** | 需探索多方案 |
| 数据分析报告 | **Plan&Execute** | 步骤明确（查-算-析-写） |
| 复杂研究（多跳问答） | **ReAct + Plan** | 先规划子问题，再 ReAct 逐个查 |

## 八、加分点

- 说出 **ReAct 是当前主流**：因为多数 Agent 任务都需要调工具，ReAct 的 Thought-Action-Observation 循环最通用
- 说出 **Plan&Execute + ReAct 组合**：Plan 阶段出全局计划，Execute 阶段每步用 ReAct（兼顾结构化和灵活性）
- 说出 **ToT 的成本控制**：限制树深度 + 限制分支数 + 早期剪枝

## 九、雷区

- ❌ 所有任务都用 ToT → 成本爆炸（ToT 调用次数是 CoT 的 N 倍）
- ❌ ReAct 不设步数上限 → 无限循环烧钱
- ❌ Plan&Execute 不动态调整 → 计划过时还硬执行

## 十、扩展

- **Self-Consistency**：CoT 的增强版，采样多条推理路径，多数投票选答案，提升准确率
- **Reflexion**：ReAct + 反思，执行失败后反思原因再重试，自我进化
- **LATS（Language Agent Tree Search）**：ToT + MCTS（蒙特卡洛树搜索），更系统的探索
