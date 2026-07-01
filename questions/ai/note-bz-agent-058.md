---
id: note-bz-agent-058
difficulty: L3
category: ai
subcategory: RAG
tags:
- B站面经
- RAG评估
- RAGAS
feynman:
  essence: RAG评估用RAGAS框架四大指标：忠实度(防幻觉)、答案相关性(切题)、上下文精度(检索准)、上下文召回(检索全)。四维量化RAG质量。
  analogy: 像考试阅卷——答案对不对(忠实)、有没有答到点上(相关)、参考资料找对了没(精度)、该找的都找了没(召回)。
  first_principle: RAG质量=检索质量×生成质量。检索好但生成差=找到了但没用好；生成好但检索差=巧妇难为无米之炊。需要分别评估。
  key_points:
  - RAGAS四指标：faithfulness/answer_relevancy/context_precision/context_recall
  - 忠实度最重要（防幻觉）
  - 检索和生成分别评估
  - 建立评估闭环持续优化
first_principle:
  essence: RAG是两阶段系统（检索+生成），需分别评估各阶段质量。
  derivation: 检索质量低→生成再好也无米下锅。生成质量低→检索再准也答不好。RAGAS分别评估检索(context指标)和生成(faithfulness/answer指标)，定位瓶颈。
  conclusion: RAG评估 = 检索指标（precision/recall） + 生成指标（faithfulness/relevancy）
follow_up:
- RAGAS怎么实现？——用LLM自动评估，无需人工标注
- 忠实度怎么算？——答案中的每个claim是否能在context找到支持
- 评估集怎么建？——真实问题+标准答案+相关文档
memory_points:
- 六大缺陷口诀：检索失败/噪音、LLM幻觉、上下文丢失、时效/矛盾信息
- 评估框架用RAGAS四大指标：生成看忠实与相关，检索看精度与召回
- 防幻觉看faithfulness（答案能否在上下文找到依据）
- 切题度看answer_relevancy（从答案反推问题的相似度）
- 查全率看context_recall，查准率看context_precision
---

# RAG 有哪些缺陷？如何用指标评估 RAG 系统？

## 一、RAG 的主要缺陷

```
┌──────────────────────────────────────────────────┐
│              RAG 的六大缺陷                          │
├──────────────────────────────────────────────────┤
│                                                    │
│  1. 检索失败                                       │
│     相关文档没被检索到（召回率低）                   │
│     → 答案错误或"我不知道"                          │
│                                                    │
│  2. 检索噪音                                       │
│     检索到大量不相关文档，干扰生成                   │
│     → 答案跑题                                     │
│                                                    │
│  3. 幻觉                                           │
│     LLM无视检索文档，编造答案                       │
│     → 答案不可信                                   │
│                                                    │
│  4. 上下文丢失                                     │
│     分块切断语义，关键信息不完整                     │
│     → 答案片面                                     │
│                                                    │
│  5. 时效性                                         │
│     知识库更新不及时，答案过时                       │
│     → 答案错误                                     │
│                                                    │
│  6. 矛盾信息                                       │
│     多个文档信息矛盾，LLM不知信哪个                 │
│     → 答案混乱                                     │
│                                                    │
└──────────────────────────────────────────────────┘
```

## 二、RAGAS 评估框架（四指标）

```python
"""
RAGAS (RAG Assessment) 四大核心指标
"""

metrics = {
    # === 生成质量指标 ===
    
    "faithfulness（忠实度）": {
        "含义": "答案是否忠实于检索文档（防幻觉）",
        "计算": "答案中的每个claim能否在context找到支持",
        "范围": "[0,1]，越高越好",
        "最重要": True,
        # 例: 答案"Agent有3个核心能力"
        #     context里确实说了 → faithful=1
        #     context没说 → faithful=0（幻觉）
    },
    
    "answer_relevancy（答案相关性）": {
        "含义": "答案是否切题回答了问题",
        "计算": "从答案反向生成问题，与原问题的相似度",
        "范围": "[0,1]，越高越好",
        # 例: 问"什么是Agent" 答"Agent是AI系统..." → 高相关
        #     答"Python是编程语言" → 低相关
    },
    
    # === 检索质量指标 ===
    
    "context_precision（上下文精度）": {
        "含义": "检索到的文档中有多少是相关的",
        "计算": "相关文档数 / 检索文档总数",
        "范围": "[0,1]，越高越好",
        # 检索10个，3个相关 → precision=0.3
    },
    
    "context_recall（上下文召回）": {
        "含义": "应该检索到的是否都检索到了",
        "计算": "需要标注的relevant docs",
        "范围": "[0,1]，越高越好",
        # 应该检索5个相关文档，只检索到3个 → recall=0.6
    },
}
```

