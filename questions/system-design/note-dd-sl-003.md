---
id: note-dd-sl-003
difficulty: L4
category: system-design
subcategory: 缓存
tags:
- 滴滴
- 面经
- 短链系统
- 缓存一致性
- Redis
feynman:
  essence: 短链场景读多写少，用先更新DB再删缓存的最终一致方案即可。
  analogy: 就像图书馆更新目录卡——你先换新书，再扔掉旧目录卡，下次有人查时自然去拿新卡。
  first_principle: 缓存一致性的本质是：缓存数据有 TTL 的过期窗口，在此窗口内读到旧数据是否可接受？
  key_points:
  - Cache Aside（先DB后删缓存）
  - 延迟双删
  - 消息队列保证最终一致
  - 短链场景最终一致足够
first_principle:
  essence: CAP定理下的BASE理论：追求最终一致
  derivation: 强一致需要分布式锁→性能差→短链读取旧数据TTL秒级可接受→最终一致
  conclusion: 短链场景不需要强一致，Cache Aside + 延迟双删是最优解
follow_up:
- 如果先删缓存再更新DB，会有什么问题？
- 延迟双删的延迟时间怎么定？
- 如何监控缓存不一致率？
memory_points:
- 旁路缓存：标准模式为先更新DB，再删除Redis缓存
- 为何删除：删缓存幂等防并发覆盖，更新非原子易引发竞态
- 业务妥协：短链读多极少改，无需强一致，靠TTL兜底即可
---

# 【滴滴面经】怎么保证 Redis 里的短链数据和 DB 一致？这个场景下是否一定要强一致？

## 一、问题本质

缓存一致性是所有"Redis + DB"架构的经典难题。核心矛盾在于：**缓存和数据库是两个独立的存储，无法用一个原子操作同时更新两者**。任何先后的更新顺序，都可能在并发场景下产生数据不一致。

短链场景的特殊性在于：**读多写少**（跳转 QPS 数万，而短链 URL 的修改几乎不发生），这意味着一致性问题的影响范围极其有限。

---

## 二、Cache Aside 模式（旁路缓存）——最标准方案

### 2.1 读操作

```
读请求
  │
  ├─ ① 查 Redis 缓存
  │   ├─ 命中 → 直接返回
  │   └─ 未命中 ↓
  │
  ├─ ② 查 MySQL
  │   └─ 数据存在 → 回写 Redis（设置 TTL）→ 返回
  │   └─ 数据不存在 → 返回 null（可配合布隆过滤器防穿透）
```

### 2.2 写操作

```
写请求
  │
  ├─ ① 先更新 MySQL
  │
  └─ ② 再删除 Redis 缓存（不是更新缓存，是删除）
```

> **为什么是"删除"缓存而不是"更新"缓存？**
> - **删除是幂等的**：并发删除不会出错；更新可能产生覆盖竞态
> - **Lazy 思想**：写时只删缓存，下次读时按需重建（lazy load），避免频繁更新一个可能根本没人读的缓存

### 2.3 Java 代码实现

```java
@Service
@Slf4j
public class ShortLinkService {

    @Autowired private StringRedisTemplate redisTemplate;
    @Autowired private ShortLinkMapper shortLinkMapper;

    private static final String CACHE_PREFIX = "sl:";
    private static final long CACHE_TTL_HOURS = 7L;

    // ========== 读操作 ==========
    public String getLongUrl(String shortCode) {
        String cacheKey = CACHE_PREFIX + shortCode;

        // ① 先查 Redis
        String longUrl = redisTemplate.opsForValue().get(cacheKey);
        if (longUrl != null) {
            return longUrl;  // 缓存命中，直接返回
        }

        // ② 缓存未命中，查 MySQL
        longUrl = shortLinkMapper.getLongUrlByShortCode(shortCode);
        if (longUrl != null) {
            // ③ 回写 Redis，设置 TTL 防止脏数据永久驻留
            redisTemplate.opsForValue().set(
                cacheKey, longUrl, CACHE_TTL_HOURS, TimeUnit.HOURS
            );
        }
        return longUrl;
    }

    // ========== 写操作：先更新 DB，再删除缓存 ==========
    @Transactional
    public void updateLongUrl(String shortCode, String newLongUrl) {
        // ① 先更新 DB
        shortLinkMapper.updateLongUrl(shortCode, newLongUrl);
        // ② 再删除缓存
        redisTemplate.delete(CACHE_PREFIX + shortCode);
    }
}
```

