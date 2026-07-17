---
id: note-sp-003
difficulty: L4
category: ai
subcategory: RAG
tags:
- RAG
- 文档分块
- Parent-Document
- 虾皮
- 面经
- 检索策略
feynman:
  essence: 父子文档分块 = 用小块(语义精确)做检索匹配，用大块(上下文完整)喂给LLM生成。解决了"小块语义精确但上下文断裂"和"大块匹配模糊但上下文完整"之间的矛盾。
  analogy: 想象你在图书馆找书。用书名/章节标题(小块)精确定位到你要的内容，但借阅时拿走整本书(父块)而不是单页，因为单页内容可能因为缺少前后文而难以理解。
  first_principle: 检索的精确性和生成的上下文完整性对分块大小的要求是矛盾的——小块检索精确但可能断裂语义，大块上下文完整但匹配模糊。父子分块通过解耦检索粒度和生成粒度来打破这个权衡。
  key_points:
  - '检索小块(如1-2段)→向量匹配精确，减少噪声'
  - '返回父块(如整个文档/章节)→LLM获得完整上下文'
  - '父子通过文档ID/章节ID关联，父块包含子块'
  - '子块不含父块的额外信息，但返回时带上父块的全部上下文'
first_principle:
  essence: 分块大小存在"检索精确性"与"生成上下文完整性"的根本矛盾。
  derivation: 向量检索需要chunk小→语义聚焦→匹配精确 → 但LLM需要大上下文→理解完整逻辑 → 小chunk缺前后文→LLM可能误解 → 大chunk匹配模糊→检索精度下降 → 所以解耦两个粒度：小检大返
  conclusion: 父子分块 = 检索用小(精确) + 生成用大(完整) = 两全其美
follow_up:
- 父块太大导致context超限怎么办？
- 父子分块 vs 滑动窗口分块，各自的优缺点？
- 如何确定父子块的合适大小？
- 多层父子结构(祖父-父-子)有必要吗？
memory_points:
- 核心矛盾：检索精确(小块) vs 上下文完整(大块)
- 方案：小块检索→映射到父块→返回父块给LLM
- 关键设计：父子通过文档/章节ID关联，子块是父块的语义子集
- 变体：Small-to-Big、RAPTOR(层级摘要)、Sentence-Window
---

# 父子文档混合分块解决什么问题？

## 🎯 本质

解决**检索精确性与生成上下文完整性之间的矛盾**：用小块做精确匹配，用大块提供完整上下文。

## 🧒 费曼类比

在图书馆用目录索引（小块）精确找到你要的章节，但借的时候拿走整本书（父块），因为单页可能读不懂。

## 📊 原理图

```
原始文档 (4页)
┌──────────────────────────────────────────────┐
│ 文档: 《退款政策》                            │
│                                              │
│ §1 退款条件 (第1段)                          │
│   - 商品完好，15天内申请...                  │
│                                              │
│ §2 退款流程 (第2段)     ← 子块A(用户匹配到)  │
│   - Step1: 申请 → 审核                       │
│   - Step2: 寄回 → 验收                       │
│   - Step3: 退款到账 (3-7工作日)              │
│                                              │
│ §3 特殊情况 (第3段)                          │
│   - 定制商品不支持退款                       │
│   - 海外订单退款周期延长                     │
│                                              │
│ §4 联系方式 (第4段)                          │
└──────────────────────────────────────────────┘

 传统分块(等分):
 ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐
 │ Chunk 1 │ │ Chunk 2 │ │ Chunk 3 │ │ Chunk 4 │
 │  (§1)   │ │  (§2)   │ │  (§3)   │ │  (§4)   │
 └─────────┘ └─────────┘ └─────────┘ └─────────┘
                    ↑
              用户检索"退款流程"
              只返回Chunk2 → 缺少§1的"15天"前提
              和§3的"定制商品例外"

 父子分块:
 ┌──────────────────────────────────────────────┐
 │           父块 = 整个文档                     │
 │  ┌───────┐ ┌───────┐ ┌───────┐ ┌───────┐   │
 │  │子块A  │ │子块B  │ │子块C  │ │子块D  │   │
 │  │ (§1)  │ │ (§2)  │ │ (§3)  │ │ (§4)  │   │
 │  └───┬───┘ └───┬───┘ └───────┘ └───────┘   │
 │      │         │                             │
 └──────┼─────────┼─────────────────────────────┘
        │         │
     向量索引    匹配"退款流程"
     (子块)     命中子块B
                    │
                    ▼
           返回父块(整个文档)给LLM
           → LLM获得完整上下文
           → 答案: "退款流程3步,
                    15天内申请,
                    定制商品除外"
```

## 🔧 专业详解

### 三种常见实现方式

#### 1. Parent-Document Retriever（经典父子）

```python
from langchain.text_splitter import RecursiveCharacterTextSplitter
from langchain.retrievers import ParentDocumentRetriever

# 父分块器: 大块(给LLM)
parent_splitter = RecursiveCharacterTextSplitter(chunk_size=2000)
# 子分块器: 小块(做向量检索)
child_splitter = RecursiveCharacterTextSplitter(chunk_size=400)

# 子块→父块ID的映射存储在docstore中
retriever = ParentDocumentRetriever(
    vectorstore=vectorstore,     # 存子块向量
    docstore=docstore,           # 存父块原文
    child_splitter=child_splitter,
    parent_splitter=parent_splitter,
)
# 检索时: query → 匹配子块 → 查docstore获取父块 → 返回父块
```

#### 2. Sentence-Window Retrieval

