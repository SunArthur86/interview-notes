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

