---
id: note-bd4-004
difficulty: L4
category: ai
subcategory: Agent
tags:
- 字节
- 面经
- Harness
- 工程化
feynman:
  essence: Harness是包裹在Agent核心逻辑外面的工程化层，负责调度、超时熔断、上下文注入、可观测性、错误隔离等生产级保障
  analogy: Agent核心逻辑是赛车手，Harness是整辆赛车——引擎再好，没有刹车(熔断)、仪表盘(监控)、安全带(错误隔离)也不能上赛道
  first_principle: LLM是非确定性的，Agent是多步执行的复杂系统，生产环境必须用工程手段保障可靠性
  key_points:
  - 调度层：任务队列、并发控制、优先级
  - 超时熔断：单步超时、全局超时、失败重试
  - 上下文注入：System Prompt管理、动态上下文窗口
  - 可观测性：全链路trace、token计数、成本追踪
  - 错误隔离：单步失败不影响整体、降级兜底
first_principle:
  essence: LLM应用的工程复杂度不在模型调用，而在围绕模型调用的可靠性保障
  derivation: LLM输出不确定 → 单步可能失败 → 多步串联放大失败率 → 需要超时/重试/降级机制 → 需要监控发现问题 → 需要隔离避免级联失败
  conclusion: Harness层是Agent从demo走向生产的必经之路
follow_up:
- 你们Agent系统的P99延迟多少？怎么优化的？
- Agent超时后怎么处理？直接返回错误还是有兜底？
- 怎么做Agent的灰度发布？
memory_points:
- 一句话定义：包裹在Agent核心逻辑(LLM)外面的工程保障层
- 六大核心职责：调度(并发/编排)、熔断(超时/重试)、上下文管理
- 还包含：可观测性(Tracing)、错误隔离兜底、安全审计与人机协同
- 因为LLM API易超时打满，所以Harness层必须实现并发控制与三层超时兜底机制
---

# 什么是 Harness Engineering？Agent Harness 层包含哪些职责？

## 核心概念

```
┌──────────────────────────────────────────────────┐
│              Agent Harness 层                    │
│  (包裹在Agent核心逻辑外面的工程保障层)            │
├──────────────────────────────────────────────────┤
│                                                  │
│  ┌──────────┐ ┌──────────┐ ┌──────────────┐   │
│  │ 调度引擎  │ │ 超时熔断  │ │ 上下文管理    │   │
│  │ Scheduler │ │ Circuit  │ │ Context Mgr  │   │
│  │          │ │ Breaker  │ │              │   │
│  └──────────┘ └──────────┘ └──────────────┘   │
│                                                  │
│  ┌──────────┐ ┌──────────┐ ┌──────────────┐   │
│  │ 可观测性  │ │ 错误隔离  │ │ 成本控制     │   │
│  │ Tracing  │ │ Fallback │ │ Cost Tracker │   │
│  │ Metrics  │ │ Retry    │ │ Rate Limit   │   │
│  └──────────┘ └──────────┘ └──────────────┘   │
│                                                  │
│  ┌──────────┐ ┌──────────┐ ┌──────────────┐   │
│  │ 安全审计  │ │ 状态管理  │ │ 人机协同     │   │
│  │ Security │ │ State    │ │ Human Loop   │   │
│  │ Audit    │ │ Checkpt  │ │ Approval     │   │
│  └──────────┘ └──────────┘ └──────────────┘   │
│                                                  │
├──────────────────────────────────────────────────┤
│           Agent 核心逻辑 (Brain)                  │
│     LLM + Prompt + Tools + Memory               │
└──────────────────────────────────────────────────┘
```

## 六大核心职责

### 1. 调度引擎 (Scheduler)

```python
class AgentScheduler:
    def __init__(self, max_concurrent=10, max_queue=1000):
        self.semaphore = asyncio.Semaphore(max_concurrent)
        self.queue = asyncio.Queue(maxsize=max_queue)

    async def run(self, task):
        async with self.semaphore:  # 并发控制
            return await self._execute(task)
```

