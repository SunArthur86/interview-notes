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
  essence: 多Agent协作通过消息传递和共享状态实现分工，核心挑战是上下文隔离与信息共享的平衡
  analogy: 就像公司运作——产品经理(Orchestrator)拆任务，开发(Worker A)、设计(Worker B)各做各的，通过项目管理工具(共享状态)同步进度，不需要互相看对方代码(上下文隔离)
  first_principle: '多Agent系统的本质是分布式系统问题: 任务分解、信息传递、状态同步、故障恢复。每个Agent是独立的计算单元，通过消息协议协作'
  key_points:
  - '协作模式: 中心化(Orchestrator) vs 去中心化(P2P)'
  - '上下文管理: 每个Agent有独立上下文，通过消息传递共享必要信息'
  - '状态传递: 共享黑板模式 / 消息队列 / 分布式状态'
  - '防失控: 最大深度、超时、循环检测'
first_principle:
  essence: 多Agent协作是分布式计算思想在LLM系统中的应用
  derivation: 单个Agent处理复杂任务时上下文爆炸、注意力分散。多个专业化Agent各司其职，通过消息协议协作，类似微服务架构的"关注点分离"
  conclusion: 多Agent协作 = 任务分解 + 专业化Agent + 消息协议 + 状态管理 + 故障恢复
follow_up:
- 多Agent和单个Agent用多个工具调用的本质区别是什么？
- Agent之间传递消息用什么格式最有效？
- 如何防止两个Agent互相调用形成无限循环？
memory_points:
- 模式对比：中心化编排好管理而去中心化P2P适合直接通信。
- 状态隔离：各Agent保持独立的上下文记忆，避免窗口超载。
- 共享黑板：设立全局状态空间，各Agent读写任务结果实现解耦协作。
- 状态传递：上级拆解任务，附带必要只读上下文下发给子Agent。
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

## 记忆要点

- 模式对比：中心化编排好管理而去中心化P2P适合直接通信。
- 状态隔离：各Agent保持独立的上下文记忆，避免窗口超载。
- 共享黑板：设立全局状态空间，各Agent读写任务结果实现解耦协作。
- 状态传递：上级拆解任务，附带必要只读上下文下发给子Agent。

## 苏格拉底式面试追问

> 这组追问模拟面试官层层逼问，每一问先回答"为什么"，再回答"怎么做"，最后回答"如何证明"。

### 第一层：目标与动机

**Q：多 Agent 协作你用"共享黑板"（全局状态空间）。为什么不直接用 Agent 间直接传消息（P2P），省得维护一个中间黑板？**

黑板解耦 + 可观测。P2P 直接传消息的问题是"耦合度高"——Agent A 要知道 Agent B 的接口（发什么格式、B 在不在线），A 和 B 强耦合，加一个 Agent C 要改 A 的代码（让 A 知道 C 的存在）。黑板是"发布订阅"模式——Agent 往黑板写结果，谁需要谁读，Agent 之间不直接耦合，加新 Agent 只需订阅黑板，不改现有 Agent。且黑板是"全局可观测"的——编排器能看到所有 Agent 的状态，做调度决策（如"等 A 和 B 都完成后触发 C"），P2P 的状态分散在各 Agent，编排困难。黑板适合"多 Agent 复杂协作"，P2P 适合"两个 Agent 简单直连"。生产级多 Agent 系统用黑板（或消息队列）做解耦。

### 第二层：证据与定位

**Q：多 Agent 系统的端到端任务成功率从 85% 降到 60%。你怎么定位是单个 Agent 出错、Agent 间通信丢消息、还是编排逻辑问题？**

