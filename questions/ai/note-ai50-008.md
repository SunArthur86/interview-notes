---
id: note-ai50-008
difficulty: L3
category: ai
subcategory: Agent
tags:
- 某厂
- 面经
- Agent
- ReAct
- 推理
feynman:
  essence: ReAct让模型交替进行"思考推理"和"行动调用"，形成Thought-Action-Observation循环，而非一次性输出答案
  analogy: 就像做数学题——不是直接写答案(单轮问答)，而是先写"我需要先算X"(Thought)，然后实际去算(Action)，看到结果后(Observation)再推理下一步
  first_principle: 单轮问答只有一个Forward Pass，模型无法获取外部信息也无法自我纠错。ReAct引入了"环境交互循环"，让模型能调用工具获取真实数据并基于结果继续推理
  key_points:
  - ReAct = Reasoning + Acting 的交替循环
  - '核心循环: Thought → Action → Observation → Thought → ...'
  - '与单轮问答本质区别: 引入了外部信息获取和迭代推理'
  - ReAct是当前主流Agent框架(Frank, LangChain Agent)的基础范式
first_principle:
  essence: 复杂问题需要"推理-行动-观察"的迭代过程，而非单次推理
  derivation: 问题"2024年中国GDP增速是多少"需要搜索→获取数据→计算→回答。单轮问答只能凭记忆回答(可能过时)，ReAct通过工具调用获取实时数据后回答(准确)
  conclusion: ReAct通过引入Action-Observation循环，突破了单轮问答的信息和推理深度限制
follow_up:
- ReAct和Plan-and-Execute模式有什么区别？
- ReAct的Thought是否可以省略？(无推理直接行动)
- ReAct循环最多迭代几次？如何防止无限循环？
memory_points:
- 核心：Reason推理+Act行动交替循环，形成Thought-Action-Observation链路
- 对比：单轮仅靠内部知识，而ReAct能借助外部工具获取实时信息
- 对比：单轮出错无法挽回，而ReAct可基于Observation动态纠错与迭代
- 代价：因为需要多轮调用工具，所以ReAct延迟更高、成本更大
---

# ReAct的原理和与单轮问答的本质区别

## ReAct 核心循环

```
┌─────────────────────────────────────────────────┐
│              ReAct 循环                          │
│                                                  │
│  用户: "北京今天的气温比上海高多少度？"           │
│                                                  │
│  Thought 1: 我需要先查北京和上海的气温            │
│  Action 1: search_weather("北京")                │
│  Observation 1: 北京今天35°C                     │
│                                                  │
│  Thought 2: 北京35°C，现在查上海                  │
│  Action 2: search_weather("上海")                │
│  Observation 2: 上海今天30°C                     │
│                                                  │
│  Thought 3: 北京35°C - 上海30°C = 5°C            │
│  Action 3: finish("北京比上海高5°C")              │
│                                                  │
│  最终答案: 北京比上海高5°C                        │
└─────────────────────────────────────────────────┘
```

## 与单轮问答的本质区别

| 维度 | 单轮问答 | ReAct |
|------|---------|-------|
| 推理次数 | 1次 | 多次迭代 |
| 信息来源 | 仅模型内部知识 | 外部工具 + 模型知识 |
| 自我纠错 | 不可能 | 可以(基于Observation调整) |
| 可解释性 | 低(黑盒) | 高(Thought链可追踪) |
| 准确性 | 依赖训练数据时效 | 实时获取最新信息 |
| 延迟 | 低(1次调用) | 高(多轮调用) |
| 成本 | 低 | 高(多次API调用) |

```
单轮问答:
  Query ──→ LLM ──→ Answer
  (一次Forward Pass，无法获取外部信息)

ReAct:
  Query ──→ LLM ──→ Thought + Action
                    │              │
                    │    ┌─────────┘
                    │    ▼
                    │  Tool执行
                    │    │
                    │    ▼
                    └─ Observation ──→ LLM ──→ Thought + Action
                                                       │
                                                   (循环直到finish)
```

## ReAct Prompt 模板

```python
REACT_PROMPT = """尽可能回答以下问题。你可以使用以下工具:

{tools_description}

请严格按照以下格式输出:

Question: 输入的问题
Thought: 你应该怎么思考
Action: 要使用的工具名称
Action Input: 工具的输入参数
Observation: 工具返回的结果
... (Thought/Action/Action Input/Observation可以重复多次)
Thought: 我现在知道最终答案了
Final Answer: 对原始问题的最终回答

开始!

Question: {question}
Thought: {agent_scratchpad}
"""
```

## 代码实现

