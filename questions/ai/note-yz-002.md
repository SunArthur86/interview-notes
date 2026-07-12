---
id: note-yz-002
difficulty: L3
category: ai
subcategory: RAG
tags:
- 宇树科技
- AI Agent
- RAG
- Chunking
- 文本分块
- 面经
feynman:
  essence: Chunking是把长文档切成可检索的小块，策略直接影响RAG召回质量。核心是在"语义完整性"和"检索精度"之间平衡——块太大检索不精准，块太小丢失上下文。常见策略有固定长度、按段落、按语义边界、递归分块。
  analogy: 像切蛋糕——均匀切（固定长度）简单但可能切开草莓；按花纹切（按段落）美观但大小不一；按草莓位置切（语义分块）每个都有完整草莓但形状不规则。
  key_points:
  - 固定长度分块：简单粗暴，可能切断句子
  - 按段落/标题分块：语义完整但块大小不均
  - 递归分块：先按大标题再按段落再按句子，层次化切分
  - 语义分块：用embedding相似度找语义边界，最精准但最慢
  - overlap重叠：相邻块重叠20-30%避免边界信息丢失
first_principle:
  essence: Chunking = 在信息完整性和检索精度之间寻找最优切分粒度
  derivation: 文档→切分成块→每块embedding→检索时用query embedding匹配→块太大→embedding被稀释→检索不准→块太小→上下文断裂→答案不完整→需在两者间平衡
  conclusion: 没有万能策略，需按文档类型（代码/FAQ/论文/法律）选择，并用eval指标验证效果
follow_up:
- chunk_size设多少合适？（一般256-512 token，按模型和文档类型调）
- overlap设多少？（通常10-20%的chunk_size）
- 如何评估chunking策略的好坏？（用RAGAS的context precision/recall指标）
- 中英文文档的chunking策略有什么区别？（中文按句号/段落，英文按.和换行）
memory_points:
- 四种策略：固定长度(简单) → 按段落(完整) → 递归分块(层次化) → 语义分块(最精准)
- chunk_size通常256-512 token，overlap通常chunk_size的10-20%
- 核心矛盾：块大=上下文完整但检索不准，块小=检索准但上下文断裂
- 按文档类型选：FAQ用每条一个chunk，论文用按section切，代码用按函数切
- 加分项：提到markdown-aware分块(按标题层级)和代码感知分块(按函数/类)
---

# 【宇树科技二面】RAG 的 Chunking 策略如何设计？遇到过哪些问题，如何调整？

> 来源：小红书 宇树科技 AI Agent 三轮面试面经

## 一、Chunking 为什么重要

```
RAG 完整流程

文档 ──► Chunking ──► Embedding ──► 存入向量库
                                         │
用户查询 ──► Query Embedding ──────────► 检索 Top-K
                                         │
                                    取回的 Chunk
                                         │
                                    LLM 生成答案

         Chunking 是第一步，直接影响后续所有环节的质量
         切得不好 → 检索不到 → LLM 无法回答
```

**Chunking 的核心矛盾**：

```
块太大(1000+ token)               块太小(50 token)
┌──────────────────┐             ┌──────┐
│ 包含多个主题       │             │ 单句   │
│ embedding被稀释   │             │ 无上下文│
│ 检索时不够精准     │             │ 答案片面│
│ 但上下文完整       │             │ 但检索精准│
└──────────────────┘             └──────┘
      ↑                                ↑
   需要在两者之间找到最优粒度
```

## 二、四种 Chunking 策略

### 策略1：固定长度分块（最简单）

```python
from langchain.text_splitter import CharacterTextSplitter

splitter = CharacterTextSplitter(
    chunk_size=500,        # 每块500字符
    chunk_overlap=50,      # 相邻块重叠50字符
    separator="\n"         # 按换行分割
)
chunks = splitter.split_text(document)
```

```
固定长度分块示意

原始文本: [AAAAAA\nBBBBBB\nCCCCCC\nDDDDDD\nEEEEEE...]
                 ↑ 切割点
chunk 1: [AAAAAA BBBB]     (500字符)
chunk 2: [BBB CCCCCC DDD]  (重叠50字符)
chunk 3: [DDD EEEEEE FFF]

问题：可能从句子中间切开 → 语义断裂
```

### 策略2：按段落/标题分块（语义完整）

