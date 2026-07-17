---
id: note-xhs-algo-011
difficulty: L1
category: algorithm
subcategory: 链表
tags:
- 链表
- 反转
- 双指针
- 递归
- 手撕代码
source: 拼多多Java三轮技术面一面
feynman:
  essence: 反转链表就是将每个节点的next指针从指向后一个节点改为指向前一个节点。迭代法用三指针（prev/curr/next），递归法利用调用栈自然反转。
  analogy: 就像一排人手拉手面朝前站着——反转就是让每个人转过身来，松开前面人的手，去拉后面人的手。关键是转换过程中要临时记住下一个人的位置（next指针），否则手一松就找不到人了。
  key_points:
  - 迭代法：三指针 prev/curr/next，每轮翻转一个节点
  - 递归法：递归到链表尾部，回溯时翻转指针
  - 时间复杂度O(n)，空间复杂度迭代O(1)/递归O(n)
  - 边界：空链表、单节点链表
  - 变体：反转链表的一部分（区间反转）、K个一组反转
first_principle:
  problem: 链表的每个节点只存了next指针（单向），如何在不使用额外空间的前提下反转整个链表？
  axioms:
  - 每个节点的next指针需要改变方向
  - 改变next指针前必须保存原next，否则丢失后续节点
  - 只需要遍历一次即可完成
  rebuild: 维护prev指针（初始null）→ 遍历每个节点：先存next→再把curr.next指向prev→然后prev=curr→curr=next → 循环直到curr为null → prev就是新头节点。
follow_up:
  - 递归和迭代哪种更好？各有什么优缺点？
  - 反转链表的一部分（从第m个到第n个）怎么做？
  - K个一组反转链表怎么做？注意什么？
  - 如何判断回文链表？能用反转链表的思想吗？
  - 如果链表有环，反转后会发生什么？
memory_points:
  - 迭代三指针：prev=null, curr=head, next暂存 → 每轮翻转一个
  - 递归：base case(head==null||head.next==null) → head.next.next=head → head.next=null
  - 时空复杂度：迭代O(n)/O(1)，递归O(n)/O(n)
  - 口诀：存next、转指针、移prev、移curr
---

# 【拼多多一面】手撕算法：反转单链表

## 🎯 一句话本质

反转链表 = 将每个节点的 `next` 指针从"指向后一个"改为"指向前一个"。**迭代法**用三指针逐个翻转，**递归法**利用调用栈从尾到头翻转。

## 🧒 费曼类比

```
原始链表（一排人面朝右站立）：
  1 → 2 → 3 → 4 → 5 → null

反转过程（迭代法）：
  Step 0: prev=null, curr=1
  Step 1: 1→null (1的手从指2改为指null)    prev=1, curr=2
  Step 2: 2→1     (2的手从指3改为指1)       prev=2, curr=3  
  Step 3: 3→2                               prev=3, curr=4
  Step 4: 4→3                               prev=4, curr=5
  Step 5: 5→4                               prev=5, curr=null → 结束！

结果：null ← 1 ← 2 ← 3 ← 4 ← 5
  即 5 → 4 → 3 → 2 → 1 → null
```

## 📊 图解迭代过程

```
初始状态：
  prev    curr →   next
  null    [1]  →  [2]  →  [3]  →  [4]  →  [5]  →  null

第一轮（翻转节点1）：
  ① 保存 next: next = curr.next = [2]
  ② 翻转指针:  curr.next = prev  →  [1] → null
  ③ 移动 prev: prev = curr = [1]
  ④ 移动 curr: curr = next = [2]

  null ← [1]    [2]  →  [3]  →  [4]  →  [5]  →  null
   prev          curr→   next

第二轮（翻转节点2）：
  null ← [1] ← [2]    [3]  →  [4]  →  [5]  →  null
               prev    curr→   next

... 持续直到 curr = null ...

最终状态：
  null ← [1] ← [2] ← [3] ← [4] ← [5]
                                      prev=null? 
                                      不！prev=[5], curr=null → 返回prev=[5]
```

## 🔧 代码实现

### 方法一：迭代法（推荐面试写）

```java
class ListNode {
    int val;
    ListNode next;
    ListNode(int val) { this.val = val; }
}

public ListNode reverseList(ListNode head) {
    ListNode prev = null;
    ListNode curr = head;
    
    while (curr != null) {
        ListNode next = curr.next;  // ① 暂存下一个节点
        curr.next = prev;           // ② 翻转指针
        prev = curr;                // ③ prev前进一步
        curr = next;                // ④ curr前进一步
    }
    
    return prev;  // prev就是新的头节点
}
```

**口诀：存next、转指针、移prev、移curr**

### 方法二：递归法

```java
public ListNode reverseList(ListNode head) {
    // Base case: 空链表或只有一个节点
    if (head == null || head.next == null) {
        return head;
    }
    
    // 递归反转后面的部分
    // reverseList(2→3→4→5) 返回 5→4→3→2→null
    ListNode newHead = reverseList(head.next);
    
    // 此时 head.next 仍然指向2（虽然2的next已经改了）
    // 让 head.next（节点2）的next指向head（节点1）
    head.next.next = head;
    
    // head的next置空（避免循环引用）
    head.next = null;
    
    return newHead;
}
```

