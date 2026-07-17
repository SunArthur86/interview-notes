---
id: note-hw-002
difficulty: L3
category: ai
subcategory: 数据工程
tags:
- 华为
- 面经
- SQL
- 窗口函数
- 数据倾斜
feynman:
  essence: 窗口函数是"在不改变行数的前提下，对一组相关行做聚合计算"的SQL能力；数据倾斜是分布式计算中某节点数据量远超其他节点导致的长尾瓶颈。
  analogy: 窗口函数像带"望远镜"的聚合——你站在某一行，望远镜能看到这一行周围的一组行（窗口），算完聚合后还在原地（不改变行数）。数据倾斜像高速公路收费站——9个通道畅通，1个通道堵了5公里，整体速度由最慢的车道决定。
  first_principle: 窗口函数的数学本质是"滑动窗口上的函数应用"F(x_i, {x_j, j ∈ window(i)})。数据倾斜的本质是"并行计算的木桶效应"——总耗时等于max(各partition耗时)，一个partition过大就拖垮全局。
  key_points:
  - 窗口函数三要素：PARTITION BY(分组) + ORDER BY(排序) + 窗口框架(ROWS/RANGE)
  - 窗口函数不改变行数（区别于GROUP BY聚合后行数减少）
  - 数据倾斜根因：key分布不均导致hash/shuffle后某partition过大
  - 解决数据倾斜：加盐打散、两阶段聚合、自定义Partitioner
first_principle:
  essence: 分布式聚合的性能上界由最大partition决定，而非平均partition
  derivation: 在MapReduce/Spark中，数据按key的hash分布到N个partition并行处理，总耗时=max(各partition耗时)。当某个key的频次远超其他（如null、空字符串、热门ID），其所在partition成为瓶颈。窗口函数通过预排序+滑动窗口，避免了GROUP BY的shuffle代价。
  conclusion: 性能优化=让数据分布均匀(治倾斜)+让计算本地化(减少shuffle+合理用窗口函数)
follow_up:
- ROWS BETWEEN和RANGE BETWEEN的区别？
- 开窗函数和GROUP BY能否在同一个查询中混用？
- Spark中如何诊断数据倾斜？如何看SQL执行计划？
memory_points:
- 本质对比：GROUP BY 合并行降维，窗口函数保留原行明细并附加聚合计算结果。
- 三要素：语法包含 PARTITION BY(分组)、ORDER BY(组内排序)、ROWS/RANGE(框架范围)。
- 函数分类：聚合类做累计求和，排名类(ROW_NUMBER等)常用于去重，偏移类(LAG/LEAD)算同比。
- 倾斜处理：因 Key 分布不均导致，优化常靠打散重组、加盐扩容或开启 Skew Join 参数。
---

# 【华为面经】SQL 窗口函数与数据倾斜问题如何处理？

## 一、窗口函数详解

### 1.1 什么是窗口函数

窗口函数（Window Function）= **对一组相关行（窗口）做计算，但每一行都返回一个结果，不改变行数**。

```sql
-- 需求：查出每个员工的信息，并附上他所在部门的平均薪资
-- ❌ GROUP BY方式：会丢失员工个人行（只剩每个部门一行）
SELECT dept, AVG(salary) FROM employees GROUP BY dept;

-- ✅ 窗口函数方式：保留每个员工，额外加上部门均值列
SELECT
    name,
    dept,
    salary,
    AVG(salary) OVER (PARTITION BY dept) AS dept_avg_salary
FROM employees;
```

### 1.2 窗口函数三要素

```sql
函数名() OVER (
    [PARTITION BY 分组列]      -- 1. 怎么分组（窗口边界）
    [ORDER BY 排序列]          -- 2. 组内怎么排序
    [ROWS/RANGE BETWEEN ...]   -- 3. 窗口框架（看哪些行）
)
```

| 要素 | 作用 | 示例 |
|------|------|------|
| `PARTITION BY` | 定义窗口分组（类似GROUP BY但不合并行） | `PARTITION BY dept` 每个部门一个窗口 |
| `ORDER BY` | 窗口内排序（滑动窗口需要） | `ORDER BY hire_date` 按入职日期排序 |
| `ROWS/RANGE` | 窗口框架范围 | `ROWS BETWEEN 1 PRECEDING AND CURRENT ROW` |

### 1.3 常用窗口函数分类

