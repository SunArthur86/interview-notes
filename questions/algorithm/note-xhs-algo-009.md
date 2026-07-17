---
id: note-xhs-algo-009
difficulty: L2
category: algorithm
subcategory: 二叉树/DFS
tags:
- 拼多多
- Java服务端
- 二叉树
- DFS
- 递归
- 手撕代码
- 面经
feynman:
  essence: "合并两棵二叉树：相同位置的节点值相加，不同位置的节点直接保留，用DFS递归同时遍历两棵树即可"
  analogy: "想象两个部门的组织架构图要合并——同一个岗位有两个人，那合并后的岗位人数=两个部门人数之和；如果只有一个部门有这个岗位，就直接搬过来"
  key_points:
  - 两棵树同一位置节点值相加：t1.val + t2.val
  - 如果一边为null，直接返回另一边（递归终止条件）
  - DFS递归：merge(t1.left, t2.left) 和 merge(t1.right, t2.right)
  - 时间复杂度O(min(N,M))，只遍历两棵树重叠部分
  - 面试现场可用BFS层序，但DFS递归代码最简洁
first_principle:
  essence: "树是递归结构——任何树操作都可以分解为'处理根节点 + 递归处理子树'"
  derivation: "两棵树在同一位置有三种情况：(1)都存在→值相加 (2)只有一个存在→直接用那个 (3)都不存在→返回null。递归处理左右子树即可"
  conclusion: "合并二叉树 = 同步DFS + 节点值相加 + null短路返回"
follow_up:
- 如果要求不修改原始树（创建新节点），代码怎么改？
- BFS层序方式如何实现合并？和DFS有什么区别？
- 迭代法（不用递归）怎么实现？
- 如果两棵树结构差异很大（深度差很多），合并后的树是什么形态？
memory_points:
- 核心三行：if (!t1) return t2; if (!t2) return t1; t1.val += t2.val
- 递归处理：t1.left = merge(t1.left, t2.left); t1.right = merge(t1.right, t2.right)
- 返回t1（原地修改）或创建新节点（不破坏原树）
---

# 【拼多多 Java服务端】力扣617：合并两棵二叉树

> 来源：拼多多复活赛一面面经（小红书）

## 一、费曼类比

合并二叉树就像**两个团队的组织架构合并**：

```
  树1:        树2:         合并后:
    1          2              3
   / \        / \            / \
  3   2      1   3          4   5
 /            \   \         /     \
5              4   7       9       7
```

相同位置的节点值直接**相加**（1+2=3），不同位置只有一边有节点的就**搬过来**。

## 二、第一性原理分析

**为什么用DFS递归？** 因为树天然是递归结构。

处理任何一个位置，只有三种情况：

```
情况1: t1存在, t2存在 → 新值 = t1.val + t2.val，递归合并左右子树
情况2: t1不存在, t2存在 → 直接返回t2（整棵子树搬过来）
情况3: t1存在, t2不存在 → 直接返回t1
情况4: 都不存在 → 返回null（自动处理）
```

## 三、详细答案

### 解法一：DFS递归（推荐）

```java
class Solution {
    public TreeNode mergeTrees(TreeNode t1, TreeNode t2) {
        // 递归终止：某一边为空，直接返回另一边
        if (t1 == null) return t2;
        if (t2 == null) return t1;
        
        // 两边都存在：值相加
        t1.val += t2.val;
        
        // 递归合并左右子树
        t1.left = mergeTrees(t1.left, t2.left);
        t1.right = mergeTrees(t1.right, t2.right);
        
        // 返回合并后的t1（原地修改）
        return t1;
    }
}
```

### 解法二：BFS层序（面试官提示的替代方案）

```java
class Solution {
    public TreeNode mergeTrees(TreeNode t1, TreeNode t2) {
        if (t1 == null) return t2;
        if (t2 == null) return t1;
        
        Queue<TreeNode[]> queue = new LinkedList<>();
        queue.offer(new TreeNode[]{t1, t2});
        
        while (!queue.isEmpty()) {
            TreeNode[] pair = queue.poll();
            // t1一定不为null（因为入队时保证）
            if (pair[1] == null) continue; // t2为空，t1不变
            
            pair[0].val += pair[1].val;
            
            // 处理左子树
            if (pair[0].left == null) {
                pair[0].left = pair[1].left; // 直接搬过来
            } else if (pair[1].left != null) {
                queue.offer(new TreeNode[]{pair[0].left, pair[1].left});
            }
            
            // 处理右子树
            if (pair[0].right == null) {
                pair[0].right = pair[1].right;
            } else if (pair[1].right != null) {
                queue.offer(new TreeNode[]{pair[0].right, pair[1].right});
            }
        }
        return t1;
    }
}
```

