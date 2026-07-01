---
id: note-bg-012
difficulty: L3
category: ai
subcategory: Agent框架
tags:
- 八股总结
- 面经
- MCP
- Skill
- Function Call
- Agent工具调用
feynman:
  essence: MCP（Model Context Protocol）是连接LLM与外部工具/数据源的标准化协议（类似USB-C）；Skill是预定义的能力包（任务模板+工具+知识）。Function Call是LLM输出结构化函数调用的能力，是所有工具调用的底层机制。
  analogy: Function Call是"打电话的能力"（基础机制）。MCP是"统一的电话协议标准"（让所有电话能互通）。Skill是"预设的快捷拨号+通话脚本"（打包好的复杂任务流程）。
  first_principle: Agent调用工具的本质是"LLM输出结构化的函数调用指令"。Function Call是底层能力（输出{tool, args}）。MCP解决了"每个工具都要单独适配LLM"的碎片化问题（标准化接口）。Skill解决了"复杂任务需要多步编排"的问题（预封装流程）。
  key_points:
  - Function Call：LLM输出结构化{tool_name, arguments}的能力（底层）
  - MCP：标准化的工具/数据源接入协议（中间层，解决碎片化）
  - Skill：封装好的任务能力包（应用层，解决复杂编排）
  - 三者是层次关系：Function Call < MCP < Skill
first_principle:
  essence: 工具调用的标准化分为三层：能力层(Function Call) + 协议层(MCP) + 应用层(Skill)
  derivation: 早期每个工具都要为每个LLM单独写适配代码（M×N问题）。MCP定义了统一协议，工具只需实现一次，所有支持MCP的LLM都能用（M+N问题）。Skill在工具之上封装"如何完成某类任务"，让Agent不用从零规划复杂流程。
  conclusion: Function Call是基础，MCP是生态，Skill是体验，三者协同构成现代Agent工具体系
follow_up:
- MCP和传统的Plugin/API有什么区别？
- 如何开发一个MCP Server？
- Skill和Agent模板(如AutoGPT的prompt)有什么区别？
memory_points:
- 抽象层级：Function Call是底层能力，而Skill和MCP是上层的标准封装协议
- Function Call：LLM原生能力，直接输出结构化JSON指令替代文本解析
- MCP协议：Client与Server解耦，把M×N适配降维成M+N的标准化工具生态
- Skill侧重：Agent内化的业务流，MCP侧重跨模型跨平台的外部工具通信规范
---

# 【八股总结】MCP、Skill、Function Call 的关系与区别

## 一、Function Call：工具调用的底层能力

### 1.1 什么是Function Call

```python
# Function Call：LLM原生支持输出结构化的"函数调用指令"

response = client.chat.completions.create(
    model="gpt-4",
    messages=[{"role": "user", "content": "北京天气怎么样？"}],
    tools=[{
        "type": "function",
        "function": {
            "name": "get_weather",
            "description": "查询某城市天气",
            "parameters": {
                "type": "object",
                "properties": {
                    "city": {"type": "string", "description": "城市名"}
                },
                "required": ["city"]
            }
        }
    }],
    tool_choice="auto"
)

# LLM直接输出结构化的函数调用（而非文本）：
# response.tool_calls = [{
#     "name": "get_weather",
#     "arguments": {"city": "北京"}
# }]

# 应用层执行：
result = get_weather(city="北京")
# 把结果喂回LLM继续对话
```

### 1.2 Function Call 的意义

```python
# 没有Function Call时（ReAct模式，用文本解析）
llm_output = """
Thought: 我需要查天气
Action: get_weather(city=北京)
"""
# 问题：解析Action文本容易出错，格式不统一

# 有Function Call时
tool_call = response.tool_calls[0]
tool_name = tool_call.function.name      # "get_weather"
tool_args = json.loads(tool_call.function.arguments)  # {"city": "北京"}
# 结构化、可靠、标准化
```

### 1.3 Function Call是所有工具调用的基础

```
所有上层的工具调用机制（MCP、Skill、Agent框架）底层都依赖Function Call：

用户问题
   ↓
LLM + Function Call → 输出 {tool: "xxx", args: {...}}
   ↓
执行层调用实际工具
   ↓
结果返回LLM
   ↓
继续对话

MCP/Skill/各种Agent框架
   ↑ 都是在这个流程之上做封装
```

## 二、MCP：标准化的工具接入协议

### 2.1 MCP要解决的问题

```python
# 没有MCP的世界：M×N适配问题

LLMs: [GPT-4, Claude, Gemini, LLaMA, Qwen, ...]  # M个
Tools: [数据库, 搜索, 文件系统, GitHub, Slack, ...]  # N个

# 每个LLM要用每个工具，都需要单独适配：
# GPT-4 + 数据库 → 写一套适配
# Claude + 数据库 → 再写一套
# GPT-4 + 搜索 → 又写一套
# ...
# 总共 M × N 套适配代码！

# 每个LLM的API还不同（OpenAI vs Anthropic格式）
# → 开发者痛苦，生态碎片化
```

