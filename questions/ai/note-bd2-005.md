---
id: note-bd2-005
difficulty: L4
category: ai
subcategory: Agent
tags:
  - 字节
  - 面经
  - Agent
  - 多Agent
  - 协作
  - 状态管理
feynman:
  essence: '多Agent协作通过消息传递和共享状态实现分工，核心挑战是上下文隔离与信息共享的平衡'
  analogy: '就像公司运作——产品经理(Orchestrator)拆任务，开发(Worker A)、设计(Worker B)各做各的，通过项目管理工具(共享状态)同步进度，不需要互相看对方代码(上下文隔离)'
  first_principle: '多Agent系统的本质是分布式系统问题: 任务分解、信息传递、状态同步、故障恢复。每个Agent是独立的计算单元，通过消息协议协作'
  key_points:
    - '协作模式: 中心化(Orchestrator) vs 去中心化(P2P)'
    - '上下文管理: 每个Agent有独立上下文，通过消息传递共享必要信息'
    - '状态传递: 共享黑板模式 / 消息队列 / 分布式状态'
    - '防失控: 最大深度、超时、循环检测'
first_principle:
  essence: '多Agent协作是分布式计算思想在LLM系统中的应用'
  derivation: '单个Agent处理复杂任务时上下文爆炸、注意力分散。多个专业化Agent各司其职，通过消息协议协作，类似微服务架构的"关注点分离"'
  conclusion: '多Agent协作 = 任务分解 + 专业化Agent + 消息协议 + 状态管理 + 故障恢复'
follow_up:
  - '多Agent和单个Agent用多个工具调用的本质区别是什么？'
  - 'Agent之间传递消息用什么格式最有效？'
  - '如何防止两个Agent互相调用形成无限循环？'
---

# 多Agent协作、上下文管理和任务状态传递

## 多Agent协作模式

```
模式1: 中心化编排 (Orchestrator Pattern)
┌────────────┐
│Orchestrator│ ── 拆分任务、分配、汇总
│  (主管)     │
└─┬───┬───┬──┘
  │   │   │       分配任务
  ▼   ▼   ▼
┌──┐┌──┐┌──┐
│ A1││ A2││ A3│   各自独立执行
│研究││写码││测试│
└─┬─┘└─┬─┘└─┬─┘
  │    │    │    返回结果
  ▼    ▼    ▼
┌────────────┐
│Orchestrator│ ── 汇总、决策下一步
└────────────┘

模式2: 去中心化 (P2P Pattern)
┌──┐         ┌──┐
│ A1│────────→│ A2│   直接通信
│研究│←───────│分析│
└──┘         └─┬┘
               │
               ▼
             ┌──┐
             │ A3│
             │报告│
             └──┘

模式3: 层级化 (Hierarchical Pattern)
┌──────┐
│ CEO  │ ── 战略决策
└──┬───┘
   ├──┌──────┐
   │  │Manager│ ── 项目管理
   │  └─┬──┬─┘
   │    │  │
   │  ┌─┴┐┌┴──┐
   │  │ W1││ W2│ ── 执行具体任务
   │  └──┘└───┘
```

## 上下文管理

```python
class AgentContext:
    """每个Agent有独立的上下文，不直接共享"""
    
    def __init__(self, agent_id: str):
        self.agent_id = agent_id
        self.local_memory = []  # 只属于这个Agent的对话历史
        self.shared_state = None  # 从共享状态读取的数据
    
    def receive_task(self, task_description, shared_context):
        """从Orchestrator接收任务和必要的共享上下文"""
        self.local_memory.append({
            "role": "user",
            "content": f"""
任务: {task_description}

共享上下文 (只读):
{shared_context}

请独立完成任务并返回结果。
"""
        })

class SharedBlackboard:
    """共享黑板模式 - 所有Agent读写同一个状态空间"""
    
    def __init__(self):
        self.tasks = {}       # 任务状态
        self.results = {}     # 已完成的结果
        self.messages = []    # Agent间的消息
    
    def write_result(self, agent_id, task_id, result):
        """Agent写入结果"""
        self.results[task_id] = {
            "agent_id": agent_id,
            "result": result,
            "timestamp": time.time(),
            "status": "completed"
        }
    
    def read_results(self, task_ids=None):
        """读取其他Agent的结果"""
        if task_ids:
            return {tid: self.results[tid] for tid in task_ids if tid in self.results}
        return self.results
```

## 完整实现：中心化多Agent

