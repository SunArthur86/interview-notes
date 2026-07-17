---
id: note-mt2-001
difficulty: L3
category: system-design
subcategory: 分布式锁
tags:
- 美团
- 面经
- Redis
- 分布式锁
- 容灾
feynman:
  essence: 分布式流程引擎的状态一致性需要分布式锁+状态机+事件溯源保证；Redis锁需要考虑单点故障，用RedLock或ZK兜底
  analogy: 像多人协作编辑同一份文档——必须有人拿编辑锁才能改(分布式锁)，改之前确认版本号(状态机)，改完通知所有人(事件通知)，编辑工具挂了要有备用方案(兜底)
  first_principle: 分布式一致性的核心是操作互斥性(锁) + 状态可恢复性(持久化) + 故障容错(兜底)
  key_points:
  - '分布式锁: Redis SETNX + 过期时间 + 唯一token'
  - '锁ID设计: 业务前缀+实体ID+操作类型，防误删'
  - 'Redis故障兜底: RedLock/ZK/数据库乐观锁'
  - '事件不丢失: WAL(预写日志)+ACK确认+重试'
  - '顺序性: 分区key路由+单消费者+幂等'
first_principle:
  essence: 分布式系统没有完美的锁，只有适合场景的锁
  derivation: 单机用mutex → 多机需要分布式锁 → Redis快但可能挂 → 需要兜底 → ZK强一致但慢 → 数据库乐观锁简单但吞吐低 → 根据业务SLA选择
  conclusion: 核心链路用Redis+RedLock双保险，非核心用数据库乐观锁
follow_up:
- RedLock算法的争议点是什么？
- Redis Cluster下分布式锁有什么坑？
- 消息顺序消费怎么保证？
memory_points:
- 加解锁基石：加锁用SET NX PX防死锁，解锁必须用Lua脚本保证“判断+删除”原子性
- 锁粒度：锁ID设计为“业务域+实体ID+操作类型”，因为细粒度控制能避免不同操作互相竞争
- 高可用兜底：纯Redis不安全，所以用RedLock过半节点成功机制来防单点故障
- 终极防线：状态机+DB乐观锁(version版本号)，即使缓存锁全挂，数据库层依然能拦截并发修改
---

# 分布式流程引擎如何保证状态一致性？Redis 锁故障怎么兜底？

## 分布式锁设计

### Redis 分布式锁实现

```java
public class RedisDistributedLock {

    // 加锁: SET key value NX PX timeout
    public boolean tryLock(String lockKey, String requestId, long expireMs) {
        // requestId = UUID，标识锁的持有者(防误删)
        return jedis.set(lockKey, requestId, "NX", "PX", expireMs) != null;
    }

    // 解锁: Lua脚本保证"判断+删除"原子性
    public boolean unlock(String lockKey, String requestId) {
        String luaScript =
            "if redis.call('get', KEYS[1]) == ARGV[1] then " +
            "  return redis.call('del', KEYS[1]) " +
            "else " +
            "  return 0 " +
            "end";
        return jedis.eval(luaScript, Collections.singletonList(lockKey),
                Collections.singletonList(requestId)).equals(1L);
    }
}
```

### 锁ID设计

```java
// ❌ 糟糕的锁ID: 只用实体ID
String lockKey = "lock:order:" + orderId;
// 问题: 同一订单不同操作(创建/取消/退款)会争抢同一把锁

// ✅ 正确的锁ID: 业务前缀 + 实体ID + 操作类型
String lockKey = String.format("lock:%s:%s:%s",
    "order_flow",     // 业务域
    orderId,          // 实体ID
    "approve"         // 操作类型
);
// 不同操作不竞争 → 并发度更高
```

## Redis 故障兜底方案

### 方案1: RedLock (Redis官方推荐)

```
RedLock算法:
  1. 向N个(通常5个)独立的Redis实例同时请求加锁
  2. 超过半数(N/2+1=3)成功 → 锁获取成功
  3. 总耗时 < 锁过期时间 → 有效
  4. 任何节点挂了不影响锁的正确性

  优点: 单点故障不影响
  缺点: 性能下降(5次RTT)，实现复杂
  争议: Martin Kleppmann认为RedLock在时钟漂移下不安全
```

