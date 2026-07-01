---
id: note-bd-llm-010
difficulty: L4
category: ai
subcategory: RAG
tags:
- 字节
- 面经
- 多模态
- 文档解析
- 上下文关联
feynman:
  essence: 多模态文档解析中，图片文字与正文的关联需要通过位置感知Embedding和上下文窗口拼接来保留。
  analogy: 就像看连环画——每幅画旁边的文字和画本身是一个整体，拆开就丢失了'图配文'的语义关联。
  first_principle: 多模态文档的语义单位不是单独的文本或图片，而是它们的组合+位置关系。
  key_points:
  - 图文同切片(位置感知chunking)
  - 图片OCR+caption注入正文
  - 位置编码(序列号/页码/坐标)
  - 多模态Embedding(CLIP/图文联合向量)
first_principle:
  essence: 文档理解=文本×图像×位置的三维信息融合
  derivation: 纯文本切片→丢失图片上下文→图文关联断裂→检索时无法召回关联信息→需要位置感知的联合编码
  conclusion: 多模态文档必须保留图文的空间-语义关联
follow_up:
- 如何处理跨页的图文关联？
- 表格截图和正文怎么关联？
- VLM(如GPT-4V)能替代传统OCR吗？
memory_points:
- 正交互补：长上下文解决'一次读多少'(窗口)，而RAG解决'海量中找什么'(检索)，二者不可替代
- 规模鸿沟：128k仅约十万字，因为企业库常达数百万篇，所以全塞入在物理上极不现实
- Lost in Middle：模型对超长上下文的注意力呈U型曲线，因为中部信息极易被忽略，所以全塞入精度反而下降
- 业务硬需求：RAG支持增量索引秒级更新与精确文档溯源，这是静态长上下文绝对无法做到的
- 成本劣势：长上下文单次Token消耗与首字延迟极高，相比RAG每次几K的消耗不具备规模化商业可行性
---

# 【字节面经】你提到做过多模态文档解析，当图片里的文字与周边正文语义强相关时，你是怎么把两者的上下文关联保留下来的？

## 一、问题本质

传统文档解析流程是"先抽文本 → 再切块 → 做Embedding"。对于纯文本没问题，但遇到**图文混排文档**（PDF报告、PPT、扫描件、网页），这种流水线会彻底断裂图片与周边正文的语义关联——比如一张架构图旁边写着"如上图所示，系统分为三层"，如果把图丢掉或单独处理，这句正文就成了无意义引用。

核心矛盾在于：**多模态文档的语义单位不是单独的文本或图片，而是"文本+图片+空间位置"的组合**。解析和切片必须在这个语义层面上保留关联。

## 二、四层技术方案

### 第一层：图文同切片（位置感知 Chunking）

这是最基础也最重要的策略——**不要把图片和它相关的正文拆到不同的chunk里**。

**具体做法**：

1. **版面分析**：用 LayoutLM、PP-StructureV2 或视觉模型对文档做区域检测，识别出标题、段落、图片、表格、图注等区域及其BBox坐标。
2. **语义聚类**：根据空间关系将相邻区域分组。核心规则是：**图注（caption）与图片绑定为一个原子单元**，再与上下段落合并。
3. **位置感知切片**：在切chunk时，不跨过图文边界。如果一个图文组合块太大，优先在文本段落内部切分，保持图文对完整。

**伪代码示例**：

