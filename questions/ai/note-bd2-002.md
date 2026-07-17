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
  essence: 上下文窗口满了时，通过摘要压缩、选择性遗忘、分层记忆等策略在有限Token内保留最关键的信息
  analogy: 就像开会做笔记——不是把每个人说的每句话都记下来，而是提炼关键决策、遗忘闲聊、重要细节单独标注，让有限的笔记本发挥最大价值
  first_principle: 上下文窗口是有限资源(Tokens)，信息价值不均匀。压缩的本质是信息论中的"有损压缩"——保留高信息量内容，丢弃低信息量内容
  key_points:
  - '滑动窗口: 只保留最近N轮对话'
  - '摘要压缩: 用LLM对历史对话生成摘要'
  - '选择性遗忘: 根据相关性丢弃低价值信息'
  - '分层记忆: 短期窗口+长期向量库的二级架构'
  - '实体中心: 只保留关键实体和关系'
first_principle:
  essence: 信息在对话中的价值随时间衰减且分布不均匀，压缩策略应基于信息价值评估
  derivation: 假设对话已有100轮，窗口只能容纳20轮。第1轮的用户画像(高价值)和第99轮的"好的"(低价值)显然不同。按时间截断会丢失高价值信息，应按价值排序保留
  conclusion: 最优压缩策略 = 价值评估 + 分层存储 + 动态裁剪
follow_up:
- 摘要本身也可能丢失信息，怎么保证摘要质量？
- 不同压缩策略对Agent性能的影响有多大？
- 有没有自适应的压缩策略，根据任务自动选择？
memory_points:
- 滑动窗口：仅保留最近N轮，最简单但易丢早期关键信息。
- 摘要压缩：最常用策略，LLM总结旧对话，保留近期原文。
- 选择性遗忘：基于当前Query的语义相关性裁剪并组合历史。
- 实体抽取：提取用户画像和状态独立存库，减少Token消耗。
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

## 记忆要点

- 滑动窗口：仅保留最近N轮，最简单但易丢早期关键信息。
- 摘要压缩：最常用策略，LLM总结旧对话，保留近期原文。
- 选择性遗忘：基于当前Query的语义相关性裁剪并组合历史。
- 实体抽取：提取用户画像和状态独立存库，减少Token消耗。

## 苏格拉底式面试追问

> 这组追问模拟面试官层层逼问，每一问先回答"为什么"，再回答"怎么做"，最后回答"如何证明"。

### 第一层：目标与动机

**Q：上下文窗口满了你说用"摘要压缩"。为什么不直接换更大的模型（如 128k/200k 窗口），省得做摘要丢信息？**

大窗口贵且仍有上限。128k 窗口的模型（如 GPT-4-Turbo）token 单价是 8k 版本的 2-3 倍，长上下文成本爆炸（一个对话几万 token，每次请求都付费）。且大窗口有"lost in the middle"问题——模型对中间位置的信息注意力弱，即使塞进去也"看不到"，不如摘要把关键信息前置。再者，即使 200k 窗口也会满（长周期对话如客服陪伴、代码助手迭代几天），必须压缩。摘要的价值是"信息密度"——把 10000 token 的历史浓缩成 1000 token 的摘要，保留关键事实（用户画像、已达成的共识、未解决的问题），丢弃寒暄和冗余，既省钱又提升模型注意力质量。

### 第二层：证据与定位

**Q：用户反馈"Agent 忘了我之前说的事"（如第 3 轮说的偏好，第 10 轮被忽略）。你怎么定位是摘要丢了信息、滑动窗口截断了、还是检索没召回？**

看上下文构建的各阶段。一是摘要内容——第 3 轮的信息是否进了摘要（如果摘要里没提该偏好，是摘要压缩时丢了，摘要 prompt 不够全面）；二是滑动窗口——第 3 轮是否在窗口内（如果窗口只保留最近 5 轮，第 3 轮在窗口外，靠摘要或长期记忆补，摘要没补上就丢了）；三是长期记忆检索——如果用了向量库存历史，当前 query 检索时是否召回了第 3 轮的内容（没召回是 embedding 差或没存进库）。治法：摘要丢失改摘要 prompt（明确要求保留用户偏好/关键决策）；窗口截断配合实体抽取（把偏好独立存 KV 库，不受窗口影响）；检索失败改 embedding 或加 query 改写。

### 第三层：根因深挖

**Q：摘要压缩后 Agent 的表现反而变差（比不压缩直接截断还差）。根因是什么？**

根因可能是"摘要质量差"或"摘要时机不对"。摘要质量差——LLM 摘要时丢失关键信息（如把"用户要退货因为商品损坏"摘要成"用户咨询退货"，丢了"损坏"这个关键原因），后续 Agent 基于残缺摘要决策出错。摘要时机不对——如果每轮都实时摘要（把全部历史摘要），摘要本身消耗 token 和延迟，且累积误差（摘要的摘要越来越失真）。治本：一是摘要要结构化（按"用户意图/已做决策/待办事项/关键约束"分类摘要，而非自由文本）；二是分层摘要（近 3 轮保留原文，更早的做摘要，摘要只做一次不递归）；三是摘要后校验（用 NLI 检查摘要是否覆盖原文关键信息）。

**Q：那为什么不直接用"全量检索"（每轮把全部历史存向量库，当前 query 检索 top-K 拼进上下文），省得摘要丢信息？**

