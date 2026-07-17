---
id: note-ai50-011
difficulty: L4
category: ai
subcategory: Agent
tags:
- 某厂
- 面经
- Agent
- Harness
- 工程化
feynman:
  essence: Agent Harness是包裹在LLM外面的工程框架，解决评测、观测、回放和安全控制四大问题，没有它Agent就像没有仪表盘的汽车
  analogy: 就像飞机的黑匣子+自动驾驶仪——不光让飞机飞起来(LLM生成)，还要记录每一步操作(Trace)、监控异常(Observability)、能复现问题(Replay)、紧急时能接管(Control)
  first_principle: LLM是随机系统，同一个输入可能产生不同输出。生产环境要求可调试、可监控、可复现、可回滚，这些能力LLM本身不提供，必须由外部Harness提供
  key_points:
  - '评测(Eval): 任务完成率、工具调用成功率、成本效率'
  - '观测(Observability): Trace每一步的Prompt/Response/Tool I/O'
  - '回放(Replay): 精确复现某次执行的完整链路'
  - '控制(Control): 超时中断、重试策略、安全护栏'
first_principle:
  essence: 生产系统要求确定性，LLM本质是概率系统，Harness是在概率系统上构建确定性工程保障的中间层
  derivation: '没有Harness: Agent出错时无法定位(哪一步失败?)、无法复现(随机性)、无法统计(成功率多少?)、无法控制(无限循环?)。每个问题都是生产事故'
  conclusion: Agent Harness不是锦上添花而是生产必需，是从Demo到产品的必经之路
follow_up:
- LangSmith和Langfuse等工具在Harness中的角色？
- Agent评测自动化怎么搭建？
- Harness和Agent Framework(如LangChain)是什么关系？
memory_points:
- 核心痛点：无Harness的Agent面临不可调试、不可复现、不可控三大黑洞
- Trace能力：全链路追踪Prompt、Response、Token和工具调用，定位具体出错步骤
- 控制能力：防止Agent陷入死循环或调用危险工具，限制成本和步数
- 评估迭代：支持A/B测试与指标监控，量化对比不同模型或Prompt的效果
---

# 没有Agent Harness大模型会遇到什么瓶颈？

## 没有Harness的六大瓶颈

```
┌────────────────────────────────────────────────────┐
│              裸LLM Agent (无Harness)                 │
│                                                     │
│  ❌ 瓶颈1: 不可调试                                  │
│     Agent给出错误答案，但不知道是哪一步出错            │
│                                                     │
│  ❌ 瓶颈2: 不可复现                                  │
│     同一问题有时对有时错，无法稳定复现bug              │
│                                                     │
│  ❌ 瓶颈3: 不可监控                                  │
│     不知道延迟分布、成本消耗、工具调用成功率            │
│                                                     │
│  ❌ 瓶颈4: 不可控制                                  │
│     Agent可能无限循环、调用危险工具、成本失控          │
│                                                     │
│  ❌ 瓶颈5: 不可评估                                  │
│     换了Prompt或模型，不知道是变好了还是变差了         │
│                                                     │
│  ❌ 瓶颈6: 不可迭代                                  │
│     无法做A/B测试，无法对比不同策略的效果             │
└────────────────────────────────────────────────────┘
```

## Harness的四大核心能力

### 1. Trace（全链路追踪）

```python
# 每一步都记录完整的输入输出
@trace
def agent_step(step_name, input_data):
    """自动记录每一步的完整信息"""
    trace_data = {
        "step": step_name,
        "timestamp": time.time(),
        "input": input_data,
        "prompt": rendered_prompt,      # 完整Prompt
        "model": model_name,
        "response": llm_response,        # 完整响应
        "tokens": {"input": 500, "output": 200},
        "latency_ms": 1200,
        "tool_calls": [{"name": "search", "args": {...}, "result": ...}]
    }
    tracer.log(trace_data)  # 发送到LangSmith/Langfuse
```

