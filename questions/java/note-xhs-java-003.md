---
id: note-xhs-java-003
difficulty: L4
category: java
subcategory: 并发
tags:
- ConcurrentHashMap
- CAS
- synchronized
- 并发
- 线程安全
feynman:
  essence: ConcurrentHashMap 是线程安全的HashMap。1.7用分段锁（把数据切成16段每段一把锁），1.8改为锁单个桶头节点+CAS，粒度更细并发更高。
  analogy: "想象一个大食堂：1.7 版本是分成16个独立小餐厅每个有自己的门锁（最多16人同时吃饭）；1.8 版本是开放大食堂，每张桌子有自己的锁（几百人同时吃不同桌）。"
  key_points:
  - 1.7=Segment+ReentrantLock，并发度固定16
  - 1.8=CAS+synchronized锁桶头，并发度=桶数
  - 1.8引入红黑树优化最坏O(n)为O(log n)
  - synchronized经过JVM锁升级优化后性能不输ReentrantLock
  - size()用baseCount+CounterCell分散CAS热点
first_principle:
  problem: "多线程并发读写HashMap需要保证线程安全，但全局锁（Hashtable）并发度太低，如何实现高并发安全哈希表？"
  axioms:
  - 锁粒度越细，并发度越高
  - 无锁（CAS）比有锁性能更好但只适用于简单操作
  - 锁升级（偏向→轻量→重量）可以兼顾无竞争和有竞争场景
  - 分散热点（CounterCell）比单点CAS在高并发下吞吐量更高
  rebuild: "从并发安全哈希表需求出发：全局锁→分段锁(1.7)→桶级锁+CAS(1.8)，每次演进都在降低锁粒度，同时利用JVM锁优化和CPU原子指令减少开销"
follow_up:
- ConcurrentHashMap 的 get() 需要加锁吗？为什么？
- ConcurrentHashMap 的 put 为什么不允许 null key/value？
- CounterCell 和 LongAdder 的关系是什么？
- 1.8 的 ConcurrentHashMap 在扩容时如何支持并发？
---

# ConcurrentHashMap JDK 1.7 和 1.8 的差异与优化？（华为od Java一面）

## 一、架构对比

```
JDK 1.7: 分段锁（Segment）
┌───────────────────────────────────┐
│  ConcurrentHashMap                │
│  ┌──────┐ ┌──────┐ ┌──────┐      │
│  │Seg 0 │ │Seg 1 │ │Seg 2 │ ...  │  ← 每个Segment是一把锁
│  │ReentrantLock                    │
│  │┌────┐│ │┌────┐│ │┌────┐│      │
│  ││HashEntry[]←链表               │
│  │└────┘│ │└────┘│ │└────┘│      │
│  └──────┘ └──────┘ └──────┘      │
└───────────────────────────────────┘
默认16个Segment → 最大并发度16

JDK 1.8: CAS + synchronized
┌───────────────────────────────────┐
│  ConcurrentHashMap                │
│  Node[] table (同一把锁的粒度=桶)  │
│  [0] → null                        │
│  [1] → Node → Node → ... (链表)   │  ← 锁单个桶头节点
│  [2] → TreeBin (红黑树)           │
│  ...                               │
│  [15] → Node                      │
└───────────────────────────────────┘
并发度 = 桶数量（远大于16）
```

## 二、JDK 1.8 put 流程

```
put(key, value)
    │
    ▼
① key/value 非空检查（CHM不允许null）
    │
    ▼
② hash = spread(key.hashCode())  ← (h ^ (h>>>16)) & HASH_BITS
    │
    ▼
③ tab == null → initTable() (CAS初始化)
    │
    ▼
④ f = tabAt(tab, i)  // CAS读桶头
    f == null?
    │        │
   是        否
    │        ▼
    │     ⑤ synchronized(f) {  // 锁住桶头节点
    │        链表→遍历插入/替换
    │        红黑树→putTreeVal
    │        }
    │        │
    ▼        ▼
⑥ casTabAt(tab, i, new Node)   addCount(1L) // CAS更新baseCount
   CAS放入空桶                 判断是否扩容
```