### 2.4 为什么"先更新 DB 再删缓存"是最优的？

考虑四种策略的并发风险：

| 策略 | 并发风险 | 不一致窗口 | 评估 |
|------|---------|-----------|------|
| ① 先更新 DB，再更新缓存 | 并发写覆盖：A 先更新 DB 但后更新缓存，B 后更新 DB 但先更新缓存 → 缓存是旧值 | 长期 | ❌ |
| ② 先更新缓存，再更新 DB | DB 更新失败 → 缓存是新值，DB 是旧值 | 长期 | ❌ |
| ③ **先更新 DB，再删缓存** | 删缓存失败 → 缓存残留旧值，但 TTL 兜底 | TTL 内 | **✅ 最优** |
| ④ 先删缓存，再更新 DB | 并发读回写旧值（经典坑）→ 见下文分析 | 长期 | ⚠️ 需配合延迟双删 |

### 2.5 "先更新 DB 再删缓存"残留的不一致场景

```
Thread A (读，缓存刚好失效)    Cache         Thread B (写)       Database
    │                            │                │                  │
    │  ① GET key (miss)          │                │                  │
    │ ─────────────────────────> │                │                  │
    │                            │                │                  │
    │  ② SELECT * FROM db        │                │                  │
    │ ────────────────────────────────────────────────────────────> │
    │                            │                │                  │
    │                            │   ③ UPDATE db  │                  │
    │                            │ ────────────────────────────────>│
    │                            │                │  ④ DELETE cache  │
    │                            │ <──────────────│                  │
    │  ⑤ SET key = old_data      │                │                  │
    │ ─────────────────────────> │ ← 脏数据写入！   │                  │
```

> **触发条件极苛刻**：需要读线程查完 DB 后、写回缓存前，恰好被写线程插入。因为**读 DB → 写缓存**的时间远小于**写 DB**的时间，实际触发概率极低。再加 TTL 兜底，最终会自愈。

---

## 三、经典反面案例：先删缓存再更新 DB

### 3.1 问题复现

```
Thread A (写)          Thread B (读)         Cache          Database
    │                       │                  │                │
    │  ① DELETE cache       │                  │                │
    │ ─────────────────────────────────────> │                │
    │                       │                  │                │
    │                       │  ② GET key (miss)│                │
    │                       │ ────────────────│                │
    │                       │                  │                │
    │  ③ UPDATE db          │  ④ SELECT (old)  │                │
    │ ────────────────────────────────────────────────────────> │
    │                       │ <──────────────────────────────── │
    │                       │  ⑤ SET key = old_data             │
    │                       │ ────────────────│  ← 脏数据！       │
    │                       │                  │                │
    │   结果：DB 是新值，缓存是旧值，不一致！                       │
```

**根本原因：** 删缓存后、更新 DB 前，其他线程读到旧数据并回写缓存。

### 3.2 延迟双删方案

为了解决"先删缓存再更新 DB"的并发问题，引入**延迟双删**：

```
写操作流程：
  ① 删除缓存
  ② 更新 DB
  ③ 延迟 N 毫秒后，再次删除缓存  ← 消灭并发读回写的脏数据
```

```java
@Transactional
public void updateLongUrlWithDoubleDelete(String shortCode, String newLongUrl) {
    String cacheKey = CACHE_PREFIX + shortCode;

    // 第一次删除缓存
    redisTemplate.delete(cacheKey);

    // 更新 DB
    shortLinkMapper.updateLongUrl(shortCode, newLongUrl);

    // 延迟第二次删除（异步，不阻塞主流程）
    // 延迟时间 = 一次读请求的耗时（查DB + 回写缓存），通常 500ms 足够
    scheduledExecutor.schedule(() -> {
        redisTemplate.delete(cacheKey);
        log.info("延迟双删完成, key={}", cacheKey);
    }, 500, TimeUnit.MILLISECONDS);
}
```

