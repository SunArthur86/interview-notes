---
id: note-feed-001
difficulty: L4
category: system-design
subcategory: Feed流
tags:
- 微博
- 面经
- Feed流
- 高并发
- 缓存
feynman:
  essence: 千万网红Feed流的核心是推拉结合(推给活跃粉丝+拉取非活跃粉丝)+多级缓存+降级策略，在保证实时性的同时控制写扩散成本
  analogy: 大V发博就像明星开演唱会——不能给每个粉丝都打电话通知(推扩散太大)，而是发公告让粉丝自己来看(拉)，只有铁粉(活跃用户)才主动推送通知
  first_principle: Feed流的本质矛盾是写扩散(发博时推给所有粉丝)vs读聚合(刷新时拉取关注人内容)的权衡
  key_points:
  - '推模式(写扩散): 发博时推到所有粉丝收件箱，适合普通用户'
  - '拉模式(读聚合): 刷新时实时拉取关注人最新内容，适合大V'
  - '推拉结合: 大V用拉，普通用户用推'
  - '多级缓存: Redis(ZSET收件箱) + 本地缓存 + CDN'
  - '降级: 大V发博时跳过推送，改为粉丝主动拉取'
first_principle:
  essence: Feed流的核心是时间线(Timeline)的构建方式
  derivation: '用户刷新Feed → 需要看到关注人的最新内容 → 方式1: 发博时推到粉丝收件箱(推) → 方式2: 刷新时实时聚合(拉) → 大V粉丝太多 → 推成本爆炸 → 推拉结合'
  conclusion: 千万粉丝级别必须用推拉结合，纯推或纯拉都无法承受
follow_up:
- 推拉结合的切换阈值怎么定？
- Feed流的排序算法(推荐vs时间序)怎么做？
- 如果缓存全部miss怎么办？
memory_points:
- 核心架构：千万网红Feed采用推拉结合模式，兼顾性能与写扩散压力
- 推拉分界：普通用户(粉丝<10万)用推模式，因为发博成本低，粉丝读O(1)极快
- 大V特判：大V(粉丝>10万)用拉模式，因为写扩散会瞬间撑爆Redis，改为粉丝活跃时再拉取
- 数据结构：收发件箱(in/outbox)均用Redis ZSET，因为Score存时间戳天然支持按时间倒序排
---

# 微博千万网红 Feed 流量如何扛住不崩？

## 核心架构: 推拉结合( Hybrid Timeline)

```
┌──────────────────────────────────────────────────────┐
│              微博Feed流推拉结合架构                    │
├──────────────────────────────────────────────────────┤
│                                                      │
│  普通用户(粉丝<10万): [推模式]                        │
│  发博 ──► 写入自己outbox                              │
│        ──► 异步推送到所有粉丝inbox (Redis ZSET)       │
│        粉丝刷新 → 直接读自己的inbox (O(1))            │
│                                                      │
│  大V(粉丝>10万): [拉模式]                             │
│  发博 ──► 只写入自己outbox (不推送!)                  │
│        ──► 写入"大V发博事件"队列                      │
│  粉丝刷新 ──► 读inbox + 实时拉取关注的大V outbox      │
│           ──► 合并 + 排序 → 返回Feed                  │
│                                                      │
├──────────────────────────────────────────────────────┤
│                                                      │
│  切换阈值: 粉丝数 > 10万 → 切换为拉模式                │
│  原因: 10万粉丝 × 每天发5条 = 50万次推送/大V/天       │
│        1000个大V = 5亿次推送/天 → Redis扛不住          │
│                                                      │
└──────────────────────────────────────────────────────┘
```

## 数据结构

```go
// 收件箱(Inbox): Redis ZSET
// key: inbox:{user_id}
// member: post_id
// score: timestamp
// 操作: ZREVRANGEBYSCORE (按时间倒序取最新N条)

// 发件箱(Outbox): Redis ZSET
// key: outbox:{user_id}
// 同上结构

// 关注关系: Redis SET
// key: following:{user_id} → Set of followee_ids
// key: followers:{user_id} → Set of follower_ids
```

## 推模式详细流程 (普通用户)

