---
id: note-fl-013
difficulty: L3
category: ai
subcategory: 中间件
tags:
- 字节
- 飞连
- 面经
- Redis
- Kafka
- 消息队列
feynman:
  essence: Redis Stream vs Kafka——Redis Stream 看持久化模式(RDB/AOF)，AOF everysec 仍可能丢1s；Kafka 磁盘顺序写+副本更强。吞吐 Redis 单机十万级，Kafka 单机百万级。两者都有消费组+ACK。Redis Stream 未ACK消息留 Pending List，挂掉的 consumer 重启能 claim 回去。已有Redis+量不大+想少组件→Stream；高吞吐+跨团队+严格一致→Kafka。
  analogy: Redis Stream 像小区快递柜（够用、就近、偶尔丢件），Kafka 像专业物流中心（吞吐大、可追溯、跨城市）。小社区用快递柜够了，跨国电商必须物流中心。
  first_principle: 消息队列的本质诉求是"解耦 + 削峰 + 可靠投递"。Redis Stream 胜在轻量（已有 Redis 就能用），Kafka 胜在专业（高吞吐 + 强一致 + 生态）。
  key_points:
  - '持久化：Redis看模式(AOF everysec可能丢1s)，Kafka磁盘顺序写+副本更强'
  - '吞吐：Redis单机十万级，Kafka单机百万级'
  - '消费组：都有；ACK用XACK vs offset commit'
  - 'Redis Stream Pending List：未ACK消息留存，consumer重启能claim回去'
  - '选型：已有Redis+量不大→Stream；高吞吐+跨团队+严格一致→Kafka'
first_principle:
  essence: 消息队列 = 解耦 + 削峰 + 可靠投递
  derivation: 生产者消费者需解耦 → 引入中间层 → 中间层要可靠投递(ACK/重试) → 要削峰(缓冲) → Redis Stream 轻量满足小规模，Kafka 专业满足大规模
  conclusion: 消息队列选型 = 规模 + 可靠性需求 + 已有基础设施 的综合权衡
follow_up:
- Redis Stream 能保证消息不丢吗？什么配置下接近不丢？
- Kafka 的 exactly-once 语义怎么实现？
- Agent 系统的事件总线用 Redis Stream 还是 Kafka？
---

# 【字节飞连面经】Redis Stream vs Kafka：怎么选？

## 一、核心对比

| 维度 | Redis Stream | Kafka |
|------|-------------|-------|
| 持久化 | 看 Redis 持久化模式（RDB/AOF），AOF everysec 仍可能丢 1s | 磁盘顺序写 + 副本，更强 |
| 吞吐 | 单机十万级 | 单机百万级 |
| 消费组 | 有（XGROUP） | 有（Consumer Group） |
| ACK | XACK | offset commit |
| Pending List | **未 ACK 的消息会留在 Pending List**，挂掉的 consumer 重启能 claim 回去 | 类似机制是 uncommitted offset |
| 延迟 | 亚毫秒级 | 毫秒级 |
| 部署 | 已有 Redis 就能用 | 需要独立集群（Zookeeper/KRaft） |
| 适用 | 中小规模事件、Agent 步骤日志、消息总线 | 大规模日志、跨系统数据管道 |

## 二、Pending List 机制（Redis Stream 精华）

```
consumer 从 Stream 读消息（XREADGROUP）→ 消息进入该 consumer 的 Pending List
  │
  ├─consumer 正常处理完 → XACK → 从 Pending List 移除
  │
  └─consumer 挂掉 → 消息留在 Pending List
       → 其他 consumer 用 XCLAIM 把 Pending List 的消息认领走
       → 重新处理（实现"至少一次"投递）
```

**XPENDING** 查看哪些消息没 ACK，**XCLAIM** 认领挂掉 consumer 的消息。

## 三、Redis Stream 能保证消息不丢吗？

**接近不丢，但仍弱于 Kafka**：
- `appendfsync always`（每次写都 fsync）→ 接近不丢，但性能大降
- 主从复制 → 副本兜底
- 但 Redis 的持久化是"事后补"（AOF 是写后日志），极端情况仍可能丢

**Kafka 不丢的保障**：
- 写时多副本同步（`acks=all` + `min.insync.replicas=2`）
- 磁盘顺序写（性能高）
- ISR（In-Sync Replicas）机制

## 四、什么时候选哪个

| 场景 | 选谁 | 理由 |
|------|------|------|
| 已有 Redis、量不大、想少一个组件 | **Stream** | 不引入新依赖 |
| Agent 步骤日志、消息总线 | **Stream** | 中小规模够用 |
| 高吞吐 / 跨团队数据管道 | **Kafka** | 专业、可追溯 |
| 严格一致性（金融、订单） | **Kafka** | 不丢保障更强 |

## 五、Agent 系统的事件总线

**典型选择**：Redis Stream
- Agent 步骤事件量级中等（单 Agent 每秒几十条）
- 已有 Redis（存会话状态）
- 不想再引入 Kafka 集群

**升级到 Kafka 的信号**：
- 多团队共享事件流（如数据团队消费 Agent 日志做分析）
- 吞吐到百万级 QPS
- 需要严格不丢（如订单链路）

## 六、加分点

- 说出 **Kafka 的 exactly-once**：通过幂等生产者（`enable.idempotence=true`）+ 事务（事务 ID 跨 session）+ 消费端只读 committed 消息实现
- 说出 **Redis 5.0 引入 Stream** 就是为了对标 Kafka 的消息队列能力

## 七、扩展

- **Redis Stream 的 maxlen**：`XADD stream MAXLEN ~ 10000 * field value` 限制流长度，~ 表示近似裁剪（性能好）
- **Kafka 的 partition**：并行消费的关键，一个 partition 只能被一个 consumer 消费（同组内）
- **Pulsar**：介于两者之间，计算存储分离，云原生友好
