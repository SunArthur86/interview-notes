---
id: note-xhs-ai-057
difficulty: L4
category: ai
subcategory: Agent
tags:
- Agent
- ToolCalling
- 会话记忆
- Java
- SpringAI
- FunctionCalling
source: 拼多多Java三轮技术面二面
feynman:
  essence: 用Java实现AI Agent需要三部分：工具注册与调用框架（Tool Registry + Function Calling）、会话记忆管理（短期对话历史+长期向量记忆）、对话编排引擎（ReAct循环：思考→调用→观察→回答）。
  analogy: AI Agent就像一个新来的客服——你给他一本工具手册（工具注册表），告诉他每个工具怎么用（schema描述），给他一个记事本记录和客户的对话（会话记忆），他就能根据客户问题自己决定用哪个工具、怎么用，最后给出回答。
  key_points:
  - 工具注册：Java方法通过注解/接口声明为Tool，自动生成schema给LLM
  - Function Calling：LLM返回结构化JSON调用指令，Java反射执行对应方法
  - 会话记忆：短期用对话列表（最近N轮），长期用向量数据库检索
  - ReAct循环：Think(分析)→Act(调用工具)→Observe(观察结果)→Answer(回答)
  - 安全护栏：参数校验+权限控制+工具调用审计
first_principle:
  problem: Java后端如何将LLM的推理能力与企业系统（订单查询、物流追踪、库存管理）集成，构建一个能自主决策和执行操作的智能体？
  axioms:
  - LLM只能输出文本，不能直接执行Java方法
  - 工具需要被LLM"看到"才能被"使用"——需要标准化描述
  - 多轮对话需要维护上下文——对话历史和长期记忆
  - Agent需要自主决策何时调用工具、调用哪个、用什么参数
  rebuild: 工具注册表（@Tool注解自动生成schema）→ LLM接收工具描述+用户问题 → 输出Function Calling JSON → Java反射执行 → 结果回传LLM → 循环直到完成。记忆层：Redis存短期对话，向量库存长期记忆。
follow_up:
  - Java实现Agent和Python（LangChain）比有什么优势和劣势？
  - 如果LLM返回的JSON格式不对（比如少了括号），怎么处理？
  - 会话记忆用Redis还是数据库？各有什么考虑？
  - Agent循环调用工具如果死循环了（一直在调用但解决不了问题），怎么终止？
  - Spring AI和LangChain4j在Agent实现上有什么区别？
memory_points:
  - Agent三要素：工具注册表（@Tool注解）+ Function Calling（LLM→JSON→反射）+ 会话记忆（短期Redis+长期向量）
  - ReAct循环：Think→Act→Observe→Answer，最多N轮防死循环
  - Spring AI @Tool注解自动生成schema，LangChain4j @P注解描述参数
  - 记忆分层：短期（对话窗口/摘要压缩）、长期（向量检索相似记忆）
---

# 【拼多多二面】用Java实现AI Agent：ToolCalling和会话记忆设计

## 🎯 一句话本质

Java实现AI Agent的三大组件：(1) **工具注册与调用**（`@Tool`注解声明→自动生成schema→LLM Function Calling→Java反射执行），(2) **会话记忆**（短期对话历史存Redis+长期记忆存向量库），(3) **ReAct编排循环**（思考→行动→观察→回答，限制最大轮次防死循环）。

## 🧒 费曼类比

```
AI Agent = 一个有工具箱的智能客服

工具箱（Tool Registry）：
  🔧 查订单（输入订单号 → 返回订单状态）
  📦 查物流（输入订单号 → 返回物流信息）  
  💰 查余额（输入用户ID → 返回账户余额）
  
记事本（会话记忆）：
  [短期] 最近5轮对话："用户问了订单OD001，物流到上海了..."
  [长期] 用户画像："这个用户常买电子产品，偏好顺丰快递"

工作流程（ReAct循环）：
  用户: "我的包裹到哪了？"
  
  Think: 用户想查物流，需要订单号，但用户没说。查记忆→最近提过OD001
  Act:   调用 查物流(orderId="OD001")
  Observe: 结果="已到达上海转运中心，预计明天送达"
  Answer: "您的包裹已到上海转运中心，预计明天就能送达！"
```

