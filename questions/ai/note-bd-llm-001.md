---
id: note-bd-llm-001
difficulty: L3
category: ai
subcategory: RAG
tags:
- 字节
- 面经
- RAG
- 检索增强生成
feynman:
  essence: RAG = 检索增强生成，先用检索找到相关知识，再用LLM生成回答。索引阶段构建可检索的知识库，检索阶段实时召回相关知识。
  analogy: 就像开卷考试——索引阶段是提前做好目录和书签，检索阶段是考试时快速翻到对应页面，生成阶段是看着书上的内容写答案。
  first_principle: LLM的参数化知识是静态的且有限的，RAG通过外挂非参数化知识库来扩展LLM的知识边界。
  key_points:
  - '索引阶段: 文档解析-切片-Embedding-入库'
  - '检索阶段: Query向量化-相似度搜索-重排序'
  - '生成阶段: 检索结果注入Prompt-LLM生成'
first_principle:
  essence: 参数化知识 vs 非参数化知识的互补
  derivation: LLM预训练知识有截止日期且不可更新→外挂向量数据库→实时检索最新知识→注入上下文
  conclusion: RAG本质是给LLM外挂了一个可实时更新的知识库
follow_up:
- 索引阶段如何选择切片策略？
- 检索阶段如何提升召回率？
- RAG和微调什么时候用哪个？
memory_points:
- 核心思想：因为LLM存在知识截止与幻觉，所以通过外挂库解耦检索与生成提供可控知识
- 三大阶段：索引阶段(离线建库)→检索阶段(在线召回Top-K)→生成阶段(组装Prompt让大模型作答)
- 索引职责：将文档解析、切片、向量化并入库，负责把原始数据转化为可高效检索的特征库
- 检索职责：在线对Query预处理并Embedding，结合向量相似度与重排序(Rerank)精准召回
- 优化目标：因为检索决定上限，所以索引重切片质量，检索重召回与精排的准确度
---

# 【字节面经】RAG 系统的整体流程是什么？索引阶段和检索阶段分别承担哪些职责？

## 一、核心概念

RAG（Retrieval-Augmented Generation，检索增强生成）的核心思想是：**在不改变LLM参数的前提下，通过外挂知识库为模型提供实时、可控的外部知识**。LLM的参数化知识存在三个固有缺陷——知识截止日期、无法实时更新、容易产生幻觉。RAG通过将"检索"和"生成"解耦，让LLM基于检索到的真实文档片段作答，显著降低幻觉率。

一个完整的RAG系统由三大阶段构成：**索引阶段（离线）→ 检索阶段（在线）→ 生成阶段（在线）**。索引阶段负责将原始文档转化为可高效检索的向量知识库，是一次性的离线构建过程；检索阶段负责在用户查询时实时召回最相关的知识片段；生成阶段将检索结果注入Prompt上下文，由LLM生成最终回答。

## 二、全流程架构图

```
┌─────────────────────────────────────────────────────────────────────┐
│                        RAG 系统全流程                                │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  ╔═══════════════════════╗     ╔════════════════════════╗          │
│  ║   索引阶段 (离线)      ║     ║   检索阶段 (在线)       ║          │
│  ║   ─────────────        ║     ║   ─────────────        ║          │
│  ║                       ║     ║                        ║          │
│  ║  ① 文档加载            ║     ║  ⑥ Query 预处理         ║          │
│  ║    (PDF/Word/HTML)     ║     ║    (改写/扩展/HyDE)     ║          │
│  ║         ↓              ║     ║         ↓              ║          │
│  ║  ② 文档解析            ║     ║  ⑦ Query Embedding     ║          │
│  ║    (提取纯文本+表格)    ║     ║    (同索引阶段模型)      ║          │
│  ║         ↓              ║     ║         ↓              ║          │
│  ║  ③ 文本切片            ║     ║  ⑧ 向量相似度检索       ║          │
│  ║    (语义/固定/递归)     ║     ║    (Top-K 召回)        ║          │
│  ║         ↓              ║     ║         ↓              ║          │
│  ║  ④ Embedding 向量化    ║     ║  ⑨ 重排序 (Rerank)     ║          │
│  ║    (bge-m3/te3等)      ║     ║    (Cross-Encoder)     ║          │
│  ║         ↓              ║     ║         ↓              ║          │
│  ║  ⑤ 向量入库            ║     ║  ⑩ 上下文组装          ║          │
│  ║    (Milvus/Qdrant)     ║     ║    (去重/压缩/排序)     ║          │
│  ╚══════════╤════════════╝     ╚════════╤═══════════════╝          │
│             │                            │                          │
│             └──────────┬─────────────────┘                          │
│                        ↓                                            │
│              ╔════════════════════════╗                             │
│              ║   生成阶段 (在线)       ║                             │
│              ║   ─────────────        ║                             │
│              ║                        ║                             │
│              ║  ⑪ Prompt 模板组装     ║                             │
│              ║    (System+Context+Q)  ║                             │
│              ║         ↓              ║                             │
│              ║  ⑫ LLM 生成回答        ║                             │
│              ║    (GPT-4/Claude/Qwen) ║                             │
│              ║         ↓              ║                             │
│              ║  ⑬ 后处理 & 引用标注    ║                             │
│              ║    (溯源/格式化)        ║                             │
│              ╚════════════════════════╝                             │
└─────────────────────────────────────────────────────────────────────┘
```

