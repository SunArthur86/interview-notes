---
id: note-by-004
difficulty: L2
category: ai
subcategory: 算法
tags:
- 字节
- 面经
- 回溯
- 贪心
- 算法题
- 不大于n的最大值
feynman:
  essence: 不大于 n 的最大值题面略含糊，常见两种解读。解读1是给定数字集合（如1,2,4,9），用这些数字拼出不超过n的最大数。解读2是从某范围找不超过n的满足条件的最大值。解读1用贪心+回溯，从高位到低位尽量填大数，超出n就回溯。解读2从n往下遍历或二分找。需先和面试官澄清题意，这本身是考点。
  analogy: 像用限定的积木（数字集合）搭一个不超过规定高度（n）的塔，且尽量高——从底层（高位）开始挑最大的能放的积木，放不下就回退重选。
  first_principle: 不超过n的最大本质是在约束下的最优化。若约束是用给定数字组成则回溯或贪心从高位填；若约束是满足某性质则从n往下找或二分。
  key_points:
  - '先澄清题意: 数字集合拼数 or 范围找满足条件'
  - '解读1(拼数): 贪心+回溯，高位到低位尽量填大，超出回溯'
  - '解读2(找性质): 从n往下遍历 or 二分'
  - '高位贪心: 高位尽量大，低位的权衡影响小'
  - '回溯: 当前位填X导致整体>n，回退试更小数字'
first_principle:
  essence: 约束下的最大化 = 高位贪心 + 失败回溯
  derivation: 数值大小高位决定 → 高位尽量填大 → 填不下回溯 → 保证最大且≤n
  conclusion: 数值题优先从高位贪心，回溯兜底
follow_up:
- 如果数字可重复使用呢？
- 如果要求恰好 K 位呢？
- 时间复杂度是多少？
memory_points:
- 核心策略：贪心+回溯，从高位到低位尽量填能填的最大数字
- 剪枝约束：受is_tight标志位约束，若前序与n一致，当前位上限受n该位限制，否则为9
- 回退机制：若位数与n相同的情况全超限，则直接退一位并全填最大数字拼成结果
- 复杂度对比：暴力的O(n^3)不可用，而回溯剪枝能避免全排列，效率极高
---

# 【字节面经】手撕：不大于 n 的最大值

## 一、先澄清题意（重要考点）

这类题面略含糊，**第一反应应该是和面试官确认**——这本身就是考察点。常见两种解读：

**解读1**：给定一组数字（如 `{1, 2, 4, 9}`），用这些数字（可重复）拼出 **≤ n 的最大数**。
> 例：digits={1,2,4,9}, n=2345 → 拼 "2299"？不对，最大是 "2249"？需算。

**解读2**：找 **≤ n 的最大自幂数/完全平方数/满足某性质的数**。
> 例：≤ n 的最大完全平方数 → floor(√n)²。

以下按**解读1**（更常见、更有算法含量）展开。

## 二、解读1：用给定数字拼 ≤ n 的最大数

### 思路：贪心 + 回溯

```
从高位到低位：
  1. 尽量填能填的最大数字（贪心）
  2. 如果某位填了 X 后，剩余位即使全填最大也不够/超出，回溯试更小数字
  3. 特殊情况：n 是 3 位数，但用给定数字拼 3 位必超 → 拼位数少一位的全最大数
```

### 完整实现

