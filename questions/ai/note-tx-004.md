---
id: note-tx-004
difficulty: L4
category: ai
subcategory: Agent
tags:
- 腾讯
- 面经
- Claude Code
- OpenClaw
- 记忆机制
feynman:
  essence: CC记忆=上下文+CLAUDE.md（简单直接，用压缩管理窗口），OpenClaw记忆=分层外部存储（功能完整，支持跨会话长期记忆）。
  analogy: CC像金鱼记忆——只记得眼前的事，但有个笔记本（CLAUDE.md）随时翻。OpenClaw像大象记忆——能记住很久以前的事，通过外部大脑（向量DB）检索。
  key_points:
  - CC:上下文内+CLAUDE.md+Auto-Compact
  - OpenClaw:分层记忆+外部向量DB
  - CC简单可靠无幻觉
  - OpenClaw功能完整可跨会话
first_principle: null
follow_up:
- CC的Auto-Compact会丢失信息吗？——会，但有任务状态快照保证关键目标不丢
- OpenClaw支持哪些向量数据库？——通常支持Milvus/Qdrant/ChromaDB
- CC的错误恢复机制是什么？——失败重试+回滚到最近检查点+人工介入
memory_points:
- 核心对比：Claude Code是轻量上下文派，OpenClaw是外部存储派。
- Claude机制：上下文即记忆，强依赖CLAUDE.md做静态长期记忆与Auto-Compact快照压缩。
- OpenClaw机制：分层外部存储，划分为工作记忆、时序情景记忆与向量语义记忆。
- 本质差异：CC追求极简但受窗口限制，OpenClaw依赖异步抽取支持跨会话但架构重。
---

# 【腾讯面经】Claude Code 的 memory 是怎么做的？OpenClaw 的 memory 是怎么做的？两者的记忆机制有什么区别？

> 本题考察对 Agent 记忆系统的深度理解。Claude Code（Anthropic 官方 CLI Agent）代表"轻量上下文派"，OpenClaw（开源多模态 Agent 框架）代表"外部存储派"。回答时要从架构原理、数据流、工程权衡三层面展开，最后落到选型建议。

## 一、为什么 Agent 需要记忆

LLM 本身是**无状态**的：每次推理只看到当前 prompt。但真实 Agent 任务（如修复一个 bug、写一个完整 feature）往往跨越几十轮工具调用，必须解决三类记忆需求：

| 记忆类型 | 类比 | 解决的问题 | 典型载体 |
|---------|------|-----------|---------|
| 短期记忆（Working） | 人的"工作记忆" | 当前任务的上下文连续性 | 上下文窗口 |
| 中期记忆（Episodic） | 人的"情景记忆" | 跨工具调用的执行轨迹 | 检查点/日志 |
| 长期记忆（Semantic） | 人的"知识库" | 跨会话的项目约定、用户偏好 | 文件/向量DB |

Claude Code 和 OpenClaw 对这三种记忆的实现策略截然不同。

## 二、Claude Code 的记忆机制

Claude Code 采用**"上下文即记忆"**的极简哲学，核心由四层组成：

### 1. 上下文窗口内记忆（In-Context Memory）

所有对话历史、工具调用入参/出参、系统消息都拼接到一个长 prompt 里，作为模型的短期工作记忆。

```
[System Prompt] + [CLAUDE.md 内容] + [历史消息 1..N] + [最新用户输入]
                          ↓
                  LLM 一次性推理
```

**优点**：实现极简，模型能看到完整上下文，决策最准。
**缺点**：受 200K token 窗口限制，长任务必然溢出。

### 2. CLAUDE.md 项目级持久记忆

在项目根目录放一个 `CLAUDE.md` 文件，内容类似 system prompt，记录：
- 项目技术栈、目录结构
- 编码规范、命名约定
- 构建/测试命令
- 已知坑、注意事项

每次会话启动时自动注入到 system prompt。**关键点**：CLAUDE.md 是"静态长期记忆"——用户手动维护、版本化管理、跨会话稳定，类似项目的"宪法"。

```markdown
# CLAUDE.md 示例
- 技术栈: Python 3.12 + FastAPI + PostgreSQL
- 测试: pytest tests/ -v
- 禁止使用 print() 调试，统一用 logger
- 数据库迁移: alembic upgrade head
```

### 3. Auto-Compact 自动压缩

当上下文接近窗口上限（默认 92%）时，CC 自动触发**摘要压缩**：

```
[原始上下文: 180K tokens]
        ↓ Auto-Compact
[压缩后: 40K tokens]
  ├─ 任务目标快照（必保留）
  ├─ 关键决策点摘要
  ├─ 已完成步骤清单
  └─ 最近 5 轮完整对话
```

压缩策略的关键在于**Task State Snapshot**：在压缩前先提取当前任务的"状态检查点"（目标、进度、阻塞点），确保压缩后 Agent 不会"忘记自己在干嘛"。这是 CC 相比朴素摘要的核心创新。

### 4. 错误恢复与检查点

CC 不会把记忆完全交给模型，而是维护一份**外部执行日志**：
- 每次工具调用前记录意图 + 入参
- 调用失败时自动重试（指数退避）
- 连续失败触发回滚到最近检查点
- 极端情况请求人工介入

这层"机械记忆"不依赖 LLM，保证了即使模型幻觉也不会丢任务。