### 方案2: 数据库乐观锁 (终极兜底)

```sql
-- Redis锁是第一道防线，数据库是最后一道
UPDATE order_flow
SET status = 'APPROVED', version = version + 1
WHERE order_id = ? AND version = ? AND status = 'PENDING';
-- 如果affected_rows = 0 → 状态已被其他线程修改 → 并发冲突
```

### 方案3: 状态机 + 前置校验

```java
public class OrderFlowEngine {

    // 状态机定义: 每个状态只允许特定操作
    private static final Map<Status, Set<Action>> TRANSITIONS = Map.of(
        Status.PENDING,    Set.of(Action.APPROVE, Action.REJECT),
        Status.APPROVED,   Set.of(Action.EXECUTE),
        Status.EXECUTING,  Set.of(Action.COMPLETE, Action.FAIL),
        Status.COMPLETED,  Set.of()  // 终态
    );

    public void execute(String orderId, Action action) {
        // 1. Redis分布式锁
        String lockKey = "lock:order:" + orderId + ":" + action;
        if (!redisLock.tryLock(lockKey, requestId, 30000)) {
            throw new ConcurrentOperationException();
        }

        try {
            // 2. 查询当前状态
            Order order = orderDao.findById(orderId);

            // 3. 状态机校验 (防止非法状态转换)
            if (!TRANSITIONS.get(order.getStatus()).contains(action)) {
                throw new IllegalStateException(
                    "非法状态转换: " + order.getStatus() + " → " + action);
            }

            // 4. 执行操作 (数据库乐观锁兜底)
            int affected = orderDao.updateStatus(orderId, action.nextStatus(),
                order.getVersion());
            if (affected == 0) {
                throw new OptimisticLockException("版本号冲突");
            }

            // 5. 发布事件
            eventBus.publish(new OrderStatusChangedEvent(orderId, action));

        } finally {
            redisLock.unlock(lockKey, requestId);
        }
    }
}
```

## 事件不丢失 + 顺序性保证

### 事件不丢失

```
┌─────────────────────────────────────────────┐
│  WAL (Write-Ahead Log) 预写日志             │
│                                             │
│  1. 操作前先写WAL: [op_id, order_id, action]│
│  2. 写入成功 → 执行业务操作                  │
│  3. 业务操作成功 → 发送MQ                    │
│  4. MQ消费ACK → 标记WAL完成                  │
│  5. 崩溃恢复 → 扫描未完成的WAL → 重放        │
└─────────────────────────────────────────────┘
```

### 顺序性保证

```java
// 方案: 分区key路由 + 单消费者 + 幂等

// 生产者: 相同orderId路由到同一partition
ProducerRecord<String, Event> record = new ProducerRecord<>(
    "order-events",
    orderId,    // ← partition key, 相同orderId → 相同partition → 有序
    event
);

// 消费者: 单partition单消费者 → 保证顺序消费
// 幂等: 消费前检查event_id是否已处理

// 如果业务允许乱序但需要最终一致:
// → 用saga模式补偿 → 最终所有步骤都完成
```

## 完整兜底链路

```
请求 → Redis分布式锁 (第一道, 99.9%拦截)
           ↓ Redis挂了
       → 数据库乐观锁 (第二道, 兜底)
           ↓ 并发冲突
       → 状态机校验 (第三道, 防非法转换)
           ↓ 状态已变更
       → 拒绝操作 (安全失败)
```

## 记忆要点

- 加解锁基石：加锁用SET NX PX防死锁，解锁必须用Lua脚本保证“判断+删除”原子性
- 锁粒度：锁ID设计为“业务域+实体ID+操作类型”，因为细粒度控制能避免不同操作互相竞争
- 高可用兜底：纯Redis不安全，所以用RedLock过半节点成功机制来防单点故障
- 终极防线：状态机+DB乐观锁(version版本号)，即使缓存锁全挂，数据库层依然能拦截并发修改


