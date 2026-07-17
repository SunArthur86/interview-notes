---
id: note-dd-lt-003
difficulty: L4
category: system-design
subcategory: 性能优化
tags:
- 滴滴
- 面经
- 抽奖系统
- O(1)
- 算法优化
- 空间换时间
feynman:
  essence: 将概率分布展开为静态查找表，用一次随机数取模即可确定中奖结果——O(1)复杂度。
  analogy: 就像彩票箱——你提前按1000张票放进去，抽奖时只随机摸一张就行。
  first_principle: 概率分布可以展开为离散数组：总概率100%映射到大小为N的数组。
  key_points:
  - 概率展开为数组
  - 随机数取模O(1)
  - 内存占用=N*sizeof(PrizeID)
  - 更新概率=重建数组
first_principle:
  essence: 空间换时间：用O(N)空间存储概率分布，换取O(1)的抽奖复杂度
  derivation: 原始方法：遍历所有奖品累加概率→O(K)→展开为数组→随机数%N→O(1)查找
  conclusion: 概率展开表是抽奖系统O(1)的银弹
follow_up:
- 数组大小N怎么选？1000够吗？
- 概率精度要求高时数组会很大吗？
- 有没有比展开表更省空间的O(1)方案？
memory_points:
- 核心对比：原算法需O(K)累加遍历前缀和，优化后变O(1)一步定位取模查表
- 一句话定义：概率展开为查找表，把各奖品按概率比例直接铺满数组槽位
- 口诀记流程：建表展开铺满，抽奖随机取模，一步直达结果
- 关键数字：表大小通常设10000，保证精度到万分位
- 极易踩坑：概率极小但非0的奖品，必须强制分配至少1个槽位防死局
---

# 【滴滴面经】你说用了空间换时间，把抽奖算法优化到了 O(1)，具体是怎么做的？

## 一、原始方法的瓶颈：O(K) 累加遍历

在说优化方案之前，先回顾一下最朴素的抽奖算法。假设有 K 个奖品，每个奖品有一个中奖概率，标准的做法是**累加概率前缀和 + 二分/线性查找**：

```java
// 原始 O(K) 抽奖
public Prize draw(List<Prize> prizes) {
    double rand = Math.random();          // [0, 1)
    double cumulative = 0;
    for (Prize prize : prizes) {           // 最多遍历 K 次
        cumulative += prize.probability;
        if (rand < cumulative) {
            return prize;
        }
    }
    return prizes.get(prizes.size() - 1);  // 兜底
}
```

每次抽奖需要做 **最多 K 次浮点加法和 K 次比较**，时间复杂度为 **O(K)**。当奖品数量不多（比如 K=10）时影响不大，但在高频抽奖场景（万级 QPS）下，每次多出的循环开销会被放大。

## 二、核心思想：概率展开为查找表

优化的核心思路非常直观——**用空间换时间**：

> 把概率分布「展开」为一个固定大小的数组，每个数组槽位存放对应的奖品 ID。抽奖时只需生成一个随机数，对数组长度取模，**一步定位**中奖结果。

### 2.1 彩票箱类比

想象一个彩票箱：如果一等奖 10%、二等奖 30%、三等奖 60%，你准备一个 100 格的箱子，往里面放：
- 10 张「一等奖」券
- 30 张「二等奖」券
- 60 张「三等奖」券

抽奖时，蒙眼随机摸一张，结果就出来了。**不需要遍历、不需要累加概率**，O(1) 完成。

### 2.2 数学等价性

设数组大小为 N，奖品 i 的概率为 p_i，则奖品 i 在数组中占据的槽位数为 `round(p_i × N)`。随机数 `r ∈ [0, N)` 取模后均匀落在数组的每个位置上，概率为 1/N。因此选中奖品 i 的概率为 `count_i / N ≈ p_i`，**精度取决于 N 的大小**。

## 三、完整 Java 代码实现

