---
id: note-bd-llm-009
difficulty: L3
category: algorithm
subcategory: 设计题
tags:
- 字节
- 面经
- 手撕
- LRU Cache
- HashMap
feynman:
  essence: HashMap + 双向链表：HashMap提供O(1)查找，双向链表维护访问顺序，O(1)移动节点到头部。
  analogy: 就像书架上最常用的书放最前面——查书时从书架上取下(hashmap查找)放到最前面(链表头部)，满了就从最后面扔掉(淘汰尾部)。
  first_principle: O(1)查找→HashMap；O(1)删除和插入→双向链表。两者结合=O(1)的LRU。
  key_points:
  - 'HashMap: key→Node(O(1)查找)'
  - '双向链表: 维护访问顺序(O(1)移动)'
  - 'get: 查找+移到头部'
  - 'put: 添加/更新+移到头部+可能淘汰尾部'
first_principle:
  essence: LRU = 哈希表(查找) + 有序链表(时序)
  derivation: 需要O(1)查找→HashMap→需要维护LRU顺序→双向链表(O(1)删除插入)→HashMap存Node指针
  conclusion: HashMap+双向链表是LRU Cache的经典组合
follow_up:
- LFU Cache怎么实现？
- Java的LinkedHashMap能直接实现LRU吗？
- LRU在高并发下怎么保证线程安全？
memory_points:
- 核心设计：HashMap负责O(1)查找，双向链表负责O(1)维护时序
- 双向链表原因：删除节点需找前驱，双向才能O(1)断开重连，单向需O(n)
- 必须设哨兵节点：dummy head和tail互指，彻底免除边界空指针判断
- 淘汰逻辑：新节点插入头部，满容量时直接淘汰tail.prev(最久未使用)
---

# 【字节面经】实现一个 LRU Cache，要求 get/put 均为 O(1)。

## 一、什么是 LRU Cache？

**LRU（Least Recently Used）** 是一种**缓存淘汰策略**：当缓存满了需要淘汰数据时，选择**最久没有被访问过**的那个淘汰掉。

**核心思想**：最近访问过的数据，很可能再次被访问（**局部性原理**）。

**题目要求**：实现 `get(key)` 和 `put(key, value)` 两个操作，**时间复杂度均为 O(1)**。

---

## 二、为什么单一数据结构不行？

| 需求 | 单独的数据结构 | 问题 |
|------|----------------|------|
| O(1) 查找 | **HashMap** | 无法维护访问顺序 |
| O(1) 删除最旧 | **队列/链表** | 查找是 O(n) |
| O(1) 移动到头部 | **双向链表** | 查找是 O(n) |

**结论**：需要 **HashMap + 双向链表** 的组合，互相弥补短板。

---

## 三、数据结构设计

```
HashMap:  key  →  Node指针
            指向链表中的实际节点

双向链表: 按访问时间排序
          head（最近访问） ←→ ... ←→ tail（最久未访问）

         ┌─── dummy_head ───┐
         │                     │
         ▼                     ▼
       ┌───┐ ⇄ ┌───┐ ⇄ ┌───┐ ⇄ ┌───┐
       │ A │   │ B │   │ C │   │ D │   ← data nodes
       └───┘ ⇄ └───┘ ⇄ └───┘ ⇄ └───┘
         ▲                     ▲
         │                     │
         └─── dummy_tail ─────┘

         ↑ head端 = 最近使用      ↑ tail端 = 最久未使用（淘汰目标）
```

### 为什么用双向链表而不是单向？

- **单向链表删除节点**：需要知道**前驱节点**，要从头遍历 O(n)
- **双向链表删除节点**：通过 `node.prev` 直接拿到前驱，O(1)

### 为什么用 dummy（哨兵）头尾节点？

- 避免处理头/尾为空的边界条件，代码更简洁
- 空链表时 dummy_head 和 dummy_tail 互指，天然处理

---

## 四、核心操作图解

### 4.1 get(key) 流程

```
Step 1: HashMap 查 key → 找到 Node          O(1)
Step 2: 把 Node 移到链表头部（标记为最近使用）  O(1)
Step 3: 返回 Node.value
```

### 4.2 put(key, value) 流程

```
情况A: key 已存在
  → 更新 value
  → 移到头部

情况B: key 不存在
  → 新建 Node，插入头部
  → HashMap 添加映射
  → 如果超容量：删除 tail 前一个节点 + HashMap 删除映射
```

### 4.3 "移到头部"的分解动作

