---
id: note-sz-004
difficulty: L4
category: ai
subcategory: 数据工程
tags:
- 神州专车
- 面经
- Spark
- 数据倾斜
- Shuffle
feynman:
  essence: 数据倾斜本质是 Shuffle 阶段某个 key 的数据量远超其他，导致少数 task 处理巨量数据而其他 task 空闲。三类常见 key：①空值/null key ②热点业务 key（如某大V用户ID）③GroupBy 的高频 key。解法按场景：空值→过滤或加随机前缀打散；热点 key→加盐（salting，加随机前缀打散再聚合）；GroupBy→两阶段聚合（先局部聚合打散，再全局聚合）。
  analogy: 像超市结账——1000 个顾客里 999 个买几件东西，1 个买了整车。如果按"顾客ID"分到不同收银台，那个买整车的收银台排队1小时，其他收银台闲死。解法：把那个大客户的商品拆到多个收银台（加盐打散），最后再合并。
  first_principle: 分布式计算的瓶颈是最慢的 task。Shuffle 按 key 分配，key 数据量不均导致 task 负载不均。倾斜解法的本质是"打散热点 key 再聚合"，用两阶段换负载均衡。
  key_points:
  - '倾斜本质：Shuffle 时某 key 数据量远超其他，少数 task 成为瓶颈'
  - '三类常见key：空值/null、热点业务key(大V用户ID)、GroupBy高频key'
  - '空值解法：过滤掉 或 用随机值打散'
  - '热点key解法：加盐(salting)加随机前缀打散，两阶段聚合'
  - 'GroupBy倾斜：两阶段聚合（局部+全局）'
first_principle:
  essence: 倾斜 = Shuffle key 不均 → task 负载不均
  derivation: 分布式按 key 分区 → 某 key 数据量是其他100倍 → 该分区task成为瓶颈 → 解法是打散key再聚合 → 用两阶段换负载均衡
  conclusion: 倾斜不可消除（业务决定 key 分布），但可以通过"打散+聚合"把瓶颈从"单task"摊到"多task"
follow_up:
- 怎么定位是哪个 key 倾斜？
- 加盐后聚合结果怎么保证正确？
- MapJoin 适合什么场景？
---

# 【神州专车面经】数据倾斜怎么处理？

## 一、倾斜的本质

```
Shuffle 阶段按 key 分配到不同 task/reducer：
  task 1: key=A → 100 条
  task 2: key=B → 80 条
  task 3: key=C → 1000000 条  ← 倾斜！这个 task 跑 2 小时，其他 2 分钟
```

**现象**：任务卡在 99%，少数 task 运行极慢，其他 task 早已完成。

**根因**：某 key 数据量是其他的几十上百倍。

## 二、三类常见倾斜 key

| 类型 | 例子 | 场景 |
|------|------|------|
| **空值/null key** | user_id 为 null 的日志 | 日志缺失字段 |
| **热点业务 key** | 大V用户ID、热门商品ID | join 时热点用户 |
| **GroupBy 高频 key** | 某城市订单量是其他10倍 | GroupBy 城市 |

## 三、解法一：空值倾斜——过滤或打散

```sql
-- 方案A：直接过滤（如果空值无业务意义）
SELECT * FROM A JOIN B ON A.id = B.id 
WHERE A.id IS NOT NULL;

-- 方案B：给空值随机值打散（如果需要保留）
SELECT * FROM A 
JOIN B ON CASE WHEN A.id IS NULL THEN CONCAT('null_', RAND()) ELSE A.id END = B.id;
```

## 四、解法二：热点 key 倾斜——加盐（Salting）

**两阶段加盐**：

```
[阶段1] 给热点 key 加随机前缀打散
  原 key: user_001 (100万条)
  加盐后: user_001_0 (20万), user_001_1 (20万), ..., user_001_4 (20万)
  → join（此时每个加盐 key 数据量均匀）

[阶段2] 去掉前缀再聚合
  把 user_001_0~4 合并回 user_001
```

