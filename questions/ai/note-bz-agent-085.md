---
id: note-bz-agent-085
difficulty: L3
category: ai
subcategory: RAG
tags:
- B站面经
- 文档问答
- 召回率
feynman:
  essence: 文档问答召回率提升=查询优化(改写/HyDE)+混合检索(向量+BM25)+Rerank+分块优化+元数据过滤。全链路优化，检索是核心。
  analogy: 像图书馆找书——好的检索词(查询优化)、多种索引方式(混合检索)、让馆员帮你挑(Rerank)、合理分类摆放(分块)。
  first_principle: 召回率=该找到的有没有找到。受查询质量、检索方法、数据组织三方面影响，需全链路优化。
  key_points:
  - 查询：改写/HyDE/多查询
  - 检索：混合(向量+BM25)
  - 排序：Rerank精选
  - 数据：分块/元数据/父子
first_principle:
  essence: 召回率取决于"查询与文档的匹配质量"，需多维度提升。
  derivation: 查询表达差→匹配不到(改写)。单一检索有盲区→漏召回(混合)。分块不当→语义断(优化分块)。多管齐下才能最大化召回。
  conclusion: 文档问答召回 = 查询优化 + 混合检索 + Rerank + 数据优化的全链路
follow_up:
- 召回率多少算好？——>85%算优秀
- 召回和精度冲突怎么办？——先保召回再Rerank提精度
- 怎么评估？——标注relevant docs算recall@k
memory_points:
- 提升召回五步走：查询改写优化、多路混合检索、Rerank精排、优化分块、调参
- HyDE反向假设：先让大模型生成假设答案，再拿答案去向量库做相似度检索
- 多路融合检索：向量搜语义，BM25搜关键词，RRF算法融合去重提升长尾覆盖
- 精排保精准：粗筛后用交叉编码器Rerank，解决向量检索的噪音问题
---

# 文档问答系统的检索召回率如何提升？

## 一、文档问答的检索挑战

```
文档问答(Document QA) vs 普通搜索：
  - 答案藏在文档的某一段落，需精准定位
  - 用户问法多样，与文档表述有语义鸿沟
  - 文档可能很长，关键信息占比小
  - 需要高召回（漏了就答不出）+高精度（噪音干扰生成）

核心指标：
  recall@k: 应该检索到的是否都在前k个结果里
  precision@k: 检索到的是否都相关
```

## 二、全链路优化方案

```
┌──────────────────────────────────────────────────┐
│            召回率提升全链路                           │
├──────────────────────────────────────────────────┤
│                                                    │
│  1. 查询优化层                                     │
│     改写 / HyDE / 多查询 / 扩展                    │
│                                                    │
│  2. 检索方法层                                     │
│     向量 + BM25混合 + 多路召回                     │
│                                                    │
│  3. 排序优化层                                     │
│     Rerank / 上下文扩展                            │
│                                                    │
│  4. 数据组织层                                     │
│     分块策略 / 元数据 / 父子分块                   │
│                                                    │
│  5. 参数调优层                                     │
│     top_k / 阈值 / chunk_size                     │
│                                                    │
└──────────────────────────────────────────────────┘
```

## 三、查询优化（缩小语义鸿沟）

```python
class QueryOptimizer:
    def optimize(self, query):
        queries = [query]
        
        # 1. 改写：口语→规范
        queries.append(self.rewrite(query))
        
        # 2. HyDE：用假设答案检索
        hyde = self.llm.generate(f"简要回答: {query}")
        queries.append(hyde)
        
        # 3. 多查询：不同角度
        queries.extend(self.llm.variants(query, n=3))
        
        # 4. 子问题分解（复杂问题）
        if self.is_complex(query):
            queries.extend(self.decompose(query))
        
        return queries  # 一个查询变多个，扩大覆盖
```

## 四、混合检索（多路覆盖）

