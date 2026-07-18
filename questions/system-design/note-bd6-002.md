---
id: note-bd6-002
difficulty: L4
category: system-design
subcategory: 分布式
tags:
- 字节
- 后端
- CDC
- 数据同步
- MQ
- 分布式系统
- 面经
feynman:
  essence: CDC(Change Data Capture)通过监听数据库Binlog实时捕获数据变更，将变更事件推送到MQ，多个下游系统各自消费实现数据同步。核心是"单数据源 → MQ扇出 → 多消费者各自处理"。
  analogy: 像报社发新闻——记者写好稿子（数据源变更），编辑发到通讯社（CDC+MQ），报纸、网站、APP各自从通讯社取稿子（下游消费），格式各不相同但源头只有一个。
  key_points:
  - CDC核心：监听Binlog而非定时轮询，实现毫秒级延迟
  - 架构：数据源 → CDC工具(Canal/Debezium) → MQ → 多下游消费者
  - 每个下游维护自己的消费offset，互不影响
  - 幂等消费：下游必须处理重复消息（网络重试场景）
  - Schema变更兼容：DDL变更需要下游能处理新结构
first_principle:
  essence: CDC = 数据变更事件的实时捕获和分发，本质是"发布订阅模式在数据同步领域的应用"
  derivation: 数据源变更→Binlog记录→CDC工具解析→发布到MQ Topic→各下游订阅消费→各自转为自己的数据格式存储→实现解耦的多向同步
  conclusion: CDC解决了"多系统数据一致性"问题，相比定时轮询有更低延迟和更小数据库压力
follow_up:
- CDC和定时全量同步有什么区别？（实时vs批量，增量vs全量）
- 如何处理CDC工具宕机后的数据断点？（记录Binlog位置/GTID，重启后从断点继续）
- 下游消费速度跟不上怎么办？（增加消费者+幂等处理+死信队列）
- DDL变更（加列/改类型）如何兼容？（Schema Registry+向后兼容策略）
memory_points:
- CDC架构：数据源→Binlog→CDC工具(Canal/Debezium)→MQ→多下游消费
- vs 定时轮询：CDC是推(Push)模式，延迟毫秒级；轮询是拉(Pull)模式，延迟分钟级
- 消费者必须幂等！Binlog重放或MQ重试都会导致重复消息
- 断点续传：记录消费到的Binlog position/GTID，CDC工具重启后从断点继续
- 一对多扇出：一个Topic多个Consumer Group各自维护offset，互不影响
---

# 【字节一面】基于 CDC 思想设计一个数据同步系统：单一数据源同步到多个下游系统，使用 MQ

> 来源：小红书 字节后端一二三面面试全流程回顾

## 一、整体架构

```
                    ┌──────────────┐
                    │   MySQL 主库   │  ← 单一数据源
                    │ (业务数据写入)  │
                    └──────┬───────┘
                           │ Binlog (行模式)
                           ▼
                    ┌──────────────┐
                    │  CDC 工具     │
                    │ (Canal/       │  ← 监听Binlog，解析变更事件
                    │  Debezium)    │
                    └──────┬───────┘
                           │ 变更事件 (INSERT/UPDATE/DELETE)
                           ▼
                    ┌──────────────┐
                    │  MQ (RocketMQ │  ← 扇出中心
                    │  / Kafka)     │
                    └──┬───┬───┬───┘
                       │   │   │
          ┌────────────┘   │   └──────────────┐
          ▼                ▼                  ▼
   ┌─────────────┐  ┌─────────────┐  ┌─────────────┐
   │  下游1:ES    │  │  下游2:Redis │  │  下游3:数仓  │
   │  搜索引擎    │  │  缓存        │  │  分析平台    │
   │             │  │             │  │             │
   │ Consumer    │  │ Consumer    │  │ Consumer    │
   │ Group: es   │  │ Group: redis│  │ Group: dw   │
   └─────────────┘  └─────────────┘  └─────────────┘
   
   各下游维护独立消费位点，互不影响
```

## 二、CDC 工作原理

