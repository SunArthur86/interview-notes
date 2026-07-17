---
id: note-bz-agent-066
difficulty: L4
category: ai
subcategory: Agent
tags:
- B站面经
- Agent框架
- 自研
- 对标LangGraph
feynman:
  essence: 对标LangGraph自研Agent框架=实现状态图引擎(节点/边/状态)+执行器(拓扑排序/并行)+检查点+人工节点。核心难点是图执行引擎和状态管理。
  analogy: 像自己造车——发动机(执行引擎)、底盘(状态管理)、变速箱(节点调度)、安全气囊(错误处理)，每个都要自己实现。
  first_principle: LangGraph本质是"图执行引擎"。自研要实现：图定义/拓扑排序/并行调度/状态管理/中断恢复。
  key_points:
  - 核心模块：图定义/执行引擎/状态管理/检查点
  - 难点：循环检测/并行调度/中断恢复
  - 价值：定制化/无依赖/性能优化
  - 适合：特殊需求/学习原理/性能极致
first_principle:
  essence: Agent框架本质是"有向图的执行引擎"。
  derivation: Agent=状态机。状态机=有向图。执行Agent=遍历图。自研框架=实现图定义API+执行引擎+状态管理。理解这个本质，就能对标实现。
  conclusion: 自研Agent框架 = 实现图执行引擎（定义/调度/状态/恢复）
follow_up:
- 为什么自研而不直接用LangGraph？——特殊需求/性能/学习/无依赖
- 最难实现的是什么？——并行调度+状态一致性+中断恢复
- 自研值得吗？——除非特殊需求，否则用开源更划算
memory_points:
- 核心架构五模块：API接口层、图定义层、执行引擎、状态管理与持久化可观测
- 执行引擎核心：基于拓扑排序调度节点，控制并行与防死循环，是框架心脏
- 实现复杂流的关键：支持条件路由分发、状态合并与异步并发调度
- 企业级特性壁垒：长任务中断恢复(检查点机制)与全链路Trace监控是自研难点
---

# 如何实现一个对标 LangGraph 的 AI Agents 框架？

## 一、框架核心架构

```
┌──────────────────────────────────────────────────┐
│          自研 Agent 框架架构                          │
├──────────────────────────────────────────────────┤
│                                                    │
│  API层（用户接口）                                  │
│    graph.add_node() / add_edge() / compile()      │
│                                                    │
│  图定义层                                           │
│    Node / Edge / State 定义                        │
│                                                    │
│  执行引擎（核心）                                   │
│    拓扑排序 / 并行调度 / 循环控制                   │
│                                                    │
│  状态管理                                           │
│    State对象 / 状态更新 / 状态合并                  │
│                                                    │
│  持久化                                             │
│    检查点 / 中断恢复                                │
│                                                    │
│  可观测                                             │
│    Trace / 日志 / 监控                              │
│                                                    │
└──────────────────────────────────────────────────┘
```

## 二、核心实现

### 1. 图定义

```python
from typing import TypedDict, Callable, Dict, List, Optional
from dataclasses import dataclass

@dataclass
class Node:
    name: str
    func: Callable
    is_subgraph: bool = False

@dataclass
class Edge:
    source: str
    target: str  # 或条件路由函数
    condition: Optional[Callable] = None

class StateGraph:
    def __init__(self, state_type: type):
        self.state_type = state_type
        self.nodes: Dict[str, Node] = {}
        self.edges: Dict[str, List[Edge]] = {}
        self.entry_point: Optional[str] = None
    
    def add_node(self, name: str, func: Callable):
        self.nodes[name] = Node(name, func)
        return self
    
    def add_edge(self, source: str, target: str):
        self.edges.setdefault(source, []).append(
            Edge(source, target)
        )
        return self
    
    def add_conditional_edges(self, source: str, router: Callable, mapping: dict):
        """条件分支"""
        self.edges.setdefault(source, []).append(
            Edge(source, router, condition=True)
        )
        return self
    
    def set_entry_point(self, name: str):
        self.entry_point = name
        return self
```

