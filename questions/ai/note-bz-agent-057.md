---
id: note-bz-agent-057
difficulty: L4
category: ai
subcategory: RAG
tags:
- B站面经
- GraphRAG
- 知识图谱
feynman:
  essence: GraphRAG=用知识图谱做检索。实体为节点、关系为边，通过图遍历做多跳推理。适合"关系密集型"和"全局摘要"场景，向量RAG做不好的地方。
  analogy: 向量RAG像查字典(找相似词)，GraphRAG像查家谱(找表哥的岳父的母校这种多跳关系)。
  first_principle: 向量检索只能找"语义相似"的文本，无法理解实体间的"关系"。知识图谱显式编码关系，图遍历实现多跳推理。
  key_points:
  - 核心：实体节点+关系边+图遍历
  - 构建：LLM抽实体关系→建图→社区检测
  - 适合：多跳推理/关系分析/全局摘要
  - 不适合：简单查询/频繁更新/小数据
first_principle:
  essence: 知识的连接方式决定了推理能力——向量只存"相似度"，图谱存"关系"。
  derivation: 多跳问题(A公司CEO的母校)需要跨文档串联实体关系。向量检索每个chunk独立，无法表达"A收购B，B的创始人是C"。图谱显式编码这些关系，图遍历自然解决多跳。
  conclusion: GraphRAG = 知识图谱（显式关系） + 图遍历（多跳推理）
follow_up:
- GraphRAG怎么构建？——LLM抽实体+关系→建图→社区聚类
- 构建成本高吗？——高，每个文档都要LLM抽取
- 和LightRAG什么关系？——LightRAG是轻量替代
memory_points:
- 场景对比：向量RAG擅长局部事实提取，GraphRAG专攻多跳推理和全局摘要。
- 必用场景：多跳推理（如A收购B，B的创始人是谁）、复杂依赖与因果分析。
- 图库构建：LLM抽取实体和关系构建图，并跑Leiden算法做社区检测。
- 全局查询：GraphRAG先汇总各社区生成的摘要，再回答全局总结类问题。
---

# 什么场景必须用 GraphRAG？知识图谱如何构建和应用？

## 一、GraphRAG vs 向量 RAG

```
┌──────────────┬──────────────────┬──────────────────────┐
│ 维度          │ 向量RAG             │ GraphRAG                │
├──────────────┼──────────────────┼──────────────────────┤
│ 数据结构      │ 文本块+向量索引     │ 实体+关系+图结构        │
│ 检索方式      │ 语义相似度          │ 图遍历                  │
│ 擅长          │ 局部事实查询        │ 多跳关系推理            │
│ 全局摘要      │ 弱（只看局部片段）  │ 强（社区摘要）          │
│ 构建成本      │ 低（切分+向量化）   │ 高（LLM抽取实体关系）   │
│ 更新成本      │ 低（重新向量化）    │ 高（重建图结构）        │
│ 延迟          │ 快(ms)             │ 中(图遍历)             │
└──────────────┴──────────────────┴──────────────────────┘
```

## 二、必须用 GraphRAG 的场景

### 场景 1：多跳推理（核心场景）

```
问题: "收购了DeepMind的公司，其创始人的母校在哪里？"

需要跨3跳推理:
  DeepMind → 被Google收购 → 创始人Larry Page → 母校密歇根大学

向量RAG: 一次检索找不到（信息分散在不同文档）
GraphRAG: 图遍历 DeepMind-[收购]→Google-[创始]→Page-[毕业]→密歇根
```

### 场景 2：关系密集型

```
场景: 药物相互作用分析
  药物A -[相互作用]- 药物B
  药物B -[禁忌]- 疾病C
  → 患者有疾病C，能用药物A吗？

向量RAG: 难以发现间接的相互作用链
GraphRAG: 图遍历自然发现 A→B→C 的禁忌链
```

### 场景 3：全局摘要

```
问题: "总结这个领域的所有主要观点"

向量RAG: 只能检索top-k局部片段，无法全局概览
GraphRAG: 社区检测聚类后，每个社区生成摘要，汇总成全局视图

GraphRAG的全局查询流程:
  1. 图结构 → Leiden算法社区检测
  2. 每个社区生成摘要
  3. 查询时汇总各社区摘要 → 全局答案
```

### 场景 4：因果/依赖分析

