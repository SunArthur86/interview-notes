---
id: note-dd-re-002
difficulty: L4
category: system-design
subcategory: 微服务
tags:
- 滴滴
- 面经
- 规则引擎
- 责任链模式
- 组合模式
feynman:
  essence: 责任链模式下新增规则只需实现接口并注册到链上，完全不改动已有代码。
  analogy: 就像流水线加一道工序——新工序只需接到流水线末端或中间，其他工序完全不变。
  first_principle: 责任链模式：将请求沿着处理者链传递，每个处理者决定处理或传递给下一个。
  key_points:
  - 实现IRule接口
  - 注册到责任链
  - Spring自动注入
  - 配置化顺序
first_principle:
  essence: 多态+链表 = 可扩展的处理流水线
  derivation: 抽象接口IRule→各规则实现→Chain持有List→新增规则=新增实现类→注册到Chain
  conclusion: 责任链模式让规则新增变成O(1)成本
follow_up:
- 责任链的顺序怎么控制？
- Spring的@Order能实现自动排序吗？
- 责任链中途能不能终止？
memory_points:
- 核心机制：利用Spring将所有规则Bean注入List<IRule>，实现自动构建责任链。
- 接入步骤：新规则只需实现IRule接口，加@Component和@Order注解即可自动接入。
- 设计原则：零改老代码完美践行开闭原则；拦截型规则@Order小排前，增强型规则排后。
---

# 【滴滴面经】你前面提到用责任链和组合模式做规则引擎，那新增的付费用户加权规则怎么接入原来的规则链？

## 一、直接回答

在责任链 + 组合模式的规则引擎架构下，新增"付费用户加权"规则只需三步：

1. **实现 `IRule` 接口**——编写规则逻辑
2. **加 `@Component` 注解**——Spring 自动注册到规则链
3. **加 `@Order` 注解**——控制执行顺序

**全程零修改任何已有代码**，完美践行开闭原则（OCP）。这就是责任链模式让规则新增变成 O(1) 成本的核心价值。

## 二、完整架构回顾

```
LotteryController → LotteryService → RuleChainExecutor
                                           │
                                    List<IRule>（Spring自动注入）
                                   ┌────────┼────────┐
                              BlackList  DailyLimit  VipWeight(新增)
                              @Order(10) @Order(20)  @Order(30)
```

核心机制：`RuleChainExecutor` 持有一个 `List<IRule>`，Spring 启动时自动收集容器中所有 `IRule` 实现类并按 `@Order` 排序后注入。新增规则类 = 自动加入链。

## 三、IRule 接口定义

```java
/**
 * 抽奖规则统一接口
 */
public interface IRule {

    /**
     * 执行规则校验或处理
     * @param context 抽奖上下文（贯穿整条责任链）
     * @return true = 继续下一条规则, false = 终止责任链
     */
    boolean execute(LotteryContext context);
}
```

## 四、Spring 自动注册机制详解

### RuleChainExecutor 核心实现

```java
@Component
public class RuleChainExecutor {

    private final List<IRule> rules;

    /**
     * 构造器注入 List<IRule>
     * Spring 启动时自动收集容器中所有 IRule 实现类的 Bean，
     * 组成 List 并按 @Order 注解值从小到大排序后注入。
     */
    public RuleChainExecutor(List<IRule> rules) {
        this.rules = rules;
    }

    /**
     * 依次执行每条规则
     * 任一规则返回 false 即终止整条链
     */
    public boolean process(LotteryContext ctx) {
        for (IRule rule : rules) {
            if (!rule.execute(ctx)) {
                return false;
            }
        }
        return true;
    }
}
```

### 为什么 `List<IRule>` 能自动注入？

Spring 4.0+ 支持将同类型（或同接口）的多个 Bean 自动注入到 `List` 或 `Map` 中：

- **`List<IRule>`** → 收集所有 `IRule` 实现类，组成有序 List
- **`Map<String, IRule>`** → Key 为 Bean 名称，Value 为 Bean 实例