```
原始状态:  head ⇄ [A] ⇄ [B] ⇄ [C] ⇄ tail

要把 [C] 移到头部:
  Step 1: 从链表中摘除 C
    C.prev.next = C.next   // B.next = tail
    C.next.prev = C.prev   // tail.prev = B

  Step 2: 插入到 head 之后
    C.next = head.next      // C.next = A
    C.prev = head           // C.prev = head
    head.next.prev = C      // A.prev = C
    head.next = C           // head.next = C

结果:  head ⇄ [C] ⇄ [A] ⇄ [B] ⇄ tail
```

---

## 五、Python 完整实现

```python
class Node:
    """双向链表节点"""
    def __init__(self, key=0, value=0):
        self.key = key       # 存key是为了淘汰时能从HashMap删映射
        self.value = value
        self.prev = None
        self.next = None


class LRUCache:
    def __init__(self, capacity: int):
        self.capacity = capacity
        self.cache = {}               # key → Node
        # 哨兵节点，避免边界判断
        self.head = Node()            # dummy head
        self.tail = Node()            # dummy tail
        self.head.next = self.tail
        self.tail.prev = self.head

    def _remove(self, node: Node):
        """从链表中删除节点 — O(1)"""
        node.prev.next = node.next
        node.next.prev = node.prev

    def _add_to_head(self, node: Node):
        """在 head 后面插入节点 — O(1)"""
        node.next = self.head.next
        node.prev = self.head
        self.head.next.prev = node
        self.head.next = node

    def _move_to_head(self, node: Node):
        """把已有节点移到头部 = 删除 + 插入 — O(1)"""
        self._remove(node)
        self._add_to_head(node)

    def _remove_tail(self) -> Node:
        """删除尾部节点（最久未使用）— O(1)"""
        lru = self.tail.prev
        self._remove(lru)
        return lru

    def get(self, key: int) -> int:
        """O(1)"""
        if key in self.cache:
            node = self.cache[key]
            self._move_to_head(node)     # 访问后移到头部
            return node.value
        return -1

    def put(self, key: int, value: int):
        """O(1)"""
        if key in self.cache:
            # key 存在：更新 + 移到头部
            node = self.cache[key]
            node.value = value
            self._move_to_head(node)
        else:
            # key 不存在：新建节点
            node = Node(key, value)
            self.cache[key] = node
            self._add_to_head(node)
            # 检查容量
            if len(self.cache) > self.capacity:
                # 淘汰尾部节点
                lru = self._remove_tail()
                del self.cache[lru.key]  # 用 lru.key 从 HashMap 删除


# ========== 测试 ==========
lru = LRUCache(2)
lru.put(1, 10)       # cache: {1=10}
lru.put(2, 20)       # cache: {1=10, 2=20}
print(lru.get(1))    # 10  ← 访问1，1变为最近使用
lru.put(3, 30)       # 超容量，淘汰最久未使用的2 → cache: {1=10, 3=30}
print(lru.get(2))    # -1  ← 2已被淘汰
print(lru.get(3))    # 30
lru.put(4, 40)       # 超容量，淘汰1 → cache: {3=30, 4=40}
print(lru.get(1))    # -1
print(lru.get(3))    # 30
print(lru.get(4))    # 40
```

### Python 速写版（使用 OrderedDict）

面试中如果只要求快速实现，可以用 `collections.OrderedDict`：

```python
from collections import OrderedDict

class LRUCache:
    def __init__(self, capacity: int):
        self.cap = capacity
        self.od = OrderedDict()

    def get(self, key: int) -> int:
        if key not in self.od:
            return -1
        self.od.move_to_end(key)   # 移到末尾（最近使用）
        return self.od[key]

    def put(self, key: int, value: int):
        if key in self.od:
            self.od.move_to_end(key)
        self.od[key] = value
        if len(self.od) > self.cap:
            self.od.popitem(last=False)  # 弹出头部（最久未使用）
```

> **面试注意**：面试官看到 OrderedDict 可能会追问"手写一个"。所以**两种都要会**，先说 OrderedDict 方案展示知识广度，再手写 HashMap+双向链表方案展示底层功力。

---

## 六、Java 完整实现