```
用户A(粉丝500人) 发博:
  1. 写入MySQL: INSERT INTO posts(...)
  2. 写入outbox: ZADD outbox:A {timestamp} {post_id}
  3. 获取粉丝列表: SMEMBERS followers:A → [B,C,D...500人]
  4. 批量推送: Pipeline ZADD inbox:B inbox:C ... {timestamp} {post_id}
  5. 完成

粉丝B 刷新Feed:
  1. ZREVRANGEBYSCORE inbox:B +inf -inf LIMIT 0 20
  2. 批量获取post详情: MGET post:{id1} post:{id2}...
  3. 返回 → O(1)复杂度, 极快
```

## 拉模式详细流程 (大V)

```
大V(粉丝2000万) 发博:
  1. 写入MySQL: INSERT INTO posts(...)
  2. 写入outbox: ZADD outbox:star {timestamp} {post_id}
  3. ⚠️ 不推送到粉丝inbox!
  4. 完成 (写成本O(1))

粉丝B(关注了大V) 刷新Feed:
  1. 读inbox: ZREVRANGEBYSCORE inbox:B → [普通用户的推文]
  2. 查关注的大V列表: SMEMBERS following:B → [star1, star2...]
  3. 拉取大V最新: ZREVRANGEBYSCORE outbox:star1 → [大V推文]
  4. 合并排序: Merge inbox + outbox by timestamp
  5. 返回Top 20
```

## 多级缓存设计

```
┌──────────────────────────────────────────┐
│  Layer 1: CDN (静态资源)                  │
│  图片/视频/JS/CSS → 边缘缓存              │
├──────────────────────────────────────────┤
│  Layer 2: 本地缓存 (Guava/Caffeine)       │
│  用户画像、关注列表 → 进程内缓存(1min TTL)│
│  命中率: ~30%                             │
├──────────────────────────────────────────┤
│  Layer 3: Redis集群 (热数据)              │
│  inbox/outbox/post详情 → ZSET+String     │
│  命中率: ~95%+                            │
├──────────────────────────────────────────┤
│  Layer 4: MySQL (冷数据)                  │
│  历史博文、用户资料 → 分库分表             │
│  命中率: <5%                              │
└──────────────────────────────────────────┘
```

## 突发流量应对 (明星官宣)

```
场景: 某明星官宣结婚 → 瞬间10倍流量

防线1: 限流
  - API层: Sentinel单机限流 5000 QPS
  - 用户层: 单用户3秒内最多刷新5次
  - 全局: 网关层限流保护后端

防线2: 缓存预热
  - 大V发博 → 立即预热到热点缓存池
  - TOP热搜 → CDN预热到边缘节点

防线3: 降级
  - 缓存miss时 → 返回旧数据(stale cache)
  - DB压力过大 → 关闭部分非核心功能(搜索推荐)
  - Feed刷新 → 降级为时间序(不做推荐排序)

防线4: 弹性扩容
  - K8s HPA: CPU>70%自动扩容
  - 预扩容: 大促/晚会前手动扩容
```

## 性能指标

```
目标:
  Feed刷新延迟 P99 < 100ms
  大V发博延迟 < 50ms (不包含推送)
  缓存命中率 > 95%

监控:
  - Redis QPS/内存/慢查询
  - Kafka 消费延迟
  - API P50/P99/P999
  - 推送队列积压量
  - 缓存命中率
```

## 推拉阈值选择

```
阈值确定方法:
  1. 测试Redis ZADD性能: 单实例 ~10万ops/s
  2. 计算推送成本: 粉丝数 × 日均发博数 × 推送次数
  3. 设定上限: 单次推送batch不超过10万
  4. 经验阈值:
     - 粉丝 < 1万: 纯推 (成本低)
     - 粉丝 1万-10万: 推 + 异步削峰
     - 粉丝 > 10万: 切换为拉模式
     - 粉丝 > 500万: 拉模式 + 缓存预聚合
```

## 记忆要点

- 核心架构：千万网红Feed采用推拉结合模式，兼顾性能与写扩散压力
- 推拉分界：普通用户(粉丝<10万)用推模式，因为发博成本低，粉丝读O(1)极快
- 大V特判：大V(粉丝>10万)用拉模式，因为写扩散会瞬间撑爆Redis，改为粉丝活跃时再拉取
- 数据结构：收发件箱(in/outbox)均用Redis ZSET，因为Score存时间戳天然支持按时间倒序排