```sql
-- 1. 聚合类窗口函数
SELECT
    name, dept, salary,
    SUM(salary)   OVER w AS running_sum,    -- 累计求和
    AVG(salary)   OVER w AS running_avg,    -- 累计均值
    COUNT(*)      OVER w AS running_cnt     -- 累计计数
FROM employees
WINDOW w AS (PARTITION BY dept ORDER BY hire_date
             ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW);

-- 2. 排名类窗口函数（大模型数据去重常用）
SELECT
    url, text, quality_score,
    ROW_NUMBER() OVER (PARTITION BY url ORDER BY quality_score DESC) AS rn,
    RANK()       OVER (PARTITION BY url ORDER BY quality_score DESC) AS rnk,
    DENSE_RANK() OVER (PARTITION BY url ORDER BY quality_score DESC) AS dense_rnk
FROM corpus;
-- rn=1的行即每个url质量最高的那条（去重）

-- 3. 偏移类窗口函数（时序分析）
SELECT
    date, daily_active,
    LAG(daily_active, 1)  OVER (ORDER BY date) AS prev_day,  -- 前一天
    LEAD(daily_active, 1) OVER (ORDER BY date) AS next_day,  -- 后一天
    daily_active - LAG(daily_active,1) OVER (ORDER BY date) AS dau_growth
FROM metrics;

-- 4. 取值类窗口函数（百分位、分桶）
SELECT
    name, salary,
    NTILE(4) OVER (ORDER BY salary) AS quartile,  -- 分成4档
    FIRST_VALUE(salary) OVER (ORDER BY salary) AS min_sal,
    LAST_VALUE(salary)  OVER (ORDER BY salary
        ROWS BETWEEN UNBOUNDED PRECEDING AND UNBOUNDED FOLLOWING) AS max_sal
FROM employees;
```

### 1.4 ROWS vs RANGE 框架区别

```sql
-- ROWS：按物理行数定义窗口
-- RANGE：按逻辑值范围定义窗口

-- 需求：当前行及前1行（物理）
ROWS BETWEEN 1 PRECEDING AND CURRENT ROW

-- 需求：排序值与当前行相同的所有行（逻辑，处理并列）
RANGE BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
-- 如果有3个人salary相同，RANGE会把3行都算进窗口
```

## 二、数据倾斜问题深度剖析

### 2.1 数据倾斜的本质

分布式计算（Spark/Hive/Presto）中，数据按**key的hash值**分配到N个partition并行处理：

```
数据分布理想情况（均匀）：
┌──────────┬──────────┬──────────┐
│  Part 0  │  Part 1  │  Part 2  │
│ 1GB(10s) │ 1GB(10s) │ 1GB(10s) │  ← 总耗时=10s
└──────────┴──────────┴──────────┘

数据倾斜情况（某key爆炸）：
┌──────────┬──────────┬──────────────────┐
│  Part 0  │  Part 1  │     Part 2       │
│ 1GB(10s) │ 1GB(10s) │ 100GB(1000s)!!!  │  ← 总耗时=1000s
└──────────┴──────────┴──────────────────┘
         木桶效应：最慢的partition决定全局性能
```

### 2.2 数据倾斜的典型场景

```sql
-- 场景1：GROUP BY 某字段，但该字段有大量相同值
SELECT status, COUNT(*) FROM logs GROUP BY status;
-- 如果status=200的记录占99%，那个partition巨大

-- 场景2：JOIN时某个key分布极不均
SELECT a.*, b.info
FROM fact_table a                 -- 100亿行
JOIN dim_table b ON a.user_id = b.user_id;
-- 如果user_id=NULL的记录有几亿条，全部hash到同一partition

-- 场景3：COUNT(DISTINCT)
SELECT city, COUNT(DISTINCT user_id) FROM logs GROUP BY city;
-- DISTINCT会强制把同一city的所有数据shuffle到一个节点
```

### 2.3 数据倾斜的诊断

```sql
-- Spark: 查看stage任务，找出执行时间异常长的task
-- 写SQL前先看key分布
SELECT
    status,
    COUNT(*) AS cnt,
    ROUND(COUNT(*) * 100.0 / SUM(COUNT(*)) OVER (), 2) AS pct
FROM logs
GROUP BY status
ORDER BY cnt DESC
LIMIT 10;
-- 如果某个key占比超过30%，基本确定倾斜
```