## 三、索引阶段详解（离线构建）

索引阶段是RAG的地基，其质量直接决定检索上限。核心Pipeline包含四步：

### 3.1 文档解析

将多格式文档（PDF、Word、HTML、Markdown）统一提取为结构化文本。关键挑战在于表格、图片、公式等非纯文本内容的保留。生产环境中通常使用 `unstructured`、`PyMuPDF`、`marker` 等工具。

### 3.2 文本切片（Chunking）

将长文档切分为适合Embedding的语义单元。常见策略：

| 策略 | 原理 | 适用场景 |
|------|------|----------|
| 固定长度 | 按 Token 数切割 + Overlap | 简单文本、快速原型 |
| 递归字符 | 按段落→句子→字符递归切分 | 通用场景（LangChain默认） |
| 语义切片 | 按 Markdown 标题/主题边界 | 结构化文档 |
| 文档感知 | 表格整表保留、代码按函数 | 复杂混合文档 |

切片大小的经验值：**通用QA场景 256\~512 tokens**，长文档摘要场景 1024\~2048 tokens，需配合 10\~20% 的Overlap保证上下文连续性。

### 3.3 Embedding 向量化

使用Embedding模型将每个文本块映射为高维稠密向量。选型需考虑：语言支持（中英双语）、维度（768/1024/1536/3072）、推理速度、MTEB榜单表现。详见 [note-bd-llm-002](./note-bd-llm-002.md)。

### 3.4 向量入库

将向量 + 原文 + 元数据写入向量数据库。主流选择：**Milvus**（分布式、高性能）、**Qdrant**（Rust编写、轻量高效）、**Weaviate**（支持混合检索）、**Chroma**（轻量原型）。入库时需建立HNSW索引以支撑近似最近邻搜索（ANN），通常 `M=16, efConstruction=200` 即可满足大多数场景。

## 四、检索阶段详解（在线实时）

### 4.1 Query 预处理

原始用户Query往往口语化、信息不足。常用增强手段：

- **Query Rewriting**：用LLM改写为更清晰的检索语句
- **Query Expansion**：扩展同义词/相关词增加召回
- **HyDE**（Hypothetical Document Embeddings）：先让LLM生成一个假设性答案，用该答案的Embedding去检索，缩小Query-Document之间的语义鸿沟
- **Multi-Query**：将一个Query拆分为多个子Query并行检索

### 4.2 向量相似度搜索

使用与索引阶段**相同的Embedding模型**将Query向量化，在向量数据库中执行Top-K检索（通常K=10\~50）。距离度量常用**余弦相似度**或**内积（IP）**。对于MTEB排名前列的bge模型，官方推荐使用Cosine。

### 4.3 重排序（Rerank）

向量检索是**双塔模型（Bi-Encoder）**，速度快但精度有限。Rerank阶段使用**交叉编码器（Cross-Encoder）**对Top-K候选逐个打分精排，大幅提升精度：

