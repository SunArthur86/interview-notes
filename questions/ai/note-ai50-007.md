---
id: note-ai50-007
difficulty: L3
category: ai
subcategory: RAG
tags:
- 某厂
- 面经
- RAG
- 评估
- Ragas
feynman:
  essence: Ragas通过拆解RAG的检索和生成两个阶段，用忠实度、答案相关性、上下文精确率和召回率四个维度量化幻觉
  analogy: 就像考试评分——不光看最终答案对不对，还要看参考书找得准不准(检索)、答题有没有超出参考书范围(忠实度)、答案跑没跑题(相关性)
  first_principle: RAG系统质量=检索质量×生成质量，必须分别评估而非只看端到端结果
  key_points:
  - 'Ragas四大指标: Faithfulness, Answer Relevancy, Context Precision, Context Recall'
  - 'Faithfulness(忠实度): 答案是否忠于检索到的上下文，直接衡量幻觉'
  - 'Context Precision: 检索到的上下文中有多少是真正相关的'
  - 评估依赖LLM-as-Judge，用GPT-4等强模型评判
first_principle:
  essence: 幻觉本质是答案包含检索上下文中不存在的信息
  derivation: 将答案拆解为独立陈述，逐个判断是否被上下文支持。不被支持的陈述比例 = 幻觉率。Faithfulness = 1 - 幻觉率
  conclusion: Faithfulness指标直接量化幻觉程度，是RAG评估的核心指标
follow_up:
- LLM-as-Judge的可靠性如何保证？
- 除了Ragas还有哪些RAG评估框架？
- 评估数据集怎么构建？需要多少条？
memory_points:
- 四大核心指标：忠实度、答案相关性、上下文精确率和召回率。
- 反幻觉看Faithfulness：把答案拆解为原子陈述，计算能被上下文支持的陈述比例。
- Context Recall看信息覆盖率，Context Precision看Top-K文档中有用文档的比例。
---

# Ragas框架如何评估RAG系统中的幻觉？

## Ragas评估框架总览

```
┌──────────────────────────────────────────────┐
│              RAG Pipeline                     │
│                                               │
│  Query → Retrieval → Context → LLM → Answer   │
│            │              │           │       │
│            ▼              ▼           ▼       │
│     ┌──────────────────────────────────────┐ │
│     │           Ragas 评估                  │ │
│     │                                      │ │
│     │  检索质量:                            │ │
│     │    • Context Precision (精确率)       │ │
│     │    • Context Recall (召回率)          │ │
│     │                                      │ │
│     │  生成质量:                            │ │
│     │    • Faithfulness (忠实度/反幻觉)     │ │
│     │    • Answer Relevancy (答案相关性)    │ │
│     └──────────────────────────────────────┘ │
└──────────────────────────────────────────────┘
```

## 四大核心指标

### 1. Faithfulness（忠实度）— 核心反幻觉指标

```
定义: 答案中的所有陈述是否都能被检索到的上下文支持

计算过程:
  Answer: "GPT-4的上下文窗口是128K tokens，于2023年发布。"
  
  拆解为原子陈述:
    ① "GPT-4的上下文窗口是128K tokens" → 上下文中有支持 ✅
    ② "于2023年发布" → 上下文中没有提及 ❌ (幻觉!)
  
  Faithfulness = 支持的陈述数 / 总陈述数 = 1/2 = 0.5
```

```python
from ragas import evaluate
from ragas.metrics import faithfulness
from datasets import Dataset

# 准备评估数据
eval_data = {
    "question": ["GPT-4的上下文窗口多大？"],
    "answer": ["GPT-4的上下文窗口是128K tokens，于2023年发布。"],
    "contexts": [["GPT-4 Turbo支持128K上下文窗口。"]],
    "ground_truth": ["128K tokens"]  # 可选，用于其他指标
}

dataset = Dataset.from_dict(eval_data)

# 评估
results = evaluate(dataset, metrics=[faithfulness])
print(results['faithfulness'])  # 0.5 → 存在幻觉
```

### 2. Answer Relevancy（答案相关性）

```
定义: 答案是否切题回答了用户的问题

问题: "Python怎么读取CSV文件？"
答案A: "Python用pandas.read_csv()读取CSV文件..."  → 相关性高
答案B: "CSV是逗号分隔值文件格式，由RFC 4180定义..." → 跑题了
```

### 3. Context Precision（上下文精确率）

```
定义: 检索到的Top-K文档中，有多少是真正有用的

检索结果: [Doc1✅, Doc2✅, Doc3❌, Doc4❌, Doc5❌]
Context Precision = 2/5 = 0.4 → 检索质量偏低
```

### 4. Context Recall（上下文召回率）

```
定义: 回答问题需要的信息，是否都被检索到了

Ground Truth答案中包含5个关键信息点
检索到的上下文覆盖了其中3个
Context Recall = 3/5 = 0.6
```

