---
id: note-bd-llm-003
difficulty: L4
category: ai
subcategory: RAG
tags:
- 字节
- 面经
- 切片策略
- Chunking
- 表格数据
feynman:
  essence: 不会用统一策略。正文用语义切片(按段落/标题)，表格用结构化切片(按行/按表)，需要混合切片策略。
  analogy: 就像处理一封信和一张Excel表格——信按段落拆开读，表格按行列理解，不能用同一把剪刀。
  first_principle: 不同内容类型的语义边界不同，统一的Token长度切割会破坏语义完整性。
  key_points:
  - '正文: 语义切片(段落/标题/滑动窗口)'
  - '表格: 结构化保留(Markdown/HTML格式)'
  - '图表: 多模态解析(VLM识别)'
  - '混合策略: 先分类再分别切片'
first_principle:
  essence: 语义完整性 > Token均匀性
  derivation: 固定长度切割→表格被腰斩→行数据断裂→检索时无法理解→需要按内容类型自适应切片
follow_up:
- 表格数据怎么向量化效果最好？
- PDF中的表格怎么提取？
- 切片大小如何量化评估？
---

# 【字节面经】如果用户的文档同时包含大段正文和密集的表格数据，你会采用统一的切片策略吗？

## 一、核心结论：不能用统一切片策略

**直接回答：不会。** 不同内容类型的语义边界完全不同，用统一的Token长度切割会导致严重的信息损坏。

**核心原则：语义完整性 > Token均匀性。**

具体来说，固定长度切割在面对混合文档时会产生三类致命问题：

| 问题 | 描述 | 后果 |
|------|------|------|
| **表格腰斩** | 一个表格被切到两个chunk中，前半截有表头无数据，后半截有数据无表头 | 检索到的片段无法理解，LLM无法正确解读表格 |
| **行数据断裂** | 表格中间被切断，某一行数据残缺（如"张三\|28\|工程"和"师\|北京"分离） | 关键字段丢失，检索语义不完整 |
| **正文语义割裂** | 正文段落中间被切断，前后逻辑断裂 | Embedding的语义表示不准确，召回率下降 |

## 二、切片策略全景对比

| 策略 | 原理 | 适用内容 | 优点 | 缺点 |
|------|------|----------|------|------|
| **固定长度切片** | 按Token数均匀切割 + Overlap | 纯文本原型 | 实现简单，chunk均匀 | 破坏语义边界 |
| **递归字符切片** | 按`\n\n`→`\n`→`。`→字符递归 | 通用文本 | 大部分场景适用 | 不感知表格结构 |
| **Markdown标题切片** | 按`#`/`##`标题层级切分 | 结构化文档（MD/Wiki） | 天然语义边界 | 不适用无标题文档 |
| **表格结构化切片** | 整表保留或按行分组，保持行列关系 | 表格数据 | 完整保留表格语义 | 需要专门的表格识别 |
| **语义模型切片** | 用Embedding相似度判断段落边界 | 长文档 | 最细粒度的语义保持 | 计算开销大 |
| **多模态切片** | 图表用VLM解析为文字描述后切片 | 图表/图片 | 解决视觉内容检索问题 | 依赖VLM质量 |

## 三、正文语义切片策略

### 3.1 Markdown/标题感知切片

对于有结构标记的文档（Markdown、Wiki、HTML），按标题层级天然切分是最优选择：

```python
"""
Markdown 标题感知切片
按 ## / ### 标题层级切割，保证每个chunk在同一个章节内
"""
import re
from dataclasses import dataclass


@dataclass
class Chunk:
    text: str
    metadata: dict  # 来源、标题路径、类型等


def markdown_header_chunking(
    text: str,
    max_chunk_size: int = 512,
    min_chunk_size: int = 100,
) -> list[Chunk]:
    """
    按 Markdown 标题层级切片
    规则:
      1. 遇到标题(#/##/###)作为分割点
      2. 同一标题下内容超过max_chunk_size时再按段落递归切
      3. 记录标题路径(如 "第三章 > 3.2 架构设计")
    """
    lines = text.split("\n")
    chunks = []
    current_section = []
    current_headers = {}  # level -> header text

    for line in lines:
        header_match = re.match(r'^(#{1,6})\s+(.+)$', line)
        if header_match:
            # 遇到新标题，保存上一个section
            if current_section:
                section_text = "\n".join(current_section)
                _add_chunk(chunks, section_text, current_headers,
                          max_chunk_size, min_chunk_size)
                current_section = []
            # 更新标题层级
            level = len(header_match.group(1))
            current_headers[level] = header_match.group(2).strip()
            # 清除更深层级
            current_headers = {k: v for k, v in current_headers.items()
                             if k <= level}
            current_section.append(line)
        else:
            current_section.append(line)

    # 最后一个section
    if current_section:
        section_text = "\n".join(current_section)
        _add_chunk(chunks, section_text, current_headers,
                  max_chunk_size, min_chunk_size)

    return chunks


def _add_chunk(chunks, text, headers, max_size, min_size):
    """如果section太长，再按段落递归切"""
    header_path = " > ".join(headers.get(i, "") for i in sorted(headers))
    if len(text) <= max_size:
        chunks.append(Chunk(text=text, metadata={"header_path": header_path}))
    else:
        # 按段落再切
        paragraphs = text.split("\n\n")
        buf = ""
        for para in paragraphs:
            if len(buf) + len(para) <= max_size:
                buf += para + "\n\n"
            else:
                if buf and len(buf) >= min_size:
                    chunks.append(Chunk(
                        text=buf.strip(),
                        metadata={"header_path": header_path}
                    ))
                buf = para + "\n\n"
        if buf.strip():
            chunks.append(Chunk(
                text=buf.strip(), metadata={"header_path": header_path}
            ))
```