全量检索（类似无限记忆）的问题是"检索质量不稳定"。向量检索基于语义相似度，但"关键信息"不一定和当前 query 语义相似——如用户第 1 轮说"我是 VIP 用户"（偏好信息），第 10 轮问"我的订单多久到"（query 和 VIP 偏好语义不相似，检索不到第 1 轮）。摘要的优势是"主动提炼"（LLM 判断哪些是关键信息，主动保留），检索是"被动匹配"（只召回语义相似的，可能漏掉非相似但关键的信息）。正确做法是"摘要 + 检索 + 实体库"三层——摘要保留对话主线，检索补充语义相关的细节，实体库存结构化关键信息（用户画像、订单状态）每轮注入。单一方案都有盲区。

### 第四层：方案权衡

**Q：你说用"实体抽取"（提取用户画像独立存库）。为什么不直接全塞进 System Prompt（每轮都带上完整用户画像），省得做存取？**

System Prompt 有 token 上限且每次请求都计费。用户画像可能很大（偏好、历史订单、咨询记录、投诉历史），全塞进 System Prompt 占几千 token，每次对话都付费，成本高。且画像不是每次都用得上（如用户问天气不需要订单历史），全塞进是浪费。实体库存取的优势是"按需注入"——当前 query 需要什么信息，从 KV 库取对应字段注入（如问订单就注入订单历史，问偏好就注入偏好），精准且省 token。代价是"取的逻辑要写好"（判断当前 query 需要哪些实体），取错了仍会漏信息。优化：用 LLM 做"实体需求判断"（根据 query 决定取哪些实体），或用规则（query 命中关键词则取对应实体）。

**Q：为什么不直接用长窗口模型 + 不做任何压缩（让模型自己处理长上下文），架构最简单？**

长窗口模型的"自己处理"不可靠且贵。前面说了 lost-in-the-middle（中间信息注意力弱），模型对 50k token 的上下文处理质量远低于 5k token（关键信息可能在中间被忽略）。且长上下文延迟高（Prefill 时间随 token 数线性增长，50k token 的首 token 延迟可能 5-10 秒），用户体验差。成本上，每次请求都传 50k token，API 费用是短上下文的 10 倍。架构简单但运营成本和质量都差。正确做法是"主动压缩到模型能高效处理的长度"（如 8k-16k token），让模型在高质量区间运行，而非依赖长窗口"硬扛"。

### 第五层：验证与沉淀

**Q：你怎么衡量上下文管理方案的效果，证明摘要压缩没丢关键信息？**

定义指标：一是信息保留率（information_retention）——用 golden set（标注历史中的关键信息点），检查压缩后上下文是否包含这些点，保留率应 >90%；二是任务表现（task_success_rate）——压缩前后在多轮对话测试集上的成功率对比，压缩后不应显著下降（<3%）；三是 token 消耗（avg_tokens_per_turn）——压缩应降低 token 消耗（如从 20000 降到 5000）；四是延迟（TTFT）——压缩应降低 Prefill 时间。关键测试：构造"长周期对话"（20+ 轮，关键信息分散在各轮），看压缩后 Agent 是否仍能正确引用早期信息。A/B 测试：对照组（滑动窗口截断）vs 实验组（摘要压缩），看用户满意度（CSAT）和重复提问率（用户反复问同样问题说明信息丢了）。

**Q：上下文管理方案怎么沉淀成 Agent 框架的标配？**

封装成"上下文管理器"：支持多种策略（滑动窗口/摘要压缩/检索增强/实体注入）可配置组合，自动监控上下文长度触发压缩（如超过 80% 窗口容量时压缩）。沉淀"各场景的压缩策略配置"（客服用摘要 + 实体库、代码助手用检索 + 近期原文）、"摘要 prompt 模板"（结构化摘要：意图/决策/待办/约束）、"实体库 schema 设计规范"。配套监控（信息保留率、token 消耗、任务成功率），异常（保留率骤降/用户重复提问率涨）告警。把"上下文管理"作为 Agent 的核心组件，而非事后补丁。

## 结构化回答



**30 秒电梯演讲：** 就像开会做笔记——不是把每个人说的每句话都记下来，而是提炼关键决策、遗忘闲聊、重要细节单独标注，让有限的笔记本发挥最大价值

**展开框架：**
1. **滑动窗口** — 只保留最近N轮对话
2. **摘要压缩** — 用LLM对历史对话生成摘要
3. **选择性遗忘** — 根据相关性丢弃低价值信息

**收尾：** 摘要本身也可能丢失信息，怎么保证摘要质量？




## 视频脚本

> 预计时长：4 分钟 | 由浅入深


| 时间 | 画面/字幕 | 口播台词 | 讲解要点 |
|------|----------|----------|----------|
| 0:00 | 标题卡：Agent上下文窗口满了怎么办？有哪些压缩方式？ | "就像开会做笔记——不是把每个人说的每句话都记下来，而是提炼关键决策、遗忘闲聊、重要细节单独…" | 开场钩子 |
| 0:20 | 核心概念图 | "上下文窗口满了时，通过摘要压缩、选择性遗忘、分层记忆等策略在有限Token内保留最关键的信息" | 核心定义 |
| 0:50 | 滑动窗口示意图 | "滑动窗口——只保留最近N轮对话" | 要点拆解1 |
| 1:30 | 对比/实战案例图 | "对比一下常见误区和工程实践，看真实场景里怎么取舍。" | 实战与对比 |
| 2:20 | 总结卡 | "记住核心要点。下期我们追问：摘要本身也可能丢失信息，怎么保证摘要质量？" | 收尾与钩子 |
