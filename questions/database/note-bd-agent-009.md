---
id: note-bd-agent-009
difficulty: L2
category: database
subcategory: Redis
tags:
- 字节
- 面经
- Redis
- 分布式锁
feynman:
  essence: 长链路用Redisson(自动续期)，短耗时用SetNX(轻量快速)，锁粒度按orderId/groupId控制
  analogy: 长链路操作像装修(需要好几天)要签正式合同(Redisson+续期)，短操作像借充电宝(几分钟)扫码即用(SetNX)
  first_principle: 分布式锁的本质是在分布式系统中实现互斥访问，核心要求是原子性获取+安全释放+超时自动释放
  key_points:
  - Redisson适合长链路场景（有watchdog自动续期）
  - SetNX适合短耗时场景（性能轻量）
  - 锁粒度按orderId或groupId控制
  - 不同场景选不同方案
first_principle:
  essence: 分布式锁需要解决三个基本问题——获取原子性、释放安全性、持有超时保护
  derivation: 多节点竞争同一资源→需要互斥→获取必须原子→释放必须校验owner→超时必须自动释放防止死锁
  conclusion: 分布式锁 = 原子获取 + 安全释放 + 超时保护 + (可选)自动续期
follow_up:
- Redisson的watchdog机制是怎么实现的？
- RedLock算法了解吗？有什么争议？
- 锁粒度怎么设计才能兼顾安全和性能？
memory_points:
- 核心结论：长链路用Redisson+watchdog（支付结算），短耗时用SetNX+过期时间（库存限流）
- 对比记忆：Redisson内置自动续期、可重入、安全释放，而SetNX轻量但需手动写Lua防误删
- 关键数字：watchdog底层机制是每10秒自动续期，把过期时间重置为30秒
- 一句话原则：锁粒度按业务实体设计（如订单ID），不同实体不互斥，坚决避免全局锁
---

# Redis里的分布式锁你们具体用了什么方案？

## 方案选型矩阵

```
                场景特点
                │
    ┌───────────┴───────────┐
    │                       │
长链路操作               短耗时操作
(秒~分钟级)              (毫秒~秒级)
    │                       │
    ▼                       ▼
 Redisson               SetNX
+ watchdog              + 过期时间
(自动续期)              (轻量快速)
    │                       │
    ▼                       ▼
支付回调                 库存预占
拼团结算                 限流计数
订单处理                 
```

## Redisson方案（长链路）

```java
// Java Redisson分布式锁
RLock lock = redissonClient.getLock("lock:order:" + orderId);

try {
    // 尝试加锁，最多等待5秒，锁自动续期
    boolean acquired = lock.tryLock(5, TimeUnit.SECONDS);
    
    if (acquired) {
        // 执行业务逻辑（可能耗时较长）
        processPayment(orderId);
    }
} finally {
    if (lock.isHeldByCurrentThread()) {
        lock.unlock();
    }
}
```

**Redisson核心优势**：

| 特性 | 说明 | 原理 |
|------|------|------|
| **自动续期** | 业务没执行完锁不会过期 | watchdog后台线程每10s续期到30s |
| **可重入** | 同一线程可多次获取同一把锁 | Hash结构记录threadId+重入次数 |
| **等待机制** | 获取失败可排队等待 | 基于Pub/Sub通知 + 信号量 |
| **安全释放** | 只有线程持有者才能释放 | Lua脚本校验UUID+threadId |

```
watchdog续期机制：

时间轴 ──────────────────────────────────→
加锁     10s    20s    30s    40s
  │      │      │      │      │
  ▼      ▼      ▼      ▼      ▼
T=0s   续期30s  续期30s  续期30s  业务完成→unlock
锁=30s  锁=30s  锁=30s  锁=30s
  
如果JVM崩溃 → watchdog停止 → 锁30s后自动释放
```

## SetNX方案（短耗时）

```python
import uuid

def setnx_lock(resource, expire_seconds=10):
    """简单SetNX分布式锁"""
    lock_value = str(uuid.uuid4())
    lock_key = f"lock:{resource}"
    
    # SET key value NX EX seconds（原子操作）
    acquired = redis.set(lock_key, lock_value, 
                         nx=True, ex=expire_seconds)
    
    if acquired:
        return lock_value  # 返回锁标识用于安全释放
    return None  # 获取失败

def setnx_unlock(resource, lock_value):
    """安全释放：Lua脚本校验value后再删除"""
    script = """
    if redis.call('GET', KEYS[1]) == ARGV[1] then
        return redis.call('DEL', KEYS[1])
    else
        return 0  -- 锁已被其他人获取，不能删
    end
    """
    return redis.eval(script, 1, f"lock:{resource}", lock_value)
```

## 锁粒度设计

```python
# ❌ 粒度太粗：所有拼团共用一把锁 → 性能瓶颈
lock_key = "lock:group_buy"

# ✅ 粒度合适：每个团独立锁 → 并行处理不同团
lock_key = f"lock:group:{group_id}"

# ✅ 订单级别锁：每个订单独立
lock_key = f"lock:order:{order_id}"

# ❌ 粒度太细：每个用户每个操作一把锁 → 锁管理复杂
lock_key = f"lock:user:{user_id}:action:buy:item:{item_id}"
```

**锁粒度原则**：
- 按业务实体分锁（orderId、groupId、itemId）
- 不同实体之间不互斥，相同实体才互斥
- 避免全局锁（除非是全局限流）

## 实际业务中的应用

| 场景 | 方案 | 锁Key | TTL |
|------|------|-------|-----|
| 拼团结算 | Redisson | `lock:settle:{groupId}` | watchdog续期 |
| 支付回调 | Redisson | `lock:pay:{orderId}` | watchdog续期 |
| 库存预占 | SetNX | `lock:stock:{itemId}` | 10s |
| 防重复提交 | SetNX | `lock:submit:{userId}:{api}` | 5s |

## 面试加分点

1. **场景化选型**：不是一刀切用某个方案，而是根据业务特点选择
2. **理解watchdog**：能解释续期机制和JVM崩溃时的自动释放
3. **锁粒度设计**：提到按orderId/groupId控制，体现并发优化意识
4. **安全释放**：强调Lua脚本校验value，避免误删他人锁

## 记忆要点

- 核心结论：长链路用Redisson+watchdog（支付结算），短耗时用SetNX+过期时间（库存限流）
- 对比记忆：Redisson内置自动续期、可重入、安全释放，而SetNX轻量但需手动写Lua防误删
- 关键数字：watchdog底层机制是每10秒自动续期，把过期时间重置为30秒
- 一句话原则：锁粒度按业务实体设计（如订单ID），不同实体不互斥，坚决避免全局锁

