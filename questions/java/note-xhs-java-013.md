---
id: note-xhs-java-013
difficulty: L4
category: java
subcategory: JVM
tags:
- 拼多多
- Java服务端
- G1
- MixedGC
- Region
- 垃圾回收
- JVM
- 面经
feynman:
  essence: "G1将堆划分为多个等大Region（1-32MB），Mixed GC同时回收新生代和部分老年代Region，触发条件是堆使用率超过InitiatingHeapOccupancyPercent(默认45%)"
  analogy: "G1就像城市环卫系统——把城市分成若干街区（Region），每个街区可以是住宅区（Eden）、商业区（Old）或空地（Free）。Mixed GC就是大扫除时，不仅清理住宅区，还挑选商业区里最脏的几个一起打扫"
  key_points:
  - G1堆被划分为2048个左右的Region（等大，1-32MB）
  - Region角色可变：Eden/Survivor/Old/Humongous
  - Mixed GC = Young GC + 部分Old Region回收
  - 触发条件：堆使用率 > IHOP(默认45%)
  - Mixed GC由多个GC cycle组成，每轮回收一部分Old Region
first_principle:
  essence: "G1的设计目标是'可预测的停顿时间'。通过Region化+优先回收垃圾最多的Region实现"
  derivation: "传统GC全堆扫描→停顿时间长→将堆分成Region→每次只回收部分Region→控制停顿时间→优先选垃圾最多的Region(Garbage First)→Mixed GC在Young GC基础上额外回收Old Region"
  conclusion: "G1 = Region化堆 + 垃圾优先策略 + 可预测停顿时间。Mixed GC是G1回收老年代的核心机制"
follow_up:
- G1和CMS有什么区别？为什么JDK9默认G1？
- G1的Remembered Set是什么？有什么作用？
- Humongous Region是什么？什么时候产生？
- G1的Full GC触发条件是什么？（分配失败、Evacuation Failure）
- 如何调优G1的停顿时间目标？
memory_points:
- Region大小 = 1~32MB，由 -XX:G1HeapRegionSize 指定
- IHOP默认45%：堆使用率超过45%触发并发标记→Mixed GC
- Mixed GC回收范围 = 全部Young + 部分Old（垃圾最多的优先）
- -XX:MaxGCPauseMillis=200 控制目标停顿时间
---

# 【拼多多 Java服务端】G1收集器的Mixed GC触发条件是什么？Region大小怎么划分？

> 来源：拼多多211本硕Java服务端面经（已OC）（小红书）

## 一、G1 堆内存 Region 划分

```
┌──────────────────────────────────────────────────────────────┐
│                    G1 堆内存布局                                │
│                                                               │
│   ┌────┬────┬────┬────┬────┬────┬────┬────┬────┬────┐        │
│   │ E  │ E  │ S  │ O  │ O  │ O  │ H  │ H  │ F  │ F  │        │
│   ├────┼────┼────┼────┼────┼────┼────┼────┼────┼────┤        │
│   │ O  │ E  │ O  │ S  │ O  │ F  │ O  │ E  │ O  │ F  │        │
│   └────┴────┴────┴────┴────┴────┴────┴────┴────┴────┘        │
│                                                               │
│   E = Eden    S = Survivor  O = Old    H = Humongous          │
│   F = Free (未分配)                                            │
│                                                               │
│   每个 Region 大小相等: 1MB ~ 32MB (2的幂)                     │
│   总数约 2048 个                                               │
│   Region 大小 = Max(1MB, Min(32MB, heap_size / 2048))         │
│                                                               │
│   ┌─────────────────────────────────────┐                    │
│   │  Region 大小计算示例:                │                    │
│   │  Heap = 4GB (4096MB)               │                    │
│   │  4096 / 2048 = 2MB                  │                    │
│   │  → 每个Region = 2MB                 │                    │
│   │                                      │                    │
│   │  Heap = 32GB                        │                    │
│   │  32768 / 2048 = 16MB                │                    │
│   │  → 每个Region = 16MB                │                    │
│   └─────────────────────────────────────┘                    │
│                                                               │
│   Humongous Region: 大对象(>Region/2)独占连续多个Region        │
│   例: Region=2MB, 大对象=5MB → 占3个连续Region                │
└──────────────────────────────────────────────────────────────┘
```

## 二、G1 GC 类型

| GC类型 | 回收范围 | 触发条件 | 停顿类型 |
|--------|---------|---------|---------|
| Young GC | Eden + Survivor | Eden区满 | STW |
| Mixed GC | Young + 部分Old | IHOP阈值 + 并发标记完成 | STW |
| Full GC | 整个堆 | Evacuation Failure / 分配失败 | STW（单线程，很慢!） |

