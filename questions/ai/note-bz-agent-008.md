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


## 苏格拉底式面试追问

> 这组追问模拟面试官层层逼问，每一问先回答"为什么"，再回答"怎么做"，最后回答"如何证明"。

### 第一层：目标与动机

**Q：ReAct 把 Thought 和 Action 交织，为什么不直接让 LLM 输出 Action（调工具）就行，非要让它先"想一想"（Thought）？**

Thought 的作用是"显式推理引导正确行动"。直接输出 Action 时，LLM 是"直觉式"决策（next-token 概率最高的工具调用），容易选错——尤其在工具多、意图模糊时。Thought 强制 LLM 先把"为什么要调这个工具、期望得到什么"说出来，这个推理过程激活了 LLM 的 CoT 能力，让 Action 的选择基于"显式推理"而非"直觉"。实测：带 Thought 的 tool_call_success_rate 比直接 Action 高 15-25%，因为 Thought 帮 LLM 澄清意图、对比工具、构造正确参数。类比人类：直接动手（Action）容易出错，先想清楚（Thought）再做更靠谱。ReAct 的核心贡献就是"把推理引入行动决策"。

### 第二层：证据与定位

**Q：怎么从 trace 日志判断 ReAct 的 Thought 环节是否真的在发挥作用，而不是"走了形式"（写了 Thought 但决策还是错的）？**

看 Thought 和 Action 的一致性 + Thought 的信息量。1）一致性——Thought 说"我需要查天气"，Action 是否调了天气工具？如果 Thought 说查天气但 Action 调了计算器，说明 Thought 是"走过场"（LLM 没真正基于 Thought 决策），这是 prompt 设计问题（Thought 和 Action 没有逻辑绑定）；2）信息量——Thought 是有意义的推理（"用户问北京天气，我需要调 weather_api，参数 city=北京"）还是空洞模板（"让我想想...我决定调用一个工具"）？空洞 Thought 说明 prompt 没引导好。统计"Thought-Action 一致率"（一致/总数），健康值应 >90%，低于 80% 说明 Thought 没发挥作用，要优化 prompt（如加 few-shot 示例教 LLM 怎么写有意义的 Thought）。

### 第三层：根因深挖

**Q：ReAct 实际运行时，最常见的失败模式是"循环调用同一工具得不到答案"，根因是什么？**

根因是 LLM 没有从 Observation 中"学到"该换策略。具体：LLM 调 Search["iPhone 价格"]，Observation 返回不相关结果（如只搜到新闻没价格），LLM 下一步 Thought 如果还是"我需要搜价格"，Action 再调 Search["iPhone 价格"]——重复。这是因为 LLM 的 prompt 没教"Observation 不满意时换策略"（如改 query、换工具、放宽条件）。治本：1）prompt 里加 few-shot 示例——演示"搜索结果不理想→换关键词/换工具"的推理；2）Agentic RL 训练——给"基于 Observation 调整策略"的轨迹高 reward，让模型内化；3）工程兜底——死循环检测（连续 N 次相同 Action 触发干预，如强制换工具或转人工）。三者结合，循环调用从常见失败降为偶发。

**Q：既然循环调用是 ReAct 的痛点，为什么不限制每个工具最多调用一次，从源头杜绝循环？**

因为有些任务确实需要多次调用同一工具（如分页查询、多步骤搜索）。限制"每工具一次"会让这些合法任务失败。正确做法不是"限制次数"而是"检测无进展循环"——判断标准是 Observation 是否带来新信息（信息增益）。如果连续 3 次调同一工具、参数相似、Observation 内容高度重复（embedding 相似度>0.95），判定为无进展循环，触发干预（强制换策略/终止/转人工）。这样既允许合法的多次调用（每次 Observation 不同），又阻止无意义的死循环。比"硬限制次数"更智能。

### 第四层：方案权衡

**Q：ReAct 和 Plan-and-Execute（先全局规划再执行）相比，各有什么优劣？什么场景选哪个？**

ReAct 是"边想边做"——每步基于上一步 Observation 决定下一步，灵活但缺乏全局视野，容易在复杂任务里"只见树木不见森林"（走了弯路才发现方向错）。Plan-and-Execute 是"先想清楚再做"——先一次性生成完整计划，再逐步执行，全局视野好但僵化（执行中发现计划错了要回溯重规划）。选型：1）信息充分、步骤确定的任务（如"按已知流程处理工单"）选 Plan-Execute（计划准、执行快）；2）信息动态、需要边查边决策的任务（如"调研一个开放问题"）选 ReAct（灵活适应）；3）超复杂任务用混合——先 Plan 生成大纲，再 Execute 时用 ReAct 模式处理每步的动态性。实务 80% 用 ReAct（通用性强），流程化任务用 Plan-Execute。

