---
id: note-bz-agent-032
difficulty: L3
category: ai
subcategory: Agent
tags:
- B站面经
- Tool Use
- Function Calling
- 工具调用
feynman:
  essence: LLM工具调用=让模型输出结构化的"调用指令"(工具名+参数)，程序解析后执行真实工具，再把结果喂回模型。本质是"LLM决策+代码执行"的协作。
  analogy: 像医生开处方——医生(LLM)写药方(调用指令)，药师(程序)配药执行，病人吃药后反馈(结果)。
  first_principle: LLM只能生成文本，不能执行代码。工具调用通过"LLM生成指令→程序执行→结果回传"的循环，让LLM间接获得执行能力。
  key_points:
  - 流程：LLM生成tool_call → 程序执行 → 结果回传 → LLM继续
  - 两种实现：原生Function Calling / Prompt工程
  - 关键：工具描述(JSON Schema)+参数校验+错误处理
  - 安全：沙箱执行+权限控制
first_principle:
  essence: LLM是文本生成器，工具调用通过结构化输出+外部执行，突破LLM的能力边界。
  derivation: LLM不能直接调API/查数据库/执行代码。但LLM能理解工具描述并生成结构化指令。程序解析指令→执行→返回结果→LLM基于结果继续。这赋予LLM"间接行动"能力。
  conclusion: 工具调用 = LLM决策（生成指令） + 程序执行（真实效果） + 结果反馈（闭环）
follow_up:
- Function Calling和ReAct什么关系？——Function Calling是ReAct的"Action"的工程实现
- 工具调用失败怎么办？——重试/换工具/降级/告知用户
- 怎么保证参数正确？——JSON Schema校验+类型检查+默认值
memory_points:
- 核心机制闭环：LLM决策生成tool_call → 程序解析并真实执行 → 结果作为tool角色回传 → LLM总结生成最终回复
- 推荐原生Function Calling：大模型原生输出结构化JSON，参数提取稳定可靠
- 对比Prompt硬解：对于不支持FC的旧模型，只能通过提示词约束并正则强行解析输出
- 面试一句话：Tool Use本质是赋予了LLM调用外部API与动态获取实时数据的能力
---

# LLM 工具调用（Tool Use）机制是什么？如何实践？

## 一、工具调用的完整流程

```
用户: "北京明天天气怎么样？"
                │
                ▼
┌─────────────────────────────────────┐
│ Step1: LLM决策（生成tool_call）       │
│   输入: 用户消息 + 工具描述列表        │
│   输出: {                            │
│     "name": "get_weather",           │
│     "arguments": {"city": "北京",    │
│                   "date": "明天"}    │
│   }                                  │
└──────────────┬──────────────────────┘
               ▼
┌─────────────────────────────────────┐
│ Step2: 程序解析并执行                  │
│   result = get_weather(city="北京")  │
│   → "晴，18-25度"                    │
└──────────────┬──────────────────────┘
               ▼
┌─────────────────────────────────────┐
│ Step3: 结果回传给LLM                  │
│   messages.append({                  │
│     "role": "tool",                  │
│     "content": "晴，18-25度"         │
│   })                                 │
└──────────────┬──────────────────────┘
               ▼
┌─────────────────────────────────────┐
│ Step4: LLM生成最终回复                │
│   "北京明天晴天，18-25度，适合出行"    │
└─────────────────────────────────────┘
```

## 二、两种实现方式

### 方式 1：原生 Function Calling（推荐）

```python
from openai import OpenAI

client = OpenAI()

# 定义工具（JSON Schema）
tools = [
    {
        "type": "function",
        "function": {
            "name": "get_weather",
            "description": "查询指定城市天气",
            "parameters": {
                "type": "object",
                "properties": {
                    "city": {"type": "string", "description": "城市名"},
                    "date": {"type": "string", "description": "日期，如'明天'"}
                },
                "required": ["city"]
            }
        }
    }
]

# 第一轮：LLM决定调用工具
response = client.chat.completions.create(
    model="gpt-4",
    messages=[{"role": "user", "content": "北京明天天气"}],
    tools=tools
)

msg = response.choices[0].message
if msg.tool_calls:  # LLM要调工具
    for tc in msg.tool_calls:
        # 解析工具名和参数
        tool_name = tc.function.name       # "get_weather"
        args = json.loads(tc.function.arguments)  # {"city":"北京"}
        
        # 执行真实工具
        result = get_weather(**args)
        
        # 结果回传
        messages.append(msg)
        messages.append({
            "role": "tool",
            "tool_call_id": tc.id,
            "content": json.dumps(result)
        })
    
    # 第二轮：LLM基于工具结果生成回复
    final = client.chat.completions.create(
        model="gpt-4", messages=messages, tools=tools
    )
```