```
MySQL Binlog → CDC解析 → 变更事件

Binlog 事件:
  INSERT: table=orders, after={id:1,amount:100,...}
  UPDATE: table=orders, before={id:1,amount:100}, after={id:1,amount:200}
  DELETE: table=orders, before={id:1,amount:100}

CDC解析后发送到MQ:
  Topic: cdc.orders
  Message: {
    "type": "UPDATE",
    "table": "orders",
    "before": {"id":1,"amount":100},
    "after": {"id":1,"amount":200},
    "ts": 1720000000000,
    "binlog_position": "mysql-bin.000123:4567",
    "gtid": "3E11FA47-71CA-11E1-9E33-C80AA9429562:123"
  }
```

## 三、核心实现

### CDC工具配置（Canal示例）

```yaml
# canal.properties 核心配置
canal.serverMode = rocketMQ        # 输出到RocketMQ
canal.mq.topic = cdc_orders        # Topic名称

# instance.properties
canal.instance.master.address = 127.0.0.1:3306
canal.instance.dbUsername = canal
canal.instance.dbPassword = ******
canal.instance.filter.regex = shop\\.orders  # 只监听orders表
canal.instance.parser.parallelBufferSize = 512
```

### 下游消费者（ES同步示例）

```java
@RocketMQMessageListener(
    topic = "cdc_orders",
    consumerGroup = "es_sync_group"  // 独立消费组
)
public class EsSyncConsumer implements RocketMQListener<CdcEvent> {
    
    @Override
    public void onMessage(CdcEvent event) {
        // 幂等检查：用event id做去重
        if (isProcessed(event.getId())) {
            return;
        }
        
        switch (event.getType()) {
            case "INSERT":
            case "UPDATE":
                // 转换数据格式 → 写入ES
                OrderDoc doc = convertToEsDoc(event.getAfter());
                esClient.index("orders_index", doc.getId(), doc);
                break;
            case "DELETE":
                esClient.delete("orders_index", event.getBefore().getId());
                break;
        }
        
        markProcessed(event.getId());
    }
}

// Redis缓存同步（另一个消费组）
@RocketMQMessageListener(
    topic = "cdc_orders", 
    consumerGroup = "redis_sync_group"  // 不同消费组，独立offset
)
public class RedisSyncConsumer implements RocketMQListener<CdcEvent> {
    @Override
    public void onMessage(CdcEvent event) {
        String key = "order:" + event.getAfter().getId();
        switch (event.getType()) {
            case "INSERT":
            case "UPDATE":
                redisTemplate.opsForValue().set(key, 
                    JSON.toJSONString(event.getAfter()));
                break;
            case "DELETE":
                redisTemplate.delete(key);
                break;
        }
    }
}
```

### 断点续传机制

```java
// CDC工具记录Binlog位置（Canal自动管理）
// 存储在ZooKeeper/meta.json中：
{
    "destination": "orders_cdc",
    "binlogPosition": "mysql-bin.000123:4567",
    "gtid": "3E11FA47-...:123",
    "timestamp": 1720000000000
}

// CDC工具重启后从记录的position继续读取Binlog
// 不会丢数据，可能有少量重复（幂等消费处理）
```

## 四、CDC vs 定时轮询对比

| 维度 | CDC (Binlog监听) | 定时轮询 |
|------|-----------------|---------|
| **延迟** | 毫秒级 | 分钟级 |
| **数据库压力** | 小（读Binlog不影响业务） | 大（周期性全量/增量查询） |
| **数据完整性** | 高（捕获所有变更） | 可能遗漏（两次轮询间的多次变更） |
| **实现复杂度** | 中（需维护CDC工具） | 低（简单定时任务） |
| **Schema变更** | 需处理DDL | 直接查新结构 |

## 五、面试加分点

1. **为什么用CDC不用轮询**：毫秒级延迟、不增加DB查询压力、不遗漏中间变更
2. **一对多扇出**：MQ的Consumer Group机制让各下游独立消费、互不影响
3. **断点续传**：CDC工具记录Binlog position/GTID，重启后从断点继续
4. **幂等消费**：下游必须处理重复消息——Binlog重放和MQ重试都会产生重复
5. **Schema变更兼容**：提到Schema Registry和向后兼容策略（加列向前兼容、删列向后兼容）


