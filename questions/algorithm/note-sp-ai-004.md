---
id: note-sp-ai-004
difficulty: L2
category: algorithm
subcategory: 链表
tags:
  - Shopee
  - 面经
  - 链表
  - 双指针
feynman:
  essence: 双指针法——两个指针各走一遍两个链表，走过的路程相同，必然在交点相遇
  analogy: '两个人在Y形路上走——A从支路1出发，B从支路2出发，都走完自己的路再走对方的路，必然在Y的交叉点相遇'
  first_principle: '两个链表如果相交，从交点开始后面完全重合，a+c+b = b+c+a 保证双指针走相同总长'
  key_points:
    - pA走headA到头后走headB，pB走headB到头后走headA
    - 如果相交，第一次相遇就是交点
    - 如果不相交，同时走到null
    - 时间O(n+m)，空间O(1)
first_principle:
  essence: '数学等式 a+c = b+c 不一定成立，但 a+c+b = b+c+a 必然成立'
  derivation: '设A到交点距离a，B到交点距离b，交点到末尾距离c。pA走a+c+b到交点，pB走b+c+a到交点，路径长相等'
  conclusion: 双指针互换走法保证同时到达交点
follow_up:
  - '如果链表有环怎么办？'
  - '能用哈希表做吗？时间和空间复杂度？'
  - '如果只是判断是否相交（不需要找交点）怎么做？'
---

# 怎么判断链表相交？

## 双指针法（最优解）

### 核心思路

```
链表A:  a1 → a2 → c1 → c2 → c3
                     ↑
链表B:  b1 → b2 ────┘

a = A到交点的距离 = 2
b = B到交点的距离 = 2  
c = 交点到末尾的距离 = 3

双指针路径：
pA: a1 → a2 → c1 → c2 → c3 → null → b1 → b2 → c1 ← 相遇！
    |___a___|___c____|___b___|
    总长 = a + c + b = 2+3+2 = 7

pB: b1 → b2 → c1 → c2 → c3 → null → a1 → a2 → c1 ← 相遇！
    |___b___|___c____|___a___|
    总长 = b + c + a = 2+3+2 = 7

a+c+b = b+c+a → 保证两个指针同时到达交点！
```

### 代码实现

```python
class ListNode:
    def __init__(self, x):
        self.val = x
        self.next = None

def getIntersectionNode(headA: ListNode, headB: ListNode) -> ListNode:
    """
    双指针法：时间O(n+m)，空间O(1)
    """
    if not headA or not headB:
        return None
    
    pA, pB = headA, headB
    
    # pA走完A链表后走B链表，pB走完B链表后走A链表
    # 如果相交，必然在交点相遇
    # 如果不相交，同时走到None
    while pA != pB:
        pA = pA.next if pA else headB
        pB = pB.next if pB else headA
    
    return pA  # 相交则返回交点，不相交则返回None
```

### 执行过程演示

```
A: 4 → 1 → 8 → 4 → 5
B: 5 → 6 → 1 → 8 → 4 → 5
              ↑ 交点(8)

Step 1: pA=4, pB=5
Step 2: pA=1, pB=6
Step 3: pA=8, pB=1
Step 4: pA=4, pB=8
Step 5: pA=5, pB=4
Step 6: pA=null→跳到B头=5, pB=5
Step 7: pA=6, pB=null→跳到A头=4
Step 8: pA=1, pB=1
Step 9: pA=8, pB=8 ← 相遇！返回节点8
```

## 其他解法对比

### 方法二：哈希集合

```python
def getIntersectionNode_hash(headA, headB):
    """时间O(n+m)，空间O(n)"""
    visited = set()
    
    # 遍历A链表，存入集合
    cur = headA
    while cur:
        visited.add(cur)
        cur = cur.next
    
    # 遍历B链表，查集合
    cur = headB
    while cur:
        if cur in visited:
            return cur  # 第一个在A中出现的是交点
        cur = cur.next
    
    return None
```

### 方法三：长度差法

```python
def getIntersectionNode_len(headA, headB):
    """先算长度差，长的先走差值，再同时走"""
    def get_length(head):
        length = 0
        while head:
            length += 1
            head = head.next
        return length
    
    lenA, lenB = get_length(headA), get_length(headB)
    diff = abs(lenA - lenB)
    
    # 长的先走diff步
    curA, curB = headA, headB
    if lenA > lenB:
        for _ in range(diff):
            curA = curA.next
    else:
        for _ in range(diff):
            curB = curB.next
    
    # 同时走，找交点
    while curA and curB:
        if curA == curB:
            return curA
        curA = curA.next
        curB = curB.next
    
    return None
```

## 三种方法对比

| 方法 | 时间复杂度 | 空间复杂度 | 优点 | 缺点 |
|------|----------|----------|------|------|
| **双指针** | O(n+m) | O(1) | 最优 | 思路不直观 |
| **哈希集合** | O(n+m) | O(n) | 简单直观 | 空间开销大 |
| **长度差法** | O(n+m) | O(1) | 直观易理解 | 需要两次遍历 |

## 面试加分点

1. **数学证明**：能解释a+c+b=b+c+a为什么保证同时到达
2. **边界处理**：两链表不相交时，pA和pB同时走到None退出
3. **代码简洁**：双指针法核心就5行代码，展示编码功底
4. **注意是指针相等而非值相等**：比较的是节点引用，不是val
