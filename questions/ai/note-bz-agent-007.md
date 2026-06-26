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
  derivation: 'Agent不是线性执行的程序，而是响应式系统。它等待事件（用户消息/工具返回/定时器），事件触发状态转换，转换时调用LLM决策，决策产生新动作（工具调用）成为新事件。这就是Reactive Agent的本质。'
  conclusion: Agent调度 = 状态机（建模） + 事件循环（驱动） + LLM（决策转换）
follow_up:
  - 多Agent怎么调度？——消息队列+事件总线，每个Agent订阅感兴趣的事件
  - 长任务怎么不阻塞？——异步IO+协程，工具调用期间Agent可处理其他请求
  - 怎么保证调度公平？——优先级队列+超时机制+资源配额
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
