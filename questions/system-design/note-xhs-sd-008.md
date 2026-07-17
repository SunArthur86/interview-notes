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
## 苏格拉底式面试追问

> 这组追问模拟面试官层层逼问，每一问先回答"为什么"，再回答"怎么做"，最后回答"如何证明"。

### 第一层：目标与动机

**Q：多 AI 厂商适配你为什么用适配器模式而不是直接 if-else 判断厂商？**

因为厂商会增减且 API 差异大。每家厂商的请求格式（OpenAI 的 `/v1/chat/completions` vs Claude 的 `/v1/messages`）、认证方式（Bearer token vs API key）、响应结构都不同。if-else 判断厂商会在业务代码里充斥"if vendor == openai then ... else if vendor == claude then ..."，新增厂商要改几十处。适配器模式把每家厂商的 API 封装成独立的 Adapter（实现统一的 AIModelAdapter 接口），业务层只调统一接口，新增厂商只加 Adapter 类不改业务代码。决策依据：厂商数量 > 2 且 API 差异大，必须用适配器模式解耦。

### 第二层：证据与定位

**Q：用户反馈"AI 回答突然变差了"（之前用 GPT-4 现在好像降级了），怎么定位是路由切了厂商还是厂商自身变差？**

查路由决策日志：
1. 路由记录——查 AI 网关的路由日志，这次请求被路由到哪个厂商/模型。如果从 OpenAI 切到了通义千问（可能是 OpenAI 限流触发降级），是路由切换导致质量变化。
2. 降级链——看是否触发了 failover（OpenAI 超时/限流 → 自动切到备用厂商）。
3. 模型版本——即使是同一厂商，可能从 GPT-4 切到了 GPT-3.5（成本优化路由策略），确认路由配置。

### 第三层：根因深挖

**Q：路由配置没变（应该用 OpenAI），但实际请求被发到了通义千问，根因是什么？**

最可能是 failover 降级被触发。AI 网关通常配置降级链：OpenAI → Claude → 通义千问。如果 OpenAI 的 API 超时（网络抖动）或限流（QPS 超限），网关自动 failover 到下一个厂商。用户看到的"变差"是因为降级到了能力较弱的模型。根因是 OpenAI 的可用性问题（超时/限流）。要看网关的上游调用日志，确认 OpenAI 的错误率和限流情况。如果频繁降级，要么提升 OpenAI 的配额，要么优化降级策略（优先降级到 Claude 而非通义）。

**Q：为什么不直接只用一家厂商（OpenAI），不用搞多厂商适配的复杂度？**

因为单点风险和成本。① 单点风险——OpenAI 宕机（曾发生多次大面积故障）或限流（高峰期 QPS 被限），业务直接不可用；② 成本——OpenAI 最贵，所有任务都用 GPT-4 成本爆炸，简单任务（如分类、摘要）用便宜模型即可；③ 合规——某些行业/地区要求数据不出境（中国不能用 OpenAI，要用国产模型）。多厂商适配是"可用性 + 成本 + 合规"的综合考量，不是技术炫技。单厂商适合"小规模 + 容忍停服"的场景，生产级 AI 应用必须多厂商。

### 第四层：方案权衡

**Q：路由策略你按"任务类型选模型"（翻译用 GPT-4、分类用 GPT-3.5），怎么决定哪个任务用哪个模型？**

基于效果 + 成本的 A/B 测试：
1. 离线评估——用标注数据集测试各模型在每个任务上的准确率（如翻译 BLEU 分数、分类 F1）。GPT-4 翻译 BLEU 0.85、GPT-3.5 BLEU 0.78，如果业务要求 > 0.8，翻译必须用 GPT-4。
2. 成本核算——GPT-4 的 token 价格是 GPT-3.5 的 10 倍。如果分类任务 GPT-3.5 准确率 95%、GPT-4 是 96%，1% 的提升不值 10 倍价格，分类用 GPT-3.5。
3. 动态调整——路由策略配置化，运营根据业务效果和成本动态调整（如大促期间为了省钱把更多任务切到便宜模型）。

**Q：为什么不直接所有任务都用最强的模型（GPT-4），反正效果最好？**

因为成本不可控。GPT-4 的 token 价格约 $0.03/1K（输入），一次复杂对话可能消耗 2000 token = $0.06。日均百万次调用 = $60000/天 = 月 $180 万。如果 70% 的任务（简单分类、FAQ）切到 GPT-3.5（$0.002/1K，便宜 15 倍），月成本降到 $60 万，省 60%+。而且最强模型未必在所有任务上最好——某些垂直任务（如中文古文翻译）国产模型可能优于 GPT-4。按任务匹配最优模型，是效果和成本的帕累托最优。

### 第五层：验证与沉淀

**Q：你怎么证明多厂商适配的降级容错真的有效（一家挂了业务不受影响）？**

混沌演练：
1. 主动封禁厂商——在网关层模拟 OpenAI 超时/限流（配置熔断器，10 秒内错误率 > 50% 触发降级），观察是否自动切到 Claude。
2. 切换时间——从 OpenAI 故障到切到 Claude 的耗时，应该 < 1 秒（用户几乎无感）。
3. 恢复验证——OpenAI 恢复后，网关是否自动切回（避免长期用备用厂商增加成本）。

**Q：AI 网关架构怎么沉淀？**

1. AI 网关 SDK——把"适配器 + 路由 + 降级 + 计费 + 限流"封装成网关组件，各业务线统一接入，不用各自对接厂商。
2. 模型评估平台——自动化评估各模型在各任务上的效果 + 成本，为路由策略提供数据支撑。
3. 成本管控——Token 预算管理（每个业务/用户每日 token 上限），超预算自动降级到便宜模型或拒绝服务。


## 结构化回答

**30 秒电梯演讲：** AI网关模式就是定义一套统一的接口（适配器模式），让业务层不关心底层调的是哪家AI厂商。

**展开框架：**
1. **适配器模式** — 统一接口+各厂商Adapter实现
2. **路由策略** — 按任务类型/成本/质量/延迟选模型
3. **降级容错** — failover chain自动切换厂商

**收尾：** 这块我踩过坑——要不要深入聊：AI网关如何做成本优化？Token预算管理怎么做？

## 视频脚本

> 预计时长：4 分钟 | 由浅入深

| 时间 | 画面/字幕 | 口播台词 | 讲解要点 |
|------|----------|----------|----------|
| 0:00 | 标题卡 | "架构设计一句话：AI网关模式就是定义一套统一的接口（适配器模式），让业务层不关心底层调的是哪家AI厂商。各厂商API差异封装在各自的Adapter里…。" | 开场钩子 |
| 0:15 | 缓存读写策略流程图 | "适配器模式：统一接口+各厂商Adapter实现" | 适配器模式 |
| 1:08 | 缓存读写策略流程图分步演示 | "路由策略：按任务类型/成本/质量/延迟选模型" | 路由策略 |
| 2:01 | 关键代码/伪代码片段 | "降级容错：failover chain自动切换厂商" | 降级容错 |
| 2:54 | 对比表格 | "工程化：计费/缓存/限流/审计/灰度" | 工程化 |
| 3:50 | 总结卡 | "核心抓住这条主线，下期咱们接着聊：AI网关如何做成本优化？Token预算管理怎么做。" | 收尾 |
