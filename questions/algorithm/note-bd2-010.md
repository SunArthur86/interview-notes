---
id: note-bd2-010
difficulty: L3
category: algorithm
subcategory: 设计
tags:
- 字节
- 面经
- 算法
- 设计题
- 哈希表
- 双向链表
- LeetCode146
feynman:
  essence: HashMap提供O(1)查找，双向链表维护访问顺序，两者结合实现O(1)的get和put
  analogy: 就像书架上找书——HashMap是书名目录(O(1)找到位置)，双向链表是按"最近阅读"排列的书架。每次看书就把它移到最前面，满了就丢最后那本
  first_principle: 'LRU(Least Recently Used)要求: (1) O(1)查找 (2) O(1)更新访问顺序。HashMap解决查找，双向链表解决顺序维护'
  key_points:
  - 'HashMap: key→链表节点，O(1)查找'
  - '双向链表: 维护访问顺序，最近访问在head，最久未访问在tail'
  - 'get: 查HashMap→移到链表head→返回值'
  - 'put: 存在则更新+移到head，不存在则新建+判断容量淘汰tail'
first_principle:
  essence: LRU的数据结构设计 = O(1)查找 + O(1)顺序维护
  derivation: '单独用HashMap: 查找O(1)但无法维护顺序。单独用链表: 顺序O(1)但查找O(n)。HashMap+双向链表: 两者都O(1)'
  conclusion: HashMap+双向链表是LRU的最优数据结构组合
follow_up:
- 为什么用双向链表而不是单向链表？
- 如何实现LFU(最不经常使用)缓存？
- Redis的LRU淘汰策略和这个实现有什么区别？
memory_points:
- 核心结构：HashMap + 双向链表。因为要O(1)读写，所以用Map查位置，用链表保顺序。
- 顺序维护：链表头部存最近访问，尾部存最久未使用（LRM）。
- 操作口诀：读/写先移至表头，容量满则删尾结点。
- 必须用虚拟头尾：因为能避免空指针判断，所以大幅简化边界处理。
---

# 手撕：力扣146.LRU缓存（带输入输出版本）

## 数据结构设计

```
HashMap + 双向链表

HashMap: { key → Node }
  key1 → Node(key1, val1)
  key2 → Node(key2, val2)
  ...

双向链表 (head ←→ ... ←→ tail):
  head ←→ [Node A(最近)] ←→ [Node B] ←→ [Node C(最久)] ←→ tail

  head端 = 最近使用
  tail端 = 最久未使用 → 淘汰从这里删
```

## 图解操作

```
初始状态 (capacity=2):
  HashMap: {}
  List: head ←→ tail

put(1, 1):
  HashMap: {1→Node(1,1)}
  List: head ←→ [1,1] ←→ tail

put(2, 2):
  HashMap: {1→Node(1,1), 2→Node(2,2)}
  List: head ←→ [2,2] ←→ [1,1] ←→ tail

get(1):  ← 访问key=1，移到head
  返回: 1
  List: head ←→ [1,1] ←→ [2,2] ←→ tail

put(3, 3):  ← 容量满! 淘汰tail(key=2)，加入key=3
  HashMap: {1→Node(1,1), 3→Node(3,3)}  ← key=2被删除
  List: head ←→ [3,3] ←→ [1,1] ←→ tail

get(2):  ← key=2已被淘汰
  返回: -1
```

## 完整代码

