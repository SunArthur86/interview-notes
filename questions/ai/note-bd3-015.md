---
id: note-bd3-015
difficulty: L3
category: ai
subcategory: Agent
tags:
  - 字节跳动
  - 面经
  - 二面
feynman:
  essence: LLM Agent = LLM(大脑) + Planning(规划) + Memory(记忆) + Tools(工具) + Action(执行)，让LLM从"只会说"变成"能做事"
  analogy: 'Agent像一个有手有脚的员工——LLM是大脑（思考），Planning是日程表（分解任务），Memory是笔记本（记住历史），Tools是工具箱（搜索/计算/API），Action是执行（真正动手干活）'
  first_principle: 'Agent的本质是让LLM在Observation-Thinking-Action循环中与环境交互，从被动回答变成主动解决问题'
  key_points:
    - 'Planning: 任务分解、反思、自我修正'
    - 'Memory: 短期(对话历史) + 长期(向量检索/知识库)'
    - 'Tools: Function Calling、代码执行、API调用'
    - 'Action: ReAct循环 (Reason→Act→Observe)'
first_principle:
  essence: Agent系统将LLM的推理能力与外部环境的执行能力连接起来
  derivation: '纯LLM只能基于训练知识生成文本。Agent通过工具调用扩展LLM的感知和行动范围，通过记忆扩展时间跨度，通过规划扩展任务复杂度'
  conclusion: 完整的Agent系统是Planning+Memory+Tools的有机组合，缺一不可
follow_up:
  - Agent的ReAct和Plan-and-Execute有什么区别？
  - 如何评估Agent系统的效果？
  - 多Agent协作系统如何设计？
---

# 一个完整的LLM Agent系统通常由哪些核心模块组成？

> 来源：字节跳动大模型技术面试二面

## Agent 系统架构

```
┌──────────────────────────────────────────────────────────────┐
│                    LLM Agent 系统架构                          │
│                                                              │
│                    ┌─────────────┐                           │
│                    │   用户输入   │                           │
│                    └──────┬──────┘                           │
│                           │                                  │
│                    ┌──────▼──────┐                           │
│                    │   LLM Core  │ ← 大脑(Central Reasoner)  │
│                    │  (推理引擎)  │                           │
│                    └──┬──┬──┬──┘                            │
│            ┌──────────┘  │  └──────────┐                    │
│            ▼            ▼              ▼                     │
│     ┌──────────┐ ┌──────────┐ ┌──────────────┐              │
│     │ Planning │ │ Memory   │ │ Tool Use     │              │
│     │ (规划)   │ │ (记忆)   │ │ (工具调用)   │              │
│     └────┬─────┘ └────┬─────┘ └──────┬───────┘              │
│          │            │              │                       │
│     ┌────▼─────┐ ┌────▼─────┐ ┌─────▼──────┐               │
│     │任务分解   │ │短期记忆   │ │搜索引擎    │               │
│     │反思修正   │ │长期记忆   │ │代码沙箱    │               │
│     │策略选择   │ │工作记忆   │ │API调用     │               │
│     │优先级排序 │ │摘要压缩   │ │数据库查询  │               │
│     └──────────┘ └──────────┘ │文件操作    │               │
│                                └────────────┘               │
│                           │                                  │
│                    ┌──────▼──────┐                          │
│                    │  Observation│ ← 观察执行结果             │
│                    │  (感知反馈) │                           │
│                    └──────┬──────┘                          │
│                           │                                  │
│                    ┌──────▼──────┐                          │
│                    │   用户输出   │                           │
│                    └─────────────┘                          │
└──────────────────────────────────────────────────────────────┘
```

## 核心模块详解

### 1. Planning（规划模块）

```python
class PlanningModule:
    """任务规划与分解"""
    
    def plan(self, task: str) -> list:
        """
        ReAct模式: Think → Act → Observe 循环
        Plan-and-Execute模式: 先全局规划再逐步执行
        """
        # Step 1: 任务分解
        steps = self.llm.generate(f"""
        将以下任务分解为可执行的子步骤:
        任务: {task}
        
        输出格式:
        1. [子任务描述]
        2. [子任务描述]
        ...
        """)
        
        return parse_steps(steps)
    
    def reflect(self, action_result: str, original_plan: str):
        """反思: 根据执行结果修正计划"""
        reflection = self.llm.generate(f"""
        上一部执行结果: {action_result}
        原计划: {original_plan}
        
        反思: 这一步成功了吗？需要调整后续计划吗？
        """)
        return reflection
```

```
Planning策略对比:

ReAct (Reasoning + Acting):
  Thought: 用户要查北京天气，我需要调用天气API
  Action: search_weather("北京")
  Observation: 北京今天晴，25°C
  Thought: 获取到天气信息，可以回答了
  Answer: 北京今天晴，气温25°C

Plan-and-Execute:
  Plan: 1.查天气 2.查穿衣建议 3.综合回答
  Execute Step 1: search_weather("北京") → 晴25°C
  Execute Step 2: get_clothing_advice(25) → 薄外套
  Execute Step 3: 综合回答用户

Tree-of-Thoughts (ToT):
  对复杂问题生成多个思维分支
  对每个分支评估可行性
  选择最优路径深入
```