## 完整评估流程

```python
from ragas import evaluate
from ragas.metrics import (
    faithfulness,
    answer_relevancy,
    context_precision,
    context_recall
)

def evaluate_rag_pipeline(test_cases):
    """
    test_cases: List[Dict] 每个包含
        - question: 用户问题
        - answer: RAG系统的回答
        - contexts: 检索到的文档列表
        - ground_truth: 标准答案
    """
    dataset = Dataset.from_list(test_cases)
    
    results = evaluate(
        dataset,
        metrics=[
            faithfulness,          # 忠实度(反幻觉)
            answer_relevancy,      # 答案相关性
            context_precision,     # 检索精确率
            context_recall         # 检索召回率
        ],
        llm=eval_llm,  # 用GPT-4做Judge
        embeddings=eval_embeddings
    )
    
    return results

# 结果解读
# Faithfulness > 0.9: 幻觉很少
# Faithfulness 0.7-0.9: 有少量幻觉，可接受
# Faithfulness < 0.7: 幻觉严重，需要优化
```

## 评估数据集构建

```python
# 用LLM自动生成评估数据集
from ragas.testset.generator import TestsetGenerator

generator = TestsetGenerator.with_openai()

# 从文档自动生成Q&A对
testset = generator.generate(
    documents=load_documents("knowledge_base/"),
    test_size=100,           # 生成100个测试用例
    distributions={
        "simple": 0.3,       # 简单事实查询
        "reasoning": 0.4,    # 需要推理的查询
        "multi_context": 0.3 # 跨文档查询
    }
)

# testset 包含: question, ground_truth, contexts
# 用你的RAG系统回答这些问题，然后用Ragas评估
```

## 指标优化对照表

| 指标低 | 原因 | 优化方向 |
|--------|------|---------|
| Faithfulness低 | 模型编造信息 | 加Prompt约束 + 降低temperature |
| Answer Relevancy低 | 答案跑题 | 优化Prompt + 加Query改写 |
| Context Precision低 | 检索噪音多 | 加Reranker + 调整chunk_size |
| Context Recall低 | 检索不全 | 增加top_k + 优化embedding |

## Ragas vs 其他评估框架

| 框架 | 特点 | 适用场景 |
|------|------|---------|
| Ragas | 无需人工标注，LLM-as-Judge | 快速迭代评估 |
| TruLens | 支持追踪和可视化 | 需要调试RAG链路 |
| DeepEval | 类似pytest的单元测试 | CI/CD集成 |
| 人工评估 | 最可靠 | 最终验收 |

## 记忆要点

- 四大核心指标：忠实度、答案相关性、上下文精确率和召回率。
- 反幻觉看Faithfulness：把答案拆解为原子陈述，计算能被上下文支持的陈述比例。
- Context Recall看信息覆盖率，Context Precision看Top-K文档中有用文档的比例。

## 苏格拉底式面试追问

> 这组追问模拟面试官层层逼问，每一问先回答"为什么"，再回答"怎么做"，最后回答"如何证明"。

### 第一层：目标与动机

**Q：Ragas 为什么要把 RAG 拆成四个指标评估，而不是直接看"答案对不对"这个端到端准确率？**

端到端准确率无法定位瓶颈。答案错可能是检索没召回正确 chunk（Context Recall 低）、检索召回了但排序差导致正确 chunk 没进 top-k（Context Precision 低）、检索都对但模型编造（Faithfulness 低）、模型忠实于 context 但答非所问（Answer Relevancy 低）。四个指标把"检索质量"和"生成质量"解耦，才能对症下药——换 embedding、调 top-k、改 prompt、还是换模型。动机是可归因的优化，不是只看分数。

### 第二层：证据与定位

**Q：Faithfulness 是 0.92 但用户投诉说答案有幻觉，你怎么解释这个矛盾？**

Faithfulness 衡量的是"答案是否被 context 支持"，不是"答案是否符合客观事实"。如果 context 本身是错的或过时的（RAG 召回了错误文档），模型忠实于 context 生成，Faithfulness 高但客观上是幻觉。这时要结合 Context Recall 看召回的文档对不对——Context Recall 高但答案仍错，说明 ground truth 文档没在库里，是知识库覆盖问题；Context Recall 低是检索问题。Faithfulness 高不代表没幻觉，只代表没编造。

### 第三层：根因深挖

**Q：Faithfulness 的计算是把答案拆成原子陈述再逐一判断能否被 context 支持，这个"判断"用什么做的？准确吗？**

Ragas 默认用 LLM（如 GPT-4）做原子陈述拆解和 NLI 判断。拆解是把"产品 A 的价格为 100 元且支持退货"拆成两个原子陈述；判断是对每个原子陈述问 LLM"context 里是否支持这个陈述"。准确率受 LLM 能力影响——弱模型（如 GPT-3.5）会把"context 没明确说但可推理"误判为支持，导致 Faithfulness 虚高。治本是用更强的 judge 模型，或对关键场景用人工复核抽样。Ragas 的 Faithfulness 是"近似指标"，不是绝对真值。