### 3.2 语义相似度切片（Sentence-Aware）

对于无结构的纯文本，用相邻句子的Embedding相似度变化来检测语义边界：

```python
"""
基于语义相似度的动态切片
当相邻句子Embedding相似度低于阈值时 → 认为是主题切换点 → 在此切分
"""
from sentence_transformers import SentenceTransformer
import numpy as np


def semantic_chunking(
    text: str,
    model_name: str = "BAAI/bge-m3",
    max_chunk_size: int = 512,
    similarity_threshold: float = 0.5,
) -> list[str]:
    model = SentenceTransformer(model_name)

    # 分句
    sentences = [s.strip() + "。" for s in text.split("。") if s.strip()]
    if len(sentences) <= 1:
        return [text]

    # 计算相邻句子的相似度
    embeddings = model.encode(sentences, normalize_embeddings=True)
    # 相邻句子余弦相似度
    similarities = [
        np.dot(embeddings[i], embeddings[i + 1])
        for i in range(len(embeddings) - 1)
    ]

    # 在相似度低谷处切分
    chunks = []
    current_sentences = [sentences[0]]
    current_length = len(sentences[0])

    for i in range(1, len(sentences)):
        # 判断是否应该切分：相似度低 OR 累积长度超限
        should_split = (
            similarities[i - 1] < similarity_threshold
            or current_length + len(sentences[i]) > max_chunk_size
        )
        if should_split and current_sentences:
            chunks.append("".join(current_sentences))
            current_sentences = [sentences[i]]
            current_length = len(sentences[i])
        else:
            current_sentences.append(sentences[i])
            current_length += len(sentences[i])

    if current_sentences:
        chunks.append("".join(current_sentences))

    return chunks
```

## 四、表格结构化切片策略

### 4.1 核心原则：保持表格的行列完整性

表格切片的关键是**绝对不能在表格中间切断**。具体策略取决于表格大小：

| 表格规模 | 策略 | 说明 |
|----------|------|------|
| 小表（<30行） | **整表保留为单个chunk** | 表头+数据完整存储 |
| 中表（30-100行） | **按行分组切片，每组携带表头** | 如每20行一组，重复表头 |
| 大表（>100行） | **按行切片 + 表格摘要chunk** | 每行/几行一个chunk，额外生成表格描述chunk |

### 4.2 表格切片代码实现

