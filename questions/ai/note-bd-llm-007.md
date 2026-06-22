---
id: note-bd-llm-007
difficulty: L4
category: ai
subcategory: RAG
tags:
- 字节
- 面经
- RAGAS
- 评估
- RAG质量
feynman:
  essence: RAG评估需要分别评估检索质量和生成质量。RAGAS从Faithfulness/Answer Relevancy/Context Precision/Context Recall四个维度量化。
  analogy: 就像评估一个研究员——要看他查资料的能力(检索)和写报告的能力(生成)，不能只看最终报告。
  first_principle: RAG = 检索 + 生成，必须分解评估，否则无法定位问题。
  key_points:
  - 'RAGAS四维度: Faithfulness/Answer Relevancy/Context Precision/Context Recall'
  - '检索评估: Recall@K/MRR/NDCG'
  - '生成评估: BLEU/ROUGE/LLM-as-Judge'
  - '端到端: 人工标注+用户反馈'
first_principle:
  essence: 可分解性是系统优化的前提
  derivation: RAG=检索+生成→整体指标差→不知道是检索还是生成的问题→分别评估→定位瓶颈→针对性优化
  conclusion: RAG评估必须检索和生成分开评估
follow_up:
- 如何构建RAG评测数据集？
- LLM-as-Judge有什么局限性？
- 如何做RAG系统的A/B测试？
---

# 【字节面经】如何评估 RAG 系统的回答质量？你用过 RAGAS 或类似的评测框架吗？

## 一、为什么 RAG 评估需要分解？

RAG 系统本质是**两阶段流水线**：先**检索**（Retrieval），后**生成**（Generation）。如果只看最终答案质量，一旦效果差，你根本不知道是**检索器召回不到**，还是**生成器有了材料也答不对**。这就像评估一个研究员——不能只看最终报告，还要看他**查资料的能力**（检索）和**写报告的能力**（生成）分开评估。

> **核心原则**：可分解性是系统优化的前提。整体指标只能告诉你"好或不好"，分解指标才能告诉你"哪里不好、怎么修"。

---

## 二、RAG 评估全景图

```
┌─────────────────────────────────────────────────────┐
│                  RAG 评估体系                         │
├──────────────┬──────────────────────────────────────┤
│              │  Recall@K / Precision@K              │
│  检索层评估   │  MRR (Mean Reciprocal Rank)           │
│ (Retrieval)  │  NDCG                               │
│              │  Hit Rate                           │
├──────────────┼──────────────────────────────────────┤
│              │  Faithfulness (忠实度)               │
│  生成层评估   │  Answer Relevancy (答案相关性)        │
│ (Generation) │  BLEU / ROUGE                       │
│              │  LLM-as-Judge                        │
├──────────────┼──────────────────────────────────────┤
│  端到端评估   │  整体准确率 / 用户满意度              │
│ (End-to-End) │  人工标注 + A/B 测试                 │
└──────────────┴──────────────────────────────────────┘
```

---

## 三、RAGAS 四大核心维度（重点）

**RAGAS**（RAG Assessment）是目前最主流的 RAG 评估框架，它**不需要人工标注**，仅凭 `问题(question)`、`上下文(contexts)`、`答案(answer)` 和 `参考答案(ground_truth)` 四项输入，即可用 LLM 自动评分。

| 维度 | 含义 | 评估什么 | 输入 | 分数含义 |
|------|------|----------|------|----------|
| **Faithfulness**（忠实度） | 答案是否**基于**检索到的上下文，有没有**幻觉/编造** | 生成质量 | question, answer, contexts | 分越高 = 越忠实于上下文，幻觉越少 |
| **Answer Relevancy**（答案相关性） | 答案是否**回答了**用户问题，有没有答非所问 | 生成质量 | question, answer | 分越高 = 越切题 |
| **Context Precision**（上下文精度） | 检索到的上下文里，**有多少是真正有用的** | 检索质量 | question, ground_truth, contexts | 分越高 = 噪声越少，检索越准 |
| **Context Recall**（上下文召回） | 回答问题所需的**信息是否都被检索到了** | 检索质量 | question, ground_truth, contexts | 分越高 = 信息越完整，没漏 |

### 3.1 各维度的底层实现原理

**Faithfulness（忠实度）**：
1. LLM 把 `answer` 拆成一个个**原子陈述句**（atomic claims）
2. 对每一条陈述，判断能否从 `contexts` 中找到证据支持
3. `Faithfulness = 被支持的陈述数 / 总陈述数`

