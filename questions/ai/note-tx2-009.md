---
id: note-tx2-009
difficulty: L4
category: ai
subcategory: 系统设计
tags:
- 腾讯
- 面经
- 多Agent
- 客服中心
- 协作系统
feynman:
  essence: 设计多Agent协作系统（如客服中心）要解决分工/通信/状态管理/容错四件事。分工按角色（路由Agent分流/工单Agent查单/退款Agent处理退款/质检Agent抽检）。通信走共享状态（不直接对话），用消息总线异步。状态管理用分布式存储+版本号防冲突。容错用超时熔断+任务重试+人工兜底。核心是Orchestrator统一调度，子Agent无状态。
  analogy: 像客服中心运转——前台(路由Agent)分流，售后(工单Agent)查单，财务(退款Agent)退钱，主管(质检Agent)抽检。员工之间不直接喊话(走工单系统共享状态)，每个人超时了有备份接手(容错)。
  first_principle: 多 Agent 协作的本质是"分治"。复杂任务一个 Agent 做不好，拆给多个专业 Agent。但分治带来通信和协调成本，核心是"用 Orchestrator 统一调度 + 子 Agent 无状态"。
  key_points:
  - '分工按角色: 路由/工单/退款/质检 Agent'
  - '通信走共享状态(不直接对话)+消息总线异步'
  - '状态管理: 分布式存储+乐观锁(版本号)防冲突'
  - '容错: 超时熔断+任务重试+人工兜底'
  - '核心: Orchestrator统一调度，子Agent无状态'
first_principle:
  essence: 多 Agent = 分治 + 协调
  derivation: 复杂任务单 Agent 做不好 → 分给专业子 Agent → 分治带来通信成本 → 用 Orchestrator 统一调度 + 共享状态通信 → 子 Agent 无状态化便于容错
  conclusion: 多 Agent 不是"越多越好"，而是"分工边界清晰 + 通信成本可控"
follow_up:
- 子 Agent 之间需要直接对话吗？什么时候需要？
- 怎么防止子 Agent 之间任务冲突？
- Orchestrator 挂了怎么办？
---

# 【某讯面经】设计一个多 Agent 协作系统（如客服中心）：分工、通信、状态管理、容错

## 一、客服中心多 Agent 架构

```
                    ┌─────────────────┐
                    │  Orchestrator   │  ← 统一调度
                    │   (路由+协调)    │
                    └────────┬────────┘
                             │
        ┌──────────┬─────────┼──────────┬──────────┐
        ▼          ▼         ▼          ▼          ▼
   ┌─────────┐┌─────────┐┌─────────┐┌─────────┐┌─────────┐
   │ 工单    ││ 退款    ││ 知识库  ││ 升级    ││ 质检    │
   │ Agent   ││ Agent   ││ Agent   ││ Agent   ││ Agent   │
   │ (查单)  ││ (退钱)  ││ (FAQ)   ││ (转人工)││ (抽检)  │
   └─────────┘└─────────┘└─────────┘└─────────┘└─────────┘
        │          │         │          │          │
        └──────────┴─────────┴──────────┴──────────┘
                             │
                    ┌────────▼────────┐
                    │  共享状态 + 消息总线 │
                    └─────────────────┘
```

## 二、分工：按角色定义 Agent

| Agent | 职责 | 工具 | 权限 |
|-------|------|------|------|
| **Orchestrator** | 路由分流、任务协调 | 任务分发 | 全局 |
| **工单 Agent** | 查询/创建/更新工单 | DB查询 | read |
| **退款 Agent** | 处理退款流程 | 退款API | write（需审批） |
| **知识库 Agent** | 回答 FAQ | RAG检索 | read |
| **升级 Agent** | 转人工/高级客服 | 通知系统 | write |
| **质检 Agent** | 抽检对话质量 | LLM-as-Judge | read |

**分工原则**：
- 单一职责（一个 Agent 只做一类事）
- 权限最小化（退款 Agent 不能改工单）
- 幂等（同一任务重试不产生副作用）

## 三、通信：共享状态 + 消息总线

