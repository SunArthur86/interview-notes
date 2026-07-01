---
id: note-bd2-001
difficulty: L3
category: ai
subcategory: Agent
tags:
- 字节
- 面经
- Agent
- 工具调用
- Function Calling
- MCP
feynman:
  essence: 'Agent调用工具的完整链路: 理解意图→选择工具→构造参数→执行→解析结果→决定下一步'
  analogy: 就像找师傅修水管——你描述问题(LLM理解意图)，师傅选工具(扳手还是胶带)，按规格操作(构造参数)，看结果对不对(Observation)，不对换方法
  first_principle: 工具调用的本质是LLM输出结构化的函数调用指令(JSON)，由外部运行环境执行函数并将结果返回给LLM，形成感知-决策-执行的闭环
  key_points:
  - LLM本身不执行代码，只输出"调用意图"(函数名+参数JSON)
  - '判断是否需要调用工具: 通过System Prompt中的工具描述让LLM自行决策'
  - '执行环境(Runtime)负责: 解析指令→执行函数→返回结果'
  - MCP协议标准化了工具描述和调用接口
first_principle:
  essence: LLM是"大脑"做决策，工具是"手脚"做执行，两者通过结构化JSON通信
  derivation: LLM的输出空间是文本，工具的输入空间是代码参数。Function Calling将自然语言意图映射到结构化函数调用，弥合了两个空间
  conclusion: Agent工具调用 = LLM决策层 + Runtime执行层 + 结构化通信协议
follow_up:
- 工具描述写得不好会怎样？如何优化？
- 如果LLM选择了错误的工具怎么办？
- 工具调用失败后如何优雅恢复？
memory_points:
- 四步链路：LLM判断意图→输出结构化调用指令→Runtime执行→结果回传生成。
- 定义规范：通过System Prompt下发工具描述和参数Schema。
- 结构化输出：模型按JSON格式输出工具名和参数列表。
- 循环反馈：工具执行结果作为Observation拼接到上下文，指导下一步生成。
---

# Agent工具调用的完整机制和判断逻辑

## 完整调用链路

```
用户: "帮我查下北京明天天气"
         │
         ▼
┌─────────────────────────────────────────────┐
│ Step 1: LLM判断是否需要调用工具               │
│                                             │
│  System Prompt中包含工具列表:                 │
│  - get_weather(city, date): 查询天气         │
│  - search_web(query): 搜索网页               │
│  - send_email(to, subject): 发邮件           │
│                                             │
│  LLM分析: 查天气 → 需要 get_weather 工具      │
└─────────────────────────────────────────────┘
         │
         ▼
┌─────────────────────────────────────────────┐
│ Step 2: LLM输出结构化调用指令                  │
│                                             │
│  tool_call: {                               │
│    "name": "get_weather",                   │
│    "arguments": {"city": "北京", "date": "明天"} │
│  }                                          │
└─────────────────────────────────────────────┘
         │
         ▼
┌─────────────────────────────────────────────┐
│ Step 3: Runtime解析并执行函数                  │
│                                             │
│  result = get_weather(city="北京", date="明天")│
│  result = {"temp": 15, "weather": "晴"}     │
└─────────────────────────────────────────────┘
         │
         ▼
┌─────────────────────────────────────────────┐
│ Step 4: 结果返回给LLM，生成自然语言回答        │
│                                             │
│  LLM: "北京明天天气晴朗，气温约15°C"          │
└─────────────────────────────────────────────┘
```

## 代码实现

