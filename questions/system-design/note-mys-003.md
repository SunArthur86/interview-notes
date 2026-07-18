---
id: note-mys-003
difficulty: L3
category: system-design
subcategory: 高并发
tags:
- 美云智数
- Java后端
- 高并发
- 超卖
- Redis
- 消息队列
- 终面
- 面经
feynman:
  essence: 超卖的本质是"并发读-改-写"的竞态条件——多个请求同时读到库存=1，各自判断够用后都扣减。防超卖的核心是"检查和扣减必须原子化"，三层方案是从数据库到缓存到消息队列的纵深防御。
  analogy: 就像最后一个演唱会门票——如果10个人同时看到"还剩1张"，都点击购买，就超卖了。解决方法：要么加锁（数据库层），要么先到先得（Redis层），要么排队（消息队列层）。
  key_points:
  - 数据库层：UPDATE stock=stock-1 WHERE stock>0 利用行锁保证原子性
  - Redis层：DECR/Lua脚本原子扣减，库存预热到Redis
  - 消息队列层：请求入队串行消费，削峰填谷
  - 三层不是互斥而是纵深防御——Redis挡流量+DB做兜底
  - 关键细节：Redis扣减成功后异步同步到DB，失败需回滚Redis
first_principle:
  essence: 防超卖 = 保证"检查库存>0"和"库存-1"的原子性操作
  derivation: 并发请求同时检查stock>0→都通过→都执行stock-1→超卖→解决：让检查+扣减在同一原子操作内→数据库行锁/Redis单线程/Lua脚本
  conclusion: 越靠近用户拦截越好（Redis先行），但必须有数据库层兜底保证最终正确
follow_up:
- Redis宕机了怎么办？库存数据不一致如何恢复？
- 分布式环境下如何防止用户重复下单？
- 秒杀场景下如何防止恶意刷单？（验证码+IP限流+风控）
- 如果库存预热到Redis时数据不一致怎么办？（定时对账+补偿）
memory_points:
- 三层防御：Redis原子扣减(DB前置) + DB乐观锁(兜底) + MQ削峰(削峰填谷)
- DB层：UPDATE SET stock=stock-1 WHERE id=? AND stock>0 受影响行数=0则卖完
- Redis层：DECR返回值<0说明超卖，Lua脚本保证check+扣减原子
- 超卖根因：check和扣减不是原子操作 → 解决方案都是让它们原子化
- 最终一致：Redis先扣→异步写DB→失败回滚Redis+通知用户
---

# 【美云智数终面】高并发下商品库存扣减，如何防止超卖？从数据库、缓存、消息队列三层设计方案

> 来源：小红书 美云智数 Java后端终面面经

## 一、超卖是怎么发生的

```
时间线    请求A          请求B          请求C          库存值
  T1     读stock=1                                    1
  T2                    读stock=1                      1
  T3                                   读stock=1       1
  T4     判断 stock>0 ✓                               1
  T5                    判断 stock>0 ✓                 1
  T6                                   判断 stock>0 ✓  1
  T7     写stock=0                                    0
  T8                    写stock=-1  ← 超卖!          -1
  T9                                   写stock=-2 ← 更超!  -2

  根因：读(check)和写(deduct)是分离的，中间窗口被并发利用
```

## 二、三层方案设计

### 第一层：数据库层——行锁兜底

```sql
-- 方案A：条件更新（推荐，最简单可靠）
UPDATE product_stock 
SET stock = stock - 1, 
    version = version + 1
WHERE product_id = #{productId} 
  AND stock > 0;
-- 返回 affected_rows：1=成功，0=库存不足

-- 方案B：乐观锁（version字段）
UPDATE product_stock 
SET stock = stock - 1,
    version = version + 1
WHERE product_id = #{productId}
  AND version = #{currentVersion};
-- 版本号不匹配说明被其他请求抢先了
```

```
数据库层能力边界
┌────────────────────────────────┐
│  ✅ 保证不超卖（行锁+条件判断）   │
│  ❌ 扛不住高并发（行锁竞争严重）  │
│  ❌ 1000 QPS 以上开始大量超时   │
└────────────────────────────────┘
```

**适用**：日活不高的普通电商。秒杀场景必须加缓存层。

### 第二层：Redis层——原子扣减（核心防线）

```lua
-- Lua脚本：保证"检查+扣减"原子执行（Redis单线程执行Lua不会被中断）
local stock = tonumber(redis.call('GET', KEYS[1]))
if stock == nil then
    return -1  -- 商品不存在
end
if stock <= 0 then
    return 0   -- 库存不足
end
redis.call('DECR', KEYS[1])
return 1       -- 扣减成功
```

