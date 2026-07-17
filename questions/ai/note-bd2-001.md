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

## 苏格拉底式面试追问

> 这组追问模拟面试官层层逼问，每一问先回答"为什么"，再回答"怎么做"，最后回答"如何证明"。

### 第一层：目标与动机

**Q：Agent 调用工具你说是"LLM 判断意图 → 输出结构化指令 → Runtime 执行 → 结果回传"。为什么不直接让 LLM 生成代码（如 Python）执行，而要走 JSON 指令 + Runtime 这套？**

安全性和可控性。让 LLM 直接生成代码执行（如 `exec()` 任意 Python）是"代码即权限"——LLM 能干任何事，包括删文件、发网络请求、读敏感数据，风险极高（prompt injection 可诱导生成恶意代码）。JSON 指令 + Runtime 是"工具白名单"——LLM 只能从预定义的工具列表里选（如 `search`、`calculate`），参数受 Schema 约束，Runtime 校验后再执行，LLM 无法越权。且 JSON 指令可审计（记录每次 tool_call）、可回滚（执行失败可重试/降级）、可限流（防止 LLM 死循环调用）。生产级 Agent 必须用白名单 + Runtime，不能让 LLM 直接执行代码。

### 第二层：证据与定位

**Q：线上 Agent 调用工具失败率从 2% 涨到 15%。你怎么定位是 LLM 选错工具、参数构造错、还是 Runtime 执行错？**

看 tool_call 的日志分阶段统计。一是工具选择准确率（tool_selection_accuracy）——LLM 选的工具对不对（对比人工标注的"应该选哪个工具"），如果选错率涨，是 LLM 理解意图能力差或工具描述（System Prompt 里的 tool description）写得不清晰。二是参数正确率（argument_correctness）——选对工具后参数对不对（如 `search` 的 query 参数是否合理、`calculate` 的表达式是否合法），参数错率高是 Schema 设计问题（字段含义模糊）或 LLM 参数生成能力差。三是 Runtime 执行成功率（execution_success_rate）——参数对但执行失败（如 API 超时、权限不足、工具 bug），这是 Runtime/工具本身问题。三类错误的治法不同：选错改 prompt/加 few-shot，参数错改 Schema/加约束，执行错修工具/加重试。

### 第三层：根因深挖

**Q：Agent 进入死循环——反复调用同一个工具（如连调 10 次 `search`），根因是什么？**

根因是"Observation 没有有效指导下一步"。ReAct 循环里，LLM 基于 Observation（工具返回结果）决定下一步。如果工具返回的结果 LLM"看不懂"或"无法判断是否已解决"，LLM 会重复调用同一工具（以为"再试一次可能有用"）。具体场景：一是工具返回空或模糊（如 `search` 返回"无结果"，LLM 不知道该换 query 还是放弃）；二是上下文太长，LLM 忘了之前调过（每次调用没被有效总结进上下文）；三是缺少终止条件（LLM 不知道何时该停止）。治本：一是工具返回要结构化且带"建议"（如"无结果，建议扩大搜索范围"）；二是设置 max_steps（如最多 5 步）硬终止；三是每步做"任务完成判断"（LLM 自检或独立判别器）。

**Q：那为什么不直接给 LLM 无限步数（让它自己决定何时停），省得设 max_steps 可能误杀正常的长任务？**

无限步数会失控。LLM 没有"成本意识"——它会为了微小的成功率提升而无限重试（每次调用都花 token 和 API 成本），一个死循环任务可能消耗几十美元和几分钟延迟，用户体验崩溃且成本爆炸。且 LLM 的"自信度"不可靠（前面说过确认偏误），它"觉得"再试一次能成功，实际不会。max_steps 是"硬安全阀"——即使 LLM 判断失误，也不会无限消耗。正常长任务（如 10 步的多工具协作）的 max_steps 设大（如 15-20），短任务设小（如 5）。关键是配合"任务完成判断"——每步检查是否已达成目标，达成则提前停止，不浪费剩余步数。max_steps 是"兜底"，不是"限制正常任务"。

### 第四层：方案权衡

**Q：工具描述（System Prompt 里的 tool description）你写得很详细（每个工具 5-10 行）。为什么不写简短点省 token？**

