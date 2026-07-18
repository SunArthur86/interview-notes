---
id: note-xhs-java-007
difficulty: L3
category: java
subcategory: 并发
tags:
- 拼多多
- Java服务端
- LRU
- 并发安全
- ConcurrentHashMap
- CAS
- 面经
feynman:
  essence: "LRU缓存淘汰策略——最近最少使用的先淘汰，核心是HashMap+双向链表的O(1)查找+O(1)删除，并发安全需无锁化设计"
  analogy: "想象一个只能放5本书的书架。每次看一本书就把它放最前面，书架满了时把最后那本（最久没看的）扔掉。多个人同时拿书时不能互相打架——用CAS无锁操作替代加锁"
  key_points:
  - HashMap提供O(1)查找，双向链表提供O(1)移动到头部/删除尾部
  - 基础版用ReentrantLock保证线程安全，但get频繁时锁竞争激烈
  - 高性能版用ConcurrentHashMap+CAS操作实现无锁读取
  - 面试要求手写get/put + 考虑并发安全
  - PDD追问：get频繁锁竞争激烈→CAS方案
first_principle:
  essence: "缓存的本质是'用空间换时间'。LRU的约束是'容量有限'，推导出'必须淘汰'。淘汰策略选择LRU是因为'时间局部性原理'——最近访问的数据更可能再次访问"
  derivation: "缓存容量有限→必须淘汰→淘汰谁？→选最不可能再被访问的→时间局部性原理告诉我们最近访问的更可能再访问→所以淘汰最久没访问的→需要O(1)完成查找+移动+淘汰→HashMap+双向链表"
  conclusion: "LRU = HashMap(O(1)查找) + 双向链表(O(1)增删移动)。并发场景下，锁粒度从全局锁→分段锁→CAS无锁逐步优化"
follow_up:
- 如果get操作远多于put，如何优化锁粒度？（提示：读写锁 vs CAS）
- LRU和LFU的区别是什么？什么场景下LFU更优？
- 如果缓存命中率不理想，你会如何调优？
- Redis的LRU实现和Java手写的有什么区别？
- CAS方案中如何解决ABA问题？
memory_points:
- HashMap + 双向链表 = LRU核心数据结构
- 并发安全三阶段：ReentrantLock → 读写锁 → ConcurrentHashMap+CAS
- 双向链表dummyHead/dummyTail简化边界处理
- CAS通过AtomicReference+自旋实现无锁更新
---

# 【拼多多 Java服务端】手撕LRU缓存，要求并发安全

> 来源：拼多多211本硕Java服务端面经（已OC）（小红书）

## 一、问题背景

面试官要求手撕LRU，不仅要写出get和put，还要考虑并发情况下的线程安全。候选人最初用ReentrantLock，面试官追问"如果get操作很频繁，锁竞争太激烈怎么办"，引导往ConcurrentHashMap + CAS方向改进。

## 二、基础版：ReentrantLock实现

```
┌──────────────────────────────────────────────┐
│              LRU Cache 结构                   │
│                                               │
│   HashMap<Integer, Node>                      │
│         │                                     │
│         ▼                                     │
│    ┌─────────┐    ┌─────────┐                 │
│    │ Node(1) │◄──►│ Node(2) │◄──► ... ◄──►   │
│    └─────────┘    └─────────┘                 │
│         │                                     │
│   dummyHead ◄──────────► dummyTail           │
│   (最近使用)              (最久未用→淘汰)      │
│                                               │
│   操作流程:                                    │
│   get(key): 查HashMap → 移到链表头部           │
│   put(k,v): 查HashMap → 更新/新建 → 移到头部   │
│             → 超容量则删除尾部                  │
└──────────────────────────────────────────────┘
```

```java
public class LRUCache {
    private final int capacity;
    private final Map<Integer, Node> map = new HashMap<>();
    private final Node dummyHead = new Node();
    private final Node dummyTail = new Node();
    private final ReentrantLock lock = new ReentrantLock();

    static class Node {
        int key, val;
        Node prev, next;
        Node() {}
        Node(int k, int v) { key = k; val = v; }
    }

    public LRUCache(int capacity) {
        this.capacity = capacity;
        dummyHead.next = dummyTail;
        dummyTail.prev = dummyHead;
    }

    public int get(int key) {
        lock.lock();
        try {
            Node node = map.get(key);
            if (node == null) return -1;
            moveToHead(node);
            return node.val;
        } finally {
            lock.unlock();
        }
    }

    public void put(int key, int value) {
        lock.lock();
        try {
            Node node = map.get(key);
            if (node != null) {
                node.val = value;
                moveToHead(node);
            } else {
                Node newNode = new Node(key, value);
                map.put(key, newNode);
                addToHead(newNode);
                if (map.size() > capacity) {
                    Node tail = removeTail();
                    map.remove(tail.key);
                }
            }
        } finally {
            lock.unlock();
        }
    }

    private void addToHead(Node node) {
        node.prev = dummyHead;
        node.next = dummyHead.next;
        dummyHead.next.prev = node;
        dummyHead.next = node;
    }

    private void removeNode(Node node) {
        node.prev.next = node.next;
        node.next.prev = node.prev;
    }

    private void moveToHead(Node node) {
        removeNode(node);
        addToHead(node);
    }

    private Node removeTail() {
        Node tail = dummyTail.prev;
        removeNode(tail);
        return tail;
    }
}
```