### 2.2 MCP的解决方案

```python
# MCP（Model Context Protocol，Anthropic 2024提出）
# 定义统一的"工具接入协议"

# 架构：
# ┌──────────┐      MCP协议      ┌──────────────┐
# │ LLM Host │ ←────────────────→│ MCP Server   │
# │ (Claude/ │   (标准化JSON)    │ (工具实现)    │
# │  Cursor) │                   │              │
# └──────────┘                   └──────────────┘
#                                     ↓
#                              ┌──────────────┐
#                              │ 实际工具      │
#                              │ (DB/API/FS)  │
#                              └──────────────┘

# 关键：LLM Host和MCP Server之间用标准协议通信
# - 工具开发者：只需实现MCP Server（一套），所有支持MCP的LLM都能用
# - LLM厂商：只需支持MCP协议（一套），所有MCP工具都能接入
# - M × N → M + N 问题解决！
```

### 2.3 MCP Server的结构

```python
# MCP Server定义三类能力：
class MCPServer:
    # 1. Tools（工具）：可被LLM调用的函数
    tools = [
        {
            "name": "query_database",
            "description": "查询数据库",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "sql": {"type": "string"}
                }
            }
        }
    ]

    # 2. Resources（资源）：可被LLM读取的数据
    resources = [
        {
            "uri": "file:///project/README.md",
            "name": "项目说明",
            "mimeType": "text/markdown"
        }
    ]

    # 3. Prompts（提示模板）：预定义的提示词
    prompts = [
        {
            "name": "code_review",
            "description": "代码审查提示",
            "arguments": [{"name": "language"}]
        }
    ]

    # 标准化的方法实现
    async def handle_call_tool(self, name, arguments):
        if name == "query_database":
            return await self.db.execute(arguments["sql"])

    async def handle_read_resource(self, uri):
        return await self.read_file(uri)
```

### 2.4 MCP vs 传统Plugin/API

```
┌──────────────┬────────────────────┬────────────────────┐
│              │ 传统Plugin/API     │ MCP                │
├──────────────┼────────────────────┼────────────────────┤
│ 标准化       │ 各家不同           │ 统一协议           │
│ 跨LLM        │ 需要每家单独适配   │ 写一次到处用       │
│ 发现机制     │ 手动注册           │ 自动发现tools      │
│ 双向通信     │ 单向(请求-响应)    │ 双向(支持订阅通知) │
│ 安全模型     │ 各自实现           │ 标准化的权限控制   │
│ 生态         │ 碎片化             │ 统一生态           │
└──────────────┴────────────────────┴────────────────────┘

MCP类比：
- USB-C接口：硬件统一了接口标准
- HTTP协议：Web通信统一了协议
- MCP：AI工具调用统一了协议
```

## 三、Skill：封装的任务能力包

### 3.1 什么是Skill

```python
# Skill = 预封装的"任务能力包"
# 包含：提示词模板 + 工具组合 + 执行流程 + 领域知识

# 以"代码审查Skill"为例
class CodeReviewSkill:
    name = "code_review"
    description = "对代码进行全面审查，输出改进建议"

    # 1. 提示词模板
    prompt_template = """
    你是资深代码审查专家。审查以下代码：

    语言：{language}
    代码：{code}

    审查维度：
    1. 正确性（逻辑错误、边界条件）
    2. 性能（时间/空间复杂度）
    3. 可读性（命名、注释、结构）
    4. 安全性（注入、权限）
    5. 最佳实践（语言特性、设计模式）

    输出格式：
    ## 严重问题（必须修复）
    ## 改进建议（推荐修复）
    ## 良好实践（保持）
    """

    # 2. 用到的工具
    required_tools = ["read_file", "search_pattern", "run_tests"]

    # 3. 执行流程
    def execute(self, context):
        code = self.read_target_code(context)
        tests = self.run_existing_tests(context)  # 先跑测试看现状
        review = self.llm.analyze(self.prompt_template, code, tests)
        return review

    # 4. 领域知识（注入prompt）
    domain_knowledge = load("code_review_best_practices.md")
```

### 3.2 Skill vs 简单的Prompt

```python
# 简单Prompt（一次性）：
prompt = "审查这段代码：{code}"
# 问题：
# - 每次都要重新描述审查标准
# - 没有固定流程（先跑测试？先读结构？）
# - 没有领域知识注入

# Skill（封装的能力）：
# - 标准化的审查流程（先跑测试→静态分析→LLM审查）
# - 预置的最佳实践知识库
# - 可复用、可组合、可版本管理
# - 用户只需说"审查代码"，Skill自动编排
```

