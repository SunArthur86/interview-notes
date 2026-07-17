---
id: note-bd3-013
difficulty: L3
category: ai
subcategory: RAG
tags:
- 字节跳动
- 面经
- 二面
feynman:
  essence: 召回变差需从数据链路逐层排查——文档更新→切片偏移→embedding漂移→索引退化→查询分布变化
  analogy: 像图书馆找书变难了——可能是新书没编目(数据缺失)、书架号变了(切片偏移)、目录索引太旧(索引退化)、或者你找的书换了个名字(Query漂移)
  first_principle: RAG召回质量 = f(文档完整性, 向量索引质量, Query表达质量)。任一环节退化都会导致召回质量下降
  key_points:
  - '数据层: 新文档未索引、旧文档已删除但向量残留'
  - '切片层: 文档格式变化导致切分不一致'
  - '向量层: Embedding模型版本不一致、向量精度损失'
  - '查询层: 用户查询模式偏移、领域术语变化'
first_principle:
  essence: 向量检索的准确性依赖于查询向量和文档向量在同一嵌入空间中的一致性
  derivation: cosine_sim(q, d) = cos(emb(q), emb(d))。如果emb(q)和emb(d)不在同一空间（模型版本不同、分词器变化、文档预处理不一致），相似度计算结果就会失真
  conclusion: 召回退化排查应从"向量空间一致性"出发，逐步检查数据预处理→embedding→索引→查询全链路
follow_up:
- 如何设置召回质量的告警阈值？
- 向量数据库的索引（如HNSW）参数退化怎么发现？
- 如何设计A/B测试比较新旧RAG管道？
memory_points:
- 退化主因：索引层HNSW参数退化与长期增量更新导致的碎片化
- 致命暗坑：文档已删但向量残留，导致返回幽灵数据
- 更新机制：构建增量同步管道，坚决拒绝无脑全量重建
- 版本强控：Embedding模型升级必须重刷全量，混用新老向量会导致精度崩塌
---

# RAG系统运行一段时间后召回效果变差，可能有哪些原因？如何设计知识更新机制？

> 来源：字节跳动大模型技术面试二面

## 召回退化排查清单（按优先级）

```
┌─────────────────────────────────────────────────────────┐
│              RAG召回退化排查决策树                        │
│                                                         │
│                    召回质量下降                           │
│                         │                               │
│              ┌──────────┼──────────┐                    │
│              ▼          ▼          ▼                    │
│          数据层      索引层      查询层                   │
│              │          │          │                    │
│  ┌───────────┤  ┌───────┤  ┌──────┤                    │
│  │文档未更新  │  │HNSW   │  │Query  │                   │
│  │旧向量残留  │  │参数退化│  │漂移   │                   │
│  │格式不一致  │  │向量精度│  │领域变化│                   │
│  └───────────┘  └───────┘  └──────┘                    │
└─────────────────────────────────────────────────────────┘
```

### 1. 数据层问题

| 问题 | 症状 | 排查方法 | 解决方案 |
|------|------|---------|---------|
| 新文档未索引 | 最新内容搜不到 | 对比文档存储和向量库数量 | 建立增量同步管道 |
| 旧文档已删但向量残留 | 返回已删除的内容 | 检查orphan vectors | 删除时同步清理向量 |
| 文档格式变化 | 同类文档召回率不稳定 | 检查预处理pipeline | 统一预处理流程 |
| 文档版本冲突 | 旧信息覆盖新信息 | 检查doc_id去重 | 版本号+时间戳排序 |

### 2. 索引层问题

| 问题 | 症状 | 排查方法 | 解决方案 |
|------|------|---------|---------|
| HNSW参数退化 | 召回率随时间下降 | 对比重建索引 vs 增量索引 | 定期重建索引 |
| 向量精度损失 | 相似度分数异常 | 检查存储精度(fp16 vs fp32) | 使用一致精度 |
| Embedding模型不一致 | 混用旧/新向量 | 记录模型版本tag | 全量重新向量化 |
| 索引碎片化 | 查询延迟增加 | 监控索引健康度 | 定期compact |

