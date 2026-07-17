---
id: note-xhs-ai-053
difficulty: L3
category: ai
subcategory: RAG
tags:
- RAG
- 文档切片
- Chunking
- 语义分割
- 滑动窗口
- Embedding
source: 高德AI大模型应用开发面试
feynman:
  essence: 文档切片（Chunking）避免信息丢失的核心是语义切片+滑动窗口重叠（10%-15%）+结构化文档单独处理（标题锚定切片）。
  analogy: 固定切片像用裁纸刀按固定长度切报纸——一句话可能被拦腰截断。语义切片像按段落和语义切——保证每个片段意思完整。滑动窗口像切的时候每刀和上一刀重叠一小段——防止跨段信息被遗漏。
  key_points:
  - 固定分块问题：割裂语义、丢失跨段落关联、规则类文档被拆碎
  - 语义切片：按章节/段落/句子自然边界切分
  - 滑动窗口重叠：10%-15%窗口避免关键语句被切割
  - 结构化文档：标题锚定切片，保证每条规则完整留存
  - 进阶策略：父子分块(Parent-Child)、递归分块、表格保留
first_principle:
  problem: RAG检索是chunk级别的——检索返回的是切片而非完整文档。如果切片丢失了上下文，检索到的碎片无法支撑准确回答。如何切才能既不丢信息又不浪费Token？
  axioms:
  - 切片太大：Embedding向量包含太多信息，检索精度下降，Token浪费
  - 切片太小：上下文丢失，模型无法理解完整含义
  - 自然语言有层次结构：标题>段落>句子>词
  - 结构化文档（表格、规则）有逻辑完整性要求
  rebuild: 按文档结构自适应选择切分点 → 段落级别语义切片 → 切片间加10%-15%重叠 → 表格和规则单独处理不切割 → 父子分块让检索用小块、生成用大块。
follow_up:
  - 切片大小选多大合适？256 token还是512 token？
  - 如果文档是PDF，包含图表和表格，怎么处理？
  - 父子分块（Parent-Child Chunking）是什么？解决了什么问题？
  - 如何评估切片质量？有没有自动化指标？
  - 中文的切片策略和英文有什么不同？
memory_points:
  - 核心策略：语义切片 + 10%-15%滑动窗口重叠 + 结构化文档标题锚定
  - 固定分块三大问题：语义割裂、关联丢失、规则拆碎
  - 父子分块：检索小块精度高，生成时返回父块提供上下文
  - 切片大小经验值：通用文档256-512 token，技术文档可以更大
---

# 【高德AI面试】做文档切片的时候，怎么避免关键信息丢失？

## 🎯 一句话本质

避免信息丢失的核心策略：**语义切片**（按段落/章节自然边界切分）+ **滑动窗口重叠**（10%-15%）+ **结构化文档特殊处理**（标题锚定、表格保留）。进阶方案用**父子分块**平衡检索精度和上下文完整性。

## 🧒 费曼类比

```
固定分块（错误做法）：
  "...第三条，退票手续费按照票价的" | "20%收取，最低10元起..."
  ↑ 这句话被切断了！检索时可能只检索到一半

语义切片（正确做法）：
  Chunk 1: "...第三条，退票手续费按照票价的20%收取，最低10元起。"  ← 完整规则
  Chunk 2: "...第四条，改签需在发车前2小时操作..."               ← 另一条完整规则
  
滑动窗口重叠：
  Chunk 1: "...第二条...第三条（完整）...第四条开头..."
  Chunk 2: "...第三条（重复尾部）...第四条（完整）..."
  ↑ 第三条出现在两个chunk中，保证检索时不会漏掉
```

## 📊 切片策略对比

