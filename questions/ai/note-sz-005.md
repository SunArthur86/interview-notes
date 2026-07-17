---
id: note-sz-005
difficulty: L2
category: ai
subcategory: 数据工程
tags:
- 神州专车
- 面经
- SQL
- 窗口函数
feynman:
  essence: 窗口函数能在不聚合行的情况下对"一组相关行"做计算，保留明细同时算聚合/排名/偏移。四类：①聚合类(SUM/AVG/COUNT OVER)②排名类(ROW_NUMBER/RANK/DENSE_RANK)③偏移类(LAG/LEAD)④分布类(PERCENTILE/NTILE)。出行场景实例：司机收入排名用ROW_NUMBER，连续登录判断用ROW_NUMBER差值，环比增长用LAG，累计流水用SUM OVER累加。
  analogy: 普通聚合像把全班分数算个平均分（只出一个数），窗口函数像给每个学生旁边贴一列"班级平均分""班级第几名""比上次进步多少"——既保留每个学生明细，又能看到他在班级里的位置。
  first_principle: 窗口函数 = 聚合 + 不丢明细。OVER() 定义"和当前行相关的哪些行参与计算"（分区+排序+范围），让每行都能看到自己所在窗口的统计值。
  key_points:
  - 聚合类：SUM/AVG/COUNT OVER(PARTITION BY) 保留明细算聚合
  - 排名类：ROW_NUMBER(连续不重复)/RANK(重复跳号)/DENSE_RANK(重复不跳号)
  - 偏移类：LAG(取前N行)/LEAD(取后N行)，算环比/同比
  - 分布类：PERCENTILE_RANK/NTILE，分桶/百分位
  - OVER三要素：PARTITION BY(分组)/ORDER BY(排序)/FRAME(行范围)
first_principle:
  essence: 窗口函数 = 聚合 + 保留明细
  derivation: 普通聚合丢明细 → 需要既看明细又看聚合 → OVER 定义窗口 → 每行算自己窗口的统计 → 明细和聚合共存
  conclusion: 窗口函数是"分组聚合"和"逐行明细"之间的桥梁
follow_up:
- ROW_NUMBER/RANK/DENSE_RANK 怎么选？
- 窗口函数的 FRAME（ROWS/RANGE）有什么区别？
- 窗口函数和子查询哪个性能好？
memory_points:
- 语法记忆：函数() OVER (PARTITION BY 分组 ORDER BY 排序 ROWS BETWEEN 范围)
- 四大分类：聚合类（算日均）、排序类（取TopN）、偏移类（环比Lag/Lead）、分布类（NTile分桶)
- 函数对比：ROW_NUMBER唯一不重复，RANK重复且跳号，DENSE_RANK重复不跳号
---

# 【神州专车面经】开窗函数用过哪些？举个实际场景

## 一、四类窗口函数

```sql
函数() OVER (
  PARTITION BY <分组列>     -- 像 GROUP BY，但不合并行
  ORDER BY <排序列>         -- 窗口内排序
  ROWS BETWEEN <范围>       -- FRAME：参与计算的行范围
)
```

### 1. 聚合类（保留明细算聚合）
```sql
-- 每个司机每单 + 该司机当日平均流水
SELECT 
  driver_id, order_id, fare,
  AVG(fare) OVER(PARTITION BY driver_id, order_date) AS daily_avg
FROM orders;
```

### 2. 排名类（连续登录题就用到）
```sql
-- 司机收入排名
ROW_NUMBER() OVER(PARTITION BY city ORDER BY fare DESC)  -- 1,2,3,4,5（不重复）
RANK()       OVER(PARTITION BY city ORDER BY fare DESC)  -- 1,1,3,4（重复跳号）
DENSE_RANK() OVER(PARTITION BY city ORDER BY fare DESC)  -- 1,1,2,3（重复不跳号）
```

### 3. 偏移类（环比/前后对比）
```sql
-- 司机本周 vs 上周流水（环比）
SELECT 
  driver_id, week, total_fare,
  LAG(total_fare, 1) OVER(PARTITION BY driver_id ORDER BY week) AS prev_week,
  total_fare - LAG(total_fare, 1) OVER(PARTITION BY driver_id ORDER BY week) AS growth
FROM dws_driver_weekly;
```

### 4. 分布类（分桶/百分位）
```sql
-- 司机按收入分4档
NTILE(4) OVER(PARTITION BY city ORDER BY total_fare DESC) AS tier;
-- 1=头部25%, 2=中上, 3=中下, 4=底部25%
```

## 二、出行场景实例

### 场景1：找连续7天登录的司机（排名类）
见 note-sz-003，用 `ROW_NUMBER() OVER(PARTITION BY driver_id ORDER BY login_date)` 算差值。

