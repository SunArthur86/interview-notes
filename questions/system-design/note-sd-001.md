---
id: note-sd-001
difficulty: L4
category: system-design
subcategory: 高并发
tags:
- 秒杀
- 高并发
- Redis
- 限流
feynman:
  essence: 秒杀 = 把瞬时洪峰分散消化。前端挡一波（限流）, Redis挡一波（库存预热）, MQ异步削峰, DB最后兜底。
  analogy: 秒杀像春运抢火车票——先让购票app卡一下分散流量（前端限流），余票信息提前到Redis（不查数据库），抢到后排队出票（MQ异步），出完票更新数据库。
  key_points:
  - 前端+网关双层限流
  - Redis原子扣减防超卖
  - MQ异步削峰
  - Lua脚本保证原子性
  - DB兜底同步
first_principle: null
follow_up:
- Redis挂了怎么办？
- 怎么防止黄牛刷单？
memory_points:
- 核心思想：层层削峰，10万请求最终仅有极少量打到DB，拦截在越前段越好
- 漏斗模型：前端→网关限流→应用过滤，层层递减退掉无效流量
- 原子防超卖：Redis执行Lua脚本扣减库存，因为需保证“判断+扣减”串行原子性
- 异步落库：因为DB无法承受并发写入，所以Redis扣减成功后发MQ异步落DB下单
---

# 设计一个秒杀系统，核心要点是什么？

## 一、问题分析

秒杀系统的本质是在**极短时间窗口（通常几秒内）**面对**远超日常数十倍乃至上百倍的流量洪峰**，需要保证：

| 核心目标 | 说明 |
|----------|------|
| **防超卖** | 库存只有 1000，绝不能卖出 1001 件 |
| **高并发** | 10 万 QPS 量级，系统不能崩溃 |
| **防刷单** | 防止黄牛脚本/机器批量抢购 |
| **高可用** | 核心链路不能宕机 |
| **数据一致性** | Redis 扣减与数据库最终一致 |

> **核心设计思想：层层削峰，让真正到达数据库的请求极少。**

```
10万请求 → 前端挡掉6万 → 网关限流剩2万 → 应用层过滤剩5千
→ Redis扣减成功的1千 → MQ异步下单 → DB承受1千写入
```

---

## 二、整体架构图

```
                           ┌──────────────────────────────────────────┐
                           │              CDN（静态资源）               │
                           │   商品页/JS/CSS/图片 → 就近缓存            │
                           └──────────────┬───────────────────────────┘
                                          │ 动态请求
                           ┌──────────────▼───────────────────────────┐
                           │           负载均衡 (Nginx/LB)              │
                           │   连接限流 / IP 频率限制                   │
                           └──────────────┬───────────────────────────┘
                                          │
                           ┌──────────────▼───────────────────────────┐
                           │           API 网关层                       │
                           │  鉴权 / 令牌桶限流 / 防刷 / 路由            │
                           └──────────────┬───────────────────────────┘
                                          │
                    ┌─────────────────────┼─────────────────────┐
                    │                     │                     │
            ┌───────▼───────┐    ┌────────▼───────┐   ┌────────▼───────┐
            │  秒杀服务 A    │    │  秒杀服务 B     │   │  秒杀服务 C     │
            │  (无状态)      │    │  (无状态)       │   │  (无状态)       │
            └───────┬───────┘    └────────┬───────┘   └────────┬───────┘
                    │                     │                     │
                    └─────────────────────┼─────────────────────┘
                                          │
                    ┌─────────────────────┼─────────────────────┐
                    │                     │                     │
            ┌───────▼───────┐    ┌────────▼───────┐   ┌────────▼───────┐
            │  Redis 集群   │    │   MQ (Kafka/   │   │  本地缓存      │
            │  库存预热      │    │   RocketMQ)    │   │  (Caffeine)    │
            │  原子扣减      │    │   异步削峰     │   │  活动元数据     │
            └───────┬───────┘    └────────┬───────┘   └────────────────┘
                    │                     │
                    │          ┌──────────▼──────────┐
                    │          │  订单消费者集群       │
                    │          │  幂等消费 / DB写入   │
                    │          └──────────┬──────────┘
                    │                     │
            ┌───────▼─────────────────────▼───────────────────────┐
            │              MySQL（分库分表）                         │
            │   订单表 / 库存表 / 用户表  最终数据持久化              │
            └──────────────────────────────────────────────────────┘
```

---

## 三、分层防御策略（核心设计要点）

### 第 1 层：前端限流（挡掉 60% 流量）

| 手段 | 说明 |
|------|------|
| 按钮置灰 | 点击后立即禁用，防止重复提交 |
| 活动倒计时 | 未到开抢时间，请求不发往后端 |
| 验证码/滑动验证 | 增加机器操作成本 |
| 答题验证 | 阿里早期秒杀方案，故意延迟 1-2 秒打散流量 |
| 静态页 CDN | 商品详情页完全静态化，CDN 就近返回 |

