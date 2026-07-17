---
id: note-bz-agent-007
difficulty: L4
category: ai
subcategory: Agent
tags:
- B站面经
- Agent
- 调度
- 事件循环
- 状态机
feynman:
  essence: Agent底层调度逻辑=状态机+事件循环。每个Agent是有限状态机，事件循环驱动状态流转，LLM在状态转换时做决策，工具在状态内执行。
  analogy: 像红绿灯控制系统——状态机定义灯的颜色（红/黄/绿），事件循环是时钟，根据传感器（观察）和规则（决策）切换状态。
  first_principle: Agent是离散事件系统——时间是按"事件"推进的（用户输入/工具返回/定时器），而非连续。状态机建模离散状态，事件循环处理状态转换。
  key_points:
  - 调度核心：状态机建模+事件循环驱动
  - LLM在状态转换点做决策
  - 工具在状态内执行，结果作为事件触发转换
  - 调度策略：轮询/事件驱动/优先级队列
first_principle:
  essence: Agent的"自主性"本质是事件驱动的状态机——外部事件和内部决策共同推进状态演进。
  derivation: Agent不是线性执行的程序，而是响应式系统。它等待事件（用户消息/工具返回/定时器），事件触发状态转换，转换时调用LLM决策，决策产生新动作（工具调用）成为新事件。这就是Reactive Agent的本质。
  conclusion: Agent调度 = 状态机（建模） + 事件循环（驱动） + LLM（决策转换）
follow_up:
- 多Agent怎么调度？——消息队列+事件总线，每个Agent订阅感兴趣的事件
- 长任务怎么不阻塞？——异步IO+协程，工具调用期间Agent可处理其他请求
- 怎么保证调度公平？——优先级队列+超时机制+资源配额
memory_points:
- 底层本质：Agent的调度逻辑是一个有限状态机（FSM）结合事件循环
- 核心状态机：IDLE → PLANNING → EXECUTING → OBSERVING → REPLANNING/RESPONDING
- 驱动机制：由事件队列驱动，根据当前状态和接收到的事件查表决定状态转换
- 调度闭环：OBSERVING后若未完成或报错，触发循环回到PLANNING进行重规划
---

# Agent 的底层调度逻辑是什么？

## 一、Agent = 有限状态机（FSM）

```
Agent状态定义：

┌──────────┐     ┌──────────┐     ┌──────────┐
│  IDLE    │────→│ PLANNING │────→│ EXECUTING│
│ (等待输入) │ 用户  │ (LLM规划) │ 计划  │ (调工具)  │
└──────────┘ 事件  └────┬─────┘ 完成  └────┬─────┘
     ↑                 │                    │
     │                 │ 失败               │ 完成
     │                 ▼                    ▼
     │           ┌──────────┐         ┌──────────┐
     │           │REPLANNING│         │ OBSERVING│
     │           │ (重规划)  │         │ (观察结果) │
     │           └──────────┘         └────┬─────┘
     │                                     │
     │              ┌──────────┐           │
     └─────────────│RESPONDING│←──────────┘
              完成   │ (回复用户) │  目标达成
                    └──────────┘
```

```python
from enum import Enum

class AgentState(Enum):
    IDLE = "idle"              # 等待用户输入
    UNDERSTANDING = "understand"  # 理解意图
    PLANNING = "planning"      # 规划步骤
    EXECUTING = "executing"    # 执行工具
    OBSERVING = "observing"    # 观察结果
    REPLANNING = "replanning"  # 失败重规划
    RESPONDING = "responding"  # 生成回复
    ERROR = "error"            # 错误状态
    DONE = "done"              # 完成
```

## 二、事件循环（Event Loop）驱动调度

