---
id: note-ks-001
difficulty: L3
category: system-design
subcategory: 性能调优
tags:
- 快手
- Java开发
- 一面
- 场景题
- 性能调优
- 链路追踪
- 面经
feynman:
  essence: TP99从50ms飙到2s但MySQL CPU正常，说明瓶颈不在数据库，而在应用层。快速定位四步法：(1)链路追踪定位RT高的模块→(2)jstack看线程状态(是否阻塞)→(3)连接池分析(是否耗尽)→(4)限流兜底防雪崩。
  analogy: "就像城市交通堵塞——路口A→B→C→D，你说从A到D的时间从5分钟变成40分钟，但D停车场不挤(MySQL正常)。那堵在哪？(1)先看导航(SkyWalking)找出堵在哪段路；(2)看每个路口的红绿灯状态(线程状态)；(3)看是不是某个路口的加油站(连接池)排满了车；(4)先限流别让更多车进来。"
  key_points:
  - 排查顺序：先看链路追踪定位慢节点→再看线程dump→然后连接池→最后限流保护
  - MySQL CPU正常排除数据库瓶颈，重点排查应用层（线程阻塞、连接池、GC、锁竞争）
  - SkyWalking定位RT高的具体Dubbo接口或模块
  - jstack看BLOCKED/WAITING线程数，排查线程池队列是否满
  - Druid/HikariCP连接池活跃连接数暴增说明有连接泄漏或慢SQL
first_principle:
  essence: 性能瓶颈定位 = 排除法 + 逐层下钻
  derivation: "请求链路：Client→Gateway→Service→DB。TP99升高但DB CPU正常 → 排除DB → 瓶颈在Service层。Service层可能的瓶颈：线程阻塞(锁/IO等待)、连接池耗尽、GC停顿、下游服务慢。"
  conclusion: 系统化排查路径：链路追踪(定位模块)→线程分析(定位原因)→连接池(定位资源)→限流(保护系统)
follow_up:
- 如果链路追踪发现是某个下游RPC服务变慢，如何进一步排查？
- jstack中BLOCKED线程过多，如何定位是哪把锁导致的？
- 连接池参数(maxActive/minIdle)如何调优？
- 如果GC停顿导致TP99飙升，如何排查和优化？
- 如何建立性能监控体系，在TP99升高前预警？
memory_points:
- 四步排查法：SkyWalking定位慢模块→jstack看线程状态→检查连接池→令牌桶限流兜底
- MySQL CPU正常=排除数据库，重点查应用层：线程阻塞、连接池耗尽、Full GC
- SkyWalking是分布式链路追踪的核心——一个请求在所有微服务中的耗时一目了然
- jstack关键指标：BLOCKED线程(锁竞争)、WAITING线程(资源等待)、RUNNABLE线程(CPU消耗)
---

# 【快手Java一面】促销活动时订单服务TP99从50ms飙到2s，MySQL CPU正常，如何快速定位？

> 来源：快手Java开发一面场景题复盘（小红书）

## 一、问题分析

```
正常状态                          异常状态
TP99: 50ms                       TP99: 2s（40倍恶化）
MySQL CPU: 30%                   MySQL CPU: 35%（正常！）

关键信息：
  ✅ MySQL CPU正常 → 数据库不是瓶颈
  ❌ TP99飙升40倍 → 瓶颈在应用层
  🎯 目标：快速定位应用层的瓶颈点
```

## 二、阶梯式排查四步法

```
Step 1: 链路追踪定位
  "哪里慢？"
     │
     ▼
Step 2: 线程池分析
  "什么在阻塞？"
     │
     ▼
Step 3: 连接池分析
  "资源够不够？"
     │
     ▼
Step 4: 限流兜底
  "先保命！"
```

### Step 1: 链路追踪（定位慢模块）

```
通过SkyWalking / Zipkin查看一个请求的完整Trace：

  ┌───────────────────────────────────────────────────────┐
  │ 请求: POST /api/order/create                           │
  │ TP99: 2000ms                                          │
  │                                                       │
  │ [Gateway]          2ms ──┐                            │
  │ [OrderService]    5ms ──┤                            │
  │   ├─ [queryUser]  8ms ──┤                            │
  │   ├─ [queryProduct] 10ms──┤                           │
  │   ├─ [dubboCall:inventory] 1800ms! ← 🎯 找到了！     │
  │   │   └── Dubbo接口调用堆积                            │
  │   └─ [saveOrder]  15ms──┤                            │
  │ [Gateway Response]  2ms ──┘                           │
  └───────────────────────────────────────────────────────┘

  结论：Dubbo调用inventory服务耗时1800ms（占总耗时90%）
  → 瓶颈在Dubbo接口调用堆积
```