```java
import java.util.*;
import java.util.concurrent.ThreadLocalRandom;

/**
 * O(1) 抽奖引擎 —— 概率展开为查找表
 */
public class LotteryEngine {

    /** 默认展开表大小：10000，精度到万分位 */
    private static final int DEFAULT_TABLE_SIZE = 10_000;

    /** 展开后的查找表：table[i] = 奖品在该位置的概率占位 */
    private final int[] table;

    /** 奖品池：prizeId -> Prize 对象 */
    private final Map<Integer, Prize> prizeMap;

    /** 实际使用的表大小 */
    private final int tableSize;

    /**
     * 构造函数：根据奖品概率配置构建查找表
     */
    public LotteryEngine(List<Prize> prizes) {
        this(prizes, DEFAULT_TABLE_SIZE);
    }

    public LotteryEngine(List<Prize> prizes, int tableSize) {
        this.tableSize = tableSize;
        this.table = new int[tableSize];
        this.prizeMap = new HashMap<>();
        buildTable(prizes);
    }

    /**
     * 构建概率展开表 —— 核心方法
     * 将每个奖品的概率 × tableSize = 占据的槽位数，依次填入数组
     */
    private void buildTable(List<Prize> prizes) {
        // 1. 按概率从大到小排序（减少尾部误差）
        List<Prize> sorted = new ArrayList<>(prizes);
        sorted.sort((a, b) -> Double.compare(b.probability, a.probability));

        int index = 0;
        for (Prize prize : sorted) {
            prizeMap.put(prize.id, prize);

            // 该奖品应占据的槽位数
            int slots = (int) Math.round(prize.probability * tableSize);

            // 概率极低的奖品至少占 1 个槽位（保证非零概率奖品一定能被抽中）
            if (slots == 0 && prize.probability > 0) {
                slots = 1;
            }

            // 填充连续槽位
            for (int i = 0; i < slots && index < tableSize; i++) {
                table[index++] = prize.id;
            }
        }

        // 2. 处理剩余未填充的槽位（概率四舍五入导致的不满）
        //    全部填入概率最高的奖品（兜底）
        if (index < tableSize && !sorted.isEmpty()) {
            int fallbackPrizeId = sorted.get(0).id;
            while (index < tableSize) {
                table[index++] = fallbackPrizeId;
            }
        }
    }

    /**
     * O(1) 抽奖 —— 随机数取模直接定位
     */
    public Prize draw() {
        // ThreadLocalRandom 比 Math.random() 性能更好（无竞争）
        int randomIndex = ThreadLocalRandom.current().nextInt(tableSize);
        int prizeId = table[randomIndex];
        return prizeMap.get(prizeId);
    }

    /**
     * 批量抽奖：预生成随机数，减少随机数生成开销
     */
    public List<Prize> batchDraw(int count) {
        List<Prize> results = new ArrayList<>(count);
        ThreadLocalRandom random = ThreadLocalRandom.current();
        for (int i = 0; i < count; i++) {
            int prizeId = table[random.nextInt(tableSize)];
            results.add(prizeMap.get(prizeId));
        }
        return results;
    }

    /**
     * 奖品实体类
     */
    public static class Prize {
        int id;
        String name;
        double probability;

        public Prize(int id, String name, double probability) {
            this.id = id;
            this.name = name;
            this.probability = probability;
        }

        @Override
        public String toString() {
            return String.format("Prize{id=%d, name='%s', prob=%.4f}", id, name, probability);
        }
    }

    // ==================== 测试 ====================
    public static void main(String[] args) {
        List<Prize> prizes = Arrays.asList(
            new Prize(1, "iPhone",     0.01),   // 1%
            new Prize(2, "AirPods",    0.05),   // 5%
            new Prize(3, "优惠券",      0.30),   // 30%
            new Prize(4, "谢谢参与",    0.64)    // 64%
        );

        LotteryEngine engine = new LotteryEngine(prizes);

        // 模拟 100 万次抽奖，验证概率分布
        int N = 1_000_000;
        Map<Integer, Integer> counter = new HashMap<>();
        for (int i = 0; i < N; i++) {
            Prize result = engine.draw();
            counter.merge(result.id, 1, Integer::sum);
        }

        System.out.println("抽奖 " + N + " 次的结果分布：");
        for (Prize p : prizes) {
            int count = counter.getOrDefault(p.id, 0);
            double actualProb = (double) count / N;
            System.out.printf("  %-10s 期望: %.2f%%  实际: %.2f%%  (误差: %.4f%%)%n",
                p.name, p.probability * 100, actualProb * 100,
                Math.abs(actualProb - p.probability) * 100);
        }
    }
}
```

运行输出示例：
```
抽奖 1000000 次的结果分布：
  iPhone      期望: 1.00%  实际: 1.00%  (误差: 0.00%)
  AirPods     期望: 5.00%  实际: 5.00%  (误差: 0.01%)
  优惠券       期望: 30.00%  实际: 30.01%  (误差: 0.01%)
  谢谢参与     期望: 64.00%  实际: 63.99%  (误差: 0.01%)
```

