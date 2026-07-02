---
id: note-ks-005
difficulty: L3
category: system-design
subcategory: 消息队列
tags:
- 快手
- Java开发
- 一面
- 场景题
- Kafka
- 消息积压
- 面经
feynman:
  essence: Kafka积压100万消息的三步应急：(1)扩容消费者实例并行处理；(2)跳过非关键数据优先处理核心业务消息；(3)修复后通过Lag监控确保积压完全消费。如果消费者是瓶颈，临时增加Consumer实例数即可快速消化积压。
  analogy: "Kafka积压就像快递站爆仓——100万个包裹堆积。应急三步：(1)临时多招快递员(增加Consumer实例)并行送货；(2)先送加急件(跳过非关键消息，优先处理核心业务)；(3)送完后看监控(ConsumerLag)确认仓库清空。"
  key_points:
  - 消费者宕机→消息积压→快速恢复需要增加消费能力
  - 扩容消费者：增加Consumer实例，注意分区数限制（Consumer数≤Partition数才有意义）
  - 跳过非关键数据：设置过滤条件，优先消费核心业务topic/partition
  - ConsumerLag监控：messages still to be consumed = HW - Consumer Offset
  - 长期方案：增加分区数、优化消费逻辑(批量处理/异步写入)
first_principle:
  essence: 消息积压 = 生产速率 > 消费速率，恢复需要 消费速率 > 生产速率
  derivation: "积压100万消息，正常消费速率5000/s，生产速率2000/s → 需要100万/(5000-2000) ≈ 333秒追平。如果增加Consumer实例使消费速率达到20000/s → 100万/(20000-2000) ≈ 55秒追平。"
  conclusion: 短期靠扩容消费者实例，长期靠优化消费逻辑+增加分区
follow_up:
- Kafka的Consumer数量为什么不能超过Partition数量？
- Rebalance机制是什么？扩容消费者时会触发Rebalance吗？
- 如何监控ConsumerLag？有哪些工具？
- 如果消费端有DB写入，DB也成为瓶颈怎么办？
- Kafka的exactly-once语义如何保证？
memory_points:
- 核心限制：Consumer实例数 ≤ Partition数（否则多余的Consumer空闲）
- 三步应急：扩容Consumer→跳过非关键消息→ConsumerLag监控确认
- ConsumerLag = LogEndOffset - ConsumerOffset = 还没消费的消息数
- 长期优化：批量消费(max.poll.records)、增加分区数、异步处理
---

# 【快手Java一面】Kafka消费者宕机后，积压100万消息，如何快速恢复？

> 来源：快手Java开发一面场景题复盘（小红书）

## 一、问题分析

```
正常状态：
  Producer → [Topic: 6 Partitions] → 6 Consumer Instances
  生产速率: 2000 msg/s
  消费速率: 2000 msg/s
  ConsumerLag: ~0

消费者宕机后：
  Producer → [Topic: 6 Partitions] → 2 Consumer Instances (4个宕机!)
  生产速率: 2000 msg/s
  消费速率: 667 msg/s (只有原来的1/3)
  积压: 每秒新增 1333 条

  100万条积压 ÷ (667-2000) ... 不对，消费 < 生产，积压持续增长!
  → 需要立即行动!
```

## 二、三步应急方案

### Step 1: 扩容消费者

```
                    Topic: order-events (6 Partitions)

  Before（4个Consumer宕机，2个在工作）：
  ┌─────────┐  ┌─────────┐
  │Consumer1│  │Consumer2│     ← 消费速率: 667/s
  └─────────┘  └─────────┘     ← 积压持续增长!

  After（紧急扩容到6个Consumer实例）：
  ┌─────────┐  ┌─────────┐  ┌─────────┐
  │Consumer1│  │Consumer2│  │Consumer3│
  └─────────┘  └─────────┘  └─────────┘
  ┌─────────┐  ┌─────────┐  ┌─────────┐
  │Consumer4│  │Consumer5│  │Consumer6│   ← 消费速率: 2000/s
  └─────────┘  └─────────┘  └─────────┘   ← 6个分区各分配1个Consumer

  恢复时间：100万 / (2000-2000) → 还是不够!
  → 需要更多消费能力，见Step 2
```

```java
// 紧急扩容方案：动态增加Consumer实例
// 注意：Consumer实例数不能超过Partition数!

// 如果当前Topic有6个Partition，最多只能有6个Consumer同时消费
// 需要先增加Partition数，再增加Consumer

// 方案A：增加Partition（Kafka支持在线扩容）
kafka-topics.sh --alter --topic order-events --partitions 12

// 方案B：增加Consumer实例到12个
// 但旧消息仍在原6个分区中 → 新分区只处理新消息
// 所以Partition扩容对已积压的消息帮助有限

// 方案C（推荐）：部署独立的"消费者突击队"
// 新部署一组Consumer实例，专门消费积压Topic
// 不做业务处理，只做消息转发到一个新Topic(更多分区)
// → 新Topic有足够多分区 → 大量Consumer并行消费
```

