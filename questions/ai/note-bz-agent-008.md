---
id: note-bz-agent-008
difficulty: L3
category: ai
subcategory: Agent
tags:
- B站面经
- ReAct
- 认知框架
- Agent
feynman:
  essence: ReAct=Reasoning(推理)+Acting(行动)交替进行。先思考(Thought)再行动(Action)再观察(Observation)，把"想"和"做"交织，比纯思考更接地气，比纯行动更有章法。
  analogy: 像做实验的科学家——先假设(Thought)→做实验(Action)→看结果(Observation)→再假设，循环逼近真相。而不是闭门造车空想，或盲目乱试。
  first_principle: 纯推理(CoT)会幻觉（脱离事实），纯行动(Act-only)会盲目（没有规划）。ReAct把两者交织，推理指导行动，行动反馈修正推理。
  key_points:
  - 三元组循环：Thought→Action→Observation
  - 解决CoT的幻觉问题（用工具获取真实信息）
  - 解决Act-only的盲目问题（推理指导行动）
  - 是现代Agent最基础的认知范式
first_principle:
  essence: ReAct解决了"思考"与"行动"的割裂——人类解决问题时两者本就是交织的。
  derivation: 纯CoT：只在脑中推理，无法验证，易幻觉。纯Act：无脑调用工具，无规划，低效。ReAct：每次行动前先思考为什么，行动后观察结果修正思考，形成感知-决策闭环。
  conclusion: ReAct = 交替的推理与行动，让Agent既有脑（推理）又有手（工具）
follow_up:
- ReAct和CoT能结合吗？——可以，ReAct的Thought本质就是CoT
- ReAct的Token消耗大吗？——大，因为要显式输出Thought，可用内部推理优化
- ReAct什么时候失效？——任务过于复杂（需全局规划）或过于简单（无需推理）
memory_points:
- 核心定义：ReAct = Reasoning + Acting，让大模型交替进行推理和行动
- 循环机制：Thought(思考) -> Action(行动) -> Observation(观察)循环执行
- 解决痛点：纯CoT易产生幻觉，纯Act缺乏全局规划，ReAct结合两者优势
- 终止条件：Action输出为Finish时，代表获得最终答案，结束循环
---

# 什么是 ReAct 框架？它的原理是什么？

## 一、ReAct 核心定义

**ReAct** = **Re**asoning + **Ac**ting（推理 + 行动）

让 LLM 在解决任务时，**交替进行推理（Thought）和行动（Action）**，并把行动结果（Observation）作为下一步推理的输入。

```
经典ReAct循环：

Thought 1: 我需要先查天气信息
Action 1:  Search("北京明天天气")
Observation 1: 明天北京中雨，18-22度

Thought 2: 下雨不适合户外，我应该推荐室内活动
Action 2:  Search("北京室内活动推荐")
Observation 2: 博物馆、购物中心、室内运动...

Thought 3: 信息足够，可以回答了
Action 3:  Finish("明天有雨，建议室内活动如...")
```

## 二、为什么需要 ReAct（动机）

### 纯 CoT 的问题：幻觉

```
纯CoT（只推理不行动）：
用户: "2026年最新的Agent框架有哪些？"
LLM: "据我所知，有LangChain、AutoGPT..." 
      ↑ 这些可能是过时的/编造的（幻觉）
      因为模型无法获取实时信息

ReAct：
Thought: 这个问题需要最新信息，我应该搜索
Action: Search("2026 Agent框架 最新")
Observation: [真实搜索结果]
Thought: 基于搜索结果，最新框架是X、Y、Z
Action: Finish(基于事实的回答)
```

### 纯 Act 的问题：盲目

```
纯Act（只行动不推理）：
用户: "帮我订去北京的机票"
Action: book_ticket("北京")  ← 没确认日期/航班/价格
↑ 盲目执行，缺少规划

ReAct：
Thought: 订机票需要先确认日期和偏好，再比价
Action: ask_user("您想哪天出发？")
Observation: "后天"
Thought: 后天是6月28日，先搜索航班
Action: search_flight(date="2026-06-28", dest="北京")
```

## 三、ReAct 的 Prompt 模板

