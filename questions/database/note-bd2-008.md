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
  essence: '多表查询优化的核心是减少中间结果集大小，慢查询排查的核心是看执行计划找瓶颈'
  analogy: '就像物流配送——多表JOIN是合并多个仓库的货物，优化就是让合并的中间货物尽量少(小表驱动大表)，慢查询排查就是看运输路线图(执行计划)找堵点'
  first_principle: 'SQL执行的时间 = 磁盘I/O时间 + CPU计算时间 + 网络传输时间。优化目标是减少这三个维度: 减少扫描行数(I/O)、减少JOIN计算量(CPU)、减少返回数据量(网络)'
  key_points:
    - 'EXPLAIN看执行计划: type/key/rows/Extra四列是关键'
    - '多表JOIN: 小表驱动大表，优先JOIN过滤性强的表'
    - '索引优化: WHERE/JOIN/ORDER BY的列要有索引'
    - '慢查询排查: 慢查询日志→EXPLAIN→优化索引→重写SQL'
first_principle:
  essence: '数据库查询的瓶颈在于磁盘I/O，优化的本质是减少磁盘读取量'
  derivation: 'B+树一次I/O读一页(16KB)，全表扫描100万行需要~7000次I/O，走索引只需要3-4次I/O(树高3-4)。索引将I/O从O(n)降到O(log n)'
  conclusion: 'SQL优化的第一性原理: 让查询走索引而非全表扫描'
follow_up:
  - '联合索引的最左前缀原则是什么？'
  - '什么情况下索引会失效？'
  - '分库分表后多表JOIN怎么做？'
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
