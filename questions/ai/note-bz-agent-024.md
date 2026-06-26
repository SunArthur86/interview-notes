---
id: note-bz-agent-024
difficulty: L3
category: ai
subcategory: Agent
tags:
  - B站面经
  - 多轮对话
  - 上下文
  - 记忆
feynman:
  essence: 多轮对话上下文建模=决定"带什么历史进下一轮"。核心方法是滑动窗口+摘要压缩+记忆检索，在"不丢关键信息"和"不超token限制"间平衡。
  analogy: 像开长会——不可能记住每句话(全量)，但能记住决议(摘要)、最近讨论(窗口)、之前提过的要点(检索)。
  first_principle: 上下文窗口有限，但对话信息随轮次线性增长。必须选择性保留——全留会超限，全丢会失忆。建模本质是"信息价值评估+有损压缩"。
  key_points:
    - 核心矛盾：信息增长 vs 窗口有限
    - 方法：滑动窗口/摘要压缩/记忆检索/分层管理
    - 评估：保留关键信息+控制token成本
    - 演进：从固定窗口到智能压缩
first_principle:
  essence: 多轮对话建模是"有限带宽下的信息保真"问题。
  derivation: '每轮对话新增信息，但上下文窗口固定。若全保留→超限；若随机丢弃→失忆。解法：评估信息价值，高价值保留/压缩，低价值丢弃，实现有损但保真的压缩。'
  conclusion: 上下文建模 = 信息价值评估（什么重要）+ 有损压缩策略（怎么精简）
follow_up:
  - 摘要会丢信息吗？——会，所以关键信息要结构化保留
  - 怎么判断哪些是关键信息？——LLM评估+用户反馈+任务相关性
  - Token超了怎么处理？——分级压缩：先摘要旧轮，再裁剪，最后记忆外置
---

# 多轮对话的上下文如何建模？

## 一、核心矛盾

```
对话轮次增长 vs 上下文窗口有限

轮次1: [user1, ai1]                        ~100 tokens
轮次5: [u1,a1,...,u5,a5]                   ~500 tokens
轮次20: [u1,a1,...,u20,a20]               ~2000 tokens
轮次100: ...                              ~10000 tokens
                    │
                    ▼
         上下文窗口上限（如128K）

问题：轮次多了，要么超限报错，要么丢历史失忆
```

## 二、四种建模方法

### 方法 1：滑动窗口（最简单）

```
策略：只保留最近N轮，旧的丢弃

┌──────────────────────────────────┐
│  完整对话: [u1,a1,u2,a2,...,u20,a20]│
│                                    │
│  滑动窗口(保留最近5轮):             │
│  [u16,a16,u17,a17,...,u20,a20]     │
│  前面的丢弃                         │
└──────────────────────────────────┘

优点：实现极简，token可控
缺点：丢失早期重要信息（如用户姓名/需求）
```

```python
def sliding_window(messages, keep_recent=10):
    """保留最近N轮"""
    return messages[-keep_recent * 2:]  # 每轮2条(user+ai)
```

### 方法 2：摘要压缩（常用）

```
策略：旧对话压缩成摘要，最近对话保留原文

┌──────────────────────────────────┐
│  [摘要: "用户在咨询Python项目，    │ ← 旧对话压缩
│   偏好异步方案，已讨论了架构设计"]  │
│  [u18,a18,u19,a19,u20,a20]        │ ← 最近3轮原文
└──────────────────────────────────┘

优点：保留关键信息，token省
缺点：摘要有损，可能丢细节
```

```python
class SummaryMemory:
    def __init__(self, llm):
        self.llm = llm
        self.summary = ""
        self.recent = []  # 最近几轮原文
        self.SUMMARY_THRESHOLD = 10  # 每10轮压缩一次
    
    def add(self, turn):
        self.recent.append(turn)
        if len(self.recent) >= self.SUMMARY_THRESHOLD:
            # 压缩旧轮到摘要
            old = self.recent[:-3]  # 保留最近3轮
            new_summary = self.llm.summarize(
                f"已有摘要: {self.summary}\n"
                f"新增对话: {old}\n"
                f"请更新摘要，保留关键信息"
            )
            self.summary = new_summary
            self.recent = self.recent[-3:]
    
    def get_context(self):
        return [{"role": "system", "content": f"历史摘要: {self.summary}"}] + self.recent
```

### 方法 3：记忆检索（智能）

