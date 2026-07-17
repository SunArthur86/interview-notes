---
id: note-mt-agent-004
difficulty: L4
category: ai
subcategory: Agent
tags:
- 美团
- 面经
- Function Call
- MCP
- Skills
feynman:
  essence: 三者是工具调用能力的递进抽象：Function Call单次调用到MCP标准协议到Skills能力封装。
  analogy: Function Call等于直接打电话，MCP等于电话簿标准，Skills等于完整业务流程打包。
  first_principle: 抽象层级越高复用性越强但灵活性越低。
  key_points:
  - Function Call原子操作厂商原生
  - MCP统一协议开放标准
  - Skills能力组合多Tool加Prompt
  - 抽象层级递进各有适用场景
first_principle:
  essence: 抽象层级与复用性的权衡
  derivation: Function Call简单但耦合厂商，MCP标准化但需适配，Skills高复用但重
  conclusion: 三者不是替代关系而是不同抽象层级互补
follow_up:
- MCP如何解决工具发现和鉴权？
- Skills如何版本管理？
- Claude Skills和LangChain Tools的区别？
memory_points:
- 递进抽象关系：FunctionCall是原子级，MCP是协议级，Skills是能力级
- FunctionCall：厂商原生的单次函数调用，灵活性最高但绑定特定格式无状态
- MCP：基于JSON-RPC的开放标准协议，实现跨平台工具发现与生态接入
- Skills：封装多Tool加Prompt加流程逻辑，抽象层级最高直接复用完整业务
---

# 【美团面经】Function Call到MCP到Skills的区别与优缺点？

## 一句话回答

> Function Call 是**原子级**的单次工具调用（厂商原生）；MCP 是**协议级**的标准化工具发现与调用框架（开放标准）；Skills 是**能力级**的业务封装（多 Tool + Prompt + 流程逻辑）。三者是**递进抽象关系**——抽象层级越高复用性越强，但灵活性越低，各自适用于不同工程场景。

---

## 一、三层递进抽象总览

```
抽象层级：  低 ───────────────────────────────────────► 高

           Function Call          MCP                Skills
           (原子调用)           (标准协议)            (能力封装)
  ┌─────────────────────┐ ┌──────────────────┐ ┌─────────────────────┐
  │ • 单个函数定义       │ │ • 工具发现协议     │ │ • 多 Tool 组合       │
  │ • 厂商 API 原生      │ │ • JSON-RPC 通信    │ │ • 内嵌 Prompt        │
  │ • 入参/出参 schema   │ │ • Server/Client   │ │ • 业务流程编排        │
  │ • 无状态单次调用     │ │ • 鉴权/传输标准化   │ │ • 状态管理 + 记忆     │
  └─────────────────────┘ └──────────────────┘ └─────────────────────┘
       "调一个函数"            "接一套工具生态"         "完成一个业务目标"
```

| 维度 | Function Call | MCP | Skills |
|------|--------------|-----|--------|
| **抽象层级** | 原子操作 | 协议标准 | 能力封装 |
| **粒度** | 单个函数 | 多个工具集合 | 完整业务流程 |
| **标准化** | 厂商私有（OpenAI/Gemini各异） | 开放协议（JSON-RPC 2.0） | 框架级约定 |
| **包含内容** | 函数名 + Schema | Tools + Resources + Prompts | Tools + Prompt + 逻辑 + 状态 |
| **状态管理** | 无状态 | 无状态（Server 可有状态） | 可有状态 + 记忆 |
| **复用性** | 低（绑定厂商格式） | 高（跨平台跨模型） | 最高（直接复用整段能力） |
| **灵活性** | 最高（完全自定义） | 中（遵循协议规范） | 较低（框架约束流程） |
| **典型实现** | OpenAI Tools API | @modelcontextprotocol/sdk | Claude Skills / Dify Plugin |

---

## 二、第一层：Function Call——原子级调用

### 2.1 核心概念

