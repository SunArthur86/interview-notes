---
id: note-xhs-java-002
difficulty: L4
category: java
subcategory: 集合
tags:
- HashMap
- 红黑树
- 扩容
- 哈希冲突
- 集合
feynman:
  essence: HashMap 是一个「数组+链表/红黑树」的哈希表。用hash函数算出位置放入数组，冲突了就在那个位置挂链表，链表太长就变红黑树。
  analogy: "想象一个有16格的储物柜。你用名字的首字母算出放哪个格子（hash）。如果两个人首字母相同（冲突），就在那个格子挂一个挂钩链（链表）。挂钩链超过8个就改成更高效的标签系统（红黑树）。"
  key_points:
  - 数组+链表/红黑树，默认容量16负载因子0.75
  - 扰动函数：(h=key.hashCode())^(h>>>16)减少冲突
  - 链表≥8且数组≥64才树化，泊松分布概率千万分之六
  - 扩容翻倍，元素位置=原位置或原位置+oldCap
  - 线程不安全，多线程用ConcurrentHashMap
first_principle:
  problem: "需要一种能根据 key 快速定位 value 的数据结构。哈希函数将无限key映射到有限数组，必然产生冲突，如何高效处理冲突？"
  axioms:
  - 哈希表平均O(1)查找的前提是冲突率低
  - 冲突处理有两种主流方式：链地址法(HashMap)和开放寻址法(ThreadLocalMap)
  - 空间换时间：负载因子越低冲突越少但内存浪费越多
  - 红黑树将最坏情况从O(n)优化到O(log n)
  rebuild: "从哈希表第一性原理出发：hash函数→桶定位→冲突处理(链表)→极端冲突优化(红黑树)→动态扩容(2倍)。每一步都在权衡时间与空间"
follow_up:
- HashMap 的 key 可以为 null 吗？value 呢？
- 为什么负载因子是 0.75 而不是 1 或 0.5？
- HashMap 和 Hashtable 的区别？
- 如何设计一个好的 hashCode() 方法？
---

# HashMap 底层原理及扩容机制？（华为od Java一面）

## 一、JDK 1.8 HashMap 数据结构

```
table[] (Node<K,V>数组，长度始终为2的幂)
  [0] → null
  [1] → Node(hash, key, value, next) → Node → ... (链表，长度<8)
  [2] → null
  [3] → TreeNode(红黑树，链表长度≥8 && table.length≥64)
  ...
  [15] → Node → Node → Node
```

**核心字段**：
- `DEFAULT_INITIAL_CAPACITY = 16` — 默认初始容量
- `DEFAULT_LOAD_FACTOR = 0.75f` — 负载因子
- `TREEIFY_THRESHOLD = 8` — 链表转红黑树阈值
- `UNTREEIFY_THRESHOLD = 6` — 红黑树退链表阈值
- `MIN_TREEIFY_CAPACITY = 64` — 树化前数组最小长度

## 二、put 流程（核心考点）

```
put(key, value)
    │
    ▼
① hash = (h = key.hashCode()) ^ (h >>> 16)  ← 扰动函数（减少冲突）
    │
    ▼
② index = (n - 1) & hash  ← 桶定位（位运算代替取模，前提n是2的幂）
    │
    ▼
③ 桶为空？ → 直接放入新Node
    │ 否
    ▼
④ 第一个Node的key相等？ → 替换value
    │ 否
    ▼
⑤ 是TreeNode？ → 红黑树插入
    │ 否
    ▼
⑥ 遍历链表尾部插入 → 链表长度≥8？ → treeifyBin()树化
    │                    （但table.length<64时优先扩容）
    ▼
⑦ ++size > threshold(容量×0.75)？ → resize()扩容
```

## 三、扩容机制（resize）

```
扩容前: table[16], threshold=12
         │
         ▼
    newCapacity = oldCapacity << 1  // 翻倍：16→32
    newThreshold = newCapacity * 0.75  // 24
         │
         ▼
    创建newTab[32]，遍历oldTab：
         │
    ┌────┴────┐
    │         │
  单节点    链表/树
    │         │
  直接迁移   rehash：e.hash & oldCap == 0?
              │           │
             是(原位置)    否(原位置+oldCap)
              │           │
           低位链表      高位链表
```

**扩容时元素位置规律**：原位置 或 原位置 + oldCapacity（二进制高位bit决定）

## 四、为什么链表转红黑树阈值是 8？

HashMap 源码注释：理想情况下 hash 分布均匀，桶中元素个数服从泊松分布 λ=0.5：

| 桶中元素数 | 概率 |
|-----------|------|
| 0 | 0.60653 |
| 1 | 0.30327 |
| 2 | 0.07582 |
| ... | ... |
| 8 | 0.00000006 |

概率极低（千万分之六），说明 hash 函数正常时几乎不会树化。阈值选 8 是防止恶意 hash 碰撞攻击。

## 五、线程不安全的表现

1. **JDK 1.7**：扩容时头插法导致链表成环 → 死循环（CPU 100%）
2. **JDK 1.8**：尾插法解决了死循环，但多线程 put 仍可能数据覆盖丢失