### Step 2: 线程池分析

```bash
# jstack查看线程状态
jstack <pid> | grep "java.lang.Thread.State" | sort | uniq -c | sort -rn

# 输出分析：
  185 RUNNABLE       # 正常运行的线程
  342 BLOCKED        # 🔴 BLOCKED线程暴增！→ 锁竞争严重
   89 WAITING        # 等待中的线程
   23 TIMED_WAITING  # 超时等待中的线程

# BLOCKED过多 → 看具体在等什么锁
jstack <pid> | grep -A 5 "BLOCKED"
# 找到 blocked on 0x000000076b8a3e88 → 对应某个synchronized块
```

```
线程池队列分析：

  线程池配置：corePoolSize=50, maxPoolSize=200, queueSize=1000

  正常状态：
    活跃线程: 30/200
    队列积压: 0/1000

  异常状态（促销）：
    活跃线程: 200/200（满！）
    队列积压: 800/1000（快满！）
    → 任务排队等待 → TP99飙升

  根因：瞬时流量超过线程池处理能力
  → 任务在队列中排队等待 → 延迟飙升
```

### Step 3: 连接池瓶颈分析

```
Druid/HikariCP连接池监控：

  正常状态：
    activeCount: 15/50       # 活跃连接
    idleCount: 35/50         # 空闲连接
    waitThreadCount: 0       # 等待线程
    poolingPeakTime: 5ms     # 获取连接平均时间

  异常状态：
    activeCount: 50/50       # 🔴 活跃连接打满！
    idleCount: 0/50          # 没有空闲连接
    waitThreadCount: 180     # 🔴 180个线程在等连接！
    poolingPeakTime: 800ms   # 获取连接要等800ms

  根因：连接池不够用 → 线程等连接 → 延迟飙升
  解决：临时调大maxActive参数
```

```java
// Druid连接池实时监控
DruidDataSource ds = (DruidDataSource) dataSource;
System.out.println("活跃连接: " + ds.getActiveCount());
System.out.println("空闲连接: " + ds.getPoolingCount());
System.out.println("等待线程: " + ds.getWaitThreadCount());
System.out.println("最大连接: " + ds.getMaxActive());

// 紧急扩容（不需要重启，Druid支持运行时修改）
ds.setMaxActive(100); // 从50调到100
```

### Step 4: 限流兜底

```java
// Guava RateLimiter令牌桶限流
private final RateLimiter limiter = RateLimiter.create(500); // 500 QPS

@PostMapping("/order/create")
public Response createOrder(@RequestBody OrderRequest req) {
    // 1. 先限流，防止雪崩
    if (!limiter.tryAcquire(1, 100, TimeUnit.MILLISECONDS)) {
        log.warn("请求被限流, current QPS={}", limiter.getRate());
        return Response.tooManyRequests("系统繁忙，请稍后重试");
    }

    // 2. 正常处理
    return orderService.createOrder(req);
}
```

## 三、常见根因排查表

```
TP99飙升的常见原因（MySQL CPU正常的前提下）：

┌───────────────────┬──────────────────────┬─────────────────────┐
│ 根因               │ 现象                 │ 验证方式              │
├───────────────────┼──────────────────────┼─────────────────────┤
│ 线程池满           │ 队列积压，任务排队     │ jstack + 线程池监控  │
├───────────────────┼──────────────────────┼─────────────────────┤
│ 连接池耗尽         │ 等待连接线程多        │ Druid/HikariCP监控   │
├───────────────────┼──────────────────────┼─────────────────────┤
│ Dubbo调用堆积      │ 链路追踪显示RPC慢     │ SkyWalking Trace     │
├───────────────────┼──────────────────────┼─────────────────────┤
│ Full GC频繁       │ jstat显示FGC次数多    │ jstat -gcutil        │
├───────────────────┼──────────────────────┼─────────────────────┤
│ 锁竞争            │ BLOCKED线程多        │ jstack找锁           │
├───────────────────┼──────────────────────┼─────────────────────┤
│ 网络延迟          │ RPC RTT升高          │ ping/tcptraceroute   │
├───────────────────┼──────────────────────┼─────────────────────┤
│ 慢日志拖累        │ 慢SQL查询多          │ 慢查询日志            │
│ (非CPU密集)       │ (虽然CPU不高但IO高)   │                      │
└───────────────────┴──────────────────────┴─────────────────────┘
```

