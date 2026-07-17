---
id: note-bd-agent-007
difficulty: L2
category: database
subcategory: Redis
tags:
- 字节
- 面经
- Redis
feynman:
  essence: Redis在高并发业务中主要解决缓存、锁单、分布式锁、库存预扣和热点配置问题
  analogy: Redis就像前台的暂存柜——常用东西放这拿得快(缓存)、贵重物品先锁起来(锁单)、多人抢同一个东西先到先得(分布式锁)
  first_principle: 数据库面向磁盘设计随机IO慢，Redis全内存操作快10-100倍，适合做热点数据的缓冲层
  key_points:
  - 拼团锁单防止超卖
  - 库存预扣用Redis原子操作
  - 分布式锁控制并发
  - 热点配置和限流阈值缓存
first_principle:
  essence: MySQL单机QPS上限~5000，Redis单机QPS可达10万+，高并发场景必须用Redis做缓冲层
  derivation: 拼团高峰QPS可达数万→MySQL扛不住→先用Redis原子操作预扣库存→异步落库→保护MySQL
  conclusion: Redis在业务系统中的定位是高并发缓冲层和过程态存储
follow_up:
- Redis和MySQL的数据一致性怎么保证？
- 热点Key问题怎么解决？
- Redis集群模式选主从还是哨兵？
memory_points:
- 两大核心场景：高并发读写缓存，以及分布式锁防超卖。
- 防超卖方案：因为高并发下MySQL行锁慢，所以用Redis配合Lua脚本做原子库存预扣。
- 分布式锁实现：短耗时用SetNX，长链路用Redisson自动续期。
- 数据类型：热点数据(如配置)做缓存，异步任务用消息队列(如List/Stream)。
---

# Redis在业务项目中主要解决了哪些问题？

## Redis核心用途全景

```
┌──────────────────────────────────────────────┐
│              Redis 在业务中的应用              │
├───────────┬───────────┬───────────┬──────────┤
│  缓存     │  分布式锁  │ 库存预扣   │ 消息队列 │
│ ────────  │ ────────  │ ────────  │ ──────── │
│ 热点数据   │ 拼团锁单   │ INCR/DECR │ List     │
│ 配置信息   │ 支付回调   │ Lua脚本   │ Stream   │
│ 限流阈值   │ 秒杀防超卖 │ 过期释放  │ PUB/SUB  │
└───────────┴───────────┴───────────┴──────────┘
```

## 1. 拼团锁单（防超卖）

```python
# 拼团场景：多人同时拼同一个团，需要锁单防止超卖
def lock_group_order(group_id, user_id):
    """用Redis分布式锁实现拼团锁单"""
    lock_key = f"lock:group:{group_id}"
    
    # SET NX EX：不存在才设置，60秒自动过期
    acquired = redis.set(lock_key, user_id, nx=True, ex=60)
    
    if acquired:
        try:
            # 检查拼团是否已满
            current = redis.get(f"group:{group_id}:count")
            if int(current or 0) < max_members:
                redis.incr(f"group:{group_id}:count")
                return True
        finally:
            # 释放锁（Lua脚本保证原子性）
            redis.eval(release_script, 1, lock_key, user_id)
    
    return False  # 锁单失败
```

## 2. 库存预扣（高并发）

```python
# 秒杀/拼团场景：用Redis原子操作做库存预扣
DEDUCT_SCRIPT = """
local stock = redis.call('GET', KEYS[1])
if not stock or tonumber(stock) < tonumber(ARGV[1]) then
    return -1  -- 库存不足
end
redis.call('DECRBY', KEYS[1], ARGV[1])
return tonumber(stock) - tonumber(ARGV[1])
"""

def pre_deduct_stock(item_id, quantity):
    """Lua脚本保证扣减原子性"""
    result = redis.eval(DEDUCT_SCRIPT, 1, 
                        f"stock:{item_id}", quantity)
    if result < 0:
        return False  # 库存不足
    # 异步落库到MySQL
    mq.send("stock_sync", {"item_id": item_id, "qty": quantity})
    return True
```

