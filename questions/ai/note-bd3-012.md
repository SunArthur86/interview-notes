---
id: note-bd3-012
difficulty: L3
category: ai
subcategory: RAG
tags:
  - 字节跳动
  - 面经
  - 二面
feynman:
  essence: Chunk切分是RAG的"颗粒度调节器"——太大召回噪声多，太小丢失上下文。最优策略取决于文档结构和业务需求
  analogy: '像切蛋糕——切太大一坨吃不下（检索噪声多），切太小碎渣到处是（语义不完整）。要沿着蛋糕的"自然纹理"（段落边界）切，每块大小正好一口吃'
  first_principle: 'RAG检索的基本单位是chunk。chunk大小决定检索精度和上下文完整性的trade-off：小chunk定位精准但缺乏上下文，大chunk信息完整但引入噪声'
  key_points:
    - '固定切分: 简单但可能切断语义'
    - '语义切分: 按段落/句子边界，保留语义完整性'
    - '常见范围: 256-512 tokens，overlap 10-20%'
    - '过大: 噪声多、embedding不精确、Token浪费'
    - '过小: 上下文断裂、检索到碎片化信息'
first_principle:
  essence: Embedding模型对输入长度有最优范围，过长则语义被稀释，过短则信息不足
  derivation: 'Embedding本质是将文本压缩为稠密向量。固定维度的向量有信息容量上限：256-512 tokens的文本段能产生语义最集中的向量表示。超出这个范围，embedding开始"平均化"，检索精度下降'
  conclusion: Chunk大小应该匹配embedding模型的最优输入范围（通常256-512 tokens），并用overlap保证跨chunk的语义连续性
follow_up:
  - 如何处理表格和图片的切分？
  - 递归切分(Recursive Splitting)是什么？
  - 如何评估chunk质量对RAG效果的影响？
---

# 如何确定Chunk的大小和切分策略？过大或过小分别会带来什么问题？

> 来源：字节跳动大模型技术面试二面

## 完整RAG流程中的Chunk定位

```
┌─────────────────────────────────────────────────────────┐
│                   RAG 系统流程                           │
│                                                         │
│  文档 ──→ 切分(Chunking) ──→ 向量化(Embedding)          │
│                                    │                    │
│                                    ▼                    │
│           重排序 ←── 检索 ←── 向量数据库                 │
│              │                                          │
│              ▼                                          │
│         上下文组装 ──→ LLM生成 ──→ 回答                  │
│                                                         │
│  ★ Chunk切分是第一步，直接决定后续所有环节的质量           │
└─────────────────────────────────────────────────────────┘
```

## 切分策略全景

### 1. 固定大小切分 (Fixed-Size Chunking)

```
原始文档: ████████████████████████████████████████████

固定512 tokens:
  [████████████████████] [████████████████████] [██████████]
  
带overlap (50 tokens):
  [████████████████████]
                    [████████████████████]  ← 重叠区
                                [████████████████████]

优点: 实现简单，易于并行处理
缺点: 可能在句子中间切断，破坏语义
```

### 2. 语义切分 (Semantic Chunking)

```
策略A: 按段落切分
  ┌─────────────────────┐  ┌─────────────────────┐
  │ 第一段: 完整的语义   │  │ 第二段: 另一个话题   │
  │ 按自然段落分块       │  │                     │
  └─────────────────────┘  └─────────────────────┘

策略B: 按句子+合并
  Step 1: 按句子切分 (Sentence Tokenizer)
  Step 2: 合并相邻句子直到接近目标大小 (如400 tokens)
  Step 3: 在句子边界处切分

策略C: 语义相似度切分
  计算相邻句子的embedding余弦相似度
  当相似度 < 阈值时切分 (话题转换点)
  
  句子1 ──0.85── 句子2 ──0.82── 句子3 ──0.45── 句子4
                                            ↑ 这里切分!
```

### 3. 结构化切分 (Structure-Aware)

```
Markdown文档:
  # 标题1          ← 作为chunk的metadata
  ## 子标题1       ← 切分点
  正文段落...
  ## 子标题2       ← 切分点
  正文段落...

代码文档:
  class/function 级别切分
  
PDF文档:
  按页面段落 + 表格/图片单独提取
```

### 4. 递归切分 (Recursive Splitting)

