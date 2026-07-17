---
id: note-bz-agent-048
difficulty: L3
category: ai
subcategory: RAG
tags:
- B站面经
- RAG优化
- 检索召回
feynman:
  essence: RAG召回率优化=全链路：查询改写(查得对)+混合检索(查得全)+Rerank(排得准)+分块优化(切得好)+参数调优。十种技巧覆盖检索前中后。
  analogy: 像钓鱼——选对鱼饵(查询改写)、多撒几竿(多路召回)、挑大鱼(重排)、选好钓点(分块)。
  first_principle: 召回率低要么是"没查对"(查询问题)要么是"查不到"(索引/检索方法问题)。全链路优化每个环节。
  key_points:
  - 十种技巧：查询改写/HyDE/多查询/混合检索/Rerank/分块/元数据/参数/上下文扩展/反馈
  - 分检索前/中/后三类
  - 核心思想：多路召回+精排
  - 评估驱动优化
first_principle:
  essence: 召回率=该找到的有没有找到。受查询质量、检索方法、数据组织三方面影响。
  derivation: 查询表达不全→查不到(改写查询)。单一检索方法有盲区→漏召回(混合检索)。分块不当→语义被切断(优化分块)。全链路优化才能最大化召回。
  conclusion: 召回率优化 = 查询优化（查得对） + 多路检索（查得全） + 精排序（排得准）
follow_up:
- 召回率怎么衡量？——有标注数据算recall，无标注用LLM评估
- 召回率和精度冲突吗？——会，先保召回再优化精度
- 极限能到多少？——视任务而定，通常>80%算好
memory_points:
- 框架口诀：前改写、中混合、后重排、底分块（查前优化、查中召回、查后精排、基础数据）。
- 检索前：用查询改写或HyDE（生假设答案）对齐文档语义，多查询广撒网。
- 检索中：核心是混合检索（向量加BM25），外加元数据过滤缩小范围。
- 检索后：必做Rerank重排精选上下文，并配合去重压缩降噪音。
- 数据层：分块决定上限，推荐父子分块（小块检索，大块返回保留上下文）。
---

# RAG 有哪些优化技巧？（十种）

## 一、十种优化技巧总览

```
┌──────────────────────────────────────────────────┐
│          RAG 召回率优化十技                          │
├──────────────────────────────────────────────────┤
│                                                    │
│  【检索前：查询优化】                                │
│  1. 查询改写（Query Rewriting）                    │
│  2. HyDE（假设答案检索）                           │
│  3. 多查询融合（Multi-Query）                      │
│  4. 查询扩展（Query Expansion）                    │
│                                                    │
│  【检索中：方法优化】                                │
│  5. 混合检索（向量+BM25）                          │
│  6. 多路召回（不同chunk_size/不同模型）             │
│  7. 元数据过滤（缩小搜索范围）                      │
│                                                    │
│  【检索后：结果优化】                                │
│  8. Rerank重排序                                   │
│  9. 上下文扩展（Context Expansion）                │
│  10. 去重与压缩                                    │
│                                                    │
│  【数据层：基础优化】                                │
│  + 分块策略优化（父子分块/语义分块）                │
│                                                    │
└──────────────────────────────────────────────────┘
```

## 二、检索前：查询优化

### 技巧 1：查询改写

```python
def rewrite_query(query):
    """把口语化查询改成检索友好的形式"""
    return llm.rewrite(f"把以下查询改成更适合检索的关键词形式: {query}")
    # "那个做AI的很火的公司" → "OpenAI 人工智能 公司"
```

### 技巧 2：HyDE（假设答案检索）

```python
def hyde_retrieve(query):
    """先生成假设答案，用答案检索"""
    # 假设答案的语义更接近文档（而非问题）
    hypothetical = llm.generate(f"假设回答: {query}")
    # "Agent是什么" → "Agent是能自主行动的AI系统，具有规划能力..."
    docs = vector_db.search(embed(hypothetical))
    return docs
```

### 技巧 3：多查询融合

```python
def multi_query(query):
    """生成多个角度的查询，分别检索后合并"""
    variants = llm.generate(f"用3种不同表述: {query}")
    # ["AI智能体", "autonomous agent", "自主代理系统"]
    
    all_docs = []
    for v in variants:
        all_docs.extend(vector_db.search(v, k=5))
    
    # 去重+排序
    return deduplicate(all_docs)
```

### 技巧 4：查询扩展

```python
def expand_query(query):
    """加同义词/相关词扩大匹配"""
    synonyms = llm.get_synonyms(query)
    # "Agent" → ["Agent", "智能体", "autonomous", "代理"]
    expanded = query + " " + " ".join(synonyms)
    return expanded
```