### 2.4 解决数据倾斜的四大策略

#### 策略1：加盐打散（Salt）——最通用

```sql
-- 原始倾斜SQL
SELECT dept, SUM(amount) FROM big_table GROUP BY dept;
-- 假设dept='other'占80%数据

-- 两阶段聚合：第一阶段加随机前缀打散，第二阶段还原
-- 阶段1：加0-9随机盐，分散到10个partition
WITH salted AS (
    SELECT
        CONCAT(dept, '_', CAST(FLOOR(RAND()*10) AS STRING)) AS salted_dept,
        amount
    FROM big_table
),
step1 AS (
    SELECT salted_dept, SUM(amount) AS partial_sum
    FROM salted
    GROUP BY salted_dept
)
-- 阶段2：去掉盐，二次聚合
SELECT
    SUBSTRING(salted_dept, 1, LENGTH(salted_dept)-2) AS dept,
    SUM(partial_sum) AS total
FROM step1
GROUP BY SUBSTRING(salted_dept, 1, LENGTH(salted_dept)-2);
```

#### 策略2：两阶段聚合（局部+全局）——解决COUNT(DISTINCT)

```sql
-- ❌ 直接COUNT(DISTINCT)：所有数据shuffle到一个节点
SELECT city, COUNT(DISTINCT user_id) FROM logs GROUP BY city;

-- ✅ 两阶段：先局部去重，再全局去重
WITH local_dedup AS (
    -- 阶段1：按city + user_id分组（分散到多partition），每组COUNT=1即去重
    SELECT city, user_id, COUNT(*) AS cnt
    FROM logs
    GROUP BY city, user_id
)
SELECT city, COUNT(*) AS distinct_users  -- 阶段2：全局count
FROM local_dedup
GROUP BY city;
```

#### 策略3：广播JOIN（Broadcast Join）——小表驱动大表

```sql
-- 如果JOIN的一侧是小表（<广播阈值，默认10MB）
-- 把小表广播到所有executor，避免shuffle

-- Spark SQL自动优化：
SET spark.sql.autoBroadcastJoinThreshold = 10485760;  -- 10MB

-- 或显式hint
SELECT /*+ BROADCAST(b) */ a.*, b.info
FROM huge_fact a JOIN small_dim b ON a.id = b.id;
```

#### 策略4：过滤无效key——NULL/空值单独处理

```sql
-- 把user_id IS NULL的记录单独拎出来，不参与JOIN
SELECT a.*, b.info
FROM fact_table a
JOIN dim_table b ON a.user_id = b.user_id
WHERE a.user_id IS NOT NULL

UNION ALL

SELECT a.*, NULL AS info
FROM fact_table a
WHERE a.user_id IS NULL;
```

## 三、窗口函数与数据倾斜的工程结合

在大模型数据工程的去重场景，窗口函数 + 数据倾斜处理的组合拳：

```sql
-- 需求：对TB级语料，按url去重保留quality最高的版本
-- 倾斜点：某些热门url（如wikipedia条目）被爬取了上百万次

-- 优化方案：两阶段 + 窗口函数
WITH salted AS (
    -- 阶段1：加随机盐，按url+盐分组，每组取top1
    SELECT
        CONCAT(url, '_', CAST(FLOOR(RAND()*50) AS STRING)) AS salted_url,
        url, text, quality_score
    FROM corpus
),
stage1 AS (
    SELECT *,
        ROW_NUMBER() OVER (
            PARTITION BY salted_url ORDER BY quality_score DESC
        ) AS rn
    FROM salted
    WHERE rn = 1  -- 这里Spark会用PushDown优化
),
-- 阶段2：50个partition的结果再按真url取top1
final AS (
    SELECT *,
        ROW_NUMBER() OVER (PARTITION BY url ORDER BY quality_score DESC) AS rn
    FROM (SELECT * FROM stage1 WHERE rn = 1)
)
SELECT * FROM final WHERE rn = 1;
```

## 加分点

1. **知道窗口函数的执行原理**：先按PARTITION BY排序，再用滑动指针扫描，复杂度O(NlogN)，避免GROUP BY的全量shuffle
2. **能说出Spark中数据倾斜的具体参数**：`spark.sql.shuffle.partitions`（默认200，大表应调大）、`spark.sql.autoBroadcastJoinThreshold`
3. **理解两阶段聚合的数学等价性**：SUM可拆（加法结合律），但COUNT(DISTINCT)不能直接拆——需要先局部去重再全局count

