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


## 苏格拉底式面试追问

> 这组追问模拟面试官层层逼问，每一问先回答"为什么"，再回答"怎么做"，最后回答"如何证明"。

### 第一层：目标与动机

**Q：你的分布式锁按业务实体设计粒度（如订单 ID），而不是用全局锁，为什么？粒度细化的代价是什么？**

全局锁意味着所有请求争抢同一把锁，QPS 上万时锁等待成为瓶颈——10 万 QPS 下，单把锁即使每次持有 1ms，理论上限也只有 1000 QPS，其余 9.9 万请求全排队超时。按订单 ID 分锁后，不同订单互不阻塞，并发度提升到订单数级别。代价是"锁数量爆炸"——千万订单就是千万个 key，Redis 内存占用上升（每个 key 虽小但总量可观），且锁管理复杂（监控、清理过期锁）。权衡：粒度细化换取并发度，但要控制 key 总量。常见做法是"按热点维度分片"——如按用户 ID 分 1000 个锁分片，同一用户的请求串行、不同用户并行，既控制 key 数又保证并发。

### 第二层：证据与定位

**Q：线上 Redisson 锁突然大面积超时，你怎么确认是锁本身的问题还是业务执行变慢？**

看两个指标交叉判断：一、Redis 的 `SLOWLOG` 和锁 key 的 TTL 变化——如果锁 key 长期存在不释放（TTL 一直被续期），说明持有锁的线程业务执行变慢（GC、DB 慢查询等），不是锁机制问题；二、APM trace 看持有锁的线程在干什么——如果业务逻辑耗时正常但锁等待时间长，可能是锁竞争激烈（热点 key），如果业务逻辑本身耗时长，是业务问题不是锁问题。具体命令：`redis-cli CLIENT LIST` 看连接数、`INFO Stats` 看 evicted_keys（锁 key 被驱逐说明内存压力），结合应用日志的"加锁耗时/业务耗时/释放耗时"分解，能定位瓶颈在锁机制、锁竞争还是业务执行。

### 第三层：根因深挖

**Q：Redisson 的 watchdog 每 10 秒续期一次把 TTL 重置为 30 秒，如果续期线程挂了会怎样？**

续期失败后锁会在 30 秒后过期释放，期间其他线程可以抢到锁。这是"安全优于活性"的设计——续期失败（如应用线程池满、GC 长停顿、Redis 网络中断）时，宁可让锁过期（活性损失，业务要重试）也不能让锁永久持有（安全性损失，死锁）。具体机制：watchdog 是一个定时任务（Netty 的 HashedWheelTimer），如果业务线程被 kill 或应用崩溃，定时任务随之停止，锁自然过期；如果是 Redis 暂时不可达，续期请求失败，锁也会在 30 秒后过期。所以 watchdog 的可靠性建立在"Redis 可达 + 应用存活"两个前提上，不保证 100% 续期成功，但保证不会死锁。

**Q：那为什么 watchdog 默认续期间隔是 10 秒（TTL 的 1/3），不是 1 秒或 29 秒？**

1/3 是经验值，平衡"续期频率"和"失败容错"。间隔 1 秒太频繁——大量续期请求打 Redis，且 watchdog 线程频繁调度，开销大；间隔 29 秒太冒险——一旦某次续期失败（网络抖动），剩余 1 秒内来不及重试，锁就过期了。10 秒间隔意味着每次续期失败后还有 2 次重试机会（第 10 秒失败、第 20 秒重试、第 30 秒前还有机会），容错性好。这个 1/3 规则也用于其他自动续期场景（如 HTTP session 续期、租约续期）。Redisson 源码里 `lockWatchdogTimeout` 默认 30 秒，续期间隔是 `timeout/3 = 10 秒`，可配置但不建议改。

### 第四层：方案权衡

**Q：长链路用 Redisson + watchdog，短耗时用 SetNX，但如果短耗时操作偶尔变长（如 GC 停顿），SetNX 锁过期了怎么办？**

两种应对：一、接受偶发过期——如果是低频且业务可容忍（如限流场景偶尔多放过几个请求），不处理，记录日志观察；二、升级为 Redisson——如果业务对锁可靠性敏感（如不能多扣库存），直接用 Redisson watchdog，不依赖"业务耗时稳定"这个假设。工程上我倾向于"统一用 Redisson"——它的开销比 SetNX 大不了多少（多一个续期线程），但避免了"估错过期时间"的所有坑。SetNX 只在"不能引入 Redisson 依赖（如轻量级脚本）"或"业务明确是毫秒级且可容忍偶发失效"时用。所以"短耗时用 SetNX"是个简化方案，不是首选。

