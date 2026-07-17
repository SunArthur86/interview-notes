---
id: note-xhs-sd-010
difficulty: L5
category: system-design
subcategory: 架构设计
tags:
- Kubernetes
- 可观测性
- Prometheus
- SkyWalking
- 运维
feynman:
  essence: K8s配置管理用ConfigMap(普通)+Secret(敏感)分离管理。可观测性三支柱：Metrics(指标/Prometheus)+Logging(日志/ELK)+Tracing(链路/SkyWalking)，分别回答「系统状态」「发生了什么」「请求经过了哪」。
  analogy: "配置管理像公司的文件柜：ConfigMap是公开的操作手册（谁都能看），Secret是保险柜（只有授权人能看密码）。可观测性像医院的监护系统：Metrics是体温血压(实时数值)，Logging是病历(详细记录)，Tracing是转诊单(记录患者经过了哪些科室)。"
  key_points:
  - 配置管理：ConfigMap+Secret，支持envFrom和volumeMount
  - 动态配置：@RefreshScope热更新或Nacos/Apollo
  - 可观测三支柱：Metrics+Logging+Tracing
  - 'Metrics: Prometheus+Grafana+Micrometer'
  - 'Logging: 结构化JSON日志→EFK栈'
  - 'Tracing: SkyWalking/Jaeger+Java Agent'
first_principle:
  problem: "分布式微服务环境下，系统由几十个服务组成，如何管理配置和观测系统健康状态？"
  axioms:
  - 配置应与代码分离（12-Factor App原则）
  - 可观测性是分布式系统的「免疫系统」——没有可观测性的系统无法运维
  - Metrics回答「what」（指标异常）、Logging回答「why」（原因）、Tracing回答「where」（位置）
  - K8s的声明式配置 + Secret加密 + 动态刷新 = 生产级配置管理
  rebuild: "从分布式运维需求出发：ConfigMap+Secret(配置分离)→Prometheus(指标监控+告警)→EFK(日志聚合搜索)→SkyWalking(全链路追踪)。三者互补形成完整的可观测性体系，缺一不可"
follow_up:
- K8s 中如何做滚动更新和优雅停机？
- Prometheus 的 Pull 和 Push 模式有什么区别？K8s 用哪个？
- 如何用 SkyWalking 排查慢请求？Trace 和 Span 的关系？
- AI服务的 SLA 怎么定义？P99 延迟如何优化？
---

# K8s 环境下的配置管理与可观测性方案如何设计？（入职Java复盘）

## 一、K8s 配置管理

### ConfigMap + Secret 分层管理

```yaml
# 1. 普通配置 → ConfigMap
apiVersion: v1
kind: ConfigMap
metadata:
  name: ai-service-config
data:
  application.yaml: |
    ai:
      providers:
        openai:
          base-url: https://api.openai.com
          timeout: 30000
        claude:
          base-url: https://api.anthropic.com
          timeout: 60000
      cache:
        l1-ttl: 300
        l2-ttl: 600

---
# 2. 敏感信息 → Secret（base64编码）
apiVersion: v1
kind: Secret
metadata:
  name: ai-service-secret
type: Opaque
data:
  openai-api-key: c2st4ByT...   # echo -n "sk-xxx" | base64
  claude-api-key: c2stYW50aA...

---
# 3. Pod 挂载配置
apiVersion: apps/v1
kind: Deployment
metadata:
  name: ai-service
spec:
  template:
    spec:
      containers:
      - name: app
        image: ai-service:v1.0
        envFrom:
        - configMapRef:
            name: ai-service-config
        - secretRef:
            name: ai-service-secret
        # 或者挂载为文件
        volumeMounts:
        - name: config-volume
          mountPath: /app/config
      volumes:
      - name: config-volume
        configMap:
          name: ai-service-config
```

### 动态配置更新（无需重启Pod）

```java
// Spring Cloud Kubernetes 动态刷新
@RefreshScope
@RestController
public class AIController {
    
    @Value("${ai.providers.openai.timeout:30000}")
    private int openaiTimeout;  // ConfigMap更新后自动刷新
    
    @Value("${ai.cache.l1-ttl:300}")
    private int l1CacheTTL;
}

// 或使用 Nacos/Apollo 做配置中心
@NacosConfigListener(dataId = "ai-service.yaml")
public void onConfigUpdate(String config) {
    // 配置变更时回调，热更新
    refreshConfig(config);
}
```

