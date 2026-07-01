---
id: note-bd-agent-005
difficulty: L3
category: ai
subcategory: Agent
tags:
- 字节
- 面经
- Agent
- Harness
feynman:
  essence: Agent Harness是Agent的生产运行时框架，解决评测、观测、回放和安全四大工程问题
  analogy: Agent Harness就像飞机的黑匣子+自动驾驶测试台——记录每一步操作、实时监控状态、出事了能回放复现
  first_principle: Agent有随机性，不能只看一次输出——工程上要看任务完成率、Tool调用成功率、延迟、成本和错误链路
  key_points:
  - 评测：任务完成率、Tool成功率、延迟和成本度量
  - 观测：全链路Trace，记录每步Prompt和输出
  - 回放：从检查点恢复和复现执行过程
  - 安全：权限控制、超时熔断、资源限制
first_principle:
  essence: Agent的本质不确定性要求必须有完善的工程基础设施来保证可靠性
  derivation: LLM输出不可预测→单次测试无法评估质量→需要系统化评测+全链路观测+可回放的执行日志→Harness
  conclusion: 没有Harness的Agent就像没有日志和监控的微服务——出了问题完全无法定位
follow_up:
- Agent评测的Golden Set怎么构建？
- Trace数据量很大怎么存储和检索？
- Harness和LangSmith/Langfuse的关系？
memory_points:
- 核心四能力：Eval(评测)、Trace(全链路观测)、Replay(回放)、Safety(安全控制)
- 评测防随机：因为Agent输出有随机性，所以单测例必须跑多次(n_runs)取平均统计
- Trace查节点：记录Prompt到Tool调用的树形Span结构，用于定位错误链路和Token成本
- 核心监控指标：任务完成率、工具调用成功率、P99延迟和Token成本追踪
---

# 从工程化角度看，Agent Harness主要解决哪些问题？

## Agent Harness全景图

```
┌──────────────────────────────────────────────┐
│               Agent Harness                   │
├──────────┬──────────┬──────────┬─────────────┤
│  评测     │  观测     │  回放     │   安全      │
│ Eval     │ Trace    │ Replay   │  Safety     │
├──────────┼──────────┼──────────┼─────────────┤
│完成率统计 │全链路日志 │检查点恢复 │权限控制     │
│Tool成功率 │Prompt记录 │执行复现   │超时熔断     │
│延迟监控   │模型输出   │对比分析   │资源限制     │
│成本追踪   │Tool入参   │A/B测试   │异常隔离     │
│回归测试   │错误链路   │版本对比   │沙箱执行     │
└──────────┴──────────┴──────────┴─────────────┘
```

## 1. 评测（Evaluation）

### 核心指标

| 维度 | 指标 | 说明 |
|------|------|------|
| **任务完成率** | Task Success Rate | 端到端任务是否成功完成 |
| **Tool调用成功率** | Tool Call Accuracy | 工具是否被正确选择和调用 |
| **延迟** | P50/P95/P99 Latency | 端到端和各节点延迟 |
| **成本** | Token Cost / Task | 每个任务消耗的Token费用 |
| **错误链路** | Error Trace | 失败发生在哪个节点的哪一步 |

### 评测体系搭建

```python
class AgentEvaluator:
    def __init__(self, golden_set: list):
        self.test_cases = golden_set  # 标准测试集
    
    def evaluate(self, agent, n_runs=5):
        """每个测试用例跑多次取平均（因为Agent有随机性）"""
        results = []
        for case in self.test_cases:
            run_results = []
            for _ in range(n_runs):
                result = agent.run(case.input)
                run_results.append({
                    "success": self._check_success(result, case.expected),
                    "tool_calls": self._analyze_tools(result),
                    "latency_ms": result.latency,
                    "token_cost": result.total_tokens
                })
            results.append(self._aggregate(run_results))
        return results
```

## 2. 观测（Observability / Trace）

### 全链路Trace

