---
id: note-fl-016
difficulty: L2
category: ai
subcategory: 算法
tags:
- 字节
- 飞连
- 面经
- 链表
- 双指针
feynman:
  essence: 合并两个有序链表用双指针 + dummy head。dummy 是哨兵节点，避免"头节点单独处理"的冗余逻辑。每次比较两链表当前节点，小的接到结果链表后，指针后移。最后把未空的链表直接接上。时间 O(m+n)，空间 O(1)（只动指针不创建新节点）。面试默认要求迭代（递归在长链表会爆栈）。
  analogy: 像两个已经排好队的人合并成一队——每次比较两队队首谁矮，矮的先入新队，直到一队空了，另一队剩余的直接接后面。dummy 像一个虚拟队长，避免你纠结"第一个人怎么处理"。
  first_principle: 有序合并的本质是"双指针同步扫描，每次取较小者"。dummy head 把"头节点边界条件"统一成"普通节点处理"，消除特判。
  key_points:
  - 'dummy head 哨兵节点，消除头节点特判'
  - '双指针同步扫描，每次取较小者接到结果链表'
  - 'while l1 and l2，一空就停'
  - '最后 cur.next = l1 if l1 else l2 直接接剩余（别再while）'
  - '迭代默认（递归在长链表爆栈），比较用<=保证稳定'
first_principle:
  essence: 有序合并 = 双指针扫描 + 取较小者
  derivation: 两序列有序 → 同步扫描比较当前元素 → 取较小者输出 → 一序列空了另一序列剩余必有序 → 直接拼接
  conclusion: dummy head 是消除边界条件的标准技巧，让代码更简洁
follow_up:
- 合并 K 个有序链表怎么做？
- 链表合并 vs 数组合并，空间复杂度差异？
- 如果两个链表有环，怎么处理？
---

# 【字节飞连面经】算法：合并两个有序链表（LeetCode 21）

## 一、核心思路：双指针 + dummy head

```python
# Definition for singly-linked list.
# class ListNode:
#     def __init__(self, val=0, next=None):
#         self.val = val
#         self.next = next

class Solution:
    def mergeTwoLists(self, l1: ListNode, l2: ListNode) -> ListNode:
        dummy = ListNode()    # 哨兵节点
        cur = dummy
        while l1 and l2:
            if l1.val <= l2.val:    # <= 保证稳定（相等时 l1 优先）
                cur.next = l1
                l1 = l1.next
            else:
                cur.next = l2
                l2 = l2.next
            cur = cur.next
        cur.next = l1 if l1 else l2   # 直接接剩余，别再 while
        return dummy.next
```

## 二、为什么用 dummy head

**不用 dummy**：头节点要特判（第一个节点要单独赋值，因为没有一个"前驱"可以 `.next`）。

**用 dummy**：所有节点都通过 `cur.next = x` 接入，统一处理，消除特判。最后返回 `dummy.next`（真正的头）。

```
不用 dummy:
  if not head: head = node; cur = head
  else: cur.next = node; cur = cur.next    # 特判头节点

用 dummy:
  cur = dummy
  cur.next = node; cur = cur.next           # 统一处理
  return dummy.next                          # 返回时跳过 dummy
```

## 三、复杂度

| 维度 | 复杂度 | 说明 |
|------|--------|------|
| 时间 | O(m+n) | 每个节点访问一次 |
| 空间 | **O(1)** | 只用几个指针，**没创建新节点**（在原节点上改 next） |

## 四、面试要点

1. **用 dummy head** 避免"头节点单独处理"的冗余
2. **比较用 `<=`** 保证稳定（相等时 l1 优先，保持原相对顺序）
3. **最后 `cur.next = l1 if l1 else l2`** 直接接上剩余的——别傻乎乎再 while 一遍
4. **面试默认要求迭代**（递归在长链表上会爆栈，递归深度 = 链表长度）

## 五、递归写法（≤5 行，但面试不推荐）

```python
def mergeTwoLists(self, l1, l2):
    if not l1 or not l2:
        return l1 or l2
    if l1.val <= l2.val:
        l1.next = self.mergeTwoLists(l1.next, l2)
        return l1
    else:
        l2.next = self.mergeTwoLists(l1, l2.next)
        return l2
```

**不推荐原因**：递归深度 = 链表长度，长链表（>1000）会 `RecursionError`。

## 六、追问：合并 K 个有序链表

**解法 1：最小堆**
```python
import heapq
def mergeKLists(lists):
    heap = [(head.val, i, head) for i, head in enumerate(lists) if head]
    heapq.heapify(heap)
    dummy = cur = ListNode()
    while heap:
        val, i, node = heapq.heappop(heap)
        cur.next = node
        cur = cur.next
        if node.next:
            heapq.heappush(heap, (node.next.val, i, node.next))
    return dummy.next
```
时间 O(N log K)，N=总节点数，K=链表数。

**解法 2：分治两两合并**——时间也是 O(N log K)。

## 七、扩展

- **链表 vs 数组合并**：链表合并空间 O(1)（改指针），数组合并空间 O(m+n)（要新建数组）
- **原地合并两个有序数组**（LeetCode 88）：从后往前填，避免覆盖——`nums1` 末尾有预留空间
- **合并后的稳定性**：用 `<=`（不是 `<`）保证相等元素保持原顺序，这在排序稳定性场景很重要
