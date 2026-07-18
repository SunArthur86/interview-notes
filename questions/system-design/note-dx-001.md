---
id: note-dx-001
difficulty: L3
category: system-design
subcategory: 分布式
tags:
- 中国电信
- Java后端
- 幂等性
- 微服务
- Token
- 唯一索引
- 状态机
- 面经
feynman:
  essence: 幂等性是"同一操作执行一次或多次，结果一致"。微服务中网络不可靠导致超时重试，同一请求可能被发送多次，必须用Token/唯一索引/状态机等机制保证重复请求不产生副作用。
  analogy: 就像去超市买东西刷信用卡——POS机超时重新刷了一次，但你只应被扣一次钱。幂等性就是保证"不管刷几次，只扣一次"。
  key_points:
  - 幂等定义：f(f(x)) = f(x)，执行多次结果相同
  - 方案一：Token机制（防重令牌），请求前先获取Token
  - 方案二：数据库唯一约束（业务流水号做唯一索引）
  - 方案三：状态机（只允许合法的状态流转）
  - 所有方案都要求有"唯一标识"来识别重复请求
first_principle:
  essence: 幂等 = 操作可重复执行无副作用，本质是"让重复请求被识别并跳过"
  derivation: 网络不可靠→超时重试→同一请求被发送多次→如果不做幂等→重复扣款/重复下单→解决：用唯一标识区分"第一次"和"重复"
  conclusion: 创建类操作用Token/唯一索引，更新类操作用状态机/乐观锁
follow_up:
- Token存在哪里？Redis还是DB？过期时间设多少？
- 如果Token校验通过了但业务执行失败了怎么办？
- 幂等和防重复提交是一回事吗？（幂等是系统层面，防重是用户层面）
- 分布式锁能实现幂等吗？（可以，但性能差于Token/唯一索引）
memory_points:
- 幂等定义：f(f(x))=f(x)，执行一次和多次结果一致
- 三大方案：Token机制(防重令牌) + 唯一索引(数据库约束) + 状态机(状态流转)
- Token方案：先获取Token→请求带Token→服务端校验Token状态→处理或拒绝
- 唯一索引：业务流水号做唯一约束，重复插入报错直接返回上次结果
- 面试加分：方案描述不能只说"用Redis"，需具体到键值设计和校验逻辑
---

# 【中国电信面试】微服务架构下，如何保证服务之间调用的幂等性？请列举至少两种实现方案

> 来源：小红书 中国电信后端开发工程师(JAVA方向)面试真题

## 一、为什么微服务需要幂等

```
微服务调用链（没有幂等保护的场景）

用户 ──► 订单服务 ──► 支付服务
              │            │
              │  超时！      │
              │  重试 ──────►│ ← 第二次调用！
              │            │ 扣款第二次！
              │            │
              
问题：网络超时 → 调用方不确定对方是否处理了 → 重试 → 可能重复执行

没有幂等：重复扣款/重复下单/重复发消息
有幂等：  重复请求被识别，直接返回上次的结果
```

## 二、方案一：Token 机制（防重令牌）

```
┌─────────┐                    ┌─────────┐
│ 客户端   │                    │ 服务端   │
│         │  1. 请求Token       │         │
│         │ ──────────────────► │         │
│         │                    │ 生成Token │
│         │  ◄────────────────  │ 存入Redis │
│         │  Token=abc123       │ status=UNUSED
│         │                    │         │
│         │  2. 携带Token       │         │
│         │     发起业务请求     │         │
│         │ ──────────────────► │         │
│         │                    │ 校验Token │
│         │                    │ 存在且UNUSED?
│         │                    │ 是→处理业务
│         │                    │   Token改USED
│         │  ◄────────────────  │ 否→拒绝/返回上次结果
│         │  业务结果            │         │
└─────────┘                    └─────────┘
```