## 📊 Agent架构图

```
┌─────────────────────────────────────────────────────────────┐
│                    AI Agent 架构                              │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  ┌─────────────┐    ┌──────────────────────────────────┐   │
│  │  用户输入    │───→│        Agent编排引擎               │   │
│  │  "查下订单"  │    │  ┌────────────────────────────┐  │   │
│  └─────────────┘    │  │    ReAct 循环               │  │   │
│                     │  │                             │  │   │
│  ┌─────────────┐    │  │  Think: 分析需要什么工具      │  │   │
│  │  会话记忆    │←──→│  │  ACT:   Function Calling    │  │   │
│  │             │    │  │  OBSERVE: 接收工具返回        │  │   │
│  │ ┌─────────┐ │    │  │  ANSWER: 生成自然语言回复     │  │   │
│  │ │短期记忆  │ │    │  │                             │  │   │
│  │ │(Redis)  │ │    │  │  循环直到回答 或 达到最大轮次  │  │   │
│  │ ├─────────┤ │    │  └────────────────────────────┘  │   │
│  │ │长期记忆  │ │    └───────────┬──────────────────────┘   │
│  │ │(向量库) │ │                │                           │
│  │ └─────────┘ │                │                           │
│  └─────────────┘                │                           │
│                     ┌───────────▼──────────────────────┐    │
│                     │       工具注册表 (Tool Registry)    │    │
│                     │                                   │    │
│                     │  @Tool "queryOrder"               │    │
│                     │    → OrderService.findById()      │    │
│                     │  @Tool "queryLogistics"           │    │
│                     │    → LogisticsService.track()     │    │
│                     │  @Tool "getBalance"               │    │
│                     │    → AccountService.getBalance()  │    │
│                     └───────────────────────────────────┘    │
│                                                             │
│  ┌─────────────────────────────────────────────────────┐    │
│  │              安全护栏 (Safety Guardrails)              │    │
│  │  参数校验 | 权限控制 | 调用审计 | 敏感操作人工确认       │    │
│  └─────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────┘
```

## 🔧 核心代码实现

### 1. 工具注册（Spring AI风格）

```java
@Component
public class OrderTools {
    
    @Autowired private OrderService orderService;
    @Autowired private LogisticsService logisticsService;
    
    @Tool(description = "根据订单号查询订单状态，包括支付状态、发货状态、商品明细")
    public OrderInfo queryOrder(
        @ToolParam(description = "订单编号，格式OD开头+12位数字") String orderId,
        @ToolParam(description = "查询维度：status/logistics/detail", required = false) String dimension
    ) {
        // 权限校验
        SecurityContext.checkOrderAccess(orderId);
        
        OrderInfo info = orderService.queryById(orderId);
        if ("logistics".equals(dimension)) {
            info.setLogistics(logisticsService.track(orderId));
        }
        return info;
    }
    
    @Tool(description = "查询用户账户余额和积分")
    public AccountInfo getBalance(
        @ToolParam(description = "用户ID") Long userId
    ) {
        return accountService.getAccount(userId);
    }
}
```

### 2. 工具注册表（自动生成Schema）

```java
@Component
public class ToolRegistry {
    
    private final Map<String, ToolDefinition> tools = new ConcurrentHashMap<>();
    
    @PostConstruct
    public void scanTools() {
        // 扫描所有@Tool注解的方法，自动生成JSON Schema
        Reflections reflections = new Reflections("com.pdd.agent.tools");
        Set<Class<?>> toolClasses = reflections.getTypesAnnotatedWith(Component.class);
        
        for (Class<?> clazz : toolClasses) {
            for (Method method : clazz.getDeclaredMethods()) {
                if (method.isAnnotationPresent(Tool.class)) {
                    ToolDefinition def = buildToolDefinition(method);
                    tools.put(def.getName(), def);
                }
            }
        }
    }
    
    public List<Map<String, Object>> getToolsSchemaForLLM() {
        // 转换为OpenAI Function Calling格式
        return tools.values().stream()
            .map(this::toOpenAISchema)
            .collect(Collectors.toList());
    }
    
    public ToolExecutionResult execute(String toolName, Map<String, Object> arguments) {
        ToolDefinition def = tools.get(toolName);
        if (def == null) throw new ToolNotFoundException(toolName);
        
        // 参数校验
        List<String> errors = validateArguments(def, arguments);
        if (!errors.isEmpty()) return ToolExecutionResult.error(errors);
        
        // 反射调用
        try {
            Object bean = applicationContext.getBean(def.getBeanClass());
            Object result = def.getMethod().invoke(bean, mapToArgs(def, arguments));
            return ToolExecutionResult.success(result);
        } catch (Exception e) {
            return ToolExecutionResult.error("执行失败: " + e.getMessage());
        }
    }
}
```

