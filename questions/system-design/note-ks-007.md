---
id: note-ks-007
difficulty: L3
category: system-design
subcategory: 算法
tags:
- 快手
- Java开发
- 一面
- 场景题
- 布隆过滤器
- 大数据处理
- 位图
- 面经
feynman:
  essence: 10亿昵称去重且内存限制1GB，核心方案是布隆过滤器(Bloom Filter)。10亿数据 × 每个元素约1.2字节(最优参数) ≈ 1.2GB，用1GB可以通过分治+布隆过滤器实现：按哈希分文件 → 每个文件用布隆过滤器去重 → 合并结果。或者用Bitmap+哈希压缩。
  analogy: "10亿人查重名且只有一个小房间(1GB)——(1)布隆过滤器就像一个超大的'指纹登记本'：不需要存每个人的名字，只需记录'这个名字的指纹是否存在过'。用几个哈希函数算出位置打勾，查重时看这些位置是否都打了勾。(2)如果登记本也放不下 → 分成几个小房间(分治)，每个房间处理一部分人。"
  key_points:
  - 布隆过滤器：k个哈希函数 + 位数组，空间O(n×m bits)，假阳性率可控
  - 10亿数据1GB：每个元素约1 byte，1GB=10亿byte → 刚好够用（低误判率）
  - 分治+哈希：按hash(name)分N个文件 → 每个文件独立去重 → 合并
  - Bitmap方案：如果昵称可以映射为整数ID，用BitSet去重(每个元素1 bit)
first_principle:
  essence: 去重 = 在有限空间内判断"是否出现过"
  derivation: "精确去重需要存储所有元素 → 10亿×avg 10字节=100GB → 远超1GB。必须用概率数据结构：布隆过滤器只存'指纹'(位图)，不存原始数据 → 空间O(n) bytes而非O(n×avg_string_length)。"
  conclusion: 布隆过滤器是内存受限场景下大数据去重的最优解。1GB可存10亿元素，误判率约1-3%
follow_up:
- 布隆过滤器的假阳性率如何计算？如何选择最优k值？
- 如何删除布隆过滤器中的元素？Counting Bloom Filter是什么？
- 如果要求100%精确去重（零误判），1GB够吗？
- 除了布隆过滤器，还有哪些概率数据结构？（HyperLogLog/CuckooFilter/SkipList）
- 分布式场景下如何做去重？
memory_points:
- 布隆过滤器：k个哈希函数映射到位数组的k个位置，全为1=可能存在，有0=一定不存在
- 10亿元素1GB：m=80亿bits=1GB, k=7, 假阳性率≈2.5%
- 分治法：hash(name)%N分N个文件→每个文件独立布隆过滤器→合并
- 精确去重1GB不够：10亿×10字节=100GB，必须用概率结构或外部排序
---

# 【快手Java一面】10亿用户昵称去重，内存限制1GB？

> 来源：快手Java开发一面场景题复盘（小红书）

## 一、问题分析

```
输入：10亿个用户昵称（字符串）
限制：内存1GB
目标：找出重复的昵称

数据量分析：
  10亿昵称 × 平均10字节 = 100亿字节 ≈ 10GB
  → 全部放内存：10GB >> 1GB ❌

  HashSet方式：10亿 × (10字节 + 指针开销) ≈ 50GB
  → 完全不可能 ❌
```

## 二、方案一：布隆过滤器（推荐）

### 布隆过滤器原理

```
Bloom Filter = 位数组 + k个哈希函数

  位数组 (m bits):
  ┌──┬──┬──┬──┬──┬──┬──┬──┬──┬──┬──┬──┬──┬──┬──┐
  │0 │0 │0 │0 │0 │0 │0 │0 │0 │0 │0 │0 │0 │0 │0 │
  └──┴──┴──┴──┴──┴──┴──┴──┴──┴──┴──┴──┴──┴──┴──┘
   0  1  2  3  4  5  6  7  8  9  10 11 12 13 14

  添加 "张三"：
    h1("张三") = 3   → bit[3] = 1
    h2("张三") = 7   → bit[7] = 1
    h3("张三") = 12  → bit[12] = 1

  查询 "李四"是否重复：
    h1("李四") = 3   → bit[3] = 1 ✓
    h2("李四") = 5   → bit[5] = 0 ✗ → "李四"一定不存在！

  查询 "王五"是否重复：
    h1("王五") = 3   → bit[3] = 1 ✓
    h2("王五") = 7   → bit[7] = 1 ✓
    h3("王五") = 12  → bit[12] = 1 ✓
    → 全为1 → "王五"可能存在（也可能是误判）
```

### 参数计算

```
n = 10亿 (元素数量)
m = 80亿 bits = 1GB (位数组大小)
k = ? (哈希函数个数)

最优k = (m/n) × ln(2) = (80亿/10亿) × 0.693 ≈ 5.5 → 取k=6

假阳性率 p = (1 - e^(-kn/m))^k
  = (1 - e^(-6×10亿/80亿))^6
  = (1 - e^(-0.75))^6
  = (1 - 0.472)^6
  = 0.528^6
  ≈ 2.2%

结论：
  ✅ 1GB内存可以装下10亿元素的布隆过滤器
  ⚠️ 假阳性率约2.2%（100个"重复"判断中有2个是误报）
  ❓ 但不会漏报（不存在说"不存在"但实际存在的情况）
```

### 代码实现

