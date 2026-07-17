---
id: note-tx-002
difficulty: L3
category: ai
subcategory: Agent
tags:
- 腾讯
- 面经
- GraphRAG
- RAG
feynman:
  essence: 普通RAG=按语义搜文档片段，GraphRAG=按实体关系搜知识图谱。前者擅长查事实，后者擅长推理关系。
  analogy: 普通RAG像查字典（找到相关词条），GraphRAG像查家谱（能找到表哥的岳父的母校这种多跳关系）。
  key_points:
  - 普通RAG:向量相似度+局部片段
  - GraphRAG:图遍历+多跳推理+全局摘要
  - 适合:多跳问答/关系推理/全局总结
  - 不适合:简单查询/频繁更新/小数据
first_principle: null
follow_up:
- GraphRAG怎么评估效果？——对比向量RAG在多跳问答上的准确率
- 图谱构建成本怎么控制？——用小模型抽实体+人工审核+增量更新
- LightRAG是什么？——GraphRAG的轻量替代
memory_points:
- 对比口诀：普通RAG找局部相似片段，GraphRAG做跨文档全局推理。
- 普通RAG局限：依赖向量相似度，多跳推理弱，缺乏全局摘要视角。
- GraphRAG核心：离线抽取实体关系建图谱+社区检测生成摘要。
- 双模检索：Local针对单实体图遍历，Global针对全局Map-Reduce摘要。
- 场景互补：简单事实用向量，复杂多跳与全局总结用图谱，常建混合架构。
---

# 【腾讯面经】GraphRAG 跟普通 RAG 的区别是什么？什么场景适合用 GraphRAG？

## 核心结论

> 普通 RAG 基于向量相似度检索文档片段，擅长局部事实查询；GraphRAG 基于知识图谱进行图遍历和多跳推理，擅长跨文档关系推理和全局摘要。**两者不是替代关系，而是互补关系**——简单查询用向量 RAG，复杂关系推理用 GraphRAG，生产环境常采用混合架构。

---

## 一、技术原理详解

### 1.1 普通 RAG（Vector RAG）的工作原理

```
用户提问 → Embedding → 向量数据库检索 Top-K → 拼接上下文 → LLM 生成答案
```

**核心机制：** 语义相似度匹配。通过 Embedding 模型将问题和文档都编码为向量，在向量空间中找最近邻的文档片段。

**局限性：**
- **局部性：** 每次只检索到语义相似的片段，无法跨文档串联信息
- **多跳推理弱：** 问 "A公司的CEO的母校在哪个城市？" 需要先找到A公司→CEO→母校→城市，跨越4个文档
- **全局视角缺失：** 无法回答 "这个领域的主要观点是什么？" 这类需要综合全部信息的问题

### 1.2 GraphRAG 的工作原理

GraphRAG 由微软于 2024 年提出，核心创新是将**知识图谱**引入 RAG 流程。

**完整流程分为两个阶段：**

#### 阶段一：离线图谱构建（Indexing）

```
原始文档
    │
    ▼
┌──────────────────┐
│ 1. 文档分块       │  按语义/长度切分
│    (Chunking)    │
└────────┬─────────┘
         ▼
┌──────────────────┐
│ 2. 实体抽取       │  LLM 抽取人名/地名/组织/概念等实体
│ (Entity Extract) │  "马斯克"、"SpaceX"、"特斯拉"
└────────┬─────────┘
         ▼
┌──────────────────┐
│ 3. 关系抽取       │  LLM 抽取实体间关系
│ (Relation Extract│  (马斯克) --[CEO]--> (特斯拉)
└────────┬─────────┘
         ▼
┌──────────────────┐
│ 4. 知识图谱构建   │  实体=节点, 关系=边
│  (Build Graph)   │  存入图数据库(Neo4j/NetworkX)
└────────┬─────────┘
         ▼
┌──────────────────┐
│ 5. 社区检测       │  Leiden 算法聚类形成主题社区
│ (Community Det.) │  科技圈 / 政治圈 / 金融圈
└────────┬─────────┘
         ▼
┌──────────────────┐
│ 6. 社区摘要       │  LLM 为每个社区生成层级摘要
│ (Summarization)  │  L0:全局 / L1:领域 / L2:子主题
└──────────────────┘
```

