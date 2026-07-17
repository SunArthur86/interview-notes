---
id: note-bd-agent-010
difficulty: L3
category: database
subcategory: Redis
tags:
- 字节
- 面经
- Redis
- 分布式锁
feynman:
  essence: 裸SetNX有三大问题——过期时间难定、无自动续期、误删他人锁，Redisson封装了这些
  analogy: 裸SetNX像用绳子拴门——绳子的长度(过期时间)不好定、没人在门外帮你续绳子(无续期)、别人可能误拆你的绳(误删)
  first_principle: 分布式锁的安全要求：只有持有者能释放 + 持有期间锁不会过期 + 锁不会永远不释放
  key_points:
  - 过期时间难定——业务执行时间不确定
  - 没有自动续期——业务慢则锁过期被他人获取
  - 误删他人锁风险——不加校验直接DEL
  - 不可重入——同线程不能多次获取
first_principle:
  essence: 分布式锁需要同时满足互斥性、安全性和防死锁三个约束
  derivation: SetNX只满足了互斥性(NX保证)→缺乏安全性(无owner校验)→缺乏防死锁(EX过期但业务没完)→Redisson补全了这些
  conclusion: 裸SetNX是分布式锁的最简陋实现，生产环境必须用Redisson或自己补全安全措施
follow_up:
- RedLock算法解决了什么问题？
- Redis主从切换时锁会丢失吗？
- ZooKeeper分布式锁和Redis锁的区别？
memory_points:
- 三大问题：因为业务耗时不确定，所以过期时间难定；且无自动续期易致锁提前释放，存在删他人锁风险
- 对比记忆：裸SetNX无重入无排队，Redisson开箱即用内置watchdog、Pub/Sub等待及重入机制
- 可重入原理：因为Redisson底层用Hash结构（key+UUID+threadId+重入次数），所以同线程可多次获取锁
- 安全释放：必须通过Lua脚本校验value唯一标识后再执行DEL，以保证释放操作的原子性
---

# 直接用SetNX做分布式锁会有什么问题？和Redisson有什么区别？

## 裸SetNX的三大问题

### 问题一：过期时间难定 ⏱️

```
场景：业务执行时间不确定

设置TTL=10s：
情况A：业务执行5s完成 → 锁还剩5s才过期 → 浪费
情况B：业务执行15s完成 → 锁10s就过期了！

问题B的后果：
T=0s   线程A获取锁(TTL=10s)
T=10s  锁过期，线程B获取锁
T=15s  线程A执行完毕，执行DEL → 删掉了线程B的锁！
T=16s  线程C获取锁 → A和B和C同时持有 → 互斥被破坏！
```

### 问题二：误删他人锁 🔓

```python
# ❌ 危险：不加校验直接删除
def unsafe_unlock(lock_key):
    redis.delete(lock_key)  # 可能删掉别人的锁！

# ✅ 安全：Lua脚本校验value
RELEASE_SCRIPT = """
if redis.call('GET', KEYS[1]) == ARGV[1] then
    return redis.call('DEL', KEYS[1])
else
    return 0
end
"""
def safe_unlock(lock_key, lock_value):
    redis.eval(RELEASE_SCRIPT, 1, lock_key, lock_value)
```

### 问题三：不可重入 🔄

```python
# 同一线程多次调用同一资源的锁 → 第二次获取失败
def process_order(order_id):
    lock("order:" + order_id)      # 第一次获取 ✅
    update_order(order_id)          # 内部又调用了lock("order:"+id)
    # → 获取失败！因为已经持有，但SetNX不支持重入
    unlock("order:" + order_id)
```

## SetNX vs Redisson 对比

| 特性 | 裸SetNX | Redisson |
|------|---------|----------|
| **原子获取** | ✅ SET NX EX | ✅ |
| **自动续期** | ❌ 没有 | ✅ watchdog每10s续期 |
| **owner校验释放** | ❌ 需自己写Lua | ✅ 内置Lua校验 |
| **可重入** | ❌ 不支持 | ✅ Hash结构记录重入次数 |
| **等待/通知** | ❌ 需自己轮询 | ✅ Pub/Sub通知 |
| **公平锁** | ❌ 不支持 | ✅ 支持公平锁 |
| **读写锁** | ❌ 不支持 | ✅ 支持ReadWriteLock |
| **生产可用** | ⚠️ 需自行补全 | ✅ 开箱即用 |

