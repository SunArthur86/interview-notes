---
id: note-dd-re-004
difficulty: L4
category: system-design
subcategory: 微服务
tags:
- 滴滴
- 面经
- 规则引擎
- 优先级
- 冲突解决
feynman:
  essence: 规则冲突需要预定义冲突解决策略：优先级短路、权重投票、或者分层裁决。
  analogy: 就像交通规则——红灯和绿灯同时出现时，交警按红灯停的绝对优先级来决定。
  first_principle: 冲突解决 = 优先级定义 + 短路策略 + 兜底规则。
  key_points:
  - 绝对优先级（短路）
  - 权重投票
  - 互斥组
  - 分层裁决
first_principle:
  essence: 冲突处理的本质是决策权分配
  derivation: 多规则冲突→谁说了算？→定义优先级→黑名单=一票否决→VIP=加权
  conclusion: 规则引擎必须预定义冲突解决策略
follow_up:
- 一票否决和权重投票各适合什么场景？
- 两个一票否决规则谁优先？
- 冲突解决策略能动态配置吗？
---

# 【滴滴面经】如果规则之间存在优先级冲突怎么办？比如黑名单和VIP概率提升同时命中。

## 一、问题拆解：冲突的本质

这个问题的核心场景非常具体：一个用户**同时**命中了两条规则——

- **规则A：黑名单规则** → 应该拦截（BLOCK）
- **规则B：VIP概率提升规则** → 应该放行并加权（BOOST）

两者给出的结论是矛盾的：一个说要拦，一个说要放。规则引擎必须决定：**听谁的？**

这就是**规则冲突问题**。冲突解决的本质不是技术问题，而是**业务决策权分配问题**。在工程上，我们需要预定义一套冲突解决策略（Conflict Resolution Policy），让系统在运行时自动裁决。

## 二、四种冲突解决策略

### 2.1 策略总览：决策矩阵

| 策略 | 核心思想 | 适用场景 | 黑名单×VIP案例 | 优点 | 缺点 |
|------|---------|---------|---------------|------|------|
| **一票否决（Veto）** | 高优先级规则拥有绝对否决权 | 风控/安全类 | 黑名单直接拦截，VIP失效 | 安全第一，逻辑简单 | 无法表达"取决于上下文"的柔性需求 |
| **权重投票（Weighted Voting）** | 每条规则一个权重分，加权后取阈值 | 营销/评分类 | 黑名单权重=∞，VIP权重=0.2，总分 < 0 → 拦截 | 灵活，可量化 | 权重值需要持续调优 |
| **互斥组（Mutex Group）** | 同一互斥组内只取优先级最高的一条 | 互斥动作类 | 黑名单和VIP属于同一互斥组，取黑名单 | 干净利落，无歧义 | 需要预先定义互斥关系 |
| **分层裁决（Layered Arbitration）** | 分层执行，上层结果覆盖下层 | 复杂多层场景 | 安全层 > 风控层 > 营销层，安全层拦截后营销层不执行 | 结构清晰，可扩展 | 设计复杂度高 |

### 2.2 黑名单×VIP场景的决策矩阵

| 同时命中的规则组合 | 一票否决 | 权重投票 | 互斥组 | 分层裁决 |
|------------------|---------|---------|--------|---------|
| 黑名单 + VIP | **拦截**（黑名单否决） | 取决于权重设计 | 取黑名单（同组优先级高） | 安全层拦截，营销层不执行 |
| 黑名单 + 优惠券 | **拦截** | 拦截 | 取黑名单 | 拦截 |
| 频次异常 + VIP | **拦截**（安全类否决） | 视权重和阈值 | 不同组，分别处理 | 风控层先处理 |
| 优惠券 + VIP | 都生效 | 加权汇总 | 不同组，分别处理 | 营销层内聚合处理 |

## 三、冲突解决策略代码实现

### 3.1 基础模型定义

```java
/** 规则动作类型 */
public enum ActionType {
    BLOCK,      // 拦截（安全/风控类）
    PASS,       // 放行
    BOOST,      // 加权提升（营销类）
    TAG         // 打标（不影响决策，仅标记）
}

/** 冲突解决策略枚举 */
public enum ConflictPolicy {
    VETO,               // 一票否决
    WEIGHTED_VOTING,    // 权重投票
    MUTEX_GROUP,        // 互斥组
    LAYERED_ARBITRATION // 分层裁决
}

/** 规则定义（带冲突元数据） */
@Data
@Builder
public class RuleDefinition {
    private String ruleId;
    private String name;
    private int priority;               // 优先级，数字越大越优先
    private ActionType action;          // 命中后的动作
    private double weight;              // 权重分（用于投票）
    private String mutexGroup;          // 互斥组名（null表示不互斥）
    private String layer;               // 所在层：SAFETY / RISK / MARKETING
    private boolean vetoPower;          // 是否拥有一票否决权
}

/** 规则命中结果 */
@Data
@Builder
public class RuleHit {
    private RuleDefinition rule;
    private Object payload;             // 命中时的附加数据
}
```

### 3.2 策略一：一票否决（Veto Policy）