Function Call 是 LLM 厂商提供的原生能力：开发者定义一个函数（名称 + 参数 Schema），LLM 在推理时决定是否调用该函数，并返回结构化的参数 JSON。

### 2.2 代码示例

```python
import openai
import json

# 1. 定义函数 Schema
tools = [{
    "type": "function",
    "function": {
        "name": "get_weather",
        "description": "获取指定城市的天气",
        "parameters": {
            "type": "object",
            "properties": {
                "city": {"type": "string", "description": "城市名"},
                "unit": {"type": "string", "enum": ["celsius", "fahrenheit"]}
            },
            "required": ["city"]
        }
    }
}]

# 2. 第一次调用：LLM 决定要调用哪个函数
response = openai.chat.completions.create(
    model="gpt-4o",
    messages=[{"role": "user", "content": "北京今天多少度？"}],
    tools=tools
)

# 3. LLM 返回结构化参数
tool_call = response.choices[0].message.tool_calls[0]
args = json.loads(tool_call.function.arguments)
# → {"city": "北京", "unit": "celsius"}

# 4. 开发者执行实际函数，再把结果喂回去
result = get_weather(**args)  # → {"temp": 25, "condition": "晴"}

# 5. 第二次调用：LLM 基于工具结果生成自然语言回答
final = openai.chat.completions.create(
    model="gpt-4o",
    messages=[
        {"role": "user", "content": "北京今天多少度？"},
        response.choices[0].message,
        {"role": "tool", "tool_call_id": tool_call.id, "content": json.dumps(result)}
    ]
)
# → "北京今天25度，晴天。"
```

**关键特征：** 一次 Function Call = 一个函数定义 + 一次 LLM 决策 + 一次执行 + 一次结果回填。**没有工具发现机制，没有鉴权规范，没有协议标准**——这些都由开发者手动硬编码。

### 2.3 痛点

- 厂商格式不统一（OpenAI 的 `tools` vs Gemini 的 `function_declarations` vs Claude 的 `tool_use`）
- 工具数量增多时需要手动维护注册表
- 鉴权、传输、错误处理全部自定义
- 无法跨 Agent 系统复用工具定义

---

## 三、第二层：MCP——协议级标准化

### 3.1 核心概念

MCP（Model Context Protocol）是 Anthropic 于 2024 年发布的**开放协议**，定义了 LLM 与外部工具/资源之间的标准通信接口。核心思想：把工具调用从「厂商私有 API」升级为「标准化协议」，类似于 USB-C 统一了所有设备的充电接口。

### 3.2 架构

```
┌─────────────────┐       JSON-RPC 2.0        ┌─────────────────┐
│   MCP Client    │ ◄══════ stdio/SSE ═══════► │   MCP Server    │
│  (LLM Agent)    │                            │ (工具提供方)     │
│                 │                            │                 │
│ • 发现工具列表   │     ┌── tools/list ──►     │ • 注册 Tool      │
│ • 调用工具      │     ├── tools/call ──►     │ • 注册 Resource  │
│ • 读取资源      │     ├── resources/read ►   │ • 注册 Prompt    │
│ • 使用提示模板   │     └── prompts/get ──►    │ • 鉴权拦截        │
└─────────────────┘                            └─────────────────┘
```

### 3.3 代码示例（MCP Server）

```python
from mcp import Server, Tool
import mcp.types as types

server = Server("weather-service")

@server.list_tools()
async def list_tools() -> list[types.Tool]:
    return [
        types.Tool(
            name="get_weather",
            description="获取指定城市天气",
            inputSchema={
                "type": "object",
                "properties": {
                    "city": {"type": "string"}
                },
                "required": ["city"]
            }
        )
    ]

@server.call_tool()
async def call_tool(name: str, arguments: dict) -> list[types.TextContent]:
    if name == "get_weather":
        city = arguments["city"]
        # 实际调用天气API
        weather = await fetch_weather_api(city)
        return [types.TextContent(type="text", text=json.dumps(weather))]

# 任何 MCP Client（Claude Desktop / Cursor / 自研Agent）都能自动发现并调用
```