> 示例：问题"公司年假几天？"，上下文写"入职满1年有5天年假"，答案"入职有10天年假" → Faithfulness 低（有证据的部分为0）。

**Answer Relevancy（答案相关性）**：
1. LLM 根据 `answer` **反向生成若干候选问题**
2. 计算这些反向问题与原始 `question` 的**语义相似度**（通常用 embedding cosine）
3. 取平均作为最终分数

**Context Precision（上下文精度）**：
1. 对每个检索到的 chunk，LLM 判断它是否对回答 `ground_truth` 有贡献
2. 类似 Precision@K 的加权计算，靠前的有用 chunk 权重更高

**Context Recall（上下文召回）**：
1. LLM 把 `ground_truth` 拆成原子陈述
2. 对每条判断是否能从 `contexts` 中找到支撑
3. `Recall = 可追溯的陈述数 / 总陈述数`

---

## 四、检索层评估指标

独立评估检索器时，我们需要预先标注的**golden context**（哪些 chunk 是正确答案所在）。

| 指标 | 公式 | 说明 |
|------|------|------|
| **Recall@K** | 前K个结果中命中golden的比例 | 能不能找到正确 chunk |
| **Precision@K** | 前K个结果中相关chunk占比 | 找到的准不准 |
| **Hit Rate@K** | 前K个结果中是否至少命中1个 | 最简单的命中率 |
| **MRR** | Mean Reciprocal Rank = `1/排名` 平均 | 正确结果排在越前面越好 |
| **NDCG** | 带位置衰减的相关性得分归一化 | 兼顾相关性和排序质量 |

```python
# 检索指标计算示例
def recall_at_k(retrieved_ids, relevant_ids, k):
    top_k = retrieved_ids[:k]
    hits = len(set(top_k) & set(relevant_ids))
    return hits / len(relevant_ids) if relevant_ids else 0.0

def mrr(ranked_ids, relevant_ids):
    for i, doc_id in enumerate(ranked_ids):
        if doc_id in relevant_ids:
            return 1.0 / (i + 1)
    return 0.0

# 假设检索排序结果和标准答案
retrieved = [101, 203, 305, 410, 512]
relevant  = {203, 512}

print(f"Recall@3 = {recall_at_k(retrieved, relevant, 3):.2f}")  # 0.50
print(f"MRR      = {mrr(retrieved, relevant):.4f}")              # 0.5000
```

---

## 五、RAGAS 实战代码

### 5.1 安装与数据准备

```bash
pip install ragas datasets
```

```python
from datasets import Dataset

# 构造评测集：每条需要 question/contexts/answer/ground_truth
eval_data = Dataset.from_dict({
    "question": [
        "公司的年假政策是什么？",
        "如何申请报销？",
    ],
    "contexts": [
        ["根据员工手册，入职满1年享5天年假，满3年享10天年假。",
         "所有年假需提前一周在系统中申请。",
         "公司年会是每年12月举办。"],  # 第3条是噪声
        ["报销需提供发票原件，通过OA系统提交。",
         "审批流程为：直属领导→财务部。",
         "公司食堂每周一更新菜单。"],   # 第3条是噪声
    ],
    "answer": [
        "入职满1年有5天年假，满3年有10天年假，需提前一周在系统申请。",
        "报销需要提供发票原件，通过OA系统提交，由直属领导和财务部审批。",
    ],
    "ground_truth": [
        "入职满1年5天，满3年10天，需提前一周系统申请。",
        "需提供发票原件，OA系统提交，直属领导→财务审批。",
    ],
})
```

### 5.2 运行 RAGAS 评估

```python
import os
from ragas import evaluate
from ragas.metrics import (
    faithfulness,
    answer_relevancy,
    context_precision,
    context_recall,
)

os.environ["OPENAI_API_KEY"] = "sk-..."

# 一行评估
results = evaluate(
    dataset=eval_data,
    metrics=[
        faithfulness,
        answer_relevancy,
        context_precision,
        context_recall,
    ],
)

print(results)
# {'faithfulness': 1.00, 'answer_relevancy': 0.92,
#  'context_precision': 0.83, 'context_recall': 1.00}

# 导出为 DataFrame 方便分析
import pandas as pd
df = results.to_pandas()
print(df[["question", "faithfulness", "answer_relevancy",
          "context_precision", "context_recall"]])
```

### 5.3 使用中文模型 / 自定义 LLM

