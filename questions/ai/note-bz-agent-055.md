---
id: note-bz-agent-055
difficulty: L3
category: ai
subcategory: RAG
tags:
  - B站面经
  - RAG
  - Chunking
  - 文档分割
feynman:
  essence: 文档分块(Chunking)=把长文档切成可检索的小块。核心权衡：太大(检索不准/超token)vs太小(丢失上下文)。策略有固定/递归/语义/结构化分块。
  analogy: 像切蛋糕——切太大一块吃不下(超token)，切太小吃不到料(丢上下文)，要切得每块都有完整味道。
  first_principle: 检索粒度=分块大小。块太大→一个块包含多个主题，检索不精准。块太小→语义不完整，检索到了但信息不全。
  key_points:
    - 核心权衡：大小/上下文/精准度
    - 策略：固定/递归/语义/结构化/父子
    - 经验：chunk_size 300-500，overlap 10-20%
    - 进阶：父子分块(检索小块返回大块)
first_principle:
  essence: 分块是检索粒度的决定因素——粒度匹配查询需求。
  derivation: '用户问题需要多详细的信息？简单事实用小块（精准），复杂分析用大块（上下文全）。没有最优块大小，只有最适合的。父子分块兼顾两者。'
  conclusion: Chunking = 匹配检索粒度（块大小权衡精准与上下文）
follow_up:
  - chunk_size多少合适？——300-500字符（中文），可实验调优
  - overlap有必要吗？——有，防止语义被切断
  - 不同文档用不同策略吗？——是，论文按章节，对话按轮次
---

# 文档的加载和分割（Chunking）怎么做？

## 一、为什么需要分块

```
原始文档可能很长（一本手册100页=50000字）

不分块的问题：
  1. 整篇文档作为一个向量 → 一个向量表示太多内容（语义稀释）
  2. 检索到整篇 → 超出LLM上下文窗口
  3. 不相关的内容也带进去 → 噪音

分块的好处：
  ✓ 每块语义聚焦（一个主题）
  ✓ 检索精准（找到最相关的段落）
  ✓ 控制上下文大小（top-k块不超token）
```

## 二、分块策略

### 策略 1：固定大小分块（最简单）

```python
from langchain.text_splitter import CharacterTextSplitter

splitter = CharacterTextSplitter(
    chunk_size=500,      # 每块500字符
    chunk_overlap=50,    # 相邻块重叠50字符
    separator="\n\n"     # 尽量在段落边界切
)
chunks = splitter.split_text(long_document)
```

### 策略 2：递归分块（推荐）

```python
from langchain.text_splitter import RecursiveCharacterTextSplitter

splitter = RecursiveCharacterTextSplitter(
    chunk_size=500,
    chunk_overlap=50,
    separators=["\n\n", "\n", "。", "，", " ", ""]  # 按优先级递归切
)
# 先尝试按段落切，太大则按句子，再大则按字符
# 尽量在自然边界切，保留语义
```

### 策略 3：语义分块

```python
# 用Embedding检测语义边界
class SemanticChunker:
    def chunk(self, text):
        sentences = split_sentences(text)
        
        # 计算相邻句子的语义相似度
        for i in range(len(sentences) - 1):
            sim = cosine(embed(sentences[i]), embed(sentences[i+1]))
            if sim < threshold:  # 语义跳变点
                # 这里是分块边界
                start_new_chunk(i + 1)
# 在语义自然断点处分块，最尊重语义
```

### 策略 4：结构化分块（按文档结构）

```python
# 按标题/章节分块
class StructureChunker:
    def chunk(self, markdown_doc):
        # Markdown按标题层级分
        sections = re.split(r'^#+\s', markdown_doc, flags=re.M)
        # 每个section是一个块
        # 保留标题作为metadata
        
    def chunk_pdf(self, pdf):
        # PDF按页/章节分
        for page in pdf:
            if is_chapter_start(page):
                start_new_chunk()
```

### 策略 5：父子分块（进阶）

```python
class ParentChildChunker:
    """检索小块，返回大块"""
    def chunk(self, doc):
        # 先切大块（父）：2000字符
        parents = split(doc, size=2000)
        
        for parent in parents:
            # 再切小块（子）：200字符
            children = split(parent, size=200)
            for child in children:
                # 子块建索引（用于检索）
                child.metadata["parent_id"] = parent.id
                self.index.add(child)
            # 父块存储（用于返回）
            self.parent_store[parent.id] = parent
    
    def retrieve(self, query):
        # 检索子块（精准）
        child_hits = self.index.search(query, k=5)
        # 返回父块（上下文全）
        parent_ids = {c.metadata["parent_id"] for c in child_hits}
        return [self.parent_store[pid] for pid in parent_ids]
```

## 三、分块参数选择

```python
# 经验值
params = {
    "chunk_size": {
        "事实问答": 200-300,    # 小块，精准
        "总结分析": 500-1000,   # 大块，上下文全
        "代码": 按函数/类,      # 结构化
        "对话": 按轮次,         # 每轮一块
    },
    "chunk_overlap": {
        "推荐": chunk_size的10-20%,
        "作用": 防止关键信息被切断,
        "代价": 增加存储和冗余,
    }
}

# 调优方法：实验对比不同参数的召回率
for size in [200, 400, 600, 800]:
    for overlap in [0, 50, 100]:
        chunks = chunk(docs, size, overlap)
        recall = evaluate(test_cases, chunks)
        print(f"size={size}, overlap={overlap}: recall={recall}")
```

## 四、不同文档类型的分块

```python
document_strategies = {
    "PDF/Word（文章）": "递归分块，按段落→句子",
    "Markdown": "按标题层级分（# ## ###）",
    "代码": "按函数/类/方法分",
    "表格": "每行/每组相关行一块",
    "对话记录": "每轮对话或每几轮一块",
    "FAQ": "每个Q&A对一块",
    "长篇小说": "按章节分",
    "API文档": "每个接口/端点一块",
}
```

## 五、分块质量的影响

```
分块好坏对RAG效果影响巨大：

好的分块：
  块1: "Agent的规划能力指任务分解"     ← 一个主题
  块2: "Agent的记忆分为短期和长期"      ← 一个主题
  → 查"规划"精准命中块1

坏的分块（固定500字符硬切）：
  块1: "Agent的规划能力指...记忆分为短期"  ← 两个主题混在一起
  → 查"规划"命中了，但块里一半是"记忆"，噪音大
```

## 六、面试加分点

1. **强调"粒度匹配"**：没有最优块大小，要看查询需求——事实用小块，分析用大块
2. **父子分块**：检索小块精准+返回大块上下文全，这是进阶技巧
3. **按文档类型分**：代码/对话/表格各有适合的分块方式，不能一刀切
