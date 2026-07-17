---
id: note-bd-agent-004
difficulty: L3
category: ai
subcategory: Agent
tags:
- 字节
- 面经
- Agent
- MCP
- Skill
feynman:
  essence: Skill定义能力边界和触发条件，MCP做标准化工具接入，Agent按需动态调用
  analogy: Skill像招聘JD（描述能力+触发条件），MCP像标准化的API网关（统一接入+权限控制），Agent像HR（按需调用）
  first_principle: Agent能力扩展需要标准化协议——Skill定义What（做什么），MCP定义How（怎么接入），Runtime定义When（何时调用）
  key_points:
  - Skill定义能力边界、输入输出和触发条件
  - Tool是Skill的具体实现
  - MCP做标准化接入和Schema暴露
  - 执行时限制权限和超时
first_principle:
  essence: Agent要接入外部能力，需要统一的接口协议和安全管理
  derivation: 每个外部能力接口各异→集成成本高→需要标准化协议(MCP)→定义统一Schema→Agent Runtime动态注册和调用
  conclusion: MCP是Agent生态的USB-C接口——标准化接入、统一管理、即插即用
follow_up:
- MCP和Function Calling有什么区别？
- Skill的版本管理怎么做？
- 如何防止Agent调用恶意Tool？
memory_points:
- 核心架构：Agent Runtime挂载Skill，底层通过MCP Client连接标准化外部Server
- 接入四步走：定义边界(Schema) -> 封装Tool(执行) -> 注册Client(动态发现) -> 规范通信(JSON-RPC)
- Skill定义核心三要素：触发条件、输入/输出Schema、执行约束(超时与频控)
- 安全与控制：MCP接入必须配套动态注册、权限校验和超时熔断机制
---

# 如何给Agent生成Skill并通过MCP接入外部能力？

## 整体架构

```
┌──────────────────────────────────────────┐
│            Agent Runtime                 │
│  ┌─────────┐  ┌─────────┐  ┌─────────┐  │
│  │ Skill A │  │ Skill B │  │ Skill C │  │
│  │(查询章节)│  │(保存内容)│  │(搜索角色)│  │
│  └────┬────┘  └────┬────┘  └────┬────┘  │
│       │            │            │        │
│  ┌────┴────────────┴────────────┴────┐  │
│  │         MCP Client Layer          │  │
│  │   (动态注册 + 权限校验 + 超时控制)   │  │
│  └────────────────┬───────────────────┘  │
└───────────────────┼──────────────────────┘
                    │ 标准化协议
    ┌───────────────┼───────────────┐
    │               │               │
┌───┴───┐     ┌────┴────┐    ┌────┴────┐
│ MCP   │     │ MCP     │    │ MCP     │
│Server │     │Server   │    │Server   │
│(DB)   │     │(Search) │    │(API)    │
└───────┘     └─────────┘    └─────────┘
```

## Step 1: 定义Skill能力边界

```yaml
# Skill定义示例
skill:
  name: "query_chapter"
  description: "查询指定小说的章节内容"
  
  # 触发条件
  trigger:
    type: "intent_match"
    patterns:
      - "查看第*章"
      - "回顾之前的内容"
      - "上一章讲了什么"
  
  # 输入Schema
  input_schema:
    type: object
    properties:
      novel_id:
        type: string
        description: "小说ID"
      chapter_range:
        type: object
        properties:
          start: { type: integer }
          end: { type: integer }
  
  # 输出Schema
  output_schema:
    type: object
    properties:
      chapters:
        type: array
        items:
          type: object
          properties:
            chapter_id: { type: integer }
            title: { type: string }
            content: { type: string }
            summary: { type: string }
  
  # 约束
  constraints:
    max_chapters_per_query: 5
    timeout_ms: 3000
    rate_limit: "10/minute"
```

## Step 2: 封装为Tool

```python
class QueryChapterTool:
    """Skill的具体实现"""
    
    @property
    def schema(self):
        return {
            "name": "query_chapter",
            "description": "查询指定小说的章节内容",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "novel_id": {"type": "string"},
                    "chapter_start": {"type": "integer"},
                    "chapter_end": {"type": "integer"}
                },
                "required": ["novel_id"]
            }
        }
    
    def execute(self, novel_id: str, 
                chapter_start: int = 1, 
                chapter_end: int = 1) -> dict:
        try:
            chapters = db.query(
                "SELECT * FROM chapters WHERE novel_id=? AND num BETWEEN ? AND ?",
                [novel_id, chapter_start, chapter_end]
            )
            return {"success": True, "chapters": chapters}
        except Exception as e:
            return {"success": False, "error": str(e)}
```

## Step 3: MCP标准化接入

