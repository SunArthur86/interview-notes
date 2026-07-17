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


## 苏格拉底式面试追问

> 这组追问模拟面试官层层逼问，每一问先回答"为什么"，再回答"怎么做"，最后回答"如何证明"。

### 第一层：目标与动机

**Q：基于 LangGraph 搭 Agent 的步骤是"定义 State→建 Node→连 Edge→编译"，为什么要把 Agent 建模为"状态图"而非"顺序代码"（如写函数顺序调）？**

因为 Agent 的执行是"非确定性的状态流转"。1）非确定性——Agent 的下一步取决于当前状态（如 LLM 判断"信息够了吗"决定继续查还是回答），顺序代码（固定 A→B→C）无法表达这种"按状态分支/循环"；状态图用节点（动作）+边（流转条件）+状态（当前信息），天然表达；2）循环——Agent 的"思考-行动-观察"是循环（多轮直到完成），顺序代码要递归/while hack，状态图的边可成环（自然表达循环）；3）状态管理——Agent 跨步骤共享信息（对话历史/中间结果/任务上下文），状态图显式管理 State（结构化+在节点间传递），顺序代码的状态是隐式（全局变量/参数传递，易乱）；4）可观测/调试——状态图显式（节点/边/状态可视化），易调试（看状态流转卡在哪），顺序代码控制流隐式（难看全貌）。所以状态图建模是"贴合 Agent 的非确定/循环/状态特性"，顺序代码不适合。

### 第二层：证据与定位

**Q：用 LangGraph 搭的 Agent 卡住（如循环不退出/状态不更新），怎么定位？**

用 LangGraph 的 trace 和状态检查。1）trace（LangSmith）——看 Agent 的执行链路（节点流转/LLM 调用），找卡住点（如某节点循环不退出/某 LLM 调用超时）；2）状态检查——LangGraph 的 State 在每个节点后可检查（如打印 State），看状态是否正确更新（如"信息够了"标志是否置位），如果状态没更新导致流转条件不满足（如停止条件依赖某状态但没更新），是状态更新问题；3）流转条件——看 Edge 的条件（如"if 信息够 → 结束 else → 继续查"），条件判断逻辑错（如判断不准）会导致循环不退出；4）节点逻辑——定位到具体节点后，看该节点的逻辑（如 LLM 判断/工具调用），找节点级问题。定位方法：trace→状态检查→流转条件→节点逻辑，层层细查。常见根因：停止条件错（LLM 判断信息够永远不满足）、状态没更新（某节点漏更新 State）、节点逻辑错（工具失败/LLM 幻觉）。

### 第三层：根因深挖

**Q：State（状态）是 LangGraph 的核心，State 设计不好（太简单丢信息/太复杂难管理）会导致问题，怎么设计好 State？**

State 要"结构化+必要+可累积"。1）结构化——State 用 TypedDict/dataclass 定义（如 `{messages: list, current_task: str, retrieved_info: list, done: bool}`），字段明确，节点按字段读写，避免无结构字典乱；2）必要——State 只存"跨节点需要的"（如对话历史/任务上下文/中间结果），不存临时变量（临时变量在节点内局部处理），避免 State 膨胀；3）可累积——State 的字段设计支持累积（如 messages 是 list，每轮 append 而非覆盖；retrieved_info 累积检索结果），让信息跨轮次保留；4）类型注解——字段加类型（如 `messages: List[Message]`），便于调试和类型检查。反例：State 全塞一个大字符串（难解析）/存太多临时变量（膨胀）/字段覆盖而非累积（丢历史）。原则：结构化（TypedDict）+ 必要字段 + 累积语义，清晰可管理。

**Q：LangGraph 的 Edge（边）支持条件边（按状态分支），但条件写错（如永远走一个分支）会导致 Agent 无法流转，怎么设计可靠的边？**

显式条件+默认兜底。1）显式条件——条件边的判断逻辑要明确（如 `if state["done"]: return "end" else: return "continue"`），基于 State 的明确字段判断，避免隐式/模糊条件；2）多分支覆盖——条件要覆盖所有可能（如 done/not done 都有对应分支），避免某状态无分支（Agent 卡住）；3）默认兜底——加默认分支（如条件都不满足时走默认，如"继续查"或"结束"），防止意外状态卡死；4）停止条件——循环边（如"继续查"回到查询节点）要有可靠停止条件（如"最大循环次数"或"信息够判断"），否则死循环；5）测试——对边条件跑测试（如构造不同 State，验证走对分支），保证可靠。原则：条件显式+全覆盖+默认兜底+停止条件+测试，保证流转可靠。

### 第四层：方案权衡

**Q：LangGraph 的 Node（节点）可以是任意逻辑（LLM 调用/工具/RAG），但节点设计太粗（一个节点干太多）或太细（节点太多）都有问题，怎么把握粒度？**