### 不要让 Agent 直接对话
```
❌ 工单 Agent → 退款 Agent："这个单要退款"
   问题：直接对话容易扯皮、死循环、难调试

✅ 工单 Agent → 写共享状态 → Orchestrator 读 → 分发给退款 Agent
   优势：解耦、可追溯、易调试
```

### 共享状态结构
```python
class ConversationState:
    session_id: str
    user_id: str
    messages: list          # 对话历史
    current_task: Task      # 当前任务
    task_history: list      # 任务历史
    artifacts: dict         # 各 Agent 产出（工单/退款记录）
    pending_agents: list    # 待执行的 Agent 队列
```

### 消息总线（异步通信）
```
Orchestrator → 发布任务到消息总线（Kafka/Redis Stream）
  ├─ 工单 Agent 订阅 → 处理 → 结果写回共享状态
  ├─ 退款 Agent 订阅 → 处理 → 结果写回
  └─ ...

优势：
  - 异步解耦（Agent 之间不阻塞等待）
  - 可扩展（加新 Agent 只需订阅）
  - 容错（Agent 挂了消息留 Pending List）
```

## 四、状态管理：分布式存储 + 乐观锁

```
共享状态存 Redis（热数据）+ Postgres（持久化）

并发冲突处理（乐观锁）：
  state.version = 1
  Agent A 读到 v1，改完写回 → v2
  Agent B 也读到 v1，改完写回 → 版本冲突！
  
  → 重试：B 重新读 v2，合并改动，再写
```

```python
def update_state(session_id, update_fn):
    while True:
        state = redis.get(session_id)  # 带 version
        new_state = update_fn(state)
        new_state.version += 1
        # CAS（Compare-And-Swap）
        if redis.cas(session_id, state.version, new_state):
            return new_state
        # 冲突，重试
```

## 五、容错：超时 + 重试 + 兜底

### 超时熔断
```python
@timeout(seconds=30)
@retry(times=3, backoff='exponential')
def call_agent(agent, task):
    return agent.execute(task)
    
# 超时/重试都失败 → 降级
```

### 任务重试 + 幂等
```
退款 Agent 执行失败 → 重试
  但退款必须幂等（重试不能退两次）
  → 用 task_id 做幂等键，退款API支持幂等
```

### 人工兜底
```
Orchestrator 检测到：
  - 子 Agent 连续失败 3 次
  - 任务超出 Agent 能力（如金额超阈值）
  - 用户明确要人工
→ 升级 Agent → 转人工客服
```

### Orchestrator 高可用
```
Orchestrator 是单点 → 用主备/集群
  - 无状态（状态全在 Redis/DB）
  - 多实例 + 选主（Raft/Zookeeper）
  - 一台挂了另一台接管
```

## 六、客服场景完整流程

```
用户："我昨天订单多收钱了"
  ↓
Orchestrator 路由：
  - 意图：退款投诉
  - 分配：工单 Agent（查单）+ 知识库 Agent（退款政策）
  ↓
工单 Agent：查昨天订单 → 多收 20 元
  → 写共享状态：{order_id, overcharge: 20}
  ↓
Orchestrator 读状态 → 判断金额 < 50 → 自动退款
  → 分配：退款 Agent
  ↓
退款 Agent：调退款API → 退 20 元
  → 写状态：{refund_id, status: done}
  ↓
Orchestrator 汇总 → 通知用户"已退款"
  ↓
质检 Agent（异步）：抽检本次对话，评分
```

## 七、加分点

- 说出 **子 Agent 无状态**：状态全在共享存储，Agent 挂了重启不影响
- 说出 **幂等性**：重试不能产生副作用（尤其退款/支付类）
- 说出 **Orchestrator 是潜在单点**：要做高可用（集群+选主）

## 八、雷区

- ❌ Agent 之间直接对话 → 扯皮、死循环、难调试
- ❌ 没有超时/重试 → 一个 Agent 挂全链路阻塞
- ❌ 退款类操作不做幂等 → 重试导致退两次

## 九、扩展

- **A2A（Agent-to-Agent）协议**：Google 提出的 Agent 间通信标准
- **层级 Agent**：Manager Agent → Worker Agents，类似组织架构
- **竞标式分工**：多个 Agent 竞标任务，Orchestrator 选最优（适合能力重叠场景）
