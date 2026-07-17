---
id: note-bz-agent-009
difficulty: L3
category: ai
subcategory: Agent
tags:
- B站面经
- ReAct
- RAG
- Agent
- 认知框架
feynman:
  essence: ReAct RAG Agent=把RAG(检索)变成Agent的"工具"，让Agent自主决定何时检索、检索什么、检索后如何推理。区别于固定流程的Naive RAG，它动态决策检索策略。
  analogy: 普通RAG像自动售货机（投币出货，固定流程），ReAct RAG像导购员（听需求→找商品→不够再找→推荐）。
  first_principle: Naive RAG是"一次性检索"，复杂问题需要多次检索/拆分检索。把检索作为Agent工具，让LLM动态决定检索策略，能解决多跳问答等问题。
  key_points:
  - 把retrieval作为Agent的一个tool
  - Agent自主决定：检索时机/查询构造/是否再次检索
  - 解决多跳问答（需多次检索串联）
  - 比Naive RAG更智能，比Agentic RAG更轻量
first_principle:
  essence: 复杂问题的信息需求是动态的——无法一次性构造完美query。
  derivation: Naive RAG假设：query一次检索就能找到答案。但多跳问题（A公司的CEO的母校）需要先查A公司→再查CEO→再查母校。ReAct让Agent在推理过程中按需检索，每次基于已有信息构造下一个query。
  conclusion: ReAct RAG = 把检索变成可反复调用的工具，让Agent动态规划检索路径
follow_up:
- 怎么评估ReAct RAG效果？——多跳问答数据集（HotpotQA/MuSiQue）
- 检索多次会不会太慢？——并行检索+缓存+检索次数限制
- 和Self-RAG什么区别？——Self-RAG训练模型自带检索门控，ReAct RAG靠prompt引导
memory_points:
- 对比Naive RAG：Naive是固定单次检索，ReAct RAG是动态按需多次检索
- 工具化：将向量数据库的检索功能封装为 retrieve 工具供Agent调用
- 核心优势：解决复杂多跳问答，如A买了B，B的创始人是谁的链式推理
---

# ReAct RAG Agent 如何实现？

## 一、Naive RAG vs ReAct RAG

```
Naive RAG（固定流程，一次性检索）：
用户问题 → Embedding → 向量检索(top-k) → 塞入Prompt → LLM生成
问题：复杂问题一次检索找不到答案，无法多跳推理

ReAct RAG（动态决策，按需检索）：
用户问题 → Agent思考 → 需要查吗？→ 构造query → 检索
                                          ↓
                              观察结果 → 够吗？→ 不够再检索
                                          ↓           ↓
                                         够了        足够
                                          ↓
                                      推理生成答案
```

## 二、ReAct RAG 的实现

### 把检索包装成 Tool

```python
class RAGAgent:
    def __init__(self, llm, vector_db):
        self.llm = llm
        self.vector_db = vector_db
        self.tools = {
            "retrieve": self.retrieve,  # 检索工具
        }
    
    def retrieve(self, query, top_k=3):
        """检索工具：Agent可反复调用"""
        docs = self.vector_db.similarity_search(query, k=top_k)
        return "\n".join([d.page_content for d in docs])
    
    def run(self, question):
        scratchpad = f"Question: {question}\n"
        
        for step in range(MAX_STEPS):
            # ReAct: Thought + Action
            output = self.llm.reason(REACT_RAG_PROMPT + scratchpad)
            
            thought, action = parse(output)
            
            if action.name == "Finish":
                return action.args  # 最终答案
            
            if action.name == "retrieve":
                # Agent自主构造检索query
                obs = self.retrieve(action.args)
                scratchpad += f"Thought: {thought}\n"
                scratchpad += f"Action: retrieve[{action.args}]\n"
                scratchpad += f"Observation: {obs[:500]}\n"
```

### ReAct RAG 专用 Prompt

```python
REACT_RAG_PROMPT = """
你能使用检索工具回答问题。按以下格式：

Question: {问题}

Thought: {分析问题，决定是否需要检索，检索什么}
Action: retrieve[{检索查询词}]
Observation: {检索到的文档}

Thought: {基于检索结果继续分析}
Action: retrieve[{可能需要换个角度再检索}]  # 或 Finish
Observation: ...

Thought: 已收集足够信息
Action: Finish[{基于检索证据的回答}]

规则：
- 每次检索用精准的关键词，不要一次问太宽泛
- 检索结果不足时，换关键词再检索
- 回答必须基于检索到的Observation，不要编造
"""
```

