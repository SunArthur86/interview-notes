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
  essence: "分布式流程引擎的状态一致性需要分布式锁+状态机+事件溯源保证；Redis锁需要考虑单点故障，用RedLock或ZK兜底"
  analogy: "像多人协作编辑同一份文档——必须有人拿编辑锁才能改(分布式锁)，改之前确认版本号(状态机)，改完通知所有人(事件通知)，编辑工具挂了要有备用方案(兜底)"
  first_principle: "分布式一致性的核心是操作互斥性(锁) + 状态可恢复性(持久化) + 故障容错(兜底)"
  key_points:
    - '分布式锁: Redis SETNX + 过期时间 + 唯一token'
    - '锁ID设计: 业务前缀+实体ID+操作类型，防误删'
    - 'Redis故障兜底: RedLock/ZK/数据库乐观锁'
    - '事件不丢失: WAL(预写日志)+ACK确认+重试'
    - '顺序性: 分区key路由+单消费者+幂等'
first_principle:
  essence: "分布式系统没有完美的锁，只有适合场景的锁"
  derivation: "单机用mutex → 多机需要分布式锁 → Redis快但可能挂 → 需要兜底 → ZK强一致但慢 → 数据库乐观锁简单但吞吐低 → 根据业务SLA选择"
  conclusion: "核心链路用Redis+RedLock双保险，非核心用数据库乐观锁"
follow_up:
  - "RedLock算法的争议点是什么？"
  - "Redis Cluster下分布式锁有什么坑？"
  - "消息顺序消费怎么保证？"
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
