---
id: note-ali-tt-ai-002
difficulty: L4
category: ai
subcategory: Multi-Agent
tags:
- 阿里巴巴
- 淘天
- AI应用开发
- Multi-Agent
- 上下文管理
- Agent通信
- 面经
feynman:
  essence: Multi-Agent系统的核心是"分工协作"——把复杂任务拆分给多个Agent，关键挑战是上下文如何共享。两种基础范式：层级式（父-子Agent，子任务独立）和协作式（Agent Team，子任务有依赖）。上下文共享通过直接通信（消息传递）和间接通信（共享状态/文件）实现。子Agent通常不会获得父Agent的全部Context，而是只接收必要的任务描述和结果。
  analogy: "层级式就像公司部门——CEO(父Agent)把任务分给各部门经理(子Agent)，各部门独立干活，互不通信，最后汇报。协作式就像项目组——产品经理和开发坐在一起(通信)，互相讨论(共享上下文)，因为任务有依赖。子Agent不会拿到CEO的全部信息(战略规划)，只会拿到与任务相关的部分(具体需求文档)。"
  key_points:
  - 层级式(Hierarchical)：父Agent拆解任务→调度子Agent→子Agent执行→结果汇报
  - 协作式(Collaborative)：Planner-Executor模型，多个Agent之间相互通信协作
  - 关键区别：子Agent之间是否有直接通信
  - 上下文共享方式：直接通信(RPC/WebSocket/MCP工具) + 间接通信(文件/数据库/共享状态)
  - 子Agent通常不使用父Agent全部Context，只接收任务相关的精简上下文
  - Claude Code的Multi-Agent方案：文件系统作为消息队列(inbox目录)
first_principle:
  essence: Multi-Agent的本质是"关注点分离"——每个Agent有独立的上下文窗口和职责，通过受控的信息交换实现协作
  derivation: "单Agent问题：任务复杂→上下文爆炸→推理质量下降。Multi-Agent解决：任务拆分→每个Agent上下文独立且聚焦→推理质量提高。但拆分带来新问题：信息如何传递？→通信机制。传递多少？→上下文边界设计。"
  conclusion: 子Agent不应该使用父Agent的全部Context。原因：(1)上下文窗口有限，全量传递会再次爆炸；(2)信息过载降低推理质量；(3)安全边界——子Agent不应获得超出其职责的信息。
follow_up:
- 层级式和协作式如何选择？各自的优缺点是什么？
- Agent-to-Agent通信协议有哪些标准？(如MCP, A2A Protocol)
- 如何保证Multi-Agent系统中消息的顺序性和一致性？
- 子Agent执行失败时，父Agent如何进行错误恢复和重试？
- 多Agent系统如何做负载均衡和资源调度？
memory_points:
- 层级式(SubAgents)：子Agent之间无通信，适合子任务相互独立；协作式(Agent Team)：子Agent之间可通信，适合子任务彼此依赖
- 上下文共享两大方式：直接通信(RPC/WebSocket/暴露为Tool) + 间接通信(共享文件/数据库/共享状态)
- 子Agent不用父Agent全部Context：只传任务描述+必要上下文+结果约束
- Claude Code Multi-Agent方案：文件系统消息队列(~/.claude/teams/inboxes/)，Agent给谁发消息就往对方inbox JSON追加记录，Agent执行时收不到消息必须等turn结束
---

# 【阿里淘天AI二面】Multi-Agent是如何共享上下文的？子Agent会使用父Agent的所有Context吗？

> 来源：阿里巴巴淘天淘工厂 AI应用开发 二面面经（小红书）

## 一、Multi-Agent 两种基础范式

```
                    Multi-Agent 架构
                         │
            ┌────────────┴────────────┐
            ▼                         ▼
    ┌───────────────┐        ┌───────────────┐
    │  层级式        │        │  协作式        │
    │ (Hierarchical)│        │(Collaborative)│
    │ SubAgents     │        │ Agent Team    │
    └───────┬───────┘        └───────┬───────┘
            │                        │
  子Agent之间：无通信        子Agent之间：有通信
  适合：子任务相互独立        适合：子任务彼此依赖
```

### 1. 层级式（Hierarchical / SubAgents）

```
        ┌─────────────┐
        │  父Agent     │  任务拆解 + 调度
        │ (Orchestrator│
        └──────┬──────┘
               │ 分配子任务
    ┌──────────┼──────────┐
    ▼          ▼          ▼
┌───────┐ ┌───────┐ ┌───────┐
│子Agent│ │子Agent│ │子Agent│  各自独立执行
│   A   │ │   B   │ │   C   │  互相不通信
└───┬───┘ └───┬───┘ └───┬───┘
    │         │         │
    └─────────┼─────────┘
              ▼
        ┌───────────┐
        │  父Agent   │  结果汇总
        └───────────┘

特点：子Agent A 不知道子Agent B 的存在
      每个 子Agent 只与父Agent通信
```

### 2. 协作式（Collaborative / Agent Team）

```
    ┌─────────────┐
    │   Planner   │  全局规划
    │   Agent     │
    └──────┬──────┘
           │ 分发计划
    ┌──────┼──────────┐
    ▼      ▼          ▼
┌───────┐    ║     ┌───────┐
│Executor│←──╫──→│Executor│  执行者之间
│   1   │    ║     │   2   │  可以直接通信
└───┬───┘    ║     └───┬───┘
    │        ║         │
    └────────╫─────────┘
             ║
         结果写回
         共享状态

特点：Executor 1 和 Executor 2 之间可以直接交换信息
      适合子任务之间有数据依赖的场景
```