## 三、多跳问答示例

**问题："收购了 DeepMind 的公司的创始人毕业于哪所大学？"**

```
Step 1:
  Thought: 我需要先找出谁收购了DeepMind
  Action: retrieve["DeepMind 收购"]
  Observation: 2014年，Google以约4亿英镑收购了DeepMind
  
Step 2:
  Thought: Google收购了DeepMind。现在需要找Google的创始人
  Action: retrieve["Google 创始人"]
  Observation: Google由Larry Page和Sergey Brin创立
  
Step 3:
  Thought: 创始人是Larry Page和Sergey Brin，查他们的母校
  Action: retrieve["Larry Page 大学 Sergey Brin 大学"]
  Observation: 两人在斯坦福大学相识，Larry Page密歇根大学本科，
               Sergey Brin马里兰大学本科
  
Step 4:
  Thought: 已获得完整信息链，可以回答了
  Action: Finish["Google（收购DeepMind）的创始人Larry Page
           毕业于密歇根大学，Sergey Brin毕业于马里兰大学，两人
           硕士均就读斯坦福大学"]
```

**关键点：** Naive RAG 一次检索无法解决这种"收购方→创始人→母校"的三跳问题。

## 四、ReAct RAG 的检索策略增强

### 1. 查询改写（Query Rewriting）

```python
# Agent把口语问题改写成更利于检索的query
原始问题: "那个做电动车的马斯克的公司最近怎么样"
改写query: "Tesla 2026 最新动态"  # 更精准
```

### 2. 子问题分解（Decomposition）

```python
# 复杂问题拆成子问题分别检索
问题: "比较GPT-4和Claude在代码任务上的表现"
分解:
  - retrieve["GPT-4 代码 benchmark"]
  - retrieve["Claude 代码 benchmark"]  
  - retrieve["GPT-4 vs Claude 代码对比"]
```

### 3. 检索结果过滤（Self-Reflection）

```python
# Agent判断检索结果是否相关，不相关则重新检索
Thought: 上次检索结果都是新闻，没有技术细节，换个query
Action: retrieve["XXX 技术架构 原理"]  # 更具体的query
```

## 五、ReAct RAG 架构图

```
┌─────────────────────────────────────────────────┐
│              ReAct RAG Agent                      │
│                                                   │
│  ┌──────────┐                                    │
│  │ LLM Brain │ ← Thought: 推理/规划               │
│  └────┬─────┘                                    │
│       │ Action                                    │
│       ▼                                           │
│  ┌──────────────────────────────────┐           │
│  │ Tools:                            │           │
│  │  ├── retrieve(query) → 向量检索    │           │
│  │  ├── retrieve_sql(sql) → 结构化查询│           │
│  │  ├── rerank(docs) → 重排序         │           │
│  │  └── finish(answer) → 输出答案     │           │
│  └──────────────────────────────────┘           │
│       │ Observation                               │
│       ▼                                           │
│  反馈给LLM，决定下一步（再检索 or 回答）            │
└─────────────────────────────────────────────────┘
```

## 六、ReAct RAG 的局限与演进

```
ReAct RAG局限：
1. 检索次数不可控（可能检索很多次，慢且贵）
2. 依赖LLM构造好query（弱模型query质量差）
3. 无检索结果质量评估（可能用错信息）

演进 → Agentic RAG：
+ 检索结果置信度评估（低置信度触发重检索）
+ 多种检索源路由（向量/图/SQL自适应选择）
+ 检索策略学习（从历史记录优化检索模式）
```

## 七、面试加分点

1. **强调"动态决策"**：ReAct RAG 的核心是让 Agent 自主决定检索时机和 query，而非固定流程
2. **用多跳问答举例**：这是最能体现 ReAct RAG 价值的场景，Naive RAG 做不到
3. **提"检索即工具"**：把 retrieval 抽象为 tool，自然融入 ReAct 框架，设计优雅

## 记忆要点

- 对比Naive RAG：Naive是固定单次检索，ReAct RAG是动态按需多次检索
- 工具化：将向量数据库的检索功能封装为 retrieve 工具供Agent调用
- 核心优势：解决复杂多跳问答，如A买了B，B的创始人是谁的链式推理


## 苏格拉底式面试追问

> 这组追问模拟面试官层层逼问，每一问先回答"为什么"，再回答"怎么做"，最后回答"如何证明"。

### 第一层：目标与动机

