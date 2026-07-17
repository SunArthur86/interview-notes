---
id: note-flg-001
difficulty: L3
category: system-design
subcategory: 消息队列
tags:
- RabbitMQ
- RocketMQ
- ActiveMQ
- 消息队列
- 飞猪
- 面经
- 选型
feynman:
  essence: 三者都是消息中间件但设计目标不同——RabbitMQ追求可靠路由和灵活Exchange(AMQP标准)，RocketMQ追求高吞吐和分布式事务(阿里双十一验证)，ActiveMQ是老牌全能选手但性能落后。选型本质是在"可靠性/灵活性/吞吐量"三角中找平衡。
  analogy: RabbitMQ像邮政系统——信件按地址精确路由，挂号信保证送达，但处理速度有上限；RocketMQ像快递分拣中心——高并发流水线，支持定时投递和事务包裹，双十一十亿包裹验证；ActiveMQ像老式电报局——功能齐全但设备老旧。
  first_principle: 消息中间件的核心权衡是CAP中的CP(一致性+分区容错)还是AP(可用性+分区容错)，以及延迟vs吞吐量的取舍。不同MQ在这个权衡谱上的位置不同。
  key_points:
  - 'RabbitMQ: AMQP协议, Exchange路由灵活, 消息可靠性高, 吞吐量万级TPS'
  - 'RocketMQ: 自研协议, 支持事务消息/定时消息, 吞吐量十万级TPS, 分布式原生'
  - 'ActiveMQ: JMS标准, 功能最全, 但性能最弱, 适合遗留系统'
  - '选型原则: 小规模可靠通信→RabbitMQ, 高吞吐业务→RocketMQ, 遗留系统→ActiveMQ'
first_principle:
  essence: MQ选型的根本问题是"你的业务最不能牺牲什么"——是消息绝对不能丢(RabbitMQ)、还是吞吐量必须扛住(RocketMQ)、还是必须兼容JMS(ActiveMQ)。
  derivation: 消息中间件的核心功能是解耦+异步+削峰 → 不同业务场景对这三个能力的权重不同 → 金融场景需要事务消息(RocketMQ) → 微服务通信需要灵活路由(RabbitMQ) → 所以不存在"最好的MQ"只有"最合适的MQ"
  conclusion: 选型 = 明确约束条件(吞吐/延迟/可靠性/团队熟悉度) → 匹配MQ能力 → 选择
follow_up:
- Kafka和这三个MQ有什么区别？什么时候用Kafka？
- RabbitMQ的消息丢失怎么防止？
- RocketMQ的事务消息原理是什么？
- 如果MQ宕机了怎么办？怎么保证高可用？
memory_points:
- "RabbitMQ: AMQP + Exchange灵活路由 + 万级TPS + Erlang底层"
- "RocketMQ: 事务消息 + 定时消息 + 十万级TPS + Java底层 + 阿里开源"
- "ActiveMQ: JMS全功能 + 性能最弱 + 遗留系统维护"
- "选型矩阵: 低吞吐高可靠→RabbitMQ, 高吞吐→RocketMQ, 大数据流→Kafka"
---

# RabbitMQ、RocketMQ和ActiveMQ的主要差异及选型

## 🎯 本质

三者设计目标不同：RabbitMQ = 灵活路由+高可靠，RocketMQ = 高吞吐+事务消息，ActiveMQ = JMS全功能但性能落后。

## 🧒 费曼类比

RabbitMQ = 邮政系统（精确路由、挂号信、速度有限）；RocketMQ = 快递分拣中心（高并发流水线、定时投递、双十一验证）；ActiveMQ = 老式电报局（功能齐全、设备老旧）。

## 📊 核心对比

