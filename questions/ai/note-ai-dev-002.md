---
id: note-ai-dev-002
difficulty: L3
category: ai
subcategory: RAG
tags:
  - 大厂P7
  - RAG优化
  - 数据工程
feynman:
  essence: RAG准确率提升的关键不在换大模型，而在死磕数据工程——语义切分、Query改写、混合检索归一化、细粒度指标监控
  analogy: '像提高考试分数——换更好的学生(换大模型)只能提几分，但改进学习方法(数据工程)能从60分跳到85分'
  first_principle: 'RAG的准确率瓶颈在数据链路而非模型能力。每个环节的损耗（切分不当→检索偏差→排序不准→评估缺失）累积导致60%的baseline'
  key_points:
    - '结构化语义切分+上下文桥接: 沿语义边界切分，chunk间保留上下文'
    - 'Query扩写+语义相似度阈值: 用户意图不够时自动扩展+质量过滤'
    - '混合检索用LambdaMART归一化: 向量+BM25分数统一排名'
    - '拆开看Context Recall和Faithfulness: 精确诊断检索和生成各环节'
first_principle:
  essence: RAG系统是串行流水线，每个环节的精度损失会乘法累积
  derivation: '假设切分精度0.9 × 检索精度0.8 × 重排精度0.85 × 生成精度0.95 = 0.58 ≈ 60%。要让整体达到85%，需要每个环节都提升到0.95+'
  conclusion: 系统性地逐环节优化数据质量，而不是寄希望于某个银弹
follow_up:
  - 什么是HyDE？它如何改善检索？
  - LambdaMART vs RRF，哪个更适合做混合检索归一化？
  - 如何用RAGAS评估RAG系统的各环节？
---

# 大厂P7：RAG准确率从60%提升到85%的4个关键优化

> 来源：小红书——大厂P7分享RAG优化实战

## 四大优化全景

```
┌──────────────────────────────────────────────────────────┐
│           RAG 准确率提升路线图                            │
│                                                          │
│  60% ──────────────────────────────────────── 85%       │
│   │                                                  ↑   │
│   │     ①语义切分     ②Query改写   ③混合检索  ④监控  │   │
│   │     +上下文桥接    +阈值过滤    +LambdaMART +指标   │   │
│   │         ↓            ↓           ↓          ↓      │
│   │      +8%           +6%         +7%        +4%     │   │
│   │         ↓            ↓           ↓          ↓      │
│   │       68%           74%         81%        85%     │
│                                                          │
│  核心: 不换大模型，死磕数据工程细节                       │
└──────────────────────────────────────────────────────────┘
```

## 优化1：结构化语义切分 + 上下文桥接

```
问题: 固定大小切分会在句子中间断裂，丢失语义

传统切分 (512 tokens, 无overlap):
  Chunk 1: "...RAG系统的核心是检索模块。它负责从"
  Chunk 2: "知识库中召回与用户查询最相关的文档片段..."

  → Chunk 2缺少主语"检索模块"，语义不完整！

语义切分 + 上下文桥接:
  Chunk 1: "RAG系统的核心是检索模块。它负责从知识库中召回相关文档。"
           ↑ 按句子/段落边界切分
           
  上下文桥接: 在Chunk 1前加上前一个chunk的最后1-2句作为上下文
  Chunk 1 (增强): "[上一段尾: 本章介绍RAG架构各模块。]
                   RAG系统的核心是检索模块。它负责从知识库中召回相关文档。"
  
  效果: 检索精度 +8%
```

```python
class SemanticChunker:
    """结构化语义切分 + 上下文桥接"""
    
    def chunk(self, document, target_size=400, overlap_sentences=2):
        # 1. 按语义边界切分（段落 > 句子 > 子句）
        sentences = self.split_sentences(document)
        
        # 2. 动态合并到目标大小
        chunks = []
        current_chunk = []
        current_size = 0
        
        for sent in sentences:
            current_chunk.append(sent)
            current_size += len(sent)
            
            if current_size >= target_size:
                chunks.append(current_chunk)
                # ★ 保留最后overlap_sentences句作为桥接
                current_chunk = current_chunk[-overlap_sentences:]
                current_size = sum(len(s) for s in current_chunk)
        
        # 3. 为每个chunk添加上下文桥接
        enhanced_chunks = []
        for i, chunk in enumerate(chunks):
            if i > 0:
                # 从上一个chunk的尾部提取桥接上下文
                bridge = " ".join(chunks[i-1][-overlap_sentences:])
                chunk_text = f"[上下文: {bridge}]\n" + " ".join(chunk)
            else:
                chunk_text = " ".join(chunk)
            
            enhanced_chunks.append({
                "text": chunk_text,
                "chunk_id": i,
                "source": document.id
            })
        
        return enhanced_chunks
```

## 优化2：Query扩写 + 语义相似度阈值

```
问题: 用户查询太短/太模糊，检索不到准确结果

原始Query: "价格"  → 向量检索 → 召回各种不相关的"价格"内容

优化: 多维度Query扩写
  原始: "价格"
  扩写1: "产品定价方案"        ← 同义替换
  扩写2: "套餐费用和月费"      ← 场景化
  扩写3: "相比竞品的价格优势"   ← 对比角度
  
  对每个扩写Query分别检索，结果合并去重

质量过滤: 语义相似度 < 0.82 → 丢弃
  → 避免低质量召回污染上下文
```

