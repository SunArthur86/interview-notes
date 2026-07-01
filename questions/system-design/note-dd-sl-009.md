---
id: note-dd-sl-009
difficulty: L4
category: system-design
subcategory: 高并发
tags:
- 滴滴
- 面经
- 短链系统
- 分库分表
- 查询优化
feynman:
  essence: 分库分表后按用户维度查询是跨分片查询难题，需要用索引表或反范式解决。
  analogy: 就像在图书馆找自己借的所有书——书按书名分散在不同楼层，你需要一个个人借阅清单来快速定位。
  first_principle: 分片维度和查询维度不一致时，必须建立二级索引。
  key_points:
  - 建用户维度的索引表
  - 按用户ID分片的副表
  - ES倒排索引
  - 异构索引
first_principle:
  essence: 多维度查询需要异构索引
  derivation: 按短码分片→用户查询需全表扫描→建按用户ID分片的索引表→O(1)定位
  conclusion: 跨维度查询的银弹是异构索引
follow_up:
- 索引表和主表怎么保证数据一致？
- 索引表的数据量会不会也很大？
- 用ES做索引的写入延迟怎么处理？
memory_points:
- 本质冲突：因为数据按ShortCode分片，所以按user_id查询会导致全分片扫描
- 核心方案：建立异构索引表（按user_id分片），先查出short_code列表，再批量路由回查主表详情
- 方案对比：异构索引(通用首选)而ES倒排(适合复杂搜索)，用户维度副表(高频查询但需保证最终一致)
- 分页处理：索引表先排好序，主表查询时利用Pipeline/MGET批量获取，避免内存放大
---

# 【滴滴面经】如果一个用户创建了很多短链，他要查看自己的短链列表，你怎么设计查询？

## 一、问题本质：跨分片查询难题

这是一个经典的**分片维度冲突问题**。

短链系统的主表按**短码（ShortCode）**做哈希分片，数据均匀分布在 N 个库 M 个表中。这个分片策略对于"根据短码查长链"的场景非常高效——O(1) 定位。

但用户查看自己的短链列表时，查询条件是 **`WHERE user_id = ?`**，而数据是按 ShortCode 分散在所有分片上的。如果直接查，就是**全分片扫描（Fan-Out Query）**：

```
查询: SELECT * FROM short_url WHERE user_id = 12345

结果: 需要向所有 16 个分库 × 16 个分表 = 256 张表发送查询
      → 合并结果 → 性能极差，P99 可能 >2s
```

> **核心矛盾**：数据按 ShortCode 分片，查询按 user_id 过滤。**分片 Key 和查询 Key 不一致**。

---

## 二、三种解决方案对比

### 方案对比总览

| 方案 | 核心思路 | 查询延迟 | 实现复杂度 | 一致性 | 适用场景 |
|------|---------|---------|-----------|--------|---------|
| 异构索引表 | 建 user_id→short_code 映射表 | 低(~5ms) | 中 | 强一致 | 通用首选 |
| 用户维度副表 | 按 user_id 分片的冗余表 | 低(~3ms) | 高 | 最终一致 | 高频查询 |
| ES 倒排索引 | ElasticSearch 做二级索引 | 中(~20ms) | 中高 | 准实时 | 复杂搜索 |

---

## 三、方案一：异构索引表（推荐首选）

### 3.1 核心设计

**思路**：额外建一张**按 `user_id` 分片的索引表**，只存储 user_id → short_code 的映射关系（不存完整数据），查询时先从索引表拿到该用户的所有短码，再回主表查详情。

```
┌──────────────────────────────────────────────────────────────┐
│                     异构索引表设计                              │
│                                                              │
│  分片Key: user_id                                            │
│  存储内容: user_id, short_code, create_time                   │
│  分片策略: user_id % 16 (与主表不同的分片维度)                   │
│                                                              │
│  ┌────────────┬──────────────┬───────────────┐              │
│  │ user_id    │ short_code   │ create_time   │              │
│  ├────────────┼──────────────┼───────────────┤              │
│  │ 10001      │ aB3xK9       │ 2024-01-15    │              │
│  │ 10001      │ xK7mP2       │ 2024-01-16    │              │
│  │ 10001      │ qW8nL5       │ 2024-01-18    │              │
│  │ 10002      │ mN4pQ8       │ 2024-01-20    │              │
│  └────────────┴──────────────┴───────────────┘              │
└──────────────────────────────────────────────────────────────┘
```

### 3.2 查询流程

