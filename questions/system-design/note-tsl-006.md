---
id: note-tsl-006
difficulty: L3
category: system-design
subcategory: 高并发
tags:
- 特斯拉
- 实名认证
- KYC
- 数据安全
- 异步处理
feynman:
  essence: 亿级实名认证的本质是"外部API调用+异步结果处理+数据加密存储"。核心矛盾：认证要调第三方API（慢），但用户体验要快。解法：提交后异步处理，用加密队列保护隐私数据。
  analogy: 像银行开户——前台（API网关）收资料很快，但后台（第三方核验）需要时间。客户不用在柜台等着，先回家，认证结果短信通知。
  key_points:
  - 异步认证流程(MQ解耦第三方调用)
  - 数据加密(传输层TLS+存储层AES)
  - 认证状态机(pending→verifying→success/fail)
  - 多国合规(GDPR/CCPA/中国个保法)
  - Redis缓存认证结果防重复提交
first_principle:
  essence: 认证 = 身份核验(你是谁) + 资产核验(你有什么)。核验依赖第三方数据源(政府/机构API)，这是不可控的I/O瓶颈。系统设计核心是把这个慢I/O异步化，让用户体验不受影响。
  derivation: 假设第三方认证API平均响应2-5s，同步等待 → 用户请求超时。异步化后：提交<100ms返回，后台异步认证，30s-2min内出结果。亿级用户分批处理，控制第三方API QPS不超限。
  conclusion: 架构 = 提交API(快速入队) + MQ异步认证 + 加密存储 + 状态轮询/推送 + 多国合规策略。
follow_up:
- 身份信息泄露怎么办？
- 第三方认证服务挂了怎么办？
- 如何支持不同国家的合规要求？
- 一个人认证多辆车如何处理？
---

# 亿级车主完成实名认证（身份、车辆信息核验），如何设计后端架构，保证核验高效、数据安全且符合全球合规要求？

## 🎯 本质

```
认证流程 = 提交资料(快) → 异步核验(慢,调第三方) → 结果回调(推/拉) → 加密存储(安全)
```

| 维度 | 挑战 | 方案 |
|------|------|------|
| **性能** | 第三方API慢(2-5s) | 异步MQ解耦 |
| **安全** | 身份证/护照等敏感数据 | AES-256加密 + 脱敏存储 |
| **合规** | 各国隐私法规不同 | 多区域数据中心 + 数据本地化 |
| **可用性** | 第三方API不可用 | 降级策略 + 重试机制 |

---

## 🧒 类比

想象一个**全球签证中心**：
1. **前台**：快速收取申请材料（提交API，秒级返回）
2. **审批室**：联系各国使馆核验（异步调第三方API）
3. **保险箱**：材料加密存放（敏感数据加密存储）
4. **通知栏**：审批结果短信/邮件通知（结果回调推送）
5. **合规墙**：不同国家用不同流程（多国合规策略）

---

## 📊 整体架构图

```
┌──────────────────────────────────────────────────────────────┐
│                    车主 App / Web                             │
│         提交身份证/护照 + 车辆信息 → 状态查询                    │
└──────────────────────┬───────────────────────────────────────┘
                       │
┌──────────────────────▼───────────────────────────────────────┐
│                    API 网关 (TLS)                              │
│            鉴权 / 限流 / WAF防护                                │
└──────────────────────┬───────────────────────────────────────┘
                       │
┌──────────────────────▼───────────────────────────────────────┐
│                 认证提交服务 (快速入队)                          │
│   ① 数据加密(AES-256)                                          │
│   ② 生成认证请求 → 写入MQ                                       │
│   ③ 返回 pending 状态 (< 100ms)                                │
└──────┬───────────────────────────────────────────────────────┘
       │
┌──────▼───────────────────────────────────────────────────────┐
│                    MQ 消息队列                                  │
│         按国家/认证类型分Topic                                    │
│    kyc-cn / kyc-us / kyc-eu / kyc-vehicle                     │
└──────┬───────────────────────────────────────────────────────┘
       │
┌──────▼───────────────────────────────────────────────────────┐
│               异步认证消费者集群                                 │
│   ┌──────────────┐  ┌──────────────┐  ┌──────────────┐     │
│   │ 中国公安API   │  │ 美国DMV API  │  │ EU GDPR API  │     │
│   │ 身份核验      │  │ 车辆登记核验  │  │ 合规检查      │     │
│   └──────────────┘  └──────────────┘  └──────────────┘     │
│         限流(令牌桶) / 重试(指数退避) / 超时降级                 │
└──────┬───────────────────────────────────────────────────────┘
       │
┌──────▼───────────────────────────────────────────────────────┐
│              加密存储 + 结果通知                                 │
│   ① 认证结果 → AES加密 → MySQL(分库分表)                       │
│   ② 状态更新 → Redis (供查询)                                   │
│   ③ 结果通知 → WebSocket/推送                                   │
└──────────────────────────────────────────────────────────────┘
```

---

## 🔧 详解

### 1. 认证状态机

```
                     ┌──────────┐
       提交认证 ───→ │ PENDING  │ ───→ 等待处理
                     └────┬─────┘
                          │ 消费者取出
                     ┌────▼─────┐
                     │VERIFYING │ ───→ 调第三方API中
                     └────┬─────┘
                     ┌────┴──────────┐
                     │               │
                ┌────▼────┐    ┌────▼────┐
                │ SUCCESS │    │ FAILED  │
                └─────────┘    └────┬────┘
                                    │ 可重试
                               ┌────▼────┐
                               │  RETRY  │ ──→ 重新VERIFYING
                               └─────────┘
```

