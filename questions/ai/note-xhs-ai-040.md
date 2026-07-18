---
id: note-xhs-ai-040
difficulty: L3
category: ai
subcategory: agent
tags:
- AI-Agent
- Function-Calling
- 幻觉防护
- 降级策略
- 面经
feynman:
  essence: "模型幻觉调用不存在的API是Agent最危险的线上事故——需要三层防护：Schema校验拦截+白名单限制+降级兜底"
  analogy: "LLM像一个过度自信的实习生——你说'帮我订机票'，他可能瞎编一个'超级订票API'来调用。防护措施：1) 工具说明书(白名单)——只有列表里的工具能用；2) 参数检查(schema校验)——调用参数必须合规；3) Plan B(降级)——工具挂了有备选方案"
  key_points:
  - Schema校验：LLM输出的function call参数必须通过JSON Schema验证
  - 白名单机制：只有预注册的工具能被调用，拒绝未注册的工具名
  - 工具调用幻觉根因：LLM在训练数据中见过类似API名，会编造看似合理的调用
  - 降级方案：超时→重试→缓存→默认值→人工兜底
  - 监控：记录所有被拒绝的调用尝试，分析幻觉模式
first_principle:
  essence: "LLM是概率模型，输出的function call本质上是token采样——有一定概率生成不存在的工具名或错误参数。必须用确定性逻辑（校验）来约束概率输出"
  derivation: "LLM生成function call的过程：给定工具列表和用户query，LLM采样输出一段JSON。这段JSON可能：1) 工具名不存在（幻觉）；2) 参数类型错误（如期望int给了string）；3) 参数值无效（如给了不存在的API路径）。传统Java开发中编译器/IDE会拦截这些错误，但LLM的输出没有编译期检查，必须运行时校验"
  conclusion: "Agent的工具调用必须遵循「不信任LLM输出」原则——所有function call都要经过严格的schema校验和白名单检查才能执行"
follow_up:
- JSON Schema校验用什么库？性能如何？
- 工具调用准确率怎么量化评估？
- 除了Schema校验，还有什么防护手段？（Prompt约束、Few-shot示例）
- 工具调用死循环怎么检测和熔断？
memory_points:
- 三层防护：Schema校验→白名单→降级兜底
- 幻觉根因：LLM编造看似合理的工具名/参数
- 降级链：超时→重试→缓存→默认值→人工
- 不信任原则：所有LLM输出都要运行时校验
---

# 【AI Agent工程】模型幻觉调用不存在API如何拦截？工具调用降级方案？

> 来源：小红书「Java 后端转 AI Agent 面试吐槽」

## 一、幻觉调用问题场景

```
用户: "帮我查下北京明天的天气"

正常LLM输出:
  {"tool": "weather_api", "args": {"city": "北京", "date": "明天"}}
  ✓ 工具存在，参数正确 → 执行

幻觉LLM输出（危险！）:
  场景1 - 工具名幻觉:
    {"tool": "getWeatherInfo", "args": {"location": "北京"}}
    ✗ getWeatherInfo不存在！→ 调用报错 → Agent崩溃
  
  场景2 - 参数幻觉:
    {"tool": "weather_api", "args": {"city": 12345}}  
    ✗ city应该是string不是int！→ 参数解析失败
  
  场景3 - 编造端点:
    {"tool": "http://api.internal/fake-endpoint", ...}
    ✗ 端点不存在！→ HTTP 404
```

## 二、三层防护体系

```
LLM输出 function call
       │
       ▼
┌──────────────┐
│ 防护层1:      │ 不通过 → 记录日志 + 返回错误
│ 白名单校验    │         "工具不存在"
│ 工具名在注册  │
│ 列表中?       │
└──────┬───────┘
       │ 通过
       ▼
┌──────────────┐
│ 防护层2:      │ 不通过 → 记录日志 + 要求重试
│ Schema校验    │         "参数格式错误"
│ 参数符合JSON  │
│ Schema?       │
└──────┬───────┘
       │ 通过
       ▼
┌──────────────┐
│ 防护层3:      │ 超时/失败 → 降级链
│ 执行+降级     │
│ 超时→重试→    │
│ 缓存→默认→人工│
└──────────────┘
```

### 防护层一：白名单 + Schema校验