### 2. 执行引擎（核心）

```python
class GraphExecutor:
    def __init__(self, graph: StateGraph):
        self.graph = graph
        self.checkpointer = None
    
    def compile(self, checkpointer=None, interrupt_before=None):
        """编译图，生成可执行的应用"""
        self.checkpointer = checkpointer
        self.interrupt_before = interrupt_before or []
        self._validate()  # 校验图（有无环/不可达节点等）
        return RunnableGraph(self)
    
    async def execute(self, initial_state):
        """执行图"""
        state = initial_state
        current = self.graph.entry_point
        visited = []  # 防死循环
        
        while current is not None:
            # 中断检查
            if current in self.interrupt_before:
                self._save_checkpoint(state, current)
                yield {"type": "interrupt", "node": current}
                return
            
            # 执行节点
            node = self.graph.nodes[current]
            new_state = await self._run_node(node, state)
            state = self._merge_state(state, new_state)
            
            visited.append(current)
            
            # 死循环检测
            if self._detect_infinite_loop(visited):
                break
            
            # 路由到下一节点
            current = self._route(current, state)
            
            yield {"type": "node_done", "node": node.name, "state": state}
        
        yield {"type": "end", "state": state}
    
    def _route(self, current: str, state) -> Optional[str]:
        """路由：根据边决定下一节点"""
        edges = self.graph.edges.get(current, [])
        if not edges:
            return None  # 无后继，结束
        
        for edge in edges:
            if edge.condition:
                # 条件边：调用路由函数
                result = edge.target(state)
                if result:
                    return result
            else:
                # 固定边
                return edge.target
        return None
```

### 3. 并行调度

```python
class ParallelExecutor:
    """处理Fan-out/Fan-in的并行执行"""
    
    async def execute_parallel(self, nodes: List[Node], state):
        """并行执行多个节点，等待全部完成"""
        import asyncio
        tasks = [self._run_node(n, state.copy()) for n in nodes]
        results = await asyncio.gather(*tasks)
        
        # 合并所有结果到state
        merged = state.copy()
        for result in results:
            merged = self._merge_state(merged, result)
        return merged
```

### 4. 状态合并

```python
class StateManager:
    """状态管理：节点返回的partial state合并到完整state"""
    
    def merge(self, current: dict, update: dict) -> dict:
        """合并状态更新"""
        new_state = current.copy()
        for key, value in update.items():
            if key in new_state and isinstance(new_state[key], list):
                # 列表类型：追加而非覆盖（如messages）
                new_state[key] = new_state[key] + value
            else:
                new_state[key] = value
        return new_state
```

### 5. 检查点与恢复

```python
class Checkpointer:
    """检查点：保存状态用于中断恢复"""
    
    async def save(self, thread_id: str, state: dict, node: str):
        """保存当前状态和位置"""
        await self.db.save({
            "thread_id": thread_id,
            "state": state,
            "current_node": node,
            "timestamp": time.time()
        })
    
    async def load(self, thread_id: str):
        """恢复状态"""
        return await self.db.load(thread_id)
    
    async def resume(self, thread_id: str, state_update: dict):
        """从检查点恢复执行"""
        checkpoint = await self.load(thread_id)
        state = self.merge(checkpoint["state"], state_update)
        # 从checkpoint的节点继续
        return self.execute_from(checkpoint["current_node"], state)
```

## 三、完整使用示例

```python
# 用自研框架搭一个ReAct Agent

# 1. 定义状态
class AgentState(TypedDict):
    messages: list
    tool_results: list

# 2. 构建图
graph = StateGraph(AgentState)

graph.add_node("think", think_node)    # LLM思考
graph.add_node("act", act_node)        # 执行工具
graph.add_node("observe", observe_node) # 观察结果

graph.set_entry_point("think")
graph.add_edge("think", "act")
graph.add_edge("act", "observe")

# 条件边：观察后决定继续思考还是结束
graph.add_conditional_edges("observe", lambda s: 
    "think" if s["messages"][-1].needs_action else None
)

# 3. 编译
app = graph.compile(
    checkpointer=SqliteCheckpointer(),
    interrupt_before=["act"]  # 高危操作前暂停
)

# 4. 运行
result = await app.execute({"messages": [{"role": "user", "content": "..."}]})
```

