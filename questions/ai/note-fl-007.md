---
id: note-fl-007
difficulty: L4
category: ai
subcategory: Agent
tags:
- 字节
- 飞连
- 面经
- LangGraph
- Agent框架
feynman:
  essence: LangChain 是早期"链式调用"抽象（封装 prompt/LLM/output_parser），LangGraph 是后来出的有状态图框架，把工作流显式建模成状态机。State 解决"上下文怎么传"，Node 解决"每一步做什么"，Edge 解决"下一步去哪"（conditional edge 让流程按状态走分支）。选 LangGraph 是因为它最贴近"显式有限状态机"心智模型，调试/回放/断点都比 AutoGen"Agent 互聊"好治理。
  analogy: LangChain 像流水线传送带（A→B→C 线性），LangGraph 像地铁线路图（有分叉、有环线、有换乘站）。前者简单场景快，后者复杂场景才理得清。AutoGen 像开会议——几个人各说各的，会议记录又长又乱。
  first_principle: 复杂 Agent 逻辑本质是状态机。把状态（State）、动作（Node）、转移（Edge）显式化，才能调试、回放、断点、并行、人工介入。隐式的"Agent 互聊"无法做到这些工程能力。
  key_points:
  - LangChain 链式（LCEL）适合线性流；LangGraph 图式支持循环/分支/并行/人工介入
  - State：TypedDict 定义共享上下文，每个 Node 读+改它
  - Node：纯函数（input=State, output=State partial）
  - Edge：静态(A→B)/Conditional(函数返回下一节点名)/END
  - 选 LangGraph：显式状态+路由+复用通用能力，比 AutoGen/CrewAI/手写更可控
first_principle:
  essence: Agent = 显式状态机
  derivation: 复杂逻辑本质是状态机 → 状态/动作/转移必须显式 → 才能调试回放断点并行 → LangGraph 把这三者抽象成 State/Node/Edge → 隐式互聊（AutoGen）无法工程化
  conclusion: 选框架不是选"哪个流行"，而是选"哪个抽象匹配你的复杂度"——简单用 LangChain，复杂用 LangGraph，互聊用 AutoGen
follow_up:
- LangGraph 的 interrupt() 怎么实现 human-in-the-loop？
- LangGraph 的 CheckpointSaver 接口怎么接 Redis/Postgres？
- 框架能力不满足时怎么扩展？
memory_points:
- 选LangGraph因其为图抽象(状态机)，支持循环/分支/并行，LangChain只适合简单线性流
- 核心三要素：State(共享上下文)、Node(执行动作)、Conditional Edge(条件路由分支)
- 对比优势：AutoGen难调试，手写缺通用基建。LangGraph自带持久化与流处理
- 加分项：interrupt机制结合Checkpoint，原生支持human-in-the-loop人工介入审批
---

# 【字节飞连面经】用过哪些 Agent 框架？LangGraph vs LangChain？为什么选 LangGraph？

## 一、LangChain vs LangGraph

| 框架 | 抽象 | 适合 |
|------|------|------|
| **LangChain** | 链式（LCEL），prompt → llm → parser 线性流 | 简单线性流程 |
| **LangGraph** | 图式，节点+边+状态，支持循环/分支/并行/人工介入 | 复杂状态机 |

LangChain 官方现在的推荐：**复杂逻辑用 LangGraph，LangChain 只做底层组件**。

## 二、State / Node / Edge 各解决什么

```
State（状态）：整个图的共享上下文
  TypedDict 定义字段：messages, plan, step_count, tool_history
  每个 Node 读 + 改它

Node（节点）：每一步做什么
  纯函数（input=State, output=State partial）
  可以是 LLM 调用、工具调用、纯 Python 逻辑

Edge（边）：下一步去哪
  - 静态 Edge：A → B
  - Conditional Edge：函数返回下一节点名（实现分支与循环）
  - END：终止
```

**Conditional Edge 是精华**——让流程可以根据状态走不同分支，这是状态机的核心。

## 三、为什么选 LangGraph 而不是 AutoGen / CrewAI / 手写

| 框架 | 范式 | 优 | 劣 |
|------|------|----|----|
| **AutoGen** | 多 Agent 对话 | 适合"Agent 互聊" | 调试很痛苦（对话历史长且非结构化） |
| **CrewAI** | 角色化（Crew/Agent/Task） | 上手快 | 定制弱 |
| **手写状态机** | 自己写 | 完全可控 | 要重写一堆通用能力（persistence/stream/interrupt） |
| **LangGraph** | 显式状态+路由 | 调试/回放/断点好治理 | 学习曲线略陡 |

**LangGraph 是"显式状态 + 显式路由 + 复用通用能力"的折中**。

## 四、框架能力不满足怎么扩展

```
[1] Node 是普通函数
    │  想怎么写怎么写，任意 Python 逻辑
    ▼
[2] 自定义 Checkpoint（state 持久化）
    │  实现 BaseCheckpointSaver 接口
    │  接 Redis / Postgres
    ▼
[3] 自定义 Stream
    │  自己 yield，前端用 SSE 接
    ▼
[4] 真不行就只用 State 和 Edge 抽象
       Node 内部全部自写
```

## 五、加分点

能讲清 LangGraph 的 `interrupt()` 怎么实现 **human-in-the-loop**：

```
1. Agent 跑到关键决策节点 → 调 interrupt() 暂停
2. State 持久化到 Checkpoint（Redis/Postgres）
3. 等用户输入（飞书卡片 / Web UI）
4. 用户确认 → 从 Checkpoint resume，带用户输入继续跑
```

这套机制让"危险操作前必须人确认"成为框架级能力，不用自己实现。

## 六、雷区

- ❌ "多 Agent 全交给 AutoGen 自己跑" → 立刻被追问"那超时和死循环你怎么治"
- ❌ "我们手写状态机更灵活" → 被追问"那 persistence/stream/interrupt 你都自己实现了吗"

## 七、扩展

- **2026 H2 生态变化**：OpenAI Agents SDK、Anthropic Computer Use SDK、字节自研 Agent Studio 都在抢这个生态位，但抽象本质（State/Node/Edge）不会变
- **LangGraph 的 Subgraph**：把复杂图拆成子图复用，类似函数调用
- **并行 Node**：LangGraph 支持 fan-out/fan-in，多个 Node 并行执行后聚合结果

## 记忆要点

- 选LangGraph因其为图抽象(状态机)，支持循环/分支/并行，LangChain只适合简单线性流
- 核心三要素：State(共享上下文)、Node(执行动作)、Conditional Edge(条件路由分支)
- 对比优势：AutoGen难调试，手写缺通用基建。LangGraph自带持久化与流处理
- 加分项：interrupt机制结合Checkpoint，原生支持human-in-the-loop人工介入审批