## 四、关键设计决策详解

### 4.1 展开表大小 N 怎么选？

| 表大小 N | 概率精度 | 内存占用（int数组） | 适用场景 |
|---------|---------|-------------------|---------|
| 100 | 1% | 400 B | 粗粒度抽奖（促销活动） |
| 1,000 | 0.1% | 4 KB | 中等精度 |
| 10,000 | 0.01% | 40 KB | **推荐默认值** |
| 100,000 | 0.001% | 400 KB | 高精度场景 |
| 1,000,000 | 0.0001% | 4 MB | 极端精度（万分之一中奖率） |

**经验法则**：`N = 1 / 最小概率精度`。如果最小概率是 0.01%（万分之一），N 至少取 10,000。实际项目中取 `N = 10000` 足够覆盖 99% 的场景，内存仅占 40KB。

### 4.2 内存预分配

- 查找表用 **`int[]`** 而非 `Integer[]`，避免装箱开销
- 数组在构造时一次性分配，**后续抽奖只读不写**，对 CPU 缓存友好
- 对象头开销为 0（原生数组），对比 `List<Integer>` 节省 50%+ 内存

### 4.3 随机数选择

使用 `ThreadLocalRandom.current().nextInt(N)` 而非 `Math.random()`：
- **无竞争**：每个线程有独立的 Random 实例，无 CAS 开销
- **更高效**：`nextInt(bound)` 直接生成 `[0, bound)` 的随机数，不需要浮点运算

## 五、面试加分点

### 5.1 精度误差分析

展开表存在四舍五入误差。解决方法：
1. **按概率从大到小排列**：大概率奖品先填入，减少累计误差
2. **最小概率奖品至少占 1 个槽位**：保证低概率奖品不被「吃掉」
3. **剩余槽位兜底**：全部归入最高概率奖品

### 5.2 Alias Method（别名法）—— 更省空间的 O(1) 方案

如果奖品数量 K 很大（比如 1000+），展开表会浪费空间。**别名法**用 O(K) 空间实现 O(1) 抽奖：

```java
/**
 * Alias Method：O(K) 空间 + O(1) 时间
 * 适合奖品数量多、概率差异大的场景
 */
public class AliasMethod {
    private final int[] alias;
    private final double[] prob;
    private final int size;

    public AliasMethod(double[] probabilities) {
        this.size = probabilities.length;
        this.alias = new int[size];
        this.prob = new double[size];

        double[] p = new double[size];
        for (int i = 0; i < size; i++) {
            p[i] = probabilities[i] * size;
        }
        // 用两个双端队列分别装 <1 和 >=1 的概率
        Deque<Integer> small = new ArrayDeque<>();
        Deque<Integer> large = new ArrayDeque<>();
        for (int i = 0; i < size; i++) {
            if (p[i] < 1.0) small.add(i);
            else large.add(i);
        }
        while (!small.isEmpty() && !large.isEmpty()) {
            int s = small.poll(), l = large.poll();
            prob[s] = p[s];
            alias[s] = l;
            p[l] = p[l] + p[s] - 1.0;
            if (p[l] < 1.0) small.add(l);
            else large.add(l);
        }
        while (!large.isEmpty()) prob[large.poll()] = 1.0;
        while (!small.isEmpty()) prob[small.poll()] = 1.0;
    }

    public int draw() {
        int col = ThreadLocalRandom.current().nextInt(size);
        return ThreadLocalRandom.current().nextDouble() < prob[col] ? col : alias[col];
    }
}
```

| 方案 | 空间复杂度 | 时间复杂度 | 适用场景 |
|------|----------|----------|---------|
| 概率展开表 | O(N)（N 为精度） | O(1) | 奖品少、精度要求明确 |
| Alias Method | O(K) | O(1) | 奖品多、概率差异大 |
| 前缀和+二分 | O(K) | O(log K) | 通用、实现简单 |

### 5.3 与 Redis 的结合

在分布式场景下，展开表可以预构建后存入 Redis：
- **构建阶段**：在应用层生成 `int[]`，序列化后存入 Redis（`SET prize:table {serialized}`）
- **抽奖阶段**：用 Lua 脚本在 Redis 端完成 `RANDOM + 取模 + 查表`，减少网络往返

## 六、总结