```python
# 排查脚本: 检查向量库健康度
def diagnose_vector_store(vector_store, sample_queries):
    issues = []
    
    # 1. 检查orphan vectors (文档已删除但向量还在)
    all_vectors = vector_store.list_ids()
    doc_ids = set(doc_store.list_ids())
    orphan = [v for v in all_vectors if v.doc_id not in doc_ids]
    if orphan:
        issues.append(f"发现 {len(orphan)} 个orphan vectors")
    
    # 2. 检查embedding版本一致性
    versions = vector_store.get_metadata_values("embedding_version")
    if len(set(versions)) > 1:
        issues.append(f"发现 {len(set(versions))} 个embedding版本: {set(versions)}")
    
    # 3. 抽样检查召回质量
    for q in sample_queries:
        results = vector_store.search(emb(q), top_k=5)
        if not results or results[0].score < 0.3:
            issues.append(f"Query '{q}' 召回质量低: top1_score={results[0].score if results else 'None'}")
    
    # 4. 检查索引大小vs原始数据
    total_chunks = len(all_vectors)
    expected = doc_store.count() * 5  # 估计每文档5个chunk
    if total_chunks < expected * 0.9:
        issues.append(f"向量数量({total_chunks})低于预期({expected})")
    
    return issues
```

### 3. 查询层问题

| 问题 | 症状 | 排查方法 | 解决方案 |
|------|------|---------|---------|
| 查询分布漂移 | 新领域问题召回差 | 分析查询日志主题分布 | 扩充领域知识库 |
| 术语不一致 | 用户词和文档词不匹配 | Query-Doc词汇重叠分析 | Query改写/同义词扩展 |
| 查询过短/过长 | 极端长度召回差 | 统计query长度分布 | Query预处理标准化 |
| 多语言混合 | 跨语言召回差 | 检测query语言 | 多语言embedding模型 |

## 知识更新机制设计

```
┌──────────────────────────────────────────────────────────────┐
│              实时增量知识更新架构                               │
│                                                              │
│  ┌─────────┐     ┌──────────────┐     ┌──────────────┐      │
│  │ 文档源   │────→│ 变更检测      │────→│ 预处理队列    │      │
│  │ (CMS/DB) │     │ (Webhook/轮询)│     │ (异步处理)   │      │
│  └─────────┘     └──────┬───────┘     └──────┬───────┘      │
│                         │                    │              │
│                         ▼                    ▼              │
│                  ┌──────────────┐    ┌──────────────┐       │
│                  │ 变更日志      │    │ 切分+向量化   │       │
│                  │ (审计trail)   │    │ (Worker池)   │       │
│                  └──────────────┘    └──────┬───────┘       │
│                                             │               │
│                              ┌──────────────┼────────┐      │
│                              ▼              ▼        ▼      │
│                    ┌──────────┐  ┌──────────┐ ┌──────────┐  │
│                    │ 向量DB   │  │ 全文索引  │ │ 图谱索引 │  │
│                    │ (语义)   │  │ (关键词)  │ │ (关系)   │  │
│                    └──────────┘  └──────────┘ └──────────┘  │
│                         │              │          │          │
│                         └──────────────┼──────────┘          │
│                                        ▼                     │
│                              ┌──────────────┐               │
│                              │  混合检索     │               │
│                              │  (实时)      │               │
│                              └──────────────┘               │
└──────────────────────────────────────────────────────────────┘
```

