---
id: note-dd-re-003
difficulty: L4
category: system-design
subcategory: 微服务
tags:
- 滴滴
- 面经
- 规则引擎
- 设计模式
- 架构设计
feynman:
  essence: 线性责任链在规则过多时会退化，需要引入分组、优先级、短路评估等策略。
  analogy: 就像公司管理层级——3个人可以直接汇报，但30个人就需要分组、设优先级。
  first_principle: 系统复杂度管理 = 分组 + 分层 + 分治。
  key_points:
  - 规则分组管理
  - 优先级队列
  - 策略模式替代线性链
  - 规则树（AST）
first_principle:
  essence: 复杂度守恒定律：问题不会消失只会转移
  derivation: 规则增多→线性链维护困难→分组+优先级+分类→用组合模式构建规则树
  conclusion: 规则超过10个时应从责任链升级为规则树或策略模式
follow_up:
- 规则树和决策树有什么区别？
- Drools规则引擎了解吗？
- 如何可视化规则之间的依赖关系？
---

# 【滴滴面经】如果后面不是加一个规则，而是连续加十几个规则，会不会越来越乱？

## 一、问题的本质：线性责任链的退化

面试中被问到这个问题，面试官其实是在考察你对**复杂度治理**的认知。当一个系统中规则从 3 个增长到 15 个甚至更多时，最朴素的写法——线性责任链或 `if-else` 瀑布——会出现以下退化：

| 维度 | 3-5 个规则 | 15+ 个规则 |
|------|-----------|------------|
| 可读性 | 一眼看懂 | 需要滚动多屏才能理解全貌 |
| 维护成本 | 加一个类就行 | 改一条规则可能影响后续链路 |
| 执行效率 | 全量执行也快 | 大量无效匹配浪费 CPU |
| 可测试性 | 单元测试简单 | 规则之间存在隐式依赖，难以隔离测试 |
| 可配置性 | 硬编码尚可 | 必须动态配置否则每次改代码都需发版 |

**核心结论：规则超过 10 个时，必须从线性结构升级为树/分组结构。** 这不是一个选择题，而是一个工程必然。

## 二、架构演进路径：从链到树

### 2.1 规则树架构图

```
                    ┌──────────────────────────────────────────────────┐
                    │              RuleEngine 入口                      │
                    │   接收RuleContext，返回RuleResult                  │
                    └──────────────────────┬───────────────────────────┘
                                           │
                    ┌──────────────────────▼───────────────────────────┐
                    │           RuleGroupRouter（分组路由）              │
                    │   按 category(风控/营销/准入) 路由到不同规则组      │
                    └──────┬───────────────┬───────────────┬───────────┘
                           │               │               │
              ┌────────────▼──┐  ┌─────────▼──────┐  ┌────▼──────────┐
              │ RiskGroup     │  │ MarketingGroup │  │ AccessGroup   │
              │ 优先级: HIGH   │  │ 优先级: MEDIUM  │  │ 优先级: LOW    │
              │ 短路策略:      │  │ 聚合策略:       │  │ 短路策略:      │
              │  命中即返回    │  │  多规则加权     │  │  全部通过才放行│
              └──────┬────────┘  └────────┬───────┘  └──────┬────────┘
                     │                    │                  │
          ┌──────────┼──────────┐        ┌┼┐          ┌─────┼─────┐
      ┌───▼──┐  ┌───▼──┐  ┌───▼──┐  ┌───▼▼▼──┐    ┌───▼──┐ ┌───▼──┐
      │黑名单 │  │频次  │  │设备  │  │VIP     │    │年龄  │ │信用  │
      │规则  │  │规则  │  │规则  │  │规则    │    │规则  │ │规则  │
      └──────┘  └──────┘  └──────┘  │优惠券  │    └──────┘ └──────┘
                                    │规则    │
                                    └────────┘
```

每个规则组内部维护一个**优先级队列**，组与组之间通过**策略模式**决定执行顺序和短路逻辑。

### 2.2 核心代码实现

