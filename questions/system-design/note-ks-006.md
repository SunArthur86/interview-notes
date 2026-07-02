---
id: note-ks-006
difficulty: L4
category: system-design
subcategory: 系统设计
tags:
- 快手
- Java开发
- 一面
- 场景题
- 系统设计
- 高并发
- 评论系统
- 面经
feynman:
  essence: 评论系统设计的核心是"高并发写入+实时展示"。四层架构：(1)分片存储——按视频ID哈希分片减轻单表压力；(2)读写分离——写主库读从库+Redis缓存最新评论；(3)消息队列削峰——评论先写入Kafka异步落库；(4)多级缓存——本地缓存+Redis+CDN加速读取。
  analogy: "评论系统就像一个万人演唱会的大屏幕互动——(1)分片存储=多个大屏幕(分库分表)各管一个区域；(2)读写分离=观众看屏幕(读)和发消息(写)走不同通道；(3)消息队列削峰=先收集到中转站(Kafka)，再一批批显示到大屏幕；(4)多级缓存=热门评论放屏幕中央(缓存)，冷门评论放角落(数据库)。"
  key_points:
  - 写入挑战：高并发评论写入（热门视频每秒数千条）
  - 读取挑战：实时展示最新评论+分页加载历史评论
  - 分片策略：按video_id哈希分片，保证同一视频的评论在同一分片
  - 消息队列削峰：评论→Kafka→异步写入DB，削峰填谷
  - 多级缓存：Caffeine(本地)→Redis(分布式)→MySQL(持久化)
first_principle:
  essence: 评论系统 = 高吞吐写入 + 低延迟读取 + 数据有序性
  derivation: "快手级评论量：日活3亿，假设10%用户评论，每人每天1条 = 3000万条/天 ≈ 350条/s。热门视频可能瞬间1万条/s。写入瓶颈：单MySQL写入约1万/s → 需要分片+MQ削峰。读取：需要按时间排序+分页 → Redis Sorted Set + 分页缓存。"
  conclusion: 写入走MQ异步+分库分表，读取走多级缓存+读写分离，热点视频特殊处理
follow_up:
- 评论的排序规则是什么？如何处理热评vs最新评论？
- 如何防止评论中的垃圾内容和恶意刷评论？
- 分页查询深分页问题如何解决？
- 如何实现评论的二级回复（回复评论的评论）？
- 评论数据增长后如何做冷热分离？
memory_points:
- 四层架构：分片存储(video_id哈希)→MQ削峰(Kafka异步落库)→读写分离→多级缓存(Caffeine+Redis)
- 写入路径：用户评论→API→Kafka→Consumer批量写入DB（削峰）
- 读取路径：用户请求→Caffeine→Redis ZSet(按时间排序)→MySQL分页
- 分片键选择video_id：同一视频的评论在同一分片，避免跨库查询
---

# 【快手Java一面】如何设计快手评论系统，确保高并发写入和实时展示？

> 来源：快手Java开发一面场景题复盘（小红书）

## 一、系统规模估算

```
用户规模：
  日活用户: 3亿
  日均评论: 3000万条
  平均QPS: 350/s
  峰值QPS: 10000/s（热门视频发布时）

存储估算：
  每条评论: ~500字节
  日存储: 3000万 × 500B = 15GB
  年存储: 15GB × 365 = 5.5TB

SLA要求：
  写入延迟: < 100ms（用户感知）
  读取延迟: < 50ms（首屏加载）
  可用性: 99.99%
```

## 二、整体架构

```
                     用户APP
                       │
              ┌────────┴────────┐
              ▼                 ▼
        发评论(写)           看评论(读)
              │                 │
              ▼                 │
     ┌─────────────────┐        │
     │  API Gateway     │        │
     │  (鉴权+限流+降级) │        │
     └────────┬────────┘        │
              │                  │
              ▼                  │
     ┌─────────────────┐         │
     │  Kafka MQ        │         │
     │  (评论消息队列)   │         │
     └────────┬────────┘         │
              │                  │
     ┌────────┴────────┐         │
     │ Consumer集群     │         │
     │ (异步批量写入)   │         │
     └────────┬────────┘         │
              │                  │
              ▼                  ▼
     ┌──────────────────────────────────┐
     │         数据存储层                │
     │  ┌─────────┐  ┌───────────────┐ │
     │  │ MySQL   │  │ Redis ZSet    │ │
     │  │ (分库分表)│  │ (最新评论缓存) │ │
     │  └─────────┘  └───────────────┘ │
     └──────────────────────────────────┘
              │                  │
              │                  ▼
              │          ┌─────────────┐
              │          │ Caffeine    │
              │          │ (本地缓存)   │
              │          └─────────────┘
              │                  │
              └──────────────────┘
                       │
                       ▼
                    用户APP
```

## 三、写入链路：高并发写入

### 1. 消息队列削峰

```java
// 用户发评论 → 先写入Kafka，立即返回成功
@PostMapping("/comment/post")
public Response postComment(@RequestBody CommentRequest req) {
    // 1. 内容安全检查（异步）
    if (contentFilter.isSpam(req.getContent())) {
        return Response.reject("内容违规");
    }

    // 2. 构建评论消息
    CommentMessage msg = CommentMessage.builder()
        .commentId(snowflakeIdGenerator.nextId())
        .videoId(req.getVideoId())
        .userId(req.getUserId())
        .content(req.getContent())
        .timestamp(System.currentTimeMillis())
        .build();

    // 3. 写入Kafka（异步削峰）
    kafkaTemplate.send("comment-topic", msg);

    // 4. 立即返回（不等落库）
    return Response.success("评论成功");
}
```

