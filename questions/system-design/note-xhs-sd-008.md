---
id: note-xhs-sd-008
difficulty: L5
category: system-design
subcategory: 架构设计
tags:
- AI网关
- 适配器模式
- 多模型
- 策略模式
- LLM
feynman:
  essence: AI网关模式就是定义一套统一的接口（适配器模式），让业务层不关心底层调的是哪家AI厂商。各厂商API差异封装在各自的Adapter里，路由层决定用哪个厂商。
  analogy: "AI网关像国际快递公司。你只需要说「寄到国外」，快递公司（网关）自动选择走空运(OpenAI快)、海运(通义便宜)还是陆运(文心)。你不用关心每家航空公司的规定，快递公司帮你处理所有差异。"
  key_points:
  - 适配器模式：统一接口+各厂商Adapter实现
  - 路由策略：按任务类型/成本/质量/延迟选模型
  - 降级容错：failover chain自动切换厂商
  - 工程化：计费/缓存/限流/审计/灰度
  - 设计模式：Adapter(接口适配)+Strategy(路由)+Factory(创建)
first_principle:
  problem: "多个AI厂商API格式各异，业务代码不应与具体厂商耦合。如何设计可扩展的多模型适配架构？"
  axioms:
  - 依赖倒置：业务层依赖抽象接口，不依赖具体厂商
  - 开闭原则：新增厂商不改现有代码（加新Adapter即可）
  - 单一职责：适配器只做格式转换，路由只做决策
  - 故障隔离：单个厂商故障不影响其他厂商
  rebuild: "从多厂商适配需求出发：定义统一接口(AIModelAdapter)→各厂商实现(OpenAIAdapter/ClaudeAdapter)→路由层选最优(策略模式)→降级链容错→网关层加缓存/计费/限流。核心是适配器模式解耦业务与厂商"
follow_up:
- AI网关如何做成本优化？Token预算管理怎么做？
- 多个AI厂商的流式响应格式不同，如何统一？
- 如何防止Prompt注入攻击？AI网关的安全策略？
- OpenAI的Function Calling和Claude的Tool Use如何统一适配？
---

# 如何设计多 AI 厂商接口统一适配方案？（入职Java复盘）

## 一、问题背景

```
现实场景：
  - 业务需要调用多个AI厂商（OpenAI/Claude/通义千问/文心/智谱）
  - 每个厂商的API格式不同（请求参数、响应结构、认证方式）
  - 厂商可能宕机/限流/涨价 → 需要快速切换
  - 不同模型擅长不同任务 → 需要动态路由

OpenAI:    POST /v1/chat/completions  {model, messages, stream}
Claude:    POST /v1/messages           {model, messages, max_tokens}
通义千问:   POST /api/v1/services/aigc/text-generation/generation
文心一言:   POST /rpc/2.0/ai_custom/v1/wenxinworkshop/chat/{model}
```

## 二、架构设计：AI 网关模式

```
                    ┌─────────────────────────────┐
                    │       业务应用层              │
                    │   chatService.chat(prompt)   │
                    └────────────┬────────────────┘
                                 │
                    ┌────────────▼────────────────┐
                    │       AI 网关 (Gateway)       │
                    │                              │
                    │  ┌─────────────────────┐    │
                    │  │  路由策略层           │    │
                    │  │  (成本/质量/延迟/地域) │    │
                    │  └──────────┬──────────┘    │
                    │             │                │
                    │  ┌──────────▼──────────┐    │
                    │  │  统一接口适配层        │    │
                    │  │  Adapter Pattern     │    │
                    │  └──────────┬──────────┘    │
                    │             │                │
                    │  ┌─────┬────┴───┬─────┐     │
                    │  │     │        │     │     │
                    │  ▼     ▼        ▼     ▼     │
                    │ OpenAI Claude 通义  文心    │
                    └──────────────────────────────┘
```

## 三、核心代码实现

### 1. 统一接口定义

```java
// 统一的请求/响应模型
@Data
public class ChatRequest {
    private String model;         // gpt-4, claude-3, qwen-max...
    private List<Message> messages;
    private Double temperature;
    private Integer maxTokens;
    private Boolean stream;       // 是否流式
    private Map<String, Object> extra; // 厂商特有参数
}

@Data
public class ChatResponse {
    private String content;
    private String finishReason;
    private Usage usage;          // token统计
    private String requestId;
}

@Data
public class Usage {
    private int promptTokens;
    private int completionTokens;
    private int totalTokens;
}

// 统一适配器接口
public interface AIModelAdapter {
    ChatResponse chat(ChatRequest request);
    Flux<String> streamChat(ChatRequest request);  // 流式
    String getProvider();  // "openai" / "claude" / "qwen"
    boolean isAvailable(); // 健康检查
}
```

