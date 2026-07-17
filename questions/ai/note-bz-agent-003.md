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
  derivation: 控制论核心：测量输出→对比目标→计算误差→调整输入。Agent版：执行动作→观察结果→对比目标→调整下一步。LLM承担"控制器"角色，把自然语言目标转化为工具调用序列。
  conclusion: Agent = 目标驱动的OODA反馈控制循环，LLM为控制器
follow_up:
- Agent怎么知道任务完成了？——LLM自判断 + 显式完成信号 + 步数兜底
- 循环卡死怎么办？——步数上限+超时+重复检测+人工介入
- 和传统状态机有什么区别？——状态机路径固定，Agent路径由LLM动态决定
memory_points:
- 底层逻辑：Agent本质上是一个OODA（观察-定向-决策-行动）闭环系统
- 核心范式：ReAct循环，即Thought（推理）→Action（行动）→Observation（观察）的交替
- 闭环控制：每次行动后的Observation会作为新的观察输入，直到达成目标或触发步数兜底
- 能力分工：决策环节靠规划，观察环节靠记忆读写，行动环节靠工具调用
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

## 记忆要点

- 底层逻辑：Agent本质上是一个OODA（观察-定向-决策-行动）闭环系统
- 核心范式：ReAct循环，即Thought（推理）→Action（行动）→Observation（观察）的交替
- 闭环控制：每次行动后的Observation会作为新的观察输入，直到达成目标或触发步数兜底
- 能力分工：决策环节靠规划，观察环节靠记忆读写，行动环节靠工具调用


## 苏格拉底式面试追问

> 这组追问模拟面试官层层逼问，每一问先回答"为什么"，再回答"怎么做"，最后回答"如何证明"。

### 第一层：目标与动机

**Q：你用 OODA 闭环（观察-定向-决策-行动）描述 Agent 工作原理，这和 ReAct 的 Thought-Action-Observation 有什么本质区别？是不是换了个名字？**

不完全是换名字。OODA 是更上位的"认知论"框架（源自军事决策），ReAct 是 OODA 在 LLM Agent 的"工程实现"。对应关系：Observe≈接收 Observation、Orient≈Thought（理解+推理）、Decide≈决定 Action（调什么工具）、Act≈执行工具。区别在于 OODA 强调"Orient"（定向/态势理解）是核心——在决策前要先理解当前状态和信息，这对应 Agent 的"上下文理解和意图识别"环节，ReAct 把它简化进了 Thought。实务中 OODA 更适合设计 Agent 的状态机（每个状态对应一个 OODA 阶段），ReAct 更适合写 prompt（Thought-Action-Observation 三段式）。两者互补，不冲突。

### 第二层：证据与定位

**Q：OODA 闭环里"行动后的观察结果"如何反馈到下一轮决策？这个反馈机制具体怎么实现？**

靠 context 拼接。每轮 Action 的执行结果（Observation）被格式化为文本，拼接到 Agent 的 context 窗口里，下一轮 LLM forward 时 attention 到这些 Observation，作为决策依据。实现上是：`context = system_prompt + history (Thought_1, Action_1, Observation_1, ..., Thought_n, Action_n, Observation_n) + current_input`，每轮把新的 Thought/Action/Observation append 进去。LLM 在生成下一轮 Thought 时，通过 attention 机制"看到"之前的 Observation。如果 Observation 很长（如搜索结果几千 token），要做摘要或截断，否则 context 会爆炸。这个"行动→观察→context→决策"的反馈环就是 OODA 闭环的工程实现。

### 第三层：根因深挖

**Q：OODA 闭环听起来很顺，但 Agent 经常在"Orient"（理解态势）这步出错——误解用户意图或误读工具结果。根因是什么？**

两个根因。1）LLM 的理解能力局限——复杂意图（如隐含约束、多目标）LLM 推理不准，表现是"理解偏了"；2）context 信号被稀释——长 context 里关键信息（用户意图、工具结果）的 attention 权重被大量噪声稀释（lost in the middle），LLM 没"看到"关键信息，表现是"信息在那但没用到"。区分方法：把 context 里的关键信息（如用户明确要求）标红或加 marker，看 LLM 是否引用；如果加了 marker 后理解正确了，是 attention 稀释问题（要精简 context 或移到末尾）；如果加了 marker 还是理解错，是 LLM 推理能力问题（要换更强模型或 SFT 提升理解）。

**Q：既然 Orient（理解）是出错重灾区，为什么不专门训练一个"意图理解模型"做这步，而不是让通用 LLM 兼任？**

专模型做意图理解确实更准（在特定领域 fine-tune 后准确率能到 95%+），但牺牲了灵活性。Agent 的核心价值是"通用性"——一个 Agent 能处理多种任务，靠 LLM 的零样本理解能力。如果每个任务都训专模型，就退化成了传统 pipeline（每个环节一个专模型），失去 Agent 的泛化优势。实务折中：1）通用意图理解用 LLM（覆盖长尾任务）；2）高频核心意图用专模型/规则做预识别（如"这是查订单还是退货"用分类器先判，再路由到对应 Agent）；3）LLM 兜底处理专模型没覆盖的。这样核心意图准、长尾任务灵活，兼顾准确性和泛化。

