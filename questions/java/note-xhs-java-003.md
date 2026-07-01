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