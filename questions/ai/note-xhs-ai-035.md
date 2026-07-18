---
id: note-xhs-ai-035
difficulty: L2
category: ai
subcategory: rag
tags:
- RAG
- Reranker
- Cross-Encoder
- Bi-Encoder
- 精排
- 面经
feynman:
  essence: "Reranker是检索结果的精排环节——用Cross-Encoder把query和doc拼在一起送入模型，通过深度交叉交互获得更高精度"
  analogy: "召回阶段像海选——双塔模型快速从万人中挑出20个候选人（各打各的分，快但粗）。精排阶段像决赛——Cross-Encoder把query和doc放在一起仔细对比（交叉互动，慢但准）。两阶段架构=海选+决赛"
  key_points:
  - Bi-Encoder（双塔）：query和doc分别编码再算相似度，速度快但无交叉交互
  - Cross-Encoder（交叉编码器）：query+doc拼接后一起过模型，精度高但慢
  - 两阶段架构：先用Bi-Encoder召回Top20（快），再用Cross-Encoder精排取Top5（准）
  - 常用Reranker：bge-reranker、Cohere Rerank、Jina Reranker
  - 精排通常提升nDCG@5约10-20%
first_principle:
  essence: "检索精度取决于模型能否捕捉query和doc之间的细粒度交互。双塔模型因计算效率约束无法做到，Cross-Encoder可以"
  derivation: "Bi-Encoder将query和doc分别编码为独立向量q和d，相似度=cos(q,d)。这种独立编码无法建模query中某个词与doc中某个词的交互（如query的'退货'与doc的'7天无理由'的因果关系）。Cross-Encoder将[CLS]query[SEP]doc[SEP]拼接后输入Transformer，self-attention自然建模所有词对之间的交互，输出直接是相关性分数。代价是每对query-doc都要过一次完整模型，无法预计算"
  conclusion: "两阶段架构（召回+精排）是精度与速度的最优平衡——召回阶段用Bi-Encoder快速过滤，精排阶段用Cross-Encoder在少量候选上获得高精度"
follow_up:
- Cross-Encoder为什么不能预计算doc向量？
- Reranker模型的训练数据怎么获取？（人工标注、点击日志、蒸馏）
- 除了Cross-Encoder还有什么精排方法？（Late Interaction、ColBERT）
- Reranker的延迟在什么量级？怎么优化？
memory_points:
- Bi-Encoder=分别编码→cos相似度，快但无交叉
- Cross-Encoder=拼接输入→直接出分数，准但慢
- 两阶段：召回Top20（快）→精排Top5（准）
- 常用：bge-reranker、Cohere Rerank
---

# 【RAG混合检索】Reranker是什么？为什么需要精排？

> 来源：小红书「前端 AI 项目必问：为啥不能只用向量检索？」（OCR图片内容）

## 一、Bi-Encoder vs Cross-Encoder

```
【Bi-Encoder 双塔模型】

  Query ──→ [Encoder] ──→ q向量 ─┐
                                   ├──→ cos(q,d) → 分数
  Doc   ──→ [Encoder] ──→ d向量 ─┘
  
  特点：doc向量可预计算并索引，检索速度O(1)
  问题：query和doc没有交叉交互
  
  类比：两个候选人各自填表打分——快但不够细致


【Cross-Encoder 交叉编码器】

  [CLS] Query [SEP] Doc [SEP] ──→ [Transformer] ──→ 相关性分数
  
  特点：query和doc的每个token都通过self-attention交互
  优势：建模细粒度语义关系（因果关系、条件匹配）
  问题：每对query-doc都要过一次模型，无法预计算
  
  类比：面试官和候选人面对面深入交流——慢但准确
```

## 二、两阶段检索架构

```
            召回阶段                          精排阶段
     (Bi-Encoder, 快)                  (Cross-Encoder, 准)

用户Query ──→ 向量检索 ──┐
              BM25检索 ──┤──→ RRF融合 ──→ Top 20 ──→ Reranker ──→ Top 5
                         │                候选文档     精排        最终结果
                         │                   ↑
                         │              每对query-doc
                         │              过一次Cross-Encoder
                         │              ~50ms/doc × 20 = ~1s
                         │
                    约10ms完成                  约1s完成
```

## 三、Cross-Encoder内部原理

```python
# Cross-Encoder的内部计算过程
from transformers import AutoModelForSequenceClassification

class Reranker:
    def __init__(self, model_name='BAAI/bge-reranker-base'):
        self.model = AutoModelForSequenceClassification.from_pretrained(model_name)
        self.tokenizer = AutoTokenizer.from_pretrained(model_name)
    
    def score(self, query, doc):
        # 关键：query和doc拼接在一起输入
        inputs = self.tokenizer(
            query, doc,
            padding=True, truncation=True,
            max_length=512,
            return_tensors='pt'
        )
        
        # Cross-Attention: query的token和doc的token深度交互
        # [CLS] q1 q2 q3 [SEP] d1 d2 d3 d4 [SEP]
        #         ↕   ↕   ↕         ↕   ↕   ↕
        #      self-attention覆盖所有token对
        output = self.model(**inputs)
        
        # [CLS]位置的输出 → 分类头 → 相关性分数
        return output.logits[0].item()  # 0~1分数
    
    def rerank(self, query, candidates, top_k=5):
        # 对每个候选doc打分
        scored = [(doc, self.score(query, doc)) for doc in candidates]
        # 按分数排序取TopK
        scored.sort(key=lambda x: -x[1])
        return scored[:top_k]
```

## 四、常用Reranker对比