## 二、可观测性三支柱

```
┌──────────────────────────────────────────────────┐
│              可观测性 (Observability)              │
│                                                    │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐       │
│  │ Metrics  │  │ Logging  │  │ Tracing  │       │
│  │ 指标监控  │  │ 日志聚合  │  │ 链路追踪  │       │
│  │(Prometheus│  │(ELK/LoKi)│  │(SkyWalking│       │
│  │ +Grafana) │  │          │  │ /Jaeger) │       │
│  └──────────┘  └──────────┘  └──────────┘       │
│                                                    │
│  "系统现在什么状态"  "发生了什么"  "请求经过了哪里"    │
└──────────────────────────────────────────────────┘
```

## 三、Metrics 指标监控（Prometheus + Grafana）

### Spring Boot Actuator + Micrometer

```java
@Service
public class AIChatService {
    
    private final MeterRegistry registry;
    private final Counter requestCounter;
    private final Timer responseTimer;
    private final Gauge cacheHitGauge;
    
    public AIChatService(MeterRegistry registry) {
        this.registry = registry;
        this.requestCounter = Counter.builder("ai.chat.requests")
            .tag("provider", "openai")
            .register(registry);
        this.responseTimer = Timer.builder("ai.chat.latency")
            .register(registry);
    }
    
    public ChatResponse chat(String prompt) {
        return responseTimer.record(() -> {
            requestCounter.increment();
            // 业务逻辑
            return doChat(prompt);
        });
    }
}
```

### 关键监控指标

```
┌────────────────────────────────────────────────┐
│  Grafana Dashboard 核心面板                      │
│                                                  │
│  📊 业务指标                                      │
│  • ai_chat_requests_total (QPS)                 │
│  • ai_chat_latency_seconds (P50/P95/P99延迟)    │
│  • ai_chat_tokens_total (Token消耗速率)          │
│  • ai_chat_cost_dollars (实时成本)               │
│  • ai_cache_hit_ratio (缓存命中率)               │
│                                                  │
│  📊 系统指标                                      │
│  • jvm_memory_used_bytes (JVM内存)               │
│  • jvm_gc_pause_seconds (GC暂停)                │
│  • process_cpu_usage (CPU使用率)                 │
│  • http_server_requests_seconds (HTTP延迟)       │
│                                                  │
│  📊 K8s指标                                      │
│  • kube_pod_status_phase (Pod状态)               │
│  • container_cpu_usage_seconds (容器CPU)         │
│  • container_memory_working_set_bytes (容器内存) │
└────────────────────────────────────────────────┘
```

### 告警规则

```yaml
# Prometheus Alert Rule
groups:
- name: ai-service-alerts
  rules:
  # AI API延迟过高
  - alert: HighAILatency
    expr: histogram_quantile(0.99, ai_chat_latency_seconds_bucket) > 5
    for: 5m
    labels:
      severity: warning
    annotations:
      summary: "AI API P99延迟超过5秒"
  
  # 错误率过高
  - alert: HighErrorRate
    expr: rate(ai_chat_errors_total[5m]) / rate(ai_chat_requests_total[5m]) > 0.05
    for: 2m
    labels:
      severity: critical
    annotations:
      summary: "AI服务错误率超过5%"
  
  # Pod重启
  - alert: PodRestart
    expr: increase(kube_pod_container_status_restarts_total[1h]) > 3
    labels:
      severity: critical
```

## 四、Logging 日志聚合

### 结构化日志（JSON格式）

```java
// 使用 SLF4J + Logback JSON格式
@Slf4j
@Service
public class AIChatService {
    
    public ChatResponse chat(ChatRequest request) {
        // 结构化日志：方便ELK搜索和聚合
        log.info(JSON.toJSONString(Map.of(
            "event", "ai_chat_start",
            "request_id", MDC.get("requestId"),
            "provider", request.getModel(),
            "prompt_length", request.getPrompt().length(),
            "user_id", request.getUserId()
        )));
        
        ChatResponse response = doChat(request);
        
        log.info(JSON.toJSONString(Map.of(
            "event", "ai_chat_complete",
            "request_id", MDC.get("requestId"),
            "tokens_used", response.getUsage().getTotalTokens(),
            "latency_ms", elapsedMs,
            "status", "success"
        )));
        
        return response;
    }
}
```

### EFK 日志栈（K8s环境）