```python
class Node:
    """双向链表节点"""
    def __init__(self, key=0, val=0):
        self.key = key
        self.val = val
        self.prev = None
        self.next = None


class LRUCache:
    def __init__(self, capacity: int):
        self.capacity = capacity
        self.cache = {}  # key → Node
        
        # 虚拟头尾节点 (简化边界处理)
        self.head = Node()  # dummy head
        self.tail = Node()  # dummy tail
        self.head.next = self.tail
        self.tail.prev = self.head
    
    def _remove(self, node: Node):
        """从链表中删除节点 O(1)"""
        node.prev.next = node.next
        node.next.prev = node.prev
    
    def _add_to_head(self, node: Node):
        """在head后插入节点 O(1)"""
        node.next = self.head.next
        node.prev = self.head
        self.head.next.prev = node
        self.head.next = node
    
    def _move_to_head(self, node: Node):
        """将已有节点移到head O(1)"""
        self._remove(node)
        self._add_to_head(node)
    
    def _remove_tail(self) -> Node:
        """删除tail前一个节点(最久未使用) O(1)"""
        lru = self.tail.prev
        self._remove(lru)
        return lru
    
    def get(self, key: int) -> int:
        """O(1)"""
        if key in self.cache:
            node = self.cache[key]
            self._move_to_head(node)  # 访问后移到head
            return node.val
        return -1
    
    def put(self, key: int, value: int) -> None:
        """O(1)"""
        if key in self.cache:
            # key已存在: 更新值 + 移到head
            node = self.cache[key]
            node.val = value
            self._move_to_head(node)
        else:
            # key不存在: 创建新节点
            node = Node(key, value)
            self.cache[key] = node
            self._add_to_head(node)
            
            # 检查容量
            if len(self.cache) > self.capacity:
                # 淘汰最久未使用
                lru = self._remove_tail()
                del self.cache[lru.key]


# ===== 带输入输出的测试版本 =====
if __name__ == "__main__":
    import sys
    input_data = sys.stdin.read().split()
    idx = 0
    
    capacity = int(input_data[idx]); idx += 1
    n = int(input_data[idx]); idx += 1
    
    cache = LRUCache(capacity)
    
    for _ in range(n):
        op = input_data[idx]; idx += 1
        if op == "put":
            key = int(input_data[idx]); idx += 1
            val = int(input_data[idx]); idx += 1
            cache.put(key, val)
        elif op == "get":
            key = int(input_data[idx]); idx += 1
            print(cache.get(key))
```

## 为什么用双向链表

```python
# 单向链表的问题: 删除节点需要知道前驱节点

# ❌ 单向链表删除节点: O(n)找前驱
def delete_singly(node):
    prev = head
    while prev.next != node:
        prev = prev.next
    prev.next = node.next  # 找到前驱才能删

# ✅ 双向链表删除节点: O(1)直接删
def delete_doubly(node):
    node.prev.next = node.next
    node.next.prev = node.prev
    # 不需要遍历找前驱!
```

## 复杂度证明

| 操作 | 时间 | 空间 | 说明 |
|------|------|------|------|
| get | O(1) | O(1) | HashMap查找O(1) + 链表移动O(1) |
| put | O(1) | O(1) | HashMap插入O(1) + 链表操作O(1) |
| 总空间 | - | O(capacity) | HashMap和链表各存capacity个节点 |

## Redis中的LRU实现

```python
# Redis的LRU不是精确的链表实现，而是近似LRU:
# 1. 每个key记录最后访问时间戳(24bit)
# 2. 淘汰时随机采样N个key(默认5)，淘汰最久未使用的
# 3. 牺牲精度换取内存(不需要维护链表指针)

# Redis 4.0+ 还支持LFU(Least Frequently Used):
# 记录访问频率而非时间，用Morris计数器近似
```

## LRU vs LFU

| 策略 | 淘汰依据 | 优点 | 缺点 |
|------|---------|------|------|
| LRU | 最后访问时间 | 实现简单 | 偶尔访问的大批量数据会挤掉热点 |
| LFU | 访问频率 | 保留真正热点 | 新数据容易被淘汰(冷启动问题) |
| LRU-K | 最近K次访问 | 平衡 | 实现复杂 |
| ARC | 自适应LRU+LFU | 自动调优 | 实现最复杂 |

## 记忆要点

- 核心结构：HashMap + 双向链表。因为要O(1)读写，所以用Map查位置，用链表保顺序。
- 顺序维护：链表头部存最近访问，尾部存最久未使用（LRM）。
- 操作口诀：读/写先移至表头，容量满则删尾结点。
- 必须用虚拟头尾：因为能避免空指针判断，所以大幅简化边界处理。


