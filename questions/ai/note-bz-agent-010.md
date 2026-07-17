---
id: note-bz-agent-010
difficulty: L3
category: ai
subcategory: Agent
tags:
- B站面经
- Plan-and-Execute
- 认知框架
- Agent
feynman:
  essence: Plan-and-Execute=先全局规划再逐步执行。规划器把大目标拆成有序步骤，执行器逐步完成，必要时回溯重规划。解决ReAct"只见树木不见森林"的问题。
  analogy: 像旅行计划——先做完整攻略(Day1去哪Day2去哪)，再按计划执行。比ReAct的"走一步看一步"更有全局观，遇到封路再调整。
  first_principle: ReAct每步只看当前，缺乏全局规划，导致步骤冗余或方向偏差。先做全局Plan能提升效率和准确性，执行时遇到偏差再局部调整。
  key_points:
  - 两阶段：Planner全局规划 + Executor逐步执行
  - 解决ReAct的局部视角问题
  - 规划与执行解耦，可用不同模型
  - 失败时支持Replan（重新规划）
first_principle:
  essence: 复杂任务需要"自顶向下"的层次化分解，而非"自底向上"的逐步试探。
  derivation: ReAct是贪心的（每步局部最优），Plan-Execute是全局的（先看整体再行动）。对于步骤间有依赖的任务，先规划能避免走弯路。类比：盖楼先画图纸再施工，而非边想边盖。
  conclusion: Plan-Execute = 全局规划（减少返工） + 局部调整（应对变化）的平衡
follow_up:
- Planner和Executor用同一个模型吗？——可以不同，Planner用强模型，Executor用便宜的
- 计划错了怎么办？——Replan机制，执行失败或偏差大时重新规划
- 和ReAct怎么选？——任务可分解用Plan-Execute，需探索用ReAct
memory_points:
- 核心思想：先全局规划，后逐步执行，必要时重新规划
- 两阶段：Phase1 Planner生成步骤列表，Phase2 Executor逐步执行
- 对比ReAct：ReAct走一步看一步，Plan-Execute有全局视角避免局部贪心
- 模型搭配：Planner可用强模型，Executor可用便宜模型
---

# Plan-and-Execute（计划-执行）认知框架怎么工作？

## 一、核心思想：先规划，后执行

```
ReAct（走一步看一步）：
  Thought→Act→Obs→Thought→Act→Obs...
  问题：缺乏全局视角，可能绕远路

Plan-and-Execute（先规划再执行）：
  Phase 1: Plan（全局规划）
    "写报告" → [1.查资料 2.列大纲 3.写初稿 4.校对 5.定稿]
  
  Phase 2: Execute（逐步执行）
    执行步骤1 → 执行步骤2 → ... → 完成
  
  Phase 3: Replan（必要时重新规划）
    步骤2失败 → 重新规划剩余步骤
```

## 二、两阶段架构

```
┌──────────────────────────────────────────────┐
│              Planner（规划器）                  │
│  输入：用户目标 + 历史上下文                    │
│  输出：有序步骤列表（多步骤）                    │
│  ┌──────────────────────────────────────┐   │
│  │ "分析竞品" →                          │   │
│  │   1. 搜索竞品名单                      │   │
│  │   2. 逐个收集产品信息                   │   │
│  │   3. 对比核心功能                      │   │
│  │   4. 分析价格策略                      │   │
│  │   5. 生成对比报告                      │   │
│  └──────────────────────────────────────┘   │
└──────────────────┬───────────────────────────┘
                   │ steps
                   ▼
┌──────────────────────────────────────────────┐
│            Executor（执行器）                   │
│  for step in steps:                            │
│    result = execute_step(step)                 │
│    if result.failed or result.deviation:       │
│      → trigger Replan                          │
└──────────────────┬───────────────────────────┘
                   │ 必要时
                   ▼
┌──────────────────────────────────────────────┐
│              Replan（重规划）                   │
│  输入：原计划 + 已完成步骤 + 失败原因            │
│  输出：调整后的剩余计划                         │
└──────────────────────────────────────────────┘
```

## 三、代码实现

