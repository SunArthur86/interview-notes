---
id: note-tsl-003
difficulty: L4
category: system-design
subcategory: 高并发
tags:
- 特斯拉
- 积分系统
- 高并发
- Redis
- 分库分表
feynman:
  essence: 亿级车主积分的核心矛盾是"高并发读写"vs"数据绝对准确"。解法：热数据放Redis（实时扣减原子性），冷数据放DB（分库分表存储），通过MQ异步同步保证最终一致。
  analogy: 像大型商场的会员积分卡——收银台（Redis）实时扣减积分保证不超扣，每天晚上后台（DB）统一对账同步。这样收银快又不丢数据。
  key_points:
  - Redis原子操作保证积分不超扣
  - 分库分表存储亿级积分记录
  - MQ异步同步Redis→DB
  - 定时对账保证数据一致
  - 积分过期用延迟队列处理
first_principle:
  essence: 积分系统本质是一个高并发计数器+状态机。计数器需要原子性（防超扣/超加），状态机管理积分生命周期（获取→可用→冻结→兑换→过期）。
  derivation: 亿级用户 × 日均10次积分变动 = 日10亿次操作 ≈ 10K+ QPS。MySQL单机写入上限约5K TPS，必须用Redis做前置缓冲。积分计算需要强一致性（钱不能错），但存储可以最终一致。
  conclusion: 架构 = Redis原子计数(实时) + MQ异步落库(最终一致) + 分库分表(存储) + 延迟队列(过期) + 定时对账(校验)。
follow_up:
- 积分被恶意刷取怎么办？
- Redis和DB数据不一致怎么处理？
- 积分兑换时如何防超扣？
- 积分过期机制如何设计？
---

# 亿级车主积分获取、兑换、过期管理，如何设计后端架构，保证积分计算准确，支持高并发兑换且实时同步状态？

## 🎯 本质

| 核心挑战 | 说明 |
|----------|------|
| **高并发兑换** | 促销活动期间峰值 QPS 万级 |
| **绝对准确** | 积分=钱，不能算错 |
| **亿级存储** | 亿级用户 × 多年记录 |
| **过期管理** | 需要精准触发过期时间 |
| **实时同步** | 兑换后立即反映最新余额 |

---

## 🧒 类比

想象一家全球连锁银行的积分系统：
1. **柜台（Redis）**：客户来兑换时实时扣减，速度快，用保险箱锁住防超扣
2. **金库（MySQL）**：每天晚上统一把柜台数据搬回金库存储
3. **审计员（对账系统）**：定期核对柜台和金库是否一致
4. **闹钟（延迟队列）**：积分快过期时自动提醒用户

---

## 📊 整体架构图

```
                     ┌─────────────────────────────────┐
                     │         用户请求层                 │
                     │   获取积分 / 兑换积分 / 查询余额     │
                     └───────────────┬─────────────────┘
                                     │
                     ┌───────────────▼─────────────────┐
                     │       API 网关层                   │
                     │   鉴权 / 限流 / 防刷                 │
                     └───────────────┬─────────────────┘
                                     │
                     ┌───────────────▼─────────────────┐
                     │       积分服务层 (无状态)          │
                     │   ┌──────────────────────────┐  │
                     │   │  获取积分 → MQ异步处理     │  │
                     │   │  兑换积分 → Redis原子扣减  │  │
                     │   │  查询余额 → Redis直读      │  │
                     │   └──────────────────────────┘  │
                     └──┬──────────────┬───────────────┘
                        │              │
               ┌────────▼───┐   ┌─────▼──────────┐
               │  Redis集群  │   │  MQ (RocketMQ)  │
               │  积分余额    │   │  异步落库消息     │
               │  Lua原子操作 │   │  过期延迟消息     │
               └────────┬───┘   └─────┬──────────┘
                        │              │
               ┌────────▼──────────────▼───────────────┐
               │         MySQL 分库分表                   │
               │  user_points (用户积分汇总表)            │
               │  point_records (积分流水表, 按月分表)     │
               │  point_expire (过期记录表)               │
               └─────────────────────────────────────────┘
```