### 方式 2：Prompt 工程（不支持 FC 的模型）

```python
# 通过prompt让模型输出结构化指令
TOOL_USE_PROMPT = """
你可以调用以下工具。需要时输出JSON：

可用工具：
- get_weather(city, date): 查天气
- search(q): 搜索

输出格式（仅JSON，不要其他文字）：
{"tool": "工具名", "args": {参数}}

或不需要工具时：
{"tool": "none", "response": "直接回答"}

用户: {user_message}
"""
# 自己解析JSON并执行
```

## 三、实践要点

### 工具定义规范

```python
# 完整的工具定义
{
    "type": "function",
    "function": {
        "name": "transfer_money",          # 清晰的函数名
        "description": """转账给他人。
          使用：用户明确要转账时
          不使用：用户只是查余额
          注意：金额超过1万需二次确认""",
        "parameters": {
            "type": "object",
            "properties": {
                "to_account": {
                    "type": "string",
                    "description": "收款账号"
                },
                "amount": {
                    "type": "number",
                    "description": "金额（元）",
                    "minimum": 0.01,
                    "maximum": 50000
                }
            },
            "required": ["to_account", "amount"]
        }
    }
}
```

### 参数校验与错误处理

```python
def safe_execute(tool_call):
    try:
        # 1. 参数校验
        validate_schema(tool_call.arguments, tool_call.schema)
        
        # 2. 权限检查
        if not check_permission(user, tool_call.name):
            return {"error": "无权限"}
        
        # 3. 执行（带超时）
        result = timeout(execute, args=tool_call, timeout=30)
        
        return result
    except ValidationError as e:
        return {"error": f"参数错误: {e}"}
    except TimeoutError:
        return {"error": "执行超时"}
    except Exception as e:
        return {"error": str(e)}
    # 错误会回传给LLM，让它决定重试还是换方案
```

### 多工具并发

```python
# LLM可能一次调用多个工具（无依赖时）
async def handle_multiple_tool_calls(tool_calls):
    # 并发执行
    results = await asyncio.gather(*[
        execute(tc) for tc in tool_calls
    ])
    # 全部结果一起回传
    return results
```

## 四、工具调用 vs ReAct

```
ReAct（认知框架）：
  Thought → Action → Observation
  是"怎么思考"的方法论

Function Calling（技术实现）：
  LLM输出tool_call → 程序执行 → 结果回传
  是"怎么执行"的工程机制

关系：Function Calling是ReAct中"Action"的标准实现
现代Agent = ReAct思想 + Function Calling技术
```

## 五、面试加分点

1. **四步流程**：决策→执行→回传→继续，讲清闭环
2. **原生 vs Prompt**：优先用原生 FC（更准更稳），不支持才用 prompt 工程
3. **错误回传**：工具失败时把错误信息回传给 LLM，让它自主决定重试/换方案——这是"智能"的体现

## 记忆要点

- 核心机制闭环：LLM决策生成tool_call → 程序解析并真实执行 → 结果作为tool角色回传 → LLM总结生成最终回复
- 推荐原生Function Calling：大模型原生输出结构化JSON，参数提取稳定可靠
- 对比Prompt硬解：对于不支持FC的旧模型，只能通过提示词约束并正则强行解析输出
- 面试一句话：Tool Use本质是赋予了LLM调用外部API与动态获取实时数据的能力


## 苏格拉底式面试追问

> 这组追问模拟面试官层层逼问，每一问先回答"为什么"，再回答"怎么做"，最后回答"如何证明"。

### 第一层：目标与动机

**Q：LLM 工具调用的本质是"LLM 决策+代码执行"，为什么不让 LLM 直接执行代码（如生成 Python 跑），而非要搞"结构化函数调用"这个中间层？**

