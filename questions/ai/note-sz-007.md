---
id: note-sz-007
difficulty: L3
category: ai
subcategory: 数据工程
tags:
- 神州专车
- 面经
- Spark
- Hive
- 计算引擎
feynman:
  essence: Spark 和 Hive 在数据团队是互补分工——Hive 是"SQL on MapReduce/Tez"偏离线批处理，生态成熟稳定，适合稳定的大表 ETL 和数仓分层；Spark 是内存计算引擎，比 MapReduce 快10-100倍（DAG+内存缓存），适合需要迭代/复用中间结果/机器学习/实时计算的场景。现代趋势是 Spark 替代 MapReduce 做计算，Hive Metastore 仍做元数据管理。
  analogy: Hive 像稳定的卡车（拉货量大、稳、但慢），Spark 像高铁（快、灵活、但要修铁路即调内存）。日常大批量拉货用卡车（Hive ETL），需要快速迭代或实时分析坐高铁（Spark）。
  first_principle: 计算引擎选型 = 数据量 × 计算复杂度 × 时效性。Hive 胜在稳定（成熟生态、容错好），Spark 胜在速度（内存计算、DAG 优化）。简单离线 ETL 用 Hive 够了，复杂/迭代/实时用 Spark。
  key_points:
  - 'Hive: SQL on MapReduce/Tez，离线批处理，稳定生态成熟'
  - 'Spark: 内存计算+DAG，比MR快10-100倍，适合迭代/复用/ML/实时'
  - Hive胜在稳定容错，Spark胜在速度灵活
  - 互补分工：Hive做稳定大表ETL，Spark做复杂/迭代/实时
  - 现代趋势：Spark替代MR做计算，Hive Metastore仍做元数据
first_principle:
  essence: 引擎选型 = 数据量 × 复杂度 × 时效性
  derivation: MapReduce 慢（每步落盘）→ Spark 内存计算快（DAG+cache）→ 但 Spark 不稳（内存管理复杂）→ Hive 容错稳 → 互补分工
  conclusion: 不是二选一，而是按场景分工——稳定离线用 Hive，快速/迭代/实时用 Spark
follow_up:
- Spark 为什么比 MapReduce 快？
- Spark 的 RDD/DataFrame/Dataset 区别？
- Hive on Spark 和 Spark SQL 什么关系？
memory_points:
- Hive胜在稳定性，作为数仓标准承担底层数据清洗和海量大表离线ETL
- Spark胜在极速计算，利用DAG和内存缓存承担机器学习、迭代计算和实时任务
- 趋势：Hive的计算引擎正被替代，但其Metastore仍是Spark/Flink共用的元数据标准
---

# 【神州专车面经】Spark 和 Hive 在项目中分别承担什么角色？

## 一、核心定位

| 维度 | Hive | Spark |
|------|------|-------|
| 本质 | SQL on MapReduce/Tez | 内存计算引擎 + SQL/ML/Streaming |
| 速度 | 慢（每步落盘） | **快10-100倍**（DAG+内存缓存） |
| 稳定性 | 高（容错成熟） | 中（内存管理复杂） |
| 生态 | 数仓标准，Metastore 是事实标准 | 计算生态（SQL/ML/Streaming/Graph） |
| 适合 | 稳定的大表 ETL、数仓分层 | 复杂计算、迭代、机器学习、实时 |
| 上手 | SQL 为主 | SQL + 编程（Scala/Python） |

## 二、Spark 为什么比 MapReduce 快

```
MapReduce：
  Map → 落盘 → Shuffle → 落盘 → Reduce → 落盘
  每一步都落磁盘，IO 瓶颈

Spark（DAG + 内存缓存）：
  Stage1 → cache(内存) → Stage2 → cache → Stage3
  中间结果在内存，多轮迭代不重复读盘
```

- **DAG 调度**：把任务拆成有向无环图，优化执行计划（pipeline、减少 shuffle）
- **内存缓存**：`cache()`/`persist()` 把中间结果放内存，迭代算法复用
- **Lazy Evaluation**：transformations 不立即执行，action 触发时整体优化

## 三、项目中的分工（出行场景）

### Hive 承担：稳定的大表离线 ETL

```sql
-- Hive：数仓分层 ETL（每天定时跑）
-- ODS → DWD：清洗、维度退化
INSERT OVERWRITE TABLE dwd_order_di PARTITION (dt='${date}')
SELECT ... FROM ods_order JOIN dim_driver ON ...;

-- DWD → DWS：日/周/月汇总
INSERT OVERWRITE TABLE dws_driver_daily PARTITION (dt='${date}')
SELECT driver_id, COUNT(*), SUM(fare) FROM dwd_order_di WHERE dt='${date}' GROUP BY driver_id;
```

**为什么用 Hive**：ETL 任务稳定第一，每天定时跑，Hive 容错好、生态成熟、SQL 即可。

### Spark 承担：复杂计算 + 机器学习 + 实时