### 3.4 MCP 相比 Function Call 的关键提升

| 能力 | Function Call | MCP |
|------|--------------|-----|
| 工具发现 | 手动注册 | `tools/list` 自动发现 |
| 通信协议 | 厂商私有 HTTP | JSON-RPC 2.0 标准化 |
| 资源管理 | 无 | `resources/read` 统一读取 |
| 提示模板 | 无 | `prompts/get` 共享模板 |
| 跨模型复用 | ❌ | ✅ 一次开发处处可用 |
| 生态 | 各自为政 | MCP Hub 统一市场 |

---

## 四、第三层：Skills——能力级封装

### 4.1 核心概念

Skills 是在 MCP/Function Call 之上的**最高抽象**：它把「多个工具 + 提示词 + 业务流程 + 状态管理」打包成一个可独立运行、可复用的「能力单元」。类比来说，Function Call 是一个螺丝刀，MCP 是一个标准化的工具箱，Skills 是一个完整的「维修手册 + 工具箱 + 操作流程」。

### 4.2 代码示例（Dify Plugin / 自研 Skill 框架）

```python
from dataclasses import dataclass, field
from typing import List

@dataclass
class Skill:
    """一个 Skill = 多个Tool + Prompt + 执行流程"""
    name: str
    description: str
    prompt_template: str          # 嵌入的提示词
    tools: List[dict] = field(default_factory=list)
    required_context: List[str] = field(default_factory=list)

# 定义「机票预订」Skill
flight_booking_skill = Skill(
    name="book_flight",
    description="根据用户需求搜索并预订机票，支持改签退票",
    prompt_template="""
你是一个专业的机票预订助手。
规则：
1. 先搜索航班，确认用户选择后再预订
2. 预订前必须确认：乘客姓名、证件号、航班号、日期
3. 如果用户只说了模糊需求，先追问

用户需求：{user_request}
当前时间：{current_time}
用户历史偏好：{user_preferences}
""",
    tools=[
        {"name": "search_flights", "function": search_flights},
        {"name": "book_ticket", "function": book_ticket},
        {"name": "refund_ticket", "function": refund_ticket},
        {"name": "get_user_profile", "function": get_user_profile},
    ],
    required_context=["user_preferences", "current_time"]
)

# Agent 框架自动：加载Skill → 注入Prompt → 暴露Tools → 编排执行
agent.register_skill(flight_booking_skill)
agent.run("帮我订一张明天北京到上海的机票，靠窗")
```

### 4.3 Skills 的核心特征

- **Prompt 内嵌**：不需要用户或开发者额外写提示词，Skill 自带最佳实践 Prompt
- **多 Tool 组合**：一个 Skill 封装多个原子工具，完成完整业务闭环
- **状态与记忆**：Skill 可维护对话状态、记住用户偏好（Function Call / MCP 无状态）
- **即插即用**：安装一个 Skill 就获得一整套能力，无需理解底层工具实现

---

## 五、三者关系总结

```
  Skills  ⊃  MCP  ⊃  Function Call
  (能力)     (协议)    (原子)

  ┌─────────────────────────────────────────┐
  │              Skill: "数据分析"            │  ← 能力封装
  │  ┌───────────────────────────────────┐  │
  │  │         MCP Protocol              │  │  ← 标准协议
  │  │  ┌─────────┐ ┌─────────┐          │  │
  │  │  │ Function │ │ Function │  ...    │  │  ← 原子调用
  │  │  │ Call A   │ │ Call B   │         │  │
  │  │  └─────────┘ └─────────┘          │  │
  │  └───────────────────────────────────┘  │
  └─────────────────────────────────────────┘
```

**不是替代关系，而是互补关系：**
- 原型 / 快速验证 → Function Call 足够
- 多工具生态 / 跨模型复用 → MCP
- 成熟产品 / 业务闭环 → Skills

---

## 六、面试高频追问