```
用户请求: 查看我的短链列表 (user_id=10001, page=1, size=20)

Step 1: 查索引表（按 user_id 分片，精确定位）
        SELECT short_code FROM user_short_link_index
        WHERE user_id = 10001
        ORDER BY create_time DESC
        LIMIT 0, 20
        → 得到: [aB3xK9, xK7mP2, qW8nL5, ...]

Step 2: 用短码批量查主表（按 short_code 分片）
        通过路由表/哈希定位各短码所在分片
        分组后批量查询（MGET / Pipeline）
        → 得到完整短链信息

Step 3: 合并返回
```

### 3.3 架构图

```
┌──────────────┐
│  用户请求      │  GET /api/my-links?userId=10001&page=1
└──────┬───────┘
       │
┌──────▼───────────────────────────────────────────────┐
│              应用服务层 (Application Layer)              │
│                                                      │
│  ┌─────────────────────────────────────────────────┐ │
│  │  1. 查索引表(user_id分片)                         │ │
│  │     → 得到 short_code 列表                       │ │
│  └───────────────────┬─────────────────────────────┘ │
│                      │                               │
│  ┌───────────────────▼─────────────────────────────┐ │
│  │  2. 批量查主表(short_code分片)                    │ │
│  │     → 路由定位 → 分组批量查询                      │ │
│  └───────────────────┬─────────────────────────────┘ │
│                      │                               │
│  ┌───────────────────▼─────────────────────────────┐ │
│  │  3. 合并排序返回                                   │ │
│  └─────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────┘
       │                                    │
       ▼                                    ▼
┌──────────────────┐              ┌──────────────────────┐
│  索引表集群        │              │   主表集群             │
│  (按user_id分片)   │              │  (按short_code分片)    │
│                  │              │                      │
│  db_00 tbl_00    │              │  db_00 tbl_00        │
│  db_01 tbl_01    │              │  db_01 tbl_03        │
│  ...             │              │  ...                 │
│  db_15 tbl_15    │              │  db_15 tbl_15        │
└──────────────────┘              └──────────────────────┘
```

### 3.4 索引表 DDL

```sql
-- 按 user_id 分库分表
CREATE TABLE user_short_link_index_0000 (
    id          BIGINT      PRIMARY KEY AUTO_INCREMENT,
    user_id     BIGINT      NOT NULL,
    short_code  VARCHAR(16) NOT NULL,
    long_url    VARCHAR(2048),              -- 冗余字段，避免回表
    title       VARCHAR(256),               -- 冗余字段
    status      TINYINT     DEFAULT 1,      -- 1正常 0删除
    create_time DATETIME    DEFAULT CURRENT_TIMESTAMP,
    update_time DATETIME    DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uk_user_code (user_id, short_code),
    INDEX idx_create_time (user_id, create_time)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
```

> **关键设计**：索引表中冗余了 `long_url`、`title` 等高频字段。对于"列表展示"场景，直接从索引表就能返回全部信息，**Step 2 回主表查询可以省略**，大幅降低延迟。

---

## 四、方案二：用户维度副表（完全反范式）

### 4.1 核心设计

**思路**：不只建索引，而是**完整复制一份按 user_id 分片的短链数据表**。主表负责"短码→长链"跳转，副表负责"用户→短链列表"查询。

```
主表 (short_code 分片)           副表 (user_id 分片)
┌───────────────────────┐       ┌───────────────────────────┐
│ short_code (PK)       │       │ user_id + short_code (PK) │
│ long_url              │       │ long_url (冗余)           │
│ user_id               │  ←→   │ status (冗余)             │
│ status                │  同步  │ create_time (冗余)        │
│ create_time           │       │ click_count (冗余)        │
│ ...                   │       │ ...                       │
└───────────────────────┘       └───────────────────────────┘
  职责: 短链跳转(O(1))            职责: 用户列表查询(O(1))
```

### 4.2 优缺点

**优点**：查询完全在一张分片表内完成，**无跨分片、无回表**，延迟最低。

**缺点**：数据冗余 2 倍存储，同步复杂度高，一致性维护成本大。

---

## 五、方案三：ES 倒排索引

### 5.1 核心设计

**思路**：将短链数据同步到 ElasticSearch，利用其强大的倒排索引能力做多维度查询。

```
┌────────────────────────────────────────────────────┐
│               ElasticSearch 索引                     │
│                                                    │
│  Mapping:                                          │
│  {                                                 │
│    "short_code": {"type": "keyword"},              │
│    "user_id":     {"type": "long"},                │
│    "long_url":    {"type": "text"},                │
│    "title":       {"type": "text", "analyzer": "ik"},│
│    "create_time": {"type": "date"},                │
│    "status":      {"type": "integer"}              │
│  }                                                 │
│                                                    │
│  查询能力:                                          │
│  - user_id 精确过滤      ✓                          │
│  - 长链接内容全文搜索    ✓                          │
│  - 时间范围 + 排序       ✓                          │
│  - 聚合统计             ✓                          │
└────────────────────────────────────────────────────┘
```