## 四、自研的难点与价值

```
难点：
  1. 并行调度的状态一致性
  2. 中断恢复的精确性
  3. 循环检测（防死循环）
  4. 子图的状态隔离与传递
  5. 性能优化（大量节点时的调度）

价值：
  ✓ 完全定制（满足特殊需求）
  ✓ 无外部依赖（安全可控）
  ✓ 性能优化（针对场景调优）
  ✓ 学习原理（深入理解Agent机制）
  ✓ 灵活演进（自主升级）

适合自研的场景：
  - 有特殊编排需求（开源不满足）
  - 对性能有极致要求
  - 安全合规要求（不能用外部依赖）
  - 学习和研究目的
```

## 五、面试加分点

1. **本质是图执行引擎**：点破 Agent 框架的本质，体现深刻理解
2. **讲清难点**：并行调度/状态一致性/中断恢复——这些是真做了才会遇到的
3. **务实建议**：除非特殊需求，否则用 LangGraph 更划算——不自嗨

## 记忆要点

- 核心架构五模块：API接口层、图定义层、执行引擎、状态管理与持久化可观测
- 执行引擎核心：基于拓扑排序调度节点，控制并行与防死循环，是框架心脏
- 实现复杂流的关键：支持条件路由分发、状态合并与异步并发调度
- 企业级特性壁垒：长任务中断恢复(检查点机制)与全链路Trace监控是自研难点


## 苏格拉底式面试追问

> 这组追问模拟面试官层层逼问，每一问先回答"为什么"，再回答"怎么做"，最后回答"如何证明"。

### 第一层：目标与动机

**Q：对标 LangGraph 自研 Agent 框架要实现"状态图引擎+执行器+检查点+人工节点"，为什么不直接用 LangGraph 而要自研？**

因为自研有特定价值。1）极致可控——LangGraph 是开源框架（设计固定），特殊需求（如自定义执行语义/特殊状态管理/特定容错策略）框架不支持时要 hack，自研可完全按需求设计；2）性能优化——LangGraph 通用（覆盖多数场景），特定场景（如超大规模/超低延迟/特定部署）的极致优化自研更灵活（如定制执行器/内存管理）；3）技术栈统一——团队已有技术栈（如用其他图引擎/状态存储），自研集成更好（而非引入 LangGraph 的依赖）；4）避免依赖——LangGraph 是外部依赖（版本/许可/维护风险），自研无外部依赖（完全自主）；5）学习成本——团队学 LangGraph 要时间，自研团队熟（自己的代码）。但自研成本高（开发+维护+生态不如开源），适合有特殊需求/强工程能力的团队，否则用 LangGraph 更经济。

### 第二层：证据与定位

**Q：自研 Agent 框架出 bug（如节点执行错/状态不一致/循环死锁），没有 LangSmith 这种现成 trace 工具，怎么定位？**

自建可观测+调试工具。1）执行 trace——框架内置 trace（每节点的输入/输出/状态变更/延迟记录），存日志/数据库，异常时查 trace 定位卡住点；2）状态快照——每节点后存 State 快照（检查点），可回放（从某快照恢复重跑），定位状态何时出错；3）可视化——把图结构+执行流转可视化（如节点状态/边流转），直观看出哪里卡（如某节点循环不退/某边没走）；4）单元测试——对节点/边/状态管理写单元测试（如"某状态应走某分支""某节点应更新某字段"），bug 时跑测试定位；5）日志/断点——框架支持详细日志+断点（在某节点暂停检查 State），类似传统调试。定位方法：trace（执行链路）+状态快照（何时出错）+可视化（直观）+测试（回归）。自研要内置这些工具，否则调试难（黑盒）。