```python
"""
表格结构化切片
核心: 保证表头和数据的完整性，必要时重复表头
"""
from dataclasses import dataclass
from typing import Optional


@dataclass
class TableChunk:
    text: str              # Markdown/JSON 格式的表格文本
    table_id: str          # 表格唯一标识
    row_range: tuple       # (起始行, 结束行)
    has_header: bool       # 是否包含表头
    summary: Optional[str] # 表格摘要（可选）


def chunk_table(
    headers: list[str],
    rows: list[list[str]],
    table_id: str = "table_1",
    max_rows_per_chunk: int = 30,
    table_caption: str = "",
) -> list[TableChunk]:
    """
    表格结构化切片
    - 每个chunk携带表头，保证语义完整性
    - 转为Markdown表格格式，便于LLM理解
    - 第一个chunk额外包含表格摘要
    """
    chunks = []
    total_rows = len(rows)

    for start in range(0, total_rows, max_rows_per_chunk):
        end = min(start + max_rows_per_chunk, total_rows)
        row_subset = rows[start:end]

        # 构建 Markdown 表格文本
        md_lines = []
        if start == 0 and table_caption:
            md_lines.append(f"**表格: {table_caption}**\n")
        # 表头（每个chunk都带）
        md_lines.append("| " + " | ".join(headers) + " |")
        md_lines.append("| " + " | ".join(["---"] * len(headers)) + " |")
        # 数据行
        for row in row_subset:
            # 补齐列数
            padded = row + [""] * (len(headers) - len(row))
            md_lines.append("| " + " | ".join(padded[:len(headers)]) + " |")

        text = "\n".join(md_lines)

        # 为表格生成摘要（简化版，实际可用LLM生成）
        summary = None
        if start == 0:
            summary = f"本表共{total_rows}行数据，包含字段: {', '.join(headers)}"

        chunks.append(TableChunk(
            text=text,
            table_id=table_id,
            row_range=(start, end),
            has_header=True,
            summary=summary,
        ))

    return chunks


# ============================================================
# 完整示例: 从文档中分离正文和表格
# ============================================================
def mixed_document_chunking(
    text: str,
    max_chunk_size: int = 512,
    max_table_rows: int = 30,
) -> list[dict]:
    """
    混合文档切片主流程:
    1. 识别文档中的表格区域和正文区域
    2. 正文 → 语义切片
    3. 表格 → 结构化切片
    4. 合并结果，保留类型标签和位置信息
    """
    chunks = []

    # Step 1: 识别 Markdown 表格（| ... | 格式连续行）
    lines = text.split("\n")
    text_buffer = []
    i = 0
    table_counter = 0

    while i < len(lines):
        line = lines[i]
        # 检测表格起始（含表头分隔行 |---|---|）
        if _is_table_line(line) and i + 1 < len(lines) and _is_table_line(lines[i+1]):
            # 先处理之前缓存的正文
            if text_buffer:
                text_content = "\n".join(text_buffer)
                text_chunks = markdown_header_chunking(text_content, max_chunk_size)
                for c in text_chunks:
                    chunks.append({"type": "text", "text": c.text,
                                   "metadata": c.metadata})
                text_buffer = []

            # 提取完整表格
            table_lines = []
            while i < len(lines) and _is_table_line(lines[i]):
                table_lines.append(lines[i])
                i += 1

            # 解析表格
            headers = [h.strip() for h in table_lines[0].split("|") if h.strip()]
            rows = []
            for tl in table_lines[2:]:  # 跳过分隔行
                cells = [c.strip() for c in tl.split("|") if c.strip()]
                if cells:
                    rows.append(cells)

            # 结构化切片
            table_chunks = chunk_table(
                headers, rows,
                table_id=f"table_{table_counter}",
                max_rows_per_chunk=max_table_rows,
            )
            for tc in table_chunks:
                chunks.append({
                    "type": "table",
                    "text": tc.text,
                    "metadata": {
                        "table_id": tc.table_id,
                        "row_range": tc.row_range,
                        "summary": tc.summary,
                    },
                })
            table_counter += 1
        else:
            text_buffer.append(line)
            i += 1

    # 处理尾部正文
    if text_buffer:
        text_content = "\n".join(text_buffer)
        text_chunks = markdown_header_chunking(text_content, max_chunk_size)
        for c in text_chunks:
            chunks.append({"type": "text", "text": c.text, "metadata": c.metadata})

    return chunks


def _is_table_line(line: str) -> bool:
    """判断是否为 Markdown 表格行"""
    stripped = line.strip()
    return stripped.startswith("|") and stripped.endswith("|") and "|" in stripped[1:-1]


# ============================================================
# 运行示例
# ============================================================
if __name__ == "__main__":
    sample_doc = """
## 项目概述

本项目是一个RAG知识库问答系统，用于内部技术文档检索。

## 团队成员

| 姓名 | 角色 | 经验 | 所在城市 |
| --- | --- | --- | --- |
| 张三 | 技术负责人 | 8年 | 北京 |
| 李四 | 算法工程师 | 5年 | 上海 |
| 王五 | 后端工程师 | 3年 | 深圳 |
| 赵六 | 前端工程师 | 4年 | 杭州 |

## 技术架构

系统采用微服务架构，核心组件包括向量数据库Milvus、
Embedding服务bge-m3、重排序模块bge-reranker。
前端使用React，后端使用Python FastAPI。
""".strip()

    chunks = mixed_document_chunking(sample_doc)

    print(f"共生成 {len(chunks)} 个切片:\n")
    for i, chunk in enumerate(chunks):
        print(f"--- Chunk {i} [{chunk['type']}] ---")
        if chunk['metadata'].get('header_path'):
            print(f"  路径: {chunk['metadata']['header_path']}")
        if chunk['metadata'].get('summary'):
            print(f"  摘要: {chunk['metadata']['summary']}")
        print(f"  内容: {chunk['text'][:80]}...")
        print()
```

## 五、图表多模态解析策略

文档中的图表（柱状图、流程图、示意图）无法直接文本化，需要**多模态处理**：

