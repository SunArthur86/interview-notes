---
id: note-flg-003
difficulty: L3
category: database
subcategory: ES
tags:
- Elasticsearch
- MySQL同步
- Canal
- 全文搜索
- 飞猪
- 面经
feynman:
  essence: ES解决MySQL不擅长的全文搜索+多维聚合+模糊匹配场景。数据同步的核心挑战是"近实时一致性"——通过Canal监听MySQL binlog增量同步到ES，再配合定时全量补偿，达到秒级延迟的数据一致性。
  analogy: MySQL像档案室的纸质文件(精确查找但要翻柜子)，ES像档案室的电子索引系统(秒搜全文但不是原件)。Canal就是一个"自动抄录员"——档案室每次有新文件，它就同步抄一份到电子索引系统。
  first_principle: 不同存储引擎擅长不同场景——MySQL擅长事务+精确查询，ES擅长全文检索+聚合分析。数据同步的本质是"在正确的时间把正确的数据放到正确的引擎中"。
  key_points:
  - 'ES场景: 全文搜索/多条件组合查询/模糊匹配/聚合统计/地理位置搜索'
  - '同步方案: Canal binlog增量 + 定时全量补偿 + MQ削峰'
  - '一致性保证: 秒级最终一致 + 补偿机制 + 对账校验'
  - 'ES设计: Mapping设计(分词器/索引类型) + 分片策略 + 深度分页优化'
first_principle:
  essence: 数据存储应该遵循"各取所长"原则——每个引擎做自己最擅长的事，通过同步保持一致性。
  derivation: MySQL B+Tree擅长精确查询但不擅长全文搜索 → ES倒排索引擅长全文搜索但不支持事务 → 业务同时需要两种能力 → 所以双写/同步 → 但双写有一致性问题 → 所以用Canal binlog做单向同步
  conclusion: MySQL(主存储) → Canal(增量同步) → ES(搜索副本) = 各取所长 + 最终一致
follow_up:
- Canal同步有延迟，用户搜索到的数据不是最新的怎么办？
- ES和MySQL数据不一致怎么排查和修复？
- ES的深度分页性能问题怎么解决？
- 什么场景不适合用ES？
memory_points:
- "ES适用: 全文搜索/多维度过滤/聚合统计/模糊匹配"
- "同步方案: Canal(binlog)增量同步 + 定时全量补偿 + MQ削峰"
- "一致性: 秒级最终一致(非强一致) + 对账机制"
- "ES Mapping设计: keyword(精确) vs text(分词) + 分片数 = 数据节点数"
---

# Elasticsearch查询场景与MySQL数据同步

## 🎯 本质

ES承载MySQL不擅长的全文搜索/多维聚合/模糊匹配。通过Canal监听binlog做增量同步，达到秒级最终一致。

## 🧒 费曼类比

MySQL = 档案室纸质文件（精确但翻找慢）；ES = 电子索引系统（秒搜全文但不是原件）；Canal = 自动抄录员（有新文件就同步到电子系统）。

## 📊 系统架构

```
    ┌─────────────┐
    │  Application │
    └──────┬──────┘
           │
     ┌─────┴──────┐
     ▼            ▼
┌─────────┐  ┌──────────┐
│  MySQL  │  │    ES     │
│ (主存储) │  │ (搜索副本) │
│         │  │           │
│ 精确查询  │  │ 全文搜索   │
│ 事务ACID │  │ 多维聚合   │
└────┬────┘  └──────▲────┘
     │              │
     │ binlog       │ 增量同步
     ▼              │
┌──────────┐  ┌─────┴─────┐
│  Canal   │→ │ MQ(Kafka) │──→ ES Indexer
│ (监听器)  │  │ (削峰缓冲) │    (写入ES)
└──────────┘  └───────────┘
     │
     │              ┌───────────────┐
     │              │ 定时全量补偿   │
     └─────────────→│ (每天凌晨对账) │
                    └───────────────┘
```

## 🔧 专业详解

### 1. ES典型查询场景

