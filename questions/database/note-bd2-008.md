---
id: note-bd2-008
difficulty: L3
category: database
subcategory: SQL优化
tags:
- 字节
- 面经
- SQL
- MySQL
- 慢查询
- 性能优化
feynman:
  essence: 多表查询优化的核心是减少中间结果集大小，慢查询排查的核心是看执行计划找瓶颈
  analogy: 就像物流配送——多表JOIN是合并多个仓库的货物，优化就是让合并的中间货物尽量少(小表驱动大表)，慢查询排查就是看运输路线图(执行计划)找堵点
  first_principle: 'SQL执行的时间 = 磁盘I/O时间 + CPU计算时间 + 网络传输时间。优化目标是减少这三个维度: 减少扫描行数(I/O)、减少JOIN计算量(CPU)、减少返回数据量(网络)'
  key_points:
  - 'EXPLAIN看执行计划: type/key/rows/Extra四列是关键'
  - '多表JOIN: 小表驱动大表，优先JOIN过滤性强的表'
  - '索引优化: WHERE/JOIN/ORDER BY的列要有索引'
  - '慢查询排查: 慢查询日志→EXPLAIN→优化索引→重写SQL'
first_principle:
  essence: 数据库查询的瓶颈在于磁盘I/O，优化的本质是减少磁盘读取量
  derivation: B+树一次I/O读一页(16KB)，全表扫描100万行需要~7000次I/O，走索引只需要3-4次I/O(树高3-4)。索引将I/O从O(n)降到O(log n)
  conclusion: 'SQL优化的第一性原理: 让查询走索引而非全表扫描'
follow_up:
- 联合索引的最左前缀原则是什么？
- 什么情况下索引会失效？
- 分库分表后多表JOIN怎么做？
memory_points:
- 多表JOIN：优先让小表/结果集驱动大表，必须带上ON条件以避免产生笛卡尔积
- 排查入口：用EXPLAIN看type列，出现ALL（全表扫描）必须加索引优化至range或ref级别
- 执行计划关注点：重点看type确认连表类型，看Extra排查是否出现Using temporary或Using filesort
- 排查步骤：开启慢查询日志定位SQL -> EXPLAIN分析执行计划 -> 针对性建索引或重写SQL驱动顺序
---

# SQL多表查询优化和慢查询排查

## 多表查询优化策略

### 策略1: 小表驱动大表

```sql
-- ❌ 错误: 大表驱动小表 (扫描order的100万行)
SELECT * FROM orders o
JOIN users u ON o.user_id = u.id
WHERE u.status = 'active';  -- users表只有100行active用户

-- ✅ 正确: 小表驱动大表 (先过滤users到100行，再用这100行去查orders)
SELECT o.* FROM (
    SELECT id FROM users WHERE status = 'active'  -- 先得到100个user_id
) u
JOIN orders o ON o.user_id = u.id;
-- MySQL优化器通常会自动选择小表做驱动表
```

### 策略2: JOIN顺序优化

```sql
-- 3表JOIN: 选择过滤性最强的表作为基准
-- 假设: orders(1000万), users(10万), products(1万)
-- 条件: orders.status='paid' (过滤到100万), products.category='电子'(过滤到1000)

-- ✅ 最优JOIN顺序: 先过滤再JOIN
SELECT o.id, u.name, p.name
FROM products p                          -- 1万 → 过滤到1000
JOIN order_items oi ON oi.product_id = p.id  -- 1000 → 关联到1万订单项
JOIN orders o ON o.id = oi.order_id AND o.status = 'paid'  -- 1万 → 过滤到1千
JOIN users u ON u.id = o.user_id         -- 1000 → 关联到1千用户
WHERE p.category = '电子产品';
```

### 策略3: 避免笛卡尔积

