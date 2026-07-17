---
id: note-bz-agent-056
difficulty: L4
category: ai
subcategory: RAG
tags:
- B站面经
- Agentic RAG
- GraphRAG
- RAG对比
feynman:
  essence: Agentic RAG=把检索变成Agent的工具，动态决策检索策略。区别于Naive RAG的固定流程，Agentic RAG让LLM自主决定何时查、查什么、查几次。
  analogy: Naive RAG像自动售货机(投币出货固定流程)，Agentic RAG像导购(听需求→找商品→不够再找→推荐)。
  first_principle: 复杂问题的信息需求是动态的，固定流程的Naive RAG无法适应。Agent能根据上下文动态调整检索策略。
  key_points:
  - Agentic RAG是检索作为Agent工具，动态决策
  - Naive RAG是固定流程，一次性检索
  - 区别：智能程度（动态vs固定）
  - 优势：多跳问答/复杂推理/自我纠错
first_principle:
  essence: 检索策略应该匹配问题的复杂度——简单问题一次检索够，复杂问题需多次探索。
  derivation: Naive RAG假设一次检索就能找到答案。复杂问题（多跳/需要推理）的信息需求是动态的——查到A后才知道要查B。Agent能在推理过程中按需检索，适应这种动态性。
  conclusion: Agentic RAG = 检索作为Agent工具 + 动态检索策略决策
follow_up:
- Agentic RAG什么时候比Naive好？——多跳问答/复杂分析
- 会不会太慢？——会，简单问题用Naive，复杂才用Agentic
- 怎么实现？——ReAct框架+retrieve工具
memory_points:
- 核心区别：Naive RAG是固定单次检索，Agentic RAG是Agent动态按需多次检索。
- Agent四能力：决定是否查、改写拆解问、评估检索结果、多源路由（KG/SQL/Web）。
- 特性对比：Agent具备自我纠错和多跳推理能力，但相比传统RAG速度慢且成本高。
- 实现范式：ReAct模式加工具调用，思考-行动-观察多轮循环。
---

# 什么是 Agentic RAG？和传统 RAG 的区别？

## 一、Naive RAG vs Agentic RAG

```
Naive RAG（传统/固定流程）：
  用户问题 → 向量化 → 检索top-k → 塞入Prompt → LLM生成
  特点：固定流程，一次性检索，无决策
  
  局限：
  - 复杂问题一次检索找不到
  - 不能根据中间结果调整检索
  - 无法多跳推理

Agentic RAG（智能/动态）：
  用户问题 → Agent思考
    → 需要查吗？查什么？
    → 检索 → 观察结果
    → 够吗？不够换关键词再查
    → 够了 → 综合生成答案
  
  特点：动态决策，多次检索，自我纠错
```

## 二、核心区别对比

| 维度 | Naive RAG | Agentic RAG |
|------|-----------|-------------|
| **检索策略** | 固定（一次top-k） | 动态（按需多次） |
| **查询构造** | 原始问题 | Agent改写/分解 |
| **决策能力** | 无 | 自主决策 |
| **自我纠错** | 无 | 检索不足时重查 |
| **多跳推理** | 不支持 | 支持 |
| **速度** | 快 | 慢（多轮） |
| **成本** | 低 | 高（多轮Token） |
| **适用** | 简单QA | 复杂分析 |

## 三、Agentic RAG 的核心能力

```
┌──────────────────────────────────────────────────┐
│            Agentic RAG 的智能能力                    │
├──────────────────────────────────────────────────┤
│                                                    │
│  1. 检索决策（要不要查）                             │
│     简单问题（LLM已知）→ 不检索，直接答              │
│     需要外部信息 → 触发检索                          │
│                                                    │
│  2. 查询优化（怎么查）                               │
│     改写查询 / 分解子问题 / 多角度查询               │
│                                                    │
│  3. 结果评估（查到的好不好）                         │
│     相关 → 使用                                     │
│     不相关 → 换关键词重查                            │
│     不够 → 补充检索                                  │
│                                                    │
│  4. 多源路由（查哪里）                               │
│     向量库 / 知识图谱 / SQL / Web搜索               │
│     Agent根据问题类型选择最佳数据源                  │
│                                                    │
│  5. 迭代深化（查几次）                               │
│     基于已有信息，继续深挖                           │
│                                                    │
└──────────────────────────────────────────────────┘
```

## 四、实现：ReAct + 检索工具