> 关键：**前端是第一道防线，能挡多少挡多少。**

### 第 2 层：网关限流（挡掉 80% 剩余流量）

在 API 网关（如 Spring Cloud Gateway、Nginx+Lua）层实施：

```
限流策略：
  ① 全局限流：总 QPS 上限（如 2万 QPS），超出直接返回"活动太火爆"
  ② 单用户限流：同一 userId 每秒最多 1 次
  ③ 单 IP 限流：同一 IP 每秒最多 5 次（防机器人）
  ④ 黑名单机制：已知刷单 IP/设备 直接拒绝
```

**算法选择**：

| 算法 | 特点 | 适用场景 |
|------|------|----------|
| 令牌桶 | 允许突发流量，匀速发放令牌 | API 网关限流（推荐） |
| 漏桶 | 严格匀速出水，不允许突发 | 保护下游数据库 |
| 滑动窗口 | 精确控制时间窗口内请求数 | 单用户/单 IP 限流 |

### 第 3 层：应用层过滤

- **活动校验**：检查活动是否开始/结束（本地缓存活动元数据，不查 DB）
- **用户校验**：检查用户是否已购买过（Redis SET 去重）
- **库存预判**：本地缓存一个粗略库存标志，售罄后直接拒绝（快速失败）

### 第 4 层：Redis 原子扣减（核心！）

这是**防超卖**的关键。活动开始前，将库存写入 Redis。

**方案 A：DECR 原子扣减**

```bash
# 活动前预热
SET seckill:stock:{itemId} 1000

# 下单时原子扣减
DECR seckill:stock:{itemId}
# 返回值 ≥ 0 → 扣减成功；< 0 → 库存不足
```

**方案 B：Lua 脚本（检查 + 扣减原子化）**

```lua
-- seckill.lua
local stockKey = KEYS[1]        -- seckill:stock:{itemId}
local userId   = ARGV[1]

-- 1. 检查是否重复下单
if redis.call('SISMEMBER', stockKey .. ':users', userId) == 1 then
    return -2  -- 已购买过
end

-- 2. 检查库存
local stock = tonumber(redis.call('GET', stockKey))
if stock == nil or stock <= 0 then
    return 0   -- 库存不足
end

-- 3. 扣减库存 + 记录用户
redis.call('DECR', stockKey)
redis.call('SADD', stockKey .. ':users', userId)
return 1       -- 成功
```

> **为什么用 Lua？** Redis 执行 Lua 脚本时是**单线程原子**的，检查和扣减不会被其他命令插入，从根本上杜绝超卖。

### 第 5 层：MQ 异步削峰

Redis 扣减成功后，**不直接写数据库**，而是发送消息到 MQ：

```
用户请求 → Redis扣减成功 → 发送MQ消息(含 userId, itemId, orderId)
                                    │
                                    ▼
                        ┌──────────────────────┐
                        │  MQ (Kafka/RocketMQ)  │  ← 削峰填谷
                        └──────────┬───────────┘
                                   │ 异步消费（按DB承受能力控制消费速率）
                                   ▼
                        ┌──────────────────────┐
                        │  订单消费者            │
                        │  1. 幂等校验           │
                        │  2. 创建订单（DB）     │
                        │  3. 发送通知           │
                        └──────────────────────┘
```

**关键设计**：
- 消息**幂等**：消费端用 `orderId` 做去重，防止 MQ 重试导致重复下单
- **消费速率**：控制消费者并发数，让 DB 始终在安全负载内（如 1000 TPS）
- 用户**异步等待**：前端收到"排队中"提示，轮询订单状态

---

## 四、防超卖完整代码示例

### Java 核心代码（Spring Boot + Redis + Lua + RocketMQ）

```java
@Service
public class SeckillService {

    @Autowired private StringRedisTemplate redis;
    @Autowired private RocketMQTemplate mq;

    private static final DefaultRedisScript<Long> SECKILL_SCRIPT;
    static {
        SECKILL_SCRIPT = new DefaultRedisScript<>();
        SECKILL_SCRIPT.setLocation(new ClassPathResource("seckill.lua"));
        SECKILL_SCRIPT.setResultType(Long.class);
    }

    public SeckillResult doSeckill(Long itemId, Long userId) {
        String stockKey = "seckill:stock:" + itemId;

        // ① Lua 原子扣减（检查重复 + 检查库存 + 扣减）
        Long result = redis.execute(
            SECKILL_SCRIPT,
            Collections.singletonList(stockKey),
            userId.toString()
        );

        if (result == 0)  return SeckillResult.fail("手慢了，库存不足");
        if (result == -2) return SeckillResult.fail("您已抢购过该商品");

        // ② 扣减成功 → 发送 MQ 异步创建订单
        String orderId = generateOrderId(itemId, userId);
        SeckillMessage msg = new SeckillMessage(itemId, userId, orderId);
        mq.asyncSend("seckill-order-topic", msg, ...);

        // ③ 返回"排队中"，前端轮询
        return SeckillResult.queuing(orderId);
    }
}
```