## 苏格拉底式面试追问

> 这组追问模拟面试官层层逼问，每一问先回答"为什么"，再回答"怎么做"，最后回答"如何证明"。

### 第一层：目标与动机

**Q：手写 LRU 你用虚拟头尾节点（dummy head/tail），为什么不直接用 head/tail 指针？**

不设哨兵的话，链表为空、只有一个节点、删除头/尾节点这些边界都要单独写 if 分支，代码里充斥 `if (head == null)`、`if (node == head)`、`if (node == tail)`，极易写漏。设虚拟节点后，head 和 tail 永远存在（初始化时 `dummyHead.next = dummyTail; dummyTail.prev = dummyHead`），所有节点的 prev/next 都不为 null，删除和插入的代码完全统一，不用判空。代价是多两个 Node 对象的内存（几十字节），换来代码量减半 + bug 概率骤降。这是链表类题目的通用优化，哨兵思想在 LRU、跳表、链表反转里都适用。

### 第二层：证据与定位

**Q：你说所有操作 O(1)，那 put 满容量淘汰 tail.prev 时是几步？怎么确认真的是 O(1)？**

四步，每步 O(1)：① `Node toRemove = tail.prev`（拿到最久未访问节点，O(1)）；② `removeNode(toRemove)`（双向链表，toRemove.prev/next 直接拿到，三行指针操作，O(1)）；③ `map.remove(toRemove.key)`（HashMap 删除，O(1) 均摊）；④ 新节点插入 head 之后 + `map.put(k, node)`。每一步都是常数操作，没有遍历，所以总 O(1)。关键证据：链表操作没遍历（靠 prev/next 指针直接定位）、HashMap 操作没遍历（靠 hash 直接定位）。如果某一步退化成遍历（比如用单链表找前驱），整体就不是 O(1) 了。

### 第三层：根因深挖

**Q：你的 put 方法里，如果 key 已存在，你是先更新 value 还是先移到表头？顺序错了会怎样？**

顺序无所谓，但要保证两件事都做。如果只移到表头不更新 value，get 出来还是旧值（逻辑错误）；如果只更新 value 不移到表头，访问时间没刷新，会被提前淘汰（LRU 语义错误）。正确做法：先 `map.get(k)` 拿到 node，更新 `node.value = v`，再 `removeNode(node); addToHead(node)`。常见的 bug 是漏了移到表头这一步——因为"key 已存在"和"新插入"两条分支容易写分裂。建议把"移到表头"抽成独立方法 `makeRecent(node)`，两条分支都调用，避免遗漏。这是 LRU 最常见的隐蔽 bug。

**Q：那为什么不直接用 LinkedHashMap，它不是内置支持 LRU 吗？**

LinkedHashMap 确实能做 LRU——`new LinkedHashMap<>(capacity, 0.75f, true)` 第三个参数 true 表示按访问顺序排序，重写 `removeEldestEntry` 即可自动淘汰。生产代码我会直接用它（5 行搞定）。但面试场景下面试官要的是"手写证明你懂原理"，用 LinkedHashMap 等于回避了核心考点（HashMap+双向链表的组合、O(1) 操作的实现）。所以标准回答：先说"生产用 LinkedHashMap 或 Caffeine"，再补"但我能从头手写，原理是..."。两条腿走路，既显工程理性又显底层功底。

### 第四层：方案权衡

**Q：Redis 用近似 LRU（采样 5 个 key）而不是你这种精确 LRU，这个权衡你怎么看？**

Redis 是单线程，全局链表的挪节点操作会让主循环阻塞，且百万 key 下链表指针多耗几十 MB。近似 LRU 随机采样 5 个淘汰最旧的，命中率比精确 LRU 低约 1-5%，但零额外内存 + 零挪动开销。权衡逻辑：Redis 的核心矛盾是"单线程吞吐"而不是"淘汰精度"，1-5% 命中率损失换来主循环不被拖慢是值得的。Redis 4.0 引入 LFU（用 Morris 计数器近似频率），进一步说明"近似算法 + 低开销"在工程里常胜过"精确算法 + 高开销"。我手写的精确 LRU 适合单机小规模缓存（万级 key），大规模场景必须借鉴 Redis 的分片/采样思路。

