---
id: note-tt-agent-018
difficulty: L4
category: ai
subcategory: 推理优化
tags:
- 淘天
- 面经
- 二面
- 延迟优化
- 推理加速
- 多步推理
feynman:
  essence: Agent多步推理延迟高，从模型层（蒸馏/量化）、检索层（缓存/异步）、工程层（并行/流式/预计算）三层系统优化，将平均延迟从30s降到5s以内
  analogy: 就像快递提速——用更快的车（模型层：小模型量化），优化配送路线（检索层：缓存+预检索），同时分拣打包（工程层：并行+流式输出）
  first_principle: 多步推理总延迟 = Σ(每步LLM推理延迟 + 工具调用延迟 + 检索延迟)。每层都有优化空间，需逐层分析瓶颈
  key_points:
  - 模型层：7B蒸馏替代32B、INT4量化、KV Cache复用
  - 检索层：Query缓存、异步预检索、Embedding本地化
  - 工程层：无依赖步骤并行化、流式输出、Speculative Decoding
first_principle:
  essence: 总延迟是各阶段延迟的加和，优化应从占比最大的瓶颈入手
  derivation: 典型5步Agent延迟：LLM推理5步×3s=15s，RAG检索3次×1s=3s，工具调用2次×2s=4s，网络开销~3s。总计25s。模型层优化（量化）省6s，检索层（缓存）省2s，工程层（并行）省8s→总计9s
  conclusion: 先Profile找出瓶颈，再逐层优化，不要盲目优化所有环节
follow_up:
- Speculative Decoding在Agent场景的效果如何？
- 如何平衡延迟优化和质量下降？
- 有没有"提前规划"的机制减少推理步数？
memory_points:
- 因果句：因为多步推理耗时累加，所以必须从模型层、检索层、工程层三维压缩总耗时
- 对比句：模型层靠小模型路由与KV缓存，工程层靠无依赖步骤异步并行化处理
- 因果句：因为工具定义等前缀固定，所以开启Prefix Caching可大幅减少Token计算
- 因果句：因为Rerank模型极耗时，所以检索层采用粗排召回Top50再精排提速
---

# 自研Agent多步推理带来高延迟，从模型、检索、工程三层给出优化方案？

## 延迟瓶颈分析

```
典型5步Agent的总延迟分解：

┌──────────────────────────────────────────┐
│ 步骤1: 意图理解     LLM推理 3s          │
│ 步骤2: 检索         RAG 1s + Rerank 1s  │
│ 步骤3: 规划         LLM推理 3s          │
│ 步骤4: 工具调用     API 2s              │
│ 步骤5: 生成回答     LLM推理 4s          │
│ 网络开销             ~3s                │
├──────────────────────────────────────────┤
│ 总延迟               ~17s               │
│ 目标                  <5s               │
└──────────────────────────────────────────┘
```

## 模型层优化

### 1. 模型蒸馏与路由

```python
class ModelRouter:
    """简单任务用小模型，复杂任务用大模型"""
    def route(self, task_complexity: str) -> str:
        if task_complexity == 'simple':   # 意图分类、参数提取
            return 'qwen-7b-int4'         # 7B量化，推理~0.5s
        elif task_complexity == 'medium': # 单步推理、总结
            return 'qwen-14b'             # 14B，推理~1.5s
        else:                              # 复杂规划、多步推理
            return 'qwen-32b'             # 32B，推理~3s

# 效果：5步中3步简单+1步中等+1步复杂
# 延迟：0.5×3 + 1.5 + 3 = 6s（原15s → 6s）
```

### 2. 量化加速

```python
# INT4量化：模型体积减少75%，推理速度提升2-3x
# vLLM + AWQ量化部署
"""
vllm serve Qwen/Qwen2.5-32B-Instruct-AWQ \
    --quantization awq \
    --dtype half \
    --max-model-len 8192 \
    --gpu-memory-utilization 0.9
"""
```

### 3. KV Cache + Prefix Caching

```python
# 相同System Prompt + 工具定义的请求复用KV Cache
# Agent场景中工具定义固定，每次只有用户输入变化
# Prefix Cache可减少30-50%的推理时间

# vLLM原生支持：
"""
vllm serve model --enable-prefix-caching
"""
```

