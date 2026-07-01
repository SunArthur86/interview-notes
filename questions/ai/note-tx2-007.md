---
id: note-tx2-007
difficulty: L4
category: ai
subcategory: RAG
tags:
- 腾讯
- 面经
- RAG幻觉
- 溯源
- 事实校验
feynman:
  essence: 缓解 RAG 幻觉四种手段——①溯源引用(每个答案标注来源chunk，无来源就不输出)②相似度阈值过滤(检索分数低于阈值的chunk不喂LLM，避免硬编)③事实校验子Agent(独立Agent验证答案是否被检索内容支持)④Rerank模型(精排提升喂入chunk质量，减少噪声干扰)。本质是"只让有依据的内容输出"+"用独立机制验证"。
  analogy: 像写论文防抄袭/造假——①每个观点必须标引用(溯源)②来源不可靠的资料不用(阈值过滤)③请导师审核论文内容是否真有出处(事实校验)④先把资料筛一遍质量再读(Rerank)。
  first_principle: 幻觉源于 LLM "编造"无依据内容。缓解的本质是"约束 LLM 只基于检索内容回答"+"用独立机制验证"。
  key_points:
  - '溯源引用: 答案标注来源chunk，无来源不输出'
  - '相似度阈值过滤: 低分chunk不喂LLM，避免硬编'
  - '事实校验子Agent: 独立验证答案是否被检索内容支持'
  - 'Rerank模型: 精排提升喂入chunk质量'
  - '本质: 只让有依据的输出 + 独立验证'
first_principle:
  essence: 幻觉缓解 = 约束依据 + 独立验证
  derivation: LLM 会编造 → 约束只基于检索内容(溯源+阈值) → 但仍可能误用 → 加独立验证(事实校验子Agent) → 提升输入质量(Rerank)
  conclusion: 幻觉不能100%消除，但可以多层防御降到可接受
follow_up:
- 溯源引用怎么实现？怎么保证引用准确？
- 相似度阈值怎么定？
- 事实校验子Agent用什么prompt？
memory_points:
- 幻觉根源：检索不到硬编、检索到噪声误用、LLM自身胡编，需多层防御
- 检索端：设相似度阈值低分过滤，加Rerank模型剔除噪声，避免LLM误用上下文
- 生成端：Prompt强制溯源引用并校验chunk_id，限制只用给定Context，温度调低
- 验证端：独立事实校验子Agent逐句比对（推荐换不同模型防同源偏差），不支持即拦截
---

# 【某讯面经】缓解 RAG 幻觉手段：溯源引用、相似度阈值过滤、事实校验子Agent、重排模型

## 一、为什么 RAG 会幻觉

```
RAG 幻觉的根源：
  1. 检索不到相关内容 → LLM 用预训练知识硬编
  2. 检索到但质量差 → LLM 误用噪声
  3. 检索到了但 LLM 没正确引用 → 编造来源
  4. LLM 本身的幻觉倾向 → 即使有依据也可能编
```

**缓解思路**：①只让有依据的输出 ②用独立机制验证 ③提升输入质量。

## 二、手段1：溯源引用（Citation）

```
Prompt 设计：
  "请基于以下检索内容回答。每个陈述必须标注来源 [chunk_id]。
   如果检索内容不支持该陈述，请说'未找到相关内容'。
   不要使用检索内容之外的知识。"

输出示例：
  "VPN 连不上的常见原因是配置错误[chunk_3]。
   建议检查认证方式[chunk_7]。"
```

### 工程实现
```python
# 检索时记录 chunk_id
retrieved = vector_store.search(query, k=5)  # 每个 chunk 带 id

# Prompt 里带上 chunk_id
context = "\n".join([f"[{c.id}] {c.text}" for c in retrieved])
prompt = f"基于以下内容回答（标注来源）：\n{context}\n\n问题：{query}"

# 后处理：校验答案里的 [chunk_id] 是否都在 retrieved 里
import re
cited_ids = set(re.findall(r'\[chunk_\d+\]', answer))
valid_ids = {f"[{c.id}]" for c in retrieved}
invalid = cited_ids - valid_ids
if invalid:
    # 有编造的引用，标记可疑
    pass
```

**效果**：强制 LLM 标注来源，能 catch "无依据的编造"。

## 三、手段2：相似度阈值过滤