**Q：为什么不直接用 LFU 替代 LRU，LFU 不是命中率更高吗？**

LFU 有冷启动问题——新加入的 key 访问频率初始为 0/1，容易被误淘汰，即使它是未来的热点。LRU 至少给新 key 一个"最近访问"的初始权重。Caffeine 用 Window-TinyLFU 把两者结合：新 key 进 LRU 窗口（保护新数据）+ TinyLFU 段（按频率淘汰），综合命中率比纯 LRU/LFU 都高 30%+。所以"谁更好"不是绝对的——短时热点场景 LRU 好、长期稳定热点 LFU 好、混合场景 Window-TinyLFU 最好。选型要看访问模式，生产环境推荐直接用 Caffeine 让它自动适配。

### 第五层：验证与沉淀

**Q：你怎么验证 LRU 在并发下不会出现链表节点丢失或死循环？**

三步验证：① 单线程功能测试——LeetCode 146 官方用例 + capacity=1 边界 + 反复 put 同 key 测更新；② 并发压力测试——10 线程各做 10 万次随机 get/put，结束后 `assert map.size() == capacity` 且遍历链表节点数 == capacity（多余则有泄漏、少则有丢失）；③ 与并发基准对拍——用 `ConcurrentHashMap` 包裹的加锁版本作为 oracle，随机操作序列下两个缓存状态应最终一致（容量满后淘汰策略相同）。死循环检测：遍历链表从 head 出发，节点数超过 capacity+2 就 break 报错（链表成环的征兆）。

**Q：这道题沉淀出了什么可复用的设计经验？**

两条可复用原则：一、"职责分离 + 组合数据结构"——单一结构难以同时满足多种需求（查找快 + 顺序维护），用 HashMap 管定位、链表管顺序，各司其职。这个思路也适用于 LFU（HashMap + 频次链表 + 节点链表）、LRU-K（HashMap + 历史队列 + 主缓存）；二、"哨兵消除边界"——虚拟头尾节点让链表操作代码统一，这个技巧在所有链表题（反转、合并、删除）里都该默认使用。这两条原则我已经写进了个人算法模板库，每次写链表/缓存类题先套模板再填业务逻辑。


## 结构化回答

**30 秒电梯演讲：** HashMap提供O(1)查找，双向链表维护访问顺序，两者结合实现O(1)的get和put。

**展开框架：**
1. **核心结构** — HashMap + 双向链表。因为要O(1)读写，所以用Map查位置，用链表保顺序。
2. **顺序维护** — 链表头部存最近访问，尾部存最久未使用（LRM）。
3. **操作口诀** — 读/写先移至表头，容量满则删尾结点。

**收尾：** 这块我踩过坑——要不要深入聊：为什么用双向链表而不是单向链表？

## 视频脚本

> 预计时长：3 分钟 | 由浅入深

| 时间 | 画面/字幕 | 口播台词 | 讲解要点 |
|------|----------|----------|----------|
| 0:00 | 标题卡 | "设计一句话：HashMap提供O(1)查找，双向链表维护访问顺序，两者结合实现O(1)的get和put。" | 开场钩子 |
| 0:15 | 链表节点指针图 | "核心结构：HashMap + 双向链表。因为要O(1)读写，所以用Map查位置，用链表保顺序。" | 核心结构 |
| 1:06 | 链表节点指针图分步演示 | "顺序维护：链表头部存最近访问，尾部存最久未使用（LRM）。" | 顺序维护 |
| 1:57 | 关键代码/伪代码片段 | "操作口诀：读/写先移至表头，容量满则删尾结点。" | 操作口诀 |
| 2:50 | 总结卡 | "核心抓住这条主线，下期咱们接着聊：为什么用双向链表而不是单向链表。" | 收尾 |
