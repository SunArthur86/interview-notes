---
id: note-bd-agent-006
difficulty: L3
category: ai
subcategory: Agent
tags:
  - 字节
  - 面经
  - Agent
  - 多Agent
  - 编排
feynman:
  essence: 不让Agent直接互调，而是加一层Orchestrator做任务拆分和调度，靠限制机制防失控
  analogy: '不要让两个员工直接互相派活(容易死循环)，而是通过项目经理(Orchestrator)统一分配和验收'
  first_principle: '多Agent协作本质是分布式系统问题——需要任务分发、状态同步、错误传播控制和死循环防护'
  key_points:
    - 加Orchestrator中间层做统一调度
    - 固定流程用LangGraph串节点
    - 复杂任务用消息队列异步通信
    - 防失控靠max depth、timeout、retry limit
first_principle:
  essence: 多Agent直接互调会产生不可控的依赖环，必须有中心化调度打破环路
  derivation: 'Agent A调用B、B反向调用A→无限递归→资源耗尽。引入Orchestrator后A和B只与Orchestrator通信→DAG无环→可控'
  conclusion: 多Agent编排的核心原则是DAG化（有向无环图）+ 资源限制
follow_up:
  - 'Orchestrator本身会不会成为单点故障？'
  - 'Agent间的状态怎么同步？'
  - '如何评估多Agent协作的效果？'
---

# 如果一个Agent需要调用另一个Agent，怎么做编排和防失控？

## 核心原则：不要让Agent直接互调

```
❌ 错误做法：Agent直接互调
┌───────┐         ┌───────┐
│Agent A│────────→│Agent B│
│       │←────────│       │
└───────┘         └───────┘
  问题：A调B，B又调A → 死循环

✅ 正确做法：通过Orchestrator
┌───────┐         ┌──────────────┐         ┌───────┐
│Agent A│←───────→│ Orchestrator │←───────→│Agent B│
│(写作) │         │  (调度中心)   │         │(审稿) │
└───────┘         └──────────────┘         └───────┘
```

## 编排方案选型

### 方案一：LangGraph同步编排（简单流程）

```python
from langgraph.graph import StateGraph, END

class MultiAgentState(TypedDict):
    task: str
    writer_output: str
    reviewer_feedback: str
    final_output: str
    iteration: int

def writer_node(state):
    """写作Agent"""
    output = writer_agent.generate(
        task=state["task"],
        feedback=state.get("reviewer_feedback", "")
    )
    return {"writer_output": output}

def reviewer_node(state):
    """审稿Agent"""
    feedback = reviewer_agent.review(state["writer_output"])
    return {"reviewer_feedback": feedback, "iteration": state["iteration"] + 1}

def should_continue(state):
    if state["iteration"] >= 3:  # max depth
        return "final"
    if "PASS" in state["reviewer_feedback"]:
        return "final"
    return "writer"  # 继续修改

workflow = StateGraph(MultiAgentState)
workflow.add_node("writer", writer_node)
workflow.add_node("reviewer", reviewer_node)
workflow.add_node("final", lambda s: {"final_output": s["writer_output"]})

workflow.set_entry_point("writer")
workflow.add_edge("writer", "reviewer")
workflow.add_conditional_edges("reviewer", should_continue)
workflow.add_edge("final", END)
```

### 方案二：消息队列异步编排（复杂任务）

```
                    ┌───────────────────┐
                    │   Orchestrator    │
                    │   (任务调度中心)    │
                    └────┬────┬────┬────┘
                         │    │    │
              ┌──────────┤    │    ├──────────┐
              ▼          ▼    │    ▼          ▼
         ┌─────────┐ ┌─────┐ │ ┌─────┐  ┌─────────┐
         │Agent A  │ │Agent│ │ │Agent│  │Agent D  │
         │(分析)   │ │  B  │ │ │  C  │  │(汇总)   │
         └────┬────┘ └──┬──┘ │ └──┬──┘  └────┬────┘
              │         │    │    │          │
              ▼         ▼    │    ▼          │
         ┌──────────────────────────────────────┐
         │        消息队列 (RabbitMQ/Kafka)      │
         │  task_queue │ result_queue │ dlq     │
         └──────────────────────────────────────┘
```

```python
# 异步多Agent编排
class AsyncOrchestrator:
    def __init__(self):
        self.max_depth = 5          # 最大调用深度
        self.timeout = 60           # 单任务超时(秒)
        self.retry_limit = 3        # 单Agent重试次数
        self.task_graph = {}        # DAG任务图
    
    async def dispatch(self, task: Task):
        """拆分任务并分发给各Agent"""
        subtasks = self._decompose(task)
        
        for sub in subtasks:
            # 检查依赖
            if not self._dependencies_met(sub):
                continue
            
            # 限制深度
            if sub.depth > self.max_depth:
                await self._fallback(sub)  # 降级处理
                continue
            
            # 异步派发
            await self.mq.publish(
                queue=f"agent_{sub.assigned_agent}",
                message=sub.to_dict(),
                timeout=self.timeout
            )
    
    async def on_result(self, result: AgentResult):
        """接收Agent结果，更新DAG"""
        self.task_graph[result.task_id].status = "completed"
        
        # 检查是否有死循环
        if self._detect_cycle():
            raise SafetyError("检测到循环调用，强制终止")
        
        # 继续下游任务
        await self.dispatch_next(result.task_id)
```

## 防失控机制

| 机制 | 实现 | 场景 |
|------|------|------|
| **Max Depth** | 限制调用链最大深度=5 | 防止A→B→A递归 |
| **Timeout** | 单Agent执行超时=60s | 防止Agent卡死 |
| **Retry Limit** | 单Agent重试≤3次 | 防止无限重试 |
| **Cycle Detection** | DAG图检测环路 | 防止互调死循环 |
| **Dead Letter Queue** | 失败任务进入DLQ | 失败不丢失 |
| **Rate Limit** | Agent调用频率限制 | 防止雪崩 |
| **Circuit Breaker** | 连续失败N次熔断 | 保护下游服务 |

```
防失控全景：

任务进入 → 深度检查 → 超时设置 → 派发Agent
              │            │
              ▼            ▼
          depth > 5?    timeout=60s?
          → 降级处理    → 强制终止
              
Agent执行 → 成功 → 更新DAG → 继续下游
         → 失败 → retry < 3? → 重试
                → retry = 3 → 进入DLQ → 人工介入
```

## 面试回答要点

> "我一般不让两个Agent直接互调，而是加一层Orchestrator做任务拆分和调度。

> **固定流程**可以用LangGraph串节点——写作Agent和审稿Agent通过状态图编排，审稿不通过就回到写作节点，最多迭代3轮。

> **复杂任务**用消息队列异步通信——Orchestrator拆分任务后通过MQ分发给各Agent，Agent只跟MQ通信不互调。

> **防失控**主要靠四道防线：max depth限制调用深度、timeout防卡死、retry limit防无限重试、cycle detection检测环路。"

## 面试加分点

1. **DAG思维**：多Agent编排本质是构建有向无环图
2. **分布式经验**：提到DLQ、熔断、限流等分布式系统经典概念
3. **分层设计**：同步用LangGraph，异步用MQ，体现技术选型能力
4. **安全第一**：强调"防失控"是Agent工程化的核心命题