### 5.2 适用场景

- 需要复杂搜索（按长链 URL 内容搜索）
- 需要聚合统计（用户短链总数、按天统计）
- 数据量极大（亿级以上）

> **注意**：ES 方案的写入有延迟（通常 1-5 秒），不适合需要强一致的场景。

---

## 六、数据同步方案与一致性保障

### 6.1 三种同步策略

#### 策略一：同步双写（强一致，推荐用于索引表）

```java
@Transactional(rollbackFor = Exception.class)
public void createShortLink(String shortCode, String longUrl, Long userId) {
    // 1. 写主表（按 short_code 分片）
    mainTableMapper.insert(buildMainEntity(shortCode, longUrl, userId));

    // 2. 写索引表（按 user_id 分片）
    indexTableMapper.insert(buildIndexEntity(userId, shortCode, longUrl));

    // 3. 清除相关缓存
    redisTemplate.delete("user_links:" + userId);
}
```

**一致性保障**：

- **同一个事务**中写入主表和索引表（跨库时用 **Seata** 分布式事务）。
- 失败时整体回滚，保证强一致。
- 缺点：写入延迟增加（两个 DB 写入 + 事务开销）。

#### 策略二：异步消息（最终一致，推荐用于副表/ES）

```
主表写入 → 发送MQ消息 → 消费者异步写入索引表/ES
```

```java
// 生产者：写主表后发消息
public void createShortLink(String shortCode, String longUrl, Long userId) {
    mainTableMapper.insert(buildMainEntity(shortCode, longUrl, userId));

    // 发送 MQ 消息（异步同步到副表）
    LinkCreateEvent event = new LinkCreateEvent(shortCode, longUrl, userId);
    rocketMQTemplate.asyncSend("topic_link_create", event, callback);
}

// 消费者：异步写入索引/副表
@RocketMQMessageListener(topic = "topic_link_create")
public class LinkCreateConsumer implements RocketMQListener<LinkCreateEvent> {
    @Override
    public void onMessage(LinkCreateEvent event) {
        indexTableMapper.insert(buildIndexEntity(event));
    }
}
```

**一致性保障**：

- **消息重试机制**：消费失败自动重试（最多 16 次），几乎不会丢失。
- **本地消息表**：将消息持久化到本地表，定时扫描补偿。
- **对账程序**：定时（每小时）对比主表和索引表，发现不一致时自动修复。

#### 策略三：Binlog 监听（解耦，推荐用于 ES）

```
主表 Binlog → Canal → MQ → 消费者写入 ES/索引表
```

```
┌──────────┐     ┌──────────┐     ┌──────────┐     ┌──────────┐
│  MySQL    │────→│  Canal   │────→│  Kafka   │────→│ Consumer │
│  Binlog   │     │ (监听变更) │     │  (消息)   │     │ (写ES)   │
└──────────┘     └──────────┘     └──────────┘     └──────────┘
```

**优点**：完全解耦，主表写入零侵入，不影响写入性能。

**缺点**：有秒级延迟（Binlog 解析 → 传输 → 消费）。

### 6.2 一致性保障总结

```
┌──────────────────┬──────────────┬──────────────┬──────────────┐
│     同步策略       │   一致性      │   写入延迟    │   适用场景    │
├──────────────────┼──────────────┼──────────────┼──────────────┤
│ 同步双写(同事务)   │ 强一致        │ +5-10ms     │ 索引表(关键)   │
│ 同步双写(Seata)   │ 强一致        │ +15-30ms    │ 跨库事务       │
│ 异步MQ            │ 最终一致(秒级) │ ~0           │ 副表/ES       │
│ Binlog+Canal     │ 最终一致(秒级) │ ~0           │ ES/离线分析    │
└──────────────────┴──────────────┴──────────────┴──────────────┘
```

### 6.3 对账补偿机制

```java
/**
 * 定时对账：每小时检查主表和索引表的一致性
 */
@Scheduled(cron = "0 0 * * * ?")
public void dataReconciliation() {
    // 获取最近1小时有变更的短链
    List<String> recentCodes = mainTableMapper.selectRecentCodes(1);

    for (String code : recentCodes) {
        MainEntity main = mainTableMapper.selectByCode(code);
        IndexEntity index = indexTableMapper.selectByCode(code);

        if (index == null) {
            // 索引表缺失，补偿写入
            indexTableMapper.insert(buildIndexEntity(main));
        } else if (!main.getStatus().equals(index.getStatus())) {
            // 状态不一致，以主表为准
            indexTableMapper.updateStatus(main.getUserId(), code, main.getStatus());
        }
    }
}
```

---

## 七、分页查询优化

用户短链列表需要分页展示，常见的坑：

