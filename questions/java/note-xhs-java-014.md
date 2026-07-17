---
id: note-xhs-java-014
difficulty: L3
category: java
subcategory: 并发/线程池
tags:
- 拼多多
- Java服务端
- 线程池
- ThreadPoolExecutor
- 并发
- 面经
feynman:
  essence: "线程池 = 预创建的线程集合 + 任务队列 + 拒绝策略。7个核心参数控制线程创建、排队和拒绝行为"
  analogy: "线程池就像一家餐厅——corePoolSize是常驻厨师，maxPoolSize是高峰期最多雇佣的厨师，workQueue是候餐区，rejectHandler是客人太多时的处理方式（拒绝/叫外卖/等位）"
  key_points:
  - 7个参数：corePoolSize、maxPoolSize、keepAliveTime、unit、workQueue、threadFactory、handler
  - 任务处理流程：核心线程→队列→非核心线程→拒绝策略
  - 4种拒绝策略：AbortPolicy(抛异常)、CallerRunsPolicy(调用者执行)、DiscardPolicy(丢弃)、DiscardOldestPolicy(丢弃最旧)
  - 常见队列：LinkedBlockingQueue(无界)、ArrayBlockingQueue(有界)、SynchronousQueue(直接交换)
  - 阿里规约禁止Executors.newFixedThreadPool()，要用new ThreadPoolExecutor()
first_principle:
  essence: "线程创建/销毁有开销(约1ms)，池化复用减少开销。但有界资源需要策略控制何时扩容、何时排队、何时拒绝"
  derivation: "任务来了 → 先用常驻线程(core) → 不够用就排队(queue) → 队列满了就临时扩容(max) → 都满了就拒绝(reject)。这是'先复用→再缓冲→后扩容→最后保护'的渐进式策略"
  conclusion: "线程池设计 = 核心线程(常态) + 队列(缓冲) + 最大线程(峰值) + 拒绝策略(保护)"
follow_up:
- 线程池是如何区分核心线程和非核心线程的？
- 为什么阿里禁止用Executors创建线程池？
- 如何合理设置线程池大小？（CPU密集型 vs IO密集型）
- 线程池的execute()和submit()有什么区别？
- 线程池异常处理机制是什么？任务抛异常后线程会怎样？
memory_points:
- 7参数：core、max、keepAlive、unit、queue、factory、handler
- 流程口诀：核心满→入队列→队列满→开到max→都满→拒绝
- CPU密集型：线程数 ≈ CPU核数+1；IO密集型：线程数 ≈ CPU核数×2或更多
- 4种拒绝策略：Abort(抛异常)、CallerRuns(调用者跑)、Discard(静默丢)、DiscardOldest(丢最旧)
---

# 【拼多多 Java服务端】Java线程池有哪些参数？提交任务时的处理流程是什么？

> 来源：拼多多复活赛一面面经（小红书）

## 一、费曼类比

```
线程池 = 餐厅运营模型:

┌────────────────────────────────────────────────────┐
│                   餐厅（线程池）                     │
│                                                    │
│  常驻厨师 ──→ corePoolSize (3个固定厨师)             │
│  临时厨师 ──→ maxPoolSize - corePoolSize (高峰期加人) │
│  候餐区   ──→ workQueue (排队等位的客人)             │
│  临时工时长──→ keepAliveTime (闲了多久就辞退)         │
│  满客处理 ──→ handler (四种策略应对爆满)              │
│                                                    │
│  客人来了:                                          │
│  1. 有空闲厨师？→ 直接做                             │
│  2. 厨师都在忙？→ 去候餐区排队                        │
│  3. 候餐区满了？→ 招临时厨师                         │
│  4. 厨师到上限了？→ 执行满客策略                      │
└────────────────────────────────────────────────────┘
```

## 二、第一性原理分析

**为什么要池化？**

```
无线程池:                          有线程池:
任务1 → new Thread → 执行 → 销毁    任务1 → 从池中取线程 → 执行 → 归还
任务2 → new Thread → 执行 → 销毁    任务2 → 从池中取线程 → 执行 → 归还
任务3 → new Thread → 执行 → 销毁    
                                   线程复用，省去创建/销毁开销（~1ms/次）
缺点: 创建开销大、无法控制数量        优点: 复用 + 可控 + 可监控
```