## 三、核心优化对比

| 维度 | JDK 1.7 | JDK 1.8 |
|------|---------|---------|
| 锁粒度 | Segment（段） | 桶头节点（更细粒度） |
| 锁实现 | ReentrantLock | synchronized + CAS |
| 数据结构 | HashEntry[] + 链表 | Node[] + 链表/红黑树 |
| 并发度 | 固定16（segments） | 等于桶数（动态扩展） |
| 查询复杂度 | O(n) 链表 | O(log n) 红黑树（≥8） |
| size() | 先尝试无锁累加，最多重试2次后加锁 | baseCount + CounterCell[] CAS累加 |

## 四、为什么 1.8 用 synchronized 而不是 ReentrantLock？

1. **锁粒度降低**：1.8 锁的是单个桶头节点，冲突概率极低
2. **JVM 优化**：偏向锁→轻量级锁→重量级锁的锁升级，无竞争时几乎零开销
3. **内存占用少**：不需要额外的 AQS 对象（每个 Segment 都是 ReentrantLock）
4. **CAS 处理空桶**：无竞争时直接 CAS 写入，连 synchronized 都不需要

## 五、size() 实现原理（1.8）

```java
// 类似 LongAdder 的思想
private transient volatile long baseCount;
private transient volatile CounterCell[] counterCells;

// put/remove 时调用 addCount()
// 1. 先 CAS 更新 baseCount
// 2. 失败则 CAS 更新随机 CounterCell
// 3. size = baseCount + Σ counterCells[i].value
```
## 苏格拉底式面试追问

> 这组追问模拟面试官层层逼问，每一问先回答"为什么"，再回答"怎么做"，最后回答"如何证明"。

### 第一层：目标与动机

**Q：ConcurrentHashMap JDK 1.7 用 Segment 分段锁，1.8 改成 CAS + synchronized 锁 bucket，为什么抛弃 Segment？**

Segment 的设计是"锁分离"——把整个 Map 分成 16 个 Segment，每个 Segment 是一个独立的小 HashMap，自带 ReentrantLock。put 时只锁目标 Segment，其他 Segment 不阻塞，并发度=Segment 数（默认 16）。问题：一、并发度固定 16——高并发场景（如 100 线程）仍竞争 16 把锁，不够细；二、Segment 是"二级结构"——Segment 数组 + Segment 内的 HashEntry 数组，两次 hash 定位，内存开销大；三、扩容粒度粗——单个 Segment 满了独立扩容，但 Segment 间负载不均可能某 Segment 频繁扩容。JDK 8 改用"锁单个 bucket"——put 时 CAS 尝试写入空 bucket（无锁），冲突时 synchronized 锁 bucket 的链表头节点（锁粒度更细，并发度 = bucket 数，远大于 16）。所以抛弃 Segment 是"细化锁粒度 + 简化结构"，提升并发和减少内存。

### 第二层：证据与定位

**Q：JDK 8 的 ConcurrentHashMap put 流程你说是"CAS 写空 bucket、synchronized 锁链表头"，具体怎么定位？怎么验证锁粒度？**

put 流程：一、`hash = spread(key.hashCode())` 计算 hash（高 16 位异或低 16 位，减少冲突）；二、`tabAt(tab, i)` 找到 bucket i（i = (tab.length-1) & hash），如果 bucket 为空，`casTabAt(tab, i, null, new Node(...))` CAS 写入（无锁，成功则结束）；三、如果 bucket 非空且不是 ForwardingNode（扩容标记），`synchronized (bucket 的第一个节点)` 锁链表头，在锁内遍历链表/树做 put；四、如果是 ForwardingNode（其他线程在扩容），当前线程协助扩容（`helpTransfer`）。验证锁粒度：用 `jstack` 抓 ConcurrentHashMap 的 put 阻塞线程，看锁等的是哪个节点（`- waiting to lock <0x...>`），不同 bucket 的 put 应锁不同节点（互不阻塞）。对比：JDK 7 的 Segment 锁，所有该 Segment 的 put 锁同一 Segment 对象。JDK 8 的细粒度锁让并发度从 16 提升到 bucket 数（默认 16，扩容后可达数千）。

