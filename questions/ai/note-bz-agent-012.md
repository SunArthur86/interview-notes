---
id: note-bz-agent-012
difficulty: L3
category: ai
subcategory: Agent
tags:
- B站面经
- Reflexion
- 自我反思
- 认知框架
- Agent
feynman:
  essence: Reflexion=失败后反思总结，把经验存入记忆，下次避免重蹈覆辙。本质是给Agent装了"错题本"，让它从错误中学习。
  analogy: 像做题——做错了不只看答案，还写"我为什么错/下次怎么避免"，下次遇到类似题不再犯。
  first_principle: 普通Agent失败后重新尝试但不会总结，可能反复犯同样错。Reflexion增加反思环节，把失败原因抽象成可复用的经验，提升后续成功率。
  key_points:
  - 三步循环：Act→Evaluate→Reflect
  - 反思存入记忆，指导下次尝试
  - 在复杂推理/代码任务上显著提升成功率
  - 本质是Agent层面的"经验学习"
first_principle:
  essence: 智能的本质之一是从失败中学习。Agent缺乏这个能力会导致重复犯错。
  derivation: LLM是stateless的，每次调用独立。普通Agent每次尝试都"从零开始"。Reflexion通过外部记忆（反思文本）把失败经验显式化，让下一次尝试能看到"上次为什么失败"，相当于给Agent加了一个会积累的经验库。
  conclusion: Reflexion = 试错 + 反思 + 经验记忆，让Agent具备"吃一堑长一智"的能力
follow_up:
- 反思会不会反思错？——会，可用环境反馈（ground truth）校准
- 反思多少轮合适？——通常3-5轮，过多会陷入循环
- 和RL什么关系？——Reflexion是用自然语言做"策略更新"，RL是用梯度
memory_points:
- 核心机制：Act(行动) -> Eval(评估) -> Reflect(反思)，失败后总结经验重试
- 对比普通Agent：普通Agent失败盲目重试，Reflexion会将反思存入记忆指导下轮
- 适用场景：有明确成败反馈且可验证的任务，如代码生成和Bug修复
---

# Thinking and Self-Reflection（思考与自我反思）框架？

## 一、Reflexion 核心思想

**Reflexion** = **Refl**ection + **Act**ion，让 Agent 在失败后**自我反思**，总结经验教训，存入记忆，指导下一次尝试。

```
普通Agent（失败后盲目重试）：
  尝试1（失败）→ 尝试2（同样错）→ 尝试3（同样错）...

Reflexion Agent（失败后反思）：
  尝试1（失败）
    → Reflect: "我错在没考虑边界条件"
    → 存入记忆
  
  尝试2（基于反思）
    → 记忆提醒："注意边界条件"
    → 这次考虑了边界 → 成功！
```

## 二、Reflexion 三步循环

```
┌──────────────────────────────────────────────┐
│              Reflexion 循环                     │
│                                                │
│   ┌─────────┐                                 │
│   │  Actor   │ ← 执行任务（基于当前反思记忆）     │
│   │ (执行器)  │    生成行动/答案                  │
│   └────┬────┘                                 │
│        │ 输出结果                                │
│        ▼                                       │
│   ┌─────────┐                                 │
│   │ Evaluator│ ← 评估结果（自评/环境反馈）        │
│   │ (评估器)  │    判断成功/失败/原因             │
│   └────┬────┘                                 │
│        │ 如果失败                                │
│        ▼                                       │
│   ┌─────────┐                                 │
│   │Self-Reflec│ ← 反思失败原因                   │
│   │ (反思器)   │    生成经验教训                  │
│   └────┬────┘                                 │
│        │ 经验存入记忆                            │
│        ▼                                       │
│   更新反思记忆 → 回到Actor重新尝试              │
└──────────────────────────────────────────────┘
```

## 三、三个核心组件

### 1. Actor（执行器）— 实际干活

```python
class Actor:
    def act(self, task, reflections):
        """基于反思记忆执行任务"""
        prompt = f"""
        任务: {task}
        
        过往反思（避免重蹈覆辙）:
        {reflections}
        
        请完成任务。
        """
        return self.llm.act(prompt)
```

### 2. Evaluator（评估器）— 判断对错