```python
# Spark：机器学习（司机效率评分模型）
from pyspark.ml import Pipeline
from pyspark.ml.regression import GBTRegressor

df = spark.read.parquet("dws_driver_daily")
model = GBTRegressor(featuresCol="features", labelCol="efficiency_score")
pipeline = Pipeline(stages=[...]).fit(df)

# Spark：特征工程（复用中间结果）
features = df.transform(...).cache()  # cache 复用
model1.fit(features)
model2.fit(features)  # 第二次不用重算
```

```python
# Spark Streaming：实时订单监控
spark.readStream.table("ods_order_realtime") \
  .groupBy(window("event_time", "5 minutes"), "city") \
  .count() \
  .writeStream.format("kafka")...
```

**为什么用 Spark**：机器学习要迭代（多轮训练），实时要低延迟，Spark 内存计算+复用优势明显。

## 四、Hive on Spark vs Spark SQL

```
Hive on Spark：Hive 的执行引擎从 MR 换成 Spark（Hive 负责 SQL 解析+优化，Spark 负责执行）
  → 结合 Hive 的稳定性 + Spark 的速度

Spark SQL：Spark 自带的 SQL 引擎（Spark 负责全链路：解析+优化+执行）
  → 更深度集成 Spark 生态（DataFrame/Dataset/ML）
```

**选择**：已有 Hive 数仓想加速 → Hive on Spark；新项目用 Spark 生态 → Spark SQL。

## 五、现代数据架构的趋势

```
[元数据管理] Hive Metastore（事实标准，Spark/Flink/Trino 都用）
       ↑
[计算引擎] Spark（替代 MR）+ Flink（实时）
       ↑
[存储] HDFS / S3 / OSS（数据湖）
       ↑
[查询] Trino/Presto（交互式 ad-hoc 查询）
```

**关键认知**：Hive 的 Metastore 是事实标准（连 Spark/Flink 都用它管元数据），但 Hive 的计算引擎（MR/Tez）正在被 Spark/Flink 替代。

## 六、加分点

- 说出 **Spark 的 RDD/DataFrame/Dataset**：
  - RDD：底层抽象，强类型（Java/Scala），无 schema 优化
  - DataFrame：有 schema，Catalyst 优化器，类似数据库表
  - Dataset：DataFrame + 强类型（Scala/Java），编译期类型检查
- 说出 **Hive Metastore 是事实标准**：即使不用 Hive 计算引擎，Metastore 仍被 Spark/Flink/Trino 共用

## 七、雷区

- ❌ "Spark 完全替代 Hive" → Metastore 还是 Hive 的，且 Hive 在稳定 ETL 场景仍有价值
- ❌ "所有任务都用 Spark" → 简单 ETL 用 Hive 更稳，Spark 内存调优复杂

## 八、扩展

- **Flink**：实时流计算第一选择（Spark Streaming 是微批，Flink 是真流）
- **Trino/Presto**：交互式 ad-hoc 查询，多数据源联邦查询（Hive/MySQL/Kafka 都能查）
- **Data Lakehouse**（Iceberg/Hudi/Delta Lake）：结合数据湖的灵活和数据仓的事务性，支持 upsert/time travel

## 记忆要点

- Hive胜在稳定性，作为数仓标准承担底层数据清洗和海量大表离线ETL
- Spark胜在极速计算，利用DAG和内存缓存承担机器学习、迭代计算和实时任务
- 趋势：Hive的计算引擎正被替代，但其Metastore仍是Spark/Flink共用的元数据标准


## 苏格拉底式面试追问

> 这组追问模拟面试官层层逼问，每一问先回答"为什么"，再回答"怎么做"，最后回答"如何证明"。

### 第一层：目标与动机

**Q：Spark 和 Hive 在你的项目里是替代关系还是互补？为什么不全用 Spark？**

互补关系，不是替代。Hive 的 Metastore 做元数据管理（表结构、分区、权限），即使计算引擎换成 Spark，元数据仍存在 Hive Metastore 里共享。Hive on Tez/MapReduce 适合"稳定的大表 ETL"（生态成熟、SQL 兼容性好），Spark 适合"需要迭代/复用中间结果/低延迟"的场景（内存计算快 10-100x）。全用 Spark 的问题：1) 部分老 SQL 在 Spark 上有兼容性问题；2) Spark 的稳定性调优门槛高，Hive 更"傻瓜"。

### 第二层：证据与定位

**Q：同一个 SQL 在 Hive 上跑 30 分钟，Spark 上跑 5 分钟但偶尔 OOM，怎么定位 Spark 的 OOM？**

看 Spark 的 executor 内存使用和 task 数据分布。1) 看 executor 的 GC 时间和内存峰值——如果某个 executor 内存打满，是数据倾斜导致单 task 数据过多；2) 看 shuffle 数据量——如果 shuffle write 远超预期，可能是 join 逻辑问题（如大表 join 大表没优化）；3) 看 broadcast join 阈值——如果小表超过 broadcast 阈值但没触发 broadcast，走 shuffle join 内存压力大。具体用 Spark UI 的 stage 内存图和 executor tab。