```json
// 场景1: 全文搜索 (MySQL的LIKE效率低，ES倒排索引秒搜)
POST /orders/_search
{
  "query": {
    "match": {
      "description": "医保报销"  // 自动分词搜索
    }
  }
}

// 场景2: 多维度组合过滤 (MySQL需要多列索引，ES天然支持)
POST /orders/_search
{
  "query": {
    "bool": {
      "must": [{"match": {"status": "已完成"}}],
      "filter": [
        {"range": {"amount": {"gte": 100, "lte": 5000}}},
        {"term": {"city": "杭州"}},
        {"range": {"created_at": {"gte": "2024-01-01"}}}
      ]
    }
  }
}

// 场景3: 聚合统计 (MySQL GROUP BY大数据量慢，ES聚合快)
POST /orders/_search
{
  "size": 0,
  "aggs": {
    "city_stats": {
      "terms": {"field": "city", "size": 10},
      "aggs": {
        "avg_amount": {"avg": {"field": "amount"}},
        "total_count": {"value_count": {"field": "order_id"}}
      }
    }
  }
}

// 场景4: 模糊匹配 (MySQL全文索引功能弱)
POST /users/_search
{
  "query": {
    "fuzzy": {
      "name": {"value": "张三", "fuzziness": "AUTO"}
    }
  }
}
```

### 2. MySQL → ES 数据同步方案

| 方案 | 原理 | 延迟 | 复杂度 | 适用场景 |
|------|------|------|--------|---------|
| **Canal binlog** | 监听MySQL binlog增量同步 | 秒级 | 中 | ⭐ 生产推荐 |
| **双写** | 代码同时写MySQL和ES | 实时 | 低 | 简单但有一致性风险 |
| **定时全量** | 定时任务全量同步 | 小时级 | 低 | 数据量小 |
| **MQ异步** | 写MySQL后发MQ→消费写ES | 秒级 | 中 | 已有MQ基础设施 |
| **Canal+MQ** | Canal→MQ→ES(削峰) | 秒级 | 高 | ⭐ 高吞吐推荐 |

#### Canal增量同步实现

```java
// Canal Client 消费binlog变更
public class CanalESSync {
    
    public void startSync() {
        CanalConnector connector = CanalConnectors
            .newSingleConnector(
                new InetSocketAddress("canal-server", 11111),
                "example", "", "");
        
        connector.connect();
        connector.subscribe(".*\\..*");  // 订阅所有库表
        
        while (running) {
            Message msg = connector.getWithoutAck(1000); // 批量获取
            long batchId = msg.getId();
            
            if (batchId != -1 && msg.getEntries().size() > 0) {
                for (CanalEntry.Entry entry : msg.getEntries()) {
                    if (entry.getEntryType() == EntryType.ROWDATA) {
                        CanalEntry.RowChange rowChange = CanalEntry.RowChange
                            .parseFrom(entry.getStoreValue());
                        
                        for (RowData rowData : rowChange.getRowDatasList()) {
                            // INSERT/UPDATE/DELETE → 转换为ES操作
                            syncToES(rowChange.getEventType(), rowData);
                        }
                    }
                }
            }
            connector.ack(batchId);  // 确认消费
        }
    }
    
    private void syncToES(EventType eventType, RowData rowData) {
        switch (eventType) {
            case INSERT:
            case UPDATE:
                Map<String, Object> doc = convertRowToMap(rowData.getAfterColumnsList());
                esClient.index(IndexRequest.of(i -> i
                    .index("orders")
                    .id(doc.get("id").toString())
                    .document(doc)
                ));
                break;
            case DELETE:
                String id = getColumnValue(rowData.getBeforeColumnsList(), "id");
                esClient.delete(d -> d.index("orders").id(id));
                break;
        }
    }
}
```

### 3. ES Mapping设计要点

