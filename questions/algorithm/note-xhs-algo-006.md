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
## 苏格拉底式面试追问

> 这组追问模拟面试官层层逼问，每一问先回答"为什么"，再回答"怎么做"，最后回答"如何证明"。

### 第一层：目标与动机

**Q：反转链表你用迭代（三指针 prev/curr/next），为什么不直接用递归？递归代码不是更短吗？**

递归代码确实更短（`if (head == null || head.next == null) return head; ListNode newHead = reverse(head.next); head.next.next = head; head.next = null; return newHead;`），但有两个硬伤：一、空间 O(n)——递归深度等于链表长度，n=1 万就 StackOverflow，题目要求 O(1) 空间不满足；二、常数大——每次递归调用有函数栈开销，实测比迭代慢 2-3 倍。迭代版三指针（prev 初始 null，curr 初始 head，next 临时存 curr.next）原地反转，空间 O(1)、时间 O(n)，是标准答案。递归版的价值是"训练递归思维"（理解 `head.next.next = head` 这一步的反向连接），但生产代码和面试提交都该用迭代。

### 第二层：证据与定位

**Q：你写 `ListNode next = curr.next; curr.next = prev; prev = curr; curr = next;`，这四步的顺序能换吗？**

不能随意换。关键约束：在修改 `curr.next` 之前，必须先用 `next` 保存 `curr.next` 的原值，否则修改后 `curr.next` 指向 prev，丢失了原下一个节点，循环走不下去。正确顺序：① `next = curr.next`（先存原 next）；② `curr.next = prev`（反转指针）；③ `prev = curr`（prev 前进）；④ `curr = next`（curr 前进，用第一步存的 next）。如果交换 ①②，先 `curr.next = prev` 再 `next = curr.next`，next 拿到的是 prev 而不是原下一个节点，下一轮 `curr = next` 就跳错了。这是反转链表最易写错的点，本质是"读取-修改-更新"的顺序依赖。

### 第三层：根因深挖

**Q：迭代版最后返回 prev 而不是 curr，为什么？curr 此时是什么？**

循环结束条件是 `curr == null`，此时 curr 已经走到原链表尾部之后（null）。prev 在上一轮迭代里被赋值为原链表的最后一个节点，也就是反转后的新头节点。所以返回 prev。这是循环不变式的典型应用：每轮结束后，prev 指向"已反转部分的头"，curr 指向"未反转部分的头"。循环结束时 curr=null（无未反转部分），prev 就是整个反转后的头。如果错误返回 curr（null）或 head（原头，现在是尾），链表丢失。这个"返回 prev"的细节是反转链表的高频 bug，根源是没有想清楚循环不变式。

**Q：那为什么不返回 head.next，head 不是原来的头吗？**

反转后 head 变成了新链表的尾，head.next 应该是 null（我们手动设的）。如果返回 head，整个新链表从尾开始，只有一个节点（因为 head.next=null）。必须返回新链表的头，即原链表的尾——迭代版里 prev 最终停在原尾位置。这是"指针语义"的理解：head 这个变量名反转前后指向同一个节点对象，但它的"角色"从头变成了尾。代码里不要被变量名迷惑，要看每个指针当前指向的"逻辑角色"。这是链表题的核心思维——变量名是固定的，但指针指向的"链表位置"随操作变化。

### 第四层：方案权衡

**Q：反转链表的反向操作是"两两交换节点"（LeetCode 24），这两个题的解法有关联吗？**

思路相通但实现不同。两两交换是：dummy → 1 → 2 → 3 → 4 变成 dummy → 2 → 1 → 4 → 3，每次处理两个相邻节点。实现上仍用三指针，但每轮处理两个节点（交换 + 跳两步）。反转链表是"全部反转"，两两交换是"分组反转（组大小 2）"，K 个一组翻转（LeetCode 25）是"分组大小 K"。这三题共享"局部反转 + 指针重连"的核心技巧，反转链表是它们的基础模板。掌握了反转链表，K 个一组翻转就是"数 K 个 + 反转这 K 个 + 连接前后"的组合，反转区间（92）是"定位区间 + 反转区间内 + 重连"。所以反转链表是链表操作的"原子操作"，必须烂熟。

**Q：如果链表是双向链表（有 prev 指针），反转还需要这么多操作吗？**

双向链表的反转更简单——只要把每个节点的 prev 和 next 互换即可，不需要三指针轮转。因为双向链表每个节点已经存了 prev 和 next，反转 = `swap(node.prev, node.next)` 对每个节点执行一遍。代码：遍历链表，每个节点交换 prev/next，最后返回原尾（新头）。时间仍 O(n)，但代码更直观（不用暂存 next）。但工程上双向链表的反转很少需要——它本来就支持双向遍历，"反转"更多是逻辑上的需求（如 LRU 把 head 端当最近访问、tail 端当最久未访问）。所以这道题的"单向链表反转"是考察受限环境下的指针操作能力。

### 第五层：验证与沉淀

**Q：你怎么验证反转链表在各种边界下都对？**

五类用例：① 空链表 null → null（边界，head==null 直接返回）；② 单节点 [1] → [1]（无反转操作）；③ 两个节点 [1,2] → [2,1]（最小有意义的反转）；④ 偶数长度 [1,2,3,4] → [4,3,2,1]；⑤ 奇数长度 [1,2,3,4,5] → [5,4,3,2,1]。重点验证循环终止后 prev 指向原尾（新头）、curr 为 null、原 head 的 next 已置 null。避免成环：反转后遍历新链表，节点数应等于原链表，且最后节点的 next 为 null（如果有环，遍历会死循环，加个计数上限检测）。对拍：随机生成链表，跟递归版逐 case 对比。

**Q：这道题沉淀出了什么可复用的链表操作经验？**

三条可复用：一、"暂存 next 再修改指针"——所有链表指针操作（反转、删除、插入、合并）都要先暂存会被覆盖的指针，再修改；二、"循环不变式思维"——写循环前想清楚"每轮结束后各指针指向什么"，结束时据此确定返回值（反转链表返回 prev 不是 curr，源于不变式）；三、"原子操作识别"——反转链表是链表的"原子操作"，K 个一组翻转、反转区间、回文判断、重排链表都用到它。我把"反转链表迭代版"和"反转区间版"都存进模板库，遇到链表题先看能否分解成已知原子操作的组合，能分解就拼模板。


## 结构化回答

**30 秒电梯演讲：** 反转链表就是把每个节点的next指针从「指向后一个」改成「指向前一个」。

**展开框架：**
1. **迭代法** — prev/curr/next三指针，O(n)时间O(1)空间
2. **递归法** — 递归到末尾再逐层翻转指针，O(n)空间
3. **核心操作** — curr.next=prev

**收尾：** 这块我踩过坑——要不要深入聊：递归反转的空间复杂度为什么是O(n)？

## 视频脚本

> 预计时长：2 分钟 | 由浅入深

| 时间 | 画面/字幕 | 口播台词 | 讲解要点 |
|------|----------|----------|----------|
| 0:00 | 标题卡 | "链表一句话：反转链表就是把每个节点的next指针从「指向后一个」改成「指向前一个」…。" | 开场钩子 |
| 0:15 | 链表节点指针图 | "迭代法：prev/curr/next三指针，O(n)时间O(1)空间" | 迭代法 |
| 1:02 | 链表节点指针图分步演示 | "递归法：递归到末尾再逐层翻转指针，O(n)空间" | 递归法 |
| 1:50 | 总结卡 | "核心抓住这条主线，下期咱们接着聊：递归反转的空间复杂度为什么是O(n)。" | 收尾 |
