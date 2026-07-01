---
id: note-bz-agent-060
difficulty: L3
category: ai
subcategory: Agent
tags:
- B站面经
- LangChain
- 框架
feynman:
  essence: LangChain是LLM应用的"脚手架"，提供文档加载/向量检索/Prompt管理/Agent编排/记忆等组件，让开发者快速搭建LLM应用而不重复造轮子。
  analogy: 像建房子的脚手架——不提供房子本身(LLM)，但提供搭房子的框架和工具，让你专注设计而非砌砖。
  first_principle: LLM应用有大量共性需求（检索/Prompt/记忆/工具），LangChain把这些抽象成可复用组件。
  key_points:
  - 定位：LLM应用开发框架（脚手架）
  - 核心组件：Models/Prompts/Chains/Agents/Memory/Retrieval
  - 优势：快速开发/组件丰富/生态好
  - 适用：RAG/Agent/聊天机器人/文档处理
first_principle:
  essence: LangChain是"胶水层"——把LLM与外部组件(检索/记忆/工具)粘合。
  derivation: LLM应用=LLM+检索+记忆+工具+编排。每个都从头写太慢。LangChain提供标准化的组件和接口，开发者组合即可。
  conclusion: LangChain = LLM应用的标准化组件库 + 编排框架
follow_up:
- LangChain有什么缺点？——抽象过度/版本变化快/性能开销
- 和LlamaIndex什么区别？——LangChain偏通用Agent，LlamaIndex偏RAG
- 生产环境能用吗？——能，但复杂场景建议LangGraph
memory_points:
- 定位：大模型应用的“脚手架”，自身不提供LLM和向量库，只做统一封装
- 核心组件六件套：Models(模型)、Prompts(模板)、Memory(记忆)、Chains(编排)、Retrievers(检索)、Agents(智能体)
- 三大典型应用场景：RAG知识库问答、带记忆的多轮对话机器人、自主调用工具的Agent
---

# LangChain 框架有哪些应用场景？

## 一、LangChain 定位

```
LangChain = LLM应用开发的"脚手架框架"

不提供：
  ✗ LLM本身（用OpenAI/Claude等）
  ✗ 向量数据库（集成Milvus/Chroma等）

提供：
  ✓ 连接LLM的统一接口
  ✓ 文档加载/分块/向量化组件
  ✓ Prompt模板和管理
  ✓ Chain（组件编排）
  ✓ Agent（智能体）
  ✓ Memory（记忆）
  ✓ Retriever（检索器）
```

## 二、核心组件

```
┌──────────────────────────────────────────────────┐
│              LangChain 核心组件                     │
├──────────────────────────────────────────────────┤
│                                                    │
│  Models: 统一的LLM接口                              │
│    ChatOpenAI / ChatAnthropic / 本地模型            │
│                                                    │
│  Prompts: Prompt模板                                │
│    PromptTemplate / FewShotPromptTemplate          │
│                                                    │
│  Chains: 组件编排                                   │
│    LLMChain / SequentialChain / RAG Chain          │
│                                                    │
│  Agents: 智能体                                     │
│    ReAct Agent / Tool Calling Agent                │
│                                                    │
│  Memory: 对话记忆                                   │
│    ConversationBufferMemory / SummaryMemory        │
│                                                    │
│  Retrievers: 检索器                                 │
│    VectorStoreRetriever / MultiQueryRetriever       │
│                                                    │
│  Document Loaders: 文档加载                         │
│    PDF/Word/Web/CSV/Notion...                      │
│                                                    │
└──────────────────────────────────────────────────┘
```

## 三、典型应用场景

### 场景 1：RAG 知识库问答

```python
from langchain.chain import RetrievalQA
from langchain.vectorstores import Chroma

# 最简RAG（10行代码）
vectorstore = Chroma.from_documents(docs, embeddings)
qa = RetrievalQA.from_chain_type(
    llm=ChatOpenAI(),
    retriever=vectorstore.as_retriever()
)
answer = qa.run("什么是Agent?")
```

### 场景 2：对话机器人

```python
from langchain.memory import ConversationBufferMemory

chat = ConversationChain(
    llm=ChatOpenAI(),
    memory=ConversationBufferMemory()
)
chat.predict(input="你好")  # 带记忆的多轮对话
```

### 场景 3：Agent（工具调用）

```python
from langchain.agents import initialize_agent, Tool

tools = [
    Tool(name="search", func=search),
    Tool(name="calculator", func=calculate),
]
agent = initialize_agent(tools, ChatOpenAI(), agent="zero-shot-react-description")
agent.run("23乘以17是多少？")  # 自主调用计算器
```

### 场景 4：文档处理

```python
# 文档加载+分块+摘要
loader = PyPDFLoader("report.pdf")
docs = loader.load()
chunks = RecursiveCharacterTextSplitter().split_documents(docs)
summary = load_summarize_chain(ChatOpenAI()).run(chunks)
```

### 场景 5：数据提取

```python
# 从非结构化文本提取结构化数据
from langchain.output_parsers import PydanticOutputParser

class Person(BaseModel):
    name: str
    age: int

parser = PydanticOutputParser(pydantic_object=Person)
# LLM输出 → 自动解析为Person对象
```

## 四、LangChain 的优势与劣势

```
优势：
  + 快速开发（组件丰富，组合即用）
  + 统一接口（换模型/换向量库改一行代码）
  + 生态好（集成几十种工具/模型/数据库）
  + 社区活跃（文档多，问题好查）

劣势：
  - 抽象过度（简单需求也要绕几层）
  - 版本变化快（API经常breaking change）
  - 性能开销（层层封装有额外开销）
  - 调试困难（报错信息不直观）
  - 生产稳定性（复杂Chain可能不稳定）
```

## 五、面试加分点

1. **定位是"脚手架"**：LangChain 不替代 LLM，是连接和编排组件的框架
2. **承认缺点**：抽象过度/版本不稳——体现批判性思维，不只吹
3. **知道何时不用**：简单需求用 LangChain 过重，复杂生产用 LangGraph 更稳

## 记忆要点

- 定位：大模型应用的“脚手架”，自身不提供LLM和向量库，只做统一封装
- 核心组件六件套：Models(模型)、Prompts(模板)、Memory(记忆)、Chains(编排)、Retrievers(检索)、Agents(智能体)
- 三大典型应用场景：RAG知识库问答、带记忆的多轮对话机器人、自主调用工具的Agent

