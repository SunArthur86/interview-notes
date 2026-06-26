---
id: note-bz-agent-014
difficulty: L3
category: ai
subcategory: Agent
tags:
  - B站面经
  - 认知框架
  - CoT
  - ReAct
  - Plan-Execute
  - Reflexion
feynman:
  essence: 四大认知框架各有所长——CoT擅长单步推理，ReAct擅长边想边做，Plan-Execute擅长全局规划，Reflexion擅长从错误学习。选型看任务的复杂度、确定性和反馈可得性。
  analogy: 像选交通工具——短途骑车(CoT)，城市出行开车(ReAct)，长途旅行先规划路线(Plan-Execute)，迷路了要看导航纠错(Reflexion)。
  first_principle: 不同任务的"结构"不同——有的可分解(Plan)，有的需探索(ReAct)，有的需推理(CoT)，有的会失败(Reflexion)。框架选择要匹配任务结构。
  key_points:
    - CoT：单步深度推理（数学/逻辑）
    - ReAct：推理+行动交替（通用Agent）
    - Plan-Execute：先规划后执行（多步确定任务）
    - Reflexion：试错+反思（有反馈的难题）
    - 选型：看任务复杂度/确定性/反馈可得性
first_principle:
  essence: 没有万能框架，框架是任务结构的映射。
  derivation: '任务可否分解？→Plan-Execute。是否需要外部信息？→ReAct。是否单步可推？→CoT。失败可否诊断？→Reflexion。选型本质是匹配任务的信息需求结构。'
  conclusion: 框架选型 = 匹配任务的（可分解性/信息需求/反馈可得性/探索需求）
follow_up:
  - 这些框架能组合吗？——能，Plan-Execute的每步可用ReAct，ReAct失败可加Reflexion
  - 哪个最通用？——ReAct，是现代Agent的基础范式
  - 生产环境怎么选？——复杂度低用ReAct，复杂度高用混合(Plan+ReAct+Reflexion)
---

# 主流认知框架（CoT/ReAct/Plan-Execute/Reflexion）各自适用什么场景？

## 一、四大框架速览

```
┌──────────────┬────────────────┬──────────────────────┐
│ 框架          │ 一句话           │ 核心机制               │
├──────────────┼────────────────┼──────────────────────┤
│ CoT          │ 先想清楚再答     │ 推理链(Thought→Answer) │
│ ReAct        │ 边想边做         │ Thought→Act→Obs循环   │
│ Plan-Execute │ 先规划全局再干   │ Plan→Execute→Replan   │
│ Reflexion    │ 失败了反思再试   │ Act→Eval→Reflect循环  │
└──────────────┴────────────────┴──────────────────────┘
```

## 二、各框架详解与适用场景

### 1. CoT（思维链）

```
机制：Thought → Thought → ... → Answer
      （纯推理，无外部行动）

适用：
  ✓ 数学计算（"鸡兔同笼"）
  ✓ 逻辑推理（"甲乙丙谁说谎"）
  ✓ 常识推理（"为什么天空是蓝的"）
  ✗ 需要实时信息的（"今天天气"）
  ✗ 需要执行动作的（"发邮件"）

特点：最简单，单次调用，适合"脑内可解"的问题
```

### 2. ReAct（推理+行动）

```
机制：Thought → Action → Observation → Thought → ...

适用：
  ✓ 需要查信息的（"最新新闻""库存查询"）
  ✓ 需要工具的（"计算""搜索""调用API"）
  ✓ 通用Agent任务（客服/助手）
  ✗ 步骤超多且明确的（用Plan更高效）
  ✗ 完全无工具的纯推理（用CoT即可）

特点：最通用，是现代Agent的基础范式
```

### 3. Plan-and-Execute（计划-执行）

