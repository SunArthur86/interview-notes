---
id: note-fl-010
difficulty: L2
category: ai
subcategory: 中间件
tags:
- 字节
- 飞连
- 面经
- Redis
- 数据结构
feynman:
  essence: Redis 五大数据结构各有场景——String 做计数/缓存对象/分布式锁，Hash 做对象字段级读写（最适合 Agent 会话状态），List 做消息队列/日志，Set 做去重/标签，ZSet 做排行榜/延时队列。Agent 会话状态推荐 Hash：字段级 update 不用读整个对象，省带宽；TTL 整体设在 key 上。状态复杂需嵌套时反推 JSON 存 String。
  analogy: String 像便签纸（一条信息），Hash 像表格（一行多列可单独改），List 像排队队列（先进先出），Set 像标签云（去重），ZSet 像带分数的排行榜（自动排序）。
  first_principle: 数据结构的选择 = 访问模式 + 性能特征的匹配。字段级读写选 Hash（O(1) 改单字段），排队选 List（O(1) 头尾操作），排序选 ZSet（O(logN) 排序）。
  key_points:
  - String：计数器(INCR)/缓存对象JSON/分布式锁
  - Hash：对象字段级读写，Agent 会话状态首选
  - List：消息队列(左进右出)/操作日志
  - Set：去重(已处理tool_call_id)/标签
  - ZSet：排行榜/按时间戳排序/延时队列
first_principle:
  essence: 数据结构 = 访问模式的函数
  derivation: 不同访问模式（字段读写/排队/去重/排序）→ 匹配不同底层结构（Hash/SkipList/HashTable）→ 性能特征不同 → 按访问模式选结构
  conclusion: 没有最好的数据结构，只有最匹配访问模式的数据结构
follow_up:
- Hash 字段太多（>1000）会不会有问题？
- ZSet 实现底层是 SkipList + HashTable，为什么这么设计？
- Agent 会话状态什么时候用 JSON 存 String 比 Hash 好？
memory_points:
- Agent状态首选Hash：支持字段级update省带宽，整体设TTL，优于String频繁全量读写
- 状态结构若需深度嵌套(如消息列表)，退而求其次序列化为JSON存String
- 状态去重用Set，事件流/日志用List，延时队列(按时间戳)用ZSet
- 加分点：ZSet底层是跳表+哈希表双结构，Hash字段少时用ziplist省内存
---

# 【字节飞连面经】Redis 数据结构：String/Hash/List/Set/ZSet 各适合什么？Agent 会话状态用哪种？

## 一、五大结构 + 典型场景

| 结构 | 底层 | 典型场景 |
|------|------|---------|
| **String** | SDS | 计数器（`INCR`）、缓存对象 JSON、分布式锁（`SETNX`） |
| **Hash** | ziplist / hashtable | 对象字段级读写（用户资料、**Agent 会话状态**） |
| **List** | quicklist（ziplist 链） | 消息队列（左进右出 `LPUSH`/`RPOP`）、操作日志 |
| **Set** | intset / hashtable | 去重（已处理 `tool_call_id`）、标签、共同好友 |
| **ZSet** | ziplist / skiplist+hashtable | 排行榜、按时间戳排序的事件、延时队列 |

## 二、Agent 会话状态为什么用 Hash

```bash
# 字段级 update，不用读整个对象，省带宽
HSET session:{user_id}:{conv_id} step 3 status running
HSET session:{user_id}:{conv_id} tool_count 5

# 读单个字段
HGET session:{user_id}:{conv_id} step    # → "3"

# 读全部
HGETALL session:{user_id}:{conv_id}

# TTL 整体设在 key 上
EXPIRE session:{user_id}:{conv_id} 1800   # 30 min
```

**优势**：
- 字段级 update 不用读整个对象（String 要 GET→改→SET 三步）
- TTL 整体设在 key 上即可
- 省带宽（只改变化的字段）

## 三、什么时候反推 JSON 存 String

如果状态结构复杂、需要**嵌套**（如 `messages: [{role, content, ts}]`），Hash 不好表达（Hash 不支持嵌套）。这时推荐：
- 序列化成 JSON 存 String
- 简单，但每次改要 GET→改→SET

**取舍**：
- 字段扁平、频繁改单字段 → Hash
- 结构嵌套、整体读多改少 → JSON 存 String

## 四、各结构的 Agent 场景

| 场景 | 选谁 | 命令 |
|------|------|------|
| 会话短期状态 | Hash | `HSET/HGET/HGETALL` |
| 已处理工具调用去重 | Set | `SADD/SISMEMBER` |
| 操作日志/事件流 | List | `LPUSH/RPOP` |
| 延时任务（如定时回调） | ZSet | score=执行时间戳 |
| 分布式锁（防并发改状态） | String | `SET NX EX` |
| 全局计数（步数/调用次数） | String | `INCR` |

## 五、加分点

- 说出 **ZSet 底层是 SkipList + HashTable 双结构**：SkipList 支持范围查询（按分数排序），HashTable 支持单点 O(1) 查询（按 member 取分数）
- 说出 **Hash 在字段少时用 ziplist**（紧凑省内存），字段多了转 hashtable

## 六、扩展

- **Hash 字段过多**：超过 `hash-max-ziplist-entries`（默认 128）会从 ziplist 转 hashtable，内存占用上升但性能不变
- **大 Key 问题**：单个 Hash/Set 元素过多（>10万）会阻塞 Redis（操作是 O(N)），需要拆分
- **Redis 7.0 引入 Stream**：比 List 更适合消息队列，支持消费组和 ACK

## 记忆要点

- Agent状态首选Hash：支持字段级update省带宽，整体设TTL，优于String频繁全量读写
- 状态结构若需深度嵌套(如消息列表)，退而求其次序列化为JSON存String
- 状态去重用Set，事件流/日志用List，延时队列(按时间戳)用ZSet
- 加分点：ZSet底层是跳表+哈希表双结构，Hash字段少时用ziplist省内存