分阶段看 trace。一是各 Agent 的个体成功率（per_agent_success_rate）——每个 Agent 独立执行其子任务的成功率，如果某个 Agent 从 95% 降到 70%，是该 Agent 的问题（如工具失效、prompt 退化）；二是通信成功率——黑板的消息是否被正确写入和读取（如 Agent A 写了结果但 Agent B 没读到，可能是订阅配置错或消息序列化问题）；三是编排逻辑——任务拆解和调度是否正确（如编排器把任务分错了 Agent，或依赖关系搞反了，A 应该等 B 但提前执行了）。通过 LangGraph 的 StateGraph trace 或自研的 Agent trace 系统，看每步的状态流转，定位卡在哪一步。关键是有"全链路 trace"（记录每个 Agent 的输入/输出/耗时），否则无法定位。

### 第三层：根因深挖

**Q：多 Agent 协作时，各 Agent 的上下文互相污染（如 Agent A 的中间结果误导了 Agent B）。根因是什么？**

根因是"共享信息未经清洗"。黑板模式下，Agent A 把自己的完整中间结果（包含思考过程、失败尝试、冗余信息）写入黑板，Agent B 读取后把这些"噪声"当作事实，被误导。如 A 探索了错误方向（"可能是 X 原因"）后否定了，但中间结果留在了黑板，B 看到"可能是 X 原因"当真了。治本：一是 Agent 写黑板时只写"结论"（如任务完成状态、最终结果），不写"过程"（思考、失败尝试）；二是黑板有 schema 约束（每个字段定义清楚，Agent 只能写对应字段，避免随意倾倒）；三是 B 读取时做"可信度过滤"（标注信息来源和置信度，低置信度信息不采纳）。关键是"信息分层"——黑板存结构化结论，各 Agent 的详细过程存各自日志，不进黑板。

**Q：那为什么不直接把所有 Agent 合并成一个超级 Agent（一个 prompt 干所有事），省得协作时信息传递丢失？**

超级 Agent 不可扩展且质量差。一个 Agent 干所有事意味着 prompt 极长（塞进所有工具描述、所有场景的处理逻辑），上下文爆炸 + 注意力分散，LLM 处理质量下降（lost-in-the-middle）。且"全能 Agent"难以调试（出错时不知道是哪个环节），难以并行（所有任务串行）。多 Agent 的价值是"分而治之"——每个 Agent 专注一个领域（如检索 Agent 只管搜索、推理 Agent 只管分析、写作 Agent 只管输出），prompt 短而精，各自质量高，可并行执行，可独立调试。代价是协作开销（信息传递、调度），但远小于"超级 Agent"的质量损失。复杂任务（如"研究 + 写报告"）拆成多 Agent 是必要的，简单任务（如"翻译"）单 Agent 够用。

### 第四层：方案权衡

**Q：多 Agent 编排你用中心化（Orchestrator 统一调度）。为什么不直接去中心化（P2P，Agent 间自主协商）？**

中心化好管理，去中心化更灵活但易失控。中心化编排——一个 Orchestrator 统一拆解任务、分配给各 Agent、汇总结果，逻辑清晰、易调试、易监控（所有调度经过中心）。去中心化——Agent 间直接通信协商（如 Agent A 觉得需要 Agent B 帮忙，直接调用 B），更灵活（无中心瓶颈）、更鲁棒（中心挂了全挂，去中心化单点故障影响小）。但去中心化的问题：一是"死循环"（A 调 B，B 调 A，无限循环）；二是"状态不一致"（各 Agent 看到的全局状态不同步）；三是"难以调试"（调度链路分散，trace 困难）。生产级系统优先中心化（可控性重要），只在"Agent 数量多 + 需要高鲁棒"时考虑去中心化（加防死循环机制）。

**Q：为什么不直接用现成的多 Agent 框架（如 AutoGen、CrewAI），省得自己写编排？**