## 雷区

- **ROW_NUMBER vs RANK vs DENSE_RANK混淆**：有并列时行为不同——ROW_NUMBER强制唯一(1,2,3)，RANK跳号(1,1,3)，DENSE_RANK不跳(1,1,2)
- **以为窗口函数没有性能开销**：窗口函数需要全量排序（PARTITION BY + ORDER BY），内存开销 = partition大小，倾斜时一样OOM
- **盲目加盐**：如果倾斜key本身就少（如只有1个超大key），加盐后第二阶段还是倾斜——需结合其他策略

## 扩展

- **Spark Adaptive Query Execution (AQE)**：Spark 3.0+运行时自动检测倾斜并切分partition，无需手动加盐（`spark.sql.adaptive.skewJoin.enabled`）
- **Hive的SkewJoin优化**：`set hive.optimize.skewjoin=true`，自动把倾斜key单独走MapJoin
- **大模型数据去重工具**：datasketch（MinHash LSH）、Deduplicating Massive Datasets（CCNet的精确去重）

## 记忆要点

- 本质对比：GROUP BY 合并行降维，窗口函数保留原行明细并附加聚合计算结果。
- 三要素：语法包含 PARTITION BY(分组)、ORDER BY(组内排序)、ROWS/RANGE(框架范围)。
- 函数分类：聚合类做累计求和，排名类(ROW_NUMBER等)常用于去重，偏移类(LAG/LEAD)算同比。
- 倾斜处理：因 Key 分布不均导致，优化常靠打散重组、加盐扩容或开启 Skew Join 参数。

## 苏格拉底式面试追问

> 这组追问模拟面试官层层逼问，每一问先回答"为什么"，再回答"怎么做"，最后回答"如何证明"。

### 第一层：目标与动机

**Q：窗口函数保留原行明细，而 GROUP BY 合并行。但"保留明细"这个需求为什么不直接用"GROUP BY + JOIN 回原表"实现（先聚合再 join 回去拿明细）？窗口函数在性能上优势在哪？**

GROUP BY + JOIN 回原表能实现相同结果，但性能差。原因是 JOIN 需要一次额外的 shuffle（按 dept 把聚合结果和原表对齐），而窗口函数在"已按 PARTITION BY 排序的数据"上用滑动指针一次性算完，无需额外 shuffle。具体地：GROUP BY 聚合一趟 shuffle + JOIN 回原表又一趟 shuffle = 两趟 shuffle；窗口函数 PARTITION BY 排序一趟（本质是 shuffle + sort）就完成。在 Spark/Hive 上，shuffle 是最贵的操作（网络 IO + 磁盘 IO），少一趟 shuffle 对大表是巨大的性能差异（可能 2-3 倍）。所以窗口函数不是"语法糖"，是"减少 shuffle 的工程优化"。小表无所谓，大表（TB 级）少一趟 shuffle 省几分钟到几小时。

### 第二层：证据与定位

**Q：你诊断数据倾斜用"看 key 占比超 30% 判断"。但 30% 这个阈值怎么来的？如果某个 key 占 25% 但绝对量很大（如 10 亿条），算不算倾斜？**

30% 是经验阈值，不是绝对的。倾斜的本质是"某 partition 的处理时间显著大于其他 partition"，占百分比只是间接信号。更准确的判断是看 Spark/Hive 的 task 执行时间分布——如果某 stage 里大部分 task 几秒完成，但少数 task 跑几分钟甚至几十分钟，且这些慢 task 处理的数据量明显大，就是倾斜。占百分比和绝对量都要看：key 占 25% 但总表只有 100 万行（25 万行）可能不倾斜（25 万行一个 partition 很快）；key 占 5% 但总表 100 亿行（5 亿行）可能严重倾斜。所以 30% 是"快速筛查"的信号，确认要看 task 级别的执行时长和数据量分布（Spark UI 的 stage 详情）。生产中建议两个一起看：占比异常（> 20%）或慢 task 存在，任一触发就深入诊断。

### 第三层：根因深挖

**Q：加盐打散你给"加 0-9 随机盐分散到 10 个 partition"。但如果倾斜的 key 只有 1 个（如 user_id=NULL 占 80%），加盐后第二阶段聚合时这个 key 还是聚集到一个 partition。加盐不是没解决根本问题吗？**