```python
from langchain.text_splitter import RecursiveCharacterTextSplitter

splitter = RecursiveCharacterTextSplitter(
    chunk_size=512,
    chunk_overlap=50,
    separators=[
        "\n\n\n",   # 先按多换行(大段落)
        "\n\n",     # 再按双换行(段落)
        "\n",       # 再按单换行
        "。",        # 再按句号
        "；",        # 再按分号
        "，",        # 最后按逗号
        " ",        # 最后按空格
        ""          # 强制切分
    ]
)

# 策略: 尽可能在最大的自然边界处切分
# 如果段落本身就<chunk_size，保留完整段落
# 如果段落>chunk_size，递归用更小的分隔符
```

## 过大 vs 过小的问题

```
┌─────────────────────────────────────────────────────────┐
│              Chunk大小 vs RAG效果                        │
│                                                         │
│  检索精度                                         │
│   ↑                                                    │
│   │    过小区域              过大区域                   │
│   │    (信息不足)            (语义稀释)                  │
│   │     ╱╲                                              │
│   │    ╱  ╲     最优区间                                │
│   │   ╱    ╲   ┌────────┐                               │
│   │  ╱      ╲  │  256-  │                              │
│   │╱         ╲ │  512t  │                              │
│   │           ╲└────────┘                              │
│   └──┬────┬────┬────┬────┬────→ Chunk大小              │
│     64  128  256  512  1024  2048  (tokens)           │
└─────────────────────────────────────────────────────────┘
```

| 问题 | Chunk过大 | Chunk过小 |
|------|----------|----------|
| 检索精度 | ❌ Embedding被稀释，多主题混合 | ✅ 语义集中，定位精准 |
| 上下文完整性 | ✅ 信息完整 | ❌ 语义断裂，缺少背景 |
| 噪声 | ❌ 大量无关信息 | ✅ 噪声少 |
| Token消耗 | ❌ 浪费context窗口 | ✅ 高效利用 |
| Top-K召回 | 每个chunk信息多，少K即可 | 需要更多K拼上下文 |
| 跨chunk信息 | 可能重复(overlap大) | 可能丢失(边界切割) |

## 实际参数选择

```python
# 通用推荐配置
config = {
    # 知识库问答（FAQ、文档）
    "qa": {
        "chunk_size": 400,
        "chunk_overlap": 40,
        "splitter": "recursive",
    },
    # 代码文档
    "code": {
        "chunk_size": 800,
        "chunk_overlap": 100,
        "splitter": "markdown_header",
    },
    # 长篇技术文档
    "technical": {
        "chunk_size": 600,
        "chunk_overlap": 100,
        "splitter": "semantic",
    },
    # 对话记录
    "dialogue": {
        "chunk_size": 200,
        "chunk_overlap": 20,
        "splitter": "turn_based",  # 按对话轮次
    },
}
```

## 知识更新机制设计

```python
class KnowledgeUpdatePipeline:
    """保证RAG系统实时性和准确性的更新机制"""
    
    def __init__(self):
        self.vector_store = None  # 向量数据库
        self.doc_store = None     # 原始文档存储
        self.update_queue = []    # 更新队列
    
    def incremental_update(self, new_docs):
        """增量更新：只处理新增/修改的文档"""
        for doc in new_docs:
            # 1. 检查是否已存在
            existing = self.doc_store.get(doc.id)
            
            if existing and existing.hash == doc.hash:
                continue  # 未变化，跳过
            
            # 2. 如果存在旧版本，先删除
            if existing:
                self.vector_store.delete(filter={"doc_id": doc.id})
            
            # 3. 重新切分+向量化+插入
            chunks = self.splitter.split(doc)
            embeddings = self.embed(chunks)
            self.vector_store.upsert(
                vectors=embeddings,
                metadata=[{"doc_id": doc.id, "chunk_idx": i} 
                          for i in range(len(chunks))]
            )
    
    def periodic_rebuild(self):
        """定期全量重建（纠正累积错误）"""
        # 每周执行一次
        all_docs = self.doc_store.list()
        self.vector_store.clear()
        self.incremental_update(all_docs)
```

**面试加分点**：提到Post5原文中的RAG优化技巧——结构化语义切分+上下文桥接、Query扩写+语义相似度阈值、混合检索用LambdaMART做分数归一化；提到Contextual Retrieval(Anthropic 2024)在切分时给每个chunk加上文档级摘要作为上下文；提到评估chunk质量可以用RAGAS的Context Precision和Context Recall指标；提到Late Chunking（先对整文档做embedding再切分）是2024年新方向。