## 三、检索中：方法优化

### 技巧 5：混合检索

```python
def hybrid_retrieve(query):
    """向量检索 + BM25 关键词检索 融合"""
    # 向量：语义匹配（"开心"≈"快乐"）
    dense = vector_db.search(embed(query), k=10)
    
    # BM25：精确匹配（专有名词/代码）
    sparse = bm25.search(query, k=10)
    
    # RRF融合
    return rrf_merge(dense, sparse)

def rrf_merge(list_a, list_b, k=60):
    """Reciprocal Rank Fusion"""
    scores = {}
    for rank, doc in enumerate(list_a):
        scores[doc.id] = scores.get(doc.id, 0) + 1/(k + rank)
    for rank, doc in enumerate(list_b):
        scores[doc.id] = scores.get(doc.id, 0) + 1/(k + rank)
    return sorted(scores, key=scores.get, reverse=True)
```

### 技巧 6：多路召回

```python
def multi_path_retrieve(query):
    """不同参数/模型多路召回"""
    results = []
    # 不同chunk_size
    results += vector_db_small.search(query, k=5)   # 小块(精准)
    results += vector_db_large.search(query, k=5)   # 大块(上下文)
    # 不同embedding模型
    results += openai_db.search(query, k=5)
    results += bge_db.search(query, k=5)
    return merge(results)
```

### 技巧 7：元数据过滤

```python
def filtered_retrieve(query, filters):
    """先过滤再检索，缩小范围"""
    return vector_db.search(
        embed(query),
        filter={
            "version": "latest",      # 只要最新版
            "doc_type": "manual",     # 只要手册
            "date": {"$gte": "2026"}  # 2026年以后的
        },
        k=10
    )
```

## 四、检索后：结果优化

### 技巧 8：Rerank 重排序

```python
def rerank(query, docs, top_k=5):
    """Cross-Encoder精排"""
    # 召回top-20，精排选top-5
    pairs = [(query, doc.content) for doc in docs]
    scores = cross_encoder.predict(pairs)
    ranked = sorted(zip(docs, scores), key=lambda x: -x[1])
    return [d for d, s in ranked[:top_k]]
```

### 技巧 9：上下文扩展

```python
def expand_context(docs):
    """找到相邻块，补充上下文"""
    for doc in docs:
        # 找到前后相邻的块
        prev = vector_db.get(doc.id - 1)
        next_ = vector_db.get(doc.id + 1)
        doc.context = [prev, doc, next_]
    # 防止关键信息被分块切断
```

### 技巧 10：去重与压缩

```python
def dedup_and_compress(docs):
    """去重+压缩"""
    # 去重（多路召回会有重复）
    unique = deduplicate_by_similarity(docs, threshold=0.9)
    # 压缩（长文档提取关键句）
    for doc in unique:
        if len(doc.content) > 500:
            doc.content = llm.extract_keypoints(doc.content)
    return unique
```

## 五、数据层：分块优化

```python
# 父子分块：检索小块，返回大块
class ParentChildRetriever:
    def retrieve(self, query):
        # 用小块精准检索
        small_chunks = self.small_index.search(query, k=5)
        # 返回对应的父块（上下文更全）
        parent_ids = [c.metadata["parent_id"] for c in small_chunks]
        return [self.parent_store.get(pid) for pid in parent_ids]
```

## 六、效果对比（经验值）

```
以基础RAG为基线(假设recall=60%)：

技巧                     recall提升
─────────────────────────────────
基础(向量检索top-5)       60% (基线)
+查询改写                 65% (+5%)
+混合检索(向量+BM25)      75% (+15%)  ← 效果显著
+Rerank                   80% (+20%)  ← 效果显著
+HyDE                     78% (+18%)
+多查询融合               82% (+22%)
+上下文扩展               80% (+20%)
+全部组合                 88% (+28%)

结论：混合检索+Rerank 是性价比最高的两个技巧
```

## 七、面试加分点

1. **全链路视角**：检索前(查询)+检索中(方法)+检索后(排序)，系统性
2. **强调混合检索+Rerank**：这两个是性价比最高的，必提
3. **多路召回思想**：召回阶段宁多勿少（先召回再精排），体现"召回率优先"原则

## 记忆要点

- 框架口诀：前改写、中混合、后重排、底分块（查前优化、查中召回、查后精排、基础数据）。
- 检索前：用查询改写或HyDE（生假设答案）对齐文档语义，多查询广撒网。
- 检索中：核心是混合检索（向量加BM25），外加元数据过滤缩小范围。
- 检索后：必做Rerank重排精选上下文，并配合去重压缩降噪音。
- 数据层：分块决定上限，推荐父子分块（小块检索，大块返回保留上下文）。