```python
from dataclasses import dataclass
from typing import List, Optional

@dataclass
class DocumentRegion:
    """文档中的区域单元"""
    region_type: str        # 'text', 'image', 'table', 'caption'
    content: str            # 文本内容或图片路径
    page: int               # 页码
    bbox: tuple             # (x0, y0, x1, y1) 归一化坐标
    seq_order: int          # 阅读顺序序列号

@dataclass  
class ImageTextChunk:
    """图文关联切片"""
    chunk_id: str
    text_content: str                    # 正文文本
    image_refs: List[str]                # 关联图片路径
    image_captions: List[str]            # 图片caption/OCR
    page: int                            # 所在页码
    position_context: str                # 位置描述（如"第2页上半部分"）
    seq_order: int                       # 阅读顺序

def position_aware_chunking(regions: List[DocumentRegion], max_tokens: int = 512) -> List[ImageTextChunk]:
    """
    位置感知切片：保持图文关联不跨边界
    """
    chunks = []
    current_text = []
    current_images = []
    current_captions = []
    current_page = None
    seq_start = 0

    for region in sorted(regions, key=lambda r: (r.page, r.seq_order)):
        # 换页或token超限时强制切分
        if current_page != region.page or _estimate_tokens(current_text) >= max_tokens:
            if current_text or current_images:
                chunks.append(_build_chunk(
                    current_text, current_images, current_captions,
                    current_page, seq_start, len(chunks)
                ))
            current_text, current_images, current_captions = [], [], []

        current_page = region.page

        if region.region_type == 'image':
            # 图片与最近的caption绑定
            current_images.append(region.content)
        elif region.region_type == 'caption':
            current_captions.append(region.content)
            current_text.append(f"[图注] {region.content}")
        elif region.region_type == 'text':
            current_text.append(region.content)

    # 最后一个chunk
    if current_text or current_images:
        chunks.append(_build_chunk(
            current_text, current_images, current_captions,
            current_page, seq_start, len(chunks)
        ))

    return chunks


def _build_chunk(text_parts, images, captions, page, seq_start, idx):
    text = "\n".join(text_parts)
    # 在文本中注入图片占位符，保持阅读顺序关联
    for i, img in enumerate(images):
        caption = captions[i] if i < len(captions) else ""
        text += f"\n[IMAGE_REF: {img} | caption: {caption} | page: {page}]\n"
    return ImageTextChunk(
        chunk_id=f"chunk_{idx}",
        text_content=text,
        image_refs=images,
        image_captions=captions,
        page=page,
        position_context=f"page_{page}",
        seq_order=seq_start,
    )


def _estimate_tokens(text_parts: List[str]) -> int:
    return sum(len(t) // 2 for t in text_parts)  # 粗略估算
```

### 第二层：OCR + Caption 注入

图片本身不是文本，如果直接丢弃就丢失了"图里写了什么"的信息。需要两层注入：

1. **OCR层**：对图片中的文字做OCR（PaddleOCR、Tesseract），提取图中的文字内容。
2. **Caption层**：对图片做语义描述（VLM生成或人工标注），用一句话概括"这张图在表达什么"。
3. **注入正文**：将OCR结果和Caption以结构化标记注入到正文文本流中，放在图片出现的位置。

```python
import asyncio

async def enrich_image_with_context(image_path: str, vlm_client, ocr_engine):
    """
    对图片做OCR + VLM caption，生成结构化描述注入正文
    """
    # 1. OCR提取图中文字
    ocr_result = ocr_engine.extract(image_path)
    ocr_text = "\n".join([item.text for item in ocr_result])

    # 2. VLM生成图片语义描述
    caption = await vlm_client.describe_image(
        image_path,
        prompt="用一句话描述这张图片的核心内容，如果是图表请说明数据维度和趋势。"
    )

    # 3. 构造注入文本块
    injected_block = f"""
[图片内容描述]
- 图片位置: {image_path}
- 图中文字(OCR): {ocr_text}
- 语义摘要(Caption): {caption}
[/图片内容描述]
"""
    return injected_block.strip()


async def build_multimodal_chunk(page_text: str, images: List[dict], vlm_client, ocr_engine):
    """将OCR+Caption注入到正文，形成多模态文本块"""
    enriched_parts = []
    for img in images:
        insert_pos = img['text_offset']  # 图片在正文中的位置
        block = await enrich_image_with_context(
            img['path'], vlm_client, ocr_engine
        )
        enriched_parts.append((insert_pos, block))

    # 按位置插入到正文中
    result = page_text
    for offset, block in sorted(enriched_parts, reverse=True):
        result = result[:offset] + "\n" + block + "\n" + result[offset:]

    return result
```

### 第三层：位置编码（页码 + 坐标 + 序列号）

