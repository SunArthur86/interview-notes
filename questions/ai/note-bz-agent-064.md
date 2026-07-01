---
id: note-bz-agent-064
difficulty: L3
category: ai
subcategory: Agent
tags:
- B站面经
- LangGraph
- Agent应用
feynman:
  essence: 基于LangGraph搭Agent=定义State→构建节点(Node)→连边(Edge)→编译。核心是把Agent建模为状态图，节点是动作，边是流转，天然支持循环和分支。
  analogy: 像画流程图——状态是节点，决策是分支，工具调用是动作，LangGraph把流程图变成可执行的Agent。
  first_principle: Agent本质是状态机+循环。LangGraph用图结构显式建模，比隐式的Chain更可控、可调试、可中断。
  key_points:
  - 四步：定义State→建节点→连边→编译
  - 核心概念：Node(节点)/Edge(边)/State(状态)
  - 关键能力：循环/条件分支/人工节点/检查点
  - 优势：可控可调试可中断
first_principle:
  essence: Agent是状态驱动的图——状态在节点间流转，节点修改状态，边决定流向。
  derivation: ReAct的Thought-Act-Obs是循环。Plan-Execute有分支。这些用代码写if-else难维护。LangGraph用图显式定义，可视化、可调试、支持复杂模式。
  conclusion: LangGraph = 把Agent建模为状态图（Node=动作，Edge=流转，State=数据）
follow_up:
- LangGraph和普通代码写Agent什么区别？——图结构更清晰可调试
- 怎么做人工审核？——interrupt_before节点+恢复机制
- 支持并行吗？——支持，多个节点可并发
memory_points:
- 核心三要素：State(状态：流转数据)、Node(节点：执行动作)、Edge(边：流转控制)
- 搭建四步法：1.定义State结构体 → 2.编写节点动作函数 → 3.连线(含条件分支) → 4.编译运行
- 条件边是灵魂：根据State中的变量(如是否需人工)动态决定下一跳节点，实现智能路由
---

# 如何基于 LangGraph 搭建一个 Agent 应用？

## 一、LangGraph 核心概念

```
┌──────────────────────────────────────────────┐
│              LangGraph 三要素                   │
├──────────────────────────────────────────────┤
│                                                │
│  State（状态）                                  │
│    在节点间流转的数据（TypedDict定义）            │
│    例: {messages, current_step, results}       │
│                                                │
│  Node（节点）                                   │
│    执行动作的函数，接收State返回新State           │
│    例: plan_node / execute_node / check_node   │
│                                                │
│  Edge（边）                                     │
│    节点间的流转，可以是固定的或条件分支            │
│    例: plan → execute → (条件) → check 或 END  │
│                                                │
└──────────────────────────────────────────────┘
```

## 二、搭建四步法

### Step 1：定义 State

```python
from typing import TypedDict, List, Annotated
from langgraph.graph import MessagesState

class AgentState(TypedDict):
    messages: list          # 对话历史
    current_plan: list      # 当前计划
    step_index: int         # 执行到第几步
    results: list           # 已完成的结果
    needs_human: bool       # 是否需要人工
    iteration: int          # 迭代次数（防死循环）
```

### Step 2：定义节点

```python
def plan_node(state: AgentState) -> AgentState:
    """规划节点：分解任务"""
    plan = llm.plan(state["messages"][-1])
    return {"current_plan": plan, "step_index": 0}

def execute_node(state: AgentState) -> AgentState:
    """执行节点：调用工具"""
    step = state["current_plan"][state["step_index"]]
    result = tool.execute(step)
    
    # 高风险操作需要人工
    if result.is_dangerous:
        return {"needs_human": True, "results": state["results"] + [result]}
    
    return {
        "results": state["results"] + [result],
        "step_index": state["step_index"] + 1,
        "iteration": state["iteration"] + 1
    }

def check_node(state: AgentState) -> AgentState:
    """检查节点：判断是否完成"""
    if state["step_index"] >= len(state["current_plan"]):
        return {"done": True}
    return state
```

### Step 3：连边