### 两种范式的关键区别

| 维度 | 层级式 (SubAgents) | 协作式 (Agent Team) |
|------|-------------------|-------------------|
| **子Agent间通信** | 无 | 有 |
| **调度方式** | 父Agent集中调度 | 分布式协作 |
| **适合场景** | 子任务相互独立 | 子任务彼此依赖 |
| **复杂度** | 低，易于实现 | 高，需要协调机制 |
| **典型框架** | AutoGen, CrewAI | LangGraph, AutoGen |

## 二、上下文共享的两种方式

### 方式一：直接通信

```
Agent A ────消息──────────→ Agent B
        ←───回复──────────

实现方式：
  1. RPC/HTTP：Agent暴露REST/gRPC接口
  2. WebSocket：实时双向通信
  3. 暴露为Tool：Agent将自身能力包装成MCP工具，其他Agent通过工具调用
  4. Agent-to-Agent Protocol：标准化的A2A通信协议

代码示例（Tool方式）：
  // Agent B 暴露的能力
  @tool
  def search_product(query: str) -> str:
      """搜索商品信息"""
      return product_db.search(query)

  // Agent A 可以调用Agent B的工具
  agent_a.invoke({
      "tools": [search_product],  // Agent B的能力
      "task": "帮用户找到合适的手机"
  })
```

### 方式二：间接通信

```
Agent A ──写入──→ ┌──────────────┐ ──监听──→ Agent B
                   │  共享状态     │
                   │ (文件/数据库) │
                   └──────────────┘

实现方式：
  1. 文件系统：Agent读写共享文件（如Claude Code的inbox方案）
  2. 数据库：Agent写入数据库表，其他Agent查询
  3. 消息队列：通过Kafka/Redis Pub-Sub中转
  4. 共享内存：共享变量/状态存储（如Redis Hash）
```

## 三、Claude Code 的 Multi-Agent 实现

Claude Code 使用**文件系统作为消息队列**，这是一个非常优雅的间接通信方案：

```
~/.claude/teams/
├── config.json              # 成员列表（所有Agent的信息）
└── inboxes/                 # 每个Agent一个inbox文件
    ├── agent-alpha.json     # Agent Alpha的收件箱
    ├── agent-beta.json      # Agent Beta的收件箱
    └── agent-gamma.json     # Agent Gamma的收件箱

消息格式（inbox JSON中的每条记录）：
{
  "from": "agent-alpha",
  "text": "我已经完成了数据分析，结果在 /tmp/result.json",
  "timestamp": "2024-01-15T10:30:00Z",
  "read": false
}

工作流程：
  1. Agent要给谁发消息 → 往对方的inbox JSON追加一条记录
  2. Agent执行任务时 → 不检查inbox（专注当前任务）
  3. Agent当前turn（推理+工具调用+返回）完成后 → 检查inbox
  4. 发现新消息 → 处理消息 → 发送回复
```

## 四、子Agent会使用父Agent的全部Context吗？

**答案：不会。** 子Agent只接收与其任务相关的精简上下文。

### 为什么不全量传递？

```
❌ 原因1：上下文窗口有限
   父Agent上下文：50K tokens（包含完整对话历史）
   子Agent任务：只需要2K tokens的上下文
   → 全量传递 = 浪费48K tokens + 可能超限

❌ 原因2：信息过载降低推理质量
   父Agent上下文可能包含大量与子任务无关的信息
   → 无关信息干扰子Agent的推理（注意力分散）

❌ 原因3：安全边界
   父Agent可能拥有敏感信息（API keys, 用户隐私数据）
   → 子Agent不应获得超出其职责的信息

✅ 正确做法：最小必要上下文原则
   子Agent只获得：
   - 任务描述（要做什么）
   - 必要的上下文（做这件事需要知道什么）
   - 结果约束（输出格式/限制）
```

### 上下文传递模型

```
父Agent上下文（完整）：
┌────────────────────────────────────────────┐
│ 用户完整对话历史                              │
│ 之前所有工具调用的结果                         │
│ 中间推理过程                                  │
│ 系统提示和约束                                │
│ ────────────────────────────────             │
│  提取任务相关部分 ↓                           │
│  ┌──────────────────────────┐               │
│  │ 任务描述："查询用户123的订单"│               │
│  │ 约束："返回JSON格式"       │               │
│  │ 必要数据：用户ID=123       │               │
│  └──────────────────────────┘               │
│        │                                    │
│        ▼ 只传递这部分                         │
└────────┼────────────────────────────────────┘
         │
         ▼
子Agent上下文（精简）：
┌──────────────────────────┐
│ 任务描述："查询用户123的订单"│
│ 约束："返回JSON格式"       │
│ 必要数据：用户ID=123       │
│ Agent系统提示              │
│ 可用工具列表               │
└──────────┬───────────────┘
           │
           ▼ 执行完成后
┌──────────────────────────┐
│ 结果：{"orders": [...]}   │ ← 只返回结果给父Agent
└──────────────────────────┘
```

## 五、面试加分点

1. **提到A2A Protocol标准**：Google提出的Agent-to-Agent通信标准，类似MCP但面向Agent间通信
2. **提到上下文压缩技术**：父Agent在传递上下文给子Agent前，可以做summarization/context window compression
3. **提到错误传播问题**：层级式中，一个子Agent的错误会影响父Agent的决策，需要重试机制
4. **提到成本控制**：每个子Agent都是一次LLM调用，Multi-Agent会显著增加token消耗
5. **提到Claude Code的真实实现细节**：文件系统inbox方案是一个低成本、高可靠的工程实现，适合展示对工业界Agent系统的深入理解
