---
id: note-bd2-006
difficulty: L4
category: ai
subcategory: Agent
tags:
- 字节
- 面经
- Agent
- 多Agent
- 评估
- 量化
feynman:
  essence: '多Agent系统评估分两层: 个体层(每个Agent的准确率和效率)和系统层(协作效率、任务完成率、成本)'
  analogy: 就像评估一支球队——不光看个人数据(进球、助攻)，还要看团队指标(传球成功率、配合默契度、战术执行力)
  first_principle: 多Agent系统的整体效果 ≠ 各Agent效果的简单加总。涌现行为(协作增益)和负面交互(冲突、循环)需要专门的系统级度量
  key_points:
  - '个体指标: 每个Agent的任务完成率、准确率、延迟、成本'
  - '系统指标: 端到端任务完成率、协作效率、通信开销、冗余度'
  - '工作流指标: 任务分解合理性、依赖满足率、并行度'
  - '经济指标: 总成本、单位任务成本、ROI'
first_principle:
  essence: 多Agent系统是复杂系统，需要多层级评估而非单一端到端指标
  derivation: 两个系统可能端到端准确率都是80%，但一个需要3个Agent协作5轮完成(高效)，另一个需要5个Agent协作15轮完成(低效)。只看准确率无法区分
  conclusion: 多Agent评估 = 个体指标 × 系统指标 × 经济指标，缺一不可
follow_up:
- 如何构建多Agent系统的自动化测试集？
- LLM-as-Judge评估多Agent系统的可靠性如何？
- 多Agent系统什么情况下不如单Agent？
memory_points:
- 评估维度记三层：个体指标(准确率/延迟)、系统指标(通信轮次/冲突率)、经济指标(总成本/ROI)。
- 系统效果看全局：不仅看单Agent成功率，更要端到端(E2E)成功率与协作效率。
- 量化代码建两表：AgentMetrics记录单次执行，SystemMetrics聚合通信与冲突。
---

# 多Agent系统的工作流程和效果量化评估

## 评估指标体系

```
┌──────────────────────────────────────────────────┐
│            多Agent系统评估指标体系                  │
│                                                    │
│  ┌─── 个体指标 (Per-Agent) ──────────────┐       │
│  │ • 任务完成率 (Task Success Rate)        │       │
│  │ • 输出准确率 (Accuracy)                 │       │
│  │ • 工具调用准确率 (Tool Accuracy)        │       │
│  │ • 单次延迟 (Latency P50/P99)            │       │
│  │ • Token消耗 (Tokens per task)           │       │
│  └────────────────────────────────────────┘       │
│                                                    │
│  ┌─── 系统指标 (System-Level) ───────────┐       │
│  │ • 端到端任务完成率 (E2E Success Rate)   │       │
│  │ • 协作效率 (Collaboration Efficiency)   │       │
│  │ • 通信轮次 (Communication Rounds)       │       │
│  │ • 冗余度 (Redundancy Ratio)             │       │
│  │ • 冲突率 (Conflict Rate)                │       │
│  │ • 循环检测 (Loop Incidents)             │       │
│  └────────────────────────────────────────┘       │
│                                                    │
│  ┌─── 经济指标 (Economics) ──────────────┐       │
│  │ • 总成本 (Total Cost per Task)          │       │
│  │ • 成本效率 (Cost per Correct Answer)    │       │
│  │ • ROI对比 (vs 单Agent方案)              │       │
│  └────────────────────────────────────────┘       │
└──────────────────────────────────────────────────┘
```

## 代码实现

