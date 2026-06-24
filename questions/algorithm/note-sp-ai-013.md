---
id: note-sp-ai-013
difficulty: L2
category: algorithm
subcategory: 树
tags:
  - Shopee
  - 面经
  - 二叉树
  - DFS
  - 回溯
feynman:
  essence: DFS回溯——进入节点加路径减目标和，叶子且和为0记录，递归左右，回溯移除
  analogy: '像走迷宫找宝藏——每到一个路口(节点)就记下走过的路并减掉消耗，到死胡同(叶子)发现刚好到达目标就记录路线，然后退回上一步试别的路'
  first_principle: '二叉树路径是从根到叶子的唯一路径，DFS天然遍历所有根到叶路径，回溯维护当前路径状态'
  key_points:
    - DFS前序遍历访问每个节点
    - 进入节点：targetSum减去当前节点值
    - 叶子节点且剩余和为0：记录路径
    - 回溯：递归返回时从path中移除当前节点
    - 时间O(n²)，空间O(n)
first_principle:
  essence: '二叉树根到叶路径是唯一的，穷举所有路径即可'
  derivation: 'DFS天然遍历所有路径→每条路径累计和→等于targetSum则记录→回溯恢复状态尝试其他路径'
  conclusion: DFS+回溯是树形路径枚举问题的标准范式
follow_up:
  - '如果路径不需要从根到叶子，而是任意节点到任意节点呢？'
  - '如果是N叉树怎么办？'
  - '能不能用BFS做？'
---

# 手撕二叉树目标和（LeetCode 113. 路径总和 II）

## 题目描述

给你二叉树的根节点 `root` 和一个整数 `targetSum`，找出所有从根节点到叶子节点路径总和等于给定目标和的路径。

```
示例：
         5
        / \
       4   8
      /   / \
     11  13  4
    / \     / \
   7   2   5   1

targetSum = 22

输出: [[5,4,11,2], [5,8,4,5]]
解释: 
  5→4→11→2 = 22 ✅
  5→8→4→5 = 22 ✅
```

## DFS回溯解法

```python
class TreeNode:
    def __init__(self, val=0, left=None, right=None):
        self.val = val
        self.left = left
        self.right = right

class Solution:
    def pathSum(self, root: TreeNode, targetSum: int) -> list:
        result = []
        path = []  # 当前路径
        
        def dfs(node, remaining):
            if not node:
                return
            
            # 进入节点：加入路径，减去当前值
            path.append(node.val)
            remaining -= node.val
            
            # 叶子节点且剩余和为0 → 找到一条路径
            if not node.left and not node.right and remaining == 0:
                result.append(path[:])  # 注意拷贝！
            
            # 递归左右子树
            dfs(node.left, remaining)
            dfs(node.right, remaining)
            
            # 回溯：移除当前节点
            path.pop()
        
        dfs(root, targetSum)
        return result
```

## 执行过程演示

```
         5
        / \
       4   8
      /   / \
     11  13  4
    / \     / \
   7   2   5   1

targetSum = 22

DFS执行：
进入5   path=[5]   remaining=17
  进入4   path=[5,4]   remaining=13
    进入11  path=[5,4,11]  remaining=2
      进入7   path=[5,4,11,7]  remaining=-5
        叶子！remaining≠0 → 不记录
      回溯  path=[5,4,11]
      进入2   path=[5,4,11,2]  remaining=0
        叶子！remaining=0 → 记录 ✅ [[5,4,11,2]]
      回溯  path=[5,4,11]
    回溯  path=[5,4]
  回溯  path=[5]
  进入8   path=[5,8]   remaining=9
    进入13  path=[5,8,13]  remaining=-4
      叶子！remaining≠0 → 不记录
    回溯  path=[5,8]
    进入4   path=[5,8,4]   remaining=5
      进入5   path=[5,8,4,5]  remaining=0
        叶子！remaining=0 → 记录 ✅ [[5,4,11,2],[5,8,4,5]]
      回溯  path=[5,8,4]
      进入1   path=[5,8,4,1]  remaining=4
        叶子！remaining≠0 → 不记录
      回溯  path=[5,8,4]
    回溯  path=[5,8]
  回溯  path=[5]
回溯  path=[]

最终结果: [[5,4,11,2], [5,8,4,5]]
```

## 回溯模板

```python
def backtrack(路径, 选择列表):
    if 满足结束条件:
        result.add(路径的拷贝)
        return
    
    for 选择 in 选择列表:
        做选择       # path.append(...)
        backtrack(路径, 选择列表)
        撤销选择     # path.pop()
```

## 复杂度分析

| 维度 | 复杂度 | 说明 |
|------|--------|------|
| **时间** | O(n²) | 最坏情况遍历所有n个节点，每条路径拷贝O(n) |
| **空间** | O(n) | 递归栈深度O(h)=O(n)(最坏链状)，path存O(n) |

### 时间复杂度详细推导

```
最好情况(平衡树)：O(n log n)
  → n个节点，路径最长log n，每条路径拷贝log n
  → 总拷贝成本 = (n/2) × log n ≈ O(n log n)

最坏情况(链状树)：O(n²)  
  → 所有节点在一条路径上
  → 但只有1个叶子，最多记录1条路径
  → 实际是O(n)遍历 + O(n)拷贝 = O(n)

另一个最坏(完全平衡且每条路径都满足)：O(n²)
  → n/2个叶子，每条路径log n长
  → 拷贝总成本 = (n/2) × log n
  → 但如果所有路径都满足，路径数量可能O(n)
```

## 常见陷阱

```python
# ❌ 错误1：忘记拷贝path
result.append(path)  # 引用！后续修改path会影响result中的记录

# ✅ 正确
result.append(path[:])  # 浅拷贝
# 或
result.append(list(path))

# ❌ 错误2：remaining计算位置
if remaining == 0:  # 应该在叶子节点检查
    result.append(path[:])
# → 非叶子节点remaining=0也会误记录

# ✅ 正确：同时检查叶子节点
if not node.left and not node.right and remaining == 0:
    result.append(path[:])
```

## 面试加分点

1. **回溯模板**：展示对回溯范式的理解（做选择→递归→撤销选择）
2. **拷贝陷阱**：强调`path[:]`的必要性，体现细节意识
3. **叶子判断**：`not node.left and not node.right`，不能只判断node不为None
4. **复杂度分析**：能分析不同树形下的时间复杂度差异
