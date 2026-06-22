---
id: note-mt-agent-012
difficulty: L3
category: algorithm
subcategory: 链表
tags:
- 美团
- 面经
- 手撕
- 链表
- 重排链表
feynman:
  essence: 将链表重排为L0到Ln到L1到Ln-1到L2到Ln-2交替排列。
  analogy: 就像洗扑克牌从中间劈开一张正序一张逆序交错插入。
  first_principle: 三步走找中点反转后半交错合并。
  key_points:
  - 快慢指针找中点
  - 反转链表后半段
  - 双指针交错合并
  - 时间On空间O1
first_principle:
  essence: 链表操作组合查找加反转加合并
  derivation: 重排等于正序加逆序交替需要后半段逆序先找中点反转后半交替合并
  conclusion: 重排链表等于快慢指针加反转加合并经典组合题
follow_up:
- 链表有环怎么处理？
- 能否用栈来做空间多少？
- 递归解法思路？
---

# 【美团面经】手撕：重排链表（LeetCode 143）

## 一、题目描述

给定一个单链表 `L: L0 → L1 → … → Ln-1 → Ln`，重新排列为 `L0 → Ln → L1 → Ln-1 → L2 → Ln-2 → …`。

**示例：**
```
输入: 1 → 2 → 3 → 4 → 5
输出: 1 → 5 → 2 → 4 → 3

输入: 1 → 2 → 3 → 4
输出: 1 → 4 → 2 → 3
```

**要求**：不能只是修改节点的值，必须实际修改节点链接关系。要求 **O(n) 时间、O(1) 空间**。

---

## 二、解题思路：三步走

```
原始链表：  1 → 2 → 3 → 4 → 5 → null

Step 1 - 快慢指针找中点：
  前半段：1 → 2 → 3        （slow 停在中点3）
  后半段：4 → 5

Step 2 - 反转后半段：
  前半段：1 → 2 → 3
  后半段：5 → 4             （反转后）

Step 3 - 交错合并：
  1 → 5 → 2 → 4 → 3 → null
```

这是三个经典链表操作的组合：**快慢指针 + 反转链表 + 合并链表**。

---

## 三、Python 完整实现

```python
# Definition for singly-linked list.
class ListNode:
    def __init__(self, val=0, next=None):
        self.val = val
        self.next = next

class Solution:
    def reorderList(self, head: ListNode) -> None:
        """
        Do not return anything, modify head in-place instead.
        """
        if not head or not head.next:
            return
        
        # ============ Step 1: 快慢指针找中点 ============
        slow, fast = head, head
        while fast.next and fast.next.next:
            slow = slow.next       # slow 走1步
            fast = fast.next.next  # fast 走2步
        # slow 现在指向中点（奇数个节点时是正中间）
        
        # ============ Step 2: 反转后半段 ============
        second = slow.next   # 后半段起点
        slow.next = None     # 断开前半段和后半段
        second = self._reverse(second)  # 反转后半段
        
        # ============ Step 3: 交错合并 ============
        first = head
        while second:        # second 可能比 first 短，用 second 控制循环
            tmp1 = first.next
            tmp2 = second.next
            first.next = second    # first → second
            second.next = tmp1     # second → first原下一个
            first = tmp1           # first 前进
            second = tmp2          # second 前进
    
    def _reverse(self, node: ListNode) -> ListNode:
        """迭代法反转链表"""
        prev = None
        curr = node
        while curr:
            nxt = curr.next   # 暂存下一个
            curr.next = prev  # 反转指向
            prev = curr       # prev前进
            curr = nxt        # curr前进
        return prev           # 返回新头节点


# ====== 测试 ======
def build_list(vals):
    dummy = ListNode()
    cur = dummy
    for v in vals:
        cur.next = ListNode(v)
        cur = cur.next
    return dummy.next

def print_list(head):
    res = []
    while head:
        res.append(str(head.val))
        head = head.next
    print(" → ".join(res))

# 测试
head = build_list([1, 2, 3, 4, 5])
Solution().reorderList(head)
print_list(head)  # 输出: 1 → 5 → 2 → 4 → 3
```

---

## 四、Java 完整实现

