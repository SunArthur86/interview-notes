---
id: note-bz-agent-056
difficulty: L4
category: ai
subcategory: RAG
tags:
- B站面经
- Agentic RAG
- GraphRAG
- RAG对比
feynman:
  essence: Agentic RAG=把检索变成Agent的工具，动态决策检索策略。区别于Naive RAG的固定流程，Agentic RAG让LLM自主决定何时查、查什么、查几次。
  analogy: Naive RAG像自动售货机(投币出货固定流程)，Agentic RAG像导购(听需求→找商品→不够再找→推荐)。
  first_principle: 复杂问题的信息需求是动态的，固定流程的Naive RAG无法适应。Agent能根据上下文动态调整检索策略。
  key_points:
  - Agentic RAG是检索作为Agent工具，动态决策
  - Naive RAG是固定流程，一次性检索
  - 区别：智能程度（动态vs固定）
  - 优势：多跳问答/复杂推理/自我纠错
first_principle:
  essence: 检索策略应该匹配问题的复杂度——简单问题一次检索够，复杂问题需多次探索。
  derivation: Naive RAG假设一次检索就能找到答案。复杂问题（多跳/需要推理）的信息需求是动态的——查到A后才知道要查B。Agent能在推理过程中按需检索，适应这种动态性。
  conclusion: Agentic RAG = 检索作为Agent工具 + 动态检索策略决策
follow_up:
- Agentic RAG什么时候比Naive好？——多跳问答/复杂分析
- 会不会太慢？——会，简单问题用Naive，复杂才用Agentic
- 怎么实现？——ReAct框架+retrieve工具
memory_points:
- 核心区别：Naive RAG是固定单次检索，Agentic RAG是Agent动态按需多次检索。
- Agent四能力：决定是否查、改写拆解问、评估检索结果、多源路由（KG/SQL/Web）。
- 特性对比：Agent具备自我纠错和多跳推理能力，但相比传统RAG速度慢且成本高。
- 实现范式：ReAct模式加工具调用，思考-行动-观察多轮循环。
---

# 什么是 Agentic RAG？和传统 RAG 的区别？

## 一、Naive RAG vs Agentic RAG

```
Naive RAG（传统/固定流程）：
  用户问题 → 向量化 → 检索top-k → 塞入Prompt → LLM生成
  特点：固定流程，一次性检索，无决策
  
  局限：
  - 复杂问题一次检索找不到
  - 不能根据中间结果调整检索
  - 无法多跳推理

Agentic RAG（智能/动态）：
  用户问题 → Agent思考
    → 需要查吗？查什么？
    → 检索 → 观察结果
    → 够吗？不够换关键词再查
    → 够了 → 综合生成答案
  
  特点：动态决策，多次检索，自我纠错
```

## 二、核心区别对比

| 维度 | Naive RAG | Agentic RAG |
|------|-----------|-------------|
| **检索策略** | 固定（一次top-k） | 动态（按需多次） |
| **查询构造** | 原始问题 | Agent改写/分解 |
| **决策能力** | 无 | 自主决策 |
| **自我纠错** | 无 | 检索不足时重查 |
| **多跳推理** | 不支持 | 支持 |
| **速度** | 快 | 慢（多轮） |
| **成本** | 低 | 高（多轮Token） |
| **适用** | 简单QA | 复杂分析 |

## 三、Agentic RAG 的核心能力

```
┌──────────────────────────────────────────────────┐
│            Agentic RAG 的智能能力                    │
├──────────────────────────────────────────────────┤
│                                                    │
│  1. 检索决策（要不要查）                             │
│     简单问题（LLM已知）→ 不检索，直接答              │
│     需要外部信息 → 触发检索                          │
│                                                    │
│  2. 查询优化（怎么查）                               │
│     改写查询 / 分解子问题 / 多角度查询               │
│                                                    │
│  3. 结果评估（查到的好不好）                         │
│     相关 → 使用                                     │
│     不相关 → 换关键词重查                            │
│     不够 → 补充检索                                  │
│                                                    │
│  4. 多源路由（查哪里）                               │
│     向量库 / 知识图谱 / SQL / Web搜索               │
│     Agent根据问题类型选择最佳数据源                  │
│                                                    │
│  5. 迭代深化（查几次）                               │
│     基于已有信息，继续深挖                           │
│                                                    │
└──────────────────────────────────────────────────┘
```

