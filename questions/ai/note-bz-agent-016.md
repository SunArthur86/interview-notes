---
id: note-bz-agent-016
difficulty: L3
category: ai
subcategory: Agent
tags:
- B站面经
- 多Agent
- 协作模式
- 串行
- 并行
- 仲裁
feynman:
  essence: 多Agent协作三种模式——串行(流水线)、并行(分治)、仲裁(辩论)。串行求顺序，并行求速度，仲裁求可靠。
  analogy: 像餐厅——串行是前厅→后厨→传菜(流水线)，并行是多个厨师同时炒(分治)，仲裁是几个评委试菜打分取平均(辩论)。
  first_principle: 协作的本质是任务分解后的整合方式——顺序依赖用串行，独立子任务用并行，需多方共识用仲裁。
  key_points:
  - 串行：流水线，前输出后输入，适合有依赖
  - 并行：分治，子任务并发，适合独立任务
  - 仲裁：多Agent各出方案，投票/汇总，求可靠
  - 实际常混合使用
first_principle:
  essence: 协作模式取决于子任务间的依赖关系。
  derivation: 子任务有顺序依赖→必须串行。子任务相互独立→可并行。子任务结论需共识→需仲裁。任务结构决定协作模式，非主观选择。
  conclusion: 协作模式 = 子任务依赖结构的镜像（串行=顺序依赖，并行=相互独立，仲裁=需共识）
follow_up:
- 三种模式能混用吗？——能，先并行调研再串行写作最后仲裁审核
- 哪种最常用？——串行（流水线）最常见，实现简单
- 并行怎么聚合结果？——主管汇总/投票/LLM综合
memory_points:
- 串行：前一个输出是后一个输入，顺序明确但无法并行易阻塞
- 并行：主管分发独立子任务并发执行，速度快，最后聚合结果
- 仲裁：多方独立提方案，由仲裁者综合择优或融合，提升可靠性
---

# 多 Agent 协作有哪些模式？（串行、并行、仲裁三种）

## 一、三种协作模式总览

```
┌──────────────────────────────────────────────────┐
│                  三种协作模式                       │
├──────────────────────────────────────────────────┤
│                                                    │
│  1. 串行 (Sequential / Pipeline)                   │
│     A → B → C → 输出                               │
│     前一个的输出 = 后一个的输入                      │
│                                                    │
│  2. 并行 (Parallel / Fan-out)                      │
│        A                                           │
│       / \                                          │
│      B   C  → 聚合 → 输出                          │
│     同时执行，最后汇总                              │
│                                                    │
│  3. 仲裁 (Debate / Arbitration)                    │
│     A的方案 }                                      │
│     B的方案 } → 仲裁者 → 最终方案                  │
│     C的方案 }                                      │
│     多方提案，择优/融合                             │
│                                                    │
└──────────────────────────────────────────────────┘
```

## 二、模式 1：串行（Pipeline 流水线）

```
工作流：
  Agent A (调研) → Agent B (写作) → Agent C (校对) → 输出

特点：
  + 简单清晰，易实现
  + 顺序明确，易调试
  - 无法并行，速度慢
  - 一环出错全链路阻塞

适用：任务有明确阶段顺序
```

```python
class Pipeline:
    def __init__(self, agents):
        self.agents = agents  # [agent_a, agent_b, agent_c]
    
    def run(self, task):
        data = task
        for agent in self.agents:
            data = agent.process(data)  # 前一个输出给下一个
            if data is None:
                return "流水线在{agent}中断"
        return data

# 示例：内容生产流水线
pipeline = Pipeline([
    ResearchAgent(),   # 调研 → 素材
    WriterAgent(),     # 写作 → 草稿
    EditorAgent(),     # 校对 → 终稿
])
final = pipeline.run("写一篇Agent技术博客")
```

## 三、模式 2：并行（Fan-out 分治）

```
工作流：
              ┌─ Agent A (查新闻)
  主管分发 ───┼─ Agent B (查论文)  ──→ 主管聚合 → 输出
              └─ Agent C (查社区)

特点：
  + 速度快（并发执行）
  + 信息覆盖广
  - 需要聚合逻辑
  - 子任务必须相互独立

适用：子任务相互独立，可同时进行
```