```python
from langchain_openai import ChatOpenAI
from langchain_community.embeddings import HuggingFaceEmbeddings
from ragas import evaluate

# 用国内模型评估中文 RAG
llm_judge = ChatOpenAI(
    model="gpt-4o-mini",         # 或 deepseek、qwen 等
    temperature=0,
)
embeddings = HuggingFaceEmbeddings(
    model_name="BAAI/bge-small-zh-v1.5"
)

results = evaluate(
    dataset=eval_data,
    metrics=[faithfulness, answer_relevancy,
             context_precision, context_recall],
    llm=llm_judge,
    embeddings=embeddings,
)
```

---

## 六、LLM-as-Judge：通用生成质量评估

当没有标准答案（没有 ground_truth）时，可以用 **LLM-as-Judge**：让一个强 LLM（如 GPT-4）充当裁判，对 RAG 输出打分。

```python
def llm_as_judge(question, answer, context, judge_llm):
    prompt = f"""你是一个严格的评估专家。请根据以下标准给答案打1-5分：
    1. 正确性：答案是否准确无误
    2. 完整性：是否覆盖了所有关键点
    3. 忠实性：是否基于提供的上下文，无幻觉

    问题：{question}
    上下文：{context}
    答案：{answer}

    请给出总分(1-5)和理由。"""
    return judge_llm.invoke(prompt)
```

### LLM-as-Judge 的局限性

| 局限 | 说明 |
|------|------|
| **位置偏见** | LLM 倾向于给第一个出现的答案打高分 |
| **冗长偏好** | LLM 更喜欢更长、看起来更丰富的答案 |
| **自我偏好** | GPT-4 评价时可能偏向 GPT 风格的答案 |
| **不能代替人工** | 微妙的事实错误可能被 LLM 漏判 |
| **成本** | 每条评估都要调用 LLM API，大批量评估费用高 |

> **最佳实践**：用 LLM-as-Judge 做大规模初筛，再对低分样本做**人工复核**。

---

## 七、RAG 评估完整指标速查表

| 层级 | 指标 | 评估目标 | 需要标注 | 工具 |
|------|------|----------|----------|------|
| 检索 | Recall@K | 召回率 | Golden context | 自定义 |
| 检索 | MRR | 排序质量 | Golden context | 自定义 |
| 检索 | NDCG | 排序+相关性 | 相关性标注 | 自定义 |
| 生成 | Faithfulness | 无幻觉 | 无 | RAGAS |
| 生成 | Answer Relevancy | 答案相关性 | 无 | RAGAS |
| 检索+生成 | Context Precision | 上下文精度 | Ground truth | RAGAS |
| 检索+生成 | Context Recall | 上下文召回 | Ground truth | RAGAS |
| 生成 | BLEU | 文本相似度 | Ground truth | sacrebleu |
| 生成 | ROUGE | 召回式相似度 | Ground truth | rouge-score |
| 端到端 | LLM-as-Judge | 综合质量 | 无 | GPT-4 |
| 端到端 | 人工标注 | 最终质量 | 人工 | Label Studio |
| 端到端 | 用户反馈 | 真实满意度 | 用户行为 | A/B测试 |

---

## 八、完整评估流程（面试加分）

1. **构建评测集**：人工编写 200-500 条 `(question, ground_truth, golden_contexts)` 三元组
2. **评估检索器**：跑 Recall@K / MRR / Context Precision
3. **评估生成器**：跑 Faithfulness / Answer Relevancy
4. **端到端评估**：LLM-as-Judge + 人工抽检
5. **迭代优化**：
   - Context Precision 低 → 优化分块策略（chunk size/overlap）
   - Context Recall 低 → 换 embedding 模型 / 加重排器（reranker）
   - Faithfulness 低 → 调 prompt（如加"仅基于上下文回答"约束）
   - Answer Relevancy 低 → 换更强的生成模型 / 优化 prompt

### 面试加分点

- **TruLens**、**DeepEval** 是 RAGAS 的替代框架，各有侧重
- **RAG Triad**（TruLens 提出）：Context Relevance + Groundedness + Answer Relevance，本质上和 RAGAS 四维度异曲同工
- **用 LangSmith** 可以做完整的 RAG tracing + 评估一体化
- 评估不是一次性的：上线后要持续收集 **bad case**，扩充评测集，形成飞轮
- PEP 703（free-threaded Python）移除 GIL 后，大规模 RAG 评估的并发性能会提升

---

## 九、总结一句话

> RAG 评估的本质是**分解**：用 Recall@K / MRR 评估检索器，用 Faithfulness / Answer Relevancy 评估生成器，用 RAGAS 框架实现无标注自动化评分，再配合 LLM-as-Judge 和人工抽检形成闭环。不分解就无法定位瓶颈，这是 RAG 系统优化的第一原则。