```
┌───────────────── 固定分块（Fixed-Size Chunking）─────────────────┐
│ doc: AABBBCCDDDEEEFFFGGG...                                     │
│ chunks: [AABB] [BCCD] [DDDE] [EEFF] [FGGG]                      │
│ 问题：BCCD包含不相关的B和D，语义被割裂                              │
└──────────────────────────────────────────────────────────────────┘

┌───────────────── 语义切片（Semantic Chunking）──────────────────┐
│ doc: 段落1(AA) 段落2(BBB) 段落3(CC) 段落4(DDD)                   │
│ chunks: [段落1] [段落2] [段落3] [段落4]                           │
│ 优点：每个chunk语义完整                                           │
└──────────────────────────────────────────────────────────────────┘

┌─────────── 滑动窗口重叠（Sliding Window Overlap）──────────────┐
│ chunks: [段落1 + 段落2头部] [段落2 + 段落3头部] [段落3 + ...]    │
│ 优点：跨段落的关键信息不会因为切分点而丢失                           │
└──────────────────────────────────────────────────────────────────┘

┌─────────── 父子分块（Parent-Child Chunking）──────────────────┐
│ Parent: [完整段落 - 800 tokens]                                  │
│   Child1: [段落前半 - 200 tokens]                                │
│   Child2: [段落后半 - 200 tokens]                                │
│ 检索：用Child（精度高）→ 返回：用Parent（上下文完整）              │
└──────────────────────────────────────────────────────────────────┘
```

## 🔧 核心实现

### 1. 语义切片 + 滑动窗口

```python
from langchain.text_splitter import RecursiveCharacterTextSplitter

def semantic_chunk_with_overlap(text, chunk_size=512, overlap=64):
    """
    递归语义切片：
    1. 先按章节标题切（##, ###）
    2. 再按段落（\\n\\n）
    3. 再按句子（。！？.!?）
    4. 最后按字符兜底
    """
    splitter = RecursiveCharacterTextSplitter(
        chunk_size=chunk_size,
        chunk_overlap=overlap,  # 10%-15% of chunk_size
        separators=[
            "\n## ", "\n### ", "\n#### ",  # Markdown标题
            "\n\n",                         # 段落
            "。", "！", "？",               # 中文句子
            ". ", "! ", "? ",              # 英文句子
            "；", ";",                     # 分号
            "，", ",", " ", ""             # 最终字符兜底
        ]
    )
    return splitter.split_text(text)
```

### 2. 结构化文档标题锚定切片

```python
def structure_aware_chunk(document):
    """针对规则类、流程类文档的切片策略"""
    chunks = []
    
    # 1. 解析文档结构
    sections = parse_sections(document)  # 按标题层级解析
    
    for section in sections:
        title = section['title']  # 如"第三条 退票规则"
        content = section['content']
        
        # 2. 如果整个section不超过阈值，整体保留
        if len(content) <= MAX_CHUNK_SIZE:
            chunks.append({
                'text': f"{title}\n{content}",  # 标题锚定
                'metadata': {'section': title, 'type': 'rule'}
            })
        else:
            # 3. 超长的section递归切分，但每块都带上标题
            sub_chunks = semantic_chunk_with_overlap(content)
            for sc in sub_chunks:
                chunks.append({
                    'text': f"{title}\n{sc}",
                    'metadata': {'section': title, 'type': 'rule'}
                })
    
    # 4. 表格单独处理，不切割
    for table in document.tables:
        chunks.append({
            'text': table_to_markdown(table),
            'metadata': {'type': 'table', 'section': table.title}
        })
    
    return chunks
```

### 3. 父子分块（高级策略）

```python
class ParentChildChunker:
    """检索用小块（精度高），生成用大块（上下文全）"""
    
    def chunk(self, document):
        # 1. 先切成大块（Parent）- 如一个完整章节
        parents = self.large_splitter.split(document, size=1024)
        
        result = []
        for i, parent in enumerate(parents):
            # 2. 每个大块再切成小块（Child）- 如200 tokens
            children = self.small_splitter.split(parent, size=200)
            
            for child in children:
                result.append({
                    'child_text': child,           # 用于Embedding检索
                    'child_embedding': embed(child),
                    'parent_id': f'parent_{i}',     # 关联到Parent
                })
            
            # Parent单独存储（不做Embedding，只做ID关联）
            self.parent_store[f'parent_{i}'] = parent
        
        return result
    
    def retrieve(self, query, top_k=5):
        # 检索Child → 返回Parent
        child_hits = self.vector_store.search(embed(query), top_k=top_k)
        parent_ids = list(set([h['parent_id'] for h in child_hits]))
        return [self.parent_store[pid] for pid in parent_ids]
```

