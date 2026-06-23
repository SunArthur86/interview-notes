---
id: note-fl-006
difficulty: L4
category: ai
subcategory: RAG
tags:
- 字节
- 飞连
- 面经
- AgenticRAG
- ReAct
feynman:
  essence: 传统 RAG 是 retrieve-once → generate 的一步流程；Agentic RAG 是 plan → retrieve → reflect → re-retrieve → generate 的多步循环，每步允许 LLM 决定下一步动作。Query Rewrite 严格说不算 Agentic（无决策回路），要算 Agentic 至少要有"根据上一轮结果决定要不要再检索"这个决策点。成本靠硬上限（最多N轮）+ 早停（置信度够高就停）。
  analogy: 传统 RAG 像一次性外卖——下单（检索）→ 收餐（生成）→ 结束。Agentic RAG 像跟研究员合作——你说需求，他先查一轮，觉得不够再查一轮，边查边反思，直到凑齐证据才给报告。
  first_principle: 简单事实查询用一步检索就够；但多跳推理、跨文档对比、深度研究需要"边查边想"。决策点的引入让系统从"固定流程"升级为"自适应流程"，代价是成本和复杂度上升。
  key_points:
  - '传统RAG检索1次固定流程；AgenticRAG检索N次LLM决策'
  - 'Query Rewrite 严格说不算 Agentic（无决策回路）'
  - '多轮检索用 Self-Ask / ReAct-RAG / Plan-and-Execute'
  - '检索失败：改写query / 切数据源 / 降难度 / 兜底转人工'
  - '成本控制：硬上限（3-5轮）+ 早停（置信度τ）+ 缓存 + 降级 + 小模型决策'
first_principle:
  essence: Agentic = 决策回路引入
  derivation: 一步检索只能答简单事实 → 多跳推理需要多次检索 → 谁决定"要不要再查"→ LLM决策回路 → 决策点带来灵活性也带来失败点和成本 → 必须加上下界控制
  conclusion: Agentic RAG 的核心不是"检索多次"，而是"LLM 决定要不要再检索"——决策回路是把双刃剑
follow_up:
- Anthropic 的 deep-research / multi-agent research 论文怎么拆分研究任务？
- 怎么定义"置信度"做早停？LLM 自评可信吗？
- Agentic RAG 失败时怎么 fallback 到传统 RAG？
---

# 【字节飞连面经】Agentic RAG 和传统 RAG 区别？Query Rewrite 算 Agentic 吗？

## 一、核心区别

| 维度 | 传统 RAG | Agentic RAG |
|------|---------|-------------|
| 检索次数 | 1 | N |
| 决策权 | 没有，固定流程 | LLM 决定要不要再查、查什么 |
| 工具数 | 1（一个检索器） | 多（多个数据源 + 计算工具） |
| 适用 | 简单事实查询 | 多跳推理、跨文档对比、深度研究 |
| 成本 | 低 | 3-10x |
| 稳定性 | 高 | 低（多了决策点就多了失败点） |

## 二、Query Rewrite 算 Agentic 吗？严格说不算

- **Query Rewrite**：固定一步预处理，无决策回路 → 仍是传统 RAG
- **算 Agentic 的标准**：至少要有"根据上一轮结果决定要不要再检索"这个决策点

```
传统 RAG（含 Query Rewrite）：
  query → rewrite → retrieve(1次) → generate

Agentic RAG：
  query → retrieve → 看结果 → 不够？→ rewrite → retrieve(再) → ... → generate
                       ↑_________决策回路________↓
```

## 三、多轮检索设计

| 范式 | 做法 | 适用 |
|------|------|------|
| **Self-Ask** | LLM 自问"我还需要知道什么"，生成子问题 → 检索 → 答 → 拼装 | 多跳推理 |
| **ReAct-RAG** | Thought → Search → Observation → Thought → ... 直到 Answer | 信息不全需边问边查 |
| **Plan-and-Execute** | 先出完整 plan（5 步），再执行 | 步骤明确的研究 |

飞连 IT 工单场景适合 **ReAct-RAG**（用户描述往往不完整，需要边问边查）。

## 四、检索失败时 Agent 怎么调整策略

```
检索失败 → 
  [1] 改写 query（同义词、去停用词、英文化）
  [2] 切数据源（wiki 没查到 → 工单历史 → 代码库）
  [3] 降难度（找不到完整答案就找相关上下文，让 LLM 推理）
  [4] 兜底：透明告知"未找到相关文档" + 转人工
```

## 五、成本和稳定性控制

```
硬上限：每个 query 最多 N 轮（典型 3-5）
  ↓
早停：每轮算一次置信度，超过 τ 就停
  ↓
缓存：同一个 sub-query 命中过就不重复
  ↓
降级：Agentic RAG 失败/超时 → fallback 到传统 RAG
  ↓
小模型决策 + 大模型总结：决策环节用 Haiku / 豆包 lite，便宜稳定
```

## 六、加分点

提到 **Anthropic 的 deep-research / multi-agent research 论文**：把研究任务拆给多个 sub-agent 并行做，每个 sub-agent 负责一个子问题，最后 orchestrator 汇总。比单 agent 串行检索快 3-5 倍。

## 七、Agentic RAG 失败 fallback

- 超时 / 步数耗尽 → 用最后一轮检索结果做传统 RAG 生成（保证有答案）
- 全部检索失败 → 透明告知 + 转人工（不要硬编）

## 八、扩展

- **置信度评估**：让 LLM 自评"我对这个答案有多确定"（0-1），但 LLM 自评有过度自信偏差 → 用 Retrieval confidence（检索分数）+ LLM 自评 + 多次采样一致性 综合判断
- **成本预算**：给每个 query 设 token budget，超了就强制降级
- **评测指标**：除了答案准确率，还要看"平均检索轮数""平均成本""早停命中率"
