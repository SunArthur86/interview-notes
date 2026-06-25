---
id: note-bd-fq-006
difficulty: L3
category: ai
subcategory: RAG
tags:
  - 字节
  - 番茄小说
  - 面经
  - Rerank
  - 截断策略
  - 检索优化
feynman:
  essence: Rerank后需要截断保留高质量文档，三种策略：得分阈值（低于0.7丢弃）、固定K值（取Top-5）、混合策略（阈值+K上限）。K值需平衡上下文窗口、回答质量和成本
  analogy: 就像高考录取——可以设分数线（得分阈值），可以招固定人数（固定K），也可以两者结合（分数线+招生上限），根据学校容量和生源质量决定
  first_principle: 截断的本质是在"信息量"和"噪声"之间做平衡。保留太少→信息不足，保留太多→噪声干扰+Token浪费+注意力稀释
  key_points:
    - 得分阈值法：低于固定分数的不保留，灵活但需调参
    - 固定K值法：总是取Top-N，简单但可能引入低质文档
    - 混合策略：同时设阈值和K上限，最稳健
    - K值考量：上下文窗口占用、回答质量、成本控制、业务场景
first_principle:
  essence: Rerank得分反映了Query-Document的相关性强度，截断应基于相关性而非数量
  derivation: 'Rerank模型输出相关性得分s∈[0,1]。设阈值τ，保留s>τ的文档。当知识库覆盖好时，可能20条都>τ；当覆盖差时，可能0条>τ。固定K无法适应这种波动'
  conclusion: 最优截断 = 混合策略（阈值过滤 + K上限），加上"零召回兜底"机制
follow_up:
  - Rerank得分阈值怎么确定？不同业务场景差异大吗？
  - 如果Rerank后所有文档得分都很低（<0.3），应该怎么处理？
  - 截断后的文档顺序对大模型回答有什么影响（Lost in the Middle）？
---

# Rerank之后的截断策略是怎么设计的？为什么选这个K值？

## 三种截断策略对比

```
Rerank得分排序后：

文档A: 0.95 ████████████████████ 
文档B: 0.88 ██████████████████ 
文档C: 0.82 ████████████████ 
文档D: 0.71 ██████████████ 
文档E: 0.45 █████████        ← 分数骤降点
文档F: 0.32 ██████ 
文档G: 0.15 ███ 

策略1 - 固定K=5:          策略2 - 阈值0.5:         策略3 - 混合(K=10,τ=0.5):
[A,B,C,D,E]              [A,B,C,D]               [A,B,C,D]
↑ 引入了低分E            ↑ 精准但可能漏召回        ✅ 最优平衡
```

## 策略一：得分阈值法

```python
def threshold_truncate(reranked: list, threshold: float = 0.5) -> list:
    """低于阈值的文档全部丢弃"""
    return [d for d in reranked if d['score'] >= threshold]

# 优势：自适应——好时候多保留，差时候少保留
# 劣势：极端情况下可能返回0条（无召回兜底）
```

## 策略二：固定K值法

```python
def fixed_k_truncate(reranked: list, k: int = 5) -> list:
    """总是取Top-K"""
    return reranked[:k]

# 优势：简单可控，上下文Token消耗可预测
# 劣势：低质文档也会被强行保留
```

## 策略三：混合策略（推荐）

```python
def hybrid_truncate(
    reranked: list,
    max_k: int = 10,
    min_score: float = 0.5,
    min_return: int = 1,
) -> list:
    """同时设阈值和K上限，保证至少返回min_return条"""
    # 先按阈值过滤
    filtered = [d for d in reranked if d['score'] >= min_score]
    # 再按K上限截断
    result = filtered[:max_k]
    # 兜底：如果过滤后为空，至少返回得分最高的min_return条
    if len(result) < min_return:
        result = reranked[:min_return]
    return result
```

## K值设定的四个维度

| 维度 | 考量 | 建议K值 |
|------|------|--------|
| **上下文窗口** | 每条约500Token，K=10→5000Token | K≤上下文的20% |
| **回答质量** | K=5-10时RAG准确率最高 | K=5~10 |
| **成本控制** | 每多1条→增加~500Token成本 | 按预算反推 |
| **业务场景** | 客服(精确) vs 研究(广泛) | 客服K=3~5, 研究K=8~10 |

## 得分骤降检测（动态截断）

```python
def elbow_truncate(reranked: list) -> list:
    """检测得分曲线的"拐点"（elbow），在骤降处截断"""
    scores = [d['score'] for d in reranked]
    # 计算相邻文档的得分差
    diffs = [scores[i] - scores[i+1] for i in range(len(scores)-1)]
    # 找到最大跌幅的位置
    if not diffs:
        return reranked
    elbow_idx = diffs.index(max(diffs))
    # 在拐点处截断（保留拐点之前的文档）
    return reranked[:elbow_idx + 1]

# 示例：
# scores = [0.95, 0.88, 0.82, 0.71, 0.45, 0.32, 0.15]
# diffs   = [0.07, 0.06, 0.11, 0.26, 0.13, 0.17]
# max diff at index 3 (0.26) → 保留前4条
```

## 面试加分点

1. **Lost in the Middle**：截断后的文档顺序也有讲究——把最相关的放最前面和最后面（首因/近因效应），避免中间位置被忽略
2. **零召回兜底**：Rerank后全部低分时，应返回兜底回答（"暂无相关信息"）而不是强行用低质文档生成
3. **AB测试**：截断策略没有万能公式，必须用线上AB测试对比不同K值/阈值的准确率、延迟、成本
4. **动态调整**：根据Query难度动态调整K——简单事实题K=3，复杂推理题K=8
