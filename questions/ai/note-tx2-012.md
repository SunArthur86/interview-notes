---
id: note-tx2-012
difficulty: L3
category: ai
subcategory: RAG
tags:
- 腾讯
- 面经
- 向量库
- Milvus
- FAISS
feynman:
  essence: Milvus/FAISS/Chroma选型——FAISS是Facebook的向量检索库(单机、算法强、无服务，适合离线/嵌入式)；Chroma是轻量级(开发友好、易上手，适合原型/小规模)；Milvus是分布式向量数据库(水平扩展、高可用、多副本，适合大规模生产)。大规模生产用Milvus，原型用Chroma，算法实验用FAISS。选型看"规模+是否需分布式+运维成本"。
  analogy: FAISS像算盘(单机强、自己用)、Chroma像计算器(轻便、日常够用)、Milvus像企业ERP系统(分布式、可扩展、需要运维但能撑大规模)。
  first_principle: 向量库选型 = 规模 × 运维能力 × 功能需求。小规模原型用轻量库，大规模生产用分布式数据库。关键是"数据规模到什么量级、要不要高可用、要不要水平扩展"。
  key_points:
  - 'FAISS: 单机向量检索库，算法强，无服务，适合离线/嵌入式'
  - 'Chroma: 轻量级，开发友好，适合原型/小规模'
  - 'Milvus: 分布式向量数据库，水平扩展+高可用，大规模生产'
  - '大规模生产选Milvus，原型选Chroma，算法实验选FAISS'
  - '看维度: 规模/分布式/运维成本/功能(过滤/混合检索/多向量)'
first_principle:
  essence: 向量库选型 = 规模 × 运维 × 功能
  derivation: 小规模→轻量库够 → 大规模→需分布式 → 要高可用→需数据库 → 算法实验→库够 → 按场景选
  conclusion: 没有"最好"的向量库，只有"最匹配规模和团队能力"的
follow_up:
- Milvus 的分片和副本怎么设计？
- 向量索引选哪个（IVF/HNSW/Flat）？
- 向量库的数据更新怎么做？
---

# 【某讯面经】Milvus/FAISS/Chroma 线上选型差异，大规模生产用哪个？

## 一、三者定位对比

| 维度 | FAISS | Chroma | Milvus |
|------|-------|--------|--------|
| 定位 | 向量检索**库** | 轻量**向量数据库** | 分布式**向量数据库** |
| 来源 | Meta（Facebook） | Chroma 公司 | Zilliz（CNCF） |
| 部署 | 单机库（嵌入式） | 单机/轻量服务 | 分布式集群 |
| 规模 | 千万级（单机） | 百万级 | **十亿级**（分布式） |
| 高可用 | ❌ 无 | ❌ 弱 | ✅ 多副本 |
| 水平扩展 | ❌ | ❌ | ✅ 分片 |
| 运维成本 | 低（库） | 低（轻量） | 高（集群） |
| 混合检索 | ❌（需自己组合） | ✅ | ✅ |
| 元数据过滤 | ❌（需自己实现） | ✅ | ✅ |
| 适合 | 算法实验/离线 | 原型/小规模 | **大规模生产** |

## 二、FAISS：算法强的单机库

```python
import faiss
import numpy as np

# 建索引
dim = 768
index = faiss.IndexFlatIP(dim)  # 内积（cosine）
index.add(np.array(embeddings).astype('float32'))

# 检索
D, I = index.search(query_vec, k=5)
```

**优势**：
- 算法最全（Flat/IVF/HNSW/PQ/SCANN...）
- 单机性能极致（C++ 实现）
- 无服务，嵌入式集成

**劣势**：
- 无服务化（要自己封装 API）
- 无高可用/水平扩展
- 无元数据过滤（要自己实现）
- 数据更新麻烦（多数索引要重建）

**适合**：算法实验、离线批量检索、嵌入式场景。

## 三、Chroma：轻量开发友好

```python
import chromadb
client = chromadb.Client()
collection = client.create_collection("docs")

# 带 metadata 插入
collection.add(
    embeddings=[[...]],
    documents=["text"],
    metadatas=[{"source": "wiki"}]
)

# 检索（带过滤）
results = collection.query(
    query_embeddings=[[...]],
    where={"source": "wiki"},
    n_results=5
)
```

**优势**：
- 开发体验好（Pythonic API）
- 自带元数据过滤
- 单文件存储，易部署
- 适合快速原型

**劣势**：
- 规模上限低（百万级吃力）
- 无高可用
- 性能不如 FAISS/Milvus

**适合**：原型开发、小规模应用、本地知识库。

## 四、Milvus：大规模生产首选

```python
from pymilvus import connections, Collection
connections.connect(host="milvus-host", port="19530")

collection = Collection("knowledge_base")
# 带过滤检索
results = collection.search(
    data=[query_vec],
    anns_field="embedding",
    param={"metric_type": "IP", "params": {"nprobe": 10}},
    expr="user_id == '123' and source == 'wiki'",  # 元数据过滤
    limit=5
)
```

**优势**：
- **分布式**（分片 + 副本，水平扩展到十亿级）
- **高可用**（多副本、故障转移）
- **混合检索**（向量 + 标量过滤）
- **多索引**（IVF/HNSW/DiskANN...）
- **云原生**（K8s 部署，CNCF 项目）
- 数据实时更新（不像 FAISS 要重建）

**劣势**：
- 运维复杂（集群部署）
- 资源占用大
- 学习曲线

**适合**：**大规模生产**（亿级向量、高并发、要高可用）。

## 五、大规模生产选 Milvus 的理由

```
当你的场景满足以下任一：
  ✅ 向量数 > 1亿
  ✅ QPS > 1000
  ✅ 需要高可用（不能因单机挂了不可用）
  ✅ 需要水平扩展（数据持续增长）
  ✅ 需要实时更新（不停服加数据）
→ 选 Milvus
```

**腾讯内部场景**：混元的知识库、社交图谱、推荐召回——都是亿级向量 + 高并发，用 Milvus（或自研类似系统）。

## 六、向量索引选择

| 索引 | 原理 | 适合 |
|------|------|------|
| **Flat** | 暴力遍历 | 数据小（<10万），100%召回 |
| **IVF** | 聚类分桶，查近邻桶 | 中等规模，召回/速度可调 |
| **HNSW** | 层次化近邻图 | **主流选择**，召回高速度快 |
| **PQ/IVF-PQ** | 乘积量化压缩 | 内存敏感，牺牲精度 |
| **DiskANN** | 磁盘索引 | 超大规模，内存装不下 |

**生产推荐**：HNSW（召回和速度平衡好）。

## 七、加分点

- 说出 **FAISS 是库不是数据库**：无服务化、无高可用，要自己封装
- 说出 **Milvus 是 CNCF 项目**：云原生、K8s 部署、社区活跃
- 说出 **HNSW 是当前主流索引**：图结构，召回高、速度快，但内存占用大

## 八、雷区

- ❌ "生产用 FAISS" → 无高可用，单机挂了全挂
- ❌ "亿级数据用 Chroma" → 扛不住
- ❌ "所有场景都用 HNSW" → 内存敏感场景该用 PQ/DiskANN

## 九、扩展

- **Qdrant / Weaviate / pgvector**：其他主流向量库。pgvector 直接用 Postgres 扩展（适合已有 PG 的团队）
- **多向量检索**：ColBERT 风格（每个 token 一个向量），Milvus 2.4+ 支持
- **向量库 + 关系库联动**：向量库做召回，Postgres 存结构化数据，按 id 关联