```java
public class BloomFilterDedup {

    private final BitSet bitSet;
    private final int size;          // 位数组大小
    private final int hashCount;     // 哈希函数个数

    // 六个不同的哈希种子
    private final int[] seeds = {3, 7, 11, 13, 31, 37};

    public BloomFilterDedup(int expectedElements, double falsePositiveRate) {
        // 计算最优参数
        this.size = optimalBits(expectedElements, falsePositiveRate);
        this.hashCount = optimalHashes(expectedElements, size);
        this.bitSet = new BitSet(size);
    }

    public void add(String nickname) {
        for (int seed : seeds) {
            int hash = hash(nickname, seed);
            bitSet.set(Math.abs(hash % size));
        }
    }

    public boolean mightContain(String nickname) {
        for (int seed : seeds) {
            int hash = hash(nickname, seed);
            if (!bitSet.get(Math.abs(hash % size))) {
                return false;  // 一定不存在
            }
        }
        return true;  // 可能存在（有误判率）
    }

    // 去重主流程
    public Set<String> findDuplicates(List<String> nicknames) {
        Set<String> duplicates = new HashSet<>();
        for (String name : nicknames) {
            if (mightContain(name)) {
                // 布隆过滤器说可能重复 → 二次确认（精确判断）
                duplicates.add(name);
            } else {
                add(name);
            }
        }
        return duplicates;
    }
}
```

### 处理误判：二次确认

```
布隆过滤器有假阳性 → 需要"二次确认"：

  布隆过滤器说"可能重复" (2.2%)
       │
       ├── 如果需要精确结果：
       │   → 把这些"疑似重复"的昵称存入精确集合(HashSet)
       │   → 再做一次精确比较
       │   → 疑似重复约2.2%×10亿=2200万 → 可放内存
       │
       └── 如果可以容忍少量误判：
           → 直接使用布隆过滤器结果（省时省力）
```

## 三、方案二：分治 + 哈希

```
如果1GB连布隆过滤器都不够（或需要精确去重）：

  10亿昵称文件
       │
       ▼
  ┌──────────────────────────┐
  │ Step 1: 按哈希分文件      │
  │                          │
  │ hash(name) % 100         │
  │ → 分成100个小文件          │
  │ → 每个文件约1000万昵称     │
  │ → 每个文件约100MB          │
  └────────────┬─────────────┘
               │
  ┌────────────▼─────────────┐
  │ Step 2: 逐个文件处理       │
  │                          │
  │ 对每个小文件：             │
  │ → 读入内存(100MB < 1GB)   │
  │ → HashSet去重             │
  │ → 输出重复昵称             │
  │ → 清空内存，处理下一个      │
  └────────────┬─────────────┘
               │
  ┌────────────▼─────────────┐
  │ Step 3: 合并结果           │
  │                          │
  │ 100个文件的重复结果合并     │
  │ → 最终的去重列表            │
  └──────────────────────────┘

  时间复杂度：O(N) 读文件 + O(N) 哈希 + O(N/100) 去重
  空间复杂度：O(N/100) ≈ 100MB（远小于1GB）
```

```java
// 分治去重实现
public Set<String> dedupByPartition(String inputFile, int partitions) throws IOException {
    Set<String> allDuplicates = new HashSet<>();

    // Phase 1: 分文件
    List<BufferedWriter> writers = new ArrayList<>();
    for (int i = 0; i < partitions; i++) {
        writers.add(new BufferedWriter(new FileWriter("/tmp/part-" + i + ".txt")));
    }

    try (BufferedReader reader = new BufferedReader(new FileReader(inputFile))) {
        String line;
        while ((line = reader.readLine()) != null) {
            int part = Math.abs(line.hashCode() % partitions);
            writers.get(part).write(line + "\n");
        }
    }

    // Phase 2: 逐文件去重
    for (int i = 0; i < partitions; i++) {
        writers.get(i).close();

        Set<String> seen = new HashSet<>();
        Set<String> dups = new HashSet<>();

        try (BufferedReader reader = new BufferedReader(
                new FileReader("/tmp/part-" + i + ".txt"))) {
            String line;
            while ((line = reader.readLine()) != null) {
                if (seen.contains(line)) {
                    dups.add(line);
                } else {
                    seen.add(line);
                }
            }
        }
        allDuplicates.addAll(dups);
        seen.clear();  // 释放内存
    }

    return allDuplicates;
}
```

## 四、方案对比

| 方案 | 空间 | 时间 | 精确性 | 复杂度 | 适用场景 |
|------|------|------|--------|--------|---------|
| **布隆过滤器** | O(n) bytes | O(n×k) | 概率性(2%误判) | 低 | 近似去重 |
| **分治+哈希** | O(n/p) | O(n) + IO | 精确 | 中 | 精确去重 |
| **Bitmap** | O(max_id) bits | O(n) | 精确 | 低 | 可映射为整数 |
| **外部排序** | O(1) | O(n log n) | 精确 | 高 | 全排序需求 |

## 五、面试加分点

1. **提到Counting Bloom Filter**：标准布隆过滤器不能删除元素，CBF用计数器替代位，支持删除（但空间增加4-8倍）
2. **提到Cuckoo Filter**：布隆过滤器的替代品，支持删除，查询更快，在低假阳性率下空间更省
3. **提到Redis Bitmap**：如果用Redis的SETBIT/GETBIT命令，可以在分布式环境下做去重，单机内存+网络通信
4. **提到Google Guava BloomFilter**：`BloomFilter.create(Funnels.stringFunnel(), 10_0000_0000, 0.01)` 一行代码创建，生产可用
5. **提到HyperLogLog**：如果只需要知道"有多少个不同的昵称"（基数），不需要知道具体是哪些，用HLL只需12KB就能估算10亿数据的基数