```python
class Evaluator:
    def evaluate(self, task, output):
        """评估输出质量"""
        # 类型1：有标准答案（如代码题）
        if has_ground_truth(task):
            return {"success": output == answer, "reason": "答案不匹配"}
        
        # 类型2：环境反馈（如工具执行结果）
        if is_executable(task):
            result = execute(output)
            return {"success": result.passed, "reason": result.error}
        
        # 类型3：LLM自评（无标准答案）
        return self.llm.evaluate(task, output)
```

### 3. Self-Reflection（反思器）— 总结经验

```python
class Reflector:
    def reflect(self, task, attempt, feedback):
        """生成反思文本"""
        prompt = f"""
        任务: {task}
        你的尝试: {attempt}
        失败反馈: {feedback}
        
        请反思：
        1. 具体哪里做错了？
        2. 为什么会错？
        3. 下次应该如何避免？
        
        用简洁的经验总结表述（1-3句话）。
        """
        reflection = self.llm.reflect(prompt)
        return reflection
```

## 四、完整 Reflexion 流程

```python
class ReflexionAgent:
    def __init__(self):
        self.actor = Actor()
        self.evaluator = Evaluator()
        self.reflector = Reflector()
        self.reflections = []  # 反思记忆
    
    def run(self, task, max_trials=4):
        for trial in range(max_trials):
            # 1. 执行（带上历史反思）
            output = self.actor.act(task, self.reflections)
            
            # 2. 评估
            eval_result = self.evaluator.evaluate(task, output)
            
            if eval_result.success:
                return output  # 成功
            
            # 3. 反思失败
            reflection = self.reflector.reflect(
                task, output, eval_result.reason
            )
            self.reflections.append(reflection)
            # 例: "上次没处理空列表导致IndexError，
            #      这次要先判空"
        
        return output  # 达到最大次数返回最后结果
```

## 五、反思记忆示例

```
任务: 写一个二分查找函数

Trial 1:
  输出: def bin_search...（漏了边界处理）
  反馈: 测试失败，target在数组首位时返回-1
  反思: "二分查找的边界条件容易出错，
        左右指针更新要用mid±1，不能直接用mid"

Trial 2:
  输出: 修正了边界，但循环条件写错（用<而不是<=）
  反馈: 当数组只有1个元素时找不到
  反思: "循环条件应该是while left<=right，
        这样才能覆盖到left==right的情况（单元素）"

Trial 3:
  基于两条反思 → 正确实现 → 成功
```

## 六、Reflexion 的效果与代价

```
效果（论文数据）：
  - 编程任务(HumanEval): 80% → 91%（+11%）
  - 决策任务(AlfWorld): 75% → 91%（+16%）
  - 推理任务(HotpotQA): 35% → 50%（+15%）

代价：
  - 多轮尝试 = 更多Token消耗（3-5倍）
  - 延迟增加（串行多轮）
  - 依赖评估器质量（评估错则反思也错）

适用场景：
  ✓ 有明确成功/失败信号的任务（代码/数学/游戏）
  ✓ 错误可诊断的任务
  ✗ 主观任务（开放问答，难评估）
  ✗ 实时性要求高的场景（多轮太慢）
```

## 七、Reflexion vs 普通重试

| 维度 | 普通重试 | Reflexion |
|------|---------|-----------|
| **失败后** | 直接重试 | 先反思再重试 |
| **记忆** | 无 | 积累经验 |
| **学习** | 不会 | 会（避免重复错） |
| **效果** | 持平或微升 | 显著提升 |
| **成本** | 低 | 高（多轮） |

## 八、面试加分点

1. **类比"错题本"**：Reflexion 就是给 Agent 装了个错题本，把失败经验显式化积累
2. **强调"经验记忆"**：关键是反思结果存入记忆，跨尝试复用，这是普通重试做不到的
3. **知道适用边界**：适合有明确反馈的任务（代码/数学），不适合主观任务——评估器是瓶颈

## 记忆要点

- 核心机制：Act(行动) -> Eval(评估) -> Reflect(反思)，失败后总结经验重试
- 对比普通Agent：普通Agent失败盲目重试，Reflexion会将反思存入记忆指导下轮
- 适用场景：有明确成败反馈且可验证的任务，如代码生成和Bug修复