```python
import asyncio

class ParallelCoordinator:
    def __init__(self, workers):
        self.workers = workers
    
    async def run(self, task):
        # 分解子任务
        subtasks = self.decompose(task)
        
        # 并发执行
        results = await asyncio.gather(*[
            worker.run(sub) for worker, sub in 
            zip(self.workers, subtasks)
        ])
        
        # 聚合结果
        return self.aggregate(results)

# 示例：市场调研
coordinator = ParallelCoordinator([
    NewsResearcher(),    # 查新闻
    PaperResearcher(),   # 查论文
    ForumResearcher(),   # 查社区
])
report = await coordinator.run("调研2026 Agent趋势")
```

## 四、模式 3：仲裁（Debate 辩论）

```
工作流：
  Agent A 提案 ─┐
  Agent B 提案 ─┼─→ 仲裁者(Aggregator) → 最终方案
  Agent C 提案 ─┘

特点：
  + 多视角，减少单点偏差
  + 可靠性高（容错）
  - 成本高（多次生成）
  - 需要好的仲裁机制

适用：高风险决策、需要多视角验证
```

```python
class DebateSystem:
    def __init__(self, proposers, arbitrator):
        self.proposers = proposers  # 多个提案Agent
        self.arbitrator = arbitrator  # 仲裁Agent
    
    def run(self, question):
        # 1. 各Agent独立给方案
        proposals = [p.propose(question) for p in self.proposers]
        
        # 2. （可选）多轮辩论
        for round in range(DEBATE_ROUNDS):
            proposals = [
                p.revise(question, proposals, own=p) 
                for p in self.proposers
            ]
        
        # 3. 仲裁者综合
        return self.arbitrator.arbitrate(question, proposals)

# 示例：医疗诊断
system = DebateSystem(
    proposers=[Cardiologist(), Neurologist(), Generalist()],
    arbitrator=ChiefDoctor()
)
diagnosis = system.run("患者症状：胸痛+头晕")
```

### 仲裁策略

```python
def arbitrate(question, proposals):
    # 策略1：投票（多数决）
    if is_objective(question):
        return most_common(proposals)
    
    # 策略2：LLM综合（取各方优点）
    return llm.synthesize(question, proposals)
    
    # 策略3：置信度加权
    weighted = [(p, p.confidence) for p in proposals]
    return max(weighted, key=lambda x: x[1])[0]
```

## 五、三种模式对比

| 维度 | 串行 | 并行 | 仲裁 |
|------|------|------|------|
| **速度** | 慢（串行） | 快（并发） | 中（并发+汇总） |
| **成本** | 低 | 中 | 高 |
| **可靠性** | 中 | 中 | 高（容错） |
| **适用** | 有顺序依赖 | 独立子任务 | 需多视角/高风险 |
| **典型** | 内容生产流水线 | 多源调研 | 医疗诊断/投资决策 |

## 六、混合模式（生产实战）

```
真实场景：开发一个软件功能

阶段1：并行调研（并行）
  ├─ Agent: 调研需求
  ├─ Agent: 调研技术方案
  └─ Agent: 调研竞品
       ↓ 汇总

阶段2：串行实现（串行）
  Architect → Developer → Tester
       ↓

阶段3：仲裁审核（仲裁）
  ├─ 代码审查Agent A
  ├─ 代码审查Agent B
  └─ 安全审查Agent C
       ↓ 仲裁
  最终是否合并
```

```python
async def hybrid_workflow(feature_request):
    # 阶段1：并行调研
    research = await parallel_coordinator.run(feature_request)
    
    # 阶段2：串行实现
    design = architect.run(research)
    code = developer.run(design)
    test_result = tester.run(code)
    
    # 阶段3：仲裁审核
    if test_result.passed:
        review = debate_system.run({"code": code, "action": "merge"})
        return review.approved
    return False
```

## 七、面试加分点

1. **三种模式讲清差异**：串行重顺序、并行重速度、仲裁重可靠，各有适用
2. **强调"实际混合"**：生产中很少单用一种，常是"并行调研→串行执行→仲裁审核"
3. **提成本意识**：仲裁模式最贵，不能滥用；简单任务串行即可

## 记忆要点

- 串行：前一个输出是后一个输入，顺序明确但无法并行易阻塞
- 并行：主管分发独立子任务并发执行，速度快，最后聚合结果
- 仲裁：多方独立提方案，由仲裁者综合择优或融合，提升可靠性