```java
@RestController
@RequestMapping("/api/order")
public class OrderController {
    
    @Autowired
    private StringRedisTemplate redisTemplate;
    
    // 第一步：获取Token
    @GetMapping("/token")
    public String getToken() {
        String token = UUID.randomUUID().toString().replace("-", "");
        // 存入Redis，设置过期时间（如10分钟）
        redisTemplate.opsForValue().set(
            "idempotent:token:" + token, 
            "UNUSED", 
            10, TimeUnit.MINUTES);
        return token;
    }
    
    // 第二步：携带Token发起业务请求
    @PostMapping("/create")
    public Result createOrder(@RequestHeader("X-Idempotent-Token") String token,
                              @RequestBody OrderDTO dto) {
        String key = "idempotent:token:" + token;
        
        // 原子性校验+标记（Lua脚本保证CAS原子）
        String luaScript = 
            "if redis.call('GET', KEYS[1]) == 'UNUSED' then " +
            "  redis.call('SET', KEYS[1], 'USED') " +
            "  return 1 " +
            "else return 0 end";
        
        DefaultRedisScript<Long> script = new DefaultRedisScript<>(luaScript, Long.class);
        Long success = redisTemplate.execute(script, Collections.singletonList(key));
        
        if (success == null || success == 0) {
            // Token已使用 → 重复请求 → 返回上次结果
            return getCachedResult(token);
        }
        
        // 首次请求 → 处理业务
        Result result = orderService.createOrder(dto);
        // 缓存结果（重复请求时返回）
        redisTemplate.opsForValue().set(
            "idempotent:result:" + token,
            JSON.toJSONString(result),
            24, TimeUnit.HOURS);
        return result;
    }
}
```

**适用场景**：创建订单、支付、提交表单等创建类操作

## 三、方案二：数据库唯一约束

```
原理：利用数据库的唯一索引拦截重复插入

┌──────────────────────────────────────────┐
│ orders 表                                 │
│                                          │
│ id (PK)     BIGINT AUTO_INCREMENT        │
│ order_no    VARCHAR(32) UNIQUE  ← 唯一索引│
│ user_id     BIGINT                       │
│ amount      DECIMAL                      │
│ status      VARCHAR(20)                  │
│ create_time DATETIME                     │
└──────────────────────────────────────────┘

业务流水号 order_no 由调用方生成（UUID/雪花算法）
→ 第一次插入成功
→ 重复请求时唯一键冲突 → 捕获DuplicateKeyException
  → 查询已有记录并返回
```

```java
@Service
public class OrderService {
    
    public Order createOrder(OrderDTO dto) {
        String orderNo = dto.getRequestId(); // 调用方传的唯一标识
        try {
            Order order = new Order();
            order.setOrderNo(orderNo);
            order.setUserId(dto.getUserId());
            order.setAmount(dto.getAmount());
            orderMapper.insert(order); // 唯一索引保证不重复
            return order;
        } catch (DuplicateKeyException e) {
            // 唯一键冲突 → 重复请求 → 返回已有记录
            return orderMapper.findByOrderNo(orderNo);
        }
    }
}
```

**适用场景**：创建类操作，业务表本身有唯一标识字段

## 四、方案三：状态机机制

```
原理：只允许合法的状态流转，非法流转直接拒绝

订单状态流转图
┌─────────┐     ┌─────────┐     ┌─────────┐     ┌─────────┐
│ CREATED │ ──► │  PAID   │ ──► │ SHIPPED │ ──► │COMPLETED│
└─────────┘     └─────────┘     └─────────┘     └─────────┘
                      │
                      ▼
                 ┌─────────┐
                 │ CANCELLED│
                 └─────────┘

更新SQL带状态条件：
UPDATE orders 
SET status = 'PAID', update_time = NOW()
WHERE order_no = #{orderNo} 
  AND status = 'CREATED';  ← 只有CREATED才能变PAID

→ 如果重复请求：status已经是PAID了
  → WHERE条件不匹配 → affected_rows=0 → 说明已处理过
```

```java
public boolean payOrder(String orderNo) {
    int rows = orderMapper.updateStatus(orderNo, "PAID", "CREATED");
    if (rows == 0) {
        // 状态不是CREATED（可能已经PAID了）→ 幂等返回
        Order existing = orderMapper.findByOrderNo(orderNo);
        if ("PAID".equals(existing.getStatus())) {
            return true; // 已支付过，幂等返回成功
        }
        return false; // 其他状态（如CANCELLED），拒绝
    }
    return true; // 状态更新成功
}
```

**适用场景**：更新类操作（订单状态更新、审批流等）

## 五、方案对比

| 方案 | 原理 | 适用场景 | 优点 | 局限 |
|------|------|---------|------|------|
| **Token机制** | 预发Token+原子校验 | 创建类操作 | 通用性强 | 需额外Redis开销 |
| **唯一索引** | 数据库约束拦截 | 创建类操作 | 简单可靠 | 仅适用DB写入 |
| **状态机** | 合法状态流转 | 更新类操作 | 无额外存储 | 需设计状态图 |
| **乐观锁** | version版本号 | 并发更新 | 防并发修改 | 非严格幂等 |

## 六、面试加分点

