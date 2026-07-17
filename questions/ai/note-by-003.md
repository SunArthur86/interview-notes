---
id: note-by-003
difficulty: L2
category: ai
subcategory: 算法
tags:
- 字节
- 面经
- 滑动窗口
- 双指针
- 算法题
- 最长无重复子串
feynman:
  essence: 求字符串最长无重复字符子串的长度，最优解是滑动窗口+哈希表 O(n)。维护窗口 [left, right]，right 右扩遇到重复字符就把 left 跳到"重复字符上次出现位置+1"。哈希表存每个字符的最新下标，O(1) 判断重复并定位 left 新位置。关键优化：left 不用一步步挪，直接跳到重复字符上次的下一位（哈希表存的值）。
  analogy: 像在书里找最长的不重复段落——用两个手指夹住一段（窗口），右手指往右滑，遇到重复的字就把左手指直接跳到上次这个字之后，继续找。不用每次左手指一格一格挪，直接跳过去最快。
  first_principle: 无重复子串的"无重复"约束可以用窗口维护——窗口内保证无重复，右扩时若遇重复就收缩左边界到合法。哈希表记录字符位置让收缩可以"跳变"而非"逐格"，降到 O(n)。
  key_points:
  - 滑动窗口[left,right]+哈希表存字符最新下标
  - right右扩遇重复，left跳到重复字符上次位置+1
  - '关键优化: left跳变(非逐格)，靠哈希表O(1)定位'
  - 时间O(n)空间O(min(n,字符集大小))
  - 更新max_len = max(max_len, right-left+1)
first_principle:
  essence: 滑动窗口维护"无重复"约束，哈希表实现 O(1) 收缩定位
  derivation: 暴力O(n³) → 优化双指针O(n²) → 哈希表记录位置让left跳变 → O(n)
  conclusion: 滑动窗口+哈希表是字符串"无重复/至多K种"类问题的通用模板
follow_up:
- 如果允许最多 K 个重复怎么做？
- 如果是字符流（实时输入）怎么做？
- 滑动窗口的 left 什么时候"跳变"什么时候"逐格"？
memory_points:
- 算法框架：滑动窗口+哈希表，因为right遍历一次且left可跳变，所以时间复杂度为O(n)
- 核心优化：遇重复字符，left直接跳到该字符上次出现的下标+1（跳变收缩）
- 边界判断：跳变前必须检查 char_index[ch] >= left，否则会误跳到窗口外
- 核心动作：每次移动right更新哈希表，并计算 max_len = max(max_len, right-left+1)
---

# 【字节面经】手撕：求字符串最长无重复字符子串的长度

## 一、题目

给定字符串 s，找其中不包含重复字符的最长子串的长度。

```
输入: "abcabcbb"
输出: 3（"abc" 或 "bca" 或 "cab"）

输入: "bbbbb"
输出: 1（"b"）

输入: "pwwkew"
输出: 3（"wke"）
```

## 二、最优解：滑动窗口 + 哈希表

```python
def lengthOfLongestSubstring(s: str) -> int:
    char_index = {}        # 字符 → 最新下标
    left = 0
    max_len = 0
    
    for right in range(len(s)):
        ch = s[right]
        # 如果 ch 在窗口内出现过（char_index[ch] >= left）
        # left 跳到 ch 上次出现位置 + 1
        if ch in char_index and char_index[ch] >= left:
            left = char_index[ch] + 1
        
        # 更新 ch 的最新下标
        char_index[ch] = right
        
        # 更新最长长度
        max_len = max(max_len, right - left + 1)
    
    return max_len
```

### 执行过程示例：s = "abcabcbb"

```
right=0, ch='a': 窗口[a], left=0, max_len=1, char_index={a:0}
right=1, ch='b': 窗口[a,b], left=0, max_len=2, char_index={a:0,b:1}
right=2, ch='c': 窗口[a,b,c], left=0, max_len=3, char_index={a:0,b:1,c:2}
right=3, ch='a': a重复(上次在0), left跳到1, 窗口[b,c,a], max_len=3, char_index={a:3,b:1,c:2}
right=4, ch='b': b重复(上次在1,>=left=1), left跳到2, 窗口[c,a,b], max_len=3, char_index={a:3,b:4,c:2}
right=5, ch='c': c重复(上次在2,>=left=2), left跳到3, 窗口[a,b,c], max_len=3
right=6, ch='b': b重复(上次在4,>=left=3), left跳到5, 窗口[c,b], max_len=3
right=7, ch='b': b重复(上次在6,>=left=5), left跳到7, 窗口[b], max_len=3

结果: 3
```