配合 `@Order` 注解，Spring 会在注入 List 时自动按 Order 值排序，无需手动编排。

### @Order 控制执行顺序

```java
@Component
@Order(10)  // 数值越小，优先级越高，越先执行
public class BlackListRule implements IRule { ... }

@Component
@Order(20)
public class DailyLimitRule implements IRule { ... }

// ✨ 新增的规则
@Component
@Order(30)
public class VipWeightRule implements IRule { ... }
```

**执行顺序**：`BlackListRule(10)` → `DailyLimitRule(20)` → `VipWeightRule(30)`

> **设计原则**：黑名单等"拦截型"规则应排在前面（Order 值小），尽早终止无效请求；加权等"增强型"规则排在后面，只有通过所有校验后才生效，避免对被拦截的用户做无意义的加权计算。

## 五、新增付费用户加权规则——完整实现

### Step 1：抽奖上下文（已有，无需修改）

```java
public class LotteryContext {
    private Long userId;
    private User user;
    private int weight = 1;       // 默认权重
    private String rejectReason;   // 拒绝原因

    // getter / setter omitted
}
```

### Step 2：VIP 等级枚举（可配置化设计）

```java
public enum VipLevel {
    MONTHLY(2,  "月度会员"),
    YEARLY(3,   "年度会员"),
    SUPER(5,    "超级会员");

    private final int weightMultiplier;
    private final String desc;

    VipLevel(int weightMultiplier, String desc) {
        this.weightMultiplier = weightMultiplier;
        this.desc = desc;
    }

    public int getWeightMultiplier() { return weightMultiplier; }
    public String getDesc()          { return desc; }
}
```

### Step 3：实现付费用户加权规则（✨ 唯一需要新增的代码）

```java
/**
 * 付费用户加权规则
 * - 普通用户：权重 1（不变）
 * - 月度会员：权重 × 2
 * - 年度会员：权重 × 3
 * - 超级会员：权重 × 5
 */
@Component
@Order(30)
public class VipWeightRule implements IRule {

    @Override
    public boolean execute(LotteryContext ctx) {
        User user = ctx.getUser();
        if (user == null) {
            return true; // 无用户信息则跳过，不阻断链
        }

        VipLevel vipLevel = user.getVipLevel();
        if (vipLevel != null) {
            int multiplier = vipLevel.getWeightMultiplier();
            ctx.setWeight(ctx.getWeight() * multiplier);
        }

        return true; // 继续执行下一条规则
    }
}
```

### Step 4：已有代码——完全不需要修改

```java
// LotteryService —— 完全不变！
@Service
public class LotteryService {
    @Autowired
    private RuleChainExecutor ruleChainExecutor;

    public LotteryResult draw(Long userId) {
        LotteryContext ctx = new LotteryContext(userId, userService.getById(userId));

        if (!ruleChainExecutor.process(ctx)) {
            return LotteryResult.reject(ctx.getRejectReason());
        }

        return lotteryEngine.draw(ctx.getUserId(), ctx.getWeight());
    }
}

// RuleChainExecutor —— 完全不变！
// Spring 启动时自动发现 VipWeightRule，注入到 List<IRule> 中
```

**整个过程：零修改已有代码，只新增一个类 + 一个枚举。** 这就是开闭原则的最佳实践。

## 六、高级进阶

### 6.1 配置化权重值（不写死数字）

```java
@Component
@Order(30)
public class VipWeightRule implements IRule {

    @Value("${lottery.vip.monthly.multiplier:2}")
    private int monthlyMultiplier;

    @Value("${lottery.vip.yearly.multiplier:3}")
    private int yearlyMultiplier;

    @Value("${lottery.vip.super.multiplier:5}")
    private int superMultiplier;

    @Override
    public boolean execute(LotteryContext ctx) {
        VipLevel level = ctx.getUser().getVipLevel();
        int multiplier = switch (level) {
            case MONTHLY -> monthlyMultiplier;
            case YEARLY  -> yearlyMultiplier;
            case SUPER   -> superMultiplier;
            case null    -> 1;
        };
        ctx.setWeight(ctx.getWeight() * multiplier);
        return true;
    }
}
```