---

## 🔧 详解

### 1. 积分数据模型

```sql
-- 用户积分汇总表（分库分表，按 userId 取模）
CREATE TABLE user_points (
    user_id     BIGINT PRIMARY KEY,
    total       BIGINT NOT NULL DEFAULT 0,    -- 总积分
    available   BIGINT NOT NULL DEFAULT 0,    -- 可用积分
    frozen      BIGINT NOT NULL DEFAULT 0,    -- 冻结积分（兑换中）
    expired     BIGINT NOT NULL DEFAULT 0,    -- 已过期积分
    version     INT NOT NULL DEFAULT 0,       -- 乐观锁版本号
    updated_at  TIMESTAMP DEFAULT NOW()
);

-- 积分流水表（按月分表，记录每一笔变动）
CREATE TABLE point_records (
    id          BIGINT AUTO_INCREMENT PRIMARY KEY,
    user_id     BIGINT NOT NULL,
    change_type ENUM('earn', 'redeem', 'expire', 'adjust'),
    amount      INT NOT NULL,          -- 正=获取, 负=消耗
    balance     BIGINT NOT NULL,       -- 变动后余额（快照）
    source      VARCHAR(64),           -- 来源（充电/推荐/活动）
    biz_id      VARCHAR(128),          -- 业务流水号（幂等）
    created_at  TIMESTAMP DEFAULT NOW(),
    INDEX idx_user_time (user_id, created_at)
);
```

### 2. Redis 原子扣减（防超扣核心）

```lua
-- redeem_points.lua
local key = KEYS[1]           -- points:available:{userId}
local amount = tonumber(ARGV[1])
local bizId = ARGV[2]         -- 幂等键

-- 1. 幂等检查
if redis.call('SISMEMBER', key .. ':biz', bizId) == 1 then
    return -3  -- 重复请求
end

-- 2. 检查余额
local current = tonumber(redis.call('GET', key) or '0')
if current < amount then
    return -1  -- 余额不足
end

-- 3. 原子扣减
redis.call('DECRBY', key, amount)
redis.call('SADD', key .. ':biz', bizId)
return current - amount  -- 返回新余额
```

### 3. 积分过期延迟队列

```java
@Service
public class PointsExpireService {

    @Autowired private RocketMQTemplate mq;

    // 积分获取时，设置过期时间（如2年）
    public void earnPoints(Long userId, int amount, String source) {
        // ... 写入积分 ...

        // 发送延迟消息，到过期日触发扣减
        long expireDelay = 2 * 365 * 24 * 60 * 60 * 1000L; // 2年
        PointsExpireMessage msg = new PointsExpireMessage(userId, amount, recordId);

        // RocketMQ 18个延迟级别，选最接近的
        // Level 18 = 2h，需要自定义延迟
        // 生产环境用 Redisson 延迟队列或时间轮
        msg.delayLevel = calculateDelayLevel(expireDelay);
        mq.asyncSend("points-expire-topic", msg, ...);
    }
}

// 过期消费者
@RocketMQMessageListener(topic = "points-expire-topic")
public class PointsExpireConsumer implements RocketMQListener<PointsExpireMessage> {
    @Override
    public void onMessage(PointsExpireMessage msg) {
        // 将可用积分减去过期数量，记入已过期
        pointsService.expirePoints(msg.getUserId(), msg.getAmount());
        // 发送过期通知
        notifyService.send(msg.getUserId(), "您有" + msg.getAmount() + "积分已过期");
    }
}
```

### 4. 定时对账（保证数据一致）