## 四、面试加分点

1. **提到GC排查**：用`jstat -gcutil <pid> 1000`观察GC频率，如果Full GC频繁（每分钟>5次），说明老年代空间不足，需要调大堆或优化对象生命周期
2. **提到Arthas在线诊断**：直接用Arthas的`trace`命令追踪方法内部耗时，比jstack更精确
3. **提到自动扩缩容**：K8s HPA根据CPU/内存/QPS自动扩缩容，大促期间弹性应对
4. **提到全链路压测**：大促前做全链路压测，提前发现瓶颈，而不是等线上出问题
5. **提到限流降级自动化**：Sentinel/Gore配置自动限流降级规则，TP99超阈值自动触发保护

## 苏格拉底式面试追问

> 这组追问模拟面试官层层逼问，每一问先回答"为什么"，再回答"怎么做"，最后回答"如何证明"。

### 第一层：目标与动机

**Q：TP99 飙到 2s 你先看 MySQL CPU 正常就排除 DB，为什么不是 DB 的锁等待或慢查询（不占 CPU 但慢）？**

思路对但要验证，不能只看 CPU。MySQL 的瓶颈除了 CPU 还有 IO 等待和锁等待——行锁等待（SELECT FOR UPDATE）的线程处于 WAIT 状态不占 CPU，但 RT 飙高。正确排查是：CPU 正常 + `SHOW PROCESSLIST` 看是否有大量锁等待 + 慢查询日志看是否有 RT 高的 SQL。如果这些都正常，才排除 DB。决策依据：MySQL CPU 正常只能排除"计算密集"瓶颈，不能排除"IO 等待/锁等待"瓶颈，要组合多个指标判断。

### 第二层：证据与定位

**Q：SkyWalking 显示是"订单查询 RPC"慢（1.5s），你怎么定位是订单服务自身慢还是它调的下游慢？**

在 SkyWalking 的 trace 链路里展开这个 RPC，看它的子 span：
1. 如果子 span 显示"查 Redis 1.2s"——是下游 Redis 慢（可能 big key 或网络）。
2. 如果子 span 显示"DB 查询 0.8s"——是 DB 慢查询。
3. 如果 RPC 自身耗时占比高（无慢子 span）——是订单服务自身的业务逻辑慢（CPU 计算、锁等待、GC）。
Trace 的 span 树能精确到每一段耗时，不要只看顶层 RPC 的总耗时。

### 第三层：根因深挖

**Q：订单服务自身慢（无慢下游），jstack 发现 200 个 BLOCKED 线程，怎么定位是哪把锁？**

jstack 输出里每个 BLOCKED 线程会显示"waiting to lock <0x000000076b8a1234>"，这个 lock ID 指向锁对象。同时找一个 RUNNABLE 且持有该锁的线程（"locked <0x000000076b8a1234>"），看它的堆栈在执行什么代码——那就是持锁的临界区。常见根因：① synchronized 保护的长耗时操作（如 DB 查询在锁内）；③ 单例对象的锁粒度太粗（整个方法 synchronized，所有请求串行）。定位到代码行后，看是否能把锁细化或把慢操作移出锁。

**Q：为什么不直接重启服务解决 TP99 飙高，重启后 BLOCKED 线程清空不就好了吗？**

因为重启是治标不治本，问题会复发。重启后 BLOCKED 暂时消失，但根因（锁粒度粗、慢 SQL、连接池小）还在，流量一上来又飙高。而且重启期间服务不可用（或需要优雅下线），促销活动期间重启 = 业务中断。正确做法是先限流保护（令牌桶限流降到服务能承受的 QPS），再定位根因修复，热更新（如调大连接池参数、优化 SQL 加索引）不用重启。重启是最后的兜底（如内存泄漏只能重启），不是首选。

