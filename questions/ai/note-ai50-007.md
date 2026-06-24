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
  essence: 'Ragas通过拆解RAG的检索和生成两个阶段，用忠实度、答案相关性、上下文精确率和召回率四个维度量化幻觉'
  analogy: '就像考试评分——不光看最终答案对不对，还要看参考书找得准不准(检索)、答题有没有超出参考书范围(忠实度)、答案跑没跑题(相关性)'
  first_principle: 'RAG系统质量=检索质量×生成质量，必须分别评估而非只看端到端结果'
  key_points:
    - 'Ragas四大指标: Faithfulness, Answer Relevancy, Context Precision, Context Recall'
    - 'Faithfulness(忠实度): 答案是否忠于检索到的上下文，直接衡量幻觉'
    - 'Context Precision: 检索到的上下文中有多少是真正相关的'
    - '评估依赖LLM-as-Judge，用GPT-4等强模型评判'
first_principle:
  essence: '幻觉本质是答案包含检索上下文中不存在的信息'
  derivation: '将答案拆解为独立陈述，逐个判断是否被上下文支持。不被支持的陈述比例 = 幻觉率。Faithfulness = 1 - 幻觉率'
  conclusion: 'Faithfulness指标直接量化幻觉程度，是RAG评估的核心指标'
follow_up:
  - 'LLM-as-Judge的可靠性如何保证？'
  - '除了Ragas还有哪些RAG评估框架？'
  - '评估数据集怎么构建？需要多少条？'
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