```
图表处理 Pipeline:
┌──────────┐    ┌──────────────┐    ┌─────────────────┐    ┌──────────┐
│ 图片提取 │ →  │ VLM 图像理解 │ →  │ 生成文本描述     │ →  │ 切片入库  │
│ (图片区域)│    │ (GPT-4V/Qwen)│    │ + 原图URL存储    │    │(描述文本) │
└──────────┘    └──────────────┘    └─────────────────┘    └──────────┘
```

```python
"""
图表多模态解析：使用 VLM 将图表转为文字描述后入库
"""
def process_figure(image_path: str, vlm_client) -> dict:
    """
    使用视觉语言模型解析图表，生成结构化描述
    """
    import base64
    with open(image_path, "rb") as f:
        img_b64 = base64.b64encode(f.read()).decode()

    prompt = """请详细描述这张图表的内容：
    1. 图表类型（柱状图/折线图/饼图/流程图/架构图等）
    2. 图表标题和坐标轴说明
    3. 关键数据和趋势
    4. 用一段完整的文字总结图表传达的信息
    请用JSON格式返回。"""

    response = vlm_client.chat.completions.create(
        model="gpt-4o",
        messages=[{
            "role": "user",
            "content": [
                {"type": "text", "text": prompt},
                {"type": "image_url",
                 "image_url": {"url": f"data:image/png;base64,{img_b64}"}},
            ],
        }],
    )
    description = response.choices[0].message.content

    return {
        "type": "figure",
        "text": description,          # 文字描述用于Embedding检索
        "image_path": image_path,      # 原图路径，可在回答中展示
        "metadata": {"modality": "image"},
    }
```

## 六、完整混合切片策略架构

```
                    ┌─────────────────────┐
                    │   原始文档 (PDF等)   │
                    └──────────┬──────────┘
                               ↓
                    ┌─────────────────────┐
                    │  文档解析 & 元素分类  │
                    │  (unstructured/PyMuPDF)│
                    └──────────┬──────────┘
                               ↓
              ┌────────────────┼────────────────┐
              ↓                ↓                 ↓
     ┌────────────┐   ┌────────────┐    ┌────────────┐
     │ 正文段落    │   │ 表格数据    │    │ 图表/图片   │
     └──────┬─────┘   └──────┬─────┘    └──────┬─────┘
            ↓                ↓                  ↓
     ┌────────────┐   ┌────────────┐    ┌────────────┐
     │语义/标题切片 │   │结构化切片   │    │VLM→文字描述 │
     │(段落/标题)  │   │(整表/分组)  │    │(GPT-4V)    │
     └──────┬─────┘   └──────┬─────┘    └──────┬─────┘
            ↓                ↓                  ↓
     ┌────────────┐   ┌────────────┐    ┌────────────┐
     │ type=text  │   │ type=table │    │type=figure │
     │ +header路径│   │ +表头+摘要 │    │ +原图路径  │
     └──────┬─────┘   └──────┬─────┘    └──────┬─────┘
            └────────────────┼─────────────────┘
                             ↓
                    ┌─────────────────────┐
                    │  统一 Embedding 入库  │
                    │  (元数据保留类型标签) │
                    └─────────────────────┘
```

**检索时的差异化处理**：
- 检索结果中如果是`type=table`，在Prompt中用Markdown表格格式注入，LLM理解效果更好
- 检索结果中如果是`type=figure`，在回答中可以附上原图链接，增强可解释性
- 元数据中的`header_path`可以用于**元数据过滤**，缩小检索范围

## 七、面试加分点

1. **切片不是越小越好**：chunk太小会导致上下文断裂，太大会导致Embedding语义稀释。需要通过评测找到最佳chunk_size——可以用不同chunk_size构建索引，对比Recall@5来量化选择。
2. **表格向量化的进阶技巧**：对于纯数值表格，直接Embedding效果差（数字语义弱）。可以对表格做**自然语言化**预处理（如将"张三|28|工程师"转为"张三是一名28岁的工程师"），显著提升检索效果。
3. **父子切片策略（Parent-Document Chunking）**：检索时用小chunk（精准匹配），但返回时扩展到大chunk（完整上下文）。LangChain的`ParentDocumentRetriever`实现了这一策略。
4. **上下文增强窗口（Contextual Enrichment）**：每个chunk入库前，用LLM生成一段摘要作为前缀——Anthropic的Contextual RAG技术证明这能显著降低检索失败率。
5. **生产环境工具链推荐**：文档解析用 `unstructured` 或 `marker`（表格识别好）；切片用 LlamaIndex的`SentenceSplitter` + 自定义Table解析；PDF表格提取推荐 `camelot` 或 `pdfplumber`。
6. **Late Chunking**（2024年新技术）：先对整个文档做Embedding（保留全局上下文），再做切片——通过延迟切片时机来保留文档级的上下文信息，在长文档检索中有显著优势。