```sql
-- ❌ 缺少JOIN条件，产生笛卡尔积 (A×B×C行)
SELECT * FROM table_a, table_b, table_c;

-- ❌ 隐式笛卡尔积
SELECT * FROM orders o, users u WHERE o.status = 'paid';
-- 缺少 o.user_id = u.id，会生成 orders × users 行!

-- ✅ 必须有JOIN条件
SELECT * FROM orders o
JOIN users u ON o.user_id = u.id
WHERE o.status = 'paid';
```

## 慢查询排查流程

```
┌─────────────────────────────────────────────┐
│           慢查询排查五步法                     │
│                                             │
│  Step 1: 开启慢查询日志，收集慢SQL            │
│     ↓                                       │
│  Step 2: EXPLAIN分析执行计划                 │
│     ↓                                       │
│  Step 3: 定位瓶颈(全表扫描/临时表/文件排序)   │
│     ↓                                       │
│  Step 4: 优化(加索引/改SQL/改架构)           │
│     ↓                                       │
│  Step 5: 验证优化效果                        │
└─────────────────────────────────────────────┘
```

### Step 1: 开启慢查询日志

```sql
-- 查看慢查询配置
SHOW VARIABLES LIKE 'slow_query%';
SHOW VARIABLES LIKE 'long_query_time';

-- 开启慢查询日志 (记录执行>1秒的SQL)
SET GLOBAL slow_query_log = 'ON';
SET GLOBAL long_query_time = 1;
SET GLOBAL slow_query_log_file = '/var/log/mysql/slow.log';

-- 也可以用 pt-query-digest 分析慢查询日志
-- pt-query-digest /var/log/mysql/slow.log | head -50
```

### Step 2: EXPLAIN 执行计划

```sql
EXPLAIN SELECT * FROM orders 
WHERE user_id = 123 AND status = 'paid' 
ORDER BY created_at DESC LIMIT 20;
```

| 列 | 值 | 含义 | 是否需要优化 |
|---|---|------|------------|
| type | **ALL** | 全表扫描 | ❌ 必须优化 |
| type | index | 全索引扫描 | ⚠️ 可能需要 |
| type | range | 索引范围扫描 | ✅ 正常 |
| type | ref | 索引等值查找 | ✅ 好 |
| type | eq_ref | 唯一索引JOIN | ✅ 很好 |
| type | const | 主键/唯一索引 | ✅ 最优 |
| key | NULL | 没用索引 | ❌ 必须优化 |
| rows | 1000000 | 预估扫描行数 | ⚠️ 越少越好 |
| Extra | **Using filesort** | 文件排序 | ❌ 需要优化 |
| Extra | **Using temporary** | 临时表 | ❌ 需要优化 |
| Extra | Using index | 覆盖索引 | ✅ 最优 |

### Step 3: 常见瓶颈和解决方案

```sql
-- 瓶颈1: 全表扫描 (type=ALL)
-- 原因: WHERE条件列没有索引
-- 解决: 加索引

-- ❌ 慢: status无索引，扫描100万行
SELECT * FROM orders WHERE status = 'paid';

-- ✅ 快: 加索引后只扫描相关行
CREATE INDEX idx_status ON orders(status);

-- 瓶颈2: 文件排序 (Using filesort)
-- 原因: ORDER BY的列没有索引或索引顺序不对
-- 解决: 加联合索引

-- ❌ 慢: ORDER BY走文件排序
SELECT * FROM orders WHERE user_id = 123 ORDER BY created_at DESC;

-- ✅ 快: 联合索引(user_id, created_at)
CREATE INDEX idx_user_created ON orders(user_id, created_at DESC);

-- 瓶颈3: 临时表 (Using temporary)
-- 原因: GROUP BY/DISTINCT没有索引
-- 解决: 给GROUP BY列加索引

-- ❌ 慢: GROUP BY产生临时表
SELECT category, COUNT(*) FROM products GROUP BY category;

-- ✅ 快: 给category加索引
CREATE INDEX idx_category ON products(category);
```

### Step 4: 索引优化实战

