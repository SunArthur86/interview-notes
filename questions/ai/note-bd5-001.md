---
id: note-bd5-001
difficulty: L3
category: ai
subcategory: Agent
tags:
- 字节
- 面经
- RAG
- Memory
feynman:
  essence: RAG是检索外部知识来增强当前回答，持久化记忆是跨会话存储用户偏好和历史交互，两者解决不同维度的信息缺失
  analogy: RAG像查百科全书——每次现查；持久化记忆像你的私人笔记本——记住你的习惯。查百科回答事实问题，翻笔记记住你是谁
  first_principle: RAG补充的是世界知识(factual)，持久化记忆补充的是用户上下文(personal)，两者正交
  key_points:
  - 'RAG: 检索文档/知识库，解决LLM知识截止/私有数据问题'
  - '持久化记忆: 存储用户偏好/历史，解决跨会话个性化问题'
  - RAG是stateless的(每次重新检索)，记忆是stateful的(累积状态)
  - 生产Agent两者都需要：先查记忆了解用户，再RAG检索知识回答
first_principle:
  essence: LLM有两个信息缺口：不知道外部世界的事实(RAG补)和不记得和用户的过往(记忆补)
  derivation: LLM训练数据有截止日期 → 需要RAG补充新知识 → LLM每次会话独立 → 需要记忆补充用户历史 → 两者解决不同缺口 → 需要协同工作
  conclusion: RAG是'查资料'，记忆是'认人'，生产Agent缺一不可
follow_up:
- 记忆和RAG怎么协同工作？谁先谁后？
- 记忆存在哪？和RAG的向量库共用吗？
- 如何控制记忆的注入量避免context爆炸？
memory_points:
- RAG解决模型不知道的外部知识(Stateless)，记忆解决模型不记得的用户历史(Stateful)
- RAG检索无个性化的全局文档，记忆累积存储特定用户的独立画像
- 因为用户常问'上次推荐的'，所以需要记忆提取历史结合RAG查询实时状态
- 生产架构：每次会话先查用户记忆构建Prompt，再RAG检索外部知识生成回答
---

# 讲讲 RAG 和持久化记忆的区别

## 核心区别

```
┌────────────────────────────────────────────────────┐
│              用户输入: "推荐一家川菜馆"              │
│                                                    │
│     ┌──────────────┐      ┌──────────────────┐    │
│     │  持久化记忆    │      │     RAG 检索      │    │
│     │              │      │                  │    │
│     │ "这个用户是   │      │ 检索本地餐厅     │    │
│     │  四川人,      │      │ 知识库 → 返回    │    │
│     │  偏好麻辣,    │      │ "老房子川菜"     │    │
│     │  人均80以内"  │      │  等商家信息       │    │
│     └──────┬───────┘      └────────┬─────────┘    │
│            │                       │               │
│            └───────────┬───────────┘               │
│                        ▼                           │
│     "根据您的口味偏好，推荐老房子川菜馆..."         │
└────────────────────────────────────────────────────┘
```

| 维度 | RAG | 持久化记忆 |
|------|-----|-----------|
| **解决什么** | LLM不知道的外部知识 | LLM不记得的用户历史 |
| **数据来源** | 文档/知识库/数据库 | 用户历史交互/偏好 |
| **时效性** | 实时检索(当前快照) | 累积存储(历史状态) |
| **个性化** | 无(所有用户查同一库) | 强(每个用户独立记忆) |
| **数据变更** | 文档更新即生效 | 随交互动态更新 |
| **存储方式** | 向量库(文档chunks) | 向量库+KV(用户画像) |
| **检索时机** | 需要事实知识时 | 每次会话开始时 |
| **State** | Stateless(每次新检索) | Stateful(累积状态) |

## 协同工作流程

```python
async def agent_with_memory_and_rag(user_input, user_id, session_id):
    # Step 1: 查记忆 — 了解用户是谁
    user_memory = await memory_store.search(
        query=embed(user_input),
        user_id=user_id,
        top_k=3
    )
    # 结果: ["偏好川菜", "人均80以内", "不吃香菜"]

    # Step 2: 构建增强Prompt
    system_prompt = f"""
    用户偏好: {user_memory}
    """

    # Step 3: RAG检索 — 补充外部知识
    rag_results = await rag_engine.search(
        query=user_input,
        filters={"cuisine": "川菜", "price_max": 80}
    )
    # 结果: 老房子川菜、巴蜀风等商家信息

    # Step 4: LLM生成 — 结合记忆+知识
    response = await llm.chat(
        system=system_prompt,
        context=rag_results,
        user=user_input
    )

    # Step 5: 更新记忆 — 记录本次交互
    await memory_store.update(
        user_id=user_id,
        interaction={"query": user_input, "response": response}
    )

    return response
```

## 为什么两者都需要

```
场景: 用户问 "上次你推荐的那家店还在吗？"

❌ 只有RAG: 不知道"上次推荐了什么" → 无法回答
❌ 只有记忆: 知道推荐过"老房子川菜" → 但不知道是否还在营业
✅ 记忆+RAG: 从记忆找到"老房子川菜" → RAG检索该店当前状态 → 回答
```

## 存储架构

```
┌─────────────────────────────────────────┐
│         Agent Context Window            │
│  ┌─────────┐  ┌─────────────────────┐  │
│  │ Memory  │  │   RAG Results       │  │
│  │ (1KB)   │  │   (4KB)             │  │
│  │用户偏好  │  │检索到的文档chunks   │  │
│  └─────────┘  └─────────────────────┘  │
├─────────────────────────────────────────┤
│  向量库 (共享)                           │
│  ┌──────────┐  ┌──────────────────┐    │
│  │记忆Collection│ │ 知识Collection  │    │
│  │filter:   │  │ filter: none     │    │
│  │user_id=X │  │ (全用户共享)      │    │
│  └──────────┘  └──────────────────┘    │
└─────────────────────────────────────────┘
```

## 记忆要点

- RAG解决模型不知道的外部知识(Stateless)，记忆解决模型不记得的用户历史(Stateful)
- RAG检索无个性化的全局文档，记忆累积存储特定用户的独立画像
- 因为用户常问'上次推荐的'，所以需要记忆提取历史结合RAG查询实时状态
- 生产架构：每次会话先查用户记忆构建Prompt，再RAG检索外部知识生成回答