#### 阶段二：在线查询（Query）

GraphRAG 支持两种查询模式：

| 模式 | 适用场景 | 工作原理 |
|------|---------|---------|
| **Local Search** | 针对特定实体的查询 | 从问题中提取实体→图遍历邻居→收集相关文本片段→LLM生成 |
| **Global Search** | 需要全局总结的查询 | 遍历所有社区摘要→Map-Reduce式汇总→LLM综合生成全局答案 |

### 1.3 核心区别对比

| 维度 | 普通 RAG (Vector) | GraphRAG |
|------|-------------------|----------|
| **数据结构** | 向量索引 + 文本块 | 知识图谱（实体+关系+社区） |
| **检索方式** | 向量相似度 Top-K | 图遍历 + 社区摘要 |
| **多跳推理** | ❌ 弱（需多次检索） | ✅ 强（图遍历天然支持多跳） |
| **全局摘要** | ❌ 只看局部片段 | ✅ 社区摘要+Map-Reduce |
| **构建成本** | 低（只需Embedding） | 高（LLM抽取实体关系） |
| **查询延迟** | 快（毫秒级） | 较慢（图遍历+多步推理） |
| **增量更新** | 容易（重新Embedding） | 复杂（需更新图结构） |
| **适用数据量** | 中小规模 | 大规模知识密集型 |

---

## 二、代码示例与架构对比

### 2.1 普通 RAG 实现

```python
from langchain.embeddings import OpenAIEmbeddings
from langchain.vectorstores import FAISS

# === 普通 RAG ===
class VectorRAG:
    def __init__(self, documents):
        self.embeddings = OpenAIEmbeddings()
        self.vectorstore = FAISS.from_documents(documents, self.embeddings)

    def query(self, question: str, top_k: int = 5):
        """向量检索 + LLM 生成"""
        docs = self.vectorstore.similarity_search(question, k=top_k)
        context = "\n".join([d.page_content for d in docs])
        answer = llm.generate(f"基于以下信息回答问题：\n{context}\n\n问题：{question}")
        return answer

# 问题: "马斯克创立的公司有哪些？"
# 结果: 可能只能检索到提到马斯克的文档片段，遗漏关联信息
```

### 2.2 GraphRAG 实现（简化版）

```python
from dataclasses import dataclass
from typing import List, Dict, Set
import networkx as nx

@dataclass
class Entity:
    id: str
    name: str
    type: str          # person / org / location / concept
    description: str

@dataclass
class Relation:
    source: str        # entity id
    target: str        # entity id
    type: str          # CEO / FOUNDED / LOCATED_IN
    weight: float = 1.0


class GraphRAG:
    def __init__(self):
        self.graph = nx.DiGraph()
        self.entities: Dict[str, Entity] = {}
        self.community_summaries: Dict[int, str] = {}

    def build_graph(self, documents: List[str]):
        """离线构建知识图谱"""
        for doc in documents:
            # Step 1: LLM 抽取实体和关系
            entities, relations = self._llm_extract(doc)
            
            # Step 2: 添加到图中
            for e in entities:
                self.graph.add_node(e.id, **{'name': e.name, 'type': e.type})
                self.entities[e.id] = e
            for r in relations:
                self.graph.add_edge(r.source, r.target,
                                    relation=r.type, weight=r.weight)

        # Step 3: 社区检测（Leiden 算法）
        communities = nx.community.louvain_communities(self.graph.to_undirected())
        
        # Step 4: LLM 为每个社区生成摘要
        for idx, community in enumerate(communities):
            summary = self._llm_summarize_community(community)
            self.community_summaries[idx] = summary

    def query(self, question: str, mode: str = "local"):
        """在线查询"""
        if mode == "local":
            return self._local_search(question)
        else:
            return self._global_search(question)

    def _local_search(self, question: str) -> str:
        """局部查询：图遍历找答案"""
        # Step 1: 从问题中提取实体
        query_entities = self._llm_extract_entities_from_question(question)

        # Step 2: 图遍历（多跳）
        relevant_nodes = set()
        for entity_id in query_entities:
            if entity_id in self.graph:
                # 1-hop + 2-hop neighbors
                neighbors = nx.single_source_shortest_path_length(
                    self.graph, entity_id, cutoff=2
                )
                relevant_nodes.update(neighbors.keys())

        # Step 3: 收集相关文本和关系
        context = self._collect_context(relevant_nodes)

        # Step 4: LLM 生成答案
        return self._llm_answer(question, context)

    def _global_search(self, question: str) -> str:
        """全局查询：Map-Reduce 式汇总社区摘要"""
        # Step 1: Map - 每个社区独立回答
        partial_answers = []
        for idx, summary in self.community_summaries.items():
            partial = self._llm_answer(question, summary)
            partial_answers.append(partial)

        # Step 2: Reduce - 汇总所有社区答案
        final_answer = self._llm_reduce(partial_answers, question)
        return final_answer

    def _llm_extract(self, doc: str):
        """LLM 抽取实体和关系"""
        prompt = f"""
        从以下文本中抽取实体和关系，输出JSON格式：
        文本：{doc}
        """
        return llm.generate(prompt)  # 返回 entities, relations

    def _llm_summarize_community(self, community) -> str:
        """LLM 为社区生成摘要"""
        entities_desc = [str(self.entities[n]) for n in community]
        return llm.generate(f"总结以下实体构成的社区：\n{entities_desc}")
```

