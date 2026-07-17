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
  derivation: 没有MCP：每个Agent框架有自己的工具格式，工具要适配N个框架。有MCP：工具实现MCP接口，任何MCP客户端都能用。一次实现，处处可用。
  conclusion: MCP服务搭建 = 按标准协议暴露工具能力 + 注册到Agent使用
follow_up:
- MCP用什么协议？——JSON-RPC 2.0 over stdio/SSE
- 怎么保证安全？——权限控制+沙箱+审计
- 支持哪些语言？——Python/TypeScript SDK官方支持
memory_points:
- 通信架构：Client(Agent侧)与Server(工具侧)基于JSON-RPC 2.0协议通信。
- 传输方式：本地用stdio，远程用SSE。
- 开发三步：1.定义工具(参数与Schema)；2.用SDK实现Server(@list_tools与@call_tool)；3.配置Agent连接。
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

## 记忆要点

- 通信架构：Client(Agent侧)与Server(工具侧)基于JSON-RPC 2.0协议通信。
- 传输方式：本地用stdio，远程用SSE。
- 开发三步：1.定义工具(参数与Schema)；2.用SDK实现Server(@list_tools与@call_tool)；3.配置Agent连接。


## 苏格拉底式面试追问

> 这组追问模拟面试官层层逼问，每一问先回答"为什么"，再回答"怎么做"，最后回答"如何证明"。

### 第一层：目标与动机

**Q：搭 MCP 服务本质是"用 MCP 标准暴露能力"，为什么不直接写个 HTTP API 让 Agent 调用，非要套一层 MCP 协议？**

因为 MCP 提供了 HTTP API 没有的"Agent 生态标准化"。1）工具自动发现——MCP Server 启动后，Client 通过 `tools/list` 自动发现所有工具及其 schema（参数/返回格式），Agent 无需手动配置"调用哪个 URL、传什么参数"；HTTP API 要 Agent 开发者手写每个工具的调用代码；2）跨 Agent 复用——一个 MCP Server 写一次，任何支持 MCP 的 Agent（Claude/其他）都能用，HTTP API 通常要为每个 Agent 适配；3）标准化交互——MCP 定义了 `tools/call`、`resources/read`、`prompts/get` 等标准方法，Agent 不用关心 Server 内部实现。所以搭 MCP 服务的价值是"写一次，所有 MCP 客户端都能用"，而非一次性 HTTP 接口。

### 第二层：证据与定位

**Q：你搭的 MCP 服务被 Agent 调用时返回结果不对，怎么定位是 Server 的工具实现问题还是协议对接问题？**

分层排查。1）协议层——用 MCP Inspector（官方调试工具）直接调 `tools/list` 看工具注册是否正确（名称/schema/描述），再调 `tools/call` 传测试参数看返回，如果 Inspector 返回错误（如"方法未实现""参数 schema 不符"），是协议对接问题；2）工具实现层——如果协议返回正确结构但内容错（如查数据库返回空/错误数据），是工具内部逻辑问题，单独测工具函数（绕过 MCP）。常见协议问题：JSON-RPC 消息格式错（id/method/params 缺失）、stdio 传输有脏输出（print 混入 stdout 干扰协议）、SSE 连接未正确握手。定位方法：开 MCP Server 的 debug 日志（`DEBUG=*`），看完整的请求/响应 JSON。

### 第三层：根因深挖

**Q：MCP 服务要定义工具的"描述"（让 Agent 知道何时用），描述写不好导致 Agent 误调用/漏调用，怎么写好工具描述？**

描述要包含"功能 + 触发场景 + 参数语义 + 边界"。1）功能——这个工具干什么（如"查询用户的订单列表"）；2）触发场景——什么情况用（如"当用户询问订单/购买记录时"）；3）参数语义——每个参数什么意思、什么格式（如"user_id: 用户唯一ID，字符串，非用户名"）；4）边界——不干什么（如"此工具只查订单，不能查支付记录"），帮 Agent 区分相似工具。反例："查询工具"（太模糊）、"用这个查数据"（没说什么数据）。验证：给 Agent 工具列表，测几个典型 query，看 Agent 是否选对工具——选错说明描述不够清晰或边界没写。

**Q：MCP Server 把所有工具都暴露给 Client，但有些工具是高风险的（如删除数据/支付），为什么不全部开放让 Agent 自己判断？**

Agent 的自主判断不可靠（可能误用高危工具），高危工具要"权限分级 + 确认机制"。1）权限分级——工具标记风险等级（read/write/dangerous），Client 按等级控制（read 自动允许，write 询问用户，dangerous 强制人工确认）；2）白名单/黑名单——MCP Server 注册时声明哪些工具是"只读"（安全）、哪些是"写"（需授权），Agent 配置时只授予需要的工具；3）审计日志——高危工具调用全程记录（谁调的/参数/结果/是否用户确认），事后可追溯。全部开放的风险：Agent 误判（如"清理数据"工具被当成"查询"误调）导致数据丢失。所以高危工具不靠 Agent 自主，靠"权限+确认+审计"三重防护。