## 苏格拉底式面试追问

> 这组追问模拟面试官层层逼问，每一问先回答"为什么"，再回答"怎么做"，最后回答"如何证明"。

### 第一层：目标与动机

**Q：分布式流程引擎你为什么必须用分布式锁，不能用数据库的 SELECT FOR UPDATE？**

因为 SELECT FOR UPDATE 的性能和粒度不够。流程引擎的核心操作是"读取流程当前状态 → 执行流转 → 更新状态"，SELECT FOR UPDATE 能保证"读 + 写"的原子性，但① 性能——行锁在高并发下排队，TPS 低；② 超时——锁等待超时（innodb_lock_wait_timeout 默认 50 秒）会导致长事务；③ 粒度——DB 锁是行级，但流程引擎可能需要"跨多行的复合操作"（如并行网关要同时锁多个分支），DB 锁难表达。Redis 分布式锁是内存操作（快），锁粒度灵活（可锁任意 key 如 `process:instance:123`），TTL 防死锁。决策依据：高并发 + 细粒度锁需求，用 Redis 分布式锁。

### 第二层：证据与定位

**Q：流程实例的状态异常（如卡在"审批中"不动），你怎么定位是锁没释放还是流程逻辑 bug？**

查锁状态和流程事件：
1. Redis 锁——`GET lock:process:instance:123`，如果锁存在且 TTL 还很长，是持有者没释放（崩溃或 bug），手动删除锁恢复。
2. 流程事件日志——流程引擎的事件溯源（Event Sourcing）记录了所有状态变更，查实例 123 的事件流，看最后一个事件是什么，是否应该触发下一步但没触发。
3. 消息队列——如果流程流转依赖 MQ（如"审批通过"消息），看消息是否积压或消费失败。

### 第三层：根因深挖

**Q：Redis 锁的 TTL 是 30 秒，但流程操作执行了 40 秒，锁提前释放导致并发修改，根因是什么？**

最可能是业务执行时间超过锁 TTL。Redis SET NX PX 30000 设了 30 秒过期，但流程操作（含 DB 写 + MQ 发送 + 外部调用）耗时 40 秒，30 秒时锁自动释放，另一个线程拿到锁开始操作，两个线程并发修改同一流程实例，数据错乱。根因是 TTL 估算不准。解法：① Redisson 看门狗——自动续期（默认每 10 秒续到 30 秒），只要线程活着锁不过期；② 优化业务——把 40 秒的操作拆成更小的原子步骤，每步独立加锁；③ 乐观锁兜底——DB 层加 version 字段，`UPDATE ... WHERE version = ?`，并发修改时一个失败重试。

**Q：为什么不直接把锁 TTL 设到 5 分钟，留足余量，而要用看门狗续期？**

因为风险和资源浪费。TTL 5 分钟意味着如果持锁线程崩溃（OOM、Kill），锁要等 5 分钟才释放，期间这个流程实例卡死 5 分钟（其他线程拿不到锁）。看门狗续期是"动态续期"——正常执行时每 10 秒续期（锁不过期），线程崩溃时停止续期，锁在 30 秒后自动释放（快速恢复）。TTL 设长是"以防万一"但恢复慢，看门狗是"按需续期"且崩溃快速恢复。生产场景用 Redisson 看门狗，不用固定长 TTL。

### 第四层：方案权衡

**Q：Redis 锁挂了你用 RedLock 兜底，RedLock 的争议（Martin Kleppmann 批评）你怎么看？**

RedLock 的争议在于"时钟假设"。RedLock 要在 N 个独立 Redis 节点上获取锁，多数派（N/2+1）成功才算获锁。批评点：① 时钟跳跃——如果某节点的系统时钟被 NTP 调快，锁会提前过期，多个客户端同时"以为"自己持锁；② GC 停顿——客户端 STW 停顿期间锁过期，恢复后误以为自己还持锁。Antirez（Redis 作者）反驳说合理配置下这些概率极低。我的实践：不追求 RedLock 的"完美正确性"，而是把 RedLock 作为"降低单点故障概率"的手段（单 Redis 故障概率 > RedLock 多数派故障概率），终极防线用 DB 乐观锁（version 字段）。金融级强一致用 ZK/etcd，业务级用 RedLock + DB 兜底。

