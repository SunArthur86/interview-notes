---
id: note-xhs-ai-055
difficulty: L3
category: ai
subcategory: Agent
tags:
- MCP
- 工具调用
- ToolCalling
- FunctionCalling
- 协议
- 参数匹配
source: 高德AI大模型应用开发面试
feynman:
  essence: MCP（Model Context Protocol）是大模型工具调用的标准通信协议，完整流程分四步：意图识别→参数提取与匹配→标准化封装调用→结果整理返回。LLM通过理解工具的schema语义+Few-shot示例来匹配参数。
  analogy: MCP就像给大模型配了一个标准化的"遥控器协议"。不管你家里是格力还是美的的空调，遥控器格式都一样（协议标准化）。大模型只需要知道"调温度需要哪些参数"（schema），然后从你的话里提取这些参数，按下遥控器（调用接口），最后把结果显示给你。
  key_points:
  - MCP四步流程：意图识别→参数匹配→协议封装调用→结果整理
  - LLM参数匹配靠理解schema语义 + Few-shot示例约束格式
  - MCP标准化了工具描述、参数schema、调用格式、返回格式
  - 参数校验拦截：类型检查+必填校验+安全过滤
  - MCP vs Function Calling：MCP是跨平台标准协议，Function Calling是各家API实现
first_principle:
  problem: 大模型有强大的推理能力，但不能直接操作外部系统（查数据库、调API、执行代码）。如何让LLM安全、标准、可扩展地使用外部工具？
  axioms:
  - LLM只能输入文本输出文本，不能直接执行代码或调用API
  - 每个工具的参数格式不同，需要标准化描述
  - 从自然语言提取结构化参数本身就是一个推理任务
  - 工具调用的安全性、可追溯性需要协议保证
  rebuild: 定义标准化的工具描述格式（JSON Schema）→ LLM解析schema理解需要什么参数 → 从用户问句中提取并匹配参数 → MCP协议标准化封装请求 → 执行后结果整理为自然语言返回。
follow_up:
  - MCP和OpenAI Function Calling有什么区别？
  - 如果LLM提取的参数类型不对（比如该填数字填了字符串），怎么处理？
  - 一个用户问句需要调用多个工具，MCP怎么编排？
  - MCP工具调用失败了，怎么给用户一个友好的错误提示？
  - 如何防止LLM调用不该调用的工具（权限控制）？
memory_points:
  - MCP四步：意图识别→参数匹配→协议封装→结果整理
  - 参数匹配靠：schema语义理解 + Few-shot示例 + 参数校验拦截
  - MCP是Anthropic提出的跨平台标准协议，解决工具描述和调用的标准化问题
  - 关键区别：MCP=协议标准，Function Calling=API实现
---

# 【高德AI面试】讲一下MCP调用全过程，LLM是怎么匹配工具参数的？

## 🎯 一句话本质

MCP（Model Context Protocol）是大模型工具调用的**标准通信协议**，完整流程分四步：(1) 用户输入→LLM意图识别判断是否需要工具，(2) 根据工具schema从问句提取参数，(3) 通过MCP协议标准化封装并调用后端接口，(4) 接收结果整理成自然语言回复。

## 🧒 费曼类比

```
没有MCP的世界：
  工具A的参数格式: {cmd: "weather", city: "Beijing"}     ← 每个工具格式不同
  工具B的参数格式: {action: "search", keyword: "apple"}   ← 开发者要适配每个
  工具C的参数格式: params={q: "hello", lang: "zh"}       ← 格式混乱

有MCP的世界（标准化遥控器）：
  所有工具统一格式：
    tools: [{
      name: "get_weather",
      description: "查询指定城市的天气",
      inputSchema: {
        type: "object",
        properties: {
          city: {type: "string", description: "城市名称"},
          unit: {type: "string", enum: ["C", "F"]}
        },
        required: ["city"]
      }
    }]
    
  LLM看到schema就知道：
    用户说"北京天气怎么样" → 需要 city="北京" → 调用get_weather
    用户说"上海明天几度"   → 需要 city="上海" → 调用get_weather
```

## 📊 MCP调用全过程

