---
id: note-xhs-sd-017
difficulty: L3
category: system-design
subcategory: 消息队列
tags:
- Kafka
- 消息不丢失
- 消息不重复
- 幂等
- ISR
- 消息队列
source: 拼多多Java三轮技术面二面 + 小红书视频帖
feynman:
  essence: Kafka通过Producer端ACK+重试、Broker端副本复制（ISR）、Consumer端手动提交Offset三段保证消息不丢失；通过Producer端幂等+事务、Consumer端幂等消费保证不重复。
  analogy: 不丢消息就像寄快递要签收——寄出后要确认对方收到（ACK），对方要妥善保管（副本备份），收件人要确认签收（手动Offset）。不重复消费就像快递公司给每个包裹唯一编号，即使重复投递，收件人也只拆一次（幂等消费）。
  key_points:
  - 不丢失三环节：Producer（acks=all+重试）、Broker（副本ISR机制）、Consumer（手动提交offset）
  - 不丢失核心：min.insync.replicas ≥ 2，acks=all，unclean.leader.election.enable=false
  - 不重复Producer端：enable.idempotence=true（幂等生产者，Kafka 0.11+）
  - 不重复Consumer端：业务幂等（唯一键去重/数据库唯一约束/Redis去重）
  - Exactly-Once：幂等生产者 + 事务（Kafka Transactions API）
first_principle:
  problem: 消息从生产到消费经过三个阶段（Producer→Broker→Consumer），每个阶段都可能因为网络故障、进程崩溃、磁盘损坏而丢消息。如何端到端保证？
  axioms:
  - 网络是不可靠的（消息可能丢失或重复）
  - 磁盘可能损坏（Broker宕机丢数据）
  - 消费者可能在处理完消息但提交Offset前崩溃（重启后重复消费）
  - 每个环节都不能假设上一环节可靠
  rebuild: 每个环节都加确认和重试机制 → Producer等Broker所有ISR副本确认（acks=all）→ Broker多副本保证单机故障不丢 → Consumer处理完业务再提交Offset → 幂等设计防止重试导致的重复 → 端到端Exactly-Once语义。
follow_up:
  - Kafka的ISR机制是什么？如果ISR只剩一个副本怎么办？
  - Consumer的auto.offset.reset参数有什么作用？设置为latest还是earliest？
  - 幂等生产者的原理是什么？它靠什么字段去重？
  - Kafka事务能实现跨分区的Exactly-Once吗？原理是什么？
  - 如果Consumer处理消息很慢，导致rebalance时Offset没提交，怎么避免重复消费？
memory_points:
  - 不丢消息口诀：Producer acks=all + Broker ISR≥2 + Consumer手动提交Offset
  - 不重复口诀：Producer幂等(producerID+sequenceNumber) + Consumer业务幂等(唯一键去重)
  - Exactly-Once = 幂等生产者 + 事务（Kafka 0.11+）
  - 关键参数：acks=all, min.insync.replicas≥2, enable.idempotence=true
---

# 【拼多多二面 + XHS视频帖】Kafka 如何保证消息不丢失、不重复消费？

## 🎯 一句话本质

**不丢失** = Producer端（`acks=all` + 重试）+ Broker端（多副本ISR机制）+ Consumer端（处理完手动提交Offset）。**不重复** = Producer端（幂等生产者 + 事务）+ Consumer端（业务幂等去重）。

## 🧒 费曼类比

```
消息不丢失（快递签收流程）：
  寄件人(Producer) → 必须收到签收回执才放心（acks=all）
  快递站(Broker) → 重要包裹复制3份存不同仓库（ISR副本）
  收件人(Consumer) → 拆完包裹再签收（先处理再提交Offset）

消息不重复（防重复签收）：
  快递单号 = producerID + sequenceNumber → 即使寄两次，收件人看单号一样就不重复拆
  收件人记录 → "这个单号已签收"，再来一次直接跳过（业务幂等）
```

## 📊 端到端可靠性全链路

```
 Producer                    Broker                      Consumer
┌──────────┐             ┌──────────────┐            ┌──────────────┐
│ 1.发送消息 │             │  Leader副本   │            │ 1.拉取消息    │
│ 2.acks=all│───────────→ │  (写入本地)   │            │   (poll)     │
│   等所有   │             │              │            │              │
│   ISR确认  │             │ 2.Follower   │            │ 2.处理业务    │
│           │ ←────────── │  从Leader拉取 │            │   (写DB)     │
│ 3.重试机制 │   ACK       │  同步数据     │            │              │
│   retries=│             │              │            │ 3.提交Offset │
│   MAX_INT │             │ 3.ISR列表     │            │   (手动提交)  │
│           │             │  min.insync   │            │              │
│ 4.幂等生产 │             │  .replicas≥2 │            │ 4.幂等处理    │
│   PID+Seq │             │              │            │   唯一键去重   │
└──────────┘             └──────────────┘            └──────────────┘
```