## 📋 切片策略选择指南

| 文档类型 | 推荐策略 | chunk_size | overlap | 备注 |
|---------|---------|------------|---------|------|
| 技术文档 | 递归语义切分 | 512 | 64 | 按标题+段落 |
| 法律/规则 | 标题锚定切片 | 不限 | 0 | 保证每条规则完整 |
| FAQ问答 | 单Q&A一对一切片 | 不限 | 0 | 一个Q&A一个chunk |
| 长篇报告 | 父子分块 | Child:200/Parent:1024 | 20 | 检索精度+上下文 |
| 表格数据 | 整表保留 | 不限 | 0 | 不切割，转markdown |
| 代码文档 | 按函数/类切分 | 不限 | 0 | 保持代码块完整 |

## ❓ 苏格拉底式面试追问

1. **"你说overlap设置为10%-15%，为什么不是30%甚至50%？overlap越大信息越全不是吗？"**
   → overlap过大导致存储浪费和检索结果冗余。10%-15%足以覆盖跨段落语句

2. **"如果两个chunk完全相同（因为overlap），检索时返回了重复内容怎么处理？"**
   → metadata去重 + 父子分块只返回一次Parent

3. **"Markdown和PDF的切片策略有什么不同？PDF没有标题标记怎么办？"**
   → PDF需要OCR+布局分析提取结构，可用marker-pdf等工具。Markdown天然有结构标记

4. **"高德出行规则这种结构化文档，如果用户问'北京到上海的高速费'，你的切片策略怎么保证检索到正确答案？"**
   → 标题锚定+表格保留+metadata关联路线和城市信息

5. **"如何衡量切片质量？有没有自动化的评估方法？"**
   → RAGAS等框架评估context_precision/context_recall/faithfulness

## 结构化回答

**30 秒电梯演讲：** 文档切片（Chunking）避免信息丢失的核心是语义切片+滑动窗口重叠（10%-15%）+结构化文档单独处理（标题锚定切片）。

**展开框架：**
1. **固定分块问题** — 割裂语义、丢失跨段落关联、规则类文档被拆碎
2. **语义切片** — 按章节/段落/句子自然边界切分
3. **滑动窗口重叠** — 10%-15%窗口避免关键语句被切割

**收尾：** 您想深入聊：切片大小选多大合适？256 token还是512 token？


## 视频脚本

> 预计时长：4 分钟 | 由浅入深


| 时间 | 画面/字幕 | 口播台词 | 讲解要点 |
|------|----------|----------|----------|
| 0:00 | 标题卡：做文档切片的时候，怎么避免关键信息丢失？ | "固定切片像用裁纸刀按固定长度切报纸——一句话可能被拦腰截断。语义切片像按段落和语义切——保…" | 开场钩子 |
| 0:20 | 核心概念图 | "文档切片（Chunking）避免信息丢失的核心是语义切片+滑动窗口重叠（10%-15%）+结构化文档单独处理（标题锚定切…" | 核心定义 |
| 0:50 | 固定分块问题示意图 | "固定分块问题——割裂语义、丢失跨段落关联、规则类文档被拆碎" | 要点拆解1 |
| 1:30 | 对比/实战案例图 | "对比一下常见误区和工程实践，看真实场景里怎么取舍。" | 实战与对比 |
| 2:20 | 总结卡 | "记住核心要点。下期我们追问：切片大小选多大合适？256 token还是512 token？" | 收尾与钩子 |
