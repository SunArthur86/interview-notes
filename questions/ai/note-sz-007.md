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
  - 'Hive胜在稳定容错，Spark胜在速度灵活'
  - '互补分工：Hive做稳定大表ETL，Spark做复杂/迭代/实时'
  - '现代趋势：Spark替代MR做计算，Hive Metastore仍做元数据'
first_principle:
  essence: 引擎选型 = 数据量 × 复杂度 × 时效性
  derivation: MapReduce 慢（每步落盘）→ Spark 内存计算快（DAG+cache）→ 但 Spark 不稳（内存管理复杂）→ Hive 容错稳 → 互补分工
  conclusion: 不是二选一，而是按场景分工——稳定离线用 Hive，快速/迭代/实时用 Spark
follow_up:
- Spark 为什么比 MapReduce 快？
- Spark 的 RDD/DataFrame/Dataset 区别？
- Hive on Spark 和 Spark SQL 什么关系？
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