**为什么不用MySQL直接扣**：
- MySQL行锁→高并发时大量请求排队→响应慢
- Redis内存操作→QPS可达10万+→用户体验好

## 3. 分布式锁（详见Q12-Q13）

```
长链路操作（支付回调、拼团结算）→ Redisson + watchdog自动续期
短耗时操作（库存预占）→ SetNX + 过期时间
```

## 4. 热点配置缓存

```python
# 变化不频繁但读取频繁的数据放Redis
def get_activity_rules(activity_id):
    # 1. 先查Redis
    rules = redis.get(f"rules:{activity_id}")
    if rules:
        return json.loads(rules)
    
    # 2. 未命中查MySQL
    rules = mysql.query("SELECT * FROM rules WHERE activity_id=%s", 
                        activity_id)
    
    # 3. 写入Redis（设置TTL防止数据不一致）
    redis.setex(f"rules:{activity_id}", 300, json.dumps(rules))
    return rules
```

**缓存的数据类型**：

| 数据 | TTL | 更新策略 |
|------|-----|---------|
| 活动规则 | 5min | Cache Aside |
| 黑名单 | 10min | 定时刷新 |
| 限流阈值 | 30min | 后台配置变更时主动删缓存 |
| 商品基础信息 | 1h | 下单时验证 |

## 5. 动态配置中心

```python
# 限流、开关等运行时配置存Redis，不重启即可生效
def check_rate_limit(user_id, api):
    key = f"ratelimit:{api}:{user_id}"
    count = redis.incr(key)
    if count == 1:
        redis.expire(key, 60)  # 1分钟窗口
    
    limit = redis.get(f"config:ratelimit:{api}")  # 动态阈值
    return count <= int(limit or 100)
```

## 数据流向

```
用户请求 → 检查限流(Redis) → 预扣库存(Redis) → 锁单(Redis)
              │                    │                 │
              └──── 消息队列 ──────┴──── 异步落库 ────┘
                                          │
                                     MySQL (最终一致)
```

## 面试加分点

1. **场景驱动**：不是列举Redis数据结构，而是从业务场景出发
2. **原子操作**：强调Lua脚本保证预扣库存的原子性
3. **异步落库**：Redis做过程态，MySQL做最终态，体现架构思维
4. **TTL管理**：不同数据设置不同过期时间，平衡一致性和性能

## 记忆要点

- 两大核心场景：高并发读写缓存，以及分布式锁防超卖。
- 防超卖方案：因为高并发下MySQL行锁慢，所以用Redis配合Lua脚本做原子库存预扣。
- 分布式锁实现：短耗时用SetNX，长链路用Redisson自动续期。
- 数据类型：热点数据(如配置)做缓存，异步任务用消息队列(如List/Stream)。


## 苏格拉底式面试追问

> 这组追问模拟面试官层层逼问，每一问先回答"为什么"，再回答"怎么做"，最后回答"如何证明"。

### 第一层：目标与动机

**Q：拼团防超卖你用 Redis + Lua 做原子预扣，为什么不直接用 MySQL 的 `UPDATE stock = stock - 1 WHERE id = X AND stock > 0`？这条 SQL 本身就是原子的。**

这条 SQL 确实原子，但在高并发下有两个问题：一、行锁串行化——MySQL 行锁会让所有请求排队更新同一行，QPS 上万时锁等待时间从毫秒级飙到秒级，接口超时；二、连接数撑不住——每个请求都要拿数据库连接，连接池（如 HikariCP 默认 10-20）瞬间耗尽，后续请求阻塞。Redis 是内存操作单线程串行，QPS 能到 10 万，Lua 脚本保证"判断库存 + 扣减"原子，扣减成功的请求再异步落库。所以 Redis 是"挡在 MySQL 前面的缓冲层"，把 90% 的并发压力消化在内存里，MySQL 只接收预扣成功的请求。选 Redis 不是因为 MySQL 不原子，是因为 MySQL 撑不住这个并发量。

