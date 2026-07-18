---
id: note-xhs-sd-011
difficulty: L4
category: system-design
subcategory: cache-architecture
tags:
- Redis
- 缓存击穿
- 缓存雪崩
- 多级缓存
- 高并发
- CDN
- 面经
feynman:
  essence: "热点缓存在瞬间千万级流量下需要四道防线：互斥锁防击穿→多副本打散热点Key→本地缓存+CDN多级缓存→降级兜底保命"
  analogy: "明星官宣离婚=超市突然涌入万人抢购同一种商品。第一道防线：开一个收银台（互斥锁），只让一个人去仓库取货；第二道：在多个货架放同一种商品（多副本）；第三道：每个收银台旁都放一些（本地缓存）；第四道：实在卖光了就发替代品（降级兜底）"
  key_points:
  - 互斥锁防缓存击穿：热点Key过期时只放一个请求回源
  - 多副本打散：同一数据存多个Key（如hot_key_1~N），分散到不同Redis节点
  - 多级缓存：CDN→本地缓存(Caffeine)→Redis→DB
  - 降级兜底：极端流量下返回静态/默认数据，保住系统不死
  - 热点探测：实时监控Key访问频率，提前预加载
first_principle:
  essence: "热点缓存的核心矛盾是：单个Key的访问量远超单节点处理能力。解决思路是减少回源（多级缓存）和分散热点（多副本）"
  derivation: "Redis单节点QPS上限约10万。明星官宣场景下，单个热点Key的QPS可能达到百万级。即使Redis集群能扛住，网络带宽和DB回源也会成为瓶颈。因此需要：1) 让请求尽量在客户端/本地缓存命中（减少网络IO）；2) 把单个热点Key分散到多个Key和多个节点（减少单点压力）；3) 极端情况主动降级（保住系统不死比返回正确数据更重要）"
  conclusion: "热点缓存设计是防御性架构——平时用不上，但在极端流量事件中决定系统是生存还是崩溃"
follow_up:
- 互斥锁用什么实现？Redis SETNX还是Redisson？
- 热点探测怎么做？有没有开源工具？
- 多级缓存的数据一致性怎么保证？
- 降级策略的触发条件怎么设置？
memory_points:
- 四道防线：互斥锁→多副本→多级缓存→降级
- 互斥锁：只放一个请求回源，其余等缓存重建
- 多副本：hot_key_1~N分散到不同Redis节点
- 多级：CDN→本地缓存→Redis→DB
- 降级兜底：保命比正确更重要
---

# 【系统设计】明星官宣离婚，热点缓存怎么扛？

> 来源：小红书「面试官：明星官宣离婚，热点缓存怎么扛？」

## 一、问题分析——极端流量下的缓存架构

```
明星官宣离婚 → 微博/小红书瞬间千万级流量

流量特征:
┌──────────────────────────────────────────────┐
│  时间: 几秒内从0飙到百万QPS                    │
│  热点: 99%流量集中在1-3个Key（明星主页/话题）   │
│  持续: 持续30分钟-2小时后逐渐消退              │
│  风险: 缓存击穿→DB被打爆→雪崩→全站不可用       │
└──────────────────────────────────────────────┘

流量曲线:
  QPS
  100万 ┤            ┌─────┐
   50万 ┤           ╱       ╲
   10万 ┤         ╱           ╲
    1万 ┤───────╱               ╲──────
        └──┬──┬──┬──┬──┬──┬──┬──┬──
           T0 T+1 T+2 T+5 T+10 T+30 T+60 (分钟)
              ↑
           官宣瞬间
```

## 二、四道防线架构

```
                    用户请求
                       │
         ┌─────────────┼─────────────┐
         ▼             ▼              ▼
    【防线1】      【防线2】       【防线3】
    CDN边缘缓存   本地缓存        互斥锁
    (静态资源)   (Caffeine)     (防击穿)
         │             │              │
         └─────────────┼──────────────┘
                       ▼
                  【防线4】
                  Redis集群
                  +多副本打散
                       │
                       ▼
                   数据库DB
                  (最后兜底)
                       │
                       ▼
                 【降级方案】
                 返回静态/默认数据
```

## 三、各防线详解

### 防线一：互斥锁防缓存击穿