```sql
-- 联合索引最左前缀原则
CREATE INDEX idx_composite ON orders(user_id, status, created_at);

-- ✅ 能用到索引:
WHERE user_id = 123                           -- 用到user_id
WHERE user_id = 123 AND status = 'paid'       -- 用到user_id, status
WHERE user_id = 123 AND status = 'paid' 
  AND created_at > '2024-01-01'               -- 全部用到

-- ❌ 用不到索引(违反最左前缀):
WHERE status = 'paid'                         -- 跳过了user_id
WHERE created_at > '2024-01-01'              -- 跳过了user_id和status
WHERE user_id = 123 AND created_at > '2024'   -- status断裂，created_at用不到

-- 索引失效的场景:
WHERE LEFT(name, 3) = 'abc'   -- 函数操作 → 失效
WHERE name LIKE '%abc'        -- 左模糊 → 失效 (右模糊'abc%'可以)
WHERE age + 1 = 18            -- 运算 → 失效
WHERE name = 123              -- 隐式类型转换(字符串vs数字) → 失效
WHERE status IS NOT NULL      -- IS NOT NULL可能不走索引
```

## 优化效果对比

| 优化手段 | 优化前 | 优化后 | 提升 |
|---------|--------|--------|------|
| 加索引(全表→索引) | 3000ms | 5ms | 600× |
| 联合索引(覆盖排序) | 800ms | 3ms | 267× |
| 子查询改JOIN | 1200ms | 50ms | 24× |
| 限制返回行数(LIMIT) | 2000ms | 100ms | 20× |
| 分页优化(深分页) | 5000ms | 10ms | 500× |

```sql
-- 深分页优化
-- ❌ 慢: OFFSET越大越慢 (需要扫描前面所有行)
SELECT * FROM orders ORDER BY id LIMIT 1000000, 20;

-- ✅ 快: 用游标分页 (直接定位)
SELECT * FROM orders WHERE id > 1000000 
ORDER BY id LIMIT 20;
```

## 记忆要点

- 多表JOIN：优先让小表/结果集驱动大表，必须带上ON条件以避免产生笛卡尔积
- 排查入口：用EXPLAIN看type列，出现ALL（全表扫描）必须加索引优化至range或ref级别
- 执行计划关注点：重点看type确认连表类型，看Extra排查是否出现Using temporary或Using filesort
- 排查步骤：开启慢查询日志定位SQL -> EXPLAIN分析执行计划 -> 针对性建索引或重写SQL驱动顺序


## 苏格拉底式面试追问

> 这组追问模拟面试官层层逼问，每一问先回答"为什么"，再回答"怎么做"，最后回答"如何证明"。

### 第一层：目标与动机

**Q：多表 JOIN 你说"让小表驱动大表"，为什么驱动表的大小会影响性能？本质是什么？**

本质是"嵌套循环的次数"。JOIN 的本质是 Nested Loop Join（NLJ）：驱动表的每一行去被驱动表里找匹配。如果驱动表 N 行、被驱动表 M 行，循环次数是 N（每次在 M 里查，靠索引的话 O(logM)）。驱动表越小，N 越小，外层循环越少，总 IO 和 CPU 越少。MySQL 的 Block Nested Loop（BNL）优化会先把驱动表（或其 chunk）读入 join buffer，再扫被驱动表匹配，减少被驱动表的扫描次数。但核心仍是"驱动表越小，join buffer 装得下，被驱动表扫一次就够"。所以"小表驱动大表"的本质是减少外层循环 + 提高 join buffer 命中率。EXPLAIN 里看驱动表是第一个（id=1 的表的 rows），rows 小的当驱动表更优。

### 第二层：证据与定位

**Q：线上一条 JOIN 查询从 10ms 飙到 10 秒，你怎么用 EXPLAIN 定位是索引失效还是驱动顺序错了？**