```python
def largestNumberNotGreaterThanN(digits: list[int], n: int) -> str:
    """
    用 digits 中的数字（可重复）拼出 ≤ n 的最大数。
    digits 如 [1, 2, 4, 9]
    """
    digits = sorted(set(digits))
    s = str(n)
    length = len(s)
    
    def backtrack(pos, is_tight, current):
        """
        pos: 当前填到第几位
        is_tight: 前面是否和 n 完全一致（True 表示受 n 约束）
        current: 已填的数字列表
        返回: 能拼出的最大数字字符串，或 None（拼不出）
        """
        if pos == length:
            return ''.join(current) if current else None
        
        # 这一位的上限
        upper = int(s[pos]) if is_tight else 9
        
        # 从大到小试（贪心）
        for d in reversed(digits):
            if d > upper:
                continue  # 超过 n 这一位，跳过
            # 填 d
            current.append(str(d))
            result = backtrack(
                pos + 1,
                is_tight and (d == upper),
                current
            )
            if result is not None:
                return result  # 找到最大的，直接返回
            current.pop()
        
        return None  # 这一位填什么都不行
    
    result = backtrack(0, True, [])
    
    # 如果位数和 n 相同拼不出（如 n=200, digits=[3,4,5] 都>2）
    # 退一位拼全最大
    if result is None and length > 1:
        # 拼位数少一位的、全用最大数字
        result = str(max(digits)) * (length - 1)
        # 去掉前导 0（如果有）
        result = result.lstrip('0') or '0'
    
    return result if result else "0"
```

### 示例

```python
# 例1: digits=[1,2,9], n=2345
# 第0位: 上限2，试9(超)→试2(填)，is_tight=True
# 第1位: 上限3，试9(超)→试2(填)，is_tight=False（2<3）
# 第2位: is_tight=False，上限9，填9
# 第3位: 填9
# 结果: "2299"

# 例2: digits=[5,6], n=100  
# 第0位: 上限1，试6(超)→试5(超)→None
# 退一位: "66"（2位最大，但>100?）不对
# 正确: 退一位拼"66"? 66<100 ✓ 但其实应该检查
# 更稳: 位数少一位的全最大 = "66"（66≤100 ✓）
```

## 三、简化版（数字可重复，常见面试版）

```python
def largest_smaller_or_equal(digits, n):
    """简化: 贪心从高位填，每位填 ≤ 对应位的最大可用数字"""
    digits = sorted(digits, reverse=True)
    s = str(n)
    
    # 尝试 1 到 len(s) 位
    for length in range(len(s), 0, -1):
        # 尝试用 length 位拼最大数
        if length < len(s):
            # 位数少，直接全填最大
            return str(digits[0]) * length
        
        # 位数相同，受 n 约束
        result = []
        for i, ch in enumerate(s):
            upper = int(ch)
            # 找 ≤ upper 的最大可用数字
            placed = False
            for d in digits:
                if d <= upper:
                    result.append(str(d))
                    placed = True
                    break
            if not placed:
                break  # 这位填不了
        else:
            # 成功填完 length 位
            return ''.join(result)
    
    return "0"  # 都不行
```

## 四、解读2：≤ n 的最大满足某性质的数

### 例：≤ n 的最大完全平方数

```python
import math
def largest_square_leq(n):
    return math.isqrt(n) ** 2  # math.isqrt 是整数平方根
```

### 例：≤ n 的最大 2 的幂

```python
def largest_power_of_2_leq(n):
    if n <= 0: return 0
    # 找最高位的 1
    return 1 << (n.bit_length() - 1)
```

## 五、加分点

- 说出 **先和面试官澄清题意**（数字拼数 vs 范围找性质）
- 说出 **高位贪心**：数值大小由高位决定，高位尽量填大
- 说出 **回溯**：当前选择导致拼不出/超出就回退

## 六、雷区

- ❌ 不澄清题意直接写 → 可能答错方向
- ❌ 高位填不下时不回溯 → 漏解
- ❌ 忘记处理"位数少一位"的情况 → n=200 digits=[3,4] 应返回 "44"

## 七、扩展

- **数位 DP**：此类"≤ n 的满足条件数"通用解法，用记忆化搜索
- **前导 0 处理**：如拼 3 位数时首位不能是 0
- **数字不可重复**：需要额外记录已用数字（全排列变体）

## 记忆要点

- 核心策略：贪心+回溯，从高位到低位尽量填能填的最大数字
- 剪枝约束：受is_tight标志位约束，若前序与n一致，当前位上限受n该位限制，否则为9
- 回退机制：若位数与n相同的情况全超限，则直接退一位并全填最大数字拼成结果
- 复杂度对比：暴力的O(n^3)不可用，而回溯剪枝能避免全排列，效率极高

