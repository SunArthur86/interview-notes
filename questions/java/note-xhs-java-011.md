---
id: note-xhs-java-011
difficulty: L3
category: java
subcategory: JVM
tags:
- 拼多多
- Java服务端
- OOM
- HeapDump
- MAT
- 内存排查
- JVM
- 面经
feynman:
  essence: "线上OOM排查的核心是拿到Heap Dump文件，用MAT分析大对象和引用链，定位是内存泄漏还是内存溢出"
  analogy: "就像家里水管爆了——先关总阀（限流降级），然后拍照取证（Dump），最后请管道工（MAT）分析是哪个水管漏了（哪个对象泄漏了）"
  key_points:
  - OOM类型：堆溢出、元空间溢出、GC开销超限、直接内存溢出
  - 排查核心：Heap Dump → MAT分析 → 找到GC Root引用链
  - 关键参数：-XX:+HeapDumpOnOutOfMemoryError 自动生成Dump
  - MAT关键视图：Dominator Tree（支配树）、Leak Suspects（泄漏嫌疑）
  - 常见泄漏：静态集合不断增长、ThreadLocal未清理、连接未关闭
first_principle:
  essence: "OOM的本质是'内存需求超过供给'。要么是泄漏（垃圾无法回收），要么是溢出（确实用太多了）"
  derivation: "JVM堆有限→对象不断创建→GC回收速度跟不上→堆满→OutOfMemoryError→需要分析哪些对象占满了堆→Heap Dump→MAT找到引用链→定位代码"
  conclusion: "排查OOM = 拿到Dump + 分析大对象 + 追溯GC Root → 定位泄漏源"
follow_up:
- 如果OOM发生时没有生成Dump文件怎么办？（见note-xhs-java-012）
- 元空间OOM和堆OOM的排查方法有什么不同？
- 如何区分内存泄漏和内存溢出？处理方式有何不同？
- 线上频繁Full GC但没OOM，怎么排查？
- MAT的Shallow Heap和Retained Heap有什么区别？
memory_points:
- OOM排查三步：Dump → MAT → 定位引用链
- Heap Dump参数：-XX:+HeapDumpOnOutOfMemoryError -XX:HeapDumpPath=/path
- MAT两大视图：Dominator Tree看谁占内存大，Leak Suspects自动分析
- Retained Heap = 对象本身大小 + 它持有的所有引用大小
---

# 【拼多多 Java服务端】线上系统突然OOM了，怎么排查？

> 来源：拼多多211本硕Java服务端面经（已OC）（小红书）

## 一、OOM类型与排查总览

```
┌──────────────────────────────────────────────────────────┐
│                   OOM 排查决策树                           │
│                                                           │
│  OutOfMemoryError                                         │
│  ├── "Java heap space"                                    │
│  │   → 堆内存不足/内存泄漏                                 │
│  │   → 排查: Heap Dump + MAT                              │
│  │                                                        │
│  ├── "Metaspace"                                          │
│  │   → 元空间不足（类元数据太多）                          │
│  │   → 排查: -XX:MaxMetaspaceSize + 检查动态类生成         │
│  │                                                        │
│  ├── "GC overhead limit exceeded"                         │
│  │   → GC花费>98%时间但回收<2%堆                           │
│  │   → 排查: 同堆溢出，通常是泄漏的前兆                     │
│  │                                                        │
│  ├── "Direct buffer memory"                               │
│  │   → 堆外内存不足（Netty/NIO）                           │
│  │   → 排查: -XX:MaxDirectMemorySize + 检查ByteBuffer释放 │
│  │                                                        │
│  └── "unable to create new native thread"                 │
│      → 线程数超过限制                                      │
│      → 排查: ulimit -u / jstack看线程数                   │
└──────────────────────────────────────────────────────────┘
```

## 二、Heap Dump 分析流程

