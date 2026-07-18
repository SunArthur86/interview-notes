---
id: note-rmq-003
difficulty: L3
category: system-design
subcategory: 消息队列
tags:
- Java
- RocketMQ
- 事务消息
- 分布式事务
- 半消息
- 大厂二面
- 面经
feynman:
  essence: RocketMQ事务消息用"半消息+本地事务+回查"三步实现最终一致——先发一条对消费者不可见的半消息，执行本地事务，成功则提交（消费者可见），失败则回滚。如果Producer宕机，Broker定期回查本地事务状态。
  analogy: 像发快递前先打包贴单（半消息，快递员已收但还没寄出），然后确认你要不要寄（本地事务）。确认寄就发出去（commit），不寄就退回（rollback）。如果你人跑了（宕机），快递员会打电话问你的家人（回查）。
  key_points:
  - 半消息：发送后对消费者不可见，状态为"待确认"
  - 本地事务执行成功→commit→消费者可见；失败→rollback→删除
  - 回查机制：Producer宕机后Broker定期回调checkLocalTransaction
  - 本质替代了本地消息表方案，无需自己维护消息表
  - 回查的时间间隔和超时次数是高频追问点
first_principle:
  essence: 事务消息 = 把"本地事务"和"消息发送"绑定为一个原子操作，通过半消息状态管理实现
  derivation: 先发半消息(Broker收到但消费者不可见)→执行本地事务→根据结果commit/rollback→如果Producer挂了Broker回查补偿→保证本地事务和消息最终一致
  conclusion: RocketMQ事务消息是分布式事务最终一致性的优雅实现，比本地消息表少维护一张表
follow_up:
- 回查的时间间隔是多少？超时次数限制？
- 事务消息和本地消息表方案哪个更好？
- 如果本地事务一直不返回结果怎么办？
- Kafka支持事务消息吗？和RocketMQ有什么区别？
memory_points:
- 三步流程：1.发半消息(消费者不可见) 2.执行本地事务 3.commit/rollback
- 回查机制：Broker定期(默认60s)回调Producer的checkLocalTransaction，最多回查15次
- 半消息存在特殊Topic：RMQ_SYS_TRANS_HALF_TOPIC，commit后转投到真实Topic
- 回查需实现checkLocalTransaction()，返回COMMIT/ROLLBACK/UNKNOWN
- 事务消息本质=本地消息表的Broker托管版，无需自建消息表
---

# 【大厂二面】RocketMQ 事务消息的实现原理？

> 来源：小红书 Java大厂二面 RocketMQ踩坑复盘

## 一、为什么需要事务消息

```
问题场景：创建订单 + 发送消息通知库存扣减

// 传统做法：先写DB再发MQ
@Transactional
public void createOrder(Order order) {
    orderMapper.insert(order);      // 1. 写DB
    producer.send("stock-topic", msg); // 2. 发MQ
    // 问题：如果第1步成功第2步失败 → 订单创建了但库存没扣
    //       如果第1步失败 → 没问题
    //       如果第2步成功后进程crash但事务还没提交 → 消费了但DB没数据
}
```

> RocketMQ事务消息解决的就是"本地事务+消息发送"的原子性问题。

## 二、事务消息完整流程

```
Producer                    Broker                    Consumer
   │                          │                          │
   │  1. 发送半消息             │                          │
   │ ──────────────────────►   │                          │
   │                          │  存入 HALF_TOPIC           │
   │                          │  (消费者不可见!)            │
   │  ◄──────────────────────  │                          │
   │  半消息发送成功             │                          │
   │                          │                          │
   │  2. 执行本地事务            │                          │
   │  (写订单DB)                │                          │
   │                          │                          │
   │  3. 根据本地事务结果         │                          │
   │     commit / rollback     │                          │
   │ ──────────────────────►   │                          │
   │                          │                          │
   │           ┌──── commit ──│  消息转入真实Topic          │
   │           │              │ ──────────────────────►   │
   │           │              │  消费者收到消息              │
   │           │              │                          │
   │           └──── rollback │  删除半消息                │
   │                          │  (标记删除，非物理删除)     │
   │                          │                          │
   │ ═══════════════════════════════════════════════════  │
   │                          │                          │
   │  4. 如果Producer宕机       │                          │
   │  (没有commit/rollback)     │                          │
   │                          │                          │
   │                          │  事务回查                   │
   │  ◄──────────────────────  │  (定期检查本地事务状态)     │
   │  checkLocalTransaction()  │                          │
   │  返回 COMMIT/ROLLBACK     │                          │
   │ ──────────────────────►   │                          │
```

