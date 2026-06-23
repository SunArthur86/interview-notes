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
  - '聚合类：SUM/AVG/COUNT OVER(PARTITION BY) 保留明细算聚合'
  - '排名类：ROW_NUMBER(连续不重复)/RANK(重复跳号)/DENSE_RANK(重复不跳号)'
  - '偏移类：LAG(取前N行)/LEAD(取后N行)，算环比/同比'
  - '分布类：PERCENTILE_RANK/NTILE，分桶/百分位'
  - 'OVER三要素：PARTITION BY(分组)/ORDER BY(排序)/FRAME(行范围)'
first_principle:
  essence: 窗口函数 = 聚合 + 保留明细
  derivation: 普通聚合丢明细 → 需要既看明细又看聚合 → OVER 定义窗口 → 每行算自己窗口的统计 → 明细和聚合共存
  conclusion: 窗口函数是"分组聚合"和"逐行明细"之间的桥梁
follow_up:
- ROW_NUMBER/RANK/DENSE_RANK 怎么选？
- 窗口函数的 FRAME（ROWS/RANGE）有什么区别？
- 窗口函数和子查询哪个性能好？
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