```java
/**
 * Definition for singly-linked list.
 * public class ListNode {
 *     int val;
 *     ListNode next;
 *     ListNode() {}
 *     ListNode(int val) { this.val = val; }
 *     ListNode(int val, ListNode next) { this.val = val; this.next = next; }
 * }
 */
class Solution {
    public void reorderList(ListNode head) {
        if (head == null || head.next == null) return;

        // ========== Step 1: 快慢指针找中点 ==========
        ListNode slow = head, fast = head;
        while (fast.next != null && fast.next.next != null) {
            slow = slow.next;
            fast = fast.next.next;
        }
        // slow 指向中点

        // ========== Step 2: 反转后半段 ==========
        ListNode second = slow.next;  // 后半段起点
        slow.next = null;             // 断开前后两段
        second = reverse(second);     // 反转后半段

        // ========== Step 3: 交错合并 ==========
        ListNode first = head;
        while (second != null) {
            ListNode tmp1 = first.next;
            ListNode tmp2 = second.next;

            first.next = second;   // first → second
            second.next = tmp1;    // second → first原下一个

            first = tmp1;          // 前进
            second = tmp2;
        }
    }

    /** 迭代法反转链表 */
    private ListNode reverse(ListNode node) {
        ListNode prev = null;
        ListNode curr = node;
        while (curr != null) {
            ListNode next = curr.next;  // 暂存
            curr.next = prev;           // 反转
            prev = curr;                // 前进
            curr = next;
        }
        return prev;  // 新头节点
    }
}
```

---

## 五、图解三步细节

### Step 1 - 快慢指针找中点

```
初始：  slow          fast
        ↓              ↓
        1 → 2 → 3 → 4 → 5 → null

第1轮：     slow   fast
             ↓      ↓
        1 → 2 → 3 → 4 → 5 → null

终止条件：fast.next.next == null（无法再走2步）
slow 停在节点 3（中点）
```

> **为什么用 `fast.next && fast.next.next`？**
> 当 fast 停在最后一个节点（奇数长度）或倒数第二个节点后越界（偶数长度）时终止，保证 slow 恰好停在前半段的最后一个节点。

### Step 2 - 反转后半段

```
断开后：
  前半段：1 → 2 → 3 → null
  后半段：4 → 5 → null

反转过程：
  prev  curr
  null   4 → 5 → null
    ↓
  null ← 4    5 → null     （4.next = null）
         ↓
   4 ←   5 → null          （5.next = 4）
         ↓
  prev=5, curr=null → 结束

结果：5 → 4 → null
```

### Step 3 - 交错合并

```
first: 1 → 2 → 3 → null
second:5 → 4 → null

轮次1: 1 → 5 → 2 → 3 → null    first=2, second=4
轮次2: 1 → 5 → 2 → 4 → 3 → null first=3, second=null
second=null → 循环结束 ✅
```

---

## 六、复杂度分析

| 维度 | 复杂度 | 说明 |
|------|--------|------|
| **时间** | O(n) | 找中点 O(n) + 反转 O(n/2) + 合并 O(n/2) = O(n) |
| **空间** | O(1) | 只用常数个指针变量，原地修改 |

---

## 七、面试追问

### Q1：能否用栈来做？空间多少？

```python
# 用栈的解法 —— 空间 O(n)
def reorderList_stack(head):
    stack = []
    cur = head
    while cur:
        stack.append(cur)
        cur = cur.next
    
    cur = head
    n = len(stack)
    for i in range(n // 2):
        # 取栈顶（链表尾部）插入当前节点后面
        tail = stack.pop()
        nxt = cur.next
        cur.next = tail
        tail.next = nxt
        cur = nxt
    
    # 最后一个节点指向 null
    cur.next = None
```

空间复杂度 **O(n)**，时间 O(n)。面试时可以先说栈解法（容易想到），再优化到 O(1)。

### Q2：链表有环怎么办？

有环时快慢指针找中点会死循环。需先检测环（Floyd 判圈），如果有环需先断环或拒绝处理。

### Q3：递归解法思路？

从尾到头递归，每次处理一头一尾两个节点。但递归深度 O(n)，空间 O(n) 栈空间，**不满足 O(1) 要求**，了解即可。

```python
def reorderList_recursive(head):
    # 递归到中间节点，回溯时交替连接
    # 不推荐：栈空间 O(n)
    pass
```

---

## 八、总结

| 要点 | 内容 |
|------|------|
| 核心思想 | 找中点 + 反转后半 + 交错合并 |
| 时间复杂度 | O(n) |
| 空间复杂度 | O(1)（最优解）/ O(n)（栈解法） |
| 易错点 | 快慢指针终止条件、断开前后链表、合并时暂存 next |
| 延伸 | 这题是「快慢指针」「反转链表」「合并链表」三个经典模板的组合 |
