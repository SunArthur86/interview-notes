---
id: note-xhs-sd-009
difficulty: L4
category: system-design
subcategory: 缓存
tags:
- 多级缓存
- Caffeine
- Redis
- 本地缓存
- 缓存一致性
feynman:
  essence: 多级缓存就是L1(Caffeine本地)→L2(Redis分布式)→L3(MySQL)三层逐级降速的缓存体系。本地缓存最快但各实例独立需处理一致性，分布式缓存共享但多一跳网络。
  analogy: "多级缓存像快递柜系统：L1是你家门口的快递柜(最快但容量小)、L2是小区快递站(快容量大但多走几步)、L3是远郊仓库(最慢但什么都有)。大部分快递在小区快递站就找到了，不需要去远郊。"
  key_points:
  - 三级缓存：Caffeine(~1ms)→Redis(~3ms)→MySQL(~10ms)
  - L1容量小速度快但不跨实例共享→需一致性方案
  - 一致性：Redis Pub/Sub广播失效 > 短TTL > Canal binlog
  - AI场景：Embedding缓存+FAQ缓存可省大量API费用
  - 监控命中率：L1目标30-50%，L2目标80-90%
first_principle:
  problem: "数据访问有明显的局部性（热点/重复），如何用多层级存储介质平衡速度、容量和一致性？"
  axioms:
  - 存储层级越靠近CPU越快但容量越小（寄存器>L1>L2>L3>内存>磁盘）
  - 缓存命中率决定性能：命中率每提升10%，平均延迟降低一个数量级
  - 多实例本地缓存必然有一致性问题，需要失效广播或TTL兜底
  - AI场景API调用成本高，缓存的ROI（投入产出比）远高于传统场景
  rebuild: "从数据访问加速需求出发：DB→Redis(L2分布式缓存)→Caffeine(L1本地缓存)。L1解决单实例热点、L2解决跨实例共享。一致性通过Pub/Sub广播失效保证。AI场景API成本高，Embedding/FAQ缓存的ROI极高"
follow_up:
- Caffeine 的 W-TinyLFU 淘汰算法比传统 LRU 好在哪？
- 缓存击穿（热点key过期）如何用布隆过滤器解决？
- 如何保证多级缓存的最终一致性？Canal 方案的优缺点？
- AI场景下哪些数据适合缓存？Embedding缓存如何设计？
---

# 多级缓存方案如何设计？AI业务场景下的缓存策略？（入职Java复盘）

## 一、多级缓存架构

```
请求 → L1 本地缓存 → L2 分布式缓存 → L3 数据库
        (Caffeine)     (Redis)         (MySQL)
        ~1ms           ~3ms            ~10ms
        
命中率目标：
  L1: 30-50%（热点数据）
  L2: 80-90%（大部分缓存）
  DB: <5%（仅穿透请求）
```

```
┌────────────────────────────────────────────────────────┐
│                    应用实例1                            │
│  ┌──────────┐    ┌──────────┐    ┌──────────────┐     │
│  │ L1 Caffeine│   │ L2 Redis │   │ L3 MySQL     │     │
│  │ (堆内存)   │   │ (分布式)  │   │ (持久化)     │     │
│  │ ~1ms      │   │ ~3ms     │   │ ~10ms        │     │
│  │ 容量小     │   │ 容量大    │   │ 容量大       │     │
│  └──────────┘    └──────────┘   └──────────────┘     │
│                                                          │
│  ┌──────────┐    ┌──────────┐    ┌──────────────┐     │
│  │ L1 Caffeine│   │ L2 Redis │   │ L3 MySQL     │     │
│  └──────────┘    └──────────┘   └──────────────┘     │
│                    应用实例2                            │
└────────────────────────────────────────────────────────┘
```

## 二、各级缓存职责

| 层级 | 技术 | 特点 | 适合数据 |
|------|------|------|---------|
| L1 本地 | Caffeine | 最快~1ms，容量受限于JVM堆 | 配置、字典、热点数据 |
| L2 分布式 | Redis | 快~3ms，跨实例共享，大容量 | 会话、热点列表、计算结果 |
| L3 数据库 | MySQL | 持久可靠~10ms | 原始数据、事务数据 |

