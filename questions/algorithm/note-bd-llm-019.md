---
id: note-bd-llm-019
difficulty: L2
category: algorithm
subcategory: 滑动窗口
tags:
- 字节
- 面经
- 手撕
- 滑动窗口
- 最长不重复子串
feynman:
  essence: 用双指针维护滑动窗口+HashMap记录字符最后出现位置，O(n)时间复杂度。
  analogy: 就像排队买票——窗口是当前不重复的人，新来的人如果和队列里的人重号，就从重号的人后面截断队列。
  first_principle: 滑动窗口的本质是维护一个满足条件的连续区间，用双指针动态调整边界。
  key_points:
  - 左右双指针维护窗口
  - HashMap记录字符最后出现位置
  - 右指针扩展遇到重复→左指针跳到重复字符+1
  - '流式处理: 每次add一个字符更新窗口'
first_principle:
  essence: 滑动窗口=单调性+双指针(O(n))
  derivation: '暴力O(n^3)→优化: 固定左端枚举右端O(n^2)→观察: 左端可以跳变→用HashMap记录位置→左端直接跳→O(n)'
  conclusion: 滑动窗口+HashMap是不重复子串的最优解
follow_up:
- 如果是字符串流(无限输入)怎么处理？
- 如果要返回所有最长不重复子串呢？
- 窗口大小固定为K的问题怎么解？
memory_points:
- 核心模型：双指针+HashMap。因为需实时O(1)操作，所以HashMap记录字符最后一次出现的位置。
- 左边界单调右移：遇重复时直接跳过，公式为 left = max(left, map[char]+1)。
- 右边界逐个扩展：每流入一个新字符，即计算并更新最大窗口长度。
- 空间换时间：时间复杂度O(1)每次操作，空间复杂度O(字符集大小)。
---

# 【字节面经】给定一个字符串流，实现一个滑动窗口，返回当前窗口内的最长不重复子串长度。

## 一、题目分析

### 1.1 题目描述

给定一个字符串流（字符逐个到达，长度可能无限），需要实时维护一个数据结构，支持：

- `add(char)`：流入一个新字符
- `query()`：返回**当前已流入的全部字符中**最长不重复子串的长度

**示例**：
```
流入 "a"     → 最长不重复子串 "a"     → 长度 1
流入 "b"     → 最长不重复子串 "ab"    → 长度 2
流入 "c"     → 最长不重复子串 "abc"   → 长度 3
流入 "a"     → 最长不重复子串 "bca"   → 长度 3
流入 "b"     → 最长不重复子串 "cab"   → 长度 3
流入 "b"     → 最长不重复子串 "ab"    → 长度 2
```

### 1.2 核心约束

| 维度 | 要求 |
|------|------|
| 时间复杂度 | 每次 `add` 操作 O(1) |
| 空间复杂度 | O(min(n, charset))，charset为字符集大小 |
| 流式特性 | 字符逐个到达，无法回看已丢弃的字符 |

---

## 二、算法思路

### 2.1 从暴力到最优的推导

```
暴力 O(n³): 枚举所有子串 → 检查是否不重复 → 取最大
    ↓ 优化: 固定左端，右端逐步扩展
O(n²): 固定left, right向右扫描直到出现重复
    ↓ 关键观察: 当right遇到重复时，left可以直接跳到
    ↓          "重复字符上次出现位置+1"，无需逐个移动
O(n): 双指针 + HashMap，left只增不减(单调性)
```

### 2.2 核心思想：双指针 + HashMap

```
left指针:  窗口左边界，只增不减（单调右移）
right指针: 窗口右边界，逐字符扩展

HashMap:   记录每个字符最后一次出现的位置(索引)
           char → index

关键操作:  当 right 指向的字符已在窗口内出现时
           left = max(left, char_last_pos[char] + 1)
           → left 跳过重复字符，保证窗口内不重复
```

### 2.3 图解过程

以字符串 `"abcabcbb"` 为例：

