---
id: note-dd-re-005
difficulty: L5
category: system-design
subcategory: 微服务
tags:
- 滴滴
- 面经
- 规则引擎
- 动态配置
- 架构设计
feynman:
  essence: 动态规则引擎 = DSL + 规则解析器 + 热更新机制，实现不改代码即可调整规则。
  analogy: 就像乐高积木——你不重新开模，只需按说明书拼装不同积木就能搭出各种造型。
  first_principle: 配置化 = 将代码中的逻辑提取为数据中的配置，用解释器模式执行。
  key_points:
  - JSON/YAML DSL
  - 规则解释器
  - 热更新（不重启）
  - 规则版本管理
first_principle:
  essence: 数据与逻辑分离是软件设计的终极目标
  derivation: 规则写在代码→改规则=改代码=重新发版→规则提取为配置→解析器读取配置执行→热更新
  conclusion: 动态规则引擎的本质是把if-else变成数据配置
follow_up:
- DSL用什么格式最好？
- 热更新时正在执行的规则怎么办？
- 规则版本回滚怎么做？
memory_points:
- 核心目标：规则抽离代码转DSL，依托配置中心实现热更新
- 运行机制：DSL解析转AST语法树，编译结果缓存兼顾灵活性性能
- 架构闭环：后台管理配置版本，监听变更，本地缓存加速执行
---

# 【滴滴面经】如果规则引擎要做成动态可配置的，你觉得应该怎么设计？

## 一、问题本质与设计目标

规则引擎动态可配置的核心目标是：**将业务规则从代码中抽离为数据配置，通过解析器解释执行，并支持不重启服务即可热更新。** 本质上就是把硬编码的 `if-else` 逻辑提升为可动态管理的数据。

设计目标拆解：

| 目标 | 说明 |
|------|------|
| **配置化** | 规则以 JSON/YAML DSL 描述，而非写死在 Java 代码中 |
| **热更新** | 修改配置后不重启服务，秒级生效 |
| **版本管理** | 每次修改产生新版本，支持灰度发布和一键回滚 |
| **可观测** | 规则执行过程可追踪、可审计、可灰度验证 |
| **高性能** | 规则编译后缓存，避免每次请求重新解析 |

---

## 二、整体架构

```
┌─────────────────────────────────────────────────────────┐
│                    管理后台 (Admin Console)               │
│   规则编辑器 → DSL校验 → 版本提交 → 发布审批               │
└──────────────┬──────────────────────────────┬───────────┘
               │ 写入规则配置                    │ 发布事件
               ▼                               ▼
┌──────────────────────┐         ┌──────────────────────┐
│   配置中心 (Apollo /   │         │   消息总线            │
│   Nacos / 数据库)      │         │  (MQ / Watch 通知)    │
│                      │         └──────────┬───────────┘
│  rule_meta (元信息)   │                    │ 配置变更通知
│  rule_version (版本)  │                    ▼
│  rule_publish (发布)  │     ┌──────────────────────────┐
└──────────┬───────────┘     │   规则引擎运行时           │
           │ 加载配置          │                          │
           ▼                  │  ┌────────────────────┐  │
┌──────────────────────┐     │  │  DSL解析器          │  │
│  规则缓存层           │     │  │  YAML → AST        │  │
│  (本地缓存+版本快照)  │◀────│  └────────┬───────────┘  │
│  key=ruleSetId+ver   │     │           ▼              │
└──────────┬───────────┘     │  ┌────────────────────┐  │
           │                  │  │  规则执行器          │  │
           ▼                  │  │  (Interpreter模式)  │  │
┌──────────────────────┐     │  └────────┬───────────┘  │
│  业务调用             │     │           ▼              │
│  ruleEngine.execute  │     │  ┌────────────────────┐  │
│  (context)           │────▶│  │  执行结果+审计日志   │  │
└──────────────────────┘     │  └────────────────────┘  │
                             └──────────────────────────┘
```

---

## 三、DSL 设计（YAML 格式）

采用 YAML 格式作为规则 DSL，兼顾可读性和结构化表达能力。每条规则由**条件（Condition）**和**动作（Action）**组成，规则集（RuleSet）是规则的有序集合。

### 3.1 完整 DSL 配置示例