### 3. ReAct编排引擎

```java
@Service
public class AgentEngine {
    
    private static final int MAX_ITERATIONS = 5; // 防死循环
    
    @Autowired private LLMClient llmClient;
    @Autowired private ToolRegistry toolRegistry;
    @Autowired private MemoryService memoryService;
    
    public String run(String userId, String userInput) {
        // 1. 加载会话记忆
        List<Message> history = memoryService.getShortTermMemory(userId, 10);
        
        // 2. 构建系统Prompt
        String systemPrompt = buildSystemPrompt(toolRegistry.getToolsSchemaForLLM());
        
        // 3. ReAct循环
        List<Message> messages = new ArrayList<>(history);
        messages.add(new UserMessage(userInput));
        
        for (int i = 0; i < MAX_ITERATIONS; i++) {
            // Think + Act: 发给LLM，看是否需要调用工具
            LLMResponse response = llmClient.chat(systemPrompt, messages);
            
            if (response.hasToolCall()) {
                // 执行工具调用
                String toolName = response.getToolCallName();
                Map<String, Object> args = response.getToolCallArguments();
                
                ToolExecutionResult result = toolRegistry.execute(toolName, args);
                
                // Observe: 将工具结果加入对话
                messages.add(new ToolMessage(result.toJson()));
                
            } else {
                // Answer: LLM决定不再调用工具，返回最终回答
                String answer = response.getContent();
                
                // 更新记忆
                memoryService.saveShortTermMemory(userId, userInput, answer);
                memoryService.saveLongTermMemory(userId, userInput, answer); // 可选
                
                return answer;
            }
        }
        
        // 超过最大轮次，返回当前最佳回答
        return "抱歉，处理该请求需要太多步骤，请联系人工客服。";
    }
}
```

### 4. 会话记忆管理

```java
@Service
public class MemoryService {
    
    @Autowired private RedisTemplate<String, String> redis;
    @Autowired private VectorStore vectorStore; // 例如Milvus/Pinecone
    
    private static final int SHORT_TERM_LIMIT = 20; // 最近20条消息
    
    // === 短期记忆：Redis列表 ===
    public List<Message> getShortTermMemory(String userId, int limit) {
        String key = "memory:short:" + userId;
        List<String> raw = redis.opsForList().range(key, 0, limit - 1);
        if (raw == null) return Collections.emptyList();
        
        List<Message> messages = raw.stream()
            .map(s -> JSON.parseObject(s, Message.class))
            .collect(Collectors.toList());
        
        // 如果消息太多，做摘要压缩
        if (messages.size() > SHORT_TERM_LIMIT) {
            String summary = llmClient.summarize(messages);
            messages = List.of(new SystemMessage("之前的对话摘要: " + summary));
        }
        
        return messages;
    }
    
    public void saveShortTermMemory(String userId, String input, String output) {
        String key = "memory:short:" + userId;
        redis.opsForList().rightPush(key, JSON.toJSONString(new UserMessage(input)));
        redis.opsForList().rightPush(key, JSON.toJSONString(new AssistantMessage(output)));
        redis.expire(key, 24, TimeUnit.HOURS); // 24小时过期
        
        // 保持列表长度
        redis.opsForList().trim(key, -SHORT_TERM_LIMIT, -1);
    }
    
    // === 长期记忆：向量数据库 ===
    public void saveLongTermMemory(String userId, String input, String output) {
        String combined = input + " → " + output;
        float[] embedding = embeddingModel.embed(combined);
        
        vectorStore.insert(VectorRecord.builder()
            .id(UUID.randomUUID().toString())
            .vector(embedding)
            .metadata(Map.of("userId", userId, "timestamp", Instant.now().toString()))
            .text(combined)
            .build());
    }
    
    public List<String> retrieveRelevantMemory(String userId, String query, int topK) {
        float[] queryVec = embeddingModel.embed(query);
        return vectorStore.search(queryVec, 
            Map.of("userId", userId), topK)
            .stream()
            .map(VectorRecord::getText)
            .collect(Collectors.toList());
    }
}
```