```
Trace示例:
├── Planner
│   ├── input: "帮我分析这份数据"
│   ├── prompt: [完整system + user prompt]
│   ├── response: "需要执行3个步骤..."
│   ├── latency: 1.2s, tokens: 500→200
├── Tool: search_database
│   ├── input: {"query": "sales 2024"}
│   ├── output: [{"date": "2024-01", ...}]
│   ├── latency: 0.8s, status: success
├── Analyzer
│   ├── input: "分析以下数据..."
│   ├── response: "销售趋势显示..."
│   ├── latency: 2.1s, tokens: 800→400
└── Final: "2024年销售趋势分析完成..."
```

### 2. Evaluation（自动化评测）

```python
class AgentEvaluator:
    def __init__(self, test_cases):
        self.test_cases = test_cases  # 标准测试集
    
    def evaluate(self, agent_config):
        """评估某个Agent配置的效果"""
        results = []
        for case in self.test_cases:
            output = agent_config.run(case['input'])
            
            results.append({
                "task_completion": self.check_completion(output, case['expected']),
                "tool_accuracy": self.check_tools(output, case['expected_tools']),
                "latency_p50": output.latency_p50,
                "latency_p99": output.latency_p99,
                "cost_per_task": output.total_cost,
                "token_usage": output.total_tokens,
            })
        
        return {
            "success_rate": mean(r['task_completion'] for r in results),
            "tool_success_rate": mean(r['tool_accuracy'] for r in results),
            "avg_latency": mean(r['latency_p50'] for r in results),
            "avg_cost": mean(r['cost_per_task'] for r in results),
        }
```

### 3. Replay（精确回放）

```python
def replay_session(trace_id):
    """根据Trace记录精确回放某次执行"""
    trace = tracer.get_trace(trace_id)
    
    for step in trace.steps:
        print(f"[{step.timestamp}] {step.name}")
        print(f"  Input: {step.input}")
        print(f"  Prompt: {step.prompt[:200]}...")
        print(f"  Output: {step.output}")
        print(f"  Latency: {step.latency_ms}ms")
        
        # 可以修改某步的输入重新执行
        if step.name == "Planner":
            # 从这里开始用新的Prompt重跑
            new_output = rerun_from_step(step, new_prompt="...")
```

### 4. Control（运行时控制）

```python
class AgentController:
    def __init__(self):
        self.max_iterations = 10
        self.max_cost = 0.50  # 单次任务最多$0.50
        self.timeout = 60     # 60秒超时
        self.forbidden_tools = ["delete_database"]
    
    def check(self, step, accumulated_cost):
        """每步执行前的安全检查"""
        if step.iteration > self.max_iterations:
            raise MaxIterationError()
        if accumulated_cost > self.max_cost:
            raise BudgetExceededError()
        if step.tool in self.forbidden_tools:
            raise ForbiddenToolError()
        return True
```

## Harness工具生态

| 工具 | 核心能力 | 适用场景 |
|------|---------|---------|
| LangSmith | Trace + Eval + Dataset | LangChain生态首选 |
| Langfuse | 开源Trace + Eval | 自托管需求 |
| Phoenix(Arize) | Trace + LLM Eval | 侧重可观测性 |
| Weights & Biases | Eval + 实验追踪 | ML团队已有 |
| Braintrust | Eval + Prompt Playground | 快速迭代评估 |

## 从Demo到生产的Harness清单

```
□ Trace: 每步Prompt/Response/Tool I/O完整记录
□ Metrics: 延迟(P50/P99)、Token用量、成本、成功率
□ Eval: 自动化测试集，CI/CD中运行
□ Replay: 能根据Trace ID精确复现问题
□ Alert: 延迟或错误率超阈值自动告警
□ Budget: 单次任务成本上限
□ Timeout: 单步和总执行时间限制
□ Guardrails: 危险工具和内容过滤
□ Versioning: Prompt和模型版本管理
□ A/B Test: 新策略灰度对比
```