- **原理**：Cross-Encoder将Query和Document拼接后联合编码，捕获细粒度交互特征
- **模型**：`bge-reranker-v2-m3`、`cohere-rerank-3`、`jina-reranker-v2`
- **策略**：从Top-50中精排出Top-5注入Prompt

### 4.4 上下文组装与Prompt注入

将重排后的Top-N文档片段按相关性排序，注入到Prompt模板中。关键技巧：

- **Lost in the Middle 问题**：LLM对长上下文中间位置的信息容易忽略，需将最相关的内容放在Prompt首尾
- **上下文压缩**：对过长的文档块做摘要/抽取关键句
- **元数据过滤**：利用文档元数据（时间、来源、作者）做预过滤，缩小检索范围

## 五、完整 Python 代码实现

```python
"""
RAG 系统完整 Pipeline（索引 + 检索 + 生成）
依赖: pip install llama-index qdrant-client sentence-transformers openai
"""
import os
from dataclasses import dataclass
from typing import Optional

from qdrant_client import QdrantClient
from qdrant_client.models import Distance, VectorParams, PointStruct
from sentence_transformers import SentenceTransformer
from openai import OpenAI


# ============================================================
# 配置
# ============================================================
EMBEDDING_MODEL = "BAAI/bge-m3"
RERANKER_MODEL = "BAAI/bge-reranker-v2-m3"
LLM_MODEL = "gpt-4o-mini"
COLLECTION_NAME = "knowledge_base"
VECTOR_DIM = 1024


# ============================================================
# 索引阶段
# ============================================================
class IndexingPipeline:
    """索引阶段：文档 → 切片 → Embedding → 入库"""

    def __init__(self):
        self.embedder = SentenceTransformer(EMBEDDING_MODEL)
        self.qdrant = QdrantClient(host="localhost", port=6333)
        self._init_collection()

    def _init_collection(self):
        """初始化向量集合"""
        collections = self.qdrant.get_collections().collections
        if COLLECTION_NAME not in [c.name for c in collections]:
            self.qdrant.create_collection(
                collection_name=COLLECTION_NAME,
                vectors_config=VectorParams(
                    size=VECTOR_DIM,
                    distance=Distance.COSINE,
                ),
            )

    def load_and_chunk(self, text: str, chunk_size: int = 512,
                       overlap: int = 64) -> list[str]:
        """
        递归字符切片：按段落 → 句子 → 字符 层级递归
        """
        chunks = []
        sentences = text.replace("\n\n", "\n").split("。")
        sentences = [s.strip() for s in sentences if s.strip()]

        current_chunk = ""
        for sent in sentences:
            sent_with_period = sent + "。"
            if len(current_chunk) + len(sent_with_period) <= chunk_size:
                current_chunk += sent_with_period
            else:
                if current_chunk:
                    chunks.append(current_chunk)
                # overlap: 保留上一块尾部
                if chunks and overlap > 0:
                    current_chunk = chunks[-1][-overlap:] + sent_with_period
                else:
                    current_chunk = sent_with_period
        if current_chunk:
            chunks.append(current_chunk)
        return chunks

    def embed(self, texts: list[str]) -> list[list[float]]:
        """批量向量化（bge-m3 推荐 query 前加 prompt 但通用检索可省略）"""
        vectors = self.embedder.encode(
            texts, normalize_embeddings=True, batch_size=32
        )
        return vectors.tolist()

    def index(self, text: str, metadata: Optional[dict] = None):
        """完整索引流程"""
        # Step 1: 切片
        chunks = self.load_and_chunk(text)
        print(f"[Index] 切片完成: {len(chunks)} 个chunk")

        # Step 2: 向量化
        vectors = self.embed(chunks)
        print(f"[Index] Embedding完成: {len(vectors)} 个向量")

        # Step 3: 入库（向量 + 原文 + 元数据）
        points = [
            PointStruct(
                id=i,
                vector=vectors[i],
                payload={
                    "text": chunks[i],
                    "chunk_index": i,
                    **(metadata or {}),
                },
            )
            for i in range(len(chunks))
        ]
        self.qdrant.upsert(collection_name=COLLECTION_NAME, points=points)
        print(f"[Index] 入库完成: {len(points)} 条记录")


# ============================================================
# 检索阶段
# ============================================================
class RetrievalPipeline:
    """检索阶段：Query → 向量化 → 检索 → 重排 → 组装"""

    def __init__(self):
        self.embedder = SentenceTransformer(EMBEDDING_MODEL)
        self.reranker = SentenceTransformer(RERANKER_MODEL)
        self.qdrant = QdrantClient(host="localhost", port=6333)

    def retrieve(self, query: str, top_k: int = 20) -> list[dict]:
        """向量检索 Top-K"""
        query_vec = self.embedder.encode(
            [query], normalize_embeddings=True
        )[0].tolist()

        results = self.qdrant.search(
            collection_name=COLLECTION_NAME,
            query_vector=query_vec,
            limit=top_k,
            with_payload=True,
        )
        return [
            {"text": hit.payload["text"], "score": hit.score}
            for hit in results
        ]

    def rerank(self, query: str, candidates: list[dict],
               top_n: int = 5) -> list[dict]:
        """Cross-Encoder 重排序"""
        pairs = [[query, c["text"]] for c in candidates]
        scores = self.reranker.predict(pairs)

        ranked = sorted(
            zip(candidates, scores), key=lambda x: x[1], reverse=True
        )[:top_n]
        return [{**c, "rerank_score": float(s)} for c, s in ranked]

    def search(self, query: str, top_k: int = 20, top_n: int = 5):
        """检索 + 重排完整流程"""
        candidates = self.retrieve(query, top_k)
        reranked = self.rerank(query, candidates, top_n)
        return reranked


# ============================================================
# 生成阶段
# ============================================================
PROMPT_TEMPLATE = """你是一个专业的知识库问答助手。请根据以下检索到的上下文回答用户问题。
如果上下文中没有相关信息，请明确说"根据现有知识库无法回答"，不要编造。

## 上下文
{context}

## 用户问题
{question}

## 回答（请在回答中标注引用来源编号 [1] [2] 等）"""


class GenerationPipeline:
    """生成阶段：组装Prompt → LLM生成"""

    def __init__(self):
        self.llm = OpenAI(api_key=os.getenv("OPENAI_API_KEY"))

    def generate(self, query: str, retrieved_docs: list[dict]) -> str:
        # 组装上下文（按重排分数降序，最相关的放前面）
        context = "\n\n".join(
            f"[{i+1}] (score={d['rerank_score']:.4f}) {d['text']}"
            for i, d in enumerate(retrieved_docs)
        )
        prompt = PROMPT_TEMPLATE.format(context=context, question=query)

        response = self.llm.chat.completions.create(
            model=LLM_MODEL,
            messages=[{"role": "user", "content": prompt}],
            temperature=0.1,  # 低温度保证事实性
            max_tokens=1024,
        )
        return response.choices[0].message.content


# ============================================================
# 端到端调用
# ============================================================
if __name__ == "__main__":
    # --- 索引阶段（离线执行一次） ---
    indexer = IndexingPipeline()
    sample_doc = """
    向量数据库是一种专门用于存储和检索高维向量的数据库系统。
    它通过近似最近邻（ANN）算法实现高效的相似度搜索。
    主流向量数据库包括Milvus、Qdrant、Weaviate和Chroma。
    Milvus是开源的分布式向量数据库，支持十亿级向量检索。
    Qdrant使用Rust编写，在性能和资源消耗方面表现优秀。
    """.strip()
    indexer.index(sample_doc, metadata={"source": "vector-db-intro.pdf"})

    # --- 检索 + 生成（在线实时） ---
    retriever = RetrievalPipeline()
    generator = GenerationPipeline()

    query = "有哪些主流的向量数据库？"
    retrieved = retriever.search(query, top_k=10, top_n=3)
    answer = generator.generate(query, retrieved)

    print(f"\n用户问题: {query}")
    print(f"检索到 {len(retrieved)} 条相关知识")
    print(f"LLM回答:\n{answer}")
```