看 EXPLAIN 输出的四个关键列：一、`type`——出现 ALL（全表扫描）说明索引失效，必须加索引；二、`rows`——单表的扫描行数，如果某表 rows 是百万级，说明没走索引或索引选择性差；三、`Extra`——`Using join buffer (Block Nested Loop)` 说明走 BNL（没索引可用，被迫块嵌套循环，慢），`Using index` 说明覆盖索引（快）；四、驱动表顺序——EXPLAIN 输出第一行（id=1）是驱动表，如果它是大表（rows 大），驱动顺序错了。综合判断：如果大表当驱动表 + BNL，是双重灾难；如果小表驱动 + 走索引（type=ref/range），是正常配置。修复：加索引消除 ALL、用 STRAIGHT_JOIN 强制驱动顺序（谨慎用）、或重写 SQL 让优化器选对。

### 第三层：根因深挖

**Q：EXPLAIN 显示 `Using filesort`，你说是排序没走索引，根因是什么？什么情况会触发 filesort？**

filesort 意味着 MySQL 无法用索引的有序性来满足 ORDER BY，必须在内存（或磁盘）里额外排序。触发条件：一、ORDER BY 的列不在索引里——如 `ORDER BY create_time` 但 create_time 没建索引；二、多列索引但顺序不匹配——索引 (a, b)，`ORDER BY b`（跳过了 a，无法用索引有序性）；三、混合 ASC/DESC——索引 (a, b) 默认同序，`ORDER BY a ASC, b DESC` 在 MySQL 8.0 前无法用索引（8.0 支持降序索引）；四、函数操作——`ORDER BY UPPER(name)` 破坏索引。根因都是"排序所需的有序性在索引里拿不到"。filesort 的代价：小结果集在内存排（sort_buffer_size 内）较快，大结果集溢出到磁盘排，极慢（临时文件 IO）。解决：建合适的索引让 ORDER BY 走索引，或缩小结果集（加 LIMIT）。

**Q：那为什么不直接禁用 filesort，强制所有排序走索引？**

不能一概而论。有些排序天然无法走索引：一、聚合后排序——`ORDER BY COUNT(*)`（结果不是表数据，是计算值）；二、UNION 后排序——合并结果无原表索引；三、表达式排序——`ORDER BY a + b`。这些场景必须 filesort。强制建索引覆盖所有 ORDER BY 场景会导致索引膨胀（每个查询一个索引），写入变慢（每次 INSERT 要维护多个索引）。所以工程上权衡：高频查询的 ORDER BY 建索引覆盖（如列表页按时间倒序），低频查询允许 filesort（如报表的复杂排序）。判断标准是"这条查询的 QPS × filesort 耗时"，高频慢查询必优化，低频慢查询可容忍。用 `slow_query_log` 抓真实慢查询，针对性优化，不要盲目给所有列建索引。

### 第四层：方案权衡

**Q：JOIN 三个表查询很慢，你考虑拆成多次单表查询在应用层 JOIN，这个取舍怎么定？**

取舍看"JOIN 能否走索引"和"数据量"。如果三个表都有合适索引、JOIN 条件命中索引、结果集不大（< 1000 行），数据库 JOIN 一次完成最快（避免多次网络往返）。如果某个 JOIN 走不了索引（被迫 BNL）或结果集巨大（百万行），拆成应用层 JOIN 可能更快——先查小表（带索引），拿到 ID 列表再 IN 查大表，每步走索引。权衡：数据库 JOIN 简单（一条 SQL）但受限于优化器决策；应用层 JOIN 灵活（可控制每步）但代码复杂、网络往返多。我的实践：默认用数据库 JOIN（简单），只有遇到"JOIN 性能差且优化器调不好"或"需要跨不同数据源"时才拆应用层。不要为了"拆而拆"，那是过度设计。

**Q：为什么 MySQL 优化器有时选错驱动表（大表驱动小表）？怎么纠正？**

优化器基于成本估算选驱动表，估算可能不准：一、统计信息过期——`ANALYZE TABLE` 更新统计信息，优化器按旧统计选错；二、JOIN 条件复杂——多条件 OR、函数操作让优化器无法准确估算行数；三、直方图缺失（MySQL 8.0+ 有 histogram）——列值分布不均时，优化器估算偏差大。纠正手段：一、`ANALYZE TABLE` 刷新统计；二、`STRAIGHT_JOIN` 强制驱动顺序（`SELECT * FROM small STRAIGHT_JOIN big WHERE ...`），但慎用（表数据变化后可能又错）；三、给 JOIN 列建索引让优化器选 ref 而非 ALL；四、加 hint `/*+ JOIN_ORDER(a, b, c) */`（8.0+）。根治是保持统计信息新鲜 + 索引齐全，让优化器大概率选对。