## 四、复杂度分析

| 维度 | DFS递归 | BFS层序 |
|------|---------|---------|
| 时间复杂度 | O(min(N, M)) | O(min(N, M)) |
| 空间复杂度 | O(min(H1, H2)) 递归栈 | O(min(W1, W2)) 队列 |
| 代码简洁度 | 极简（6行核心） | 较复杂（~20行） |
| 面试推荐 | **推荐**（面试官期望） | 作为补充 |

## 五、例子演示

```
输入: 
  Tree 1     Tree 2
     1         2
    / \       / \
   3   2     1   3
  /           \   \
 5             4   7

输出: 
     3
    / \
   4   5
  / \   \
 5   4   7

过程:
- 根节点: 1+2=3
- 左子节点: 3+1=4
- 右子节点: 2+3=5
- 最左叶: 5(null直接保留) = 5
- 左右叶: null+4=4
- 最右叶: null+7=7
```

## 六、扩展知识

### 不修改原树的版本

```java
public TreeNode mergeTrees(TreeNode t1, TreeNode t2) {
    if (t1 == null) return t2;
    if (t2 == null) return t1;
    
    TreeNode merged = new TreeNode(t1.val + t2.val);
    merged.left = mergeTrees(t1.left, t2.left);
    merged.right = mergeTrees(t1.right, t2.right);
    return merged;
}
```

## 七、苏格拉底式面试提问

1. **"你说用DFS递归，但如果树的深度达到1万层呢？"** — 引出栈溢出风险，需要迭代解法
2. **"你的代码修改了t1，如果调用方还需要原树怎么办？"** — 测试不变性意识，引出新节点方案
3. **"如果两棵树非常大，内存放不下怎么办？"** — 引出流式处理、外部排序等分布式思路
4. **"合并N棵树呢？时间复杂度怎么变化？"** — 引出归并策略 vs 逐一合并的复杂度差异
5. **"BFS和DFS在这种场景下有什么本质区别？"** — 测试对两种遍历方式空间复杂度的理解

## 八、面试加分点

1. **先说最优解再编码** — DFS递归是最简洁的，直接说思路
2. **主动提不修改原树** — 展示工程意识
3. **知道BFS解法** — 面试官提示层序时，能快速转换
4. **递归终止条件清晰** — 三个if分别处理三种null情况
5. **主动分析复杂度** — O(min(N,M))不是O(N+M)，体现精确分析


## 结构化回答

**30 秒电梯演讲：** 合并两棵二叉树：相同位置的节点值相加，不同位置的节点直接保留，用DFS递归同时遍历两棵树即可。

**展开框架：**
1. **核心三行** — if (!t1) return t2; if (!t2) return t1; t1.val += t2.val
2. **递归处理** — t1.left = merge(t1.left, t2.left); t1.right = merge(t1.right, t2.right)
3. **返回t1（原地修改）或创** — 返回t1（原地修改）或创建新节点（不破坏原树）

**收尾：** 这块我踩过坑——要不要深入聊：如果要求不修改原始树（创建新节点），代码怎么改？

## 视频脚本

> 预计时长：2 分钟 | 由浅入深

| 时间 | 画面/字幕 | 口播台词 | 讲解要点 |
|------|----------|----------|----------|
| 0:00 | 标题卡 | "二叉树/DFS一句话：合并两棵二叉树：相同位置的节点值相加，不同位置的节点直接保留，用DFS递归同时遍历两棵树即可。" | 开场钩子 |
| 0:15 | 二叉树结构图 | "核心三行：if (!t1) return t2; if (!t2) return t1; t1.val +就是 t2…" | 核心三行 |
| 1:02 | 二叉树结构图分步演示 | "递归处理：t1.left 就是 merge(t1.left, t2.left); t1.right 就是 merge…" | 递归处理 |
| 1:50 | 总结卡 | "核心抓住这条主线，下期咱们接着聊：如果要求不修改原始树（创建新节点），代码怎么改。" | 收尾 |