```python
from langgraph.graph import StateGraph, END
from typing import TypedDict, List, Optional
import uuid

class MultiAgentState(TypedDict):
    """多Agent共享状态"""
    original_task: str           # 原始任务
    subtasks: List[dict]         # 拆分的子任务
    results: dict                # 子任务结果 {task_id: result}
    messages: List[dict]         # Agent间消息
    current_phase: str           # 当前阶段
    iteration: int               # 迭代次数
    error: Optional[str]         # 错误信息

# ===== Orchestrator Agent =====

def orchestrator(state: MultiAgentState) -> MultiAgentState:
    """主管Agent: 拆分任务、分配、汇总"""
    
    if not state.get("subtasks"):
        # 首次: 拆分任务
        plan = llm.generate(f"""
将以下任务拆分为3-5个子任务:
任务: {state['original_task']}

每个子任务包含:
- task_id: 唯一ID
- description: 任务描述
- assigned_to: 分配给哪个专业Agent
- depends_on: 依赖哪些其他子任务(可为空)
""")
        state["subtasks"] = parse_plan(plan)
        state["results"] = {}
    
    else:
        # 后续: 检查进度，分配待执行任务
        for task in state["subtasks"]:
            if task["task_id"] not in state["results"]:
                # 检查依赖是否完成
                deps = task.get("depends_on", [])
                if all(d in state["results"] for d in deps):
                    # 依赖满足 → 分配执行
                    pass  # 在下一个节点执行
    
    state["iteration"] += 1
    return state

# ===== Worker Agents =====

def research_agent(state: MultiAgentState) -> MultiAgentState:
    """研究Agent: 搜索和分析信息"""
    pending = [t for t in state["subtasks"] 
               if t.get("assigned_to") == "researcher" 
               and t["task_id"] not in state["results"]]
    
    for task in pending:
        # 执行任务
        result = research_worker(task["description"])
        state["results"][task["task_id"]] = result
    
    return state

def coding_agent(state: MultiAgentState) -> MultiAgentState:
    """编码Agent: 写代码"""
    pending = [t for t in state["subtasks"]
               if t.get("assigned_to") == "coder"
               and t["task_id"] not in state["results"]
               and all(d in state["results"] for d in t.get("depends_on", []))]
    
    for task in pending:
        # 获取依赖任务的输出作为输入
        deps = task.get("depends_on", [])
        dep_results = {d: state["results"][d] for d in deps}
        
        result = coding_worker(task["description"], dep_results)
        state["results"][task["task_id"]] = result
    
    return state

# ===== 路由逻辑 =====

def route(state: MultiAgentState) -> str:
    """决定下一步执行哪个Agent"""
    # 检查是否所有任务完成
    all_done = all(t["task_id"] in state["results"] for t in state["subtasks"])
    if all_done:
        return "finalize"
    
    # 检查是否有可执行的任务
    has_research = any(
        t.get("assigned_to") == "researcher" 
        and t["task_id"] not in state["results"]
        for t in state["subtasks"]
    )
    if has_research:
        return "research"
    
    has_coding = any(
        t.get("assigned_to") == "coder"
        and t["task_id"] not in state["results"]
        and all(d in state["results"] for d in t.get("depends_on", []))
        for t in state["subtasks"]
    )
    if has_coding:
        return "coding"
    
    return "finalize"

# ===== 构建图 =====

workflow = StateGraph(MultiAgentState)
workflow.add_node("orchestrator", orchestrator)
workflow.add_node("research", research_agent)
workflow.add_node("coding", coding_agent)
workflow.add_node("finalize", lambda s: s)

workflow.set_entry_point("orchestrator")
workflow.add_conditional_edges("orchestrator", route, {
    "research": "research",
    "coding": "coding",
    "finalize": "finalize"
})
workflow.add_edge("research", "orchestrator")  # 完成后回到主管
workflow.add_edge("coding", "orchestrator")
workflow.add_edge("finalize", END)

app = workflow.compile()
```

## 防失控机制

```python
class SafetyController:
    """多Agent安全控制"""
    
    MAX_DEPTH = 10          # 最大调用深度
    MAX_ITERATIONS = 20     # 最大总迭代次数
    MAX_TOTAL_COST = 5.0    # 最大总成本($)
    TIMEOUT = 300           # 总超时5分钟
    
    def check(self, state: MultiAgentState) -> bool:
        if state["iteration"] > self.MAX_ITERATIONS:
            raise MaxIterationError(f"超过最大迭代次数{self.MAX_ITERATIONS}")
        
        # 循环检测: 如果同一任务被分配超过3次，可能卡住了
        for task in state.get("subtasks", []):
            if task.get("assign_count", 0) > 3:
                raise LoopDetectedError(f"任务{task['task_id']}被重复分配")
        
        return True
```

## 状态传递方式对比

| 方式 | 原理 | 优点 | 缺点 | 适用场景 |
|------|------|------|------|---------|
| 共享黑板 | 所有Agent读写同一状态 | 简单直接 | 并发冲突 | 中心化模式 |
| 消息队列 | Agent间通过消息异步通信 | 解耦，可扩展 | 延迟高 | 大规模分布式 |
| 状态传递 | 每步结果作为下步输入 | 清晰可控 | 串联延迟 | 线性流水线 |
| 数据库 | 共享数据库表 | 持久化 | 查询延迟 | 需要持久状态 |
