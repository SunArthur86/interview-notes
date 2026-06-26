---
id: note-bz-agent-061
difficulty: L3
category: ai
subcategory: Agent
tags:
  - B站面经
  - LangChain
  - 生产级架构
  - LCEL
feynman:
  essence: LangChain 1.2生产级架构=LCEL(声明式编排)+LangGraph(复杂工作流)+LangSmith(监控)+组件模块化。从"脚手架"升级为"可观测的生产系统"。
  analogy: 从毛坯房(LangChain早期)到精装房(1.2)——加了监控系统(LangSmith)、复杂管线(LangGraph)、标准化接口(LCEL)。
  first_principle: 生产级需要可观测/可编排复杂流程/组件解耦。LangChain 1.2用LCEL+LangGraph+LangSmith解决这些。
  key_points:
    - LCEL：声明式链编排（替代旧Chain）
    - LangGraph：图结构复杂工作流
    - LangSmith：全链路监控调试
    - 模块化：组件独立，可组合
first_principle:
  essence: 生产级LLM应用需要"可控"+"可观测"+"可扩展"。
  derivation: '早期LangChain的Chain是黑盒，难调试难扩展。1.2用LCEL声明式编排(透明可调试)+LangGraph(支持复杂流程如循环/分支)+LangSmith(全链路Trace)，补齐生产能力。'
  conclusion: LangChain 1.2 = LCEL(编排) + LangGraph(复杂流) + LangSmith(可观测) 的生产级组合
follow_up:
  - LCEL和旧Chain什么区别？——LCEL声明式+流式+异步，更现代
  - 什么时候用LangGraph？——需要循环/分支/人工节点的复杂Agent
  - LangSmith必须用吗？——生产强烈推荐，调试利器
---

# LangChain 1.2 生产级架构是什么样？

## 一、LangChain 1.2 的架构升级

```
早期LangChain（脚手架）：
  Chains（顺序编排）→ 简单但黑盒
  问题：难调试/难扩展/不支持复杂流程

LangChain 1.2（生产级）：
  ┌─────────────────────────────────────┐
  │  LCEL (LangChain Expression Language)│ ← 声明式编排
  │  prompt | model | parser            │   透明/流式/异步
  ├─────────────────────────────────────┤
  │  LangGraph                          │ ← 复杂工作流
  │  图结构：循环/分支/人工节点/检查点   │   生产级Agent
  ├─────────────────────────────────────┤
  │  LangSmith                          │ ← 可观测
  │  Trace/Eval/Monitor/Debug           │   全链路追踪
  ├─────────────────────────────────────┤
  │  LangServe                          │ ← 部署
  │  一键API部署                        │
  └─────────────────────────────────────┘
```

## 二、LCEL（声明式编排）

```python
from langchain_core.prompts import ChatPromptTemplate
from langchain_core.output_parsers import StrOutputParser

# LCEL用管道符|声明式编排
prompt = ChatPromptTemplate.from_template("回答: {question}")
chain = prompt | model | StrOutputParser()

# 等价于旧的LLMChain，但更简洁透明
result = chain.invoke({"question": "什么是Agent"})

# LCEL优势：
# 1. 流式输出（stream）
for chunk in chain.stream({"question": "..."}):
    print(chunk, end="")

# 2. 异步支持
result = await chain.ainvoke({"question": "..."})

# 3. 批处理
results = chain.batch([{"question": "Q1"}, {"question": "Q2"}])

# 4. 透明可调试（每步可见）
# 旧Chain是黑盒，LCEL每步可inspect
```

## 三、LangGraph（复杂工作流）

```python
from langgraph.graph import StateGraph, END

# LangGraph用图结构定义复杂Agent
class State(TypedDict):
    messages: list
    needs_human: bool

# 定义节点
def understand(state):
    return {"messages": [llm.understand(state["messages"])]}

def execute(state):
    result = tool.execute(state)
    if result.risky:
        state["needs_human"] = True
    return state

def human_review(state):
    # 人工审核节点（支持中断/恢复）
    approval = wait_for_human()
    return {"approved": approval}

# 构建图
graph = StateGraph(State)
graph.add_node("understand", understand)
graph.add_node("execute", execute)
graph.add_node("human", human_review)

# 定义边（含条件分支）
graph.add_edge("understand", "execute")
graph.add_conditional_edges(
    "execute",
    lambda s: "human" if s["needs_human"] else END
)
graph.add_edge("human", END)

app = graph.compile(checkpointer=memory)  # 支持中断恢复
```

```
LangGraph的核心能力：
  ✓ 循环（ReAct的Thought-Act-Obs循环）
  ✓ 条件分支（根据结果走不同路径）
  ✓ 人工节点（Human-in-the-loop，支持中断恢复）
  ✓ 检查点（长任务可保存/恢复状态）
  ✓ 并行（独立节点并发执行）
  ✓ 状态管理（显式的State对象）
```

## 四、LangSmith（可观测）

```python
# LangSmith提供全链路追踪
import langsmith

# 自动记录每次调用的完整轨迹
@trace
def rag_pipeline(question):
    retrieved = retriever.search(question)   # 被追踪
    answer = llm.generate(question, retrieved)  # 被追踪
    return answer

# LangSmith界面可见：
# - 完整调用链（检索→生成每步）
# - 每步的输入输出/延迟/Token
# - 错误定位
# - A/B测试对比
# - 评估指标

# 生产价值：
# - 故障定位：哪一步出错了
# - 性能优化：哪一步慢
# - 成本分析：哪一步贵
# - 质量评估：Bad Case分析
```

## 五、生产级架构示例

```python
# 完整的生产级RAG Agent架构
from langgraph.graph import StateGraph
from langsmith import trace

@trace
class ProductionRAGAgent:
    def build(self):
        graph = StateGraph(State)
        
        # 节点1: 查询理解
        graph.add_node("query_processing", self.query_processor)
        
        # 节点2: 多路检索
        graph.add_node("retrieval", self.hybrid_retriever)
        
        # 节点3: 重排
        graph.add_node("rerank", self.reranker)
        
        # 节点4: 生成
        graph.add_node("generation", self.generator)
        
        # 节点5: 质量检查
        graph.add_node("quality_check", self.fact_checker)
        
        # 边：含条件分支
        graph.add_edge("query_processing", "retrieval")
        graph.add_edge("retrieval", "rerank")
        graph.add_edge("rerank", "generation")
        graph.add_conditional_edges(
            "quality_check",
            lambda s: "generation" if not s.passed else END
            # 质量不过则重新生成
        )
        
        return graph.compile(
            checkpointer=SqliteSaver(),  # 检查点
            interrupt_before=["human_review"]  # 可中断
        )
```

## 六、面试加分点

1. **三件套**：LCEL(编排)+LangGraph(复杂流)+LangSmith(监控)，这是 1.2 的核心
2. **LangGraph 是重点**：支持循环/分支/人工节点——这是生产级 Agent 的刚需
3. **强调可观测**：没有 LangSmith 级别的 Trace，生产 Agent 无法调试