## Redisson底层实现原理

### 可重入锁

```
Redisson用Hash结构存储锁信息：

Key:   lock:order:123
Value: {
    "uuid:threadId:1": "1"   ← 线程标识: 重入次数
}

获取锁：
  HSET lock:order:123 uuid:threadId:1 1
  PEXPIRE lock:order:123 30000

重入：
  HINCRBY lock:order:123 uuid:threadId:1 1

释放：
  HINCRBY lock:order:123 uuid:threadId:1 -1
  if count == 0 → DEL lock:order:123
```

### watchdog续期

```java
// Redisson watchdog伪代码
// 锁默认TTL=30s，watchdog每10s检查一次
while (lock.isHeldByCurrentThread()) {
    if (lock.exists()) {
        // 续期到30s
        lock.expire(30, TimeUnit.SECONDS);
    }
    Thread.sleep(10000);  // 10s后再次检查
}
// JVM崩溃 → watchdog线程死亡 → 锁30s后自动释放
```

## 面试回答要点

> "裸SetNX有三大问题：

> **第一是过期时间难定**——业务执行时间不确定，设短了锁提前过期被别人抢，设长了浪费。

> **第二是没有自动续期**——业务慢的时候锁过期了，但业务还在执行。

> **第三是误删别人锁的风险**——如果自己实现，至少要value校验加Lua删除。

> Redisson封装了续期、可重入和等待机制，复杂业务里更稳。SetNX更适合短链路、轻量锁。"

## 什么时候用SetNX？

```
SetNX适用场景：
✅ 操作耗时短（<5s）
✅ 不需要重入
✅ 不需要等待队列
✅ 性能要求极高

SetNX不适用场景：
❌ 操作耗时长（>10s）
❌ 需要重入
❌ 需要公平排队
❌ 支付/结算等关键链路
```

## 面试加分点

1. **代码级理解**：能写出Lua脚本的安全释放逻辑
2. **watchdog原理**：解释续期线程的生命周期与JVM绑定
3. **选型建议**：能根据业务特点推荐合适方案，而不是盲目选Redisson
4. **RedLock认知**：提到RedLock解决主从切换丢锁问题（但争议较大，了解即可）

## 记忆要点

- 三大问题：因为业务耗时不确定，所以过期时间难定；且无自动续期易致锁提前释放，存在删他人锁风险
- 对比记忆：裸SetNX无重入无排队，Redisson开箱即用内置watchdog、Pub/Sub等待及重入机制
- 可重入原理：因为Redisson底层用Hash结构（key+UUID+threadId+重入次数），所以同线程可多次获取锁
- 安全释放：必须通过Lua脚本校验value唯一标识后再执行DEL，以保证释放操作的原子性


## 苏格拉底式面试追问

> 这组追问模拟面试官层层逼问，每一问先回答"为什么"，再回答"怎么做"，最后回答"如何证明"。

### 第一层：目标与动机

**Q：SetNX 裸用有三大问题，你说"过期时间难定"是核心。为什么不能用"先 SetNX 不设过期、业务完再 DEL"的方式彻底避免过期问题？**

会死锁。如果持有锁的进程崩溃（kill -9、OOM、机器宕机）、或网络分区导致 DEL 请求发不出去，这个没有过期的锁会永远存在，其他线程永远拿不到锁，业务雪崩。过期时间是"兜底释放机制"——即使持有者异常无法主动释放，锁也会在过期后被自动清理。所以"不设过期"换来的是"过期时间难定"问题的消失，但引入了更严重的"死锁"风险。两者权衡，死锁是 P0 级故障（整个业务瘫痪），过期时间难定是 P1 级（偶发锁失效），必须接受后者以避免前者。这是分布式锁的基本安全原则——"必须有兜底释放机制"，没有过期的锁是设计缺陷。