### 2.3 混合架构（生产推荐）

```
                    用户提问
                       │
                ┌──────▼──────┐
                │ Query Router│  LLM 分类：简单查询 or 复杂查询？
                └──┬─────┬────┘
                   │     │
          简单查询 │     │ 复杂/多跳查询
                   ▼     ▼
           ┌─────────┐ ┌──────────┐
           │Vector   │ │GraphRAG  │
           │RAG      │ │Local/    │
           │(Top-K)  │ │Global    │
           └────┬────┘ └────┬─────┘
                │           │
                └─────┬─────┘
                      ▼
              ┌──────────────┐
              │ LLM 生成答案  │
              └──────────────┘
```

---

## 三、什么场景适合 GraphRAG

| 场景 | 例子 | 为什么 GraphRAG 更好 |
|------|------|---------------------|
| **多跳推理** | "A公司的CEO的母校在哪个城市？" | 需跨4个文档串联实体关系，向量检索只能找到局部片段 |
| **关系密集型** | "哪些药物与华法林有相互作用？" | 药物相互作用本质是图关系，天然适合图遍历 |
| **全局摘要** | "总结这个领域的主要技术路线" | 需综合全部文档，普通RAG只能检索局部片段 |
| **因果推理** | "为什么供应链中断导致价格上涨？" | 需理解A→B→C的因果链路 |
| **实体消歧** | "苹果"是公司还是水果？ | 图谱中的上下文关系帮助消歧 |

### 什么场景不适合 GraphRAG

- **简单事实查询：** "Python的GIL是什么？" → 向量RAG更快更便宜
- **频繁更新的数据：** 实时新闻、股票行情 → 图结构重建成本太高
- **数据量小（<100篇文档）：** 建图收益不显著
- **对延迟敏感的场景：** GraphRAG 的图遍历+多步推理延迟高于向量检索

---

## 四、面试高频追问点

### Q1: GraphRAG 怎么评估效果？

**答：** 核心评估基准：
1. **多跳问答数据集：** HotpotQA、MuSiQue、2WikiMultihopQA，这些数据集专门测试多跳推理能力，GraphRAG 在此显著优于向量RAG。
2. **对比实验：** 相同问题集，对比 Vector RAG vs GraphRAG 的回答准确率、覆盖率。
3. **分层评估：** Simple QA（事实查询）向量RAG可能更好；Multi-hop QA GraphRAG 更好；Global Summary GraphRAG 压倒性优势。

### Q2: 图谱构建成本怎么控制？

**答：** 这是 GraphRAG 最大的工程瓶颈（LLM 抽取实体关系需要大量 API 调用）。控制方法：
1. **用小模型抽实体：** 用 7B/14B 模型做实体抽取，GPT-4 只做质量审核
2. **增量更新：** 只对新文档做图谱更新，而非全量重建
3. **缓存抽取结果：** 相同实体只抽取一次，后续文档只需更新关系
4. **预定义 Schema：** 限制实体和关系类型（而非开放抽取），降低抽取难度和成本

### Q3: LightRAG 是什么？

