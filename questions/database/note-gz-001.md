---
id: note-gz-001
difficulty: L3
category: database
subcategory: Kafka
tags:
- 瓜子二手车
- 面经
- Flink
- Kafka
- Exactly-Once
feynman:
  essence: Exactly-Once语义通过Kafka幂等生产者+Flink Checkpoint+两阶段提交(2PC)实现端到端精确一次处理
  analogy: 像寄快递有签收确认——寄出后没丢(幂等生产者)，分拣中心有登记(Checkpoint)，最终签收才确认完成(两阶段提交)，三个环节缺一不可
  first_principle: Exactly-Once的核心是让数据处理的每个环节都具备幂等性和事务性，端到端组合后保证消息不丢不重
  key_points:
  - 'Kafka端: 幂等性生产者(防重) + 事务(跨partition原子写入)'
  - 'Flink端: Checkpoint机制(一致性快照) + Barrier对齐'
  - 'Sink端: 两阶段提交(2PC)保证输出也精确一次'
  - 三者缺一不可，否则退化为At-Least-Once
first_principle:
  essence: 分布式流处理的Exactly-Once = Source幂等 + 处理Checkpoint + Sink事务提交
  derivation: Kafka可能重发 → 需要幂等生产者 → Flink可能崩溃重启 → 需要Checkpoint恢复状态 → 输出可能重复 → 需要事务Sink → 三层组合才能保证端到端
  conclusion: Exactly-Once不是单一机制，而是Source+Process+Sink三层的事务性保证
follow_up:
- Flink Checkpoint的Barrier对齐有什么问题？
- 两阶段提交如果协调者挂了怎么办？
- Exactly-Once和At-Least-Once的性能差异？
memory_points:
- 一句话区分：两者底层同用B+树，但MySQL主键是聚簇索引，而PgSQL全是非聚簇的Heap表
- 聚簇差异：MySQL主键叶子存完整行（极快），而PgSQL所有索引叶子只存CTID物理指针（均需回表）
- 二级索引差异：MySQL二级索引存主键值（需二次回表），而PgSQL均存物理CTID
- 适用场景：MySQL适合读多写少及KV主键查询，PgSQL凭借JSONB及pgvector更适合复杂查询与AI向量检索
---

# 如何保证 Kafka 到 Flink 的数据不丢失、不重复(Exactly-Once)？

## 三层保障架构

```
┌──────────────────────────────────────────────────────┐
│                  端到端 Exactly-Once                  │
├──────────┬───────────────────┬───────────────────────┤
│  Source  │     Process       │       Sink            │
│  (Kafka) │     (Flink)       │    (Kafka/DB)        │
│          │                   │                       │
│ 幂等生产者│ Checkpoint +     │ 两阶段提交 (2PC)      │
│ 事务      │ Barrier对齐      │                       │
│          │                   │                       │
│ 防重发    │ 状态一致性快照    │ 输出精确一次          │
└──────────┴───────────────────┴───────────────────────┘
```

## Layer 1: Kafka Source 幂等+事务

```properties
# Kafka Producer配置
enable.idempotence=true        # 幂等性: 同一消息不重复写入
acks=all                        # 所有副本确认才算成功
retries=Integer.MAX_VALUE       # 无限重试(幂等保证不会重复)
max.in.flight.requests.per.connection=5  # 幂等要求≤5

# 事务配置(跨partition原子写入)
transactional.id=flink-tx-001   # 事务ID(固定,用于恢复)
```

```python
# 幂等原理: PID + SequenceNumber
# ProducerID(PID): 每个生产者唯一标识
# SequenceNumber: 每条消息递增序号
# Broker校验: 相同PID+SN的消息拒绝写入 → 防重复
```

## Layer 2: Flink Checkpoint 机制