## 三、Caffeine 本地缓存（L1）

```java
@Configuration
public class CacheConfig {
    
    @Bean
    public Cache<String, AIResponse> aiResponseCache() {
        return Caffeine.newBuilder()
            .maximumSize(10_000)           // 最大缓存1万条
            .expireAfterWrite(Duration.ofMinutes(5))  // 写后5分钟过期
            .expireAfterAccess(Duration.ofMinutes(10)) // 访问后10分钟过期
            .recordStats()                 // 开启统计
            .build();
    }
}

// 使用示例
@Service
public class AIChatService {
    
    @Autowired
    private Cache<String, AIResponse> localCache;
    
    @Autowired
    private RedisTemplate<String, AIResponse> redisTemplate;
    
    @Autowired
    private AIModelAdapter aiAdapter;
    
    public AIResponse chat(String prompt) {
        String key = "ai:chat:" + DigestUtils.md5Hex(prompt);
        
        // L1: 本地缓存
        AIResponse cached = localCache.getIfPresent(key);
        if (cached != null) {
            return cached;  // ~1ms
        }
        
        // L2: Redis缓存
        cached = redisTemplate.opsForValue().get(key);
        if (cached != null) {
            localCache.put(key, cached);  // 回填L1
            return cached;  // ~3ms
        }
        
        // L3: 调用AI API
        cached = aiAdapter.chat(new ChatRequest(prompt));  // ~500ms-3s
        
        // 写入缓存
        localCache.put(key, cached);
        redisTemplate.opsForValue().set(key, cached, 5, TimeUnit.MINUTES);
        
        return cached;
    }
}
```

## 四、缓存一致性方案

### 问题：多实例L1缓存不一致

```
实例1 L1: user=张三     实例2 L1: user=张三
         ↓ 更新                    ↓ 未更新
         user=李四                 user=张三 ← 旧数据！
```

### 方案1：Redis Pub/Sub 广播失效（推荐⭐）

```java
// 更新缓存时
public void updateUser(User user) {
    // 1. 更新数据库
    userMapper.update(user);
    // 2. 删除Redis缓存
    redisTemplate.delete("user:" + user.getId());
    // 3. 广播通知所有实例清L1
    redisTemplate.convertAndSend("cache:invalidate", 
        "user:" + user.getId());
}

// 监听失效消息
@Component
public class CacheInvalidationListener implements MessageListener {
    @Autowired
    private Cache<String, Object> localCache;
    
    @Override
    public void onMessage(Message message, byte[] pattern) {
        String key = new String(message.getBody());
        localCache.invalidate(key);  // 清除本地缓存
    }
}
```

### 方案2：短TTL（简单方案）

```
L1 Caffeine TTL = 30秒（短过期）
即使不一致，最多30秒后自动刷新
适合：容忍短暂不一致的非关键数据
```

### 方案3：Canal 监听 binlog（终极方案）

```
MySQL binlog → Canal → Kafka → 各应用实例清L1+L2缓存
保证最终一致性，不侵入业务代码
```

## 五、AI业务场景缓存策略

### 1. Embedding 向量缓存

```java
// 相同文本的Embedding结果缓存（省API费用）
public float[] getEmbedding(String text) {
    String key = "emb:" + DigestUtils.md5Hex(text);
    // 多级缓存查找
    return cacheChain.get(key, () -> embeddingClient.embed(text));
    // Embedding API调用$0.0001/1K tokens，缓存可省大量费用
}
```

### 2. 常见问题缓存

```
用户高频问题（如"你是谁"、"怎么使用"）→ 缓存完整回答
  key = "faq:" + md5(question)
  TTL = 24小时
  
命中率可达30-50%，大幅降低API调用成本
```

### 3. Prompt 模板缓存

```
System Prompt + Few-shot examples → 编译后缓存
只有User Message部分动态变化
```

