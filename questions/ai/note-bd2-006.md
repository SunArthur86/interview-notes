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

## 苏格拉底式面试追问

> 这组追问模拟面试官层层逼问，每一问先回答"为什么"，再回答"怎么做"，最后回答"如何证明"。

### 第一层：目标与动机

**Q：多 Agent 评估你分"个体/系统/经济"三层。为什么不只看端到端（E2E）成功率，省得拆三层？**

E2E 成功率看不出"哪里出错"和"是否值得"。E2E 只有 60%，可能是单个 Agent 拉胯（如检索 Agent 准确率 50%，拖累全局），也可能是协作流程问题（如 Agent 间通信丢失信息）。不看个体指标就无法定位瓶颈。经济层更重要——多 Agent 系统的 token 成本可能是单 Agent 的 5-10 倍（每个 Agent 都调用 LLM），如果 E2E 成功率只提升 5% 但成本涨 10 倍，ROI 为负，不值得。三层评估让你既看效果（E2E）、又看瓶颈（个体）、还看成本（经济），综合决策"是否值得用多 Agent"。

### 第二层：证据与定位

**Q：多 Agent 系统的 E2E 成功率从 80% 降到 55%。你怎么用三层指标定位是个体退化、协作失效、还是成本爆炸？**

逐层对比基线。一是个体层——各 Agent 的 accuracy 是否降了（如检索 Agent 从 90% 降到 70%），如果某个 Agent 退化明显，是该 Agent 的问题（工具失效/prompt 退化）；二是系统层——communication_rounds（平均通信轮次）是否暴涨（如从 5 轮涨到 15 轮，说明协作效率变差，可能死循环或反复重试）、conflict_rate（Agent 间结果冲突的比例）是否升了；三是经济层——total_cost 是否暴涨（如从 0.05 美元/任务涨到 0.3 美元，说明某个 Agent 在烧 token，可能陷入长循环）。三层交叉定位：个体退化 + 成本暴涨 = 某 Agent 质量差导致重试；个体正常 + 通信暴涨 = 协作流程问题（编排逻辑 bug）。

### 第三层：根因深挖

**Q：多 Agent 系统的通信轮次（communication_rounds）越来越高（如从 5 轮涨到 12 轮）。根因是什么？**

根因是"协作效率退化"或"Agent 间不信任"。协作效率退化——任务拆解不合理（本该一步完成的拆成多步，每步一个 Agent，轮次自然多）或依赖关系设计错（本可并行的串行了，轮次翻倍）。Agent 间不信任——Agent A 收到 Agent B 的结果后不信任，反复要求 B 确认或自己重做（如 A 觉得 B 的检索结果不全，自己再检索一次，轮次+1），本质是 Agent 间没有清晰的"职责边界"和"信任机制"。治本：一是优化任务拆解（合并相似子任务、最大化并行）；二是明确职责边界（每个 Agent 只做自己的事，不越权重做别人的）；三是加"结果置信度标注"（B 返回结果时带 confidence score，A 判断是否需要重做）。

**Q：那为什么不直接设一个全局的 max_rounds（如最多 5 轮），硬终止，省得通信轮次失控？**

max_rounds 是必要的兜底但治标不治本。设 max_rounds=5 能防止成本爆炸，但如果正常任务需要 6 轮，硬终止会导致任务失败（success_rate 降）。根因（协作效率差/不信任）没解决，即使 max_rounds 内完成，也是低效的（5 轮本该 3 轮完成）。正确做法是"max_rounds 兜底 + 根因优化"——先设 max_rounds（如 10）防止失控，同时分析每次接近 max_rounds 的任务（是拆解不合理还是 Agent 冲突），优化协作流程把平均轮次降到合理水平（如 4-5 轮）。max_rounds 是"安全阀"，不是"优化手段"，不能依赖它掩盖协作设计的缺陷。

### 第四层：方案权衡

**Q：系统指标你用 communication_rounds 和 conflict_rate。为什么不直接用更细的指标（如每条消息的延迟、每个 Agent 的等待时间）？**

细指标诊断价值高但收集成本高。每条消息的延迟、每个 Agent 的等待时间能精确定位"哪个 Agent 慢""哪条通信阻塞"，但需要全链路 trace（每条消息打时间戳、记录 Agent 间的等待队列），工程实现重。communication_rounds 和 conflict_rate 是"聚合指标"——粗粒度但容易收集（数消息数和冲突数），适合"日常监控和告警"（如轮次突然涨就告警）。细指标适合"问题定位"（告警后下钻，用 trace 查具体哪步慢）。两层配合：粗指标做监控，细指标做诊断。生产系统先上粗指标（低成本），有问题时加 trace 查细指标，不要一上来就全量 trace（存储和性能开销大）。

