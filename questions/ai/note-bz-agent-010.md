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
  derivation: 'ReAct是贪心的（每步局部最优），Plan-Execute是全局的（先看整体再行动）。对于步骤间有依赖的任务，先规划能避免走弯路。类比：盖楼先画图纸再施工，而非边想边盖。'
  conclusion: Plan-Execute = 全局规划（减少返工） + 局部调整（应对变化）的平衡
follow_up:
  - Planner和Executor用同一个模型吗？——可以不同，Planner用强模型，Executor用便宜的
  - 计划错了怎么办？——Replan机制，执行失败或偏差大时重新规划
  - 和ReAct怎么选？——任务可分解用Plan-Execute，需探索用ReAct
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
