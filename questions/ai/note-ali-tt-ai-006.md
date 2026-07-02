---
id: note-ali-tt-ai-006
difficulty: L2
category: ai
subcategory: JVM调优
tags:
- 阿里巴巴
- 淘天
- AI应用开发
- JVM
- Arthas
- 内存分析
- 面经
feynman:
  essence: JVM调优查看内存对象的核心工具是Arthas——一个线上诊断工具，可以实时查看堆内存中新生代/老年代占用情况、哪些类占用内存最多、对象引用链等。配合jmap、jstack、MAT等工具形成完整的内存分析工具链。
  analogy: "JVM内存就像一个仓库——Arthas是仓库的'透视镜'，不用停业(停机)就能看到：哪个货架(新生代/老年代)快满了、哪种货物(类/对象)堆得最多、谁在占用货架不放(引用链)。jmap是'盘点清单'，MAT是'深度分析报告'。"
  key_points:
  - Arthas：阿里开源的Java在线诊断工具，无需停机，实时查看JVM状态
  - 核心命令：dashboard(总览)、heapdump(堆转储)、profiler(CPU/内存火焰图)
  - jmap -histo：查看堆中对象统计（按大小/数量排序）
  - MAT(Memory Analyzer Tool)：离线分析heapdump，找内存泄漏
  - JVM内存区域：堆(新生代Eden+S0+S1 / 老年代)、元空间、栈、直接内存
first_principle:
  essence: JVM内存分析 = 定位"谁占用了内存" + "为什么没被回收"
  derivation: "OOM或频繁GC的根因：对象创建快于回收 → 堆空间不足。分析路径：(1)看整体占用(jstat/dashboard) → (2)看对象分布(jmap -histo) → (3)看对象引用链(MAT/Arthas) → (4)定位代码位置。"
  conclusion: 在线用Arthas快速定位问题类，离线用MAT深度分析引用链，两者配合是JVM内存调优的标准工作流。
follow_up:
- Arthas的watch和trace命令有什么区别？
- 如何分析频繁Full GC的原因？
- JVM的内存模型有哪些区域？各自的OOM类型是什么？
- 对象从新生代晋升到老年代的条件是什么？
- G1和CMS垃圾收集器的区别？
memory_points:
- Arthas是JVM内存调优的首选工具——无需重启、实时诊断、阿里开源
- Arthas三件套：dashboard(总览GC/线程) → heapdump+jmap -histo(对象分布) → profiler(火焰图)
- MAT用于离线分析：parse heapdump → Dominator Tree(谁占最多) → Leak Suspects(泄漏嫌疑)
- 对象进入老年代条件：年龄>=15(默认) 或 大对象直接进 或 Survivor区放不下动态年龄判断
---

# 【阿里淘天AI二面】JVM调优时，如何查看内存对象的情况？有了解过开源工具吗？

> 来源：阿里巴巴淘天淘工厂 AI应用开发 二面面经（小红书）

## 一、JVM 内存区域回顾

```
┌───────────────────────────────────────────────────┐
│                    JVM 内存结构                     │
├───────────────────────────────────────────────────┤
│                                                   │
│  ┌─────────────────────────────────────────────┐  │
│  │              堆内存 (Heap)                    │  │
│  │  ┌───────────────────────────────────────┐  │  │
│  │  │           新生代 (Young Gen)           │  │  │
│  │  │  ┌────────┐  ┌────────┐  ┌────────┐  │  │  │
│  │  │  │ Eden   │  │ S0     │  │ S1     │  │  │  │
│  │  │  │ (8/10) │  │ (1/10) │  │ (1/10) │  │  │  │
│  │  │  └────────┘  └────────┘  └────────┘  │  │  │
│  │  └───────────────────────────────────────┘  │  │
│  │  ┌───────────────────────────────────────┐  │  │
│  │  │           老年代 (Old Gen)             │  │  │
│  │  │       长期存活的对象 / 大对象           │  │  │
│  │  └───────────────────────────────────────┘  │  │
│  └─────────────────────────────────────────────┘  │
│                                                   │
│  ┌──────────────┐ ┌──────────────┐ ┌───────────┐ │
│  │  元空间       │ │  线程栈      │ │ 直接内存   │ │
│  │ (Metaspace)  │ │ (Stack)     │ │ (Direct)  │ │
│  │ 类元数据      │ │ 方法栈帧     │ │ NIO/Netty │ │
│  └──────────────┘ └──────────────┘ └───────────┘ │
└───────────────────────────────────────────────────┘
```

## 二、在线诊断工具：Arthas

### Arthas 是什么

Arthas 是阿里巴巴开源的 Java 在线诊断工具，**无需重启应用**，通过字节码增强技术实时查看JVM状态。

### 核心命令速查

```bash
# 安装与启动
curl -O https://arthas.aliyun.com/arthas-boot.jar
java -jar arthas-boot.jar <pid>

# 1. dashboard — JVM总览（内存、GC、线程一目了然）
[arthas@12345]$ dashboard
# 显示：堆内存使用率、GC次数/耗时、线程状态、CPU使用率

# 2. jvm — 查看JVM详细信息
[arthas@12345]$ jvm
# 显示：JVM版本、内存区域详细大小、GC策略、类加载数量

# 3. heapdump — 导出堆转储文件
[arthas@12345]$ heapdump /tmp/heap.hprof
# 生成heap dump文件，后续用MAT分析

# 4. 查看类加载信息和对象大小
[arthas@12345]$ ognl '@java.lang.Runtime@getRuntime().freeMemory()'
# 通过OGNL表达式查看运行时内存

# 5. profiler — 生成火焰图（CPU或内存分配）
[arthas@12345]$ profiler start --event alloc
# 开始内存分配采样
[arthas@12345]$ profiler stop --format html
# 停止并生成火焰图HTML报告

# 6. vmtool — 查询内存中的对象
[arthas@12345]$ vmtool --action getInstances --className java.lang.String --limit 10
# 查询内存中String对象实例

# 7. watch — 观察方法执行（含返回值和耗时）
[arthas@12345]$ watch com.example.OrderService createOrder returnObj -x 2
# 观察OrderService.createOrder方法的返回值

# 8. trace — 追踪方法调用链耗时
[arthas@12345]$ trace com.example.OrderService createOrder
# 追踪方法内部每个子调用的耗时
```

