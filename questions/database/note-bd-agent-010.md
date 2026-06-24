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
  analogy: '裸SetNX像用绳子拴门——绳子的长度(过期时间)不好定、没人在门外帮你续绳子(无续期)、别人可能误拆你的绳(误删)'
  first_principle: '分布式锁的安全要求：只有持有者能释放 + 持有期间锁不会过期 + 锁不会永远不释放'
  key_points:
    - 过期时间难定——业务执行时间不确定
    - 没有自动续期——业务慢则锁过期被他人获取
    - 误删他人锁风险——不加校验直接DEL
    - 不可重入——同线程不能多次获取
first_principle:
  essence: 分布式锁需要同时满足互斥性、安全性和防死锁三个约束
  derivation: 'SetNX只满足了互斥性(NX保证)→缺乏安全性(无owner校验)→缺乏防死锁(EX过期但业务没完)→Redisson补全了这些'
  conclusion: 裸SetNX是分布式锁的最简陋实现，生产环境必须用Redisson或自己补全安全措施
follow_up:
  - 'RedLock算法解决了什么问题？'
  - 'Redis主从切换时锁会丢失吗？'
  - 'ZooKeeper分布式锁和Redis锁的区别？'
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
