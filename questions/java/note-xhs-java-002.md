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