```java
/**
 * 规则上下文 —— 所有规则的输入
 */
@Data
@Builder
public class RuleContext {
    private String userId;
    private BigDecimal amount;
    private String deviceId;
    private String ip;
    private int userAge;
    private Map<String, Object> extData;
}

/**
 * 规则结果
 */
@Data
@Builder
public class RuleResult {
    private boolean hit;           // 是否命中
    private String ruleName;       // 命中的规则名
    private String action;         // 动作：BLOCK / PASS / TAG
    private int priority;          // 优先级
    private String reason;         // 命中原因
}

/**
 * 规则抽象 —— 单条规则的最小单元
 */
public interface Rule {
    RuleResult evaluate(RuleContext ctx);
    int getPriority();
    String getGroup();
    default String getName() { return this.getClass().getSimpleName(); }
}

/**
 * 规则组 —— 一组规则的容器，内部定义执行策略
 */
public abstract class RuleGroup {

    private final List<Rule> rules;

    protected RuleGroup(List<Rule> rules) {
        this.rules = rules.stream()
                .sorted(Comparator.comparingInt(Rule::getPriority).reversed())
                .collect(Collectors.toList());
    }

    public abstract List<RuleResult> execute(RuleContext ctx);

    protected List<Rule> getRules() { return rules; }
}

/**
 * 短路型规则组 —— 命中任意一条就返回（适合风控场景）
 */
public class ShortCircuitRuleGroup extends RuleGroup {

    public ShortCircuitRuleGroup(List<Rule> rules) { super(rules); }

    @Override
    public List<RuleResult> execute(RuleContext ctx) {
        for (Rule rule : getRules()) {           // 按优先级从高到低
            RuleResult result = rule.evaluate(ctx);
            if (result.isHit()) {
                return List.of(result);           // 短路：立即返回
            }
        }
        return Collections.emptyList();
    }
}

/**
 * 聚合型规则组 —— 所有规则都执行，汇总结果（适合营销场景）
 */
public class AggregationRuleGroup extends RuleGroup {

    public AggregationRuleGroup(List<Rule> rules) { super(rules); }

    @Override
    public List<RuleResult> execute(RuleContext ctx) {
        List<RuleResult> results = new ArrayList<>();
        for (Rule rule : getRules()) {
            results.add(rule.evaluate(ctx));     // 不短路，全部执行
        }
        return results;
    }
}
```

### 2.3 规则引擎入口：策略模式路由

```java
@Component
public class RuleEngine {

    private final Map<String, RuleGroup> groupMap;

    // Spring 自动注入所有 RuleGroup 实现
    public RuleEngine(List<RuleGroup> groups) {
        this.groupMap = groups.stream()
                .collect(Collectors.toMap(g -> g.getClass().getSimpleName(), g -> g));
    }

    /**
     * 按组执行：先执行风控组（短路），再执行营销组（聚合）
     */
    public EngineResult evaluate(RuleContext ctx) {
        // 第一层：风控规则（短路型，一票否决）
        List<RuleResult> riskResults = groupMap.get("RiskGroup").execute(ctx);
        if (riskResults.stream().anyMatch(r -> "BLOCK".equals(r.getAction()))) {
            return EngineResult.block(riskResults);   // 风控拦截，直接返回
        }

        // 第二层：准入规则（短路型，全部通过才放行）
        List<RuleResult> accessResults = groupMap.get("AccessGroup").execute(ctx);

        // 第三层：营销规则（聚合型，收集所有命中）
        List<RuleResult> marketingResults = groupMap.get("MarketingGroup").execute(ctx);

        return EngineResult.pass(riskResults, accessResults, marketingResults);
    }
}
```

## 三、为什么用规则树而不是线性链

### 3.1 规则树 vs 线性责任链

| 维度 | 线性责任链 | 规则树（分组+优先级） |
|------|-----------|---------------------|
| 时间复杂度 | O(n)，必须遍历所有节点 | O(log n)，分组路由快速定位 |
| 短路能力 | 链路中途可中断 | 分组级别短路 + 组内短路，双重优化 |
| 可维护性 | 改一条规则需理解全链路 | 改一组规则只需理解组内逻辑 |
| 可扩展性 | 新增规则插入位置敏感 | 新增规则归入对应组即可 |
| 规则独立性 | 规则之间隐式耦合 | 规则与组弱耦合，可独立测试 |

### 3.2 规则树 vs 决策树

面试追问「规则树和决策树有什么区别」时，可以这样回答：

- **决策树（Decision Tree）**：是 ML 算法或 `if-else` 二叉结构，节点是条件判断，叶子是结论。一次请求只走一条路径，路径互斥。
- **规则树（Rule Tree / AST）**：是规则的组合结构，节点可以是规则、规则组或逻辑组合（AND/OR/NOT）。多条路径可以同时命中，需要冲突解决。

规则树更接近 **AST（抽象语法树）**，可以表达任意复杂的逻辑组合：

```
    AND                        // 根节点：逻辑组合
   /   \
  OR    NOT                    // 中间节点：逻辑操作符
 / \    |
R1 R2  R3                      // 叶子节点：具体规则
```

