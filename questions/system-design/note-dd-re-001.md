---
id: note-dd-re-001
difficulty: L3
category: system-design
subcategory: 微服务
tags:
- 滴滴
- 面经
- 规则引擎
- 设计模式
- 抽奖系统
feynman:
  essence: 规则硬编码会导致牵一发动全身，必须用设计模式解耦。
  analogy: 就像装修时把所有电线焊死在墙里——要加一个插座就得砸墙。规则引擎就是可插拔的电线管道。
  first_principle: 软件设计的核心原则：开闭原则（对扩展开放，对修改封闭）。
  key_points:
  - 违反开闭原则
  - 难以维护和扩展
  - 责任链模式解耦
  - 规则配置化
first_principle:
  essence: 开闭原则（OCP）：对扩展开放，对修改封闭
  derivation: 硬编码→改规则=改代码=重新发版→风险高→用设计模式解耦
  conclusion: 规则绝不应该硬编码，必须用设计模式或规则引擎实现
follow_up:
- 什么是开闭原则？
- 规则简单时是否值得引入规则引擎？
- 规则引擎会不会过度设计？
---

# 【滴滴面经】你会把付费用户加权这种规则直接写死在抽奖流程里吗？为什么？

## 一、直接回答

**不会。** 把"付费用户加权"这类业务规则直接硬编码在抽奖流程中，是典型的**反模式**。核心原因：**严重违反开闭原则（OCP）**，导致系统难以扩展和维护。

正确的做法是通过 **责任链模式 + 组合模式** 构建规则引擎，实现规则逻辑与抽奖核心流程的彻底解耦。

## 二、硬编码的危害（反面教材）

### ❌ 反面代码——规则与业务流程强耦合

```java
// ❌ 硬编码方式：所有规则混在核心抽奖方法里
public class LotteryService {

    public LotteryResult draw(Long userId) {
        User user = userService.getById(userId);

        // 规则1：黑名单用户禁止抽奖
        if (blackListService.isBlack(userId)) {
            return LotteryResult.reject("黑名单用户");
        }

        // 规则2：每日抽奖次数限制
        if (countService.todayCount(userId) >= 5) {
            return LotteryResult.reject("超过每日限制");
        }

        // 规则3：付费用户加权（直接写死在这里）
        int weight = 1;
        if (user.isVip()) {
            weight = 3;
        }

        // 规则4：新用户保底中奖
        if (user.isNewUser()) {
            return drawWithGuarantee(userId);
        }

        // 核心抽奖逻辑被淹没在各种 if-else 中
        return doDraw(userId, weight);
    }
}
```

### 硬编码的五大危害

| 危害 | 具体说明 |
|------|---------|
| **违反开闭原则** | 新增/修改任何规则都需要改动 `LotteryService`，回归测试范围大 |
| **代码膨胀** | 规则越多 if-else 越长，一个方法可能膨胀到几百行，可读性急剧下降 |
| **测试困难** | 规则逻辑混在业务流程中，无法对单条规则做隔离单元测试 |
| **团队协作冲突** | 多人同时修改同一个大类，频繁 Merge Conflict |
| **上线风险高** | 改一条规则 = 改核心代码 = 全量回归 = 发版风险，牵一发动全身 |

### 开闭原则（Open-Closed Principle, OCP）

> 软件实体（类、模块、函数）应该**对扩展开放，对修改封闭**。

即：新增功能时应该通过**新增代码**实现，而不是**修改已有代码**。硬编码方式每加一条规则就要修改 `LotteryService`，完全违反这一原则。

## 三、责任链 + 组合模式的重构方案

### 设计思路

```
抽奖请求 → [规则责任链] → 核心抽奖引擎
              ↓
        ┌─────┼─────┐
    BlackList → DailyLimit → VipWeight → ...
    (每条规则可放行、拒绝或修改上下文)
```

- **责任链模式**：将每条规则封装为独立的 Handler，按链式顺序依次执行，每条规则决定放行、终止或修改上下文。
- **组合模式**：将所有规则统一抽象为 `IRule` 接口，调用方不需要知道具体有多少条规则、是什么规则。

### ✅ 正面代码——完整重构

**Step 1：定义规则抽象接口**

```java
/**
 * 抽奖规则统一接口——所有规则实现此接口
 */
public interface IRule {

    /**
     * 执行规则校验/处理
     * @param context 抽奖上下文（包含用户信息、权重等）
     * @return true = 继续下一条规则, false = 终止责任链
     */
    boolean execute(LotteryContext context);
}
```

