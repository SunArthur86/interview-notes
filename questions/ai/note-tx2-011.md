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
memory_points:
- 会话隔离：每请求用ThreadLocal/ContextVars存用户ID，绝不共享全局上下文
- 并发控制：令牌桶限制单用户QPS防滥用，信号量限制LLM总并发槽位防雪崩
- 数据隔离：DB用行级安全(RLS)，向量库检索强制带user_id过滤表达式防越权
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

## 记忆要点

- 会话隔离：每请求用ThreadLocal/ContextVars存用户ID，绝不共享全局上下文
- 并发控制：令牌桶限制单用户QPS防滥用，信号量限制LLM总并发槽位防雪崩
- 数据隔离：DB用行级安全(RLS)，向量库检索强制带user_id过滤表达式防越权


## 苏格拉底式面试追问

> 这组追问模拟面试官层层逼问，每一问先回答"为什么"，再回答"怎么做"，最后回答"如何证明"。

### 第一层：目标与动机

**Q：多用户会话隔离的核心是"每用户独立上下文"，但"独立"到什么程度？共享什么、隔离什么？**

隔离的是"会话状态和用户数据"，共享的是"模型和系统资源"。具体：1) 隔离——每个会话的对话历史、短期记忆、用户画像、工具调用记录，绝不能跨用户可见；2) 共享——LLM 模型权重（所有用户用同一个模型）、工具定义（所有用户用同一套工具 schema）、系统提示（如"你是客服"可以共享，但用户特定约束要隔离）。判断标准："这条信息是否用户私有"——私有则隔离，公共则共享。隔离失败 = 隐私泄露，是安全事故。

### 第二层：证据与定位

**Q：怎么验证会话隔离真的生效，A 用户的数据 B 看不到？**

渗透测试。1) 数据层——查 Redis/Postgres，确认每条记录带 user_id，查询时强制带 user_id 过滤（尝试不带过滤应该被拒绝）；2) 应用层——构造"A 的会话 + B 的查询"，看是否返回 A 的数据；3) LLM 层——A 的对话历史是否被拼进 B 的 prompt（检查 prompt 构造逻辑）。自动化测试：CI 跑"两个用户的隔离测试"（A 写敏感词、B 查询，断言 B 查不到）。线上监控：采样检查 prompt 里是否混入其他用户的数据。

### 第三层：根因深挖

**Q：高并发下偶尔出现"用户 A 看到了 B 的数据"，根因是并发控制问题还是数据访问层 bug？**

通常并发问题。1) 共享状态——如果用全局变量或类属性存会话状态（如 self.current_user），并发时 A 的请求覆盖了 B 的，是共享可变状态 bug；2) 线程/协程隔离——应该用 Thread-local 或协程上下文存 user_id，但如果漏了，请求间会串。根因判断：看是否用了"请求级隔离"（每请求独立实例或上下文变量）。解法：所有用户相关状态走 Thread-local/协程上下文，不用全局变量；LLM 调用时 user_id 从上下文取，不从全局取。

**Q：那为什么不直接给每个会话起一个独立进程（物理隔离），彻底避免并发问题？**

资源浪费。一个进程占几十 MB 内存，1000 并发会话要 1000 进程 = 几十 GB，且进程间通信开销大。协程/线程级隔离（同一进程内用上下文变量隔离）能让一个进程服务几千并发，资源效率高 100 倍。物理隔离适合"超高安全要求"（如金融级隔离），普通业务用逻辑隔离（上下文变量 + 强制 user_id 过滤）够用。权衡"安全性 vs 资源效率"。

### 第四层：方案权衡

**Q：限流用"令牌桶"还是"漏桶"，怎么选？多用户场景有什么特殊考量？**

令牌桶——允许突发（桶里攒了令牌可以一下用完），适合"偶尔突发"的场景；漏桶——匀速输出（不管请求多猛都按固定速率处理），适合"严格限速"的场景。多用户场景：1) 全局限流——保护系统总量（令牌桶，允许合理突发）；2) 每用户限流——防单用户滥用（每用户独立的令牌桶，如 10 QPS/用户）。两层配合：全局限流挡总量洪水，用户限流防个体滥用。令牌桶更常用（灵活性高）。

**Q：为什么不直接用队列（所有请求排队，按顺序处理），而要限流（拒绝超额请求）？**

权衡"延迟 vs 可用性"。队列让所有请求最终被处理（不拒绝），但高峰期排队可能很长（延迟暴增），用户等不了。限流直接拒绝超额请求（返回 429），让客户端立即知道要重试或降级，延迟可控。Agent 场景的 LLM 调用本身慢（几秒），排队累积会很快，所以限流（快速失败）比队列（长时间等待）更适合。队列适合"必须处理"的任务（如订单），限流适合"可拒绝"的请求（如查询）。

### 第五层：验证与沉淀

**Q：怎么衡量会话隔离和并发控制的有效性？**

三类测试：1) 隔离测试——A/B 用户的渗透测试（A 写 B 读，断言隔离）；2) 并发压测——模拟 1000 并发，检查是否有数据串（响应里 user_id 是否和请求一致）；3) 限流测试——发超出限额的请求，确认被正确拒绝（429）而非放行。线上监控：每请求记录 user_id 和 session_id，定期对账是否有"异常关联"（如 A 的请求响应了 B 的数据）。沉淀为多用户安全规范：user_id 强制传递、查询层强制过滤、限流配置、隔离测试 CI。

## 结构化回答

**30 秒电梯演讲：** 高并发多用户会话隔离的核心是"每用户独立上下文 + 全局资源竞争控制"。会话隔离用 session_id 维度隔离 Redis(每会话独立key)+Thread-local/协程上下文(每请求独立LLM实例)。

**展开框架：**
1. **会话隔离** — session_id维度Redis key + 每请求独立LLM上下文
2. **并发控制** — 令牌桶限流(每用户QPS) + 信号量(LLM并发槽) + 队列
3. **数据隔离** — user_id做row-level权限，绝不交叉

**收尾：** 您想深入聊：怎么防止用户A的请求拿到用户B的会话？


## 视频脚本

> 预计时长：4 分钟 | 由浅入深


| 时间 | 画面/字幕 | 口播台词 | 讲解要点 |
|------|----------|----------|----------|
| 0:00 | 标题卡：高并发多用户会话隔离设计 | "像酒店管理——每个客人住独立房间(会话隔离)，大堂/餐厅是共享资源要排队(并发控制)，客人…" | 开场钩子 |
| 0:20 | 核心概念图 | "高并发多用户会话隔离的核心是"每用户独立上下文 + 全局资源竞争控制"。会话隔离用 session_id 维度隔离…" | 核心定义 |
| 0:50 | 会话隔离示意图 | "会话隔离——session_id维度Redis key + 每请求独立LLM上下文" | 要点拆解1 |
| 1:30 | 对比/实战案例图 | "对比一下常见误区和工程实践，看真实场景里怎么取舍。" | 实战与对比 |
| 2:20 | 总结卡 | "记住核心要点。下期我们追问：怎么防止用户A的请求拿到用户B的会话？" | 收尾与钩子 |