```
┌──────────────────────────────────────────────────┐
│  Step 1: 获取 Heap Dump                           │
│  ┌────────────────────────────────────────────┐  │
│  │ 方式A: JVM参数自动生成 (推荐)               │  │
│  │ -XX:+HeapDumpOnOutOfMemoryError            │  │
│  │ -XX:HeapDumpPath=/data/dumps/              │  │
│  │                                            │  │
│  │ 方式B: 手动触发                              │  │
│  │ jmap -dump:format=b,file=heap.hprof <pid> │  │
│  │                                            │  │
│  │ 方式C: jcmd (JDK11+)                        │  │
│  │ jcmd <pid> GC.heap_dump /data/dumps/heap  │  │
│  └────────────────────────────────────────────┘  │
│                      │                            │
│  Step 2: MAT (Memory Analyzer Tool) 分析          │
│  ┌────────────────────────────────────────────┐  │
│  │ Leak Suspects Report → 自动检测泄漏嫌疑      │  │
│  │ Dominator Tree      → 按Retained Heap排序   │  │
│  │ Histogram           → 按类统计对象数量       │  │
│  │ Thread Overview     → 查看各线程内存使用     │  │
│  └────────────────────────────────────────────┘  │
│                      │                            │
│  Step 3: 定位引用链                                │
│  ┌────────────────────────────────────────────┐  │
│  │ 右键大对象 → Path To GC Roots               │  │
│  │           → exclude weak/soft references    │  │
│  │           → 找到是谁持有了这个对象的引用     │  │
│  └────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────┘
```

## 三、MAT 关键概念

### 3.1 Shallow Heap vs Retained Heap

| 概念 | 含义 | 例子 |
|------|------|------|
| Shallow Heap | 对象自身占用的内存 | ArrayList对象头+内部数组指针 ≈ 48字节 |
| Retained Heap | 对象被回收后能释放的总内存 | ArrayList + 内部所有元素 ≈ 列表总大小 |
| Deep Heap | 同Retained Heap（去除共享部分后） | 与Retained略有差异 |

### 3.2 常见泄漏模式

```java
// 模式1: 静态集合无限增长
public class CacheManager {
    private static final Map<String, Object> CACHE = new HashMap<>();
    // 只put不remove → 永不回收 → 泄漏!
    public static void put(String key, Object val) {
        CACHE.put(key, val);
    }
}

// 模式2: ThreadLocal未清理（见note-xhs-java-008）
// 模式3: 连接未关闭
public void query() {
    Connection conn = dataSource.getConnection();
    // 异常时conn未关闭 → 连接泄漏 → 最终耗尽连接池
    // 解决: try-with-resources
}

// 模式4: 监听器/回调未注销
public void register() {
    EventBus.register(this);  // 注册了但从不unregister
}
```

## 四、线上应急流程

```bash
# 1. 紧急：重启应用恢复服务
kubectl rollout restart deployment my-app

# 2. 保留现场：如果Dump参数已配，从日志找Dump路径
grep "HeapDump" /app/logs/stdout.log
# 输出: java.lang.OutOfMemoryError: Java heap space
#       Dumping heap to /data/dumps/java_pid12345.hprof ...

# 3. 检查是否真的生成了
ls -lh /data/dumps/*.hprof

# 4. 下载到本地用MAT分析
scp user@server:/data/dumps/java_pid12345.hprof ./

# 5. 如果没配Dump参数，手动在下次OOM前触发
# (但此时可能已经来不及了，见note-xhs-java-012)
jmap -dump:format=b,file=/data/dumps/manual.hprof <pid>
```

## 五、面试加分点

1. **在线分析工具**：Arthas的 `heapdump /tmp/dump.hprof` 可在不停止JVM的情况下生成Dump
2. **JFR (Java Flight Recorder)**：JDK11+内置的低开销持续监控，可在OOM前捕捉到内存增长趋势
3. **提前预警**：通过JMX监控 `HeapMemoryUsage.used / max` 比值，超过80%时告警
4. **GC日志分析**：GCEasy（gceasy.io）在线分析GC日志，判断是否GC效率低下导致
5. **容器环境注意**：Docker中Dump文件可能很大（等于堆大小），确保挂载了足够的磁盘空间


## 结构化回答

