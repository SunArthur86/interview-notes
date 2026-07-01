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

