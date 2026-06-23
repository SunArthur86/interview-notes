---
id: note-tx2-011
difficulty: L3
category: ai
subcategory: Agent
tags:
- 腾讯
- 面经
- 高并发
- 会话隔离
- 多租户
feynman:
  essence: 高并发多用户会话隔离的核心是"每用户独立上下文 + 全局资源竞争控制"。会话隔离用 session_id 维度隔离 Redis(每会话独立key)+Thread-local/协程上下文(每请求独立LLM实例)。并发控制用令牌桶限流(每用户QPS限)+信号量(LLM并发槽位)+队列(超限排队)。数据隔离用 user_id 做 row-level 权限，绝不交叉。
  analogy: 像酒店管理——每个客人住独立房间(会话隔离)，大堂/餐厅是共享资源要排队(并发控制)，客人的物品绝不能进别人房间(数据隔离)。
  first_principle: 多用户并发的本质是"资源共享 + 状态隔离"。共享资源(LLM/DB/工具)要限流防过载，用户状态(会话/历史)要严格隔离防串扰。
  key_points:
  - '会话隔离: session_id维度Redis key + 每请求独立LLM上下文'
  - '并发控制: 令牌桶限流(每用户QPS) + 信号量(LLM并发槽) + 队列'
  - '数据隔离: user_id做row-level权限，绝不交叉'
  - '状态无共享: 会话状态全在Redis/DB，服务无状态'
  - '安全: 鉴权每请求校验 + PII按用户隔离'
first_principle:
  essence: 多用户并发 = 资源共享 + 状态隔离
  derivation: 多用户共享LLM/DB → 资源竞争 → 限流防过载 → 但用户状态不能串 → 严格隔离(session_id/user_id维度)
  conclusion: 隔离做不好=用户数据串=事故，限流做不好=服务过载=雪崩
follow_up:
- 怎么防止用户A的请求拿到用户B的会话？
- LLM 并发槽位怎么估？
- 多租户怎么计费？
---

# 【某讯面经】高并发多用户会话隔离设计

## 一、隔离的三个维度

```
[1] 会话隔离：每用户/每会话上下文独立
    │  用户A的对话历史 ≠ 用户B的
    ▼
[2] 并发控制：共享资源(LLM/DB)防过载
    │  限流 + 排队 + 熔断
    ▼
[3] 数据隔离：用户数据按 user_id 隔离
       权限校验 + row-level security
```

## 二、会话隔离

### Redis 会话状态隔离
```bash
# 每个会话独立 key（user_id + conversation_id 维度）
session:{user_id}:{conversation_id}
  ├─ user_001:conv_001 → 用户A的会话状态
  ├─ user_002:conv_001 → 用户B的会话状态（即使 conv_id 相同也隔离）
  └─ ...

# 每请求从 key 读自己的状态，绝不读别人的
def get_session(user_id, conv_id):
    return redis.get(f"session:{user_id}:{conv_id}")
```

### 请求级上下文隔离
```python
# 用 contextvars（Python）或 ThreadLocal（Java）隔离每请求
import contextvars
current_user = contextvars.ContextVar('user_id')
current_session = contextvars.ContextVar('session_id')

async def handle_request(request):
    current_user.set(request.user_id)      # 设置当前请求的用户
    current_session.set(request.conv_id)
    # 后续所有调用都用 current_user.get()，不会串
    session = get_session(current_user.get(), current_session.get())
    response = await agent.run(session, request.message)
```

### LLM 调用隔离
```
每请求独立的 messages 列表：
  用户A 的请求 → messages_A = [userA 的历史]
  用户B 的请求 → messages_B = [userB 的历史]
  
绝不共享 messages（否则用户B 看到用户A 的对话）
```

## 三、并发控制

### 令牌桶限流（每用户 QPS）
```python
# 每用户独立的令牌桶
def rate_limit(user_id, max_qps=10):
    key = f"ratelimit:{user_id}"
    # Redis 实现令牌桶
    allowed = redis_token_bucket(key, max_qps, capacity=max_qps)
    if not allowed:
        raise RateLimitError("请求过于频繁")

# 全局也有令牌桶（防总体过载）
def global_rate_limit(max_total_qps=1000):
    ...
```