```python
# MCP Server端：暴露Tool Schema
from mcp.server import MCPServer

server = MCPServer("chapter-service")

@server.tool()
async def query_chapter(novel_id: str, 
                        chapter_start: int = 1, 
                        chapter_end: int = 1):
    """查询章节内容"""
    # 权限校验
    if not has_permission(novel_id):
        return {"error": "无权限"}
    
    # 超时控制
    result = await with_timeout(
        db.query_chapters(novel_id, chapter_start, chapter_end),
        timeout=3000
    )
    return result

# MCP Client端：Agent Runtime动态注册
async def register_tools():
    """从MCP Server发现并注册工具"""
    tools = await mcp_client.discover_tools()
    
    for tool in tools:
        # 注册到Agent的Tool Registry
        agent.register_tool(
            name=tool.name,
            schema=tool.inputSchema,
            handler=lambda args: mcp_client.call(tool.name, args),
            timeout=tool.constraints.get("timeout_ms", 5000),
            permissions=tool.constraints.get("permissions", [])
        )
```

## Step 4: 执行时动态调用

```python
# Agent Runtime执行流程
async def agent_execute(task: str):
    # 1. LLM根据任务和已注册Tools决定调用哪个
    decision = await llm.plan(task, available_tools=agent.list_tools())
    
    # 2. 执行Tool调用（带权限和超时）
    for tool_call in decision.tool_calls:
        result = await agent.call_tool(
            tool_call.name,
            tool_call.args,
            timeout=3000,        # 超时控制
            max_retries=2,       # 重试次数
            require_auth=True    # 权限校验
        )
    
    # 3. 将结果反馈给LLM继续推理
    ...
```

## Skill vs Tool vs MCP

| 概念 | 层级 | 职责 |
|------|------|------|
| **Skill** | 业务层 | 定义"能做什么"+"何时触发" |
| **Tool** | 实现层 | Skill的具体代码实现 |
| **MCP** | 协议层 | 标准化Tool的接入和通信 |

## 面试加分点

1. **强调标准化**：MCP是Agent生态的"USB-C接口"，解决N×M集成问题
2. **安全意识**：提到权限校验、超时控制、速率限制
3. **动态注册**：Agent不需要预先知道所有Tool，运行时通过MCP发现
4. **与Function Calling对比**：MCP是协议层标准，Function Calling是调用机制

## 记忆要点

- 核心架构：Agent Runtime挂载Skill，底层通过MCP Client连接标准化外部Server
- 接入四步走：定义边界(Schema) -> 封装Tool(执行) -> 注册Client(动态发现) -> 规范通信(JSON-RPC)
- Skill定义核心三要素：触发条件、输入/输出Schema、执行约束(超时与频控)
- 安全与控制：MCP接入必须配套动态注册、权限校验和超时熔断机制

## 苏格拉底式面试追问

> 这组追问模拟面试官层层逼问，每一问先回答"为什么"，再回答"怎么做"，最后回答"如何证明"。

### 第一层：目标与动机

**Q：MCP（Model Context Protocol）你说是标准化工具接入协议，为什么不直接用 Function Calling，非要再搞一层 MCP？**

Function Calling 是"调用机制"（LLM 生成函数名和参数），MCP 是"协议标准"（工具如何被发现、注册、通信）。Function Calling 的问题是每个工具要手写到 prompt 里（函数名、参数 schema、描述），工具多了 prompt 爆炸且模型选不准；且每个工具的实现是 ad-hoc 的（各团队自己写 wrapper），无法跨 Agent 复用。MCP 标准化了工具的暴露方式（统一的 JSON-RPC 接口）和发现机制（Agent 动态查询 MCP Server 支持哪些工具），让工具像"USB 设备"即插即用。动机是"工具生态的标准化和解耦"。

### 第二层：证据与定位

**Q：Agent 调用某个 MCP Server 的工具失败了，你怎么定位是 Agent 调用方式错、MCP Server 实现错、还是网络问题？**

分三段查。一是看 Agent 生成的 tool_call（函数名和参数）是否符合该工具的 JSON Schema——如果参数格式错（如把 int 传成 string），是 Agent/LLM 问题；二是直接用 JSON-RPC 客户端手动调该 MCP Server 的工具（绕过 Agent），如果手动调用也失败，是 Server 实现问题；三是看 MCP Server 的日志和健康检查，如果 Server 没收到请求或响应超时，是网络/部署问题。MCP 的标准化接口让"手动直连测试"成为可能，这是它比 ad-hoc 工具好 debug 的地方。

### 第三层：根因深挖

**Q：你给 Agent 接了 20 个工具（MCP Server），但 LLM 经常选错工具或参数填错。根因是什么？**

根因是工具数量超过了 LLM 的选择能力。研究表明，工具数量 >10 个时，LLM 的工具选择准确率显著下降（prompt 里工具描述太多，模型注意力分散）。治本是分级路由：先用一个轻量分类器（或 LLM）判断"这个 query 属于哪类工具"（如查询类/操作类/分析类），只把该类的 3-5 个工具描述传给主 LLM，减少选择压力。另一个根因是工具描述写得差——如果两个工具描述模糊（如"查询数据"vs"获取信息"），模型分不清。治本是给每个工具写清晰、有区分度的 description，并对易混工具加"何时用 A 何时用 B"的说明。

