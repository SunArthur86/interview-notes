---
id: note-ai50-012
difficulty: L4
category: ai
subcategory: Agent
tags:
- 某厂
- 面经
- Agent
- 自进化
- Memory
- 经验学习
feynman:
  essence: 不微调模型的情况下，通过外部记忆系统和经验库让Agent"记住"过去的成功和失败，逐步改进行为
  analogy: 就像新员工成长——不需要回炉重造(微调)，靠工作笔记(经验记忆)、同事反馈(评估循环)、SOP更新(Prompt迭代)就能越来越熟练
  first_principle: 模型权重不可变时，Agent的"学习"只能发生在外部系统。本质是将"学习"从参数更新(Backprop)转为知识积累(Memory + Reflexion)
  key_points:
  - '经验记忆: 记录成功和失败的案例，检索增强下次执行'
  - 'Reflexion机制: 执行后自我反思，将反思写入记忆'
  - 'Prompt动态优化: 根据历史表现自动调整Prompt'
  - '工具使用策略进化: 学习什么场景用什么工具组合最有效'
first_principle:
  essence: Agent自进化 = 外部记忆(经验积累) + 反思机制(经验提取) + 行为修正(经验应用)
  derivation: 微调改变模型权重(参数空间学习)，自进化改变外部知识(符号空间学习)。两者正交互补。不微调时，符号空间的积累是唯一进化路径
  conclusion: 不微调也能实现Agent自进化，核心是把每次执行的经验(成功/失败/优化)结构化存储并检索复用
follow_up:
- 经验记忆和RAG有什么本质区别？
- 自进化的效果有上限吗？什么时候必须微调？
- 如何评估自进化是否真的在进步而不是退化？
memory_points:
- 核心手段：无需微调参数，靠经验记忆库（Memory）和自我反思（Reflexion）进化
- 经验沉淀：每次执行的成功或失败轨迹向量化存储，作为下次决策的先验知识
- 反思机制：执行失败后，让LLM分析错误原因并生成反思总结，更新到提示词中
- 双引擎：Prompt动态优化与策略调整结合，让Agent越跑越聪明
---

# 不微调模型如何实现Agent自进化？

## 自进化四层架构

```
┌──────────────────────────────────────────────────┐
│                 Agent 自进化循环                    │
│                                                    │
│   ┌────────┐   执行    ┌────────┐                │
│   │ Memory │─────────→│ Agent  │                │
│   │ (经验)  │←─────────│ (执行)  │                │
│   └───┬────┘  检索增强  └───┬────┘                │
│       │                     │ 执行结果              │
│       │                     ▼                     │
│       │              ┌────────────┐               │
│       │   反思写入    │ Reflexion  │               │
│       │←─────────────│ (自我评估)  │               │
│       │              └──────┬─────┘               │
│       │                     │ 更新策略              │
│       ▼                     ▼                     │
│   ┌────────┐         ┌────────────┐               │
│   │ Prompt │         │ Strategy   │               │
│   │ 优化   │         │ 优化       │               │
│   └────────┘         └────────────┘               │
│                                                    │
│   每次循环后，Agent用积累的经验做得更好             │
└──────────────────────────────────────────────────┘
```

## 层1: 经验记忆系统

```python
class ExperienceMemory:
    """Agent的经验库，类似RAG但存的是经验而非知识"""
    
    def __init__(self):
        self.success_cases = VectorStore(collection="successes")
        self.failure_cases = VectorStore(collection="failures")
        self.optimizations = VectorStore(collection="optimizations")
    
    def record(self, task, execution_trace, outcome):
        """记录一次执行经验"""
        experience = {
            "task": task,
            "steps": execution_trace.steps,
            "tools_used": execution_trace.tools,
            "outcome": outcome,  # success/failure/partial
            "error": execution_trace.error,
            "user_feedback": outcome.feedback,
            "timestamp": time.time()
        }
        
        if outcome.is_success:
            self.success_cases.add(experience)
        else:
            failure_cases.add(experience)
    
    def retrieve_relevant(self, task):
        """检索与当前任务相关的经验"""
        successes = self.success_cases.search(task, top_k=3)
        failures = self.failure_cases.search(task, top_k=3)
        
        return {
            "similar_successes": successes,
            "similar_failures": failures,
            "tips": self._extract_tips(successes, failures)
        }
```

## 层2: Reflexion反思机制