### 2. 异步批量写入

```java
// Consumer批量消费Kafka消息，批量写入DB
@KafkaListener(topics = "comment-topic", groupId = "comment-writer")
public void batchConsume(List<ConsumerRecord<String, String>> records) {
    // 批量解析
    List<Comment> comments = records.stream()
        .map(r -> JSON.parseObject(r.value(), Comment.class))
        .collect(Collectors.toList());

    // 按 video_id 分组
    Map<Long, List<Comment>> grouped = comments.stream()
        .collect(Collectors.groupingBy(Comment::getVideoId));

    // 批量写入各自的分片表
    grouped.forEach((videoId, batch) -> {
        int shard = (int) (videoId % 64);  // 64个分片
        commentMapper.batchInsert(shard, batch);  // MyBatis批量插入
    });

    // 同时更新Redis缓存
    grouped.forEach((videoId, batch) -> {
        String key = "comments:" + videoId;
        batch.forEach(c -> {
            redis.opsForZSet().add(key, JSON.toJSONString(c), c.getTimestamp());
        });
        // 只保留最新的1000条
        redis.opsForZSet().removeRange(key, 0, -1001);
    });
}
```

### 3. 分库分表策略

```
分片键：video_id
分片方式：video_id % 64

  ┌─────────────────────────────────────────────┐
  │ comment_db_0                                  │
  │   comment_table_0 (video_id % 64 == 0)        │
  │   comment_table_1 (video_id % 64 == 1)        │
  │   ...                                         │
  │   comment_table_15 (video_id % 64 == 15)      │
  ├─────────────────────────────────────────────┤
  │ comment_db_1                                  │
  │   comment_table_16 (video_id % 64 == 16)      │
  │   ...                                         │
  │   comment_table_31 (video_id % 64 == 31)      │
  ├─────────────────────────────────────────────┤
  │ comment_db_2                                  │
  │   comment_table_32 ... comment_table_47       │
  ├─────────────────────────────────────────────┤
  │ comment_db_3                                  │
  │   comment_table_48 ... comment_table_63       │
  └─────────────────────────────────────────────┘

  为什么用video_id做分片键？
  ✅ 同一视频的评论在同一分片 → 查询不跨库
  ✅ 按视频维度查询最高频 → 分片键=查询键
  ✅ 视频ID分布均匀 → 数据均匀分片
```

## 四、读取链路：实时展示

### 多级缓存读取

```java
public List<Comment> getComments(Long videoId, int page, int size) {
    // 1. 本地缓存 (Caffeine) — 毫秒级
    String localKey = "comments:" + videoId + ":" + page;
    List<Comment> cached = caffeineCache.getIfPresent(localKey);
    if (cached != null) return cached;

    // 2. Redis ZSet — 亚毫秒级
    String redisKey = "comments:" + videoId;
    Set<String> jsonSet = redis.opsForZSet()
        .reverseRange(redisKey, (page - 1) * size, page * size - 1);
    if (jsonSet != null && !jsonSet.isEmpty()) {
        List<Comment> result = jsonSet.stream()
            .map(s -> JSON.parseObject(s, Comment.class))
            .collect(Collectors.toList());
        caffeineCache.put(localKey, result);
        return result;
    }

    // 3. MySQL — 十毫秒级
    int shard = (int) (videoId % 64);
    List<Comment> dbResult = commentMapper.selectByVideoId(
        shard, videoId, (page - 1) * size, size);

    // 回填缓存
    redis.opsForZSet().add(redisKey, ...);
    caffeineCache.put(localKey, dbResult);

    return dbResult;
}
```

### 实时推送（WebSocket/SSE）

```
用户发评论 → 其他用户实时看到新评论：

  用户A发评论
      │
      ▼
  Kafka → Consumer落库
      │
      ├──→ 更新Redis ZSet（最新评论）
      │
      └──→ 推送到WebSocket通道
           │
           ├── 用户B的连接 ← 推送新评论
           ├── 用户C的连接 ← 推送新评论
           └── 用户D的连接 ← 推送新评论

  推送策略：
  - 热门视频：WebSocket推送（实时性高）
  - 普通视频：轮询（3秒一次拉取最新评论）
  - 权衡：推送 vs 轮询，取决于在线用户数
```

## 五、面试加分点

1. **提到评论排序**：热评（点赞数排序）和最新评论（时间排序）使用不同的Redis ZSet，Score分别为点赞数和时间戳
2. **提到内容安全**：评论内容需要实时审核（NLP模型检测敏感词/垃圾内容），审核通过才展示
3. **提到二级回复**：parent_id字段关联父评论，查询时用递归或预聚合树结构
4. **提到冷热分离**：超过30天的评论归档到冷存储（HBase/Elasticsearch），热数据留在MySQL+Redis
5. **提到热点视频特殊处理**：超级热门视频(亿级播放)需要独立缓存集群+CDN边缘缓存