```java
import java.util.HashMap;
import java.util.Map;

public class LRUCache {

    /** 双向链表节点 */
    private static class Node {
        int key;
        int value;
        Node prev;
        Node next;

        Node() {}
        Node(int key, int value) {
            this.key = key;
            this.value = value;
        }
    }

    private final int capacity;
    private final Map<Integer, Node> cache;
    private final Node head;  // dummy head
    private final Node tail;  // dummy tail

    public LRUCache(int capacity) {
        this.capacity = capacity;
        this.cache = new HashMap<>();
        this.head = new Node();
        this.tail = new Node();
        head.next = tail;
        tail.prev = head;
    }

    /** 从链表中删除节点 — O(1) */
    private void remove(Node node) {
        node.prev.next = node.next;
        node.next.prev = node.prev;
    }

    /** 在 head 后面插入节点 — O(1) */
    private void addToHead(Node node) {
        node.next = head.next;
        node.prev = head;
        head.next.prev = node;
        head.next = node;
    }

    /** 把已有节点移到头部 — O(1) */
    private void moveToHead(Node node) {
        remove(node);
        addToHead(node);
    }

    /** 删除尾部节点（最久未使用），返回被删除的节点 — O(1) */
    private Node removeTail() {
        Node lru = tail.prev;
        remove(lru);
        return lru;
    }

    /** O(1) */
    public int get(int key) {
        Node node = cache.get(key);
        if (node == null) {
            return -1;
        }
        moveToHead(node);
        return node.value;
    }

    /** O(1) */
    public void put(int key, int value) {
        Node node = cache.get(key);
        if (node != null) {
            // key存在：更新 + 移到头部
            node.value = value;
            moveToHead(node);
        } else {
            // key不存在：新建节点
            Node newNode = new Node(key, value);
            cache.put(key, newNode);
            addToHead(newNode);
            if (cache.size() > capacity) {
                // 淘汰尾部
                Node lru = removeTail();
                cache.remove(lru.key);
            }
        }
    }

    // ========== 测试 ==========
    public static void main(String[] args) {
        LRUCache lru = new LRUCache(2);
        lru.put(1, 10);
        lru.put(2, 20);
        System.out.println(lru.get(1));   // 10
        lru.put(3, 30);                    // 淘汰2
        System.out.println(lru.get(2));   // -1
        System.out.println(lru.get(3));   // 30
        lru.put(4, 40);                    // 淘汰1
        System.out.println(lru.get(1));   // -1
        System.out.println(lru.get(3));   // 30
        System.out.println(lru.get(4));   // 40
    }
}
```

### Java 速写版（使用 LinkedHashMap）

```java
import java.util.LinkedHashMap;
import java.util.Map;

public class LRUCacheSimple extends LinkedHashMap<Integer, Integer> {
    private final int capacity;

    public LRUCacheSimple(int capacity) {
        super(capacity, 0.75f, true);  // accessOrder=true 是关键
        this.capacity = capacity;
    }

    public int get(int key) {
        return super.getOrDefault(key, -1);
    }

    public void put(int key, int value) {
        super.put(key, value);
    }

    @Override
    protected boolean removeEldestEntry(Map.Entry<Integer, Integer> eldest) {
        return size() > capacity;  // 超容量时自动淘汰最老的
    }
}
```

---

## 七、复杂度分析

| 操作 | 时间复杂度 | 空间复杂度 | 说明 |
|------|-----------|-----------|------|
| `get(key)` | **O(1)** | — | HashMap查找O(1) + 链表移动O(1) |
| `put(key,value)` | **O(1)** | — | HashMap插入O(1) + 链表操作O(1) |
| 整体空间 | — | **O(capacity)** | HashMap和链表各存一份引用 |
| Node 内存 | — | O(capacity) | 每个节点key+value+2指针 |

---

## 八、面试高频追问

### Q1: LFU Cache 怎么实现？

LFU（Least Frequently Used）淘汰**访问频率最低**的。需要 HashMap + 多个按频率分组的双向链表（频率→链表的映射），复杂度更高。

```python
# LFU 结构示意
freq_map = {
    1: DLL([key_a, key_b]),   # 访问1次的节点
    2: DLL([key_c]),           # 访问2次的节点
    3: DLL([key_d, key_e]),    # 访问3次的节点
}
min_freq = 1  # 跟踪最小频率，淘汰时从该链表尾部删除
```

### Q2: 高并发下 LRU 怎么保证线程安全？

| 方案 | 说明 |
|------|------|
| **全局锁** | `synchronized` / `ReentrantLock` 包住 get/put，简单但吞吐低 |
| **分段锁** | 把缓存分 N 段，每段独立 LRU + 独立锁，并发度 × N |
| **Caffeine / Guava Cache** | 生产级方案，内置 W-TinyLFU 算法，近似 LRU 但更高效 |
| **CAS 无锁** | 理论可行但链表操作难以无锁化，实践中很少用 |

```java
// 简单的线程安全版
public synchronized int get(int key) { ... }
public synchronized void put(int key, int value) { ... }

// 更好：用读写锁
private final ReentrantReadWriteLock rwl = new ReentrantReadWriteLock();
public int get(int key) {
    rwl.readLock().lock();
    try { ... } finally { rwl.readLock().unlock(); }
}
```

