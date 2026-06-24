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
  essence: 'HashMap提供O(1)查找，双向链表维护访问顺序，两者结合实现O(1)的get和put'
  analogy: '就像书架上找书——HashMap是书名目录(O(1)找到位置)，双向链表是按"最近阅读"排列的书架。每次看书就把它移到最前面，满了就丢最后那本'
  first_principle: 'LRU(Least Recently Used)要求: (1) O(1)查找 (2) O(1)更新访问顺序。HashMap解决查找，双向链表解决顺序维护'
  key_points:
    - 'HashMap: key→链表节点，O(1)查找'
    - '双向链表: 维护访问顺序，最近访问在head，最久未访问在tail'
    - 'get: 查HashMap→移到链表head→返回值'
    - 'put: 存在则更新+移到head，不存在则新建+判断容量淘汰tail'
first_principle:
  essence: 'LRU的数据结构设计 = O(1)查找 + O(1)顺序维护'
  derivation: '单独用HashMap: 查找O(1)但无法维护顺序。单独用链表: 顺序O(1)但查找O(n)。HashMap+双向链表: 两者都O(1)'
  conclusion: 'HashMap+双向链表是LRU的最优数据结构组合'
follow_up:
  - '为什么用双向链表而不是单向链表？'
  - '如何实现LFU(最不经常使用)缓存？'
  - 'Redis的LRU淘汰策略和这个实现有什么区别？'
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
