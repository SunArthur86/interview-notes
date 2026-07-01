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