```java
@Service
public class StockService {
    
    @Autowired
    private RedisTemplate<String, String> redisTemplate;
    
    private static final String LUA_SCRIPT = 
        "local stock = tonumber(redis.call('GET', KEYS[1])) " +
        "if stock == nil then return -1 end " +
        "if stock <= 0 then return 0 end " +
        "redis.call('DECR', KEYS[1]) return 1";
    
    public boolean deductStock(Long productId) {
        String key = "stock:product:" + productId;
        DefaultRedisScript<Long> script = new DefaultRedisScript<>(LUA_SCRIPT, Long.class);
        Long result = redisTemplate.execute(script, Collections.singletonList(key));
        
        if (result == null || result == 0) {
            return false;  // 库存不足
        }
        if (result == -1) {
            return false;  // 商品不存在
        }
        
        // Redis扣减成功 → 异步同步到数据库
        sendAsyncMessage(productId);
        return true;
    }
    
    private void sendAsyncMessage(Long productId) {
        // 发送MQ消息，异步更新DB库存
        rocketMQTemplate.asyncSend("stock-sync", 
            new StockSyncMsg(productId, 1), callback);
    }
}
```

```
Redis层架构
                     用户请求
                        │
                        ▼
              ┌─────────────────┐
              │  Redis Lua扣减   │ ← 原子操作，10万+ QPS
              │  stock:product:X │
              └────────┬────────┘
                       │
            ┌──────────┼──────────┐
            ▼          ▼          ▼
        库存充足    库存不足    商品不存在
        扣减成功    直接拒绝    返回错误
            │
            ▼
        异步MQ消息
            │
            ▼
        ┌────────┐
        │ DB更新  │ ← 最终一致
        │ stock-1 │
        └────────┘
```

**库存预热**（活动开始前）：

```java
// 定时任务：活动开始前5分钟将DB库存同步到Redis
@Scheduled(cron = "0 55 * * * *")
public void preloadStock() {
    List<Product> products = productMapper.getSeckillProducts();
    for (Product p : products) {
        String key = "stock:product:" + p.getId();
        redisTemplate.opsForValue().set(key, String.valueOf(p.getStock()));
    }
}
```

### 第三层：消息队列层——削峰填谷

```
┌─────────────────────────────────────────────────┐
│                 秒杀请求处理流程                    │
│                                                  │
│  用户 ──► 网关限流 ──► 创建订单请求 ──► MQ队列     │
│                                                  │
│                                        │         │
│                              ┌─────────┘         │
│                              ▼                   │
│                     ┌────────────────┐           │
│                     │ 消费者串行处理   │           │
│                     │ 1. Redis扣减    │           │
│                     │ 2. 创建订单     │           │
│                     │ 3. DB更新       │           │
│                     └────────────────┘           │
│                                                  │
│  效果：10万请求 → MQ削峰 → 消费者按能力处理        │
│        避免DB被瞬间打挂                            │
└─────────────────────────────────────────────────┘
```

```java
// 生产者：请求入队
@RestController
public class SeckillController {
    
    @PostMapping("/seckill/{productId}")
    public Result seckill(@PathVariable Long productId, Long userId) {
        // 快速检查：Redis库存标记
        if (!checkStockFlag(productId)) {
            return Result.fail("已售罄");
        }
        // 入队异步处理
        SeckillMsg msg = new SeckillMsg(userId, productId);
        rocketMQTemplate.sendOneWay("seckill-queue", msg);
        return Result.ok("排队中，请等待");
    }
}

// 消费者：串行处理
@RocketMQMessageListener(topic = "seckill-queue")
public class SeckillConsumer implements RocketMQListener<SeckillMsg> {
    
    @Override
    public void onMessage(SeckillMsg msg) {
        // 幂等检查
        if (orderMapper.existsByUserAndProduct(msg.getUserId(), msg.getProductId())) {
            return; // 已处理过
        }
        // Redis原子扣减
        if (!stockService.deductStock(msg.getProductId())) {
            notifyUser(msg.getUserId(), "库存不足");
            return;
        }
        // 创建订单
        orderService.createOrder(msg);
    }
}
```

## 三、三层方案对比总结

| 层级 | 方案 | QPS上限 | 一致性 | 适用场景 |
|------|------|---------|--------|---------|
| **DB层** | UPDATE WHERE stock>0 | ~1000 | 强一致 | 普通电商 |
| **Redis层** | Lua脚本原子扣减 | 10万+ | 最终一致 | 秒杀/抢购 |
| **MQ层** | 请求入队串行消费 | 按消费者数量 | 最终一致 | 超高并发 |

### 生产环境最佳实践

```
纵深防御架构

用户请求
    │
    ├──► [网关层] IP限流 + 验证码 + 风控拦截
    │         │ (拦掉90%恶意请求)
    │         ▼
    ├──► [Redis层] Lua原子扣减 ← 第一道防线
    │         │ (挡住99%流量)
    │         ▼  
    ├──► [MQ层] 请求入队异步处理 ← 削峰
    │         │ (保护后端服务)
    │         ▼
    └──► [DB层] 条件UPDATE兜底 ← 最终防线
              (保证数据绝对正确)
```

