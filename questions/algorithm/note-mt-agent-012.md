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
memory_points:
- 三步走口诀：找中点、转后半、交错合并。
- 找中点：快慢指针法，因为快指针走两步慢指针走一步，所以慢指针刚好停在中点。
- 转后半：断开前后半段，将后半段链表进行局部反转。
- 合并：双指针交替连接，时间 O(n) 且空间 O(1)。
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

## 记忆要点

- 三步走口诀：找中点、转后半、交错合并。
- 找中点：快慢指针法，因为快指针走两步慢指针走一步，所以慢指针刚好停在中点。
- 转后半：断开前后半段，将后半段链表进行局部反转。
- 合并：双指针交替连接，时间 O(n) 且空间 O(1)。


## 苏格拉底式面试追问

> 这组追问模拟面试官层层逼问，每一问先回答"为什么"，再回答"怎么做"，最后回答"如何证明"。

### 第一层：目标与动机

**Q：重排链表你拆成"找中点 + 反转后半 + 交错合并"三步，为什么不直接从两端向中间处理（像数组那样）？**

数组可以两端下标访问，O(1) 拿到任意位置；但链表只能从头 next 单向遍历，拿尾节点要 O(n)，而且单链表节点没有 prev 指针，无法从尾回退。所以"从两端向中间"对数组天然、对链表不行。三步法的本质是把"链表"转换成我们熟悉的操作：找中点（快慢指针）、反转（经典模板）、合并（双指针交替），每一步都是 O(n) 且空间 O(1)。这三步组合起来的复杂度是 3 个 O(n)=O(n)，而"两端向中间"在链表上要么 O(n²)、要么用栈辅助（空间 O(n)）。

### 第二层：证据与定位

**Q：你用快慢指针找中点，slow 最终停在哪里？奇数个和偶数个节点结果一样吗？**

不一样。快慢指针的终止条件 `fast.next != null && fast.next.next != null` 下：奇数个节点（如 5 个），slow 停在第 3 个（正中间）；偶数个（如 4 个），slow 停在第 2 个（前半段最后一个）。这个差异影响后续反转的起点——奇数时要让 slow = slow.next（跳过中间节点，后半段从第 4 个开始），偶数时 slow.next 就是后半段起点。验证方法：手画 5 个节点和 4 个节点各跑一遍，标出 slow 最终位置和 `slow.next` 的指向。写代码时如果不区分奇偶，后半段会多一个/少一个节点，合并阶段就会错位。

### 第三层：根因深挖

**Q：合并阶段你写 `ListNode next = cur.next; cur.next = reversed; cur = next;` 但不暂存 reversed.next，会出什么 bug？**

会丢失后半段剩余节点。合并是交替连接：原链表的 cur 接反转链表的 reversed，然后 cur 前进、reversed 前进。如果不暂存 `reversed.next`，`cur.next = reversed` 之后 reversed.next 还指向它原来的下一个，但下一轮 `cur = cur.next`（即 reversed）再 `cur.next = ...` 会把反转链表的连接打断。正确做法是双向暂存：`n1 = cur.next; n2 = reversed.next; cur.next = reversed; reversed.next = n1; cur = n1; reversed = n2`。这是交错合并的核心易错点，跟反转链表（需暂存 next）是同一类陷阱。

**Q：那为什么不用递归做？递归思路更简洁，从中间向两边展开。**

递归思路确实更直观（递归到中点，回溯时交替连接前后），但有两个硬伤：一是空间 O(n)——递归深度等于链表长度，n=1 万时栈就爆了，题目通常要求 O(1) 空间；二是常数大——每次递归调用有函数栈开销，实测比迭代慢 3-5 倍。面试中如果用了递归解法，要主动说明"递归空间 O(n) 不满足 O(1) 要求，迭代版才是标准答案"，否则面试官会扣分。递归版的价值是验证思路正确性，最终提交必须用迭代。

### 第四层：方案权衡

**Q：如果把题目改成"K 个一组重排"或"任意顺序重排"，你的三步法还适用吗？**

