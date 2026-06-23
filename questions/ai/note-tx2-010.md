---
id: note-tx2-010
difficulty: L4
category: ai
subcategory: Agent
tags:
- 腾讯
- 面经
- Memory系统
- 向量记忆
- 上下文污染
feynman:
  essence: 设计Agent Memory系统分三层——短期(当前会话，Redis，TTL短)、长期(用户画像/历史结论，Postgres，持久)、向量记忆(知识/历史对话，向量库，按相关性召回)。避免上下文污染四个手段：①摘要后再写回(不留原始错误文本)②独立scratchpad(反思不进主context)③相关性召回(不全塞，按query召回top-K)④遗忘机制(定期清理低引用/过时记忆)。
  analogy: 像人的记忆系统——短期是工作记忆(正在想的事，容量小忘得快)，长期是经历沉淀(人生的经验)，向量是联想记忆(看到X想起相关的Y)。避免污染就是别把每个念头都记下来(摘要)、别让负面记忆干扰当下(scratchpad隔离)、忘掉没用的事(遗忘)。
  first_principle: Memory 的价值在"按需召回"而非"全量塞入"。LLM context 有限，全量历史会爆 + 噪声干扰。Memory 系统的本质是"组织信息让相关内容在需要时被召回"。
  key_points:
  - '三层: 短期(会话,Redis)/长期(画像,PG)/向量(知识,向量库)'
  - '避免污染: 摘要后写回/独立scratchpad/相关性召回/遗忘机制'
  - '短期TTL短，长期持久，向量按相关性召回top-K'
  - '记忆组织: 按type分类(user/feedback/project/reference)'
  - '遗忘: 定期清理低引用/过时/低价值记忆'
first_principle:
  essence: Memory = 按需召回，非全量塞入
  derivation: LLM context 有限 → 全量历史爆+噪声 → 按相关性召回 top-K → 但召回也可能污染 → 加摘要/隔离/遗忘
  conclusion: Memory 系统的核心不是"记多少"，而是"该记的记、该忘的忘、需要时召得回"
follow_up:
- 怎么衡量 Memory 的有效性？
- 遗忘机制怎么设计？什么时候该忘？
- 向量记忆和知识库 RAG 有什么区别？
---

# 【某讯面经】设计 Agent 的 Memory 系统（短期+长期+向量记忆），如何避免上下文污染

## 一、三层 Memory 架构

```
┌─────────────────────────────────────────────────────────┐
│  短期记忆（Working Memory）                               │
│  内容: 当前会话上下文                                      │
│  存储: Redis（TTL 30min-2h）                              │
│  特点: 容量小、读频繁、关窗即丢                            │
├─────────────────────────────────────────────────────────┤
│  长期记忆（Long-term Memory）                             │
│  内容: 用户画像、历史结论、偏好                            │
│  存储: Postgres / 文档数据库                              │
│  特点: 持久、结构化、跨会话                                │
├─────────────────────────────────────────────────────────┤
│  向量记忆（Episodic / Semantic Memory）                  │
│  内容: 历史对话、知识文档                                  │
│  存储: 向量库（Milvus/FAISS）                             │
│  特点: 按语义相关性召回、top-K                            │
└─────────────────────────────────────────────────────────┘
```

## 二、各层设计

### 短期记忆
```python
# Redis Hash
key = session:{user_id}:{conversation_id}
fields:
  messages: [最近 N 轮对话]
  current_intent: 当前意图
  pending_tasks: 待处理任务
TTL = 30 min（会话活跃就续期）
```

**设计要点**：
- 只存最近 N 轮（如 10 轮），更早的转长期/向量
- 滑动窗口：超 N 轮自动摘要旧消息
- TTL 续期：用户活跃时延长 TTL

### 长期记忆
```python
# Postgres 表
user_memory:
  user_id, memory_type, content, created_at, last_accessed, access_count
  
memory_type 分类（Claude Code 风格）：
  - user: 用户偏好（"喜欢简洁回答"）
  - feedback: 用户反馈（"上次回答太长"）
  - project: 项目规则（"用 React 不用 Vue"）
  - reference: 参考资料（"API 文档在 X"）
  - conclusion: 历史结论（"上次解决的问题方案"）
```