### 半消息的特殊存储

```
RocketMQ 内部 Topic 结构

┌────────────────────────────────────────┐
│ RMQ_SYS_TRANS_HALF_TOPIC               │  ← 半消息存储在这里
│ (消费者无法订阅这个Topic)                  │
│                                        │
│ 消息1: order_001  status=HALF          │
│ 消息2: order_002  status=HALF          │
│ 消息3: order_003  status=HALF          │
└────────────────────────────────────────┘

commit后：
  消息1 → 从HALF_TOPIC取出，重新投递到真实Topic "OrderTopic"
  消费者就能消费了

rollback后：
  消息2 → 标记为已删除（写入Op队列）
  消费者永远看不到
```

## 三、代码实现

```java
// 事务消息生产者
TransactionMQProducer producer = new TransactionMQProducer("tx_group");
producer.setNamesrvAddr("127.0.0.1:9876");

// 设置事务监听器（核心）
producer.setTransactionListener(new TransactionListener() {
    
    // 执行本地事务（半消息发送成功后回调）
    @Override
    public LocalTransactionState executeLocalTransaction(Message msg, Object arg) {
        String orderId = msg.getKeys();
        try {
            // 执行本地数据库事务
            orderService.createOrder(orderId, parseBody(msg));
            return LocalTransactionState.COMMIT_MESSAGE;
        } catch (Exception e) {
            log.error("本地事务失败", e);
            return LocalTransactionState.ROLLBACK_MESSAGE;
        }
    }
    
    // 事务回查（Producer宕机后Broker回调）
    @Override
    public LocalTransactionState checkLocalTransaction(MessageExt msg) {
        String orderId = msg.getKeys();
        // 查询本地事务是否执行成功
        Order order = orderMapper.findById(orderId);
        if (order != null && order.getStatus() == OrderStatus.CREATED) {
            return LocalTransactionState.COMMIT_MESSAGE;
        } else if (order == null) {
            // 订单不存在，说明本地事务没执行 → 回滚
            return LocalTransactionState.ROLLBACK_MESSAGE;
        }
        // 不确定，让Broker稍后再次回查
        return LocalTransactionState.UNKNOW;
    }
});

producer.start();

// 发送事务消息
Message msg = new Message("OrderTopic", "TAG_A", 
    "order_001", orderData.getBytes());
TransactionSendResult result = producer.sendMessageInTransaction(msg, null);
// 此时半消息已发送，executeLocalTransaction会被回调
```

## 四、回查机制详解（高频追问点）

```
回查参数（Broker配置）

┌────────────────────────────────────────┐
│ transactionCheckMax = 15               │  ← 最多回查15次
│ transactionCheckInterval = 60s         │  ← 每60秒回查一次
│ transactionTimeout = 6s               │  ← 半消息超过6s未确认开始回查
└────────────────────────────────────────┘

回查时间线：
  T+0s:    半消息发送，Producer执行本地事务
  T+6s:    如果未收到commit/rollback，Broker开始第一次回查
  T+66s:   第二次回查
  T+126s:  第三次回查
  ...
  T+846s:  第15次回查（约14分钟后）
  超过15次: 标记为ROLLBACK，消息被丢弃

⚠️ 面试追问："回查的时间间隔、超时次数"
  答：默认60秒间隔，最多15次回查，超过后默认rollback
```

## 五、事务消息 vs 本地消息表

| 维度 | RocketMQ事务消息 | 本地消息表 |
|------|-----------------|-----------|
| 消息存储 | Broker的HALF_TOPIC | 业务数据库local_msg表 |
| 一致性保证 | Broker回查机制 | 定时任务扫描重试 |
| 开发成本 | 实现TransactionListener | 维护消息表+定时任务 |
| 数据库压力 | 无额外表 | 消息表随业务增长 |
| 依赖 | 强依赖RocketMQ | 通用（任何MQ都行） |
| 推荐场景 | 已用RocketMQ | 任何MQ环境 |

## 六、面试加分点