### 2. 各厂商适配器实现

```java
@Component
public class OpenAIAdapter implements AIModelAdapter {
    
    @Value("${ai.openai.api-key}")
    private String apiKey;
    
    @Value("${ai.openai.base-url}")
    private String baseUrl;
    
    @Override
    public ChatResponse chat(ChatRequest request) {
        // 转换为OpenAI格式
        Map<String, Object> body = new HashMap<>();
        body.put("model", request.getModel());
        body.put("messages", request.getMessages());
        body.put("temperature", request.getTemperature());
        body.put("max_tokens", request.getMaxTokens());
        
        // 调用OpenAI API
        ResponseEntity<JsonNode> resp = restTemplate.postForEntity(
            baseUrl + "/v1/chat/completions",
            createHttpEntity(body),
            JsonNode.class
        );
        
        // 转换为统一响应
        return parseOpenAIResponse(resp.getBody());
    }
    
    @Override
    public Flux<String> streamChat(ChatRequest request) {
        request.setStream(true);
        return webClient.post()
            .uri(baseUrl + "/v1/chat/completions")
            .header("Authorization", "Bearer " + apiKey)
            .bodyValue(request)
            .retrieve()
            .bodyToFlux(String.class)
            .map(this::extractContent);
    }
    
    @Override
    public String getProvider() { return "openai"; }
}

@Component
public class ClaudeAdapter implements AIModelAdapter {
    @Override
    public ChatResponse chat(ChatRequest request) {
        // Claude特有：需要max_tokens（必填）、system单独传
        Map<String, Object> body = new HashMap<>();
        body.put("model", request.getModel());
        body.put("messages", extractNonSystemMessages(request));
        body.put("system", extractSystemMessage(request));
        body.put("max_tokens", request.getMaxTokens() != null ? 
                request.getMaxTokens() : 4096);  // Claude必填
        // ...调用 + 转换
    }
}
```

### 3. 路由策略层

```java
@Service
public class AIRouter {
    
    @Autowired
    private List<AIModelAdapter> adapters; // Spring自动注入所有适配器
    
    private final Map<String, AIModelAdapter> adapterMap;
    
    // 选择最优模型
    public AIModelAdapter select(ChatRequest request) {
        String model = request.getModel();
        
        // 策略1：指定模型 → 直接路由
        if (model != null) {
            return findByModel(model);
        }
        
        // 策略2：按任务类型路由
        String taskType = (String) request.getExtra().get("task_type");
        switch (taskType) {
            case "code": return getAdapter("claude");  // Claude擅长代码
            case "search": return getAdapter("qwen");   // 通义擅长搜索
            default: return getAdapter("openai");        // 默认GPT
        }
    }
    
    // 带降级的调用
    public ChatResponse chatWithFallback(ChatRequest request) {
        List<AIModelAdapter> chain = getFailoverChain(request);
        for (AIModelAdapter adapter : chain) {
            try {
                if (adapter.isAvailable()) {
                    return adapter.chat(request);
                }
            } catch (Exception e) {
                log.warn("{} failed: {}, trying next", 
                        adapter.getProvider(), e.getMessage());
            }
        }
        throw new AllProvidersFailedException("All AI providers failed");
    }
}
```

## 四、面试加分：AI网关工程化

```
┌──────────────────────────────────────────────────┐
│                 AI 网关核心能力                    │
├──────────────────────────────────────────────────┤
│                                                    │
│  1. 统一接口：业务层只对接一套API                   │
│                                                    │
│  2. 智能路由：按成本/延迟/质量自动选模型             │
│     • 代码任务 → Claude (质量优先)                │
│     • 简单问答 → GPT-3.5 (成本优先)               │
│     • 中文场景 → 通义/文心 (本地化)                │
│                                                    │
│  3. 降级容错：A厂商挂了自动切B厂商                  │
│                                                    │
│  4. 统一计费：Token统计+成本分摊                    │
│                                                    │
│  5. 安全审计：敏感词过滤+Prompt注入防护              │
│                                                    │
│  6. 缓存加速：相同请求直接返回缓存结果               │
│                                                    │
│  7. 限流熔断：保护下游API + 控制成本                │
│                                                    │
│  8. 灰度发布：新模型按比例灰度                      │
└──────────────────────────────────────────────────┘
```