| 维度 | 原始 O(K) | 优化后 O(1) |
|------|----------|------------|
| 时间复杂度 | O(K) 遍历 | O(1) 取模+索引 |
| 空间复杂度 | O(K) 概率列表 | O(N) 查找表 |
| 单次操作 | K 次比较 | 1 次取模 + 1 次数组访问 |
| 缓存友好性 | 每次访问不同概率值 | 顺序内存访问，缓存命中率高 |
| 更新成本 | O(1) 修改概率值 | O(N) 重建表（但低频） |

**核心结论**：对于抽奖这种**读多写少**（每次请求都读，概率配置极少变更）的场景，空间换时间是绝对正确的方向。展开表用 40KB 的内存，把每次抽奖的 CPU 开销从 K 次比较降到 1 次取模，在高 QPS 场景下收益巨大。

## 记忆要点

- 核心对比：原算法需O(K)累加遍历前缀和，优化后变O(1)一步定位取模查表
- 一句话定义：概率展开为查找表，把各奖品按概率比例直接铺满数组槽位
- 口诀记流程：建表展开铺满，抽奖随机取模，一步直达结果
- 关键数字：表大小通常设10000，保证精度到万分位
- 极易踩坑：概率极小但非0的奖品，必须强制分配至少1个槽位防死局


## 苏格拉底式面试追问

> 这组追问模拟面试官层层逼问，每一问先回答"为什么"，再回答"怎么做"，最后回答"如何证明"。

### 第一层：目标与动机

**Q：你为什么把抽奖算法优化到 O(1)，O(K) 的遍历在 K=10 时也就 10 次比较，有那么慢吗？**

因为高并发下常数被 QPS 放大。单次抽奖 O(K=10) 是微秒级，但万级 QPS 下每秒 10 万次比较 + 浮点累加 + 分支预测失败，CPU 占用明显。更关键的是尾延迟——O(K) 的耗时是变量（概率分布不同，匹配到的位置不同），P99 可能是平均的 2-3 倍；O(1) 取模是恒定耗时，P99 = P50 = 平均，尾延迟可控。抽奖是 C 端高并发场景，尾延迟比平均延迟更影响体验。决策依据不是单次慢不慢，是高 QPS 下 CPU 和尾延迟的综合成本。

### 第二层：证据与定位

**Q：压测发现 O(1) 方案的 QPS 没有比 O(K) 高多少，只快了 15%，你怎么解释？**

因为瓶颈不在抽奖算法本身。压测时 QPS 上不去，要看 Flame Graph 定位热点：
1. 如果 CPU 热点在 Redis 网络往返（Lua 脚本执行 + 网络 RTT 1ms），抽奖算法 O(1) vs O(K) 的微秒级差异被毫秒级网络淹没。
2. 如果热点在 DB 写中奖记录，抽奖算法优化没用，要优化的是异步落库。
3. 如果热点确实在抽奖代码（CPU 占比 > 30%），O(1) 才有明显收益。压测结果说明当前瓶颈在网络/IO，算法优化要先等 IO 瓶颈解决才能体现。

### 第三层：根因深挖

**Q：O(1) 查找表上线后，发现某奖品（如 iPhone）的中奖率比配置的低，根因是什么？**

最可能是概率展开时的精度问题。假设 iPhone 概率 0.05%（万分之一），表大小 1000，展开时 0.05% × 1000 = 0.5 个槽位，向下取整 = 0 个槽位，iPhone 永远不会被抽中。根因是表大小不够——概率精度要求到万分之一，表至少要 10000。另一种可能是随机数取模的模偏差——`rand() % N` 当 N 不是 2 的幂时有模偏差，某些槽位概率略高。要校准概率，必须用 `floor(rand() / (RAND_MAX+1.0) * N)` 避免模偏差，且表大小远大于概率精度的倒数。

**Q：为什么不直接把表大小设成 100 万（百万分之一精度），彻底避免精度问题？**

内存浪费 + 缓存不友好。表大小 100 万 × 4 字节（int 奖品 ID）= 4MB，看似不大，但这个表是每个活动一份（多活动并存），且高频访问要常驻 L1/L2 缓存。4MB 的数组超过 L2 缓存（通常 256KB-1MB），随机访问全是 cache miss，O(1) 的取模操作反而比 O(K) 的顺序遍历慢（顺序遍历缓存友好）。权衡：表大小 10000（十万分之一精度）够用且能进 L2，是性能和精度的平衡点。百万级表是过度设计。

### 第四层：方案权衡