## 记忆要点

- 核心痛点：无Harness的Agent面临不可调试、不可复现、不可控三大黑洞
- Trace能力：全链路追踪Prompt、Response、Token和工具调用，定位具体出错步骤
- 控制能力：防止Agent陷入死循环或调用危险工具，限制成本和步数
- 评估迭代：支持A/B测试与指标监控，量化对比不同模型或Prompt的效果

## 苏格拉底式面试追问

> 这组追问模拟面试官层层逼问，每一问先回答"为什么"，再回答"怎么做"，最后回答"如何证明"。

### 第一层：目标与动机

**Q：Agent Harness 解决的"不可调试、不可复现、不可控"三大黑洞，为什么 LLM 本身解决不了？**

LLM 是随机系统（temperature>0 时同输入不同输出），且是黑盒（无法看内部状态）。不可调试——出错了不知道是 prompt 问题、检索问题还是模型推理问题；不可复现——同一条 query 重跑结果不同，无法定位是偶发还是必现；不可控——可能死循环（反复调同一工具）、调用危险工具（删库）、成本爆炸（跑 100 步）。Harness 通过 Trace（可调试）、Replay（可复现）、Guardrail（可控）补上这些能力，因为 LLM 本身不提供这些工程语义。

### 第二层：证据与定位

**Q：你的 Agent 线上出现"成本异常"（单次任务花了 $5），怎么定位是哪一步烧的钱？**

靠 Trace 的 token 级追踪。每个 LLM 调用记录 prompt token 数、completion token 数、model 名称，按 model 单价算费用。线上任务 $5 意味着要么步数爆炸（跑了 50+ 步），要么单步 prompt 过长（Observation 塞了大段数据）。按 trace_id 查看该任务的每步 token 明细，找 token 峰值步骤。常见根因：ReAct 死循环（前一步 Observation 触发后一步重复 Action）或 RAG 召回过多 chunk 全塞进 prompt。

### 第三层：根因深挖

**Q：Trace 显示 Agent 在第 8 步和第 9 步之间死循环（重复调同一工具同样参数），根因是什么？**

根因是 Agent 没有正确处理"已经做过的动作"。ReAct 的 prompt 累积所有历史，理论上模型应该看到"第 8 步已经调过这个工具"，但实际上长上下文下模型对历史注意力衰减（lost in the middle），忘了第 8 步做过，第 9 步重复。治本有三招：一是 prompt 里显式加"已执行的步骤"摘要；二是用 visited_actions 集合做去重，重复 Action 直接拦截；三是设 max_steps 上限（如 15 步）强制终止。

**Q：那为什么不直接用有状态的 FSM（如 LangGraph）替代 ReAct，状态图天然防死循环？**

LangGraph 的状态图能定义明确的节点转移（A→B→C），理论上能防死循环，但牺牲了灵活性。ReAct 的优势是动态决策（下一步做什么由模型基于 Observation 决定），适合不确定环境；LangGraph 的转移是预定义的，适合流程固定的场景。正确姿势是混合：用 LangGraph 定义粗粒度状态（如"检索→生成→校验"），每个状态内部用 ReAct 做细粒度执行。死循环问题用 max_steps + visited_actions 去重兜底，不必为了防循环放弃 ReAct 的灵活性。

### 第四层：方案权衡

**Q：Harness 的 Trace 你记录了 prompt/response/tool_call，数据量很大，怎么存？全存成本扛不住？**

分级存储。热数据（最近 7 天的 Trace）存 Elasticsearch/ClickHouse，支持快速查询和告警；冷数据（7 天以上）转存 S3/OSS，按 trace_id 索引，需要时再捞。采样策略：成功 case 采 10%（够统计指标），失败 case 100% 存（用于 debug）。token 级明细只存采样 case 的，全量 case 只存聚合指标（总 token 数、总费用、总步数）。这样存储成本可控，且失败 case 不漏。