```
场景: 供应链风险分析
  "如果供应商A停产，影响哪些产品？"
  
  产品X -[依赖]- 组件Y -[来自]- 供应商A
  → 图遍历找到所有依赖A的产品
```

## 三、知识图谱构建流程

```python
class GraphRAGBuilder:
    def build(self, documents):
        # Step 1: 实体抽取
        entities = []
        for doc in documents:
            extracted = self.llm.extract_entities(doc)
            # "Google由Larry Page创立" 
            # → 实体: [Google, Larry Page]
            entities.extend(extracted)
        
        # Step 2: 关系抽取
        relationships = []
        for doc in documents:
            rels = self.llm.extract_relationships(doc)
            # → 关系: [(Google, 创立者, Larry Page)]
            relationships.extend(rels)
        
        # Step 3: 构建图
        graph = KnowledgeGraph()
        for entity in deduplicate(entities):
            graph.add_node(entity)
        for rel in relationships:
            graph.add_edge(rel.source, rel.target, rel.type)
        
        # Step 4: 社区检测（聚类）
        communities = graph.detect_communities(algorithm="Leiden")
        # 相关节点的聚类，如"AI领域""医疗领域"
        
        # Step 5: 社区摘要
        for community in communities:
            community.summary = self.llm.summarize(community.nodes)
        
        return graph
```

## 四、GraphRAG 查询流程

```python
class GraphRAGQuery:
    def query(self, question, graph):
        # 判断查询类型
        if self.is_global_query(question):
            # 全局查询：汇总各社区摘要
            return self.global_query(question, graph)
        else:
            # 局部查询：从相关实体图遍历
            return self.local_query(question, graph)
    
    def local_query(self, question, graph):
        # 1. 找到问题相关的起始实体
        entities = self.llm.extract_entities(question)
        start_nodes = graph.find_nodes(entities)
        
        # 2. 图遍历（扩展N跳）
        relevant = graph.traverse(start_nodes, max_hops=3)
        
        # 3. 收集相关信息
        context = self.collect_subgraph_info(relevant)
        
        # 4. LLM基于图信息生成答案
        return self.llm.answer(question, context)
    
    def global_query(self, question, graph):
        # 汇总所有社区摘要
        summaries = [c.summary for c in graph.communities]
        return self.llm.answer_global(question, summaries)
```

## 五、什么场景不适合 GraphRAG

```
不适合：
  ✗ 简单事实查询（向量RAG更快更便宜）
    "什么是Agent" → 向量一次检索就够
  
  ✗ 频繁更新的数据（图重建成本高）
    新闻/实时数据 → 向量库增量更新更快
  
  ✗ 数据量小（没必要建图）
    几十篇文档 → 向量RAG足够
  
  ✗ 无明确实体关系的文本
    纯叙述性文本 → 抽不出有意义的关系

判断标准：
  问题需要"跨实体关系推理" → GraphRAG
  问题只是"找相关信息" → 向量RAG
```

## 六、GraphRAG 的成本

```
构建成本（高）:
  - 每个文档都要LLM抽取实体和关系
  - 1000篇文档 → ~百万Token的LLM调用
  - 成本可能是向量RAG的10-50倍

查询成本（中）:
  - 图遍历比向量检索慢
  - 但通常比多轮Agentic RAG快

更新成本（高）:
  - 新增文档需要重新抽取+更新图结构
  - 不像向量库可以简单增量

优化:
  - 增量构建（只处理新文档）
  - 用小模型抽取（省成本）
  - 混合：关键数据建图，其余用向量
```

## 七、面试加分点

1. **多跳推理是核心价值**：用"A公司CEO的母校"例子说明向量 RAG 做不到的事
2. **承认成本高**：GraphRAG 构建贵更新难，不是银弹——只在需要时用
3. **混合架构**：向量+图谱混合（简单走向量，复杂走图谱）是生产实践

## 记忆要点

- 场景对比：向量RAG擅长局部事实提取，GraphRAG专攻多跳推理和全局摘要。
- 必用场景：多跳推理（如A收购B，B的创始人是谁）、复杂依赖与因果分析。
- 图库构建：LLM抽取实体和关系构建图，并跑Leiden算法做社区检测。
- 全局查询：GraphRAG先汇总各社区生成的摘要，再回答全局总结类问题。

