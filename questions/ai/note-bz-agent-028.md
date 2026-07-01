---
id: note-bz-agent-028
difficulty: L3
category: ai
subcategory: Agent
tags:
- B站面经
- 多轮对话
- Token优化
- 成本
feynman:
  essence: 多轮对话Token优化三招——任务拆解(大任务变小任务独立处理)+记忆分层(重要的存、次要的摘要)+滑动窗口(只带最近相关)。核心是"按价值裁剪上下文"。
  analogy: 像出差收拾行李——只带必需品(任务拆解)、重要文件随身记忆分层)、换洗衣物按天数带(滑动窗口)，而不是把整个家搬走。
  first_principle: Token成本∝上下文长度。多轮对话上下文线性增长，但不是所有历史都对当前轮有价值。按价值筛选保留，能大幅降本。
  key_points:
  - 三招：任务拆解+记忆分层+滑动窗口
  - 核心：按信息价值裁剪上下文
  - 进阶：增量计算+缓存复用+模型路由
  - 评估：Token/轮 + 成本/任务
first_principle:
  essence: 上下文中的信息价值是不均匀的——少量关键信息+大量冗余。
  derivation: 每轮对话贡献的信息价值不同（关键决定vs寒暄）。全量保留=为低价值信息买单。按价值筛选，只保留高价值+最近相关，能在保证质量前提下大幅减少Token。
  conclusion: Token优化 = 信息价值评估 + 有损压缩（保留高价值，丢弃低价值）
follow_up:
- 压缩会影响回答质量吗？——会，需平衡压缩率和质量
- 怎么知道哪些该压缩？——LLM评估重要性+用户反馈
- 极限能省多少？——优化好可省50-70%Token
memory_points:
- 因为每轮重发全部历史，所以多轮对话Token成本呈O(n²)级爆炸增长
- 策略1任务拆解：按边界切分子任务独立上下文，实现物理隔绝省Token
- 策略2记忆分层：核心记忆始终留，早期历史转摘要，近期留原文，长尾靠检索
- 对比传统全量加载：分层后上下文仅保留核心+摘要+近期，按需加载外存
---

# 多轮对话越聊越贵，如何优化 Token 成本？

## 一、为什么越聊越贵

```
Token成本 = 输入Token数 × 单价

多轮对话输入Token累积：
  轮次1: [system + u1]              = 200 tokens
  轮次2: [system + u1,a1 + u2]      = 400 tokens
  轮次5: [system + u1...a4 + u5]    = 1000 tokens
  轮次20: [system + u1...a19 + u20] = 4000 tokens
  轮次100: ...                      = 20000 tokens

问题：每轮都要重发全部历史，成本O(n²)增长
  100轮的对话，单轮成本是第1轮的100倍！
```

## 二、优化方法 1：任务拆解

```
策略：把长对话拆成独立子任务，各自独立上下文

┌──────────────────────────────────────────────┐
│  原始：一个长对话，上下文持续累积                │
│  [Q1,A1,Q2,A2,...,Q20,A20] = 4000 tokens     │
├──────────────────────────────────────────────┤
│  拆解：识别独立子任务，各自独立                  │
│  任务1: [Q1,A1,Q3,A3] = 800 tokens（查天气）  │
│  任务2: [Q5,A5,Q8,A8] = 800 tokens（查机票）  │
│  任务3: [Q10,A10,...] = 1000 tokens（订酒店） │
│                                                │
│  总Token：2600（省35%）且各任务上下文更聚焦     │
└──────────────────────────────────────────────┘
```

```python
class TaskDecomposer:
    def decompose_session(self, conversation):
        """把长对话按任务边界拆分"""
        # LLM识别任务边界
        boundaries = self.llm.identify_task_boundaries(conversation)
        # 例: [0-4轮是任务A, 5-12轮是任务B, ...]
        
        subtasks = []
        for start, end in boundaries:
            subtask_convo = conversation[start:end]
            subtasks.append({
                "topic": self.llm.summarize_topic(subtask_convo),
                "conversation": subtask_convo,
                "key_results": self.extract_results(subtask_convo)
            })
        return subtasks
    
    def get_context_for_query(self, query, subtasks):
        """只加载相关子任务的上下文"""
        relevant = self.find_relevant_subtask(query, subtasks)
        return relevant.conversation  # 只带相关的，不带全部
```

## 三、优化方法 2：记忆分层

```
策略：按重要性分层管理历史

┌──────────────────────────────────────────────┐
│  Layer 1: 核心记忆（始终保留，~200 tokens）    │
│    - 用户画像/偏好                            │
│    - 当前任务目标                             │
│    - 关键决定（如"选了方案A"）                 │
├──────────────────────────────────────────────┤
│  Layer 2: 摘要（压缩保留，~300 tokens）       │
│    - 早期对话的要点                           │
│    例: "讨论了天气→机票→酒店，已订北京机票"   │
├──────────────────────────────────────────────┤
│  Layer 3: 最近原文（~500 tokens）             │
│    - 最近2-3轮完整对话                        │
├──────────────────────────────────────────────┤
│  Layer 4: 检索记忆（按需加载）                 │
│    - 存外部，相关时才召回                      │
└──────────────────────────────────────────────┘

总上下文：~1000 tokens（而非全量4000+）
```