```yaml
# rule-set: 滴滴出行价格补贴规则
meta:
  id: "rs-order-subsidy-001"
  name: "订单补贴规则集"
  version: "2.1.0"
  tenant: "didi-express"
  description: "根据城市、时段、用户等级计算订单补贴"
  status: "active"

# 规则集级别的上下文参数定义
context_schema:
  fields:
    - name: "city"
      type: "string"
      required: true
    - name: "hour"
      type: "integer"
      source: "time.hour()"
    - name: "user_level"
      type: "enum"
      values: ["bronze", "silver", "gold", "platinum"]
    - name: "order_amount"
      type: "decimal"
    - name: "is_peak"
      type: "boolean"
      source: "time.isPeakHour()"

# 规则列表（按优先级从高到低匹配，命中即返回）
rules:
  # 规则1: 早高峰金牌用户大单补贴
  - id: "rule-001"
    name: "早高峰金牌大单补贴"
    priority: 100
    enabled: true
    condition:
      logic: "AND"
      conditions:
        - field: "city"
          operator: "IN"
          values: ["北京", "上海", "深圳"]
        - field: "is_peak"
          operator: "EQ"
          value: true
        - field: "user_level"
          operator: "EQ"
          value: "platinum"
        - field: "order_amount"
          operator: "GTE"
          value: 50.00
    actions:
      - type: "SET"
        field: "subsidy_type"
        value: "peak_platinum_bonus"
      - type: "CALC"
        field: "subsidy_amount"
        formula: "order_amount * 0.15 + 10"
      - type: "LOG"
        level: "info"
        message: "命中早高峰金牌大单补贴规则"

  # 规则2: 晚高峰银牌用户补贴
  - id: "rule-002"
    name: "晚高峰银牌补贴"
    priority: 90
    enabled: true
    condition:
      logic: "AND"
      conditions:
        - field: "hour"
          operator: "BETWEEN"
          range: [17, 20]
        - field: "user_level"
          operator: "IN"
          values: ["silver", "gold"]
    actions:
      - type: "CALC"
        field: "subsidy_amount"
        formula: "order_amount * 0.08"
      - type: "SET"
        field: "subsidy_type"
        value: "evening_silver_bonus"

  # 规则3: 兜底规则——所有用户基础补贴
  - id: "rule-999"
    name: "基础补贴兜底"
    priority: 1
    enabled: true
    condition:
      logic: "ALWAYS"  # 永远命中
    actions:
      - type: "SET"
        field: "subsidy_amount"
        value: 0
      - type: "SET"
        field: "subsidy_type"
        value: "none"
```

### 3.2 DSL 设计要点

- **逻辑操作符**：支持 `AND`/`OR`/`NOT` 嵌套，形成条件树
- **比较操作符**：`EQ`/`NE`/`GT`/`GTE`/`LT`/`LTE`/`IN`/`NOT_IN`/`BETWEEN`/`CONTAINS`
- **动作类型**：`SET`（赋值）、`CALC`（计算）、`LOG`（日志）、`REJECT`（拒绝）、`CALL`（调用外部接口）
- **优先级**：数字越大优先级越高，默认 `first-match` 策略，也支持 `all-match`

---

## 四、规则解析器核心代码（解释器模式）

### 4.1 DSL 模型定义

```java
/**
 * 规则集模型
 */
@Data
public class RuleSet {
    private RuleSetMeta meta;
    private ContextSchema contextSchema;
    private List<Rule> rules;

    /** 按优先级降序排列 */
    public List<Rule> getSortedRules() {
        return rules.stream()
            .filter(Rule::isEnabled)
            .sorted(Comparator.comparing(Rule::getPriority).reversed())
            .collect(Collectors.toList());
    }
}

@Data
public class Rule {
    private String id;
    private String name;
    private int priority;
    private boolean enabled;
    private Condition condition;
    private List<Action> actions;
}

/**
 * 条件节点 —— 支持 AND / OR / NOT 嵌套
 */
@Data
public class Condition {
    private String logic;           // AND | OR | NOT | ALWAYS | LEAF
    private List<Condition> conditions;  // 子条件（AND/OR/NOT 时使用）

    // 叶子条件字段
    private String field;
    private String operator;        // EQ | GT | IN | BETWEEN ...
    private Object value;
    private List<Object> values;
    private Object[] range;
}

/**
 * 动作定义
 */
@Data
public class Action {
    private String type;    // SET | CALC | LOG | REJECT | CALL
    private String field;
    private Object value;
    private String formula; // CALC 类型用
    private String level;   // LOG 类型用
    private String message;
}
```