```python
import asyncio

class AgentScheduler:
    """Agent的事件循环调度器"""
    
    def __init__(self):
        self.state = AgentState.IDLE
        self.event_queue = asyncio.Queue()
        self.context = {}  # 工作记忆
    
    async def run(self):
        """主事件循环"""
        while self.state != AgentState.DONE:
            # 1. 等待事件
            event = await self.event_queue.get()
            # 2. 根据当前状态和事件，决定转换
            next_state = self.transition(self.state, event)
            # 3. 执行状态对应的动作
            await self.handle_state(next_state, event)
            self.state = next_state
    
    def transition(self, current, event):
        """状态转换函数（状态转移表）"""
        transitions = {
            (AgentState.IDLE, "user_input"): AgentState.UNDERSTANDING,
            (AgentState.UNDERSTANDING, "understood"): AgentState.PLANNING,
            (AgentState.PLANNING, "plan_ready"): AgentState.EXECUTING,
            (AgentState.EXECUTING, "tool_result"): AgentState.OBSERVING,
            (AgentState.OBSERVING, "need_more"): AgentState.PLANNING,
            (AgentState.OBSERVING, "goal_met"): AgentState.RESPONDING,
            (AgentState.OBSERVING, "error"): AgentState.REPLANNING,
            (AgentState.REPLANNING, "plan_ready"): AgentState.EXECUTING,
            (AgentState.RESPONDING, "done"): AgentState.DONE,
        }
        return transitions.get((current, event), AgentState.ERROR)
    
    async def handle_state(self, state, event):
        """每个状态的处理逻辑"""
        if state == AgentState.UNDERSTANDING:
            intent = await self.llm.understand(event.data)
            await self.event_queue.put(Event("understood", intent))
        elif state == AgentState.PLANNING:
            plan = await self.llm.plan(self.context)
            await self.event_queue.put(Event("plan_ready", plan))
        elif state == AgentState.EXECUTING:
            result = await self.execute_tool(event.data)
            await self.event_queue.put(Event("tool_result", result))
        # ...
```

## 三、LLM 在调度中的角色：决策转换器

```
传统状态机：转换规则是硬编码的（if-else）
Agent状态机：转换规则由LLM动态决定

┌──────────────┐
│ 当前状态+观察 │ ──→ LLM ──→ 下一步决策
│ +历史轨迹    │           （转向哪个状态）
└──────────────┘

例：OBSERVING状态，工具返回"库存不足"
  - 传统：固定走REPLANNING
  - Agent：LLM可能决定"换商品推荐"(PLANNING)
          或"告知用户并结束"(RESPONDING)
```

```python
async def agent_transition_with_llm(self, state, observation):
    """LLM驱动的状态转换"""
    prompt = f"""
    当前状态: {state}
    观察结果: {observation}
    历史轨迹: {self.context['trajectory']}
    目标: {self.context['goal']}
    
    决定下一步：
    - continue_planning: 继续规划（信息不足）
    - execute_next: 执行下一步
    - replan: 重新规划（失败）
    - respond: 回复用户（完成或无法继续）
    """
    decision = await self.llm.decide(prompt)
    return AgentState(decision)
```

## 四、工具调用的调度策略

### 1. 同步串行（简单场景）

```python
# 一个工具完成后再调下一个
for tool in plan.tools:
    result = await tool.run()  # 阻塞等待
```

### 2. 异步并发（独立任务）

```python
# 多个无依赖的工具并发执行
results = await asyncio.gather(*[
    tool.run() for tool in independent_tools
])
```

### 3. 优先级调度（资源受限）

```python
import heapq

class PriorityScheduler:
    def __init__(self):
        self.queue = []  # 优先级队列
    
    def schedule(self, task, priority):
        heapq.heappush(self.queue, (priority, task))
    
    async def run(self):
        while self.queue:
            _, task = heapq.heappop(self.queue)
            await task.execute()
```

## 五、多 Agent 调度：消息总线

```
┌──────────────────────────────────────────┐
│              事件总线 (Event Bus)           │
│   pub/sub 模式，Agent间通过事件通信         │
├──────────────────────────────────────────┤
│  Agent A ──publish("data_ready")──→ Bus   │
│  Agent B ←──subscribe("data_ready")── Bus │
│  Agent C ←──subscribe("data_ready")── Bus │
└──────────────────────────────────────────┘

每个Agent是独立的FSM，通过事件总线协调
调度器负责：路由事件 / 管理Agent生命周期 / 资源分配
```

## 六、面试加分点

1. **用状态机建模**：把 Agent 抽象为 FSM，比单纯讲"循环"更有体系，体现系统工程思维
2. **强调"事件驱动"**：现代 Agent（如 LangGraph）本质是事件驱动的状态机，这是理解框架底层的关键
3. **LLM 是转换函数**：LLM 在调度中的角色是"决定状态转换"，而非执行——执行交给工具和事件循环

## 记忆要点

- 底层本质：Agent的调度逻辑是一个有限状态机（FSM）结合事件循环
- 核心状态机：IDLE → PLANNING → EXECUTING → OBSERVING → REPLANNING/RESPONDING
- 驱动机制：由事件队列驱动，根据当前状态和接收到的事件查表决定状态转换
- 调度闭环：OBSERVING后若未完成或报错，触发循环回到PLANNING进行重规划


## 苏格拉底式面试追问

> 这组追问模拟面试官层层逼问，每一问先回答"为什么"，再回答"怎么做"，最后回答"如何证明"。

