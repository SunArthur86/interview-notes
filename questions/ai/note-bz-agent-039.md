---
id: note-bz-agent-039
difficulty: L3
category: ai
subcategory: Agent
tags:
  - B站面经
  - MCP
  - 工具协议
feynman:
  essence: 搭MCP服务=定义工具(Server)→实现标准接口→配置到Agent(Client)。核心是"把你的能力用MCP标准暴露，让任何支持MCP的Agent都能调用"。
  analogy: 像开餐厅接入外卖平台——把菜品(能力)按平台标准(菜单格式)上架，所有平台的骑手(各种Agent)都能来取餐(调用)。
  first_principle: MCP的价值是"一次封装，处处可用"。标准化接口后，你的工具不再绑定特定Agent框架。
  key_points:
    - MCP架构：Server(工具提供方)+Client(Agent)
    - 搭建步骤：定义工具→实现Server→注册到Client
    - 核心：JSON-RPC标准协议
    - 价值：工具复用、框架无关
first_principle:
  essence: MCP是工具的"通用适配器"——定义统一接口，解耦工具和Agent。
  derivation: '没有MCP：每个Agent框架有自己的工具格式，工具要适配N个框架。有MCP：工具实现MCP接口，任何MCP客户端都能用。一次实现，处处可用。'
  conclusion: MCP服务搭建 = 按标准协议暴露工具能力 + 注册到Agent使用
follow_up:
  - MCP用什么协议？——JSON-RPC 2.0 over stdio/SSE
  - 怎么保证安全？——权限控制+沙箱+审计
  - 支持哪些语言？——Python/TypeScript SDK官方支持
---

# 如何从 0 搭建一个专属 MCP 服务？

## 一、MCP 架构

```
┌──────────────────────────────────────────────────┐
│                  MCP 架构                          │
├──────────────────────────────────────────────────┤
│                                                    │
│  ┌──────────────┐         ┌──────────────┐       │
│  │  MCP Client  │ ←JSON-RPC→ │  MCP Server  │       │
│  │  (Agent侧)    │           │  (工具侧)     │       │
│  │              │           │              │       │
│  │ - Claude     │           │ - 你的工具    │       │
│  │ - Cursor     │           │ - DB接口     │       │
│  │ - 自研Agent  │           │ - API封装    │       │
│  └──────────────┘           └──────────────┘       │
│                                                    │
│  协议: JSON-RPC 2.0                                │
│  传输: stdio (本地) / SSE (远程)                   │
│                                                    │
└──────────────────────────────────────────────────┘
```

## 二、搭建步骤

### Step 1：定义你的工具

```python
# 假设你要暴露"查询公司内部知识库"的能力
# 先想清楚：有哪些工具？参数是什么？返回什么？

tools_definition = [
    {
        "name": "search_kb",
        "description": "搜索公司知识库",
        "inputSchema": {
            "type": "object",
            "properties": {
                "query": {"type": "string", "description": "搜索关键词"},
                "limit": {"type": "integer", "default": 5}
            },
            "required": ["query"]
        }
    },
    {
        "name": "get_doc",
        "description": "获取指定文档全文",
        "inputSchema": {
            "type": "object",
            "properties": {
                "doc_id": {"type": "string"}
            },
            "required": ["doc_id"]
        }
    }
]
```

### Step 2：实现 MCP Server（Python SDK）