详细描述提升工具选择准确率。LLM 选工具靠"理解工具描述 + 匹配当前意图"，描述越清晰（功能、适用场景、参数含义、返回格式、边界 case），LLM 选择越准。简短描述（如"搜索工具"）会让 LLM 在多个相似工具间困惑（如有 `search_web` 和 `search_kb` 两个搜索工具，简短描述分不清）。代价是 token 消耗——每个工具 10 行描述，10 个工具就 100 行（约 500 token），占上下文。但工具描述是"一次性成本"（每次对话只发一次），相比 tool_call 失败导致的重试成本（一次重试几十 token + 延迟），详细描述更划算。优化：用 Function Calling 的 tools 参数（结构化 Schema）代替自然语言描述，更省 token 且 LLM 理解更准。

**Q：为什么不直接用 ReAct（纯文本的 Thought/Action/Observation），省得搞结构化 JSON 指令？**

ReAct 纯文本灵活但不可靠。ReAct 让 LLM 输出 `Thought: ... Action: search(query="...")` 然后用正则解析 Action，问题是 LLM 可能输出格式跑偏（如 Action 写成自然语言、多了一个 Action、格式不符正则），解析失败率 5-10%。结构化 JSON（Function Calling）靠 API 强制 Schema，解析失败率 <1%。且 ReAct 的 Observation 拼接靠字符串操作（容易注入），JSON 指令的参数传递是结构化的（类型安全）。ReAct 适合"原型验证"（灵活、易调试），生产用 Function Calling（可靠、可审计）。当前主流框架（LangChain Agent、OpenAI Assistants）都转向 Function Calling，ReAct 是历史方案。

### 第五层：验证与沉淀

**Q：你怎么衡量 Agent 工具调用链路的质量，证明优化有效？**

定义指标：一是 tool_selection_accuracy（选对工具的比例），用 golden set（人工标注每个 query 该用哪个工具）评估；二是 argument_correctness（参数正确率），检查参数是否符合预期；三是 execution_success_rate（执行成功率），排除 LLM 错误后的工具本身可靠性；四是 E2E task_success_rate（端到端任务完成率），最终用户视角的成功率；五是平均步数（avg_steps），反映效率（步数过多可能是死循环或低效）。做消融实验：改 System Prompt（加 few-shot）前后对比 selection_accuracy；改 Schema（字段更清晰）前后对比 argument_correctness；加 max_steps 前后对比成本和 success_rate。

**Q：Agent 工具调用链路怎么沉淀成团队标配？**

封装成"Agent Runtime SDK"：统一工具注册接口（声明 name/description/parameters_schema/handler）、tool_call 执行引擎（参数校验 → 执行 → 结果序列化）、ReAct 循环管理（max_steps/终止判断/重试）、日志和 trace（记录每步 Thought/Action/Observation 用于调试和评估）。沉淀"工具描述编写规范"、"Schema 设计最佳实践"、"max_steps 配置经验值"（按任务复杂度）、"golden set 构建方法"。配套评估看板（selection_accuracy、argument_correctness、E2E success_rate、avg_cost），异常（success_rate 骤降/步数飙升）告警。

## 结构化回答

**30 秒电梯演讲：** Agent调用工具的完整链路: 理解意图→选择工具→构造参数→执行→解析结果→决定下一步——就像找师傅修水管。

**展开框架：**
1. **LLM** — LLM本身不执行代码，只输出"调用意图"(函数名+参数JSON)
2. **判断是否需要调用工具** — 通过System Prompt中的工具描述让LLM自行决策
3. **执行环境(Runtime)负** — 解析指令→执行函数→返回结果

**收尾：** 您想深入聊：工具描述写得不好会怎样？如何优化？


## 视频脚本

> 预计时长：4 分钟 | 由浅入深


| 时间 | 画面/字幕 | 口播台词 | 讲解要点 |
|------|----------|----------|----------|
| 0:00 | 标题卡：Agent工具调用的完整机制和判断逻辑 | "就像找师傅修水管——你描述问题(LLM理解意图)，师傅选工具(扳手还是胶带)，按规格操作(…" | 开场钩子 |
| 0:20 | 核心概念图 | "Agent调用工具的完整链路: 理解意图→选择工具→构造参数→执行→解析结果→决定下一步" | 核心定义 |
| 0:50 | LLM示意图 | "LLM——LLM本身不执行代码，只输出"调用意图"(函数名+参数JSON)" | 要点拆解1 |
| 1:30 | 对比/实战案例图 | "对比一下常见误区和工程实践，看真实场景里怎么取舍。" | 实战与对比 |
| 2:20 | 总结卡 | "记住核心要点。下期我们追问：工具描述写得不好会怎样？如何优化？" | 收尾与钩子 |