### 第二层：证据与定位

**Q：线上拼团突然大面积超时，你怎么确认是 Redis 还是 MySQL 的瓶颈？**

三组证据交叉定位：一、看 Redis 监控——`redis-cli --latency` 看延迟，`INFO clients` 看连接数，`SLOWLOG GET` 看慢命令（>10ms 的）。如果 Redis 延迟正常（<1ms）且 QPS 没到上限，排除 Redis；二、看 MySQL 监控——`SHOW PROCESSLIST` 看是否有大量 `Waiting for lock` 状态的线程，`innodb_row_lock_waits` 看行锁等待次数。如果行锁等待堆积，是 MySQL 瓶颈；三、看应用侧——APM trace 看拼团接口的耗时分布，是卡在 Redis 调用还是 DB 调用。三者交叉能精准定位——Redis 延迟高是 Redis 问题、DB 行锁堆积是 DB 问题、两者都正常但应用卡顿是连接池或 GC 问题。

### 第三层：根因深挖

**Q：你的 Redis 分布式锁用 SetNX + 过期时间，但出现过"锁被误删"事故——线程 A 的锁过期后被线程 B 拿到，A 执行完把 B 的锁删了。根因是什么？**

根因是"锁的持有者标识缺失"。SetNX 时只设了 key 没设唯一 value，删除时 `DEL key` 不校验是不是自己加的锁。线程 A 因业务耗时超过过期时间，锁自动释放；线程 B 抢到锁（同一个 key）；A 执行完调用 DEL，把 B 的锁删了；B 的临界区失去保护，第三个线程 C 也能进来。这是"锁释放不安全"的经典 case。修复：SetNX 时 value 设成 UUID（如 `SET key uuid NX EX 30`），删除前用 Lua 脚本判断 `if redis.call('get', key) == uuid then return redis.call('del', key) end`——GET+DEL 包在 Lua 里保证原子，避免"GET 后别人抢锁、再 DEL 删错"的竞态。这是 SetNX 裸用的第一大坑。

**Q：那为什么不直接把过期时间设很长（如 5 分钟），避免锁提前过期？**

治标不治本。设 5 分钟只是降低概率，不是消除风险——如果业务卡死（如 GC 停顿 6 分钟、DB 死锁等 10 分钟），5 分钟照样过期，问题复现。而且长过期时间带来新问题：持有锁的进程崩溃后，锁要等 5 分钟才释放，这 5 分钟内其他线程全卡住，业务雪崩。根治方案是 watchdog 自动续期——Redisson 的看门狗机制：锁默认 30 秒过期，后台线程每 10 秒检查"当前线程是否仍持有锁"，是则续到 30 秒。业务执行多久锁就续多久，业务结束主动释放。所以"设多长过期时间"是个伪命题，正确答案是"不要靠人估时间，要用自动续期机制"。

### 第四层：方案权衡

**Q：你说长链路用 Redisson（带 watchdog），短耗时用 SetNX，这个分界怎么定？有没有量化标准？**

量化标准是"业务 P99 耗时 vs 锁过期时间的安全比例"。规则：锁过期时间 ≥ 业务 P99 × 3（留 3 倍 buffer 防 GC、网络抖动）。如果业务 P99 < 100ms，设过期时间 1 秒就够，SetNX 足矣（无需续期复杂度）；如果业务 P99 > 1 秒（如支付要调第三方、要等回调），过期时间难估，用 Redisson watchdog 自动续期。所以分界不是拍脑袋，是"P99 能不能稳定估进过期时间"。我的实践：库存扣减、限流这类毫秒级操作用 SetNX；订单创建、支付结算这类秒级链路用 Redisson。两类锁的成本不同（Redisson 更重），按需选型。

**Q：为什么不直接用 ZooKeeper 做分布式锁，它的强一致性不是更适合锁吗？**

