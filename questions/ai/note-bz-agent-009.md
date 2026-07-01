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