## 四、面试加分点

1. **纵深防御**：不是三层选一个，而是层层递进——Redis挡流量+DB做兜底
2. **Redis与DB的一致性**：能说出"Redis扣减成功后异步写DB，如果DB写失败需要回滚Redis"
3. **Lua脚本的必要性**：能解释为什么不用GET→判断→DECR（非原子，仍会超卖）
4. **库存预热时机**：活动开始前将DB库存同步到Redis，活动结束后对账
5. **防刷策略**：提到验证码、IP限流、用户频率限制等多维度防护


## 结构化回答

**30 秒电梯演讲：** 超卖的本质是"并发读-改-写"的竞态条件——多个请求同时读到库存就是1，各自判断够用后都扣减。

**展开框架：**
1. **三层防御** — Redis原子扣减(DB前置) + DB乐观锁(兜底) + MQ削峰(削峰填谷)
2. **DB层** — UPDATE SET stock=stock-1 WHERE id=? AND stock>0 受影响行数=0则卖完
3. **Redis层** — DECR返回值<0说明超卖，Lua脚本保证check+扣减原子

**收尾：** 这块我踩过坑——要不要深入聊：Redis宕机了怎么办？库存数据不一致如何恢复？

## 视频脚本

> 预计时长：3 分钟 | 由浅入深

| 时间 | 画面/字幕 | 口播台词 | 讲解要点 |
|------|----------|----------|----------|
| 0:00 | 标题卡 | "高并发一句话：超卖的本质是'并发读-改-写'的竞态条件——多个请求同时读到库存就是1…。" | 开场钩子 |
| 0:15 | Redis Lua 脚本执行截图 | "三层防御：Redis原子扣减(DB前置) + DB乐观锁(兜底) + MQ削峰(削峰填谷)" | 三层防御 |
| 1:06 | Redis Lua 脚本执行截图分步演示 | "DB层：UPDATE SET stock就是stock-1 WHERE id就是? AND stock>0 受影响行…" | DB层 |
| 1:57 | 关键代码/伪代码片段 | "Redis层：DECR返回值<0说明超卖，Lua脚本保证check+扣减原子" | Redis层 |
| 2:50 | 总结卡 | "核心抓住这条主线，下期咱们接着聊：Redis宕机了怎么办？库存数据不一致如何恢复。" | 收尾 |

## 苏格拉底式面试追问

| 追问层级 | 面试官可能这样问 | 高分回答方向 |
|----------|------------------|--------------|
| 目标追问 | 防超卖的核心目标是什么？ | 并发下库存扣减不出现负数——'并发读-改-写'竞态导致多扣，要保证扣减原子性和一致性 |
| 证据追问 | 数据库、缓存、MQ三层方案各自怎么做？ | DB层用乐观锁（version/where stock>0）或悲观锁；缓存层用Lua脚本原子扣减+预扣；MQ层异步削峰+最终扣减 |
| 边界追问 | 纯数据库扣减够不够？为什么要三层？ | 纯DB扛不住高并发（行锁竞争、慢）；缓存层扛流量预扣、DB层保一致、MQ削峰，分层应对不同QPS |
| 反例追问 | 缓存扣减成功DB失败怎么办？ | 需要补偿回滚缓存、或缓存预扣+DB最终扣减+对账；不能只信缓存，DB是最终一致依据 |
| 风险追问 | 防超卖方案的风险有哪些？ | 缓存DB不一致、Redis宕机、Lua脚本性能、MQ积压、超时重试导致重复扣减 |
| 验证追问 | 怎么验证防超卖有效？ | 并发压测（万级QPS）断言库存不超卖、缓存DB对账、监控扣减成功率和对账差异 |
| 沉淀追问 | 防超卖方案怎么沉淀？ | 规范：缓存预扣+DB最终一致+对账兜底、Lua原子脚本、幂等key、监控告警 |

### 现场对话示例
**面试官**：高并发商品库存扣减如何防止超卖？从数据库、缓存、MQ三层设计。
**候选人**：DB层用乐观锁where stock>0原子扣减；缓存层Redis Lua脚本预扣扛流量；MQ层异步削峰最终扣减；对账兜底一致性。
**面试官**：纯数据库扣减够吗？
**候选人**：不够，高并发下行锁竞争严重、慢查询影响在线；缓存层扛流量预扣、DB保一致、MQ削峰分层应对。
**面试官**：缓存扣减成功DB失败怎么办？
**候选人**：补偿回滚缓存，或缓存预扣+DB最终扣减+对账兜底，不能只信缓存，DB是最终一致依据。
