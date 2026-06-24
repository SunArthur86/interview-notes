---
id: note-bd2-009
difficulty: L2
category: algorithm
subcategory: 数组
tags:
  - 字节
  - 面经
  - 算法
  - 排序
  - LeetCode56
feynman:
  essence: '先按起点排序，再遍历一次合并有重叠的区间'
  analogy: '就像整理时间表——先把所有会议按开始时间排序，然后从头到尾看，有重叠的会议合并成一个大的时间段'
  first_principle: '区间重叠的充要条件是: 前一个区间的end >= 后一个区间的start。排序后只需比较相邻区间'
  key_points:
    - '第一步: 按区间起点排序'
    - '第二步: 遍历，当前区间start <= 上一个end就合并'
    - '时间O(n log n)(排序)，空间O(n)(结果数组)'
    - '合并时取两个区间的max(end)作为新区间的end'
first_principle:
  essence: '排序消除了区间的无序性，使重叠判断从O(n²)降为O(n)'
  derivation: '未排序时判断所有区间对是否重叠需要O(n²)。排序后，重叠区间必然相邻，只需O(n)一次遍历'
  conclusion: '排序+一次遍历是最优解，时间复杂度的下界由排序决定'
follow_up:
  - '如果要返回哪些区间有重叠(而不是合并)，怎么做？'
  - '区间是动态插入的，如何高效维护合并结果？'
  - '如果区间是二维的(矩形)，怎么判断重叠？'
---

# 手撕：力扣56.合并区间

## 题目

以数组 `intervals` 表示若干个区间的集合，其中单个区间为 `intervals[i] = [starti, endi]`。合并所有重叠的区间，返回一个不重叠的区间数组。

## 图解

```
输入: [[1,3],[2,6],[8,10],[15,18]]

Step 1: 按起点排序 (已排序)
  [1,3] [2,6] [8,10] [15,18]

Step 2: 遍历合并
  ┌─────┐
  │[1,3]│  ← 初始化result=[[1,3]]
  └──┬──┘
     │ [2,6].start=2 <= 3=current_end → 重叠!
     ▼
  ┌──────┐
  │[1,6] │  ← end = max(3, 6) = 6
  └──┬───┘
     │ [8,10].start=8 > 6=current_end → 不重叠
     ▼
  ┌──────┐ ┌──────┐
  │[1,6] │ │[8,10]│  ← 直接入结果
  └──────┘ └──┬───┘
              │ [15,18].start=15 > 10 → 不重叠
              ▼
  ┌──────┐ ┌──────┐ ┌───────┐
  │[1,6] │ │[8,10]│ │[15,18]│
  └──────┘ └──────┘ └───────┘

输出: [[1,6],[8,10],[15,18]]
```

## 代码

```python
def merge(intervals: list[list[int]]) -> list[list[int]]:
    """
    合并重叠区间
    时间: O(n log n) - 排序
    空间: O(n) - 结果数组
    """
    if not intervals:
        return []
    
    # Step 1: 按起点排序
    intervals.sort(key=lambda x: x[0])
    
    # Step 2: 遍历合并
    result = [intervals[0]]
    
    for i in range(1, len(intervals)):
        curr = intervals[i]
        prev = result[-1]
        
        if curr[0] <= prev[1]:
            # 重叠 → 合并，取较大的end
            prev[1] = max(prev[1], curr[1])
        else:
            # 不重叠 → 直接入结果
            result.append(curr)
    
    return result

# 测试
print(merge([[1,3],[2,6],[8,10],[15,18]]))  # [[1,6],[8,10],[15,18]]
print(merge([[1,4],[4,5]]))                   # [[1,5]] (端点相等也算重叠)
print(merge([[1,4],[0,4]]))                   # [[0,4]] (排序后[0,4]在前)
```

## 边界情况

```python
# 1. 空数组
merge([])                              # []

# 2. 单个区间
merge([[1,1]])                         # [[1,1]]

# 3. 全部重叠
merge([[1,4],[2,3]])                   # [[1,4]] (包含关系)

# 4. 完全不重叠
merge([[1,2],[3,4],[5,6]])            # [[1,2],[3,4],[5,6]]

# 5. 未排序输入
merge([[2,6],[1,3],[8,10],[15,18]])   # [[1,6],[8,10],[15,18]]
```

## 复杂度分析

| 维度 | 复杂度 | 说明 |
|------|--------|------|
| 时间 | O(n log n) | 排序O(n log n) + 遍历O(n) |
| 空间 | O(n) | 结果数组(不算排序的O(log n)栈空间) |

## 变体题

```python
# 变体: 插入区间 (力扣57)
# 在已排序不重叠区间中插入一个新区间，返回合并后的结果

def insert(intervals, newInterval):
    """O(n)解法，无需排序(输入已排序)"""
    result = []
    i = 0
    n = len(intervals)
    
    # 1. 添加所有在newInterval之前的区间
    while i < n and intervals[i][1] < newInterval[0]:
        result.append(intervals[i])
        i += 1
    
    # 2. 合并所有与newInterval重叠的区间
    while i < n and intervals[i][0] <= newInterval[1]:
        newInterval[0] = min(newInterval[0], intervals[i][0])
        newInterval[1] = max(newInterval[1], intervals[i][1])
        i += 1
    result.append(newInterval)
    
    # 3. 添加剩余区间
    while i < n:
        result.append(intervals[i])
        i += 1
    
    return result
```
