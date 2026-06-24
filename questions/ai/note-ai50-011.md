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
  essence: 'Agent Harness是包裹在LLM外面的工程框架，解决评测、观测、回放和安全控制四大问题，没有它Agent就像没有仪表盘的汽车'
  analogy: '就像飞机的黑匣子+自动驾驶仪——不光让飞机飞起来(LLM生成)，还要记录每一步操作(Trace)、监控异常(Observability)、能复现问题(Replay)、紧急时能接管(Control)'
  first_principle: 'LLM是随机系统，同一个输入可能产生不同输出。生产环境要求可调试、可监控、可复现、可回滚，这些能力LLM本身不提供，必须由外部Harness提供'
  key_points:
    - '评测(Eval): 任务完成率、工具调用成功率、成本效率'
    - '观测(Observability): Trace每一步的Prompt/Response/Tool I/O'
    - '回放(Replay): 精确复现某次执行的完整链路'
    - '控制(Control): 超时中断、重试策略、安全护栏'
first_principle:
  essence: '生产系统要求确定性，LLM本质是概率系统，Harness是在概率系统上构建确定性工程保障的中间层'
  derivation: '没有Harness: Agent出错时无法定位(哪一步失败?)、无法复现(随机性)、无法统计(成功率多少?)、无法控制(无限循环?)。每个问题都是生产事故'
  conclusion: 'Agent Harness不是锦上添花而是生产必需，是从Demo到产品的必经之路'
follow_up:
  - 'LangSmith和Langfuse等工具在Harness中的角色？'
  - 'Agent评测自动化怎么搭建？'
  - 'Harness和Agent Framework(如LangChain)是什么关系？'
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