### 4.2 条件解释器（Interpreter 模式）

```java
/**
 * 条件解释器接口 —— 解释器模式核心
 */
public interface ConditionInterpreter {
    boolean interpret(RuleContext context);
}

/**
 * 叶子条件解释器：处理单个 field OP value
 */
public class LeafConditionInterpreter implements ConditionInterpreter {
    private final Condition condition;

    public LeafConditionInterpreter(Condition condition) {
        this.condition = condition;
    }

    @Override
    public boolean interpret(RuleContext context) {
        Object fieldValue = context.get(condition.getField());
        String op = condition.getOperator();

        return switch (op) {
            case "EQ"    -> Objects.equals(fieldValue, condition.getValue());
            case "NE"    -> !Objects.equals(fieldValue, condition.getValue());
            case "GT"    -> compare(fieldValue, condition.getValue()) > 0;
            case "GTE"   -> compare(fieldValue, condition.getValue()) >= 0;
            case "LT"    -> compare(fieldValue, condition.getValue()) < 0;
            case "LTE"   -> compare(fieldValue, condition.getValue()) <= 0;
            case "IN"    -> condition.getValues().contains(fieldValue);
            case "NOT_IN"-> !condition.getValues().contains(fieldValue);
            case "BETWEEN" -> {
                Object[] range = condition.getRange();
                yield compare(fieldValue, range[0]) >= 0
                   && compare(fieldValue, range[1]) <= 0;
            }
            case "CONTAINS" -> String.valueOf(fieldValue)
                                       .contains(String.valueOf(condition.getValue()));
            default -> throw new RuleEngineException("不支持的操作符: " + op);
        };
    }

    @SuppressWarnings({"rawtypes", "unchecked"})
    private int compare(Object a, Object b) {
        return ((Comparable) a).compareTo(b);
    }
}

/**
 * AND 逻辑解释器
 */
public class AndInterpreter implements ConditionInterpreter {
    private final List<ConditionInterpreter> children;

    public AndInterpreter(List<ConditionInterpreter> children) {
        this.children = children;
    }

    @Override
    public boolean interpret(RuleContext context) {
        return children.stream().allMatch(c -> c.interpret(context));
    }
}

/**
 * OR 逻辑解释器
 */
public class OrInterpreter implements ConditionInterpreter {
    private final List<ConditionInterpreter> children;

    public OrInterpreter(List<ConditionInterpreter> children) {
        this.children = children;
    }

    @Override
    public boolean interpret(RuleContext context) {
        return children.stream().anyMatch(c -> c.interpret(context));
    }
}

/**
 * NOT 逻辑解释器
 */
public class NotInterpreter implements ConditionInterpreter {
    private final ConditionInterpreter child;

    public NotInterpreter(ConditionInterpreter child) {
        this.child = child;
    }

    @Override
    public boolean interpret(RuleContext context) {
        return !child.interpret(context);
    }
}

/**
 * ALWAYS 解释器（兜底规则用）
 */
public class AlwaysTrueInterpreter implements ConditionInterpreter {
    @Override
    public boolean interpret(RuleContext context) {
        return true;
    }
}
```

### 4.3 条件解析器工厂 —— 将 DSL 节点编译为解释器树

```java
/**
 * 条件解析器：将 Condition DSL 递归编译为解释器树（AST）
 */
public class ConditionParser {

    public ConditionInterpreter parse(Condition condition) {
        if (condition == null) {
            return new AlwaysTrueInterpreter();
        }

        String logic = condition.getLogic();

        if ("ALWAYS".equals(logic) || logic == null) {
            return new AlwaysTrueInterpreter();
        }

        return switch (logic) {
            case "AND" -> new AndInterpreter(
                condition.getConditions().stream()
                    .map(this::parse)
                    .collect(Collectors.toList())
            );
            case "OR" -> new OrInterpreter(
                condition.getConditions().stream()
                    .map(this::parse)
                    .collect(Collectors.toList())
            );
            case "NOT" -> new NotInterpreter(
                parse(condition.getConditions().get(0))
            );
            case "LEAF" -> new LeafConditionInterpreter(condition);
            default     -> new LeafConditionInterpreter(condition);
        };
    }
}
```