```java
// 热点Key过期时的互斥锁保护
public String getWithMutex(String key) {
    String value = redis.get(key);
    if (value != null) {
        return value; // 缓存命中
    }
    
    // 缓存未命中，尝试获取互斥锁
    String lockKey = "lock:" + key;
    try {
        // SETNX + 过期时间（防死锁）
        boolean locked = redis.setIfAbsent(
            lockKey, "1", 10, TimeUnit.SECONDS
        );
        
        if (locked) {
            try {
                // 获取锁成功 → 查DB → 写缓存
                value = db.query(key);
                redis.set(key, value, 300, TimeUnit.SECONDS);
                return value;
            } finally {
                redis.delete(lockKey); // 释放锁
            }
        } else {
            // 获取锁失败 → 短暂等待后重试读缓存
            Thread.sleep(50);
            return getWithMutex(key); // 递归重试
        }
    } catch (Exception e) {
        // 超时降级
        return getDefaultData(key);
    }
}
```

### 防线二：多副本打散热点Key

```java
// 将单个热点Key分散为多个副本Key
public class HotKeyReplicator {
    private static final int REPLICA_COUNT = 10;
    
    // 写入时：同时写多个副本
    public void setHotKey(String key, String value, int ttl) {
        for (int i = 0; i < REPLICA_COUNT; i++) {
            String replicaKey = key + ":" + i;
            // 副本分散到不同Redis节点（用一致性hash）
            redis.set(replicaKey, value, ttl + randomOffset());
        }
    }
    
    // 读取时：随机选一个副本读
    public String getHotKey(String key) {
        int idx = ThreadLocalRandom.current().nextInt(REPLICA_COUNT);
        return redis.get(key + ":" + idx);
    }
    
    // 效果：单个Key的100万QPS分散到10个副本，每个仅10万QPS
}
```

### 防线三：多级缓存

```
请求 → CDN(边缘节点)     命中率: 30% (静态资源)
         ↓ miss
      本地缓存(Caffeine)   命中率: 50% (热点数据)
         ↓ miss  
      L1 Redis(读集群)     命中率: 15%
         ↓ miss
      L2 Redis(主集群)     命中率: 4%
         ↓ miss
      DB                   命中率: 1%

总体缓存命中率: 99% → DB QPS仅为总QPS的1%
```

```java
// Caffeine本地缓存配置
Cache<String, String> localCache = Caffeine.newBuilder()
    .maximumSize(10_000)              // 最多缓存1万个Key
    .expireAfterWrite(5, TimeUnit.SECONDS) // 5秒过期（热点数据频繁更新）
    .recordStats()                    // 记录命中率
    .build();
```

### 防线四：降级兜底

```java
public String getHotData(String key) {
    try {
        // 正常流程
        return getWithMultiLevelCache(key);
    } catch (Exception e) {
        // 降级策略
        if (isUnderHighLoad()) {
            // 策略1: 返回上次缓存的旧数据（容忍短暂不一致）
            return getStaleCache(key);
        }
        // 策略2: 返回默认/静态数据
        return getDefaultData(key);
        // 策略3: 返回"稍后重试"提示（保命）
        // return "系统繁忙，请稍后重试";
    }
}
```

## 四、热点探测——主动发现热点

```java
// 滑动窗口热点Key检测
public class HotKeyDetector {
    private ConcurrentHashMap<String, LongAdder> counter = new ConcurrentHashMap<>();
    private static final int HOT_THRESHOLD = 10_000; // 1秒内1万次访问=热点
    private static final int WINDOW_MS = 1000;
    
    public void access(String key) {
        counter.computeIfAbsent(key, k -> new LongAdder()).increment();
    }
    
    @Scheduled(fixedRate = WINDOW_MS)
    public void detect() {
        counter.forEach((key, count) -> {
            if (count.sum() > HOT_THRESHOLD) {
                // 标记为热点Key → 触发预加载+多副本
                activateHotKeyProtection(key);
            }
        });
        counter.clear(); // 重置计数器
    }
}
```

## 五、方案对比

| 方案 | 解决的问题 | 复杂度 | 延迟影响 | 适用规模 |
|------|-----------|--------|---------|---------|
| 互斥锁 | 缓存击穿 | 低 | +50ms(等锁) | 中等 |
| 多副本 | 单点热点 | 中 | 无 | 高 |
| 多级缓存 | 整体命中率 | 中 | 降低50%+ | 高 |
| 热点探测 | 主动发现 | 高 | 无 | 超高 |
| 降级兜底 | 极端保命 | 低 | N/A | 所有 |

## 六、面试加分点