```
初始: left=0, right=0, maxLen=0, map={}

Step 1: char='a'  map中无'a'
        ┌───┬───┬───┬───┬───┬───┬───┬───┐
        │ a │ b │ c │ a │ b │ c │ b │ b │
        └───┴───┴───┴───┴───┴───┴───┴───┘
          L
          R
        map={'a':0}  窗口="a"  maxLen=1

Step 2: char='b'  map中无'b'
        ┌───┬───┬───┬───┬───┬───┬───┬───┐
        │ a │ b │ c │ a │ b │ c │ b │ b │
        └───┴───┴───┴───┴───┴───┴───┴───┘
          L   R
        map={'a':0,'b':1}  窗口="ab"  maxLen=2

Step 3: char='c'  map中无'c'
        ┌───┬───┬───┬───┬───┬───┬───┬───┐
        │ a │ b │ c │ a │ b │ c │ b │ b │
        └───┴───┴───┴───┴───┴───┴───┴───┘
          L       R
        map={'a':0,'b':1,'c':2}  窗口="abc"  maxLen=3

Step 4: char='a'  map中'a'在位置0, 0 >= left=0 → 重复!
        left跳到 max(0, 0+1) = 1
        ┌───┬───┬───┬───┬───┬───┬───┬───┐
        │ a │ b │ c │ a │ b │ c │ b │ b │
        └───┴───┴───┴───┴───┴───┴───┴───┘
              L       R
        更新 map={'a':3,'b':1,'c':2}  窗口="bca"  maxLen=3

Step 5: char='b'  map中'b'在位置1, 1 >= left=1 → 重复!
        left跳到 max(1, 1+1) = 2
        ┌───┬───┬───┬───┬───┬───┬───┬───┐
        │ a │ b │ c │ a │ b │ c │ b │ b │
        └───┴───┴───┴───┴───┴───┴───┴───┘
                  L       R
        更新 map={'a':3,'b':4,'c':2}  窗口="cab"  maxLen=3

Step 6: char='c'  map中'c'在位置2, 2 >= left=2 → 重复!
        left跳到 max(2, 2+1) = 3
        ┌───┬───┬───┬───┬───┬───┬───┬───┐
        │ a │ b │ c │ a │ b │ c │ b │ b │
        └───┴───┴───┴───┴───┴───┴───┴───┘
                      L       R
        更新 map={'a':3,'b':4,'c':5}  窗口="abc"  maxLen=3

Step 7: char='b'  map中'b'在位置4, 4 >= left=3 → 重复!
        left跳到 max(3, 4+1) = 5
        ┌───┬───┬───┬───┬───┬───┬───┬───┐
        │ a │ b │ c │ a │ b │ c │ b │ b │
        └───┴───┴───┴───┴───┴───┴───┴───┘
                            L   R
        更新 map={'a':3,'b':6,'c':5}  窗口="cb"  maxLen=3

Step 8: char='b'  map中'b'在位置6, 6 >= left=5 → 重复!
        left跳到 max(5, 6+1) = 7
        ┌───┬───┬───┬───┬───┬───┬───┬───┐
        │ a │ b │ c │ a │ b │ c │ b │ b │
        └───┴───┴───┴───┴───┴───┴───┴───┘
                                L   R
        更新 map={'a':3,'b':7,'c':5}  窗口="b"  maxLen=3

最终结果: maxLen = 3 (子串 "abc" / "bca" / "cab")
```

### 2.4 left跳变的单调性证明

```
关键性质: left 指针只增不减

证明: 假设当前 left = L, right = R, 字符 s[R] 在位置 P (P < R) 出现过

Case 1: P >= L (重复字符在当前窗口内)
    → left 更新为 P+1 > L ✓ (left增大)

Case 2: P < L (重复字符已被移出窗口)
    → left = max(L, P+1) = L (left不变) ✓

∴ left 单调递增 → 每个字符最多被 left 和 right 各访问一次 → O(n)
```

---

## 三、完整代码

### 3.1 Python 实现

#### 版本一：经典版（一次遍历字符串）

```python
def length_of_longest_substring(s: str) -> int:
    """
    LeetCode 3: 无重复字符的最长子串
    双指针 + HashMap，O(n) 时间，O(min(n, charset)) 空间
    """
    char_index = {}       # 字符 → 最后出现的索引
    left = 0
    max_len = 0

    for right, char in enumerate(s):
        # 如果字符已在窗口内出现，左指针跳过它
        if char in char_index and char_index[char] >= left:
            left = char_index[char] + 1

        # 更新字符的最新位置
        char_index[char] = right

        # 更新最大长度
        current_len = right - left + 1
        max_len = max(max_len, current_len)

    return max_len


# 测试
if __name__ == "__main__":
    assert length_of_longest_substring("abcabcbb") == 3
    assert length_of_longest_substring("bbbbb") == 1
    assert length_of_longest_substring("pwwkew") == 3
    assert length_of_longest_substring("") == 0
    assert length_of_longest_substring(" ") == 1
    assert length_of_longest_substring("dvdf") == 3
    print("All tests passed!")
```