```python
class HybridDocRetriever:
    def retrieve(self, query, top_k=20):
        results = []
        
        # 路径1: 向量检索（语义匹配）
        results += self.vector_db.search(embed(query), k=20)
        
        # 路径2: BM25（关键词/专有名词）
        results += self.bm25.search(query, k=20)
        
        # 路径3: 元数据过滤后检索
        if self.has_metadata_hint(query):
            results += self.filtered_search(query)
        
        # 路径4: 多查询分别检索（每个查询都查）
        for variant in self.query_variants(query):
            results += self.vector_db.search(variant, k=5)
        
        # 去重融合
        return self.rrf_merge(results)[:top_k]
```

## 五、Rerank 精选

```python
def retrieve_and_rerank(query, top_k=5):
    # 广召回（top-30）
    candidates = hybrid_retrieve(query, top_k=30)
    
    # Cross-Encoder精排
    reranked = cross_encoder.rerank(query, candidates)
    
    # 上下文扩展（找到相邻段落）
    expanded = []
    for doc in reranked[:top_k]:
        expanded.append(doc)
        # 加入前后相邻段落（补全被切断的语义）
        expanded += self.get_neighbors(doc, window=1)
    
    return deduplicate(expanded)
```

## 六、数据组织优化

```python
# 父子分块：检索小块精准，返回大块完整
class ParentChildDocIndex:
    def build(self, documents):
        for doc in documents:
            # 大块（保留完整上下文）
            parents = semantic_split(doc, target_size=2000)
            for parent in parents:
                # 小块（精准匹配）
                children = split(parent, size=300)
                for child in children:
                    child.metadata["parent"] = parent.id
                    self.index(child)  # 小块建索引
    
    def retrieve(self, query):
        # 检索小块
        small_hits = self.search(query, k=10)
        # 返回对应的大块
        parent_ids = {h.metadata["parent"] for h in small_hits}
        return [self.get_parent(pid) for pid in parent_ids]

# 元数据增强
def enrich_metadata(doc):
    doc.metadata.update({
        "section": extract_section(doc),      # 所属章节
        "doc_type": classify(doc),             # 文档类型
        "keywords": extract_keywords(doc),     # 关键词
        "summary": llm.summarize(doc),         # 摘要（用于另一路检索）
    })
```

## 七、参数调优

```python
# A/B测试找最优参数
param_experiments = [
    {"chunk_size": 300, "overlap": 50, "top_k": 5},
    {"chunk_size": 500, "overlap": 50, "top_k": 10},
    {"chunk_size": 300, "overlap": 100, "top_k": 5},
    {"chunk_size": 800, "overlap": 100, "top_k": 3},
]

for params in param_experiments:
    recall = evaluate_recall(test_set, **params)
    print(f"{params}: recall@5 = {recall}")

# 经验最优：
# chunk_size: 300-500（中文）
# overlap: 50-100
# recall top_k: 20（广召回）
# final top_k: 5（精排后）
```

## 八、效果评估

```python
def evaluate_recall(test_cases):
    """
    test_cases = [
        {query, relevant_doc_ids: [...]},
        ...
    ]
    """
    recalls = []
    for case in test_cases:
        retrieved = retrieve(case["query"], k=20)
        retrieved_ids = {d.id for d in retrieved}
        relevant_ids = set(case["relevant_doc_ids"])
        
        recall = len(retrieved_ids & relevant_ids) / len(relevant_ids)
        recalls.append(recall)
    
    avg_recall = sum(recalls) / len(recalls)
    
    # 分层分析
    by_difficulty = {
        "简单(事实查询)": avg,
        "中等(需理解)": avg,
        "复杂(多跳/推理)": avg,
    }
    
    return {"overall": avg_recall, "breakdown": by_difficulty}
```

## 九、优化效果（经验值）

```
优化路径与效果：

基线(向量检索top-5)           recall: 60%
+增大top_k到20               recall: 72% (+12%)
+混合检索(向量+BM25)         recall: 82% (+10%)
+查询改写                    recall: 86% (+4%)
+Rerank                     recall: 85% (-1%,但precision↑)
+父子分块                    recall: 88% (+3%)
+多查询融合                  recall: 90% (+2%)

结论：混合检索+增大top_k是最大提升
      Rerank可能recall微降但precision大幅提升（值得）
```

## 十、面试加分点

1. **全链路优化**：查询+检索+排序+数据+参数，系统性
2. **混合检索+Rerank 是黄金组合**：先广召回(混合)再精选(Rerank)
3. **父子分块**：解决"精准检索"和"上下文完整"的矛盾——进阶技巧

