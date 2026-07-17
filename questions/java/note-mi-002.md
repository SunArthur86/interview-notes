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


## 苏格拉底式面试追问

> 这组追问模拟面试官层层逼问，每一问先回答"为什么"，再回答"怎么做"，最后回答"如何证明"。

### 第一层：目标与动机

**Q：线程池配置你说"CPU 密集型核数+1、I/O 密集型核数×2"，这个公式怎么来的？为什么是 +1 不是 +2？**

CPU 密集型公式 `N+1` 的依据：N 个线程对应 N 个 CPU 核，每个线程满负荷计算，CPU 利用率 100%。多出 1 个线程是为了"偶尔的页面中断或其他等待"——如果某线程偶尔阻塞（如缺页、GC），多出的 1 个线程顶上，保持 CPU 不闲。加更多线程（+2、+3）没用——CPU 已经满了，多余线程只能排队等 CPU 时间片，反而增加上下文切换开销。所以 N+1 是"刚好填满 CPU + 一点冗余应对偶发阻塞"的最小值。I/O 密集型公式 `2N`（或 `N/(1-阻塞比)`）的依据：I/O 密集任务大部分时间在等 I/O（阻塞），CPU 利用率低，需要更多线程让"某个线程阻塞时其他线程能用 CPU"。2N 是经验值，精确计算用 `N×(等待时间+计算时间)/计算时间`——如计算占 30%、等待 70%，则 `N×(100/30)=3.3N`。这些公式是"起步估算"，生产要靠压测调整（监控 CPU 利用率和队列积压）。

### 第二层：证据与定位

**Q：线上线程池拒绝率飙升，你怎么判断是"线程太少"还是"任务太慢"？**

看两个指标交叉判断：一、活跃线程数 vs 配置线程数——如果活跃线程数 = 最大线程数（线程全忙），且队列已满，是"线程不够"或"任务积压"；二、单任务平均耗时——如果某段时间任务平均耗时从 10ms 涨到 1s（如 DB 慢查询、下游服务慢），是"任务变慢"导致线程被占用，即使线程数够也会拒绝。具体：`ThreadPoolExecutor` 暴露的 `getActiveCount()`、`getQueue().size()`、`getCompletedTaskCount()`。如果 activeCount=maxPoolSize 且 queue 满，是积压；如果 activeCount=maxPoolSize 但 completedTaskCount 增速慢，是任务慢。常见根因：下游服务超时（如 DB 慢查询、HTTP 调用超时）让线程长时间阻塞，要先查下游，不是盲目加线程。盲目加线程可能让问题更糟（更多线程同时打下游，下游雪崩）。

### 第三层：根因深挖

**Q：你说"无界队列会 OOM，必须用有界队列"，但 LinkedBlockingQueue 默认是无界的（Integer.MAX_VALUE），为什么 Java 要提供无界队列？**

无界队列有合理用途——当任务"必须全部执行不能丢"且"生产速度可控"时，无界队列作为缓冲。如批量任务处理，生产端是定时任务（可控速率），消费端是线程池，用无界队列让任务排队不丢失。但风险是"生产端失控"——如果生产速度远超消费，队列无限堆积，最终 OOM（队列里的任务对象占满堆）。所以无界队列要配合"生产端限流"使用，不能单独依赖。生产场景建议显式设容量：`new LinkedBlockingQueue<>(1000)`，明确表达"最多排 1000 任务，超了走拒绝策略"。默认 Integer.MAX_VALUE 是"让开发者显式决策"的反模式——很多人不知道默认是无界，结果线上 OOM。所以"必须用有界队列"的本质是"显式设容量 + 拒绝策略"，不是禁用 LinkedBlockingQueue。

**Q：那为什么不直接用 SynchronousQueue（无缓冲队列），让任务直接传递给线程，超出就拒绝？**

SynchronousQueue 的语义是"无缓冲，每个 put 必须等一个 take"——提交任务时如果没有空闲线程，立即创建新线程（前提是未达 maxPoolSize），满了才拒绝。它适合"每个任务都要立即执行、不希望排队"的场景，对应 Executors.newCachedThreadPool()（corePoolSize=0、maxPoolSize=Integer.MAX_VALUE、SynchronousQueue）。风险是 maxPoolSize 无限，可能创建海量线程导致 OOM（OutOfMemoryError: unable to create new native thread）。所以 SynchronousQueue 要配合"有限的 maxPoolSize"用，如 corePoolSize=10、maxPoolSize=100、SynchronousQueue——10 个核心线程不够就扩到 100，再超就拒绝。选 LinkedBlockingQueue 还是 SynchronousQueue 看"希望排队缓冲还是立即拒绝"——缓冲用前者、即时性高用后者。

### 第四层：方案权衡

**Q：拒绝策略你说"核心链路用 AbortPolicy、可降级用 CallerRunsPolicy"，但 CallerRunsPolicy 会让主线程执行任务，会不会拖慢主流程？**

