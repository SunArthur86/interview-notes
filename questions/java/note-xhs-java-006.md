---
id: note-xhs-java-006
difficulty: L3
category: java
subcategory: JVM
tags:
- Java
- JVM
- 内存排查
- OOM
- MAT
- 面经
- 大厂
feynman:
  essence: 线上内存过高本质分两类——瞬时峰值（流量突增导致短期对象堆积）和持续泄露（对象被引用无法回收），排查路径是监控发现→jmapdump→MAT分析大对象/GCRoot→定位代码修复。
  analogy: 像水管漏水——瞬时峰值是突然开大水龙头（流量洪峰），水池满了但关了就好；持续泄露是水管有个暗漏（代码持有引用不释放），水池一直涨直到溢出（OOM）。
  key_points:
  - 先区分瞬时峰值 vs 持续泄露——看GC后内存是否回落
  - jmap -dump:format=b,file=heap.hprof <pid> 生成堆转储
  - MAT的Dominator Tree找最大对象，Leak Suspects找泄露路径
  - GC Root引用链是定位泄露的关键——谁持有对象不让回收
  - 常见泄露：静态集合无限增长、ThreadLocal未清理、监听器未注销
first_principle:
  essence: JVM内存管理 = 分代回收 + 可达性分析，内存过高的根因是"对象存活时间超出预期"
  derivation: 对象分配在堆→GC通过GCRoot可达性判断存活→如果对象仍被引用(GCRoot可达)则不回收→持续引用导致Old区膨胀→FullGC频繁但仍回收不了→OOM
  conclusion: 排查内存 = 找出"本该被回收但仍被GCRoot引用"的对象，核心工具链是jmap+MAT
follow_up:
- jmap和jcmd的区别？生产环境用哪个更安全？
- MAT的Shallow Heap和Retained Heap有什么区别？
- 线上Full GC频繁但内存没泄露，可能是什么原因？（元空间/大对象/System.gc）
- 如何在不重启服务的情况下持续监控内存？
memory_points:
- 一句话：内存排查三步走——监控告警→jmap dump→MAT Dominator Tree定位大对象
- 瞬时峰值看GC后是否回落，持续泄露看Old区单调递增
- jmap -dump必须在FGC前抓，否则可能OOM中断；用jmap -histo:live先快速看对象分布
- MAT核心：Dominator Tree看谁占内存最大，Path to GC Roots看谁不释放
- 常见泄露Top3：静态Map无限put、ThreadLocal忘remove、内部类隐式持有外部类引用
---

# 【大厂面试】线上 Java 内存占用过高怎样排查解决？

> 来源：小红书 JAVA 大厂面试题（2026最新面试题库）

## 一、问题分类——先判断是哪种"高"

```
内存占用过高
    ├── 瞬时峰值（流量洪峰/大查询）
    │   ├── 特征：GC后内存明显回落
    │   └── 对策：扩容 + JVM参数调优 + 限流
    │
    └── 持续泄露（代码Bug）
        ├── 特征：Old区单调递增，Full GC后不回落
        └── 对策：dump分析 → 定位引用链 → 修代码
```

**判断方法**：连续观察 3 次 Full GC 后的 Old 区使用量：
- 如果每次GC后回落明显 → 瞬时峰值
- 如果GC后依然高位甚至递增 → 持续泄露

## 二、排查工具链

### 第一步：监控发现（告警先行）

```bash
# 1. 查看进程内存概况
jstat -gcutil <pid> 1000 5
#  输出：S0  S1   E    O    M   CCS  YGC  YGCT  FGC  FGCT  GCT
#        0  100  85   92   78  70   120  3.5   15   8.2   11.7
#  O=92% → Old区快满了，FGC=15次且还在涨

# 2. 快速看对象分布（不dump，轻量）
jmap -histo:live <pid> | head -20
#  按对象数量排序，快速定位哪种对象异常多

# 3. 看线程栈（排除线程导致泄露）
jstack <pid> > thread_dump.txt
```

### 第二步：生成堆转储

```bash
# 方式1：手动dump（会STW，生产慎用）
jmap -dump:format=b,file=/tmp/heap.hprof <pid>

# 方式2：JVM启动参数预设OOM自动dump（推荐）
-XX:+HeapDumpOnOutOfMemoryError
-XX:HeapDumpPath=/data/dumps/

# 方式3：Arthas在线诊断（不重启）
heapdump /tmp/heap.hprof
```