## 记忆要点

- 提升召回五步走：查询改写优化、多路混合检索、Rerank精排、优化分块、调参
- HyDE反向假设：先让大模型生成假设答案，再拿答案去向量库做相似度检索
- 多路融合检索：向量搜语义，BM25搜关键词，RRF算法融合去重提升长尾覆盖
- 精排保精准：粗筛后用交叉编码器Rerank，解决向量检索的噪音问题

## 苏格拉底式面试追问

> 这组追问模拟面试官层层逼问，每一问先回答"为什么"，再回答"怎么做"，最后回答"如何证明"。

### 第一层：目标与动机

**Q：你说召回率 > 85% 算优秀，但文档问答里"漏召回 = 答不出"，为什么容忍 15% 的漏召回？这 15% 的用户怎么办？**

85% 是 recall@20（前 20 个结果里的召回），不是最终答案的覆盖率。漏掉的 15% 分两类处理：一是通过多查询/查询改写在运行时补救（第一轮没召回的，改写查询后第二轮召回），实际端到端漏召率能压到 5% 以下。二是剩下真召不到的（文档里没覆盖的问题），系统走"拒答 + 转人工/记录待补充"，比硬答（幻觉）好。所以 85% 是单次检索的指标，不是用户体验指标，用户体验看的是"端到端能答对的比例"，那是 90%+。两个指标不能混。

### 第二层：证据与定位

**Q：召回率从 88% 掉到 80%，怎么定位是文档更新了没重建索引、embedding 模型不匹配新文档、还是查询改写出了 bug？**

逐层 ablation 定位。第一层：直接用原始查询（不走改写）检索，看召回率——如果原始查询召回率也掉，是检索/索引侧问题，和改写无关。第二层：检查索引是否最新——对比文档库的更新时间和索引的构建时间，如果文档新增了但索引没重建，是索引过期。第三层：如果是 embedding 不匹配（新文档用了新术语/新格式），看未召回文档的 embedding 和查询的相似度，如果新文档本身 embedding 质量差（比如文档是扫描件 OCR 出来的乱码），是数据质量问题。三层 ablation 能把问题定位到具体环节。

### 第三层：根因深挖

**Q：HyDE 你说先让 LLM 生成假设答案再去检索，但如果 LLM 对这个问题本来就不知道（才会幻觉），生成的假设答案是错的，拿错的答案去检索不是更偏吗？**

这是 HyDE 的已知局限。HyDE 的原理是"假设答案和真实答案的 embedding 比问题和答案的 embedding 更接近"（因为问题和答案的表述差异大，但答案之间表述风格相近）。这个假设在 LLM"大致知道但表述方式不同"的场景成立——LLM 生成的事实性大致正确但措辞风格化的假设答案，能匹配到文档。在 LLM"完全不知道"的场景（领域知识盲区），假设答案是幻觉，检索确实会偏。所以 HyDE 不是万能的，我的做法是"多路并列"——原始查询、改写查询、HyDE 答案三路同时检索用 RRF 融合，HyDE 锥了的路被另外两路拉回来。不是单押 HyDE。

**Q：那为什么不直接用更强的 embedding 模型（如 OpenAI 的 text-embedding-3-large），把语义鸿沟从根本上解决，还要搞查询改写这么多 trick？**

因为更强的 embedding 模型提升有天花板且带来成本。embedding 模型再强，本质是把文本压成向量，信息有损——"怎么退款"和"退货流程"的语义关系，靠 embedding 可能 cosine 只有 0.7，而查询改写直接把"怎么退款"扩展成"退款流程/退货流程/如何申请退款"多路检索，召回更直接。而且查询改写是针对业务定制的（能加领域同义词、能做指代消解），embedding 模型是通用的不懂业务。成本上，强 embedding 模型贵 + 慢，查询改写用小 LLM 一次调用成本低。所以两者是互补的——embedding 解决通用语义，查询改写解决业务定制，不是谁替代谁。

### 第四层：方案权衡

**Q：父子分块你说"检索小块返回大块"，但大块塞进上下文会增加 token 成本和 Lost in Middle 风险，怎么权衡块大小？**

