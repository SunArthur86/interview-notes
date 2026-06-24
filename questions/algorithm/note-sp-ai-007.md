---
id: note-sp-ai-007
difficulty: L2
category: algorithm
subcategory: 链表
tags:
  - Shopee
  - 面经
  - 栈
  - 队列
feynman:
  essence: 一个栈管入队一个管出队，出队栈空了就把入队栈倒灌过来——均摊O(1)
  analogy: '像两个盒子——一个是"收件箱"(入队栈)，一个是"处理箱"(出队栈)。处理箱空了就把收件箱的东西全倒过去(LIFO变FIFO)'
  first_principle: '栈是LIFO，队列是FIFO。两个LIFO栈串联可以实现FIFO——第一次LIFO+第二次LIFO=FIFO'
  key_points:
    - 入队栈(push栈)负责接收元素
    - 出队栈(pop栈)负责输出元素
    - 出队栈空时，把入队栈全部倒入出队栈
    - 每个元素最多搬运一次，均摊O(1)
first_principle:
  essence: 两次栈操作(LIFO+LIFO)等价于一次队列操作(FIFO)
  derivation: '入栈1: [1,2,3](3在顶)→倒灌到栈2: [3,2,1](1在顶)→栈2弹出: 1→FIFO顺序'
  conclusion: 双栈串联反转两次，负负得正，实现队列效果
follow_up:
  - '怎么用两个队列实现栈？'
  - '均摊O(1)的证明？'
  - '这道题有什么实际应用？'
---

# 怎么用两个栈实现队列？

## 核心思路

```
队列操作: FIFO（先进先出）
栈操作: LIFO（后进先出）

两个栈串联 = 两次反转 = FIFO

入队 1, 2, 3:
┌─────────────┐    ┌─────────────┐
│  入队栈      │    │  出队栈      │
│  (push栈)   │    │  (pop栈)    │
│             │    │             │
│  [3] ← 顶   │    │  [ ] 空     │
│  [2]        │    │             │
│  [1] ← 底   │    │             │
└─────────────┘    └─────────────┘

出队时，出队栈空→倒灌：
┌─────────────┐    ┌─────────────┐
│  入队栈      │    │  出队栈      │
│  [ ] 空     │──→ │  [1] ← 顶   │
│             │ 倒灌│  [2]        │
│             │    │  [3] ← 底   │
└─────────────┘    └─────────────┘

出队栈弹出 → 得到1（FIFO顺序 ✅）
```

## 代码实现

```python
class MyQueue:
    def __init__(self):
        self.in_stack = []   # 入队栈
        self.out_stack = []  # 出队栈
    
    def push(self, x: int) -> None:
        """入队：直接压入入队栈"""
        self.in_stack.append(x)
    
    def pop(self) -> int:
        """出队：从出队栈弹出"""
        self._transfer()  # 确保出队栈有元素
        return self.out_stack.pop()
    
    def peek(self) -> int:
        """查队首：不弹出"""
        self._transfer()
        return self.out_stack[-1]
    
    def empty(self) -> bool:
        """是否为空"""
        return not self.in_stack and not self.out_stack
    
    def _transfer(self):
        """如果出队栈为空，把入队栈全部倒入"""
        if not self.out_stack:
            while self.in_stack:
                self.out_stack.append(self.in_stack.pop())
```

## 执行过程演示

```
操作序列: push(1), push(2), push(3), pop(), push(4), pop(), pop()

push(1): in=[1], out=[]
push(2): in=[1,2], out=[]
push(3): in=[1,2,3], out=[]

pop(): out空→倒灌: in=[], out=[3,2,1]
       弹出1 → 返回1
       in=[], out=[3,2]

push(4): in=[4], out=[3,2]

pop(): out不空→直接弹出2 → 返回2
       in=[4], out=[3]

pop(): out不空→直接弹出3 → 返回3
       in=[4], out=[]

最终: in=[4], out=[]
```

## 均摊O(1)分析

```
关键洞察：每个元素最多被搬运一次（从in_stack到out_stack）

push(1) → 1进入in_stack     搬运次数=0
倒灌     → 1从in到out        搬运次数=1  ← 只搬这一次
pop()    → 1从out弹出        搬运次数=0

总搬运次数 = N个元素各搬1次 = N次
总操作次数 = N次push + N次pop + N次搬运 = 3N

均摊到每次操作 = 3N / 2N = 1.5 → O(1)

虽然单次pop可能触发倒灌O(n)，但均摊到所有操作是O(1)
```

## 复杂度

| 操作 | 最好 | 最坏 | 均摊 |
|------|------|------|------|
| push | O(1) | O(1) | O(1) |
| pop | O(1) | O(n)* | O(1) |
| peek | O(1) | O(n)* | O(1) |
| empty | O(1) | O(1) | O(1) |

> *最坏情况：出队栈空时需要倒灌整个入队栈

## 面试加分点

1. **均摊分析**：每个元素只搬运一次，所以均摊O(1)
2. **倒灌时机**：只在out_stack为空时倒灌，避免反复搬运
3. **不变式**：out_stack中的元素已经是FIFO顺序，不需要每次倒灌
4. **负负得正**：LIFO + LIFO = FIFO，两次反转恢复原始顺序
