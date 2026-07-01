---
id: note-bz-agent-062
difficulty: L3
category: ai
subcategory: RAG
tags:
- B站面经
- LlamaIndex
- 框架
- RAG
feynman:
  essence: LlamaIndex是专注RAG的框架，在"数据接入/索引构建/检索优化"上比LangChain更深。如果说LangChain是"瑞士军刀"，LlamaIndex是"RAG专用手术刀"。
  analogy: LangChain像多功能瑞士军刀(啥都能干)，LlamaIndex像专业手术刀(RAG这件事做得最精)。
  first_principle: LangChain追求通用(Agent/对话/RAG都做)，LlamaIndex专注RAG(数据索引/检索/查询引擎做到极致)。
  key_points:
  - 定位：专注数据框架/RAG
  - 核心：数据连接/索引/查询引擎
  - 优势：RAG相关功能更深更全
  - 选型：重RAG用LlamaIndex，重Agent用LangChain
first_principle:
  essence: 工具的专注度决定深度——LlamaIndex只做数据/RAG所以做得深。
  derivation: LangChain要覆盖Agent/对话/RAG/工具，每项都不够深。LlamaIndex专注数据接入和检索，在这条线上做得更深（更多数据连接器/更灵活的索引/更专业的检索器）。
  conclusion: LlamaIndex = RAG专精框架（数据接入/索引/检索最深）
follow_up:
- LlamaIndex能做Agent吗？——能，但不如LangChain/LangGraph
- 两个能混用吗？——能，各取所长
- 哪个更流行？——LangChain社区更大，LlamaIndex在RAG圈更专业
memory_points:
- 核心定位：专注“数据连接”的RAG专精框架（LangChain偏通用综合）
- 三层核心架构：数据层(200+数据连接器) → 索引层(多结构索引) → 查询层(检索合成)
- 五大索引结构：向量、摘要、知识图谱(多跳)、树状、关键词，满足不同检索推理需求
---

# LlamaIndex 在 RAG 系统中的架构？

## 一、LlamaIndex 定位

```
LlamaIndex = 专注"数据"的LLM框架

核心理念：连接你的数据与LLM
  你的数据(PDF/DB/API/网页) → LlamaIndex → LLM

vs LangChain:
  LangChain: 通用LLM应用框架（Agent/对话/RAG/工具都做）
  LlamaIndex: 数据/RAG专精（索引/检索/查询做到极致）
```

## 二、核心架构

```
┌──────────────────────────────────────────────────┐
│              LlamaIndex 架构                         │
├──────────────────────────────────────────────────┤
│                                                    │
│  数据层（Data Connections）                         │
│    ┌──────────────────────────────────────┐       │
│    │ Readers/Loaders: LlamaHub 200+数据源  │       │
│    │ (PDF/Notion/Slack/GitHub/SQL/Salesforce)│    │
│    └──────────────────────────────────────┘       │
│    Documents → Nodes(分块) → Indexing              │
│                                                    │
│  索引层（Indices）                                  │
│    ┌──────────────────────────────────────┐       │
│    │ VectorStoreIndex  (向量索引)           │       │
│    │ SummaryIndex      (摘要索引)           │       │
│    │ KnowledgeGraphIndex(知识图谱索引)      │       │
│    │ TreeIndex         (树状索引)           │       │
│    │ KeywordTableIndex(关键词索引)          │       │
│    └──────────────────────────────────────┘       │
│                                                    │
│  查询层（Query Engine）                             │
│    ┌──────────────────────────────────────┐       │
│    │ Retriever: 检索器（多种策略）          │       │
│    │ Response Synthesizer: 答案合成        │       │
│    │ Postprocessor: 后处理（重排/过滤）     │       │
│    └──────────────────────────────────────┘       │
│                                                    │
│  Agent层                                           │
│    ┌──────────────────────────────────────┐       │
│    │ Agent: 把查询引擎作为工具              │       │
│    │ Router: 路由到不同索引/引擎            │       │
│    └──────────────────────────────────────┘       │
│                                                    │
└──────────────────────────────────────────────────┘
```

## 三、LlamaIndex 的 RAG 优势

### 1. 丰富的数据连接器

```python
from llama_hub import (
    PDFReader, NotionPageReader, GitHubRepoReader,
    SlackReader, SalesforceReader, DatabaseReader
)

# LlamaHub有200+数据源连接器
# 几乎所有常见数据源都有现成的Reader
docs = NotionPageReader(integration_token="...").load_data(page_ids=[...])
```

### 2. 多种索引类型

```python
from llama_index import (
    VectorStoreIndex,     # 向量索引（最常用）
    SummaryIndex,         # 遍历所有节点（适合全量问答）
    KnowledgeGraphIndex,  # 知识图谱（多跳推理）
    TreeIndex,            # 树状索引（长文档摘要）
)

# 不同索引适合不同场景
# 可以组合使用
```

### 3. 灵活的检索器

```python
from llama_index import (
    VectorIndexRetriever,      # 向量检索
    BM25Retriever,             # 关键词检索
    QueryFusionRetriever,      # 多查询融合
)

# 混合检索（LlamaIndex原生支持）
hybrid_retriever = QueryFusionRetriever(
    retrievers=[vector_retriever, bm25_retriever],
    similarity_top_k=5,
    mode="reciprocal_rerank"  # RRF融合
)
```

### 4. 高级查询引擎

```python
from llama_index import (
    RetrieverQueryEngine,
    SubQuestionQueryEngine,  # 子问题分解
    RouterQueryEngine,       # 路由到不同引擎
    FLAREQueryEngine,        # 前瞻+回顾的迭代检索
)

# SubQuestionQueryEngine: 复杂问题分解
engine = SubQuestionQueryEngine.from_defaults(query_engine_tools=[
    Tool(engine=sales_engine, name="销售数据"),
    Tool(engine=hr_engine, name="人事数据"),
])
# "对比销售和人事的离职率" → 分解为两个子问题分别查
```

## 四、LlamaIndex vs LangChain（RAG 场景）

| 维度 | LangChain | LlamaIndex |
|------|-----------|------------|
| **数据连接器** | 多但分散 | LlamaHub更全更专业 |
| **索引类型** | 主要是向量 | 向量/摘要/图/树多种 |
| **检索器** | 基础 | 更丰富(融合/子问题/路由) |
| **RAG深度** | 中 | 深（专精） |
| **Agent能力** | 强 | 中 |
| **生态** | 大 | RAG圈更专业 |

```
选型建议：
  重RAG（知识库/文档问答）→ LlamaIndex
  重Agent（工具调用/多步推理）→ LangChain/LangGraph
  两者结合：LlamaIndex做检索，LangChain做编排
```

## 五、面试加分点

1. **定位区别**：LangChain 通用，LlamaIndex 专注 RAG——各有所长
2. **索引多样性**：LlamaIndex 不只是向量索引，还有图/树/摘要——这是深度优势
3. **数据连接器**：LlamaHub 200+数据源，企业数据接入更方便

## 记忆要点

- 核心定位：专注“数据连接”的RAG专精框架（LangChain偏通用综合）
- 三层核心架构：数据层(200+数据连接器) → 索引层(多结构索引) → 查询层(检索合成)
- 五大索引结构：向量、摘要、知识图谱(多跳)、树状、关键词，满足不同检索推理需求