```python
class KnowledgeUpdateSystem:
    """保证系统实时性和准确性的知识更新机制"""
    
    def __init__(self):
        self.vector_store = None
        self.doc_store = None
        self.embedding_model = None
        self.version = "v2.1"  # 当前embedding模型版本
    
    async def on_document_change(self, event):
        """文档变更时的实时处理"""
        
        if event.type == "created":
            await self._add_document(event.document)
        elif event.type == "updated":
            await self._update_document(event.document)
        elif event.type == "deleted":
            await self._delete_document(event.doc_id)
    
    async def _add_document(self, doc):
        """增量添加"""
        chunks = self._chunk(doc)
        embeddings = self._embed(chunks, version=self.version)
        
        self.vector_store.upsert(
            ids=[f"{doc.id}_{i}" for i in range(len(chunks))],
            vectors=embeddings,
            metadata=[{
                "doc_id": doc.id,
                "chunk_idx": i,
                "chunk_text": chunk,
                "embedding_version": self.version,
                "timestamp": doc.updated_at,
            } for i, chunk in enumerate(chunks)]
        )
    
    async def _update_document(self, doc):
        """增量更新: 先删旧chunks, 再插新chunks"""
        # 1. 删除旧chunks
        self.vector_store.delete(filter={"doc_id": doc.id})
        # 2. 重新添加
        await self._add_document(doc)
    
    async def full_rebuild(self):
        """全量重建: 用于embedding升级或大规模数据修正"""
        all_docs = self.doc_store.list()
        self.vector_store.clear()
        
        # 批量处理
        batch_size = 100
        for i in range(0, len(all_docs), batch_size):
            batch = all_docs[i:i+batch_size]
            for doc in batch:
                await self._add_document(doc)
        
        # 更新索引
        self.vector_store.rebuild_index()
    
    def health_check(self):
        """定期健康检查"""
        # 1. 向量数量 vs 文档数量
        # 2. embedding版本一致性
        # 3. orphan向量清理
        # 4. 抽样召回质量测试
        # 5. 索引碎片化检查
        pass
```

## 监控与告警

```python
# 关键监控指标
metrics = {
    "recall_at_5": {
        "description": "Top-5召回率",
        "threshold": 0.85,
        "alert": "召回率低于85%"
    },
    "index_size": {
        "description": "向量索引大小",
        "check": "向量数 ≈ 文档数 × 预期chunk数"
    },
    "query_latency_p99": {
        "description": "99%查询延迟",
        "threshold": "100ms"
    },
    "embedding_version_consistency": {
        "description": "embedding版本一致性",
        "threshold": "100%同一版本"
    }
}
```

**面试加分点**：提到混合检索（向量+BM25+重排序）可以缓解单一检索方式的退化；提到HNSW索引的`ef_construction`和`ef_search`参数会影响索引质量和查询性能；提到使用Canary查询集（100条标注好的query-doc pair）定期自动评估召回质量；提到双写策略（新旧索引并行运行一段时间）可以安全地进行embedding模型升级。

## 记忆要点

- 退化主因：索引层HNSW参数退化与长期增量更新导致的碎片化
- 致命暗坑：文档已删但向量残留，导致返回幽灵数据
- 更新机制：构建增量同步管道，坚决拒绝无脑全量重建
- 版本强控：Embedding模型升级必须重刷全量，混用新老向量会导致精度崩塌

## 苏格拉底式面试追问

> 这组追问模拟面试官层层逼问，每一问先回答"为什么"，再回答"怎么做"，最后回答"如何证明"。

### 第一层：目标与动机

**Q：召回变差你说排查"文档更新 → 切片偏移 → embedding 漂移 → 索引退化 → 查询分布变化"。为什么不直接全量重建索引（一步解决），省得逐层排查？**

全量重建能解决"索引退化"但治标不治本，且成本高。如果召回差的根因是"embedding 漂移"（模型升级后老向量和新 query 不匹配），全量重建索引（用老 embedding 重建）不解决问题——老向量和新 query 仍不匹配，要换新 embedding 重建（全量重刷 embedding，成本极高）。如果根因是"查询分布变化"（用户开始问新类型的问题，老索引没覆盖），全量重建也不解决（索引内容没变）。逐层排查是为了"找到根因，对症下药"——索引退化就重建索引（局部），embedding 漂移就重刷 embedding（全量），查询分布变化就扩文档/调召回策略。盲目全量重建可能"白费功夫"（根因没解决，重建后仍差）。且全量重建耗时长（百万文档几小时），期间服务受影响，不能轻易做。

### 第二层：证据与定位

**Q：召回变差，你怎么区分是"索引退化"（HNSW 结构变差）还是"embedding 漂移"（向量本身变了）？**