## 六、面试加分点

1. **索引和检索阶段可以独立优化**：索引阶段关注切片质量和Embedding效果，检索阶段关注召回率和重排精度，两者解耦便于A/B实验。
2. **混合检索（Hybrid Search）**：纯向量检索对精确匹配（如产品型号、人名）较弱，实际生产中常结合**BM25关键词检索 + 向量检索**做融合排序（RRF算法）。
3. **Self-RAG / Corrective RAG**：前沿方向——让LLM自主判断是否需要检索、检索结果是否相关，对低质量检索结果做二次检索或拒绝回答。
4. **索引更新策略**：增量索引（新增文档实时入库）+ 全量重建（定期重建保证一致性）相结合；注意Embedding模型升级时需要全量重新向量化。
5. **可观测性**：生产RAG系统必须监控检索命中率、上下文利用率、答案引用准确率等指标，建议接入LangSmith / Phoenix等RAG可观测平台。
6. **成本控制**：Rerank阶段是计算瓶颈，可通过先向量粗筛→轻量Reranker精排→重量Reranker终排的级联策略平衡延迟与精度。

## 记忆要点

- 核心思想：因为LLM存在知识截止与幻觉，所以通过外挂库解耦检索与生成提供可控知识
- 三大阶段：索引阶段(离线建库)→检索阶段(在线召回Top-K)→生成阶段(组装Prompt让大模型作答)
- 索引职责：将文档解析、切片、向量化并入库，负责把原始数据转化为可高效检索的特征库
- 检索职责：在线对Query预处理并Embedding，结合向量相似度与重排序(Rerank)精准召回
- 优化目标：因为检索决定上限，所以索引重切片质量，检索重召回与精排的准确度

