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
memory_points:
- 结论：绝不能硬编码，因为规则与流程强耦合严重违反开闭原则（OCP）。
- 硬编码痛点：新增规则必改核心代码，导致类膨胀、测试难、发版回归风险极高。
- 重构方案：用责任链+组合模式构建规则引擎，将每条规则封装为独立Handler实现解耦。
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

## 记忆要点

- 结论：绝不能硬编码，因为规则与流程强耦合严重违反开闭原则（OCP）。
- 硬编码痛点：新增规则必改核心代码，导致类膨胀、测试难、发版回归风险极高。
- 重构方案：用责任链+组合模式构建规则引擎，将每条规则封装为独立Handler实现解耦。


## 苏格拉底式面试追问

> 这组追问模拟面试官层层逼问，每一问先回答"为什么"，再回答"怎么做"，最后回答"如何证明"。

### 第一层：目标与动机

**Q：付费用户加权这个规则，你为什么坚持不能硬编码？写个 if (user.isVip) 加权不就完了？**

因为规则会变、会增。今天"付费用户加权"，明天加"新用户保底"，后天加"风控黑名单拦截"。硬编码意味着每条规则都嵌在抽奖主流程里，改一条要动核心代码、全量回归测试、重新发版。更严重的是规则之间会耦合——VIP 加权和黑名单拦截的顺序、互斥关系，硬编码后成一团乱麻。开闭原则（OCP）要求对扩展开放、对修改封闭，规则引擎把每条规则封装成独立 Handler，新增规则只加类不改老代码。决策依据：规则变更频率 > 每月 1 次，就必须解耦。

### 第二层：证据与定位

**Q：有用户投诉"我是付费用户但没加权"，你怎么定位是规则没生效还是规则配置问题？**

查规则执行链路：
1. 规则匹配日志——抽奖时打印每条规则的命中情况（`RuleChainLog: vipBoost rule matched=true, applied=true`），确认 VIP 规则是否被执行。
2. 用户属性——确认用户的 `isVip` 字段是否为 true（可能支付状态延迟未更新，或缓存里的用户信息过期）。
3. 规则顺序——如果黑名单规则在 VIP 规则之前且该用户误入黑名单，VIP 规则会被短路不执行。看规则链的执行顺序日志。

### 第三层：根因深挖

**Q：VIP 规则代码正确、用户确实是 VIP，但规则没生效，根因是什么？**

最可能是规则没注册到责任链。责任链模式通常用 Spring 的 `List<IRule>` 自动注入，如果新的 VIP 规则类忘了加 `@Component` 注解，Spring 扫描不到，规则链里没这个规则，自然不执行。另一种可能是 `@Order` 注解配错——VIP 规则排在某个"终止型规则"（如黑名单）之后，前置规则短路了链路，VIP 规则没机会执行。要看规则链的实际注册列表（启动日志打印）和执行顺序。

**Q：为什么不直接在抽奖主流程里按业务重要性排序写 if-else，加注释说明顺序，不也挺清楚吗？**

因为顺序是隐式的、分散的。if-else 的顺序靠人记，新人接手不知道为什么 VIP 在黑名单之后；改顺序要小心翼翼地移动代码块；新增规则要找合适的位置插入。责任链把顺序显式化——`@Order(1)`、`@Order(2)` 标注清楚，调整顺序只改注解不改代码结构。更重要的是 if-else 无法"动态配置顺序"——如果要按 A/B 测试调整规则顺序，if-else 必须改代码发版，责任链改配置即可。注释是给开发者看的，注解是给框架执行的，本质不同。

### 第四层：方案权衡

**Q：规则就两三条，引入责任链 + 规则引擎是不是过度设计（over-engineering）？**