### 信号量（LLM 并发槽位）
```python
import asyncio

# LLM 调用是昂贵资源，限制并发数
llm_semaphore = asyncio.Semaphore(50)  # 最多 50 个并发 LLM 调用

async def call_llm(messages):
    async with llm_semaphore:  # 获取槽位，满了就等
        return await llm.invoke(messages)
```

### 队列（超限排队）
```
请求进来
  ├─ 并发数 < 上限 → 直接处理
  ├─ 并发数 >= 上限 → 进队列等待
  └─ 队列也满了 → 返回 429（请稍后重试）

实现：消息队列（Kafka/Redis Stream）或内存队列
```

## 四、数据隔离

### 数据库 Row-Level Security
```sql
-- Postgres RLS：每行带 user_id，自动过滤
ALTER TABLE conversation_history ENABLE ROW LEVEL SECURITY;

CREATE POLICY user_isolation ON conversation_history
  USING (user_id = current_setting('app.current_user_id')::int);

-- 应用层每请求设置当前用户
SET app.current_user_id = 'user_001';
SELECT * FROM conversation_history;  -- 只返回 user_001 的数据
```

### 向量库隔离
```python
# Milvus 按 user_id 分区或过滤
results = collection.search(
    data=[query_vec],
    expr=f"user_id == '{user_id}'",  # 只查该用户的记忆
    limit=5
)
```

## 五、典型事故与防御

### 事故1：会话串扰（最严重）
```
原因：用全局变量存 session，多线程共享
现象：用户A 看到用户B 的对话历史
防御：
  - 用 contextvars/ThreadLocal 隔离
  - 每请求从 Redis 重新读，不缓存到全局
  - 代码 review 重点查"全局可变状态"
```

### 事故2：缓存击穿（共享缓存）
```
原因：缓存 key 不含 user_id
  cache.set("last_answer", answer)  # 全局共享！
现象：用户A 的答案被用户B 命中
防御：
  cache.set(f"last_answer:{user_id}:{conv_id}", answer)
```

### 事故3：LLM 资源耗尽
```
原因：不限并发，所有用户同时调 LLM
现象：LLM 服务 OOM / 超时 / 雪崩
防御：
  - 信号量限并发
  - 令牌桶限 QPS
  - 熔断降级
```

## 六、多租户计费

```python
# 每用户记录 token 消耗，用于计费/限额
def track_usage(user_id, tokens_used):
    redis.hincrby(f"usage:{user_id}:{date}", "tokens", tokens_used)
    redis.hincrby(f"usage:{user_id}:{date}", "requests", 1)

# 配额检查
def check_quota(user_id, max_daily_tokens=100000):
    used = redis.hget(f"usage:{user_id}:{date}", "tokens") or 0
    if int(used) >= max_daily_tokens:
        raise QuotaExceededError("今日额度已用完")
```

## 七、加分点

- 说出 **会话串扰是最严重事故**（隐私泄露），代码 review 重点查全局可变状态
- 说出 **限流要在入口做**（API 网关层），不要等到 LLM 层才限
- 说出 **多租户的 noisy neighbor 问题**：某用户用量暴涨影响其他用户 → 每用户独立限流

## 八、雷区

- ❌ 全局变量存 session → 多线程串扰
- ❌ 缓存 key 不含 user_id → 数据串
- ❌ 不限 LLM 并发 → 资源耗尽雪崩

## 九、扩展

- **分布式会话**：服务无状态，会话全在 Redis，支持水平扩展
- **会话亲和性（Sticky Session）**：负载均衡把同一用户路由到同一实例（减少 Redis 读取，但有单点风险）
- **多租户架构**：DB 隔离（每租户独立DB）vs Schema 隔离 vs Row 隔离，按租户规模选