ZK 的优势是 CP（强一致），锁释放通过 session 失效，可靠性高。但有两个劣势：一、性能——ZK 每次加锁要多节点 Quorum 写（Paxos/ZAB 协议），QPS 通常只有几千，Redis 单线程内存操作能到 10 万；二、部署成本——ZK 集群至少 3-5 节点，运维复杂，大多数业务已经有 Redis 但没有 ZK。权衡：金融级"绝对不能多持锁"场景（如资金划拨）用 ZK（牺牲性能换强一致），互联网高并发场景（拼团、秒杀）用 Redis（牺牲极端情况的一致性换性能）。我的业务是拼团，QPS 优先，所以 Redis + Redisson 是合理选择。没有"谁更好"，只有"谁更适合场景"。

### 第五层：验证与沉淀

**Q：你怎么验证分布式锁在高并发下真的没超卖、没死锁？**

三类测试：一、超卖测试——模拟 1000 并发抢 10 个库存，结束后 `SELECT COUNT(*) FROM orders WHERE activity_id=X` 应等于 10，不多不少；二、死锁测试——开 100 线程反复加锁释放，跑 1 小时后 Redis 里不应有残留 key（`KEYS lock:*` 应为空），且无线程卡在等待；三、故障注入——持有锁的进程 `kill -9`，观察锁是否在过期时间后被正确释放（Redisson 靠 watchdog 失活后过期，SetNX 靠 TTL）。线上监控：Redis 的 `connected_clients`、`blocked_clients`（BRPOP/BLPOP 等待数），持续增长说明锁等待堆积。这些指标接入告警，超阈值就告警。

**Q：这道题做完，你沉淀出了什么可复用的分布式锁设计原则？**

四条原则：一、锁要有唯一标识（UUID value），释放时校验，避免误删；二、锁要有兜底过期时间（防持有者崩溃后死锁），且优先用自动续期（watchdog）而非人估时间；三、锁粒度按业务实体（如 order_id），不要全局锁（性能灾难）；四、锁释放用 Lua 保证"判断+删除"原子，不要在应用层分两步。这套原则我已经写进团队的中间件使用规范，所有新增的分布式锁都要 review 这四点。Redisson 已经内置了前三点，所以新项目首选 Redisson，SetNX 只在"极端简单且不能引入 Redisson 依赖"时用。


## 结构化回答

**30 秒电梯演讲：** Redis在高并发业务中主要解决缓存、锁单、分布式锁、库存预扣和热点配置问题。打个比方，Redis就像前台的暂存柜——常用东西放这拿得快(缓存)、贵重物品先锁起来(锁单)、多人抢同一个东西先到先得(分布式锁)。

**展开框架：**
1. **两大核心场景** — 高并发读写缓存，以及分布式锁防超卖。
2. **防超卖方案** — 因为高并发下MySQL行锁慢，所以用Redis配合Lua脚本做原子库存预扣。
3. **分布式锁实现** — 短耗时用SetNX，长链路用Redisson自动续期。

**收尾：** 这块我踩过坑——要不要深入聊：Redis和MySQL的数据一致性怎么保证？

## 视频脚本

> 预计时长：2 分钟 | 由浅入深

| 时间 | 画面/字幕 | 口播台词 | 讲解要点 |
|------|----------|----------|----------|
| 0:00 | 标题卡 | "Redis一句话：Redis在高并发业务中主要解决缓存、锁单、分布式锁、库存预扣和热点配置问题。" | 开场钩子 |
| 0:15 | Redis Lua 脚本执行截图 | "两大核心场景：高并发读写缓存，以及分布式锁防超卖。" | 两大核心场景 |
| 1:02 | Redis Lua 脚本执行截图分步演示 | "防超卖方案：因为高并发下MySQL行锁慢，所以用Redis配合Lua脚本做原子库存预扣。" | 防超卖方案 |
| 1:50 | 总结卡 | "核心抓住这条主线，下期咱们接着聊：Redis和MySQL的数据一致性怎么保证。" | 收尾 |
