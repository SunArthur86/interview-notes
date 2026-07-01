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