## 📋 面试加分点

1. **Spring AI vs LangChain4j**：Spring AI与Spring生态深度集成（`@Tool`注解），LangChain4j更灵活跨框架。

2. **Function Calling错误处理**：LLM返回的JSON可能格式错误（少括号、多余逗号），需要JSON修复库（如`json-repair`）做容错。

3. **记忆压缩策略**：当对话历史超过Token限制时，可以用LLM做递归摘要（前N轮→1段摘要→+最近M轮原文）。

4. **Agent可观测性**：记录每轮ReAct的Think/Act/Observe日志，便于调试和优化。可用LangSmith/Phoenix等工具。

5. **工具调用安全**：高危工具（退款、删除）需要Human-in-the-loop确认，LLM输出调用意图后暂停等待人工审批。

## ❓ 苏格拉底式面试追问

1. **"你的Agent最多循环5次，如果一个复杂查询需要6步怎么办？"**
   → 增加MAX_ITERATIONS，但要有超时控制和用户反馈"正在处理中"。也可以用Plan-and-Execute模式先规划再执行

2. **"会话记忆用Redis，如果Redis挂了用户的对话历史丢失怎么办？"**
   → Redis持久化(AOF) + 异步落库(MySQL)。短期容忍丢失，长期从DB恢复

3. **"LLM调用Java方法的参数类型匹配怎么做？比如LLM给了String但方法要Long？"**
   → 参数校验层做类型转换（String→Long），转换失败返回错误让LLM修正

4. **"长期记忆存了所有对话，随着时间增长向量库会非常大，怎么管理？"**
   → 定期归档旧记忆、相似记忆合并去重、设置保留策略（只保留有价值的交互）

5. **"如果两个用户同时操作同一个订单（如夫妻共同订单），Agent怎么处理并发？"**
   → 工具调用加乐观锁，LLM感知到冲突后重试或告知用户"该订单正在被其他操作处理"

## 结构化回答

**30 秒电梯演讲：** 用Java实现AI Agent需要三部分：工具注册与调用框架（Tool Registry + Function Calling）、会话记忆管理（短期对话历史+长期向量记忆）。

**展开框架：**
1. **工具注册** — Java方法通过注解/接口声明为Tool，自动生成schema给LLM
2. **Function** — LLM返回结构化JSON调用指令，Java反射执行对应方法
3. **会话记忆** — 短期用对话列表（最近N轮），长期用向量数据库检索

**收尾：** 您想深入聊：Java实现Agent和Python（LangChain）比有什么优势和劣势？


## 视频脚本

> 预计时长：5 分钟 | 由浅入深


| 时间 | 画面/字幕 | 口播台词 | 讲解要点 |
|------|----------|----------|----------|
| 0:00 | 标题卡：用Java实现AI Agent… | "AI Agent就像一个新来的客服——你给他一本工具手册（工具注册表），告诉他每个工具怎么…" | 开场钩子 |
| 0:20 | 核心概念图 | "用Java实现AI Agent需要三部分：工具注册与调用框架（Tool Registry + Function…" | 核心定义 |
| 0:50 | 工具注册示意图 | "工具注册——Java方法通过注解/接口声明为Tool，自动生成schema给LLM" | 要点拆解1 |
| 1:30 | Function示意图 | "Function——LLM返回结构化JSON调用指令，Java反射执行对应方法" | 要点拆解2 |
| 2:20 | 对比/实战案例图 | "对比一下常见误区和工程实践，看真实场景里怎么取舍。" | 实战与对比 |
| 3:10 | 总结卡 | "记住核心要点。下期我们追问：Java实现Agent和Python（LangChain）比？" | 收尾与钩子 |