配合 **Apollo / Nacos** 配置中心，运营人员可以在不发版的情况下动态调整权重倍数（比如大促期间临时把超级会员权重从 5 调到 10）。

### 6.2 动态启用/禁用规则

```java
@Component
@Order(30)
@ConditionalOnProperty(
    name = "lottery.rule.vip-weight.enabled",
    havingValue = "true",
    matchIfMissing = true  // 默认启用
)
public class VipWeightRule implements IRule {
    // ...
}
// 配置 lottery.rule.vip-weight.enabled=false 即可一键下线此规则，不发版
```

### 6.3 规则执行日志（可观测性）

抽取公共模板类，统一记录每条规则的执行耗时和结果：

```java
@Slf4j
public abstract class AbstractRule implements IRule {

    @Override
    public boolean execute(LotteryContext ctx) {
        long start = System.currentTimeMillis();
        String ruleName = this.getClass().getSimpleName();
        try {
            boolean result = doExecute(ctx);
            log.info("规则[{}]执行完成 | result={} | cost={}ms | userId={}",
                ruleName, result, System.currentTimeMillis() - start, ctx.getUserId());
            return result;
        } catch (Exception e) {
            log.error("规则[{}]执行异常 | userId={}", ruleName, ctx.getUserId(), e);
            return false; // 安全失败：异常时终止链，防止问题扩散
        }
    }

    /** 子类实现具体规则逻辑 */
    protected abstract boolean doExecute(LotteryContext ctx);
}

// 各规则继承 AbstractRule，只关注业务逻辑，日志/异常处理由父类统一兜底
@Component
@Order(30)
public class VipWeightRule extends AbstractRule {
    @Override
    protected boolean doExecute(LotteryContext ctx) {
        // 纯业务逻辑，无需关心日志和异常处理
        VipLevel level = ctx.getUser().getVipLevel();
        if (level != null) {
            ctx.setWeight(ctx.getWeight() * level.getWeightMultiplier());
        }
        return true;
    }
}
```

## 七、责任链 vs 策略模式的选择

| 维度 | 责任链模式 | 策略模式 |
|------|----------|---------|
| **执行方式** | 多条规则**依次执行**，每条都可修改上下文 | 多种策略**只选一种**执行 |
| **是否可中断** | 可以，某条规则返回 false 即终止 | 不涉及中断，只做选择 |
| **典型场景** | 规则校验链、风控审批链、过滤器链 | 支付方式选择、排序算法选择、登录方式 |
| **本题适用性** | ✅ 多条规则叠加（黑名单 + 限流 + 加权） | ❌ 规则之间不是互斥选择关系 |

## 八、面试加分点

1. **`@Order` vs `@Priority`**：Spring 中两者功能类似，但 `@Order` 更常用。注意 `@Order` 只影响同类型 Bean 在 `List` / 数组中的排序，不影响 `@Autowired` 单 Bean 注入。
2. **规则间隐式依赖**：如果规则 B 依赖规则 A 先执行（如加权规则需要等级计算先完成），需确保 `@Order` 值正确，或在规则设计上显式声明依赖。
3. **并行优化**：对于无依赖关系的校验规则（如黑名单校验和频率限制互不影响），可以用 `CompletableFuture` 并行执行以降低链路延迟。但要注意 `LotteryContext` 的线程安全问题。
4. **回答 follow-up "责任链中途能不能终止"**：能。当前实现中任一规则返回 `false` 即终止。也可以设计更灵活的终止策略：`ABORT`（终止）、`CONTINUE`（继续）、`SKIP\_REMAINING`（跳过剩余规则但视为通过）三态返回值。