**Q：为什么不直接用现成的 APM（如 LangSmith、Langfuse）做多 Agent 评估，省得自己建指标？**

现成 APM 降低开发成本但有局限。LangSmith/Langfuse 提供 trace 可视化、token 统计、基础指标（latency/cost/success_rate），快速接入。但局限：一是多 Agent 专属指标缺失——如 conflict_rate（Agent 间结果冲突）、communication_rounds（通信轮次）需要自定义，APM 不直接提供；二是评估闭环不完整——APM 擅长 trace 和统计，但"golden set 评估""A/B 测试""自动回归"需要额外搭建；三是数据主权——trace 数据存在第三方 SaaS，敏感场景（如金融、医疗）不能上云。选型看阶段——原型用 LangSmith 快速看 trace，生产化时自建评估系统（基于 Langfuse 开源版或自研）保证定制性和数据主权。

### 第五层：验证与沉淀

**Q：你怎么证明多 Agent 系统的评估体系有效，能发现真实问题？**

验证"指标异常 → 真实问题"的关联性。一是注入故障测试——故意制造已知问题（如让某个 Agent 返回错结果、断开某条通信），看指标是否异常（individual accuracy 降/conflict_rate 升），如果指标没反应，说明指标设计有盲区；二是历史回溯——回顾过去出过的线上事故，看当时的指标是否有前兆（如某次事故前 communication_rounds 已经缓慢上涨），验证指标的预警能力；三是人工抽检——抽 100 个任务人工标注"是否真的成功"，对比 E2E success_rate 的自动统计，校准准确率（自动统计可能有误判，如任务"看似完成但答案错"）。关键是要有 golden set（人工标注的正确答案），否则 E2E success_rate 无法自动计算。

**Q：多 Agent 评估体系怎么沉淀成团队标配？**

固化成"多 Agent 评估平台"：自动 trace 收集（每步 Agent 执行记录到 AgentMetrics 表）、指标聚合（按任务/Agent/时间维度统计 individual/system/economic 指标）、golden set 评估（定期跑标注集算 E2E success_rate）、A/B 测试框架（对比不同协作模式的指标）、告警（success_rate 骤降/cost 暴涨/rounds 异常）。沉淀"各场景的指标基线"（如客服多 Agent 的正常 success_rate >85%、rounds <8）、"常见问题的指标特征"（如 rounds 涨 = 协作退化、cost 涨 = 某Agent烧token）、"golden set 构建规范"。把"三层评估"作为多 Agent 系统的标配能力，新系统上线即接入评估。

## 结构化回答

**30 秒电梯演讲：** 多Agent系统评估分两层: 个体层(每个Agent的准确率和效率)和系统层(协作效率、任务完成率、成本)——就像评估一支球队。

**展开框架：**
1. **个体指标** — 每个Agent的任务完成率、准确率、延迟、成本
2. **系统指标** — 端到端任务完成率、协作效率、通信开销、冗余度
3. **工作流指标** — 任务分解合理性、依赖满足率、并行度

**收尾：** 您想深入聊：如何构建多Agent系统的自动化测试集？


## 视频脚本

> 预计时长：5 分钟 | 由浅入深


| 时间 | 画面/字幕 | 口播台词 | 讲解要点 |
|------|----------|----------|----------|
| 0:00 | 标题卡：多Agent系统的工作流程和效果量化评估 | "就像评估一支球队——不光看个人数据(进球、助攻)，还要看团队指标(传球成功率、配合默契度…" | 开场钩子 |
| 0:20 | 核心概念图 | "多Agent系统评估分两层: 个体层(每个Agent的准确率和效率)和系统层(协作效率、任务完成率、成本)" | 核心定义 |
| 0:50 | 个体指标示意图 | "个体指标——每个Agent的任务完成率、准确率、延迟、成本" | 要点拆解1 |
| 1:30 | 系统指标示意图 | "系统指标——端到端任务完成率、协作效率、通信开销、冗余度" | 要点拆解2 |
| 2:20 | 对比/实战案例图 | "对比一下常见误区和工程实践，看真实场景里怎么取舍。" | 实战与对比 |
| 3:10 | 总结卡 | "记住核心要点。下期我们追问：如何构建多Agent系统的自动化测试集？" | 收尾与钩子 |