```python
REACT_PROMPT = """
你是一个能使用工具解决问题的助手。请严格按以下格式：

Question: {用户问题}

Thought: {你的推理，思考下一步该做什么}
Action: {工具名称}[{参数}]   # 或 Finish[最终答案]
Observation: {工具返回结果}

Thought: {基于观察继续推理}
Action: ...
Observation: ...

...(重复直到能回答)

Thought: 我现在知道答案了
Action: Finish[{最终回答}]

可用工具：
- Search[q]: 搜索互联网
- Calculator[expr]: 数学计算
- Lookup[keyword]: 在文档中查找
"""
```

## 四、ReAct 的执行引擎

```python
import re

class ReActAgent:
    def __init__(self, llm, tools):
        self.llm = llm
        self.tools = tools  # {"Search": search_fn, "Calculator": calc_fn}
    
    def run(self, question, max_steps=8):
        scratchpad = f"Question: {question}\n"
        
        for step in range(max_steps):
            # 1. LLM生成Thought + Action
            output = self.llm(REACT_PROMPT + scratchpad + "\nThought:")
            
            # 2. 解析Action
            action_match = re.search(r'Action:\s*(\w+)\[(.*?)\]', output)
            if not action_match:
                continue
            
            tool_name = action_match.group(1)
            tool_args = action_match.group(2)
            
            # 3. 终止判断
            if tool_name == "Finish":
                return tool_args  # 返回最终答案
            
            # 4. 执行工具
            thought = output.split("Action:")[0]
            observation = self.tools[tool_name](tool_args)
            
            # 5. 追加到scratchpad
            scratchpad += f"{thought}Action: {tool_name}[{tool_args}]\n"
            scratchpad += f"Observation: {observation}\n"
        
        return "达到最大步数，未能完成"
```

## 五、ReAct vs 其他范式对比

| 范式 | 核心 | 优势 | 劣势 | 适用场景 |
|------|------|------|------|---------|
| **CoT** | 纯推理链 | 简单、快 | 易幻觉、无外部信息 | 数学/逻辑题 |
| **Act-only** | 纯行动 | 能获取真实信息 | 无规划、盲目 | 简单查询 |
| **ReAct** | 推理+行动交替 | 兼顾规划和事实 | Token消耗大 | 复杂任务（需工具） |
| **Plan-Execute** | 先全局规划再执行 | 步骤清晰 | 规划僵化、不易调整 | 流程明确任务 |
| **Reflexion** | ReAct+自我反思 | 能从错误学习 | 迭代成本高 | 难题/需调试任务 |

## 六、ReAct 的演进与局限

### ReAct 的局限

```
1. 局部视角：每步只看当前，缺乏全局规划
   → 衍生Plan-and-Execute（先全局规划）

2. 无反思：失败后不会总结经验
   → 衍生Reflexion（加自我反思）

3. Token浪费：显式输出Thought消耗大
   → 现代用function calling内置推理

4. 串行低效：步骤必须依次执行
   → 衍生并行ReAct（独立步骤并发）
```

### 现代 ReAct（基于 Function Calling）

```python
# 现代模型原生支持，无需Prompt工程
response = client.chat.completions.create(
    model="gpt-4",
    messages=[{"role": "user", "content": question}],
    tools=[{"type": "function", "function": tool_def}],
    # 模型内部完成"Thought"，只输出Action（tool_call）
)
# 本质仍是ReAct，只是Thought内化了
```

## 七、面试加分点

1. **讲清动机**：ReAct 是为了同时解决 CoT 的幻觉和 Act-only 的盲目，是两者的融合
2. **强调"交织"**：核心是推理与行动**交替**，而非串接——每步行动都基于上一步的观察
3. **提"现代内化"**：现代 Agent 框架的 ReAct 已内化到 function calling，无需手写 Thought 解析

## 记忆要点

- 核心定义：ReAct = Reasoning + Acting，让大模型交替进行推理和行动
- 循环机制：Thought(思考) -> Action(行动) -> Observation(观察)循环执行
- 解决痛点：纯CoT易产生幻觉，纯Act缺乏全局规划，ReAct结合两者优势
- 终止条件：Action输出为Finish时，代表获得最终答案，结束循环