```python
from openai import OpenAI

client = OpenAI()

# Step 1: 定义工具Schema
tools = [
    {
        "type": "function",
        "function": {
            "name": "get_weather",
            "description": "查询指定城市和日期的天气",
            "parameters": {
                "type": "object",
                "properties": {
                    "city": {
                        "type": "string",
                        "description": "城市名, 如: 北京"
                    },
                    "date": {
                        "type": "string",
                        "description": "日期, 如: 2024-01-15 或 明天"
                    }
                },
                "required": ["city"]
            }
        }
    }
]

# Step 2: 工具的实际实现
def get_weather(city: str, date: str = "今天") -> dict:
    """实际的天气查询函数"""
    # 调用天气API
    response = requests.get(f"https://api.weather.com/{city}/{date}")
    return response.json()

# Step 3: Agent主循环
def agent_chat(user_message):
    messages = [
        {"role": "system", "content": "你是一个智能助手，可以使用工具帮助用户。"},
        {"role": "user", "content": user_message}
    ]
    
    while True:
        # LLM决策: 是否调用工具
        response = client.chat.completions.create(
            model="gpt-4",
            messages=messages,
            tools=tools,
            tool_choice="auto"  # auto=LLM自行决定, none=不调用, 指定=强制调用
        )
        
        msg = response.choices[0].message
        messages.append(msg)
        
        # 如果LLM决定调用工具
        if msg.tool_calls:
            for tool_call in msg.tool_calls:
                func_name = tool_call.function.name
                func_args = json.loads(tool_call.function.arguments)
                
                # 执行工具
                result = TOOL_REGISTRY[func_name](**func_args)
                
                # 将结果返回给LLM
                messages.append({
                    "role": "tool",
                    "tool_call_id": tool_call.id,
                    "content": json.dumps(result)
                })
            # 继续循环，让LLM处理工具结果
        else:
            # LLM没有调用工具 → 最终回答
            return msg.content
```

## 判断是否需要调用工具的机制

```python
# LLM通过System Prompt中的工具描述自行判断

SYSTEM_PROMPT = """你是一个智能助手。你可以使用以下工具:

可用工具:
1. get_weather(city, date): 查询天气
2. search_web(query): 搜索互联网
3. calculate(expression): 数学计算
4. query_database(sql): 查询数据库

规则:
- 如果用户的请求需要实时信息或外部数据，使用相应工具
- 如果你可以直接回答，不需要使用工具
- 一次可以使用多个工具"""

# tool_choice参数控制:
# "auto"    → LLM自行决定 (默认, 最常用)
# "none"    → 禁止调用工具 (纯对话)
# "required"→ 必须调用至少一个工具
# {"name": "get_weather"} → 强制调用指定工具
```

## 多种调用方式对比

| 方式 | 原理 | 优点 | 缺点 |
|------|------|------|------|
| Function Calling | 模型原生支持结构化输出 | 可靠性高 | 需要支持的模型 |
| ReAct (文本解析) | Prompt引导输出Thought/Action | 模型无关 | 解析容易出错 |
| MCP协议 | 标准化工具接入接口 | 跨平台复用 | 生态尚在发展 |
| 自定义JSON | Prompt要求输出JSON格式 | 简单直接 | 可靠性最低 |

## MCP协议的角色

```python
# MCP (Model Context Protocol) 解决的问题:
# 不同Agent框架(LangChain, CrewAI, AutoGen)的工具定义格式不统一
# MCP提供了一套标准协议

# MCP Server: 暴露工具能力
# MCP Client: Agent运行时，注册和使用工具

# MCP标准化了:
# 1. 工具发现 (tool discovery)
# 2. 工具描述 (tool schema)  
# 3. 工具调用 (tool invocation)
# 4. 结果格式 (result format)

# 类比: USB标准 — 不同设备通过统一接口连接电脑
# MCP: 不同工具通过统一协议连接Agent
```

## 工具调用失败处理

```python
def robust_tool_execution(tool_call, max_retries=2):
    """带容错的工具执行"""
    func_name = tool_call.function.name
    
    for attempt in range(max_retries + 1):
        try:
            args = json.loads(tool_call.function.arguments)
            result = TOOL_REGISTRY[func_name](**args)
            return {"status": "success", "data": result}
        
        except json.JSONDecodeError:
            # 参数格式错误 → 让LLM重新生成
            return {"status": "error", "message": "参数格式错误"}
        
        except KeyError:
            # 工具不存在
            return {"status": "error", "message": f"工具{func_name}不存在"}
        
        except TimeoutError:
            if attempt < max_retries:
                continue
            return {"status": "error", "message": "工具执行超时"}
        
        except Exception as e:
            return {"status": "error", "message": str(e)}
    
    # 失败后LLM可以决定: 换工具/换参数/告诉用户失败
```

## 记忆要点

- 四步链路：LLM判断意图→输出结构化调用指令→Runtime执行→结果回传生成。
- 定义规范：通过System Prompt下发工具描述和参数Schema。
- 结构化输出：模型按JSON格式输出工具名和参数列表。
- 循环反馈：工具执行结果作为Observation拼接到上下文，指导下一步生成。