## 三、详细答案

### 3.1 七个核心参数

```java
public ThreadPoolExecutor(
    int corePoolSize,         // 核心线程数（常驻）
    int maximumPoolSize,      // 最大线程数（含核心）
    long keepAliveTime,       // 非核心线程空闲存活时间
    TimeUnit unit,            // 存活时间单位
    BlockingQueue<Runnable> workQueue,  // 任务队列
    ThreadFactory threadFactory,        // 线程工厂（命名、优先级等）
    RejectedExecutionHandler handler    // 拒绝策略
)
```

### 3.2 任务处理流程（核心考点）

```
                    提交任务 execute(task)
                           │
                           ↓
                 ┌─────────────────┐
                 │ 当前线程数 <     │──YES──→ 创建核心线程执行任务
                 │ corePoolSize?   │
                 └────────┬────────┘
                         NO
                          ↓
                 ┌─────────────────┐
                 │ workQueue未满?  │──YES──→ 任务入队列等待
                 └────────┬────────┘
                         NO
                          ↓
                 ┌─────────────────┐
                 │ 当前线程数 <     │──YES──→ 创建非核心线程执行任务
                 │ maximumPoolSize?│
                 └────────┬────────┘
                         NO
                          ↓
                 ┌─────────────────┐
                 │ 执行拒绝策略      │
                 │ (RejectedHandler)│
                 └─────────────────┘
```

**口诀：核心满→入队列→队列满→开到max→都满→拒绝**

### 3.3 四种拒绝策略

| 策略 | 行为 | 适用场景 |
|------|------|---------|
| **AbortPolicy** (默认) | 抛出RejectedExecutionException | 要求任务必须执行，异常可感知 |
| **CallerRunsPolicy** | 由提交任务的线程自己执行 | 不丢任务、自动降速（反压） |
| **DiscardPolicy** | 静默丢弃新任务 | 允许丢失（如日志收集） |
| **DiscardOldestPolicy** | 丢弃队列最旧的任务，重新提交 | 只关心最新数据（如实时监控） |

### 3.4 常见阻塞队列选择

| 队列类型 | 特点 | 配套线程池 |
|---------|------|-----------|
| **LinkedBlockingQueue** | 无界（默认Integer.MAX_VALUE） | FixedThreadPool、SingleThreadPool |
| **ArrayBlockingQueue** | 有界 | 自定义线程池（推荐） |
| **SynchronousQueue** | 不存储，直接交换 | CachedThreadPool |
| **PriorityBlockingQueue** | 优先级排序 | 有优先级的任务 |

### 3.5 为什么阿里禁止Executors？

```java
// ❌ 危险：LinkedBlockingQueue无界 → OOM风险
ExecutorService pool1 = Executors.newFixedThreadPool(10);
// 内部: new LinkedBlockingQueue<Runnable>() → 容量Integer.MAX_VALUE

// ❌ 危险：maximumPoolSize=Integer.MAX_VALUE → 创建大量线程
ExecutorService pool2 = Executors.newCachedThreadPool();

// ✅ 正确：手动创建，有界队列+明确参数
ExecutorService pool = new ThreadPoolExecutor(
    10,                              // corePoolSize
    20,                              // maximumPoolSize
    60L, TimeUnit.SECONDS,           // keepAliveTime
    new ArrayBlockingQueue<>(1000),  // 有界队列！
    new ThreadFactoryBuilder().setNameFormat("biz-pool-%d").build(),
    new ThreadPoolExecutor.CallerRunsPolicy()
);
```

## 四、线程数设置经验

```
CPU密集型（计算、压缩、加密）:
  线程数 = CPU核数 + 1
  (+1是因为偶尔的页面故障等暂停，多一个线程填补)

IO密集型（网络请求、数据库、文件）:
  线程数 = CPU核数 × (1 + IO等待时间/CPU时间)
  经验值: CPU核数 × 2 ~ CPU核数 × 10

混合型:
  线程数 = CPU核数 × (1 + IO占比/(1-IO占比))
```