## 三、高性能版：ConcurrentHashMap + CAS

面试官追问的核心：**get操作远多于put时，全局锁导致吞吐量瓶颈**。

解决方案：读操作无锁化 + 写操作CAS化。

```
┌──────────────────────────────────────────────────┐
│           并发优化思路                            │
│                                                   │
│  方案1: ReentrantReadWriteLock                    │
│    get → readLock (共享)                           │
│    put → writeLock (独占)                          │
│    问题: 读锁会阻塞写锁，频繁put时退化             │
│                                                   │
│  方案2: ConcurrentHashMap + CAS  ⭐推荐            │
│    get → 完全无锁 (CHM的get不加锁)                 │
│    put → CAS更新链表指针                          │
│    链表操作 → AtomicReference<Node>               │
│                                                   │
│  方案3: 分段锁 (类似JDK7 ConcurrentHashMap)        │
│    不同key路由到不同Segment                        │
│    减少锁碰撞概率                                  │
└──────────────────────────────────────────────────┘
```

```java
public class ConcurrentLRUCache {
    private final int capacity;
    private final ConcurrentHashMap<Integer, Node> cache = new ConcurrentHashMap<>();
    // 链表头尾用AtomicReference保证可见性
    private final AtomicReference<Node> head = new AtomicReference<>();
    private final AtomicReference<Node> tail = new AtomicReference<>();

    static class Node {
        final int key;
        volatile int val;
        volatile Node prev;
        volatile Node next;
        Node(int k, int v) { key = k; val = v; }
    }

    public ConcurrentLRUCache(int capacity) {
        this.capacity = capacity;
    }

    // get完全无锁——利用ConcurrentHashMap的线程安全get
    public int get(int key) {
        Node node = cache.get(key);
        if (node == null) return -1;
        // 异步更新访问顺序（不阻塞读）
        moveToHeadCAS(node);
        return node.val;
    }

    public void put(int key, int value) {
        Node existing = cache.get(key);
        if (existing != null) {
            existing.val = value;
            moveToHeadCAS(existing);
            return;
        }
        Node newNode = new Node(key, value);
        Node prev = cache.putIfAbsent(key, newNode);
        if (prev != null) {
            // 并发put同一key，当前线程失败
            prev.val = value;
            moveToHeadCAS(prev);
            return;
        }
        addToHeadCAS(newNode);
        // 淘汰策略需要同步执行
        evictIfNeeded();
    }

    // CAS方式移动节点到头部
    private void moveToHeadCAS(Node node) {
        while (true) {
            Node currentHead = head.get();
            if (currentHead == node) return;
            // 尝试CAS更新
            // 先断开当前节点，再插入头部
            if (node.prev != null) {
                node.prev.next = node.next;
                if (node.next != null) {
                    node.next.prev = node.prev;
                }
            }
            node.next = currentHead;
            node.prev = null;
            if (currentHead != null) currentHead.prev = node;
            if (head.compareAndSet(currentHead, node)) {
                break;
            }
            // CAS失败，重试
        }
    }

    private void addToHeadCAS(Node node) {
        while (true) {
            Node currentHead = head.get();
            node.next = currentHead;
            node.prev = null;
            if (currentHead != null) currentHead.prev = node;
            if (head.compareAndSet(currentHead, node)) break;
        }
        if (tail.get() == null) {
            tail.compareAndSet(null, node);
        }
    }

    private void evictIfNeeded() {
        while (cache.size() > capacity) {
            Node currentTail = tail.get();
            if (currentTail == null) break;
            Node prev = currentTail.prev;
            if (tail.compareAndSet(currentTail, prev)) {
                if (prev != null) prev.next = null;
                cache.remove(currentTail.key);
            }
        }
    }
}
```

## 四、方案对比

| 方案 | 读性能 | 写性能 | 实现复杂度 | 适用场景 |
|------|--------|--------|-----------|---------|
| ReentrantLock | 差（串行） | 中 | 低 | 低并发场景 |
| ReadWriteLock | 好（共享） | 中 | 中 | 读多写少 |
| ConcurrentHashMap+CAS | 优（无锁） | 好 | 高 | 高并发读多写少 |
| 分段锁 | 好 | 好 | 高 | 通用高并发 |

## 五、面试加分点

