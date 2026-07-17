---
id: note-sp-005
difficulty: L2
category: algorithm
subcategory: 树
tags:
- BST
- 二叉树
- DFS
- 虾皮
- 面经
- LeetCode98
feynman:
  essence: 验证BST = 检查每个节点是否满足"左子树所有节点 < 当前节点 < 右子树所有节点"。关键陷阱是只检查直接子节点不够，必须确保整棵左子树的最大值 < 当前节点 < 整棵右子树的最小值。
  analogy: 就像查字典的页码——左边所有页码必须比当前页小，右边所有页码必须比当前页大。不能只看相邻页，因为中间穿插的页也可能乱序。
  first_principle: BST的定义是全局有序——每个节点的值必须大于左子树中的所有节点值，小于右子树中的所有节点值。不是局部的"左子<根<右子"，而是全局的。
  key_points:
  - '方法1: 中序遍历必须严格递增 → 最直观'
  - '方法2: 递归传递合法值域(min, max) → 最高效'
  - '陷阱: 只比较节点和直接子节点是错误的'
  - '注意: BST定义可能包含等于(左<=根<右)或不包含(严格不等)，LeetCode用严格不等'
first_principle:
  essence: BST的有效性是递归传递的——每个节点的合法值域由其所有祖先节点共同决定。
  derivation: 根节点无约束 → 左子节点必须 < root → 左子节点的右子节点必须 > 左子节点 但 < root → 所以每个节点的合法值域是(max_of_left_ancestors, min_of_right_ancestors)
  conclusion: 递归传递(min, max)边界是第一性原理的解法
follow_up:
- BST和二叉树的区别是什么？
- 如何把一个有序数组转化为平衡的BST？
- BST的删除操作怎么处理？
- 如果BST节点值有重复，怎么处理？
memory_points:
- "最优解: 递归传递(min, max)值域，O(n)时间O(h)空间"
- "等价判断: 中序遍历结果严格递增"
- "常见错误: 只比较直接父子，忽略孙子节点可能违反BST性质"
- "LeetCode定义: 严格不等(不能有重复值)"
---

# 验证二叉搜索树（LeetCode 98）

## 🎯 本质

验证一棵二叉树是否是有效的BST。**关键：每个节点必须大于左子树的所有节点、小于右子树的所有节点**（不是只比直接子节点）。

## 🧒 费曼类比

查字典页码：左边所有页码 < 当前页 < 右边所有页码。不能只看左右相邻页，因为中间夹的页可能也乱序。

## 📊 图解

```
      常见错误判断:              正确判断:
          
       5                         5
      / \                       / \
     1   4  ← 只看4>5?NO!      1   7
        / \                       / \
       3   6                    6    8
     
  ✗ 错误: 4<5所以右子OK?       ✓ 正确: 7>5✓, 6<7但6>5✓
  实际上4<5违反BST!             8>7且8>5✓ → 有效BST
  (右子树所有节点必须>5)
  
  正确判断逻辑:
  ┌─────────────────────────────────────┐
  │ 节点5: 值域(-∞, +∞)                │
  │   节点1: 值域(-∞, 5) → 1 ✓        │
  │   节点7: 值域(5, +∞) → 7 ✓        │
  │     节点6: 值域(5, 7) → 6 ✓       │
  │     节点8: 值域(7, +∞) → 8 ✓      │
  │ 全部通过 → 有效BST ✓               │
  └─────────────────────────────────────┘
```

## 🔧 专业详解

### 方法对比

| 方法 | 思路 | 时间 | 空间 | 推荐度 |
|------|------|------|------|--------|
| **中序遍历** | BST中序遍历必严格递增 | O(n) | O(h) | ⭐ 直观 |
| **递归值域** | 传递(min, max)合法区间 | O(n) | O(h) | ⭐⭐ 最优 |
| **暴力验证** | 每个节点找左max/右min | O(n²) | O(h) | ✗ 太慢 |

### 方法1：递归值域法（推荐）

```python
class TreeNode:
    def __init__(self, val=0, left=None, right=None):
        self.val = val
        self.left = left
        self.right = right

class Solution:
    def isValidBST(self, root: TreeNode) -> bool:
        def validate(node, min_val, max_val):
            # 空节点是有效BST
            if not node:
                return True
            
            # 当前节点值必须在合法区间内
            if node.val <= min_val or node.val >= max_val:
                return False
            
            # 左子树: 所有值 < node.val → 上界变为node.val
            # 右子树: 所有值 > node.val → 下界变为node.val
            return (validate(node.left, min_val, node.val) and
                    validate(node.right, node.val, max_val))
        
        return validate(root, float('-inf'), float('inf'))
```

