---
id: note-tsl-008
difficulty: L3
category: system-design
subcategory: 高并发
tags:
- 特斯拉
- 会员系统
- 权益管理
- 实时计费
feynman:
  essence: 会员系统的本质是"等级状态机+权益规则引擎+实时计费"。核心：用户充值/行为升级会员等级（状态机），等级映射权益（规则引擎），充电时实时应用折扣（计费引擎）。
  analogy: 僈星级酒店会员——住够N晚升级金卡（等级状态机），金卡享受免费早餐和延迟退房（权益映射），结账时自动打折（实时计费）。
  key_points:
  - 会员等级状态机(Silver→Gold→Platinum)
  - 权益规则引擎(等级→权益映射)
  - 实时计费(充电费×会员折扣)
  - 权益实时生效(缓存预热+事件驱动)
  - 账单统计(流式计算/批处理)
first_principle:
  essence: 会员系统 = 身份(你是谁) + 权益(你享受什么) + 计费(你付多少钱)。权益本质是一组条件→动作的规则，用规则引擎（Drools/自研）可以灵活配置而不改代码。
  derivation: 假设千万会员，每次充电需查询会员等级+权益+折扣。如果每次查DB→50ms+，用Redis缓存→1ms。权益变更需秒级生效→事件驱动更新缓存。
  conclusion: 架构 = 等级状态机 + Redis权益缓存(实时) + 规则引擎(灵活配置) + 流式计费(账单) + 事件驱动(实时生效)。
follow_up:
- 会员刚升级，权益如何秒级生效？
- 权益被滥用（如无限充电折扣）怎么办？
- 跨国会员如何处理汇率和税费？
- 会员退订后已享受的权益怎么处理？
---

# 会员享受充电折扣、优先预约等权益，如何设计后端架构，支持会员等级管理、权益实时生效与账单统计？

## 🎯 本质

```
会员系统 = 等级管理(状态机) + 权益管理(规则引擎) + 计费系统(实时+批处理)
```

| 模块 | 职责 | 关键挑战 |
|------|------|----------|
| **等级管理** | 升降级规则 | 跨周期升降级 |
| **权益管理** | 等级→权益映射 | 实时生效 |
| **实时计费** | 充电时应用折扣 | 并发扣费准确性 |
| **账单统计** | 月度/年度汇总 | 海量交易聚合 |

---

## 🧒 类比

想象一个**航空公司常旅客计划**：
1. 飞够里程升级银卡/金卡/白金卡（等级状态机）
2. 不同等级享受不同权益：休息室/优先登机/额外行李（权益映射）
3. 买票时自动应用里程折扣（实时计费）
4. 每月发送里程对账单（账单统计）

---

## 📊 整体架构图

```
┌──────────────────────────────────────────────────────────────┐
│                    用户行为事件流                              │
│         充电/消费/推荐 → Kafka事件流                           │
└───────────────┬──────────────────────────────────────────────┘
                │
┌───────────────▼──────────────────────────────────────────────┐
│              会员等级服务 (状态机)                              │
│   消费累计 → 触发升级检查 → 更新等级 → 发布等级变更事件         │
└───────┬───────────────┬──────────────────────────────────────┘
        │               │
┌───────▼───────┐ ┌────▼──────────────────────────────────────┐
│ Redis权益缓存  │ │     权益规则引擎                            │
│ 等级→权益快照   │ │  Silver: 充电95折, 无优先预约               │
│ 毫秒级查询     │ │  Gold:   充电8折, 优先预约, 免费            │
└───────┬───────┘ │  Platinum: 充电6折, VIP桩, 免费超充          │
        │         └────────────────────────────────────────────┘
        │
┌───────▼──────────────────────────────────────────────────────┐
│              实时计费服务                                      │
│   充电结束 → 查会员等级 → 应用折扣 → 实时扣费                   │
└───────┬──────────────────────────────────────────────────────┘
        │
┌───────▼──────────────────────────────────────────────────────┐
│              账单统计 (流式+批处理)                            │
│   Flink实时流 → 日账单    Spark批处理 → 月账单                  │
└──────────────────────────────────────────────────────────────┘
```

---

## 🔧 详解

### 1. 会员等级状态机

```java
public enum MemberTier {
    SILVER(1),    // 银卡
    GOLD(2),      // 金卡
    PLATINUM(3);  // 白金卡

    public final int level;
    MemberTier(int level) { this.level = level; }
}

@Service
public class MembershipService {

    // 消费事件触发等级检查
    @KafkaListener(topics = "charging-completed")
    public void onChargingCompleted(ChargingEvent event) {
        // ① 更新累计消费
        membershipMapper.addSpending(event.getUserId(), event.getAmount());

        // ② 检查是否触发升级
        Membership membership = getMembership(event.getUserId());
        MemberTier newTier = calculateTier(membership.getTotalSpending());

        if (newTier.level > membership.getTier().level) {
            // ③ 升级！
            membershipMapper.updateTier(event.getUserId(), newTier);

            // ④ 刷新权益缓存
            refreshBenefitsCache(event.getUserId(), newTier);

            // ⑤ 发布升级事件 → 推送通知 + 权益立即生效
            eventBus.publish(new TierUpgradedEvent(event.getUserId(), newTier));
        }
    }

    private MemberTier calculateTier(double totalSpending) {
        if (totalSpending >= 10000) return MemberTier.PLATINUM;
        if (totalSpending >= 3000) return MemberTier.GOLD;
        return MemberTier.SILVER;
    }
}
```