## 苏格拉底式面试追问

> 这组追问模拟面试官层层逼问，每一问先回答"为什么"，再回答"怎么做"，最后回答"如何证明"。

### 第一层：目标与动机

**Q：十种 RAG 优化技巧覆盖检索前中后（查询改写/混合检索/rerank/分块/参数调优），为什么不只用一种（如只调 embedding）而要全链路？**

因为单点优化有天花板，瓶颈可能在其他环节。1）单点天花板——只调 embedding 到极致（如微调），但 query 口语化（查询前没改写）或分块碎了关键信息（数据层没优化），embedding 再好也召回不全；2）全链路互补——查询改写（查得对）让 embedding 能匹配，混合检索（向量+BM25）覆盖语义和精确，rerank 精排提升 top-K 质量，分块优化保证信息完整，参数调优（K/chunk size）精细控制，各环节协同才能把召回率和准确率都拉满；3）边际收益——单点做到 80 分后提升难，全链路每个环节提 5 分叠加效果显著。所以全链路不是"堆技巧"，是"消除各环节的短板"，整体效果取决于最短板。

### 第二层：证据与定位

**Q：十种技巧不可能全用（成本高），怎么判断当前 RAG 系统最该用哪几种？**

按瓶颈定位。1）诊断——跑分层指标（Recall@K 看召回、MRR 看排序、答案准确率看端到端），找最差的层；2）匹配技巧——召回差（Recall 低）：用查询改写（提升 query 质量）+ 混合检索（覆盖更广）+ 分块优化（信息完整）；排序差（Recall 还行但 MRR 低）：用 rerank（精排）；生成差（检索好但答案差）：优化 prompt + 引用约束；3）成本排序——低成本高收益的先做（如调 K/加 BM25/改 prompt，零模型成本），高成本的按需（如微调 embedding/训练 rerank，要数据+算力）。实务：先做低成本（查询改写+混合检索+rerank+prompt），跑评估，不够再上高成本（微调）。

### 第三层：根因深挖

**Q：查询改写（如 HyDE）能有效提升召回，但 HyDE 是"让 LLM 先生成假设答案再用答案检索"，为什么用假设答案检索比用原 query 检索好？**

因为"答案和文档的语义更接近"。1）query-文档语义鸿沟——query 是"问题"（如"如何提升销量"），文档是"答案/知识"（如"提升销量的方法包括..."），两者表述形式不同（疑问 vs 陈述），embedding 相似度可能不高；2）HyDE 缩小鸿沟——让 LLM 先生成假设答案（如"提升销量可以优化营销/产品/渠道..."），假设答案是"陈述"形式，和文档（也是陈述）语义更接近，用假设答案检索召回更好；3）适用场景——HyDE 适合"query 简短/抽象、文档详细"的场景（如知识问答），不适合"query 已经很具体"的场景（如查某个产品型号，假设答案可能编造反而干扰）。注意：HyDE 的假设答案可能错（LLM 幻觉），错的答案检索也差，所以 HyDE 是双刃剑（对的时候好，错的时候差），要评估是否适合。

**Q：混合检索（向量+BM25）用 RRF 融合结果，但两者的分数尺度不同（向量是 cosine 0-1，BM25 是无界分数），为什么不直接加权融合而用 RRF（倒数排名）？**

因为分数尺度不可比。1）加权融合的问题——向量 cosine（0.8）和 BM25（15 分）尺度不同，直接加权（如 0.5*向量+0.5*BM25）无意义（BM25 的大数值会压倒向量），要先归一化，但归一化方式（min-max/z-score）影响结果且不鲁棒；2）RRF 的优势——只用排名（不看分数），如文档在向量检索排第 1、BM25 排第 3，RRF 分数=1/(1+1)+1/(3+1)=0.5+0.25=0.75，尺度无关（只看排名），鲁棒（不受分数分布影响）；3）简单有效——RRF 无需调权重（不像加权要调向量/BM25 权重），实测效果好（业界 RAG 广泛采用）。所以 RRF 解决了"多路检索结果融合"的尺度问题，简单且鲁棒。

### 第四层：方案权衡

**Q：rerank 提升精度但增加延迟（cross-encoder 慢），怎么平衡精度和延迟？**

