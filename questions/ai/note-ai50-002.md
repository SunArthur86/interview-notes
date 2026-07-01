---
id: note-ai50-002
difficulty: L3
category: ai
subcategory: RAG
tags:
- 某厂
- 面经
- RAG
- 多模态检索
- 向量检索
feynman:
  essence: 图文混合检索需要根据文档类型动态分配两路检索的权重，而非固定比例
  analogy: 就像图书馆找书——找"封面图片特征"和找"书名文字"两条线索都要用，但不同类型的书侧重点不同
  first_principle: 图像向量捕获视觉特征（形状、颜色、布局），文本向量捕获语义信息（关键词、含义），两者的信息互补但维度不同
  key_points:
  - 图文检索本质是跨模态对齐问题
  - '权重分配策略: 静态阈值、动态路由、学习排序'
  - CLIP等模型可以将图文映射到同一向量空间
  - Reranker对两路结果做统一重排是工业主流方案
first_principle:
  essence: 不同模态的向量在不同类型查询上有不同区分度，固定权重无法适配所有场景
  derivation: 文本查询"轴承尺寸表"应侧重文本检索；视觉查询"这个零件的3D结构图"应侧重图像检索。固定0.5/0.5权重在两种场景下都会退化
  conclusion: 混合检索应该根据查询意图动态调整权重，或通过Reranker统一排序
follow_up:
- CLIP模型在工业场景的局限性是什么？
- 如果文档中图片和文字是一一对应的，还需要混合检索吗？
- 如何评估多模态检索系统的效果？
memory_points:
- 三种方案：静态权重融合、查询意图动态路由、Reranker统一排序（工业主流）。
- 静态权重：分数归一化后按固定比例分配，文本为主通常文本权重设0.6-0.8。
- 动态路由：用轻量分类器识别意图是文本还是图像，动态调整两路权重。
- 工业主流：图文各路扩大召回量，合并去重后用Cross-Encoder重排得到最终结果。
---

# 多模态检索中图文向量混合检索的权重分配

## 核心问题

文档中同时包含图片和文字，用户查询时需要从两路（图像向量 + 文本向量）检索结果中找到最相关的内容。如何分配两路权重？

```
用户Query
    │
    ├──→ 文本Embedding ──→ 文本向量检索 ──→ Top-K文本结果
    │                                         │
    ├──→ 图像Embedding ──→ 图像向量检索 ──→ Top-K图像结果
    │                                         │
    └─────────────────────────────────────────┘
                    │
              权重融合 / Reranker
                    │
              最终 Top-K 结果
```

## 三种工业级权重分配方案

### 方案1: 静态权重融合（简单高效）

```python
def hybrid_search_static(query, alpha=0.7):
    """
    alpha: 文本权重, (1-alpha): 图像权重
    """
    # 文本检索
    text_results = text_vector_store.search(
        embed_text(query), top_k=20
    )
    # 图像检索 (需要先提取查询中的图像特征或用CLIP编码)
    image_results = image_vector_store.search(
        clip_model.encode_text(query), top_k=20
    )
    
    # 分数归一化后加权融合
    all_results = []
    for doc_id, score in text_results:
        all_results.append((doc_id, alpha * normalize(score)))
    for doc_id, score in image_results:
        prev = dict(all_results).get(doc_id, 0)
        all_results.append((doc_id, max(prev, (1-alpha) * normalize(score))))
    
    return sorted(all_results, key=lambda x: -x[1])[:10]
```

**适用场景**: 文档类型固定，文本为主的场景。alpha通常设0.6-0.8。

### 方案2: 查询意图路由（动态权重）

```python
def hybrid_search_dynamic(query):
    """根据查询意图动态分配权重"""
    # Step 1: 用轻量分类器判断查询类型
    query_type = classify_query(query)
    # 类型: "text_focused" | "image_focused" | "mixed"
    
    if query_type == "text_focused":
        alpha = 0.9  # 文本主导
    elif query_type == "image_focused":
        alpha = 0.3  # 图像主导
    else:
        alpha = 0.6  # 均衡
    
    return hybrid_search_static(query, alpha)

def classify_query(query):
    """简单规则分类器"""
    image_keywords = ['图', '图示', '结构', '外观', '示意图', '流程图', '图纸']
    text_keywords = ['参数', '规格', '定义', '说明', '标准', '数值']
    
    img_score = sum(1 for kw in image_keywords if kw in query)
    txt_score = sum(1 for kw in text_keywords if kw in query)
    
    if img_score > txt_score:
        return "image_focused"
    elif txt_score > img_score:
        return "text_focused"
    return "mixed"
```

### 方案3: Reranker统一排序（工业主流）

```python
from sentence_transformers import CrossEncoder

def hybrid_search_rerank(query, top_k=10):
    """两路召回 + Cross-Encoder重排"""
    # Step 1: 各路独立召回，扩大召回量
    text_hits = text_store.search(embed(query), top_k=50)
    image_hits = image_store.search(clip_encode(query), top_k=50)
    
    # Step 2: 合并去重
    candidates = deduplicate(text_hits + image_hits)
    
    # Step 3: Cross-Encoder重排
    reranker = CrossEncoder('BAAI/bge-reranker-large')
    pairs = [(query, doc.content) for doc in candidates]
    scores = reranker.predict(pairs)
    
    ranked = sorted(zip(candidates, scores), key=lambda x: -x[1])
    return [doc for doc, _ in ranked[:top_k]]
```

## 三种方案对比

| 方案 | 实现难度 | 效果 | 延迟 | 适用场景 |
|------|---------|------|------|---------|
| 静态权重 | 低 | 中 | 低 | MVP阶段，文档类型单一 |
| 查询路由 | 中 | 中高 | 中 | 查询类型可分的场景 |
| Reranker | 中 | 高 | 中高 | 生产环境，追求精度 |

## 关键技术细节

### 归一化处理

两路检索的分数分布不同（余弦相似度 vs 内积），直接加权不公平：

```python
def normalize_scores(scores):
    """Min-Max归一化到[0,1]"""
    if not scores:
        return []
    min_s, max_s = min(scores), max(scores)
    if max_s == min_s:
        return [0.5] * len(scores)
    return [(s - min_s) / (max_s - min_s) for s in scores]
```

### CLIP跨模态对齐

```python
# CLIP将文本和图像映射到同一向量空间
# 可以直接计算文本query和图像doc的相似度
from transformers import CLIPModel, CLIPTokenizer, CLIPProcessor

model = CLIPModel.from_pretrained("openai/clip-vit-large-patch14")
processor = CLIPProcessor.from_pretrained("openai/clip-vit-large-patch14")

# 文本query的embedding
text_inputs = processor(text=[query], return_tensors="pt", padding=True)
text_feat = model.get_text_features(**text_inputs)

# 与图像doc的embedding计算相似度
similarity = cosine_similarity(text_feat, image_feat)
```

### 评估指标

| 指标 | 说明 |
|------|------|
| Recall@K | 两路召回合并后，相关文档是否在Top-K |
| MRR | 平均倒数排名 |
| nDCG | 考虑排序质量的归一化指标 |
| 模态覆盖率 | 最终结果中文本/图像的比例是否合理 |

## 记忆要点

- 三种方案：静态权重融合、查询意图动态路由、Reranker统一排序（工业主流）。
- 静态权重：分数归一化后按固定比例分配，文本为主通常文本权重设0.6-0.8。
- 动态路由：用轻量分类器识别意图是文本还是图像，动态调整两路权重。
- 工业主流：图文各路扩大召回量，合并去重后用Cross-Encoder重排得到最终结果。