按"单一职责+可复用"定粒度。1）单一职责——每个节点做一件事（如"查询节点"只检索，"生成节点"只生成，"判断节点"只判断），职责清晰，易调试/复用；一个节点干太多（如"查询+判断+生成"在一个节点）耦合，难调试/复用；2）可复用——节点设计成可复用（如"检索节点"可在多个 Agent 里用），粒度适中（别太细到不可复用，别太粗到只一个场景用）；3）流程清晰——节点粒度让流程清晰（如"理解→检索→生成"三节点 vs 一个大节点），可视化易懂；4）权衡——太粗（少节点）耦合难维护，太细（多节点）流转复杂/开销大（每节点是独立执行单元），适中（单一职责的合理粒度）。原则：单一职责+可复用，典型 Agent 5-10 个节点（如理解/规划/检索/工具/判断/生成），避免极粗或极细。

**Q：LangGraph 支持人在环路（Human-in-the-loop，如人工审批节点），但加人工节点会增加延迟（等人），怎么平衡？**

按需介入+异步。1）按需——只在高风险/关键节点加人工（如"执行删除操作前审批""大额交易确认"），低风险全自动（不加人工），减少不必要等待；2）异步——人工审批节点异步（Agent 挂起，等人审批后恢复），而非阻塞（Agent 不死等，可处理其他请求），通过检查点（Checkpointer）持久化状态，恢复时从检查点继续；3）超时/默认——人工节点设超时（如 24 小时不审批自动拒绝/通过默认），防止无限等；4）通知——人工节点触发通知（如发消息给审批人），让人及时处理。选型：关键决策加人工（审批/确认），非关键全自动；人工节点异步（不阻塞）+超时兜底，平衡可靠性和延迟。实务：高风险操作（如删数据/支付）加人工审批，低风险（如查询/生成）全自动。

### 第五层：验证与沉淀

**Q：你怎么衡量用 LangGraph 搭的 Agent 是否成功（相比顺序代码/其他框架，效果和可维护）？**

多维对比。1）效果——Agent 的任务完成率/准确率（LangGraph 的状态管理/循环支持应让复杂 Agent 更准）；2）可维护——LangGraph 的图可视化/State 结构化/节点单一职责，相比顺序代码更易维护/调试，对比可维护性；3）开发效率——搭复杂 Agent 的时间，LangGraph（图建模+现成组件）应比顺序代码快；4）可观测——LangGraph 集成 LangSmith 的 trace，问题定位快（MTTR 低）。综合：效果好+可维护+开发快+可观测强 = LangGraph 选对。还要看复杂度——简单 Agent（无循环/少分支）LangGraph 可能过度（顺序代码够），复杂 Agent LangGraph 优势明显。

**Q：基于 LangGraph 搭 Agent 的经验怎么沉淀成团队的 Agent 开发能力？**

建团队 Agent 规范：1）Agent 模板——提供 LangGraph Agent 项目模板（含 State 定义/常用节点/边/检查点/LangSmith 集成），脚手架搭建；2）节点库——把常用节点（检索/工具调用/LLM 判断/生成）做成可复用组件，新 Agent 组合；3）最佳实践——文档化 LangGraph 各设计（如 State 设计原则/边条件可靠/节点粒度/人在环路），新人按手册；4）可视化——用 LangGraph 的图可视化工具展示 Agent 流程，便于 review/调试；5）案例库——真实 Agent 案例（如"客服 Agent 用 LangGraph"），经验复用。这套写入团队 Agent 开发 SOP，让"搭 Agent"从"每人摸索"变成"模板+组件+最佳实践"，标准化高效产出。

## 结构化回答

**30 秒电梯演讲：** 基于LangGraph搭Agent=定义State→构建节点(Node)→连边(Edge)→编译。核心是把Agent建模为状态图，节点是动作，边是流转，天然支持循环和分支。

**展开框架：**
1. **四步** — 定义State→建节点→连边→编译
2. **核心概念** — Node(节点)/Edge(边)/State(状态)
3. **关键能力** — 循环/条件分支/人工节点/检查点

**收尾：** 您想深入聊：LangGraph和普通代码写Agent什么区别？——图结构更清晰可调试？


## 视频脚本

> 预计时长：4 分钟 | 由浅入深


| 时间 | 画面/字幕 | 口播台词 | 讲解要点 |
|------|----------|----------|----------|
| 0:00 | 标题卡：如何基于 LangGraph 搭建一个… | "像画流程图——状态是节点，决策是分支，工具调用是动作，LangGraph把流程图变成可执行…" | 开场钩子 |
| 0:20 | 核心概念图 | "基于LangGraph搭Agent=定义State→构建节点(Node)→连边(Edge)→编译。核心是把Agent建模…" | 核心定义 |
| 0:50 | 四步示意图 | "四步——定义State→建节点→连边→编译" | 要点拆解1 |
| 1:30 | 对比/实战案例图 | "对比一下常见误区和工程实践，看真实场景里怎么取舍。" | 实战与对比 |
| 2:20 | 总结卡 | "记住核心要点。下期我们追问：LangGraph和普通代码写Agent什么区别？——图结构？" | 收尾与钩子 |