```python
import time
from dataclasses import dataclass, field
from typing import List, Dict

@dataclass
class AgentMetrics:
    """单个Agent的执行指标"""
    agent_id: str
    task_id: str
    success: bool
    accuracy: float          # 输出准确率(0-1)
    latency_ms: float        # 执行延迟
    tokens_input: int        # 输入Token
    tokens_output: int       # 输出Token
    tool_calls: int          # 工具调用次数
    tool_errors: int         # 工具调用失败次数

@dataclass 
class SystemMetrics:
    """系统级指标"""
    task_id: str
    e2e_success: bool                    # 端到端是否成功
    total_latency_ms: float              # 总延迟
    communication_rounds: int            # Agent间通信轮次
    agent_metrics: List[AgentMetrics]    # 各Agent指标
    total_cost: float                    # 总API成本
    conflict_count: int                  # 冲突次数
    loop_detected: bool                  # 是否检测到循环
    
    @property
    def total_tokens(self):
        return sum(a.tokens_input + a.tokens_output for a in self.agent_metrics)
    
    @property
    def avg_agent_accuracy(self):
        return sum(a.accuracy for a in self.agent_metrics) / len(self.agent_metrics)
    
    @property
    def collaboration_efficiency(self):
        """协作效率 = 有效工作轮次 / 总通信轮次"""
        effective = sum(1 for a in self.agent_metrics if a.success)
        return effective / max(self.communication_rounds, 1)


class MultiAgentEvaluator:
    """多Agent系统评估器"""
    
    def __init__(self, test_cases: List[dict]):
        self.test_cases = test_cases  # 标准测试集
        self.results: List[SystemMetrics] = []
    
    def evaluate(self, multi_agent_app, config_name="default"):
        """评估某个配置"""
        for case in self.test_cases:
            start_time = time.time()
            
            # 执行多Agent系统
            result = multi_agent_app.invoke({
                "original_task": case["task"],
                "expected_output": case["expected"]
            })
            
            # 收集指标
            system_metric = SystemMetrics(
                task_id=case["id"],
                e2e_success=self._check_success(result, case),
                total_latency_ms=(time.time() - start_time) * 1000,
                communication_rounds=result.get("iteration", 0),
                agent_metrics=self._collect_agent_metrics(result),
                total_cost=self._calculate_cost(result),
                conflict_count=result.get("conflicts", 0),
                loop_detected=result.get("loop_detected", False)
            )
            self.results.append(system_metric)
        
        return self._generate_report(config_name)
    
    def _generate_report(self, config_name) -> dict:
        """生成评估报告"""
        n = len(self.results)
        return {
            "config": config_name,
            "e2e_success_rate": sum(r.e2e_success for r in self.results) / n,
            "avg_agent_accuracy": sum(r.avg_agent_accuracy for r in self.results) / n,
            "avg_latency_p50": sorted([r.total_latency_ms for r in self.results])[n//2],
            "avg_comm_rounds": sum(r.communication_rounds for r in self.results) / n,
            "avg_collab_efficiency": sum(r.collaboration_efficiency for r in self.results) / n,
            "avg_total_cost": sum(r.total_cost for r in self.results) / n,
            "total_tokens": sum(r.total_tokens for r in self.results) / n,
            "conflict_rate": sum(r.conflict_count > 0 for r in self.results) / n,
            "loop_rate": sum(r.loop_detected for r in self.results) / n,
        }
```

## 工作流程评估模板

```python
WORKFLOW_EVAL_TEMPLATE = """
多Agent工作流评估报告
═══════════════════════════════════════════

任务: {task}
配置: {config}

┌─ 端到端结果 ─────────────────────────┐
│ 成功: {success}                       │
│ 总延迟: {latency:.1f}s                │
│ 总成本: ${cost:.4f}                   │
│ 总Token: {tokens:,}                   │
└──────────────────────────────────────┘

┌─ 协作指标 ───────────────────────────┐
│ 通信轮次: {rounds}                    │
│ 协作效率: {efficiency:.1%}            │
│ 冲突次数: {conflicts}                 │
│ 循环检测: {loop}                      │
└──────────────────────────────────────┘

┌─ Agent明细 ──────────────────────────┐
│ Agent   成功率  准确率  延迟   成本   │
│ ─────────────────────────────────── │
│ Orchestrator  100%  N/A   1.2s  $0.01│
│ Researcher     90%  85%   2.1s  $0.03│
│ Coder          85%  80%   3.5s  $0.05│
│ Reviewer       95%  90%   1.8s  $0.02│
└──────────────────────────────────────┘

结论: {conclusion}
"""
```

## 多Agent vs 单Agent 对比评估

```python
def compare_single_vs_multi(test_cases):
    """对比单Agent和多Agent方案"""
    
    # 单Agent方案
    single_results = evaluate_single_agent(test_cases)
    
    # 多Agent方案
    multi_results = evaluate_multi_agent(test_cases)
    
    comparison = {
        "准确率": {
            "单Agent": single_results["accuracy"],
            "多Agent": multi_results["accuracy"],
            "提升": f"+{(multi_results['accuracy'] - single_results['accuracy'])*100:.1f}%"
        },
        "延迟": {
            "单Agent": f"{single_results['latency']:.1f}s",
            "多Agent": f"{multi_results['latency']:.1f}s",
            "变化": f"{(multi_results['latency']/single_results['latency']-1)*100:+.0f}%"
        },
        "成本": {
            "单Agent": f"${single_results['cost']:.4f}",
            "多Agent": f"${multi_results['cost']:.4f}",
            "变化": f"{(multi_results['cost']/single_results['cost']-1)*100:+.0f}%"
        }
    }
    
    return comparison
```

## 什么时候多Agent不如单Agent

| 场景 | 推荐 | 原因 |
|------|------|------|
| 简单任务(1-2步) | 单Agent | 通信开销 > 协作收益 |
| 强依赖任务(线性) | 单Agent | 无法并行，多Agent无加速 |
| 成本敏感场景 | 单Agent | 多Agent token消耗3-10× |
| 低延迟要求 | 单Agent | 多Agent多轮通信增加延迟 |
| 复杂推理任务 | 多Agent | 专业化分工提升质量 |
| 需要并行处理 | 多Agent | 同时执行独立子任务 |
| 需要交叉验证 | 多Agent | 多视角减少错误 |

## 记忆要点

- 评估维度记三层：个体指标(准确率/延迟)、系统指标(通信轮次/冲突率)、经济指标(总成本/ROI)。
- 系统效果看全局：不仅看单Agent成功率，更要端到端(E2E)成功率与协作效率。
- 量化代码建两表：AgentMetrics记录单次执行，SystemMetrics聚合通信与冲突。