**Q：除了概率展开表，还有别的 O(1) 抽奖方案吗？怎么选？**

有两种替代：
1. 别名法（Alias Method）——构建别名表（两个数组：prob[] 和 alias[]），O(1) 查找且空间 O(K)（不展开，表大小 = 奖品数 K）。优势是省内存（K=10 时表只有 10 项 vs 展开表 10000 项），劣势是建表算法复杂（Vose 算法）。
2. 拒绝采样——按最大概率生成随机数，不匹配则重采。最坏情况非 O(1)。

权衡：奖品数少（K < 20）且概率精度要求高时，别名法更优（内存小）；奖品数多或概率频繁变更时，展开表更直观（重建简单）。抽奖场景 K 通常 < 20，别名法其实是更优解，但展开表实现简单、可读性好，工程上多数团队选展开表。

**Q：为什么不用二分查找（前缀和 + 二分，O(log K)），不也是很快吗？**

O(log K) 在 K=10 时约 4 次比较，理论上是 O(1) 的 4 倍，但实测差距更大——二分查找的内存访问是跳跃的（cache miss 多），而 O(1) 取模是单次访问。更重要的是二分查找有分支（if mid val > rand），分支预测失败的惩罚（10-20 周期）在高并发下累积。O(1) 无分支（直接索引），CPU 流水线最优。所以在"极致性能"场景，O(log K) 不够，必须 O(1)。但如果场景不是那么极致（QPS 千级），O(log K) 完全够用，不需要展开表的复杂度。

### 第五层：验证与沉淀

**Q：你怎么证明 O(1) 查找表的概率分布和配置一致？**

统计验证：
1. 离线验证——用蒙特卡洛模拟，跑 1000 万次抽奖，统计各奖品实际中奖率，与配置概率比对，误差 < 0.1%。
2. 线上采样——线上抽奖日志采样 1%，跑同样的统计，确认线上实际分布与配置一致。
3. 边界 case——专门验证低概率奖品（0.01%）是否能被抽中（跑了足够多次一定会有），验证高概率奖品（50%）不会超过配置上限。

**Q：抽奖算法怎么沉淀？**

1. 抽奖引擎 SDK 化——封装"建表 + 查表 + 概率校验"成通用组件，支持展开表和别名法两种实现，按场景切换。
2. 建表工具——提供概率配置 → 自动生成查找表的工具，运营配概率，工具自动校验（概率和 = 100%、低概率奖品有槽位）。
3. 性能基线——记录 O(1) vs O(K) 的压测数据，作为团队"是否需要优化到 O(1)"的决策依据，避免过度优化。


## 结构化回答

**30 秒电梯演讲：** 将概率分布展开为静态查找表，用一次随机数取模即可确定中奖结果——O(1)复杂度。打个比方，就像彩票箱——你提前按1000张票放进去，抽奖时只随机摸一张就行。

**展开框架：**
1. **核心对比** — 原算法需O(K)累加遍历前缀和，优化后变O(1)一步定位取模查表
2. **一句话定义** — 概率展开为查找表，把各奖品按概率比例直接铺满数组槽位
3. **口诀记流程** — 建表展开铺满，抽奖随机取模，一步直达结果

**收尾：** 这块我踩过坑——要不要深入聊：数组大小N怎么选？1000够吗？

## 视频脚本

> 预计时长：4 分钟 | 由浅入深

| 时间 | 画面/字幕 | 口播台词 | 讲解要点 |
|------|----------|----------|----------|
| 0:00 | 标题卡 | "性能优化一句话：将概率分布展开为静态查找表，用一次随机数取模即可确定中奖结果——O(1)复杂度。" | 开场钩子 |
| 0:15 | JVM 内存结构图 | "核心对比：原算法需O(K)累加遍历前缀和，优化后变O(1)一步定位取模查表" | 核心对比 |
| 1:08 | JVM 内存结构图分步演示 | "一句话定义：概率展开为查找表，把各奖品按概率比例直接铺满数组槽位" | 一句话定义 |
| 2:01 | 关键代码/伪代码片段 | "口诀记流程：建表展开铺满，抽奖随机取模，一步直达结果" | 口诀记流程 |
| 2:54 | 对比表格 | "关键数字：表大小通常设10000，保证精度到万分位" | 关键数字 |
| 3:50 | 总结卡 | "核心抓住这条主线，下期咱们接着聊：数组大小N怎么选？1000够吗。" | 收尾 |