### 第四层：方案权衡

**Q：MCP 支持多种传输（stdio/SSE/HTTP），搭服务时怎么选？**

按部署场景选。1）stdio——Server 作为 Agent 的子进程，通过标准输入输出通信，适合"本地工具"（如本地文件操作、本地命令），零网络开销，配置简单（启动 Agent 时 fork Server）；2）SSE/HTTP——Server 是独立服务，跨网络调用，适合"远程服务"（如公司的 GitHub/DB 统一服务），多 Agent 共享一个 Server，可独立扩缩容。决策：本地单机工具用 stdio（快），跨团队/跨服务复用的工具用 HTTP/SSE（标准）。实务：个人 Agent 的本地工具（读文件/执行脚本）用 stdio，公司级共享工具（如统一的用户查询服务）用 HTTP。

**Q：MCP 服务搭好后要维护（工具更新/新增），但 Server 改了工具 schema 可能让已对接的 Agent 报错，怎么平衡"迭代"和"兼容"？**

版本化 + 向后兼容。1）版本号——Server 声明版本，工具变更（加字段/改行为）升版本，Client 知道差异；2）向后兼容——工具改 schema 时只加不删（新参数有默认值，老 Client 不传也能用），删/改参数要废弃老版本过渡（标记 deprecated，同时提供新版本，给 Client 迁移时间）；3）变更通知——Server 变更通过 `notifications/tools/list_changed` 通知 Client 重新拉取工具列表，Client 动态适配。极端情况（必须 breaking change）要协调 Client 升级。原则：宁可新增工具（v2）也别改老工具，让新老 Client 各用各的。

### 第五层：验证与沉淀

**Q：你怎么衡量搭的 MCP 服务是否成功（被用起来 vs 形同虚设）？**

四个指标。1）接入 Agent 数——有多少 Agent/Client 接入了这个 Server，多说明生态价值高；2）工具调用频率——各工具的调用次数/天，高频工具是核心能力，零调用的工具该下线（设计错了或没用）；3）调用成功率——工具执行成功比例（失败率高说明工具实现/稳定性差），目标 >95%；4）开发者反馈——接入方反馈（文档清不清楚、schema 对不对、bug 多不多），差则优化。综合：高接入+高频+高成功+好反馈的 Server 是成功资产；低接入/低频/低质的是失败（要么下线要么重构）。

**Q：搭 MCP 服务这件事怎么沉淀成团队的能力平台？**

建 MCP 平台：1）Server 脚手架——提供标准模板（按 MCP 规范实现 tools/list、tools/call 等接口），开发者只写工具函数，框架处理协议；2）Server 市场——注册中心，团队共享 MCP Server（如 GitHub Server、DB Server），避免重复造；3）质量治理——Server 上线前过标准测试（协议符合性/工具正确性/安全性），带评分；4）版本管理——Server 版本化 + 变更通知 + 向后兼容规范；5）监控——调用频率/成功率/延迟自动统计。这套写入团队 Agent 平台 SOP，让"搭 MCP 服务"从"每个团队自己摸索"变成"用平台标准化产出"。

## 结构化回答

**30 秒电梯演讲：** 搭MCP服务=定义工具(Server)→实现标准接口→配置到Agent(Client)。核心是"把你的能力用MCP标准暴露，让任何支持MCP的Agent都能调用"。

**展开框架：**
1. **MCP架构** — Server(工具提供方)+Client(Agent)
2. **搭建步骤** — 定义工具→实现Server→注册到Client
3. **核心** — JSON-RPC标准协议

**收尾：** 您想深入聊：MCP用什么协议？——JSON-RPC 2.0 over stdio/SSE？


## 视频脚本

> 预计时长：4 分钟 | 由浅入深


| 时间 | 画面/字幕 | 口播台词 | 讲解要点 |
|------|----------|----------|----------|
| 0:00 | 标题卡：如何从 0 搭建一个专属 MCP 服务？ | "像开餐厅接入外卖平台——把菜品(能力)按平台标准(菜单格式)上架，所有平台的骑手(各种…" | 开场钩子 |
| 0:20 | 核心概念图 | "搭MCP服务=定义工具(Server)→实现标准接口→配置到Agent(Client)。核心是"把你的能力用MCP标准暴…" | 核心定义 |
| 0:50 | MCP架构示意图 | "MCP架构——Server(工具提供方)+Client(Agent)" | 要点拆解1 |
| 1:30 | 对比/实战案例图 | "对比一下常见误区和工程实践，看真实场景里怎么取舍。" | 实战与对比 |
| 2:20 | 总结卡 | "记住核心要点。下期我们追问：MCP用什么协议？——JSON-RPC 2.0 over s？" | 收尾与钩子 |