会，这正是它的设计目的——"背压"。CallerRunsPolicy 让提交任务的主线程自己执行任务（如 main 线程调 execute，main 自己跑任务），这天然限流了主线程的提交速度——主线程在跑任务，就没空继续提交。这是"用主线程阻塞反向控制生产速度"的机制，叫 backpressure。好处是"不丢任务 + 自动限流"，坏处是"主线程被拖慢"。权衡：如果主线程是 Web 请求线程，CallerRunsPolicy 会让该请求变慢（但任务不丢），用户感知"请求慢了"；如果用 AbortPolicy，任务被拒绝（要捕获 RejectedExecutionException 做兜底，如记日志重试），但主线程立即返回不阻塞。所以"核心链路 + 任务不能丢"用 CallerRuns（牺牲主线程速度换不丢任务）、"任务可丢/可重试"用 Abort（快速失败）。

**Q：为什么不用自定义拒绝策略（如"拒绝时写 Kafka 异步重试"），不是更优雅吗？**

自定义拒绝策略适合"任务绝对不能丢"的场景，但有成本：一、增加系统依赖（Kafka 要可用、消费端要 ready）；二、重试链路复杂（消息可能重复、消费顺序问题）；三、调试难（异步链路问题定位麻烦）。如果业务真能容忍丢（如统计、日志），AbortPolicy 最简单（丢弃 + 记日志）。如果业务要"至少执行一次"，CallerRuns（同步降级）比 Kafka 重试更简单（无额外依赖）。只有"任务跨进程/跨机器才能完成"（如任务要其他服务处理）才值得自定义拒绝 + 异步重试。所以拒绝策略按"任务重要性"分级：可丢 → Abort、要执行 → CallerRuns、要异步 → 自定义。不要无脑自定义（过度设计）。

### 第五层：验证与沉淀

**Q：你怎么验证线程池配置在生产负载下合理（不积压、不拒绝、CPU 利用率合适）？**

压测 + 监控双管齐下。压测：用 JMeter/wrk 模拟生产 QPS，持续 10 分钟，观察 ThreadPoolExecutor 的 activeCount（活跃线程）、queue.size()（队列积压）、rejectedCount（拒绝数）、completedTaskCount（完成数）。合理配置：activeCount 稳定在 corePoolSize 附近、queue.size() 在容量 50% 以下波动、rejectedCount=0、CPU 利用率 70-80%（留余量应对峰值）。线上监控：把这些指标暴露到 Prometheus（通过 ThreadPoolExecutor 的 getter），告警阈值——queue.size() > 80% capacity 预警、rejectedCount 增长告警、activeCount 持续=maxPoolSize 告警。定期复盘：每周看线程池运行报告，按负载变化调整（如大促前临时扩 corePoolSize）。线程池配置不是一成不变，要随负载动态调。

**Q：这道题做完，你沉淀出了什么可复用的线程池配置方法论？**

五步配置法：一、看任务类型——CPU 密集用 N+1、I/O 密集用 2N（N=核数）；二、看任务重要性——核心任务用 AbortPolicy 快速失败暴露问题、可降级用 CallerRuns 背压、要异步重试自定义；三、看突发流量——corePoolSize 应对常态、maxPoolSize 应对峰值、队列缓冲平滑；四、监控告警——队列积压（80%预警）、拒绝率（持续增长告警）、CPU 利用率（>85%告警）；五、动态调整——根据压测和生产负载定期调参。核心原则："线程池是资源池，配置要匹配负载，监控要到位，拒绝策略要明确语义。" 这套方法论也适用于其他池化资源（连接池、对象池），本质都是"池大小 + 排队 + 拒绝"三要素的权衡。


## 结构化回答

**30 秒电梯演讲：** 线程池不是背公式配置参数，而是根据业务场景( CPU密集/IO密集)选核心线程数、队列类型和拒绝策略，核心是防止OOM和保证关键链路不被拖垮。打个比方，线程池像餐厅后厨——核心线程是常驻厨师，队列是等单架，最大线程是高峰临时工，拒绝策略是客流爆满时的处理方式(拒绝接单/老板亲自上/转其他店)。

**展开框架：**
1. **公式口诀** — CPU密集型配置核数+1，而IO密集型配置核数×2（或除以计算占比）
2. **队列选型** — 因为无界队列会OOM，所以线上必须强制使用有界队列
3. **拒绝策略** — 核心链路用Abort防积压，可降级异步用CallerRuns主线程背压

**收尾：** 这块我踩过坑——要不要深入聊：如何动态调整线程池参数？

## 视频脚本

> 预计时长：3 分钟 | 由浅入深

| 时间 | 画面/字幕 | 口播台词 | 讲解要点 |
|------|----------|----------|----------|
| 0:00 | 标题卡 | "并发编程一句话：线程池不是背公式配置参数，而是根据业务场景( CPU密集/IO密集)选核心线程数、队列类型和拒绝策略…。" | 开场钩子 |
| 0:15 | IO 模型对比图 | "公式口诀：CPU密集型配置核数+1，而IO密集型配置核数×2（或除以计算占比）" | 公式口诀 |
| 1:06 | IO 模型对比图分步演示 | "队列选型：因为无界队列会OOM，所以线上必须强制使用有界队列" | 队列选型 |
| 1:57 | 关键代码/伪代码片段 | "拒绝策略：核心链路用Abort防积压，可降级异步用CallerRuns主线程背压" | 拒绝策略 |
| 2:50 | 总结卡 | "核心抓住这条主线，下期咱们接着聊：如何动态调整线程池参数。" | 收尾 |