**Q：ReAct RAG Agent 把检索变成"Agent 自主决策的工具"，这和 Naive RAG（固定流程：查询→检索→生成）有什么本质区别？固定流程不是更可靠吗？**

Naive RAG 是"单次检索"，假设一次查询就能检索到所有需要的信息。但复杂问题（如多跳问答"获得2022年诺贝尔物理学奖的科学家的博士导师是谁"）需要多次检索——先查获奖者，再查他的导师，是两步。Naive RAG 一次检索只能查"2022诺贝尔物理学奖"，拿到获奖者名字后没有"再查导师"的机制，答不出。ReAct RAG Agent 把检索作为工具，LLM 自主决定"先查 A，看结果再决定查 B 还是 C"，支持多跳、多轮、动态调整查询策略。可靠性上，Agent 虽然灵活但可能"乱查"，所以更适合复杂问题；简单问题（单跳事实查询）Naive RAG 更可靠（固定流程不发散）。

### 第二层：证据与定位

**Q：ReAct RAG Agent 在多跳问题上表现差（查了 5 步还没答对），你怎么定位是检索质量差还是 Agent 决策差？**

看每步的 trace 分层定位。1）检索质量——每步检索的 Observation 是否包含回答该步子问题需要的信息？如果 query 正确但检索召回的是无关文档，是检索（embedding/chunking）问题；2）Agent 决策——LLM 基于上一步 Observation 生成的下一步 query 是否合理？如果 Observation 里有信息但 LLM 没提取到/没用来构造下一步 query，是 LLM 推理问题；3）查询改写——LLM 生成的 query 是否适合检索（如用口语化问题检索效果差）？区分方法：人工审核每步的 query 和召回的 top-5 文档，标注"query 是否合理""召回是否相关"。query 合理但召回不相关→检索问题；query 不合理→决策问题；两者都合理但 LLM 没用召回信息→推理问题。

### 第三层：根因深挖

**Q：ReAct RAG Agent 决策出错（该继续检索却提前回答了），根因是什么？**

通常是"终止判断"的 prompt 设计问题。LLM 在每步要决定"继续检索 or 给最终答案"，这个判断依赖 prompt 里的终止信号指引。常见根因：1）prompt 没教"信息不足时继续检索"——LLM 倾向于"拿到一点信息就答"（急于求成），要明确"只有当 Observation 完整回答了问题才输出 final_answer"；2）检索结果看起来"相关但不充分"——LLM 误以为够了（如查到获奖者名字但没查到导师，LLM 编造导师），要在 prompt 强调"不要编造，信息不足继续查"；3）步数焦虑——LLM 在 prompt 里看到"要高效"的指引会提前终止。治本：prompt 加 few-shot 示例（演示"信息不足→继续检索"的推理），配 RL 训练（信息不足就答→负 reward）。

**Q：既然 Agent 可能"乱检索"（查了无关的），为什么不限制检索次数（如最多 3 次），从源头控制？**

限制次数是必要的兜底（防无限检索），但要配合"质量判断"而非硬截断。纯限制 3 次的问题：复杂多跳问题可能需要 4-5 步，硬卡 3 次会答不出。正确做法：1）设宽松上限（如 max_turns=8）防失控；2）中间不硬截断，而是让 LLM 每步自评"信息是否充分"，充分就答、不充分继续；3）加"检索效率监控"——如果连续 3 步检索的信息增益都接近 0（召回的都是已见过的相似内容），强制终止（再查也没用）。这样既允许合法的多步检索，又避免无效的无限检索，比硬限制次数更智能。

### 第四层：方案权衡

**Q：ReAct RAG 和 Naive RAG，在检索成本和延迟上差距多大？业务上能接受吗？**

成本和延迟差距显著。Naive RAG 单次检索（query→检索→生成），延迟约 500ms-1s，每次调 1 次 LLM + 1 次检索。ReAct RAG 多步（每步 query→检索→LLM 决策），平均 3-5 步，延迟 3-8s，每次调 3-5 次 LLM + 3-5 次检索，成本是 Naive 的 3-5 倍。业务接受度取决于任务价值：1）简单 FAQ（单跳事实）用 Naive RAG（快、便宜、够用）；2）复杂研究/多跳问答用 ReAct RAG（贵但能答对，单次任务价值高）；3）混合策略——先用分类器判断问题复杂度（单跳 vs 多跳），单跳走 Naive，多跳走 ReAct，兼顾成本和能力。实测 80% 查询是单跳（走 Naive），20% 多跳（走 ReAct），整体成本只比纯 Naive 高 30%，但多跳准确率从 40% 提到 75%。