> **避坑**：jmap dump会触发STW（Stop-The-World），生产高峰期可能卡顿数秒。建议在低峰期操作或使用Arthas。

### 第三步：MAT 分析（核心环节）

MAT（Memory Analyzer Tool）的三个核心视图：

```
┌─────────────────────────────────────────────┐
│              MAT 分析流程                      │
├─────────────────────────────────────────────┤
│                                              │
│  1. Leak Suspects Report（自动泄露报告）      │
│     → 自动分析可能的泄露点                    │
│     → 优先看 "Problem Suspect 1"             │
│                                              │
│  2. Dominator Tree（支配树）                  │
│     → 按Retained Size排序                    │
│     → 找最大的对象→谁持有了最多内存            │
│                                              │
│  3. Path to GC Roots（引用链）               │
│     → 右键对象 → Merge Shortest Paths        │
│     →       → exclude weak/soft references   │
│     → 找到阻止回收的GC Root                   │
│                                              │
└─────────────────────────────────────────────┘
```

**关键概念——Shallow Heap vs Retained Heap**：

| 概念 | 含义 | 实例 |
|------|------|------|
| Shallow Heap | 对象自身占用的内存 | 一个ArrayList对象头=16字节 |
| Retained Heap | 对象被回收后能释放的总内存 | ArrayList + 里面所有元素 = 10MB |

> 排查时**只看 Retained Heap**，它才代表"如果回收这个对象能省多少内存"。

## 三、常见内存泄露场景及修复

### 场景1：静态集合无限增长

```java
// BUG：静态Map不断put从不remove
public class CacheManager {
    private static final Map<String, Object> CACHE = new HashMap<>();
    // 随时间推移CACHE无限膨胀，Old区持续增长
    
    public static void put(String key, Object val) {
        CACHE.put(key, val); // 从不清理！
    }
}

// 修复：使用有界缓存
public class CacheManager {
    private static final Map<String, Object> CACHE = 
        new LinkedHashMap<>(1000, 0.75f, true) {
            @Override
            protected boolean removeEldestEntry(Map.Entry eldest) {
                return size() > 10000; // 限制最大1万条
            }
        };
    // 或直接用Caffeine/Guava Cache设置过期时间
}
```

### 场景2：ThreadLocal 未清理

```java
// BUG：线程池中ThreadLocal忘记remove
executor.submit(() -> {
    ThreadLocal<BigObject> tl = new ThreadLocal<>();
    tl.set(new BigObject(1024 * 1024)); // 1MB
    // 业务逻辑...
    // 忘记 tl.remove()！线程池复用→ThreadLocal永不回收
});

// 修复：finally中remove
executor.submit(() -> {
    ThreadLocal<BigObject> tl = new ThreadLocal<>();
    try {
        tl.set(new BigObject(1024 * 1024));
        // 业务逻辑...
    } finally {
        tl.remove(); // 必须清理！
    }
});
```

### 场景3：监听器/回调未注销

```java
// BUG：注册了Listener但从未取消
public class EventService {
    public void init() {
        eventBus.register(new MyListener()); 
        // 每次init都注册新的，旧的永不释放
    }
}

// 修复：注册时记录引用，销毁时unregister
public class EventService {
    private MyListener listener;
    public void init() {
        listener = new MyListener();
        eventBus.register(listener);
    }
    public void destroy() {
        eventBus.unregister(listener); // 注销
    }
}
```

## 四、面试加分点

1. **体系化回答**：先分类（峰值vs泄露）→ 再说工具链（jstat→jmap→MAT）→ 最后举例常见泄露场景
2. **Retained Heap vs Shallow Heap**：能说出区别，并强调排查时只看Retained
3. **生产安全意识**：提到jmap dump会STW，建议低峰操作或用Arthas在线诊断
4. **预防优于治疗**：提到JVM参数 `HeapDumpOnOutOfMemoryError` 提前配置
5. **GC Root类型**：能列举常见GC Root——虚拟机栈中的引用、静态变量、JNI引用、活跃线程


## 结构化回答