**Q：那为什么不直接把所有工具的实现代码塞给模型（如用代码解释器），让模型自己写代码调，省得维护工具 schema？**

代码解释器（如 ChatGPT 的 Code Interpreter）确实灵活，但有安全和确定性问题。一是安全——模型写的代码可能执行危险操作（如删文件、访问敏感 API），要跑在沙箱里且限制权限；二是确定性——同样的 query 模型每次写的代码可能不同，难以测试和复现；三是性能——写代码 + 执行 + 解析结果比直接调用结构化工具慢且不稳定。MCP 工具是"预定义的、经过测试的、有权限控制的"操作，比模型即兴写代码安全可靠。代码解释器适合"探索性分析"（如算个复杂统计），工具调用适合"确定性操作"（如查订单、发邮件）。

### 第四层：方案权衡

**Q：Skill 的"触发条件"你怎么定义？是写规则（if query contains X）还是让 LLM 判断？**

混合用。高频明确的触发用规则（快且确定，如"query 含'查订单' → 触发订单查询 Skill"）；模糊的触发用 LLM 判断（如"用户想了解物流状态"→ 触发哪个 Skill 要语义理解）。纯规则覆盖不全（用户表达多变），纯 LLM 有延迟和误判（且每次判断都要 LLM 调用）。工程上：先用规则匹配（<10ms），规则不匹配的 fallback 到 LLM 判断（100-300ms），且 LLM 判断结果可以反馈到规则库（高频模式自动沉淀成规则），逐步提升规则覆盖率减少 LLM 调用。

**Q：为什么不直接用 Function Calling 的"auto"模式（让模型自己决定调哪个工具），省得搞 Skill 触发条件？**

Function Calling 的 auto 模式就是"让 LLM 判断触发"，但对工具多（>10）或工具语义接近时准确率下降。Skill 的"触发条件"是在 LLM 判断之上的"预筛选"——先把候选工具缩到 3-5 个，再让 LLM 从小集合里选，准确率高。且 Skill 的触发条件可以包含"业务规则"（如"该用户无权限调 X 工具"），这些规则在 LLM 判断前就过滤掉，比指望 LLM 理解权限更可靠。Skill 是"规则 + LLM"的混合，比纯 LLM auto 更可控。

### 第五层：验证与沉淀

**Q：你怎么衡量 MCP 接入的工具质量？怎么知道某个工具该优化还是该换掉？**

按工具统计核心指标：调用频次（该工具被调用多少次）、成功率（调用成功/总调用）、平均延迟、参数错误率（LLM 传错参数的占比）。调用频次低可能说明工具描述没写好（模型不知道用它）或确实没用；成功率低可能说明工具实现有 bug 或 schema 不清晰；参数错误率高说明 schema 描述要优化。按"频次 × 成功率"排序，高频但低成功率的工具优先优化。把工具质量看板纳入 Agent 的运维体系，定期淘汰低价值工具。

**Q：MCP 的工具生态怎么沉淀成团队/公司的复用能力？**

建公司内部的"MCP Server 市场"：各业务团队把自己的能力封装成标准 MCP Server（如订单查询、用户画像、支付），注册到统一目录。Agent 开发者从市场发现并挂载需要的 Server，不用自己实现工具。配套"Server 质量评级"（成功率/延迟/文档完整度）、"Server 版本管理"（工具 schema 变更要向后兼容）、"权限审计"（哪些 Agent 能调哪些 Server）。这是把工具从"每个 Agent 各自实现"变成"全公司共享生态"，类似微服务化的能力复用。

## 结构化回答

**30 秒电梯演讲：** Skill定义能力边界和触发条件，MCP做标准化工具接入，Agent按需动态调用——Skill像招聘JD（描述能力+触发条件）。

**展开框架：**
1. **Skill** — Skill定义能力边界、输入输出和触发条件
2. **Tool** — Tool是Skill的具体实现
3. **MCP** — MCP做标准化接入和Schema暴露

**收尾：** 您想深入聊：MCP和Function Calling有什么区别？


## 视频脚本

> 预计时长：4 分钟 | 由浅入深


| 时间 | 画面/字幕 | 口播台词 | 讲解要点 |
|------|----------|----------|----------|
| 0:00 | 标题卡：如何给Agent生成Skill并通过MCP接入外… | "Skill像招聘JD（描述能力+触发条件），MCP像标准化的API网关（统一接入+权限控制…" | 开场钩子 |
| 0:20 | 核心概念图 | "Skill定义能力边界和触发条件，MCP做标准化工具接入，Agent按需动态调用" | 核心定义 |
| 0:50 | Skill示意图 | "Skill——Skill定义能力边界、输入输出和触发条件" | 要点拆解1 |
| 1:30 | 对比/实战案例图 | "对比一下常见误区和工程实践，看真实场景里怎么取舍。" | 实战与对比 |
| 2:20 | 总结卡 | "记住核心要点。下期我们追问：MCP和Function Calling有什么区别？" | 收尾与钩子 |