### Q3: 为什么 Node 要存 key？

淘汰尾部节点时，需要从 HashMap 中同步删除映射。如果不存 key，拿到尾部 Node 后不知道它对应的 HashMap key 是什么，就无法删除。

---

## 九、总结一句话

> LRU Cache = **HashMap（O(1) 查找）+ 双向链表（O(1) 删除/插入）**，head 端是最近访问，tail 端是最久未访问。get 和 put 的核心操作都是 HashMap 查找 + 链表节点移动，每步都是 O(1)。面试中先说 OrderedDict/LinkedHashMap 方案展示知识广度，再手写完整实现展示底层功底，同时准备好线程安全和 LFU 的追问。

## 记忆要点

- 核心设计：HashMap负责O(1)查找，双向链表负责O(1)维护时序
- 双向链表原因：删除节点需找前驱，双向才能O(1)断开重连，单向需O(n)
- 必须设哨兵节点：dummy head和tail互指，彻底免除边界空指针判断
- 淘汰逻辑：新节点插入头部，满容量时直接淘汰tail.prev(最久未使用)


## 苏格拉底式面试追问

> 这组追问模拟面试官层层逼问，每一问先回答"为什么"，再回答"怎么做"，最后回答"如何证明"。

### 第一层：目标与动机

**Q：题目要求 get/put 都 O(1)，你为什么选 HashMap + 双向链表而不是红黑树或跳表？**

目标是两个 O(1)：O(1) 查找 + O(1) 维护访问顺序。HashMap 查找天然 O(1)；但"把访问的节点挪到表头"这一步，如果用单链表删除节点需要先找前驱（O(n)），用红黑树/跳表虽然查找 O(log n) 但旋转/调整也是 O(log n) 且实现复杂。双向链表每个节点存 prev 和 next，删除时 `node.prev.next = node.next; node.next.prev = node.prev` 三行搞定，O(1)。所以组合起来：HashMap 提供"key→Node"的定位，双向链表提供"位置维护"，两者职责分离，正好满足双 O(1)。红黑树是为了"有序集合的动态排名查询"，跟 LRU 的需求不匹配。

### 第二层：证据与定位

**Q：面试官追问，你说双向链表删除是 O(1)，但如果只给你 Node 引用不给 prev 指针，为什么单链表做不到？**

这是单向 vs 双向的本质差异。单链表删除节点 `node`，必须知道它的前驱 `prev` 才能 `prev.next = node.next`，而找前驱只能从头遍历 O(n)。双向链表的 `node` 自带 `node.prev`，直接拿到前驱，所以删除是 O(1)。可以用一个具体反例验证：链表 A→B→C，要删 B，单链表得从 A 一路 next 找到 B 的前驱是 A；双向链表直接 `B.prev` 就是 A。这就是 LRU 必须双向的根本原因——put 命中已有 key 时要把它挪到表头，挪之前先删原位置，这一步如果 O(n) 整个 put 就退化到 O(n) 了。

### 第三层：根因深挖

**Q：你写了 HashMap + 双向链表，但面试官说"线程不安全，多线程下 put 会丢数据"。根因在哪？**

根因是"查 + 改"不是原子操作。线程 A 执行 put(k)，先 `map.get(k)` 返回 null（说明是新 key），准备创建 Node 插入；线程 B 同时也 `map.get(k)` 也返回 null；两人各建一个 Node，后写入的覆盖前一个，先建的 Node 成了孤儿——链表里多了一个该被淘汰的节点，map 里的引用也被覆盖，数据丢失且内存泄漏。这是典型的 check-then-act 竞态条件（TOCTOU）。不是某个方法没加锁，而是"读 map + 改链表 + 写 map"这三步之间被其他线程插入。

**Q：那为什么不直接给所有方法加 synchronized？这样不是最简单吗？**

synchronized 是粗粒度锁，get 和 put 全部串行化，读多写少的场景下吞吐急剧下降。LRU 在缓存场景里读远多于写（命中率 90%+），用 synchronized 等于把 90% 互不冲突的读操作也串行化了。正确做法是读写锁 `ReentrantReadWriteLock`——读读不互斥（多个线程可以同时 get），只有写写、读写才互斥。或者用 ConcurrentHashMap + 自己实现的 CAS 式链表操作，但实现复杂度陡增。所以"最简单"的 synchronized 在性能敏感场景反而是错的，要按读写比例选锁策略。

### 第四层：方案权衡

**Q：如果面试官说"容量 100 万，要支持高并发"，你的 HashMap + 双向链表方案还能撑住吗？**