**30 秒电梯演讲：** 线上内存过高本质分两类——瞬时峰值（流量突增导致短期对象堆积）和持续泄露（对象被引用无法回收），排查路径是监控发现→jmapdump→MAT分析大对象/GCRoot→定位代码修复。

**展开框架：**
1. **一句话** — 内存排查三步走——监控告警→jmap dump→MAT Dominator Tree定位大对象
2. **瞬时峰值看GC后是否回落** — 瞬时峰值看GC后是否回落，持续泄露看Old区单调递增
3. **jmap -dump必须** — jmap -dump必须在FGC前抓，否则可能OOM中断；用jmap -histo:live先快速看对象分布

**收尾：** 这块我踩过坑——要不要深入聊：jmap和jcmd的区别？生产环境用哪个更安全？

## 视频脚本

> 预计时长：3 分钟 | 由浅入深

| 时间 | 画面/字幕 | 口播台词 | 讲解要点 |
|------|----------|----------|----------|
| 0:00 | 标题卡 | "JVM一句话：线上内存过高本质分两类——瞬时峰值（流量突增导致短期对象堆积）和持续泄露（对象被引用无法回收）…。" | 开场钩子 |
| 0:15 | 二叉树结构图 | "一句话：内存排查三步走——监控告警到jmap dump到MAT Dominator Tree定位大对象" | 一句话 |
| 1:06 | 二叉树结构图分步演示 | "瞬时峰值看GC后是否回落，持续泄露看Old区单调递增" | 瞬时峰值看GC后是否回落 |
| 1:57 | 关键代码/伪代码片段 | "jmap -dump必须在FGC前抓，否则可能OOM中断；用jmap -histo:live先快速看对象分布" | jmap -dump必须 |
| 2:50 | 总结卡 | "核心抓住这条主线，下期咱们接着聊：jmap和jcmd的区别？生产环境用哪个更安全。" | 收尾 |

## 苏格拉底式面试追问

| 追问层级 | 面试官可能这样问 | 高分回答方向 |
|----------|------------------|--------------|
| 目标追问 | 线上内存占用过高，你排查的第一目标是什么？ | 第一目标是区分两类根因——瞬时峰值（流量突增短期对象堆积）还是持续泄露（对象被引用无法回收），决定处置方向完全不同 |
| 证据追问 | 你怎么证明是泄漏而不是正常高负载？拿什么数据说话？ | 对比多次Heap Dump的对象数量趋势、看老年代占用持续上涨不回落、jstat看GC后老年代不释放、MAT的leak suspect报告 |
| 边界追问 | 什么场景下内存高是正常的，不需要当泄漏处理？ | 大促/秒杀短期峰值、批处理任务临时加载大数据、缓存预热阶段、JVM刚启动元空间膨胀——这些会自行回落 |
| 反例追问 | 如果GC很频繁但内存没降，一定是泄漏吗？ | 不一定，可能是大对象进老年代触发Full GC但能回收（如大List用完即弃），也可能是缓存有上限但容量设置过大 |
| 风险追问 | dump Heap会STW影响线上业务，你怎么降低风险？ | 用jcmd/JMap live选项触发GC减少体积、低峰期操作、只dump单实例而非集群、先摘除流量再dump |
| 验证追问 | 修完之后怎么验证泄漏真的解决了？ | 持续监控老年代曲线是否平稳、Full GC频率下降、多次dump对比大对象是否消失、压测复现验证 |
| 沉淀追问 | 这类问题怎么沉淀成可复用的排查SOP？ | 沉淀为运维手册：告警阈值→jstat定位→jmap dump→MAT分析→定位引用链→修复→压测回归，配套监控大盘 |

### 现场对话示例
**面试官**：线上Java内存占用过高怎么排查？
**候选人**：先区分瞬时峰值还是持续泄漏：看老年代曲线是否只涨不降，再jstat看GC后是否释放，最后jmap dump用MAT分析大对象引用链。
**面试官**：你怎么判断是泄漏而不是正常高负载？
**候选人**：多次dump对比对象数量趋势、老年代持续上涨不回落就是泄漏；会自行回落的就是峰值，处置方式完全不同。
**面试官**：dump Heap会影响线上，你怎么处理？
**候选人**：低峰期操作、用live选项先GC减小体积、摘除单实例流量再dump，避免STW影响整体可用性。
