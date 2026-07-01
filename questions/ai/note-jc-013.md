---
id: note-jc-013
difficulty: L2
category: ai
subcategory: 算法
tags:
- 阶跃星辰
- 面经
- 排序
- 时间复杂度
- 快速排序
feynman:
  essence: 常见排序复杂度——冒泡/选择/插入 O(n²)（简单但慢），归并/快排/堆排 O(nlogn)（高效），桶排/计数 O(n+k)（线性但受限）。快排原理：选基准(pivot)，比它小的放左大的放右，递归排两边。最坏 O(n²) 出现在每次 pivot 都选到极值（已序数组选首/尾）。实际很少触发最坏因为①随机选 pivot ②实际数据分布让极值概率低 ③三数取中法避免。平均 O(nlogn)。
  analogy: 快排像整理书架——随便抽一本书当标准（pivot），比它矮的放左边高的放右边，然后左右两边各再抽一本当标准继续分。最坏情况是书已经按高矮排好了你每次抽第一本（永远是当前最矮），就只能一本本挪 O(n²)。随机抽就不容易遇到这种情况。
  first_principle: 快排基于分治——选 pivot 把问题分成两个子问题。理想情况 pivot 是中位数（每次分两半，O(nlogn)）；最坏 pivot 是极值（每次分 1 和 n-1，O(n²)）。
  key_points:
  - 冒泡/选择/插入 O(n²)；归并/快排/堆排 O(nlogn)；桶排/计数 O(n+k)
  - '快排: 选pivot，小左大右，递归两边'
  - '最坏 O(n²): 每次pivot选到极值（已序+选首尾）'
  - '实际少触发: 随机pivot/三数取中/数据分布'
  - 平均 O(nlogn)，原地排序，缓存友好
first_principle:
  essence: 快排 = 分治 + pivot 划分
  derivation: 选pivot → 划分（小左大右）→ 递归 → 理想pivot=中位数每次对半切O(nlogn) → 最坏pivot=极值每次切1和n-1退化O(n²)
  conclusion: 快排平均快但最坏慢，工程上用随机化避免最坏
follow_up:
- 快排为什么平均 O(n log n)？
- 快排 vs 归并哪个更好？
- 三数取中法怎么实现？
memory_points:
- 口诀记忆：选插冒 O(n²)，归排 O(n logn)；快排均 O(nlogn) 坏 O(n²)
- 快排三步：选基准 pivot，小于放左大于放右，递归排两边
- 最坏情况：已排序数组选首尾极值导致划分极度不均，退化为 O(n²)
- 优化最坏：随机选 pivot 或三数取中法，避免极端不平衡划分
---

# 【阶跃星辰面经】排序算法时间复杂度 + 快排原理与最坏情况

## 一、常见排序复杂度总览

| 算法 | 平均 | 最坏 | 空间 | 稳定 | 特点 |
|------|------|------|------|------|------|
| 冒泡 | O(n²) | O(n²) | O(1) | ✅ | 简单，基本不用 |
| 选择 | O(n²) | O(n²) | O(1) | ❌ | 交换次数少 |
| 插入 | O(n²) | O(n²) | O(1) | ✅ | 小数据/近乎有序快 |
| 归并 | O(nlogn) | O(nlogn) | O(n) | ✅ | 稳定，需额外空间 |
| **快排** | **O(nlogn)** | **O(n²)** | O(logn) | ❌ | **最快，原地** |
| 堆排 | O(nlogn) | O(nlogn) | O(1) | ❌ | 原地，但缓存不友好 |
| 桶排 | O(n+k) | O(n²) | O(n+k) | ✅ | 数据均匀时线性 |
| 计数 | O(n+k) | O(n+k) | O(k) | ✅ | 整数且范围小 |

## 二、快排原理

```
快速排序（分治）：
  1. 选基准 pivot（如最后一个元素）
  2. 划分：比 pivot 小的放左，大的放右
  3. 递归排左半 + 递归排右半

def quicksort(arr, low, high):
    if low < high:
        pi = partition(arr, low, high)  # 划分，返回 pivot 最终位置
        quicksort(arr, low, pi - 1)     # 排左半
        quicksort(arr, pi + 1, high)    # 排右半

def partition(arr, low, high):
    pivot = arr[high]           # 选最后元素为 pivot
    i = low - 1                 # i 是"小于区"的右边界
    for j in range(low, high):
        if arr[j] <= pivot:
            i += 1
            arr[i], arr[j] = arr[j], arr[i]  # 交换到小于区
    arr[i+1], arr[high] = arr[high], arr[i+1]  # pivot 放到中间
    return i + 1
```