## 检索层优化

```python
class OptimizedRetrieval:
    async def retrieve(self, query: str):
        # 1. Query缓存（相同Query直接返回）
        cached = await self.cache.get(query)
        if cached:
            return cached  # 命中率~30%

        # 2. 异步预检索（在LLM规划的同时启动检索）
        # 用上一步的中间结果预测可能需要的检索Query

        # 3. 两级检索
        results = await self.vector_db.search(query, top_k=50)  # 快速ANN
        # Rerank只对Top-50做，而不是Top-200
        reranked = await self.reranker.rank(query, results[:50], top_k=5)

        # 4. 缓存结果
        await self.cache.set(query, reranked, ttl=3600)
        return reranked
```

## 工程层优化

### 1. 无依赖步骤并行化

```python
import asyncio

async def parallel_agent_pipeline(user_input: str):
    # 步骤1：意图理解（必须先完成）
    intent = await self.understand_intent(user_input)

    # 步骤2和3可以并行：检索 + 意图分析
    # 原来是串行：RAG(1s) → 分析(1s) = 2s
    # 并行后：max(RAG, 分析) = 1s
    retrieval_task = asyncio.create_task(self.retrieve(intent.query))
    analysis_task = asyncio.create_task(self.analyze_intent(intent))

    rag_results = await retrieval_task
    analysis = await analysis_task

    # 步骤4：生成回答
    response = await self.generate(rag_results, analysis)
    return response
```

### 2. 流式输出

```python
async def stream_response(self, prompt: str):
    """流式输出让用户在1s内看到第一个Token"""
    async for chunk in self.llm.stream(prompt):
        yield chunk  # 边生成边返回
    # 用户感知延迟从"等15s拿完整结果"变为"1s看到开始，逐步完善"
```

### 3. Speculative Decoding

```python
# 用小模型（7B）猜测大模型（32B）的输出
# 小模型快速生成5个Token，大模型一次验证
# 如果猜对5个：原本5次推理变为1次验证 → 5x加速
# 如果猜错：在大模型纠错的位置继续

"""
vllm serve model \
    --speculative-model Qwen/Qwen2.5-7B-Instruct \
    --num-speculative-tokens 5
"""
# 实测：Agent场景平均2-3x加速
```

## 优化效果汇总

| 优化措施 | 优化前延迟 | 优化后延迟 | 节省 |
|---------|----------|----------|------|
| **模型层** | | | |
| 模型路由（7B替代部分32B） | 15s | 8s | -7s |
| INT4量化 | 8s | 5s | -3s |
| Prefix Cache | 5s | 3.5s | -1.5s |
| **检索层** | | | |
| Query缓存 | 2s | 0.5s | -1.5s |
| Rerank范围缩小 | 1s | 0.3s | -0.7s |
| **工程层** | | | |
| 并行化 | 2s串行 | 1s并行 | -1s |
| 流式输出（首Token） | 等全程 | 1s | 感知提升 |
| Speculative Decoding | 3.5s | 1.5s | -2s |
| **总计** | **~25s** | **~4.8s** | **-20s** |

## 面试加分点

1. **Profile优先**：先测量各阶段耗时分布（用OpenTelemetry全链路追踪），不要盲目优化
2. **质量监控**：每项优化都需要监控准确率，延迟降低不能以质量大幅下降为代价
3. **用户感知**：流式输出让用户在1s内看到反馈，比绝对延迟优化更重要（心理学）
4. **成本权衡**：Speculative Decoding增加小模型推理成本，但大模型推理次数减少，总成本可能降低

## 记忆要点

- 因果句：因为多步推理耗时累加，所以必须从模型层、检索层、工程层三维压缩总耗时
- 对比句：模型层靠小模型路由与KV缓存，工程层靠无依赖步骤异步并行化处理
- 因果句：因为工具定义等前缀固定，所以开启Prefix Caching可大幅减少Token计算
- 因果句：因为Rerank模型极耗时，所以检索层采用粗排召回Top50再精排提速