```python
class PlanExecuteAgent:
    def __init__(self, planner_llm, executor_llm, tools):
        self.planner = planner_llm  # 规划用强模型
        self.executor = executor_llm  # 执行可用便宜模型
        self.tools = tools
    
    def run(self, goal):
        # Phase 1: 全局规划
        plan = self.make_plan(goal)
        
        # Phase 2: 逐步执行
        results = []
        while plan.steps:
            step = plan.steps[0]
            result = self.execute_step(step)
            
            if result.success:
                results.append(result)
                plan.steps.pop(0)  # 完成则移除
            else:
                # Phase 3: 重规划
                plan = self.replan(goal, plan, results, result.error)
        
        return self.aggregate(goal, results)
    
    def make_plan(self, goal):
        prompt = f"""
        把以下目标分解为有序的可执行步骤：
        目标: {goal}
        
        要求：
        - 每步是原子操作（可独立完成）
        - 步骤间有逻辑顺序
        - 考虑可能的依赖关系
        """
        return self.planner.plan(prompt)
    
    def execute_step(self, step):
        """单步执行（内部可以是ReAct）"""
        return ReActAgent(self.executor, self.tools).run(step)
    
    def replan(self, goal, plan, done, error):
        prompt = f"""
        原目标: {goal}
        已完成: {done}
        剩余计划: {plan.steps}
        失败: {error}
        
        请调整剩余计划以达成目标。
        """
        return self.planner.plan(prompt)
```

## 四、Planner 和 Executor 模型分工

```
规划质量决定上限 → Planner用强模型（Claude Opus/GPT-4）
执行效率决定成本 → Executor用小模型（GPT-4o-mini/Qwen）

┌────────────┬───────────────┬────────────────┐
│ 角色        │ 能力要求        │ 推荐模型         │
├────────────┼───────────────┼────────────────┤
│ Planner    │ 推理强、懂分解   │ 顶级模型         │
│ Executor   │ 工具调用准、快   │ 中等模型         │
│ Replanner  │ 同Planner      │ 顶级模型         │
└────────────┴───────────────┴────────────────┘

成本优化：Planner调用少（1-3次），Executor调用多（N步）
所以Planner用贵的合理，Executor用便宜的省钱
```

## 五、Replan 触发条件

```python
def should_replan(self, step, result):
    # 1. 执行失败
    if not result.success:
        return True, "工具调用失败"
    
    # 2. 结果与预期偏差大
    if result.confidence < 0.5:
        return True, "结果不可靠"
    
    # 3. 发现原计划有误
    if result.indicates_wrong_assumption:
        return True, "前提假设错误"
    
    # 4. 步数超限
    if self.total_steps > MAX_STEPS:
        return True, "步数过多需精简"
    
    return False, None
```

## 六、Plan-Execute vs ReAct 对比

| 维度 | Plan-Execute | ReAct |
|------|-------------|-------|
| **视角** | 全局（先看整体） | 局部（走一步看一步） |
| **效率** | 高（少走弯路） | 可能低（贪心） |
| **灵活性** | 中（需Replan） | 高（每步可调） |
| **Token** | 规划一次+执行N次 | 每步都推理 |
| **适用** | 步骤明确、可分解 | 需探索、不确定 |
| **典型** | "写报告""部署系统" | "查信息""调试" |

## 七、混合策略：Plan + ReAct

```python
# 生产中常用混合：Plan-Execute做骨架，每步内部用ReAct
def hybrid_agent(goal):
    plan = planner.make_plan(goal)  # 全局规划
    
    for step in plan.steps:
        # 每步内部用ReAct（保持灵活性）
        result = ReActAgent().run(step)
        
        if step_failed(result):
            # 局部ReAct解决不了，上升到全局Replan
            plan = planner.replan(goal, plan, result)
    
    return aggregate(results)
```

## 八、面试加分点

1. **强调"全局视角"**：Plan-Execute 解决 ReAct 的局部贪心问题，适合步骤明确的复杂任务
2. **提"模型分工"**：Planner 用强模型，Executor 用小模型，体现成本意识
3. **混合更实用**：生产中常用"Plan 骨架 + ReAct 节点"，兼顾全局规划和局部灵活

## 记忆要点

- 核心思想：先全局规划，后逐步执行，必要时重新规划
- 两阶段：Phase1 Planner生成步骤列表，Phase2 Executor逐步执行
- 对比ReAct：ReAct走一步看一步，Plan-Execute有全局视角避免局部贪心
- 模型搭配：Planner可用强模型，Executor可用便宜模型


## 苏格拉底式面试追问

> 这组追问模拟面试官层层逼问，每一问先回答"为什么"，再回答"怎么做"，最后回答"如何证明"。

### 第一层：目标与动机

**Q：Plan-and-Execute 要"先全局规划再执行"，但 ReAct 也能完成任务，为什么要多一个"规划"环节？解决了 ReAct 什么痛点？**