```java
// MQ 消费者：异步落库
@RocketMQMessageListener(topic = "seckill-order-topic")
public class OrderConsumer implements RocketMQListener<SeckillMessage> {

    @Override
    public void onMessage(SeckillMessage msg) {
        // 幂等校验：防止 MQ 重试导致重复下单
        if (orderMapper.existsByOrderId(msg.getOrderId())) {
            return; // 已处理，跳过
        }
        // 创建订单（DB 写入）
        Order order = new Order(msg.getOrderId(), msg.getUserId(),
                                msg.getItemId(), OrderStatus.PAID);
        orderMapper.insert(order);
        // 发送通知
        notifyService.send(msg.getUserId(), "抢购成功！");
    }
}
```

---

## 五、缓存与数据库一致性

Redis 是最终一致性模型，活动结束后需要同步到 DB：

```
方案：定时对账 + 最终同步
  ① 活动期间：Redis 扣减为准，DB 不参与实时扣减
  ② 活动结束后：异步任务将 Redis 剩余库存同步回 DB
  ③ 定时对账：比对 Redis 扣减记录 vs DB 订单数，确保一致
  ④ 异常补偿：如发现不一致，触发告警 + 人工介入
```

| 一致性策略 | 说明 |
|-----------|------|
| 活动期间 | Redis 为准（最终一致性，允许短暂延迟） |
| 活动结束后 | 异步同步 Redis → DB |
| 日常对账 | 定时任务比对，发现差异告警 |

---

## 六、高可用与容灾设计

| 层级 | 容灾方案 |
|------|----------|
| Redis | 主从 + 哨兵/Cluster；挂了降级为本地缓存兜底 |
| MQ | 多副本集群；消息持久化；消费失败进入死信队列重试 |
| 应用服务 | 多实例部署 + 无状态化 + 健康检查自动摘除 |
| 数据库 | 读写分离 + 分库分表；主备切换 |
| 整体 | 限流降级 + 熔断（Sentinel/Hystrix）保护核心链路 |

**Redis 挂了的降级方案**：
```
Redis 不可用时：
  → 网关直接返回"活动太火爆"（快速失败）
  → 或降级到本地缓存（Caffeine）粗略计数（牺牲精度保可用）
  → 绝不直接打数据库（会被打垮）
```

---

## 七、防黄牛刷单策略

| 策略 | 说明 |
|------|------|
| 设备指纹 | 同一设备限制抢购次数 |
| 用户行为分析 | 请求频率/操作路径异常检测 |
| 风控规则引擎 | IP 黑名单、用户信誉分、图形验证码 |
| 购买限制 | 实名认证 + 每人限购 1 件 |
| 动态验证 | 滑动拼图/短信验证码/人脸识别 |
| 延迟发货 | 中奖后延迟发货，留出风控审核时间 |

---

## 八、面试高频追问

### Q1：Redis 挂了怎么办？

1. **快速失败**：网关层直接返回"活动太火爆"，保护数据库不被击穿。
2. **本地缓存兜底**：使用 Caffeine 做粗略库存计数（牺牲一定精度，保证可用）。
3. **Redis 高可用**：部署 Redis Sentinel 或 Cluster，自动主从切换。
4. **限流兜底**：Sentinel 限流降级，确保核心服务不雪崩。

### Q2：怎么防止黄牛刷单？

- **事前**：设备指纹 + 实名认证 + 验证码 + 购买限制
- **事中**：网关限流（单 IP/单设备/单用户 QPS）+ 风控规则引擎实时判断
- **事后**：行为分析 + 人工审核，发现问题订单取消并拉黑

---

## 九、总结：秒杀系统设计口诀

```
前端先挡一波流（置灰/验证码/CDN）
网关再限一道闸（令牌桶/IP限流）
应用层做校验（活动/用户/库存预判）
Redis 原子扣减（Lua 脚本防超卖）
MQ 异步来削峰（异步下单+幂等消费）
DB 兜底做持久（最终一致+定时对账）
风控防刷不能少（设备指纹+行为分析）
高可用要兜底（熔断降级+主备切换）
```

> **面试核心一句话**：秒杀系统的本质是**层层削峰**——前端限流 → 网关限流 → Redis 原子扣减 → MQ 异步削峰 → DB 最终持久化，让到达数据库的写入量始终在其承受范围内，同时用 Lua 脚本保证扣减原子性、MQ 幂等消费保证不重复下单。

## 记忆要点

- 核心思想：层层削峰，10万请求最终仅有极少量打到DB，拦截在越前段越好
- 漏斗模型：前端→网关限流→应用过滤，层层递减退掉无效流量
- 原子防超卖：Redis执行Lua脚本扣减库存，因为需保证“判断+扣减”串行原子性
- 异步落库：因为DB无法承受并发写入，所以Redis扣减成功后发MQ异步落DB下单