**Step 2：定义抽奖上下文（规则间数据传递载体）**

```java
public class LotteryContext {
    private Long userId;
    private User user;
    private int weight = 1;              // 默认权重
    private String rejectReason;          // 拒绝原因
    private Map<String, Object> extra = new HashMap<>(); // 扩展字段

    // getter / setter omitted ...
}
```

**Step 3：实现各规则（每条规则一个类，完全解耦）**

```java
// 规则1：黑名单校验
@Component
@Order(10)
public class BlackListRule implements IRule {
    @Autowired
    private BlackListService blackListService;

    @Override
    public boolean execute(LotteryContext ctx) {
        if (blackListService.isBlack(ctx.getUserId())) {
            ctx.setRejectReason("黑名单用户");
            return false; // 终止责任链
        }
        return true;
    }
}

// 规则2：每日次数限制
@Component
@Order(20)
public class DailyLimitRule implements IRule {
    @Autowired
    private CountService countService;

    @Override
    public boolean execute(LotteryContext ctx) {
        if (countService.todayCount(ctx.getUserId()) >= 5) {
            ctx.setRejectReason("超过每日抽奖限制");
            return false;
        }
        return true;
    }
}

// 规则3：付费用户加权
@Component
@Order(30)
public class VipWeightRule implements IRule {
    @Override
    public boolean execute(LotteryContext ctx) {
        if (ctx.getUser().isVip()) {
            ctx.setWeight(ctx.getWeight() + 2); // 付费用户额外+2权重
        }
        return true; // 继续执行下一条
    }
}
```

**Step 4：责任链编排器（Spring 自动收集所有 IRule 实现）**

```java
@Component
public class RuleChainExecutor {

    private final List<IRule> rules;

    // Spring 自动将容器中所有 IRule 实现类注入 List，并按 @Order 排序
    public RuleChainExecutor(List<IRule> rules) {
        this.rules = rules;
    }

    public boolean process(LotteryContext ctx) {
        for (IRule rule : rules) {
            if (!rule.execute(ctx)) {
                return false; // 某条规则终止了链
            }
        }
        return true;
    }
}
```

**Step 5：抽奖服务（重构后——清爽无比）**

```java
// ✅ 重构后：核心流程与规则完全解耦
@Service
public class LotteryService {

    @Autowired
    private RuleChainExecutor ruleChainExecutor;

    public LotteryResult draw(Long userId) {
        // 1. 构建上下文
        LotteryContext ctx = new LotteryContext();
        ctx.setUserId(userId);
        ctx.setUser(userService.getById(userId));

        // 2. 规则链校验
        if (!ruleChainExecutor.process(ctx)) {
            return LotteryResult.reject(ctx.getRejectReason());
        }

        // 3. 核心抽奖逻辑——干净清爽，只关注抽奖本身
        return lotteryEngine.draw(ctx.getUserId(), ctx.getWeight());
    }
}
```

## 四、前后对比总结

| 维度 | 硬编码方式 ❌ | 责任链方式 ✅ |
|------|------------|-------------|
| **新增规则** | 修改 `LotteryService`，加 if-else | 新增一个 `IRule` 实现类，零修改已有代码 |
| **修改规则** | 改核心代码，全量回归测试 | 只改对应规则类，影响范围可控 |
| **单元测试** | 难以隔离测试单条规则 | 每条规则独立单元测试，Mock 即可 |
| **代码可读性** | 几百行 if-else 混杂 | `LotteryService` 只有核心流程 |
| **团队协作** | 频繁 Merge Conflict | 各自开发自己的规则类，互不干扰 |
| **规则顺序调整** | 需要重排 if-else 代码 | 改 `@Order` 注解值即可 |

## 五、面试加分点

1. **何时不该用规则引擎**：当规则只有 1\~2 条且几乎不会变动时，简单 if-else 更合理，避免过度设计（YAGNI 原则）。架构选择要看 ROI。
2. **进一步配置化**：规则参数（如 VIP 权重值从 3 改为 5）可以通过 Drools / Aviator 表达式引擎或 Apollo/Nacos 配置中心实现动态化，运营人员配置页面直接修改，**无需发版**。
3. **规则可观测性**：每条规则的执行结果记录日志/埋点，便于排查"为什么某用户没中奖"的线上问题，也方便做规则命中率分析。
4. **安全失败策略**：规则执行抛异常时应有兜底——默认拒绝（安全优先）还是默认放行（可用性优先），取决于业务场景。抽奖类建议默认拒绝。