### 4. 多级缓存命中率监控

```java
// Caffeine 统计
CacheStats stats = cache.stats();
log.info("L1 Hit rate: {:.2f}%, Eviction: {}, Avg load time: {}ms",
    stats.hitRate() * 100,
    stats.evictionCount(),
    stats.averageLoadPenalty() / 1_000_000);
```
## 苏格拉底式面试追问

> 这组追问模拟面试官层层逼问，每一问先回答"为什么"，再回答"怎么做"，最后回答"如何证明"。

### 第一层：目标与动机

**Q：多级缓存你为什么用 Caffeine + Redis 而不是只用 Redis？**

因为本地缓存（Caffeine）的延迟远低于 Redis。Caffeine 是 JVM 进程内的缓存，查询约 0.01ms（内存访问）；Redis 是网络缓存，查询约 0.5-3ms（网络 RTT）。对于高频热点 key（如 AI 服务的模型配置、FAQ 模板），用 Caffeine 挡住后，Redis 的 QPS 降一个数量级，整体延迟也降低。决策依据：热点 key 的访问频率占总流量 30-50%，用本地缓存挡这部分，Redis 和 DB 的压力大幅下降。单用 Redis 能工作但延迟和成本不是最优。

### 第二层：证据与定位

**Q：AI 服务的延迟从 200ms 涨到 500ms，你怎么定位是哪层缓存出了问题？**

分层看缓存命中率和耗时：
1. L1（Caffeine）命中率——如果从 40% 降到 10%，本地缓存失效（可能 JVM 重启后缓存清空，或容量太小被频繁淘汰），更多请求穿透到 L2。
2. L2（Redis）耗时——如果 Redis P99 从 1ms 涨到 50ms，Redis 负载高或网络抖动。
3. L3（DB 或 AI API）——如果穿透到 DB/AI API，单次 100-500ms（AI API 调用慢），延迟飙升。

### 第三层：根因深挖

**Q：Caffeine 命中率从 40% 降到 10%，根因是什么？**

最可能是缓存容量不足或 key 分布变化。① 容量——Caffeine 配了 maximumSize=10000，但实际热点 key 有 50000 个，LRU 淘汰频繁，命中率低；② Key 分布——如果业务的访问模式从"少量热点"变成"长尾分散"（如用户个性化推荐，每个用户的缓存 key 不同），Caffeine 本地缓存命中率天然低（分散的 key 无法被本地缓存覆盖）。要看 Caffeine 的 evictionCount 和命中率趋势。如果是容量问题调大 maximumSize，如果是长尾问题，本地缓存不适合（改用 Redis 覆盖更多 key）。

**Q：为什么不直接把 Caffeine 容量调到几百万，把所有热点都装进去，命中率不就高了？**

因为 JVM 堆内存有限。Caffeine 缓存存在 JVM 堆里，几百万条 × 每条几 KB = 几 GB，挤占业务对象的堆空间，导致 GC 频繁（大堆 Full GC 停顿几秒）。一般 Caffeine 容量建议 < 堆内存的 20%（如 4GB 堆配 100-500MB 缓存）。超过这个比例，GC 开销吞噬缓存带来的收益。大容量缓存要用堆外内存（如 Hazelcast、Memcached）或 Redis（独立进程），不用 JVM 堆。Caffeine 的定位是"小而快的本地热点缓存"，不是"大容量存储"。

### 第四层：方案权衡

**Q：多实例部署时，各实例的 Caffeine 缓存独立，怎么保证一致性（一个实例更新了，其他实例还是旧值）？**

三种方案：
1. TTL 兜底——Caffeine 设短 TTL（如 10-30 秒），不一致窗口 = TTL。简单但有几秒到几十秒的旧值窗口。
2. Redis Pub/Sub 广播——数据更新时发 Redis 消息，各实例收到后清除本地缓存。实时性好，但 Pub/Sub 不可靠（订阅者不在线消息丢失）。
3. 消息队列广播——用 Kafka 等可靠消息广播失效，各实例消费后清缓存。可靠但延迟稍高（消息消费有延迟）。