```python
class AgenticRAG:
    def __init__(self, llm, vector_db, knowledge_graph, sql_db):
        self.llm = llm
        # 多种检索源作为工具
        self.tools = {
            "vector_search": lambda q: vector_db.search(q),
            "graph_search": lambda q: knowledge_graph.query(q),
            "sql_query": lambda q: sql_db.execute(q),
            "web_search": lambda q: web_search(q),
        }
    
    def answer(self, question):
        trajectory = []
        
        for step in range(MAX_STEPS):
            # Agent思考：下一步该做什么
            thought = self.llm.reason(
                f"问题: {question}\n已有信息: {trajectory}\n"
                f"决定：直接回答 / 用什么工具查什么"
            )
            
            if thought.action == "answer":
                return self.llm.generate(question, trajectory)
            
            # 执行检索（Agent选的工具和查询）
            tool = self.tools[thought.tool_name]
            result = tool(thought.query)
            
            # Agent评估结果
            evaluation = self.llm.evaluate(
                f"检索结果: {result}\n对回答问题有帮助吗？够了吗？"
            )
            
            trajectory.append({
                "thought": thought,
                "tool": thought.tool_name,
                "query": thought.query,
                "result": result,
                "useful": evaluation.useful
            })
            
            if evaluation.sufficient:
                return self.llm.generate(question, trajectory)
```

## 五、多跳问答示例

```
问题: "获得2024年图灵奖的学者的主要研究方向是什么？"

Naive RAG（一次检索，失败）：
  检索"2024图灵奖研究方向" → 可能找不到完整答案

Agentic RAG（多跳，成功）：
  Step 1: 检索"2024年图灵奖获得者"
          → 结果: Andrew Barto和Richard Sutton（强化学习）
  
  Step 2: Agent推理"需要查他们的研究方向"
          检索"Richard Sutton 研究方向"  
          → 结果: 强化学习，著有《强化学习导论》
  
  Step 3: Agent判断"信息够了"
          生成: "2024图灵奖得主Sutton和Barto，主要研究方向是强化学习..."
```

## 六、何时用 Agentic RAG

```
适合 Agentic RAG：
  ✓ 多跳问答（需多次检索串联）
  ✓ 复杂分析（需多方信息综合）
  ✓ 需要最新信息（Web搜索+知识库）
  ✓ 需要自我纠错（检索质量不确定）

适合 Naive RAG：
  ✓ 简单事实问答（一次检索够）
  ✓ 实时性要求高（Agentic太慢）
  ✓ 成本敏感（Agentic Token多）
  ✓ 数据简单（单一知识库）

实践建议：
  - 默认用Naive RAG（快/省）
  - 只在Naive效果差时升级Agentic
  - 或混合：简单走Naive，复杂走Agentic（路由）
```

## 七、Agentic RAG 的演进

```
Naive RAG 
  → Advanced RAG (加优化：改写/重排/混合)
  → Modular RAG (模块化，可插拔组件)
  → Agentic RAG (Agent自主决策)
  → Self-RAG (训练模型自带检索门控)
  → GraphRAG (知识图谱增强)
```

## 八、面试加分点

1. **核心是"动态决策"**：Agentic RAG 不是固定流程，而是 Agent 根据需要动态检索
2. **多跳问答最能体现价值**：这是 Naive RAG 做不到的，用例子说明
3. **承认成本**：Agentic 更慢更贵，简单任务不该用——体现实用主义

## 记忆要点

- 核心区别：Naive RAG是固定单次检索，Agentic RAG是Agent动态按需多次检索。
- Agent四能力：决定是否查、改写拆解问、评估检索结果、多源路由（KG/SQL/Web）。
- 特性对比：Agent具备自我纠错和多跳推理能力，但相比传统RAG速度慢且成本高。
- 实现范式：ReAct模式加工具调用，思考-行动-观察多轮循环。


## 苏格拉底式面试追问

> 这组追问模拟面试官层层逼问，每一问先回答"为什么"，再回答"怎么做"，最后回答"如何证明"。

### 第一层：目标与动机

**Q：Agentic RAG 让 LLM 自主决策检索策略（何时查/查什么/查几次），而 Naive RAG 是固定流程（每次都检索一次），为什么要让 LLM 自主决策？**