**Q：为什么不用 Redlock（Redlock 算法）？它不是解决了 Redis 主从切换丢锁的问题吗？**

Redlock 在多个独立 Redis 实例（通常 5 个）上加锁，多数成功才算加锁成功，对抗单点 Redis 主从切换时锁丢失。但有两个争议：一、Martin Kleppmann 等人批评 Redlock 在时钟漂移、GC 停顿等场景仍有正确性问题，不是严格的分布式锁；二、部署成本高——5 个独立 Redis 集群运维复杂。对大多数业务，单 Redis + Redisson 的可靠性已足够（主从切换概率低，且业务能容忍偶发失效）。只有金融级"绝对不能多持锁"场景才考虑 Redlock 或 ZK。我的业务（拼团、支付）用 Redisson 单实例，接受主从切换时偶发失效（概率 < 0.01%），用业务幂等性兜底（重复请求不产生副作用）。这是工程取舍，不是追求理论绝对正确。

### 第五层：验证与沉淀

**Q：你怎么验证 Redisson 锁的 watchdog 续期在长时间业务下真的 work？**

专门写一个压测：加锁后让业务 sleep 5 分钟（远超 30 秒 TTL），期间用另一个线程轮询 `TTL lock_key`，应该看到 TTL 在 30→20→10→30 之间循环（每 10 秒被续期回 30），如果 TTL 跌到 0 说明续期失败。再加故障注入：在续期时 `DEBUG SETPACKET` 模拟 Redis 网络延迟、kill 续期线程，观察锁是否在 30 秒后正确释放（不死锁）。线上监控：锁 key 的平均存活时间、续期失败次数（Redisson 暴露的指标），续期失败率 > 0.1% 告警。这些验证确保 watchdog 在异常场景下不会导致死锁或误释放。

**Q：这道题做完，你沉淀出了什么可复用的分布式锁选型经验？**

选型决策树：一、业务耗时 < 100ms 且可容忍偶发失效 → SetNX（轻量）；二、业务耗时不确定或需可靠续期 → Redisson + watchdog（默认首选）；三、金融级强一致不能多持锁 → Redlock 或 ZK（成本高）；四、所有场景都要业务幂等性兜底——锁只是减少并发，不是绝对保证，业务侧用幂等 key（如订单号）保证重复执行无副作用。这个决策树的核心思想是"分层防御"——锁挡住 99% 的并发，幂等兜底剩下 1% 的异常。单纯依赖锁的可靠性是危险的，业务幂等才是终极防线。


## 结构化回答

**30 秒电梯演讲：** 长链路用Redisson(自动续期)，短耗时用SetNX(轻量快速)，锁粒度按orderId/groupId控制。打个比方，长链路操作像装修(需要好几天)要签正式合同(Redisson+续期)，短操作像借充电宝(几分钟)扫码即用(SetNX)。

**展开框架：**
1. **核心结论** — 长链路用Redisson+watchdog（支付结算），短耗时用SetNX+过期时间（库存限流）
2. **对比记忆** — Redisson内置自动续期、可重入、安全释放，而SetNX轻量但需手动写Lua防误删
3. **关键数字** — watchdog底层机制是每10秒自动续期，把过期时间重置为30秒

**收尾：** 这块我踩过坑——要不要深入聊：Redisson的watchdog机制是怎么实现的？

## 视频脚本

> 预计时长：2 分钟 | 由浅入深

| 时间 | 画面/字幕 | 口播台词 | 讲解要点 |
|------|----------|----------|----------|
| 0:00 | 标题卡 | "Redis一句话：长链路用Redisson(自动续期)，短耗时用SetNX(轻量快速)，锁粒度按orderId/g…。" | 开场钩子 |
| 0:15 | Redis Lua 脚本执行截图 | "核心结论：长链路用Redisson+watchdog（支付结算），短耗时用SetNX+过期时间（库存限流）" | 核心结论 |
| 1:02 | Redis Lua 脚本执行截图分步演示 | "对比记忆：Redisson内置自动续期、可重入、安全释放，而SetNX轻量但需手动写Lua防误删" | 对比记忆 |
| 1:50 | 总结卡 | "核心抓住这条主线，下期咱们接着聊：Redisson的watchdog机制是怎么实现的。" | 收尾 |