**延迟时间怎么定？**

- 经验值：**500ms~1s**
- 原理：延迟时间要覆盖"读线程查 DB + 写回缓存"的耗时窗口
- 过短：并发读可能还没写回缓存，第二次删除无效
- 过长：脏数据存活时间增加（但有 TTL 兜底，影响可控）

---

## 四、消息队列 + Binlog 订阅——保证最终一致性

### 4.1 问题：删除缓存可能失败

无论是 Cache Aside 还是延迟双删，删除缓存操作本身可能因网络抖动失败。这时需要重试机制。

### 4.2 Canal + MQ 方案

```
┌──────────┐      ┌─────────┐      ┌──────────┐      ┌──────────┐
│  MySQL   │─────>│  Canal  │─────>│   MQ     │─────>│ Consumer │
│ (binlog) │ 订阅  │ (伪装   │ 解析  │ (Kafka/  │ 消费  │ 删除Redis │
│          │      │  slave) │      │  RocketMQ)│      │  缓存    │
└──────────┘      └─────────┘      └──────────┘      └──────────┘
```

**工作原理：**

1. 应用层只负责**更新 DB**，完全不操作 Redis
2. Canal 伪装成 MySQL slave，订阅 binlog
3. Canal 解析 binlog 变更事件，投递到 MQ
4. Consumer 消费消息，执行缓存删除
5. 如果删除失败，MQ 自动重试（at-least-once 语义）

**优势：**

- **解耦**：应用层不感知缓存，只写 DB
- **可靠**：binlog 是 MySQL 的 WAL，不会丢；MQ 提供重试保证
- **幂等**：删除缓存是幂等操作，重复消费不会出错

```java
// Canal 消息消费者
@Component
@RocketMQMessageListener(topic = "short-link-binlog", consumerGroup = "cache-cleaner")
public class CacheCleanConsumer implements RocketMQListener<BinlogEvent> {

    @Autowired private StringRedisTemplate redisTemplate;

    @Override
    public void onMessage(BinlogEvent event) {
        if ("UPDATE".equals(event.getType()) || "DELETE".equals(event.getType())) {
            String shortCode = event.getAfterRow().get("short_code");
            redisTemplate.delete("sl:" + shortCode);
            log.info("消费binlog清理缓存: shortCode={}", shortCode);
        }
    }
}
```

### 4.3 完整时序图

```
应用层               MySQL                Canal              MQ             Consumer         Redis
  │                    │                    │                 │                │               │
  │  ① UPDATE db       │                    │                 │                │               │
  │ ─────────────────> │                    │                 │                │               │
  │                    │                    │                 │                │               │
  │  ② 返回成功         │                    │                 │                │               │
  │ <───────────────── │                    │                 │                │               │
  │                    │  ③ 写入 binlog     │                 │                │               │
  │                    │ ─────────────────> │                 │                │               │
  │                    │                    │  ④ 解析事件投递   │                │               │
  │                    │                    │ ──────────────> │                │               │
  │                    │                    │                 │  ⑤ 消费消息     │               │
  │                    │                    │                 │ ─────────────> │               │
  │                    │                    │                 │                │  ⑥ DEL key    │
  │                    │                    │                 │                │ ────────────> │
  │                    │                    │                 │                │               │
  │                    │                    │                 │                │  删除失败？     │
  │                    │                    │                 │  ⑦ NACK 重试   │               │
  │                    │                    │                 │ <───────────── │               │
  │                    │                    │                 │ ─────────────> │  ⑧ 重新消费    │
```

---

## 五、为什么短链场景不需要强一致？

### 5.1 业务特性分析

| 维度 | 短链场景 | 是否需要强一致 |
|------|---------|--------------|
| **读写比** | 读:写 ≈ 10000:1（跳转多，修改少） | 否 |
| **数据变更频率** | 极低（短链创建后几乎不修改 URL） | 否 |
| **不一致影响** | 极小（旧 URL 仍可跳转，只是跳到旧地址） | 否 |
| **容忍窗口** | TTL 内（通常几小时）自动自愈 | 可接受 |
| **写入并发** | 同一短链几乎不会有并发写 | 否 |

