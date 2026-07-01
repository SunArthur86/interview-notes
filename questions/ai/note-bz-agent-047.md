---
id: note-bz-agent-047
difficulty: L3
category: ai
subcategory: RAG
tags:
- B站面经
- RAG优化
- 深度优化
feynman:
  essence: RAG可深挖的点=数据层(分块/清洗/元数据)+检索层(查询改写/多路/重排)+生成层(Prompt/引用)+评估层(指标/闭环)。每个层都有大量优化空间。
  analogy: 像做菜——食材处理(数据)、火候控制(检索)、调味(生成)、品鉴(评估)，每个环节精益求精才能出好菜。
  first_principle: RAG是Pipeline，效果取决于最弱的环节。系统性地逐层优化，而非只调一个参数。
  key_points:
  - 四层深挖：数据/检索/生成/评估
  - 数据层：分块策略/元数据/清洗
  - 检索层：查询改写/混合检索/Rerank
  - 生成层：Prompt/引用/防幻觉
  - 评估层：RAGAS指标/闭环
first_principle:
  essence: RAG优化是系统工程——数据质量是基础，检索精度是核心，生成质量是呈现，评估是驱动。
  derivation: RAG效果=数据质量×检索精度×生成质量。任一环节短板都会拖垮整体。系统性优化=逐层提升每个因子。
  conclusion: RAG深挖 = 四层（数据/检索/生成/评估）系统化优化
follow_up:
- 哪层优化ROI最高？——检索层（投入产出比最高）
- 怎么知道哪里要优化？——评估指标定位瓶颈
- 优化到什么程度够？——满足业务SLA即可，过度优化浪费
memory_points:
- 四层深挖：数据层(基础)、检索层(核心)、生成层(呈现)、评估层(驱动)。
- 数据层提效：采用父子分块(小块检索大块返回)，并丰富文档Metadata以便过滤。
- 检索层提效：用查询改写+HyDE优化查询，并采用向量与BM25的混合检索机制。
---

# RAG 可以从哪些细节深挖？

## 一、四层深挖框架

```
┌──────────────────────────────────────────────────┐
│              RAG 优化四层                            │
├──────────────────────────────────────────────────┤
│                                                    │
│  Layer 1: 数据层（Data）— 基础                     │
│    分块策略 / 数据清洗 / 元数据 / 增量更新          │
│    影响：检索的上限（垃圾进垃圾出）                  │
│                                                    │
│  Layer 2: 检索层（Retrieval）— 核心                 │
│    查询改写 / 多路召回 / 重排序 / 上下文扩展        │
│    影响：能否找到正确的文档                         │
│                                                    │
│  Layer 3: 生成层（Generation）— 呈现                │
│    Prompt设计 / 引用标注 / 防幻觉 / 答案压缩       │
│    影响：答案的质量和可信度                         │
│                                                    │
│  Layer 4: 评估层（Evaluation）— 驱动                │
│    RAGAS指标 / 测试集 / Bad Case / 闭环迭代        │
│    影响：能否持续改进                               │
│                                                    │
└──────────────────────────────────────────────────┘
```

## 二、Layer 1：数据层深挖

### 分块策略

```python
# 不同分块策略对比
strategies = {
    "固定大小": {"size": 500, "简单但可能切断语义"},
    "递归分块": {"按段落→句子→字符递归", "平衡语义和大小"},
    "语义分块": {"用Embedding检测语义边界", "最准但最慢"},
    "文档结构": {"按标题/章节分", "保留文档逻辑"},
}

# 进阶：父子分块
# 检索用小块（精准），返回用大块（上下文全）
class ParentChildChunking:
    def chunk(self, doc):
        parent_chunks = split(doc, size=2000)    # 大块
        for parent in parent_chunks:
            child_chunks = split(parent, size=200)  # 小块
            for child in child_chunks:
                child.metadata["parent"] = parent  # 关联父块
        # 检索小块，返回时取父块（上下文更全）
```

### 元数据丰富

```python
# 给每个文档块打丰富标签，支持过滤检索
metadata = {
    "source": "产品手册.pdf",
    "page": 15,
    "section": "第三章 安装",
    "doc_type": "manual",
    "version": "2.0",
    "language": "zh",
    "created": "2026-01-01",
    "tags": ["安装", "配置"]
}
# 检索时可按metadata过滤：只查最新版本/特定章节
```