对比"当前索引的召回"和"暴力检索的召回"。针对 golden set（已知正确答案的 query），分别用 HNSW 索引检索和暴力检索（Flat，遍历所有向量算相似度）算 Recall@K。如果 HNSW 的 Recall 远低于 Flat（如 HNSW 0.7、Flat 0.95），是"索引退化"（HNSW 的图结构变差，漏召回），重建 HNSW 索引即可。如果 HNSW 和 Flat 的 Recall 都低（如都 0.7），是"向量本身的问题"（embedding 漂移或文档问题），重建索引没用，要查 embedding（是否升级了模型导致老向量和新 query 不匹配）。另一个指标：看 golden set 里"召回失败的 query"，其正确答案在索引里是否存在（如果存在但没召回，是索引退化；如果不存在，是文档没入库或被删）。

### 第三层：根因深挖

**Q：你说"文档已删但向量残留导致幽灵数据"。这是怎么发生的？为什么不删除向量就删了文档？**

发生在"文档删除和向量删除不同步"。RAG 系统中文档存在文档库（如 MySQL/MongoDB），向量存在向量库（如 Milvus/FAISS），两者是独立的存储。删除文档时，如果只删了文档库的记录（如 `DELETE FROM documents WHERE id=X`）但没同步删向量库的对应向量，向量残留。用户检索时，向量库召回残留向量，但文档库查不到对应文档（已删），返回"幽灵数据"（向量指向不存在的文档）或报错。根因是"删除操作不是原子的"——文档库和向量库的删除分别提交，中间可能失败（如文档库删了，向量库删除时网络超时失败）。解决方法：一是"软删除 + 标记"——文档库标记 deleted=true，向量库不立即删，检索时过滤 deleted 的（需向量库支持 metadata filter）；二是"事务/补偿"——删除时先标记，后台异步清理向量，失败重试；三是"定期对账"——定期扫描向量库，检查每个向量的 doc_id 是否在文档库存在，不存在则删向量。

**Q：那为什么不直接用同一个数据库存文档和向量（如 PostgreSQL + pgvector），保证原子删除？**

单一数据库能保证原子性但扩展性受限。PostgreSQL + pgvector 确实能在同一事务里删文档和向量（原子性保证），开发简单。但局限：一是规模受限——pgvector 的 ANN 检索（HNSW）在百万级向量时性能下降（PostgreSQL 不是专门的向量库，优化不如 Milvus/Qdrant）；二是功能受限——pgvector 的 ANN 参数（如 ef_search）调优不如专业向量库灵活，混合检索（向量 + 关键词）支持弱；三是资源竞争——文档查询和向量检索在同一数据库，资源竞争（向量检索是计算密集，影响文档查询）。生产级大规模 RAG（千万级文档）用专业向量库（Milvus/Qdrant，高性能 ANN），文档用文档库（PostgreSQL/MongoDB），两者分离。原子删除问题用"应用层补偿 + 定期对账"解决。小规模 RAG（<百万）用 pgvector 够用，简单可靠。

### 第四层：方案权衡

**Q：embedding 模型升级（如从 text-ada-002 换 bge-m3），你说"必须重刷全量向量"。为什么不混合使用（老文档老向量，新文档新向量）？**

embedding 模型不同则向量空间不同，混用导致召回错乱。text-ada-002 和 bge-m3 的向量空间完全不同（训练数据、模型架构、维度都不同），同一个文档在两个模型下的向量"不可比"（余弦相似度无意义）。如果索引里混了老向量（ada）和新向量（bge），用户 query 用 bge 编码，检索时 bge query 和 ada 向量的相似度无意义（不同空间），老文档的召回完全随机（可能召回不相关的老文档，漏掉相关的新文档）。所以 embedding 模型升级必须全量重刷（所有文档用新模型重新 embedding，替换老向量）。过渡方案：一是"双索引并行"——同时维护老索引（ada）和新索引（bge），新文档写入两个索引，检索时查两个索引融合（RRF），逐步迁移；二是"灰度切换"——先全量重刷新索引（后台），完成后原子切换（检索从老索引切到新索引）。绝不能"混用"。

**Q：为什么不直接冻结 embedding 模型（永远不升级），省得全量重刷？**