### 2. Memory（记忆模块）

```
┌──────────────────────────────────────────────┐
│              Agent Memory 架构                │
│                                              │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  │
│  │ 短期记忆  │  │ 工作记忆  │  │ 长期记忆  │  │
│  │(对话历史)│  │(当前任务)│  │(向量检索)│  │
│  └──────────┘  └──────────┘  └──────────┘  │
│                                              │
│  短期: 最近N轮对话 (Context Window)          │
│  工作记忆: 当前任务状态、中间结果              │
│  长期: 向量数据库存储历史交互                 │
└──────────────────────────────────────────────┘
```

```python
class MemoryModule:
    def __init__(self):
        self.short_term = []          # 对话历史
        self.working_memory = {}      # 当前任务状态
        self.long_term_store = None   # 向量数据库
    
    def add_message(self, role, content):
        self.short_term.append({"role": role, "content": content})
        # 滑动窗口: 保持最近K轮
        if len(self.short_term) > 20:
            # 压缩旧消息为摘要
            old = self.short_term[:10]
            summary = self.summarize(old)
            self.short_term = [{"role": "system", "content": summary}] + self.short_term[10:]
    
    def recall(self, query, top_k=5):
        """从长期记忆中检索相关历史"""
        results = self.long_term_store.search(query, top_k=top_k)
        return results
```

### 3. Tool Use（工具调用模块）

```python
class ToolModule:
    """工具注册与调用"""
    
    def __init__(self):
        self.tools = {
            "search": self.web_search,
            "calculate": self.calculator,
            "code_execute": self.code_sandbox,
            "database_query": self.db_query,
        }
        self.tool_schemas = self._generate_schemas()
    
    def call_tool(self, tool_name, **params):
        """通过Function Calling调用工具"""
        if tool_name not in self.tools:
            return {"error": f"Unknown tool: {tool_name}"}
        
        try:
            result = self.tools[tool_name](**params)
            return {"status": "success", "result": result}
        except Exception as e:
            return {"status": "error", "error": str(e)}
```

```
工具调用流程 (Function Calling):

用户: "帮我查一下苹果公司的最新股价"

LLM推理:
  → 识别需要调用 search_stock_price(symbol="AAPL")
  → 返回 tool_call: {name: "search_stock_price", args: {symbol: "AAPL"}}

Agent执行:
  → 调用API获取股价
  → 返回: {price: 178.50, change: +2.3%}

LLM推理:
  → 基于结果生成自然语言回答
  → "苹果公司(AAPL)最新股价为178.50美元，上涨2.3%"
```

### 4. Action/Execution Loop

```
┌──────────────────────────────────────────────┐
│           Agent 主循环 (ReAct Loop)           │
│                                              │
│   ┌──────┐                                   │
│   │START │                                   │
│   └──┬───┘                                   │
│      ▼                                       │
│   ┌──────────┐                              │
│   │ Observe  │ ← 观察用户输入/工具结果        │
│   └────┬─────┘                              │
│        ▼                                     │
│   ┌──────────┐                              │
│   │  Think   │ ← LLM推理: 下一步做什么?      │
│   └────┬─────┘                              │
│        ▼                                     │
│   ┌──────────┐     ┌──────────┐             │
│   │   Act    │────→│ 工具执行  │             │
│   └────┬─────┘     └──────────┘             │
│        ▼                                     │
│   ┌──────────┐                              │
│   │Observe   │ ← 观察执行结果                │
│   └────┬─────┘                              │
│        ▼                                     │
│   ┌──────────┐    完成?                      │
│   │  Done?   │────YES────→ 输出结果          │
│   └────┬─────┘                              │
│       NO│                                    │
│        └──────→ 回到 Think                  │
│                                              │
└──────────────────────────────────────────────┘
```

## 设计要点总结

| 模块 | 设计要点 | 关键挑战 |
|------|---------|---------|
| **LLM Core** | 选择合适模型(推理能力vs成本) | 延迟、成本、上下文长度 |
| **Planning** | 分解粒度适中，避免过深 | 任务复杂度爆炸 |
| **Memory** | 短期滑窗+长期向量+摘要压缩 | 上下文窗口溢出 |
| **Tool Use** | Schema校验+容错重试+超时控制 | 工具调用失败、格式错误 |
| **Action Loop** | 最大循环次数限制+异常处理 | 无限循环、错误传播 |

**面试加分点**：提到LangChain/LangGraph的Agent框架设计；提到AutoGPT/BabyAGI展示了Agent的自主任务分解能力；提到Agent评估框架如AgentBench、τ-bench；提到多Agent系统（如CrewAI、AutoGen）的协作模式——Router/Worker/Critic架构；提到MCP(Model Context Protocol)正在标准化Agent的工具接入层。