#### 版本二：流式处理版（支持无限字符流）

```python
from typing import Dict


class SlidingWindowStreamer:
    """
    流式处理器：字符逐个流入，实时查询当前最长不重复子串长度。

    每次 add(char) 操作 O(1)
    每次 query() 操作 O(1)

    适用于：日志流、网络数据流、实时分析等场景
    """

    def __init__(self):
        self._char_last_pos: Dict[str, int] = {}  # 字符 → 最后出现的全局索引
        self._left: int = 0          # 窗口左边界（全局索引）
        self._right: int = -1        # 窗口右边界（全局索引）
        self._max_len: int = 0       # 历史最大不重复子串长度

    def add(self, char: str) -> int:
        """
        流入一个字符，返回更新后的最长不重复子串长度。
        时间复杂度: O(1)
        """
        self._right += 1  # 全局索引递增

        # 检查字符是否在当前窗口内重复
        if char in self._char_last_pos and self._char_last_pos[char] >= self._left:
            # left 跳到重复字符上次出现位置 + 1
            self._left = self._char_last_pos[char] + 1

        # 更新字符位置
        self._char_last_pos[char] = self._right

        # 更新最大长度
        current_window_len = self._right - self._left + 1
        self._max_len = max(self._max_len, current_window_len)

        return self._max_len

    def query(self) -> int:
        """查询当前历史最长不重复子串长度。O(1)"""
        return self._max_len

    def current_window_length(self) -> int:
        """查询当前窗口的不重复子串长度（不一定是历史最大）。O(1)"""
        return self._right - self._left + 1 if self._right >= self._left else 0


# ===== 流式处理演示 =====
if __name__ == "__main__":
    stream = SlidingWindowStreamer()

    print("字符流处理过程:")
    print(f"{'流入字符':<10} {'当前窗口长度':<15} {'历史最大长度'}")
    print("-" * 45)

    for char in "abcabcbb":
        max_len = stream.add(char)
        print(f"  '{char}'        {stream.current_window_length():<15} {max_len}")

    print(f"\n最终结果: 最长不重复子串长度 = {stream.query()}")

    # 输出:
    # 字符流处理过程:
    # 流入字符     当前窗口长度     历史最大长度
    # ---------------------------------------------
    #   'a'        1               1
    #   'b'        2               2
    #   'c'        3               3
    #   'a'        3               3
    #   'b'        3               3
    #   'c'        3               3
    #   'b'        2               3
    #   'b'        1               3
    #
    # 最终结果: 最长不重复子串长度 = 3
```

### 3.2 Java 实现

#### 版本一：经典版（一次遍历字符串）

```java
import java.util.HashMap;
import java.util.Map;

public class LongestSubstringWithoutRepeating {

    /**
     * LeetCode 3: 无重复字符的最长子串
     * 双指针 + HashMap
     * 时间复杂度: O(n)
     * 空间复杂度: O(min(n, charset))
     */
    public static int lengthOfLongestSubstring(String s) {
        if (s == null || s.isEmpty()) {
            return 0;
        }

        Map<Character, Integer> charIndex = new HashMap<>();
        int left = 0;
        int maxLen = 0;

        for (int right = 0; right < s.length(); right++) {
            char c = s.charAt(right);

            // 如果字符已在窗口内出现，左指针跳过它
            if (charIndex.containsKey(c) && charIndex.get(c) >= left) {
                left = charIndex.get(c) + 1;
            }

            // 更新字符最新位置
            charIndex.put(c, right);

            // 更新最大长度
            maxLen = Math.max(maxLen, right - left + 1);
        }

        return maxLen;
    }

    public static void main(String[] args) {
        // 测试用例
        assert lengthOfLongestSubstring("abcabcbb") == 3 : "Test 1 failed";
        assert lengthOfLongestSubstring("bbbbb") == 1 : "Test 2 failed";
        assert lengthOfLongestSubstring("pwwkew") == 3 : "Test 3 failed";
        assert lengthOfLongestSubstring("") == 0 : "Test 4 failed";
        assert lengthOfLongestSubstring(" ") == 1 : "Test 5 failed";
        assert lengthOfLongestSubstring("dvdf") == 3 : "Test 6 failed";

        System.out.println("All tests passed!");
    }
}
```