撑不住。两个瓶颈：一是链表节点是分散的对象，100 万个 Node 内存碎片严重，GC 压力大；二是全局读写锁在高并发下成为瓶颈，QPS 上万时锁竞争导致线程阻塞。生产级方案要分片：把缓存按 key hash 切成 N 个 shard（如 64），每个 shard 独立加锁、独立维护小 LRU，这样并发度提升 64 倍。或者干脆不用手写，用 Caffeine（它用 Window-TinyLFU 算法，命中率比 LRU 高、并发性能好）。权衡点：手写 LRU 是面试秀底层功底，生产用 Caffeine 是工程理性，两者不矛盾。

**Q：为什么 Redis 不用你这种精确 LRU，而用近似 LRU（随机采样 5 个 key）？**

因为 Redis 是单线程内存数据库，全局维护一条双向链表的代价太高——每次访问都要挪节点，链表指针修改在单线程下虽然没锁竞争但 CPU 开销累积，且每个 key 多两个指针（prev/next）在百万级 key 下多耗几十 MB 内存。近似 LRU 随机采样 5 个 key 淘汰最旧的，牺牲少量精度（命中率比精确 LRU 低约 1-5%）换取"零额外内存 + 零指针维护开销"。这是工程上的经典权衡：在精度和成本之间，Redis 选择了低成本，因为它的核心卖点是单线程高性能，不能让淘汰逻辑拖慢主循环。

### 第五层：验证与沉淀

**Q：你怎么验证自己写的 LRU 实现没有内存泄漏和死循环？**

三组测试：一是功能用例——LeetCode 146 的官方用例（put/put/get/put/get/get/get 序列），对照期望输出；二是边界用例——capacity=1 时反复 put 应该每次都淘汰、capacity 满时 put 已有 key 只更新不新增；三是压力测试——开 10 个线程并发 put/get 10 万次，用 ThreadSanitizer 或 JCIP 的 ConcurrentLRUCache 对拍，结束后检查 map.size() == capacity 且链表长度 == capacity（两者必须相等，不等就是有孤儿节点泄漏）。死循环检测：遍历链表从 head 出发计数，超过 capacity+2（含哨兵）就 break 报错。

**Q：这道题做完，你沉淀出了什么可复用的设计模式？**

LRU 是"数据结构组合设计"的经典案例，沉淀出两条原则：一、"职责分离"——HashMap 管定位、链表管顺序，不要试图用单一结构搞定所有需求；二、"哨兵节点消除边界"——dummy head 和 dummy tail 互指，新建链表时就建好，所有插入/删除操作不用判空，代码量减半。这两条原则我也用在了 LFU（频次链表 + 节点链表 + HashMap）、跳表（多级索引 + 随机化）、并查集（路径压缩 + 按秩合并）的实现里，是通用套路。


## 结构化回答

**30 秒电梯演讲：** HashMap + 双向链表：HashMap提供O(1)查找，双向链表维护访问顺序，O(1)移动节点到头部。打个比方，就像书架上最常用的书放最前面——查书时从书架上取下(hashmap查找)放到最前面(链表头部)，满了就从最后面扔掉(淘汰尾部)。

**展开框架：**
1. **核心设计** — HashMap负责O(1)查找，双向链表负责O(1)维护时序
2. **双向链表原因** — 删除节点需找前驱，双向才能O(1)断开重连，单向需O(n)
3. **必须设哨兵节点** — dummy head和tail互指，彻底免除边界空指针判断

**收尾：** 这块我踩过坑——要不要深入聊：LFU Cache怎么实现？

## 视频脚本

> 预计时长：3 分钟 | 由浅入深

| 时间 | 画面/字幕 | 口播台词 | 讲解要点 |
|------|----------|----------|----------|
| 0:00 | 标题卡 | "设计题一句话：HashMap + 双向链表：HashMap提供O(1)查找，双向链表维护访问顺序…。" | 开场钩子 |
| 0:15 | 链表节点指针图 | "核心设计：HashMap负责O(1)查找，双向链表负责O(1)维护时序" | 核心设计 |
| 1:06 | 链表节点指针图分步演示 | "双向链表原因：删除节点需找前驱，双向才能O(1)断开重连，单向需O(n)" | 双向链表原因 |
| 1:57 | 关键代码/伪代码片段 | "必须设哨兵节点：dummy head和tail互指，彻底免除边界空指针判断" | 必须设哨兵节点 |
| 2:50 | 总结卡 | "核心抓住这条主线，下期咱们接着聊：LFU Cache怎么实现。" | 收尾 |