## 🔧 不丢失：三个环节

### 1. Producer端

```java
Properties props = new Properties();
// 关键：等待所有ISR副本确认（不是只等Leader）
props.put(ProducerConfig.ACKS_CONFIG, "all");
// 关键：发送失败无限重试
props.put(ProducerConfig.RETRIES_CONFIG, Integer.MAX_VALUE);
// 关键：每个分区单线程发送（保证重试顺序）
props.put(ProducerConfig.MAX_IN_FLIGHT_REQUESTS_PER_CONNECTION, 5);
// 幂等生产者（防止重试导致重复）
props.put(ProducerConfig.ENABLE_IDEMPOTENCE_CONFIG, true);

KafkaProducer<String, String> producer = new KafkaProducer<>(props);
```

**acks参数对比**：

| acks | 含义 | 可靠性 | 性能 |
|------|------|--------|------|
| 0 | 发出去就不管了 | 最低（可能丢） | 最高 |
| 1 | Leader写入即返回 | 中（Leader宕机可能丢） | 高 |
| all（-1）| 所有ISR副本写入才返回 | 最高 | 较低 |

### 2. Broker端

```bash
# 关键配置：server.properties
# 最少同步副本数（配合acks=all使用）
min.insync.replicas=2

# 副本总数
default.replication.factor=3

# 禁止非ISR副本成为Leader（防止数据丢失）
unclean.leader.election.enable=false

# 日志刷盘策略（默认依赖OS page cache）
log.flush.interval.messages=10000
log.flush.interval.ms=1000
```

**ISR机制（In-Sync Replicas）**：

```
Partition-A:  Leader=B1  ISR=[B1, B2, B3]   ← 三个副本都在同步

如果B3网络延迟 → ISR=[B1, B2]              ← B3被踢出ISR
如果B2也挂了   → ISR=[B1]                  ← 只剩Leader

min.insync.replicas=2 时：
  Producer写消息 → ISR只剩1个 → 拒绝写入（NotEnoughReplicasException）
  → 牺牲可用性换取不丢数据
```

### 3. Consumer端

```java
// 关闭自动提交Offset
props.put(ConsumerConfig.ENABLE_AUTO_COMMIT_CONFIG, false);

KafkaConsumer<String, String> consumer = new KafkaConsumer<>(props);
consumer.subscribe(Collections.singletonList("order-topic"));

while (true) {
    ConsumerRecords<String, String> records = consumer.poll(Duration.ofMillis(1000));
    for (ConsumerRecord<String, String> record : records) {
        try {
            // 先处理业务
            processOrder(record.value());
        } catch (Exception e) {
            log.error("处理失败，不提交offset，下次重新拉取", e);
            continue;
        }
    }
    // 业务处理完后手动提交Offset
    consumer.commitSync(); // 同步提交（更可靠）
    // 或 consumer.commitAsync(); // 异步提交（更快，但可能失败）
}
```

## 🔧 不重复：两个层面

### 1. Producer端：幂等生产者

```
Kafka 0.11+ 幂等原理：

每次Producer初始化时获得一个全局唯一的PID
每条消息附带一个递增的SequenceNumber

Broker端为每个<PID, Partition>维护一个最新的SN：
  收到消息SN <= 已提交SN → 判定为重复，直接丢弃（返回成功）
  收到消息SN > 已提交SN+1 → 等待中间消息（乱序恢复）

注意：幂等只能保证单个Producer对单个Partition的Exactly-Once
     跨分区需要事务
```

```java
// 开启幂等
props.put(ProducerConfig.ENABLE_IDEMPOTENCE_CONFIG, true);
// 幂等开启后自动设置: acks=all, retries=MAX, max.in.flight=5
```

### 2. Producer端：事务（跨分区Exactly-Once）

```java
// 事务性Producer
props.put(ProducerConfig.TRANSACTIONAL_ID_CONFIG, "order-tx-1");

KafkaProducer<String, String> producer = new KafkaProducer<>(props);
producer.initTransactions(); // 初始化事务

try {
    producer.beginTransaction();
    
    // 发送到多个分区/Topic
    producer.send(new ProducerRecord<>("order-topic", orderMsg));
    producer.send(new ProducerRecord<>("inventory-topic", invMsg));
    
    // 提交消费者Offset（消费-处理-生产 在同一个事务中）
    producer.sendOffsetsToTransaction(offsets, consumerGroupId);
    
    producer.commitTransaction(); // 原子提交
} catch (Exception e) {
    producer.abortTransaction(); // 原子回滚
}
```

