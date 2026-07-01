---
id: note-sz-003
difficulty: L3
category: ai
subcategory: 数据工程
tags:
- 神州专车
- 面经
- SQL
- 连续登录
- 窗口函数
feynman:
  essence: 找连续7天登录的司机ID，核心思路是利用"连续日期-序号=恒定值"的特征分组。三种主流写法：①ROW_NUMBER()差值法（用登录日期的序号减行号，连续天会得到相同分组键）②LEAD/LAG判断相邻法 ③自连接法（性能差不推荐）。最优是 ROW_NUMBER 差值法——简洁高效且易扩展到"连续N天"。
  analogy: 像查谁连续打卡7天——给每天的打卡编个流水号（行号），再把日期转成数字序号。如果一个人连续打卡，日期序号和行号的差值会一直不变（因为两个都每天+1）；一旦断了一天，差值就变了。相同差值的连续打卡归为一组，数每组有几天就行。
  first_principle: 连续的数学特征是"等差数列"。日期是自然序（每天+1），连续登录的行号也是等差（+1），两者相减得到恒定分组键。利用这个不变量就能把"连续"转化成"分组"。
  key_points:
  - 核心：连续日期的"日期序号 - 行号 = 恒定分组键"
  - ROW_NUMBER差值法：用date减row_number得grp，group by grp having count>=7
  - LEAD/LAG法：判断相邻日期差是否=1
  - 自连接法不推荐（O(n²)性能差）
  - 易扩展：改having count的数字即可改成连续N天
first_principle:
  essence: 连续 = 等差数列的不变量
  derivation: 连续日期是等差(差1) → 连续登录的行号也等差(差1) → 两个等差数列相减得常数 → 用常数做分组键 → 每组就是一段连续
  conclusion: 把"连续判断"转化成"分组计数"，用 SQL 窗口函数优雅实现
follow_up:
- 如果要找"连续登录至少N天且期间不能有一天中断"，怎么改？
- 如果登录时间精确到秒，怎么按天去重？
- ROW_NUMBER、RANK、DENSE_RANK 区别？什么时候用哪个？
memory_points:
- 核心口诀：日期减去行号等于相同分组键（DATE - ROW_NUMBER = Grp）
- 因连续日期递增与行号递增相减得常数，断线则常数变，借此巧妙分组
- 通用解题框架：先DISTINCT去重，再用窗口打行号，最后GroupBy并Having判定大于等于N天
---

# 【神州专车面经】手写 SQL：找出连续7天都有登录的司机ID

## 一、最优解：ROW_NUMBER 差值法

```sql
WITH login_days AS (
  -- 去重：每个司机每天只留一条
  SELECT DISTINCT driver_id, DATE(login_time) AS login_date
  FROM driver_login_log
),
with_grp AS (
  -- 关键：日期序号 - 行号 = 分组键
  SELECT 
    driver_id,
    login_date,
    ROW_NUMBER() OVER(
      PARTITION BY driver_id ORDER BY login_date
    ) AS rn,
    -- 用日期减行号，连续登录会得到相同的 grp
    DATE_SUB(login_date, rn) AS grp   -- Hive/Spark: date_sub(date, n)
    -- MySQL/PG: DATE_SUB(login_date, INTERVAL rn DAY)
  FROM login_days
)
SELECT driver_id
FROM with_grp
GROUP BY driver_id, grp
HAVING COUNT(*) >= 7;   -- 连续7天
```

> **语法注意**：
> - Hive / Spark SQL：`date_sub(date, n)`（第二个参数直接是 int）
> - MySQL / PostgreSQL：`DATE_SUB(date, INTERVAL n DAY)`
> - 面试时按对方技术栈写，先声明用的是哪个 SQL 方言

### 为什么有效

```
driver_id  login_date  row_num  grp(=date - row_num)
A          2026-06-01  1        2026-05-31
A          2026-06-02  2        2026-05-31   ← 连续，grp 相同
A          2026-06-03  3        2026-05-31
A          2026-06-10  4        2026-06-06   ← 断了，grp 变
A          2026-06-11  5        2026-06-06
```