你指出的对，单 key 倾斜时加盐的第二阶段会重新聚集。加盐解决的是"第一阶段（局部聚合）的倾斜"，第二阶段（全局聚合）仍可能倾斜。完整解法是"加盐 + 局部预聚合 + 最终聚合"三阶段，且第二阶段的结果集已经大幅缩小（10 个 partition 各聚合一次后，原来 80% 的数据变成 10 条部分聚合结果），所以第二阶段的"倾斜"是 10 条 vs 1 条，绝对量极小不再是瓶颈。具体到 SUM：第一阶段 10 个 salt 分散聚合，第二阶段把 10 条部分结果按原 key 聚合（10 条进 1 个 partition，毫秒级完成）。真正解决不了的是"COUNT(DISTINCT)"这种不可拆的聚合——加盐后局部 COUNT(DISTINCT) 和全局 COUNT(DISTINCT) 不等价（局部去重后再汇总会漏掉跨 salt 的重复），这时要用前面提的"两阶段局部去重"而非加盐。所以选策略要看聚合函数的可拆性。

**Q：那如果倾斜 key 是"NULL"或"空字符串"这种无意义值，为什么不直接过滤掉（策略4），反而要费劲加盐保留它？**

如果 NULL 确实无意义应该过滤，加盐保留是浪费。但"是否无意义"取决于业务——有时候 NULL key 的记录本身有业务价值（如"未登录用户的日志"），过滤掉会丢失这部分分析。所以策略选择是：NULL 确实无业务意义（如脏数据）→ 过滤（策略4，最简单）；NULL 有业务意义但要参与聚合 → 单独拎出来处理（不走 JOIN 的倾斜路径，单独算后 UNION 回去）；NULL 是"其他"类的兜底值且量大 → 加盐打散。判断标准是"这个 key 的记录要不要出现在最终结果里"。要 → 不能过滤，用加盐或单独处理；不要 → 过滤。生产中常见的坑是"盲目过滤 NULL 导致业务方报表少了数据"，所以过滤前要和业务确认 NULL 的含义。

### 第四层：方案权衡

**Q：Spark 3.0 的 AQE（Adaptive Query Execution）能自动检测倾斜并切分 partition。既然框架自动优化了，为什么还要手动加盐？AQE 能完全替代手动优化吗？**

AQE 解决了大部分倾斜场景，但不能完全替代手动优化。AQE 的局限：一是它基于运行时统计切分 partition，但如果某个 key 本身就极大（如单 key 100GB），切分后每个子 partition 仍然很大（100GB 切 10 份每份 10GB），治标不治本；二是 AQE 主要优化 JOIN 的倾斜，对 GROUP BY 和窗口函数的倾斜支持有限（不同 Spark 版本支持程度不同）；三是 AQE 是"事后补救"——它先 shuffle 了才发现倾斜再切分，shuffle 成本已发生，而手动加盐是"事前预防"。所以最佳实践是：简单场景（常规倾斜、JOIN 倾斜）靠 AQE 自动处理；复杂场景（单 key 极大、COUNT(DISTINCT)、窗口函数倾斜）仍要手动加盐/两阶段；且手动优化后可以关掉 AQE 的倾斜处理（避免双重优化冲突）。AQE 是"降低手动优化频率"，不是"消除手动优化需求"。

**Q：两阶段聚合解决 COUNT(DISTINCT) 倾斜。但两阶段的结果和单阶段 COUNT(DISTINCT) 真的等价吗？会不会有边界情况导致结果不一致？**

等价，前提是正确实现。两阶段的逻辑是：阶段1 按 (city, user_id) GROUP BY 去重（每个 city-user_id 组合留一条），阶段2 按 city COUNT(*)。因为阶段1 已经保证每个 city 内的 user_id 唯一，阶段2 的 COUNT 就是去重后的数量，和单阶段 COUNT(DISTINCT user_id) 数学等价。边界情况是"阶段1 的 GROUP BY 本身倾斜"——如果某 city 的 user_id 极多（如北京几亿用户），阶段1 按 (city, user_id) 分组时北京的数据仍可能聚到一个 partition。这时要给阶段1 加盐（按 city + salt 分散），阶段2 再汇总。另一个边界是 NULL user_id——COUNT(DISTINCT) 默认不计 NULL，两阶段要在阶段1 过滤 NULL 或用 COUNT(user_id) 保持一致。所以"等价"的前提是正确处理 NULL 和阶段1 的二次倾斜，不是无脑套模板。

