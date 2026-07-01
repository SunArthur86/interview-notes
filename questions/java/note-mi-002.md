---
id: note-mi-002
difficulty: L3
category: java
subcategory: 并发编程
tags:
- 小米
- 面经
- 线程池
- Java
feynman:
  essence: 线程池不是背公式配置参数，而是根据业务场景( CPU密集/IO密集)选核心线程数、队列类型和拒绝策略，核心是防止OOM和保证关键链路不被拖垮
  analogy: 线程池像餐厅后厨——核心线程是常驻厨师，队列是等单架，最大线程是高峰临时工，拒绝策略是客流爆满时的处理方式(拒绝接单/老板亲自上/转其他店)
  first_principle: 线程池的本质是资源池化+流量控制，核心矛盾是吞吐量和稳定性之间的权衡
  key_points:
  - 'CPU密集型: 核心线程=CPU核数+1(+1防偶发page fault)'
  - 'IO密集型: 核心线程=CPU核数×2或更多(线程等待IO时让出CPU)'
  - 禁用无界队列LinkedBlockingQueue → 极易OOM
  - '支付核心链路: AbortPolicy抛异常+告警'
  - '异步通知: CallerRunsPolicy主线程兜底'
first_principle:
  essence: 线程池配置的本质是CPU利用率和内存安全的平衡
  derivation: 线程太少 → CPU利用率低 → 线程太多 → 上下文切换开销 + 内存OOM → 需要根据任务类型( CPU/IO)和业务重要性(核心/非核心)分别配置
  conclusion: 没有万能配置，关键是结合业务场景做trade-off
follow_up:
- 如何动态调整线程池参数？
- 线程池满了之后新来的任务怎么监控？
- ForkJoinPool和ThreadPoolExecutor有什么区别？
memory_points:
- 公式口诀：CPU密集型配置核数+1，而IO密集型配置核数×2（或除以计算占比）
- 队列选型：因为无界队列会OOM，所以线上必须强制使用有界队列
- 拒绝策略：核心链路用Abort防积压，可降级异步用CallerRuns主线程背压
- 容灾监控：不可丢任务用自定义Kafka兜底补偿，线上必须监控队列积压与拒绝率
---

# 线程池怎么配置？线上拒绝策略怎么选？

## 线程池参数配置

### 核心公式

```
CPU密集型任务:
  corePoolSize = CPU核数 + 1
  例: 8核 → 9个核心线程
  原理: CPU几乎无空闲，+1是为了防偶发的page fault等短暂阻塞

IO密集型任务:
  corePoolSize = CPU核数 × 2  (或用公式: N × (1 + W/T))
  例: 8核 → 16个核心线程
  原理: 线程大部分时间在等IO，2倍可以让CPU不空闲

  精确公式: corePoolSize = CPU核数 × (1 + 等待时间/计算时间)
  例: 等待:计算 = 10:1 → corePoolSize = 8 × 11 = 88
```

### 队列选择 (关键!)

| 队列类型 | 特点 | 适用场景 | 风险 |
|---------|------|---------|------|
| **LinkedBlockingQueue** | 无界(默认Integer.MAX) | ❌ 生产禁用 | ⚠️ OOM! 任务无限堆积 |
| **ArrayBlockingQueue** | 有界 | ✅ 推荐 | 队列满后触发maxPool |
| **SynchronousQueue** | 不存储，直接传递 | 高吞吐Cache线程池 | 每个任务新建线程 |
| **PriorityBlockingQueue** | 优先级排序 | 任务有优先级 | 无界，需限流 |

### 拒绝策略 (线上实战)

```java
// 1. 支付核心链路 → AbortPolicy (宁可失败也不能积压)
ExecutorService payExecutor = new ThreadPoolExecutor(
    8, 16,
    60L, TimeUnit.SECONDS,
    new ArrayBlockingQueue<>(100),
    new ThreadPoolExecutor.AbortPolicy()  // 队列满→抛异常→告警→用户重试
);

// 2. 异步通知(短信/推送) → CallerRunsPolicy (主线程兜底，实现背压)
ExecutorService notifyExecutor = new ThreadPoolExecutor(
    4, 8,
    30L, TimeUnit.SECONDS,
    new ArrayBlockingQueue<>(500),
    new ThreadPoolExecutor.CallerRunsPolicy()  // 队列满→主线程自己跑→自然限流
);

// 3. 不可丢任务(订单处理) → 自定义策略 (写入Kafka/文件补偿)
ExecutorService orderExecutor = new ThreadPoolExecutor(
    8, 16,
    60L, TimeUnit.SECONDS,
    new ArrayBlockingQueue<>(1000),
    (runnable, executor) -> {
        // 写入Kafka，后续补偿消费
        kafkaTemplate.send("order-compensation", serialize(runnable));
        metrics.increment("threadpool.rejected.compensated");
    }
);

// 4. 日志/埋点 → DiscardPolicy (直接丢弃)
ExecutorService logExecutor = new ThreadPoolExecutor(
    2, 4,
    30L, TimeUnit.SECONDS,
    new LinkedBlockingQueue<>(10000),
    new ThreadPoolExecutor.DiscardPolicy()  // 日志可丢，不影响业务
);
```

## 线上监控

```java
// 定时打印线程池关键指标
@Scheduled(fixedRate = 10000)
public void monitorThreadPool() {
    ThreadPoolExecutor executor = (ThreadPoolExecutor) businessExecutor;
    log.info("ThreadPool[{}]: active={}, poolSize={}, queue={}, completed={}, rejected={}",
        executor.getPoolSize(),                    // 当前线程数
        executor.getActiveCount(),                 // 活跃线程数
        executor.getQueue().size(),                // 队列积压
        executor.getCompletedTaskCount(),          // 已完成任务
        rejectedCount.get()                        // 拒绝次数(自定义计数器)
    );

    // 上报Prometheus
    metrics.gauge("threadpool.queue.size", executor.getQueue().size());
    metrics.gauge("threadpool.active.count", executor.getActiveCount());
}
```

## 面试加分点

### 动态调整线程池
```java
// 美团内部做法: 线程池参数可通过配置中心动态调整
// 核心API:
executor.setCorePoolSize(newCore);     // 运行时修改
executor.setMaximumPoolSize(newMax);   // 运行时修改

// 不需要重启应用就能调整线程池配置
```

### 线程池隔离
```
核心业务和非核心业务使用不同的线程池:
  - 订单线程池(8核) → 不受日志线程池影响
  - 日志线程池(2核) → 挂了不影响订单
  → 故障隔离
```

## 记忆要点

- 公式口诀：CPU密集型配置核数+1，而IO密集型配置核数×2（或除以计算占比）
- 队列选型：因为无界队列会OOM，所以线上必须强制使用有界队列
- 拒绝策略：核心链路用Abort防积压，可降级异步用CallerRuns主线程背压
- 容灾监控：不可丢任务用自定义Kafka兜底补偿，线上必须监控队列积压与拒绝率

