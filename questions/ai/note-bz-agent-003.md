---
id: note-bz-agent-003
difficulty: L3
category: ai
subcategory: Agent
tags:
  - B站面经
  - Agent
  - 工作原理
  - OODA循环
feynman:
  essence: Agent工作原理就是OODA闭环——观察（Observe环境）→定向（Orient理解）→决策（Decide计划）→行动（Act执行）→观察结果，循环往复直到完成目标。
  analogy: 像开车去陌生地方——看路牌（观察）→判断在哪（定向）→决定转弯（决策）→打方向盘（行动）→再看新路况，循环直到到达。
  first_principle: Agent是个反馈控制系统，LLM是控制器，工具是执行器，记忆是状态存储，目标是参考输入，误差驱动循环。
  key_points:
    - 工作流程：感知→理解→规划→执行→观察，循环
    - 每次循环LLM做两件事：推理（Thought）+行动（Action）
    - 终止条件：目标达成/达到步数上限/无法继续
    - 三大能力在每个循环中各司其职
first_principle:
  essence: Agent本质是基于反馈的控制论系统。
  derivation: '控制论核心：测量输出→对比目标→计算误差→调整输入。Agent版：执行动作→观察结果→对比目标→调整下一步。LLM承担"控制器"角色，把自然语言目标转化为工具调用序列。'
  conclusion: Agent = 目标驱动的OODA反馈控制循环，LLM为控制器
follow_up:
  - Agent怎么知道任务完成了？——LLM自判断 + 显式完成信号 + 步数兜底
  - 循环卡死怎么办？——步数上限+超时+重复检测+人工介入
  - 和传统状态机有什么区别？——状态机路径固定，Agent路径由LLM动态决定
---

# AI Agent 的工作原理是什么？三大核心能力分别指什么？

## 一、Agent 工作原理：OODA 闭环

**OODA** = Observe（观察）→ Orient（定向）→ Decide（决策）→ Act（行动）

```
        目标输入
            │
            ▼
   ┌─────────────────┐
   │  Observe 观察     │ ← 读取记忆/工具返回/环境状态
   └────────┬────────┘
            ▼
   ┌─────────────────┐
   │  Orient 理解定向  │ ← LLM理解当前状态，对比目标
   └────────┬────────┘
            ▼
   ┌─────────────────┐
   │  Decide 决策规划  │ ← LLM决定下一步做什么（Thought）
   └────────┬────────┘
            ▼
   ┌─────────────────┐
   │  Act 行动执行     │ ← 调用工具，产生真实效果（Action）
   └────────┬────────┘
            │
            └──── 循环回到 Observe（观察执行结果）
                  直到 Goal 达成
```

## 二、ReAct 范式：Thought-Action-Observation

Agent 最经典的工作模式是 **ReAct**（Reasoning + Acting）：

```python
def react_loop(goal, tools, memory):
    scratchpad = []  # 工作记忆（记录轨迹）
    for step in range(MAX_STEPS):
        # === Observe + Orient ===
        context = memory.recall(goal) + scratchpad
        
        # === Decide: Thought（推理） ===
        thought = llm.reason(
            f"目标:{goal}\n已做:{scratchpad}\n可用工具:{tools}",
            instruction="思考下一步该做什么"
        )
        # 例: Thought: 用户要查天气，我需要先确定城市
        
        # === Act: Action（行动） ===
        action = llm.decide_action(thought, tools)
        # 例: Action: ask_user("你在哪个城市？")
        #  或: Action: search_weather(city="北京")
        
        # === Observe: 执行结果 ===
        observation = execute(action)
        # 例: Observation: 北京今天晴，25度
        
        scratchpad.append(f"Thought:{thought}\nAction:{action}\nObs:{observation}")
        
        # === 判断完成 ===
        if llm.is_goal_met(goal, scratchpad):
            return llm.summarize(scratchpad)
    return "达到最大步数，未能完成"
```

## 三、一个完整执行示例

**任务：用户问"明天北京适合户外运动吗？"**

```
Step 1:
  Thought: 需要先查明天北京的天气，判断是否适合户外
  Action: weather_api(city="北京", date="tomorrow")
  Observation: 明天北京中雨，气温18-22℃，风力4级

Step 2:
  Thought: 中雨+大风不适合户外运动，可以推荐室内替代方案
  Action: search("北京 室内运动场馆")
  Observation: 找到羽毛球馆、攀岩馆、游泳馆等选项

Step 3:
  Thought: 信息已足够，可以给用户完整建议了
  Action: respond("明天有中雨不适合户外，推荐室内羽毛球/攀岩...")
  [目标达成，结束循环]
```

## 四、三大核心能力在循环中的分工

| 循环环节 | 规划 Planning | 记忆 Memory | 工具 Tool Use |
|---------|--------------|-------------|--------------|
| Observe | - | 读上下文/历史 | 工具返回结果作为观察 |
| Orient | 理解当前进度 | 检索相关记忆 | - |
| Decide | 分解/调整计划 | - | 选择用哪个工具 |
| Act | 执行计划步骤 | 写入执行轨迹 | 调用工具产生效果 |

## 五、关键控制机制

### 1. 终止条件

```python
def should_stop(goal, trajectory, step):
    if llm.is_complete(goal, trajectory):  # LLM自判断完成
        return True
    if step >= MAX_STEPS:  # 步数兜底
        return True
    if detect_loop(trajectory):  # 检测到重复循环
        return True
    if timeout():  # 超时
        return True
    return False
```

### 2. 防死循环

```python
# 检测Agent是否陷入重复
def detect_loop(trajectory, window=3):
    recent = trajectory[-window:]
    # 如果最近几步的Action完全一样，说明卡住了
    actions = [t.action for t in recent]
    return len(set(actions)) == 1
```

### 3. 错误恢复

```python
def execute_with_recovery(action):
    try:
        return tool_call(action)
    except ToolError as e:
        # 让LLM看到错误，重新规划
        return {"error": str(e), "hint": "工具调用失败，请换方案"}
```

## 六、面试加分点

1. **用 OODA 框架讲**：比单纯讲 ReAct 更有体系感，体现对控制论的理解
2. **强调"循环"是本质**：单次 LLM 调用不是 Agent，必须有反馈循环
3. **提"目标驱动"**：Agent 与聊天机器人的根本区别是目标导向（goal-directed），而非话轮导向