### 第四层：方案权衡

**Q：你提到限流兜底（令牌桶），为什么用令牌桶而不是漏桶或计数器？**

因为令牌桶允许突发流量。令牌桶按固定速率生成令牌，请求拿到令牌才处理——桶里攒了令牌时可以瞬间处理突发请求（促销开始的流量洪峰），没有令牌时限流。漏桶是匀速出（不管来多猛都按固定速率处理），适合"严格匀速"场景但会拒绝合理突发。计数器（固定窗口）有临界点问题（窗口边界双倍流量）。促销场景流量有突发特性，令牌桶既保护系统又允许合理突发，是最优解。

**Q：为什么不直接扩容（加机器）解决 TP99 飙高，扩容不是最简单吗？**

因为扩容解决不了"单点瓶颈"。如果是锁竞争（synchronized 在单机内），扩容到多实例能把锁竞争分散（每实例独立锁），有效。但如果是 DB 连接池耗尽（所有实例连同一个 DB），扩容应用实例反而加剧 DB 压力（更多实例 = 更多连接），TP99 更高。如果是慢 SQL（缺索引全表扫描），扩容应用无用，要优化 SQL。扩容只对"CPU/内存瓶颈"和"无状态服务的并发瓶颈"有效，对"共享资源瓶颈"（DB、锁、连接池）无效甚至有害。先定位根因再决定扩容还是优化。

### 第五层：验证与沉淀

**Q：你怎么证明修复后 TP99 稳定（不是偶发正常）？**

持续监控 + 对比：
1. 修复前后 7 天的 TP99 曲线对比，确认从 2s 降到 50ms 且持续稳定。
2. 按 QPS 分层看 TP99——高 QPS 时段（促销高峰）的 TP99 也要达标，不能只看平均。
3. 压测验证——模拟促销峰值 QPS 压测，确认 TP99 在目标值以下。

**Q：性能调优经验怎么沉淀？**

1. 排查 SOP 文档化——"TP99 飙高排查四步法"写成 runbook，新人值班按流程执行，不用凭经验。
2. 监控告警前置——建立 TP99 的分级告警（P99 > 100ms 告警、> 500ms 自动限流），在用户感知前发现问题。
3. 性能基线——每次大促前压测记录性能基线（QPS、TP99、资源使用率），大促时对比基线及时发现异常。


## 结构化回答

**30 秒电梯演讲：** TP99从50ms飙到2s但MySQL CPU正常，说明瓶颈不在数据库，而在应用层。

**展开框架：**
1. **四步排查法** — SkyWalking定位慢模块→jstack看线程状态→检查连接池→令牌桶限流兜底
2. **MySQL CPU正常** — MySQL CPU正常=排除数据库，重点查应用层：线程阻塞、连接池耗尽、Full GC
3. **SkyWalking是分** — SkyWalking是分布式链路追踪的核心——一个请求在所有微服务中的耗时一目了然

**收尾：** 这块我踩过坑——要不要深入聊：如果链路追踪发现是某个下游RPC服务变慢，如何进一步排查？

## 视频脚本

> 预计时长：3 分钟 | 由浅入深

| 时间 | 画面/字幕 | 口播台词 | 讲解要点 |
|------|----------|----------|----------|
| 0:00 | 标题卡 | "性能调优一句话：TP99从50ms飙到2s但MySQL CPU正常，说明瓶颈不在数据库…。" | 开场钩子 |
| 0:15 | MySQL EXPLAIN 执行计划截图 | "四步排查法：SkyWalking定位慢模块到jstack看线程状态到检查连接池到令牌桶限流兜底" | 四步排查法 |
| 1:06 | MySQL EXPLAIN 执行计划截图分步演示 | "MySQL CPU正常就是排除数据库，重点查应用层：线程阻塞、连接池耗尽、Full GC" | MySQL CPU正常 |
| 1:57 | 关键代码/伪代码片段 | "SkyWalking是分布式链路追踪的核心——一个请求在所有微服务中的耗时一目了然" | SkyWalking是分 |
| 2:50 | 总结卡 | "核心抓住这条主线，下期咱们接着聊：如果链路追踪发现是某个下游RPC服务变慢，如何进一步排查。" | 收尾 |