```java
// 多线程下 size++ 非原子操作 → size 不准确
// 解决方案：ConcurrentHashMap
```
## 苏格拉底式面试追问

> 这组追问模拟面试官层层逼问，每一问先回答"为什么"，再回答"怎么做"，最后回答"如何证明"。

### 第一层：目标与动机

**Q：HashMap 扩容你说是"size > threshold 触发，2 倍扩容"，但为什么是 2 倍不是 1.5 倍或 3 倍？**

2 倍是为了"位运算优化"。bucket 索引算法是 `hash & (capacity - 1)`，要求 capacity 是 2 的幂（这样 capacity-1 是"低位全 1"掩码）。扩容时如果保持 2 的幂，新索引的计算可以用位运算快速判断（`hash & oldCap` 是 0 则留原位，非 0 则移到原索引 + oldCap），不用重新对每个元素算 `hash % newCap`。1.5 倍扩容（如 16→24）破坏了"2 的幂"性质，无法用位运算优化，且 24-1=23（二进制 10111）不是全 1 掩码，哈希分布不均。3 倍扩容更糟。所以"2 倍"是为了"位运算 + 均匀分布"双重优化，是 HashMap 设计的基础约束（ArrayList 没这个约束，扩容是 1.5 倍，因为 ArrayList 不需要位运算）。这是"数据结构 + 算法"协同设计的体现。

### 第二层：证据与定位

**Q：你说 JDK 7 多线程扩容会死循环，JDK 8 修复了。但面试官追问"JDK 8 真的安全吗"，你怎么回答？**

JDK 8 修复了"扩容死循环"（头插法改尾插法），但 HashMap 仍不是线程安全，还有其他并发问题：一、put 数据丢失——两个线程同时 put 到同一 bucket 的链表/树，CAS 或同步操作缺失，后写入覆盖先写入；二、size 不准——`size++` 不是原子操作（读 size、加 1、写 size 三步，中间可被其他线程插入），多线程 put 后 size 偏小；三、ConcurrentModificationException——迭代时其他线程修改（fail-fast）；四、put 后立即 get 可能拿不到——内存可见性问题（没有 volatile，一个线程的写入对另一线程不可见）。所以"JDK 8 修复死循环"只解决了一个最显眼的问题，其他并发问题依旧。多线程场景必须用 ConcurrentHashMap（JDK 8 的 ConcurrentHashMap 用 CAS + synchronized 锁 bucket，保证线程安全）。不要因为"JDK 8 修了死循环"就以为 HashMap 能多线程用。

### 第三层：根因深挖

**Q：JDK 8 的尾插法扩容你说"不反转链表"，但具体怎么实现的？为什么不会成环？**

JDK 8 扩容时，对每个 bucket 的链表/树，按"扩容后的去向"拆分。链表 case：遍历原链表，对每个节点判断 `hash & oldCap`（oldCap 是扩容前的容量）——是 0 则该节点留原 bucket（low 链）、是 1 则移到原 bucket + oldCap（high 链）。用两个指针（lowHead/lowTail、highHead/highTail）分别构建两条新链表，遍历完后把 low 链放到新数组的原 bucket、high 链放到原 bucket + oldCap。关键：尾插法保持原链表顺序（不反转），且拆分是"遍历一次，构建两条链表"（不是逐节点移动）。不会成环因为"每条新链表是线性构建，节点只被加入一条链表，不会互相指向"。JDK 7 的头插法是"逐节点用头插法插入新 bucket"，反转了链表顺序，多线程交替执行时顺序混乱可能成环。JDK 8 的批量拆分 + 尾插法避免了这个问题。

**Q：树化（链表转红黑树）你说是"链表≥8 且容量≥64"，但树本身比链表复杂，为什么要转？退化阈值为什么是 6 不是 7？**

树化的动机是"防哈希冲突严重时查询退化"。链表查询 O(N)，N=1000 时（极端哈希冲突）查询要 1000 次比较；红黑树 O(logN)，N=1000 时约 10 次比较，快 100 倍。所以冲突严重时树化提升查询。退化阈值是 6（不是 7）是为了"防抖动"——如果树化和退树化阈值相邻（如 8 和 7），链表长度在 7-8 波动会频繁树化-退树化（每次树化要构建红黑树节点，退树化要拆，浪费 CPU）。设退化阈值为 6（比树化阈值 8 小 2），留出缓冲区间，长度在 7 时既不树化也不退化，稳定。这个"上下限留 buffer"的设计也见于其他场景（如线程池 corePoolSize 和 maxPoolSize 之间留余量）。所以 8 和 6 不是任意值，是"避免抖动 + 泊松分布概率"双重考量的结果。

### 第四层：方案权衡

**Q：HashMap 的 key 可以是 null（hash 为 0），但 ConcurrentHashMap 不允许 null key/value，为什么？**