```python
from pydantic import BaseModel, ValidationError
from typing import List, Optional
import json

# 工具定义（严格Schema）
class WeatherArgs(BaseModel):
    city: str
    date: Optional[str] = None

class SearchArgs(BaseModel):
    query: str
    limit: int = 10

# 注册的工具白名单
TOOL_REGISTRY = {
    "weather_api": {"schema": WeatherArgs, "handler": call_weather},
    "search": {"schema": SearchArgs, "handler": call_search},
    # 只有这里的工具能被调用
}

def safe_execute_tool(llm_output: str) -> dict:
    """安全执行LLM输出的工具调用"""
    try:
        call = json.loads(llm_output)
    except json.JSONDecodeError:
        return {"error": "Invalid JSON", "raw": llm_output}
    
    tool_name = call.get("tool")
    args = call.get("args", {})
    
    # 白名单检查
    if tool_name not in TOOL_REGISTRY:
        log_hallucination(tool_name, args)
        return {"error": f"工具 '{tool_name}' 不存在", 
                "available_tools": list(TOOL_REGISTRY.keys())}
    
    # Schema校验
    tool = TOOL_REGISTRY[tool_name]
    try:
        validated_args = tool["schema"](**args)
    except ValidationError as e:
        return {"error": "参数校验失败", "details": str(e)}
    
    # 执行
    return tool["handler"](**validated_args.dict())

def log_hallucination(tool_name, args):
    """记录幻觉调用，用于分析和改进prompt"""
    with open("hallucination_log.jsonl", "a") as f:
        f.write(json.dumps({
            "timestamp": now(),
            "hallucinated_tool": tool_name,
            "args": args,
        }) + "\n")
```

### 防护层二：降级策略链

```python
def execute_with_fallback(tool_name, args, timeout=5):
    """工具调用+多级降级"""
    handlers = [
        # Level 0: 正常调用
        lambda: call_tool(tool_name, args, timeout=timeout),
        # Level 1: 重试（不同参数）
        lambda: call_tool(tool_name, simplify_args(args), timeout=timeout),
        # Level 2: 缓存命中
        lambda: get_cached_result(tool_name, args),
        # Level 3: 默认值
        lambda: get_default_result(tool_name),
        # Level 4: 人工兜底
        lambda: escalate_to_human(tool_name, args),
    ]
    
    for i, handler in enumerate(handlers):
        try:
            result = handler()
            if result and result.get("success"):
                return result
        except TimeoutError:
            log(f"Level {i}: 超时，降级到Level {i+1}")
        except Exception as e:
            log(f"Level {i}: 失败({e})，降级到Level {i+1}")
    
    return {"error": "所有降级方案失败", "escalated": True}
```

## 三、工具调用死循环检测

```python
class ToolCallGuard:
    """防止工具调用死循环"""
    
    def __init__(self, max_calls=10, max_retries_per_tool=3):
        self.call_history = []
        self.max_calls = max_calls
        self.max_retries = max_retries_per_tool
    
    def check(self, tool_name, args):
        # 总调用次数限制
        if len(self.call_history) >= self.max_calls:
            raise CircuitBreaker("超过最大调用次数，强制终止")
        
        # 同一工具+参数的重复调用检测
        call_key = f"{tool_name}:{hash(json.dumps(args, sort_keys=True))}"
        repeat_count = sum(1 for c in self.call_history 
                          if c['key'] == call_key)
        
        if repeat_count >= self.max_retries:
            raise CircuitBreaker(
                f"工具 {tool_name} 重复调用{repeat_count}次，疑似死循环"
            )
        
        self.call_history.append({'key': call_key, 'time': now()})
```

## 四、Prompt层面的幻觉预防

```python
# 在system prompt中严格约束工具使用
SYSTEM_PROMPT = """
你是一个AI助手，只能使用以下工具：
{available_tools}

重要规则：
1. 只能调用上述列出的工具，不能编造工具名
2. 如果没有合适的工具，直接告诉用户"我目前没有相关工具"
3. 工具参数必须严格匹配schema定义
4. 不要在同一轮中重复调用同一工具（除非明确需要）

可用工具列表:
{tool_definitions}
"""
```

## 五、方案对比

| 防护策略 | 层级 | 效果 | 实现复杂度 | 误杀率 |
|---------|------|------|-----------|--------|
| Prompt约束 | 预防 | 中等 | 低 | 低 |
| 白名单 | 运行时 | 高 | 低 | 0% |
| Schema校验 | 运行时 | 高 | 中 | 低 |
| 降级链 | 容错 | 高 | 中 | 0% |
| 死循环检测 | 容错 | 高 | 中 | 低 |
| 人工兜底 | 最后 | 最高 | 高 | 0% |

## 六、面试加分点

