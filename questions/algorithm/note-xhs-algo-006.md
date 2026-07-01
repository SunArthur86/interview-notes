---
id: note-xhs-algo-006
difficulty: L2
category: algorithm
subcategory: 链表
tags:
- 链表
- 反转
- 双指针
- 迭代
- 递归
feynman:
  essence: 反转链表就是把每个节点的next指针从「指向后一个」改成「指向前一个」。迭代法用三个指针（prev/curr/next）逐个翻转。
  analogy: "想象一排人手拉手面朝右（1→2→3→4→5）。反转就是让每个人转过身来拉住前面的人：第一个人拉住null，第二个人拉住第一个，以此类推。最后整排人变成了面朝左（5→4→3→2→1）。"
  key_points:
  - 迭代法：prev/curr/next三指针，O(n)时间O(1)空间
  - 递归法：递归到末尾再逐层翻转指针，O(n)空间
  - 核心操作：curr.next=prev
  - 面试推荐写迭代法（空间更优）
  - 变形：反转部分链表(LC92)、K个一组翻转(LC25)
first_principle:
  problem: "链表是单向指针连接的线性结构，如何在不使用额外空间的情况下反转方向？"
  axioms:
  - 链表的「方向」由next指针决定
  - 反转=把所有next指针改为指向相反方向
  - 需要保存下一个节点的引用才能安全修改当前节点的指针
  - 三个指针(prev/curr/next)足以完成原地翻转
  rebuild: "从链表指针的本质出发：保存next→翻转curr.next→前进prev和curr。三个指针是最小完备集，不需要额外数据结构。递归利用系统栈隐式保存prev，但空间换时间"
follow_up:
- 递归反转的空间复杂度为什么是O(n)？
- 如何判断链表是否有环？如何找到环的入口？
- K个一组翻转链表怎么实现？（LeetCode 25）
- 反转链表和反转数组的时间复杂度一样，但实际性能差异在哪？
---

# 反转单链表（O(n)时间 O(1)空间）（华为od Java一面）

## 一、题目

```
输入: 1 → 2 → 3 → 4 → 5 → null
输出: 5 → 4 → 3 → 2 → 1 → null
```

## 二、解法1：迭代法（推荐⭐）

```java
public ListNode reverseList(ListNode head) {
    ListNode prev = null;
    ListNode curr = head;
    
    while (curr != null) {
        ListNode next = curr.next;  // 1. 保存下一个节点
        curr.next = prev;           // 2. 反转指针方向
        prev = curr;                // 3. prev前进
        curr = next;                // 4. curr前进
    }
    
    return prev;  // prev就是新的头节点
}
```

### 执行过程

```
初始:  prev=null  curr=1→2→3→4→5

Step1: next=2, 1.next=null, prev=1, curr=2
       null←1   2→3→4→5

Step2: next=3, 2.next=1, prev=2, curr=3
       null←1←2   3→4→5

Step3: next=4, 3.next=2, prev=3, curr=4
       null←1←2←3   4→5

Step4: next=5, 4.next=3, prev=4, curr=5
       null←1←2←3←4   5

Step5: next=null, 5.next=4, prev=5, curr=null
       null←1←2←3←4←5

curr=null → 循环结束 → return prev=5
```

**时间复杂度**: O(n) — 遍历一次
**空间复杂度**: O(1) — 只用3个指针变量

## 三、解法2：递归法

```java
public ListNode reverseList(ListNode head) {
    // base case: 空链表或单节点
    if (head == null || head.next == null) {
        return head;
    }
    
    // 递归反转后面的部分
    ListNode newHead = reverseList(head.next);
    
    // head.next 此时是反转后子链表的尾节点
    head.next.next = head;  // 反转指针
    head.next = null;       // 断开原来的正向指针
    
    return newHead;
}
```

### 递归执行过程

```
reverseList(1→2→3→4→5)
  → reverseList(2→3→4→5)
    → reverseList(3→4→5)
      → reverseList(4→5)
        → reverseList(5)
          ← return 5  (base case)
        5.next = 4, 4.next = null
        ← return 5
      4.next = 3, 3.next = null
      ← return 5
    3.next = 2, 2.next = null
    ← return 5
  2.next = 1, 1.next = null
  ← return 5

最终: 5→4→3→2→1→null
```

**时间复杂度**: O(n)
**空间复杂度**: O(n) — 递归栈深度

## 四、解法3：头插法（重建链表）

```java
public ListNode reverseList(ListNode head) {
    ListNode dummy = new ListNode(0);
    
    while (head != null) {
        ListNode next = head.next;
        head.next = dummy.next;  // 头插到dummy后面
        dummy.next = head;
        head = next;
    }
    
    return dummy.next;
}
```

## 五、面试变形题

### 1. 反转链表的一部分（LeetCode 92）

```java
public ListNode reverseBetween(ListNode head, int left, int right) {
    ListNode dummy = new ListNode(0, head);
    ListNode prev = dummy;
    // 移动到left前一个
    for (int i = 1; i < left; i++) prev = prev.next;
    
    ListNode curr = prev.next;
    // 头插法反转 left到right
    for (int i = left; i < right; i++) {
        ListNode next = curr.next;
        curr.next = next.next;
        next.next = prev.next;
        prev.next = next;
    }
    return dummy.next;
}
```

### 2. K个一组翻转链表（LeetCode 25）

```
输入: 1→2→3→4→5, K=2
输出: 2→1→4→3→5
```