### 7.1 深度分页问题

```sql
-- 浅分页(前几页)：没问题
SELECT * FROM user_short_link_index
WHERE user_id = 10001 ORDER BY create_time DESC LIMIT 0, 20;

-- 深分页(第1000页)：性能急剧下降
SELECT * FROM user_short_link_index
WHERE user_id = 10001 ORDER BY create_time DESC LIMIT 20000, 20;
```

**优化方案**：

- **游标分页（Cursor-based Pagination）**：用上一页最后一条记录的 `create_time` 作为游标，避免 `OFFSET` 扫描。

```sql
-- 用游标替代 OFFSET
SELECT * FROM user_short_link_index
WHERE user_id = 10001
  AND create_time < '2024-01-15 10:30:00'  -- 上一页最后一条的时间
ORDER BY create_time DESC LIMIT 20;
```

- **三段 ID 法**：`(create_time, id)` 联合排序作为游标，避免时间重复问题。

### 7.2 列表缓存

用户翻页行为有局部性，可以缓存前几页：

```
Key:   user_links:10001:page_1
Value: [short_code 列表的 JSON]
TTL:   60s（短链创建/删除时主动失效）
```

---

## 八、最终推荐架构

综合以上分析，**推荐方案**为**异构索引表 + 同步双写 + 对账补偿**：

```
                           ┌─────────────────────────┐
                           │     用户请求              │
                           │ GET /api/my-links       │
                           └───────────┬─────────────┘
                                       │
                    ┌──────────────────▼──────────────────┐
                    │         API Gateway                  │
                    └──────────────────┬──────────────────┘
                                       │
                    ┌──────────────────▼──────────────────┐
                    │         应用服务层                     │
                    │                                     │
                    │  查询路径:                            │
                    │  1. 查 Redis 列表缓存                  │
                    │     ↓ miss                          │
                    │  2. 查索引表(user_id分片)              │
                    │     ↓ 得到 short_code 列表           │
                    │  3. 批量查主表(short_code分片)        │
                    │     ↓ (冗余字段时可省略)              │
                    │  4. 合并排序返回                      │
                    └──────┬──────────────────┬───────────┘
                           │                  │
              ┌────────────▼─────┐    ┌───────▼──────────────┐
              │   索引表集群       │    │     主表集群           │
              │ (按user_id分片)    │    │ (按short_code分片)    │
              │ + 冗余字段         │    │                     │
              └────────┬─────────┘    └───────┬──────────────┘
                       │                      │
                       │    同步双写            │
                       │◄─────────────────────┘
                       │
              ┌────────▼─────────┐
              │   对账补偿程序     │  (每小时扫描，自动修复不一致)
              └──────────────────┘
```

---

## 九、面试加分项

### 9.1 冷热数据分离

- 活跃用户的短链数据（近 30 天创建）存在热表（SSD）
- 非活跃数据归档到冷表（HDD）
- 用户列表查询默认只查热表，查看历史时再查冷表

### 9.2 写入优化

- 短链创建是**写多读多**场景，索引表的写入可以用 **批量插入 + 消息队列异步化**降低写延迟。
- 如果用同步双写，索引表写入失败不应阻塞主表（降级为异步补偿）。

### 9.3 面试金句

> "分库分表后的跨维度查询是一个经典难题。核心思路是**建立异构索引**——在主分片维度之外，额外维护一个按查询维度（user_id）分片的索引表。写入时同步双写保证强一致，查询时先查索引表精确定位，再批量回主表取详情。配合对账补偿机制兜底，可以做到既高性能又高可靠。"

---

## 十、总结

| 问题维度 | 解决方案 |
|---------|---------|
| 跨分片查询 | 建 user_id 分片的异构索引表 |
| 数据同步 | 同步双写（强一致）+ 对账补偿 |
| 深度分页 | 游标分页（Cursor-based） |
| 列表缓存 | Redis 缓存前 N 页 + 写时失效 |
| 一致性兜底 | 定时对账 + 自动补偿 |
| 冷热分离 | 近期数据热表 + 历史数据冷表 |

> **一句话总结**：跨维度查询的银弹是**异构索引**——用空间（冗余存储）换时间（O(1) 查询），用一致性保障机制（双写 + 对账）兜底数据正确性。

## 记忆要点

- 本质冲突：因为数据按ShortCode分片，所以按user_id查询会导致全分片扫描
- 核心方案：建立异构索引表（按user_id分片），先查出short_code列表，再批量路由回查主表详情
- 方案对比：异构索引(通用首选)而ES倒排(适合复杂搜索)，用户维度副表(高频查询但需保证最终一致)
- 分页处理：索引表先排好序，主表查询时利用Pipeline/MGET批量获取，避免内存放大