### 2. 敏感数据加密方案

```java
// 提交认证：敏感字段在API层就加密
@Service
public class KYCService {

    @Autowired private EncryptionService encryption;

    public SubmitResult submit(KYCRequest request) {
        // ① 敏感字段加密（AES-256-GCM）
        EncryptedData encId = encryption.encrypt(request.getIdNumber());
        EncryptedData encName = encryption.encrypt(request.getRealName());

        // ② 幂等检查：同一用户不重复提交
        String idempotentKey = "kyc:submit:" + request.getUserId();
        if (redis.exists(idempotentKey)) {
            return SubmitResult.alreadyPending();
        }
        redis.setex(idempotentKey, 3600, "1");

        // ③ 生成认证任务 → 写入MQ
        KYCTask task = new KYCTask();
        task.setTaskId(UUID.randomUUID().toString());
        task.setUserId(request.getUserId());
        task.setCountry(request.getCountry());
        task.setEncryptedId(encId.getCiphertext());
        task.setEncryptedName(encName.getCiphertext());

        // 按国家路由到不同Topic
        String topic = "kyc-" + request.getCountry().toLowerCase();
        mq.send(topic, task);

        // ④ 快速返回pending状态
        redis.setex("kyc:status:" + task.getTaskId(), 86400, "PENDING");
        return SubmitResult.pending(task.getTaskId());
    }
}
```

### 3. 异步认证消费者

```java
// 认证消费者：调用第三方API
@RocketMQMessageListener(topic = "kyc-cn")
public class ChinaKYCConsumer implements RocketMQListener<KYCTask> {

    @Override
    public void onMessage(KYCTask task) {
        String statusKey = "kyc:status:" + task.getTaskId();

        try {
            // ① 状态更新为 VERIFYING
            redis.set(statusKey, "VERIFYING");

            // ② 解密敏感数据
            String idNumber = encryption.decrypt(task.getEncryptedId());
            String realName = encryption.decrypt(task.getEncryptedName());

            // ③ 调用公安身份核验API（限流 + 重试）
            KYCVerifyResult result = retryCallAPI(() ->
                chinaPoliceAPI.verify(idNumber, realName)
            );

            // ④ 写入认证结果（加密存储）
            saveResult(task, result);

            // ⑤ 更新状态 + 推送通知
            if (result.isSuccess()) {
                redis.set(statusKey, "SUCCESS");
                pushService.send(task.getUserId(), "实名认证通过！");
            } else {
                redis.set(statusKey, "FAILED:" + result.getReason());
                pushService.send(task.getUserId(), "认证失败：" + result.getReason());
            }

        } catch (ThirdPartyTimeoutException e) {
            // ⑤ 降级：进入重试队列
            redis.set(statusKey, "RETRY");
            mq.sendDelay("kyc-cn", task, 5, TimeUnit.MINUTES);
        }
    }
}
```

### 4. 多国合规策略

```java
// 合规策略工厂：不同国家不同处理
public interface CompliancePolicy {
    String getCountry();
    boolean validate(KYCRequest req);
    Duration getRetentionPeriod();   // 数据保留期限
    boolean requiresDataLocalization(); // 是否要求数据不出境
}

@Component
public class ChinaPolicy implements CompliancePolicy {
    public String getCountry() { return "CN"; }
    public Duration getRetentionPeriod() { return Duration.ofDays(365 * 3); }
    public boolean requiresDataLocalization() { return true; } // 数据必须存中国
}

@Component
public class EUPolicy implements CompliancePolicy {
    public String getCountry() { return "EU"; }
    public Duration getRetentionPeriod() { return Duration.ofDays(90); }
    // GDPR: 用户有权要求删除数据（被遗忘权）
    public boolean supportsRightToErasure() { return true; }
}

@Component
public class USPolicy implements CompliancePolicy {
    public String getCountry() { return "US"; }
    public Duration getRetentionPeriod() { return Duration.ofDays(365 * 2); }
    // CCPA: 用户有权要求导出数据
    public boolean supportsDataExport() { return true; }
}
```

---

## ❓ 发散追问

### Q1：身份信息泄露怎么办？

- **加密存储**：AES-256加密所有敏感字段，密钥用HSM/KMS管理
- **脱敏展示**：前端只显示 `张*` / `320***********1234`
- **访问审计**：每次查询敏感数据记录日志 + 异常访问告警
- **数据最小化**：只存必要字段，核验完成后部分字段自动删除

### Q2：第三方认证服务挂了怎么办？

1. **重试队列**：超时/失败的任务进入延迟重试队列
2. **多供应商**：主备双供应商，一家挂了切另一家
3. **降级模式**：暂时接受"待核验"状态，允许使用部分功能
4. **人工兜底**：积压任务转人工审核通道

### Q3：一个人认证多辆车如何处理？

- **人车绑定关系表**：一个认证ID关联多个VIN
- **增量认证**：已认证车主添加新车时，复用身份认证，只核验车辆信息
- **家庭账户**：支持多人共享车辆，每人独立认证