- **并发控制**：限制同时运行的Agent实例数，防止LLM API被打满
- **优先级队列**：VIP用户优先、实时任务优先于批量任务
- **任务编排**：Pipeline(串行)、Fan-out(并行)、DAG(复杂依赖)

### 2. 超时熔断 (Timeout & Circuit Breaker)

```python
async def execute_with_protection(self, step):
    # 单步超时
    try:
        result = await asyncio.wait_for(step.run(), timeout=30)
    except asyncio.TimeoutError:
        # 超时降级
        return await self.fallback(step)

    # 熔断器：连续失败N次 → 熔断 → 半开探测
    if self.circuit_breaker.is_open:
        return self.cached_result or self.fallback(step)
```

- **三层超时**：单步超时(30s) + 会话超时(120s) + 全局超时(300s)
- **指数退避重试**：失败后1s→2s→4s重试，最多3次
- **熔断器**：连续5次失败 → 熔断60s → 半开探测1次 → 恢复

### 3. 上下文管理 (Context Manager)

```python
class ContextManager:
    def build_context(self, history, max_tokens=8000):
        # Token预算分配
        system_prompt = 1000  # 固定
        tool_results = 2000   # 动态
        history = max_tokens - system_prompt - tool_results

        # 滑动窗口 + 摘要压缩
        if self.token_count(history) > history:
            old = history[:len(history)//2]
            summary = self.summarize(old)  # LLM摘要
            history = [{"role": "system", "content": summary}] + history[len(history)//2:]
```

- **Token预算**：System Prompt + History + Tool Results + Output ≤ Model Context
- **滑动窗口**：保留最近N轮，旧消息摘要压缩
- **动态注入**：根据当前步骤注入相关上下文(如用户画像、会话历史)

### 4. 可观测性 (Observability)

```python
# 全链路Trace
@trace("agent_step")
async def step(self, input):
    with span("llm_call") as s:
        s.set_tag("model", "gpt-4")
        s.set_tag("tokens_in", len(input))
        result = await llm.chat(input)
        s.set_tag("tokens_out", len(result))
        s.set_tag("cost_usd", calculate_cost(...))
    return result
```

- **Trace**：每个Agent步骤记录输入/输出/耗时/token/成本
- **Metrics**：成功率、P50/P99延迟、token消耗、工具调用分布
- **日志**：结构化日志，支持按session_id/user_id查询

### 5. 错误隔离与降级 (Error Isolation & Fallback)

```
工具调用失败 → 降级策略链：
  1. 重试(指数退避, 最多3次)
  2. 备用工具(如API1挂了用API2)
  3. 缓存结果(返回上次成功的类似结果)
  4. 优雅降级(告诉用户"暂时无法查询,但可以...")
  5. 转人工(最终兜底)
```

### 6. 安全与审计

- **PII脱敏**：日志中自动脱敏手机号、身份证等
- **Prompt注入防护**：输入过滤、输出校验
- **操作审计**：记录每个工具调用的参数和结果，支持事后溯源
- **速率限制**：防止单用户滥用(如每分钟最多10次Agent调用)

## 字节内部实践

字节内部的 **Eino** 框架和 **CloudWeGo** 生态就是典型的Harness层实现：
- Eino：Go语言AI编排框架，类似LangGraph的Graph引擎
- CloudWeGo：高性能RPC框架(Kitex) + HTTP框架(Hertz)
- 结合自研LLM网关，实现统一调度、限流、监控

## 记忆要点

- 一句话定义：包裹在Agent核心逻辑(LLM)外面的工程保障层
- 六大核心职责：调度(并发/编排)、熔断(超时/重试)、上下文管理
- 还包含：可观测性(Tracing)、错误隔离兜底、安全审计与人机协同
- 因为LLM API易超时打满，所以Harness层必须实现并发控制与三层超时兜底机制