1. **半消息原理**：能说出半消息存在特殊Topic `RMQ_SYS_TRANS_HALF_TOPIC`，消费者不可见
2. **回查参数**：能答出默认60秒间隔、最多15次回查（面试官追问两次都没答准的痛点）
3. **回查实现**：checkLocalTransaction查数据库，返回COMMIT/ROLLBACK/UNKNOW
4. **本质理解**：事务消息=本地消息表的Broker托管版，无需自建消息表
5. **与Kafka对比**：Kafka事务消息是Producer端事务（多分区原子写入），RocketMQ是分布式事务（本地事务+消息原子）


## 结构化回答

**30 秒电梯演讲：** RocketMQ事务消息用"半消息+本地事务+回查"三步实现最终一致——先发一条对消费者不可见的半消息，执行本地事务，成功则提交（消费者可见），失败则回滚。

**展开框架：**
1. **三步流程** — 1.发半消息(消费者不可见) 2.执行本地事务 3.commit/rollback
2. **回查机制** — Broker定期(默认60s)回调Producer的checkLocalTransaction，最多回查15次
3. **半消息存在特殊Topic** — RMQ_SYS_TRANS_HALF_TOPIC，commit后转投到真实Topic

**收尾：** 这块我踩过坑——要不要深入聊：回查的时间间隔是多少？超时次数限制？

## 视频脚本

> 预计时长：3 分钟 | 由浅入深

| 时间 | 画面/字幕 | 口播台词 | 讲解要点 |
|------|----------|----------|----------|
| 0:00 | 标题卡 | "消息队列一句话：RocketMQ事务消息用'半消息+本地事务+回查'三步实现最终一致——先发一条对消费者不可见的半消息…。" | 开场钩子 |
| 0:15 | 消息队列架构图 | "三步流程：1.发半消息(消费者不可见) 2.执行本地事务 3.commit/rollback" | 三步流程 |
| 1:06 | 消息队列架构图分步演示 | "回查机制：Broker定期(默认60s)回调Producer的checkLocalTransaction，最多回查15次" | 回查机制 |
| 1:57 | 关键代码/伪代码片段 | "半消息存在特殊Topic：RMQ_SYS_TRANS_HALF_TOPIC，commit后转投到真实Topic" | 半消息存在特殊Topic |
| 2:50 | 总结卡 | "核心抓住这条主线，下期咱们接着聊：回查的时间间隔是多少？超时次数限制。" | 收尾 |

## 苏格拉底式面试追问

| 追问层级 | 面试官可能这样问 | 高分回答方向 |
|----------|------------------|--------------|
| 目标追问 | RocketMQ事务消息要解决什么问题？ | 本地事务和消息发送的原子性——要么本地事务成功且消息发出、要么都失败，避免'本地成功消息没发'或'消息发了本地回滚'的不一致 |
| 证据追问 | 半消息+本地事务+回查具体怎么协作？ | 生产者发半消息（对消费者不可见）→执行本地事务→根据本地事务结果commit/rollback半消息；超时未决Broker回查生产者本地事务状态 |
| 边界追问 | 事务消息和本地消息表怎么选？ | 事务消息无需额外表、Broker保证原子性但耦合MQ；本地消息表解耦但需额外表和定时任务；按架构选 |
| 反例追问 | 事务消息一定能保证一致吗？ | 保证最终一致不是强一致；回查也可能失败、消费端仍可能失败需幂等；是柔性事务 |
| 风险追问 | 事务消息的风险？ | 回查逻辑复杂、半消息超时管理、消费端失败需幂等重试、性能开销 |
| 验证追问 | 怎么验证事务消息可靠？ | 故障注入（本地事务失败/超时）、回查测试、消费幂等测试、对账验证 |
| 沉淀追问 | 事务消息怎么沉淀？ | 规范：本地事务幂等、回查实现、消费端幂等、监控回查成功率和消息一致性 |

### 现场对话示例
**面试官**：RocketMQ事务消息的实现原理？
**候选人**：半消息+本地事务+回查三步：发半消息（不可见）→执行本地事务→commit/rollback；超时未决Broker回查本地事务状态，保证本地事务和消息原子性。
**面试官**：事务消息和本地消息表怎么选？
**候选人**：事务消息无需额外表Broker保证原子性但耦合MQ；本地消息表解耦但需额外表和定时任务，按架构耦合度选。
**面试官**：事务消息一定保证一致吗？
**候选人**：保证最终一致不是强一致，回查可能失败、消费端仍需幂等重试，是柔性事务需要对账兜底。