在Embedding阶段，除了文本语义向量外，还需要额外编码位置信息，使检索时能感知"这段文字来自第几页、什么位置"。

```python
def build_position_aware_text(chunk: ImageTextChunk) -> str:
    """在chunk文本前注入位置元数据前缀"""
    position_prefix = (
        f"[文档: {chunk.position_context} | "
        f"页码: {chunk.page} | "
        f"阅读顺序: {chunk.seq_order}]\n"
    )
    return position_prefix + chunk.text_content

def get_embedding_with_position(text: str, chunk: ImageTextChunk, embed_model):
    """
    生成融合位置信息的Embedding：
    方案A(简单): 位置前缀拼接到文本中，一起做Embedding
    方案B(进阶): 文本Embedding和位置Embedding分别生成后拼接/融合
    """
    # 方案A：位置前缀 + 文本 → 联合Embedding
    combined_text = build_position_aware_text(chunk)
    return embed_model.embed(combined_text)
```

### 第四层：多模态 Embedding（图文联合向量）

更高级的方案是使用 **CLIP / BGE-VL / Jina-CLIP** 等多模态Embedding模型，让图片和文本映射到同一个向量空间。这样：

- 用户用文字搜索时，可以同时召回文本chunk和图片chunk。
- 图片和其周边正文天然在向量空间中接近。

```python
import numpy as np

class MultimodalIndexer:
    """多模态索引器：文本和图片统一向量空间"""

    def __init__(self, clip_model, text_embed_model):
        self.clip_model = clip_model          # CLIP/BGE-VL多模态模型
        self.text_embed_model = text_embed_model
        self.index = []                        # 向量库

    def index_chunk(self, chunk: ImageTextChunk):
        """索引一个图文切片"""
        # 文本部分用文本Embedding
        text_vec = self.text_embed_model.embed(chunk.text_content)

        # 图片部分用CLIP图像Embedding
        for img_path in chunk.image_refs:
            img_vec = self.clip_model.encode_image(img_path)
            # 存储时带上关联的chunk_id，检索时可以关联回文本
            self.index.append({
                'vector': img_vec,
                'type': 'image',
                'chunk_id': chunk.chunk_id,
                'content': img_path,
                'page': chunk.page,
            })

        # 文本向量入库
        self.index.append({
            'vector': text_vec,
            'type': 'text',
            'chunk_id': chunk.chunk_id,
            'content': chunk.text_content,
            'image_refs': chunk.image_refs,
            'page': chunk.page,
        })

    def search(self, query: str, top_k: int = 5):
        """跨模态检索：文本query同时搜索文本和图片向量"""
        query_vec = self.text_embed_model.embed(query)
        scores = [
            (item, np.dot(query_vec, item['vector']))
            for item in self.index
        ]
        scores.sort(key=lambda x: x[1], reverse=True)

        results = []
        seen_chunks = set()
        for item, score in scores[:top_k * 2]:
            if item['chunk_id'] not in seen_chunks:
                results.append(item)
                seen_chunks.add(item['chunk_id'])
            if len(results) >= top_k:
                break
        return results
```

## 三、整体架构图

