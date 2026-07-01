---
id: note-ai50-005
difficulty: L2
category: ai
subcategory: RAG
tags:
- 某厂
- 面经
- RAG
- 文档切片
- Chunk
feynman:
  essence: Overlap让相邻chunk共享一部分文本，避免关键信息被切断在两个chunk的边界处
  analogy: 就像装修贴瓷砖留重叠缝——每块瓷砖边缘和下一块重叠一小段，这样即使某块有瑕疵，整体也不会出现明显的缝隙
  first_principle: 一个完整语义单元（如一句话、一个段落）恰好跨越两个chunk的边界时，两个chunk都不完整。Overlap提供冗余，保证边界信息至少在一个chunk中是完整的
  key_points:
  - '标准配置: chunk_size=512, overlap=50-100 tokens'
  - Overlap不是越大越好——增加存储和计算成本
  - Overlap解决的是"硬切分"问题，更好的方案是语义切分
  - 对于表格、代码等结构化内容，Overlap应设为0
first_principle:
  essence: 语义完整性要求上下文连续性，硬切分破坏这种连续性
  derivation: 假设chunk边界恰好在一句话中间，前一个chunk缺少句尾，后一个chunk缺少句首。Overlap=50 tokens意味着两句话的边界内容在两个chunk中都存在，检索时至少有一个chunk包含完整句子
  conclusion: Overlap是对硬切分的廉价修补，语义切分是更优的解决方案
follow_up:
- 语义切分(Semantic Chunking)怎么实现？
- chunk_size设多大最合适？和模型上下文窗口什么关系？
- 如果文档很短（比如只有2段），还需要切片吗？
memory_points:
- 目的：解决硬性切分导致的语义断裂，防止关键信息在切片交界处因缺少上下文而无法被理解。
- Overlap保留相邻Chunk的重叠部分，经验值通常设为Chunk大小的10%-20%。
- 最优解是语义切分：按段落和句子自然边界断开，而非固定Token数硬切。
---

# 文档切片为什么要有Overlap？它主要解决什么问题？

## 问题：硬切分的语义断裂

```
文档原文:
"...Transformer的核心创新是Self-Attention机制，它允许每个位置直接
关注序列中所有其他位置。这种全局依赖建模能力使Transformer在处理
长序列时优于RNN。不过Self-Attention的计算复杂度是O(n²)..."

┌── Chunk 1 (tokens 0-511) ──────────────────────────┐
│ ...Transformer的核心创新是Self-Attention机制，它允许 │
│ 每个位置直接关注序列中所有其他位置。这种全局依赖建模  │
│ 能力使Transformer在处理长序列时优于RNN。不过Self-A  │
│ ttention的计算复 ← 被截断!                          │
└─────────────────────────────────────────────────────┘

┌── Chunk 2 (tokens 512-1023) ───────────────────────┐
│ 杂度是O(n²)... ← 缺少前文上下文!                     │
│ 为了解决这个问题，研究者提出了Sparse Attention...    │
└─────────────────────────────────────────────────────┘

问题: 用户问"Self-Attention的计算复杂度是多少？"
→ Chunk 1: 信息不完整（被截断）
→ Chunk 2: 缺少主语（不知道是什么的复杂度）
→ 两个chunk都无法准确回答！
```

## Overlap如何解决

```
┌── Chunk 1 (tokens 0-511) ──────────────────────────┐
│ ...Transformer的核心创新是Self-Attention机制...     │
│ ...优于RNN。不过Self-Attention的计算复杂度是O(n²).. │
│ ..[overlap区域] ← 与Chunk2重叠的内容                │
└─────────────────────────────────────────────────────┘
                        ↕ overlap = 50 tokens
┌── Chunk 2 (tokens 462-973) ────────────────────────┐
│ [overlap区域] ← 与Chunk1重叠的内容                  │
│ ...不过Self-Attention的计算复杂度是O(n²)...         │
│ ...Sparse Attention将复杂度降到O(n·log n)...        │
└─────────────────────────────────────────────────────┘

结果: Chunk 1和Chunk 2都包含完整的"复杂度是O(n²)"这个语义单元
```

## 标准配置

```python
from langchain.text_splitter import RecursiveCharacterTextSplitter

splitter = RecursiveCharacterTextSplitter(
    chunk_size=500,        # 每个chunk约500字符
    chunk_overlap=50,      # 相邻chunk重叠50字符(约10%)
    separators=["\n\n", "\n", "。", "！", "？", ".", " ", ""]
)

# 参数选择经验:
# chunk_size: 根据embedding模型的最大输入(通常512 tokens)
# overlap: chunk_size的10%-20%
```

## Overlap大小的权衡

| Overlap | 优点 | 缺点 | 适用场景 |
|---------|------|------|---------|
| 0 | 存储最省，无冗余 | 边界信息丢失 | 结构化文档（表格/代码） |
| 10% | 轻微冗余，基本够用 | 大段落仍可能断裂 | 短文本，简单文档 |
| 15-20% | 大多数边界问题解决 | 存储增加20% | **推荐默认值** |
| 30%+ | 几乎无边界问题 | 存储暴增，检索噪音 | 极长段落，法律文档 |

## 更优方案：语义切分

```python
# 语义切分不按固定token数，而是按自然边界切分
def semantic_chunk(text, max_chunk_size=512):
    """按段落和句子自然边界切分"""
    # Step 1: 按段落分割
    paragraphs = text.split('\n\n')
    
    chunks = []
    current_chunk = []
    current_size = 0
    
    for para in paragraphs:
        para_size = count_tokens(para)
        
        # 段落本身超长 → 按句子再分
        if para_size > max_chunk_size:
            if current_chunk:
                chunks.append('\n\n'.join(current_chunk))
                current_chunk, current_size = [], 0
            # 按句子切分超长段落
            sentences = split_sentences(para)
            for sent in sentences:
                if current_size + count_tokens(sent) > max_chunk_size:
                    chunks.append('\n\n'.join(current_chunk))
                    current_chunk, current_size = [sent], count_tokens(sent)
                else:
                    current_chunk.append(sent)
                    current_size += count_tokens(sent)
        # 段落能放下 → 累加
        elif current_size + para_size > max_chunk_size:
            chunks.append('\n\n'.join(current_chunk))
            current_chunk, current_size = [para], para_size
        else:
            current_chunk.append(para)
            current_size += para_size
    
    if current_chunk:
        chunks.append('\n\n'.join(current_chunk))
    
    return chunks
```

**语义切分优势**: 不需要Overlap，因为切分点天然在段落/句子边界，不会切断语义单元。

## 特殊内容的处理

| 内容类型 | 切分策略 | Overlap |
|---------|---------|---------|
| 普通文本 | 按段落+句子 | 10-15% |
| 代码 | 按函数/类边界 | 0 |
| 表格 | 整表作为一个chunk | 0 |
| Markdown | 按标题层级 | 0 |
| 对话记录 | 按对话轮次 | 5-10% |

## 记忆要点

- 目的：解决硬性切分导致的语义断裂，防止关键信息在切片交界处因缺少上下文而无法被理解。
- Overlap保留相邻Chunk的重叠部分，经验值通常设为Chunk大小的10%-20%。
- 最优解是语义切分：按段落和句子自然边界断开，而非固定Token数硬切。