## 三、为什么 left 可以"跳变"（核心优化）

```
普通滑动窗口：left 逐格右移（O(n²)）
  遇重复 → left += 1 → 还重复 → left += 1 → ...

优化：left 直接跳到"重复字符上次出现位置 + 1"
  遇 s[right]=ch 重复 → left = char_index[ch] + 1
  
为什么正确：
  如果 s[right] 在 [left, right] 内重复（位置 j）
  那么 [left, j] 这段都包含重复 ch
  → left 必须跳过 j 才能消除重复
  → left = j + 1 是最优（最小收缩）
  
为什么安全（char_index[ch] >= left 检查）：
  char_index[ch] 可能是窗口外的旧记录
  → 如果 char_index[ch] < left，说明 ch 上次在窗口外，不影响
  → 只在 char_index[ch] >= left 时才跳
```

## 四、复杂度

| 维度 | 复杂度 | 说明 |
|------|--------|------|
| 时间 | **O(n)** | right 遍历一次，left 跳变（均摊 O(n)） |
| 空间 | O(min(n, 字符集)) | 哈希表存字符（ASCII 128 或 Unicode） |

## 五、其他解法对比

### 暴力法 O(n³)
```python
def brute(s):
    max_len = 0
    for i in range(len(s)):
        for j in range(i, len(s)):
            if len(set(s[i:j+1])) == j-i+1:  # 无重复
                max_len = max(max_len, j-i+1)
    return max_len
```
两层循环 + set 检查，O(n³)。

### 双指针无哈希 O(n²)
```python
def two_pointer(s):
    max_len = 0
    for right in range(len(s)):
        left = right
        while s[left] != s[right] and left > 0:
            # 逐格检查...（复杂写法）
```
不用哈希表逐格查，O(n²)。

**最优是滑动窗口+哈希表 O(n)**。

## 六、变体：至多 K 个重复

```python
def lengthOfLongestSubstringKDistinct(s: str, k: int) -> int:
    """最多包含 K 种不同字符的最长子串"""
    from collections import defaultdict
    count = defaultdict(int)
    left = 0
    max_len = 0
    distinct = 0
    
    for right in range(len(s)):
        if count[s[right]] == 0:
            distinct += 1
        count[s[right]] += 1
        
        # 超过 K 种，收缩 left
        while distinct > k:
            count[s[left]] -= 1
            if count[s[left]] == 0:
                distinct -= 1
            left += 1
        
        max_len = max(max_len, right - left + 1)
    return max_len
```
无重复 = K=1 的特例。

## 七、加分点

- 说出 **left 跳变是核心优化**（哈希表记录位置，O(1) 定位）
- 说出 **char_index[ch] >= left 检查**避免窗口外旧记录干扰
- 说出 **用 log 域 / 哈希表避免重复扫描**

## 八、雷区

- ❌ 不检查 `char_index[ch] >= left` → 误跳到窗口外旧位置
- ❌ left 逐格挪 → O(n²) 不够优
- ❌ 忘记更新 char_index[ch] = right → 后续判断出错

## 九、扩展

- **字符流版本**：用双向链表 + 哈希表支持实时插入查询
- **滑动窗口通用模板**：right 扩张满足约束，违反约束时收缩 left，记录过程中的最优
- **相关题**：最小覆盖子串、找到字符串中所有字母异位词（同属滑动窗口家族）

## 记忆要点

- 算法框架：滑动窗口+哈希表，因为right遍历一次且left可跳变，所以时间复杂度为O(n)
- 核心优化：遇重复字符，left直接跳到该字符上次出现的下标+1（跳变收缩）
- 边界判断：跳变前必须检查 char_index[ch] >= left，否则会误跳到窗口外
- 核心动作：每次移动right更新哈希表，并计算 max_len = max(max_len, right-left+1)


## 苏格拉底式面试追问