## 三、Mixed GC 完整流程

```
┌─────────────────────────────────────────────────────────────┐
│              G1 Mixed GC Cycle (多轮)                        │
│                                                              │
│  Phase 1: 初始标记 (Initial Mark)                            │
│  ┌─────────────────────────────────────────┐                │
│  │ 标记GC Root直接引用的对象                  │                │
│  │ STW， piggyback在一次Young GC上            │                │
│  └──────────────────┬──────────────────────┘                │
│                     │                                        │
│  Phase 2: 根区域扫描 (Root Region Scan)                      │
│  ┌─────────────────────────────────────────┐                │
│  │ 扫描Survivor Region引用的Old Region        │                │
│  │ 并发执行，不停顿应用                        │                │
│  └──────────────────┬──────────────────────┘                │
│                     │                                        │
│  Phase 3: 并发标记 (Concurrent Mark)                         │
│  ┌─────────────────────────────────────────┐                │
│  │ 从GC Root遍历整个对象图                    │                │
│  │ 并发执行，不停顿应用                        │                │
│  │ 同时处理SATB(snapshot-at-the-beginning)   │                │
│  └──────────────────┬──────────────────────┘                │
│                     │                                        │
│  Phase 4: 重新标记 (Remark)                                  │
│  ┌─────────────────────────────────────────┐                │
│  │ 处理SATB缓冲区，修正并发标记期间的变更      │                │
│  │ STW                                       │                │
│  └──────────────────┬──────────────────────┘                │
│                     │                                        │
│  Phase 5: 清理 (Cleanup)                                     │
│  ┌─────────────────────────────────────────┐                │
│  │ 统计每个Region的存活对象数量                │                │
│  │ 排序Region（按垃圾比例GARBAGE FIRST）      │                │
│  │ 选择本轮要回收的Old Region集合(CSet)        │                │
│  │ 部分STW                                    │                │
│  └──────────────────┬──────────────────────┘                │
│                     │                                        │
│  Phase 6: 拷贝/疏散 (Evacuation) = Mixed GC!                 │
│  ┌─────────────────────────────────────────┐                │
│  │ 回收全部Young Region + 选中的Old Region    │                │
│  │ 存活对象拷贝到Free Region                  │                │
│  │ STW，这是Mixed GC的核心阶段                │                │
│  └─────────────────────────────────────────┘                │
│                                                              │
│  ⚠️ Mixed GC会执行多轮(默认8轮)，每轮回收一部分Old Region    │
│     直到Old Region比例降到IHOP阈值以下                       │
└─────────────────────────────────────────────────────────────┘
```

## 四、Mixed GC 触发条件详解

```bash
# 核心触发参数
-XX:+UseG1GC
-XX:MaxGCPauseMillis=200          # 目标停顿时间(默认200ms)
-XX:GCPauseIntervalMillis=1000    # GC间隔(可选)
-XX:InitiatingHeapOccupancyPercent=45  # IHOP阈值(默认45%)
-XX:G1HeapWastePercent=5          # 允许浪费的堆比例(默认5%)
-XX:G1MixedGCCountTarget=8        # Mixed GC轮数目标(默认8)
-XX:G1MixedGCLiveThresholdPercent=85  # Old Region存活率超此值不回收(默认85%)
-XX:G1HeapRegionSize=16m          # Region大小(可选)
```

```
触发链路:
  堆使用率 > IHOP(45%)
       │
       ▼
  开启并发标记周期(Phase 1-5)
       │
       ▼
  标记完成，识别出垃圾最多的Old Region
       │
       ▼
  触发Mixed GC(Phase 6) × N轮
       │
       ▼
  每轮回收: 全部Young + 1/N的Old Region
       │
       ▼
  直到 Old Region总占比 < IHOP → 停止Mixed GC
```

## 五、面试加分点

1. **自适应IHOP**：JDK9+支持 `-XX:+G1UseAdaptiveIHOP`，JVM根据历史GC数据动态调整IHOP阈值，比固定值更智能
2. **Remembered Set**：每个Region维护RSet记录"谁引用了我"，避免全堆扫描。RSet本身也占堆空间（约1%-20%）
3. **Evacuation Failure**：Mixed GC时没有足够的Free Region存放存活对象 → 触发Full GC（串行，非常慢，需极力避免）
4. **G1 vs ZGC**：ZGC（JDK15+）使用染色指针+读屏障，实现<1ms停顿，但吞吐量低于G1
5. **G1调优核心**：不要手动设太小的Region和太短的停顿目标——目标停顿时间越短，Mixed GC每轮回收的Old Region越少，总周期越长