ConcurrentHashMap 禁 null 是因为"二义性问题"。HashMap 单线程下，`get(key)` 返回 null 可以明确区分"key 不存在"和"value 是 null"（用 containsKey 判断）。但 ConcurrentHashMap 多线程下，`get(key)` 返回 null 时，可能是"key 不存在"也可能是"key 存在但 value 是 null"，而此时另一个线程可能正在 put（key, non-null value），containsKey 检查完到 get 之间状态变化，导致"用 null 做业务逻辑"出错（如把 null 当不存在，实际是存在但值被覆盖）。禁 null 消除二义性——get 返回 null 一定是"key 不存在"（因为 value 不会是 null）。这是并发安全的考虑，不是技术限制。HashMap 单线程无此问题所以允许 null。所以"ConcurrentHashMap 禁 null"是并发设计的严谨，面试时要能讲清这个二义性原理。

**Q：为什么不直接用 ConcurrentHashMap 替代所有 HashMap（反正功能一样且线程安全）？**

性能开销。ConcurrentHashMap 的 put 要 CAS + synchronized（JDK 8 锁 bucket），即使无竞争也有 CAS 开销（比 HashMap 的直接数组写慢）；size() 是估算（baseCount + CounterCell 累加），不如 HashMap 精确且 fast；迭代是弱一致（迭代时不反映并发修改）。单线程或线程封闭场景（如方法内局部变量），这些开销是"无用的并发成本"。HashMap 单线程下更快更简单。所以选型：单线程用 HashMap、多线程共享用 ConcurrentHashMap。不要无脑用 ConcurrentHashMap（无此需要的并发开销）。我的实践：方法内局部 Map 用 HashMap、全局共享缓存用 ConcurrentHashMap，按"是否跨线程共享"选。

### 第五层：验证与沉淀

**Q：你怎么验证 HashMap 的扩容时机和树化/退化逻辑符合预期？**

写测试触发各场景：一、扩容——new HashMap<>(16, 0.75f)，put 13 个不同 bucket 的 key（13 > 16×0.75=12），反射看 capacity 应从 16 变 32；二、树化——构造 9 个哈希冲突 key（重写 hashCode 返回同一值），但 capacity=16 < 64，应只扩容不树化；继续 put 直到 capacity ≥64，再 put 到链表 ≥8，反射看 bucket 应是 TreeNode；三、退化——树化后 remove 到链表长度 ≤6，反射看 bucket 应回链表（Node 不是 TreeNode）。验证 JDK 8 尾插法：扩容前后链表顺序不变（JDK 7 会反转）。验证 null key：`map.put(null, "v")` 应成功（HashMap）、ConcurrentHashMap 应抛 NullPointerException。这些测试覆盖 HashMap 的核心行为，确保理解无误。

**Q：这道题做完，你沉淀出了什么可复用的 HashMap 原理知识？**

四条核心：一、结构——数组 + 链表 + 红黑树（冲突严重时），2 的幂容量支持位运算；二、扩容——size > threshold 触发，2 倍扩容，元素按 `hash & oldCap` 位运算判断留原位/移新位（JDK 8 尾插法不反转）；三、树化——双条件（链表≥8 + 容量≥64），退化阈值 6 防抖动，泊松分布保证正常情况几乎不树化；四、并发——HashMap 不线程安全（JDK 7 死循环、JDK 8 仍丢数据/size 不准），多线程用 ConcurrentHashMap（禁 null key 消除二义性）。这套知识用于面试答题 + 生产调优（如初始化指定容量避免多次扩容、合理实现 hashCode 避免冲突）。


## 结构化回答

**30 秒电梯演讲：** HashMap 是一个「数组+链表/红黑树」的哈希表。用hash函数算出位置放入数组，冲突了就在那个位置挂链表，链表太长就变红黑树。

**展开框架：**
1. **数组+链表/红黑树** — 数组+链表/红黑树，默认容量16负载因子0.75
2. **扰动函数** — (h=key.hashCode())^(h>>>16)减少冲突
3. **链表≥8且数组≥64才树** — 链表≥8且数组≥64才树化，泊松分布概率千万分之六

**收尾：** 这块我踩过坑——要不要深入聊：HashMap 的 key 可以为 null 吗？value 呢？

## 视频脚本

> 预计时长：4 分钟 | 由浅入深

| 时间 | 画面/字幕 | 口播台词 | 讲解要点 |
|------|----------|----------|----------|
| 0:00 | 标题卡 | "集合一句话：HashMap 是一个「数组+链表/红黑树」的哈希表。用hash函数算出位置放入数组…。" | 开场钩子 |
| 0:15 | 线程状态转换图 | "数组+链表/红黑树，默认容量16负载因子0.75" | 数组+链表/红黑树 |
| 1:08 | 线程状态转换图分步演示 | "扰动函数：(h就是key.hashCode())^(h>>>16)减少冲突" | 扰动函数 |
| 2:01 | 关键代码/伪代码片段 | "链表≥8且数组≥64才树化，泊松分布概率千万分之六" | 链表≥8且数组≥64才树 |
| 2:54 | 对比表格 | "扩容翻倍，元素位置就是原位置或原位置+oldCap" | 扩容翻倍 |
| 3:50 | 总结卡 | "核心抓住这条主线，下期咱们接着聊：HashMap 的 key 可以为 null 吗？value 呢。" | 收尾 |