```python
from langchain.text_splitter import MarkdownHeaderTextSplitter

# 按 Markdown 标题层级分割
headers_to_split_on = [
    ("#", "Header 1"),
    ("##", "Header 2"),
    ("###", "Header 3"),
]

splitter = MarkdownHeaderTextSplitter(headers_to_split_on)
chunks = splitter.split_text(markdown_doc)
# 每个 chunk 是一个完整的 section
```

```
Markdown 感知分块

# 第一章：环境配置         ← Header 1
## 1.1 安装Java           ← Header 2  
Java需要JDK17...          ← 属于1.1的完整段落
## 1.2 配置Maven          ← Header 2
Maven配置如下...           ← 属于1.2的完整段落

→ 每个 section 作为独立 chunk，保留标题作为元数据
→ 优点：语义完整
→ 缺点：section 长度不均（有的50字有的2000字）
```

### 策略3：递归分块（推荐，层次化）

```python
from langchain.text_splitter import RecursiveCharacterTextSplitter

splitter = RecursiveCharacterTextSplitter(
    chunk_size=500,
    chunk_overlap=50,
    separators=[
        "\n\n",    # 先按空行（段落）
        "\n",      # 再按换行
        "。",      # 再按句号
        "；",      # 再按分号
        " ",       # 最后按空格
        ""         # 实在不行按字符
    ]
)
# 优先用大粒度分割，超长时自动降级到小粒度
```

```
递归分块逻辑

文档(5000字)
    │
    ├── 按段落(\n\n)分割 → 段落1(800字), 段落2(300字), 段落3(1200字)...
    │
    ├── 段落1(800字) > 500? → 是 → 按句号(。)再分
    │   └── 句子1(300字), 句子2(500字) → 合并到接近500字
    │
    └── 段落2(300字) < 500? → 是 → 保持原样，可能和下一段落合并

效果：在保持语义完整的前提下尽量接近目标长度
```

### 策略4：语义分块（最精准）

```python
from sentence_transformers import SentenceTransformer
import numpy as np

model = SentenceTransformer('all-MiniLM-L6-v2')

def semantic_chunk(text, threshold=0.5):
    """基于embedding相似度的语义分块"""
    # 1. 按句子分割
    sentences = text.split('。')
    
    # 2. 计算相邻句子的embedding相似度
    embeddings = model.encode(sentences)
    
    # 3. 找相似度骤降的点 → 语义边界
    chunks = []
    current_chunk = [sentences[0]]
    
    for i in range(1, len(sentences)):
        sim = cosine_similarity(embeddings[i], embeddings[i-1])
        if sim < threshold:
            # 语义断点 → 新的chunk
            chunks.append('。'.join(current_chunk))
            current_chunk = [sentences[i]]
        else:
            current_chunk.append(sentences[i])
    
    chunks.append('。'.join(current_chunk))
    return chunks
```

## 三、参数调优经验

### chunk_size 和 overlap 的选择

| 文档类型 | 推荐 chunk_size | overlap | 原因 |
|---------|----------------|---------|------|
| **FAQ** | 100-200 token | 0 | 每条QA独立 |
| **技术文档** | 300-500 token | 50 | 保持段落完整 |
| **学术论文** | 500-800 token | 100 | 上下文依赖强 |
| **法律条文** | 200-400 token | 50 | 条款独立性 |
| **代码** | 按函数/类切分 | 0 | 代码块不可切断 |

### 常见问题与调优

```
问题1：检索结果相关但不完整
原因：chunk_size太小，上下文断裂
解决：增大chunk_size 或 增加 overlap

问题2：检索结果不相关
原因：chunk_size太大，embedding被稀释
解决：减小chunk_size 或 改用语义分块

问题3：同一文档的不同chunk互相干扰
原因：跨主题内容混在一起
解决：按标题分块 + 保留metadata做过滤

问题4：表格/代码被切断
原因：固定长度分块不感知结构
解决：用Markdown/代码感知的分割器
```

## 四、面试加分点

1. **没有银弹**：能说出"不同文档类型需要不同策略"，展示工程判断力
2. **overlap的必要性**：解释为什么需要重叠——避免边界信息丢失
3. **评估方法**：提到用RAGAS的context precision/recall指标量化评估chunking效果
4. **实践经验**：能说出具体调优案例（如"FAQ文档每条一个chunk，技术文档递归分块500 token"）
5. **进阶方案**：提到Parent-Child分块（小块检索+大块返回上下文）和Late Chunking等前沿方法