### 第四层：方案权衡

**Q：OODA 闭环是单 Agent 的模型，多 Agent 协作时这个闭环还成立吗？怎么扩展？**

成立但要做分布式扩展。单 Agent 的 OODA 是一个闭环；多 Agent 时，每个 Agent 内部仍是 OODA 闭环，Agent 之间的通信构成更高层的闭环。具体：1）Agent A 的 Act（输出结果）→ 通过消息传递 → 成为 Agent B 的 Observe 输入；2）需要协调时，引入"Supervisor Agent"做全局 OODA——Observe 所有子 Agent 的状态、Orient 整体进度、Decide 任务分配、Act 下发指令。所以多 Agent 是"OODA 闭环的嵌套"——子 Agent 各自 OODA，Supervisor 做元 OODA。LangGraph 的图结构天然支持这种嵌套（每个子图是一个 Agent 的 OODA，主图编排多个子图）。

**Q：为什么不把 OODA 的四个阶段做成四个独立微服务（Observe 服务/Orient 服务/...），微服务化不是更解耦吗？**

OODA 的四阶段在单 Agent 内是紧密耦合的——Orient 的推理结果直接决定 Decided 的 Action，中间要共享 context 和中间状态。拆成微服务会引入：1）序列化开销——每阶段间要传 context（可能几万 token），网络传输成本高；2）延迟累积——四阶段四次网络往返，单轮延迟从 500ms 涨到 2s+；3）状态一致性——四阶段共享的 context 要跨服务同步，复杂。所以单 Agent 内的 OODA 应该在一个进程内（函数调用共享内存），不做微服务化。微服务化适合多 Agent 层面（每个 Agent 是独立服务，通过消息总线通信），不是单 Agent 内的 OODA 阶段拆分。

### 第五层：验证与沉淀

**Q：你怎么证明你的 Agent 确实实现了"OODA 闭环"，而不是"看似循环实则线性执行"？**

看是否有"基于反馈的状态调整"。线性执行是：步骤 1→2→3 不管结果都往下走。OODA 闭环是：Act 后的 Observation 影响下一轮 Decide——如果 Observation 显示"工具调用失败"，Agent 应该换方案（而非继续原计划）；如果 Observation 显示"信息不够"，Agent 应该追加检索。验证方法：构造需要"基于中间结果调整策略"的任务（如"查 A，如果 A>100 则查 B，否则查 C"），看 Agent 是否真的根据 A 的结果分支。如果 Agent 不管 A 的结果都执行固定流程，就是"伪闭环"。再查 trace 日志，确认每轮的 Thought 引用了上一轮的 Observation（而非无视 Observation 自顾自推理）。

**Q：OODA 闭环的工作原理怎么沉淀成 Agent 框架的默认执行引擎，而不是每个 Agent 重写循环？**

封装成 ExecutionEngine 组件：1）状态机——定义 OODA 四状态（OBSERVING/ORIENTING/DECIDING/ACTING），引擎驱动状态流转；2）循环控制——内置终止条件（final_answer/max_turns/死循环检测），开发者不用手写 while；3）context 管理——自动拼接每轮的 Thought/Action/Observation，配 token 上限和压缩策略；4）trace 日志——自动记录每轮 OODA 四阶段的内容，输出到 LangSmith/dashboard 供调试。开发者只需定义"每个状态下 LLM 的 prompt 模板 + 工具列表"，引擎自动跑闭环。这套写入团队 Agent 框架 SOP，新 Agent 继承 ExecutionEngine，专注于业务逻辑（prompt+工具），不重写循环控制。

## 结构化回答

**30 秒电梯演讲：** Agent工作原理就是OODA闭环——观察（Observe环境）→定向（Orient理解）→决策（Decide计划）→行动（Act执行）→观察结果，循环往复直到完成目标。

**展开框架：**
1. **工作流程** — 感知→理解→规划→执行→观察，循环
2. **每次循环LLM做两件事** — 推理（Thought）+行动（Action）
3. **终止条件** — 目标达成/达到步数上限/无法继续

**收尾：** 您想深入聊：Agent怎么知道任务完成了？——LLM自判断 + 显式完成信号 + 步数兜底？


## 视频脚本

> 预计时长：4 分钟 | 由浅入深


| 时间 | 画面/字幕 | 口播台词 | 讲解要点 |
|------|----------|----------|----------|
| 0:00 | 标题卡：AI Agent 的工作原理是什么？三大核心能力… | "像开车去陌生地方——看路牌（观察）→判断在哪（定向）→决定转弯（决策）→打方向盘（行动）→…" | 开场钩子 |
| 0:20 | 核心概念图 | "Agent工作原理就是OODA闭环——观察（Observe环境）→定向（Orient理解）→决策（Decide计划）→行…" | 核心定义 |
| 0:50 | 工作流程示意图 | "工作流程——感知→理解→规划→执行→观察，循环" | 要点拆解1 |
| 1:30 | 对比/实战案例图 | "对比一下常见误区和工程实践，看真实场景里怎么取舍。" | 实战与对比 |
| 2:20 | 总结卡 | "记住核心要点。下期我们追问：Agent怎么知道任务完成了？——LLM自判断 + 显式完成？" | 收尾与钩子 |