### 第五层：验证与沉淀

**Q：你怎么验证 SQL 优化（加索引、改 JOIN 顺序）真的有效，不只是碰巧当时数据少？**

三步验证：一、EXPLAIN 对比——优化前后看 type、rows、Extra 的变化，rows 应显著下降（如从百万降到千）；二、基准测试——用 `sysbench` 或 JMeter 压优化前后 SQL，对比 P50/P99 延迟和 QPS，数据要稳定（跑 5 分钟以上）；三、流量回放——从生产抓取真实查询（slow log 或 packet capture），在测试库回放，对比耗时分布。注意控制变量：测试库数据量要接近生产（用脱敏数据导入），否则优化效果失真。线上灰度：先在从库或影子库验证，确认无副作用（如索引建错导致写入变慢）再上生产。监控：上线后持续看该 SQL 的平均耗时和慢查询次数，应持续走低。如果上线初期快、几天后又慢，可能是数据增长导致索引选择性下降，要复盘。

**Q：这道题做完，你沉淀出了什么可复用的 SQL 排查方法论？**

排查五步法：一、慢查询日志定位——`long_query_time=0.1` 抓所有慢 SQL，按"次数×耗时"排序找 TOP；二、EXPLAIN 分析——看 type（ALL 要优化）、rows（过大要优化）、Extra（filesort/using temporary 要优化）；三、索引优化——给 WHERE/JOIN/ORDER BY 列建合适索引，注意最左前缀和选择性；四、SQL 重写——避免 SELECT *、避免函数操作索引列、用 JOIN 替代子查询；五、架构优化——单表数据过大考虑分表、读多写少加缓存、复杂分析上 OLAP（如 ClickHouse）。这套方法论固化成团队的 SQL 上线 checklist，所有新 SQL 必须 EXPLAIN 通过（type ≥ range）才能上线。


## 结构化回答

**30 秒电梯演讲：** 多表查询优化的核心是减少中间结果集大小，慢查询排查的核心是看执行计划找瓶颈。

**展开框架：**
1. **多表JOIN** — 优先让小表/结果集驱动大表，必须带上ON条件以避免产生笛卡尔积
2. **排查入口** — 用EXPLAIN看type列，出现ALL（全表扫描）必须加索引优化至range或ref级别
3. **执行计划关注点** — 重点看type确认连表类型，看Extra排查是否出现Using temporary或Using filesort

**收尾：** 这块我踩过坑——要不要深入聊：联合索引的最左前缀原则是什么？

## 视频脚本

> 预计时长：3 分钟 | 由浅入深

| 时间 | 画面/字幕 | 口播台词 | 讲解要点 |
|------|----------|----------|----------|
| 0:00 | 标题卡 | "SQL优化一句话：多表查询优化的核心是减少中间结果集大小，慢查询排查的核心是看执行计划找瓶颈。" | 开场钩子 |
| 0:15 | SQL 执行计划截图 | "多表JOIN：优先让小表/结果集驱动大表，必须带上ON条件以避免产生笛卡尔积" | 多表JOIN |
| 1:06 | SQL 执行计划截图分步演示 | "排查入口：用EXPLAIN看type列，出现ALL（全表扫描）必须加索引优化至range或ref级别" | 排查入口 |
| 1:57 | 关键代码/伪代码片段 | "执行计划关注点：重点看type确认连表类型，看Extra排查是否出现Using temporary或Using fi…" | 执行计划关注点 |
| 2:50 | 总结卡 | "核心抓住这条主线，下期咱们接着聊：联合索引的最左前缀原则是什么。" | 收尾 |