### 2. 权益规则引擎

```java
// 权益定义（配置化，不改代码就能调整）
public class BenefitRule {
    private MemberTier minTier;           // 最低等级要求
    private String benefitType;           // 权益类型
    private BigDecimal discountRate;      // 折扣率
    private Integer priorityLevel;        // 优先预约等级
    private Integer freeChargingMinutes;  // 免费充电分钟数
    private boolean vipChargerAccess;     // VIP桩权限
}

// 权益配置存储（DB/配置中心）
@Service
public class BenefitRuleService {

    @Cacheable(value = "benefits", key = "#tier")
    public BenefitRule getBenefits(MemberTier tier) {
        // 从DB加载该等级的权益配置
        return benefitRuleMapper.findByTier(tier);
    }

    // 权益变更时刷新缓存
    public void refreshBenefitsCache(Long userId, MemberTier tier) {
        BenefitRule benefits = getBenefits(tier);
        // 写入Redis，充电服务直接读Redis
        redis.opsForValue().set(
            "member:benefits:" + userId,
            JSON.toJSONString(benefits),
            7, TimeUnit.DAYS
        );
    }
}
```

### 3. 实时计费（充电结束时应用折扣）

```java
@Service
public class ChargingBillService {

    public Bill calculateBill(String userId, ChargingSession session) {
        // ① 查会员权益（从Redis，毫秒级）
        BenefitRule benefits = getBenefitsFromCache(userId);

        // ② 计算基础费用
        BigDecimal energyCost = session.getEnergyKwh()
            .multiply(session.getPricePerKwh());

        // ③ 应用会员折扣
        BigDecimal discountRate = benefits.getDiscountRate();
        BigDecimal discountedCost = energyCost.multiply(discountRate);

        // ④ 扣减免费充电额度
        BigDecimal finalCost = discountedCost;
        if (benefits.getFreeChargingMinutes() > 0) {
            int freeMinutes = Math.min(
                benefits.getFreeChargingMinutes(),
                session.getDurationMinutes()
            );
            BigDecimal freeAmount = calculateFreeAmount(freeMinutes, session);
            finalCost = finalCost.subtract(freeAmount).max(BigDecimal.ZERO);
        }

        // ⑤ 扣费（原子操作）
        paymentService.charge(userId, finalCost);

        return new Bill(session, energyCost, discountRate, finalCost);
    }
}
```

### 4. 账单统计（流式 + 批处理）

```java
// 日账单：Flink实时流计算
public class DailyBillingJob {

    // 每小时汇总一次当日充电消费
    @Scheduled(cron = "0 0 * * * ?")
    public void aggregateDailyBills() {
        // 按用户聚合当日所有充电消费
        String sql = """
            INSERT INTO daily_bill (user_id, bill_date, total_amount,
                                   discount_amount, final_amount, charge_count)
            SELECT user_id, DATE(created_at) as bill_date,
                   SUM(original_amount) as total_amount,
                   SUM(discount_amount) as discount_amount,
                   SUM(final_amount) as final_amount,
                   COUNT(*) as charge_count
            FROM charging_bill
            WHERE created_at >= CURDATE()
            GROUP BY user_id, DATE(created_at)
            ON DUPLICATE KEY UPDATE
                total_amount = VALUES(total_amount),
                final_amount = VALUES(final_amount)
            """;
        billMapper.upsertDailyBills(sql);
    }
}

// 月账单：月底批量生成
@Scheduled(cron = "0 0 3 1 * ?") // 每月1号凌晨3点
public void generateMonthlyBills() {
    // 汇总上月所有日账单 → 月账单
    // 包含：总消费/总折扣/充电次数/会员权益使用情况
}
```

---

## ❓ 发散追问

### Q1：会员刚升级，权益如何秒级生效？

1. **事件驱动**：升级事件发布后，消费者立即刷新Redis缓存
2. **充电前实时校验**：即使缓存未更新，充电服务也会查一次最新等级
3. **用户侧推送**：升级后App立即收到通知，权益状态实时更新

### Q2：权益被滥用怎么办？

- **使用上限**：免费充电有月度上限（如每月300分钟）
- **频率限制**：优先预约每天限2次
- **异常检测**：高频使用触发风控审核
- **权益回收**：退订/降级时自动回收未使用权益

### Q3：跨国会员如何处理汇率和税费？

- **多币种计费**：按充电站所在地货币计价，会员折扣率通用
- **汇率转换**：账单按用户主货币展示，实时汇率换算
- **税费合规**：不同国家税率不同，计费引擎按地区加载税率规则
