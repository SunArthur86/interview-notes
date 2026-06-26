---
id: note-bz-agent-063
difficulty: L3
category: ai
subcategory: Agent
tags:
  - B站面经
  - LangChain
  - LangGraph
  - LangSmith
  - 对比
feynman:
  essence: LangChain家族三兄弟：LangChain(组件库/基础)、LangGraph(工作流引擎/编排复杂Agent)、LangSmith(监控平台/可观测)。三者协同覆盖开发到运维全链路。
  analogy: 像建筑公司——LangChain是建材(砖/水泥)、LangGraph是施工方案(图纸/工序)、LangSmith是质检系统(验收/监控)。
  first_principle: LLM应用全生命周期需要不同工具：开发(组件)、编排(复杂流程)、运维(监控)。LangChain家族分别覆盖。
  key_points:
    - LangChain：组件库（Models/Prompts/Tools）
    - LangGraph：工作流引擎（图结构/循环/分支）
    - LangSmith：监控平台（Trace/Eval/Monitor）
    - 三者协同：开发→编排→运维
first_principle:
  essence: 复杂LLM应用需要分层工具——组件(积木)+编排(搭法)+监控(检查)。
  derivation: '简单应用用LangChain组件拼即可。复杂Agent需要循环/分支(LangGraph)。生产需要监控(LangSmith)。三者是不同抽象层次的工具，非竞争关系。'
  conclusion: LangChain(组件) + LangGraph(编排) + LangSmith(监控) = LLM应用全生命周期
follow_up:
  - 三者是分开的项目吗？——同属LangChain生态，可独立使用
  - 只用LangChain不用其他行吗？——简单应用可以，复杂需要全套
  - LangSmith收费吗？——有免费额度，大规模收费
---

# LangChain / LangGraph / LangSmith 家族各自定位与区别？

## 一、三兄弟定位

```
┌──────────────────────────────────────────────────────┐
│            LangChain 家族三兄弟                          │
├──────────────────────────────────────────────────────┤
│                                                        │
│  LangChain（组件库）— "建材"                            │
│    定位: LLM应用的标准化组件                             │
│    提供: Models/Prompts/Tools/Memory/Retrievers       │
│    类比: 积木块                                         │
│                                                        │
│  LangGraph（编排引擎）— "施工方案"                      │
│    定位: 复杂Agent工作流的编排                           │
│    提供: 图结构/循环/分支/人工节点/检查点                │
│    类比: 把积木搭成复杂结构的图纸                        │
│                                                        │
│  LangSmith（监控平台）— "质检系统"                      │
│    定位: LLM应用的可观测和评估                           │
│    提供: Trace/Eval/Monitor/Debug/Datasets            │
│    类比: 验收/监控/质量检查                              │
│                                                        │
└──────────────────────────────────────────────────────┘
```

## 二、各自详解

### LangChain：组件库

```python
# LangChain提供"积木"
from langchain_core.prompts import ChatPromptTemplate
from langchain_openai import ChatOpenAI
from langchain_core.tools import Tool

# 这些是基础组件，可被LangGraph使用
prompt = ChatPromptTemplate.from_template("{question}")
model = ChatOpenAI()
tool = Tool(name="search", func=search_func)
```

### LangGraph：编排引擎

```python
# LangGraph用LangChain的组件搭复杂流程
from langgraph.graph import StateGraph

graph = StateGraph(State)
# 用LangChain的组件作为节点
graph.add_node("plan", lambda s: model.invoke(plan_prompt.format(**s)))
graph.add_node("execute", lambda s: tool.invoke(s["action"]))
# 定义复杂流转（循环/分支）
graph.add_conditional_edges("execute", should_continue)
```

### LangSmith：监控平台

```python
# LangSmith追踪LangChain/LangGraph的执行
import os
os.environ["LANGCHAIN_TRACING_V2"] = "true"

# 自动追踪所有调用
# LangSmith界面可见:
# - 每个节点的输入输出
# - 执行时间/Token/成本
# - 错误堆栈
# - 可回放调试
```

## 三、三者关系

```
开发流程：

  1. 用LangChain选组件
     "我需要GPT-4 + 搜索工具 + 向量检索"
     
  2. 用LangGraph编排
     "规划→检索→执行→检查→(循环)"
     
  3. 用LangSmith监控
     "追踪每次执行，评估效果，发现Bad Case"

┌──────────────────────────────────────────────┐
│              LangSmith (监控层)                 │
│         Trace / Eval / Monitor               │
├──────────────────────────────────────────────┤
│              LangGraph (编排层)                 │
│         Graph / Loop / Branch                │
├──────────────────────────────────────────────┤
│              LangChain (组件层)                 │
│    Models / Prompts / Tools / Memory         │
└──────────────────────────────────────────────┘
```

## 四、何时用哪个

```
┌──────────────────┬──────────────────────────────┐
│ 场景               │ 用什么                          │
├──────────────────┼──────────────────────────────┤
│ 简单RAG/对话       │ LangChain组件即可               │
│ 复杂Agent(循环/分支)│ + LangGraph                   │
│ 生产上线           │ + LangSmith监控                │
│ 多Agent协作        │ LangGraph(图结构天然适合)       │
│ 需要人工审核节点    │ LangGraph(interrupt机制)       │
│ 调试Bad Case       │ LangSmith(回放/对比)           │
│ 评估效果           │ LangSmith(Datasets/Eval)      │
└──────────────────┴──────────────────────────────┘
```

## 五、对比其他框架

```
┌─────────────┬──────────────────┬──────────────────────┐
│ 框架          │ 定位                │ 与LangChain家族关系     │
├─────────────┼──────────────────┼──────────────────────┤
│ LangChain    │ 组件库              │ -                     │
│ LangGraph    │ 编排引擎            │ LangChain生态          │
│ LangSmith    │ 监控                │ LangChain生态          │
│ LlamaIndex   │ RAG专精             │ 竞品(可互补)           │
│ AutoGen      │ 多Agent对话          │ 竞品                   │
│ CrewAI       │ 角色化多Agent        │ 竞品                   │
│ Dify         │ 低代码平台           │ 竞品(更上层)           │
└─────────────┴──────────────────┴──────────────────────┘
```

## 六、面试加分点

1. **三层定位**：组件(LangChain)+编排(LangGraph)+监控(LangSmith)，清晰
2. **LangGraph 是趋势**：复杂 Agent 生产部署的首选，比旧 Chain 更可控
3. **LangSmith 是必需品**：没有监控的 LLM 应用不敢上生产——这是工程常识
