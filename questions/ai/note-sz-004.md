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
  - 倾斜本质：Shuffle 时某 key 数据量远超其他，少数 task 成为瓶颈
  - 三类常见key：空值/null、热点业务key(大V用户ID)、GroupBy高频key
  - 空值解法：过滤掉 或 用随机值打散
  - 热点key解法：加盐(salting)加随机前缀打散，两阶段聚合
  - GroupBy倾斜：两阶段聚合（局部+全局）
first_principle:
  essence: 倾斜 = Shuffle key 不均 → task 负载不均
  derivation: 分布式按 key 分区 → 某 key 数据量是其他100倍 → 该分区task成为瓶颈 → 解法是打散key再聚合 → 用两阶段换负载均衡
  conclusion: 倾斜不可消除（业务决定 key 分布），但可以通过"打散+聚合"把瓶颈从"单task"摊到"多task"
follow_up:
- 怎么定位是哪个 key 倾斜？
- 加盐后聚合结果怎么保证正确？
- MapJoin 适合什么场景？
memory_points:
- 本质是Shuffle时某Key数据量极大，导致99%任务完成而个别Task极慢
- 空值倾斜直接过滤或赋予随机Key打散，小表Join倾斜用MapJoin广播避免Shuffle
- 热点Key倾斜用加盐法（扩容加随机前缀），GroupBy倾斜用两阶段聚合（局部加全局）
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

## 记忆要点

- 本质是Shuffle时某Key数据量极大，导致99%任务完成而个别Task极慢
- 空值倾斜直接过滤或赋予随机Key打散，小表Join倾斜用MapJoin广播避免Shuffle
- 热点Key倾斜用加盐法（扩容加随机前缀），GroupBy倾斜用两阶段聚合（局部加全局）


## 苏格拉底式面试追问

> 这组追问模拟面试官层层逼问，每一问先回答"为什么"，再回答"怎么做"，最后回答"如何证明"。

### 第一层：目标与动机

**Q：数据倾斜为什么要单独处理，而不是加资源（加机器）硬扛？**

加机器解决不了倾斜。倾斜的本质是"数据分布不均"，少数 key 占了 90% 数据量，reduce 阶段这几个 key 落在少数几个 task 上，其他 task 空闲等待。加机器只是多了空闲 task，瓶颈 task 仍然慢。加资源是"扩大分母"，但分子（倾斜 key 的数据量）没变。必须从"数据分布"层面解决——打散倾斜 key 或改变聚合策略。这是分布式计算的木桶效应，短板决定整体。

### 第二层：证据与定位

**Q：Spark 任务卡在 reduce 阶段，怎么确认是数据倾斜而不是任务本身计算量大？**

看 Spark UI 的 stage 详情：1) 如果是倾斜，reduce task 的耗时分布极不均匀——少数 task 耗时是平均值的 10x+，且这些 task 处理的记录数远超平均；2) 如果是计算量大，所有 task 耗时都长且均匀。具体看 task 的 "duration" 和 "shuffle read records" 列，倾斜的标志是"少数 task 的 shuffle read 是平均的 10-100 倍"。

### 第三层：根因深挖

**Q：倾斜的 key 是某大 V 的 user_id，根因是数据本身热点还是业务设计问题？**

两者兼有，但业务设计可以缓解。数据热点是客观的（大 V 确实活跃），但"用 user_id 做 group by key"是设计选择。根因是"高基数 key 被选为 shuffle key"。解法：1) 局部聚合——先在每个 map task 内按 user_id 局部聚合，减少 shuffle 数据量；2) 加盐打散——给 user_id 加随机前缀（如 user_id + "_" + rand(0,9)）拆成 10 个 key，分散到 10 个 reduce task，最后再合并。本质是"用随机性打破热点"。

**Q：那为什么不直接用 combiner（map 端预聚合），而要搞加盐这么复杂？**

