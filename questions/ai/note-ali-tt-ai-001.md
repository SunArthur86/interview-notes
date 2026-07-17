---
id: note-ali-tt-ai-001
difficulty: L3
category: ai
subcategory: Agent范式
tags:
- 阿里巴巴
- 淘天
- AI应用开发
- ReAct
- Plan-and-Execute
- Agent
- 面经
feynman:
  essence: ReAct是"边想边做"——每一步先思考再行动再观察，适合动态不确定的任务；Plan & Execute是"先规划后执行"——先生成完整计划再逐步执行，适合目标明确的多步任务。两者不是互斥关系，而是互补配合使用。
  analogy: "ReAct就像探险家——走到哪看到哪，根据眼前情况决定下一步（发现岔路→想→选一条走→看到新线索→再想→再选）。Plan & Execute就像建筑工程师——开工前先画完整施工图，然后按图纸一步步施工。现实中两者常配合：工程师先做总体规划(Plan)，施工中遇到突发问题现场解决(React)。"
  key_points:
  - ReAct = Observation-Thought-Action 循环，单步推理+执行，灵活但上下文易爆炸
  - Plan & Execute = 先全局规划再分步执行，稳定但灵活性差，重新规划成本高
  - ReAct适合环境动态变化、需要边执行边决策的场景（如数据分析查询）
  - Plan & Execute适合目标明确、步骤可预先规划的场景（如项目设计、代码生成）
  - 现实Agent系统通常混合使用：Plan做顶层规划，ReAct执行每个子任务
first_principle:
  essence: 推理范式的本质是"思考深度"与"执行灵活性"的权衡
  derivation: "任务复杂度 ↑ → 需要更长的推理链 → 上下文窗口有限 → 必须在「逐步思考(ReAct)」和「预先规划(Plan&Execute)」之间选择。ReAct的优势是每步都能感知环境变化，劣势是长链推理时上下文爆炸。Plan&Execute的优势是规划阶段集中思考，执行阶段上下文干净，劣势是环境变化时计划失效需要重新规划。"
  conclusion: 最优策略是分层混合——Plan&Execute做任务分解和全局规划，ReAct在每个子任务内部做灵活执行和工具调用。
follow_up:
- ReAct的Thought步骤能否用Chain-of-Thought(CoT)替代？有什么区别？
- Plan & Execute重新规划(replan)的触发条件是什么？如何避免频繁replan导致抖动？
- LangChain中的AgentExecutor默认使用哪种范式？如何切换？
- 在RAG场景中，单轮检索用ReAct还是Plan & Execute更合适？
memory_points:
- ReAct核心循环：Observation→Thought→Action→Observation（闭环），"边想边做"
- ReAct致命弱点：上下文爆炸——每步的Obs+Thought+Action都累积在prompt中
- Plan&Execute拆分为Planner和Executor两个角色，执行阶段上下文独立干净
- 混合范式是工业界标配：Claude Code在"create a todo list"指令时用Plan&Execute，每个task内用ReAct
---

# 【阿里淘天AI二面】介绍ReAct范式和Plan & Execute范式？什么情况下用哪种？

> 来源：阿里巴巴淘天淘工厂 AI应用开发 二面面经（小红书）

## 一、ReAct 范式

### 🎯 本质

ReAct = **Re**asoning + **Act**ing，让LLM交替进行"推理"和"行动"。

```
ReAct 循环：

  ┌──────────────────────────────────┐
  │                                  ▼
 Thought  ────→  Action  ────→  Observation
 (思考)          (执行工具)      (观察结果)
    │                                  │
    │  "根据观察结果，我下一步该做什么？" │
    └──────────────────────────────────┘
                  │
                  ▼
            最终回答 / 完成

示例（查天气Agent）：
  Thought: 用户想知道北京明天天气，我需要调用天气API
  Action:  search_weather("北京", "明天")
  Observation: 北京明天晴，最高温35°C
  Thought: 已经获得天气信息，可以回答用户了
  Answer:  北京明天晴天，最高温度35°C，注意防晒。
```

### 核心特点

| 维度 | 说明 |
|------|------|
| **思考方式** | 单步推理——每一步根据当前观察决定下一步 |
| **上下文** | 累积式——所有Obs+Thought+Action都在prompt中增长 |
| **灵活性** | 高——能根据环境变化动态调整策略 |
| **弱点** | 上下文爆炸——长链推理时prompt超出token限制 |
| **适用场景** | 环境**动态变化**、需要**边执行边决策**的任务 |

### 代码示例（LangChain风格）