## 记忆要点

- 核心机制：利用Spring将所有规则Bean注入List<IRule>，实现自动构建责任链。
- 接入步骤：新规则只需实现IRule接口，加@Component和@Order注解即可自动接入。
- 设计原则：零改老代码完美践行开闭原则；拦截型规则@Order小排前，增强型规则排后。


## 苏格拉底式面试追问

> 这组追问模拟面试官层层逼问，每一问先回答"为什么"，再回答"怎么做"，最后回答"如何证明"。

### 第一层：目标与动机

**Q：新增规则你说"实现 IRule 接口 + @Component 注册"就行了，为什么 Spring 能自动把规则串成链？**

因为 Spring 的集合注入特性。当定义 `@Autowired List<IRule> rules` 时，Spring 会把容器里所有 IRule 类型的 Bean 收集到这个 List 里。每个规则类标了 `@Component`，Spring 启动时扫描注册，自动聚合成链。这是依赖注入的"批量收集"能力，不用手动 new 和组装。配合 `@Order` 注解，Spring 还会按 order 值排序 List，实现规则的顺序控制。决策依据：用 Spring 的 DI 能力零代码组装链路，比手动维护 List 更可靠。

### 第二层：证据与定位

**Q：新增的 VIP 规则加了 @Component，但启动后责任链里没它，怎么定位？**

查三段：
1. 包扫描路径——`@ComponentScan` 的路径是否覆盖新规则所在的包。如果规则类在 `com.xxx.promotion.rule` 但启动类的扫描路径是 `com.xxx.core`，扫不到。
2. 条件注解——规则类是否有 `@ConditionalOnProperty` 等条件注解，配置项没满足导致 Bean 不创建。
3. Bean 冲突——如果有两个同名 Bean（都叫 vipRule），Spring 可能覆盖或启动失败。看启动日志的 Bean 注册记录，搜规则类名确认是否注册成功。

### 第三层：根因深挖

**Q：规则注册成功了，但执行顺序不对（VIP 规则跑在黑名单前面），根因是什么？**

最可能是 `@Order` 的值配错或没理解排序规则。`@Order` 值越小优先级越高（越靠前）。如果 VIP 规则标了 `@Order(10)`、黑名单标了 `@Order(5)`，那黑名单在前、VIP 在后（正确）。如果开发者误以为"值大在前"，把 VIP 配成 `@Order(100)`，就排到最后了。另一种根因是用了 `@Order` 和 `Ordered` 接口混用，或者 Spring 版本的 `@Order` 对 `List` 注入的排序行为不一致（某些场景需要 `AnnotationAwareOrderComparator`）。要看规则链实际顺序（启动时打印 List 内容）和 @Order 值。

**Q：为什么不直接用责任链框架（如 Apache Commons Chain）而要自己用 Spring 的 List 注入实现？**

因为 Spring List 注入已经够用且更轻量。Apache Commons Chain 是独立框架，要引入依赖、学它的 Command/Context 模型，但核心能力和"List<IRule> + 循环调用"一样。Spring 方案的好处是：① 零额外依赖；② 与 Spring 生态无缝（事务、AOP、配置都可用）；③ 团队都懂 Spring 注解，学习成本零。Apache Commons Chain 适合"非 Spring 环境或需要复杂的责任链特性（如回滚、事务）"，抽奖场景用 Spring 原生能力最简洁。

### 第四层：方案权衡

**Q：责任链中途能终止吗（比如黑名单命中后不再执行后续规则）？怎么设计？**

可以，在 IRule 接口定义返回值控制：
1. 返回 boolean 或枚举（CONTINUE/BREAK）——`boolean apply(Context ctx)` 返回 false 表示终止链，后续规则不执行。
2. 或用 Context 的 `stopped` 标志——规则设置 `ctx.setStopped(true)`，链的循环判断这个标志决定是否继续。