### 4.4 规则引擎核心执行器

```java
/**
 * 规则引擎核心
 */
@Slf4j
public class RuleEngine {

    private final RuleSetCache ruleSetCache;
    private final ConditionParser conditionParser = new ConditionParser();
    private final ActionExecutor actionExecutor = new ActionExecutor();
    private final RuleAuditLogger auditLogger;

    /**
     * 执行规则集
     * @param ruleSetId  规则集ID
     * @param version    版本号（null 表示当前生效版本）
     * @param input      输入上下文
     * @return           规则执行结果
     */
    public RuleResult execute(String ruleSetId, String version,
                              Map<String, Object> input) {
        // 1. 加载规则集（从缓存或配置中心）
        CompiledRuleSet compiled = ruleSetCache.get(ruleSetId, version);
        if (compiled == null) {
            throw new RuleEngineException("规则集不存在: " + ruleSetId);
        }

        // 2. 构建运行时上下文
        RuleContext context = new RuleContext(input);

        // 3. 遍历规则（已按优先级排序）
        for (CompiledRule rule : compiled.getCompiledRules()) {
            boolean matched = rule.getConditionInterpreter().interpret(context);
            if (matched) {
                // 执行动作
                actionExecutor.execute(rule.getActions(), context);
                // 审计日志
                auditLogger.log(ruleSetId, compiled.getVersion(),
                                rule.getId(), context, true);
                // first-match 策略：命中即返回
                return RuleResult.matched(rule.getId(),
                                          context.getResultMap());
            }
        }

        // 无规则命中
        auditLogger.log(ruleSetId, compiled.getVersion(),
                        null, context, false);
        return RuleResult.notMatched(context.getResultMap());
    }
}

/**
 * 编译后的规则（将 Condition 预编译为解释器树，避免每次请求重新解析）
 */
@Data
public class CompiledRule {
    private String id;
    private String name;
    private int priority;
    private ConditionInterpreter conditionInterpreter;
    private List<Action> actions;
}

/**
 * 编译后的规则集
 */
@Data
public class CompiledRuleSet {
    private String version;
    private List<CompiledRule> compiledRules; // 已排序+已编译
    private long compileTimestamp;
}
```

---

## 五、热更新机制

### 5.1 配置中心监听 + 本地缓存替换

热更新的核心是**配置变更通知 → 重新编译规则 → 原子替换缓存**。

