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

