---
id: note-xhs-ai-036
difficulty: L2
category: ai
subcategory: rag
tags:
- RAG
- 优化
- HyDE
- Chunk
- 前端AI
- 面经
feynman:
  essence: "RAG效果不好时从五个方向排查：chunk大小、query改写、多路召回、rerank精排、上下文压缩——逐个诊断才能对症下药"
  analogy: "RAG像一条流水线：原料仓库（chunk分块）→找货（检索）→精选（rerank）→包装（context压缩）→出货（生成）。任何一环出问题，最终产品质量都不行。排查要从源头到终端逐站检查"
  key_points:
  - chunk大小：太大稀释精度，太小丢上下文，通常300-800字符
  - query改写：原始query太短/模糊时，用LLM改写（HyDE方法）
  - 多路召回：向量+BM25+元数据过滤
  - rerank：加Cross-Encoder重排序
  - 上下文压缩：检索内容太长时用LLM压缩后再送入生成
first_principle:
  essence: "RAG的效果取决于「正确的文档被检索到」和「LLM理解了正确的上下文」两个条件同时满足。优化就是分别提升这两个环节"
  derivation: "RAG = Retrieve + Augment + Generate。Retrieve质量取决于chunk策略、检索方法、排序算法；Generate质量取决于上下文质量、prompt工程、模型能力。如果Retrieve漏掉了正确文档（recall低），无论Generate多强都无法回答；如果Retrieve召回了但排序靠后被截断（precision低），LLM看不到正确信息；如果正确文档被检索到但被无关内容淹没（信噪比低），LLM可能被干扰"
  conclusion: "RAG优化是系统工程——chunk→检索→rerank→context→generate 全链路优化，不能只改一个环节"
follow_up:
- HyDE具体怎么实现？有什么风险？
- chunk overlap设置多少合适？
- 上下文压缩会不会丢失关键信息？怎么平衡？
- 怎么评估RAG系统效果？（RAGAS框架、Faithfulness、Answer Relevance）
memory_points:
- 五个方向：chunk→query改写→多路召回→rerank→context压缩
- chunk通常300-800字符，需实验调优
- HyDE：让LLM先生成假设答案再用答案去检索
- 逐个方向排查，对症下药
---

# 【RAG优化】RAG效果不好怎么优化？

> 来源：小红书「前端 AI 项目必问：为啥不能只用向量检索？」（OCR图片内容）

## 一、RAG全链路排查框架

```
┌─────────────────────────────────────────────────────────┐
│                    RAG 优化全景图                         │
│                                                          │
│  ┌────────┐   ┌────────┐   ┌────────┐   ┌────────┐     │
│  │ Chunk  │──→│ 检索   │──→│ Rerank │──→│ Context│──→ LLM │
│  │ 分块   │   │ 召回   │   │ 精排   │   │ 压缩   │   生成 │
│  └────────┘   └────────┘   └────────┘   └────────┘     │
│      ①           ②③          ④            ⑤            │
│                                                          │
│  ① Chunk大小调优    ② Query改写    ③ 多路召回           │
│  ④ Rerank精排       ⑤ 上下文压缩                        │
└─────────────────────────────────────────────────────────┘
```

## 二、五个优化方向详解

### ① Chunk大小调优

```
chunk太大 (2000+字符):
┌─────────────────────────────────────────┐
│█████████████████████████████████████████│ ← 一个chunk含多个主题
│└─ 无关信息稀释检索精度                    │
│└─ LLM context被无关内容淹没               │
└─────────────────────────────────────────┘

chunk太小 (100字符):
┌──┐┌──┐┌──┐┌──┐┌──┐┌──┐┌──┐┌──┐
│  ││  ││  ││  ││  ││  ││  ││  │ ← 语义断裂
└──┘└──┘└──┘└──┘└──┘└──┘└──┘└──┘
└─ 上下文丢失，检索到碎片信息

最佳: 300-800字符 + 50字符overlap
┌──────────────┐
│██████████████│ ← 一个chunk含一个完整语义单元
│  (500字符)    │
└──────────────┘
     ┌──────────────┐  ← overlap保证连续性
     │██████████████│
     └──────────────┘
```