因为固定流程不适配所有 query。1）query 差异——简单 query（如"X 产品价格"）检索一次就够，复杂 query（如"对比 X 和 Y 产品的优缺点"）要多次检索（分别查 X、Y、对比维度），固定流程（一次检索）对复杂 query 召回不全；2）检索需求判断——有些 query 不需检索（如"你好"闲聊/常识问题），固定流程强制检索浪费（检索无意义文档）；3）动态调整——首次检索结果不全时（LLM 发现信息不够），Agentic RAG 能再检索（用改写 query 补充），Naive RAG 一次定死无法调整；4）策略选择——不同 query 适合不同检索策略（如关系型问题用 GraphRAG、事实型用向量），Agentic RAG 让 LLM 选策略，Naive RAG 固定一种。所以 Agentic RAG 的价值是"按 query 动态决策检索"，适配复杂/多样 query，提升整体效果。

### 第二层：证据与定位

**Q：Agentic RAG 效果不稳定（有时好有时差），怎么定位是 LLM 决策错（该查没查/查错）还是检索本身问题？**

trace LLM 的检索决策。1）决策日志——记录 LLM 每次决策（是否检索/检索什么 query/用哪个策略），对比"应该怎么决策"（人工标注），不一致是 LLM 决策错；2）检索结果——如果 LLM 决策对（该查的查了、query 对），但检索结果差（没召回相关），是检索问题（embedding/分块）；3）决策时机——LLM 是否该继续检索时停了（信息不够但 LLM 觉得够了），或该停时还在查（冗余检索），时机错是决策问题；4）策略选择——LLM 选的策略是否适合 query（如关系型问题选了向量检索而非 GraphRAG），选错是决策问题。定位方法：trace 决策链（决策→检索→结果→再决策），找第一个"决策错或检索差"的环节。常见根因：LLM 决策 prompt 不清晰（不知何时查）、检索召回差（决策对但检索差）、LLM 判断"信息够不够"不准（过早停或过晚停）。

### 第三层：根因深挖

**Q：Agentic RAG 让 LLM 决策"何时停止检索"，但 LLM 可能过早停（信息不够就开始答）或过晚停（冗余检索），怎么控制停止时机？**

显式停止条件 + 信息充足判断。1）停止条件——定义明确的停止信号（如"已检索 N 次（上限）/连续 2 次检索无新相关信息/LLM 判断信息已足够回答"），任一满足则停，避免无限检索；2）信息充足判断——让 LLM 显式评估"当前信息是否足以回答"（如"基于已检索结果，能否完整回答 query？能则答，不能则说明缺什么"），缺则继续检索（针对缺失）；3）检索预算——设最大检索次数（如 5 次），超过强制停（防过晚停/死循环），即使信息不够也开始答（尽力而为+标注不确定）；4）奖励信号（RL）——训练 LLM 的停止决策（如 RL 优化"信息够时及时停/不够时继续查"），但需训练成本。实务：默认"信息充足判断 + 检索预算"（LLM 判断+硬上限），保证不无限检索也不过早停。

**Q：Agentic RAG 要 LLM 决策"用什么检索策略"（向量/BM25/GraphRAG），但 LLM 不懂这些策略的适用场景，怎么让它选对？**

策略描述 + 路由 prompt。1）策略描述——给 LLM 提供每个策略的"适用场景"描述（如"向量检索：语义匹配，适合开放问答""BM25：精确匹配，适合含专有名词的查询""GraphRAG：多跳关系推理，适合实体关系问题"），让 LLM 理解；2）路由 prompt——让 LLM 基于query 特征选策略（如"这个 query 是关系型吗？是→GraphRAG；含型号吗？是→加 BM25；否则向量"），prompt 引导决策；3）默认+覆盖——默认向量检索（覆盖多数），LLM 判断特殊 query（关系型/精确型）覆盖用专门策略，降低决策复杂度；4）学习路由——用分类器（基于 query 特征）或 LLM 路由，从历史数据学"哪类 query 适合哪个策略"，辅助 LLM 决策。原则：给 LLM 清晰的策略描述，默认简单策略，特殊 query 才让 LLM 选复杂策略，降低决策难度。

### 第四层：方案权衡

**Q：Agentic RAG 效果好但成本高（多次检索+LLM 决策调用），Naive RAG 便宜但效果差，怎么平衡？**

按 query 复杂度动态选。1）简单 query 用 Naive RAG——明确/单一意图的 query（如"X 价格"）一次向量检索够（成本低），不浪费 LLM 决策；2）复杂 query 用 Agentic RAG——模糊/多意图/需推理的 query（如"对比分析"）用 Agentic（多次检索+决策，效果好），接受高成本；3）query 分类——用轻量分类器（或 LLM 快速判断）把 query 分"简单/复杂"，简单走 Naive（省），复杂走 Agentic（准），按需分配成本；4）渐进——先 Naive 检索，如果结果不足（LLM 判断信息不够）再升级到 Agentic（多轮），简单 query 不升级（省），复杂的才深入（准）。实务：默认 Naive（覆盖简单 query），检测到复杂 query（分类器/LLM 判断）才用 Agentic，平衡成本和效果。