```
┌──────────┬──────────────┬──────────────┬──────────────┐
│          │  RabbitMQ    │  RocketMQ    │  ActiveMQ    │
├──────────┼──────────────┼──────────────┼──────────────┤
│ 协议     │ AMQP/MQTT    │ 自研(类Kafka)│ JMS/AMQP     │
│ 语言     │ Erlang       │ Java         │ Java         │
│ 吞吐量   │ 万级TPS      │ 十万级TPS    │ 万级TPS      │
│ 延迟     │ 微秒级       │ 毫秒级       │ 毫秒级       │
│ 消息可靠 │ 高(ACK+持久化)│ 高(同步刷盘)  │ 中           │
│ 事务消息 │ 不支持       │ ✅ 支持       │ 弱支持       │
│ 定时消息 │ 插件(TTL+DLX)│ ✅ 原生支持   │ 插件         │
│ 路由灵活性│高(Exchange)  │ 中(Topic/Tag)│ 中           │
│ 顺序消息 │ 队列级       │ 队列级+分区   │ 队列级       │
│ 集群     │ 镜像队列     │ 原生分布式    │ NetworkofBkr │
│ 适用场景 │ 微服务通信   │ 电商/金融     │ 遗留系统     │
│ 大厂使用 │ 中小型       │ 阿里/滴滴     │ 历史项目     │
└──────────┴──────────────┴──────────────┴──────────────┘
```

## 🔧 专业详解

### 1. 架构模型差异

**RabbitMQ** — Exchange-Queue模型：
```
Producer → [Exchange] → Binding Rule → [Queue] → Consumer
             │
             ├── Direct: 精确匹配routing key
             ├── Topic: 模式匹配(通配符)
             ├── Fanout: 广播
             └── Headers: 头部匹配
```

**RocketMQ** — Topic-Tag模型：
```
Producer → [Topic] → [MessageQueue] → Consumer
             │           │
             │           └── 分区(类似Kafka partition)
             └── Tag: 子主题过滤
             
特殊能力:
  ├── 事务消息: 半消息+回查机制
  ├── 定时消息: 18个延迟级别
  └── 消息轨迹: 全链路追踪
```

**ActiveMQ** — Destination模型：
```
Producer → [Destination] → Consumer
             ├── Queue: 点对点
             └── Topic: 发布订阅
支持JMS完整API + AMQP + MQTT
但底层基于KahaDB/LevelDB, 性能瓶颈明显
```

### 2. 事务消息对比（关键差异）

```java
// RocketMQ 事务消息 — 原生支持
TransactionMQProducer producer = new TransactionMQProducer("group");
producer.setTransactionListener(new TransactionListener() {
    @Override
    public LocalTransactionState executeLocalTransaction(Message msg, Object arg) {
        // 执行本地事务(如扣款)
        try {
            deductAccount(msg);
            return LocalTransactionState.COMMIT_MESSAGE;
        } catch (Exception e) {
            return LocalTransactionState.ROLLBACK_MESSAGE;
        }
    }
    
    @Override
    public LocalTransactionState checkLocalTransaction(MessageExt msg) {
        // 事务回查: MQ主动询问本地事务状态
        return isDeducted(msg) ? LocalTransactionState.COMMIT_MESSAGE 
                                : LocalTransactionState.ROLLBACK_MESSAGE;
    }
});
// 半消息机制: 先发半消息→执行本地事务→提交/回滚→超时回查
```

```python
# RabbitMQ 无原生事务消息, 需用"发件箱模式"模拟
# 1. 业务数据+消息在同一个DB事务中写入
# 2. 定时任务扫描未发送的消息 → 发送到RabbitMQ
# 3. 发送成功后标记为已发送
```

### 3. 选型决策树

```
你的场景是什么?
    │
    ├── 吞吐量 > 10万TPS?
    │   ├── 是 → Kafka (日志/大数据) 或 RocketMQ (业务消息)
    │   └── 否 → 继续
    │
    ├── 需要事务消息?
    │   ├── 是 → RocketMQ ⭐ (唯一原生支持的)
    │   └── 否 → 继续
    │
    ├── 需要复杂路由?
    │   ├── 是 → RabbitMQ ⭐ (Exchange最灵活)
    │   └── 否 → 继续
    │
    ├── 团队技术栈?
    │   ├── Java + 高吞吐 → RocketMQ
    │   ├── 多语言 + 可靠 → RabbitMQ
    │   └── 遗留JMS系统 → ActiveMQ
    │
    └── 结论: 没有"最好的MQ", 只有"最合适的MQ"
```