```python
def reflexion_loop(agent, task, max_rounds=3):
    """执行 → 反思 → 改进 → 重试"""
    
    for round_num in range(max_rounds):
        # 执行任务
        result = agent.run(task)
        
        # 评估结果
        evaluation = evaluate_result(result, task)
        
        if evaluation.is_correct:
            # 成功 → 记录经验
            memory.record(task, result.trace, 
                         outcome=Success(feedback=evaluation.feedback))
            return result
        
        # 失败 → 反思原因
        reflection = agent.reflect(
            task=task,
            attempt=result,
            error=evaluation.error,
            previous_reflections=result.previous_reflections
        )
        
        # 将反思加入记忆，影响下次执行
        agent.add_reflection(reflection)
        memory.record(task, result.trace,
                      outcome=Failure(lesson=reflection))
    
    return result  # 达到最大轮次仍未成功


REFLECTION_PROMPT = """你刚才尝试了以下任务但失败了:

任务: {task}
你的尝试: {attempt}
错误: {error}
之前的反思: {previous_reflections}

请反思:
1. 失败的根本原因是什么？
2. 下次应该怎么做 differently？
3. 有哪些需要注意的陷阱？

输出简洁的反思总结(2-3句话)，下次执行时会参考这些反思。
"""
```

## 层3: Prompt动态优化

```python
class DynamicPromptManager:
    """根据历史表现动态优化Prompt"""
    
    def __init__(self, base_prompt):
        self.base_prompt = base_prompt
        self.optimizations = []  # 积累的优化规则
    
    def get_optimized_prompt(self, task):
        """根据任务和历史经验生成优化后的Prompt"""
        prompt = self.base_prompt
        
        # 加入相关的成功经验
        relevant_successes = memory.retrieve_successes(task)
        if relevant_successes:
            prompt += "\n\n【成功经验参考】:\n"
            for exp in relevant_successes[:2]:
                prompt += f"- {exp['tip']}\n"
        
        # 加入失败教训
        relevant_failures = memory.retrieve_failures(task)
        if relevant_failures:
            prompt += "\n【注意避免】:\n"
            for exp in relevant_failures[:2]:
                prompt += f"- {exp['lesson']}\n"
        
        # 加入反思
        if self.optimizations:
            prompt += "\n【优化规则】:\n"
            for opt in self.optimizations[-5:]:  # 最近5条
                prompt += f"- {opt}\n"
        
        return prompt
    
    def learn_from_execution(self, task, result, evaluation):
        """从每次执行中学习优化规则"""
        if evaluation.is_improvement:
            # 发现了更好的做法
            rule = extract_rule(task, result)
            self.optimizations.append(rule)
```

## 层4: 工具策略进化

```python
class ToolStrategyLearner:
    """学习什么场景用什么工具组合最有效"""
    
    def __init__(self):
        self.tool_performance = {}  # {task_type: {tool_combo: success_rate}}
    
    def record_tool_usage(self, task_type, tools_used, success):
        """记录工具使用效果"""
        combo = tuple(sorted(tools_used))
        if task_type not in self.tool_performance:
            self.tool_performance[task_type] = {}
        if combo not in self.tool_performance[task_type]:
            self.tool_performance[task_type][combo] = []
        self.tool_performance[task_type][combo].append(success)
    
    def recommend_tools(self, task_type):
        """推荐成功率最高的工具组合"""
        if task_type not in self.tool_performance:
            return None  # 没有经验，用默认
        
        stats = self.tool_performance[task_type]
        best_combo = max(stats, key=lambda c: np.mean(stats[c]))
        avg_success = np.mean(stats[best_combo])
        
        if avg_success > 0.7:
            return best_combo  # 有高成功率的组合
        return None  # 经验不足
```

## 自进化效果评估

| 维度 | 指标 | 测量方法 |
|------|------|---------|
| 任务成功率 | 逐轮提升率 | 对比第1轮 vs 第N轮的成功率 |
| 工具效率 | 调用次数减少 | 同类任务平均工具调用次数 |
| 错误重复率 | 同类错误递减 | 相似错误的重复出现率 |
| 响应质量 | 用户满意度 | 人工评分或LLM-as-Judge |

## 自进化 vs 微调

| 维度 | 自进化 | 微调 |
|------|--------|------|
| 改变什么 | 外部记忆+Prompt | 模型权重 |
| 成本 | 低(无需训练) | 高(GPU+数据) |
| 生效速度 | 即时 | 训练完成后 |
| 知识容量 | 受Context限制 | 参数化存储 |
| 适用阶段 | 迭代优化 | 能力跃迁 |
| 可解释性 | 高(可查看记忆) | 低(黑盒) |

**结论**: 先用自进化快速迭代到瓶颈，再考虑微调实现能力跃迁。

## 记忆要点

- 核心手段：无需微调参数，靠经验记忆库（Memory）和自我反思（Reflexion）进化
- 经验沉淀：每次执行的成功或失败轨迹向量化存储，作为下次决策的先验知识
- 反思机制：执行失败后，让LLM分析错误原因并生成反思总结，更新到提示词中
- 双引擎：Prompt动态优化与策略调整结合，让Agent越跑越聪明

