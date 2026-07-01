---
id: note-tx2-017
difficulty: L4
category: ai
subcategory: Agent
tags:
- 腾讯
- 面经
- 多Agent
- 通信成本
- 异步
feynman:
  essence: 多Agent协作通信成本高的根源是"每多一个Agent，通信路径N²增长+每条消息要LLM理解"。解法五招：①减少Agent数(合并职责相似的)②用共享状态而非对话(避免N²通信)③异步消息总线(不阻塞等待)④小模型做通信(只传递结构化意图，不用大模型理解)⑤层级化(Manager-Worker，减少跨层通信)。核心是"能不通信就不通信"。
  analogy: 像公司开会——人越多沟通越乱(N²)，解法是：减少会议人数(合并)、用文档协同而非开会(共享状态)、异步沟通不阻塞(消息总线)、用模板填表而非自由讨论(结构化)、按层级汇报(Manager-Worker)。
  first_principle: 多 Agent 通信成本 = Agent 数² × 单次通信成本。降本要么减少 Agent 数，要么减少单次通信成本（用结构化/小模型/异步）。
  key_points:
  - '根源: 通信路径N²增长 + 每条消息要LLM理解'
  - '解法1: 减少Agent数(合并职责相似)'
  - '解法2: 共享状态而非直接对话(避免N²)'
  - '解法3: 异步消息总线(不阻塞等待)'
  - '解法4: 小模型做通信(传递结构化意图)'
  - '解法5: 层级化(Manager-Worker)'
first_principle:
  essence: 通信成本 = N² × 单次成本
  derivation: Agent多 → 通信路径N² → 每条要LLM理解(贵) → 降本：减N(合并) + 减单次成本(结构化/小模型/异步)
  conclusion: 多 Agent 不是越多越好，"能不通信就不通信"是降本第一原则
follow_up:
- 怎么决定哪些 Agent 该合并？
- 共享状态怎么设计避免并发冲突？
- 层级化的 Manager Agent 会不会成为瓶颈？
memory_points:
- 根源在于通信路径N²爆炸与同步阻塞，导致Token与延迟成本飙升
- 第一招：合并相似职责，能单Agent搞定就不拆，直接减少通信节点
- 第二招：用共享状态(黑板模式)或消息总线取代直接对话，变N²为N通信
- 第三招：小模型传结构化意图代替自然语言通信；采用Manager-Worker层级化管理
---

# 【某讯面经】多 Agent 协作中通信成本高怎么办？

## 一、通信成本高的根源

```
根源1：通信路径 N² 增长
  2 个 Agent：1 条通信路径
  5 个 Agent：10 条
  10 个 Agent：45 条
  → Agent 数线性增长，通信路径平方增长

根源2：每条消息要 LLM 理解
  Agent A 发自然语言消息 → Agent B 要用 LLM 理解
  → 每次通信 = 一次 LLM 调用 = token + 延迟

根源3：同步阻塞
  Agent A 等 Agent B 回复 → A 阻塞
  → 串行累积延迟
```

## 二、五招降低通信成本

### 招1：减少 Agent 数（合并职责）

```
❌ 过度拆分：
  查询Agent + 排序Agent + 过滤Agent + 格式化Agent
  → 4 个 Agent，3 次通信

✅ 合并：
  数据查询Agent（一个搞定查/排/滤/格式化）
  → 1 个 Agent，0 次内部通信

合并原则：
  - 职责相似（都是数据处理）→ 合并
  - 调用频繁（每次都要协作）→ 合并
  - 单个 Agent 能搞定 → 不拆
```

### 招2：共享状态而非直接对话

```
❌ 直接对话（N² 通信）：
  Agent A → Agent B："任务做完了"
  Agent A → Agent C："任务做完了"
  Agent B → Agent C："我需要你的结果"
  → 每个 Agent 都要和其他 Agent 通信

✅ 共享状态（中心化）：
  Agent A → 写共享状态：{task_a: done, result: ...}
  Agent B → 读共享状态：发现 task_a done → 开始自己的任务
  Agent C → 读共享状态：拿 result
  → 每个 Agent 只和"共享状态"通信（N 条，不是 N²）
```

```python
# 共享状态设计
class SharedState:
    session_id: str
    tasks: dict        # {task_id: {status, result, ...}}
    messages: list     # 公告板（Agent 之间的异步消息）
    
# Agent A 完成任务后写状态
state.tasks['task_a'] = {'status': 'done', 'result': data}

# Agent B 轮询/订阅状态变化
if state.tasks['task_a']['status'] == 'done':
    process(state.tasks['task_a']['result'])
```