权衡点：终止型规则（黑名单、风控拦截）用"返回 false 终止"，增强型规则（VIP 加权、新用户保底）用"返回 true 继续"。这是责任链模式的标准能力，Spring 的 List 注入配合 for 循环 + break 即可实现。如果用 Java 的 `Predicate` 链（`Predicate.and()`），默认是短路求值，也支持终止。

**Q：为什么不把所有规则都设计成"不终止"（全部执行后聚合结果），避免终止逻辑的复杂度？**

因为安全类规则必须短路。黑名单用户命中后，继续执行 VIP 加权、新用户保底等规则是浪费计算，而且可能产生矛盾结果（黑名单说要拦截，VIP 说要加权，聚合时怎么办）。短路让安全规则有"一票否决权"，逻辑清晰。全部执行后聚合适合"增强型规则互不冲突"的场景（多个加权规则叠加），但安全 + 增强混合的场景必须有终止能力。简单场景可以不终止，复杂场景必须支持，接口设计预留这个能力。

### 第五层：验证与沉淀

**Q：你怎么证明新规则接入责任链后，对老规则没有影响？**

回归验证：
1. 单元测试——每个规则有独立单测（给定输入验证输出）。新增规则后跑全量单测，老规则的行为不变。
2. 链路集成测试——构造测试用例（不同用户画像），跑完整责任链，对比接入前后的输出。只有"新规则影响的场景"输出变化，其他场景不变。
3. 规则执行日志——线上抽奖时打印规则链的执行 trace，每个规则的输入输出，出问题可追溯。

**Q：责任链规则引擎怎么沉淀？**

1. IRule 接口标准化——定义统一的 `boolean apply(RuleContext ctx)` 接口，规则链的循环逻辑封装在框架层，业务只实现接口。
2. 规则模板——提供"拦截型规则""增强型规则""过滤型规则"的抽象基类，新规则继承基类减少样板代码。
3. 规则执行监控——每条规则的执行耗时、命中率、异常率纳入监控，慢规则（> 10ms）或异常规则自动告警，支持动态摘除。


## 结构化回答

**30 秒电梯演讲：** 责任链模式下新增规则只需实现接口并注册到链上，完全不改动已有代码。打个比方，就像流水线加一道工序——新工序只需接到流水线末端或中间，其他工序完全不变。

**展开框架：**
1. **核心机制** — 利用Spring将所有规则Bean注入List<IRule>，实现自动构建责任链。
2. **接入步骤** — 新规则只需实现IRule接口，加@Component和@Order注解即可自动接入。
3. **设计原则** — 零改老代码完美践行开闭原则；拦截型规则@Order小排前，增强型规则排后。

**收尾：** 这块我踩过坑——要不要深入聊：责任链的顺序怎么控制？

## 视频脚本

> 预计时长：4 分钟 | 由浅入深

| 时间 | 画面/字幕 | 口播台词 | 讲解要点 |
|------|----------|----------|----------|
| 0:00 | 标题卡 | "微服务一句话：责任链模式下新增规则只需实现接口并注册到链上，完全不改动已有代码。" | 开场钩子 |
| 0:15 | Spring Bean 生命周期图 | "核心机制：利用Spring将所有规则Bean注入List<IRule>，实现自动构建责任链。" | 核心机制 |
| 1:08 | Spring Bean 生命周期图分步演示 | "接入步骤：新规则只需实现IRule接口，加@Component和@Order注解即可自动接入。" | 接入步骤 |
| 2:01 | 关键代码/伪代码片段 | "设计原则：零改老代码完美践行开闭原则；拦截型规则@Order小排前，增强型规则排后。" | 设计原则 |
| 2:54 | 对比表格 | "实现IRule接口" | 实现IRule接口 |
| 3:50 | 总结卡 | "核心抓住这条主线，下期咱们接着聊：责任链的顺序怎么控制。" | 收尾 |