## 三、Layer 2：检索层深挖

### 查询改写

```python
class QueryRewriter:
    def rewrite(self, query):
        # 1. 口语→规范
        # "咋装" → "如何安装"
        
        # 2. 扩展同义词
        # "Agent" → "Agent 智能体 autonomous"
        
        # 3. HyDE（假设答案检索）
        hypothetical_answer = llm.generate(f"假设答案: {query}")
        # 用假设答案（而非原问题）去检索
        # 因为答案的语义更接近文档
        
        # 4. 多查询（Multi-Query）
        queries = llm.generate_variants(query, n=3)
        # 生成3个不同角度的查询，分别检索后合并
```

### 混合检索

```python
class HybridRetriever:
    """向量检索 + 关键词检索 融合"""
    
    def retrieve(self, query):
        # 向量检索（语义）
        dense = self.vector_db.search(embed(query), k=10)
        
        # BM25检索（关键词）
        sparse = self.bm25.search(query, k=10)
        
        # 融合（RRF: Reciprocal Rank Fusion）
        fused = rrf_merge(dense, sparse)
        return fused[:10]
    # 向量擅长语义匹配，BM25擅长精确关键词，互补
```

### Rerank（重排序）

```python
# 检索召回多（top-20），Rerank精选（top-5）
class Reranker:
    def rerank(self, query, docs):
        # Cross-Encoder比向量相似度更准（但慢）
        scores = self.cross_encoder.score(
            [(query, doc.content) for doc in docs]
        )
        ranked = sorted(zip(docs, scores), key=lambda x: -x[1])
        return [d for d, s in ranked[:5]]
```

## 四、Layer 3：生成层深挖

### Prompt 工程

```python
GENERATION_PROMPT = """
你是一个严谨的知识助手。基于以下参考文档回答问题。

规则：
1. 只基于参考文档回答，不要使用文档外的知识
2. 如果文档中没有相关信息，明确说"根据现有资料，我无法回答"
3. 在关键信息后标注来源，如[文档1, 第3页]
4. 如果多个文档矛盾，指出矛盾并说明

参考文档:
{documents}

问题: {question}

回答:
"""
```

### 引用与溯源

```python
def generate_with_citation(documents, question):
    # 让LLM输出带引用标注
    prompt = f"""
    参考文档（已编号）:
    [1] {documents[0]}
    [2] {documents[1]}
    
    回答时在信息后标注来源编号，如：Agent是...[1]
    """
    answer = llm(prompt)
    # "Agent的核心是规划能力[1]，常见框架有LangChain[2]"
```

## 五、Layer 4：评估层深挖

### RAGAS 指标

```python
# RAG专用评估框架
metrics = {
    "faithfulness": "答案是否忠于检索文档（防幻觉）",
    "answer_relevancy": "答案是否切题",
    "context_precision": "检索文档中相关的比例",
    "context_recall": "应该检索到的是否都检索到了",
}

# faithfulness最重要：答案不能编造
```

### 闭环迭代

```
评估闭环：
  线上case → 评估打分 → 发现bad case → 分析原因 → 优化 → 回归测试
  
常见bad case原因：
  - 检索没找到：优化分块/查询改写/混合检索
  - 找到了但没用：优化Rerank/Prompt
  - 用了但答错：优化生成Prompt/换更强LLM
```

## 六、优化优先级

```
ROI从高到低：
  1. Rerank（加个重排序，效果立竿见影）
  2. 查询改写（低成本高收益）
  3. 混合检索（向量+BM25）
  4. 分块优化（父子分块）
  5. 数据清洗（去噪/去重）
  6. Prompt优化
  7. 换更强Embedding模型
  8. 元数据过滤

建议：先做1-3（投入小收益大），再按评估结果针对性优化
```

## 七、面试加分点

1. **四层框架**：数据/检索/生成/评估，系统化而非碎片化
2. **强调评估驱动**：没有评估的优化是盲目的——先建评估再优化
3. **给优先级**：Rerank/查询改写/混合检索 ROI 最高，体现实战经验

## 记忆要点

- 四层深挖：数据层(基础)、检索层(核心)、生成层(呈现)、评估层(驱动)。
- 数据层提效：采用父子分块(小块检索大块返回)，并丰富文档Metadata以便过滤。
- 检索层提效：用查询改写+HyDE优化查询，并采用向量与BM25的混合检索机制。