### 3.3 Skill的层次

```
Skill的复杂度层次：

Level 1: Prompt Skill
  └── 只是预定义的提示词模板
  └── 如："翻译技能" = 翻译prompt + 语言对参数

Level 2: Tool-orchestration Skill
  └── 编排多个工具完成复杂任务
  └── 如："数据分析技能" = 读文件 + 清洗 + 统计 + 可视化

Level 3: Knowledge-augmented Skill
  └── 带领域知识库的能力包
  └── 如："法律咨询技能" = 法律知识库 + 检索 + 专业prompt

Level 4: Self-improving Skill
  └── 能从反馈中学习的技能
  └── 如："个性化写作技能" = 根据用户反馈调整风格
```

## 四、三者关系：层次架构

```
┌─────────────────────────────────────────────┐
│ 应用层：Skill                               │
│ ┌─────────┐ ┌─────────┐ ┌─────────┐       │
│ │代码审查 │ │数据分析 │ │文档撰写 │ ...   │
│ │Skill   │ │Skill   │ │Skill   │       │
│ └─────────┘ └─────────┘ └─────────┘       │
├─────────────────────────────────────────────┤
│ 协议层：MCP                                  │
│ ┌─────────┐ ┌─────────┐ ┌─────────┐       │
│ │Database │ │File Sys │ │Web Srch │ ...   │
│ │MCP Srv  │ │MCP Srv  │ │MCP Srv  │       │
│ └─────────┘ └─────────┘ └─────────┘       │
├─────────────────────────────────────────────┤
│ 能力层：Function Call                        │
│ LLM原生能力：输出 {tool_name, arguments}    │
└─────────────────────────────────────────────┘

关系：
- Function Call是底层机制（LLM能输出工具调用）
- MCP是中间协议（标准化工具接入）
- Skill是上层封装（打包复杂任务能力）

类比：
- Function Call ≈ HTTP（传输协议）
- MCP ≈ RESTful标准（API设计规范）
- Skill ≈ SDK/客户端库（封装好的功能包）
```

## 五、实际工作流示例

```python
# 场景：用户说"帮我审查src/auth.py的代码"

# Step 1: Agent识别这是"代码审查"任务
agent.match_skill(user_intent="审查代码")
# → 激活 CodeReviewSkill

# Step 2: Skill编排执行
class CodeReviewExecution:
    def run(self, filepath):
        # 2a. 通过MCP读取文件内容
        file_content = mcp_client.call_tool(
            "read_file",
            {"path": filepath}
        )
        # 底层：LLM用Function Call输出 read_file(path=...)
        #       MCP Server执行实际文件读取

        # 2b. 通过MCP搜索相关测试
        tests = mcp_client.call_tool(
            "search_pattern",
            {"pattern": f"test.*{filepath.stem}", "glob": "**/test_*.py"}
        )

        # 2c. 通过MCP运行测试
        test_results = mcp_client.call_tool(
            "run_command",
            {"command": f"pytest tests/test_{filepath.stem}.py"}
        )

        # 2d. 用Skill的prompt模板做LLM审查
        review = llm.chat(
            messages=[{
                "role": "user",
                "content": self.skill.render_prompt(
                    code=file_content,
                    tests=test_results
                )
            }],
            tools=self.skill.get_additional_tools()  # 如查文档
        )

        return review

# 整个过程：
# Skill编排 → MCP调用工具 → 底层是Function Call
# 三层协同，用户只需一句话
```

## 加分点

1. **用M×N→M+N类比解释MCP价值**：体现对标准化协议本质的理解
2. **区分Skill的四个层次**：从简单prompt到自学习，体现对Agent能力封装的深度思考
3. **理解三者是层次而非替代**：Function Call不会因为有了MCP就过时，是协同关系

## 雷区

- **混淆三个概念**：Function Call是机制，MCP是协议，Skill是封装——不同层次
- **认为MCP万能**：MCP只是协议，工具的实际能力还是需要开发者实现
- **忽视Function Call的底层地位**：所有上层方案最终都要靠Function Call落地

## 扩展

- **MCP规范**：Anthropic 2024开源，modelcontextprotocol.io
- **Claude Skills**：Anthropic的Skill系统，用SKILL.md定义
- **Cursor/Cline的MCP集成**：实际IDE Agent如何使用MCP接入工具
- **OpenAI的Function Calling演进**：从tools到parallel_function_calling到computer_use

## 记忆要点

- 抽象层级：Function Call是底层能力，而Skill和MCP是上层的标准封装协议
- Function Call：LLM原生能力，直接输出结构化JSON指令替代文本解析
- MCP协议：Client与Server解耦，把M×N适配降维成M+N的标准化工具生态
- Skill侧重：Agent内化的业务流，MCP侧重跨模型跨平台的外部工具通信规范

