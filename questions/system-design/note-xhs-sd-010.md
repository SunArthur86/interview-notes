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