两阶段 + 控制精排量。1）两阶段——向量检索粗筛 top-N（N 较大，如 20-50，保召回），rerank 精排 top-K（K 小，如 3-5，精排），只对 N 个文档 rerank（而非全库），控制 rerank 的 forward 次数；2）N 的选择——N 太小（如 10）可能漏召回（rerank 的输入不全），N 太大（如 100）rerank 慢，经验值 20-50（召回够+rerank 可接受）；3）rerank 模型选择——轻量 rerank（如 bge-reranker-base，快但精度中）vs 重量（如 large，准但慢），按延迟要求选；4）异步/缓存——对高频 query 的 rerank 结果缓存，重复 query 直接返回（省 rerank）。实务：默认两阶段（top-20→rerank→top-5），延迟敏感用轻量 rerank，精度敏感用重量。

**Q：分块优化有多种策略（语义/重叠/结构化），但复杂策略（如结构化切分）实现成本高，什么时候值得？**

按文档类型和准确率要求。1）简单文档（纯文本/无结构）——固定块或语义块够了（简单），结构化切分无意义（文档没结构）；2）结构化文档（手册/法规/产品文档，有明确层级）——结构化切分值得（块带层级元数据，检索时可利用结构，如命中某章节返回该章节块，召回更精准），成本可接受（一次性解析实现）；3）高准确率要求——结构化切分能提升召回（结构信息辅助），值得投入；低要求（如粗略问答）简单块够。判断：文档有结构 + 要求高 → 结构化切分；文档无结构或要求低 → 简单块。实务：默认语义块（通用），强结构文档上结构化（精准）。

### 第五层：验证与沉淀

**Q：你用了多种优化技巧，怎么衡量每种技巧的贡献（哪个该留哪个该去）？**

消融实验。1）逐个关闭——在全优化版（所有技巧都开）基础上，逐个关闭技巧（如关 rerank、关 HyDE、关混合检索），对比关闭后的指标（Recall/准确率），掉得多的技巧贡献大；2）逐个开启——从基线（无优化）开始，逐个加技巧，对比加入后的指标提升，提升大的有效；3）成本效益——每个技巧的提升除以其成本（latency/算力/复杂度），效益高的优先留。实务：全开跑基线，逐个关闭看影响，关闭影响小的（可去省成本）影响大的（必留）。这样能识别"哪些技巧是核心（必留）、哪些是边际（可去）"，优化资源分配。

**Q：十种 RAG 优化技巧怎么沉淀成团队的可复用能力？**

建优化组件库 + playbook：1）组件库——每个技巧做成可插拔组件（查询改写器/混合检索器/rerank/分块器/prompt 模板），标准化接口，新 RAG 系统按需组合；2）playbook——记录每个技巧的"适用场景/成本/收益/调参经验"（基于实战数据），指导选型；3）诊断工具——自动化诊断（跑分层指标定位瓶颈→推荐优化技巧），降低决策门槛；4）评估集成——优化后自动跑评估集验证效果，退化告警；5）案例库——真实优化案例（如"召回 60%→85% 用了哪些技巧"），经验复用。这套写入团队 RAG 平台 SOP，让"优化 RAG"从"每次重新研究"变成"用组件+按 playbook"。

## 结构化回答




**30 秒电梯演讲：** 像钓鱼——选对鱼饵(查询改写)、多撒几竿(多路召回)、挑大鱼(重排)、选好钓点(分块)。

**展开框架：**
1. **十种技巧** — 查询改写/HyDE/多查询/混合检索/Rerank/分块/元数据/参数/上下文扩展/反馈
2. **分检索前/中** — 分检索前/中/后三类
3. **核心思想** — 多路召回+精排

**收尾：** 召回率怎么衡量？





## 视频脚本

> 预计时长：4 分钟 | 由浅入深


| 时间 | 画面/字幕 | 口播台词 | 讲解要点 |
|------|----------|----------|----------|
| 0:00 | 标题卡：RAG 有哪些优化技巧？（十种） | "像钓鱼——选对鱼饵(查询改写)、多撒几竿(多路召回)、挑大鱼(重排)、选好钓点(分块)。" | 开场钩子 |
| 0:20 | 核心概念图 | "RAG召回率优化=全链路：查询改写(查得对)+混合检索(查得全)+Rerank(排得准)+分块优化(切得好)+参数调优。…" | 核心定义 |
| 0:50 | 十种技巧示意图 | "十种技巧——查询改写/HyDE/多查询/混合检索/Rerank/分块/元数据/参数/上下文扩展/反馈" | 要点拆解1 |
| 1:30 | 对比/实战案例图 | "对比一下常见误区和工程实践，看真实场景里怎么取舍。" | 实战与对比 |
| 2:20 | 总结卡 | "记住核心要点。下期我们追问：召回率怎么衡量？——有标注数据算recall，无标注用LLM？" | 收尾与钩子 |