1. **提及时间局部性原理**：LRU淘汰策略的理论基础是"最近访问的数据更可能再次被访问"
2. **dummyHead/dummyTail技巧**：使用哨兵节点避免null检查，简化链表边界处理
3. **LinkedHashMap实现**：Java的LinkedHashMap天然支持LRU模式（accessOrder=true + removeEldestEntry），但面试要求手写
4. **生产级方案**：Caffeine缓存使用W-TinyLFU算法（结合LRU+LFU），命中率显著优于纯LRU
5. **CAS的ABA问题**：在高并发LRU中，节点可能被删除后重新创建，可用版本号解决


## 结构化回答

**30 秒电梯演讲：** LRU缓存淘汰策略——最近最少使用的先淘汰，核心是HashMap+双向链表的O(1)查找+O(1)删除，并发安全需无锁化设计。

**展开框架：**
1. **HashMap** — HashMap + 双向链表 = LRU核心数据结构
2. **并发安全三阶段** — ReentrantLock → 读写锁 → ConcurrentHashMap+CAS
3. **双向链表** — 双向链表dummyHead/dummyTail简化边界处理

**收尾：** 这块我踩过坑——要不要深入聊：如果get操作远多于put，如何优化锁粒度？（提示：读写锁 vs CAS）？

## 视频脚本

> 预计时长：3 分钟 | 由浅入深

| 时间 | 画面/字幕 | 口播台词 | 讲解要点 |
|------|----------|----------|----------|
| 0:00 | 标题卡 | "并发一句话：LRU缓存淘汰策略——最近最少使用的先淘汰，核心是HashMap+双向链表的O(1)查找+O(1)删除…。" | 开场钩子 |
| 0:15 | 加锁/解锁时序图 | "HashMap + 双向链表 就是 LRU核心数据结构" | HashMap |
| 1:06 | 加锁/解锁时序图分步演示 | "并发安全三阶段：ReentrantLock 到 读写锁 到 ConcurrentHashMap+CAS" | 并发安全三阶段 |
| 1:57 | 关键代码/伪代码片段 | "双向链表dummyHead/dummyTail简化边界处理" | 双向链表 |
| 2:50 | 总结卡 | "核心抓住这条主线，下期咱们接着聊：如果get操作远多于put，如何优化锁粒度？（提示：读写锁 vs CAS）。" | 收尾 |

## 苏格拉底式面试追问

| 追问层级 | 面试官可能这样问 | 高分回答方向 |
|----------|------------------|--------------|
| 目标追问 | 并发安全的LRU缓存要同时满足哪几个目标？ | O(1)查找+O(1)淘汰的LRU语义、并发环境下线程安全、高并发下不能成为性能瓶颈（锁粒度要细） |
| 证据追问 | 为什么HashMap+双向链表能做到O(1)？讲清楚每一步 | get：HashMap定位节点O(1)+移动到链表头O(1)；put：满了淘汰尾节点O(1)+头插O(1)，所有操作指针操作常数级 |
| 边界追问 | synchronized锁整个LRU有什么问题？怎么优化？ | 全锁并发度=1成为瓶颈；优化方案：分段锁（Segment）、CAS+volatile、读写锁、Caffeine的RingBuffer+W-TinyLFU |
| 反例追问 | 只用ConcurrentHashMap能做并发LRU吗？缺什么？ | 不能。ConcurrentHashMap只能保证Map线程安全，但LRU需要维护双向链表顺序，链表更新操作不是原子的，需要额外同步 |
| 风险追问 | 并发LRU最容易出什么并发bug？ | 移动节点到链表头的指针操作不是原子的，并发下会丢数据或成环；淘汰和get并发可能淘汰正在访问的节点 |
| 验证追问 | 怎么验证你的并发LRU线程安全且淘汰正确？ | 多线程压测+断言容量恒定、用jcstress做并发正确性测试、对比Caffeine结果、检查链表无环 |
| 沉淀追问 | 生产环境你会自己手写LRU吗？ | 不会，生产用Caffeine（W-TinyLFU+RingBuffer高性能并发），手写LRU只作为面试理解和定制化场景储备 |

### 现场对话示例
**面试官**：手撕一个并发安全的LRU缓存。
**候选人**：HashMap+双向链表实现O(1)，get/put都先查Map再调整链表把访问节点移到头部，满了淘汰尾部；并发用分段锁或synchronized。
**面试官**：为什么HashMap加双向链表就能O(1)？
**候选人**：HashMap提供O(1)定位节点，双向链表的指针操作是常数级，移动到头或淘汰尾都是O(1)，不依赖链表长度。
**面试官**：synchronized锁整个LRU性能不行，怎么优化？
**候选人**：用分段锁提高并发度，或借鉴Caffeine用RingBuffer缓冲读操作+异步更新LRU顺序，把锁竞争降到最低。