### Step 2: 跳过非关键数据

```
消息优先级过滤：

  100万积压消息中：
  ├── 核心业务消息（订单、支付）: 30万  ← 优先消费
  ├── 非核心消息（通知、日志）: 50万   ← 暂时跳过
  └── 可丢弃消息（统计数据）: 20万     ← 直接丢弃

  实现方式：
  1. 按Topic分离：核心消息和非核心消息分不同Topic
     → 先扩容核心Topic的Consumer，非核心Topic暂停消费

  2. 按Partition路由：核心业务路由到高优先级Partition
     → 优先消费指定Partition

  3. 应用层过滤：消费时先判断优先级
```

```java
// 应用层优先级过滤
@KafkaListener(topics = "order-events")
public void consume(ConsumerRecord<String, String> record) {
    OrderEvent event = JSON.parseObject(record.value(), OrderEvent.class);

    // 积压期间只处理核心消息
    if (backlogMode && event.getPriority() != Priority.HIGH) {
        log.info("积压模式：跳过低优先级消息: {}", event.getId());
        return;  // 跳过
    }

    // 正常处理核心消息
    orderService.process(event);
}
```

### Step 3: ConsumerLag 监控

```
Kafka Consumer Lag = LogEndOffset - ConsumerOffset

  Partition 0: [============] HW=200000, Offset=150000, Lag=50000
  Partition 1: [==========  ] HW=180000, Offset=160000, Lag=20000
  Partition 2: [=========   ] HW=190000, Offset=170000, Lag=20000
  Partition 3: [===========] HW=210000, Offset=180000, Lag=30000
  Partition 4: [=========   ] HW=200000, Offset=190000, Lag=10000
  Partition 5: [==========  ] HW=195000, Offset=160000, Lag=35000
                                         Total Lag: 165000

  监控命令：
  kafka-consumer-groups.sh --group order-consumer-group \
    --describe --bootstrap-server localhost:9092

  恢复标志：所有Partition的Lag都趋近于0
```

```
  恢复曲线：

  Lag
  100万 ─┐
         │ ╲
  80万   │   ╲
         │     ╲                    ← 消费速率 > 生产速率
  50万   │       ╲                     Lag开始下降
         │         ╲
  20万   │           ╲
         │             ╲
  5万    │               ╲
         │                 ╲
  0      │                   ────────  ← 完全恢复!
         └──────────────────────────────→ 时间
         宕机    扩容       恢复中      完成
```

## 三、长期优化方案

```
1. 批量消费（大幅提升吞吐）
   ┌──────────────────────────────────────┐
   │ max.poll.records = 500               │ ← 每次poll 500条
   │ 批量写入DB（MyBatis batch insert）   │ ← 一条SQL插入500行
   │ 消费速率提升5-10倍                    │
   └──────────────────────────────────────┘

2. 增加分区数
   ┌──────────────────────────────────────┐
   │ 原：6 Partitions → 6 Consumers       │
   │ 新：24 Partitions → 24 Consumers     │ ← 4倍消费能力
   │ 注意：只对新消息有效，旧消息在旧分区   │
   └──────────────────────────────────────┘

3. 异步处理
   ┌──────────────────────────────────────┐
   │ Consumer收到消息 → 写入本地队列        │
   │ 后台线程池异步处理 → 不阻塞消费         │
   │ 注意：需要处理处理失败的重试逻辑        │
   └──────────────────────────────────────┘

4. 消费降级
   ┌──────────────────────────────────────┐
   │ 积压期间：跳过部分处理步骤              │
   │ 如：不发送通知、不写日志、不更新统计    │
   │ → 减少每条消息的处理时间               │
   └──────────────────────────────────────┘
```

## 四、面试加分点

1. **提到Partition和Consumer的关系**：一个Partition只能被一个Consumer消费，所以Consumer数≤Partition数，超过的Consumer空闲
2. **提到Rebalance**：增加Consumer实例会触发Rebalance，期间消费暂停（stop-the-world），频繁Rebalance会影响吞吐
3. **提到Kafka Monitoring工具**：Kafka Manager / Cruise Control / Burrow 专门监控ConsumerLag
4. **提到死信队列(DLQ)**：无法处理的消息发到死信Topic，不影响正常消息的消费
5. **提到流式处理**：对于积压消息，可以用Kafka Streams/Flink做并行处理，比单Consumer效率高得多