### 第三层：根因深挖

**Q：size() 你说用 baseCount + CounterCell 数组累加，为什么不直接用一个 volatile int size？**

单 volatile size 的 `size++` 不是原子操作（读-加-写三步），多线程并发 put 会导致 size 丢失更新。要原子可用 AtomicLong（CAS），但高并发下所有线程 CAS 同一个 size 字段，CAS 失败重试频繁，"热点"严重，性能下降。CounterCell 是"分散热点"——借鉴 Striped64 的设计，用一个 baseCount（无竞争时 CAS 更新）+ 一个 CounterCell 数组（有竞争时分散到不同 cell）。put 时 tryAcquire：先 CAS baseCount，成功则结束；失败（说明有竞争）则 hash 到某个 CounterCell，CAS 更新该 cell。size() 时返回 `baseCount + Σ counterCells[i].value`。这样多线程并发更新分散到不同 cell，减少 CAS 冲突。这是"用空间换并发度"的优化，比单 size 字段并发性高数十倍。LongAdder 就是这个原理，ConcurrentHashMap 内部用类似结构计 size。

**Q：那为什么不在每个 bucket 上单独计 size，汇总时累加所有 bucket？**

两个原因：一、bucket 数量大（扩容后可达数千），size() 要遍历所有 bucket 累加，O(N) 太慢（size() 是高频调用）；二、扩容时 bucket 迁移，size 计数会乱。CounterCell 数组大小固定（默认 = CPU 核数的 2 的幂，如 8 核机器是 8 或 16），size() 只累加 8-16 个 cell，O(1) 快。CounterCell 与 bucket 解耦，扩容不影响 cell 计数。所以"固定大小的 CounterCell 数组"比"每 bucket 计数"更高效。这是并发计数的经典优化——用"分散 + 固定大小"平衡并发度和查询成本。Java 的 LongAdder、Striped64 都用这个模式，是高并发计数器的最佳实践。

### 第四层：方案权衡

**Q：ConcurrentHashMap 的 get() 不加锁，你说是"volatile 读 + 链表遍历"，多线程下读到旧值怎么办？**

ConcurrentHashMap 是"弱一致"——get 不加锁，可能读到"正在被 put 的旧值"。具体：bucket 数组用 volatile 数组（`transient volatile Node[] table`），tabAt 用 Unsafe 的 volatile 读，保证"看到最新 bucket 引用"；但链表/树内部的节点遍历不是 volatile（性能考虑），可能读到"刚插入但未完全可见"的节点。所以 get 可能在 put 后立即读到旧值（短暂不一致）。这是"读不加锁换性能"的权衡——强一致要加锁（synchronized 或 ReadWriteLock），性能损失大；ConcurrentHashMap 选择弱一致 + volatile 关键字段，保证"最终一致"（put 完成且 happens-before 后续 get 时可见）。对大多数业务（如缓存）这个弱一致可接受——get 拿到的是"稍早的快照"。如果业务要强一致（如不能读到旧库存），要用 synchronized 或读写锁，不能用 ConcurrentHashMap 的 get。

**Q：为什么不让 get 也加锁，保证强一致？**

性能。get 是高频操作（缓存场景读 QPS 是写的 10-100 倍），加锁会让读串行化，吞吐骤降。ConcurrentHashMap 的核心价值就是"高并发读写"——读无锁、写细粒度锁。如果 get 加锁，退化为 HashTable（每个方法 synchronized），并发度=1，QPS 极低。所以"读不加锁 + 弱一致"是高并发 Map 的必然选择。业务要强一致就别用 ConcurrentHashMap（或用但接受弱一致），用读写锁（ReentrantReadWriteLock）+ 普通 Map，读读不互斥但读写互斥。我的选型：缓存/统计等容忍弱一致用 ConcurrentHashMap、库存/余额等强一致用读写锁 + Map 或直接用 DB 事务。不要"既要高并发又要强一致"，这是矛盾的。