**执行轨迹示例**：
```
        5
       / \
      1   7
         / \
        6   8

validate(5, -∞, +∞) → 5在(-∞,+∞) ✓
  validate(1, -∞, 5) → 1在(-∞,5) ✓
    validate(null, -∞, 1) → ✓
    validate(null, 1, 5) → ✓
  validate(7, 5, +∞) → 7在(5,+∞) ✓
    validate(6, 5, 7) → 6在(5,7) ✓
    validate(8, 7, +∞) → 8在(7,+∞) ✓
→ True
```

### 方法2：中序遍历法

```python
class Solution:
    def isValidBST(self, root: TreeNode) -> bool:
        prev = None  # 记录前一个访问的节点值
        
        def inorder(node):
            nonlocal prev
            if not node:
                return True
            
            # 左
            if not inorder(node.left):
                return False
            
            # 中：检查是否严格递增
            if prev is not None and node.val <= prev:
                return False
            prev = node.val
            
            # 右
            return inorder(node.right)
        
        return inorder(root)
```

### 方法3：迭代中序（避免递归栈溢出）

```python
class Solution:
    def isValidBST(self, root: TreeNode) -> bool:
        stack = []
        prev = None
        curr = root
        
        while curr or stack:
            while curr:
                stack.append(curr)
                curr = curr.left
            
            curr = stack.pop()
            if prev is not None and curr.val <= prev:
                return False
            prev = curr.val
            curr = curr.right
        
        return True
```

## 💻 复杂度分析

```
时间复杂度: O(n) — 每个节点访问一次
空间复杂度: O(h) — 递归栈/迭代栈深度 = 树高
  最优(平衡树): O(log n)
  最差(链表): O(n)

测试用例:
✅ [2,1,3] → True
✅ [5,1,4,null,null,3,6] → False (3 < 5 但在右子树)
✅ [1,null,1] → False (重复值，非严格递增)
✅ [] → True (空树是BST)
✅ [2147483647] → True (处理边界值)
```

## 💡 例子

**虾皮笔试场景**：面试官给出 `[5,1,4,null,null,3,6]`

```
     5
    / \
   1   4
      / \
     3   6
```

逐层分析：
- `5` 在 (-∞,+∞) ✓
- `1` 在 (-∞,5) ✓
- `4` 在 (5,+∞) → **4 < 5 ✗** → 返回False

这就是为什么只比较直接子节点会出错——`4 < 5` 看起来作为右子节点违反了BST定义。

## ❓ 苏格拉底式面试追问

1. **"如果允许重复值呢？BST定义要怎么改？"**
   → 左 <= 根 < 右 (或 左 < 根 <= 右)，中序遍历改为非严格递增

2. **"为什么用float('-inf')而不是INT_MIN？"**
   → 避免节点值恰好等于INT_MIN时的边界问题

3. **"这题的递归和迭代解法哪个更好？"**
   → 逻辑等价。迭代避免栈溢出但代码更长；递归更清晰。面试推荐先写递归再写迭代

4. **"如果树很大，递归会栈溢出吗？怎么处理？"**
   → 改用迭代中序遍历(Morris遍历可以做到O(1)空间)


## 结构化回答

**30 秒电梯演讲：** 验证BST 就是 检查每个节点是否满足"左子树所有节点 < 当前节点 < 右子树所有节点"。打个比方，就像查字典的页码——左边所有页码必须比当前页小，右边所有页码必须比当前页大。不能只看相邻页，因为中间穿插的页也可能乱序。

**展开框架：**
1. **最优解** — 递归传递(min, max)值域，O(n)时间O(h)空间
2. **等价判断** — 中序遍历结果严格递增
3. **常见错误** — 只比较直接父子，忽略孙子节点可能违反BST性质

**收尾：** 这块我踩过坑——要不要深入聊：BST和二叉树的区别是什么？

## 视频脚本

> 预计时长：2 分钟 | 由浅入深

| 时间 | 画面/字幕 | 口播台词 | 讲解要点 |
|------|----------|----------|----------|
| 0:00 | 标题卡 | "树一句话：验证BST 就是 检查每个节点是否满足'左子树所有节点 < 当前节点 < 右子树所有节点'。关键陷阱是只检查直接子节点不够…。" | 开场钩子 |
| 0:15 | 架构示意图 | "最优解: 递归传递(min, max)值域，O(n)时间O(h)空间" | 最优解 |
| 1:02 | 架构示意图分步演示 | "等价判断: 中序遍历结果严格递增" | 等价判断 |
| 1:50 | 总结卡 | "核心抓住这条主线，下期咱们接着聊：BST和二叉树的区别是什么。" | 收尾 |