### 第五层：验证与沉淀

**Q：你怎么证明某个倾斜优化（如加盐）真的提升了性能，而不是碰巧那天集群空闲？**

做控制变量对比。一是同一 SQL 在同一数据集、同一集群、同一时段跑"优化前"vs"优化后"，比总执行时长和 stage 级 task 时长分布（看慢 task 是否消失）。二是看 Spark UI 的 stage 详情——优化前某 stage 有几个 task 跑 30 分钟而其他 task 跑 10 秒，优化后所有 task 时长趋于均匀（如都在 1-2 分钟），这是倾斜被解决的直接证据。三是在不同数据量（如 1TB vs 10TB）下验证优化效果的稳定性——如果只在某数据量下有效，可能不是通用解。四是消除集群波动影响——同一 SQL 跑 3 次取中位数，避免单次跑被其他作业抢占资源干扰。证明逻辑是"task 时长分布从长尾变均匀 + 总时长缩短 + 多次复现稳定"，用 Spark UI 的数字说话，不是"感觉快了"。

**Q：怎么让团队写 SQL 时自觉避免数据倾斜，而不是每次跑出来慢了才回头优化？**

把倾斜预防做进 SQL 规范和审查流程。一是预检查规范：写 GROUP BY/JOIN/DISTINCT 前必须先查 key 分布（`SELECT key, COUNT(*) ... LIMIT 10`），占比异常的 key 要在 SQL 里处理（加盐/过滤/单独处理）而非裸跑。二是 SQL Review checklist：reviewer 重点看"GROUP BY 的 key 是否可能倾斜""JOIN 的 key 有没有 NULL/空值集中""COUNT(DISTINCT) 有没有用两阶段"，高危 SQL 要附 key 分布的预查结果。三是框架兜底：开启 AQE 自动倾斜处理（`spark.sql.adaptive.skewJoin.enabled=true`）和合理设 shuffle partition 数（大表调大，如 `spark.sql.shuffle.partitions=2000`），让框架兜底常见倾斜。四是监控：跑得慢的 SQL 自动告警，定期 review 慢 SQL 治理。让倾斜预防在"写 SQL 时 + review 时 + 运行时"三层都有把关，而不是出事才查。

## 结构化回答

**30 秒电梯演讲：** 窗口函数是"在不改变行数的前提下，对一组相关行做聚合计算"的SQL能力；数据倾斜是分布式计算中某节点数据量远超其他节点导致的长尾瓶颈。

**展开框架：**
1. **窗口函数三要素** — PARTITION BY(分组) + ORDER BY(排序) + 窗口框架(ROWS/RANGE)
2. **窗口函数不改** — 窗口函数不改变行数（区别于GROUP BY聚合后行数减少）
3. **数据倾斜根因** — key分布不均导致hash/shuffle后某partition过大

**收尾：** 您想深入聊：ROWS BETWEEN和RANGE BETWEEN的区别？


## 视频脚本

> 预计时长：4 分钟 | 由浅入深


| 时间 | 画面/字幕 | 口播台词 | 讲解要点 |
|------|----------|----------|----------|
| 0:00 | 标题卡：SQL 窗口函数与数据倾斜问题如何处理？ | "窗口函数像带"望远镜"的聚合——你站在某一行，望远镜能看到这一行周围的一组行（窗口），算完…" | 开场钩子 |
| 0:20 | 核心概念图 | "窗口函数是"在不改变行数的前提下，对一组相关行做聚合计算"的SQL能力；数据倾斜是分布式计算中某节点数据量远超其他节点导…" | 核心定义 |
| 0:50 | 窗口函数三要素示意图 | "窗口函数三要素——PARTITION BY(分组) + ORDER BY(排序) + 窗口框架(ROWS/RANGE)" | 要点拆解1 |
| 1:30 | 对比/实战案例图 | "对比一下常见误区和工程实践，看真实场景里怎么取舍。" | 实战与对比 |
| 2:20 | 总结卡 | "记住核心要点。下期我们追问：ROWS BETWEEN和RANGE BETWEEN的区别？" | 收尾与钩子 |