```python
# 检索单个句子，返回句子±N句的窗口
# 更细粒度的父子结构

def sentence_window_retrieve(query, index, window_size=3):
    # 1. 向量检索单句
    matched_sentence = index.search(query, top_k=1)
    # 2. 扩展为窗口(前后各window_size句)
    doc_id = matched_sentence.doc_id
    sent_idx = matched_sentence.sentence_index
    window = get_sentences(doc_id, 
                          start=sent_idx - window_size,
                          end=sent_idx + window_size)
    return window  # 父块 = 句子窗口
```

#### 3. RAPTOR（层级摘要）

```
原文档
  ↓ 分块
叶子块 (Level 0) ← 向量检索
  ↓ 聚类+摘要
摘要块 (Level 1) ← 向量检索
  ↓ 聚类+摘要
全局摘要 (Level 2) ← 向量检索
```

### 关键设计决策

| 决策点 | 选项 | 建议 |
|--------|------|------|
| 父块大小 | 整个文档 / 章节 / 固定长度 | 按文档结构，一般2000-4000 tokens |
| 子块大小 | 单句 / 200-400 tokens | 200-400 tokens为佳 |
| 父子关联方式 | 文档ID / 章节ID / 位置索引 | 按自然文档结构 |
| 多子块命中同一父块 | 去重返回一次 / 加权排序 | 去重避免重复context |

## 💻 完整示例

```python
class ParentChildChunker:
    """父子文档分块器"""
    
    def __init__(self, parent_size=2000, child_size=400, overlap=50):
        self.parent_size = parent_size
        self.child_size = child_size
        self.overlap = overlap
    
    def chunk(self, document: str, doc_id: str):
        # Step 1: 切父块
        parent_chunks = self._split(document, self.parent_size)
        
        result = []
        for p_idx, parent in enumerate(parent_chunks):
            parent_id = f"{doc_id}_parent_{p_idx}"
            
            # Step 2: 每个父块切子块
            child_chunks = self._split(parent['text'], self.child_size)
            
            for c_idx, child in enumerate(child_chunks):
                child_id = f"{parent_id}_child_{c_idx}"
                result.append({
                    'child_id': child_id,
                    'child_text': child['text'],      # 用于向量索引
                    'parent_id': parent_id,
                    'parent_text': parent['text'],     # 用于返回给LLM
                })
        
        return result
    
    def retrieve(self, query, vector_index, top_k=3):
        # 1. 子块向量检索
        child_hits = vector_index.search(query, top_k=top_k)
        
        # 2. 子块→父块映射
        parent_ids = set()
        results = []
        for hit in child_hits:
            if hit['parent_id'] not in parent_ids:
                parent_ids.add(hit['parent_id'])
                results.append({
                    'text': hit['parent_text'],       # 返回父块
                    'score': hit['score'],
                    'source_child': hit['child_id'],
                })
        
        return results
```

## 💡 例子

**虾皮客服场景**：用户问"退款多久到账？"

- **传统等分块**：检索到"Step3: 退款到账(3-7工作日)"这个chunk，但缺少"15天内申请"的前提条件 → LLM可能遗漏关键限制
- **父子分块**：子块匹配到Step3 → 返回整个退款文档 → LLM回答"退款3-7工作日到账，需在收货后15天内申请，定制商品除外"

## ❓ 苏格拉底式面试追问

1. **"子块有父块的更多信息吗？"**
   → 子块是父块的子集，本身不含额外信息。但检索时返回的是父块，所以LLM能看到完整上下文

2. **"如果父块太长超过了LLM的context窗口怎么办？"**
   → 使用摘要版父块 / 滑动窗口 / RAPTOR层级摘要 / 多层父子(祖父→父→子)

3. **"父子分块的额外存储开销有多大？"**
   → 需要额外存储docstore(父块原文)，空间约为纯子块的2-5倍，但检索时只检索子块向量

4. **"什么场景不适合用父子分块？"**
   → 短文档(FAQ类，每条本身就是独立完整的) / 对延迟敏感的场景(减少一次docstore查询)

## 结构化回答



**30 秒电梯演讲：** 想象你在图书馆找书。用书名/章节标题(小块)精确定位到你要的内容，但借阅时拿走整本书(父块)而不是单页，因为单页内容可能因为缺少前后文而难以理解。

**展开框架：**
1. **检索小块(如** — 检索小块(如1-2段)→向量匹配精确，减少噪声
2. **LLM** — 返回父块(如整个文档/章节)→LLM获得完整上下文
3. **ID** — 父子通过文档ID/章节ID关联，父块包含子块

**收尾：** 父块太大导致context超限怎么办？




## 视频脚本

> 预计时长：5 分钟 | 由浅入深


| 时间 | 画面/字幕 | 口播台词 | 讲解要点 |
|------|----------|----------|----------|
| 0:00 | 标题卡：父子文档混合分块解决什么问题？ | "想象你在图书馆找书。用书名/章节标题(小块)精确定位到你要的内容，但借阅时拿走整本书(父块…" | 开场钩子 |
| 0:20 | 核心概念图 | "父子文档分块 = 用小块(语义精确)做检索匹配，用大块(上下文完整)喂给LLM生成。解决了"小块语义精确但上下文断裂"和…" | 核心定义 |
| 0:50 | 检索小块(如示意图 | "检索小块(如——检索小块(如1-2段)→向量匹配精确，减少噪声" | 要点拆解1 |
| 1:30 | 返回父块(如示意图 | "返回父块(如——返回父块(如整个文档/章节)→LLM获得完整上下文" | 要点拆解2 |
| 2:20 | 对比/实战案例图 | "对比一下常见误区和工程实践，看真实场景里怎么取舍。" | 实战与对比 |
| 3:10 | 总结卡 | "记住核心要点。下期我们追问：父块太大导致context超限怎么办？" | 收尾与钩子 |
