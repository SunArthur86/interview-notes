---
id: note-bd2-002
difficulty: L3
category: ai
subcategory: Agent
tags:
  - 字节
  - 面经
  - Agent
  - 上下文窗口
  - 上下文压缩
feynman:
  essence: '上下文窗口满了时，通过摘要压缩、选择性遗忘、分层记忆等策略在有限Token内保留最关键的信息'
  analogy: '就像开会做笔记——不是把每个人说的每句话都记下来，而是提炼关键决策、遗忘闲聊、重要细节单独标注，让有限的笔记本发挥最大价值'
  first_principle: '上下文窗口是有限资源(Tokens)，信息价值不均匀。压缩的本质是信息论中的"有损压缩"——保留高信息量内容，丢弃低信息量内容'
  key_points:
    - '滑动窗口: 只保留最近N轮对话'
    - '摘要压缩: 用LLM对历史对话生成摘要'
    - '选择性遗忘: 根据相关性丢弃低价值信息'
    - '分层记忆: 短期窗口+长期向量库的二级架构'
    - '实体中心: 只保留关键实体和关系'
first_principle:
  essence: '信息在对话中的价值随时间衰减且分布不均匀，压缩策略应基于信息价值评估'
  derivation: '假设对话已有100轮，窗口只能容纳20轮。第1轮的用户画像(高价值)和第99轮的"好的"(低价值)显然不同。按时间截断会丢失高价值信息，应按价值排序保留'
  conclusion: '最优压缩策略 = 价值评估 + 分层存储 + 动态裁剪'
follow_up:
  - '摘要本身也可能丢失信息，怎么保证摘要质量？'
  - '不同压缩策略对Agent性能的影响有多大？'
  - '有没有自适应的压缩策略，根据任务自动选择？'
---

# Agent上下文窗口满了怎么办？有哪些压缩方式？

## 问题本质

```
上下文窗口: 128K tokens (GPT-4 Turbo)
Agent多轮对话 + 工具调用 + RAG检索

┌──── 上下文构成 ────────────────────────────────┐
│ System Prompt:        2K tokens                │
│ 工具定义:              3K tokens                │
│ RAG检索结果:          10K tokens                │
│ 对话历史(50轮):       50K tokens                │
│ 工具调用结果(20次):    30K tokens                │
│ 当前用户输入:          1K tokens                │
│ ─────────────────────────────────              │
│ 总计:                 96K / 128K (75%)         │
│                                               │
│ 再过几轮就会超出窗口! 需要压缩!                   │
└───────────────────────────────────────────────┘
```

## 五种压缩策略

### 策略1: 滑动窗口 (最简单)

```python
def sliding_window(messages, max_messages=20):
    """只保留最近N轮对话"""
    # 简单粗暴: 丢弃最早的对话
    return messages[-max_messages * 2:]  # 每轮=1 user + 1 assistant

# 优点: 实现简单，延迟低
# 缺点: 丢失早期重要信息(用户画像、关键约束)
```

### 策略2: 摘要压缩 (最常用)

```python
async def summarize_compress(messages, keep_recent=6):
    """将旧对话压缩为摘要"""
    # 保留最近N轮原文
    recent = messages[-keep_recent * 2:]
    old = messages[:-keep_recent * 2]
    
    if not old:
        return messages
    
    # 用LLM生成旧对话的摘要
    summary = await llm.generate(
        system="请将以下对话历史压缩为简洁的摘要，保留关键信息。",
        user=format_messages(old)
    )
    
    # 用摘要替代旧对话
    return [
        {"role": "system", "content": f"【对话历史摘要】:\n{summary}"}
    ] + recent

# 摘要Prompt示例:
SUMMARY_PROMPT = """请总结以下对话的关键信息:

{old_messages}

请提取:
1. 用户的身份和偏好
2. 已经讨论过的关键结论
3. 用户提出的约束和要求
4. 已完成的操作和结果摘要

用简洁的要点格式输出，不超过500字。
"""
```

### 策略3: 选择性遗忘 (基于相关性)