### ② Query改写（HyDE方法）

```python
# HyDE: Hypothetical Document Embeddings
# 核心思想：让LLM先生成一个假设答案，用答案去检索

def hyde_retrieve(query, llm, retriever):
    # Step 1: 用LLM生成假设答案
    hypothetical_answer = llm.generate(
        f"请简要回答这个问题（不需要准确）：{query}"
    )
    # 例: query="iPhone 15怎么截图"
    #     hypothetical="同时按侧边按钮和音量上键..."
    
    # Step 2: 用假设答案（而非原始query）做向量检索
    # 答案比短query更接近文档的表述方式
    results = retriever.search(hypothetical_answer)
    
    # Step 3: 用原始query+检索结果生成最终答案
    final_answer = llm.generate(
        f"根据以下信息回答：{query}\n参考：{results}"
    )
    return final_answer
```

### ③ 多路召回

```
                  用户Query
                     │
         ┌───────────┼───────────┐
         ▼           ▼           ▼
    向量检索      BM25检索    元数据过滤
    (语义)       (精确)      (类型/时间)
         │           │           │
         └───────────┼───────────┘
                     ▼
                RRF融合排名
                     │
                     ▼
                Top 20候选
```

### ④ Rerank精排

```python
# 在RRF融合后的Top 20上做Cross-Encoder精排
from FlagEmbedding import FlagReranker

reranker = FlagReranker('BAAI/bge-reranker-large')
scores = reranker.compute_score([
    [query, doc['content']] for doc in top20_candidates
])
# 取Top 5送入LLM生成
top5 = sorted(zip(top20_candidates, scores), key=lambda x: -x[1])[:5]
```

### ⑤ 上下文压缩

```python
# 检索到的内容太长时，用LLM先压缩
def compress_context(query, retrieved_docs, llm):
    # 把所有检索结果拼接
    full_context = "\n".join(doc.content for doc in retrieved_docs)
    
    # 用LLM压缩，只保留与query相关的信息
    compressed = llm.generate(f"""
    用户问题：{query}
    参考文档：{full_context}
    
    请从参考文档中提取与用户问题直接相关的关键信息，
    去除无关内容，保留原文措辞。压缩到500字以内。
    """)
    return compressed
```

## 三、排查决策树

```
RAG回答错误/不好
       │
       ▼
  检索到正确文档了吗?
       │
   ┌───┴───┐
   ▼       ▼
  没有     有但排在后面
   │       │
   ▼       ▼
 检查    加Reranker
 检索    精排
 策略       │
   │       ▼
   │    LLM理解错误?
   │       │
   │    ┌──┴──┐
   │    ▼     ▼
   │  是    context太长
   │  │     信噪比低
   │  │       │
   │  ▼       ▼
   │ 改进   上下文压缩
   │ Prompt  或减少TopK
   │
   ▼
 chunk太小? → 增大chunk
 query太短? → HyDE改写
 只用向量? → 加BM25多路
```

## 四、方案对比

| 优化方向 | 效果提升 | 实现难度 | 延迟影响 | 优先级 |
|---------|---------|---------|---------|--------|
| Chunk调优 | 中等 | 低 | 无 | P0（先做） |
| Query改写(HyDE) | 中等 | 中 | +200ms | P1 |
| 多路召回 | 高 | 中 | +50ms | P0 |
| Rerank精排 | 高 | 中 | +500ms | P1 |
| 上下文压缩 | 中等 | 中 | +300ms | P2 |

## 五、面试加分点