**Q：那为什么不直接用人工标注每个答案的幻觉率，准确又可靠，非要用 LLM 近似？**

人工标注成本太高且不可规模化。一个评测集 1000 条 QA，人工逐条标幻觉要几个人天，且标注一致性 <90%（不同人对"是否幻觉"判断不同）。LLM 评估能在几分钟内跑完全集，可以每天跑、每次改动跑，支撑快速迭代。正确姿势是 LLM 评估做日常监控（高频低成本），人工评估做季度验收（低频高准确），两者交叉校准——当 LLM 评估和人工评估的分歧率 >15% 时，说明 LLM judge 失准，要换模型。

### 第四层：方案权衡

**Q：Context Precision 和 Recall 你更看重哪个？调 top-k 时它们是此消彼长的，怎么权衡？**

看业务场景。客服/问答类更看 Recall（宁可多召回也别漏，漏了答不了），top-k 调大；精确查询类（如查订单状态）更看 Precision（召回多了噪声反而干扰模型），top-k 调小。调 top-k 时 Recall 涨 Precision 降，找 F1 拐点（通常 top-k=5-10）。更关键的是看"正确 chunk 排在第几位"——如果正确 chunk 总是排在 top-3 之外，top-k 再大也救不了，要优化 Reranker 把正确 chunk 顶上来。

**Q：为什么不直接用端到端的 RAG 准确率做唯一指标，简单直接，还要搞四个指标的复杂评估？**

端到端准确率是黑盒，无法指导迭代。假设你改了切分策略，端到端准确率从 75% 到 73%，你不知道是切分把正确 chunk 切坏了（Context Recall 降）还是切分后 embedding 不适应（Context Precision 降），无法决定回滚还是调 embedding。四个指标是"白盒"，能告诉你"改了什么影响了哪一环"。工程上四个指标是诊断工具，端到端准确率是北极星，两者都要，不是二选一。

### 第五层：验证与沉淀

**Q：Ragas 的四个指标本身用 LLM 计算，你怎么保证指标本身可信，而不是用错误的尺子量错误的长度？**

做"尺子校准"：人工标注 200 条 QA 的四个指标真值，对比 Ragas（LLM 计算）的输出，看一致率（Pearson 相关系数和 Cohen's Kappa）。如果一致率 >0.85，Ragas 可信；如果 <0.7，换更强的 judge 模型或调整 prompt。定期（每月）用新增的 case 重新校准，防止分布漂移导致 Ragas 失准。把校准结果（一致率、分歧 case）沉淀成评估报告。

**Q：Ragas 评估怎么沉淀成持续迭代的机制？**

固化成 CI 流水线：每次改切分/检索/prompt，自动在回归评测集上跑 Ragas 四指标，和上次对比，指标下降 >2% 阻止合并。配套评估 dashboard，展示各指标随时间的趋势，定位是哪个改动导致的波动。把"指标基线""各业务线的指标阈值""Ragas judge 模型选型"沉淀成团队规范文档，新项目接入时按模板配置。

## 结构化回答


**30 秒电梯演讲：** 就像考试评分——不光看最终答案对不对，还要看参考书找得准不准(检索)、答题有没有超出参考书范围(忠实度)、答案跑没跑题(相关性)

**展开框架：**
1. **Ragas四大指标** — Faithfulness, Answer Relevancy, Context Precision, Context Recall
2. **Faithfulness(忠实度)** — 答案是否忠于检索到的上下文，直接衡量幻觉
3. **Context Precision** — 检索到的上下文中有多少是真正相关的

**收尾：** LLM-as-Judge的可靠性如何保证？



## 视频脚本

> 预计时长：4 分钟 | 由浅入深


| 时间 | 画面/字幕 | 口播台词 | 讲解要点 |
|------|----------|----------|----------|
| 0:00 | 标题卡：Ragas框架如何评估RAG系统中的幻觉？ | "就像考试评分——不光看最终答案对不对，还要看参考书找得准不准(检索)、答题有没有超出参考书…" | 开场钩子 |
| 0:20 | 核心概念图 | "Ragas通过拆解RAG的检索和生成两个阶段，用忠实度、答案相关性、上下文精确率和召回率四个维度量化幻觉" | 核心定义 |
| 0:50 | Ragas四大指标示意图 | "Ragas四大指标——Faithfulness, Answer Relevancy, Context Precision, Context… | 要点拆解1 |
| 1:30 | 对比/实战案例图 | "对比一下常见误区和工程实践，看真实场景里怎么取舍。" | 实战与对比 |
| 2:20 | 总结卡 | "记住核心要点。下期我们追问：LLM-as-Judge的可靠性如何保证？" | 收尾与钩子 |