#### 版本二：流式处理版（支持无限字符流）

```java
import java.util.HashMap;
import java.util.Map;

/**
 * 流式滑动窗口处理器
 *
 * 支持：
 * - add(char): O(1) 流入一个字符
 * - query():   O(1) 查询历史最长不重复子串长度
 *
 * 适用于：日志流、网络数据流、实时分析等场景
 */
public class SlidingWindowStreamer {

    private final Map<Character, Integer> charLastPos;  // 字符 → 最后出现的全局索引
    private int left;       // 窗口左边界
    private int right;      // 窗口右边界
    private int maxLen;     // 历史最大不重复子串长度

    public SlidingWindowStreamer() {
        this.charLastPos = new HashMap<>();
        this.left = 0;
        this.right = -1;
        this.maxLen = 0;
    }

    /**
     * 流入一个字符，返回更新后的最长不重复子串长度。
     * 时间复杂度: O(1)
     */
    public int add(char ch) {
        right++;  // 全局索引递增

        // 检查字符是否在当前窗口内重复
        if (charLastPos.containsKey(ch) && charLastPos.get(ch) >= left) {
            // left 跳到重复字符上次出现位置 + 1
            left = charLastPos.get(ch) + 1;
        }

        // 更新字符位置
        charLastPos.put(ch, right);

        // 更新最大长度
        int currentWindowLen = right - left + 1;
        maxLen = Math.max(maxLen, currentWindowLen);

        return maxLen;
    }

    /**
     * 查询当前历史最长不重复子串长度。O(1)
     */
    public int query() {
        return maxLen;
    }

    /**
     * 查询当前窗口的不重复子串长度（不一定是历史最大）。O(1)
     */
    public int currentWindowLength() {
        return right >= left ? right - left + 1 : 0;
    }

    // ===== 流式处理演示 =====
    public static void main(String[] args) {
        SlidingWindowStreamer stream = new SlidingWindowStreamer();
        String input = "abcabcbb";

        System.out.println("字符流处理过程:");
        System.out.printf("%-12s %-18s %s%n", "流入字符", "当前窗口长度", "历史最大长度");
        System.out.println("-".repeat(48));

        for (char ch : input.toCharArray()) {
            int maxLen = stream.add(ch);
            System.out.printf("  '%c'        %-18d %d%n",
                    ch, stream.currentWindowLength(), maxLen);
        }

        System.out.printf("%n最终结果: 最长不重复子串长度 = %d%n", stream.query());
    }
}
```

---

## 四、复杂度分析

### 4.1 时间复杂度

| 版本 | add操作 | query操作 | 总体 |
|------|---------|-----------|------|
| 经典版 | — | — | O(n)，n为字符串长度 |
| 流式版 | O(1) | O(1) | O(1) per char |

```
关键分析:
  · right 指针遍历整个字符串一次: O(n)
  · left 指针只增不减，最多移动 n 次: O(n)
  · HashMap 查找/插入均摊: O(1)
  · 总计: O(n)

  注意: left 不是每次 right+1 都移动，
        而是遇到重复时直接"跳变"，所以均摊 O(1)
```

### 4.2 空间复杂度

```
HashMap 最多存储 min(n, |Σ|) 个条目
  · n = 字符串长度
  · |Σ| = 字符集大小 (ASCII=128, Unicode=远大于此)

对于 ASCII 字符集: O(128) = O(1)
对于 Unicode:      O(min(n, |Σ|))
```

---

## 五、ASCII 图解汇总

### 5.1 滑动窗口机制