```python
from mcp import Server
from mcp.types import Tool, TextContent

# 创建MCP Server
server = Server("my-kb-server")

@server.list_tools()
async def list_tools() -> list[Tool]:
    """声明可用工具"""
    return [
        Tool(
            name="search_kb",
            description="搜索公司知识库",
            inputSchema={
                "type": "object",
                "properties": {
                    "query": {"type": "string"}
                },
                "required": ["query"]
            }
        ),
        Tool(
            name="get_doc",
            description="获取文档全文",
            inputSchema={
                "type": "object",
                "properties": {"doc_id": {"type": "string"}},
                "required": ["doc_id"]
            }
        )
    ]

@server.call_tool()
async def call_tool(name: str, arguments: dict) -> list[TextContent]:
    """处理工具调用"""
    if name == "search_kb":
        # 你的业务逻辑
        results = my_kb_search(arguments["query"])
        return [TextContent(
            type="text",
            text=json.dumps(results, ensure_ascii=False)
        )]
    
    elif name == "get_doc":
        doc = my_kb_get(arguments["doc_id"])
        return [TextContent(type="text", text=doc.content)]
    
    else:
        raise ValueError(f"未知工具: {name}")

# 启动Server
if __name__ == "__main__":
    import asyncio
    from mcp.stdio import stdio_server
    
    async def main():
        async with stdio_server() as (read, write):
            await server.run(read, write, server.create_initialization_options())
    
    asyncio.run(main())
```

### Step 3：注册到 Agent（Client 侧）

```json
// Claude Desktop配置 (claude_desktop_config.json)
{
  "mcpServers": {
    "my-kb": {
      "command": "python",
      "args": ["/path/to/my_kb_server.py"]
    }
  }
}
```

```python
# 自研Agent接入MCP Client
from mcp import ClientSession, StdioServerParameters
from mcp.client.stdio import stdio_client

async def use_mcp_tool():
    # 连接MCP Server
    server_params = StdioServerParameters(
        command="python",
        args=["my_kb_server.py"]
    )
    
    async with stdio_client(server_params) as (read, write):
        async with ClientSession(read, write) as session:
            await session.initialize()
            
            # 获取可用工具
            tools = await session.list_tools()
            
            # 调用工具
            result = await session.call_tool(
                "search_kb",
                arguments={"query": "报销流程"}
            )
            print(result)
```

### Step 4：测试验证

```python
# 测试你的MCP工具是否正常工作
async def test():
    async with ClientSession(...) as session:
        # 1. 测试工具列表
        tools = await session.list_tools()
        assert "search_kb" in [t.name for t in tools]
        
        # 2. 测试工具调用
        result = await session.call_tool("search_kb", {"query": "test"})
        assert result.content[0].text is not None
        
        # 3. 测试错误处理
        try:
            await session.call_tool("search_kb", {})  # 缺参数
        except Exception:
            print("错误处理正常")

asyncio.run(test())
```

## 三、生产级 MCP 服务要点

```python
class ProductionMCPServer:
    """生产级MCP服务的注意事项"""
    
    # 1. 错误处理
    async def call_tool(self, name, arguments):
        try:
            validate_input(name, arguments)  # 参数校验
            result = await self.execute(name, arguments)
            validate_output(result)  # 输出校验
            return result
        except ValidationError as e:
            return error_response(f"参数错误: {e}")
        except Exception as e:
            log_error(e)
            return error_response("内部错误")
    
    # 2. 权限控制
    async def call_tool(self, name, arguments):
        if not self.check_permission(name):
            return error_response("无权限")
    
    # 3. 限流
    @rate_limit(100, 60)  # 每分钟100次
    async def call_tool(self, name, arguments):
        ...
    
    # 4. 审计日志
    async def call_tool(self, name, arguments):
        log_call(name, arguments, caller=self.client_id)
        result = await self.execute(name, arguments)
        log_result(name, result)
    
    # 5. 超时控制
    @timeout(30)
    async def execute(self, name, arguments):
        ...
```

## 四、常见 MCP 服务类型

```
1. 数据源 MCP
   - 数据库(MySQL/PG/Mongo)
   - 文件系统
   - API网关

2. 工具 MCP
   - 代码执行(Python/Node沙箱)
   - 图表生成
   - 文件转换

3. 集成 MCP
   - GitHub/GitLab
   - Slack/钉钉
   - Jira/Confluence

4. 领域 MCP
   - 企业知识库
   - 业务系统ERP/CRM
```

## 五、面试加分点

1. **四步走**：定义工具→实现 Server→注册 Client→测试，流程清晰
2. **强调"一次实现处处可用"**：MCP 的核心价值是解耦，工具不绑定框架
3. **提生产要点**：权限/限流/审计/错误处理，体现工程化思维