```json
PUT /orders
{
  "mappings": {
    "properties": {
      "order_id":    {"type": "keyword"},           // 不分词，精确匹配
      "description": {"type": "text",                // 分词，全文搜索
                       "analyzer": "ik_max_word"},   // 中文分词器
      "amount":      {"type": "double"},
      "status":      {"type": "keyword"},
      "city":        {"type": "keyword"},
      "created_at":  {"type": "date"},
      "tags":        {"type": "keyword"}             // 数组类型
    }
  },
  "settings": {
    "number_of_shards": 3,      // 分片数 = 数据节点数
    "number_of_replicas": 1     // 副本数(高可用)
  }
}
```

### 4. 深度分页优化

```python
# 问题: from + size > 10000 时ES性能急剧下降
# 方案1: search_after (推荐, 游标式)
GET /orders/_search
{
  "size": 20,
  "sort": [{"created_at": "desc"}, {"order_id": "asc"}],
  "search_after": ["2024-01-15T10:00:00", "ORD001"]  # 上一页最后一条的排序值
}

# 方案2: scroll (大数据量导出)
POST /orders/_search?scroll=1m
{"size": 100, "query": {"match_all": {}}}
# → 返回scroll_id, 后续用scroll_id翻页
```

## 💡 例子

**飞猪社保项目场景**：
- MySQL存储参保人的精确数据（身份证、参保状态等）→ 支持事务一致性的精确查询
- ES同步全量参保数据 → 支持"按地区+年龄+参保类型+模糊姓名"的多维搜索
- Canal监听MySQL变更 → 秒级同步到ES → 用户搜索到最新数据
- 每天2AM定时全量对账 → 修复增量同步可能的遗漏

## ❓ 苏格拉底式面试追问

1. **"Canal同步延迟3秒，用户刚修改了信息搜索不到怎么办？"**
   → 接受秒级延迟(最终一致性) / 修改后直接提示"数据更新中" / 关键场景读MySQL兜底

2. **"ES和MySQL数据不一致怎么排查？"**
   → 定时全量对账(比对count和抽样数据) / 在ES文档中记录version(MySQL的更新时间戳) / 对账API逐条比较

3. **"ES的聚合查询在大数据量下会不会OOM？"**
   → 使用cardinality聚合(HyperLogLog)代替terms去重 / 设置size限制 / 使用doc_values避免fielddata

4. **"什么时候不应该用ES？"**
   → 强事务需求(ES不支持事务) / 数据量很小(MySQL够用) / 只需精确查询(不需要全文搜索) / 频繁更新(ES更新成本高)


## 结构化回答

**30 秒电梯演讲：** ES解决MySQL不擅长的全文搜索+多维聚合+模糊匹配场景。数据同步的核心挑战是"近实时一致性"——通过Canal监听MySQL binlog增量同步到ES，再配合定时全量补偿，达到秒级延迟的数据一致性。

**展开框架：**
1. **ES适用** — 全文搜索/多维度过滤/聚合统计/模糊匹配
2. **同步方案** — Canal(binlog)增量同步 + 定时全量补偿 + MQ削峰
3. **一致性** — 秒级最终一致(非强一致) + 对账机制

**收尾：** 这块我踩过坑——要不要深入聊：Canal同步有延迟，用户搜索到的数据不是最新的怎么办？

## 视频脚本

> 预计时长：3 分钟 | 由浅入深

| 时间 | 画面/字幕 | 口播台词 | 讲解要点 |
|------|----------|----------|----------|
| 0:00 | 标题卡 | "ES一句话：ES解决MySQL不擅长的全文搜索+多维聚合+模糊匹配场景。数据同步的核心挑战是'近实时一致性'…。" | 开场钩子 |
| 0:15 | 消息队列架构图 | "ES适用: 全文搜索/多维度过滤/聚合统计/模糊匹配" | ES适用 |
| 1:06 | 消息队列架构图分步演示 | "同步方案: Canal(binlog)增量同步 + 定时全量补偿 + MQ削峰" | 同步方案 |
| 1:57 | 关键代码/伪代码片段 | "一致性: 秒级最终一致(非强一致) + 对账机制" | 一致性 |
| 2:50 | 总结卡 | "核心抓住这条主线，下期咱们接着聊：Canal同步有延迟，用户搜索到的数据不是最新的怎么办。" | 收尾 |