1. **先定义幂等**：上来先说"幂等性是指同一操作执行一次或多次，对系统状态的影响一致"
2. **区分场景**：创建类用Token/唯一索引，更新类用状态机，能按场景选型
3. **具体到键值设计**：不能只说"用Redis"，要说"key=`idempotent:token:{uuid}`，Lua脚本保证CAS原子"
4. **避免混淆概念**：幂等≠防重复提交，幂等是系统层面（网络重试），防重是用户层面（连续点击）
5. **容错设计**：提到方案二的局限性（仅适用DB插入），方案三的边界（非法状态流转需拒绝）


## 结构化回答

**30 秒电梯演讲：** 幂等性是"同一操作执行一次或多次，结果一致"。微服务中网络不可靠导致超时重试，同一请求可能被发送多次，必须用Token/唯一索引/状态机等机制保证重复请求不产生副作用。打个比方，就像去超市买东西刷信用卡——POS机超时重新刷了一次，但你只应被扣一次钱。幂等性就是保证"不管刷几次，只扣一次"。

**展开框架：**
1. **幂等定义** — f(f(x))=f(x)，执行一次和多次结果一致
2. **三大方案** — Token机制(防重令牌) + 唯一索引(数据库约束) + 状态机(状态流转)
3. **Token方案** — 先获取Token→请求带Token→服务端校验Token状态→处理或拒绝

**收尾：** 这块我踩过坑——要不要深入聊：Token存在哪里？Redis还是DB？过期时间设多少？

## 视频脚本

> 预计时长：3 分钟 | 由浅入深

| 时间 | 画面/字幕 | 口播台词 | 讲解要点 |
|------|----------|----------|----------|
| 0:00 | 标题卡 | "分布式一句话：幂等性是'同一操作执行一次或多次，结果一致'。微服务中网络不可靠导致超时重试…。" | 开场钩子 |
| 0:15 | B+ 树索引结构图 | "幂等定义：f(f(x))就是f(x)，执行一次和多次结果一致" | 幂等定义 |
| 1:06 | B+ 树索引结构图分步演示 | "三大方案：Token机制(防重令牌) + 唯一索引(数据库约束) + 状态机(状态流转)" | 三大方案 |
| 1:57 | 关键代码/伪代码片段 | "Token方案：先获取Token到请求带Token到服务端校验Token状态到处理或拒绝" | Token方案 |
| 2:50 | 总结卡 | "核心抓住这条主线，下期咱们接着聊：Token存在哪里？Redis还是DB？过期时间设多少。" | 收尾 |

## 苏格拉底式面试追问

| 追问层级 | 面试官可能这样问 | 高分回答方向 |
|----------|------------------|--------------|
| 目标追问 | 幂等性要解决的核心问题是什么？ | 网络重试、消息重复、用户重复提交等导致同一操作执行多次时，保证结果一致不产生副作用（如重复扣款、重复创建） |
| 证据追问 | 幂等实现方案有哪些？各自适用什么？ | 方案：唯一索引/主键去重（数据库层）、Token机制（前端发唯一token）、状态机（业务状态约束）、乐观锁版本号、分布式锁 |
| 边界追问 | 什么操作必须幂等，什么可以不幂等？ | 写操作（扣款、创建订单、发消息）必须幂等；纯读操作天然幂等；幂等有成本要按业务必要性选 |
| 反例追问 | 加分布式锁就是幂等吗？ | 不是。锁只保证串行执行，不保证结果一致；锁内还要做业务校验（如查是否已处理），才是真正幂等 |
| 风险追问 | 幂等设计不当有什么风险？ | 唯一索引冲突、token过期/重放、状态机死锁、锁粒度过大性能差、幂等失效重复操作 |
| 验证追问 | 怎么验证幂等有效？ | 并发重复请求测试、消息重复消费测试、断言结果一致、监控重复操作告警 |
| 沉淀追问 | 幂等怎么沉淀？ | 规范：写操作默认幂等、唯一索引/Token/状态机选型、幂等key设计、监控重复请求 |

### 现场对话示例
**面试官**：微服务间调用怎么保证幂等性？列举至少两种方案。
**候选人**：方案一唯一索引去重（业务唯一键+数据库唯一约束）；方案二Token机制（前端领唯一token，后端校验消费）；方案三状态机约束业务流转。
**面试官**：加分布式锁就是幂等吗？
**候选人**：不是，锁只保证串行不保证结果一致；锁内还要查是否已处理做业务校验，配合唯一索引才是真正幂等。
**面试官**：什么操作必须幂等？
**候选人**：写操作如扣款、创建订单、发消息必须幂等防止重复；纯读天然幂等；幂等有成本按业务必要性选型。