### 5.2 强一致的成本

实现强一致需要：
- **分布式锁**（如 Redis RedLock）：每次读写都加锁 → QPS 暴跌 10 倍以上
- **分布式事务**（如 2PC/3PC）：性能极差，且实现复杂
- **串行化隔离级别**：并发度极低

```
强一致方案的代价：
  读请求 → 加分布式锁 → 查DB → 查缓存 → 比对一致 → 释放锁 → 返回
  ↑ 每次 RT 从 5ms 涨到 50ms+，QPS 从 3万 降到 3000
```

### 5.3 BASE 理论指导

根据 CAP 定理和 BASE 理论：

- **B**asically **A**vailable：基本可用
- **S**oft state：软状态（允许中间不一致状态）
- **E**ventually consistent：最终一致

短链场景完美符合 BASE 理论的适用条件——**追求高可用和高性能，容忍秒级不一致窗口**。

### 5.4 短链场景的推荐方案

```
推荐架构：

  Cache Aside（先DB后删缓存）
       +
  TTL 兜底（所有缓存设置过期时间）
       +
  Canal + MQ 异步补偿（删除失败时自动重试）
       =
  最终一致性 ✓
```

---

## 六、面试追问准备

### 6.1 如果先删缓存再更新 DB，会有什么问题？

**并发读写竞态：** 写线程删缓存后、更新 DB 前，读线程查到旧数据并回写缓存，导致缓存中残留旧值。解决方案：延迟双删。

### 6.2 延迟双删的延迟时间怎么定？

- 经验值 **500ms~1s**，取决于读 DB + 回写缓存的耗时
- 本质是确保"并发读线程完成回写"后再做第二次删除
- 如果不确定，可以用"读请求耗时监控的 P99"作为基准值

### 6.3 如何监控缓存不一致率？

```java
// 定时抽样比对：随机抽取 N 个 key，比对 Redis 和 DB 的值
@Scheduled(fixedRate = 60000)
public void checkConsistency() {
    List<String> sampleKeys = redisTemplate.randomKeys(100);
    int inconsistentCount = 0;
    for (String key : sampleKeys) {
        String cached = redisTemplate.opsForValue().get(key);
        String fromDb = shortLinkMapper.getLongUrlByShortCode(extractCode(key));
        if (!Objects.equals(cached, fromDb)) {
            inconsistentCount++;
            alertService.send("缓存不一致: " + key);
        }
    }
    metricsService.gauge("cache.inconsistency.rate",
                         (double) inconsistentCount / sampleKeys.size());
}
```

---

## 七、总结对比

| 方案 | 一致性强度 | 性能 | 复杂度 | 短链场景适用？ |
|------|----------|------|--------|-------------|
| Cache Aside（先DB后删缓存） | 最终一致 | ⭐⭐⭐⭐⭐ | 低 | ✅ 核心方案 |
| 延迟双删 | 最终一致+ | ⭐⭐⭐⭐ | 中 | ✅ 补充方案 |
| Canal + MQ 异步补偿 | 最终一致++ | ⭐⭐⭐⭐ | 中高 | ✅ 高可用保障 |
| 分布式锁 + 强一致 | 强一致 | ⭐ | 高 | ❌ 大材小用 |

> **面试核心论点：** "短链场景读多写少，数据变更极少，不一致窗口通过 TTL 自动收敛。**Cache Aside + TTL 兜底 + Canal 异步补偿**是性价比最高的方案，追求强一致是过度设计，会牺牲 90% 的 QPS 性能。能讲清楚这个 trade-off，就是架构师思维。"

## 记忆要点

- 旁路缓存：标准模式为先更新DB，再删除Redis缓存
- 为何删除：删缓存幂等防并发覆盖，更新非原子易引发竞态
- 业务妥协：短链读多极少改，无需强一致，靠TTL兜底即可