```
                    HashMap (char → last_index)
                   ┌────────────────────────┐
                   │  'a' → 3               │
                   │  'b' → 4               │
                   │  'c' → 5               │
                   └────────────────────────┘
                              │
                              │ 查询 s[right] 是否在 [left, right] 内
                              ▼
    ┌───┬───┬───┬───┬───┬───┬───┬───┐
    │ . │ . │ . │ a │ b │ c │ b │ b │
    └───┴───┴───┴───┴───┴───┴───┴───┘
                  ↑           ↑
                left        right
                 │           │
                 └─── 窗口 ──┘
                 (保证窗口内无重复字符)

    当 right 遇到 'b' (已在位置4):
    left = 4 + 1 = 5  →  新窗口 [5, 6] = "cb"
```

### 5.2 left 跳变 vs 朴素移动

```
朴素方式 (O(n²)):
    left 逐个右移，每次重新检查窗口
    ┌───────────────────────────────┐
    │ [a b c] a b c b b             │  ← 检查
    │  a [b c] a b c b b            │  ← 检查
    │  a  b [c] a b c b b           │  ← 检查
    │  a  b  c [a] b c b b  ← 找到! │
    └───────────────────────────────┘

优化方式 (O(n)):
    left 直接跳到 char_last_pos['a'] + 1
    ┌───────────────────────────────┐
    │ [a  b  c] a b c b b           │  ← 遇到重复
    │        ↓ left直接跳           │
    │  a  b  c [a] b c b b  ← 一步! │
    └───────────────────────────────┘
```

---

## 六、边界情况与Follow-up

### 6.1 边界情况

```python
# 1. 空字符串
assert length_of_longest_substring("") == 0

# 2. 单字符
assert length_of_longest_substring("a") == 1

# 3. 全部相同字符
assert length_of_longest_substring("aaaa") == 1

# 4. 全部不同字符
assert length_of_longest_substring("abcdef") == 6

# 5. 空格/特殊字符
assert length_of_longest_substring("  ") == 1      # 空格也算字符
assert length_of_longest_substring("!@#") == 3

# 6. Unicode字符
assert length_of_longest_substring("你好你好") == 2
```

### 6.2 Follow-up: 返回所有最长不重复子串

```python
def all_longest_substrings(s: str) -> list[str]:
    """返回所有最长不重复子串"""
    char_index = {}
    left = 0
    max_len = 0
    results = []

    for right, char in enumerate(s):
        if char in char_index and char_index[char] >= left:
            left = char_index[char] + 1
        char_index[char] = right

        current_len = right - left + 1
        if current_len > max_len:
            max_len = current_len
            results = [s[left:right + 1]]  # 重置结果
        elif current_len == max_len:
            results.append(s[left:right + 1])  # 追加

    # 去重
    return list(dict.fromkeys(results))

# "abcabcbb" → ["abc", "bca", "cab"]
```

### 6.3 Follow-up: 固定窗口大小为K的最长不重复子串

```python
from collections import Counter

def longest_substring_k_distinct(s: str, k: int) -> int:
    """最多包含K个不同字符的最长子串（变体题型）"""
    if k == 0:
        return 0
    counter = Counter()
    left = 0
    max_len = 0

    for right, char in enumerate(s):
        counter[char] += 1
        while len(counter) > k:
            counter[s[left]] -= 1
            if counter[s[left]] == 0:
                del counter[s[left]]
            left += 1
        max_len = max(max_len, right - left + 1)

    return max_len
```

---

## 七、面试技巧总结

```
┌──────────────────────────────────────────────────────────┐
│                   面试回答框架                              │
│                                                            │
│  ① 讲思路 (30秒)                                          │
│     "用滑动窗口+HashMap，左右双指针维护不重复区间，          │
│      HashMap记录字符最后位置，遇到重复时左指针直接跳变，      │
│      时间O(n)，空间O(charset)"                             │
│                                                            │
│  ② 画图 (30秒)                                             │
│     在纸上/白板画一个数组，标出left/right指针移动过程         │
│                                                            │
│  ③ 写代码 (3-5分钟)                                        │
│     注意边界: 空字符串、单字符、全相同                       │
│     注意: left = max(left, char_pos+1) 的单调性             │
│                                                            │
│  ④ 分析复杂度 (30秒)                                       │
│     时间O(n): 每个字符最多被访问2次(left+right各一次)        │
│     空间O(min(n, charset))                                 │
│                                                            │
│  ⑤ Follow-up准备                                          │
│     · 流式处理: 封装成类，add/query接口                     │
│     · 返回子串本身: 用数组记录所有max_len对应的子串           │
│     · K个不同字符变体: Counter + 收缩窗口                   │
│     · 字符集优化: 用int[128]代替HashMap(ASCII场景)          │
└──────────────────────────────────────────────────────────┘
```