## 四、实现：ReAct + 检索工具

```python
class AgenticRAG:
    def __init__(self, llm, vector_db, knowledge_graph, sql_db):
        self.llm = llm
        # 多种检索源作为工具
        self.tools = {
            "vector_search": lambda q: vector_db.search(q),
            "graph_search": lambda q: knowledge_graph.query(q),
            "sql_query": lambda q: sql_db.execute(q),
            "web_search": lambda q: web_search(q),
        }
    
    def answer(self, question):
        trajectory = []
        
        for step in range(MAX_STEPS):
            # Agent思考：下一步该做什么
            thought = self.llm.reason(
                f"问题: {question}\n已有信息: {trajectory}\n"
                f"决定：直接回答 / 用什么工具查什么"
            )
            
            if thought.action == "answer":
                return self.llm.generate(question, trajectory)
            
            # 执行检索（Agent选的工具和查询）
            tool = self.tools[thought.tool_name]
            result = tool(thought.query)
            
            # Agent评估结果
            evaluation = self.llm.evaluate(
                f"检索结果: {result}\n对回答问题有帮助吗？够了吗？"
            )
            
            trajectory.append({
                "thought": thought,
                "tool": thought.tool_name,
                "query": thought.query,
                "result": result,
                "useful": evaluation.useful
            })
            
            if evaluation.sufficient:
                return self.llm.generate(question, trajectory)
```

## 五、多跳问答示例

```
问题: "获得2024年图灵奖的学者的主要研究方向是什么？"

Naive RAG（一次检索，失败）：
  检索"2024图灵奖研究方向" → 可能找不到完整答案

Agentic RAG（多跳，成功）：
  Step 1: 检索"2024年图灵奖获得者"
          → 结果: Andrew Barto和Richard Sutton（强化学习）
  
  Step 2: Agent推理"需要查他们的研究方向"
          检索"Richard Sutton 研究方向"  
          → 结果: 强化学习，著有《强化学习导论》
  
  Step 3: Agent判断"信息够了"
          生成: "2024图灵奖得主Sutton和Barto，主要研究方向是强化学习..."
```

## 六、何时用 Agentic RAG

```
适合 Agentic RAG：
  ✓ 多跳问答（需多次检索串联）
  ✓ 复杂分析（需多方信息综合）
  ✓ 需要最新信息（Web搜索+知识库）
  ✓ 需要自我纠错（检索质量不确定）

适合 Naive RAG：
  ✓ 简单事实问答（一次检索够）
  ✓ 实时性要求高（Agentic太慢）
  ✓ 成本敏感（Agentic Token多）
  ✓ 数据简单（单一知识库）

实践建议：
  - 默认用Naive RAG（快/省）
  - 只在Naive效果差时升级Agentic
  - 或混合：简单走Naive，复杂走Agentic（路由）
```

## 七、Agentic RAG 的演进

```
Naive RAG 
  → Advanced RAG (加优化：改写/重排/混合)
  → Modular RAG (模块化，可插拔组件)
  → Agentic RAG (Agent自主决策)
  → Self-RAG (训练模型自带检索门控)
  → GraphRAG (知识图谱增强)
```

## 八、面试加分点

1. **核心是"动态决策"**：Agentic RAG 不是固定流程，而是 Agent 根据需要动态检索
2. **多跳问答最能体现价值**：这是 Naive RAG 做不到的，用例子说明
3. **承认成本**：Agentic 更慢更贵，简单任务不该用——体现实用主义

## 记忆要点

- 核心区别：Naive RAG是固定单次检索，Agentic RAG是Agent动态按需多次检索。
- Agent四能力：决定是否查、改写拆解问、评估检索结果、多源路由（KG/SQL/Web）。
- 特性对比：Agent具备自我纠错和多跳推理能力，但相比传统RAG速度慢且成本高。
- 实现范式：ReAct模式加工具调用，思考-行动-观察多轮循环。