现成框架降低开发成本但有局限。AutoGen/CrewAI 提供了多 Agent 协作的基础设施（消息传递、角色定义、对话管理），快速搭建原型。但局限：一是定制性差——框架的协作模式（如 AutoGen 的对话式、CrewAI 的角色式）可能不适合你的场景（如你需要"工作流式" DAG 调度，框架支持不好）；二是黑盒难调试——框架内部的调度逻辑不可控，出错时难定位；三是性能开销——框架的通用性带来额外开销（如每条消息的序列化/反序列化）。选型看阶段——原型用框架快速验证，生产化时自研编排（如用 LangGraph 的 StateGraph，可控性强）或基于框架深度定制。不要被框架"绑架"，核心编排逻辑要自己掌握。

### 第五层：验证与沉淀

**Q：你怎么衡量多 Agent 协作的效果，证明比单 Agent 好？**

定义指标：一是 E2E task_success_rate（端到端任务完成率），对比单 Agent vs 多 Agent；二是个体准确率（per_agent_accuracy），每个 Agent 在其子任务上的表现；三是协作效率（communication_rounds，完成任务的平均通信轮次，越少越高效）；四是总成本（total_cost = 各 Agent 的 token 消耗总和）；五是延迟（E2E latency，并行执行则取最长 Agent，串行则累加）。做消融实验：单 Agent vs 多 Agent（中心化）vs 多 Agent（去中心化），在相同任务集上对比 success_rate/cost/latency。关键验证"协作的价值"——如果多 Agent 的 success_rate 没显著高于单 Agent，说明拆分无意义（协作开销大于分工收益），不如用单 Agent。

**Q：多 Agent 协作方案怎么沉淀成团队标配？**

封装成"多 Agent 编排框架"：基于 LangGraph StateGraph 或自研，支持 DAG 任务编排（定义 Agent 间的依赖和并行）、黑板状态管理（结构化 schema 约束）、中心化 Orchestrator（任务拆解 + 调度 + 汇总）、全链路 trace（每步输入/输出/耗时）。沉淀"各场景的 Agent 拆分模式"（研究类用"检索 + 分析 + 写作"三 Agent、客服类用"意图识别 + 工具调用 + 回复生成"三 Agent）、"黑板 schema 设计规范"、"防死循环策略"（max_rounds、依赖图无环检查）。配套监控（E2E success_rate、per_agent_accuracy、communication_rounds、cost），异常（success 降/通信暴涨）告警。

## 结构化回答

**30 秒电梯演讲：** 多Agent协作通过消息传递和共享状态实现分工，核心挑战是上下文隔离与信息共享的平衡——就像公司运作。

**展开框架：**
1. **协作模式** — 中心化(Orchestrator) vs 去中心化(P2P)
2. **上下文管理** — 每个Agent有独立上下文，通过消息传递共享必要信息
3. **状态传递** — 共享黑板模式 / 消息队列 / 分布式状态

**收尾：** 您想深入聊：多Agent和单个Agent用多个工具调用的本质区别是什么？


## 视频脚本

> 预计时长：5 分钟 | 由浅入深


| 时间 | 画面/字幕 | 口播台词 | 讲解要点 |
|------|----------|----------|----------|
| 0:00 | 标题卡：多Agent协作、上下文管理和任务状态传递 | "就像公司运作——产品经理(Orchestrator)拆任务，开发(Worker A)、设计…" | 开场钩子 |
| 0:20 | 核心概念图 | "多Agent协作通过消息传递和共享状态实现分工，核心挑战是上下文隔离与信息共享的平衡" | 核心定义 |
| 0:50 | 协作模式示意图 | "协作模式——中心化(Orchestrator) vs 去中心化(P2P)" | 要点拆解1 |
| 1:30 | 上下文管理示意图 | "上下文管理——每个Agent有独立上下文，通过消息传递共享必要信息" | 要点拆解2 |
| 2:20 | 对比/实战案例图 | "对比一下常见误区和工程实践，看真实场景里怎么取舍。" | 实战与对比 |
| 3:10 | 总结卡 | "记住核心要点。下期我们追问：多Agent和单个Agent用多个工具调用的本质区别是什么？" | 收尾与钩子 |