**Q：为什么不直接用 Redis Pub/Sub 广播失效，实时又简单？**

因为 Pub/Sub 不可靠。Redis Pub/Sub 是"发即弃"——发布者发消息时如果订阅者网络抖动没连上，消息直接丢失，那个实例的本地缓存不会被清除，持续返回旧值。而且 Pub/Sub 没有持久化，Redis 重启后所有订阅断开。生产级方案用 Kafka 广播（可靠投递 + 持久化），各实例的消费组确保收到失效消息。但 Kafka 延迟（几百毫秒到秒级）比 Pub/Sub（毫秒级）高。权衡：容忍秒级不一致用 TTL（最简单），要求秒级一致用 Kafka 广播。Pub/Sub 介于两者但不可靠，不推荐生产用。

### 第五层：验证与沉淀

**Q：你怎么证明多级缓存的 ROI（AI 场景下省了多少 API 费用）？**

量化对比：
1. 缓存命中率——L1 40% + L2 85%（剩余 60% 的 85% = 51%），总命中率 91%，只有 9% 的请求真正调 AI API。
2. 费用节省——如果不缓存，日均 100 万次 AI 调用 × $0.02/次 = $20000/天。缓存后只有 9 万次调 API = $1800/天，省 91%。
3. 性能提升——缓存命中（0.01ms）vs AI API 调用（500ms-2s），TP99 从秒级降到毫秒级。

**Q：多级缓存方案怎么沉淀？**

1. 缓存 SDK——封装"Caffeine + Redis + 广播失效 + TTL 兜底"成通用组件，业务接入只配 key 策略和 TTL。
2. AI 场景缓存策略——Embedding 缓存（相同输入的 embedding 复用）、FAQ 缓存（常见问题的答案直接返回）、Prompt 缓存（相同 prompt 的部分结果复用），标准化到 AI 网关。
3. 命中率监控——L1/L2 命中率、穿透到 DB/API 的比例，命中率下降告警（可能是容量不足或访问模式变化）。


## 结构化回答

**30 秒电梯演讲：** 多级缓存就是L1(Caffeine本地)→L2(Redis分布式)→L3(MySQL)三层逐级降速的缓存体系。

**展开框架：**
1. **三级缓存** — Caffeine(~1ms)→Redis(~3ms)→MySQL(~10ms)
2. **L1容量小速度快但不跨实** — L1容量小速度快但不跨实例共享→需一致性方案
3. **一致性** — Redis Pub/Sub广播失效 > 短TTL > Canal binlog

**收尾：** 这块我踩过坑——要不要深入聊：Caffeine 的 W-TinyLFU 淘汰算法比传统 LRU 好在哪？

## 视频脚本

> 预计时长：4 分钟 | 由浅入深

| 时间 | 画面/字幕 | 口播台词 | 讲解要点 |
|------|----------|----------|----------|
| 0:00 | 标题卡 | "缓存一句话：多级缓存就是L1(Caffeine本地)→L2(Redis分布式)→L3(MySQL)三层逐级降速的缓存体系。本地缓存最快但各实例独立需处理一致性…。" | 开场钩子 |
| 0:15 | Redis Lua 脚本执行截图 | "三级缓存：Caffeine(~1ms)到Redis(~3ms)到MySQL(~10ms)" | 三级缓存 |
| 1:08 | Redis Lua 脚本执行截图分步演示 | "L1容量小速度快但不跨实例共享到需一致性方案" | L1容量小速度快但不跨实 |
| 2:01 | 关键代码/伪代码片段 | "一致性：Redis Pub/Sub广播失效 > 短TTL > Canal binlog" | 一致性 |
| 2:54 | 对比表格 | "AI场景：Embedding缓存+FAQ缓存可省大量API费用" | AI场景 |
| 3:50 | 总结卡 | "核心抓住这条主线，下期咱们接着聊：Caffeine 的 W-TinyLFU 淘汰算法比传统 LRU 好在哪。" | 收尾 |
