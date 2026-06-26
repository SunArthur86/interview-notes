---
id: note-bz-agent-011
difficulty: L3
category: ai
subcategory: Agent
tags:
  - B站面经
  - Self-Ask
  - 认知框架
  - Agent
feynman:
  essence: Self-Ask=自问自答。遇到复杂问题，先把它拆成一串子问题，逐个检索答案后再组合。本质是"问题分解+链式检索"。
  analogy: 像侦探破案——把"谁干的"拆成"动机是什么""机会有没有""证据指向谁"，逐个查证最后拼出结论。
  first_principle: 复杂问题无法直接检索答案，但拆成的子问题往往可以。Self-Ask用LLM自动分解+逐个检索+组合。
  key_points:
    - 核心：Follow-up子问题分解 + 链式检索
    - 每个子问题独立检索，答案喂给下一个
    - 比直接检索更适合多跳事实问答
    - 是ReAct的简化版（固定流程，只做检索）
first_principle:
  essence: 多跳问题的信息分布在多份文档，单次检索无法覆盖。
  derivation: '问题"X的妻子是哪国人"包含两个事实：X的妻子是谁 + 她是哪国人。Self-Ask先问"X的妻子是谁"，检索得答案Y，再问"Y是哪国人"，逐步逼近。'
  conclusion: Self-Ask = 问题分解 + 链式检索，专攻多跳事实问答
follow_up:
  - Self-Ask和ReAct什么区别？——Self-Ask固定检索流程，ReAct动态决策
  - 子问题分解错了怎么办？——Self-Ask较脆弱，可结合反思机制
  - 适合什么场景？——多跳事实问答（HotpotQA类）
---

# Self-Ask 框架是什么？

## 一、Self-Ask 核心思想

**Self-Ask** = 让 LLM **自问自答**，把复杂问题分解为一串子问题，逐个检索后组合答案。

```
用户问题: "马斯克创立的太空公司的火箭首次回收成功是在哪一年？"

Self-Ask 过程:
  Q: 马斯克创立的太空公司是？
    → 检索 → A: SpaceX
  
  Q: SpaceX的火箭首次回收成功是哪一次？
    → 检索 → A: 猎鹰9号，2015年12月
  
  最终答案: 2015年
```

## 二、Self-Ask 的 Prompt 模板

```python
SELF_ASK_PROMPT = """
回答问题时，如果需要，先分解成子问题逐个查找：

Question: {用户问题}

Follow up questions:
  Q: {子问题1}
  A: {检索得到的答案1}

  Q: {基于上一答案的子问题2}
  A: {检索得到的答案2}

  ...

So the final answer is: {综合所有子答案}

规则：
- 如果问题简单可直接回答，不必分解
- 子问题要能通过检索得到事实答案
- 后续子问题可依赖前面子问题的答案
"""
```

## 三、Self-Ask 执行流程

```
┌──────────────────────────────────────────────┐
│ 1. LLM判断：问题是否需要分解？                   │
│    - 简单 → 直接回答                            │
│    - 复杂 → 进入分解流程                        │
├──────────────────────────────────────────────┤
│ 2. 生成分问题（Follow-up）                      │
│    LLM: "为了回答X，我需要先知道Y"               │
├──────────────────────────────────────────────┤
│ 3. 检索子问题答案                                │
│    搜索(Y) → 得到答案A1                         │
├──────────────────────────────────────────────┤
│ 4. 基于A1生成下一个子问题                        │
│    LLM: "现在知道Y=A1，还需知道Z"               │
├──────────────────────────────────────────────┤
│ 5. 重复2-4，直到信息充分                         │
├──────────────────────────────────────────────┤
│ 6. 综合所有子答案，输出最终答案                   │
└──────────────────────────────────────────────┘
```

## 四、代码实现

```python
class SelfAskAgent:
    def __init__(self, llm, retriever):
        self.llm = llm
        self.retriever = retriever
    
    def run(self, question):
        qa_pairs = []
        current_q = question
        
        for _ in range(MAX_SUBQUESTIONS):
            # LLM决定是否需要追问 + 生成子问题
            sub_q = self.llm.generate_subquestion(
                original=question,
                history=qa_pairs
            )
            
            if sub_q == "NO_MORE":  # 信息充分
                break
            
            # 检索子问题
            docs = self.retriever.search(sub_q)
            sub_a = self.llm.extract_answer(sub_q, docs)
            
            qa_pairs.append((sub_q, sub_a))
        
        # 综合答案
        return self.llm.synthesize(question, qa_pairs)
```

## 五、Self-Ask vs ReAct vs Plan-Execute

| 框架 | 决策方式 | 检索 | 适用 |
|------|---------|------|------|
| **Self-Ask** | 固定流程（自问自答） | 每子问题检索 | 多跳事实问答 |
| **ReAct** | 动态（Thought+Act） | 灵活决策检索 | 通用Agent任务 |
| **Plan-Execute** | 全局规划 | 执行时检索 | 复杂多步任务 |

```
Self-Ask 特点：
  + 流程固定，简单可靠
  + 专攻多跳检索
  - 不够灵活（不能动态换策略）
  - 只做检索，不做其他工具

ReAct 特点：
  + 灵活，支持任意工具
  + 动态决策
  - Token消耗大
  - 可能方向跑偏
```

## 六、典型适用场景：多跳问答

```
适合Self-Ask的问题特征：
  - 答案需要串联多个事实
  - 每个事实可独立检索
  - 子问题间有依赖关系

例子（HotpotQA风格）：
  Q: 《盗梦空间》的导演的其他科幻电影获过什么奖？
  
  分解:
    Q1: 《盗梦空间》的导演是谁？ → 诺兰
    Q2: 诺兰的其他科幻电影有哪些？ → 《星际穿越》《信条》
    Q3: 《星际穿越》获过什么奖？ → 奥斯卡最佳视觉效果
  
  答案: 奥斯卡最佳视觉效果奖
```

## 七、面试加分点

1. **定位清晰**：Self-Ask 是 ReAct 的简化版，专攻多跳检索问答，流程固定更可靠
2. **强调"链式"**：子问题答案会喂给下一个子问题，形成信息链
3. **知道局限**：不如 ReAct 灵活，分解质量依赖 LLM，分解错就全错