**答：** LightRAG 是 GraphRAG 的轻量替代方案，主要优化：
- **双层检索：** Low-level（实体级）+ High-level（关系级），比 GraphRAG 的 Local/Global 更灵活
- **更快的图谱构建：** 优化的抽取pipeline，减少 LLM 调用
- **增量更新友好：** 支持低成本的增量图更新
- 适合资源受限场景或需要快速迭代的原型

---

## 五、实战经验

1. **不要盲目上 GraphRAG：** 面试中要先分析需求——如果 80% 的查询是简单事实查询，Vector RAG 就够了，只在少数多跳推理场景引入 GraphRAG。混合架构（Router 分发）是生产最优解。

2. **图谱质量决定一切：** GraphRAG 的效果上限取决于实体/关系抽取的质量。抽取不准，图遍历会引入大量噪声，效果可能不如向量 RAG。建议在实体抽取后加一层人工审核或 LLM 质量检查。

3. **社区摘要的价值被低估：** GraphRAG 最独特的不是图遍历，而是 **社区检测 + 摘要** 机制。它把海量碎片信息组织成层次化的主题摘要，这解决了普通 RAG 无法做全局总结的根本问题。

4. **面试加分点：** 提到 GraphRAG 的 **Map-Reduce 全局搜索** 和 **Leiden 社区检测** 这两个技术细节，能展示你对原始论文的深入理解。再提一下 LightRAG 等替代方案，说明你关注最新进展。

## 记忆要点

- 对比口诀：普通RAG找局部相似片段，GraphRAG做跨文档全局推理。
- 普通RAG局限：依赖向量相似度，多跳推理弱，缺乏全局摘要视角。
- GraphRAG核心：离线抽取实体关系建图谱+社区检测生成摘要。
- 双模检索：Local针对单实体图遍历，Global针对全局Map-Reduce摘要。
- 场景互补：简单事实用向量，复杂多跳与全局总结用图谱，常建混合架构。


## 苏格拉底式面试追问

> 这组追问模拟面试官层层逼问，每一问先回答"为什么"，再回答"怎么做"，最后回答"如何证明"。

### 第一层：目标与动机

**Q：GraphRAG 相比普通 RAG 的核心差异是"用图谱"还是"用关系"？为什么这个差异重要？**

核心是用关系。普通 RAG 按语义相似度检索文档片段，适合"查事实"（如"Python 的 GIL 是什么"）。GraphRAG 检索的是知识图谱中的实体和关系，适合"推理关系"（如"A 公司的 CEO 的母校在哪里"——要先找 A 公司→CEO→人物→母校，多跳推理）。普通 RAG 检索到的是"包含关键词的片段"，不一定包含多跳推理链路；GraphRAG 显式建模实体关系，能沿图谱遍历找答案。这个差异重要，因为很多业务问题本质是多跳关系推理，纯语义检索解决不了。

### 第二层：证据与定位

**Q：GraphRAG 在某类问题上效果反而不如普通 RAG，怎么定位？**

看问题类型。1) 事实查询（如"GIL 是什么"）——GraphRAG 把简单问题复杂化（要在图谱里找 GIL 实体），不如普通 RAG 直接检索文档片段；2) 多跳推理（如"A 的合作伙伴的 CEO"）——GraphRAG 应该优于普通 RAG，如果反而更差，是图谱构建不全（缺关系）或遍历算法有问题。区分方法：把问题按"事实查询 vs 关系推理"分类，分别统计两类问题的准确率，确认 GraphRAG 在关系推理类是否真的优于普通 RAG。

### 第三层：根因深挖

**Q：GraphRAG 的知识图谱构建不全（缺关系），根因是抽取模型不行还是数据覆盖不够？**

两个原因都有。1) 抽取模型——从非结构化文本抽取实体和关系的模型（如 LLM-based 抽取）准确率有限，漏抽关系（如文本说"A 收购了 B"但模型没抽出 acquisition 关系）；2) 数据覆盖——图谱基于有限的文档构建，如果文档本身没提到某些关系（如 A 和 C 的间接关系），图谱里自然没有。根因判断：抽样检查抽取模型在已知关系上的 recall，如果 < 70% 是模型问题；如果模型 recall 高但图谱仍不全，是数据问题。