**划分过程示意**：
```
原数组: [3, 6, 8, 10, 1, 2, 1]  pivot=1(最后)
划分后: [1, 1, | 6, 8, 10, 2, 3]
         ↑↑    pivot位置
         小于等于  大于
```

## 三、为什么平均 O(n log n)

```
理想情况：每次 pivot 恰好是中位数
  第1次划分：O(n)，分成两个 n/2 子问题
  第2次划分：2 × O(n/2) = O(n)，分成四个 n/4
  ...
  共 log n 层，每层 O(n)
  → 总 O(n log n)

概率分析：即使 pivot 不是完美中位数，只要分得不极端（如 1:9 划分），期望仍是 O(n log n)。
```

## 四、最坏情况 O(n²)：什么时候触发

```
最坏：每次 pivot 都选到极值（最大或最小）
  → 每次划分成 1 和 n-1（一边空）
  → 递归深度 n，每次 O(n)
  → 总 O(n²)

触发场景：
  1. 已排序数组 + 选首/尾为 pivot
     [1,2,3,4,5] 选 5(尾) → 分成 [1,2,3,4] 和 []
     递归 [1,2,3,4] 选 4 → [1,2,3] 和 []
     → 每次只减1，O(n²)

  2. 逆序数组同理

  3. 所有元素相同（某些实现会退化）
```

## 五、为什么实际很少触发最坏

### 原因1：随机化 pivot
```python
import random
def partition_random(arr, low, high):
    rand_idx = random.randint(low, high)  # 随机选
    arr[rand_idx], arr[high] = arr[high], arr[rand_idx]  # 换到末尾
    # ... 正常划分
```
随机选 pivot 让"每次都极值"的概率极低（n 个里只有 2 个极值，概率 2/n）。

### 原因2：三数取中法（median-of-three）
```python
def median_of_three(arr, low, high):
    mid = (low + high) // 2
    # 取首/中/尾的中位数做 pivot
    candidates = [(arr[low], low), (arr[mid], mid), (arr[high], high)]
    candidates.sort()
    pivot_idx = candidates[1][1]  # 中位数的位置
    arr[pivot_idx], arr[high] = arr[high], arr[pivot_idx]
```
三数取中让"选到极值"几乎不可能，工业实现标配。

### 原因3：实际数据分布
- 真实数据很少完全有序（除非是已排序数据的再排序）
- 即使部分有序，随机化也能避免

### 原因4：工程实现优化
- 小数组切到插入排序（n < 10 时插入更快）
- 双轴快排（Java 的 Arrays.sort）：两个 pivot 分三区，更快

## 六、快排 vs 归并

| 维度 | 快排 | 归并 |
|------|------|------|
| 平均 | O(nlogn) | O(nlogn) |
| 最坏 | **O(n²)** | **O(nlogn)**（稳） |
| 空间 | O(logn)（原地） | O(n)（需额外） |
| 稳定 | ❌ | ✅ |
| 实际速度 | **更快**（缓存友好） | 较慢 |
| 适合 | 内存排序 | 外部排序/链表 |

**快排实际更快的原因**：原地排序缓存命中率高，常数小。

## 七、加分点

- 说出 **快排最坏 O(n²) 是已序数据 + 选首尾 pivot**
- 说出 **三数取中 + 随机化避免最坏**
- 说出 **快排实际比归并快因为缓存友好**（原地，数据局部性好）

## 八、雷区

- ❌ "快排最坏 O(nlogn)" → 最坏 O(n²)
- ❌ "快排稳定" → 不稳定（交换可能改变相等元素相对顺序）
- ❌ "快排需要 O(n) 额外空间" → 原地，只需 O(logn) 递归栈

## 九、扩展

- **IntroSort**（内省排序）：快排 + 堆排 + 插入排序的混合，STL 的 std::sort 实现，快排退化时自动切堆排保证 O(nlogn)
- **双轴快排**：Java Arrays.sort 用，两个 pivot 分三区，平均更快
- **快排的尾递归优化**：递归调用时先处理短的半边，最坏空间降到 O(logn)

## 记忆要点

- 口诀记忆：选插冒 O(n²)，归排 O(n logn)；快排均 O(nlogn) 坏 O(n²)
- 快排三步：选基准 pivot，小于放左大于放右，递归排两边
- 最坏情况：已排序数组选首尾极值导致划分极度不均，退化为 O(n²)
- 优化最坏：随机选 pivot 或三数取中法，避免极端不平衡划分