## 五、实际例子

```java
// AI助手项目的推理线程池
ThreadPoolExecutor inferencePool = new ThreadPoolExecutor(
    8,                                // 8个常驻推理线程
    32,                               // 最多32个并发推理
    60L, TimeUnit.SECONDS,
    new ArrayBlockingQueue<>(200),    // 200个排队请求
    new ThreadFactoryBuilder()
        .setNameFormat("inference-%d")
        .setUncaughtExceptionHandler((t, e) -> log.error("推理异常", e))
        .build(),
    new ThreadPoolExecutor.CallerRunsPolicy()  // 队列满时调用方线程执行（反压）
);
```

## 六、扩展知识

- **核心线程也能被回收**: `allowCoreThreadTimeOut(true)` 让核心线程也受keepAliveTime约束
- **prestartAllCoreThreads()**: 预热所有核心线程，避免冷启动延迟
- **execute vs submit**: execute无返回值、异常直接抛出；submit返回Future、异常封装在Future中

## 七、苏格拉底式面试提问

1. **"你说核心线程满后任务入队列，但为什么不是直接创建新线程？这样不是更快吗？"** — 引出设计哲学：控制资源消耗，队列是廉价缓冲，线程是昂贵资源
2. **"CallerRunsPolicy让调用者线程执行任务，这不会阻塞调用方吗？"** — 引出反压(backpressure)机制，自动降速保护系统
3. **"如果线程池中一个线程抛了未捕获异常，线程池会怎样？"** — execute方式线程终止并创建新线程；submit方式异常封装在Future中
4. **"如何监控线程池运行状态？"** — getActiveCount/getQueueSize/getCompletedTaskCount + 自定义拒绝策略日志
5. **"线程池和ForkJoinPool有什么本质区别？"** — 引出工作窃取(Work Stealing)算法、分治任务模型

## 八、面试加分点

1. **能完整说出7个参数** — 不是背名字，而是解释每个参数的作用
2. **画出任务处理流程图** — 核心→队列→max→拒绝，清晰准确
3. **知道Executors的OOM风险** — 阿里规约的核心原因
4. **能区分CPU密集型和IO密集型的线程数设置** — 展示实际调优经验
5. **推荐CallerRunsPolicy** — 说明反压机制，体现系统设计思维


## 结构化回答

**30 秒电梯演讲：** 线程池 就是 预创建的线程集合 + 任务队列 + 拒绝策略。7个核心参数控制线程创建、排队和拒绝行为。

**展开框架：**
1. **7参数** — core、max、keepAlive、unit、queue、factory、handler
2. **流程口诀** — 核心满→入队列→队列满→开到max→都满→拒绝
3. **CPU密集型** — 线程数 ≈ CPU核数+1；IO密集型：线程数 ≈ CPU核数×2或更多

**收尾：** 这块我踩过坑——要不要深入聊：线程池是如何区分核心线程和非核心线程的？

## 视频脚本

> 预计时长：3 分钟 | 由浅入深

| 时间 | 画面/字幕 | 口播台词 | 讲解要点 |
|------|----------|----------|----------|
| 0:00 | 标题卡 | "并发/线程池一句话：线程池 就是 预创建的线程集合 + 任务队列 + 拒绝策略。7个核心参数控制线程创建、排队和拒绝行为。" | 开场钩子 |
| 0:15 | 线程状态转换图 | "7参数：core、max、keepAlive、unit、queue、factory、handler" | 7参数 |
| 1:06 | 线程状态转换图分步演示 | "流程口诀：核心满到入队列到队列满到开到max到都满到拒绝" | 流程口诀 |
| 1:57 | 关键代码/伪代码片段 | "CPU密集型：线程数 ≈ CPU核数+1；IO密集型：线程数 ≈ CPU核数×2或更多" | CPU密集型 |
| 2:50 | 总结卡 | "核心抓住这条主线，下期咱们接着聊：线程池是如何区分核心线程和非核心线程的。" | 收尾 |
