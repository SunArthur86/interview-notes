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
  analogy: 'Skill像招聘JD（描述能力+触发条件），MCP像标准化的API网关（统一接入+权限控制），Agent像HR（按需调用）'
  first_principle: 'Agent能力扩展需要标准化协议——Skill定义What（做什么），MCP定义How（怎么接入），Runtime定义When（何时调用）'
  key_points:
    - Skill定义能力边界、输入输出和触发条件
    - Tool是Skill的具体实现
    - MCP做标准化接入和Schema暴露
    - 执行时限制权限和超时
first_principle:
  essence: Agent要接入外部能力，需要统一的接口协议和安全管理
  derivation: '每个外部能力接口各异→集成成本高→需要标准化协议(MCP)→定义统一Schema→Agent Runtime动态注册和调用'
  conclusion: MCP是Agent生态的USB-C接口——标准化接入、统一管理、即插即用
follow_up:
  - 'MCP和Function Calling有什么区别？'
  - 'Skill的版本管理怎么做？'
  - '如何防止Agent调用恶意Tool？'
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