```java
/**
 * 规则集缓存管理 —— 支持热更新
 */
@Slf4j
@Component
public class RuleSetCacheManager {

    // key = ruleSetId, value = 当前生效的编译后规则集
    private final ConcurrentHashMap<String, CompiledRuleSet> activeCache
        = new ConcurrentHashMap<>();

    // 历史版本快照（用于回滚）
    private final Map<String, TreeMap<String, CompiledRuleSet>> versionSnapshots
        = new ConcurrentHashMap<>();

    private final RuleConfigLoader configLoader;
    private final ConditionParser conditionParser;

    /**
     * 初始化：注册配置变更监听器
     */
    @PostConstruct
    public void init() {
        // 监听配置中心的规则变更（以 Nacos 为例）
        configLoader.addListener(ruleSetId -> {
            log.info("检测到规则集 {} 配置变更，开始热更新...", ruleSetId);
            hotReload(ruleSetId);
        });
    }

    /**
     * 热更新：重新加载 → 编译 → 原子替换
     */
    private void hotReload(String ruleSetId) {
        try {
            // 1. 从配置中心拉取最新配置
            RuleSet ruleSet = configLoader.loadLatest(ruleSetId);
            if (ruleSet == null) return;

            // 2. DSL 校验（语法、字段引用、公式合法性）
            ValidationResult validation = validate(ruleSet);
            if (!validation.isValid()) {
                log.error("规则集 {} DSL 校验失败: {}", ruleSetId,
                          validation.getErrors());
                // 发告警，不替换旧版本
                alertService.send("规则热更新校验失败", validation.getErrors());
                return;
            }

            // 3. 编译为执行树
            CompiledRuleSet compiled = compile(ruleSet);

            // 4. 保存版本快照
            versionSnapshots
                .computeIfAbsent(ruleSetId, k -> new TreeMap<>())
                .put(compiled.getVersion(), compiled);

            // 5. 原子替换缓存（ConcurrentHashMap.put 是原子操作）
            CompiledRuleSet old = activeCache.put(ruleSetId, compiled);
            log.info("规则集 {} 热更新成功: {} -> {}",
                     ruleSetId,
                     old != null ? old.getVersion() : "null",
                     compiled.getVersion());

        } catch (Exception e) {
            log.error("规则集 {} 热更新异常，保持旧版本", ruleSetId, e);
            // 异常时不清除旧缓存，保证服务可用
        }
    }

    /**
     * 编译规则集：Condition → 解释器树
     */
    private CompiledRuleSet compile(RuleSet ruleSet) {
        List<CompiledRule> compiledRules = ruleSet.getSortedRules()
            .stream()
            .map(rule -> {
                CompiledRule cr = new CompiledRule();
                cr.setId(rule.getId());
                cr.setName(rule.getName());
                cr.setPriority(rule.getPriority());
                // 核心：将 Condition DSL 预编译为解释器树
                cr.setConditionInterpreter(conditionParser.parse(rule.getCondition()));
                cr.setActions(rule.getActions());
                return cr;
            })
            .collect(Collectors.toList());

        CompiledRuleSet result = new CompiledRuleSet();
        result.setVersion(ruleSet.getMeta().getVersion());
        result.setCompiledRules(compiledRules);
        result.setCompileTimestamp(System.currentTimeMillis());
        return result;
    }
}
```

### 5.2 热更新时正在执行的规则怎么办？

这是一个关键问题，采用**版本快照引用**策略：

```
正在执行中的请求 → 继续使用旧版本快照（引用不变）
新进来的请求    → 使用新版本（缓存已替换）
```

```java
/**
 * 每次请求获取的是编译后规则集的引用快照
 * 热更新替换的是缓存中的引用，正在执行的请求持有旧引用不受影响
 */
public RuleResult execute(String ruleSetId, Map<String, Object> input) {
    // 获取当前快照（此时拿到的是一个不可变的 CompiledRuleSet 引用）
    CompiledRuleSet snapshot = ruleSetCache.get(ruleSetId);
    // 后续执行都基于这个 snapshot，即使缓存被替换也不受影响
    return doExecute(snapshot, input);
}
```

`CompiledRuleSet` 是**不可变对象**（Immutable），热更新时创建新对象替换引用，不影响正在使用旧引用的请求。

---

## 六、版本管理与灰度发布

### 6.1 数据模型

```sql
-- 规则集元信息
CREATE TABLE rule_set_meta (
    id           VARCHAR(64) PRIMARY KEY,
    name         VARCHAR(128) NOT NULL,
    tenant       VARCHAR(64)  NOT NULL,
    description  TEXT,
    created_at   DATETIME     DEFAULT CURRENT_TIMESTAMP,
    updated_at   DATETIME     DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

-- 规则版本表（每次修改产生新版本）
CREATE TABLE rule_version (
    id            BIGINT AUTO_INCREMENT PRIMARY KEY,
    rule_set_id   VARCHAR(64)  NOT NULL,
    version       VARCHAR(32)  NOT NULL,       -- 语义化版本号 1.0.0
    content       LONGTEXT     NOT NULL,       -- DSL YAML 原文
    status        VARCHAR(20)  DEFAULT 'DRAFT',-- DRAFT/REVIEWING/PUBLISHED/ROLLBACK
    changelog     TEXT,                        -- 变更说明
    created_by    VARCHAR(64),
    created_at    DATETIME     DEFAULT CURRENT_TIMESTAMP,
    published_at  DATETIME,
    UNIQUE KEY uk_set_version (rule_set_id, version)
);

-- 规则发布表（记录当前生效版本、灰度配置）
CREATE TABLE rule_publish (
    id            BIGINT AUTO_INCREMENT PRIMARY KEY,
    rule_set_id   VARCHAR(64)  NOT NULL,
    version       VARCHAR(32)  NOT NULL,
    strategy      VARCHAR(20)  NOT NULL,  -- FULL（全量）/ GRAY（灰度）/ AB_TEST
    gray_config   JSON,                   -- 灰度配置：按城市、用户ID取模等
    status        VARCHAR(20)  NOT NULL,  -- ACTIVE / INACTIVE
    operator      VARCHAR(64),
    created_at    DATETIME     DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_set_active (rule_set_id, status)
);
```