父子分块的大块不是无限大，是"完整语义单元"——通常是一个段落或一个小节（800-1500 token），不是整个文档。权衡块大小看两个指标：一是答案是否完整（小块可能把答案切一半），二是 token 成本。我的做法是父块按语义切（段落/小节），子块按固定大小切（300 token）建索引。检索命中子块后返回父块，父块大小由语义决定不是拍脑袋。如果父块 > 2000 token，说明原文结构有问题（一个段落太长），要在文档预处理时拆分。所以块大小是"语义完整 vs token 成本"的权衡，甜区是父块 800-1500、子块 300，超过这个范围要么召回受损要么成本浪费。

**Q：为什么不直接把整个文档塞进长上下文模型（200K 窗口），还要搞分块检索？**

成本、延迟、精度三个原因。成本上，一个文档 50K token 塞进去一次调用几块钱，分块检索只塞 5K 是几毛钱，差 10 倍。延迟上，50K 输入的首字延迟 5-10 秒，分块检索后只塞相关段落是 1-2 秒。精度上（最关键），Lost in Middle 让长输入的中段召回率掉到 70%，而分块检索只塞"最相关的 5 段"，每段都在模型的注意力甜区，精度更高。所以即使有 200K 窗口，分块检索在成本/延迟/精度三方面都更优，长窗口只适合"必须看全文"的场景（如全文摘要），问答场景分块检索仍是最佳实践。

### 第五层：验证与沉淀

**Q：你怎么持续保证召回率不退化，尤其是文档库持续增长的情况下？**

建立"召回率回归测试 + 索引健康监控"。回归测试集是 200+ 标注好的 query-relevant_doc 对，每次索引重建或检索参数变更后全量跑，召回率回退 > 2% 拦截。索引健康监控看两个指标：索引构建延迟（文档更新后多久能检索到，保证近实时）和索引覆盖率（文档库的文档是否都进了索引，防漏建）。文档库增长时定期抽查长尾文档（新增的、不常被检索的）是否可被正确召回，因为新文档的格式/术语可能和旧的不同导致召回差。这套机制能保证召回率不随文档增长而退化。

**Q：这套 RAG 优化怎么沉淀复用？**

抽象成"RAG 中间件"，把查询优化/混合检索/Rerank/分块做成可配置的 pipeline，业务方接入只提供文档库和标注评测集。pipeline 各环节的参数（top_k、chunk_size、改写轮数）有自动调优工具——输入评测集，网格搜索最优参数组合。配套评测平台，业务方上传 query-relevant 标注就能一键算 recall/precision。这样 RAG 能力是平台化的，新业务接入几天上线，不用从零调参，且各业务的评测集能持续反哺优化默认参数。

## 结构化回答




**30 秒电梯演讲：** 像图书馆找书——好的检索词(查询优化)、多种索引方式(混合检索)、让馆员帮你挑(Rerank)、合理分类摆放(分块)。

**展开框架：**
1. **查询** — 改写/HyDE/多查询
2. **检索** — 混合(向量+BM25)
3. **排序** — Rerank精选

**收尾：** 召回率多少算好？





## 视频脚本

> 预计时长：4 分钟 | 由浅入深


| 时间 | 画面/字幕 | 口播台词 | 讲解要点 |
|------|----------|----------|----------|
| 0:00 | 标题卡：文档问答系统的检索召回率如何提升？ | "像图书馆找书——好的检索词(查询优化)、多种索引方式(混合检索)、让馆员帮你挑(…" | 开场钩子 |
| 0:20 | 核心概念图 | "文档问答召回率提升=查询优化(改写/HyDE)+混合检索(向量+BM25)+Rerank+分块优化+元数据过滤。全链路优…" | 核心定义 |
| 0:50 | 查询示意图 | "查询——改写/HyDE/多查询" | 要点拆解1 |
| 1:30 | 对比/实战案例图 | "对比一下常见误区和工程实践，看真实场景里怎么取舍。" | 实战与对比 |
| 2:20 | 总结卡 | "记住核心要点。下期我们追问：召回率多少算好？——>85%算优秀？" | 收尾与钩子 |