## 结构化回答

**30 秒电梯演讲：** CDC(Change Data Capture)通过监听数据库Binlog实时捕获数据变更，将变更事件推送到MQ，多个下游系统各自消费实现数据同步。

**展开框架：**
1. **CDC架构** — 数据源→Binlog→CDC工具(Canal/Debezium)→MQ→多下游消费
2. **vs 定时轮询** — CDC是推(Push)模式，延迟毫秒级；轮询是拉(Pull)模式，延迟分钟级
3. **消费者必须幂** — 消费者必须幂等！Binlog重放或MQ重试都会导致重复消息

**收尾：** 这块我踩过坑——要不要深入聊：CDC和定时全量同步有什么区别？（实时vs批量，增量vs全量）？

## 视频脚本

> 预计时长：4 分钟 | 由浅入深

| 时间 | 画面/字幕 | 口播台词 | 讲解要点 |
|------|----------|----------|----------|
| 0:00 | 标题卡 | "分布式一句话：CDC(Change Data Capture)通过监听数据库Binlog实时捕获数据变更…。" | 开场钩子 |
| 0:15 | TCP/IP 协议栈分层图 | "CDC架构：数据源到Binlog到CDC工具(Canal/Debezium)到MQ到多下游消费" | CDC架构 |
| 1:08 | TCP/IP 协议栈分层图分步演示 | "vs 定时轮询：CDC是推(Push)模式，延迟毫秒级；轮询是拉(Pull)模式，延迟分钟级" | vs 定时轮询 |
| 2:01 | 关键代码/伪代码片段 | "消费者必须幂等！Binlog重放或MQ重试都会导致重复消息" | 消费者必须幂 |
| 2:54 | 对比表格 | "断点续传：记录消费到的Binlog position/GTID，CDC工具重启后从断点继续" | 断点续传 |
| 3:50 | 总结卡 | "核心抓住这条主线，下期咱们接着聊：CDC和定时全量同步有什么区别？（实时vs批量，增量vs全量）。" | 收尾 |

## 苏格拉底式面试追问

| 追问层级 | 面试官可能这样问 | 高分回答方向 |
|----------|------------------|--------------|
| 目标追问 | 基于CDC的数据同步系统核心目标是什么？ | 准实时把单一数据源变更同步到多个下游，保证最终一致、低延迟、高可靠、不影响源库 |
| 证据追问 | 为什么用CDC+MQ而不是定时全量同步？ | CDC监听Binlog准实时（秒级）、只同步增量高效、对源库无侵入；定时全量延迟大、资源浪费、压力大 |
| 边界追问 | CDC和定时批量怎么选？ | 准实时要求高用CDC；容忍分钟级延迟且变更少可批量；混合方案——CDC增量+定期全量校对 |
| 反例追问 | CDC一定能保证不丢数据吗？ | 不一定。Binlog位点丢失、MQ消息丢失、下游消费失败都会丢；需要位点管理+MQ持久化+ack+对账兜底 |
| 风险追问 | CDC同步的风险有哪些？ | Binlog位点管理复杂、MQ积压、消息乱序、下游消费失败、 schema变更、循环复制 |
| 验证追问 | 怎么验证同步可靠？ | 对账（源和下游数据一致）、位点监控、延迟监控、消息成功率、故障注入测试 |
| 沉淀追问 | CDC系统怎么沉淀？ | 规范：Binlog位点管理+MQ持久化+幂等消费+对账兜底+延迟监控 |

### 现场对话示例
**面试官**：基于CDC设计一个数据同步系统，单源同步到多下游，用MQ。
**候选人**：CDC监听源库Binlog捕获变更→发MQ→多下游各自消费；位点管理保证不丢、MQ持久化+ack、幂等消费保证不重、对账兜底一致性。
**面试官**：为什么用CDC而不是定时全量？
**候选人**：CDC监听Binlog准实时秒级、只同步增量高效无侵入；定时全量延迟大资源浪费对源库压力大。
**面试官**：CDC怎么保证不丢数据？
**候选人**：Binlog位点管理+MQ持久化+消费ack+幂等+定期对账兜底，故障注入测试验证可靠性。
