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

## 苏格拉底式面试追问

> 这组追问模拟面试官层层逼问，每一问先回答"为什么"，再回答"怎么做"，最后回答"如何证明"。

### 第一层：目标与动机

**Q：128k 长上下文已经很普遍，你仍坚持 RAG 不可替代。最核心的一个理由是什么？**

规模鸿沟。128k token 约十万字，只是几十页文档。企业知识库常达数百万篇文档（数十亿 token），物理上不可能全塞进 128k 窗口。RAG 的价值是"从海量中精准检索少量相关文档"塞进窗口，这是长上下文解决不了的。即使上下文扩到 1M（Gemini），也只覆盖几千篇文档，对百万级库仍是九牛一毛。长上下文解决"一次读多少"，RAG 解决"海量中找什么"，两者维度不同，不可替代。

### 第二层：证据与定位

**Q：你用长上下文模型直接读 20 篇文档做问答，准确率 85%。怎么判断这是"长上下文够用"还是"恰好这 20 篇简单"？**

控制变量测试。用同样 20 篇文档做两组实验：A 组用长上下文全塞进去问答，B 组用 RAG 检索 top-5 后问答。如果两组准确率接近（如 85% vs 84%），说明长上下文够用（20 篇全读和检索 5 篇效果一样）；如果 RAG 更高（如 84% vs 90%），说明长上下文的"lost in middle"导致部分文档被忽略，RAG 的精准检索更优。再扩大文档数（50 篇、100 篇），看长上下文准确率何时开始下降（超过模型有效注意力范围），确定长上下文的适用边界。

### 第三层：根因深挖

**Q：长上下文模型读 50 篇文档时，准确率比读 5 篇还低。根因是"lost in middle"还是别的？**

主要是 lost in middle。研究表明，长上下文模型对文档的注意力呈 U 型——开头和结尾的文档被充分利用，中间的被忽略。50 篇文档时，正确答案如果在第 25 篇（中间），模型可能"看不到"。次要原因是噪声——50 篇里有 45 篇无关，无关内容干扰模型判断（即使注意力没衰减，噪声也稀释信号）。RAG 的优势是把 50 篇精筛到 5 篇相关，避免 lost in middle 和噪声。治本（如果要用长上下文）是把最相关的文档放开头和结尾（" haystack 测试"表明位置影响大），但前提是知道哪些最相关——这又回到检索问题。

**Q：那为什么不直接用 RAG 检索 + 长上下文兜底（检索 top-20 全塞进去），两者结合不就避开了各自短板？**

这正是工程上的最优组合。RAG 负责"从百万中检索 top-K"（解决规模），长上下文负责"把 K 篇全读"（K 设大些，如 20-50，利用长上下文窗口）。这样既解决了规模（RAG 检索）又减少了 lost in middle（K 篇里相关性高，噪声少）。关键是调 K——K 太小（如 5）退化为传统 RAG，K 太大（如 100）lost in middle 又出现。经验是 K=10-30（占上下文的 30-50%），既充分利用窗口又控制噪声。长上下文没有"替代" RAG，而是"放大了 RAG 能塞的 context 量"。

### 第四层：方案权衡

**Q：长上下文单次推理消耗 128k token 且首字延迟高（10-30 秒），你怎么决定"这个场景值得用长上下文还是用 RAG"？**

按"延迟敏感度"和"文档规模"两维度选。延迟敏感（如实时问答、<3 秒响应）用 RAG（只检索几 K token，响应快）；延迟不敏感（如批量文档分析、报告生成）可用长上下文（等几十秒可接受）。文档规模小（<50 篇且总量 <100k token）可直接长上下文（全读）；规模大用 RAG。成本上，长上下文单次 $0.5-2（128k token），RAG 单次 $0.01-0.05（几 K token），高频场景 RAG 成本优势巨大。混合场景：实时问答用 RAG，离线分析用长上下文。

**Q：为什么不直接等模型上下文扩到无限大（如 10M token），到时候 RAG 就没用了？**

不会。即使上下文 10M（塞几千篇文档），仍有三个问题：一是 lost in middle 会更严重（10M 的中间信息几乎全被忽略）；二是成本爆炸（10M token 单次推理 $10+，高频不可持续）；三是增量更新难——10M 上下文是静态的，知识库更新了要重新组装 context，而 RAG 的向量库支持实时增量索引。且"全塞进去"假设你知道哪些文档相关，但在百万库里选哪些本身就是检索问题。长上下文越大，RAG"选哪些塞进去"的价值越大，不是越小。两者是协同而非替代关系。

### 第五层：验证与沉淀

**Q：你怎么决定业务场景用"纯 RAG"还是"RAG + 长上下文"，数据驱动而非拍脑袋？**

定义三个指标对比：准确率、P99 延迟、单次成本。在业务评测集上跑"纯 RAG（top-5）"和"RAG+长上下文（top-30 全塞）"，如果后者准确率显著高（如 85%→90%）且延迟和成本可接受（延迟 <10s、成本 <$0.5/次），用后者；如果准确率持平但后者延迟成本高，用前者。关键是看"长上下文多塞的 25 篇有没有带来信息增益"——如果 top-5 已经包含答案，多塞的 25 篇是噪声（lost in middle 风险），用纯 RAG。

**Q：长上下文 vs RAG 的选型经验怎么沉淀？**

固化成"选型决策矩阵"：按文档规模（<50 篇长上下文、>50 篇 RAG）、延迟要求（实时 RAG、离线长上下文）、成本预算（紧 RAG、宽长上下文）推荐方案。沉淀"各模型的有效注意力范围"（如 GPT-4o 的 128k 实际有效约 30k）、"RAG+长上下文的最优 K 值""lost in middle 的缓解策略（位置排布）"。定期 reivew——随模型能力提升（上下文更大、注意力更均匀），选型边界会变，每年重新评估。

## 结构化回答




**30 秒电梯演讲：** 就像看连环画——每幅画旁边的文字和画本身是一个整体，拆开就丢失了'图配文'的语义关联。

**展开框架：**
1. **图文同切片** — 图文同切片(位置感知chunking)
2. **OCR** — 图片OCR+caption注入正文
3. **位置编码** — 位置编码(序列号/页码/坐标)

**收尾：** 如何处理跨页的图文关联？





## 视频脚本

> 预计时长：5 分钟 | 由浅入深


| 时间 | 画面/字幕 | 口播台词 | 讲解要点 |
|------|----------|----------|----------|
| 0:00 | 标题卡：你提到做过多模态文档解析，当图片里的文字与周边正… | "就像看连环画——每幅画旁边的文字和画本身是一个整体，拆开就丢失了'图配文'的语义关联。" | 开场钩子 |
| 0:20 | 核心概念图 | "多模态文档解析中，图片文字与正文的关联需要通过位置感知Embedding和上下文窗口拼接来保留。" | 核心定义 |
| 0:50 | 图文同切片(示意图 | "图文同切片(——图文同切片(位置感知chunking)" | 要点拆解1 |
| 1:30 | 图片示意图 | "图片——图片OCR+caption注入正文" | 要点拆解2 |
| 2:20 | 对比/实战案例图 | "对比一下常见误区和工程实践，看真实场景里怎么取舍。" | 实战与对比 |
| 3:10 | 总结卡 | "记住核心要点。下期我们追问：如何处理跨页的图文关联？" | 收尾与钩子 |