```java
@Scheduled(cron = "0 0 3 * * ?") // 每天凌晨3点
public void dailyReconcile() {
    // 1. 取昨天有变动的所有用户
    List<Long> userIds = getActiveUserIds(yesterday());

    for (Long userId : userIds) {
        // 2. Redis余额 vs DB余额
        long redisBalance = redis.get("points:available:" + userId);
        long dbBalance = pointsMapper.getAvailable(userId);

        if (redisBalance != dbBalance) {
            // 3. 以DB流水为准，重算正确余额
            long correctBalance = recalculateFromRecords(userId);

            // 4. 修正Redis
            redis.set("points:available:" + userId, correctBalance);

            // 5. 记录对账差异，人工审核大额差异
            if (Math.abs(redisBalance - correctBalance) > 1000) {
                alertService.send("积分对账异常: user=" + userId
                    + " redis=" + redisBalance + " db=" + correctBalance);
            }
        }
    }
}
```

---

## 💻 核心代码：兑换积分完整流程

```java
@Service
public class PointsService {

    @Autowired private StringRedisTemplate redis;
    @Autowired private RocketMQTemplate mq;

    private static final DefaultRedisScript<Long> REDEEM_SCRIPT;
    static {
        REDEEM_SCRIPT = new DefaultRedisScript<>();
        REDEEM_SCRIPT.setLocation(new ClassPathResource("redeem_points.lua"));
        REDEEM_SCRIPT.setResultType(Long.class);
    }

    @Transactional
    public RedeemResult redeem(Long userId, int amount, String bizId) {
        String key = "points:available:" + userId;

        // ① Redis 原子扣减（检查余额 + 扣减 + 幂等）
        Long result = redis.execute(
            REDEEM_SCRIPT,
            Collections.singletonList(key),
            String.valueOf(amount), bizId
        );

        if (result == -1) return RedeemResult.fail("积分不足");
        if (result == -3) return RedeemResult.fail("请勿重复提交");

        // ② 发送 MQ 异步落库
        PointRecordMessage msg = new PointRecordMessage(
            userId, "redeem", -amount, result, bizId
        );
        mq.asyncSend("points-record-topic", msg, ...);

        return RedeemResult.success(result);
    }
}

// MQ消费者：异步写入DB
@RocketMQMessageListener(topic = "points-record-topic")
public class PointsRecordConsumer implements RocketMQListener<PointRecordMessage> {

    @Override
    public void onMessage(PointRecordMessage msg) {
        // 幂等：检查biz_id是否已处理
        if (recordMapper.existsByBizId(msg.getBizId())) return;

        // 写入流水表
        PointRecord record = new PointRecord();
        record.setUserId(msg.getUserId());
        record.setChangeType(msg.getChangeType());
        record.setAmount(msg.getAmount());
        record.setBalance(msg.getBalance());
        record.setBizId(msg.getBizId());
        recordMapper.insert(record);

        // 更新汇总表（乐观锁防并发）
        pointsMapper.updateAvailable(msg.getUserId(), msg.getAmount());
    }
}
```

---

## ❓ 发散追问

### Q1：积分被恶意刷取怎么办？

- **频率限制**：单个用户获取积分有日上限和频率限制
- **行为分析**：异常获取模式（如短时间内大量充电）触发风控
- **延迟入账**：获取的积分先冻结 24h，风控通过后才可用
- **审计追溯**：每笔积分有完整流水，可追溯到业务来源

### Q2：Redis和DB数据不一致怎么处理？

1. **以DB流水为准**：Redis只做缓存，DB是source of truth
2. **定时对账**：每天凌晨全量比对，发现差异自动修正
3. **实时监控**：Redis操作后异步发MQ，消费失败进入重试队列
4. **补偿机制**：Redis宕机恢复后，从DB重建缓存

### Q3：积分过期机制如何设计更精准？

- **FIFO过期**：按获取时间先进先出，先获取的先过期
- **批次管理**：每笔积分独立记录过期时间，过期时精确扣减对应批次
- **提前提醒**：过期前7天/1天/当天多轮推送提醒