```sql
-- Spark SQL 示例
-- 阶段1：热点表加随机前缀，大表对应扩 N 倍
WITH salted_hot AS (
  SELECT CONCAT(user_id, '_', CAST(FLOOR(RAND()*10) AS STRING)) AS salted_id, *
  FROM hot_table  -- 热点表（小表）
),
expanded_big AS (
  SELECT CONCAT(user_id, '_', explode_key) AS salted_id, *
  FROM big_table
  LATERAL VIEW explode(array('0','1','2',...,'9')) t AS explode_key
)
SELECT * FROM expanded_big JOIN salted_hot ON expanded_big.salted_id = salted_hot.salted_id;
```

## 五、解法三：GroupBy 倾斜——两阶段聚合

```sql
-- 阶段1：局部聚合（加随机key打散）
WITH stage1 AS (
  SELECT 
    CONCAT(city, '_', CAST(FLOOR(RAND()*10) AS STRING)) AS grp,
    order_type,
    COUNT(*) AS cnt
  FROM orders
  GROUP BY CONCAT(city, '_', CAST(FLOOR(RAND()*10) AS STRING)), order_type
)
-- 阶段2：全局聚合（去掉随机key）
SELECT 
  SUBSTR(grp, 1, LENGTH(grp)-2) AS city,  -- 去掉 _随机数
  order_type,
  SUM(cnt) AS total_cnt
FROM stage1
GROUP BY SUBSTR(grp, 1, LENGTH(grp)-2), order_type;
```

**为什么两阶段**：阶段1 用随机 key 把热点城市打散到多个 task（局部聚合），阶段2 数据量已大幅减少，再做全局聚合不会倾斜。

## 六、解法四：MapJoin（小表广播）

如果倾斜是 join 时一方表很小（如维度表）：

```sql
-- Spark：小表 < 广播阈值时自动 MapJoin
SET spark.sql.autoBroadcastJoinThreshold=10485760;  -- 10MB

-- 或显式提示
SELECT /*+ BROADCAST(dim_table) */ * 
FROM fact_table JOIN dim_table ON fact_table.id = dim_table.id;
```

**原理**：把小表广播到所有 executor，在 map 端直接 join，**不走 shuffle**，天然无倾斜。

## 七、怎么定位是哪个 key 倾斜

```sql
-- 查看 Spark UI 的 SQL 页，找最慢的 stage
-- 然后：
SELECT key, COUNT(*) AS cnt 
FROM skew_table 
GROUP BY key 
ORDER BY cnt DESC 
LIMIT 10;
-- cnt 远超均值的 key 就是倾斜 key
```

或在 Spark UI 看 **Task Metrics**，找处理数据量远超均值的 task，看它处理的 key。

## 八、加分点

- 说出 **倾斜不可消除**（业务决定 key 分布），只能缓解
- 说出 **加盐的正确性**：阶段1 聚合时加盐 key 互不干扰，阶段2 去盐后 SUM 能还原（因为 COUNT/SUM 可加）
- 说出 **MapJoin 的限制**：只适合小表（<广播阈值，通常 10MB）

## 九、雷区

- ❌ "直接调大 reducer 数" → 治标不治本，倾斜 key 还是落在一个 reducer
- ❌ "加盐但不做两阶段" → 结果错误（加盐后 key 不同，聚合分散）
- ❌ "所有 join 都用 MapJoin" → 大表 join 大表 MapJoin 会 OOM

## 十、扩展

- **Skew Join（自适应倾斜处理）**：Spark 3.0 的 AQE（自适应查询执行）能自动检测倾斜并拆分，开启 `spark.sql.adaptive.skewJoin.enabled=true`
- **倾斜监控**：在任务里加 metric，监控各 task 处理数据量的标准差，超阈值告警
- **业务侧规避**：和业务方沟通，热点 key 提前预聚合或拆分（如大V单独走链路）
