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