**Q：既然 ReAct 这么通用，为什么还要搞 Reflexion（ReAct+反思）？ReAct 自己不能从错误中学习吗？**

ReAct 是"单次任务内"的推理-行动循环，任务结束后不保留经验——下次遇到类似问题还是从零开始试错。Reflexion 加了"跨任务学习"——任务失败后，让 LLM 反思"为什么失败"（如"工具选错了/参数错了/方向错了"），把反思总结存进记忆，下次类似任务开始时检索出来作为提示（"上次这类问题我犯了 X 错，这次要避免"）。这是 ReAct 缺失的"经验积累"能力。实测：加了 Reflexion 的 Agent 在重复类任务上，第二次完成率比第一次高 20-30%（用上了上次反思），而纯 ReAct 两次完成率持平（没积累）。所以 Reflexion 是 ReAct 的"经验层增强"，不是替代。

### 第五层：验证与沉淀

**Q：你怎么证明 ReAct 比纯 CoT（不调工具，纯推理）在你的业务任务上确实更好？**

AB 测试。固定业务任务集（分"需要外部信息"和"纯推理"两类），对比 CoT（纯推理无工具）和 ReAct（推理+工具）。指标：1）准确率——在"需要外部信息"类（如实时数据、私有数据），ReAct 应显著高于 CoT（CoT 会幻觉）；在"纯推理"类（如数学题），两者应持平（ReAct 的工具调用反而是开销）；2）幻觉率——ReAct 在事实类问题上应远低于 CoT；3）延迟和成本——ReAct 更高（工具调用），要算 ROI。如果 ReAct 在"需要外部信息"类准确率 +20%、幻觉率 -30%，且业务价值覆盖成本，证明 ReAct 优于 CoT。结论通常是"分场景路由"：需要工具的用 ReAct，纯推理的用 CoT。

**Q：ReAct 的 prompt 模板和 Thought 引导经验怎么沉淀成团队 Agent 框架的默认能力？**

封装成 ReActExecutor 组件：1）prompt 模板——内置标准的 Thought/Action/Observation 三段式模板 + few-shot 示例库（按任务类型：搜索类/计算类/查询类各一套），开发者选任务类型自动套模板；2）Thought 质量检测——自动分析 Thought-Action 一致率、Thought 信息量，低于阈值提示优化 prompt；3）死循环检测——内置 Observation 信息增益检测，自动干预无进展循环；4）现代实现——默认用 Function Call 原生 API（而非文本格式），保证解析 100% 正确。这套写入团队 Agent 框架 SOP，新 Agent 调用 ReActExecutor 配上工具列表即可，不用每次重写 Thought 引导逻辑和循环控制。

## 结构化回答

**30 秒电梯演讲：** ReAct=Reasoning(推理)+Acting(行动)交替进行。先思考(Thought)再行动(Action)再观察(Observation)，把"想"和"做"交织，比纯思考更接地气，比纯行动更有章法。

**展开框架：**
1. **三元组循环** — Thought→Action→Observation
2. **解决** — 解决CoT的幻觉问题（用工具获取真实信息）
3. **是现代** — 是现代Agent最基础的认知范式

**收尾：** 您想深入聊：ReAct和CoT能结合吗？——可以，ReAct的Thought本质就是CoT？


## 视频脚本

> 预计时长：4 分钟 | 由浅入深


| 时间 | 画面/字幕 | 口播台词 | 讲解要点 |
|------|----------|----------|----------|
| 0:00 | 标题卡：什么是 ReAct 框架？它的原理是什么？ | "像做实验的科学家——先假设(Thought)→做实验(Action)→看结果(…" | 开场钩子 |
| 0:20 | 核心概念图 | "ReAct=Reasoning(推理)+Acting(行动)交替进行。先思考(Thought)再行动(Action)再观…" | 核心定义 |
| 0:50 | 三元组循环示意图 | "三元组循环——Thought→Action→Observation" | 要点拆解1 |
| 1:30 | 对比/实战案例图 | "对比一下常见误区和工程实践，看真实场景里怎么取舍。" | 实战与对比 |
| 2:20 | 总结卡 | "记住核心要点。下期我们追问：ReAct和CoT能结合吗？——可以，ReAct的Thoug？" | 收尾与钩子 |