**Q：为什么不直接用更大的 context window（如 1M token）把所有文档塞进去，让 LLM 自己找，而要搞 ReAct RAG 多步检索？**

三个原因。1）成本和延迟——1M context 的 prefill 计算量是单次检索的几千倍，延迟从 1s 到 30s+，API 成本（按 token 计）爆炸；2）lost-in-the-middle——1M context 里中间信息的召回率比首尾低 20-30%，关键信息可能被"淹没"，反而不如精准检索 top-5 准确；3）动态性——塞进 context 的是静态文档，Agent 多步检索可以根据中间结果动态决定下一步查什么（如先查 A 发现线索 B，再查 B），塞 context 做不到这种动态。所以即使有 1M context，复杂问题仍用 ReAct RAG（精准+动态），大 context 用于"单次塞入大量参考文档做综合分析"的场景，两者不替代。

### 第五层：验证与沉淀

**Q：你怎么证明 ReAct RAG 比Naive RAG 在你的业务上确实值得（效果提升覆盖成本增加）？**

AB 测试 + ROI 计算。固定多跳问题集，对比 Naive RAG 和 ReAct RAG：1）准确率——ReAct 应显著高（如 40%→75%）；2）单查询成本——ReAct 是 Naive 的 3-5 倍（token+检索次数）；3）ROI——ReAct 多出的成本 vs 准确率提升带来的业务价值。如客服场景：Naive 准确率 40% 意味着 60% 转人工（人工成本高），ReAct 准确率 75% 只有 25% 转人工，节省的人工成本远超 ReAct 多出的 API 成本，ROI 为正。如果业务是低价值高频查询（如 FAQ），ReAct 成本不划算，用 Naive。结论按"任务复杂度 × 业务价值"决策，不是一律用 ReAct。

**Q：ReAct RAG 的检索决策和查询改写经验怎么沉淀成框架能力？**

封装成 AgenticRAG 组件：1）检索工具封装——把向量检索/关键词检索/知识图谱检索都封装成 Agent 工具（标准 schema），Agent 按需调用；2）查询改写器——内置 HyDE（假设答案检索）/同义词扩展/sub-query 分解等改写策略，Agent 决策"用哪种改写"；3）终止判断器——内置"信息充分性评估"（LLM 自评或规则判断 Observation 是否完整回答问题），防过早终止或无限检索；4）多跳 trace 评测集——内置多跳问题的评测脚本（如 HotpotQA/Musique），自动跑回归。这套写入团队 RAG 框架 SOP，新 RAG 系统从 Naive 升级到 Agentic 时，组件复用、不重写决策逻辑。

## 结构化回答

**30 秒电梯演讲：** ReAct RAG Agent=把RAG(检索)变成Agent的"工具"，让Agent自主决定何时检索、检索什么、检索后如何推理。区别于固定流程的Naive RAG，它动态决策检索策略。

**展开框架：**
1. **把retri** — 把retrieval作为Agent的一个tool
2. **Agent自主决定** — 检索时机/查询构造/是否再次检索
3. **解决多跳问** — 解决多跳问答（需多次检索串联）

**收尾：** 您想深入聊：怎么评估ReAct RAG效果？——多跳问答数据集（HotpotQA/MuSiQue）？


## 视频脚本

> 预计时长：4 分钟 | 由浅入深


| 时间 | 画面/字幕 | 口播台词 | 讲解要点 |
|------|----------|----------|----------|
| 0:00 | 标题卡：ReAct RAG Agent 如何实现？ | "普通RAG像自动售货机（投币出货，固定流程），ReAct RAG像导购员（听需求→找商品→…" | 开场钩子 |
| 0:20 | 核心概念图 | "ReAct RAG Agent=把RAG(检索)变成Agent的"工具"，让Agent自主决定何时检索、检索什么、检索后…" | 核心定义 |
| 0:50 | 把retri示意图 | "把retri——把retrieval作为Agent的一个tool" | 要点拆解1 |
| 1:30 | 对比/实战案例图 | "对比一下常见误区和工程实践，看真实场景里怎么取舍。" | 实战与对比 |
| 2:20 | 总结卡 | "记住核心要点。下期我们追问：怎么评估ReAct RAG效果？——多跳问答数据集（Hotp？" | 收尾与钩子 |