```
策略：历史存外部记忆，每轮按需检索相关

┌──────────────────────────────────┐
│  当前问题: "我之前说的异步方案..."  │
│                                    │
│  Step1: 从记忆库检索相关历史        │
│    → 找到: "轮次5讨论了asyncio"    │
│    → 找到: "轮次12确定了方案"      │
│                                    │
│  Step2: 组装上下文                 │
│    [相关记忆] + [最近2轮] + [当前] │
└──────────────────────────────────┘

优点：精准召回相关历史，不浪费token
缺点：依赖检索质量，有延迟
```

```python
class RetrievalMemory:
    def __init__(self, vector_db):
        self.memory = vector_db
        self.recent = []
    
    def get_context(self, current_query):
        # 1. 检索相关历史
        relevant = self.memory.search(
            current_query, 
            filter={"session": self.session_id},
            top_k=3
        )
        # 2. 组装：相关记忆 + 最近对话 + 当前问题
        context = []
        for mem in relevant:
            context.append({"role": "system", 
                           "content": f"[历史] {mem.content}"})
        context.extend(self.recent[-4:])  # 最近2轮
        return context
```

### 方法 4：分层管理（生产级）

```
组合策略，按信息重要性分层：

┌──────────────────────────────────────┐
│ Layer 1: 永久信息（始终保留）          │
│   - 用户画像/偏好/核心需求             │
│   - System Prompt                    │
├──────────────────────────────────────┤
│ Layer 2: 摘要（压缩保留）              │
│   - 早期对话的要点总结                 │
├──────────────────────────────────────┤
│ Layer 3: 最近原文（滑动窗口）          │
│   - 最近N轮的完整对话                  │
├──────────────────────────────────────┤
│ Layer 4: 检索记忆（按需）              │
│   - 存向量库，当前问题相关时才召回      │
└──────────────────────────────────────┘

最终上下文 = Layer1 + Layer2 + Layer3 + (Layer4 if relevant)
```

## 三、上下文组装示例

```python
def build_context(user_id, session_id, current_message):
    context = []
    
    # Layer 1: 永久信息
    profile = db.get_user_profile(user_id)
    context.append({
        "role": "system",
        "content": f"用户画像: {profile.preferences}"
    })
    
    # Layer 2: 会话摘要
    summary = redis.get(f"summary:{session_id}")
    if summary:
        context.append({
            "role": "system",
            "content": f"对话摘要: {summary}"
        })
    
    # Layer 4: 检索相关历史
    relevant = memory.retrieve(
        current_message, 
        session_id=session_id,
        top_k=3
    )
    for mem in relevant:
        context.append({
            "role": "system",
            "content": f"[相关历史] {mem}"
        })
    
    # Layer 3: 最近对话
    recent = redis.get_recent(session_id, limit=6)  # 最近3轮
    context.extend(recent)
    
    # 当前消息
    context.append({"role": "user", "content": current_message})
    
    return context
```

## 四、Token 预算管理

```python
def manage_token_budget(context, max_tokens=8000):
    """确保上下文不超过token预算"""
    total = count_tokens(context)
    
    if total <= max_tokens:
        return context  # 没超，全保留
    
    # 超了，按优先级裁剪
    # 优先级：永久信息 > 当前问题 > 最近对话 > 检索记忆 > 摘要
    
    # Step1: 减少检索记忆数量
    context = trim_retrieval(context, max_tokens * 0.9)
    # Step2: 缩短最近对话窗口
    context = trim_recent(context, max_tokens * 0.8)
    # Step3: 进一步压缩摘要
    context = compress_summary(context, max_tokens * 0.7)
    
    return context
```

## 五、方法对比

| 方法 | Token成本 | 信息保留 | 实现复杂度 | 适用 |
|------|----------|---------|-----------|------|
| 滑动窗口 | 低 | 差（丢早期） | 极低 | 简单聊天 |
| 摘要压缩 | 中 | 中（有损） | 中 | 长对话 |
| 记忆检索 | 中 | 好（精准） | 高 | 知识型对话 |
| 分层管理 | 中 | 优 | 高 | 生产级 |

## 六、面试加分点

1. **强调"有损压缩"本质**：上下文建模不是"全保留"，而是"智能取舍"
2. **分层管理**：生产级方案是组合拳，不是单一方法
3. **提"Token 预算"**：把上下文建模和成本控制结合，体现工程思维