### 第五层：验证与沉淀

**Q：你怎么验证 ConcurrentHashMap 的并发性能（锁粒度、size 准确性）？**

基准测试：一、并发 put——N 线程并发 put 不同 key，对比 HashMap（线程不安全但有数据丢失风险）、HashTable（全锁）、ConcurrentHashMap（细粒度锁），CHM 应最快且 size 准确；二、锁粒度——`jstack` 抓并发 put 的阻塞，验证不同 bucket 的 put 不互斥（锁不同节点）；三、size 准确性——并发 put 完成后 `map.size()` 应等于 put 总次数（CHM 的 size 精确，但迭代过程中 put 可能导致 size 变化）；四、弱一致验证——A 线程 put(k, v)，B 线程立即 get(k)，可能拿到 null（弱一致），用 happens-before（如 CountDownLatch）保证可见性后 get 拿到 v。JMH 基准测试 CHM 的 put/get 吞吐，应远高于 HashTable。

**Q：这道题做完，你沉淀出了什么可复用的并发 Map 使用经验？**

四条经验：一、多线程用 ConcurrentHashMap——不要用 HashMap（线程不安全）或 HashTable（全锁性能差）；二、理解弱一致——get 不加锁可能读到旧值，业务容忍才用，强一致用读写锁；三、size 是估算但精确——内部 CounterCell 机制保证并发计数准确，但迭代时 size 可能变；四、null key/value 禁止——用 Optional 或默认值替代 null，避免二义性。这套经验用于所有多线程 Map 场景，核心是"高并发用 CHM + 接受弱一致，强一致用锁"。面试时遇到"并发 Map"，按"为什么用 CHM、CHM 怎么实现并发、CHM 的弱一致边界"三层答，体现深度。


## 结构化回答

**30 秒电梯演讲：** ConcurrentHashMap 是线程安全的HashMap。1.7用分段锁（把数据切成16段每段一把锁），1.8改为锁单个桶头节点+CAS，粒度更细并发更高。

**展开框架：**
1. **1.7=Segment** — 1.7=Segment+ReentrantLock，并发度固定16
2. **1.8=CAS** — 1.8=CAS+synchronized锁桶头，并发度=桶数
3. **1.8引入红黑树优化最坏** — 1.8引入红黑树优化最坏O(n)为O(log n)

**收尾：** 这块我踩过坑——要不要深入聊：ConcurrentHashMap 的 get() 需要加锁吗？为什么？

## 视频脚本

> 预计时长：4 分钟 | 由浅入深

| 时间 | 画面/字幕 | 口播台词 | 讲解要点 |
|------|----------|----------|----------|
| 0:00 | 标题卡 | "并发一句话：ConcurrentHashMap 是线程安全的HashMap。1.7用分段锁（把数据切成16段每段一把锁）…。" | 开场钩子 |
| 0:15 | 加锁/解锁时序图 | "1.7就是Segment+ReentrantLock，并发度固定16" | 1.7=Segment |
| 1:08 | 加锁/解锁时序图分步演示 | "1.8就是CAS+synchronized锁桶头，并发度就是桶数" | 1.8=CAS |
| 2:01 | 关键代码/伪代码片段 | "1.8引入红黑树优化最坏O(n)为O(log n)" | 1.8引入红黑树优化最坏 |
| 2:54 | 对比表格 | "synchronized经过JVM锁升级优化后性能不输ReentrantLock" | synchronized |
| 3:50 | 总结卡 | "核心抓住这条主线，下期咱们接着聊：ConcurrentHashMap 的 get() 需要加锁吗？为什么。" | 收尾 |