### 第一层：目标与动机

**Q：你说 Agent 底层调度是"状态机+事件循环"，为什么不能是简单的"顺序执行"（调用 LLM→拿结果→输出）？状态机解决了什么顺序执行做不到的问题？**

顺序执行只能处理"单轮无分支"的任务（输入→LLM→输出）。Agent 的核心是"基于反馈的多步决策"——LLM 输出后要根据内容决定下一步（调工具？继续推理？终止？），这是条件分支。状态机解决这个问题：定义状态（如 IDLE/PLANNING/ACTING/OBSERVING/DONE），每个状态有转换规则（如 ACTING 状态下，工具返回成功→OBSERVING，工具失败→RETRY 或 FALLBACK）。顺序执行无法表达"工具失败重试""循环调用直到满足条件""异常分支降级"这些复杂控制流。状态机把"控制逻辑"从 prompt 里剥离到代码层，让 LLM 只负责"决策内容"（调什么工具），代码层负责"控制流转"（失败怎么办），职责清晰。

### 第二层：证据与定位

**Q：Agent 跑着跑着卡在某个状态不动（如一直停在 ACTING），你怎么定位是状态机的 bug 还是 LLM 的问题？**

看状态转换日志。状态机每次状态转换都应该有日志（从 X 状态因 Y 事件转到 Z 状态）。卡在 ACTING 说明：1）工具调用没返回（外部 API 超时，状态机在等回调）——看工具调用的网络日志；2）工具返回了但状态机没处理（事件没触发转换）——状态机的 bug，检查事件处理器；3）LLM 在 ACTING 状态持续生成 Action 但都失败（如参数错）——LLM/工具描述问题。区分方法：看工具调用的 wall-clock 时间，如果超过设置的 timeout（如 30s）还没回调，是工具/API 问题；如果工具秒回但状态没变，是状态机事件处理 bug；如果工具秒回且状态转到了 OBSERVING 但 LLM 又生成失败的 Action 回到 ACTING，是 LLM/工具问题。

### 第三层：根因深挖

**Q：状态机的"状态"怎么设计？状态太少（如只有 IDLE/ACTIVE/DONE）不够用，太多（几十个）又难维护，怎么把握粒度？**

按"控制流的分支点"定义状态，不是按"任务步骤"定义。控制流分支点是"需要不同处理逻辑的决策时刻"——如"是否要调工具"（PLANNING→ACTING vs PLANNING→RESPONDING）、"工具是否成功"（ACTING→OBSERVING vs ACTING→RETRYING）、"是否终止"（任何状态→DONE）。典型 Agent 状态机 5-7 个状态足够：IDLE（等待输入）→PLANNING（LLM 推理决策）→ACTING（执行工具）→OBSERVING（处理结果）→RETRYING（失败重试）→RESPONDING（生成最终回复）→DONE。不要按业务步骤（如"查询状态/分析状态/建议状态"）定义——那是任务逻辑，应该放在 prompt/LLM 推理里，不是状态机。状态机管"控制流"，LLM 管"任务逻辑"。

**Q：事件循环驱动状态流转，但如果多个事件同时到达（如工具回调和用户打断同时来），状态机怎么处理并发？**

用事件队列串行化处理 + 优先级。状态机本身是单线程的（一次只在一个状态），事件放进队列，按优先级处理：用户打断（高优先级，如"停止"指令）插队处理，工具回调（中优先级）按序处理。并发场景的关键是"状态一致性"——处理事件时检查当前状态是否兼容该事件（如当前在 DONE 状态，迟到的工具回调应丢弃，不该触发状态转换）。复杂场景（如多 Agent 并行协作）用多个独立状态机 + 消息总线通信，每个 Agent 一个状态机，不共享状态。不要在单状态机里做并发（状态转换的竞态条件极难 debug），而是"单状态机串行 + 多状态机并行"。

### 第四层：方案权衡

**Q：状态机 vs 用 LangGraph 的图结构（DAG）做调度，两者什么区别？实际项目怎么选？**

状态机是图结构的特例。状态机 = 状态（节点）+ 事件驱动转换（边），本质是一个图。LangGraph 的图更通用——支持条件分支、循环、并行节点、子图，表达能力是状态机的超集。区别在于抽象层次：状态机偏底层（要自己写状态定义、转换规则、事件循环），LangGraph 偏高层（声明式定义节点和边，框架自动跑执行循环）。实际项目：简单的单 Agent 控制流用状态机（轻量、可控、易调试）；复杂工作流（多节点/并行/人工审批/子图）用 LangGraph（声明式开发效率高）。但理解状态机原理是基础——即使用 LangGraph，底层还是状态机+事件循环，出了问题要能 debug 到这一层。