### Q1: MCP 如何解决工具发现和鉴权？

**答：** MCP 通过 `tools/list` 方法实现动态工具发现——Client 连接 Server 后自动拉取可用工具清单，无需硬编码。鉴权方面，MCP 支持 stdio（本地进程级信任）和 SSE（HTTP + Bearer Token）两种传输模式，Server 端可拦截 `call_tool` 请求做权限校验。

### Q2: Skills 如何版本管理？

**答：** Skills 通常配合 Prompt 版本管理系统，使用语义化版本号（major.minor.patch），存储在数据库或 Git 中。每次 Prompt 变更触发 A/B 测试，评估通过后升版本号。Skills 的 Tool 依赖也需要版本锁定，防止上游 API 变更导致 Skill 失效。

### Q3: Claude Skills 和 LangChain Tools 的区别？

**答：** LangChain Tools 本质上是 Function Call 的封装（含 name + description + func），仍然是无状态的原子工具。Claude Skills 则包含了完整的 Prompt 指令、使用场景、注意事项，模型能理解「什么时候该用这个能力」而非仅仅是「怎么调用」。本质上 Skills 在 Tool 之上增加了**能力描述层**和**使用条件层**。

### Q4: 为什么不能直接用 Function Call 搞定一切？

**答：** 当工具数量超过 20 个时，Function Call 面临「选择困难」——LLM 需要在巨大的工具列表中选对函数，准确率显著下降。MCP 通过工具发现和分组缓解了这个问题；Skills 则从根本上减少了 LLM 需要决策的粒度——从「选哪个函数」升级为「选哪个能力」，大幅降低决策复杂度。

## 记忆要点

- 递进抽象关系：FunctionCall是原子级，MCP是协议级，Skills是能力级
- FunctionCall：厂商原生的单次函数调用，灵活性最高但绑定特定格式无状态
- MCP：基于JSON-RPC的开放标准协议，实现跨平台工具发现与生态接入
- Skills：封装多Tool加Prompt加流程逻辑，抽象层级最高直接复用完整业务


## 苏格拉底式面试追问

> 这组追问模拟面试官层层逼问，每一问先回答"为什么"，再回答"怎么做"，最后回答"如何证明"。

### 第一层：目标与动机

**Q：Function Call、MCP、Skills 这三者是替代关系还是互补？为什么不能只用 Function Call？**

是抽象层级的递进，不是替代。Function Call 是"单次调用"——定义一个函数 schema，LLM 输出 JSON 调用它；MCP 是"标准协议"——把工具的发现、调用、权限统一成 client-server 架构，让一个 Agent 能接入任意 MCP server；Skills 是"能力封装"——把一组相关的工具 + prompt + 知识打包成可复用的能力单元。只用 Function Call 的问题是：工具多了之后 schema 爆炸（context 装不下）、工具复用要重新定义、权限管理散落。MCP 解决互操作，Skills 解决复用。

### 第二层：证据与定位

**Q：你的 Agent 接入了 20 个 Function Call，LLM 经常选错工具，怎么定位是 Function Call 能力本身不够还是工具太多？**

用两个实验：1) 把工具数降到 5 个，看准确率是否回升——如果回升说明是"工具数太多导致注意力分散"（经验上 > 10 个工具准确率明显下降）；2) 保持 20 个工具但用 RAG 召回 top-5 相关工具再喂给 LLM，看准确率——如果回升说明是工具检索的问题，不是 LLM 能力问题。具体指标看 tool_call_success_rate 和 first_attempt_success_rate。

### 第三层：根因深挖

**Q：工具多了 LLM 选错，根因到底是 context 装不下还是 LLM 注意力机制的问题？**

两者都有但后者是主因。20 个工具的 schema 大概 2000-3000 token，远没到 context 上限，所以不是"装不下"。真正的问题是 LLM 在长 schema 列表里的注意力稀释——类似 lost in the middle 现象，中间位置的工具被选中的概率显著低于首尾。验证方法：把同一个工具放在 schema 列表的第 1 位 vs 第 10 位，对比被选中的概率，差异通常 > 15%。