**Q：那为什么不直接用更大的模型做关系抽取，提高准确率？**

成本和速度。知识图谱构建要处理海量文档（百万级），用大模型（如 GPT-4）抽取每篇文档的成本是 0.01-0.1 美元，百万文档要 1-10 万美元。而且构建是一次性的（或周期性增量），用大模型的边际成本高。解法：1) 用小模型（如 7B 微调的抽取模型）做初抽，大模型只对高价值或低置信度的文档复核；2) 用规则补充——明确的关系模式（如"收购"、"投资"）用正则抽取，准确率 100%。混合策略比纯大模型更经济。

### 第四层：方案权衡

**Q：GraphRAG 适合多跳推理，但图谱构建和维护成本高，什么场景值得做？**

三个判断标准：1) 问题的多跳性——业务问题是否需要 2 跳以上推理（如"推荐→用户→好友→好友喜欢"），单跳问题普通 RAG 够；2) 关系密度——数据中实体关系是否密集（如社交网络、企业股权），稀疏关系的场景图谱价值低；3) 演进性——关系是否频繁变化（如实时股价），变化快的图谱维护成本高。值得做的典型场景：企业知识库（组织架构、项目关系）、社交推荐、金融风控（股权穿透）。不值得：FAQ 问答、产品文档检索。

**Q：为什么不直接把 GraphRAG 和普通 RAG 都做，按问题路由，而要二选一？**

可以都做，但要权衡成本。两套系统意味着两套索引（向量库 + 图谱）、两套维护、两套检索逻辑。维护成本翻倍。如果业务问题 90% 是事实查询、10% 是多跳推理，做普通 RAG + 小规模图谱（只覆盖多跳场景）更经济；如果 50% 是多跳，全量 GraphRAG 更合理。路由策略：用问题分类器判断"是否需要多跳"，需要的走 GraphRAG、不需要的走普通 RAG。这比"全做"更精准地匹配成本和需求。

### 第五层：验证与沉淀

**Q：怎么衡量 GraphRAG 相比普通 RAG 的增量价值？**

构造对比 eval 集：1) 事实查询集（200 题）——普通 RAG 和 GraphRAG 的准确率应该接近（GraphRAG 不能退化）；2) 多跳推理集（200 题，标注推理链路）——GraphRAG 的准确率应该显著高于普通 RAG（如 +20%）；3) 端到端业务指标——如推荐准确率、风控召回率。如果多跳集的增量 < 10%，说明 GraphRAG 的复杂度不划算。沉淀为 GraphRAG 选型决策表：问题类型 × 关系密度 × 维护成本 → 是否用 GraphRAG。

## 结构化回答

**30 秒电梯演讲：** 普通RAG=按语义搜文档片段，GraphRAG=按实体关系搜知识图谱。前者擅长查事实，后者擅长推理关系——普通RAG像查字典（找到相关词条）。

**展开框架：**
1. **普通RAG** — 向量相似度+局部片段
2. **GraphRAG** — 图遍历+多跳推理+全局摘要
3. **适合** — 多跳问答/关系推理/全局总结

**收尾：** 您想深入聊：GraphRAG怎么评估效果？——对比向量RAG在多跳问答上的准确率？


## 视频脚本

> 预计时长：4 分钟 | 由浅入深


| 时间 | 画面/字幕 | 口播台词 | 讲解要点 |
|------|----------|----------|----------|
| 0:00 | 标题卡：GraphRAG 跟普通 RAG 的区别是什么？… | "普通RAG像查字典（找到相关词条），GraphRAG像查家谱（能找到表哥的岳父的母校这种多…" | 开场钩子 |
| 0:20 | 核心概念图 | "普通RAG=按语义搜文档片段，GraphRAG=按实体关系搜知识图谱。前者擅长查事实，后者擅长推理关系。" | 核心定义 |
| 0:50 | 普通RAG示意图 | "普通RAG——向量相似度+局部片段" | 要点拆解1 |
| 1:30 | 对比/实战案例图 | "对比一下常见误区和工程实践，看真实场景里怎么取舍。" | 实战与对比 |
| 2:20 | 总结卡 | "记住核心要点。下期我们追问：GraphRAG怎么评估效果？——对比向量RAG在多跳问答上？" | 收尾与钩子 |