combiner 适合"可结合的聚合"（如 SUM、COUNT、MAX），map 端预聚合后再 shuffle，数据量大幅减少。但 combiner 对倾斜的缓解有限——即使 combiner 后，大 V 的 user_id 仍然是一个 key，shuffle 后还是落在一个 reduce task。combiner 减少的是"shuffle 数据量"，不改变"key 的分布"。加盐直接改变 key 的分布，把一个热 key 拆成多个，是治本。combiner + 加盐可以组合用。

### 第四层：方案权衡

**Q：两阶段聚合（先打散局部聚合，再全局聚合）vs 加盐，怎么选？**

两阶段聚合适合"聚合类操作"（SUM/COUNT/AVG）——第一阶段用加盐 key 局部聚合，第二阶段去掉盐做全局聚合，结果正确。加盐适合"join 类操作"——大表 join 小表时，大表的热 key 加盐扩成 N 份，小表扩成 N 份，join 后结果正确。两者本质都是"用随机性打散"，但两阶段聚合要保证聚合的代数性质（SUM 可加，AVG 要带 count），加盐 join 要保证两边盐的对应。按操作类型选。

**Q：为什么不直接用 Broadcast Join 避免倾斜？**

Broadcast Join 适合"大表 join 小表"——把小表 broadcast 到所有 executor，避免 shuffle，自然没有倾斜。但前提是小表要小（通常 < 100MB，可配 spark.sql.autoBroadcastJoinThreshold）。如果两张都是大表，Broadcast 不可行（内存放不下）。所以 Broadcast 是"小表场景的银弹"，不是通用解。倾斜的通用解是"打散 + 两阶段"，Broadcast 是特殊场景的优化。

### 第五层：验证与沉淀

**Q：怎么验证加盐后的结果是正确的，没有漏算或多算？**

对账验证：1) 加盐前后的总数对账——SUM/COUNT 应该一致（加盐只改变分布不改变总量）；2) 抽样验证——随机抽 100 个 key，对比加盐聚合和原始聚合的值，应该完全一致；3) 极端值验证——拿倾斜的那个大 V user_id，单独查它的聚合值，加盐前后应该一致。沉淀为倾斜治理 SOP：先定位倾斜 key（看 task 耗时分布）→ 判断操作类型（聚合/join）→ 选解法（两阶段/加盐/Broadcast）→ 对账验证。

## 结构化回答

**30 秒电梯演讲：** 数据倾斜本质是 Shuffle 阶段某个 key 的数据量远超其他，导致少数 task 处理巨量数据而其他 task 空闲。

**展开框架：**
1. **倾斜本质** — Shuffle 时某 key 数据量远超其他，少数 task 成为瓶颈
2. **三类常见key** — 空值/null、热点业务key(大V用户ID)、GroupBy高频key
3. **空值解法** — 过滤掉 或 用随机值打散

**收尾：** 您想深入聊：怎么定位是哪个 key 倾斜？


## 视频脚本

> 预计时长：5 分钟 | 由浅入深


| 时间 | 画面/字幕 | 口播台词 | 讲解要点 |
|------|----------|----------|----------|
| 0:00 | 标题卡：数据倾斜怎么处理？ | "像超市结账——1000 个顾客里 999 个买几件东西，1 个买了整车。如果按"顾客ID"…" | 开场钩子 |
| 0:20 | 核心概念图 | "数据倾斜本质是 Shuffle 阶段某个 key 的数据量远超其他，导致少数 task 处理巨量数据而其他 task 空…" | 核心定义 |
| 0:50 | 倾斜本质示意图 | "倾斜本质——Shuffle 时某 key 数据量远超其他，少数 task 成为瓶颈" | 要点拆解1 |
| 1:30 | 三类常见key示意图 | "三类常见key——空值/null、热点业务key(大V用户ID)、GroupBy高频key" | 要点拆解2 |
| 2:20 | 对比/实战案例图 | "对比一下常见误区和工程实践，看真实场景里怎么取舍。" | 实战与对比 |
| 3:10 | 总结卡 | "记住核心要点。下期我们追问：怎么定位是哪个 key 倾斜？" | 收尾与钩子 |