```java
/**
 * 一票否决策略
 * 原则：任何拥有 vetoPower=true 的规则命中，且动作为 BLOCK，则直接拦截
 */
public class VetoConflictResolver implements ConflictResolver {

    @Override
    public RuleHit resolve(List<RuleHit> hits) {
        // 找到所有拥有一票否决权且命中的规则
        Optional<RuleHit> vetoHit = hits.stream()
                .filter(h -> h.getRule().isVetoPower())
                .filter(h -> h.getRule().getAction() == ActionType.BLOCK)
                .max(Comparator.comparingInt(h -> h.getRule().getPriority()));

        if (vetoHit.isPresent()) {
            // 一票否决生效，直接返回 BLOCK 结果
            return vetoHit.get();
        }

        // 无否决，取优先级最高的规则
        return hits.stream()
                .max(Comparator.comparingInt(h -> h.getRule().getPriority()))
                .orElse(null);
    }
}
```

**适用场景**：黑名单、设备封禁、高危交易拦截等安全类规则。

### 3.3 策略二：权重投票（Weighted Voting）

```java
/**
 * 权重投票策略
 * 原则：每条规则贡献一个分值（正分=放行/加权，负分=拦截），累加后看正负
 */
public class WeightedVotingResolver implements ConflictResolver {

    private static final double BLOCK_THRESHOLD = 0.0;  // 总分 ≤ 0 则拦截

    @Override
    public RuleHit resolve(List<RuleHit> hits) {
        double totalScore = 0.0;
        RuleHit dominantHit = null;
        double maxAbsWeight = Double.MIN_VALUE;

        for (RuleHit hit : hits) {
            double weight = hit.getRule().getWeight();
            // BLOCK 动作的权重取负
            if (hit.getRule().getAction() == ActionType.BLOCK) {
                weight = -Math.abs(weight);
            }
            totalScore += weight;

            // 记录影响最大的规则（用于日志追溯）
            if (Math.abs(weight) > maxAbsWeight) {
                maxAbsWeight = Math.abs(weight);
                dominantHit = hit;
            }
        }

        // 根据总分决定最终动作
        if (totalScore <= BLOCK_THRESHOLD) {
            return RuleHit.builder()
                    .rule(RuleDefinition.builder()
                            .name("WEIGHTED_RESULT")
                            .action(ActionType.BLOCK)
                            .build())
                    .payload(Map.of("totalScore", totalScore, "hits", hits))
                    .build();
        }

        // 放行，但标记加权最高的规则
        return dominantHit != null ? dominantHit : hits.get(0);
    }
}
```

**适用场景**：营销概率提升、用户评级、动态定价等需要柔性决策的场景。

### 3.4 策略三：互斥组（Mutex Group）

```java
/**
 * 互斥组策略
 * 原则：同一互斥组内的规则，只取优先级最高的一条，其余忽略
 */
public class MutexGroupResolver implements ConflictResolver {

    @Override
    public RuleHit resolve(List<RuleHit> hits) {
        // 按互斥组分组
        Map<String, List<RuleHit>> groupMap = hits.stream()
                .filter(h -> h.getRule().getMutexGroup() != null)
                .collect(Collectors.groupingBy(h -> h.getRule().getMutexGroup()));

        Set<RuleHit> suppressed = new HashSet<>();  // 被互斥掉的规则

        for (List<RuleHit> groupHits : groupMap.values()) {
            if (groupHits.size() > 1) {
                // 取优先级最高的，其余标记为被互斥
                RuleHit winner = groupHits.stream()
                        .max(Comparator.comparingInt(h -> h.getRule().getPriority()))
                        .orElseThrow();
                groupHits.stream()
                        .filter(h -> h != winner)
                        .forEach(suppressed::add);
            }
        }

        // 从未被互斥的规则中取优先级最高的
        return hits.stream()
                .filter(h -> !suppressed.contains(h))
                .max(Comparator.comparingInt(h -> h.getRule().getPriority()))
                .orElse(null);
    }
}
```

**适用场景**：互斥的营销活动（同一商品不能叠加两个满减）、互斥的风控等级。

### 3.5 策略四：分层裁决（Layered Arbitration）

```java
/**
 * 分层裁决策略
 * 原则：规则按层级排列，上层 BLOCK 则下层不执行；上层 PASS 则进入下层
 */
public class LayeredArbitrationResolver implements ConflictResolver {

    // 层级定义（数字越小越上层）
    private static final List<String> LAYER_ORDER =
            List.of("SAFETY", "RISK", "ACCESS", "MARKETING");

    @Override
    public RuleHit resolve(List<RuleHit> hits) {
        // 按层级排序
        hits.sort(Comparator.comparingInt(
                h -> LAYER_ORDER.indexOf(h.getRule().getLayer())));

        for (RuleHit hit : hits) {
            if (hit.getRule().getAction() == ActionType.BLOCK) {
                // 上层拦截，直接返回，下层规则不再处理
                return hit;
            }
        }

        // 所有层都未拦截，取最后一个 PASS/BOOST 作为结果
        return hits.isEmpty() ? null : hits.get(hits.size() - 1);
    }
}
```