```
Pod → Fluent Bit(边车/DaemonSet) → Elasticsearch → Kibana

日志查询示例（Kibana KQL）：
  event: "ai_chat_error" AND provider: "openai" AND latency_ms > 3000
```

## 五、Tracing 链路追踪

### SkyWalking / Jaeger

```java
// Spring Boot 自动接入（Java Agent方式）
// 启动参数：-javaagent:/skywalking-agent.jar

// 手动添加Span
@Trace
public ChatResponse chat(String prompt) {
    // 自动生成Trace Span
    TraceContext.putCorrelation("user_id", userId);
    TraceContext.putCorrelation("prompt_hash", md5(prompt));
    
    ChatResponse response = aiAdapter.chat(request);
    
    // 记录自定义标签
    Span.current().setTag("tokens", response.getUsage().getTotalTokens());
    Span.current().setTag("provider", "openai");
    
    return response;
}
```

### 链路追踪视图

```
Trace: user_id=1001 request_id=abc123
│
├── [2ms] Gateway → ai-service
│   ├── [5ms] AIChatService.chat()
│   │   ├── [1ms] L1 Caffeine cache miss
│   │   ├── [3ms] L2 Redis cache miss
│   │   ├── [1500ms] OpenAI API call  ← 瓶颈！
│   │   └── [2ms] Redis cache set
│   └── [1ms] Response
│
总耗时: 1512ms
瓶颈定位: OpenAI API调用占99%
```
## 苏格拉底式面试追问

> 这组追问模拟面试官层层逼问，每一问先回答"为什么"，再回答"怎么做"，最后回答"如何证明"。

### 第一层：目标与动机

**Q：K8s 配置管理你为什么用 ConfigMap + Secret 分离，而不是全放 Secret（反正都能用）？**

因为权限隔离和审计。ConfigMap 存非敏感配置（如日志级别、功能开关），所有开发可见可改。Secret 存敏感信息（数据库密码、API Key），只有运维和特定服务可见。如果全放 Secret，开发要看个日志级别都要申请 Secret 权限，效率低。而且 Secret 的访问受 RBAC 控制，读取有审计日志（谁在什么时候读了哪个 Secret），全放 Secret 会让审计日志爆炸（全是非敏感配置的读取记录）。决策依据：敏感度分级管理，ConfigMap 管普通配置（便利），Secret 管敏感配置（安全）。

### 第二层：证据与定位

**Q：服务启动报"连接 DB 失败"，你怎么定位是 Secret 配错了还是 DB 本身的问题？**

查三个层面：
1. Secret 注入——进 Pod 检查环境变量（`echo $DB_PASSWORD`）或挂载的文件，确认 Secret 的值是否正确（不是 base64 编码的原文，是解码后的密码）。
2. 网络连通——从 Pod 内 `telnet db-host 3306` 或 `nc -zv db-host 3306`，确认网络可达（K8s NetworkPolicy 或安全组可能拦截）。
3. DB 本身——用正确的密码从本地连接 DB，确认 DB 服务正常 + 密码有效。

### 第三层：根因深挖

**Q：Secret 的密码是对的（本地能连），网络也通，但 Pod 里连 DB 失败，根因是什么？**

最可能是 Secret 的 base64 编解码问题。K8s 的 Secret 要求值是 base64 编码（`echo -n "password" | base64`），如果创建 Secret 时密码包含了特殊字符（如 `$`、`!`）且编码时被 shell 转义，实际存入的值与预期不同。另一种可能是 Secret 的 namespace 不对——Secret 必须与 Pod 在同一 namespace，跨 namespace 引用 Secret 会找不到。还有一种可能是 `envFrom` 或 `valueFrom` 的引用路径写错（`secretKeyRef` 的 name 或 key 不匹配）。要在 Pod 里打印实际拿到的值（注意脱敏）确认。

**Q：为什么不直接把密码写死在镜像里（Dockerfile 里 ENV DB_PASSWORD=xxx），不就不用 Secret 了？**

因为安全风险和灵活性。① 安全——镜像会被推到镜像仓库，任何能拉镜像的人都能看到密码（镜像分层，ENV 在元数据层可见）；② 灵活性——不同环境（dev/staging/prod）用不同密码，写死镜像要构建多个镜像，维护成本高；③ 轮换——密码泄露后要更换，写死镜像要重新构建 + 重新部署，Secret 只更新 Secret 对象即可（Pod 重启生效）。12-Factor App 原则要求"配置与代码分离"，Secret 是这一原则的 K8s 实现。写死镜像是反模式。