连续登录期间，日期每天+1，行号也+1，相减得常数；一旦断了，日期跳跃，grp 变化。

`GROUP BY driver_id, grp HAVING COUNT(*) >= 7` 即可找出连续≥7天的。

## 二、解法二：LEAD/LAG 判断相邻

```sql
WITH login_days AS (
  SELECT DISTINCT driver_id, DATE(login_time) AS login_date
  FROM driver_login_log
),
with_next AS (
  SELECT 
    driver_id, login_date,
    LEAD(login_date) OVER(PARTITION BY driver_id ORDER BY login_date) AS next_date
  FROM login_days
)
-- 判断相邻日期差是否=1（连续），再统计连续段长度
-- 这个方法更复杂，需要递归或多次窗口，不如差值法简洁
```

**不推荐**：判断相邻后还要分段统计，逻辑比差值法复杂。

## 三、解法三：自连接（不推荐）

```sql
SELECT DISTINCT a.driver_id
FROM login_days a
JOIN login_days b ON a.driver_id=b.driver_id 
  AND b.login_date = DATE_ADD(a.login_date, INTERVAL 1 DAY)
JOIN login_days c ON ...  -- 连续 join 6 次
```

**不推荐**：O(n²) 性能差，且要 join N-1 次才能找连续 N 天，代码冗长。

## 四、ROW_NUMBER / RANK / DENSE_RANK 区别

```sql
-- 数据：[10, 10, 30]
ROW_NUMBER(): 1, 2, 3      -- 不重复（10 和 10 强行分先后）
RANK():       1, 1, 3      -- 重复且跳号（两个第1，下一个第3）
DENSE_RANK(): 1, 1, 2      -- 重复不跳号（两个第1，下一个第2）
```

本题用 **ROW_NUMBER**（要保证每行唯一序号，差值才正确）。如果用 RANK/DENSE_RANK，相同日期会得到相同行号，差值法失效。

## 五、易扩展性

```sql
-- 连续 7 天 → 连续 N 天，只需改 having
HAVING COUNT(*) >= N;

-- 加约束：连续期间不能中断（默认就是，因为 grp 变化就分段了）

-- 找"最近30天内连续7天登录"：加 where 过滤
WHERE login_date >= DATE_SUB(CURRENT_DATE, INTERVAL 30 DAY)
```

## 六、加分点

- 先 `SELECT DISTINCT` 去重（一个司机一天登录多次只算一天）
- 用 `DATE(login_time)` 把时间戳截到天
- 说出"日期序号 - 行号 = 不变量"的数学直觉
- 提到 Hive/Spark SQL 的 `DATE_SUB` 语法，MySQL 用 `DATE_SUB(date, INTERVAL n DAY)`，PostgreSQL 用 `date - integer`

## 七、雷区

- ❌ 不去重直接算 → 一个司机一天登录 10 次，连续 1 天就被算成 10
- ❌ 用 RANK/DENSE_RANK → 相同日期得相同行号，差值法失效
- ❌ 用自连接找连续 7 天 → 性能差且代码冗长

## 八、扩展

- **跨月连续**：DATE_SUB 处理跨月没问题（数据库自动算），不用担心
- **允许中断1天**：用 LEAD 看下一个日期差 ≤2 的归为同组（更复杂的业务规则）
- **滑动窗口版**：用 SUM(1) OVER(ORDER BY date RANGE BETWEEN 6 PRECEDING AND CURRENT ROW) 判断窗口内是否满 7 天

## 记忆要点

- 核心口诀：日期减去行号等于相同分组键（DATE - ROW_NUMBER = Grp）
- 因连续日期递增与行号递增相减得常数，断线则常数变，借此巧妙分组
- 通用解题框架：先DISTINCT去重，再用窗口打行号，最后GroupBy并Having判定大于等于N天