1. **完整回答框架**：从「预防→保护→降级」三层递进——先说怎么预防（热点探测+预加载），再说怎么保护（互斥锁+多副本+多级缓存），最后说极端情况怎么降级保命。这个框架让面试官觉得你有系统性思维
2. **Redis Cluster vs Proxy**：多副本打散在Redis Cluster中是自动的（slot分布），但热点Key可能集中在同一个slot——需要客户端层面做副本分散（如Redis Proxy层拦截热点Key自动复制）
3. **缓存预热**：大事件前（如春晚、双11）提前将热点数据加载到各级缓存，避免活动开始时的缓存击穿——提及这个主动防御策略加分
4. **一致性权衡**：多级缓存必然引入数据不一致——对于热点新闻场景，短暂不一致（几秒到几分钟）是可接受的，关键是保证系统可用性
5. **监控告警**：热点缓存场景需要实时监控缓存命中率、DB QPS、P99延迟——命中率<95%或DB QPS飙升时自动触发降级开关


## 结构化回答

**30 秒电梯演讲：** 热点缓存在瞬间千万级流量下需要四道防线：互斥锁防击穿→多副本打散热点Key→本地缓存+CDN多级缓存→降级兜底保命。

**展开框架：**
1. **四道防线** — 互斥锁→多副本→多级缓存→降级
2. **互斥锁** — 只放一个请求回源，其余等缓存重建
3. **多副本** — hot_key_1~N分散到不同Redis节点

**收尾：** 这块我踩过坑——要不要深入聊：互斥锁用什么实现？Redis SETNX还是Redisson？

## 视频脚本

> 预计时长：4 分钟 | 由浅入深

| 时间 | 画面/字幕 | 口播台词 | 讲解要点 |
|------|----------|----------|----------|
| 0:00 | 标题卡 | "cache-architecture一句话：热点缓存在瞬间千万级流量下需要四道防线：互斥锁防击穿→多副本打散热点Key→本地缓存+CDN多级…。" | 开场钩子 |
| 0:15 | Redis Lua 脚本执行截图 | "四道防线：互斥锁到多副本到多级缓存到降级" | 四道防线 |
| 1:08 | Redis Lua 脚本执行截图分步演示 | "互斥锁：只放一个请求回源，其余等缓存重建" | 互斥锁 |
| 2:01 | 关键代码/伪代码片段 | "多副本：hot_key_1~N分散到不同Redis节点" | 多副本 |
| 2:54 | 对比表格 | "多级：CDN到本地缓存到Redis到DB" | 多级 |
| 3:50 | 总结卡 | "核心抓住这条主线，下期咱们接着聊：互斥锁用什么实现？Redis SETNX还是Redisson。" | 收尾 |

## 苏格拉底式面试追问

| 追问层级 | 面试官可能这样问 | 高分回答方向 |
|----------|------------------|--------------|
| 目标追问 | 明星官宣热点缓存要应对什么核心挑战？ | 瞬间千万级流量打到一个Key导致缓存击穿、单点Redis热点、DB被压垮——核心是打散热点+多级防御 |
| 证据追问 | 四道防线具体是什么？各自作用？ | 互斥锁防击穿（只让一个请求回源）、多副本打散热点Key（多个副本Key分散请求）、本地缓存+CDN多级（拦截读流量）、限流降级兜底 |
| 边界追问 | 热点Key怎么提前发现？ | 通过监控Redis QPS TopN、业务预判（官宣/大促）、大数据分析访问模式，提前识别并预热多副本 |
| 反例追问 | 只加互斥锁够吗？ | 不够。互斥锁只防击穿，但单Key仍是热点、单Redis节点压力没分散；要配合多副本打散 |
| 风险追问 | 热点缓存方案的风险？ | 多副本一致性、本地缓存失效复杂、限流误杀、CDN回源风暴、预热失败 |
| 验证追问 | 怎么验证方案扛得住？ | 压测模拟热点流量、多副本命中率、各层拦截比例、DB压力监控 |
| 沉淀追问 | 热点缓存怎么沉淀？ | 规范：热点识别+多副本+多级缓存+限流降级、监控告警、应急预案 |

### 现场对话示例
**面试官**：明星官宣离婚，热点缓存怎么扛千万流量？
**候选人**：四道防线：互斥锁防击穿、多副本打散热点Key分散请求、本地缓存+CDN多级拦截读流量、限流降级兜底，配合热点预识别预热。
**面试官**：只加互斥锁够吗？
**候选人**：不够，互斥锁只防击穿但单Key仍是热点、单节点压力没分散，必须配合多副本打散和多级缓存。
**面试官**：热点Key怎么提前发现？
**候选人**：监控Redis QPS TopN、业务预判官宣大促、大数据分析访问模式，提前识别并预热多副本和本地缓存。