### 第四层：方案权衡

**Q：配置热更新你用 @RefreshScope（Spring Cloud）还是 Nacos/Apollo（配置中心），怎么选？**

按配置变更频率和场景选：
1. @RefreshScope——配合 Spring Cloud Config + Bus，ConfigMap 变更时触发 webhook → Bus 广播 → 各实例刷新 @RefreshScope Bean。适合"K8s 原生 + 变更频率低"。
2. Nacos/Apollo——独立配置中心，客户端长轮询监听变更，实时推送。适合"变更频率高 + 需要灰度发布 + 多环境管理"。

**Q：为什么不直接全用 K8s ConfigMap + @RefreshScope，而要引入 Nacos 增加复杂度？**

因为 ConfigMap 的热更新有局限。① ConfigMap 变更后 Pod 不会自动感知（要靠 reloader 或手动重启），@RefreshScope 只刷新特定 Bean，全量配置变更不生效；② ConfigMap 没有灰度发布能力（改了 ConfigMap 所有 Pod 同时生效，无法"A/B 测试"）；③ ConfigMap 没有版本管理和回滚（改错了要手动改回来）。Nacos/Apollo 提供"灰度发布、版本回滚、多环境隔离、变更审计"，适合"配置频繁变更 + 需要精细化管控"的生产场景。简单场景用 ConfigMap 足够，复杂场景用配置中心。

### 第五层：验证与沉淀

**Q：可观测性三支柱（Metrics + Logging + Tracing）你怎么证明覆盖了所有关键场景？**

用故障排查能力验证：
1. Metrics 能发现问题——告警触发（如 P99 延迟 > 500ms），说明 Metrics 覆盖了关键指标。
2. Logging 能定位原因——根据告警时间点查日志，找到具体错误（如 OOM、DB 超时），说明 Logging 记录了关键事件。
3. Tracing 能定位位置——根据 trace ID 找到慢请求经过的链路（如 Gateway → Service A → Service B → DB），精确定位是 B → DB 慢，说明 Tracing 覆盖了全链路。
如果某个环节排查不出来，说明对应支柱有盲区（如没有 RPC 调用的 trace span），要补全。

**Q：K8s 配置与可观测性方案怎么沉淀？**

1. 配置管理规范——"敏感信息用 Secret、普通配置用 ConfigMap、动态配置用 Nacos"的分层规范，团队统一执行。
2. 可观测性模板——Prometheus 指标命名规范（如 `http_server_requests_seconds`）、日志结构化格式（JSON + traceId）、Trace 采样率策略，新服务接入即用。
3. 故障排查 SOP——"告警 → 看指标定方向 → 看 trace 定位置 → 看日志定原因"的标准流程，新人值班按 SOP 执行。


## 结构化回答

**30 秒电梯演讲：** K8s配置管理用ConfigMap(普通)+Secret(敏感)分离管理。

**展开框架：**
1. **配置管理** — ConfigMap+Secret，支持envFrom和volumeMount
2. **动态配置** — @RefreshScope热更新或Nacos/Apollo
3. **可观测三支柱** — Metrics+Logging+Tracing

**收尾：** 这块我踩过坑——要不要深入聊：K8s 中如何做滚动更新和优雅停机？

## 视频脚本

> 预计时长：4 分钟 | 由浅入深

| 时间 | 画面/字幕 | 口播台词 | 讲解要点 |
|------|----------|----------|----------|
| 0:00 | 标题卡 | "架构设计一句话：K8s配置管理用ConfigMap(普通)+Secret(敏感)分离管理…。" | 开场钩子 |
| 0:15 | 架构示意图 | "配置管理：ConfigMap+Secret，支持envFrom和volumeMount" | 配置管理 |
| 1:08 | 架构示意图分步演示 | "动态配置：@RefreshScope热更新或Nacos/Apollo" | 动态配置 |
| 2:01 | 关键代码/伪代码片段 | "可观测三支柱：Metrics+Logging+Tracing" | 可观测三支柱 |
| 2:54 | 对比表格 | "Metrics: Prometheus+Grafana+Micrometer" | Metrics |
| 3:50 | 总结卡 | "核心抓住这条主线，下期咱们接着聊：K8s 中如何做滚动更新和优雅停机。" | 收尾 |