```python
from langchain.agents import AgentExecutor, create_react_agent
from langchain.tools import Tool

tools = [
    Tool(name="Search", func=search_func, description="搜索信息"),
    Tool(name="Calculator", func=calc_func, description="数学计算"),
]

# ReAct的核心是Thought-Action-Observation循环
agent = create_react_agent(llm, tools, prompt)
executor = AgentExecutor(agent=agent, tools=tools, verbose=True)

# 每一步的prompt结构：
# Thought: 我需要先搜索XXX
# Action: Search
# Action Input: XXX
# Observation: [搜索结果]
# Thought: 现在我需要计算...
```

## 二、Plan & Execute 范式

### 🎯 本质

将Agent拆分为两个阶段：**Planner**（规划者）先生成全局计划，**Executor**（执行者）逐步执行。

```
Plan & Execute 架构：

  用户输入
     │
     ▼
┌─────────┐     1. "完成这个任务需要哪些步骤？"
│ Planner │ ──────────────────────────────→  计划：
│ (规划者) │                                  Step 1: 查询数据库
└─────────┘                                  Step 2: 分析数据
                                             Step 3: 生成报告
     │                                          Step 4: 发送邮件
     ▼
┌──────────┐    2. 逐步执行（每步上下文独立）
│ Executor │ ──→ Step 1: 查询数据库 ✅
│ (执行者)  │ ──→ Step 2: 分析数据   ✅
└──────────┘ ──→ Step 3: 生成报告   ✅
              ──→ Step 4: 发送邮件   ✅
     │
     ▼
  最终结果

关键优势：Executor每次只看当前步骤，上下文不会爆炸！
```

### 核心特点

| 维度 | 说明 |
|------|------|
| **思考方式** | 两阶段——先全局规划，后逐步执行 |
| **上下文** | 独立式——每个执行步骤的上下文是干净的 |
| **灵活性** | 低——计划生成后不易动态调整（需要replan） |
| **优势** | 执行更稳定，上下文可控，适合多步复杂任务 |
| **适用场景** | 目标**明确**、步骤可**预先规划**的任务 |

### 代码示例

```python
from langchain_experimental.plan_and_execute import (
    PlanAndExecute, load_chat_planner, load_agent_executor
)

# Planner：生成全局计划
planner = load_chat_planner(llm)
# Executor：逐步执行计划中的每个步骤
executor = load_agent_executor(llm, tools)

agent = PlanAndExecute(planner=planner, executor=executor, verbose=True)

# Planner输出示例：
# Plan:
# 1. 查询用户最近30天的订单数据
# 2. 统计每个品类的消费金额
# 3. 生成消费趋势分析报告
# 4. 将报告通过邮件发送给用户
```

## 三、两种范式对比

```
                    ReAct              Plan & Execute
                  ┌──────────┐         ┌──────────────┐
  规划粒度        │ 单步规划  │         │ 全局规划      │
                  ├──────────┤         ├──────────────┤
  上下文管理      │ 累积膨胀  │         │ 步骤独立      │
                  ├──────────┤         ├──────────────┤
  环境适应性      │ 强        │         │ 弱（需replan）│
                  ├──────────┤         ├──────────────┤
  执行稳定性      │ 较低      │         │ 高            │
                  ├──────────┤         ├──────────────┤
  适合任务        │ 不确定性  │         │ 确定性高      │
                  │ 高的场景  │         │ 的复杂任务    │
                  └──────────┘         └──────────────┘
```

| 对比维度 | ReAct | Plan & Execute |
|---------|-------|----------------|
| 规划时机 | 每一步 | 开始前一次性 |
| 上下文消耗 | O(N) 累积 | O(1) 每步独立 |
| 环境变化适应 | 天然适应 | 需要触发replan |
| 执行可控性 | 低（可能跑偏） | 高（按计划执行） |
| 典型工具 | LangChain ReAct Agent | LangChain PlanAndExecute |
| 代表应用 | 数据查询分析、实时问答 | 项目设计、多步数据处理流水线 |

## 四、什么情况用哪种？

### 用 ReAct 的场景

```
✅ 环境动态变化，无法预知所有步骤
   → 如：查询数据库分析数据，下一步取决于上一步的结果

✅ 任务步骤之间有强依赖，需要根据前一步结果调整
   → 如：调试代码，根据报错信息决定下一步操作

✅ 任务相对简单，步骤数 < 5-10 步
   → 如：查天气+计算温差+给建议
```

### 用 Plan & Execute 的场景

```
✅ 目标明确，步骤可以预先列出
   → 如：做整体的项目设计和架构规划

✅ 任务步骤多（>10步），ReAct会上下文爆炸
   → 如：自动化数据处理流水线（ETL）

✅ 需要执行可控性和确定性
   → 如：CI/CD流水线、批量文件处理
```