```python
from langchain.agents import create_react_agent, AgentExecutor
from langchain.tools import Tool

# 定义工具
tools = [
    Tool(name="Search", func=search_web, description="搜索互联网获取信息"),
    Tool(name="Calculator", func=calculate, description="数学计算"),
    Tool(name="Weather", func=get_weather, description="查询天气"),
]

# 创建ReAct Agent
agent = create_react_agent(
    llm=ChatOpenAI(model="gpt-4", temperature=0),
    tools=tools,
    prompt=REACT_PROMPT
)

executor = AgentExecutor(
    agent=agent,
    tools=tools,
    max_iterations=5,      # 防止无限循环
    verbose=True,          # 打印Thought链
    handle_parsing_errors=True  # 解析错误时重试
)

# 执行
result = executor.invoke({"input": "北京今天的气温比上海高多少度？"})
print(result['output'])
```

## 执行日志示例

```
> Entering new AgentExecutor chain...

Thought: 我需要先查询北京和上海的天气，然后计算差值
Action: Weather
Action Input: 北京
Observation: 北京今天35°C，晴

Thought: 北京35°C。现在查上海的天气
Action: Weather
Action Input: 上海
Observation: 上海今天30°C，多云

Thought: 北京35°C，上海30°C，差值5°C
Final Answer: 北京今天的气温比上海高5°C

> Finished chain.
```

## ReAct的变体与演进

| 模式 | 与ReAct的区别 | 适用场景 |
|------|-------------|---------|
| ReAct | 边想边做 | 通用场景 |
| Plan-and-Execute | 先完整规划再逐步执行 | 步骤间依赖强的任务 |
| Reflexion | 加自我反思和纠错 | 需要高准确率的场景 |
| LATS | 树搜索+多路径探索 | 最优解搜索 |

## 防止无限循环

```python
# 1. 限制最大迭代次数
executor = AgentExecutor(
    agent=agent,
    tools=tools,
    max_iterations=5,        # 最多5轮
    early_stopping_method="generate"  # 超限时让模型直接回答
)

# 2. 超时控制
import signal

def timeout_handler(signum, frame):
    raise TimeoutError("Agent执行超时")

signal.signal(signal.SIGALRM, timeout_handler)
signal.alarm(30)  # 30秒超时

try:
    result = executor.invoke({"input": query})
finally:
    signal.alarm(0)
```

## ReAct vs Function Calling

```python
# ReAct: 通过Prompt引导模型输出Thought/Action文本，需要解析
# Function Calling: 模型原生支持结构化函数调用，更可靠

# 现代实践: 用Function Calling替代ReAct的文本解析
response = client.chat.completions.create(
    model="gpt-4",
    messages=[{"role": "user", "content": query}],
    tools=[{
        "type": "function",
        "function": {
            "name": "get_weather",
            "description": "查询天气",
            "parameters": {"type": "object", "properties": {"city": {"type": "string"}}}
        }
    }],
    tool_choice="auto"
)
# 模型直接返回结构化的tool_calls，不需要文本解析
```

## 记忆要点

- 核心：Reason推理+Act行动交替循环，形成Thought-Action-Observation链路
- 对比：单轮仅靠内部知识，而ReAct能借助外部工具获取实时信息
- 对比：单轮出错无法挽回，而ReAct可基于Observation动态纠错与迭代
- 代价：因为需要多轮调用工具，所以ReAct延迟更高、成本更大

## 苏格拉底式面试追问

> 这组追问模拟面试官层层逼问，每一问先回答"为什么"，再回答"怎么做"，最后回答"如何证明"。

### 第一层：目标与动机

**Q：ReAct 相比单轮问答的本质优势是什么？为什么 Thought-Action-Observation 循环比一次性生成更可靠？**

本质优势是"环境交互"和"自我纠错"。单轮问答只有一个 forward pass，模型只能凭参数知识硬答，遇到实时信息（今天天气、最新订单）或需要多步推理（A 依赖 B 的结果）就歇菜。ReAct 的 Observation 把外部真实数据注入上下文，模型基于事实而非记忆推理；循环结构允许前一步报错后下一步纠偏，而非一条路走到黑。可靠性来自"每步都有 Observation 验证"，而不是一次性押宝。

### 第二层：证据与定位

**Q：你的 ReAct Agent 任务成功率只有 60%，你怎么定位是推理错了、工具调用错了、还是 Observation 解析错了？**

在 Trace 里分步看每个 Thought-Action-Observation 三元组。定位逻辑：如果 Thought 推理正确（目标步骤对）但 Action 工具选错或参数错，是工具调用层问题；如果 Action 对但 Observation 里没有模型需要的信息，是工具实现问题（返回字段不全）或工具选错了；如果 Observation 对但下一步 Thought 推理跑偏，是模型推理能力不足。每类失败的占比决定先优化哪层——通常工具调用格式错误（JSON 解析失败）占 30%+，是最高频问题。

### 第三层：根因深挖

**Q：ReAct 跑了 10 步还没收敛，token 上下文已经爆了。根因是什么？**

根因是 ReAct 的上下文是累积的——每步的 Thought+Action+Observation 都 append 到 prompt 里，10 步就是 10 个三元组，prompt 可能涨到 8k+ token。更糟的是 Observation 可能返回大段数据（如数据库查询返回 100 行），把上下文撑爆。治本有三招：一是 Observation 做摘要/截断（只保留关键字段）；二是用滑动窗口只保留最近 3-5 步；三是改用 Plan & Execute 范式，把全局规划和单步执行解耦，每步上下文独立。