**Q：为什么不直接用 OpenTelemetry 这种通用 tracing，还要搞专门的 LLM Harness？**

OpenTelemetry 的 span 模型是为微服务调用链设计的（RPC/DB call），无法表达 LLM 特有的语义——prompt 内容、token 数、model 名称、tool schema。LLM Harness 在 OTel 基础上扩展了 LLM-specific 的 attribute（如 `llm.prompt_tokens`、`llm.model`、`gen_ai.tool.name`），现在 OpenTelemetry 也有 GenAI semantic conventions 在跟进。选型上：如果团队已有 OTel 基建，用 OTel + GenAI convention 扩展；如果没有，用 LangSmith/Langfuse 这种 LLM-native 的 Harness 平台，开箱即用。

### 第五层：验证与沉淀

**Q：你怎么证明 Harness（Trace + Guardrail）真的提升了 Agent 的线上可靠性，而不是心理安慰？**

看两个指标的改善：一是平均故障定位时间（MTTD）——Harness 上线前，一个"Agent 偶发答错"的 bug 要复现 N 次才能定位，MTTD 可能是几天；上线后 Trace 直接显示哪步出错，MTTD 降到分钟级。二是线上事故率——Guardrail（max_steps、cost_limit、危险工具拦截）拦截了多少潜在事故，统计拦截次数。把"被 Guardrail 拦截的 case"分类（死循环/成本爆炸/危险调用），证明每一类 Guardrail 都有实际触发，不是摆设。

**Q：Harness 怎么沉淀成团队标配能力？**

固化成 Agent 开发框架：所有 Agent 必须接入 Trace（自动埋点，业务无感）、必须配置 Guardrail（max_steps、cost_limit、tool_whitelist）、必须接评估看板（成功率、token 成本、P99 延迟）。沉淀"Trace 字段标准""Guardrail 配置模板""常见事故 case 库"，新人开发的 Agent 自动获得可调试可控制能力。把"无 Harness 不上线"写进 Agent 上线 checklist，强制执行。

## 结构化回答


**30 秒电梯演讲：** 就像飞机的黑匣子+自动驾驶仪——不光让飞机飞起来(LLM生成)，还要记录每一步操作(Trace)、监控异常(Observability)、能复现问题(Replay)、紧急时能接管(Control)

**展开框架：**
1. **评测(Eval)** — 任务完成率、工具调用成功率、成本效率
2. **观测(Observability)** — Trace每一步的Prompt/Response/Tool I/O
3. **回放(Replay)** — 精确复现某次执行的完整链路

**收尾：** LangSmith和Langfuse等工具在Harness中的角色？



## 视频脚本

> 预计时长：5 分钟 | 由浅入深


| 时间 | 画面/字幕 | 口播台词 | 讲解要点 |
|------|----------|----------|----------|
| 0:00 | 标题卡：没有Agent Harness大模型会遇到什么瓶… | "就像飞机的黑匣子+自动驾驶仪——不光让飞机飞起来(LLM生成)，还要记录每一步操作(…" | 开场钩子 |
| 0:20 | 核心概念图 | "Agent Harness是包裹在LLM外面的工程框架，解决评测、观测、回放和安全控制四大问题，没有它Agent就像没有…" | 核心定义 |
| 0:50 | 评测(Eval)示意图 | "评测(Eval)——任务完成率、工具调用成功率、成本效率" | 要点拆解1 |
| 1:30 | 观测(O示意图 | "观测(O——Trace每一步的Prompt/Response/Tool I/O" | 要点拆解2 |
| 2:20 | 对比/实战案例图 | "对比一下常见误区和工程实践，看真实场景里怎么取舍。" | 实战与对比 |
| 3:10 | 总结卡 | "记住核心要点。下期我们追问：LangSmith和Langfuse等工具在Harness中？" | 收尾与钩子 |
