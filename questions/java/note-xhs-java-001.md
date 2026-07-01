---
id: note-xhs-java-001
difficulty: L2
category: java
subcategory: 集合
tags:
- ArrayList
- LinkedList
- 集合
- 数据结构
feynman:
  essence: ArrayList 是连续排列的书架（找书快但中间插书要搬动），LinkedList 是手拉手的小朋友队伍（插队快但找特定位置要数过去）。
  analogy: "想象排队买奶茶：ArrayList 像固定座位的影院（第5排第3座直接走过去），LinkedList 像手拉手的人群（找第5个人要从第1个开始数）。"
  key_points:
  - ArrayList=数组+1.5倍扩容，随机访问O(1)
  - LinkedList=双向链表，头尾插入O(1)
  - 实际开发95%用ArrayList（CPU缓存友好）
  - LinkedList额外实现Deque接口可当队列用
first_principle:
  problem: "线性表需要支持动态扩容、随机访问、任意位置插入删除，不同的物理存储方式决定了各操作的时间复杂度。"
  axioms:
  - 连续内存（数组）→ 随机访问O(1)，但插入需搬移
  - 离散内存（链表）→ 插入O(1)，但访问需遍历
  - CPU缓存对连续内存更友好（空间局部性原理）
  rebuild: "从数据结构第一性原理出发：需要频繁随机访问→数组(ArrayList)；需要频繁头尾增删→链表(LinkedList)；但现代CPU缓存使数组在大多数场景下性能更优"
follow_up:
- ArrayList 扩容 1.5 倍的原因是什么？为什么不是 2 倍？
- LinkedList 能用 fori 遍历吗？为什么实际中不推荐？
- Arrays.asList() 返回的 List 有什么坑？
---

# ArrayList 和 LinkedList 的区别与使用场景？（华为od Java一面）

## 一、核心对比表

| 维度 | ArrayList | LinkedList |
|------|-----------|------------|
| 底层结构 | 动态数组（Object[]） | 双向链表（Node{prev, item, next}） |
| 随机访问 | O(1) — 下标直接定位 | O(n) — 需从头/尾遍历 |
| 头部插入 | O(n) — 需数组搬移 | O(1) — 修改指针 |
| 尾部插入 | 均摊 O(1) | O(1) |
| 中间插入 | O(n) | O(n) — 定位O(n) + 插入O(1) |
| 内存开销 | 连续内存，紧凑 | 每个Node额外36字节（prev+item+next） |
| 实现接口 | List, RandomAccess | List, Deque, Queue |

## 二、ArrayList 扩容机制

```
初始容量: 10（首次add时创建）
         │
         ▼
    add(e) → size == capacity?
         │              │
        否              是
         │              │
    直接赋值        grow(): newCapacity = oldCapacity + oldCapacity >> 1
    array[size++]        即扩容 1.5 倍
                         Arrays.copyOf → 新数组
```

**关键**：扩容时调用 `Arrays.copyOf` 创建新数组，旧数组被 GC 回收。频繁扩容会触发大量数组拷贝。

## 三、LinkedList 双向链表结构

```
first → [Node A] ⇄ [Node B] ⇄ [Node C] ← last
          │            │            │
        prev=null     prev=A       prev=B
        next=B        next=C       next=null
```

每个 Node 对象包含：
- `E item` — 实际数据
- `Node<E> prev` — 前驱指针
- `Node<E> next` — 后继指针

## 四、使用场景选择

```java
// ✅ 用 ArrayList：读多写少、随机访问频繁
List<String> configList = new ArrayList<>();  // 配置项、字典数据

// ✅ 用 LinkedList：频繁头尾插入、实现队列/双端队列
Deque<Task> taskQueue = new LinkedList<>();  // 任务调度
```

**面试加分**：
1. 实际开发中 95% 场景用 ArrayList — CPU 缓存命中率高（连续内存），LinkedList 的 Node 对象分散在堆中，cache miss 严重
2. LinkedList 实现了 Deque 接口，可当队列/栈使用
3. ArrayList 的 `subList()` 返回的是视图（view），修改会影响原列表