1. **评估框架**：提及RAGAS框架——评估指标包括Faithfulness（忠实度）、Answer Relevance（答案相关性）、Context Precision（上下文精度）、Context Recall（上下文召回），让优化有数据支撑
2. **A/B测试**：每个优化方向都应该A/B测试——对比优化前后的Hit Rate、MRR、人工评分，避免"改了但不知道有没有效果"
3. **chunk策略进阶**：除了固定大小切分，还有语义切分（按段落/标题切分）和递归切分（先按大标题切，再按段落切）——对结构化文档效果更好
4. **多模态RAG**：如果文档含图片/表格，需要多模态embedding（如CLIP）做检索，不能用纯文本embedding——这是前端AI项目的常见坑
5. **成本意识**：HyDE和上下文压缩都额外调用LLM，增加成本和延迟——需要权衡精度提升是否值得额外开销，在小规模场景可以用更小的模型做改写/压缩

## 结构化回答

**30 秒电梯演讲：** RAG效果不好时从五个方向排查：chunk大小、query改写、多路召回、rerank精排、上下文压缩——逐个诊断才能对症下药。

**展开框架：**
1. **chunk大小** — 太大稀释精度，太小丢上下文，通常300-800字符
2. **query改写** — 原始query太短/模糊时，用LLM改写（HyDE方法）
3. **多路召回** — 向量+BM25+元数据过滤

**收尾：** 您想深入聊：HyDE具体怎么实现？有什么风险？


## 视频脚本

> 预计时长：3 分钟 | 由浅入深


| 时间 | 画面/字幕 | 口播台词 | 讲解要点 |
|------|----------|----------|----------|
| 0:00 | 标题卡：RAG效果不好怎么优化？ | "RAG像一条流水线：原料仓库（chunk分块）→找货（检索）→精选（rerank）→包装（…" | 开场钩子 |
| 0:20 | 核心概念图 | "RAG效果不好时从五个方向排查：chunk大小、query改写、多路召回、rerank精排、上下文压缩——逐个诊断才能对…" | 核心定义 |
| 0:55 | chunk大小示意图 | "chunk大小——太大稀释精度，太小丢上下文，通常300-800字符" | 要点拆解1 |
| 1:30 | 对比/实战案例图 | "对比一下常见误区和工程实践，看真实场景里怎么取舍。" | 实战与对比 |

## 苏格拉底式面试追问

| 追问层级 | 面试官可能这样问 | 高分回答方向 |
|----------|------------------|--------------|
| 目标追问 | RAG效果不好的优化第一目标是什么？ | 先定位是哪个环节出了问题——检索（召回率）、生成（幻觉）、还是数据（chunk/embedding），不能盲目优化 |
| 证据追问 | 怎么定位是检索还是生成的问题？ | 对比召回的doc是否包含答案（检索问题）vs doc有答案但生成没用（生成问题）；用召回率@k、人工抽检doc质量分诊 |
| 边界追问 | 什么情况下优化chunking最有效？什么情况优化模型更有效？ | chunk切分不当导致答案被截断时优化chunking最有效；召回doc都对但生成不好时换模型或prompt更有效 |
| 反例追问 | 换更大的embedding模型一定提升效果吗？ | 不一定。如果问题在chunk切分或检索策略，换模型没用；要先定位根因再对症下药，否则白费力气 |
| 风险追问 | 盲目优化有什么风险？ | 投入产出比低、A/B测试无显著性、改一处影响多处、上线后效果反复 |
| 验证追问 | 怎么验证优化真的有效？ | 建立评测集对比召回率/准确率、A/B测试线上指标、badcase回归、长期监控 |
| 沉淀追问 | RAG优化方法论怎么沉淀？ | 规范：分诊SOP（检索/生成/数据）、评测集必备、A/B测试规范、优化checklist |

### 现场对话示例
**面试官**：RAG效果不好怎么优化？
**候选人**：先分诊定位是检索（召回率低）、生成（幻觉）还是数据（chunk/embedding）问题，对比召回doc是否含答案分诊，再对症优化。
**面试官**：怎么定位是检索还是生成的问题？
**候选人**：看召回的doc是否包含答案——doc没答案是检索问题，doc有答案但生成没用是生成问题，用召回率@k和人工抽检分诊。
**面试官**：换大embedding模型一定有用吗？
**候选人**：不一定，如果问题在chunk切分或检索策略换模型没用；必须先定位根因再对症，配合评测集和A/B验证。