核心要点：**滑动窗口 + HashMap = O(n) 最优解**。面试中先讲清「left跳变」的单调性原理，再快速写出无Bug代码，最后主动提Follow-up展示深度。

## 记忆要点

- 核心模型：双指针+HashMap。因为需实时O(1)操作，所以HashMap记录字符最后一次出现的位置。
- 左边界单调右移：遇重复时直接跳过，公式为 left = max(left, map[char]+1)。
- 右边界逐个扩展：每流入一个新字符，即计算并更新最大窗口长度。
- 空间换时间：时间复杂度O(1)每次操作，空间复杂度O(字符集大小)。


## 苏格拉底式面试追问

> 这组追问模拟面试官层层逼问，每一问先回答"为什么"，再回答"怎么做"，最后回答"如何证明"。

### 第一层：目标与动机

**Q：求最长无重复子串，你为什么选滑动窗口而不是 DP 或暴力两重循环？**

暴力是 O(n²) 起步（每个起点扫到重复），DP 思路是 `dp[i]` 表示以 i 结尾的最长子串长度，但要依赖"上一次该字符出现的位置"，本质退化成滑动窗口。滑动窗口之所以最优，是因为它利用了"左边界单调右移"性质：当 right 扩展遇到重复字符 c 时，left 不需要回退试探所有可能，直接跳到 `map[c]+1` 即可——因为任何 left' < map[c]+1 的窗口里 c 都重复。这把每个字符最多被左右指针各访问一次，总时间 O(2n)=O(n)。选滑动窗口是因为题目有"连续子串 + 单调性"两个特征，这是它的标准应用场景。

### 第二层：证据与定位

**Q：你说 left 单调右移，怎么证明 left = max(left, map[c]+1) 这一步不会漏解？**

反证法。设最优解的窗口是 [left*, right]，在 right 位置遇到重复字符 c，c 上次出现在 pos。如果 left* < pos+1，那么 [left*, right] 区间内 c 出现了至少两次（在 pos 和 right 两处），与"无重复"矛盾。所以任何合法解的左边界必须 ≥ pos+1。同时左边界不能回退（否则之前已经检查过的更小窗口被重复扫），所以 `left = max(left, pos+1)`。这个 max 的两个参数分别保证"不漏解"（取 pos+1 保证合法）和"不重复"（取原 left 保证单调）。这是滑动窗口正确性的核心不变式。

### 第三层：根因深挖

**Q：你的滑动窗口用 HashMap，但面试官说"ASCII 场景下用 int[128] 更快"，根因是什么？**

根因是 HashMap 的装箱和哈希计算开销。Character 是包装类型，HashMap.get/put 要算 hashCode、比较 equals、可能触发扩容；而 int[128] 是原生数组，按 char 的 ASCII 值直接索引，CPU 缓存命中率高、零装箱、零哈希。LeetCode 实测 int[128] 版本比 HashMap 快 3-5 倍。但局限是：只适用于字符集固定且小（ASCII 128、扩展 ASCII 256、Unicode BMP 65536），如果字符是任意 Unicode（含 emoji、中日韩），数组就要开到几十万、内存爆炸，这时 HashMap 更优。所以"用什么存字符位置"取决于字符集大小，不是无脑 HashMap。

**Q：那为什么不直接用 HashSet 记录窗口内字符，遇到重复就移除？**

也可以（LeetCode 官方题解有这种写法），但性能更差。Set 方案在遇到重复时，要 `while` 循环从 left 开始逐个 remove 直到把重复字符移走，最坏情况 left 到 right 之间所有字符都要被删一次（虽然均摊还是 O(n)）。而 HashMap 方案记录了每个字符的"最后位置"，遇到重复直接 `left = map[c]+1` 一步跳过去，不需要 while 收缩。Set 方案代码稍简单但常数更大，HashMap 方案是"空间换常数"的最优解。面试中推荐 HashMap，因为它体现了对"信息充分利用"的理解。

### 第四层：方案权衡

**Q：题目要返回最长长度，如果改成返回最长子串本身（可能有多个），你的方案怎么改？**