```python
def selective_pruning(messages, current_query, max_tokens=8000):
    """根据与当前查询的相关性裁剪历史"""
    # 计算每条历史消息与当前查询的相关性分数
    query_embedding = embed(current_query)
    
    scored_messages = []
    for i, msg in enumerate(messages):
        msg_embedding = embed(msg["content"])
        relevance = cosine_similarity(query_embedding, msg_embedding)
        # 时间衰减因子: 越早的消息相关性权重越低
        recency_bonus = 1.0 / (1 + len(messages) - i) * 0.1
        score = relevance + recency_bonus
        scored_messages.append((msg, score))
    
    # 按分数排序，保留Top-K
    scored_messages.sort(key=lambda x: -x[1])
    
    total_tokens = 0
    selected = []
    for msg, score in scored_messages:
        msg_tokens = count_tokens(msg["content"])
        if total_tokens + msg_tokens > max_tokens:
            break
        selected.append(msg)
        total_tokens += msg_tokens
    
    # 恢复时间顺序
    selected.sort(key=lambda m: messages.index(m))
    return selected
```

### 策略4: 分层记忆 (工业主流)

```python
class HierarchicalMemory:
    """短期+长期二级记忆架构"""
    
    def __init__(self):
        self.short_term = []         # 短期: 最近对话(在窗口内)
        self.long_term = VectorStore()  # 长期: 向量库(全部历史)
        self.entity_memory = {}      # 实体记忆: 用户画像
    
    def add_message(self, msg):
        """添加消息到记忆系统"""
        self.short_term.append(msg)
        
        # 提取关键实体更新用户画像
        entities = extract_entities(msg["content"])
        for entity in entities:
            self.entity_memory[entity.name] = entity.value
        
        # 向量化存入长期记忆
        self.long_term.add({
            "content": msg["content"],
            "embedding": embed(msg["content"]),
            "timestamp": time.time(),
            "role": msg["role"]
        })
    
    def build_context(self, current_query, max_tokens=8000):
        """构建喂给LLM的上下文"""
        context_parts = []
        
        # 1. 实体记忆 (最稳定的信息)
        context_parts.append(f"用户画像: {self.entity_memory}")
        
        # 2. 从长期记忆检索相关历史
        relevant = self.long_term.search(current_query, top_k=5)
        context_parts.append(f"相关历史: {format(relevant)}")
        
        # 3. 短期记忆 (最近对话)
        recent = self.short_term[-10:]  # 最近10条
        total = sum(count_tokens(m["content"]) for m in recent)
        while total > max_tokens and recent:
            recent.pop(0)  # 从最早的开始丢弃
            total = sum(count_tokens(m["content"]) for m in recent)
        context_parts.append(f"最近对话: {format(recent)}")
        
        return '\n'.join(context_parts)
```

### 策略5: 结构化上下文 (信息密度最大化)

```python
def structured_compress(messages):
    """将对话历史转为结构化笔记"""
    
    # 提取对话中的关键信息结构化存储
    notes = llm.generate("""
请从以下对话中提取结构化信息:

{messages}

输出格式:
## 用户信息
- 姓名: 
- 偏好: 

## 已完成事项
1. [事项] → [结果]

## 待办事项
1. 

## 关键约束
- 

## 重要数据
- 
""")
    
    # 用结构化笔记替代原始对话
    return [{"role": "system", "content": notes}]
```

## 压缩策略对比

| 策略 | 信息保留 | 实现难度 | Token节省 | 延迟 | 适用场景 |
|------|---------|---------|----------|------|---------|
| 滑动窗口 | 低 | 极低 | 高 | 0 | 简单对话 |
| 摘要压缩 | 中 | 中 | 高 | +1s | 通用首选 |
| 选择性遗忘 | 中高 | 高 | 中 | +200ms | 信息密集场景 |
| 分层记忆 | 高 | 高 | 极高 | +100ms | 生产Agent |
| 结构化压缩 | 高 | 中 | 极高 | +1s | 长任务Agent |

## 触发时机

```python
class ContextManager:
    def __init__(self, max_tokens=120000, compress_threshold=0.8):
        self.max_tokens = max_tokens
        self.compress_threshold = compress_threshold
    
    def maybe_compress(self, messages, new_msg):
        """检查是否需要压缩"""
        total = sum(count_tokens(m["content"]) for m in messages)
        total += count_tokens(new_msg["content"])
        
        if total > self.max_tokens * self.compress_threshold:
            # 达到阈值，执行压缩
            return self.compress(messages)
        return messages
```