**Q：为什么不直接用 Zookeeper 做分布式锁，它强一致（ZAB 协议），不用纠结 RedLock 的争议？**

因为性能和复杂度。ZK 的锁基于 ZAB（顺序一致性 + 多数派写入），加锁要创建临时节点 + 监听前序节点，RTT 几次，耗时 10-50ms（Redis SET NX 约 1ms）。高并发流程引擎（QPS 千级）下，ZK 锁的延迟显著。而且 ZK 集群运维复杂（Leader 选举、session 管理、watch 优化）。Redis 锁快但"不够强一致"，ZK 锁强一致但慢。流程引擎的状态一致性要求是"业务级"（不是金融级），Redis 锁 + DB 乐观锁兜底够用。只有"绝对不能并发"的场景（如资金扣减）才用 ZK。权衡性能 vs 一致性强度，流程引擎选 Redis。

### 第五层：验证与沉淀

**Q：你怎么证明分布式锁方案在故障下仍然保证状态一致？**

混沌演练：
1. Redis 故障——主动 kill Redis 进程，验证流程引擎降级到 DB 乐观锁，不产生并发修改。
2. 持锁线程崩溃——模拟应用 OOM 重启，验证锁在 TTL 后自动释放（或看门狗停止续期后释放），流程不永久卡死。
3. 网络分区——Redis Cluster 分区时，验证不会有两个客户端同时获锁（RedLock 多数派机制）。

**Q：分布式锁方案怎么沉淀？**

1. 锁 SDK——封装"Redis SET NX + 看门狗 + RedLock + Lua 解锁"成通用组件，业务用 `lock.tryLock(key, supplier)` 一行搞定。
2. 乐观锁规范——所有状态更新 SQL 必须带 `WHERE version = ?`，作为分布式锁失效的终极防线，Code Review 检查。
3. 事件溯源——流程引擎的状态变更全部记入事件日志（append-only），即使锁失效导致状态错乱，也能从事件流回溯正确状态。


## 结构化回答

**30 秒电梯演讲：** 分布式流程引擎的状态一致性需要分布式锁+状态机+事件溯源保证；Redis锁需要考虑单点故障，用RedLock或ZK兜底。

**展开框架：**
1. **加解锁基石** — 加锁用SET NX PX防死锁，解锁必须用Lua脚本保证“判断+删除”原子性
2. **锁粒度** — 锁ID设计为“业务域+实体ID+操作类型”，因为细粒度控制能避免不同操作互相竞争
3. **高可用兜底** — 纯Redis不安全，所以用RedLock过半节点成功机制来防单点故障

**收尾：** 这块我踩过坑——要不要深入聊：RedLock算法的争议点是什么？

## 视频脚本

> 预计时长：3 分钟 | 由浅入深

| 时间 | 画面/字幕 | 口播台词 | 讲解要点 |
|------|----------|----------|----------|
| 0:00 | 标题卡 | "分布式锁一句话：分布式流程引擎的状态一致性需要分布式锁+状态机+事件溯源保证；Redis锁需要考虑单点故障…。" | 开场钩子 |
| 0:15 | Redis Lua 脚本执行截图 | "加解锁基石：加锁用SET NX PX防死锁，解锁必须用Lua脚本保证“判断+删除”原子性" | 加解锁基石 |
| 1:06 | Redis Lua 脚本执行截图分步演示 | "锁粒度：锁ID设计为“业务域+实体ID+操作类型”，因为细粒度控制能避免不同操作互相竞争" | 锁粒度 |
| 1:57 | 关键代码/伪代码片段 | "高可用兜底：纯Redis不安全，所以用RedLock过半节点成功机制来防单点故障" | 高可用兜底 |
| 2:50 | 总结卡 | "核心抓住这条主线，下期咱们接着聊：RedLock算法的争议点是什么。" | 收尾 |