```python
class QueryExpander:
    """Query扩写 + 相似度阈值过滤"""
    
    def expand(self, original_query, n_expansions=3):
        expansions = [original_query]
        
        # 用LLM生成改写
        rewrites = self.llm.generate(f"""
        将以下查询改写为{n_expansions}种不同表达方式，
        保持语义一致但用不同的措辞和角度:
        原始查询: {original_query}
        """)
        expansions.extend(parse_rewrites(rewrites))
        
        return expansions
    
    def filter_results(self, query, retrieved_docs, threshold=0.82):
        """相似度阈值过滤"""
        query_emb = self.embed(query)
        filtered = []
        
        for doc in retrieved_docs:
            sim = cosine_similarity(query_emb, doc.embedding)
            if sim >= threshold:
                doc.score = sim
                filtered.append(doc)
        
        # 按相似度降序排列
        return sorted(filtered, key=lambda x: x.score, reverse=True)
```

## 优化3：混合检索 + LambdaMART归一化

```
问题: 纯向量检索和纯关键词检索各有盲区

向量检索 (语义): 
  ✅ 擅长语义相似 (近义词、概念匹配)
  ❌ 不擅长精确匹配 (专有名词、编号、代码)

BM25检索 (关键词):
  ✅ 擅长精确匹配 (术语、ID、错误码)
  ❌ 不擅长语义理解 (同义词、概念)

混合检索: 两路结果合并 → LambdaMART重排

  向量Top-10: [A, B, C, D, E, F, G, H, I, J]
  BM25 Top-10: [K, B, L, A, M, N, O, P, Q, R]
                         ↑ 交集: A, B
  
  LambdaMART特征:
    - 向量相似度分数
    - BM25分数  
    - 向量排名
    - BM25排名
    - 文档长度
    - chunk位置
  
  归一化重排: [B, A, C, K, L, D, ...]
               ↑ 综合两路结果的最优排序
```

```python
from lambdamart import LambdaMART

class HybridRetriever:
    """向量 + BM25 混合检索"""
    
    def __init__(self):
        self.vector_store = None     # 向量数据库
        self.bm25_store = None       # BM25索引
        self.reranker = LambdaMART()  # LambdaMART重排模型
    
    def search(self, query, top_k=5):
        # 1. 向量检索
        vector_results = self.vector_store.search(
            self.embed(query), top_k=20
        )
        
        # 2. BM25检索
        bm25_results = self.bm25_store.search(query, top_k=20)
        
        # 3. 合并 + 特征提取
        candidates = self._merge_results(
            vector_results, bm25_results
        )
        
        # 4. LambdaMART重排
        features = self._extract_features(candidates, query)
        reranked = self.reranker.predict(features)
        
        return reranked[:top_k]
    
    def _extract_features(self, candidates, query):
        """为每个候选提取排序特征"""
        features = []
        for doc in candidates:
            feat = [
                doc.vector_score,        # 向量相似度
                doc.bm25_score,          # BM25分数
                doc.vector_rank,         # 向量排名
                doc.bm25_rank,           # BM25排名
                len(doc.text),           # 文档长度
                doc.chunk_position,      # chunk在原文中的位置
            ]
            features.append(feat)
        return features
```

## 优化4：拆开看 Context Recall 和 Faithfulness

```
问题: 只看"回答准确率"无法定位瓶颈在哪

传统评估:
  "回答对了吗?" → 对/错 → 60%正确
  → 无法区分是检索错了还是生成错了

RAGAS拆解评估:
  ┌─────────────────────────────────────────┐
  │  Context Recall: 召回的上下文是否包含了   │
  │  回答所需的全部信息?                      │
  │  → 低 = 检索有问题(召回不全)             │
  │                                         │
  │  Context Precision: 召回的上下文中       │
  │  相关信息占比?                           │
  │  → 低 = 检索有噪声(召回太多不相关的)     │
  │                                         │
  │  Faithfulness: 回答是否忠于上下文?       │
  │  → 低 = 模型在编造(幻觉)                 │
  │                                         │
  │  Answer Relevance: 回答是否切题?         │
  │  → 低 = 理解有问题                       │
  └─────────────────────────────────────────┘
  
  诊断示例:
    Context Recall: 0.72  → ★检索不全，需优化切分/扩写
    Faithfulness: 0.95    → 生成正常
    → 优先优化检索而非生成
```

```
指标监控看板:

┌────────────────────────────────────────┐
│  RAG 指标监控                           │
│                                        │
│  Context Recall:    ████████░░  82%   │
│  Context Precision: █████████░  91%   │
│  Faithfulness:      █████████░  93%   │
│  Answer Relevance:  █████████░  90%   │
│                                        │
│  整体准确率: 85%                       │
│  瓶颈: Context Recall (82%)           │
│  → 下一步: 增加chunk数量 + HyDE        │
└────────────────────────────────────────┘
```

**面试加分点**：提到HyDE（Hypothetical Document Embedding）——先让LLM生成一个假设答案，用假设答案做向量检索，因为"答案"和"文档"的语义空间比"问题"和"文档"更近；提到RRF（Reciprocal Rank Fusion）是更简单但效果略逊的归一化方法；提到Anthropic的Contextual Retrieval在切分时用LLM给每个chunk生成上下文摘要，进一步解决chunk断裂问题；提到最先进的RAG系统还会加入知识图谱增强（GraphRAG），通过实体关系提升复杂推理能力。