```java
// Flink启用Checkpoint
env.enableCheckpointing(60000);  // 每60s一次Checkpoint
env.getCheckpointConfig().setCheckpointingMode(EXACTLY_ONCE);
env.getCheckpointConfig().setMinPauseBetweenCheckpoints(30000);
env.getCheckpointConfig().setCheckpointTimeout(120000);

// Checkpoint流程:
// 1. JobManager注入Barrier到Source
// 2. Barrier随数据流过算子
// 3. 算子收到Barrier → 对齐 → 快照状态 → 转发Barrier
// 4. 所有算子都完成快照 → Checkpoint成功
// 5. 崩溃恢复 → 从最近的Checkpoint恢复状态 + 重放Kafka offset
```

### Barrier对齐

```
Operator有两个输入:
  Input A: ─[data][data][BARRIER]──[data]──→
  Input B: ─[data][BARRIER]────[data][data]→

对齐过程:
  1. 先收到A的Barrier → 暂存A后续数据
  2. 继续处理B的数据直到收到B的Barrier
  3. 两个Barrier都对齐 → 快照当前状态
  4. 恢复处理暂存的数据

⚠️ 对齐有延迟代价(等慢的输入)
   → 替代方案: Unaligned Checkpoint (Flink 1.11+)
```

## Layer 3: Sink 两阶段提交 (2PC)

```java
// Flink Kafka Producer (两阶段提交)
KafkaSink<String> sink = KafkaSink.<String>builder()
    .setBootstrapServers("broker:9092")
    .setDeliveryGuarantee(DeliveryGuarantee.EXACTLY_ONCE)
    .setTransactionalIdPrefix("flink-sink")  // 事务ID前缀
    .build();

// 2PC流程:
// Phase 1 (Pre-commit):
//   Sink收到Barrier → 开启Kafka事务 → 写入数据 → 不提交
//   → 向JobManager报告"可以提交"

// Phase 2 (Commit):
//   JobManager收到所有算子的"可以提交" → 发送"最终提交"
//   → Sink提交Kafka事务 → 数据可见

// 如果Phase 2前崩溃:
//   → JobManager从Checkpoint恢复 → 发现未提交的事务 → 重新提交
//   → Kafka事务超时自动回滚(abort)
```

## 完整数据流

```
Kafka Topic (Source)
    │
    │ 1. 幂等生产者写入 (PID+SN防重)
    │ 2. 消费者记录offset
    ▼
Flink Process
    │ 3. Barrier注入 → 状态快照
    │ 4. Barrier对齐 → 一致性保证
    ▼
Kafka Topic (Sink)
    │ 5. 两阶段提交
    │    Phase1: 事务写入(pre-commit)
    │    Phase2: Checkpoint成功后commit
    ▼
下游消费 (精确一次)

任何一层崩溃:
  → Flink从Checkpoint恢复
  → Kafka offset回滚到Checkpoint时的位置
  → Source重放 → 幂等保证不重复
  → Sink事务: 未提交的自动abort → 重新写入
```

## 常见问题排查

```sql
-- 离线和实时数仓数据不一致排查:
-- 1. 检查实时任务是否有背压
SHOW PIPELINES;

-- 2. 检查Kafka消费延迟
kafka-consumer-groups --describe --group flink-consumer

-- 3. 对比窗口触发逻辑
-- 离线Spark: TumblingEventTimeWindow
-- 实时Flink: TumblingProcessingTimeWindow
-- → 时间语义不对齐导致数据差异!
```

## 记忆要点

- 一句话区分：两者底层同用B+树，但MySQL主键是聚簇索引，而PgSQL全是非聚簇的Heap表
- 聚簇差异：MySQL主键叶子存完整行（极快），而PgSQL所有索引叶子只存CTID物理指针（均需回表）
- 二级索引差异：MySQL二级索引存主键值（需二次回表），而PgSQL均存物理CTID
- 适用场景：MySQL适合读多写少及KV主键查询，PgSQL凭借JSONB及pgvector更适合复杂查询与AI向量检索