### 3. Consumer端：业务幂等

```java
public void processOrder(String message) {
    OrderEvent event = JSON.parseObject(message, OrderEvent.class);
    
    // 方案1：数据库唯一索引
    // order表对order_id建唯一索引，重复插入会抛DuplicateKeyException
    
    // 方案2：Redis去重（适合非数据库场景）
    String key = "consumed:" + event.getRequestId();
    Boolean isNew = redisTemplate.opsForValue()
        .setIfAbsent(key, "1", 7, TimeUnit.DAYS);
    if (Boolean.FALSE.equals(isNew)) {
        log.info("消息已处理，跳过: {}", event.getRequestId());
        return;
    }
    
    // 方案3：状态机（update...where status=未处理）
    // UPDATE order SET status='已处理' WHERE id=? AND status='未处理'
    
    // 执行业务逻辑
    doBusinessLogic(event);
}
```

## 📋 面试加分点

1. **`acks=all` 的前提是 `min.insync.replicas ≥ 2`**：否则ISR只有Leader自己，acks=all等于acks=1。

2. **Kafka不丢消息的终极配置**：`acks=all` + `replication.factor=3` + `min.insync.replicas=2` + `unclean.leader.election.enable=false`。

3. **Rebalance导致的重复消费**：Consumer在rebalance前没来得及提交Offset，新Consumer从旧Offset开始消费。解决：`ConsumerRebalanceListener` 在rebalance前提交Offset。

4. **粘性分区（Sticky Partitioner）**：Kafka 2.4+默认使用粘性分区器，在没有指定key时，尽量将消息发到同一个分区，减少请求次数。

5. **LIFO消费**：Kafka支持从最新Offset开始消费（`auto.offset.reset=latest`），适合只关心实时数据的场景。

## ❓ 苏格拉底式面试追问

1. **"你说acks=all，但ISR里只有Leader自己（Follower全挂了），这条消息算确认了吗？"**
   → 如果min.insync.replicas=1，则确认了（不可靠）；如果=2，则拒绝写入（可靠但不可用）

2. **"消费者处理完业务但在commitSync()之前进程崩溃了，重启后会发生什么？"**
   → 从上次提交的Offset开始消费 → 重复消费 → 需要业务幂等

3. **"幂等生产者只能保证单分区幂等，如果同一个业务需要发到两个分区，怎么保证？"**
   → 使用Kafka事务，beginTransaction/commitTransaction原子提交

4. **"Producer的retries=MAX会不会导致消息乱序？"**
   → 如果max.in.flight.requests.per.connection > 1且未开幂等，重试会导致乱序。开启幂等后会自动设为5并保证顺序

5. **"和RocketMQ相比，Kafka在消息可靠性上有什么优势和劣势？"**
   → Kafka: 高吞吐、多副本ISR、事务API完善。RocketMQ: 事务消息机制更轻量、同步刷盘更可控、支持延迟消息


## 结构化回答

**30 秒电梯演讲：** Kafka通过Producer端ACK+重试、Broker端副本复制（ISR）、Consumer端手动提交Offset三段保证消息不丢失。

**展开框架：**
1. **不丢消息口诀** — Producer acks=all + Broker ISR≥2 + Consumer手动提交Offset
2. **不重复口诀** — Producer幂等(producerID+sequenceNumber) + Consumer业务幂等(唯一键去重)
3. **Exactly-Once** — Exactly-Once = 幂等生产者 + 事务（Kafka 0.11+）

**收尾：** 这块我踩过坑——要不要深入聊：Kafka的ISR机制是什么？如果ISR只剩一个副本怎么办？

## 视频脚本

> 预计时长：3 分钟 | 由浅入深

| 时间 | 画面/字幕 | 口播台词 | 讲解要点 |
|------|----------|----------|----------|
| 0:00 | 标题卡 | "消息队列一句话：Kafka通过Producer端ACK+重试、Broker端副本复制（ISR）…。" | 开场钩子 |
| 0:15 | Redis Lua 脚本执行截图 | "不丢消息口诀：Producer acks就是all + Broker ISR≥2 + Consumer手动提交Off…" | 不丢消息口诀 |
| 1:06 | Redis Lua 脚本执行截图分步演示 | "不重复口诀：Producer幂等(producerID+sequenceNumber) + Consumer业务幂等…" | 不重复口诀 |
| 1:57 | 关键代码/伪代码片段 | "Exactly-Once 就是 幂等生产者 + 事务（Kafka 0.11+）" | Exactly-Once |
| 2:50 | 总结卡 | "核心抓住这条主线，下期咱们接着聊：Kafka的ISR机制是什么？如果ISR只剩一个副本怎么办。" | 收尾 |