**Q：那为什么不直接用 Plan & Execute（先规划后执行），上下文不会累积，省得 ReAct 上下文爆炸？**

因为 Plan & Execute 假设"任务可以预先规划"，对动态不确定的任务失效。比如查数据库分析数据，第二步的 SQL 取决于第一步的查询结果，无法预先规划。ReAct 的每步规划是基于上一步 Observation 的，天然适应动态环境。正确做法是混合：顶层用 Plan & Execute 做粗粒度规划（减少步数），每个 step 内部用 ReAct 做细粒度执行（适应动态）。Claude Code 就是这个模式——先 create todo list，每个 task 内部 ReAct。

### 第四层：方案权衡

**Q：ReAct 的 Observation 你是原样塞回 prompt 还是做处理？处理会不会丢信息？**

必须做处理，原样塞是大坑。数据库查询返回 100 行，原样塞进 prompt 既爆 token 又让模型抓不住重点。处理策略：一是字段裁剪（只保留模型需要的字段，去掉无关列）；二是行数限制（top-10 + "共 100 行"的摘要）；三是结果摘要（让小模型先把 100 行总结成 3 句话再塞给主模型）。会丢信息的风险用"保留原始结果 id 供后续精确查询"来缓解——模型看到摘要后决定要哪几行，再精确查。

**Q：为什么不直接让 ReAct 调用更强的模型（如 GPT-4）做每步推理，减少步数和错误率？**

成本和延迟。GPT-4 每步推理 2-5 秒 + $0.01-0.03，10 步任务就是 20-50 秒 + $0.1-0.3，对高频任务不可接受。工程上用分级模型：简单步骤（如格式化输出、字段提取）用 GPT-3.5（快且便宜），复杂推理步骤（如多跳分析）用 GPT-4。ReAct 框架本身支持每步指定不同模型。更激进的是训练一个小模型专门做工具调用（如 ToolLLaMA），把通用推理留给大模型，分工优化成本。

### 第五层：验证与沉淀

**Q：你怎么衡量 ReAct Agent 比"单轮 RAG"或"Plan & Execute"更适合你的场景？**

定义任务成功率和成本两个核心指标。成功率 = 正确完成的任务数/总任务数（人工标注 ground truth）；成本 = 平均 token 数 × 单价 + 平均步数 × 单步延迟。对比三组：单轮 RAG、ReAct、Plan & Execute，在同样的 100 个测试任务上跑。如果 ReAct 成功率 75% 显著高于单轮 RAG 的 50%，且成本可控（每任务 < $0.2），证明 ReAct 适合。同时看失败 case 分布——如果 ReAct 失败集中在"需要全局规划"的任务，说明该类任务要切到 Plan & Execute。

**Q：ReAct 的工程经验怎么沉淀成可复用框架？**

封装统一的 ReAct runner：支持工具注册（带 JSON schema 描述）、步数上限、token 预算、错误重试、Observation 处理器（裁剪/摘要）可插拔。配套 Trace 看板，可视化每步的 Thought-Action-Observation，支持失败 case 回放调试。把"工具 schema 编写规范""Observation 处理策略库""步数和 token 预算经验值"沉淀成团队文档。新 Agent 开发时基于框架，不从头造轮子。

## 结构化回答

**30 秒电梯演讲：** ReAct让模型交替进行"思考推理"和"行动调用"，形成Thought-Action-Observation循环，而非一次性输出答案。

**展开框架：**
1. **ReAct** — ReAct = Reasoning + Acting 的交替循环
2. **核心循环** — Thought → Action → Observation → Thought → ...
3. **与单轮问答本质区别** — 引入了外部信息获取和迭代推理

**收尾：** 您想深入聊：ReAct和Plan-and-Execute模式有什么区别？


## 视频脚本

> 预计时长：4 分钟 | 由浅入深


| 时间 | 画面/字幕 | 口播台词 | 讲解要点 |
|------|----------|----------|----------|
| 0:00 | 标题卡：ReAct的原理和与单轮问答的本质区别 | "就像做数学题——不是直接写答案(单轮问答)，而是先写"我需要先算X"(Thought)，然…" | 开场钩子 |
| 0:20 | 核心概念图 | "ReAct让模型交替进行"思考推理"和"行动调用"，形成Thought-Action-Observation循环，而非一…" | 核心定义 |
| 0:50 | ReAct示意图 | "ReAct——ReAct = Reasoning + Acting 的交替循环" | 要点拆解1 |
| 1:30 | 对比/实战案例图 | "对比一下常见误区和工程实践，看真实场景里怎么取舍。" | 实战与对比 |
| 2:20 | 总结卡 | "记住核心要点。下期我们追问：ReAct和Plan-and-Execute模式有什么区别？" | 收尾与钩子 |
