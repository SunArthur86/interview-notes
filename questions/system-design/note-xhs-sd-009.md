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