安全性和可靠性。LLM 直接执行代码（如生成 Python 在沙箱跑）有三个风险：1）安全——LLM 可能生成恶意代码（被 prompt injection 攻击后）或破坏性代码（删文件/调系统命令），直接执行风险极高；2）可靠性——LLM 生成的代码可能有 bug（语法错/逻辑错/依赖缺失），执行失败率高，且错误信息难解析；3）可控性——代码执行的行为不可预测（如调外部 API、写文件），难审计。结构化函数调用（LLM 输出"工具名+参数"的 JSON，程序解析后执行预定义的安全工具）把"决策"（LLM 做）和"执行"（代码做）解耦——LLM 只决定调什么，执行是受控的预定义函数，安全（函数有权限控制）、可靠（函数实现稳定）、可审计（调用日志清晰）。

### 第二层：证据与定位

**Q：工具调用失败（LLM 输出了 tool_call 但执行报错），怎么定位是 LLM 输出错（参数错）还是工具实现错（代码 bug）？**

分离 LLM 输出和工具执行。1）LLM 输出检查——打印 LLM 输出的 tool_call JSON（工具名+参数），人工/校验器判断"参数是否符合 schema"（如 order_id 是不是数字、必填参数有没有），不符合是 LLM 输出错；2）工具执行检查——参数合法但执行报错，是工具实现问题（如代码 bug、外部 API 故障、权限不足）；3）错误分类——工具实现错误再细分：参数合法但业务逻辑错（如订单号不存在）、工具代码 bug（异常）、外部依赖故障（API 超时）。定位方法：工具执行层捕获异常并分类返回（如 {error: "order_not_found"} vs {error: "api_timeout"}），上层根据错误类型决定处理（重试/换工具/告知用户）。

### 第三层：根因深挖

**Q：LLM 输出的 tool_call 参数经常错（如日期格式 YYYY/MM/DD vs YYYY-MM-DD），根因是 LLM 能力问题还是工具描述没写清楚？**

通常是工具描述没写清楚（LLM 猜格式）。LLM 不知道工具期望什么格式，靠猜（用常见格式如斜线），猜错率高。治本：1）工具描述明确格式——参数说明加"格式：YYYY-MM-DD（如 2024-01-15）"+ 示例，LLM 看到示例就照做；2）参数 schema 强约束——用 JSON Schema 定义参数（type: string, format: date），LLM 输出后校验，不符合就报错让 LLM 重生成；3）few-shot 示例——工具描述附 1-2 个正确调用的示例（如"正确调用：search_orders(date='2024-01-15')"），LLM 模仿。实测：加了格式说明+示例的参数，正确率从 70% 提到 95%+。根因治理在"工具描述质量"，不是 LLM 能力。

**Q：既然结构化输出（JSON）可靠，为什么 LLM 还是偶尔输出"格式错误的 JSON"（如多余逗号、缺括号）？怎么根治？**

LLM 是 next-token 生成，理论上可能生成语法错的 JSON（尤其长 JSON 或模型弱时）。根治方法：1）用原生 Function Call API——OpenAI/Anthropic 的 tools 接口在模型层面保证输出合法 JSON（constrained decoding，解码时只允许合法 JSON 的 token），100% 不会错；2）用 outlines/guidance 等约束解码库——开源模型配合这些库，解码时约束语法，保证合法；3）容错解析——即使输出有小错（多余逗号），用容错 JSON 解析器（如 json5）修复后解析，配合重试（解析失败让 LLM 重生成）。现代最佳实践是用原生 Function Call API 或约束解码，从源头杜绝格式错，不依赖事后修复。

### 第四层：方案权衡

**Q：结构化函数调用 vs ReAct 的文本格式（Thought/Action/Observation），为什么现代 Agent 都转向原生 Function Call？**

原生 Function Call 解决了文本格式的三个痛点。1）解析可靠性——文本格式靠正则解析（如解析"Action: search[query]"），LLM 输出格式漂移（如"Action:search(query)"）导致解析失败；Function Call 是模型原生输出结构化 JSON，框架级解析 100% 可靠；2）多工具并行——文本格式表达"同时调两个工具"很别扭，Function Call 原生支持（输出多个 tool_call）；3）参数复杂度——复杂参数（嵌套对象、数组）在文本格式里难表达且易错，Function Call 用 JSON 自然表达。所以现代 Agent（LangChain/LangGraph/Claude tools）都用 Function Call，文本格式只在"用不支持 tool use 的旧模型"时作为退路。