**递归展开图**：
```
reverseList(1→2→3→4→5→null)
  → reverseList(2→3→4→5→null)
    → reverseList(3→4→5→null)
      → reverseList(4→5→null)
        → reverseList(5→null) → 返回5（base case）
        ← 4.next.next=4, 4.next=null → 5→4→null
      ← 3.next.next=3, 3.next=null → 5→4→3→null
    ← 2.next.next=2, 2.next=null → 5→4→3→2→null
  ← 1.next.next=1, 1.next=null → 5→4→3→2→1→null
```

### 方法三：反转链表区间（从第m个到第n个）

```java
public ListNode reverseBetween(ListNode head, int m, int n) {
    ListNode dummy = new ListNode(0);
    dummy.next = head;
    
    // 1. 走到第m-1个节点（翻转区间的前驱）
    ListNode prev = dummy;
    for (int i = 1; i < m; i++) {
        prev = prev.next;
    }
    
    // 2. 翻转从m到n的区间
    ListNode curr = prev.next;  // 第m个节点
    for (int i = 0; i < n - m; i++) {
        ListNode next = curr.next;      // 要搬到前面的节点
        curr.next = next.next;          // curr跳过next
        next.next = prev.next;          // next插到区间头部
        prev.next = next;               // prev连接新头部
    }
    
    return dummy.next;
}
```

### 方法四：K个一组反转

```java
public ListNode reverseKGroup(ListNode head, int k) {
    // 1. 检查剩余是否够k个
    ListNode tail = head;
    for (int i = 0; i < k; i++) {
        if (tail == null) return head;  // 不够k个，不翻转
        tail = tail.next;
    }
    
    // 2. 翻转前k个
    ListNode prev = null;
    ListNode curr = head;
    for (int i = 0; i < k; i++) {
        ListNode next = curr.next;
        curr.next = prev;
        prev = curr;
        curr = next;
    }
    
    // 3. head（翻转后的尾）连接后面的递归结果
    head.next = reverseKGroup(curr, k);
    
    // 4. prev是翻转后的头
    return prev;
}
```

## 📋 复杂度分析

| 方法 | 时间复杂度 | 空间复杂度 | 优点 | 缺点 |
|------|-----------|-----------|------|------|
| 迭代 | O(n) | O(1) | 空间最优 | 代码稍长 |
| 递归 | O(n) | O(n) | 代码简洁 | 栈空间O(n)，链表长可能栈溢出 |

## ❓ 苏格拉底式面试追问

1. **"递归法中 head.next.next = head 这行代码，head.next 此时指向谁？为什么安全？"**
   → head.next是原始链表的下一个节点（递归回溯时它已经被反转了），此时它的next正好可以指向head

2. **"如果链表非常长（100万节点），递归法会有什么问题？"**
   → 栈溢出。迭代法没有这个问题。面试中推荐写迭代

3. **"K个一组反转，如果最后一组不足K个，你选择反转还是不反转？题目怎么要求？"**
   → LeetCode 25要求不足K个不反转。如果要求反转，去掉base case检查即可

4. **"反转链表后如何验证结果正确？写个测试用例。"**
   → 正向遍历验证val序列反转 + 验证尾节点next=null

5. **"能不能用O(1)空间的递归实现？"**
   → 不能。递归的本质决定了空间O(n)。但可以用尾递归优化（Java不保证优化，C++/Rust可以）


## 结构化回答

**30 秒电梯演讲：** 反转链表就是将每个节点的next指针从指向后一个节点改为指向前一个节点。

**展开框架：**
1. **迭代三指针** — prev=null, curr=head, next暂存 → 每轮翻转一个
2. **递归** — base case(head==null||head.next==null) → head.next.next=head → head.next=null
3. **时空复杂度** — 迭代O(n)/O(1)，递归O(n)/O(n)

**收尾：** 这块我踩过坑——要不要深入聊：递归和迭代哪种更好？各有什么优缺点？

## 视频脚本

> 预计时长：1 分 30 秒 | 由浅入深

| 时间 | 画面/字幕 | 口播台词 | 讲解要点 |
|------|----------|----------|----------|
| 0:00 | 标题卡 | "链表一句话：反转链表就是将每个节点的next指针从指向后一个节点改为指向前一个节点。迭代法用三指针（prev/curr/next）…。" | 开场钩子 |
| 0:15 | 链表节点指针图 | "迭代三指针：prev就是null, curr就是head, next暂存 到 每轮翻转一个" | 迭代三指针 |
| 0:47 | 链表节点指针图分步演示 | "递归：base case(head就是就是null//head.next就是就是null) 到 head.next.…" | 递归 |
| 1:20 | 总结卡 | "核心抓住这条主线，下期咱们接着聊：递归和迭代哪种更好？各有什么优缺点。" | 收尾 |