要看变更频率。如果规则一年都不变，两三条 if-else 确实够用，引入规则引擎是过度设计——增加抽象层但收益不明显。但如果规则会增长（业务确认未来要加风控、A/B 测试、用户分层），即使现在只有 2 条，提前用责任链也是值得的，因为"重构 2 条规则的成本"远低于"重构 10 条纠缠规则的成本"。判断标准：预期半年内规则数是否会超过 5 条，是则提前抽象，否则保持简单。

**Q：为什么不直接用成熟的规则引擎（Drools、EasyRules），而要自己用责任链实现？**

因为 Drools 太重、学习成本高。Drools 用 DRL 语法（类似 SQL + 规则），要学一套 DSL，运维要维护规则库和版本，适合"规则极复杂 + 非开发人员配置规则"的场景（如保险核保）。抽奖场景规则简单（条件 → 加权/拦截），用责任链 + 策略模式几百行代码搞定，团队都能看懂维护。EasyRules 是轻量级，但本质也是封装了责任链。自研的好处是可控、轻量、无额外依赖；坏处是功能有限（不支持规则冲突的复杂裁决）。规则复杂度低时自研，规则复杂度高（数百条、多维度冲突）时上 Drools。

### 第五层：验证与沉淀

**Q：你怎么证明规则引擎化之后，新增规则真的比硬编码快、风险低？**

用数据对比：
1. 开发效率——记录"新增一条规则"的工时。规则引擎化前要改主流程代码 + 全量回归测试 + 发版，约 2 天；引擎化后只加一个 Handler 类 + 单测，约 2 小时。
2. 故障率——统计规则相关的线上 bug 数。硬编码时期改一条规则可能影响其他规则（耦合 bug），引擎化后规则隔离，故障率应下降。
3. 回归测试范围——硬编码改规则要全量回归，引擎化后只测新规则，回归范围缩小。

**Q：规则引擎怎么沉淀成团队基础设施？**

1. 规则引擎 SDK 化——把"IRule 接口 + 责任链 + 自动注册 + 顺序配置"封装成通用 starter，其他业务（风控、营销）引入即用。
2. 规则可视化——开发后台管理界面，运营可视化查看规则链、调整顺序（改 @Order 映射的配置）、启停规则，不用发版。
3. 规则测试框架——提供"输入用户上下文 → 输出规则执行链路"的测试工具，方便验证新规则接入后整个链路的行为符合预期。


## 结构化回答

**30 秒电梯演讲：** 规则硬编码会导致牵一发动全身，必须用设计模式解耦。打个比方，就像装修时把所有电线焊死在墙里——要加一个插座就得砸墙。规则引擎就是可插拔的电线管道。

**展开框架：**
1. **结论** — 绝不能硬编码，因为规则与流程强耦合严重违反开闭原则（OCP）。
2. **硬编码痛点** — 新增规则必改核心代码，导致类膨胀、测试难、发版回归风险极高。
3. **重构方案** — 用责任链+组合模式构建规则引擎，将每条规则封装为独立Handler实现解耦。

**收尾：** 这块我踩过坑——要不要深入聊：什么是开闭原则？

## 视频脚本

> 预计时长：3 分钟 | 由浅入深

| 时间 | 画面/字幕 | 口播台词 | 讲解要点 |
|------|----------|----------|----------|
| 0:00 | 标题卡 | "微服务一句话：规则硬编码会导致牵一发动全身，必须用设计模式解耦。" | 开场钩子 |
| 0:15 | 架构示意图 | "结论：绝不能硬编码，因为规则与流程强耦合严重违反开闭原则（OCP）。" | 结论 |
| 1:06 | 架构示意图分步演示 | "硬编码痛点：新增规则必改核心代码，导致类膨胀、测试难、发版回归风险极高。" | 硬编码痛点 |
| 1:57 | 关键代码/伪代码片段 | "重构方案：用责任链+组合模式构建规则引擎，将每条规则封装为独立Handler实现解耦。" | 重构方案 |
| 2:50 | 总结卡 | "核心抓住这条主线，下期咱们接着聊：什么是开闭原则。" | 收尾 |
