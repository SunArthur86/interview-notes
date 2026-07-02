---
id: note-ks-002
difficulty: L3
category: system-design
subcategory: 缓存
tags:
- 快手
- Java开发
- 一面
- 场景题
- Redis
- 缓存击穿
- Caffeine
- 面经
feynman:
  essence: 缓存击穿是热点Key突然失效，大量请求直接打到数据库。除了互斥锁外，三级防御：(1)本地缓存(Caffeine)设短TTL做第一层拦截；(2)Redis逻辑过期(不设TTL，后台异步刷新)；(3)热点Key探测+主动预热。
  analogy: "缓存就像超市的促销商品货架。缓存击穿=特价商品卖完了(缓存失效)，所有顾客都涌向仓库(数据库)抢货。防御：(1)在货架旁放个小推车备货(Caffeine本地缓存)；(2)让理货员在后台悄悄补货(逻辑过期+异步刷新)；(3)提前预测哪些商品会火，提前备足(热点探测+预热)。"
  key_points:
  - 缓存击穿=单个热点Key失效导致大量请求穿透到DB
  - 互斥锁方案：只让一个线程查DB重建缓存，其他等待（已有方案）
  - 一级防御：Caffeine本地缓存，短TTL，挡住大部分瞬时请求
  - 二级防御：Redis逻辑过期——不设TTL，后台异步刷新，永不过期
  - 核弹方案：Flink实时热点探测 + 主动预热
first_principle:
  essence: 缓存击穿防御 = 减少到达DB的并发请求数 × 缩短缓存重建窗口
  derivation: "热点Key失效瞬间 → N个线程同时请求DB → DB压力突增 → 雪崩。防御原理：(1)多级缓存(Caffeine+Redis)减少到达DB的请求数；(2)逻辑过期+异步刷新缩短/消除重建窗口；(3)互斥锁限制只有一个线程重建。"
  conclusion: 多级缓存 + 逻辑过期是最优解——零停机、无锁竞争、用户无感知
follow_up:
- 缓存击穿、缓存穿透、缓存雪崩三者的区别和各自防御方案？
- Caffeine的W-TinyLFU淘汰算法有什么优势？
- 逻辑过期方案中如何保证异步刷新的线程安全？
- 如何识别热点Key？有哪些热点探测方案？
- Redis集群中热点Key如何做负载均衡？
memory_points:
- 缓存击穿=单Key失效→DB被打穿；缓存雪崩=大量Key同时失效；缓存穿透=查不存在的Key
- 三级防御：Caffeine本地缓存(短TTL拦截)→Redis逻辑过期(不设TTL异步刷新)→热点探测+预热
- 逻辑过期核心：缓存值中存expireTime字段，逻辑判断过期后返回旧值+异步刷新(用户无感)
- 互斥锁是基础方案，逻辑过期是进阶方案(无锁等待、用户体验更好)
---

# 【快手Java一面】热点Key突然失效，数据库被打到限流，除了互斥锁还有什么方案？

> 来源：快手Java开发一面场景题复盘（小红书）

## 一、缓存击穿 vs 穿透 vs 雪崩

```
区分三种缓存异常：

  缓存击穿（本题）          缓存穿透             缓存雪崩
  ┌────────────┐         ┌────────────┐      ┌────────────┐
  │   1个热点Key │         │ 不存在的Key │      │ 大量Key同时 │
  │   突然失效   │         │ 每次都查不到 │      │   失效      │
  │      ↓      │         │      ↓      │      │      ↓      │
  │  大量请求    │         │  每次请求都  │      │  请求洪流   │
  │  打到DB     │         │  打到DB     │      │  打到DB     │
  └────────────┘         └────────────┘      └────────────┘
  热点Key TTL到期          恶意攻击/BUG        批量设置相同TTL
```

## 二、多级防御策略

```
                     用户请求
                        │
                        ▼
              ┌──────────────────┐
              │ 一级防御：Caffeine │  ← 本地缓存，短TTL
              │    (本地缓存)     │     挡住80%的瞬时请求
              └────────┬─────────┘
                  Miss │
                        ▼
              ┌──────────────────┐
              │ 二级防御：Redis   │  ← 逻辑过期(不设TTL)
              │    逻辑过期       │     后台异步刷新
              └────────┬─────────┘
                  Miss │
                        ▼
              ┌──────────────────┐
              │ 核弹方案：热点探测 │  ← Flink实时监控
              │    + 主动预热     │     提前刷新热Key
              └──────────────────┘
```

### 一级防御：Caffeine 本地缓存