## 三、OpenClaw 的记忆机制

OpenClaw 走**分层外部存储**路线，目标是支持跨会话、跨项目的长期记忆。

### 1. 三层记忆架构

```
┌─────────────────────────────────────────┐
│  Working Memory（工作记忆）              │
│  载体: 上下文窗口                         │
│  内容: 当前对话 + 工具结果                │
│  生命周期: 单次会话                       │
├─────────────────────────────────────────┤
│  Episodic Memory（情景记忆）             │
│  载体: 时序数据库 + 向量索引              │
│  内容: 历史执行轨迹（带时间戳）            │
│  生命周期: 可配置 TTL（如 30 天）         │
├─────────────────────────────────────────┤
│  Semantic Memory（语义记忆）             │
│  载体: 向量数据库（Milvus/Qdrant）        │
│  内容: 抽取的事实/知识/用户偏好           │
│  生命周期: 永久或手动删除                 │
└─────────────────────────────────────────┘
```

### 2. 记忆写入流程

每次工具调用或对话后，OpenClaw 异步执行**记忆抽取**：

```python
# 伪代码：记忆写入流程
def extract_and_store_memory(turn: Turn):
    # 1. LLM 抽取本轮的"可记忆事实"
    facts = llm.extract(
        prompt=f"从以下对话中抽取值得长期记住的事实:\n{turn}",
        schema=MemoryFact
    )
    # 2. 向量化
    embeddings = embed_model.encode(facts)
    # 3. 写入向量DB，附带元数据
    vector_db.upsert(
        vectors=embeddings,
        metadata={
            "user_id": turn.user_id,
            "timestamp": turn.ts,
            "type": "episodic",
            "source": "conversation"
        }
    )
```

### 3. 记忆检索：相关性 + 时间衰减

检索时不是简单 top-K，而是加权打分：

```
final_score = α * cosine_similarity(query, memory)
            + β * recency_boost(now - memory.ts)
            + γ * access_frequency(memory)
```

其中 `recency_boost = exp(-λ * days_since_last_access)`，模拟人类"近期记忆更容易想起"的特性。

### 4. 记忆遗忘与清理

OpenClaw 支持可配置的遗忘策略：
- **TTL 过期**：episodic 记忆默认 30 天后归档
- **容量淘汰**：超过上限按 LRU 删除
- **质量淘汰**：低置信度的事实定期清理
- **主动遗忘**：支持 GDPR right-to-be-forgotten

## 四、核心区别对比

| 维度 | Claude Code | OpenClaw |
|------|-------------|----------|
| **设计哲学** | 极简、上下文即记忆 | 功能完整、外部存储 |
| **短期记忆** | 上下文窗口 | 上下文窗口（相同） |
| **长期记忆载体** | CLAUDE.md（纯文本文件） | 向量数据库 |
| **跨会话记忆** | ❌ 每次新会话重置 | ✅ 自动加载历史 |
| **记忆检索** | 无（全量注入） | 向量相似度 + 时间衰减 |
| **记忆压缩** | Auto-Compact + 状态快照 | 无（靠检索按需取） |
| **记忆遗忘** | 无（靠窗口溢出自然淘汰） | TTL + LRU + 质量淘汰 |
| **幻觉风险** | 低（所见即所得） | 中（检索可能引入噪声） |
| **工程复杂度** | 低（无外部依赖） | 高（需维护向量DB + 抽取管线） |
| **适用场景** | 单会话编程任务 | 长期助手、跨会话对话 |

## 五、选型建议

**选 Claude Code 模式**：任务边界清晰、单次会话可完成、对可靠性要求极高（如代码生成、CI/CD 场景）。优势是简单可靠、无幻觉，劣势是无法跨会话。

**选 OpenClaw 模式**：需要记住用户长期偏好、跨会话连续对话（如个人助理、客服 Agent）。优势是体验好，劣势是工程复杂度高、检索噪声可能引入幻觉。

**生产实践中的混合方案**：很多团队采用"CC 为主 + 轻量外部存储"的折中——日常对话走上下文，关键事实定期 dump 到 SQLite/JSON，下次会话按需加载。这样既保持了简单性，又获得了有限的长期记忆能力。

## 六、面试加分点

1. **强调 Trade-off**：没有银弹，CC 的简单换来可靠性，OpenClaw 的完整换来复杂度。面试官想看你是否理解工程取舍。
2. **提到 Task State Snapshot**：这是 CC 压缩不丢任务的关键，多数候选人答不到这一层。
3. **举真实例子**：如 CC 在长任务中压缩后仍能继续，对比 GPT-4 直接用长上下文但成本爆炸。
4. **延伸到成本**：CC 的 Auto-Compact 本质是省钱——压缩后后续每轮都少付 token 费；OpenClaw 的检索增加延迟和向量DB成本。

## 记忆要点

- 核心对比：Claude Code是轻量上下文派，OpenClaw是外部存储派。
- Claude机制：上下文即记忆，强依赖CLAUDE.md做静态长期记忆与Auto-Compact快照压缩。
- OpenClaw机制：分层外部存储，划分为工作记忆、时序情景记忆与向量语义记忆。
- 本质差异：CC追求极简但受窗口限制，OpenClaw依赖异步抽取支持跨会话但架构重。