**Q：工具调用涉及外部 API（如调第三方搜索），延迟和故障不可控，怎么保证 Agent 不被工具拖垮？**

超时+降级+异步。1）超时——每个工具调用设超时（如 5s），超时取消并返回错误，Agent 据此换工具或告知用户"查询超时"；2）降级——主工具故障时降级到备用（如主搜索 API 挂了用备用搜索或本地缓存），保证功能可用；3）异步——长耗时工具（如大数据查询）异步执行，Agent 先回复"正在查询，稍后告知"，不阻塞对话；4）熔断——某工具连续失败（如 5 次失败）触发熔断（一段时间内不再调用），避免持续拖垮 Agent；5）缓存——相同工具调用结果缓存（如"查天气"5 分钟内复用），减少外部调用。核心：把"外部不可控"的工具用超时+降级+熔断隔离，不让它拖垮整个 Agent。

### 第五层：验证与沉淀

**Q：你怎么衡量工具调用机制的健康度（LLM 决策准+执行可靠）？**

两个维度指标。1）LLM 决策层——tool_call 输出合法率（JSON 语法正确率，应 >99%）、工具选择准确率（>90%）、参数正确率（>85%）；2）执行层——工具执行成功率（>90%）、平均执行延迟（P99 <5s）、故障率（外部 API 故障导致的失败率）。两个层的指标分别监控：决策层低→优化工具描述/prompt/换更强模型；执行层低→优化工具实现/加超时降级/换可靠 API。还要监控"工具调用→用户满意"的转化——调用对了但用户不满意（如查到了但答案组织差），是生成层问题。

**Q：工具调用机制怎么沉淀成框架能力？**

封装成 ToolCallLayer：1）工具注册中心——工具注册时强制 schema（参数定义+格式示例+权限），不达标拒绝；2）原生 Function Call——默认用 OpenAI/Claude/开源模型的 tools API，保证 JSON 合法；3）执行沙箱——工具在隔离环境执行（权限控制+超时+熔断），故障不影响 Agent；4）降级链——主备工具配置，自动降级；5）监控——决策层+执行层指标自动上报。开发者只需注册工具（schema+实现），框架处理决策辅助+执行+容错。这套写入团队 Agent 框架 SOP，新 Agent 工具调用开箱即用且可靠。

## 结构化回答

**30 秒电梯演讲：** LLM工具调用=让模型输出结构化的"调用指令"(工具名+参数)，程序解析后执行真实工具，再把结果喂回模型。本质是"LLM决策+代码执行"的协作。

**展开框架：**
1. **流程** — LLM生成tool_call → 程序执行 → 结果回传 → LLM继续
2. **两种实现** — 原生Function Calling / Prompt工程
3. **关键** — 工具描述(JSON Schema)+参数校验+错误处理

**收尾：** 您想深入聊：Function Calling和ReAct什么关系？——Function Calling是ReAct的"Action"的工程实现？


## 视频脚本

> 预计时长：4 分钟 | 由浅入深


| 时间 | 画面/字幕 | 口播台词 | 讲解要点 |
|------|----------|----------|----------|
| 0:00 | 标题卡：LLM 工具调用（Tool Use）机制是什么？… | "像医生开处方——医生(LLM)写药方(调用指令)，药师(程序)配药执行，病人吃药后反馈(结…" | 开场钩子 |
| 0:20 | 核心概念图 | "LLM工具调用=让模型输出结构化的"调用指令"(工具名+参数)，程序解析后执行真实工具，再把结果喂回模型。本质是"LLM…" | 核心定义 |
| 0:50 | 流程示意图 | "流程——LLM生成tool_call → 程序执行 → 结果回传 → LLM继续" | 要点拆解1 |
| 1:30 | 对比/实战案例图 | "对比一下常见误区和工程实践，看真实场景里怎么取舍。" | 实战与对比 |
| 2:20 | 总结卡 | "记住核心要点。下期我们追问：Function Calling和ReAct什么关系？——F？" | 收尾与钩子 |