### 第二层：证据与定位

**Q：你怎么定位线上 SetNX 锁导致的"误删他人锁"事故？**

证据链：一、应用日志里搜锁 key，看加锁、释放的时间戳和 value（如果记录了）；二、Redis 的 MONITOR 命令（谨慎用，仅短期排查）抓该 key 的所有操作，看 DEL 操作是否来自非持有者；三、如果有 APM，trace 同一个 key 的加锁线程和释放线程，如果 threadId 不一致，就是误删。常见模式：线程 A 加锁（value=A_uuid）→ A 业务慢，锁过期 → 线程 B 加锁（value=B_uuid）→ A 执行完调用 DEL（不校验 value，直接删 key）→ B 的锁没了。定位关键是"释放操作有没有校验 value"，如果代码里是裸 `DEL key`，就是 bug 现场。

### 第三层：根因深挖

**Q：你说"安全释放要用 Lua 脚本校验 value 再 DEL"，为什么 GET + DEL 两步不行，非得 Lua？**

GET 和 DEL 分两步有竞态。场景：线程 A 执行 GET key 返回 A_uuid（确认是自己加的）→ 此刻锁恰好过期、线程 B 抢到锁（value=B_uuid）→ 线程 A 执行 DEL key（删的是 B 的锁）。两步之间有时间窗口，被其他线程插入。Lua 脚本把"判断 value + 删除"包在 Redis 单线程的原子执行里，中间不会被其他命令打断。脚本：`if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end`。这是 Redis 保证原子性的标准手段——所有"读+写依赖"的操作都要用 Lua 或事务（MULTI/EXEC），不能拆成多个独立命令。

**Q：那为什么不直接用 Redis 事务（MULTI/EXEC）替代 Lua？**

MULTI/EXEC 是"乐观"事务，WATCH key 后如果在 EXEC 前 key 被修改，整个事务回滚。但"判断 value 再 DEL"用 WATCH 不好实现——WATCH 后 GET、判断 value，如果对就 EXEC DEL，但判断逻辑（if value == uuid）在客户端，不在事务里，事务只能保证"GET 后 key 没变"，不能保证"value 等于我的 uuid 时才删"。要在服务端做条件判断，必须用 Lua（脚本在 Redis 内执行，能看到 GET 的值并做 if 判断）。所以 Redis 事务适合"多个命令打包原子执行"（如同时更新多个 key），不适合"基于读取值做条件操作"，后者必须用 Lua。这是 Redis 与 MySQL 事务的核心区别——Redis 没有 WHERE 条件的 DELETE。

### 第四层：方案权衡

**Q：Redisson 用 Hash 结构（key+UUID+threadId+重入次数）实现可重入锁，为什么不直接用 String + 计数器变量？**

String 类型存不了"重入次数 + 线程标识"的结构化信息。可重入锁要求：同一线程多次加锁不阻塞（重入次数 +1）、释放时次数 -1、次数归零才真删 key。如果用 String，要么存"UUID:threadId:count"拼接字符串（解析麻烦且非原子）、要么用多个 key（key_uuid、key_count，管理复杂）。Hash 结构 `HSET lock_key uuid:threadId count` 天然适合——field 是 "uuid:threadId" 标识持有者，value 是重入次数，HINCRBY 原子增减，HEXISTS 判断是否持有。释放时判断 field 匹配 + HINCRBY -1，count 归零 DEL key。这是数据结构选型匹配业务语义的典范——Hash 表达"实体 + 属性 + 计数"最自然。

**Q：为什么不用 Java 进程内的 ReentrantLock，非得用 Redis 分布式锁？**

