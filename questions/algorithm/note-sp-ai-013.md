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
  analogy: 像走迷宫找宝藏——每到一个路口(节点)就记下走过的路并减掉消耗，到死胡同(叶子)发现刚好到达目标就记录路线，然后退回上一步试别的路
  first_principle: 二叉树路径是从根到叶子的唯一路径，DFS天然遍历所有根到叶路径，回溯维护当前路径状态
  key_points:
  - DFS前序遍历访问每个节点
  - 进入节点：targetSum减去当前节点值
  - 叶子节点且剩余和为0：记录路径
  - 回溯：递归返回时从path中移除当前节点
  - 时间O(n²)，空间O(n)
first_principle:
  essence: 二叉树根到叶路径是唯一的，穷举所有路径即可
  derivation: DFS天然遍历所有路径→每条路径累计和→等于targetSum则记录→回溯恢复状态尝试其他路径
  conclusion: DFS+回溯是树形路径枚举问题的标准范式
follow_up:
- 如果路径不需要从根到叶子，而是任意节点到任意节点呢？
- 如果是N叉树怎么办？
- 能不能用BFS做？
memory_points:
- 核心算法：DFS回溯。因为要找所有解，所以递归遍历所有从根到叶子的路径。
- 三大步骤：进入节点时加入路径并扣减目标值，到达叶子判断是否归零，结束后撤销选择。
- 防引用陷阱：找到合法路径时必须拷贝（如path[:]）再加入结果集，否则随回溯变空。
- 复杂度分析：时间最坏O(n²)，空间(递归栈加路径)为O(n)。
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

## 记忆要点

- 核心算法：DFS回溯。因为要找所有解，所以递归遍历所有从根到叶子的路径。
- 三大步骤：进入节点时加入路径并扣减目标值，到达叶子判断是否归零，结束后撤销选择。
- 防引用陷阱：找到合法路径时必须拷贝（如path[:]）再加入结果集，否则随回溯变空。
- 复杂度分析：时间最坏O(n²)，空间(递归栈加路径)为O(n)。


## 苏格拉底式面试追问

> 这组追问模拟面试官层层逼问，每一问先回答"为什么"，再回答"怎么做"，最后回答"如何证明"。

### 第一层：目标与动机

**Q：路径总和 II 你用 DFS 回溯而不是 BFS，为什么？BFS 不是更适合求最短路径吗？**

这题要找所有"从根到叶子且和等于 target"的路径，不是求最短路径——所有合法路径都要收集，长度可能各不相同。BFS 适合求最短/最少步数（同层扩展），但这题要枚举所有解，DFS 天然沿一条路径深入到底（叶子），符合"找所有完整路径"的语义。另外 BFS 要维护"每个节点对应的路径状态"，队列里存的不只是节点还有路径，空间开销大；DFS 用递归栈天然回溯，路径用单一 list 维护，进出节点时增删即可，空间 O(h)。所以选 DFS 不是性能而是"问题结构匹配"——找所有根到叶路径是 DFS 的本职。

### 第二层：证据与定位

**Q：你找到合法路径时写 `result.append(path[:])`（浅拷贝），为什么不直接 `result.append(path)`？**

这是 Python 引用陷阱的典型 case。path 是一个 list 引用，回溯过程中会不断 append/pop 修改内容。如果直接 `result.append(path)`，存进 result 的是 path 的引用，后续 path 变化会反映到 result 里的"那个路径"——最终所有 result 元素都指向同一个空 list（回溯结束后 path 被清空）。`path[:]` 是切片创建新 list，存的是当前路径的快照，与后续修改隔离。验证方法：故意写成 `result.append(path)`，跑完发现 result 里全是 [] 或全是最后一条路径。这个 bug 在所有"回溯收集结果"的题里都会出现（组合、排列、子集、分割），必须用切片或 `list(path)` 或 `path.copy()`。

### 第三层：根因深挖

**Q：你的叶子判断是 `not node.left and not node.right`，为什么不能只判断 `node` 不为 None？**

因为"到达叶子"和"到达 None"是两个不同的事件。叶子定义是"左右孩子都为空"，而 None 是"叶子节点的孩子"（越界）。如果只用 `node is not None` 判断，那么在叶子节点递归调用 `dfs(node.left)` 时会进入 None 节点，这时 remaining 还没归零（叶子节点值已经扣过了，但 None 节点本身没值），可能在 None 节点误判。正确做法是在递归入口先判 `if not node: return`（防御越界），然后在"当前 node 是叶子（左右都空）且 remaining==0"时记录结果。这两个条件必须同时满足——只到叶子但 remaining 不对不算解，remaining 归零但不在叶子（中间节点）也不算解（必须到叶子才算完整路径）。

**Q：那为什么不用 BFS + 队列里存 (node, path, remaining) 三元组？**

能做，但有两个劣势：一、空间大——队列里每个元素都要存一份完整 path，最坏情况 O(n·h) 空间（n 节点，每条 path 长 h）；二、不直观——DFS 的回溯天然对应"进入节点 +path、离开节点 -path"，BFS 没有"自然回溯"概念，要在每个节点显式复制 path，容易忘记深拷贝踩同样的引用陷阱。DFS 的优势是"单一 path 复用"——所有递归共用一个 path list，进节点 append、出节点 pop，空间 O(h)。权衡：DFS 适合"找所有路径/所有解"，BFS 适合"找最短/最少"。这题是前者，DFS 是标准答案。

