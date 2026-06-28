---
id: note-bd4-003
difficulty: L3
category: ai
subcategory: Agent
tags:
  - 字节
  - 面经
  - RAG
  - Agentic RAG
feynman:
  essence: "Naive RAG是一次性检索+生成；Agentic RAG让Agent主动决策检索策略，支持多轮检索、查询改写、结果评估和迭代优化"
  analogy: "Naive RAG像去图书馆问前台要一本书；Agentic RAG像一个研究员——先查目录，发现不够再查参考文献，交叉验证，直到满意才写报告"
  first_principle: "检索增强的本质是弥补LLM知识不足，Naive RAG假设一次检索就够了，Agentic RAG承认有些问题需要多步探索"
  key_points:
    - 'Naive RAG: 单次检索→拼接→生成，简单但脆弱'
    - 'Agentic RAG: Agent控制检索循环，支持查询改写/多路检索/结果评估/迭代'
    - '何时需要Agentic RAG: 多跳推理、复杂条件、需要交叉验证的场景'
    - '何时用Naive RAG: 简单FAQ、单文档问答、对延迟敏感的场景'
first_principle:
  essence: "检索是手段而非目的，何时检索、检索什么、检索结果好不好用都需要判断"
  derivation: "LLM的知识有截止日期和覆盖范围限制 → 需要外部知识增强 → 但用户的query可能不精确 → 需要Agent判断和改写查询 → 检索结果可能不相关 → 需要评估和重试"
  conclusion: "Agentic RAG将检索从静态管道变为动态决策过程"
follow_up:
  - "Agentic RAG的延迟怎么控制？"
  - "如何评估Agentic RAG比Naive RAG效果好？"
  - "Self-RAG和Agentic RAG有什么区别？"
---

# Agentic RAG 和普通 Naive RAG 的区别？什么时候需要 Agentic RAG？

## 架构对比

```
┌─────────────── Naive RAG ───────────────┐
│                                         │
│  Query ──► Embed ──► Search ──► LLM     │
│                            │             │
│                        Top-K Docs       │
│                                         │
│  特点：单次检索，不管结果好坏直接生成     │
└─────────────────────────────────────────┘

┌─────────────── Agentic RAG ─────────────┐
│                                         │
│  Query ──► Agent 决策中心               │
│             │                           │
│     ┌───────┼───────┐                   │
│     ▼       ▼       ▼                   │
│  Query    Multi   Rerank                │
│  Rewrite  Query   Eval                  │
│     │       │       │                   │
│     └───────┼───────┘                   │
│             ▼                           │
│         检索结果评估                     │
│      ┌────┴────┐                        │
│    够好      不够好                      │
│      │         │                        │
│   生成回答   改写query重试               │
│                                         │
│  特点：Agent主导，支持多轮检索和迭代     │
└─────────────────────────────────────────┘
```

## 核心区别

| 维度 | Naive RAG | Agentic RAG |
|------|-----------|-------------|
| **检索次数** | 1次 | 多次(按需) |
| **查询处理** | 原始query直接embedding | Query改写、分解、扩展 |
| **结果评估** | 无，直接拼接 | Agent评估相关性，不满意可重检 |
| **路由决策** | 固定向量库 | 可路由到不同知识源/API/工具 |
| **多跳推理** | 不支持 | 支持(Step 1结果指导Step 2检索) |
| **延迟** | 低(1次LLM+1次检索) | 高(多轮交互) |
| **准确率** | 简单问题好，复杂问题差 | 复杂问题显著提升 |
| **成本** | 低 | 高(多次LLM调用) |

## 什么时候需要 Agentic RAG

### ✅ 需要 Agentic RAG 的场景

1. **多跳推理**： "比XX公司市值高的AI公司有哪些？"
   - Step 1：检索XX公司市值 → 500亿
   - Step 2：检索AI公司市值列表 → 筛选>500亿的

2. **复杂条件查询**： "找2024年后发表的、引用次数>100的、关于RAG优化的论文"
   - Agent需要分解条件，可能先检索论文再过滤

3. **需要交叉验证**： 医疗/法律场景，需要多个来源确认

4. **动态知识源**： 先查内部知识库，不够再搜外部

### ❌ Naive RAG 就够的场景

1. **简单FAQ**： "退货政策是什么？"
2. **单文档问答**： "这篇合同的第3条说了什么？"
3. **延迟敏感**： 实时客服、搜索建议(<500ms)

## Agentic RAG 的实现模式

### 模式1：ReAct + RAG

```python
# Agent使用ReAct范式，将检索作为工具
tools = [
    Tool(name="vector_search", func=vector_db.search,
         description="搜索内部知识库"),
    Tool(name="web_search", func=web_search,
         description="搜索互联网"),
    Tool(name="sql_query", func=sql_db.execute,
         description="查询结构化数据"),
]

agent = ReActAgent(llm=llm, tools=tools)
# Agent会自己决定：何时搜索、搜什么、要不要再搜一次
```

### 模式2：CRAG (Corrective RAG)

```
Query → 检索 → 评估检索质量
                   │
          ┌────────┼────────┐
          ▼        ▼        ▼
        Correct  Ambiguous Wrong
          │        │        │
       直接生成  Web搜索   改写query
                          重新检索
```

### 模式3：Self-RAG (自反思RAG)

```
LLM在生成过程中自问：
- "需要检索吗？" → 需要 → 检索
- "检索结果相关吗？" → 不相关 → 重检
- "生成的内容有依据吗？" → 无依据 → 修正
```

## 生产级落地建议

- **模型路由**：简单query走Naive RAG(小模型)，复杂query走Agentic RAG(大模型)
- **缓存**：Semantic Cache缓存相似query的结果，避免重复检索
- **最大检索轮数**：限制3-5轮，防止Agent无限循环
- **超时控制**：总延迟控制在5s以内，超过则降级为Naive RAG结果