> 这组追问模拟面试官层层逼问，每一问先回答"为什么"，再回答"怎么做"，最后回答"如何证明"。

### 第一层：目标与动机

**Q：求最长无重复字符子串，暴力 O(n³) 人人都会想到，为什么面试官期待 O(n)？O(n) 的核心洞察是什么？**

核心洞察是"窗口内的无重复约束可以被增量维护，不需要每次重新检查"。暴力 O(n³) 的浪费在于：每次 right 右移一位，从 left 重新扫整个子串判重——但 right 只新增了一个字符，之前的无重复性已经被验证过，重复检查是冗余。O(n) 的关键：用哈希表记录每个字符的最新下标，right 右移遇到重复时，left 直接跳到"重复字符上次出现位置+1"（不是逐格挪），整个过程中 left 和 right 各最多遍历 n 次，总 O(2n)=O(n)。本质是"用空间（哈希表）换时间（跳变收缩）"，且避免重复计算已验证的状态。

### 第二层：证据与定位

**Q：你说 left "跳到重复字符上次位置+1"，但这个跳变会不会跳过头，漏掉一些合法的更长子串？**

不会跳过头。证明：设当前窗口 [left, right]，right 遇到的字符 c 上次出现在 pos[c]。因为窗口内原本无重复（不变式），c 在 [left, right-1] 内只可能在 pos[c] 出现一次。要让新的 [left', right] 无重复且包含 c，left' 必须 > pos[c]（否则窗口内有两个 c）。所以 left'=pos[c]+1 是"最小的合法 left"，不会漏掉任何更长的合法子串——任何 left<pos[c]+1 的窗口都含重复 c 不合法，left>pos[c]+1 的窗口比 left'=pos[c]+1 更短。所以跳到 pos[c]+1 既保证无重复，又保证窗口最大，是精确的最优收缩。

### 第三层：根因深挖

**Q：边界 case "abba" 这种，right 走到第二个 b 时 left 从 0 跳到 2，但第二个 a 出现在 index 2，right 继续走到 index 3 的 a 时，left 怎么动？容易出什么 bug？**

这是经典的"left 不能回退"边界。走查 "abba"：right=0(a),left=0; right=1(b),left=0; right=2(b)，b 上次在 1，left 跳到 2；right=3(a)，a 上次在 0（哈希表里存的），如果直接 left=pos[a]+1=1，left 从 2 退回到 1——这是 bug！因为 left 退回后窗口 [1,3]="bba" 含重复 b。正确做法：left = max(left, pos[c]+1)，即 left 只能前进不能后退。right=3(a) 时 left=max(2, 0+1)=2，窗口 [2,3]="ba" 无重复。这个 max 是关键边界处理，漏了就会在"中间有重复回环"的 case 出错。

**Q：为什么不直接用 set 维护窗口内字符（遇到重复就 left 逐个挪、set 里删字符），而要用哈希表存下标？**

set 方案 left 要逐格挪（while s[left] in set: remove s[left]; left+=1），虽然整体还是 O(2n)=O(n)（left 总共前进 n 次），但常数更大（每步 set 操作）。哈希表方案 left 直接跳变，常数更优。更重要的区别是"信息保留"——set 只知道"有没有重复"，哈希表知道"重复在哪"，这个位置信息让 left 跳变成为可能。从 O(n²)（双指针+set 内层逐挪）到 O(n)（哈希表跳变）的本质就是"用下标信息替代逐格探测"。面试中两种都能写对，但哈希表方案体现"用信息换效率"的算法思维，是面试官更想看到的。

### 第四层：方案权衡

**Q：这题用滑动窗口能 O(n)，那如果变成"最长至多含 K 个不同字符的子串"，思路还一样吗？要改什么？**

核心思路一样（滑动窗口 + 哈希表），但哈希表从"存下标"改成"存字符计数"。无重复（K=1 的特例）时每个字符最多出现 1 次，可以用下标定位；至多 K 种字符时窗口内可能有多个相同字符，要统计"不同字符种类数"，用哈希表存 {char: count}。right 右扩时 count[char]++，当 len(map)>K 时 left 右移（count[s[left]]--，归零就删 key），直到种类数回到 K。复杂度仍是 O(n)（left/right 各遍历一次）。模板化：这类"满足某约束的最长/最短子串"问题，滑动窗口+合适的哈希表结构（下标 or 计数）是通用解法。

**Q：为什么不直接用 DP（动态规划）解这题？dp[i] 表示以 i 结尾的最长无重复子串长度，状态转移不也清晰吗？**

DP 能解但不是最优。dp[i] 的转移：dp[i] = min(dp[i-1]+1, i - pos[s[i]])，其中 pos[s[i]] 是 s[i] 上次出现的下标。这个 DP 是 O(n) 时间 O(n) 空间，和滑动窗口一样快，但有两个劣势：1）空间——DP 要 O(n) 存 dp 数组，滑动窗口只要 O(min(n, 字符集大小)) 的哈希表（ASCII 只需 128 size 数组）；2）语义——DP 的状态转移依赖"dp[i-1] 和 pos 的 min"这个关系，不如滑动窗口的"窗口收缩"直观，面试时更容易写错边界。滑动窗口还能自然扩展到 K 种字符、变体约束，泛化性更强。所以这题虽可用 DP，滑动窗口是更优且更通用的选择。

### 第五层：验证与沉淀

**Q：你怎么验证代码在各种边界 case 都对，而不是只过了示例？**

设计测试用例覆盖所有边界：1）空串 ""→0；2）单字符 "a"→1；3）全相同 "aaaa"→1；4）全不同 "abcd"→4；5）回环重复 "abba"→2（测 left 不回退）；6）末尾重复 "abcda"→4（测 right 到末尾）；7）Unicode/特殊字符（如果题面支持）测哈希表的字符 key 处理。对每个 case 手动走查 left/right/pos 的变化，确认 max_len 正确。提交前用暴力 O(n³) 写一个对照函数，随机生成 1000 个测试串，对比 O(n) 和 O(n²) 的输出，全一致才算验证通过。这种"暴力对照 + 随机测试"是算法题验证的黄金标准。

**Q：滑动窗口这类题的解题经验怎么沉淀，面试时能快速套用？**

总结成模板：1）识别信号——题目含"最长/最短子串/子数组 + 满足某约束（无重复/至多K种/和≥target）"，优先想滑动窗口；2）通用模板——双指针 left/right，right 右扩扩张窗口，约束被破坏时 left 右缩修复约束，过程中记录最优解；3）数据结构选型——约束是"位置相关"（无重复）用哈希表存下标，约束是"计数相关"（至多K种）用哈希表存计数，约束是"数值相关"（和≥target）用前缀和。把这三步做成"滑动窗口三问"（约束是什么/扩张条件/收缩条件）的肌肉记忆，面试看到窗口题直接套，10 分钟内写出 bug-free 的 O(n) 解。

## 结构化回答

**30 秒电梯演讲：** 求字符串最长无重复字符子串的长度，最优解是滑动窗口+哈希表 O(n)。维护窗口 [left, right]，right 右扩遇到重复字符就把 left 跳到"重复字符上次出现位置+1"。哈希表存每个字符的最新下标。

**展开框架：**
1. **滑动窗口[l** — 滑动窗口[left,right]+哈希表存字符最新下标
2. **right** — right右扩遇重复，left跳到重复字符上次位置+1
3. **关键优化** — left跳变(非逐格)，靠哈希表O(1)定位

**收尾：** 您想深入聊：如果允许最多 K 个重复怎么做？


## 视频脚本

> 预计时长：3 分钟 | 由浅入深


| 时间 | 画面/字幕 | 口播台词 | 讲解要点 |
|------|----------|----------|----------|
| 0:00 | 标题卡：手撕：求字符串最长无重复字符子串的长度 | "像在书里找最长的不重复段落——用两个手指夹住一段（窗口），右手指往右滑，遇到重复的字就把左…" | 开场钩子 |
| 0:20 | 核心概念图 | "求字符串最长无重复字符子串的长度，最优解是滑动窗口+哈希表 O(n)。维护窗口 [left, right]，right…" | 核心定义 |
| 0:55 | 滑动窗口[l示意图 | "滑动窗口[l——滑动窗口[left,right]+哈希表存字符最新下标" | 要点拆解1 |
| 1:30 | 对比/实战案例图 | "对比一下常见误区和工程实践，看真实场景里怎么取舍。" | 实战与对比 |
