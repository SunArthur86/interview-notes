---
id: note-mi-001
difficulty: L2
category: java
subcategory: 集合框架
tags:
  - 小米
  - 面经
  - HashMap
  - Java
feynman:
  essence: "HashMap JDK8底层是数组+链表+红黑树，通过hash定位桶位置，链表解决冲突，链表过长(≥8)转红黑树加速查询"
  analogy: "HashMap像一栋公寓楼——数组是楼层，每层有房间(桶)；hash函数决定住几楼；同一楼层多个人住就是链表；人太多了(≥8)就改用红黑树(快速查找的管理方式)"
  first_principle: "HashMap的本质是hash表，核心矛盾是查找效率(O(1)理想vs O(n)最坏)和空间利用率的平衡"
  key_points:
    - '数组+链表+红黑树: 桶定位O(1)，链表O(n)，树化后O(logn)'
    - '树化条件: 链表长度≥8 且 数组容量≥64'
    - '退化条件: 节点数≤6退回链表'
    - '扩容优化: JDK8用hash&oldCap位运算定位，不重新计算hash'
    - '加载因子0.75: 时空平衡，基于泊松分布'
first_principle:
  essence: "Hash表的核心是均匀分布 + 高效冲突处理"
  derivation: "key→hash→取模定位桶 → 理想情况O(1) → 冲突时退化为链表O(n) → 树化限制最坏情况O(logn) → 扩容减少冲突概率"
  conclusion: "JDK8 HashMap通过树化+优化扩容，将最坏情况从O(n)提升到O(logn)"
follow_up:
  - "HashMap为什么线程不安全？具体会出现什么问题？"
  - "ConcurrentHashMap JDK8的实现？分段锁怎么做的？"
  - "为什么树化阈值是8？为什么退化阈值是6？"
---

# HashMap JDK8 底层原理是什么？

## 数据结构

```
HashMap内部 = Node<K,V>[] table (数组)

每个桶(table[i])可能是:
  null                    → 空桶
  Node → Node → Node     → 链表
  TreeNode (红黑树)       → 树化后的结构

┌────┬────┬────┬────┬────┬────┬────┬────┐
│ 0  │ 1  │ 2  │ 3  │ 4  │ 5  │ 6  │ 7  │
└─┬──┴────┴─┬──┴────┴─┬──┴────┴────┴────┘
  │        │        │
  ▼        ▼        ▼
 Node     Node     TreeNode (红黑树, 链表≥8时)
  │        │        │
  ▼        ▼        ▼
 Node     null     TreeNode
  │                 │
  ▼                 ▼
 null              TreeNode
```

## 核心流程

### put(K, V) 流程

```java
public V put(K key, V value) {
    // 1. 计算hash: (h = key.hashCode()) ^ (h >>> 16) — 扰动函数
    int hash = hash(key);

    // 2. 定位桶: hash & (capacity - 1)  — 位运算替代取模
    int index = hash & (table.length - 1);

    // 3. 桶为空 → 直接放入
    if (table[index] == null) {
        table[index] = new Node(hash, key, value, null);
    }
    // 4. 桶非空 → 遍历链表/树
    else {
        Node<K,V> node = table[index];
        // 4a. key相同 → 覆盖value
        // 4b. key不同 → 尾插法追加
        // 4c. 链表长度≥8 → 树化(treeifyBin)
    }

    // 5. 检查是否需要扩容
    if (++size > threshold) {  // threshold = capacity * 0.75
        resize();  // 扩容2倍
    }
}
```

### 树化条件 (重要!)

```java
final void treeifyBin(Node<K,V>[] tab, int hash) {
    // ⚠️ 两个条件都必须满足:
    // 1. 链表长度 ≥ 8 (TREEIFY_THRESHOLD)
    // 2. 数组容量 ≥ 64 (MIN_TREEIFY_CAPACITY)
    //    如果容量 < 64 → 不树化，而是扩容!
    if (tab.length < MIN_TREEIFY_CAPACITY) {
        resize();  // 优先扩容而非树化
    } else {
        // 转红黑树
    }
}
```

### 扩容机制 (JDK8 优化)

```java
// JDK7: 每个node重新计算 index = hash & (newCapacity - 1)
// JDK8: 利用高位bit判断，不用重新计算hash!

// 扩容后，元素的新位置只有两种可能:
// 原位置 或 原位置 + oldCapacity

// 判断方法: hash & oldCapacity
//   = 0 → 留在原位置
//   = 1 → 移到 原位置 + oldCapacity

// 示例: capacity 8→16
// hash=9 (二进制1001), oldCap=8 (二进制1000)
// 1001 & 1000 = 1000 ≠ 0 → 新位置 = 1 + 8 = 9
```

## 关键参数

| 参数 | 值 | 说明 |
|------|-----|------|
| 初始容量 | 16 | `1 << 4` |
| 加载因子 | 0.75 | 容量达75%触发扩容 |
| 树化阈值 | 8 | 链表长度≥8触发树化 |
| 退化阈值 | 6 | 树节点≤6退回链表 |
| 最小树化容量 | 64 | 容量<64时优先扩容 |

### 为什么树化阈值是8？

```
基于泊松分布: 在加载因子0.75下，
桶中节点数达到8的概率 ≈ 0.00000006 (千万分之一)

这意味着: 正常情况下几乎不会树化
树化是极端情况的保护机制，不是常规路径

退化阈值6(不是8): 避免频繁在树↔链表之间切换
  8→树, 6→链表, 留2的缓冲区间
```

### 为什么加载因子是0.75？

```
空间 vs 时间 的平衡:
  0.5 → 空间浪费大(一半空着)
  1.0 → 冲突率高(几乎每个桶都有冲突)
  0.75 → 泊松分布下冲突率最低的甜点
```

## JDK7 vs JDK8 区别

| 维度 | JDK7 | JDK8 |
|------|------|------|
| 数据结构 | 数组+链表 | 数组+链表+红黑树 |
| 插入方式 | 头插法 | 尾插法 |
| 头插法问题 | 扩容时可能形成环 → 死循环 | ✅ 解决 |
| 扩容计算 | 重新hash定位 | hash & oldCap位运算 |
| 最坏查找 | O(n) | O(logn) |