ReAct 是"贪心式"逐步决策——每步只看上一步 Observation 决定下一步，缺乏全局视野。复杂任务（如"做一个市场调研报告"涉及多步骤：收集数据→分析→对比→总结）用 ReAct 容易"走一步看一步"导致：1）方向漂移——走到中间发现前面步骤漏了关键信息，要回头重来；2）效率低——没规划就执行，可能做了无关步骤浪费算力；3）难以并行——逐步依赖无法并行。Plan-and-Execute 先生成完整计划（"1.收集A数据 2.收集B数据 3.对比 4.总结"），执行时按计划走，必要时回溯重规划。解决的是"全局视野缺失"，适合步骤多、有依赖关系、需要全局优化的复杂任务。

### 第二层：证据与定位

**Q：Plan-and-Execute 执行到第 3 步发现计划错了（如第 1 步的数据根本拿不到），怎么处理？是硬着头皮继续还是重新规划？**

触发"重规划"机制。Plan-and-Execute 不是"计划一次就死板执行"，而是"执行中发现偏差就回溯重规划"。具体：每个步骤执行后，Executor 检查执行结果是否符合 Plan 的预期——如果不符合（如数据拿不到、结果和预期矛盾），回到 Planner，把"当前已完成步骤+失败原因+新信息"喂给 Planner，让它生成修订后的计划（从当前进度继续，不是从零重来）。这个"执行-检查-重规划"循环是 Plan-Execute 的关键设计。判断"是否需要重规划"的阈值要调：太敏感（一步不顺就重规划）会频繁打断、效率低；太迟钝（计划明显错了还硬执行）会浪费算力。实务：只在"关键步骤失败"或"连续两步偏差"时触发重规划。

### 第三层：根因深挖

**Q：Plan-and-Execute 的 Planner 生成计划经常"不靠谱"（步骤遗漏或顺序错误），根因是 LLM 推理能力不行还是规划 prompt 的问题？**

两个根因都有，但 prompt 通常是主因。1）prompt 问题——Planner 的 prompt 如果只说"请规划步骤"，LLM 会生成粗略/遗漏的计划。要给 prompt 加：任务分解指引（如"按时间/逻辑顺序分解"）、few-shot 示例（演示好计划长什么样）、约束（"每步要明确输入输出和依赖"）。2）LLM 能力问题——复杂任务的规划需要强推理，弱模型（如 7B）规划质量差。验证方法：固定同一 prompt，分别用 7B/70B 生成计划，对比计划质量（步骤完整性/顺序正确性）。如果 70B 明显更好，是 LLM 能力问题；如果都差，是 prompt 问题。实务：Planner 用强模型（70B/GPT-4）保证规划质量，Executor 可以用弱模型（执行单步任务相对简单），分工优化成本。

**Q：既然 Planner 用强模型、Executor 用弱模型，那为什么不全部用强模型一步到位，非要分两层？**

成本和延迟。强模型（如 GPT-4）每次调用贵且慢（几秒），如果每个执行步骤都调强模型，一个 5 步任务的 LLM 调用成本是 5×强模型价格。分层后：Planner 调用 1 次强模型（生成全局计划，贵但只 1 次），Executor 调用 5 次弱模型（执行单步，便宜快），总成本远低于"5 次强模型"。这其实是"把强模型的推理能力用在刀刃（规划）上，弱模型做执行"的成本优化。前提是"执行单步"确实比"全局规划"简单（通常成立——执行单步是确定性的工具调用，规划是不确定性的任务分解）。如果执行步骤也很复杂（如每步都要复杂推理），就别省这个钱，全用强模型。

### 第四层：方案权衡

**Q：Plan-and-Execute 和 ReAct，在"计划的刚性 vs 执行的灵活性"上是对立的，实际项目怎么选？**

按"任务确定性"选。1）高确定性任务（流程固定，如"按 SOP 处理工单"）——Plan-and-Execute 更优，先规划出标准流程再执行，稳定高效；2）低确定性任务（信息动态、需边查边决策，如"调研开放问题"）——ReAct 更优，逐步适应新信息，Plan 会因为信息不足而规划错；3）混合任务（有大框架但细节动态，如"做市场分析报告，框架固定但数据要动态查"）——Plan-Execute 为主（规划报告大纲），ReAct 为辅（每步的数据收集用 ReAct 模式）。实务：先判断任务的"确定性比例"，确定性强用 Plan-Execute，不确定性强用 ReAct，混合的用"Plan 大纲 + ReAct 执行细节"。