**30 秒电梯演讲：** 线上OOM排查的核心是拿到Heap Dump文件，用MAT分析大对象和引用链，定位是内存泄漏还是内存溢出。打个比方，就像家里水管爆了——先关总阀（限流降级），然后拍照取证（Dump），最后请管道工（MAT）分析是哪个水管漏了（哪个对象泄漏了）。

**展开框架：**
1. **OOM排查三步** — Dump → MAT → 定位引用链
2. **Heap Dump参数** — -XX:+HeapDumpOnOutOfMemoryError -XX:HeapDumpPath=/path
3. **MAT两大视图** — Dominator Tree看谁占内存大，Leak Suspects自动分析

**收尾：** 这块我踩过坑——要不要深入聊：如果OOM发生时没有生成Dump文件怎么办？（见note-xhs-java-012）？

## 视频脚本

> 预计时长：3 分钟 | 由浅入深

| 时间 | 画面/字幕 | 口播台词 | 讲解要点 |
|------|----------|----------|----------|
| 0:00 | 标题卡 | "JVM一句话：线上OOM排查的核心是拿到Heap Dump文件，用MAT分析大对象和引用链…。" | 开场钩子 |
| 0:15 | 图遍历示意图 | "OOM排查三步：Dump 到 MAT 到 定位引用链" | OOM排查三步 |
| 1:06 | 图遍历示意图分步演示 | "Heap Dump参数：-XX:+HeapDumpOnOutOfMemoryError -XX:HeapDumpPa…" | Heap Dump参数 |
| 1:57 | 关键代码/伪代码片段 | "MAT两大视图：Dominator Tree看谁占内存大，Leak Suspects自动分析" | MAT两大视图 |
| 2:50 | 总结卡 | "核心抓住这条主线，下期咱们接着聊：如果OOM发生时没有生成Dump文件怎么办？（见note-xhs-java-012）。" | 收尾 |

## 苏格拉底式面试追问

| 追问层级 | 面试官可能这样问 | 高分回答方向 |
|----------|------------------|--------------|
| 目标追问 | 线上OOM排查的第一目标是什么？为什么不能直接重启？ | 第一目标是拿到Heap Dump定位根因；直接重启会丢失现场无法定位，要先保留dump再重启恢复服务 |
| 证据追问 | 怎么知道是哪种OOM？不同OOM处置一样吗？ | 看异常类型：Java heap space是堆溢出、Metaspace是元空间、GC overhead是GC过于频繁、Direct buffer是堆外内存，处置方案不同 |
| 边界追问 | 所有OOM都需要立即dump吗？什么情况可以缓？ | 堆OOM必须立即dump（核心现场）；Metaspace/GC overhead可适当延后；但要配-XX:+HeapDumpOnOutOfMemoryError自动dump |
| 反例追问 | 有了Heap Dump就一定能找到根因吗？ | 不一定。如果是瞬时大对象（如加载大文件）dump时已被GC，或泄漏很缓慢dump看不出明显大对象，需要多次dump对比趋势 |
| 风险追问 | dump文件可能很大，怎么处理不占满磁盘？ | 配-XX:HeapDumpPath指向大磁盘、设置轮转保留策略、dump后压缩传输、监控磁盘容量告警 |
| 验证追问 | 修完之后怎么确认OOM不再发生？ | 压测复现场景验证、监控堆内存曲线平稳、设置OOM告警、定期review GC日志确认无异常 |
| 沉淀追问 | OOM应急预案怎么沉淀成流程？ | 规范：自动dump参数必配、告警→dump→重启三步SOP、dump自动化分析、根因复盘文档 |

### 现场对话示例
**面试官**：线上系统突然OOM了，怎么排查？
**候选人**：先保留Heap Dump别急着重启，用MAT分析大对象和引用链定位是泄漏还是大对象，看异常类型判断堆/Metaspace/GC overhead。
**面试官**：为什么不能直接重启？
**候选人**：重启会丢失现场，下次还会复现；必须先dump保留证据定位根因，再重启恢复服务。
**面试官**：dump文件很大怎么处理？
**候选人**：配-XX:+HeapDumpOnOutOfMemoryError自动dump到大磁盘、设置轮转保留、dump后压缩传输、监控磁盘避免写满。