## 💻 实际项目选型示例

```java
// 飞猪(阿里系)项目: 选择RocketMQ
// 原因: 阿里技术栈 + 高吞吐 + 事务消息支持

// 场景1: 订单创建 → 扣库存 → 支付 (需要事务消息)
TransactionMQProducer producer = new TransactionMQProducer("order_group");
// 本地事务: 创建订单 → 事务消息: 通知库存服务
// 保证: 订单创建成功 && 库存扣减消息一定被发送

// 场景2: 限时秒杀 (高吞吐)
// RocketMQ 10万+TPS扛住秒杀洪峰
// Consumer按MessageQueue消费保证顺序

// 场景3: 延迟取消订单
// RocketMQ定时消息: 30分钟延迟 → 自动取消未支付订单
```

## 💡 例子

**飞猪后端选型**：
- 业务：社保/医保公共服务平台
- 需求：高可靠 + 事务一致性 + 阿里技术栈
- 选型：**RocketMQ**（事务消息保证参保/报销流程的一致性 + 延迟消息实现审批超时自动处理）

## ❓ 苏格拉底式面试追问

1. **"RabbitMQ怎么保证消息不丢失？"**
   → 生产端: confirm模式(ACK确认) + 消息端: 手动ACK + Broker: 持久化(durable queue + persistent message) + 镜像队列(高可用)

2. **"RocketMQ的事务消息原理是什么？"**
   → 半消息(对Consumer不可见) → 执行本地事务 → 提交/回滚 → 超时后Broker主动回查Producer → 保证最终一致性

3. **"Kafka vs RocketMQ，什么时候选Kafka？"**
   → Kafka: 大数据/日志流(百万TPS) + 允许少量消息丢失 → RocketMQ: 业务消息(事务/定时/顺序) + 不能丢

4. **"MQ的消费者怎么保证幂等？"**
   → 去重表(唯一键) / Redis SETNX / 数据库唯一约束 / 业务状态判断 → 参见note-flg-002


## 结构化回答

**30 秒电梯演讲：** 三者都是消息中间件但设计目标不同——RabbitMQ追求可靠路由和灵活Exchange(AMQP标准)，RocketMQ追求高吞吐和分布式事务(阿里双十一验证)，ActiveMQ是老牌全能选手但性能落后。选型本质是在"可靠性/灵活性/吞吐量"三角中找平衡。

**展开框架：**
1. **RabbitMQ** — AMQP + Exchange灵活路由 + 万级TPS + Erlang底层
2. **RocketMQ** — 事务消息 + 定时消息 + 十万级TPS + Java底层 + 阿里开源
3. **ActiveMQ** — JMS全功能 + 性能最弱 + 遗留系统维护

**收尾：** 这块我踩过坑——要不要深入聊：Kafka和这三个MQ有什么区别？什么时候用Kafka？

## 视频脚本

> 预计时长：3 分钟 | 由浅入深

| 时间 | 画面/字幕 | 口播台词 | 讲解要点 |
|------|----------|----------|----------|
| 0:00 | 标题卡 | "消息队列一句话：三者都是消息中间件但设计目标不同——RabbitMQ追求可靠路由和灵活Exchange(AMQP标准)…。" | 开场钩子 |
| 0:15 | RabbitMQ 消息流转图 | "RabbitMQ: AMQP + Exchange灵活路由 + 万级TPS + Erlang底层" | RabbitMQ |
| 1:06 | RabbitMQ 消息流转图分步演示 | "RocketMQ: 事务消息 + 定时消息 + 十万级TPS + Java底层 + 阿里开源" | RocketMQ |
| 1:57 | 关键代码/伪代码片段 | "ActiveMQ: JMS全功能 + 性能最弱 + 遗留系统维护" | ActiveMQ |
| 2:50 | 总结卡 | "核心抓住这条主线，下期咱们接着聊：Kafka和这三个MQ有什么区别？什么时候用Kafka。" | 收尾 |