```python
retrieved = vector_store.search(query, k=10)
# 过滤低分 chunk（相似度低于阈值的不要）
THRESHOLD = 0.5  # 按你的 embedding 模型调
filtered = [c for c in retrieved if c.score >= THRESHOLD]

if not filtered:
    # 没有高质量内容，直接告知用户，不让 LLM 硬编
    return "未找到相关内容，建议转人工"

# 只喂高质量 chunk
context = "\n".join([c.text for c in filtered[:5]])
```

### 阈值怎么定
- 用标注数据算：已知相关的 chunk score 分布，取分位数
- 经验值：cosine 相似度 0.3-0.7（看 embedding 模型）
- 动态阈值：按 query 长度/类型调整

**效果**：避免"检索到垃圾内容，LLM 硬编"。

## 四、手段3：事实校验子 Agent

```
主流程：检索 → LLM 生成答案
                ↓
子 Agent（独立验证）：
  "以下是检索内容和 LLM 的答案。
   请逐句判断：每句是否被检索内容支持？
   - 支持：标 ✅
   - 不支持：标 ❌（幻觉）
   - 部分支持：标 ⚠️"
```

### 实现
```python
verify_prompt = f"""
检索内容：
{context}

LLM 答案：
{answer}

请逐句验证答案是否被检索内容支持。
输出 JSON：[{{"sentence": "...", "supported": true/false, "reason": "..."}}]
"""

verification = llm.invoke(verify_prompt)
# 如果有 unsupported 的句子，要么删除，要么标注"存疑"
```

**效果**：用独立 LLM 调用做交叉验证，catch 主流程的幻觉。

**注意**：子 Agent 用同一模型有"同源偏差"，最好用不同模型（主用混元，校验用 GPT）。

## 五、手段4：Rerank 模型（重排）

```
召回 50 条（BM25+向量）→ Rerank 选 top-5 → 喂 LLM
```

**为什么能缓解幻觉**：
- 召回阶段混入噪声（语义相近但无关）→ LLM 误用 → 幻觉
- Rerank 用 cross-encoder 精排，剔除噪声 → LLM 拿到的是高质量 context → 减少误用

**Rerank 模型**：BGE-Reranker / Cohere Rerank-v3。

## 六、其他辅助手段

### 手段5：Prompt 约束
```
"如果检索内容不足以回答，请明确说'根据现有资料无法回答'，
 不要编造或推测。"
```

### 手段6：温度调低
```
temperature: 0.1-0.3（降低随机性，减少编造）
```

### 手段7：自洽性检查（Self-Consistency）
```
同一问题采样多次，如果答案不一致 → 可能是幻觉
取多数一致的答案
```

## 七、多层防御组合

```
[1] 检索质量：BM25+向量混合 + Rerank（手段4）
[2] 输入过滤：相似度阈值（手段2）
[3] 生成约束：溯源引用 Prompt（手段1）+ 温度调低
[4] 输出验证：事实校验子 Agent（手段3）+ 自洽性检查
[5] 兜底：检测到幻觉 → 标注存疑 / 转人工
```

## 八、加分点

- 说出 **幻觉不能 100% 消除**，只能降到可接受范围
- 说出 **溯源引用的工程实现**：prompt 设计 + 后处理校验引用 id 合法性
- 说出 **事实校验子 Agent 用不同模型**，避免同源偏差

## 九、雷区

- ❌ "调低 temperature 就不会幻觉" → 只是降低概率，不能消除
- ❌ "检索到了就不会幻觉" → LLM 仍可能误用或编造来源
- ❌ 只用一种手段 → 单点防御不可靠

## 十、扩展

- **Faithfulness 指标**：用 RAGAS 等评测框架量化"答案对检索内容的忠实度"
- **CRAG（Corrective RAG）**：检索后先评估质量，质量差就触发 web 搜索补充
- **Self-RAG**：训练模型自己判断"要不要检索""检索结果相不相关""答案有没有依据"

## 记忆要点

- 幻觉根源：检索不到硬编、检索到噪声误用、LLM自身胡编，需多层防御
- 检索端：设相似度阈值低分过滤，加Rerank模型剔除噪声，避免LLM误用上下文
- 生成端：Prompt强制溯源引用并校验chunk_id，限制只用给定Context，温度调低
- 验证端：独立事实校验子Agent逐句比对（推荐换不同模型防同源偏差），不支持即拦截