### Dashboard 输出解读

```
 dashboard
┌──────────────────────────────────────────────────────────┐
│ Memory                     │ GC                          │
│ heap: 2.0G  used: 1.5G     │ gc.ps.scavenge.count: 245   │
│  eden: 800M  used: 750M    │ gc.ps.scavenge.time: 3456ms │ ← 新生代GC(Minor)
│  survivor: 100M used: 45M  │ gc.ps.markSweep.count: 5    │
│  old: 1.1G   used: 705M    │ gc.ps.markSweep.time: 8923ms│ ← 老年代GC(Full)
│ nonheap: 256M used: 180M   │                             │
│ ─────────────────────────  │ ────────────────────────── │
│ 如果old.used持续增长       │ Full GC次数频繁(>5/min)     │
│ 且不下降 → 内存泄漏嫌疑     │ 且耗时长(>1s) → STW严重    │
└──────────────────────────────────────────────────────────┘
```

## 三、JDK 自带工具

### jmap — 堆内存映射

```bash
# 查看堆内存概况
jmap -heap <pid>
# 输出：Eden/Survivor/Old各区大小和使用率

# 查看对象统计（按占用大小排序，找最占内存的类）
jmap -histo <pid> | head -20
# 输出示例：
#  num     #instances         #bytes  class name
#    1:       1234567      123456789  [B  (byte数组)
#    2:        567890       45678901  java.lang.String
#    3:        345678       23456789  java.util.HashMap$Node

# 查看对象统计（只看存活对象）
jmap -histo:live <pid> | head -20
# :live 触发一次Full GC后统计

# 导出heap dump
jmap -dump:format=b,file=/tmp/heap.hprof <pid>
```

### jstack — 线程栈分析

```bash
# 查看线程堆栈（排查死锁、线程阻塞）
jstack <pid>

# 查看线程状态统计
jstack <pid> | grep "java.lang.Thread.State" | sort | uniq -c
# 输出示例：
#    15 RUNNABLE
#     3 BLOCKED       ← 阻塞线程（锁竞争）
#    42 WAITING       ← 等待中的线程
```

### jstat — GC统计

```bash
# 每隔1秒输出GC情况，共10次
jstat -gcutil <pid> 1000 10
# 输出示例：
#   S0     S1     E      O      M     YGC   YGCT   FGC   FGCT
#   0.00  45.23  78.56  65.34  92.1   245   3.456    5   8.923
#                                                 ↑Full GC次数 ↑Full GC总耗时
```

## 四、离线分析工具：MAT (Memory Analyzer Tool)

```
heap.hprof (堆转储文件)
       │
       ▼
┌───────────────────────────────────────────┐
│              MAT 分析流程                   │
│                                           │
│ 1. Leak Suspects Report（泄漏嫌疑报告）    │
│    → 自动分析可能的内存泄漏点               │
│                                           │
│ 2. Dominator Tree（支配树）                │
│    → 按对象保留内存大小排序                 │
│    → 找出"谁占的内存最多"                  │
│                                           │
│ 3. Histogram（直方图）                     │
│    → 按类统计对象数量和大小                 │
│    → 对比Shallow Size vs Retained Size    │
│                                           │
│ 4. Path to GC Roots（GC根引用链）          │
│    → 查看对象为什么没被回收                 │
│    → 找到阻止GC的引用链                    │
└───────────────────────────────────────────┘

关键概念：
  Shallow Size  = 对象自身占用的内存
  Retained Size = 对象被回收后能释放的总内存（包括引用链上的对象）

  Retained Size >> Shallow Size 的对象 → 内存泄漏嫌疑
```

## 五、完整排查流程

```
步骤1：发现异常
  监控告警：Full GC频繁 / OOM / 响应变慢
       │
       ▼
步骤2：在线诊断（Arthas）
  dashboard → 看哪个内存区域不正常
  jmap -histo → 哪个类对象最多
       │
       ▼
步骤3：导出heap dump
  heapdump /tmp/heap.hprof
       │
       ▼
步骤4：离线分析（MAT）
  Dominator Tree → 定位最大的Retained Size对象
  Path to GC Roots → 找引用链
       │
       ▼
步骤5：定位代码
  找到泄漏对象是哪个类 → 对应哪个模块的代码
  Arthas watch/trace → 确认创建/引用的代码位置
       │
       ▼
步骤6：修复 + 验证
  修复后用jstat确认Full GC频率下降
```

## 六、面试加分点

1. **提到Arthas的redefine命令**：可以热更新class文件，不停机修复线上bug
2. **提到Prometheus + Grafana监控**：生产环境应该有JVM监控面板，而不是等出问题再手动排查
3. **提到Shallow Size vs Retained Size的区别**：这是MAT分析的核心概念
4. **提到AI场景的特殊性**：AI应用中模型对象（权重、KV Cache）可能占用大量直接内存，需要特别关注Native Memory
5. **提到JFR(Java Flight Recorder)**：JDK 11+内置的低开销性能采集工具，适合长期运行的生产环境
