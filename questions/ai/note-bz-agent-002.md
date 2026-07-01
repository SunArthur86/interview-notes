---
id: note-bz-agent-002
difficulty: L2
category: ai
subcategory: Agent
tags:
- B站面经
- Agent
- 规划
- 记忆
- 工具
feynman:
  essence: Agent三大核心能力=规划（怎么干）+记忆（记住什么）+工具（能干什么）。三者缺一不可，构成Agent的行动闭环。
  analogy: 像派一个新人去办事——规划是他的执行力（先干嘛后干嘛），记忆是他的笔记本（别重复犯错），工具是他手里的家伙（电脑/电话/车）。
  first_principle: 完成复杂任务需要三要素：决策能力（做什么）+状态保持（做到哪了）+执行能力（实际做）。LLM只有决策能力，Agent补齐了状态和执行。
  key_points:
  - 规划Planning：任务分解+步骤编排+失败重规划
  - 记忆Memory：短期上下文+长期向量库+工作记忆
  - 工具使用Tool Use：感知环境+执行动作+获取反馈
  - 三者通过控制循环协同工作
first_principle:
  essence: 任何智能体完成任务都遵循"感知-决策-行动"循环，三大能力对应循环的三个环节。
  derivation: 感知（工具读环境）→决策（LLM基于记忆规划）→行动（工具改环境）→记忆更新→循环。三大能力缺失任何一个都会断链。
  conclusion: Agent = Planning（决策）+ Memory（状态）+ Tool Use（执行），三者构成OODA闭环
follow_up:
- 这三大能力哪个最难做？——记忆（稀疏奖励、检索召回、用户隔离）
- 没有工具能用Agent吗？——不能，无工具则无法行动，退化成聊天机器人
- 规划能力怎么提升？——CoT/ToT prompting + 强模型 + 任务拆解经验
memory_points:
- 三大能力口诀：规划（拆解任务）、记忆（保持状态）、工具（执行操作）
- 规划范式：线性CoT、分支ToT、以及交替进行的ReAct（推理+行动）
- 记忆分层：短期为上下文窗口，长期为向量库检索，任务记忆记录执行轨迹
- 工具分类：分为感知类（读取环境如搜索）和行动类（改变环境如发邮件）
---

# AI Agent 的核心能力有哪些？（规划、记忆、工具使用）

## 一、三大核心能力总览

```
                    目标输入
                       │
                       ▼
              ┌─────────────────┐
              │  1. 规划 Planning │ ← LLM大脑分解任务
              └────────┬────────┘
                       │ 步骤列表
                       ▼
              ┌─────────────────┐
              │  2. 记忆 Memory   │ ← 读取历史/上下文
              └────────┬────────┘
                       │ 相关信息
                       ▼
              ┌─────────────────┐
              │ 3. 工具 Tool Use  │ ← 执行真实操作
              └────────┬────────┘
                       │ 执行结果
                       ▼
                 观察并循环
                 （写到记忆里）
```

## 二、规划 Planning

**作用：** 把模糊目标拆解为可执行的有序步骤。

```python
# 1. 任务分解（Decomposition）
goal = "帮我做一份2026年大模型行业调研报告"
plan = llm.plan(goal)
# 输出：
# Step 1: 搜索"2026 大模型 行业"最新新闻
# Step 2: 整理头部公司动态（OpenAI/Anthropic/国内）
# Step 3: 提炼技术趋势（Agent/MoE/多模态）
# Step 4: 撰写报告大纲
# Step 5: 充实内容并自检

# 2. 失败重规划（Replanning）
result = execute(plan[0])
if result.failed:
    new_plan = llm.replan(goal, error=result.error, tried=plan[:0])
```

**规划范式：**
- **CoT（思维链）：** 线性逐步推理
- **ToT（思维树）：** 多分支探索，失败回溯
- **Plan-and-Execute：** 先全局规划再逐步执行
- **ReAct：** 推理与行动交替（Reason + Act）

## 三、记忆 Memory

**作用：** 跨步骤、跨轮次、跨会话保持状态。

```
┌──────────────────────────────────────────┐
│ 记忆层次                                    │
├──────────────────────────────────────────┤
│ 短期记忆 (Working/Context)                 │
│   = 当前对话窗口（LLM直接可见）              │
│   特点：快但容量有限（如128K token）         │
├──────────────────────────────────────────┤
│ 长期记忆 (Long-term)                       │
│   = 向量数据库（按语义检索）                 │
│   特点：容量大但需检索（有延迟+召回率问题）   │
├──────────────────────────────────────────┤
│ 任务记忆 (Episodic)                        │
│   = 当前任务的执行轨迹                       │
│   特点：记录"做了什么/结果如何"，用于重规划   │
└──────────────────────────────────────────┘
```

```python
# 记忆写入与检索
memory.write("用户偏好：喜欢简洁的报告风格", user_id="u1")
context = memory.retrieve("写报告", user_id="u1", top_k=5)
# 注入到下次prompt：[历史偏好] 用户喜欢简洁风格...
```

## 四、工具使用 Tool Use

**作用：** 让 Agent 拥有"感知"和"行动"能力，超越纯文本。

```python
tools = [
    # 感知类（读环境）
    {"name": "web_search", "desc": "搜索互联网"},
    {"name": "read_file", "desc": "读取本地文件"},
    {"name": "query_db", "desc": "查询数据库"},
    # 行动类（改环境）
    {"name": "send_email", "desc": "发送邮件"},
    {"name": "write_file", "desc": "写入文件"},
    {"name": "call_api", "desc": "调用外部API"},
]

# LLM决策：用哪个工具+传什么参数
decision = llm.tool_call(
    context="用户要订机票",
    tools=tools
)
# → {"name": "web_search", "args": {"q": "北京机票 6月"}}
observation = execute(decision)  # 真实执行
```

**工具使用的挑战：**
- 工具过多时选不准（30+工具命中率下降）
- 工具描述不清导致误用
- 调用失败如何重试/降级
- 参数格式不对（需要 schema 校验）

## 五、三大能力的协同：ReAct 循环

```python
# 经典ReAct循环，体现三大能力协同
def react_agent(goal, memory, tools):
    trajectory = []
    for step in range(MAX_STEPS):
        # 1. 规划+记忆：基于历史决定下一步
        thought = llm.reason(goal, trajectory, memory.recall(goal))
        # 2. 工具使用：决定调用什么
        action = llm.act(thought, tools)
        # 3. 观察：执行并记录
        observation = execute(action)
        # 4. 记忆更新
        trajectory.append((thought, action, observation))
        memory.write(trajectory[-1])
        # 5. 判断完成
        if llm.is_complete(goal, trajectory):
            return llm.finalize(goal, trajectory)
```

## 六、面试加分点

1. **强调"闭环"**：三大能力不是独立的，而是构成"感知-决策-行动"闭环，缺一环都会断链
2. **提"记忆最难"**：规划和工具相对成熟（靠强模型 + API 规范），记忆是最难工程化的（检索召回/用户隔离/遗忘策略）
3. **能力分级**：弱 Agent（固定流程+少量工具）→ 强 Agent（动态规划+长期记忆+多工具）→ 自主 Agent（自主设目标）

## 记忆要点

- 三大能力口诀：规划（拆解任务）、记忆（保持状态）、工具（执行操作）
- 规划范式：线性CoT、分支ToT、以及交替进行的ReAct（推理+行动）
- 记忆分层：短期为上下文窗口，长期为向量库检索，任务记忆记录执行轨迹
- 工具分类：分为感知类（读取环境如搜索）和行动类（改变环境如发邮件）