```
┌─────────────────────────────────────────────────────────────────────┐
│                      多模态文档解析架构                               │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  ┌──────────┐    ┌──────────────┐    ┌─────────────────────────┐   │
│  │ 文档输入  │───▶│  版面分析     │───▶│  区域检测+坐标提取       │   │
│  │ PDF/PPT/ │    │ LayoutLM/    │    │ text/image/table/      │   │
│  │ 扫描件    │    │ PP-Structure │    │ caption + BBox+page     │   │
│  └──────────┘    └──────────────┘    └───────────┬─────────────┘   │
│                                                  │                  │
│                          ┌───────────────────────┼──────────────┐  │
│                          ▼                       ▼              ▼  │
│                   ┌─────────────┐      ┌──────────────┐  ┌──────┐ │
│                   │ OCR引擎     │      │ VLM Caption  │  │ 正文 │ │
│                   │ PaddleOCR   │      │ GPT-4V/QwenVL│  │ 文本 │ │
│                   └──────┬──────┘      └──────┬───────┘  └──┬───┘ │
│                          │                    │             │     │
│                          └────────┬───────────┘             │     │
│                                   ▼                         │     │
│                   ┌──────────────────────────────┐          │     │
│                   │  图文关联注入层                │◀─────────┘     │
│                   │  · OCR文本注入正文对应位置     │                │
│                   │  · Caption语义描述注入        │                │
│                   │  · 图片占位符 [IMAGE_REF]     │                │
│                   └──────────────┬───────────────┘                │
│                                  ▼                                 │
│                   ┌──────────────────────────────┐                │
│                   │  位置感知切片                 │                │
│                   │  · 图注+图片绑定不拆分        │                │
│                   │  · 页码+坐标+序列号编码       │                │
│                   │  · 跨图文边界不切分           │                │
│                   └──────────────┬───────────────┘                │
│                                  ▼                                 │
│          ┌───────────────────────┴────────────────────┐           │
│          ▼                                          ▼             │
│   ┌──────────────┐                          ┌──────────────┐      │
│   │ 文本Embedding │                          │ 图像Embedding │      │
│   │ BGE/Text2Vec │                          │ CLIP/BGE-VL  │      │
│   └──────┬───────┘                          └──────┬───────┘      │
│          │                                         │              │
│          └────────────────┬────────────────────────┘              │
│                           ▼                                        │
│                   ┌───────────────┐                                │
│                   │ 多模态向量库    │                                │
│                   │ Milvus/Qdrant │                                │
│                   │ (图文统一空间) │                                │
│                   └───────┬───────┘                                │
│                           ▼                                        │
│                   ┌───────────────┐                                │
│                   │ 跨模态检索     │                                │
│                   │ 文字Query→    │                                │
│                   │ 召回文本+图片 │                                │
│                   └───────────────┘                                │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

## 四、关键设计决策总结

| 设计点 | 方案 | 为什么 |
|-------|------|--------|
| 图文不拆分 | 图注+图片绑定为一个原子chunk | 跨chunk的图文关联在检索时几乎无法重建 |
| OCR注入位置 | 插入到图片在正文中的出现位置 | 保持阅读顺序，让模型理解"先读这段文字→看这张图→继续读" |
| Caption生成 | VLM生成语义描述 | OCR只有字面信息，没有"这张图在表达什么"的语义 |
| 位置前缀编码 | 页码+坐标+序列号拼接到文本头部 | Embedding模型能感知位置上下文，检索时可以加位置过滤 |
| 多模态Embedding | CLIP统一向量空间 | 实现跨模态检索，文字搜图、图搜文都能做 |

## 五、面试回答话术

> "我的方案是四层关联保持策略。**第一层做位置感知切片**，用版面分析识别出图文区域后，把图注和图片绑定为一个原子单元，切chunk时不跨图文边界。**第二层做OCR+Caption注入**，对每张图用OCR提取文字、用VLM生成语义描述，以结构化标记注入到正文对应位置，这样图片信息变成文本流的一部分。**第三层做位置编码**，在每个chunk的文本前加上页码、坐标、阅读序列号前缀，让Embedding感知位置上下文。**第四层做多模态Embedding**，用CLIP把图片和文本映射到同一向量空间，实现跨模态检索。核心原则是：图文关联的断裂发生在切片阶段，所以必须在切片时就把位置信息和图片内容注入到文本流中，而不是事后补救。"

## 记忆要点

- 正交互补：长上下文解决'一次读多少'(窗口)，而RAG解决'海量中找什么'(检索)，二者不可替代
- 规模鸿沟：128k仅约十万字，因为企业库常达数百万篇，所以全塞入在物理上极不现实
- Lost in Middle：模型对超长上下文的注意力呈U型曲线，因为中部信息极易被忽略，所以全塞入精度反而下降
- 业务硬需求：RAG支持增量索引秒级更新与精确文档溯源，这是静态长上下文绝对无法做到的
- 成本劣势：长上下文单次Token消耗与首字延迟极高，相比RAG每次几K的消耗不具备规模化商业可行性