### 招3：异步消息总线（不阻塞）

```
❌ 同步阻塞：
  Agent A 调 Agent B → 等 B 返回 → A 才继续
  → 串行延迟累积

✅ 异步消息总线：
  Agent A → 发消息到总线 → A 立即继续干别的
  Agent B 订阅 → 收到消息处理 → 结果写回总线
  → 并行，不阻塞

实现：Kafka / Redis Stream / RabbitMQ
```

```python
# 发布任务（不等待）
async def agent_a():
    await message_bus.publish('task_b', {'data': ...})
    # 立即去做其他事，不等 B
    do_other_work()

# 订阅处理
async def agent_b():
    async for msg in message_bus.subscribe('task_b'):
        result = process(msg)
        await message_bus.publish('task_b_result', result)
```

### 招4：小模型做通信（结构化意图）

```
❌ 自然语言通信（贵）：
  Agent A → Agent B："我觉得这个用户可能要退款，你帮忙查下订单"
  → B 要用大模型理解这句话

✅ 结构化通信（便宜）：
  Agent A → Agent B：{intent: "refund_query", user_id: "123"}
  → B 用规则/小模型直接解析

通信只传结构化意图，不传自然语言。
```

### 招5：层级化（Manager-Worker）

```
❌ 扁平化（N² 通信）：
  Worker1 ↔ Worker2 ↔ Worker3 ↔ Worker4
  → 所有人互相通信

✅ 层级化（N 通信）：
  Manager
  ├─ Worker1
  ├─ Worker2
  └─ Worker3
  → Worker 只和 Manager 通信，不互相通信

  Worker1 完成 → 报告 Manager → Manager 分配给 Worker2
```

**Manager 负责协调**，Worker 只管执行，跨 Worker 通信都经 Manager。

## 三、实战案例对比

```
场景：处理一个退款工单（需要查单+验证+退款+通知）

❌ 扁平多 Agent（通信爆炸）：
  路由Agent ↔ 工单Agent ↔ 验证Agent ↔ 退款Agent ↔ 通知Agent
  → 5 Agent，10 条通信路径，10 次 LLM 调用
  → 延迟高、成本高

✅ 优化方案：
  [Orchestrator（Manager）]
     │ 用规则路由 + 共享状态
     ├─ 工单Agent（查单，结果写状态）
     ├─ 退款Agent（读状态，执行退款）
     └─ 通知Agent（读状态，发通知）
  → 3 个 Worker，只和 Manager 通信（3 条路径）
  → 结构化通信（不用 LLM 理解自然语言）
  → 异步（退款和通知可并行）
  → 延迟低、成本低
```

## 四、通信成本量化

```
单次通信成本 = LLM 调用（理解消息）+ 网络延迟 + 序列化

优化前后对比（5 Agent 场景）：
  扁平直接对话：10 次通信 × 大模型理解 = 10 × (1000 token + 500ms)
                = 10000 token + 5000ms
  
  层级+共享+小模型：4 次通信 × 小模型/规则 = 4 × (100 token + 50ms)
                   = 400 token + 200ms
  
  → 成本降 96%，延迟降 96%
```

## 五、加分点

- 说出 **"能不通信就不通信"是第一原则**：合并 Agent 比优化通信更有效
- 说出 **共享状态 vs 直接对话**：共享状态把 N² 通信降为 N
- 说出 **结构化通信**：Agent 间传 JSON 意图，不传自然语言，省 LLM 调用

## 六、雷区

- ❌ "Agent 越多越智能" → 通信成本爆炸
- ❌ "Agent 之间自然语言对话" → 每次都要 LLM 理解，贵
- ❌ "同步等待其他 Agent" → 延迟累积

## 七、扩展

- **A2A 协议**：Google 提出的 Agent 间通信标准，定义结构化消息格式
- **Blackboard 架构**：所有 Agent 共享一块"黑板"（共享状态），各自读写，经典的多 Agent 协作模式
- **拍卖/竞标机制**：任务发布后多个 Agent 竞标，Manager 选最优，适合能力重叠场景

## 记忆要点

- 根源在于通信路径N²爆炸与同步阻塞，导致Token与延迟成本飙升
- 第一招：合并相似职责，能单Agent搞定就不拆，直接减少通信节点
- 第二招：用共享状态(黑板模式)或消息总线取代直接对话，变N²为N通信
- 第三招：小模型传结构化意图代替自然语言通信；采用Manager-Worker层级化管理