**适用场景**：复杂的多层风控体系（安全层 → 风控层 → 准入层 → 营销层）。

## 四、统一冲突解决框架

实际工程中，不会只用一种策略，而是**策略可配置 + 组合使用**：

```java
/**
 * 冲突解决器统一入口
 * 根据规则组配置，自动选择对应的冲突解决策略
 */
@Component
public class ConflictResolutionManager {

    private final Map<ConflictPolicy, ConflictResolver> resolvers;

    public ConflictResolutionManager() {
        this.resolvers = Map.of(
            ConflictPolicy.VETO,               new VetoConflictResolver(),
            ConflictPolicy.WEIGHTED_VOTING,    new WeightedVotingResolver(),
            ConflictPolicy.MUTEX_GROUP,        new MutexGroupResolver(),
            ConflictPolicy.LAYERED_ARBITRATION, new LayeredArbitrationResolver()
        );
    }

    /**
     * 解决冲突
     * @param hits      所有命中的规则
     * @param policy    该规则组的冲突解决策略
     * @return          最终裁决结果
     */
    public RuleHit resolve(List<RuleHit> hits, ConflictPolicy policy) {
        if (hits == null || hits.isEmpty()) {
            return null;
        }
        if (hits.size() == 1) {
            return hits.get(0);  // 只命中一条，无需解决冲突
        }

        ConflictResolver resolver = resolvers.get(policy);
        if (resolver == null) {
            throw new IllegalStateException("未知的冲突解决策略: " + policy);
        }

        RuleHit result = resolver.resolve(hits);

        // 记录冲突日志（审计需要）
        logConflict(hits, result, policy);

        return result;
    }

    private void logConflict(List<RuleHit> hits, RuleHit winner,
                             ConflictPolicy policy) {
        log.info("[冲突解决] 策略={}, 命中规则={}, 胜出规则={}",
                policy,
                hits.stream().map(h -> h.getRule().getName())
                        .collect(Collectors.joining(",")),
                winner != null ? winner.getRule().getName() : "NONE");
    }
}
```

## 五、黑名单×VIP场景的完整解法

回到面试题的具体场景，**最佳实践是分层裁决 + 一票否决的组合**：

```
请求进入
    │
    ▼
┌───────────────────────────────────────────┐
│  第一层：安全层（SAFETY）                    │
│  执行黑名单规则 → 命中？                     │
│     YES → 一票否决 → 直接拦截（BLOCK）       │
│     NO  → 继续                            │
└───────────────────┬───────────────────────┘
                    │
                    ▼
┌───────────────────────────────────────────┐
│  第二层：营销层（MARKETING）                 │
│  执行VIP概率提升规则 → 命中？               │
│     YES → BOOST（概率 × 1.2）              │
│     NO  → 正常概率                         │
└───────────────────────────────────────────┘
```

**为什么这样设计？**

1. **安全优先原则**：安全层在营销层之上，无论营销层说什么，安全层的 BLOCK 绝对有效。
2. **短路效率**：黑名单命中后直接返回，VIP规则甚至不会被执行。
3. **可解释性**：日志中清晰记录「黑名单命中，VIP规则未执行」，方便审计和排查。

## 六、面试追问应对

### Q1：一票否决和权重投票各适合什么场景？

> **一票否决**适合**不可逆的安全场景**：黑名单、设备封禁、洗钱嫌疑。这类规则的特点是「宁可错杀一千」，漏放的代价远高于误杀。用否决权确保安全底线。
>
> **权重投票**适合**可容忍误差的柔性场景**：营销概率调整、动态定价、用户画像评分。这类规则的特点是「多条弱信号合成强信号」，单条规则的误判不影响整体决策。

### Q2：两个一票否决规则谁优先？

> 两个一票否决规则都给出 BLOCK 时，它们**结论一致**，不存在冲突，直接拦截即可。如果一个给 BLOCK 一个给 PASS（设计上不应该出现），则退化为优先级比较——优先级数字大的生效。**最佳实践是：一票否决权只授予 BLOCK 动作，不授予 PASS 动作**，从设计上消除这个歧义。

### Q3：冲突解决策略能动态配置吗？

> 能。策略本身是一个枚举值，存储在规则组的配置中。当业务方需要从「一票否决」切换到「权重投票」时，只需修改规则组配置中的 `conflictPolicy` 字段，无需改代码。配合规则引擎的热更新能力（见「动态可配置」章节），可以实现策略的实时切换。

## 七、总结

| 冲突解决策略 | 一句话记忆 | 黑名单×VIP的结果 |
|------------|-----------|----------------|
| 一票否决 | 安全类说了算 | **拦截** |
| 权重投票 | 分数说了算 | 取决于权重，通常拦截 |
| 互斥组 | 同组只留一个 | 留黑名单 |
| 分层裁决 | 上层覆盖下层 | 安全层拦截，营销层不执行 |

**工程最佳实践**：用分层裁决做框架，用一票否决做安全兜底，用互斥组做同域排他，用权重投票做营销柔性决策。四者组合，覆盖绝大多数冲突场景。
