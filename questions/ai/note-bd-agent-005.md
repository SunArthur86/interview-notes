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

## 苏格拉底式面试追问

> 这组追问模拟面试官层层逼问，每一问先回答"为什么"，再回答"怎么做"，最后回答"如何证明"。

### 第一层：目标与动机

**Q：Agent Harness 的 Eval/Trace/Replay/Safety 四能力，为什么 LLM 本身提供不了，非要外挂？**

因为 LLM 是无状态的随机黑盒。Eval——LLM 输出有随机性（temperature>0），跑一次不能代表质量，必须外部跑多次统计；Trace——LLM 不记录自己的 prompt/tool_call/中间推理，必须外部埋点；Replay——LLM 无状态，同一输入可能不同输出，必须外部持久化执行轨迹才能复现；Safety——LLM 不理解业务安全（可能调危险工具、死循环、成本爆炸），必须外部 Guardrail 约束。四能力都是"LLM 不提供但生产必需"的，只能靠 Harness 外挂。

### 第二层：证据与定位

**Q：你的 Agent 线上任务完成率从 85% 掉到 70%，你怎么用 Trace 定位是哪个环节退化？**

按 Trace 的树形 Span 结构分层归因。看每个节点（LLM 调用、tool_call、规则校验）的失败率变化——哪个节点的失败率涨幅最大，就是退化源头。常见情况：如果是 LLM 推理节点失败率涨，可能是模型版本被切（API provider 更新模型）；如果是 tool_call 失败率涨，是下游服务问题（如 RPC 超时）；如果是规则校验拦截率涨，是输入分布变化（如用户 query 类型变了）。Trace 的价值是"把整体退化拆到节点级"，精准定位而非瞎猜。

### 第三层：根因深挖

**Q：你发现 Trace 显示 Agent 的 token 成本突然涨了 3 倍，根因是什么？**

看 Trace 的 token 明细。可能是：一是 prompt 变长（如 RAG 召回的 chunk 数从 5 涨到 20，或历史 Memory 注入太多）；二是步数变多（Agent 在某类任务上死循环或多走了几步）；三是模型被切到更贵的版本。按 trace_id 查高 token 任务的明细，看是 prompt 涨（input token 大）还是生成涨（output token 大）。常见根因是 RAG 的 top_k 被调大（"召回更多提升质量"），导致每次 prompt 注入大量 chunk，成本爆炸但质量没提升。

**Q：那为什么不直接对每个请求设硬 token 上限（如 max_tokens=1000），省得成本失控？**

max_tokens 限制的是单次生成的 output token，限制不了 prompt（input）和总步数。且硬限制会截断输出——如果任务需要 1200 token 才能完成，1000 截断后任务失败，反而触发重试更耗 token。正确做法是"预算控制"而非"单次硬限制"：设单任务的总 token 预算（如 input+output 总和 5000），Agent 框架累计 token，超预算时停止并返回"任务过长"兜底。这样既控成本又不武断截断正常任务。预算控制是 Harness 的 Safety 能力之一。

### 第四层：方案权衡

**Q：Trace 数据量很大（每任务几十 KB），你全存还是采样？采样会不会漏掉关键 case？**

分级存储 + 采样。全存成本扛不住（万 QPS × 每天 = TB 级），策略是：成功 case 采 10%（够统计指标和趋势分析），失败 case 100% 存（debug 必需），超时/成本异常 case 100% 存（优化必需）。采样是随机的，不会系统性漏掉某类 case（只要采样率够）。对关键业务（如涉及资金的 Agent），可以提高到 30% 采样。冷热分层：热数据（7 天）存 ES/ClickHouse 支持查询，冷数据转 S3 归档。token 级明细只存采样 case，全量 case 只存聚合指标。

**Q：为什么不直接用 OpenTelemetry（OTel）这种通用 tracing，还要搞 LLM 专用的 Trace 格式？**

OTel 的 span 模型是微服务调用链（RPC/DB），表达不了 LLM 语义——prompt 内容、token 数、model 名称、tool schema 这些 LLM-specific 字段 OTel 默认不支持。虽然 OTel 在推 GenAI semantic conventions，但成熟度不够。LLM 专用 Trace（如 LangSmith/Langfuse）内置了 prompt diff、token 成本分析、LLM 调用树可视化，开箱即用。选型上：如果团队已有 OTel 基建，用 OTel + GenAI convention 扩展；如果没有，用 LLM-native 平台省事。Trace 的核心是"能表达 LLM 语义"，工具是其次。

### 第五层：验证与沉淀

**Q：Harness 的 Eval 你说要"跑多次取平均"，具体跑几次？怎么判断差异是随机还是真退化？**

跑 n_runs 次（通常 3-5 次），看成功率的均值和方差。判断退化的方法是：对比两个版本（如改 prompt 前后），各跑 n_runs，做统计检验（如配对 t 检验或 bootstrap），如果 p<0.05 且新版成功率低，才算真退化；如果 p>0.05，差异可能是随机噪声，不能下结论。n_runs 太少（如 1 次）无法区分随机和真退化，太多（如 20 次）成本高。生产级评测集建议 n_runs=5，配合统计检验，可信度和成本平衡。

**Q：Agent Harness 怎么沉淀成团队标配？**

固化成"无 Harness 不上线"的规范：所有 Agent 必须接 Trace（自动埋点）、必须配置 Safety（max_steps/cost_limit/tool_whitelist）、必须接 Eval 看板（每次改动跑回归评测）。提供统一的 Harness SDK（封装 Trace/Safety/Eval），业务侧接入即获得能力。沉淀"Trace 字段标准""Safety 配置模板""Eval 评测集规范"，新 Agent 按模板配。把 Harness 的四大能力做成 Agent 上线的 checklist 项，强制执行，避免"裸跑 Agent"上线后出事。

## 结构化回答

**30 秒电梯演讲：** Agent Harness是Agent的生产运行时框架，解决评测、观测、回放和安全四大工程问题——Agent Harness就像飞机的黑匣子+自动驾驶测试台。

**展开框架：**
1. **评测** — 任务完成率、Tool成功率、延迟和成本度量
2. **观测** — 全链路Trace，记录每步Prompt和输出
3. **回放** — 从检查点恢复和复现执行过程

**收尾：** 您想深入聊：Agent评测的Golden Set怎么构建？


## 视频脚本

> 预计时长：4 分钟 | 由浅入深


| 时间 | 画面/字幕 | 口播台词 | 讲解要点 |
|------|----------|----------|----------|
| 0:00 | 标题卡：从工程化角度看，Agent Harness主要解… | "Agent Harness就像飞机的黑匣子+自动驾驶测试台——记录每一步操作、实时监控状态…" | 开场钩子 |
| 0:20 | 核心概念图 | "Agent Harness是Agent的生产运行时框架，解决评测、观测、回放和安全四大工程问题" | 核心定义 |
| 0:50 | 评测示意图 | "评测——任务完成率、Tool成功率、延迟和成本度量" | 要点拆解1 |
| 1:30 | 对比/实战案例图 | "对比一下常见误区和工程实践，看真实场景里怎么取舍。" | 实战与对比 |
| 2:20 | 总结卡 | "记住核心要点。下期我们追问：Agent评测的Golden Set怎么构建？" | 收尾与钩子 |
