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