### 现实中的混合使用

```
工业界最佳实践：分层混合

  用户指令: "帮我重构这个项目的认证模块"
       │
       ▼
  ┌─────────────────────────┐
  │ Plan & Execute (顶层)    │
  │ 1. 分析现有认证代码       │
  │ 2. 设计新架构方案         │
  │ 3. 实现代码重构           │
  │ 4. 编写测试用例           │
  │ 5. 更新文档               │
  └────────┬────────────────┘
           │
     每个Step内部 ↓
  ┌─────────────────────────┐
  │ ReAct (执行层)           │
  │ Thought: 需要找到认证入口│
  │ Action: search_code(...) │
  │ Observation: 找到3处入口 │
  │ Thought: 分析认证逻辑... │
  └─────────────────────────┘

Claude Code 就是这个模式：
  "create a todo list" → Plan & Execute
  每个task内部 → ReAct
```

## 五、面试加分点

1. **提到上下文爆炸问题**：ReAct的最大痛点是prompt长度随步数线性增长，Plan & Execute通过拆分解决了这个问题
2. **提到Replan机制**：Plan & Execute在执行中发现计划不合理时，可以触发replan重新规划
3. **举Claude Code的真实例子**：说明你对工业界Agent系统有实际了解
4. **提到Reflexion范式**：作为扩展，ReAct + 自我反思 = Reflexion，能进一步提升执行质量

## 苏格拉底式面试追问

> 这组追问模拟面试官层层逼问，每一问先回答"为什么"，再回答"怎么做"，最后回答"如何证明"。

### 第一层：目标与动机

**Q：ReAct 和 Plan & Execute 你说一个适合动态任务一个适合确定任务，本质区别在哪里？凭什么不能互相替代？**

本质区别是"规划的时机"。ReAct 是每步规划（Thought 基于上一步 Observation 决定下一步 Action），规划粒度是单步，天然适应动态环境；Plan & Execute 是开始时一次性规划全局（Planner 生成所有 step），执行时每步独立，规划粒度是全局。不能互相替代是因为它们的失败模式相反：ReAct 在长任务（>10 步）上下文爆炸；Plan & Execute 在动态任务（后续步骤依赖前序结果）上计划失效。选型本质是"任务的动态性 vs 步数"的权衡。

### 第二层：证据与定位

**Q：你的 ReAct Agent 在一个 8 步任务上失败了，怎么判断是该用 Plan & Execute 替代，还是 ReAct 本身没调好？**

看失败发生在哪步。如果是前 3 步推理正确但第 4 步因上下文太长（前 3 步的 Thought+Action+Observation 累积到 4k+ token）导致模型丢失关键信息，是上下文爆炸问题，换 Plan & Execute 有效。如果是第 4 步因为前序结果意外（如工具返回了非预期的空值）导致后续推理跑偏，是动态适应问题，ReAct 反而比 Plan & Execute 强（后者无法根据意外结果调整）。判断依据是 Trace 里失败步的 prompt 长度和失败原因。

### 第三层：根因深挖

**Q：ReAct 的上下文爆炸，根因是 prompt 累积还是 Observation 太大？两者哪个更致命？**

Observation 太大更致命。prompt 里的 Thought 和 Action 每步约 50-100 token，10 步累积 1k token 可控；但 Observation 如果是数据库查询返回的 100 行结果或网页抓取的全文，单步可能 2k-5k token，3-4 步就爆。治本是对 Observation 做预处理——数据库结果只保留 top-10 + 字段裁剪，网页结果先摘要。更激进的是用"外部记忆"：把前面的 Observation 存到外部存储，prompt 里只放摘要 + 指针，模型需要时再检索。

**Q：那为什么不直接用 Plan & Execute 的"每步独立上下文"设计，从根本上杜绝爆炸？**

因为"每步独立上下文"假设步骤之间无依赖，而现实任务经常是后续步骤需要前序结果。比如"查用户最近订单 → 分析消费趋势 → 推荐商品"，第二步依赖第一步的订单数据。Plan & Execute 要么把前序结果作为参数传给后续步骤（但这些结果可能很大，等于把爆炸从 prompt 搬到参数），要么后续步骤重新查（重复调用浪费）。ReAct 的上下文累积虽然可能爆炸，但保留了步骤间的信息流动。混合架构（顶层 Plan & Execute 拆解 + 每步内 ReAct 执行）才是工程解。

### 第四层：方案权衡