```python
class TieredMemory:
    def __init__(self):
        self.core = {}        # 核心（小，始终在）
        self.summary = ""     # 摘要（中，压缩）
        self.recent = []      # 最近（小，原文）
        self.archive = VectorDB()  # 归档（大，检索）
    
    def add_turn(self, turn):
        self.recent.append(turn)
        
        # 最近窗口满了，旧的进入摘要
        if len(self.recent) > 6:
            old = self.recent.pop(0)
            # 判断重要性
            if self.is_critical(old):
                self.core.update(self.extract_facts(old))  # 进核心
            else:
                self.summary = self.update_summary(self.summary, old)  # 进摘要
                self.archive.add(old)  # 也存归档
    
    def get_context(self, query):
        ctx = []
        if self.core:
            ctx.append({"role": "system", "content": f"核心: {self.core}"})
        if self.summary:
            ctx.append({"role": "system", "content": f"摘要: {self.summary}"})
        # 按需检索归档
        if relevant := self.archive.search(query, top_k=2):
            ctx.append({"role": "system", "content": f"相关: {relevant}"})
        ctx.extend(self.recent)
        return ctx
```

## 四、优化方法 3：滑动窗口 + 增量摘要

```python
class SlidingWindowWithSummary:
    """滑动窗口+滚动摘要，控制上下文长度"""
    
    WINDOW_SIZE = 6  # 保留最近3轮原文
    MAX_SUMMARY_TOKENS = 300
    
    def __init__(self):
        self.summary = ""
        self.window = []
    
    def add(self, turn):
        self.window.append(turn)
        if len(self.window) > self.WINDOW_SIZE:
            # 窗口满，最旧的轮次并入摘要
            old = self.window.pop(0)
            self.summary = self.compress(self.summary, old)
            # 摘要超长时二次压缩
            if count_tokens(self.summary) > self.MAX_SUMMARY_TOKENS:
                self.summary = self.compress_summary(self.summary)
    
    def compress(self, existing_summary, new_turn):
        """增量摘要：把新轮次并入现有摘要"""
        return self.llm.summarize(
            f"现有摘要: {existing_summary}\n"
            f"新对话: {new_turn}\n"
            f"更新摘要（不超过{self.MAX_SUMMARY_TOKENS}token，保留关键信息）"
        )
```

## 五、进阶优化：缓存与复用

### 语义缓存

```python
class SemanticCache:
    """相似问题复用历史回答"""
    
    async def get_or_compute(self, query, context_hash):
        # 用(查询+上下文指纹)做key
        key = f"{embed(query)[:8]}_{context_hash}"
        
        if cached := await self.redis.get(key):
            return cached  # 命中，省一次LLM调用
        
        result = await self.llm.chat(query)
        await self.redis.setex(key, 3600, result)
        return result
```

### Prompt 缓存（Prompt Caching）

```python
# 利用Anthropic/OpenAI的Prompt Caching
response = client.messages.create(
    model="claude-3",
    system=[{
        "type": "text",
        "text": LONG_SYSTEM_PROMPT,  # 不变的部分
        "cache_control": {"type": "ephemeral"}  # 标记缓存
    }],
    messages=variable_messages  # 变化的部分
)
# 缓存命中时，system部分按缓存价计费（便宜10倍）
```

### 模型路由

```python
def route_model(query, history_length):
    """按复杂度和上下文长度选模型"""
    if history_length < 1000 and is_simple(query):
        return "cheap_model"   # 简单+短上下文 → 便宜模型
    return "strong_model"      # 复杂 → 强模型
```

## 六、优化效果对比

```
┌──────────────────┬─────────┬────────┬────────┐
│ 方法              │ 100轮Token│ 相对成本 │ 质量影响 │
├──────────────────┼─────────┼────────┼────────┤
│ 全量上下文(基线)   │ ~20000   │ 100%    │ 最佳    │
│ 滑动窗口(最近5轮)  │ ~2000    │ 10%     │ 丢早期  │
│ 滑动+摘要         │ ~2500    │ 12%     │ 轻微    │
│ 分层记忆          │ ~1500    │ 7%      │ 小      │
│ 任务拆解          │ ~2600    │ 13%     │ 小      │
│ 分层+任务拆解+缓存 │ ~800     │ 4%      │ 中      │
└──────────────────┴─────────┴────────┴────────┘

经验：组合优化可省70-90%成本，但需平衡质量
```

## 七、面试加分点

1. **强调"按价值裁剪"**：不是盲目省，而是评估信息价值，保留高价值的
2. **组合拳最有效**：单一方法效果有限，分层+拆解+缓存组合最优
3. **提"Prompt Caching"**：厂商原生支持的缓存，零质量损失省钱，必提

## 记忆要点

- 因为每轮重发全部历史，所以多轮对话Token成本呈O(n²)级爆炸增长
- 策略1任务拆解：按边界切分子任务独立上下文，实现物理隔绝省Token
- 策略2记忆分层：核心记忆始终留，早期历史转摘要，近期留原文，长尾靠检索
- 对比传统全量加载：分层后上下文仅保留核心+摘要+近期，按需加载外存