## 三、RAGAS 实现

```python
from ragas import evaluate
from ragas.metrics import (
    faithfulness, answer_relevancy, 
    context_precision, context_recall
)

# 评估数据准备
dataset = {
    "question": ["什么是Agent?", "RAG怎么优化?"],
    "answer": [agent_answer_1, agent_answer_2],
    "contexts": [[retrieved_docs_1], [retrieved_docs_2]],
    "ground_truth": [reference_answer_1, reference_answer_2],  # 标准答案
}

# 评估
results = evaluate(
    dataset,
    metrics=[faithfulness, answer_relevancy, 
             context_precision, context_recall]
)

# 输出:
# faithfulness: 0.85       (答案85%忠于文档)
# answer_relevancy: 0.90   (答案90%切题)
# context_precision: 0.70  (检索70%相关)
# context_recall: 0.80     (召回80%)
```

## 四、faithfulness 详解（最重要）

```python
def calculate_faithfulness(answer, contexts):
    """忠实度计算：答案的每个声明是否有文档支持"""
    
    # Step 1: 把答案拆成原子声明(claims)
    claims = llm.decompose(answer)
    # "Agent有规划/记忆/工具三大能力，由LLM驱动"
    # → ["Agent有规划能力", "Agent有记忆能力", 
    #    "Agent有工具能力", "Agent由LLM驱动"]
    
    # Step 2: 逐个检查claim是否有context支持
    supported = 0
    for claim in claims:
        if llm.check_supported(claim, contexts):
            supported += 1
    
    # Step 3: 忠实度 = 被支持的claims / 总claims
    return supported / len(claims)

# faithfulness低 = 幻觉严重，需要优化
```

## 五、按指标定位问题

```
┌──────────────────────┬──────────────────────────────┐
│ 指标组合               │ 问题诊断 & 优化方向            │
├──────────────────────┼──────────────────────────────┤
│ recall低, precision高 │ 检索不全 → 优化召回(混合检索)  │
│ recall高, precision低 │ 检索噪音 → 加Rerank           │
│ recall高, precision高 │ 检索OK                        │
│  但faithfulness低     │ → 生成问题(防幻觉Prompt)       │
│ faithfulness高        │ 生成OK                        │
│  但relevancy低        │ → 答非所问(Prompt优化)         │
│ 全都低                │ 系统性问题，从头排查           │
└──────────────────────┴──────────────────────────────┘
```

## 六、评估闭环

```python
class RAGEvalLoop:
    """评估驱动的持续优化闭环"""
    
    def run_eval_cycle(self):
        # 1. 收集评估数据
        eval_data = self.collect_cases()  # 真实case+bad case
        
        # 2. 跑评估
        scores = ragas_evaluate(eval_data)
        
        # 3. 分析瓶颈
        bottleneck = self.identify_bottleneck(scores)
        # 例: "context_recall=0.5，检索召回不足"
        
        # 4. 针对性优化
        if bottleneck == "recall":
            self.optimize_retrieval()  # 加混合检索/HyDE
        elif bottleneck == "faithfulness":
            self.optimize_generation()  # 改防幻觉Prompt
        
        # 5. 回归测试（确保没退化）
        new_scores = ragas_evaluate(eval_data)
        assert new_scores >= scores  # 确保提升
        
        # 6. 循环
```

## 七、评估的实践建议

```
1. 先建评估集（最重要）
   - 50-100个真实问题
   - 每个问题标注：标准答案 + 相关文档
   - 没有评估集，优化是盲目的

2. 定期评估
   - 每次改动后回归测试
   - 线上case持续收集

3. 分层评估
   - 检索层：precision/recall（检索对不对）
   - 生成层：faithfulness/relevancy（生成好不好）
   - 端到端：用户满意度（最终效果）

4. 自动+人工结合
   - RAGAS自动评估（快，覆盖广）
   - 人工抽检（准，发现细微问题）
```

## 八、面试加分点

1. **RAGAS 四指标**：faithfulness/relevancy/precision/recall，覆盖检索和生成
2. **faithfulness 最重要**：防幻觉是 RAG 的核心价值——答案必须忠于文档
3. **按指标诊断**：不同指标组合指向不同问题——体现系统化排查能力

## 记忆要点

- 六大缺陷口诀：检索失败/噪音、LLM幻觉、上下文丢失、时效/矛盾信息
- 评估框架用RAGAS四大指标：生成看忠实与相关，检索看精度与召回
- 防幻觉看faithfulness（答案能否在上下文找到依据）
- 切题度看answer_relevancy（从答案反推问题的相似度）
- 查全率看context_recall，查准率看context_precision