### 场景2：司机收入排名 + 取 Top 3
```sql
WITH ranked AS (
  SELECT 
    driver_id, city, total_fare,
    DENSE_RANK() OVER(PARTITION BY city ORDER BY total_fare DESC) AS rk
  FROM dws_driver_monthly
)
SELECT * FROM ranked WHERE rk <= 3;
```

### 场景3：累计流水（聚合类 + FRAME）
```sql
-- 每个司机每月 + 年初至今累计流水
SELECT 
  driver_id, month, monthly_fare,
  SUM(monthly_fare) OVER(
    PARTITION BY driver_id 
    ORDER BY month 
    ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
  ) AS ytd_fare
FROM dws_driver_monthly;
```

### 场景4：滑动窗口平均（最近7天日均）
```sql
SELECT 
  driver_id, dt, daily_fare,
  AVG(daily_fare) OVER(
    PARTITION BY driver_id 
    ORDER BY dt 
    ROWS BETWEEN 6 PRECEDING AND CURRENT ROW
  ) AS avg_7d
FROM dws_driver_daily;
```

## 三、ROW_NUMBER / RANK / DENSE_RANK 怎么选

```sql
-- 数据：[100, 100, 80, 60]
ROW_NUMBER: 1, 2, 3, 4    -- 强行不重复（适合连续登录差值法）
RANK:       1, 1, 3, 4    -- 重复且跳号（适合"并列第几名"）
DENSE_RANK: 1, 1, 2, 3    -- 重复不跳号（适合"分档"，Top3 能取到并列）
```

- **要每行唯一**（如差值法）→ ROW_NUMBER
- **要并列且跳号**（如"第3名"是真第3）→ RANK
- **要并列不跳号**（如分档/Top N）→ DENSE_RANK

## 四、FRAME：ROWS vs RANGE

```sql
ROWS BETWEEN 2 PRECEDING AND CURRENT ROW    -- 物理行：前2行+当前
RANGE BETWEEN INTERVAL '2' DAY PRECEDING AND CURRENT ROW  -- 逻辑范围：最近2天
```

- **ROWS**：按物理行数（精确）
- **RANGE**：按值范围（适合时间窗口，能处理"某天没数据"的情况）

## 五、加分点

- 说出 **窗口函数 vs 子查询性能**：窗口函数通常比"自连接子查询"快（只扫一遍表）
- 说出 **FRAME 默认值**：有 ORDER BY 时默认 `RANGE BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW`（从开头到当前），无 ORDER BY 时默认整分区

## 六、雷区

- ❌ 忘了 `ORDER BY` 导致聚合窗口是整分区（如累计求和变成全量求和）
- ❌ 用 RANK/DENSE_RANK 做连续登录差值法（相同日期得相同排名，差值失效）

## 七、扩展

- **PERCENTILE_CONT / PERCENTILE_DISC**：连续/离散百分位，算中位数、P95
- **FIRST_VALUE / LAST_VALUE**：取窗口内第一/最后一行（注意 LAST_VALUE 要配 FRAME 才正确）
- **PERCENT_RANK / CUME_DIST**：百分位排名/累计分布，用于数据分析

## 记忆要点

- 语法记忆：函数() OVER (PARTITION BY 分组 ORDER BY 排序 ROWS BETWEEN 范围)
- 四大分类：聚合类（算日均）、排序类（取TopN）、偏移类（环比Lag/Lead）、分布类（NTile分桶)
- 函数对比：ROW_NUMBER唯一不重复，RANK重复且跳号，DENSE_RANK重复不跳号


## 苏格拉底式面试追问

> 这组追问模拟面试官层层逼问，每一问先回答"为什么"，再回答"怎么做"，最后回答"如何证明"。

### 第一层：目标与动机

**Q：开窗函数为什么要"开窗"——和普通聚合函数（GROUP BY）有什么本质区别？**

本质区别是"是否保留明细行"。GROUP BY 聚合后每组只剩一行，丢失了明细；开窗函数（OVER）对一组相关行计算，但保留每一行。动机是"既要看个体又要看群体"——比如"每个司机的收入 + 同城市司机的平均收入对比"，需要同时保留司机明细和城市聚合，GROUP BY 做不到，开窗函数可以。

### 第二层：证据与定位

**Q：ROW_NUMBER 和 RANK 都做排名，用错了结果不对，怎么定位该用哪个？**

看是否有并列。ROW_NUMBER 永远不重复（1,2,3,4 即使分数相同），RANK 并列后跳号（1,2,2,4），DENSE_RANK 并列不跳号（1,2,2,3）。定位方法：看业务需求——"取每个城市收入 top 3 的司机"，如果有并列第三名是否都要？如果要，用 RANK 或 DENSE_RANK；如果严格取 3 个人，用 ROW_NUMBER。错误使用会导致多取或少取，用 SELECT 看排名列和原始值的对应关系验证。