```
Trace: task_abc123
├── [0.0s] Planner: 输入="写一个武侠故事第三章"
│   ├── Prompt: "你是小说规划器..." (487 tokens)
│   └── Output: {"chapters": [...]} (1.2s, 312 tokens)
│
├── [1.2s] RAG: 查询="历史章节+角色设定"
│   ├── Vector Search: top_k=5, 0.3s
│   ├── Rerank: cross-encoder, 0.2s  
│   └── Context: 2048 tokens assembled
│
├── [1.7s] Writer: 生成第三章
│   ├── Prompt: 2847 tokens
│   └── Output: 1523 tokens, 3.1s
│
├── [4.8s] Reviewer: 质量检查
│   ├── Issues found: ["角色A名称不一致"]
│   └── Pass: false
│
├── [5.1s] Repair: 修复问题
│   └── Pass: true (二次检查)
│
└── [6.8s] COMPLETE: 总耗时6.8s, 总Token=5362
```

### Trace数据结构

```python
@dataclass
class TraceSpan:
    span_id: str
    parent_id: str          # 父节点（用于构建调用树）
    node_name: str          # 节点名称
    input_prompt: str       # 完整Prompt
    model_output: str       # 模型输出
    tool_calls: list        # Tool调用记录
    start_time: float
    end_time: float
    token_usage: dict       # input_tokens, output_tokens
    status: str             # success/error/timeout
    error_message: str      # 失败原因
```

## 3. 回放（Replay）

```python
class ReplayEngine:
    """从Trace记录恢复执行"""
    
    def replay(self, trace_id: str):
        trace = self.store.load(trace_id)
        
        # 按顺序重放每个节点
        for span in trace.spans:
            # 可选：替换模型输出（测试新Prompt）
            if span.node_name == "writer":
                # 用新Prompt重新生成
                new_output = llm.generate(span.input_prompt)
                if new_output != span.model_output:
                    print(f"差异检测: {diff(span.model_output, new_output)}")
            
            # 恢复State到检查点
            self.state.restore(span.checkpoint)
```

**回放的用途**：
- **Debug**：复现线上失败的执行路径
- **A/B测试**：对比不同Prompt/模型的效果
- **回归测试**：代码改动后确保不回归

## 4. 安全（Safety）

```
┌─ 权限控制 ────┐  ┌─ 超时熔断 ────┐  ┌─ 资源限制 ────┐
│ Tool级别权限  │  │ 节点级超时    │  │ 最大Token数   │
│ 数据级别权限  │  │ 任务级超时    │  │ 最大Tool调用数 │
│ 敏感操作审计  │  │ 自动熔断降级  │  │ 并发数限制    │
└──────────────┘  └──────────────┘  └──────────────┘
```

## 面试回答要点

> "Agent Harness主要解决四个问题：

> **评测**——Agent有随机性，不能只看一次输出。要看任务完成率、Tool调用成功率、P95延迟和Token成本，每个测试用例跑多次取平均。

> **观测**——要把每一步的Prompt、模型输出、Tool入参都Trace出来。出问题时能定位到具体节点的具体调用。

> **回放**——从Trace记录恢复执行路径，用于Debug复现和A/B测试。

> **安全**——权限控制、超时熔断、资源限制，防止Agent跑飞。"

## 面试加分点

1. **强调"Agent有随机性"**：这是Harness存在的根本原因
2. **具体指标**：能说出P95延迟、Token成本、Tool成功率等量化指标
3. **对标工具**：提到LangSmith、Langfuse等开源Trace工具
4. **生产思维**：Trace数据量很大→需要采样+异步写入

## 记忆要点

- 核心四能力：Eval(评测)、Trace(全链路观测)、Replay(回放)、Safety(安全控制)
- 评测防随机：因为Agent输出有随机性，所以单测例必须跑多次(n_runs)取平均统计
- Trace查节点：记录Prompt到Tool调用的树形Span结构，用于定位错误链路和Token成本
- 核心监控指标：任务完成率、工具调用成功率、P99延迟和Token成本追踪