ReentrantLock 只在单 JVM 内有效，多实例部署时失效。场景：服务部署 3 个实例，用户请求负载均衡到实例 A，A 用 ReentrantLock 加锁；另一个用户的同类请求落到实例 B，B 的 ReentrantLock 不知道 A 持有锁，两个请求并行执行临界区。分布式锁（Redis）是跨 JVM 的——所有实例连同一个 Redis，锁状态共享。所以选 Redis 分布式锁的前提是"多实例部署"。如果服务只部署单实例（少见），ReentrantLock 足矣且性能更好（无网络开销）。现代微服务基本都是多实例，所以分布式锁是标配，ReentrantLock 用于"单实例内的细粒度并发控制"（如配置缓存读写）。

### 第五层：验证与沉淀

**Q：你怎么验证可重入锁在同线程多次加锁、跨线程互斥、锁释放后其他线程能抢到，这三个核心行为都正确？**

三个专项测试：一、同线程重入——同一线程连续加锁 3 次不阻塞，重入计数应为 3，释放 3 次后锁才真正释放（Redis 里 key 删除）；二、跨线程互斥——线程 A 持有锁时，线程 B 加锁应阻塞或返回失败（看 API：`tryLock` 返回 false、`lock` 阻塞）；三、释放后唤醒——A 释放后，阻塞中的 B 应被唤醒并拿到锁（Redisson 用 Pub/Sub 通知）。验证手段：用 CountDownLatch 控制线程时序，断言各阶段锁状态。线上监控：Redisson 暴露的 `getHoldCount`、`isLocked` 指标接入监控，锁持有时间过长（> 业务 P99×3）告警，防止业务卡死锁不释放。

**Q：这道题做完，你沉淀出了什么可复用的"安全锁实现"检查清单？**

五条检查清单：一、有过期时间（防死锁）；二、有唯一 value 标识（防误删）；三、释放用 Lua 校验（防竞态）；四、支持重入（Hash 结构存计数）；五、有等待/唤醒机制（Pub/Sub，避免轮询）。SetNX 裸用违反了 2-5 条，所以只适合极简场景。Redisson 五条全满足，是生产首选。这套清单我已经用于评审团队所有的分布式锁代码，发现违反任一条都要求整改。新项目直接禁用裸 SetNX，强制用 Redisson，从源头杜绝这类 bug。


## 结构化回答

**30 秒电梯演讲：** 裸SetNX有三大问题——过期时间难定、无自动续期、误删他人锁，Redisson封装了这些。打个比方，裸SetNX像用绳子拴门——绳子的长度(过期时间)不好定、没人在门外帮你续绳子(无续期)、别人可能误拆你的绳(误删)。

**展开框架：**
1. **三大问题** — 因为业务耗时不确定，所以过期时间难定；且无自动续期易致锁提前释放，存在删他人锁风险
2. **对比记忆** — 裸SetNX无重入无排队，Redisson开箱即用内置watchdog、Pub/Sub等待及重入机制
3. **可重入原理** — 因为Redisson底层用Hash结构（key+UUID+threadId+重入次数），所以同线程可多次获取锁

**收尾：** 这块我踩过坑——要不要深入聊：RedLock算法解决了什么问题？

## 视频脚本

> 预计时长：3 分钟 | 由浅入深

| 时间 | 画面/字幕 | 口播台词 | 讲解要点 |
|------|----------|----------|----------|
| 0:00 | 标题卡 | "Redis一句话：裸SetNX有三大问题——过期时间难定、无自动续期、误删他人锁，Redisson封装了这些。" | 开场钩子 |
| 0:15 | Redis Lua 脚本执行截图 | "三大问题：因为业务耗时不确定，所以过期时间难定；且无自动续期易致锁提前释放，存在删他人锁风险" | 三大问题 |
| 1:06 | Redis Lua 脚本执行截图分步演示 | "对比记忆：裸SetNX无重入无排队，Redisson开箱即用内置watchdog、Pub/Sub等待及重入机制" | 对比记忆 |
| 1:57 | 关键代码/伪代码片段 | "可重入原理：因为Redisson底层用Hash结构（key+UUID+threadId+重入次数），所以同线程可多次…" | 可重入原理 |
| 2:50 | 总结卡 | "核心抓住这条主线，下期咱们接着聊：RedLock算法解决了什么问题。" | 收尾 |