**Q：Plan & Execute 的 Planner 生成计划后，执行中发现计划不合理怎么办？Replan 的触发条件怎么定？**

Replan 触发靠两种信号：一是显式失败——某步执行报错（如工具调用异常），触发 Planner 重新规划剩余步骤；二是隐式偏差——执行结果和计划预期不符（如计划假设查到 100 条数据，实际查到 0 条），由 Executor 判断是否需要 replan。Replan 的代价是 Planner 又跑一次（延迟 + 成本），且重规划可能引入新错误。工程上设阈值：只有关键步骤失败或偏差 >50% 才 replan，小偏差由 Executor 内部适应，避免频繁 replan 导致任务"原地打转"。

**Q：为什么不直接用 ReAct + 外部记忆（把历史存外面）解决上下文爆炸，还要引入 Plan & Execute 增加复杂度？**

ReAct + 外部记忆能缓解爆炸，但解决不了"长任务规划"问题。ReAct 是贪心的（每步只看当前最优），可能局部最优但全局跑偏——比如查数据分析，每步看起来都在"分析"，但 10 步后发现偏离了原始目标。Plan & Execute 先做全局规划保证方向对，再逐步执行保证落地。长任务（>5 步、目标复杂）需要全局规划，短任务（<5 步、动态）用 ReAct 够了。Claude Code 的"先 create todo list（Plan）再逐步执行（ReAct）"就是这个混合。

### 第五层：验证与沉淀

**Q：你怎么在具体任务上决定用 ReAct 还是 Plan & Execute？有没有量化标准？**

看两个维度：任务的"步数预期"和"动态性"。构建任务分类器或人工标注：步数 <5 且高度动态（如下一步依赖上一步的实时数据）→ ReAct；步数 >10 且步骤可预先列举（如 ETL 流水线）→ Plan & Execute；中间地带（6-10 步、半结构化）→ 混合（顶层 Plan 拆解 + 每步 ReAct）。量化标准：在同一任务集上对比两者的成功率和成本，成功率差距 >10% 就有明显优劣；若接近，选成本低的。

**Q：这两种范式的选型经验怎么沉淀成团队的 Agent 开发指南？**

固化成"Agent 范式选型决策树"：按任务步数和动态性分流，每类给出推荐范式 + 典型 case。沉淀"ReAct 的上下文压缩策略库"（Observation 摘要/外部记忆/滑动窗口）和"Plan & Execute 的 replan 规则模板"（触发条件/replan 范围/防死循环）。配套框架代码（ReAct runner 和 PlanAndExecute runner），新 Agent 开发时按决策树选范式 + 套框架，不从头造。把"哪些任务不适合 Agent（该用规则/传统代码）"也沉淀进来，避免过度 AI 化。

## 结构化回答

**30 秒电梯演讲：** ReAct是"边想边做"——每一步先思考再行动再观察，适合动态不确定的任务；Plan & Execute是"先规划后执行"——先生成完整计划再逐步执行，适合目标明确的多步任务。两者不是互斥关系，而是互补配合使用。

**展开框架：**
1. **ReAct** — ReAct = Observation-Thought-Action 循环，单步推理+执行，灵活但上下文易爆炸
2. **Plan** — Plan & Execute = 先全局规划再分步执行，稳定但灵活性差，重新规划成本高
3. **现实Agent系统通常混合使** — Plan做顶层规划，ReAct执行每个子任务

**收尾：** 您想深入聊：ReAct的Thought步骤能否用Chain-of-Thought(CoT)替代？有什么区别？


## 视频脚本

> 预计时长：4 分钟 | 由浅入深


| 时间 | 画面/字幕 | 口播台词 | 讲解要点 |
|------|----------|----------|----------|
| 0:00 | 标题卡：介绍ReAct范式和Plan & Execute… | "ReAct就像探险家——走到哪看到哪，根据眼前情况决定下一步（发现岔路→想→选一条走→看到…" | 开场钩子 |
| 0:20 | 核心概念图 | "ReAct是"边想边做"——每一步先思考再行动再观察，适合动态不确定的任务；Plan & Execute是"先规划后执行…" | 核心定义 |
| 0:50 | ReAct示意图 | "ReAct——ReAct = Observation-Thought-Action 循环，单步推理+执行，灵活但上下文易爆炸" | 要点拆解1 |
| 1:30 | 对比/实战案例图 | "对比一下常见误区和工程实践，看真实场景里怎么取舍。" | 实战与对比 |
| 2:20 | 总结卡 | "记住核心要点。下期我们追问：ReAct的Thought步骤能否用Chain-of-Tho？" | 收尾与钩子 |