### 6.2 灰度发布策略

```yaml
# 灰度发布配置示例
publish_strategy:
  type: "GRAY"
  rules:
    # 按城市灰度：先在北京验证
    - dimension: "city"
      values: ["北京"]
      percent: 100          # 北京100%流量使用新版本

    # 按用户ID取模灰度：5%用户先体验
    - dimension: "user_id_hash"
      mod: 100
      range: [0, 5]         # hash(userId) % 100 < 5 的用户使用新版本
```

灰度路由逻辑：

```java
public CompiledRuleSet resolveVersion(String ruleSetId,
                                       RuleContext context) {
    RulePublish publish = publishDao.findActive(ruleSetId);
    if (publish.getStrategy() == StrategyType.GRAY) {
        // 检查当前请求是否命中灰度
        if (grayRouter.shouldUseNewVersion(publish.getGrayConfig(), context)) {
            return cache.get(ruleSetId, publish.getVersion());
        }
        // 未命中灰度，使用上一个稳定版本
        return cache.get(ruleSetId, publish.getPreviousStableVersion());
    }
    // 全量发布
    return cache.get(ruleSetId, publish.getVersion());
}
```

### 6.3 版本回滚

```java
/**
 * 一键回滚到指定版本
 */
public void rollback(String ruleSetId, String targetVersion) {
    // 1. 校验目标版本存在且不是当前版本
    CompiledRuleSet target = versionSnapshots.get(ruleSetId).get(targetVersion);
    if (target == null) {
        // 从数据库重新加载
        target = reloadFromDb(ruleSetId, targetVersion);
    }

    // 2. 原子替换缓存
    activeCache.put(ruleSetId, target);

    // 3. 更新发布记录
    publishDao.updateStatus(ruleSetId, "ACTIVE", targetVersion);
    publishDao.insertHistory(ruleSetId, targetVersion, "ROLLBACK");

    log.warn("规则集 {} 回滚到版本 {}", ruleSetId, targetVersion);
}
```

---

## 七、完整工作流总结

```
┌──────────┐    ┌──────────┐    ┌──────────┐    ┌──────────┐
│ 1.编辑DSL │ -> │ 2.校验   │ -> │ 3.提交   │ -> │ 4.审批   │
│ (管理后台)│    │(语法检查) │    │ (新版本) │    │ (人工)   │
└──────────┘    └──────────┘    └──────────┘    └────┬─────┘
                                                     │
┌──────────┐    ┌──────────┐    ┌──────────┐         │
│ 8.监控   │ <- │ 7.全量   │ <- │ 6.灰度   │ <───────┘
│ (执行统计)│    │ 发布     │    │ 验证     │    (5.发布)
└──────────┘    └──────────┘    └──────────┘
     │
     ▼ 支持回滚到任意历史版本
┌──────────┐
│ 9.回滚   │
│ (一键回滚)│
└──────────┘
```

**关键设计决策总结**：

| 决策点 | 方案 | 理由 |
|--------|------|------|
| DSL 格式 | YAML | 可读性好，支持注释，运维和业务都能看懂 |
| 执行模式 | 解释器模式 + 编译缓存 | 兼顾灵活性和性能（编译只做一次） |
| 热更新 | 配置中心 Watch + 原子替换 | 不停机、秒级生效、失败自动保留旧版本 |
| 并发安全 | 不可变对象 + CAS 替换 | 正在执行的请求不受影响 |
| 版本管理 | 语义化版本 + DB 持久化 | 全量历史可追溯、一键回滚 |
| 灰度发布 | 多维度灰度路由 | 降低规则变更风险 |

## 记忆要点

- 核心目标：规则抽离代码转DSL，依托配置中心实现热更新
- 运行机制：DSL解析转AST语法树，编译结果缓存兼顾灵活性性能
- 架构闭环：后台管理配置版本，监听变更，本地缓存加速执行

