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

## 苏格拉底式面试追问

> 这组追问模拟面试官层层逼问，每一问先回答"为什么"，再回答"怎么做"，最后回答"如何证明"。

### 第一层：目标与动机

**Q：评论系统你为什么用 Kafka 削峰而不是直接同步写 DB？**

因为热门视频的评论是突发高并发。一条热门视频可能瞬间涌入万级评论/秒，MySQL 单机写入约 1 万 TPS，直接写 DB 会打满连接池 + 拖慢所有读写。Kafka 削峰——评论先写入 Kafka（10 万+ QPS 无压力），消费者按 DB 的承受能力匀速消费写入（如 5000/s），把瞬时洪峰拉平。决策依据：写入峰值 > DB 承受能力 2 倍以上，就必须用 MQ 削峰。代价是评论有秒级延迟才展示（异步落库），用户可接受。

### 第二层：证据与定位

**Q：用户反馈"我发的评论过了 1 分钟才显示"，怎么定位是 MQ 积压还是消费逻辑慢？**

查消费链路：
1. ConsumerLag——Kafka 的积压量，如果 Lag 很大（万级），是消费跟不上（消费者少或处理慢）。
2. 消费耗时——单条评论从消费到写入 DB 的耗时，如果每条 200ms（含 DB 写 + 缓存更新），万级积压消化要几十秒。
3. DB 写入耗时——如果 DB 写入慢（锁等待、IO 高），消费速率被 DB 拖累。

### 第三层：根因深挖

**Q：消费逻辑不复杂（就是写 DB + 更新 Redis），但消费速率只有 1000/s，根因是什么？**

最可能是每条评论单独写 DB + 单独更新 Redis，没有批量。单条评论：DB INSERT（5ms）+ Redis ZADD（1ms）= 6ms/条，速率上限约 166 条/s（单线程）。即使多线程消费（8 线程），约 1300 条/s。优化方向：① 批量写入——攒 100 条评论用 `INSERT ... VALUES (...),(...),(...)` 一次写入（5ms 写 100 条 = 每条 0.05ms）；② Pipeline 更新 Redis——100 条评论的 ZADD 用 pipeline 一次发送。批量后速率可提升 10-50 倍。要看消费代码是否做了批量。

**Q：为什么不直接用 Redis 作为评论的主存储（不写 DB），Redis 的 List/ZSet 不是能存评论吗？**

因为内存成本和数据持久化。① 成本——快手日均千万条评论，每条 200 字节，一天 2GB，一年 730GB，全放 Redis（内存）成本爆炸；② 持久化——Redis 是内存数据库，即使有 RDB/AOF，故障恢复时可能丢数据（AOF 的 fsync 策略），评论是用户生成内容不能丢；③ 历史查询——用户翻历史评论（一年前的）如果全在 Redis，要全量加载不现实。Redis 适合"热数据缓存"（最新评论、热门评论），DB 是"全量持久化存储"。两者分工：DB 存全量，Redis 缓存热数据加速读取。

### 第四层：方案权衡

**Q：评论的"实时展示"你怎么实现？用户发了评论要立即看到，但 DB 是异步写入的。**

写后读一致性方案：
1. 发评论时先写 Kafka，同时把评论临时写入 Redis（`recent_comments:{videoId}` 的 ZSet），用户刷新评论列表时从 Redis 拿到这条评论（即使 DB 还没落库）。
2. DB 异步落库后，评论持久化，Redis 的临时评论被正常的缓存更新覆盖。
3. 用户看到的评论列表 = Redis 缓存（含临时评论）+ DB（已落库的）。用户发评论后立即能从 Redis 看到自己的评论，即使 DB 还没写入。

权衡：临时评论占 Redis 空间（设短 TTL 如 5 分钟，DB 落库后由正常缓存覆盖）。这是"写后读一致性"的经典方案，用 Redis 做"提交确认"——用户看到自己的评论 = 提交成功的反馈。

**Q：为什么不用 WebSocket 推送新评论（实时推给正在看视频的用户），而要用户主动刷新？**

因为推送的成本和必要性。① 成本——一个热门视频可能有百万用户同时观看，每条新评论推给百万用户 = 百万次 WebSocket 推送，带宽和连接数爆炸；② 必要性——评论不是"必须实时"的信息（不像聊天消息），用户晚几秒看到评论无影响；③ 体验——频繁推送评论会打断用户看视频的体验（弹幕已经够干扰了）。所以评论用"主动拉取 + 轮询/SSE 增量"而非推送。只有"回复我的评论"这种强相关通知才推送（WebSocket 或 APP 推送）。

### 第五层：验证与沉淀

**Q：你怎么证明评论系统的高并发处理能力达标？**

压测 + 线上监控：
1. 写入压测——模拟万级 QPS 评论写入，确认 Kafka 不积压、DB 不打满、评论最终落库（对账无丢失）。
2. 读取压测——模拟热门视频的评论列表查询（万级并发），确认 Redis 命中率 > 95%、TP99 < 50ms。
3. 线上指标——日均评论数、峰值 QPS、消费 Lag、缓存命中率、DB 负载，持续监控。

**Q：评论系统架构怎么沉淀？**

1. 评论中台——把"写入（Kafka 削峰）+ 存储（分片 + 冷热分离）+ 读取（多级缓存）+ 排序（热评/最新）"封装成通用评论组件，视频/图文/直播复用。
2. 分片规范——按业务实体（video_id/article_id）分片的策略标准化，新业务接入只配分片键。
3. 垃圾评论治理——接入 NLP 模型（离线 + 实时）识别垃圾/违规评论，沉淀审核平台。


## 结构化回答

**30 秒电梯演讲：** 评论系统设计的核心是"高并发写入+实时展示"。四层架构：(1)分片存储——按视频ID哈希分片减轻单表压力。

**展开框架：**
1. **四层架构** — 分片存储(video_id哈希)→MQ削峰(Kafka异步落库)→读写分离→多级缓存(Caffeine+Redis)
2. **写入路径** — 用户评论→API→Kafka→Consumer批量写入DB（削峰）
3. **读取路径** — 用户请求→Caffeine→Redis ZSet(按时间排序)→MySQL分页

**收尾：** 这块我踩过坑——要不要深入聊：评论的排序规则是什么？如何处理热评vs最新评论？

## 视频脚本

> 预计时长：4 分钟 | 由浅入深

| 时间 | 画面/字幕 | 口播台词 | 讲解要点 |
|------|----------|----------|----------|
| 0:00 | 标题卡 | "系统设计一句话：评论系统设计的核心是'高并发写入+实时展示'。四层架构：(1)分片存储——按视频ID哈希分片减轻单表压力…。" | 开场钩子 |
| 0:15 | Redis Lua 脚本执行截图 | "四层架构：分片存储(video_id哈希)到MQ削峰(Kafka异步落库)到读写分离到多级缓存(Caffeine+R…" | 四层架构 |
| 1:08 | Redis Lua 脚本执行截图分步演示 | "写入路径：用户评论到API到Kafka到Consumer批量写入DB（削峰）" | 写入路径 |
| 2:01 | 关键代码/伪代码片段 | "读取路径：用户请求到Caffeine到Redis ZSet(按时间排序)到MySQL分页" | 读取路径 |
| 2:54 | 对比表格 | "分片键选择video_id：同一视频的评论在同一分片，避免跨库查询" | 分片键选择 |
| 3:50 | 总结卡 | "核心抓住这条主线，下期咱们接着聊：评论的排序规则是什么？如何处理热评vs最新评论。" | 收尾 |