```
┌─────────────────────────────────────────────────────────────────────┐
│                        MCP 完整调用流程                               │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  用户: "帮我查一下北京到上海的高铁票价"                                │
│                                                                     │
│  Step 1: 意图识别                                                    │
│  ┌──────────────────────────────────────────┐                       │
│  │ LLM 分析:                                 │                       │
│  │  - 需要查询信息？→ 是                      │                       │
│  │  - 可用工具: search_train, get_weather... │                       │
│  │  - 匹配工具: search_train                 │                       │
│  └──────────────────────────────────────────┘                       │
│                                                                     │
│  Step 2: 参数提取与匹配                                                │
│  ┌──────────────────────────────────────────┐                       │
│  │ search_train 的 schema:                   │                       │
│  │  required: from_city, to_city, date       │                       │
│  │  optional: seat_type                      │                       │
│  │                                           │                       │
│  │ LLM从问句提取:                             │                       │
│  │  from_city = "北京" (来自"北京到上海")     │                       │
│  │  to_city = "上海"                         │                       │
│  │  date = null (未指定 → 用默认值今天)        │                       │
│  │  seat_type = null                         │                       │
│  └──────────────────────────────────────────┘                       │
│                                                                     │
│  Step 3: MCP协议封装 + 调用                                           │
│  ┌──────────────────────────────────────────┐                       │
│  │ MCP标准化请求:                             │                       │
│  │ {                                         │                       │
│  │   "jsonrpc": "2.0",                       │                       │
│  │   "method": "tools/call",                 │                       │
│  │   "params": {                             │                       │
│  │     "name": "search_train",               │                       │
│  │     "arguments": {                        │                       │
│  │       "from_city": "北京",                │                       │
│  │       "to_city": "上海"                   │                       │
│  │     }                                     │                       │
│  │   }                                       │                       │
│  │ }                                         │                       │
│  │ → 发送到MCP Server                        │                       │
│  └──────────────────────────────────────────┘                       │
│                                                                     │
│  Step 4: 结果整理返回                                                 │
│  ┌──────────────────────────────────────────┐                       │
│  │ MCP Server返回:                            │                       │
│  │ {trains: [{G1, 09:00, ¥553}, ...]}       │                       │
│  │                                           │                       │
│  │ LLM整理为自然语言:                         │                       │
│  │ "为您找到以下北京→上海的高铁：              │                       │
│  │  G1次 09:00发车 二等座¥553                 │                       │
│  │  G3次 10:00发车 二等座¥553                 │                       │
│  │  需要帮您预订吗？"                         │                       │
│  └──────────────────────────────────────────┘                       │
└─────────────────────────────────────────────────────────────────────┘
```

## 🔧 LLM参数匹配原理

### 1. 工具描述（Schema）就是Prompt

```json
{
  "tools": [
    {
      "name": "query_order",
      "description": "根据订单号查询订单状态。支持查询物流信息和支付状态。",
      "inputSchema": {
        "type": "object",
        "properties": {
          "order_id": {
            "type": "string",
            "description": "订单编号，格式为OD开头+12位数字，如OD202401010001",
            "pattern": "^OD\\d{12}$"
          },
          "query_type": {
            "type": "string",
            "enum": ["status", "logistics", "payment"],
            "description": "查询类型：status=订单状态, logistics=物流, payment=支付",
            "default": "status"
          }
        },
        "required": ["order_id"]
      }
    }
  ]
}
```

### 2. Few-shot示例约束格式

```python
SYSTEM_PROMPT = """
你可以使用以下工具：
{tools_schema}

使用示例：
用户: "我的订单OD202401010001到哪了？"
→ 调用: query_order(order_id="OD202401010001", query_type="logistics")

用户: "OD202401010001付款了吗？"
→ 调用: query_order(order_id="OD202401010001", query_type="payment")

用户: "帮我查一下我的包裹"
→ 不调用工具（缺少必需参数order_id），回复："请提供您的订单号。"

规则：
1. 必填参数缺失时不要猜测，直接询问用户
2. 参数值必须匹配schema中的类型和pattern
3. 一次只调用一个工具，等结果返回再决定下一步
"""
```

### 3. 参数校验拦截

