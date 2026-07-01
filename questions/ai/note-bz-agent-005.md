---
id: note-bz-agent-005
difficulty: L3
category: ai
subcategory: Agent
tags:
- B站面经
- Agent
- 企业级
- 架构
- 组件
feynman:
  essence: 企业级Agent必备六大组件——编排引擎(大脑)、记忆模块(状态)、工具层(手脚)、知识库(参考书)、安全层(免疫)、可观测层(监控)。区别于demo的核心是稳定性和可观测。
  analogy: 像建工厂——车间(编排)、仓库(记忆)、机器(工具)、资料室(知识)、安保(安全)、监控室(可观测)，缺一不可。
  first_principle: 企业级=能在真实生产环境7x24稳定运行的Agent。这要求除了核心智能，还要有容错、安全、可监控、可扩展的工程能力。
  key_points:
  - 六大组件：编排/记忆/工具/知识/安全/可观测
  - 企业级vs demo的区别：稳定性+可观测+可扩展
  - 编排引擎是核心，决定Agent的智能上限
  - 安全和可观测决定能否上线
first_principle:
  essence: 企业级Agent的本质矛盾是"智能性"与"可靠性"的平衡。
  derivation: demo追求智能（能完成任务），企业级追求可靠（每次都稳定完成）。智能靠LLM，可靠靠工程——容错、限流、降级、监控、人工兜底。所以企业级=demo+大量工程化组件。
  conclusion: 企业级Agent = 智能核心(LLM) + 工程外壳(六大组件)，工程外壳决定能否生产部署
follow_up:
- 企业级Agent和开源框架什么关系？——框架提供组件骨架，企业需定制化
- 多大规模算企业级？——看并发（千级QPS）+可用性（99.9%）+多租户
- 最难落地的组件是哪个？——记忆（检索召回+用户隔离+遗忘策略）
memory_points:
- 本质区别：Demo跑通即可，而企业级需满足千万级并发、SLA 99.9%+及完善容错
- 六大必备组件：编排引擎、记忆模块、工具层、知识库、安全层、可观测监控
- 记忆工程：需用户隔离、重排序（Rerank）、以及基于TTL的遗忘机制
- 企业级工具规范：必须包含参数Schema、权限矩阵、限流和降级策略
---

# 企业级 Agent 如何搭建？必备组件有哪些？

## 一、企业级 vs Demo 的区别

```
┌──────────────┬──────────────────┬──────────────────────┐
│ 维度          │ Demo               │ 企业级                  │
├──────────────┼──────────────────┼──────────────────────┤
│ 并发          │ 单用户             │ 千万级并发              │
│ 可用性        │ 跑通即可           │ SLA 99.9%+             │
│ 容错          │ 崩了重启           │ 自动降级+故障转移        │
│ 安全          │ 无                 │ 权限/审计/脱敏/防注入    │
│ 可观测        │ print日志          │ 全链路Trace+监控告警     │
│ 成本          │ 不计               │ 每次调用都要算钱         │
│ 多租户        │ 无                 │ 用户/组织隔离            │
│ 迭代          │ 手动改             │ A/B测试+灰度+回滚        │
└──────────────┴──────────────────┴──────────────────────┘
```

## 二、六大必备组件

### 组件 1：编排引擎（Orchestrator）— 大脑

```python
class Orchestrator:
    """Agent的大脑，负责调度一切"""
    def run(self, goal, context):
        # 1. 意图理解
        intent = self.understand(goal)
        # 2. 任务规划
        plan = self.planner.decompose(intent)
        # 3. 循环执行
        for step in plan:
            result = self.execute_with_recovery(step)
            if result.need_replan:
                plan = self.planner.replan(plan, result)
        # 4. 结果聚合
        return self.aggregate(plan.results)
```

**关键能力：** 任务分解、路由决策、失败重规划、结果聚合、循环控制。

### 组件 2：记忆模块（Memory）— 状态

```
分层记忆架构：
├── Working Memory（工作记忆）
│   = 当前对话上下文（LLM可见）
├── Episodic Memory（情景记忆）
│   = 历史执行轨迹（用于复盘和重规划）
├── Semantic Memory（语义记忆）
│   = 知识库/RAG（向量检索）
└── User Profile（用户画像）
    = 用户偏好/历史（个性化）

工程要点：
- 用户隔离（namespace/user_id过滤）
- 检索召回（embedding + rerank）
- 遗忘机制（TTL + LRU + 重要性衰减）
```

