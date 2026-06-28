---
id: note-xl-001
difficulty: L4
category: system-design
subcategory: 实时计算
tags:
  - 新浪微博
  - 面经
  - 热搜
  - 架构设计
feynman:
  essence: "微博热搜实时计算是流式处理+实时聚合+定时刷新的架构，核心挑战是突发流量10x扩容和防刷"
  analogy: "像一个实时股票行情系统——全网博文是交易数据，热度计算是股价计算，榜单是涨跌幅排行，突发热点就是涨停"
  first_principle: "热搜的本质是高频实时聚合+排名，数据流从生产→计算→排序→展示，每层都有性能和准确性挑战"
  key_points:
    - '数据源: 全网博文实时入库 → Kafka'
    - '计算层: Go消费Kafka → 分词/打标签 → 热度加权'
    - '存储层: Redis(实时榜单) + MySQL(历史) + ClickHouse(分析)'
    - '限流防刷: 三级限流(接口/用户/IP)'
    - '缓存一致性: 定时刷新 + 双写'
first_principle:
  essence: "热搜 = 实时词频统计 + 多维度加权 + 定时排序"
  derivation: "博文持续产生 → 需要实时计算热度 → 热度 = 数量×权重(互动/转发/评论) → 需要防刷 → 需要定时刷新榜单 → 需要缓存加速"
  conclusion: "核心是流式架构 + 分层存储 + 多级限流"
follow_up:
  - "突发热点怎么检测？10倍流量怎么扛？"
  - "热搜怎么防刷？识别异常刷量行为"
  - "实时榜单和离线日榜怎么协调？"
---

# 从零设计微博热搜实时计算服务

## 整体架构

```
┌──────────────────────────────────────────────────────────┐
│                    微博热搜实时计算架构                    │
├──────────────────────────────────────────────────────────┤
│                                                          │
│  ┌─────────┐     ┌──────────┐     ┌─────────────────┐  │
│  │ 博文采集 │────→│  Kafka   │────→│ Go消费服务      │  │
│  │ (Flume/ │     │ (3个     │     │ (消费者组)       │  │
│  │  CDC)   │     │ partition)│    │                 │  │
│  └─────────┘     └──────────┘     └────────┬────────┘  │
│                                            │            │
│                          ┌─────────────────┼─────────┐  │
│                          ▼                 ▼         ▼  │
│                   ┌──────────┐  ┌──────────────┐      │
│                   │ 分词打标签│  │ 热度加权计算   │      │
│                   │ (IK/NLP) │  │ (互动×权重)   │      │
│                   └─────┬────┘  └──────┬───────┘      │
│                         │              │               │
│                         └──────┬───────┘               │
│                                ▼                       │
│                   ┌──────────────────────────┐         │
│                   │    Redis (实时热榜)       │         │
│                   │  ZSET: topic → score     │         │
│                   │  TOP50 实时排序           │         │
│                   └────────────┬─────────────┘         │
│                                │                       │
│                   ┌────────────▼─────────────┐         │
│                   │  定时刷新任务 (每1min)    │         │
│                   │  Redis → MySQL (持久化)   │         │
│                   │  Redis → CK (分析)        │         │
│                   └──────────────────────────┘         │
│                                                          │
│  ┌─────────────────────────────────────────────────┐    │
│  │  限流防刷层                                       │    │
│  │  接口限流(Sentinel) + 用户限流 + IP限流          │    │
│  └─────────────────────────────────────────────────┘    │
│                                                          │
└──────────────────────────────────────────────────────────┘
```

## 微服务拆分

| 服务 | 职责 | 技术 |
|------|------|------|
| **博文采集** | CDC/爬虫采集全网博文 | Canal + Kafka |
| **分词服务** | 博文分词、实体识别、话题提取 | Go + IK分词 + NLP模型 |
| **热度计算** | 实时加权(转发×5 + 评论×3 + 点赞×1) | Go + Kafka Streams |
| **榜单服务** | TOP50维护、定时刷新 | Go + Redis ZSET |
| **API服务** | 对外提供热搜查询 | Go + Gin |
| **防刷服务** | 异常检测、限流 | Go + 规则引擎 |

## 存储选型

| 存储 | 数据 | 选型理由 |
|------|------|---------|
| **Redis** | 实时热榜(TOP50) | ZSET天然排序, O(logN)更新 |
| **Kafka** | 博文事件流 | 高吞吐、解耦、回溯 |
| **MySQL** | 历史榜单、配置 | 持久化、关系查询 |
| **ClickHouse** | 热度趋势分析 | 列存, 聚合查询快 |

## 热度计算逻辑

```go
func calculateHotness(post Post) float64 {
    // 热度 = 转发×5 + 评论×3 + 点赞×1 + 原创加成
    base := float64(post.Retweets)*5 +
            float64(post.Comments)*3 +
            float64(post.Likes)*1

    // 原创博文加权
    if post.IsOriginal {
        base *= 1.5
    }

    // 时间衰减(牛顿冷却定律)
    hoursSincePost := time.Since(post.CreatedAt).Hours()
    decay := math.Exp(-0.1 * hoursSincePost)

    // 话题热度累加
    for _, topic := range post.Topics {
        score := base * decay
        redis.ZIncrBy("hot_topics", score, topic)
    }

    return base * decay
}
```

## 限流防刷设计

```go
// 三级限流
type RateLimiter struct {
    // 1. 接口限流: 每秒最多10万次请求
    apiLimit   *tokenBucket  // 100000/s

    // 2. 用户限流: 单用户每小时最多发50条带话题博文
    userLimit  *slidingWindow // 50/hour/user

    // 3. IP限流: 单IP每分钟最多100次操作
    ipLimit    *slidingWindow // 100/min/ip
}

// 异常检测: 识别刷量
func detectAbuse(userID string, topic string) bool {
    // 规则1: 同一用户同一话题短时间内大量发文
    count := redis.Get(fmt.Sprintf("abuse:%s:%s", userID, topic))
    if count > 10 { // 1分钟内>10条
        return true
    }

    // 规则2: 新注册账号(注册<7天)参与热搜互动
    userAge := getUserAge(userID)
    if userAge < 7*24*3600 {
        // 降权处理而非直接封禁
        return true
    }

    return false
}
```

## 突发流量10x应对

```go
// 1. 弹性扩容: Kafka消费者自动扩缩
func autoScale() {
    lag := getConsumerLag()
    if lag > 100000 {
        k8sClient.ScaleDeployment("hot-search-consumer", currentReplicas*3)
    }
}

// 2. 降级策略: 突发时降低计算精度
func degradedCalc(post Post) {
    if underHighLoad {
        // 跳过NLP分词，用简单关键词匹配
        return simpleKeywordMatch(post)
    }
    return fullNLPCalc(post)
}

// 3. 积压告警
// Kafka lag > 50万 → P1告警 → 自动扩容
// Kafka lag > 200万 → P0告警 → 人工介入
```

## 缓存一致性

```go
// 热搜榜单更新策略: 定时刷新 + 双缓冲
func refreshLeaderboard() {
    // 每1分钟:
    // 1. 从计算结果生成新榜单
    newBoard := buildLeaderboard()

    // 2. 双缓冲切换(原子操作)
    redis.Set("hot_search:new", serialize(newBoard))
    redis.Rename("hot_search:new", "hot_search:current")

    // 3. 设置缓存过期时间(容灾)
    redis.Expire("hot_search:current", 120*time.Second)
    // 如果刷新任务挂了, 2分钟后缓存过期, 触发重新计算
}
```