```java
/** AST 节点：逻辑组合节点 */
public class CompositeRule implements Rule {

    private final List<Rule> children;
    private final LogicOperator operator;  // AND / OR / NOT

    @Override
    public RuleResult evaluate(RuleContext ctx) {
        return switch (operator) {
            case AND -> children.stream().allMatch(r -> r.evaluate(ctx).isHit())
                    ? RuleResult.hit("AND全部命中")
                    : RuleResult.miss("AND未全部命中");
            case OR  -> children.stream().anyMatch(r -> r.evaluate(ctx).isHit())
                    ? RuleResult.hit("OR部分命中")
                    : RuleResult.miss("OR全部未命中");
            case NOT -> !children.get(0).evaluate(ctx).isHit()
                    ? RuleResult.hit("NOT取反命中")
                    : RuleResult.miss("NOT取反未命中");
        };
    }
}
```

## 四、与 Drools 规则引擎的对比

面试官很可能追问「Drools 了解吗」。Drools 是业界最成熟的规则引擎之一，使用 **DRL（Drools Rule Language）** 和 **RETE 算法**：

```drl
// Drools DRL 示例
rule "Blacklist Block"
    salience 100                    // 优先级
    when
        $ctx : RuleContext(blacklisted == true)
    then
        $ctx.setAction("BLOCK");
end
```

| 维度 | 自研规则树 | Drools |
|------|-----------|--------|
| 适用规模 | 10-50 条规则 | 数百至数万条规则 |
| 学习成本 | 低（Java 代码，团队熟悉） | 高（DRL 语法 + RETE 理论） |
| 性能调优 | 直观可控 | RETE 网络复杂，需经验 |
| 灵活性 | 中等（需自己实现 DSL） | 高（内置 DSL + 决策表） |
| 运维成本 | 低 | 中高（依赖重，版本升级风险） |
| 动态配置 | 需自研 | 内置 KieSession 热加载 |

**选型建议**：规则量 < 50 且团队 Java 能力强 → 自研规则树；规则量 > 100 或需要业务方自己配置 → Drools 或 Aviator/QLExpress 等轻量表达式引擎。

## 五、面试加分点

### 5.1 规则依赖可视化

> 「如何可视化规则之间的依赖关系？」

可以将规则树序列化为 **DAG（有向无环图）**，用 Mermaid 或 Graphviz 可视化：

```java
public String toDotGraph() {
    StringBuilder sb = new StringBuilder("digraph RuleTree {\n");
    sb.append("  rankdir=TB;\n");
    sb.append("  Engine [shape=box, style=filled, color=lightblue];\n");
    for (RuleGroup group : groupMap.values()) {
        sb.append(String.format("  Engine -> %s;\n", group.getClass().getSimpleName()));
        for (Rule rule : group.getRules()) {
            sb.append(String.format("  %s -> %s;\n",
                    group.getClass().getSimpleName(), rule.getName()));
        }
    }
    sb.append("}");
    return sb.toString();
}
```

### 5.2 规则数量治理的量化指标

- **规则覆盖率**：每条规则在一定时间内的命中率。命中率 < 0.01% 的规则应评估是否删除。
- **规则冲突率**：同一请求命中互斥规则的比例。持续为正说明优先级定义有漏洞。
- **规则执行耗时 P99**：单条规则从 evaluate 到返回的时间。超过 50ms 的规则需优化。

### 5.3 渐进式演进策略

不要一步到位，而是分三阶段：

1. **阶段一（3-10 个规则）**：责任链 + 优先级注解（`@Order`），代码可控。
2. **阶段二（10-30 个规则）**：分组管理 + 策略模式，引入 RuleGroup 抽象。
3. **阶段三（30+ 个规则）**：DSL 配置化 + 热更新 + 可视化管理台。

## 六、总结回答模板（面试口述版）

> 「会越来越乱，但这是可控的。我的做法是分三步走：
>
> 第一步，**分组**——把十几个规则按业务域分成风控组、营销组、准入组，每组内部用优先级排序。这样把 O(n) 的全量遍历变成了组内遍历，组间可以短路。
>
> 第二步，**策略模式**——不同组有不同的执行策略。风控组用短路型（命中即返回），营销组用聚合型（全部执行加权汇总）。通过接口隔离，新增规则不影响其他组。
>
> 第三步，**AST 组合**——当规则之间有复杂的 AND/OR 逻辑时，用 CompositeRule 组合成树结构，而不是线性链。这样规则之间的依赖关系一目了然。
>
> 如果规则量继续增长到百级别，再考虑引入 Drools 或自研 DSL 配置化方案，实现规则与代码解耦。」