**Q：Agentic RAG 让 LLM 自主决策，但自主性带来不确定性（同样 query 不同次可能不同路径），怎么保证一致性？**

控制随机性 + 缓存。1）温度调低——LLM 决策时 temperature=0（确定性，同 query 同决策路径），降低随机性（牺牲一点多样性换一致性）；2）决策缓存——同 query 的 LLM 决策缓存（如"这个 query 该检索几次/什么策略"），重复 query 直接复用决策（跳过 LLM 决策调用），一致且快；3）流程约束——给 LLM 决策设边界（如"最多检索 3 次""只能在向量/BM25 选"），限制决策空间，减少不确定性；4）评估稳定性——跑同 query 多次，看输出一致性（相同/相似比例），低则加约束（温度/边界）。原则：关键场景（生产）要一致性（低温+缓存+约束），探索场景（研究）可宽松（允许多样性探索）。

### 第五层：验证与沉淀

**Q：你怎么证明 Agentic RAG 比 Naive RAG 效果好（值不值高成本）？**

AB 对比。固定评估集（含简单和复杂 query），对比：1）答案准确率——Agentic 应高于 Naive（特别在复杂 query 上，Agentic 多次检索更全）；2）分 query 类型——简单 query 两者可能持平（Naive 够），复杂 query Agentic 应显著好（多轮检索优势）；3）成本——Agentic 的检索次数/LLM 调用次数（成本），应可接受（如果成本翻倍但准确率只升 2%，不值）；4）延迟——Agentic 多轮检索/决策的延迟（可能几秒），用户是否可接受。最优：整体准确率升（复杂 query 显著） + 成本可接受 + 延迟可接受 = 值得。如果简单 query 居多且 Naive 够，Agentic 收益小（不值）；如果复杂 query 多且 Naive 召回差，Agentic 值。

**Q：Agentic RAG 怎么沉淀成团队的智能检索能力？**

建 Agentic RAG 框架：1）决策组件——LLM 决策"何时查/查什么/用什么策略/何时停"的标准化组件，可配置（决策 prompt/停止条件/策略库）；2）多策略集成——内置向量/BM25/GraphRAG 等策略，LLM 按需选；3）query 路由——简单/复杂 query 分类，自动选 Naive 或 Agentic（成本控制）；4）评估闭环——Agentic 决策质量评估（决策准确率/检索效率/端到端准确率），持续优化决策 prompt；5）可观测——决策链 trace（每次决策/检索/结果），便于调试和归因。这套写入团队 RAG 平台 SOP，让"Agentic RAG"从"高级特性"变成"可配置的标准能力"，开发者开箱即用。

## 结构化回答

**30 秒电梯演讲：** Agentic RAG=把检索变成Agent的工具，动态决策检索策略。区别于Naive RAG的固定流程，Agentic RAG让LLM自主决定何时查、查什么、查几次。

**展开框架：**
1. **Agent** — Agentic RAG是检索作为Agent工具，动态决策
2. **Naive** — Naive RAG是固定流程，一次性检索
3. **区别** — 智能程度（动态vs固定）

**收尾：** 您想深入聊：Agentic RAG什么时候比Naive好？——多跳问答/复杂分析？


## 视频脚本

> 预计时长：5 分钟 | 由浅入深


| 时间 | 画面/字幕 | 口播台词 | 讲解要点 |
|------|----------|----------|----------|
| 0:00 | 标题卡：什么是 Agentic RAG？和传统 RAG… | "Naive RAG像自动售货机(投币出货固定流程)，Agentic RAG像导购(听需求→…" | 开场钩子 |
| 0:20 | 核心概念图 | "Agentic RAG=把检索变成Agent的工具，动态决策检索策略。区别于Naive RAG的固定流程，Agentic…" | 核心定义 |
| 0:50 | Agent示意图 | "Agent——Agentic RAG是检索作为Agent工具，动态决策" | 要点拆解1 |
| 1:30 | Naive示意图 | "Naive——Naive RAG是固定流程，一次性检索" | 要点拆解2 |
| 2:20 | 对比/实战案例图 | "对比一下常见误区和工程实践，看真实场景里怎么取舍。" | 实战与对比 |
| 3:10 | 总结卡 | "记住核心要点。下期我们追问：Agentic RAG什么时候比Naive好？——多跳问答/？" | 收尾与钩子 |
