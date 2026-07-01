---
id: note-mt2-002
difficulty: L3
category: java
subcategory: 并发编程
tags:
- 美团
- 面经
- 线程池
- 监控
feynman:
  essence: 线程池监控防血崩的核心是暴露队列积压、活跃线程、拒绝次数三个指标，设置预警阈值和自动降级机制
  analogy: 像医院ICU监控——心跳(活跃线程)、床位(队列容量)、拒诊率(拒绝策略)，一旦指标异常就自动报警+启动应急方案
  first_principle: 线程池的血崩源于队列积压→内存OOM，或线程阻塞→全部线程卡死，必须监控+自动干预
  key_points:
  - '三大监控指标: 队列积压、活跃线程比、拒绝次数'
  - '血崩场景: 所有线程被慢调用阻塞 → 新请求全进队列 → OOM'
  - '防护: 熔断(隔离慢调用) + 超时(快速失败) + 背压(CallerRuns)'
  - 'CompletableFuture: 注意默认用ForkJoinPool.commonPool()'
first_principle:
  essence: 线程池的血崩本质是资源耗尽(线程/内存)的级联失败
  derivation: 慢调用占满线程 → 新请求排队 → 队列满 → OOM或拒绝 → 上游重试 → 更多请求 → 级联崩溃 → 需要熔断+超时+隔离
  conclusion: 防血崩 = 监控发现 + 熔断隔离 + 快速失败
follow_up:
- CompletableFuture默认线程池有什么坑？
- 线程池满了和熔断器打开有什么区别？
- 怎么实现线程池的动态参数调整？
memory_points:
- 监控血崩：核心盯队列积压、活跃率与拒绝次数，队列达80%立即告警防雪崩
- 隔离避免坑：CompletableFuture默认用commonPool，严禁混用，必须传独立线程池
- 超时防慢调用：慢任务会占满线程池，必须用orTimeout设超时与熔断隔离
- 背压兜底：核心采用小队列快速暴露问题，配合CallerRuns让主线程自我限流
---

# 用 Future/线程池做并发，怎么监控线程池状态？怎么防止血崩？

## 线程池监控指标

```java
// 定时采集线程池核心指标
@Scheduled(fixedRate = 5000)
public void monitor() {
    ThreadPoolExecutor pool = (ThreadPoolExecutor) executor;

    // 1. 队列积压 — 血崩前兆!
    int queueSize = pool.getQueue().size();
    int queueCapacity = QUEUE_CAPACITY;

    // 2. 活跃线程比 — 是否满载
    int activeCount = pool.getActiveCount();
    int maxPoolSize = pool.getMaximumPoolSize();

    // 3. 拒绝次数 — 体验影响
    long rejectedCount = rejectedCounter.get();

    // 4. 任务完成时间 — 慢任务检测
    long avgTaskTime = totalTaskTime.get() / completedTasks.get();

    // 上报
    metrics.gauge("tp.queue.size", queueSize);
    metrics.gauge("tp.queue.usage", queueSize * 1.0 / queueCapacity);
    metrics.gauge("tp.active.ratio", activeCount * 1.0 / maxPoolSize);
    metrics.counter("tp.rejected.count").increment(rejectedCount);

    // 告警判断
    if (queueSize > queueCapacity * 0.8) {
        alert("线程池队列积压 >80%: " + queueSize);
    }
    if (avgTaskTime > 5000) {
        alert("线程池平均任务耗时 >5s: " + avgTaskTime);
    }
}
```

## 血崩场景与防护

### 场景1: 慢调用占满线程池

```
正常情况:
  Thread1: [fast 50ms] [fast 50ms] [fast 50ms] ...
  Thread2: [fast 50ms] [fast 50ms] [fast 50ms] ...

血崩:
  Thread1: [slow 30s ███████████████]
  Thread2: [slow 30s ███████████████]
  Thread3: [slow 30s ███████████████]
  ...
  Thread8: [slow 30s ███████████████]
  队列: [task][task][task]...[task] → OOM!

防护:
  1. 每个任务设置超时
  2. 调用外部服务用独立线程池(隔离)
  3. 慢调用比例 >50% → 触发熔断
```