不适用。"K 个一组"是 LeetCode 25（K 个一组翻转），跟重排链表（143）是完全不同的操作——前者是分组翻转保持组内顺序，后者是首尾交错。"任意顺序重排"如果是指"重排成某种特定顺序"，要先定义清楚顺序规则。三步法（找中点+反转+合并）是专门为"首尾交错"这个特定操作设计的，不是通用模板。它的可迁移性体现在三个子操作上：快慢指针找中点、反转链表、双指针合并——这三个子操作各自是通用模板，组合起来解决"链表需要后半段反向"的一类题（如回文链表判断、链表重排）。

**Q：为什么不直接把链表转成数组，在数组上重排，再转回链表？**

能 AC 但空间 O(n) 不满足"O(1) 空间"要求。链表类题目的考察重点之一就是"在不借助额外数据结构的前提下操作指针"，转数组等于回避了指针操作这个核心考点。工程上转数组更易写易调试（下标访问直观），所以可以作为"先写出正确解再优化空间"的过渡方案——先用 ArrayList 版本过样例验证逻辑，再改成纯指针操作版。但最终提交和面试展示的必须是 O(1) 空间版，否则等于没体现链表功底。

### 第五层：验证与沉淀

**Q：你怎么验证重排结果的正确性，特别是奇偶长度都覆盖？**

四类必测：① 空链表/单节点（边界，应原样返回）；② 两个节点 [1,2]→[1,2]（无重排）；③ 奇数个 [1,2,3,4,5]→[1,5,2,4,3]（标准样例）；④ 偶数个 [1,2,3,4]→[1,4,2,3]（测中点位置差异）。验证方法：构造期望结果链表，逐节点比对 val 和长度。重点测奇偶边界——快慢指针在奇偶下中点位置不同，合并时暂存的 next 也会不同，这俩是 bug 高发区。压力测试：随机生成 1000 个长度 1-100 的链表，跟"转数组重排再转回"的朴素版对拍。

**Q：这道题沉淀出了什么可复用的链表操作模板？**

三个子模板高度可复用：一、快慢指针找中点——用于回文链表判断（找中点后反转后半比较）、链表二分类操作；二、反转链表（迭代版）——用于 K 个一组翻转、反转区间、回文判断；三、双指针交错合并——用于合并两个有序链表、交错重排。这三个模板组合起来能解决 LeetCode 上 80% 的中等链表题。我的模板库里存了这三个的"无 bug 标准实现"，每次遇到链表题先看能不能分解成这三个子操作的组合，能分解就直接拼，比从头写快且不易错。


## 结构化回答

**30 秒电梯演讲：** 将链表重排为L0到Ln到L1到Ln-1到L2到Ln-2交替排列。打个比方，就像洗扑克牌从中间劈开一张正序一张逆序交错插入。

**展开框架：**
1. **三步走口诀** — 找中点、转后半、交错合并。
2. **找中点** — 快慢指针法，因为快指针走两步慢指针走一步，所以慢指针刚好停在中点。
3. **转后半** — 断开前后半段，将后半段链表进行局部反转。

**收尾：** 这块我踩过坑——要不要深入聊：链表有环怎么处理？

## 视频脚本

> 预计时长：3 分钟 | 由浅入深

| 时间 | 画面/字幕 | 口播台词 | 讲解要点 |
|------|----------|----------|----------|
| 0:00 | 标题卡 | "链表一句话：将链表重排为L0到Ln到L1到Ln-1到L2到Ln-2交替排列。" | 开场钩子 |
| 0:15 | 链表节点指针图 | "三步走口诀：找中点、转后半、交错合并。" | 三步走口诀 |
| 1:06 | 链表节点指针图分步演示 | "找中点：快慢指针法，因为快指针走两步慢指针走一步，所以慢指针刚好停在中点。" | 找中点 |
| 1:57 | 关键代码/伪代码片段 | "转后半：断开前后半段，将后半段链表进行局部反转。" | 转后半 |
| 2:50 | 总结卡 | "核心抓住这条主线，下期咱们接着聊：链表有环怎么处理。" | 收尾 |