**设计要点**：
- 结构化存储，可查询
- 带 metadata（创建时间/访问次数/重要性）
- 跨会话共享（同一用户所有会话都能读）

### 向量记忆
```python
# 向量库
collection: conversation_history / knowledge_base
fields:
  embedding: 对话/文档的向量
  content: 原文
  metadata: {user_id, timestamp, topic, ...}

召回：
  query → embedding → 向量检索 → top-K 相关片段
```

**设计要点**：
- 按 user_id 隔离（不同用户记忆不串）
- 按 topic 分类（工作/生活/技术）
- 召回 top-K（不全塞，控制 context）

## 三、Memory 在请求时的组装

```
用户请求进来
  ↓
[短期记忆] 当前会话最近 N 轮（必带）
  ↓
[长期记忆] 用户画像 + 相关偏好（按 user_id 查）
  ↓
[向量记忆] 按 query 召回 top-K 历史相关片段
  ↓
组装到 system prompt：
  "用户偏好: {long_term}
   相关历史: {vector_recall}
   当前对话: {short_term}"
  ↓
LLM 生成
```

**关键**：不全量塞，按相关性召回 + token 预算控制。

## 四、避免上下文污染的四个手段

### 手段1：摘要后再写回
```python
# ❌ 错误：原始错误文本塞回 context
context += "上次我答错了，正确答案是..."

# ✅ 正确：摘要成规则
summary = llm.summarize("上次我答错了，正确答案是...") 
# → "回答X类问题时要注意Y"
context += summary
```

**原因**：原始错误文本含"我错了"会让模型过度自我怀疑/重复道歉。

### 手段2：独立 scratchpad（反思隔离）
```
主 context：用户对话 + 召回记忆
scratchpad（独立）：反思过程、中间推理

反思写到 scratchpad，不进主 context
只有反思的"结论"才合并进主 context
```

### 手段3：相关性召回（不全塞）
```python
# ❌ 错误：把所有历史塞 context
context = all_history  # 爆 context + 噪声

# ✅ 正确：按 query 召回 top-K
relevant = vector_store.search(query, k=5)  # 只塞相关的
context = short_term + long_term_profile + relevant
```

### 手段4：遗忘机制
```
定期清理：
  - 低引用记忆（access_count < 阈值，长期没被召回）
  - 过时记忆（如"2024年的价格"，已过期）
  - 低价值记忆（用户标记"别记这个"）
  - 矛盾记忆（新记忆覆盖旧记忆）

实现：
  定时任务跑：
    DELETE FROM user_memory 
    WHERE access_count < 2 
    AND created_at < NOW() - INTERVAL '30 days';
```

## 五、Memory 污染的真实案例

```
污染场景1：道歉循环
  用户："你上次答错了"
  Agent（把"我错了"塞回 context）："对不起我错了，这次..."
  用户继续问 → Agent 又道歉（context 里全是道歉）
  
  解法：摘要后写回（"上次X类问题答错了，这次注意"）

污染场景2：无关历史干扰
  用户问"今天天气" 
  召回了"上次聊的美食"（向量相似但无关）
  Agent 答非所问
  
  解法：Rerank 召回结果 + 相似度阈值过滤

污染场景3：过时记忆
  Memory 里："用户在上海工作"
  实际用户已搬家到北京
  Agent 永远基于"上海"回答
  
  解法：遗忘机制 + 记忆带时间戳 + 定期校验
```

## 六、加分点

- 说出 **Memory 不是越多越好**：全量塞会爆 context + 噪声干扰，按需召回才对
- 说出 **遗忘机制的重要性**：人的记忆会忘，Agent 也该忘，否则记忆库膨胀 + 过时信息干扰
- 说出 **Memory 的评测**：召回准确率、采纳率、对任务的提升度

## 七、雷区

- ❌ "把所有对话都塞 Memory" → context 爆 + 噪声
- ❌ "Memory 永不删除" → 膨胀 + 过时信息
- ❌ "反思直接进主 context" → 污染

## 八、扩展

- **MemGPT**：用 OS 的虚拟内存思想管理 LLM context（主存=context，硬盘=长期记忆，按需换页）
- **Memory 的时效性**：不同记忆有不同 TTL（会话=30min，偏好=永久，价格=1个月）
- **跨用户 Memory**：知识库类记忆可跨用户共享（如"退款政策"），个人记忆严格隔离