## 苏格拉底式面试追问

> 这组追问模拟面试官层层逼问，每一问先回答"为什么"，再回答"怎么做"，最后回答"如何证明"。

### 第一层：目标与动机

**Q：RAG 为什么要把索引和检索分成离线和在线两个阶段，而不是实时检索原始文档？**

性能和成本。实时检索原始文档（对 query 和所有文档算相似度）在百万文档库下要秒级甚至分钟级，不可用。索引阶段离线把文档转成向量存进 ANN 索引（如 HNSW），预先构建好"可快速检索的结构"；检索阶段在线只对 query 编码一次（几十毫秒）+ 索引查找（毫秒级），总延迟 <100ms。分阶段的动机是"把昂贵的计算移到离线（只算一次），在线只做轻量查询"，这是大规模检索系统的基本设计原则。

### 第二层：证据与定位

**Q：你的 RAG 回答准确率 60%，怎么判断是索引阶段（文档没切好/向量化差）还是检索阶段（召回弱）的问题？**

用 RAGAS 的 Context Recall 定位。Context Recall 衡量"正确答案所需的 chunk 是否在召回结果里"。如果低（<0.7），是检索/索引问题——要么正确 chunk 没被召回（检索阶段 embedding 弱或 top-K 太小），要么正确 chunk 在索引里就不存在（切分把答案切坏了）。进一步区分：人工抽查若干失败 case，看"正确 chunk 是否在向量库里"——在库里但没召回是检索问题，不在库里是切分问题。

### 第三层：根因深挖

**Q：你发现索引阶段的切片把关键事实切断了（如表格被从中间切开），导致检索召回不了。根因在切片算法还是切片参数？**

通常是切片算法没做"语义感知"。固定 token 切分（如每 512 token）不看内容边界，遇到表格/列表/跨段引用就切断。根因是切分只看 token 数不看语义结构。治本是换语义感知切分：按 Markdown 标题层级切（H1/H2/H3 作为边界）、按段落切（句号/换行作为边界）、对表格整体保留不切（表格作为独立 chunk）。参数调优（如改 chunk size 从 512 到 256）治标不治本，关键是切分逻辑要理解文档结构。

**Q：那为什么不直接把每个文档作为一个 chunk（不切分），保证语义完整，省得切分丢信息？**

单文档太大无法有效检索。一篇 10 页文档可能 1 万 token，作为一个 chunk 的 embedding 被"平均"——query 命中这个 chunk 但不知道是文档的哪一部分相关，且喂给 LLM 的 context 大部分是噪声。切分的目的是"粒度匹配"——chunk 的大小和 query 答案的大小匹配（通常一个 chunk 包含一个完整事实/段落，几百 token），检索精度高。不切分是另一个极端，粒度过粗，检索信号被稀释。最优是"语义边界 + 适中粒度"（256-512 token）。