| 模型 | 参数量 | 中文支持 | 延迟 | 部署方式 |
|------|--------|---------|------|---------|
| bge-reranker-base | 278M | 好 | ~30ms | 本地GPU |
| bge-reranker-large | 560M | 好 | ~50ms | 本地GPU |
| Cohere Rerank | N/A | 好 | ~100ms | API |
| Jina Reranker | 278M | 好 | ~40ms | 本地/API |
| ColBERT(v2) | 110M | 中 | ~20ms | 本地GPU |

## 五、方案对比

| 方案 | 精度 | 延迟 | 成本 | 适用场景 |
|------|------|------|------|---------|
| 纯Bi-Encoder召回 | 中等 | 极低(~10ms) | 低 | 对精度要求不高 |
| Bi-Encoder+Reranker | 高 | 中等(~1s) | 中 | 生产级RAG |
| 纯Cross-Encoder | 最高 | 极高(不可行) | 高 | 理论方案（不实用） |
| ColBERT(Late Interaction) | 较高 | 低(~50ms) | 中 | 兼顾精度和速度 |

## 六、面试加分点

1. **Late Interaction**：ColBERT提出了一种折中方案——query和doc分别编码为token级别的向量，在检索时做max-sim交互。比Bi-Encoder精（有交互），比Cross-Encoder快（doc可预计算）
2. **蒸馏优化**：用大Reranker蒸馏小Reranker——如用bge-reranker-large蒸馏出一个更小的模型，牺牲少量精度换取2x速度提升
3. **缓存策略**：对高频query的rerank结果做缓存，避免重复计算——特别是FAQ场景中相同query反复出现
4. **batch推理**：Rerank时不是逐个打分而是batch处理——将20个query-doc对组成batch一次推理，利用GPU并行性降低延迟
5. **效果量化**：典型RAG系统中，加入Reranker后nDCG@5提升10-20%，Hit Rate@5提升5-15%——有具体数据支撑让面试官信服

## 结构化回答



**30 秒电梯演讲：** 召回阶段像海选——双塔模型快速从万人中挑出20个候选人（各打各的分，快但粗）。精排阶段像决赛——Cross-Encoder把query和doc放在一起仔细对比（交叉互动，慢但准）。两阶段架构=海选+决赛

**展开框架：**
1. **Bi-Encoder（双塔）** — query和doc分别编码再算相似度，速度快但无交叉交互
2. **Cross-Encoder（交叉编码器）** — query+doc拼接后一起过模型，精度高但慢
3. **两阶段架构** — 先用Bi-Encoder召回Top20（快），再用Cross-Encoder精排取Top5（准）

**收尾：** Cross-Encoder为什么不能预计算doc向量？




## 视频脚本

> 预计时长：3 分钟 | 由浅入深


| 时间 | 画面/字幕 | 口播台词 | 讲解要点 |
|------|----------|----------|----------|
| 0:00 | 标题卡：Reranker是什么？为什么需要精排？ | "召回阶段像海选——双塔模型快速从万人中挑出20个候选人（各打各的分，快但粗）。精排阶段像决…" | 开场钩子 |
| 0:20 | 核心概念图 | "Reranker是检索结果的精排环节——用Cross-Encoder把query和doc拼在一起送入模型，通过深度交叉交…" | 核心定义 |
| 0:55 | Bi-Encoder（双塔）示意图 | "Bi-Encoder（双塔）——query和doc分别编码再算相似度，速度快但无交叉交互" | 要点拆解1 |
| 1:30 | 对比/实战案例图 | "对比一下常见误区和工程实践，看真实场景里怎么取舍。" | 实战与对比 |

## 苏格拉底式面试追问

| 追问层级 | 面试官可能这样问 | 高分回答方向 |
|----------|------------------|--------------|
| 目标追问 | Reranker在RAG里的核心目标是什么？ | 对召回的候选做精排，把最相关的排到前面，提升top-k的精度——召回追求不漏、精排追求准确 |
| 证据追问 | 为什么需要精排？召回阶段不够吗？ | 召回用双塔模型快但粗（向量相似度）；精排用交叉编码器建模query-doc深度交互更准但慢，所以先召回大批量再精排少量 |
| 边界追问 | Reranker什么时候必要，什么时候多余？ | 候选量大、精度要求高的场景必要；候选量小或业务对精度不敏感时可省，避免延迟和成本 |
| 反例追问 | Reranker一定提升效果吗？什么场景反而变差？ | 训练数据和业务不匹配时变差、Reranker太慢导致延迟超SLA、候选质量极差时精排也救不回 |
| 风险追问 | Reranker的风险和代价是什么？ | 延迟增加（cross-encoder慢）、成本上升、模型选型不当反而降效果、和召回阶段不一致导致排序错乱 |
| 验证追问 | 怎么验证Reranker有效？ | 对比有无Reranker的NDCG@k、线上问答准确率、人工badcase、监控延迟在SLA内 |
| 沉淀追问 | Reranker选型和部署怎么沉淀？ | 规范：默认bge-reranker等开源模型、控制候选数量控延迟、评测集回归、延迟监控 |

### 现场对话示例
**面试官**：Reranker是什么？为什么需要精排？
**候选人**：Reranker用cross-encoder对召回候选精排把最相关排前面；召回用双塔快但粗，精排建模query-doc深度交互更准但慢，所以先召回再精排。
**面试官**：Reranker什么时候多余？
**候选人**：候选量小或业务对精度不敏感时可省，避免延迟和成本；候选质量极差时精排也救不回。
**面试官**：Reranker有什么风险？
**候选人**：延迟增加（cross-encoder慢）、成本上升、模型选型不当反降效果、与召回不一致排序错乱，需要评测集和延迟监控保障。