**Q：Plan-and-Execute 要先生成完整计划，但如果任务超大（如 20 步），计划本身就很长且容易错，为什么不"滚动规划"（只规划接下来 3 步）？**

滚动规划（receding horizon）是 Plan-Execute 的进阶变体，确实更适合超大任务。原因：1）超大任务的完整计划容易错——20 步的计划，第 10 步可能因为前 9 步的执行结果而完全改变，早期规划的后期步骤是浪费；2）滚动规划只规划"接下来 3 步"（近期确定），执行完再基于结果规划"下 3 步"，兼顾全局方向和动态适应。代价是"全局最优性下降"——只看 3 步可能局部最优但全局次优。实务：小任务（<8 步）用完整 Plan-Execute（全局优）；大任务（>10 步）用滚动规划（每 3 步重规划）；超大的（如软件工程项目）用分层规划（先粗粒度规划大阶段，每阶段内再细规划）。

### 第五层：验证与沉淀

**Q：你怎么证明 Plan-and-Execute 比ReAct 在复杂任务上确实更好，而不是"多了一层规划反而更慢更错"？**

在复杂任务集上 AB 测试。选"步骤多、有依赖、需全局优化"的任务（如多跳问答、项目分解），对比 ReAct（逐步）和 Plan-Execute（先规划再执行）。指标：1）完成率——Plan-Execute 应更高（全局视野减少方向错误）；2）效率（步数/最优步数比）——Plan-Execute 应更接近 1（规划后少走弯路）；3）重规划率——如果 Plan-Execute 频繁重规划（>30% 步骤触发重规划），说明 Planner 质量差，规划反而成了负担；4）总延迟和成本——Plan-Execute 多了一次 Planner 调用，但执行步数可能更少，总成本可能持平或更低。如果 Plan-Execute 完成率高 20%、步数少 30%、总成本持平，证明值得。如果重规划率高、步数没少，说明 Planner 不行，要优化规划 prompt 或换更强模型。

**Q：Plan-and-Execute 的规划器和重规划机制怎么沉淀成框架能力？**

封装成 PlanExecuteExecutor 组件：1）Planner 模块——内置规划 prompt 模板（任务分解指引+few-shot+约束），支持配置 Planner 用的 LLM（默认强模型）；2）Executor 模块——按计划逐步执行，支持每步用 ReAct 模式（动态适应）；3）重规划触发器——内置"执行偏差检测"（结果和预期不符/连续失败/关键步骤失败），自动回到 Planner 重规划；4）滚动规划模式——大任务自动切换到"每 N 步重规划"；5）计划可视化——生成的计划和执行进度上报到 dashboard，可监控。这套写入团队 Agent 框架 SOP，新复杂任务选 Plan-Execute 模式即可，不重写规划和重规划逻辑。

## 结构化回答

**30 秒电梯演讲：** Plan-and-Execute=先全局规划再逐步执行。规划器把大目标拆成有序步骤，执行器逐步完成，必要时回溯重规划。解决ReAct"只见树木不见森林"的问题。

**展开框架：**
1. **两阶段** — Planner全局规划 + Executor逐步执行
2. **解决** — 解决ReAct的局部视角问题
3. **规划** — 规划与执行解耦，可用不同模型

**收尾：** 您想深入聊：Planner和Executor用同一个模型吗？——可以不同，Planner用强模型，Executor用便宜的？


## 视频脚本

> 预计时长：4 分钟 | 由浅入深


| 时间 | 画面/字幕 | 口播台词 | 讲解要点 |
|------|----------|----------|----------|
| 0:00 | 标题卡：Plan-and-Execute（计划-执行）认… | "像旅行计划——先做完整攻略(Day1去哪Day2去哪)，再按计划执行。比ReAct的"走一…" | 开场钩子 |
| 0:20 | 核心概念图 | "Plan-and-Execute=先全局规划再逐步执行。规划器把大目标拆成有序步骤，执行器逐步完成，必要时回溯重规划。解…" | 核心定义 |
| 0:50 | 两阶段示意图 | "两阶段——Planner全局规划 + Executor逐步执行" | 要点拆解1 |
| 1:30 | 对比/实战案例图 | "对比一下常见误区和工程实践，看真实场景里怎么取舍。" | 实战与对比 |
| 2:20 | 总结卡 | "记住核心要点。下期我们追问：Planner和Executor用同一个模型吗？——可以不同？" | 收尾与钩子 |
