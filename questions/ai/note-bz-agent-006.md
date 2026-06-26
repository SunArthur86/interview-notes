---
id: note-bz-agent-006
difficulty: L4
category: ai
subcategory: Agent
tags:
  - B站面经
  - Agent
  - 生产级
  - 架构
  - 记忆
  - 权限
  - 工作流
feynman:
  essence: 生产级Agent架构按四层划分——交互层(用户接入)、编排层(决策大脑)、能力层(记忆/工具/知识)、基础设施层(安全/监控)。每层独立演进，通过接口解耦。
  analogy: 像大型企业组织架构——前台(交互)、管理层(编排)、业务部门(能力)、行政IT(基础设施)，各司其职又协同。
  first_principle: 生产系统必须分层解耦，否则任何改动牵一发动全身。Agent的智能性在编排层，稳定性在基础设施层，二者必须分离才能独立演进。
  key_points:
    - 四层架构：交互层/编排层/能力层/基础设施层
    - 编排层是智能核心（LLM+控制循环）
    - 能力层是可插拔的（记忆/工具/知识独立部署）
    - 基础设施层保证稳定性（安全/监控/限流）
first_principle:
  essence: 复杂系统的演进依赖分层解耦——把易变的（智能）和稳定的（基础设施）分离。
  derivation: 'Agent的LLM和Prompt经常迭代（周级），但安全/监控/权限相对稳定（月级）。如果耦合在一起，每次改Prompt都要重测安全。分层后，编排层可独立迭代，基础设施层提供稳定保障。'
  conclusion: 生产级Agent = 分层架构（智能层与基础设施层解耦）+ 清晰接口（每层独立演进）
follow_up:
  - 微服务化怎么拆？——按能力拆（Memory服务/Tool服务/RAG服务独立部署）
  - 编排层用什么实现？——LangGraph/自研状态机/规则+LLM混合
  - 怎么保证高可用？——多副本+故障转移+降级+人工兜底
---

# 生产级 Agent 的架构怎么划分？（记忆、权限、工作流）

## 一、生产级 Agent 四层架构

```
┌──────────────────────────────────────────────────────────┐
│  Layer 1: 交互层 (Interaction)                            │
│  Web UI │ App │ OpenAPI │ IM(钉钉/飞书) │ 语音            │
├──────────────────────────────────────────────────────────┤
│  Layer 2: 编排层 (Orchestration) — 智能核心               │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐               │
│  │ 意图理解  │→│ 工作流引擎 │→│ 循环控制器 │               │
│  └──────────┘  └──────────┘  └──────────┘               │
│  + 规划器 + 反思器 + 人工协作节点                          │
├──────────────────────────────────────────────────────────┤
│  Layer 3: 能力层 (Capabilities) — 可插拔                  │
│  ┌────────┐ ┌────────┐ ┌────────┐ ┌────────┐            │
│  │ Memory │ │ Tools  │ │  RAG   │ │ Skill  │            │
│  │ 记忆服务 │ │ 工具服务 │ │ 知识库  │ │ 技能库  │            │
│  └────────┘ └────────┘ └────────┘ └────────┘            │
├──────────────────────────────────────────────────────────┤
│  Layer 4: 基础设施层 (Infrastructure)                     │
│  权限│限流│审计│Trace│监控│告警│模型网关│配置中心           │
└──────────────────────────────────────────────────────────┘
```

## 二、记忆子系统（Memory）

### 生产级记忆架构

```
┌─────────────────────────────────────────────────┐
│                Memory Service                    │
├─────────────────────────────────────────────────┤
│  写入路径                                          │
│  请求 → 权限校验 → 去重/合并 → Embedding → 存储    │
├─────────────────────────────────────────────────┤
│  存储分层                                          │
│  ├── Redis: 热数据/短期记忆（ms级）                │
│  ├── 向量DB: 长期记忆（Chroma/Milvus）            │
│  └── 对象存储: 原始文档（S3/OSS）                  │
├─────────────────────────────────────────────────┤
│  读取路径                                          │
│  query → Embedding → 向量检索 → Rerank → 过滤     │
│         → 用户隔离 → 时效性过滤 → 返回              │
└─────────────────────────────────────────────────┘
```

```python
class ProductionMemory:
    def recall(self, user_id, query, top_k=5):
        # 1. 向量检索
        candidates = self.vector_db.search(
            embedding(query), 
            filter={"user_id": user_id},  # 用户隔离
            n_results=top_k * 3  # 多取再rerank
        )
        # 2. 重排序
        ranked = self.reranker.rerank(query, candidates)
        # 3. 时效性过滤
        valid = [m for m in ranked if not m.is_expired()]
        # 4. 重要性加权
        valid.sort(key=lambda m: m.importance * m.recency_score, reverse=True)
        return valid[:top_k]
```