加一个变量 `start` 记录最优窗口的起始位置，每次 `right-left+1 > maxLen` 时更新 `maxLen` 和 `start`。最后返回 `s.substring(start, start+maxLen)`。如果要返回所有等长子串，用 List 收集所有 `right-left+1 == maxLen` 的区间。这个改动的代价是 O(1) 额外空间（单个）或 O(k) 额外空间（k 个等长解），不影响主复杂度。权衡点：如果面试官要"返回子串"，别用"记录所有候选再筛"的笨办法，直接在更新 maxLen 时同步记录 start，这是最优解的延伸。

**Q：为什么不直接用 KMP 或后缀数组解决？它们不是处理字符串的经典工具吗？**

杀鸡用牛刀。KMP 解决的是"模式串匹配"，核心是 next 数组处理失配回溯，跟"无重复子串"无关。后缀数组解决的是"最长重复子串"（注意是重复，不是无重复），构造复杂度 O(n log n) 还要写 SA-IS 算法，代码上百行。滑动窗口 O(n) 20 行搞定，且语义直接对应问题。工具选择的原则：用最简单的能解决问题的结构，不要为了显得"高级"而堆算法。KMP 和后缀数组在它们的场景里不可替代，但在这个题里是负优化。

### 第五层：验证与沉淀

**Q：你怎么验证滑动窗口实现覆盖了所有边界 case？**

枚举 6 类用例：① 空字符串 ""→0；② 单字符 "a"→1；③ 全相同 "aaaa"→1；④ 全不同 "abcdef"→6；⑤ 中间有重复 "abcabcbb"→3（标准样例）；⑥ Unicode 字符 "你好你好"→2。每一类对应一个边界：空串测 left/right 初值、单字符测循环边界、全相同测 left 跳变逻辑、Unicode 测 HashMap 对非 ASCII 的处理。这 6 类覆盖了 95% 的边界，剩下 5% 用对拍——随机生成 1000 个长度≤20 的字符串，跟暴力 O(n²) 解逐个对比。

**Q：这道题沉淀出了什么可复用的滑动窗口模板？**

模板固化成"双指针 + 窗口状态 + 收缩条件"三要素：① right 指针逐个扩展窗口；② 维护窗口状态（HashMap 记字符频次或位置、Counter 记元素计数）；③ 当窗口不合法时（出现重复/超过 K 个不同字符/和超过 target）收缩 left。三类变体：固定窗口（right-left 恒等）、可变窗口求最大（不合法才收缩）、可变窗口求最小（合法才停止收缩）。无重复子串属于第二类，最小覆盖子串属于第三类，找字串异位词属于第一类，套模板都能秒杀。


## 结构化回答

**30 秒电梯演讲：** 用双指针维护滑动窗口+HashMap记录字符最后出现位置，O(n)时间复杂度。打个比方，就像排队买票——窗口是当前不重复的人，新来的人如果和队列里的人重号，就从重号的人后面截断队列。

**展开框架：**
1. **核心模型** — 双指针+HashMap。因为需实时O(1)操作，所以HashMap记录字符最后一次出现的位置。
2. **左边界单调右移** — 遇重复时直接跳过，公式为 left = max(left, map[char]+1)。
3. **右边界逐个扩展** — 每流入一个新字符，即计算并更新最大窗口长度。

**收尾：** 这块我踩过坑——要不要深入聊：如果是字符串流(无限输入)怎么处理？

## 视频脚本

> 预计时长：2 分钟 | 由浅入深

| 时间 | 画面/字幕 | 口播台词 | 讲解要点 |
|------|----------|----------|----------|
| 0:00 | 标题卡 | "滑动窗口一句话：用双指针维护滑动窗口+HashMap记录字符最后出现位置，O(n)时间复杂度。" | 开场钩子 |
| 0:15 | 架构示意图 | "核心模型：双指针+HashMap。因为需实时O(1)操作，所以HashMap记录字符最后一次出现的位置。" | 核心模型 |
| 1:02 | 架构示意图分步演示 | "左边界单调右移：遇重复时直接跳过，公式为 left 就是 max(left, map[char]+1)。" | 左边界单调右移 |
| 1:50 | 总结卡 | "核心抓住这条主线，下期咱们接着聊：如果是字符串流(无限输入)怎么处理。" | 收尾 |