### 第三层：根因深挖

**Q：Spark 比 Hive 快，根因是内存计算还是 DAG 调度？**

两者都是，但 DAG 调度是根本。MapReduce（Hive 底层）把 job 串联，每个 job 落盘（HDFS），job 间数据要读写磁盘，IO 成本高。Spark 的 DAG 把多个 stage 串联成一个 job，中间结果可以缓存在内存（RDD cache/persist），减少磁盘 IO。内存计算是"DAG 多阶段串联"的副产品——只有 DAG 才能决定哪些中间结果值得缓存。所以根因是"DAG 调度模型比 MapReduce 的多 job 模型更高效"，内存是加速手段。

**Q：那为什么不直接用 Flink（也支持批处理且更快），而要用 Spark？**

Flink 在流处理上有优势（真正的流式、低延迟），但在批处理上 Spark 的生态更成熟：1) Spark SQL 的兼容性和优化器（Catalyst）比 Flink Table API 强；2) Spark 的机器学习库（MLlib）和图计算（GraphX）生态完善；3) 团队技术栈成本——已有 Spark 经验，换 Flink 学习成本高。批处理用 Spark、流处理用 Flink 是行业主流分工。如果你的项目是纯流处理（实时数仓），Flink 更合适；批处理 ETL，Spark 更稳。

### 第四层：方案权衡

**Q：Spark 的 DataFrame API 和 Spark SQL 怎么选？**

权衡"灵活性 vs 可维护性"。Spark SQL——声明式，优化器（Catalyst）自动优化，团队 BI 分析师也能写，可维护性好；DataFrame API——命令式，适合复杂逻辑（如条件分支、自定义函数），但优化器介入少。经验上：标准 ETL（select/join/group by）用 Spark SQL，优化器帮你做 predicate pushdown、broadcast join 自动选择；复杂逻辑（如自定义聚合、图算法）用 DataFrame API 或 RDD。两者可以混用（SQL 里调用 UDF）。

**Q：为什么不直接用 DataFrame API 全写，避免 SQL 解析开销？**

SQL 解析开销可以忽略（Catalyst 优化后的物理计划和 DataFrame 一样）。关键是"优化器能帮你做什么"。Spark SQL 声明式，Catalyst 会自动做：predicate pushdown（过滤条件下推到数据源）、常量折叠、broadcast join 自动检测。DataFrame API 也有 Catalyst 优化（底层共享），但复杂 API 链式调用可能阻碍优化器识别模式。所以不是性能问题，是"让优化器更好工作"的问题，SQL 通常让优化器发挥更好。

### 第五层：验证与沉淀

**Q：怎么衡量 Spark 任务是否调优到位，而不是"能跑就行"？**

三个指标：1) 执行时间——对比基线（如 Hive 版本），应该快 3-5x；2) 资源利用率——CPU 和内存利用率应该 > 70%（如果 < 30% 说明资源浪费或数据倾斜）；3) shuffle 数据量——合理设计 join 顺序和 broadcast，shuffle 应该最小化。沉淀为 Spark 调优 checklist：分区数、executor 内存、broadcast 阈值、shuffle 分区数（spark.sql.shuffle.partitions）、数据倾斜检测。

## 结构化回答

**30 秒电梯演讲：** Spark 和 Hive 在数据团队是互补分工——Hive 是"SQL on MapReduce/Tez"偏离线批处理，生态成熟稳定，适合稳定的大表 ETL 和数仓分层；Spark 是内存计算引擎。

**展开框架：**
1. **Hive** — SQL on MapReduce/Tez，离线批处理，稳定生态成熟
2. **Spark** — 内存计算+DAG，比MR快10-100倍，适合迭代/复用/ML/实时
3. **互补分工** — Hive做稳定大表ETL，Spark做复杂/迭代/实时

**收尾：** 您想深入聊：Spark 为什么比 MapReduce 快？


## 视频脚本

> 预计时长：4 分钟 | 由浅入深


| 时间 | 画面/字幕 | 口播台词 | 讲解要点 |
|------|----------|----------|----------|
| 0:00 | 标题卡：Spark 和 Hive 在项目中分别承担什么角… | "Hive 像稳定的卡车（拉货量大、稳、但慢），Spark 像高铁（快、灵活、但要修铁路即调…" | 开场钩子 |
| 0:20 | 核心概念图 | "Spark 和 Hive 在数据团队是互补分工——Hive 是"SQL on MapReduce/Tez"偏离线批处理…" | 核心定义 |
| 0:50 | Hive示意图 | "Hive——SQL on MapReduce/Tez，离线批处理，稳定生态成熟" | 要点拆解1 |
| 1:30 | 对比/实战案例图 | "对比一下常见误区和工程实践，看真实场景里怎么取舍。" | 实战与对比 |
| 2:20 | 总结卡 | "记住核心要点。下期我们追问：Spark 为什么比 MapReduce 快？" | 收尾与钩子 |