**Q：既然是注意力问题，为什么不直接用更长的 context 模型（128K）来解决？**

长 context 解决的是"装得下"，不是"看得清"。128K context 里放 20 个工具 schema 一样会有注意力稀释。解决注意力问题的正确方向是"减少喂给 LLM 的工具数"——用 RAG 按 query 召回 top-K 工具，或用 MCP 的工具发现机制动态挂载。把 context 从 8K 扩到 128K 是治标，把工具数从 20 降到 5 是治本。

### 第四层：方案权衡

**Q：MCP 提供了标准协议，但引入 MCP server 会增加一层网络调用和进程间通信，延迟和复杂度都上升，怎么权衡？**

权衡点是"工具的复用性和生态" vs "单次调用延迟"。MCP server 跑在独立进程，单次调用比进程内 Function Call 多 5-20ms，但换来的是：1) 同一个 MCP server 被多个 Agent 复用（不用每个 Agent 重新实现）；2) 工具可以独立升级、独立部署；3) 权限收敛到 MCP server 一层。如果工具是高频调用且只服务一个 Agent，用进程内 Function Call；如果工具要跨 Agent 共享、需要独立权限管控，用 MCP。

**Q：为什么不把所有工具都做成 Skills，让 Skills 自己管理 prompt 和工具，减少主 Agent 的负担？**

Skills 的封装粒度太粗会有问题。一个 Skill 内部如果封装了"查订单 + 算退款 + 发通知"三个动作，主 Agent 调用 Skill 时无法单独控制其中一步，灵活性丢失。Skills 适合"完整能力"（如"处理一次完整退款流程"），Function Call 适合"原子操作"（如"查订单状态"）。两者应该共存——原子操作用 Function Call，复合能力用 Skills，不要强行统一。

### 第五层：验证与沉淀

**Q：你怎么证明引入 MCP 后整体可用性提升了，而不是引入了新故障点？**

对比引入 MCP 前后的两个指标：1) tool_call_success_rate（应该持平或略升，因为 MCP server 可以做更细致的参数校验）；2) 平均故障恢复时间 MTTR（应该下降，因为 MCP server 独立部署可以单独重启）。同时监控 MCP server 的 P99 延迟和错误率，设阈值告警。沉淀为工具治理规范：原子工具用 Function Call、共享能力用 MCP、复合流程用 Skills，三层各有职责边界。

## 结构化回答

**30 秒电梯演讲：** 三者是工具调用能力的递进抽象：Function Call单次调用到MCP标准协议到Skills能力封装——Function Call等于直接打电话。

**展开框架：**
1. **Function** — Function Call原子操作厂商原生
2. **MCP** — MCP统一协议开放标准
3. **Skills** — Skills能力组合多Tool加Prompt

**收尾：** 您想深入聊：MCP如何解决工具发现和鉴权？


## 视频脚本

> 预计时长：5 分钟 | 由浅入深


| 时间 | 画面/字幕 | 口播台词 | 讲解要点 |
|------|----------|----------|----------|
| 0:00 | 标题卡：Function Call到MCP到Skills… | "Function Call等于直接打电话，MCP等于电话簿标准，Skills等于完整业务流…" | 开场钩子 |
| 0:20 | 核心概念图 | "三者是工具调用能力的递进抽象：Function Call单次调用到MCP标准协议到Skills能力封装。" | 核心定义 |
| 0:50 | Function示意图 | "Function——Function Call原子操作厂商原生" | 要点拆解1 |
| 1:30 | MCP示意图 | "MCP——MCP统一协议开放标准" | 要点拆解2 |
| 2:20 | 对比/实战案例图 | "对比一下常见误区和工程实践，看真实场景里怎么取舍。" | 实战与对比 |
| 3:10 | 总结卡 | "记住核心要点。下期我们追问：MCP如何解决工具发现和鉴权？" | 收尾与钩子 |