### 场景2: CompletableFuture 默认线程池陷阱

```java
// ❌ 危险! CompletableFuture默认使用ForkJoinPool.commonPool()
CompletableFuture.supplyAsync(() -> callRemoteApi()) // 慢调用!
    .thenAccept(result -> process(result));

// ForkJoinPool.commonPool() 线程数 = CPU核数-1
// 如果有多个慢调用 → commonPool全部占满 → 所有CompletableFuture卡死
// → 影响整个JVM中所有使用commonPool的地方!

// ✅ 正确: 使用独立线程池
ExecutorService myPool = Executors.newFixedThreadPool(8);

CompletableFuture.supplyAsync(() -> callRemoteApi(), myPool) // 指定线程池!
    .orTimeout(5, TimeUnit.SECONDS) // 设置超时!
    .thenAcceptAsync(result -> process(result), myPool);
```

## 完整防护方案

```java
// 1. 线程池隔离
ExecutorService corePool = new ThreadPoolExecutor(
    8, 8, 0, TimeUnit.SECONDS,
    new ArrayBlockingQueue<>(200),
    new ThreadFactoryBuilder().setNameFormat("core-%d").build(),
    new ThreadPoolExecutor.CallerRunsPolicy() // 背压
);

ExecutorService externalCallPool = new ThreadPoolExecutor(
    4, 4, 0, TimeUnit.SECONDS,
    new ArrayBlockingQueue<>(50),  // 小队列快速暴露问题
    new ThreadFactoryBuilder().setNameFormat("ext-%d").build(),
    new ThreadPoolExecutor.AbortPolicy() // 快速失败+告警
);

// 2. 熔断器 (Resilience4j)
CircuitBreaker circuitBreaker = CircuitBreaker.ofDefaults("externalApi");
circuitBreaker.getEventPublisher()
    .onStateTransition(e -> alert("熔断器状态变更: " + e));

// 3. 超时控制
CompletableFuture.supplyAsync(() -> {
    return circuitBreaker.executeSupplier(() ->
        callExternalApi()
    );
}, externalCallPool)
.orTimeout(3, TimeUnit.SECONDS) // 整体超时
.exceptionally(ex -> {
    log.error("调用失败，降级", ex);
    return defaultValue; // 降级
});
```

## 监控仪表盘设计

```
┌──────────────────────────────────────────────────┐
│              线程池监控面板                       │
├──────────────────────────────────────────────────┤
│                                                  │
│  core-pool:                                      │
│  ████████░░ Active: 8/10  Queue: 45/200         │
│  ⚠️ Avg Task Time: 2.3s  ✅ Rejected: 0         │
│                                                  │
│  external-call-pool:                             │
│  ████░░░░░░ Active: 4/4   Queue: 48/50 ⚠️       │
│  ⚠️ Avg Task Time: 8.5s  ⚠️ Rejected: 23        │
│  🔴 Circuit Breaker: OPEN                        │
│                                                  │
│  告警阈值:                                       │
│  - Queue usage > 80% → P2                        │
│  - Queue usage > 95% → P1                        │
│  - Avg task time > 5s → P2                       │
│  - Rejected count > 10/min → P2                  │
│  - All threads busy > 30s → P0 血崩预警          │
│                                                  │
└──────────────────────────────────────────────────┘
```

## 记忆要点

- 监控血崩：核心盯队列积压、活跃率与拒绝次数，队列达80%立即告警防雪崩
- 隔离避免坑：CompletableFuture默认用commonPool，严禁混用，必须传独立线程池
- 超时防慢调用：慢任务会占满线程池，必须用orTimeout设超时与熔断隔离
- 背压兜底：核心采用小队列快速暴露问题，配合CallerRuns让主线程自我限流