1. **幻觉根因分析**：LLM调用不存在的API是因为它在训练数据中见过类似命名模式的API，会基于模式匹配"推测"出看似合理的工具名——理解这个根因能帮你设计更好的防护策略
2. **量化评估**：工具调用准确率 = 正确调用次数 / 总调用次数。用LangSmith或LangFuse做trace分析，统计幻觉率、参数错误率、调用成功率
3. **Few-shot约束**：在prompt中给出正确调用的示例（"以下是正确的工具调用格式..."），Few-shot示例比纯指令更有效——LLM更容易模仿模式而非理解约束
4. **超时设计的坑**：Java后端习惯用同步超时，但LLM工具调用经常涉及异步操作（如爬虫、API调用）——需要设计async timeout + callback机制，不能简单套用同步超时
5. **熔断器模式**：当某个工具的连续失败率>50%时，自动熔断该工具（5分钟内不再调用），直接走降级路径——这避免了故障工具拖垮整个Agent

## 结构化回答

**30 秒电梯演讲：** 模型幻觉调用不存在的API是Agent最危险的线上事故——需要三层防护：Schema校验拦截+白名单限制+降级兜底——LLM像一个过度自信的实习生。

**展开框架：**
1. **Schema校验** — LLM输出的function call参数必须通过JSON Schema验证
2. **白名单机制** — 只有预注册的工具能被调用，拒绝未注册的工具名
3. **工具调用幻觉根因** — LLM在训练数据中见过类似API名，会编造看似合理的调用

**收尾：** 您想深入聊：JSON Schema校验用什么库？性能如何？


## 视频脚本

> 预计时长：4 分钟 | 由浅入深


| 时间 | 画面/字幕 | 口播台词 | 讲解要点 |
|------|----------|----------|----------|
| 0:00 | 标题卡：模型幻觉调用不存在API如何拦截？工具调用降级方… | "LLM像一个过度自信的实习生——你说'帮我订机票'，他可能瞎编一个'超级订票API'来调用…" | 开场钩子 |
| 0:20 | 核心概念图 | "模型幻觉调用不存在的API是Agent最危险的线上事故——需要三层防护：Schema校验拦截+白名单限制+降级兜底" | 核心定义 |
| 0:50 | Schema校验示意图 | "Schema校验——LLM输出的function call参数必须通过JSON Schema验证" | 要点拆解1 |
| 1:30 | 对比/实战案例图 | "对比一下常见误区和工程实践，看真实场景里怎么取舍。" | 实战与对比 |
| 2:20 | 总结卡 | "记住核心要点。下期我们追问：JSON Schema校验用什么库？性能如何？" | 收尾与钩子 |

## 苏格拉底式面试追问

| 追问层级 | 面试官可能这样问 | 高分回答方向 |
|----------|------------------|--------------|
| 目标追问 | 拦截幻觉调用不存在API的核心目标是什么？ | 在不破坏正常调用体验的前提下，阻止模型调用不存在的工具，保证Agent行为可靠不产生无效副作用 |
| 证据追问 | 怎么检测模型调用了不存在的API？ | 方案：工具schema白名单校验、调用前参数校验、运行时拦截未知工具名、用LLM-as-judge或规则校验参数合法性 |
| 边界追问 | 严格白名单和宽松兜底怎么选？ | 生产环境严格白名单（安全优先），开发/容错场景可用LLM辅助判断+人工兜底；要根据业务容忍度选 |
| 反例追问 | 只靠白名单够吗？参数错误怎么办？ | 不够。白名单只能拦截工具名，参数类型/取值错误需要schema校验、运行时类型检查、范围约束 |
| 风险追问 | 拦截太严会有什么副作用？ | 误杀合法调用导致Agent卡死、用户体验差、降级链路复杂；要设计合理的降级和重试策略 |
| 验证追问 | 怎么验证拦截有效且不误杀？ | 构造幻觉调用测试集、正常调用回归、监控误杀率和漏杀率、用户反馈 |
| 沉淀追问 | 工具调用安全怎么沉淀？ | 规范：白名单+schema校验+运行时拦截三层防护、降级策略、监控告警 |

### 现场对话示例
**面试官**：模型幻觉调用不存在的API怎么拦截？工具调用降级方案？
**候选人**：三层防护：工具schema白名单校验工具名、参数schema校验合法性、运行时拦截未知调用；降级用规则兜底或人工介入。
**面试官**：只靠白名单够吗？
**候选人**：不够，白名单只拦工具名，参数错误要schema校验和运行时类型检查、范围约束，多层防护才可靠。
**面试官**：拦截太严会怎样？
**候选人**：误杀合法调用导致Agent卡死、体验差，要设计降级和重试策略，监控误杀率和漏杀率持续调优。