冻结模型导致技术债。embedding 模型在不断进步（bge-m3 比早期的 ada-002 在中文检索上好很多，Recall 高 10-20%），永不升级意味着召回质量停滞，竞品用新模型持续超越你。且业务发展可能需要"多语言支持"（早期模型只支持英文，业务扩展到中文要换多语言模型）。全量重刷的成本虽高（百万文档几小时 + 计算资源），但相比"长期召回质量差"的损失（用户体验差、流失），重刷是值得的。正确做法：一是"定期评估新模型"（如每半年测一次新模型，如果 Recall 提升 >5% 考虑升级）；二是"做好重刷的基础设施"（全量重刷的流水线、双索引过渡机制），让升级成本可控；三是"embedding 模型作为 RAG 系统的可插拔组件"，升级时能快速切换。

### 第五层：验证与沉淀

**Q：你怎么证明召回变差的原因找对了（如确认是索引退化而非 embedding）？**

验证"修复后召回恢复"。如果定位是"索引退化"，重建索引后 Recall@K 应恢复（如从 0.7 回到 0.95），如果没恢复，说明根因不是索引（可能是 embedding 或文档问题）。如果定位是"幽灵数据"，清理残留向量后，"返回不存在文档"的错误率应降到 0。验证方法：维护 golden set（固定测试集），定期跑 Recall@K 作为基线，召回变差时 golden set 的分数降，修复后应恢复到基线。做"根因注入测试"——故意制造已知问题（如手动删除一些文档但不删向量，模拟幽灵数据），看召回是否变差（验证幽灵数据的影响），修复后恢复。关键是要有"持续的召回质量监控"（每日/每周跑 golden set，画 Recall 趋势），变差时及时发现，而非等用户反馈。

**Q：召回质量监控和退化排查怎么沉淀成 RAG 系统的标配？**

固化成"RAG 健康监控体系"：一是召回质量监控（每日跑 golden set，算 Recall@K/nDCG，画趋势，降 5% 告警）；二是数据一致性监控（文档库和向量库的对账，发现幽灵数据）；三是 embedding 版本管理（记录每个向量的 embedding 模型版本，禁止混用）；四是索引健康监控（HNSW 的 Recall 对比 Flat，发现索引退化）。沉淀"常见退化的排查清单"（索引退化 → 重建；幽灵数据 → 对账清理；embedding 漂移 → 全量重刷；查询分布变化 → 扩文档）。配套运维工具（全量重刷流水线、双索引切换、对账脚本），让排查和修复标准化。把"召回质量监控"作为 RAG 系统的核心 SLI，每日关注，而非等问题爆发。

## 结构化回答

**30 秒电梯演讲：** 召回变差需从数据链路逐层排查——文档更新→切片偏移→embedding漂移→索引退化→查询分布变化——像图书馆找书变难了。

**展开框架：**
1. **数据层** — 新文档未索引、旧文档已删除但向量残留
2. **切片层** — 文档格式变化导致切分不一致
3. **向量层** — Embedding模型版本不一致、向量精度损失

**收尾：** 您想深入聊：如何设置召回质量的告警阈值？


## 视频脚本

> 预计时长：4 分钟 | 由浅入深


| 时间 | 画面/字幕 | 口播台词 | 讲解要点 |
|------|----------|----------|----------|
| 0:00 | 标题卡：RAG系统运行一段时间后召回效果变差，可能有哪些… | "像图书馆找书变难了——可能是新书没编目(数据缺失)、书架号变了(切片偏移)、目录索引太旧(…" | 开场钩子 |
| 0:20 | 核心概念图 | "召回变差需从数据链路逐层排查——文档更新→切片偏移→embedding漂移→索引退化→查询分布变化" | 核心定义 |
| 0:50 | 数据层示意图 | "数据层——新文档未索引、旧文档已删除但向量残留" | 要点拆解1 |
| 1:30 | 对比/实战案例图 | "对比一下常见误区和工程实践，看真实场景里怎么取舍。" | 实战与对比 |
| 2:20 | 总结卡 | "记住核心要点。下期我们追问：如何设置召回质量的告警阈值？" | 收尾与钩子 |