### 第三层：根因深挖

**Q：自研的核心难点是"图执行引擎"（拓扑排序/并行/条件分支），图执行引擎怎么设计才能可靠？**

明确的执行语义+边界处理。1）拓扑排序——DAG（有向无环图）按拓扑序执行（无依赖的并行），但 Agent 图可能有环（循环），要支持环（如检测环+按条件退出，而非纯拓扑）；2）并行执行——无依赖的节点并行（如多源查询），用异步/线程池并行，汇总（All-of/Any-of）控制；3）条件分支——条件边按 State 判断走哪条（如 `if state["done"] → end`），条件函数明确+全覆盖+默认兜底；4）状态一致性——多节点并行更新 State 时可能竞争（如同时写同字段），要并发控制（如锁/事务/reducer 合并）；5）错误处理——节点失败的重试/回滚/补偿策略（如重试 N 次/失败转人工/回滚到检查点）。难点：环的处理（防死循环）、并行 State 一致性、错误恢复。设计要明确语义+边界处理+测试覆盖。

**Q：状态管理是自研难点（State 在节点间传递+并行更新+持久化），怎么设计可靠的状态管理？**

结构化+并发控制+持久化。1）结构化 State——State 用 TypedDict/dataclass（字段明确+类型），节点按字段读写，避免无结构混乱；2）读写语义——明确字段的读写语义（如 messages 是累积 list——节点 append 而非覆盖；current_task 是覆盖——节点设置当前任务），用 reducer/注解标明；3）并发控制——并行节点同时写 State 时，用合并语义（如 list 字段并行 append 后合并）或锁（串行化写），避免竞争导致丢失更新；4）持久化（检查点）——State 序列化存检查点（如 JSON/pickle 存 Redis/DB），支持恢复（从检查点重建 State），关键节点前存（容错）；5）不可变性——考虑 State 不可变（每次更新生成新 State，类似 Redux），避免并行修改问题（但内存开销）。原则：结构化+明确读写语义+并发控制+持久化，保证状态可靠。

### 第四层：方案权衡

**Q：自研 vs 用 LangGraph，自研成本高（开发+维护）但可控，LangGraph 省事但依赖外部，怎么决策？**

按团队能力和需求决策。1）用 LangGraph——团队工程能力中等/需求通用（标准 Agent 工作流）/要快速上线，用 LangGraph（省成本/成熟/生态），适合大多数团队；2）自研——团队工程能力强（能开发和维护框架）/需求特殊（极致性能/特定执行语义/技术栈统一）/长期投入（自研摊薄成本），自研可控；3）混合——核心/特殊部分自研（如执行引擎/状态管理定制），非核心用开源（如监控用 Langfuse），平衡；4）演进——先用 LangGraph 快速验证（产品 fit），验证后如有特殊需求再自研（基于经验自研更准）。决策因素：团队工程能力（强→可自研）、需求特殊性（通用→用开源/特殊→自研）、成本（短期省→开源/长期摊薄→自研）。实务：多数团队用 LangGraph（成熟省事），少数强团队+特殊需求自研。

**Q：自研框架要支持"人工节点"（如审批），但人工节点是异步的（等人审批），框架怎么处理（节点执行到一半挂起）？**

检查点+恢复机制。1）检查点持久化——到达人工节点时，把当前 State 持久化（检查点，存 DB/Redis），框架挂起该工作流实例（释放资源，不阻塞）；2）异步通知——触发通知（如发消息给审批人/调审批 API），告知"有审批待处理"；3）恢复机制——人工审批后（外部触发），框架从检查点恢复（读 State 重建），继续执行后续节点（如审批通过→继续，拒绝→终止）；4）超时处理——人工节点设超时（如 24 小时未审批），超时自动处理（如默认拒绝/转交/催办），防止无限等；5）状态查询——支持查询"待审批"列表（哪些工作流在等人），便于管理。技术实现：检查点（序列化 State）+事件驱动（审批结果触发恢复）+超时（定时器）。这是人工节点的核心（异步挂起+恢复），自研要支持。