### 第四层：方案权衡

**Q：索引阶段你用 bge-m3 做向量化，为什么选它不选 OpenAI text-embedding-3？**

三个考虑：一是私有部署——企业数据不能出境调 OpenAI API，bge-m3 可自部署；二是多语言——bge-m3 原生支持中英多语言且在中文 MTEB 上表现强，OpenAI 模型中文偏弱；三是成本——自部署后边际成本为零，OpenAI 按 token 计费，百万文档索引要花上千美元。选型不是"哪个绝对好"，是"在你的约束（合规/语言/成本）下哪个合适"。如果数据可出境且是英文为主，OpenAI 省事。

**Q：为什么不直接用向量数据库自带的 embedding 功能（如 Pinecone 的托管 embedding），省得自己维护向量化流程？**

托管 embedding 绑死厂商且灵活性差。一是模型选择受限——Pinecone 只支持特定模型，换模型要重新索引全部数据；二是版本控制难——托管服务更新模型版本时你的索引可能失效，无法锁定版本；三是领域微调——如果要在自有数据上微调 embedding，托管服务不支持。自建向量化流程（文档→embedding 模型→向量库）虽然多一步维护，但模型可插拔、版本可控、可微调。工程上向化和存储解耦，不要绑死。

### 第五层：验证与沉淀

**Q：你怎么衡量 RAG 索引和检索各阶段的质量，而非只看端到端？**

索引阶段看"chunk 质量"——抽样检查 chunk 是否语义完整（没有切断）、粒度是否均匀。检索阶段看 Recall@K 和 Precision@K（在标注的 golden set 上）。生成阶段看 Faithfulness 和 Answer Relevancy。三个阶段各有指标，哪个低优化哪个。配套回归评测集，每次改动（切分/embedding/检索参数）自动跑全指标，对比前后，防止改 A 坏 B。

**Q：RAG 的三阶段架构怎么沉淀成可复用框架？**

封装成 RAG pipeline SDK：索引模块（文档解析→切分→向量化→入库，各环节可配）、检索模块（query 编码→ANN 检索→Rerank→截断）、生成模块（prompt 模板→LLM 调用→后处理）。沉淀"各文档类型的切分模板""embedding/索引/Reranker 的选型对照表""检索参数（top-K/Rerank 数）经验值"，新业务按模板配置。配套索引重建工具（embedding 换型时全量重建）和增量更新工具（新文档实时入库）。

## 结构化回答

**30 秒电梯演讲：** RAG = 检索增强生成，先用检索找到相关知识，再用LLM生成回答。索引阶段构建可检索的知识库，检索阶段实时召回相关知识——就像开卷考试。

**展开框架：**
1. **索引阶段** — 文档解析-切片-Embedding-入库
2. **检索阶段** — Query向量化-相似度搜索-重排序
3. **生成阶段** — 检索结果注入Prompt-LLM生成

**收尾：** 您想深入聊：索引阶段如何选择切片策略？


## 视频脚本

> 预计时长：4 分钟 | 由浅入深


| 时间 | 画面/字幕 | 口播台词 | 讲解要点 |
|------|----------|----------|----------|
| 0:00 | 标题卡：RAG 系统的整体流程是什么？索引阶段和检索阶段… | "就像开卷考试——索引阶段是提前做好目录和书签，检索阶段是考试时快速翻到对应页面，生成阶段是…" | 开场钩子 |
| 0:20 | 核心概念图 | "RAG = 检索增强生成，先用检索找到相关知识，再用LLM生成回答。索引阶段构建可检索的知识库，检索阶段实时召回相关知识…" | 核心定义 |
| 0:50 | 索引阶段示意图 | "索引阶段——文档解析-切片-Embedding-入库" | 要点拆解1 |
| 1:30 | 对比/实战案例图 | "对比一下常见误区和工程实践，看真实场景里怎么取舍。" | 实战与对比 |
| 2:20 | 总结卡 | "记住核心要点。下期我们追问：索引阶段如何选择切片策略？" | 收尾与钩子 |