```java
// Caffeine本地缓存，作为Redis的前置防线
Cache<String, Product> localCache = Caffeine.newBuilder()
    .maximumSize(10_000)
    .expireAfterWrite(3, TimeUnit.SECONDS)  // 短TTL：3秒
    .build();

public Product getProduct(String key) {
    // 1. 先查本地缓存（纳秒级响应）
    Product product = localCache.getIfPresent(key);
    if (product != null) {
        return product;  // 80%请求在这里返回
    }

    // 2. 本地缓存Miss → 查Redis
    product = getFromRedis(key);
    if (product != null) {
        localCache.put(key, product);
        return product;
    }

    // 3. Redis也Miss → 查DB（加互斥锁）
    return getFromDBWithLock(key);
}

// 为什么Caffeine能防击穿？
// 假设10000个请求同时来：
// - 没有Caffeine：10000个请求同时打到Redis→Redis Miss→打到DB
// - 有Caffeine：第1个请求miss→查Redis→填充Caffeine
//   剩余9999个请求在3秒TTL内全部命中Caffeine→不打DB！
```

### 二级防御：Redis 逻辑过期

```
传统方案（物理过期）：
  Redis Key设TTL=30分钟 → 到期自动删除 → 下一个请求发现Miss → 查DB

逻辑过期方案（永不过期）：
  Redis Key不设TTL（永久存在），但在Value中存一个逻辑过期时间

  ┌─────────────────────────────────────────┐
  │ Redis Value (JSON):                     │
  │ {                                       │
  │   "data": {商品数据},                    │
  │   "expireTime": 1700000000000  ← 逻辑过期│
  │ }                                       │
  └─────────────────────────────────────────┘
```

```java
// 逻辑过期方案实现
public Product getProductWithLogicalExpire(String key) {
    String json = redis.get(key);  // Redis Key不设TTL，永不过期
    if (json == null) {
        // 正常情况不会走到这里（Key永不物理过期）
        return getFromDBWithLock(key);
    }

    CacheData cacheData = JSON.parseObject(json, CacheData.class);

    // 判断是否逻辑过期
    if (cacheData.getExpireTime().after(new Date())) {
        // 未过期 → 直接返回
        return cacheData.getData();
    }

    // 已过期 → 返回旧数据 + 异步刷新
    CACHE_REFRESH_POOL.submit(() -> {
        // 只让一个线程刷新（用Redis SETNX做分布式锁）
        if (redis.setnx(key + ":lock", "1", 10)) {
            try {
                Product fresh = getFromDB(key);
                CacheData newData = new CacheData(fresh, nextExpireTime());
                redis.set(key, JSON.toJSONString(newData));
            } finally {
                redis.del(key + ":lock");
            }
        }
    });

    // 返回旧数据（用户无感知！）
    return cacheData.getData();
}

// 逻辑过期的优势：
// 1. 用户永远不会等待DB查询（总是返回缓存数据）
// 2. 没有锁等待（旧数据直接返回）
// 3. 数据短暂不一致（几秒延迟），但用户体验最好
// 4. 永远不会缓存击穿（Key不会物理失效）
```

### 核弹方案：热点Key探测 + 主动预热

```
基于Flink的热点Key实时探测：

  Redis访问日志 → Flink实时统计 → 识别热点Key → 主动刷新

  ┌────────────────────────────────────────────┐
  │ Flink 实时热点探测                           │
  │                                            │
  │ 窗口：每10秒统计一次                          │
  │ 阈值：QPS > 1000 的Key标记为热点              │
  │                                            │
  │ 热点Key列表：                                │
  │   product:10086    QPS=5000  ← 热点         │
  │   product:10087    QPS=3000  ← 热点         │
  │   product:10088    QPS=50    ← 普通         │
  └──────────────────┬─────────────────────────┘
                     │
                     ▼
  ┌────────────────────────────────────────────┐
  │ 主动预热                                     │
  │                                            │
  │ 对热点Key：                                  │
  │ 1. 提前刷新（在TTL到期前刷新）                │
  │ 2. 延长TTL（从30分钟延长到2小时）             │
  │ 3. 推送到所有节点的本地缓存                   │
  └────────────────────────────────────────────┘
```

## 三、方案对比

| 方案 | 原理 | 优点 | 缺点 | 适用场景 |
|------|------|------|------|---------|
| **互斥锁** | 只让一个线程查DB | 数据强一致 | 有锁等待延迟 | 低并发场景 |
| **Caffeine本地缓存** | 短TTL本地拦截 | 极快(纳秒级) | 各节点数据不一致 | 第一道防线 |
| **逻辑过期** | 永不物理过期，异步刷新 | 用户无感知 | 短暂数据不一致 | 高并发热点Key |
| **热点探测** | 提前预知热Key并刷新 | 从根本解决 | 实现复杂 | 超大流量场景 |

## 四、面试加分点

1. **提到缓存预热**：系统启动/大促前，主动将热点数据加载到缓存，避免冷启动击穿
2. **提到Redis集群热点Key**：单Key只能存在一个分片上，超热Key可以做"Key分片"（key:1, key:2...分散到多个分片）
3. **提到布隆过滤器**：对于缓存穿透（查不存在的Key），用布隆过滤器挡住
4. **提到数据一致性**：逻辑过期方案牺牲了短暂一致性换取可用性，面试中能讨论CAP权衡是加分项
5. **提到监控告警**：Redis的bigkey/hotkey监控，提前发现潜在热点Key