## 三、权限子系统（Permission）

### 三层权限模型

```
┌─────────────────────────────────────────────────┐
│  Layer 1: 身份认证 (Authentication)               │
│  你是谁？—— JWT/API Key/OAuth                     │
├─────────────────────────────────────────────────┤
│  Layer 2: 访问控制 (Authorization)                │
│  你能做什么？—— RBAC/ABAC                         │
│  ├── RBAC: 基于角色（管理员/普通用户/访客）        │
│  └── ABAC: 基于属性（部门+数据敏感度+时间）        │
├─────────────────────────────────────────────────┤
│  Layer 3: 操作审批 (Approval)                     │
│  高危操作谁批准？—— 删除/支付/外发需人工确认      │
└─────────────────────────────────────────────────┘
```

```python
# 权限矩阵示例
PERMISSION_MATRIX = {
    "viewer":   {"query": True,  "write": False, "delete": False},
    "editor":   {"query": True,  "write": True,  "delete": False},
    "admin":    {"query": True,  "write": True,  "delete": "need_approve"},
}

def check_permission(user, action, resource):
    role = get_role(user, resource)
    perm = PERMISSION_MATRIX[role].get(action.type, False)
    if perm == "need_approve":
        return await request_approval(user, action)
    return perm
```

## 四、工作流引擎（Workflow）

### 工作流 vs Agent 决策

```
确定性工作流（Workflow）：
  固定路径：A → B → C → D
  适用：流程固定、可预测的业务（如订单处理）

Agent动态决策（Agentic）：
  动态路径：A → LLM决定 → {B或C或D} → ...
  适用：需要灵活判断的场景（如客服咨询）

混合模式（生产推荐）：
  大框架用工作流（稳定性）+ 关键节点用Agent（灵活性）
```

### LangGraph 风格的工作流定义

```python
from langgraph.graph import StateGraph

# 定义状态
class AgentState(TypedDict):
    messages: list
    user_id: str
    needs_human: bool

# 构建图
graph = StateGraph(AgentState)
graph.add_node("understand", understand_intent)
graph.add_node("plan", plan_steps)
graph.add_node("execute", execute_tools)
graph.add_node("human_review", human_checkpoint)
graph.add_node("respond", generate_response)

# 定义流转（含条件分支）
graph.add_edge("understand", "plan")
graph.add_conditional_edges(
    "execute",
    lambda s: "human_review" if s["needs_human"] else "respond"
)
graph.add_edge("human_review", "respond")

app = graph.compile(checkpointer=memory)  # 支持中断恢复
```

## 五、基础设施：稳定性保障

### 模型网关（LLM Gateway）

```python
class LLMGateway:
    """统一模型调用入口，支持路由/降级/限流"""
    def call(self, prompt, **kwargs):
        # 1. 模型路由（按任务复杂度选模型）
        model = self.router.select(prompt, budget=self.budget)
        # 2. 限流
        if not self.rate_limiter.acquire(user):
            raise RateLimitError()
        # 3. 调用（带降级）
        try:
            return self.providers[model].call(prompt)
        except (Timeout, Overload):
            # 降级到备用模型
            return self.providers["fallback"].call(prompt)
```

### 全链路可观测

```python
# 每个Agent执行生成完整Trace
trace = {
    "trace_id": "abc123",
    "user_id": "u1",
    "goal": "查询订单状态",
    "spans": [
        {"name": "understand", "duration_ms": 200, "model": "gpt-4o-mini"},
        {"name": "tool_call:query_order", "duration_ms": 350, "status": "ok"},
        {"name": "respond", "duration_ms": 800, "model": "gpt-4"},
    ],
    "total_tokens": 1200,
    "cost_usd": 0.012,
    "status": "success"
}
# 用于：故障定位 / 性能优化 / 成本分析 / Bad Case挖掘
```

## 六、面试加分点

1. **强调"分层解耦"**：智能层（编排）与基础设施层（安全/监控）分离，才能独立迭代
2. **混合架构**：纯 Agent 不稳定，纯工作流不灵活，生产推荐"工作流骨架 + Agent 节点"
3. **提"中断恢复"**：长任务（如人工审核）要支持 checkpoint，这是 LangGraph 的核心能力