### 组件 3：工具层（Tools）— 手脚

```python
# 企业级工具要有完整规范
class Tool:
    name: str               # 唯一标识
    description: str        # LLM看的描述
    parameters: Schema      # 参数JSON Schema
    permissions: List[str]  # 谁能调用
    rate_limit: int         # 调用频率限制
    timeout: int            # 超时时间
    retry_policy: dict      # 重试策略
    fallback: str           # 降级方案

# 工具治理（30+工具时的管理）
- 工具检索：用RAG按需召回工具描述（而非全塞给LLM）
- 版本管理：工具升级不影响历史调用
- 权限矩阵：不同角色可用不同工具
```

### 组件 4：知识库（RAG）— 参考书

```
企业知识接入：
├── 文档库（产品手册/SOP/FAQ）
├── 数据库（业务数据/API结果缓存）
├── 历史会话（客服记录/工单）
└── 实时数据（新闻/行情/库存）

RAG Pipeline：
文档加载 → 分块(Chunking) → 向量化(Embedding)
→ 存入向量DB → 查询时Embedding+Rerank → 注入Prompt
```

### 组件 5：安全层（Safety）— 免疫系统

```python
def security_check(request, action):
    # 1. 输入侧：防Prompt注入
    if detect_injection(request):
        return reject("检测到注入攻击")
    # 2. 权限校验
    if not has_permission(user, action):
        return reject("无权限")
    # 3. 内容合规
    if is_sensitive(action.params):
        return reject("涉及敏感信息")
    # 4. 高危操作
    if action.is_dangerous():  # 删除/支付/外发
        if not await human_approve(action):
            return reject("人工未授权")
    # 5. 输出侧：防泄露
    output = execute(action)
    return redact_sensitive(output)  # 脱敏
```

### 组件 6：可观测层（Observability）— 监控

```python
# 全链路Trace（OpenTelemetry风格）
@trace
def agent_step(step):
    with span("llm_call") as s:
        s.set_attr("model", "gpt-4")
        s.set_attr("tokens_in", 500)
        resp = llm(...)
    with span("tool_call") as s:
        s.set_attr("tool", "query_db")
        result = tool(...)
    # 每一步都可追溯

# 监控指标
metrics = {
    "task_success_rate": 任务成功率,
    "avg_steps": 平均步数,
    "p99_latency": P99延迟,
    "token_cost": token成本,
    "tool_error_rate": 工具错误率,
}
# 告警：成功率<95% / 延迟>5s / 成本激增
```

## 三、整体架构图

```
┌─────────────────────────────────────────────────────────┐
│  接入层：Web/App/API/OpenAPI                              │
├─────────────────────────────────────────────────────────┤
│  ┌─────────────────────────────────────────────────┐   │
│  │            编排引擎 Orchestrator                    │   │
│  │  意图→规划→路由→循环→重规划→聚合                     │   │
│  └─────────────────────────────────────────────────┘   │
├─────────────────────────────────────────────────────────┤
│ Memory    │ Tools    │ RAG     │ Skill    │ LLM Gateway │
│ (状态)    │ (执行)   │ (知识)  │ (能力)   │ (模型路由)  │
├─────────────────────────────────────────────────────────┤
│  安全层：鉴权│限流│审计│防注入│脱敏│高危确认               │
├─────────────────────────────────────────────────────────┤
│  可观测层：Trace│Metrics│Logging│告警│大盘               │
└─────────────────────────────────────────────────────────┘
```

## 四、面试加分点

1. **强调"工程化"**：企业级 Agent 的难点不在智能，而在工程化——稳定、安全、可观测、可扩展
2. **提"LLM Gateway"**：模型路由层是多模型/降级/成本控制的关键组件
3. **可观测是上线前提**：没有 Trace 和监控的 Agent 不敢上生产，因为概率性故障无法定位

## 记忆要点

- 本质区别：Demo跑通即可，而企业级需满足千万级并发、SLA 99.9%+及完善容错
- 六大必备组件：编排引擎、记忆模块、工具层、知识库、安全层、可观测监控
- 记忆工程：需用户隔离、重排序（Rerank）、以及基于TTL的遗忘机制
- 企业级工具规范：必须包含参数Schema、权限矩阵、限流和降级策略

