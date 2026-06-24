---
id: note-bd-agent-001
difficulty: L3
category: ai
subcategory: Agent
tags:
  - 字节
  - 面经
  - Agent
  - 工作流
  - LangGraph
feynman:
  essence: 把大任务拆成小节点，用状态图编排，靠记忆和审稿修复提升准确率
  analogy: '就像编辑部流水线——策划(Planner)选题、资料员(RAG)找素材、写手(Writer)初稿、主编(Reviewer)审稿、修稿员(Repair)改稿、最后存档(Save)'
  first_principle: 单次LLM生成的错误率随任务复杂度指数上升，拆解+多轮校验可将指数级错误率降为各节点错误率的加权和
  key_points:
    - Planner负责任务拆分和计划生成
    - RAG节点负责知识检索和上下文构建
    - Writer基于计划+上下文生成内容
    - Reviewer做质量检查和冲突检测
    - Repair节点负责修复问题
    - 短期记忆存最近上下文，长期记忆存角色设定和世界观
first_principle:
  essence: LLM单次生成在复杂任务上错误率过高，需要工程化手段降低
  derivation: '假设单轮生成准确率80%，三步串行准确率=0.8³=51%。拆解后每步独立校验+修复，假设每步提升到95%，整体=0.95³=85.7%'
  conclusion: 工作流编排+多轮校验是Agent工程化的核心范式，而非单次Prompt调优
follow_up:
  - 'Reviewer的评判标准是什么？如何自动化检测冲突？'
  - '长期记忆存储方案选型（向量库 vs 图数据库）？'
  - '如何平衡生成质量和延迟成本？'
---

# 如何搭建Agent工作流并提升生成准确性？

## 工作流架构设计

```
用户输入
  │
  ▼
┌──────────┐    ┌──────────┐    ┌──────────┐
│ Planner  │───→│   RAG    │───→│  Writer  │
│ 任务拆分  │    │ 知识检索  │    │ 内容生成  │
└──────────┘    └──────────┘    └────┬─────┘
                                     │
                                     ▼
┌──────────┐    ┌──────────┐    ┌──────────┐
│  Save    │←───│  Repair  │←───│ Reviewer │
│ 结果存储  │    │ 修复生成  │    │ 质量检查  │
└──────────┘    └──────────┘    └──────────┘
```

## 核心节点说明

### 1. Planner（规划节点）
- 接收用户意图，将长文创作拆分为章节大纲
- 维护全局计划状态（已完成/待完成/冲突项）
- 输出结构化计划：章节列表 + 每章主题 + 预期字数

### 2. RAG（检索增强节点）
- **短期记忆**：最近N章的摘要，解决上下文窗口限制
- **长期记忆**：角色卡、世界观设定、已建立的关系网络
- 检索策略：Embedding相似度 + 关键词混合检索

### 3. Writer（生成节点）
- 输入 = 计划 + 检索上下文 + 前文摘要
- 使用结构化Prompt：角色设定 + 章节计划 + 风格要求
- 生成时注入长期记忆中的角色特征，保持人设一致

### 4. Reviewer（审稿节点）
- 检查维度：情节连贯性、角色一致性、逻辑冲突、风格匹配
- 输出结构化结果：`{pass: boolean, issues: [...], suggestions: [...]}`

### 5. Repair（修复节点）
- 根据Reviewer的issues定向修复
- 只修改有问题的段落，不重新生成全文
- 修复后重新进入Reviewer检查（最多3轮）

## 提升准确性的关键策略

| 策略 | 做法 | 效果 |
|------|------|------|
| **分层记忆** | 短期(最近章节) + 长期(角色设定/世界观) | 解决长篇设定遗忘 |
| **审稿修复循环** | Reviewer发现问题→Repair修复→Reviewer再验 | 将单轮85%提升至95%+ |
| **RAG上下文注入** | 检索历史章节+角色卡拼入Prompt | 保证人设和剧情连续性 |
| **结构化输出** | 每个节点输出JSON schema | 降低解析错误率 |
| **失败重试机制** | 节点失败后最多重试3次，超出则降级 | 提高整体可用性 |

## LangGraph状态编排实现

```python
from langgraph.graph import StateGraph, END
from typing import TypedDict, List

class AgentState(TypedDict):
    user_input: str
    plan: dict
    context: str
    draft: str
    review_result: dict
    repair_count: int
    final_output: str

def should_repair(state: AgentState) -> str:
    """条件路由：审稿通过则保存，否则修复"""
    if state["review_result"]["pass"]:
        return "save"
    if state["repair_count"] >= 3:
        return "save"  # 超过3轮强制保存
    return "repair"

# 构建状态图
workflow = StateGraph(AgentState)
workflow.add_node("planner", plan_node)
workflow.add_node("rag", rag_node)
workflow.add_node("writer", write_node)
workflow.add_node("reviewer", review_node)
workflow.add_node("repair", repair_node)
workflow.add_node("save", save_node)

workflow.set_entry_point("planner")
workflow.add_edge("planner", "rag")
workflow.add_edge("rag", "writer")
workflow.add_edge("writer", "reviewer")
workflow.add_conditional_edges("reviewer", should_repair)
workflow.add_edge("repair", "reviewer")  # 修复后重新审稿
workflow.add_edge("save", END)

app = workflow.compile()
```

## 实际效果

- **单轮生成**：剧情连贯性~70%，角色一致性~65%
- **工作流+审稿修复**：剧情连贯性~92%，角色一致性~90%
- 核心提升来自Reviewer+Repair循环，而非单纯加大模型参数

## 面试加分点

1. **强调工程思维**：不是靠Prompt Engineering硬调，而是用工作流拆解降低单步错误率
2. **量化指标**：能说出具体准确率提升数字
3. **失败处理**：提及repair_count上限、降级策略，体现生产环境思维
4. **成本意识**：Repair只改有问题的段落而非全文重写，节省Token