```python
def validate_tool_args(tool_name, arguments):
    """参数校验：类型、必填、格式、安全"""
    schema = TOOL_REGISTRY[tool_name]['inputSchema']
    errors = []
    
    # 必填检查
    for req_field in schema.get('required', []):
        if req_field not in arguments:
            errors.append(f"缺少必填参数: {req_field}")
    
    # 类型检查
    for key, value in arguments.items():
        prop = schema['properties'].get(key, {})
        expected_type = prop.get('type')
        if expected_type == 'string' and not isinstance(value, str):
            errors.append(f"参数{key}应为字符串")
        elif expected_type == 'number' and not isinstance(value, (int, float)):
            errors.append(f"参数{key}应为数字")
    
    # 枚举检查
        enum_values = prop.get('enum')
        if enum_values and value not in enum_values:
            errors.append(f"参数{key}必须是{enum_values}之一")
    
    # 安全过滤（防止Prompt注入）
    for key, value in arguments.items():
        if isinstance(value, str) and contains_injection(value):
            errors.append(f"参数{key}包含不安全内容")
    
    return errors
```

## 📋 MCP vs OpenAI Function Calling

| 维度 | MCP | OpenAI Function Calling |
|------|-----|------------------------|
| 本质 | 通信协议标准 | API功能 |
| 提出者 | Anthropic (2024) | OpenAI (2023) |
| 工具注册 | Server自动发现 | 开发者手动注册 |
| 传输方式 | stdio / SSE / HTTP | HTTP API |
| 跨平台 | 支持任意LLM | 仅OpenAI系列 |
| 生态 | 开放生态，社区维护 | 封闭生态 |

## ❓ 苏格拉底式面试追问

1. **"LLM提取参数时如果填了错误的值（如日期格式不对），是LLM的问题还是工具的问题？"**
   → 两者都有。工具schema应描述格式约束，LLM应根据约束提取。后置校验拦截是最后防线

2. **"一个复杂问题需要调用3个工具，MCP怎么编排？是LLM自己决定顺序还是需要编排引擎？"**
   → LLM通过ReAct/Plan-and-Execute模式自主决定调用顺序。复杂场景可用LangGraph等编排引擎

3. **"MCP Server部署在哪里？和LLM API在同一网络吗？"**
   → MCP Server是本地或远程的独立服务。通过stdio（本地）或HTTP/SSE（远程）与LLM Agent通信

4. **"如果工具返回的数据量很大（如1000条搜索结果），LLM上下文装不下怎么办？"**
   → 工具返回时做分页/摘要，或返回结构化ID而非全文，LLM按需二次查询

5. **"MCP的安全性怎么保证？LLM不会调用有危险的工具吗（如删除数据）？"**
   → 工具注册时标注安全等级，高危工具需要人工确认（Human-in-the-loop）

## 结构化回答

**30 秒电梯演讲：** MCP（Model Context Protocol）是大模型工具调用的标准通信协议，完整流程分四步：意图识别→参数提取与匹配→标准化封装调用→结果整理返回。

**展开框架：**
1. **MCP四步流程** — 意图识别→参数匹配→协议封装调用→结果整理
2. **LLM** — LLM参数匹配靠理解schema语义 + Few-shot示例约束格式
3. **MCP** — MCP标准化了工具描述、参数schema、调用格式、返回格式

**收尾：** 您想深入聊：MCP和OpenAI Function Calling有什么区别？


## 视频脚本

> 预计时长：4 分钟 | 由浅入深


| 时间 | 画面/字幕 | 口播台词 | 讲解要点 |
|------|----------|----------|----------|
| 0:00 | 标题卡：讲一下MCP调用全过程，LLM是怎么匹配工具参数… | "MCP就像给大模型配了一个标准化的"遥控器协议"。不管你家里是格力还是美的的空调，遥控器格…" | 开场钩子 |
| 0:20 | 核心概念图 | "MCP（Model Context Protocol）是大模型工具调用的标准通信协议，完整流程分四步：意图识别→参数提取…" | 核心定义 |
| 0:50 | MCP四步流程示意图 | "MCP四步流程——意图识别→参数匹配→协议封装调用→结果整理" | 要点拆解1 |
| 1:30 | 对比/实战案例图 | "对比一下常见误区和工程实践，看真实场景里怎么取舍。" | 实战与对比 |
| 2:20 | 总结卡 | "记住核心要点。下期我们追问：MCP和OpenAI Function Calling有什么？" | 收尾与钩子 |
