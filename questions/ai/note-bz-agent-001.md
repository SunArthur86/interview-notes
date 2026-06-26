---
id: note-bz-agent-001
difficulty: L2
category: ai
subcategory: Agent
tags:
  - B站面经
  - Agent
  - 概念
  - LLM
feynman:
  essence: LLM是被动的"知识引擎"，Agent是主动的"行动派"——给LLM装上规划、记忆、工具三大外挂，让它从"只会说"变成"能干活"。
  analogy: LLM像一本百科全书（你问它答），Agent像一个员工（你给目标，它自己查资料、定计划、用工具、交付结果）。
  first_principle: LLM是状态less的函数（输入→输出），Agent是有状态的循环系统（感知→规划→行动→观察→再规划）。
  key_points:
    - LLM被动应答，Agent主动达成目标
    - Agent三大核心能力：规划+记忆+工具
    - Agent是循环系统，LLM是其中一环
    - 关系：Agent以LLM为大脑，外挂记忆和工具
first_principle:
  essence: Agent本质是"LLM+控制循环+外部能力"的闭环系统。
  derivation: '纯LLM：f(prompt)→text，无状态无副作用。Agent：引入循环（while not done）、记忆（读写外部状态）、工具（调用API产生真实效果），把LLM从"生成器"升级为"决策器"。'
  conclusion: Agent = LLM（决策核心） + Memory（状态） + Tools（执行） + Loop（控制流）
follow_up:
  - Agent和Workflow/工作流有什么区别？——工作流是固定路径，Agent是动态决策
  - 一个LLM加一个检索算Agent吗？——不算，缺少自主规划和工具调用闭环
  - LLM的哪些能力是Agent的基础？——推理、指令遵循、工具调用、自我反思
---

# 什么是 AI Agent？它和单纯的大模型（LLM）有什么区别和关系？

## 一、核心定义

**AI Agent（智能体）** = 以 LLM 为大脑，具备**感知、规划、记忆、工具使用**能力，能够**自主完成多步骤任务**的系统。

**单纯的大模型（LLM）** = 一个文本到文本的映射函数，输入 prompt 输出文本，**无状态、无记忆、无行动能力**。

## 二、五维度对比

```
┌────────────┬─────────────────────┬──────────────────────────────┐
│ 维度        │ LLM                  │ Agent                          │
├────────────┼─────────────────────┼──────────────────────────────┤
│ 主动性      │ 被动应答（你问它答）  │ 主动达成目标（给目标自己干）     │
│ 状态        │ 无状态（每次重新开始） │ 有状态（跨轮/跨会话记忆）        │
│ 行动        │ 只输出文本            │ 能调用工具产生真实效果           │
│ 控制流      │ 单次调用              │ 循环（规划→行动→观察→调整）      │
│ 任务粒度    │ 单步问答              │ 多步骤复杂任务                   │
└────────────┴─────────────────────┴──────────────────────────────┘
```

## 三、Agent 的三大核心能力

### 1. 规划（Planning）

```python
# LLM：给一步做一步
response = llm("帮我订一张去北京的机票")  # 只会输出文字建议

# Agent：自主分解任务
def agent_plan(goal):
    # LLM把大目标拆成可执行步骤
    steps = llm.plan("订去北京机票", context=memory.get())
    # 输出：1.查日程 2.比价 3.选航班 4.下单 5.通知
    for step in steps:
        result = execute(step)  # 调用真实工具
        if result.failed:
            steps = llm.replan(step, result.error)  # 失败重规划
```

### 2. 记忆（Memory）

```
短期记忆：当前对话上下文（Context Window）
长期记忆：向量数据库存储历史（跨会话）
工作记忆：当前任务的中间状态（任务进度、已收集信息）
```

### 3. 工具使用（Tool Use）

```python
# Agent能调用真实工具改变世界状态
tools = [
    {"name": "search_flight", "desc": "搜索航班"},
    {"name": "book_ticket", "desc": "下单订票"},
    {"name": "send_email", "desc": "发送通知"},
]
# LLM决定用哪个工具、传什么参数
action = llm.decide(context, tools)  # → book_ticket(flight=CA123)
```

## 四、关系：Agent 是 LLM 的"上层应用"

```
┌─────────────────────────────────────┐
│              Agent 系统               │
│  ┌─────────────────────────────┐    │
│  │      控制循环 (Loop)           │    │
│  │   while not goal_achieved:    │    │
│  │     plan → act → observe      │    │
│  │  ┌──────────────────────┐    │    │
│  │  │   LLM (决策大脑)      │ ← 记忆│    │
│  │  │   "下一步该做什么？"    │    │    │
│  │  └──────────┬───────────┘    │    │
│  │             ↓ 决策              │    │
│  │      [工具调用/工具调用]         │    │
│  │  search() book() email()        │    │
│  └─────────────────────────────┘    │
└─────────────────────────────────────┘
```

**关键关系：**
- LLM 是 Agent 的**必要组件**（决策核心），但 LLM ≠ Agent
- Agent 是 LLM 的**增强包装**：加了循环 + 记忆 + 工具
- 同一个 LLM，配不同的工具和提示词，能构建完全不同的 Agent

## 五、一个直观例子

**任务：帮我分析竞品并写一份报告**

| 步骤 | LLM 单独 | Agent |
|------|---------|-------|
| 1 | 无法上网，只能凭训练数据编 | 调用搜索工具爬取最新竞品信息 |
| 2 | 一次性生成全文（可能过时/幻觉） | 分步骤：搜集→分析→起草→自检→定稿 |
| 3 | 出错无法纠正 | 写完自检发现错误，重新搜集修正 |
| 4 | 无状态 | 记住你的偏好风格，下次沿用 |

## 六、面试加分点

1. **强调"自主性"**：Agent 的核心是 autonomy——给定目标后自主完成，而非逐步指令
2. **区分 Agentic 程度**：Workflow（固定流程）→ Agent（动态决策）→ Autonomous Agent（完全自主），不是二元的
3. **提 Anthropic 的定义**：Augmented LLM + Tools + Loop，简洁权威