```
机制：Plan(全局规划) → Execute(逐步) → Replan(必要时)

适用：
  ✓ 步骤明确可分解的（"写报告""部署系统"）
  ✓ 多步骤有依赖的（"做调研→分析→总结"）
  ✓ 需要全局视角的（避免ReAct的局部贪心）
  ✗ 高度不确定需探索的（计划容易失效）
  ✗ 简单任务（杀鸡用牛刀）

特点：全局规划，适合结构化复杂任务
```

### 4. Reflexion（反思）

```
机制：Act → Evaluate → Reflect → 重试（带反思记忆）

适用：
  ✓ 有明确成败反馈的（代码/数学/游戏）
  ✓ 难题（一次做不对，需迭代）
  ✓ 错误可诊断的（能说出"为什么错"）
  ✗ 主观任务（评估难，反思无依据）
  ✗ 实时性要求高的（多轮太慢）

特点：从错误学习，适合"可验证"的难题
```

## 三、按任务特征选型

### 决策树

```
任务来了
   │
   ├─ 需要外部信息/工具吗？
   │    ├─ 否 → CoT（纯推理即可）
   │    │
   │    └─ 是 → 步骤是否多且明确？
   │         ├─ 否（需探索）→ ReAct
   │         │
   │         └─ 是（可分解）→ Plan-Execute
   │
   └─ 失败后能判断对错吗？
        ├─ 能 → 加上 Reflexion（迭代优化）
        └─ 不能 → 一次性，不反思
```

### 场景对照表

| 场景 | 推荐框架 | 理由 |
|------|---------|------|
| "23×17=?" | CoT | 纯计算，脑内可解 |
| "今天新闻" | ReAct | 需搜索（工具） |
| "写市场调研报告" | Plan-Execute | 多步骤可分解 |
| "修这个bug" | Reflexion | 可测试验证，需迭代 |
| "客服对话" | ReAct | 灵活，需查信息 |
| "证明数学定理" | CoT+Reflexion | 推理+可验证 |

## 四、框架的组合使用

生产中常**组合**多个框架，而非单选：

```
混合架构示例：

┌──────────────────────────────────────────────┐
│  Plan-Execute 做骨架（全局规划）               │
│                                                │
│  Plan: [step1, step2, step3, step4]            │
│                                                │
│  每个step内部用 ReAct 执行（保持灵活）          │
│    step2: Thought→Act→Obs→Thought...          │
│                                                │
│  失败时触发 Reflexion（反思重试）               │
│    step3失败 → Reflect → 带经验重试            │
│                                                │
│  推理环节本质都是 CoT                          │
└──────────────────────────────────────────────┘
```

```python
def hybrid_agent(goal):
    # Plan-Execute骨架
    plan = planner.decompose(goal)
    
    reflections = []  # Reflexion记忆
    
    for step in plan.steps:
        # 每步用ReAct执行（内部Thought是CoT）
        for trial in range(MAX_TRIALS):
            result = react_agent.run(step, reflections)
            if result.success:
                break
            # Reflexion反思
            reflections.append(reflect(step, result))
        else:
            # 多次失败，上升到Replan
            plan = planner.replan(goal, plan)
    
    return aggregate(plan.results)
```

## 五、成本与延迟对比

```
┌──────────────┬────────┬──────────┬────────────┐
│ 框架          │ 调用次数 │ Token消耗 │ 延迟        │
├──────────────┼────────┼──────────┼────────────┤
│ CoT          │ 1       │ 低        │ 最低        │
│ ReAct        │ N步     │ 中        │ 中          │
│ Plan-Execute │ 1+N     │ 中        │ 中          │
│ Reflexion    │ K轮×N步 │ 高        │ 高          │
└──────────────┴────────┴──────────┴────────────┘

成本递增：CoT < ReAct ≈ Plan-Execute < Reflexion
```

## 六、面试加分点

1. **不要说"哪个最好"**：每个框架有适用场景，选型匹配任务特征才专业
2. **强调组合**：生产中几乎都是混合架构（Plan 骨架 + ReAct 节点 + Reflexion 兜底）
3. **从任务结构出发**：可分解？需工具？可验证？——这三个问题决定框架选择