## 结构化回答

**30 秒电梯演讲：** G1将堆划分为多个等大Region（1-32MB），Mixed GC同时回收新生代和部分老年代Region，触发条件是堆使用率超过InitiatingHeapOccupancyPercent(默认45%)。

**展开框架：**
1. **Region大小** — Region大小 = 1~32MB，由 -XX:G1HeapRegionSize 指定
2. **IHOP默认45%** — 堆使用率超过45%触发并发标记→Mixed GC
3. **Mixed GC回收范围** — Mixed GC回收范围 = 全部Young + 部分Old（垃圾最多的优先）

**收尾：** 这块我踩过坑——要不要深入聊：G1和CMS有什么区别？为什么JDK9默认G1？

## 视频脚本

> 预计时长：4 分钟 | 由浅入深

| 时间 | 画面/字幕 | 口播台词 | 讲解要点 |
|------|----------|----------|----------|
| 0:00 | 标题卡 | "JVM一句话：G1将堆划分为多个等大Region（1-32MB），Mixed GC同时回收新生代和部分老年代Region…。" | 开场钩子 |
| 0:15 | JVM 内存模型与 GC 流程图 | "Region大小 就是 1~32MB，由 -XX:G1HeapRegionSize 指定" | Region大小 |
| 1:08 | JVM 内存模型与 GC 流程图分步演示 | "IHOP默认45%：堆使用率超过45%触发并发标记到Mixed GC" | IHOP默认45% |
| 2:01 | 关键代码/伪代码片段 | "Mixed GC回收范围 就是 全部Young + 部分Old（垃圾最多的优先）" | Mixed GC回收范围 |
| 2:54 | 对比表格 | "XX:MaxGCPauseMillis就是200 控制目标停顿时间" | XX |
| 3:50 | 总结卡 | "核心抓住这条主线，下期咱们接着聊：G1和CMS有什么区别？为什么JDK9默认G1。" | 收尾 |

## 苏格拉底式面试追问

| 追问层级 | 面试官可能这样问 | 高分回答方向 |
|----------|------------------|--------------|
| 目标追问 | G1的Mixed GC想解决什么问题？和Full GC区别是什么？ | 解决老年代碎片化和回收效率——Mixed GC同时回收新生代+部分老年代Region，避免Full GC的长时间STW；Full GC是兜底单线程串行极慢 |
| 证据追问 | Mixed GC的触发条件具体是什么？怎么计算？ | 触发条件：堆使用率超过-XX:InitiatingHeapOccupancyPercent（默认45%）、或G1内部预测下一次GC会超MaxGCPauseMillis；看日志Mixed GC pause |
| 边界追问 | Region大小怎么划分？为什么是1-32MB？ | Region大小由-XX:G1HeapRegionSize指定，JVM根据堆大小自动选择2的幂（1/2/4/8/16/32MB），平衡大对象的Humongous分配和管理开销 |
| 反例追问 | 如果一直只做Young GC不做Mixed GC会怎样？ | 老年代持续增长直到触发Full GC（concurrent mode failure），Full GC是单线程串行STW极长，是G1要极力避免的灾难场景 |
| 风险追问 | Mixed GC太频繁或暂停时间过长怎么调？ | 调IHOP降低触发灵敏度、调G1HeapRegionSize、增大堆、调MaxGCPauseMillis放宽目标、避免大对象分配触发Humongous |
| 验证追问 | 怎么确认G1在做Mixed GC而不是Full GC？ | 看GC日志的'Mixed GC'关键字、jstat看OGC老年代变化、监控STW时长、Full GC计数器应为0 |
| 沉淀追问 | G1调优参数怎么沉淀成规范？ | 规范：堆4GB以上用G1、IHOP和MaxGCPauseMillis按业务SLA调、必开GC日志、监控Mixed GC频率和STW |

### 现场对话示例
**面试官**：G1的Mixed GC触发条件是什么？Region大小怎么划分？
**候选人**：Mixed GC在堆使用率超IHOP（默认45%）或预测超MaxGCPauseMillis时触发，回收新生代+部分老年代Region；Region按堆大小自动选1-32MB的2的幂。
**面试官**：为什么要有Mixed GC，只做Young GC不行吗？
**候选人**：只做Young GC老年代会涨到触发Full GC，Full GC单线程串行STW极长是灾难；Mixed GC分批回收老年代避免Full GC。
**面试官**：Mixed GC暂停时间过长怎么调？
**候选人**：调低IHOP、放宽MaxGCPauseMillis、增大堆、调G1HeapRegionSize、排查Humongous大对象分配，目标是STW在SLA内。