### 第四层：方案权衡

**Q：如果面试官要你返回路径的节点值之和而不是路径本身（即路径总和 I，只要 true/false），你的方案怎么简化？**

大幅简化：不需要 path list、不需要 result list、不需要回溯。只要一个 `found` 标志或直接返回布尔。DFS 函数签名从 `def dfs(node, path, remaining, result)` 简化成 `def dfs(node, remaining) -> bool`，递归时 `return dfs(node.left, remaining-node.val) or dfs(node.right, remaining-node.val)`。空间从 O(n·h)（收集所有路径）降到 O(h)（递归栈）。这是 LeetCode 112 vs 113 的区别——112 是存在性判断（只要 bool）、113 是枚举所有解（要收集路径），解法复杂度差一个量级。面试时要先确认题目要求，再决定收集路径还是只判断。

**Q：为什么不预先把树序列化成数组，再在数组上找路径？**

杀鸡用牛刀。序列化（如层序遍历转数组）本身是 O(n)，然后还要在数组上重建"父子关系"找根到叶路径，逻辑比直接 DFS 复杂。而且序列化丢失了树的指针语义，要重新用下标计算父子（如 `parent = (i-1)//2`），容易出错。DFS 直接利用树的 left/right 指针，天然就是路径遍历，零额外成本。序列化只在"要把树传到不能处理指针的环境"（如 JSON 传输、持久化）时才需要，内存里处理树就直接用指针。这是"不要把数据结构转成你不熟悉的形态再操作"的通用原则。

### 第五层：验证与沉淀

**Q：你怎么验证回溯实现的正确性，特别是 path 拷贝和叶子判断？**

四类用例：① 空树 → []；② 单节点树且 root.val==target → [[root.val]]，root.val!=target → []（测叶子边界）；③ 负数节点 + target=0（路径可能含负值，remaining 可能中途变正/变负，测扣减逻辑）；④ 多条合法路径（标准样例 [5,4,8,11,null,13,4,7,2,null,null,5,1], target=22 → [[5,4,11,7],[5,8,4,5]]）。重点验证 path 拷贝——故意跑多条解的 case，检查 result 里每条路径是否独立（不是同一引用）。对拍：随机生成二叉树，跟 BFS 版（用 (node, path, remaining) 三元组）逐 case 对比。

**Q：这道题沉淀出了什么可复用的回溯模板？**

回溯三步模板：① 做选择——进入节点时把当前元素加入路径（`path.append(node.val)`）、扣减目标（`remaining -= node.val`）；② 递归——深入下一层（`dfs(node.left, remaining)` 和 `dfs(node.right, remaining)`）；③ 撤销选择——回退时恢复路径（`path.pop()`），remaining 不用恢复（因为是参数传递，递归返回自动恢复）。这个模板适用于所有"枚举所有解"的回溯题：组合（选/不选）、排列（用了标记）、子集（含/不含）、分割（切/不切）。每道题只需改"做选择"和"终止条件"，骨架完全复用。模板里务必加 path 拷贝（记录解时），这是回溯题的第一大坑。


## 结构化回答

**30 秒电梯演讲：** DFS回溯——进入节点加路径减目标和，叶子且和为0记录，递归左右，回溯移除。打个比方，像走迷宫找宝藏——每到一个路口(节点)就记下走过的路并减掉消耗，到死胡同(叶子)发现刚好到达目标就记录路线，然后退回上一步试别的路。

**展开框架：**
1. **核心算法** — DFS回溯。因为要找所有解，所以递归遍历所有从根到叶子的路径。
2. **三大步骤** — 进入节点时加入路径并扣减目标值，到达叶子判断是否归零，结束后撤销选择。
3. **防引用陷阱** — 找到合法路径时必须拷贝（如path[:]）再加入结果集，否则随回溯变空。

**收尾：** 这块我踩过坑——要不要深入聊：如果路径不需要从根到叶子，而是任意节点到任意节点呢？

## 视频脚本

> 预计时长：2 分钟 | 由浅入深

| 时间 | 画面/字幕 | 口播台词 | 讲解要点 |
|------|----------|----------|----------|
| 0:00 | 标题卡 | "树一句话：DFS回溯——进入节点加路径减目标和，叶子且和为0记录，递归左右，回溯移除。" | 开场钩子 |
| 0:15 | 架构示意图 | "核心算法：DFS回溯。因为要找所有解，所以递归遍历所有从根到叶子的路径。" | 核心算法 |
| 1:02 | 架构示意图分步演示 | "三大步骤：进入节点时加入路径并扣减目标值，到达叶子判断是否归零，结束后撤销选择。" | 三大步骤 |
| 1:50 | 总结卡 | "核心抓住这条主线，下期咱们接着聊：如果路径不需要从根到叶子，而是任意节点到任意节点呢。" | 收尾 |