### 第三层：根因深挖

**Q：开窗函数性能慢，根因是窗口太大还是 PARTITION BY 没设计好？**

两个原因都有。1) PARTITION BY 缺失或粒度太粗——如果没 PARTITION BY，整个表是一个窗口，排序和聚合成本是 O(N log N) 全表；加了 PARTITION BY 按城市分组，每个城市独立计算，可并行且数据量小。2) 窗口范围（ROWS BETWEEN）太大——如果用 ROWS BETWEEN UNBOUNDED PRECEDING AND UNBOUNDED FOLLOWING，每行都要扫全窗口，成本高。根因判断：看执行计划的 partition 数和 sort 操作，partition 少且 sort 全表是性能瓶颈。

**Q：那为什么不直接用 GROUP BY 聚合后再 JOIN 回明细表，而要用开窗函数？**

GROUP BY + JOIN 能实现相同结果，但有两个问题：1) SQL 复杂——要写子查询再 join，可读性差；2) 性能——多一次 join 操作，shuffle 成本高。开窗函数在一次 pass 里完成"分组 + 计算 + 保留明细"，引擎可以优化成单次 sort + 窗口扫描，性能更好。所以能用开窗函数就用，不要 GROUP BY + JOIN 绕。

### 第四层：方案权衡

**Q：ROWS BETWEEN 和 RANGE BETWEEN 怎么选？**

ROWS 是"按物理行"定义窗口，RANGE 是"按逻辑值"定义窗口。ROWS BETWEEN 1 PRECEDING AND 1 FOLLOWING 是"前 1 行到后 1 行"；RANGE BETWEEN 1 PRECEDING AND 1 FOLLOWING 是"值在当前值 ±1 范围内的行"。多数场景用 ROWS（确定性强、性能好）。RANGE 适合"按值范围"的窗口（如"和当前金额相差不超过 100 的订单"），但性能差（要做范围扫描）。经验上 90% 场景用 ROWS。

**Q：为什么不直接在应用层（Python/Java）做这些计算，而要写 SQL 开窗函数？**

数据量决定。亿级数据在数据库/数仓里用开窗函数分布式计算，几分钟搞定；拉到应用层单机处理，内存放不下且慢。SQL 开窗函数是"数据不动计算动"，引擎优化好。应用层计算只适合"小数据量结果集的二次加工"。生产 ETL 倾向 SQL，应用层只做展示和轻量逻辑。

### 第五层：验证与沉淀

**Q：怎么验证开窗函数的结果正确，特别是排名和偏移类？**

构造已知答案的测试集：1) 排名类——构造 5 行已知分数（100, 95, 95, 90, 85），分别验证 ROW_NUMBER（1,2,3,4,5）、RANK（1,2,2,4,5）、DENSE_RANK（1,2,2,3,4）；2) 偏移类——构造已知序列，验证 LAG/LEAD 的值；3) 范围类——构造已知窗口，验证 SUM OVER 的累加值。沉淀为 SQL 窗口函数速查表：每类函数的语义、典型场景、易错点（如 PARTITION BY 和 ORDER BY 的位置）。

## 结构化回答

**30 秒电梯演讲：** 窗口函数能在不聚合行的情况下对"一组相关行"做计算，保留明细同时算聚合/排名/偏移。

**展开框架：**
1. **聚合类** — SUM/AVG/COUNT OVER(PARTITION BY) 保留明细算聚合
2. **排名类** — ROW_NUMBER(连续不重复)/RANK(重复跳号)/DENSE_RANK(重复不跳号)
3. **偏移类** — LAG(取前N行)/LEAD(取后N行)，算环比/同比

**收尾：** 您想深入聊：ROW_NUMBER/RANK/DENSE_RANK 怎么选？


## 视频脚本

> 预计时长：3 分钟 | 由浅入深


| 时间 | 画面/字幕 | 口播台词 | 讲解要点 |
|------|----------|----------|----------|
| 0:00 | 标题卡：开窗函数用过哪些？举个实际场景 | "普通聚合像把全班分数算个平均分（只出一个数），窗口函数像给每个学生旁边贴一列"班级平均分"…" | 开场钩子 |
| 0:20 | 核心概念图 | "窗口函数能在不聚合行的情况下对"一组相关行"做计算，保留明细同时算聚合/排名/偏移。四类：①聚合类(SUM/AVG/…" | 核心定义 |
| 0:55 | 聚合类示意图 | "聚合类——SUM/AVG/COUNT OVER(PARTITION BY) 保留明细算聚合" | 要点拆解1 |
| 1:30 | 对比/实战案例图 | "对比一下常见误区和工程实践，看真实场景里怎么取舍。" | 实战与对比 |