```python
from langgraph.graph import StateGraph, END

graph = StateGraph(AgentState)

# 添加节点
graph.add_node("plan", plan_node)
graph.add_node("execute", execute_node)
graph.add_node("check", check_node)
graph.add_node("human", human_review_node)

# 设置入口
graph.set_entry_point("plan")

# 固定边
graph.add_edge("plan", "execute")

# 条件边（分支）
def route_after_execute(state):
    if state.get("needs_human"):
        return "human"      # 需要人工审核
    return "check"          # 正常检查

graph.add_conditional_edges("execute", route_after_execute)

def route_after_check(state):
    if state.get("done"):
        return END          # 完成
    if state["iteration"] > MAX_ITER:
        return END          # 超限终止
    return "execute"        # 继续执行下一步

graph.add_conditional_edges("check", route_after_check)

# 人工审核后继续
graph.add_edge("human", "execute")
```

### Step 4：编译运行

```python
from langgraph.checkpoint.memory import MemorySaver

# 编译（可加检查点支持中断恢复）
app = graph.compile(
    checkpointer=MemorySaver(),
    interrupt_before=["human"]  # 人工节点前暂停
)

# 运行
config = {"configurable": {"thread_id": "session_1"}}
result = app.invoke(
    {"messages": [{"role": "user", "content": "帮我分析竞品"}]},
    config=config
)
```

## 三、图结构可视化

```
生成的Agent流程图：

        开始
         │
         ▼
    ┌─────────┐
    │  plan   │ ← 规划：分解任务
    └────┬────┘
         │
         ▼
    ┌─────────┐
    │ execute │◄────────────────┐
    └────┬────┘                  │
         │                       │
    needs_human?                 │
    ├──是──→ human ──────────────┤ 人工审核后继续
    │                            │
    └──否                        │
         │                       │
         ▼                       │
    ┌─────────┐     未完成        │
    │ check   │──────────────────┘ 继续执行
    └────┬────┘
         │ 完成
         ▼
        END
```

## 四、关键能力

### 人工审核（Human-in-the-loop）

```python
# 编译时设置中断点
app = graph.compile(interrupt_before=["human"])

# 运行到human节点前自动暂停
result = app.invoke(initial_state)

# 人工审核后恢复
# （人工通过界面确认后）
app.invoke(None, config=config)  # 从中断处继续
```

### 检查点（Checkpoint）

```python
# 长任务可保存状态，中断后恢复
app = graph.compile(checkpointer=SqliteSaver("agent.db"))

# 任务执行到一半崩溃
# → 状态已保存
# → 重启后从上次状态继续
```

### 流式输出

```python
# 流式获取每步结果
for event in app.stream(initial_state):
    print(event)  # 每个节点的输出实时返回
```

## 五、ReAct Agent（经典实现）

```python
# 用LangGraph实现ReAct（最经典的Agent模式）
def call_model(state):
    response = model.invoke(state["messages"])
    return {"messages": state["messages"] + [response]}

def call_tool(state):
    last_msg = state["messages"][-1]
    if last_msg.tool_calls:
        results = [execute(tc) for tc in last_msg.tool_calls]
        return {"messages": state["messages"] + results}
    return state

def should_continue(state):
    if state["messages"][-1].tool_calls:
        return "tools"
    return END

# 构建
graph = StateGraph(MessagesState)
graph.add_node("agent", call_model)
graph.add_node("tools", call_tool)
graph.set_entry_point("agent")
graph.add_conditional_edges("agent", should_continue)
graph.add_edge("tools", "agent")  # 工具执行后回到agent（循环）

react_agent = graph.compile()
```

## 六、面试加分点

1. **四步法清晰**：State→Node→Edge→Compile，标准化的搭建流程
2. **强调"图结构"优势**：可视化/可调试/支持循环分支——比代码 if-else 更清晰
3. **人工节点是亮点**：interrupt 机制支持 Human-in-the-loop，这是生产刚需

## 记忆要点

- 核心三要素：State(状态：流转数据)、Node(节点：执行动作)、Edge(边：流转控制)
- 搭建四步法：1.定义State结构体 → 2.编写节点动作函数 → 3.连线(含条件分支) → 4.编译运行
- 条件边是灵魂：根据State中的变量(如是否需人工)动态决定下一跳节点，实现智能路由