### 第五层：验证与沉淀

**Q：你怎么衡量自研框架是否成功（相比用 LangGraph，是否值得自研投入）？**

多维对比。1）功能——自研是否覆盖业务需求（如状态图/并行/人工节点），缺的功能是否影响业务；2）性能——自研的执行效率（延迟/吞吐）vs LangGraph，自研应持平或更好（否则不值得）；3）可靠性——自研的稳定性（bug 率/状态一致性）vs LangGraph（成熟），自研初期可能差（要打磨）；4）开发效率——用自研搭 Agent 的效率 vs LangGraph，自研应持平或更好（定制贴合团队习惯）；5）维护成本——自研的维护投入（修 bug/加功能）vs LangGraph（社区维护），自研维护成本高。综合：功能全+性能好+可靠+开发快+维护可控 = 自研值得。如果自研性能/可靠性不如 LangGraph 且维护成本高，不值得（应回归 LangGraph）。关键是"自研要有明确优势（可控/性能/特殊需求），否则不如用成熟开源"。

**Q：自研框架的开发和使用怎么沉淀成团队的 Agent 基础设施？**

建框架生态：1）框架文档——完整文档（设计理念/API/使用教程/最佳实践），让团队会用；2）组件库——基于框架开发可复用节点/子图（如各类查询/LLM 调用/工具），新 Agent 组合；3）模板——Agent 项目模板（含框架集成/常用节点/监控），脚手架搭建；4）可观测——框架内置 trace/监控/可视化（调试和运维），对齐 LangSmith 能力；5）质量保障——框架的单元测试/集成测试/性能基准（保证框架自身可靠）；6）迭代机制——收集用户反馈（用框架的团队）/需求，持续迭代。这套写入团队基础设施 SOP，让"自研框架"从"个人项目"变成"团队基础设施"，有文档/组件/模板/质量保障/迭代，持续服务团队。

## 结构化回答

**30 秒电梯演讲：** 对标LangGraph自研Agent框架=实现状态图引擎(节点/边/状态)+执行器(拓扑排序/并行)+检查点+人工节点。核心难点是图执行引擎和状态管理。

**展开框架：**
1. **核心模块** — 图定义/执行引擎/状态管理/检查点
2. **难点** — 循环检测/并行调度/中断恢复
3. **价值** — 定制化/无依赖/性能优化

**收尾：** 您想深入聊：为什么自研而不直接用LangGraph？——特殊需求/性能/学习/无依赖？


## 视频脚本

> 预计时长：5 分钟 | 由浅入深


| 时间 | 画面/字幕 | 口播台词 | 讲解要点 |
|------|----------|----------|----------|
| 0:00 | 标题卡：如何实现一个对标 LangGraph 的 AI… | "像自己造车——发动机(执行引擎)、底盘(状态管理)、变速箱(节点调度)、安全气囊(错误处理…" | 开场钩子 |
| 0:20 | 核心概念图 | "对标LangGraph自研Agent框架=实现状态图引擎(节点/边/状态)+执行器(拓扑排序/并行)+检查点+人工节点。…" | 核心定义 |
| 0:50 | 核心模块示意图 | "核心模块——图定义/执行引擎/状态管理/检查点" | 要点拆解1 |
| 1:30 | 难点示意图 | "难点——循环检测/并行调度/中断恢复" | 要点拆解2 |
| 2:20 | 对比/实战案例图 | "对比一下常见误区和工程实践，看真实场景里怎么取舍。" | 实战与对比 |
| 3:10 | 总结卡 | "记住核心要点。下期我们追问：为什么自研而不直接用LangGraph？——特殊需求/性能/？" | 收尾与钩子 |