**Q：为什么不直接用代码的 if-else/while 实现控制流（如 `while not done: result = llm(); if need_tool: call_tool()`），而要抽象成状态机？**

简单场景 if-else/while 够用（Demo 级）。但生产场景有三个问题：1）状态爆炸——加 retry、timeout、fallback、用户打断后，if-else 嵌套层数爆炸，可读性崩塌；2）不可观测——if-else 的控制流在代码里，没有"当前在哪个状态"的显式信号，监控/调试难；3）不可扩展——加新状态（如"等待人工审批"）要改 if-else 结构，侵入性强。状态机把控制流"声明式化"——状态和转换规则用配置/表定义，加状态只改配置不改主循环，当前状态显式可查（监控直接看 state 字段）。所以 Demo 用 if-else 快，生产用状态机（或 LangGraph）可维护。

### 第五层：验证与沉淀

**Q：你怎么验证状态机的转换逻辑是正确的，没有"死状态"（进了出不来）或"不可达状态"（定义了但永远到不了）？**

形式化验证 + 测试。1）死状态检测——画出状态转换图，找"出度为 0 的非终止状态"（没有出去的边且不是 DONE），这些是死状态，要补转换规则或删除；2）不可达状态检测——从初始状态做 BFS/DFS 遍历，没被遍历到的状态是不可达的，要么删除要么补"进入该状态的转换"；3）测试覆盖——为每个状态转换写测试用例（如"PLANNING 状态下 LLM 输出 tool_call→应转到 ACTING"），用 mock LLM 输出驱动状态机，验证转换正确。复杂状态机建议用形式化验证工具（如 TLA+）做模型检查，自动发现死锁/不可达。线上再配监控——统计各状态的进入次数和停留时间，某状态停留过久（如 ACTING 平均 30s 但某次卡 5min）告警。

**Q：Agent 的状态机设计经验怎么沉淀成框架能力，让新 Agent 不从零写状态机？**

封装成 AgentRuntime 框架：1）预置状态模板——提供标准 5-7 状态（IDLE/PLANNING/ACTING/OBSERVING/RETRYING/RESPONDING/DONE）+ 转换规则，新 Agent 继承后只覆盖"每个状态的处理器"（如 PLANNING 状态调用哪个 LLM prompt）；2）事件循环引擎——内置事件队列、优先级、超时、重试，开发者不用手写；3）状态可视化——自动生成状态转换图 + 当前状态实时上报到 dashboard；4）死锁/超时告警——自动检测卡死状态。新 Agent 定义"业务逻辑"（prompt+工具），框架提供"控制流"，组合即可。这套写入团队 Agent 框架 SOP，状态机从"每个项目重新设计"变成"框架默认能力"。

## 结构化回答

**30 秒电梯演讲：** Agent底层调度逻辑=状态机+事件循环。每个Agent是有限状态机，事件循环驱动状态流转，LLM在状态转换时做决策，工具在状态内执行。

**展开框架：**
1. **调度核心** — 状态机建模+事件循环驱动
2. **LLM** — LLM在状态转换点做决策
3. **工具在状态** — 工具在状态内执行，结果作为事件触发转换

**收尾：** 您想深入聊：多Agent怎么调度？——消息队列+事件总线，每个Agent订阅感兴趣的事件？


## 视频脚本

> 预计时长：5 分钟 | 由浅入深


| 时间 | 画面/字幕 | 口播台词 | 讲解要点 |
|------|----------|----------|----------|
| 0:00 | 标题卡：Agent 的底层调度逻辑是什么？ | "像红绿灯控制系统——状态机定义灯的颜色（红/黄/绿），事件循环是时钟，根据传感器（观察）和…" | 开场钩子 |
| 0:20 | 核心概念图 | "Agent底层调度逻辑=状态机+事件循环。每个Agent是有限状态机，事件循环驱动状态流转，LLM在状态转换时做决策，工…" | 核心定义 |
| 0:50 | 调度核心示意图 | "调度核心——状态机建模+事件循环驱动" | 要点拆解1 |
| 1:30 | LLM示意图 | "LLM——LLM在状态转换点做决策" | 要点拆解2 |
| 2:20 | 对比/实战案例图 | "对比一下常见误区和工程实践，看真实场景里怎么取舍。" | 实战与对比 |
| 3:10 | 总结卡 | "记住核心要点。下期我们追问：多Agent怎么调度？——消息队列+事件总线，每个Agent？" | 收尾与钩子 |
