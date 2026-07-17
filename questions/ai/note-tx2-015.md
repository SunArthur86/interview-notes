---
id: note-tx2-015
difficulty: L2
category: ai
subcategory: 算法
tags:
- 腾讯
- 面经
- 滑动窗口
- 上下文管理
- 算法题
feynman:
  essence: 滑动窗口实现长对话自动摘要截断，控制总 token 上限——维护一个窗口，新消息进来如果总 token 超限，就把最旧的几条摘要成一条再保留。用 deque 维护消息队列，tokenizer 计算 token 数，超限时摘除最旧的 + LLM 摘要 + 插入摘要。关键是"边淘汰边摘要"，保证不丢关键信息又能控 token。
  analogy: 像一个只能装10页的文件夹——新文件来了，文件夹满了，就把最旧的几页拍照压缩成一张摘要页放回去，腾出空间放新文件。这样既不会爆，又保留了历史要点。
  first_principle: LLM context window 有限。长对话要么截断（丢信息）要么摘要（压缩信息）。滑动窗口+摘要结合：窗口保留近期原文，窗口外的摘要成压缩版，平衡"近期细节"和"长期要点"。
  key_points:
  - 维护消息deque，tokenizer算每条token数
  - 超限时摘除最旧几条 + LLM摘要 + 插入摘要消息
  - 保留近期原文(细节)，旧的摘要(压缩)
  - token计算用tiktoken(精确)或字符数/4(估算)
  - '摘要触发时机: 总token>阈值(如80%上限)'
first_principle:
  essence: 长对话管理 = 截断 + 摘要的平衡
  derivation: context有限 → 全保留会爆 → 截断丢信息 → 摘要压缩信息 → 滑动窗口近期保留原文 + 旧的摘要 → 平衡
  conclusion: 不是简单"砍掉旧的"，而是"旧的压缩成摘要"，关键信息不丢
follow_up:
- 摘要本身也占 token，怎么避免"摘要越积越多"？
- 怎么决定摘多少条、留多少条？
- 用 tokenizer 精确算 token 还是估算？
memory_points:
- 核心机制：保留近期Keep_recent条原文，一旦总Token超限，立即触发滑动窗口摘要最旧消息
- 摘要策略：每次从队首批量取N条旧消息，LLM压缩成一条系统摘要插回队首
- 数据结构：双端队列管理动态上下文，滑动更新实现历史信息的有损压缩
---

# 【某讯面经】算法题：滑动窗口实现长对话自动摘要截断，控制总 token 上限

## 一、题目要求

实现一个滑动窗口，对长对话自动摘要截断：
- 维护对话历史，总 token 不超上限（如 8000）
- 超限时自动把最旧的几条摘要成一条
- 保留近期消息原文，旧的压缩成摘要

## 二、核心实现

```python
from collections import deque
import tiktoken

class ConversationWindow:
    def __init__(self, max_tokens=8000, keep_recent=6, summarize_batch=4):
        """
        max_tokens: 总 token 上限
        keep_recent: 保留最近 N 条原文
        summarize_batch: 每次摘要多少条旧消息
        """
        self.messages = deque()  # 消息队列
        self.max_tokens = max_tokens
        self.keep_recent = keep_recent
        self.summarize_batch = summarize_batch
        self.encoding = tiktoken.encoding_for_model("gpt-4")
    
    def count_tokens(self, text):
        return len(self.encoding.encode(text))
    
    def total_tokens(self):
        return sum(self.count_tokens(m['content']) for m in self.messages)
    
    def add_message(self, role, content):
        """添加新消息，超限自动摘要"""
        self.messages.append({"role": role, "content": content})
        self._maybe_summarize()
    
    def _maybe_summarize(self):
        """超限时摘要最旧的消息"""
        while self.total_tokens() > self.max_tokens:
            # 保留最近 keep_recent 条，其余的摘要
            if len(self.messages) <= self.keep_recent:
                # 连最近的消息都超了，强制摘要最旧的
                if len(self.messages) <= 1:
                    break  # 只剩一条，没法再摘要
            
            # 取最旧的 summarize_batch 条
            to_summarize = []
            for _ in range(min(self.summarize_batch, 
                              len(self.messages) - self.keep_recent + 1)):
                if self.messages:
                    to_summarize.append(self.messages.popleft())
            
            # LLM 摘要
            summary = self._summarize(to_summarize)
            
            # 摘要作为 system 消息插回队首
            self.messages.appendleft({
                "role": "system",
                "content": f"[历史摘要] {summary}"
            })
    
    def _summarize(self, messages):
        """用 LLM 摘要一组消息"""
        conversation = "\n".join(
            f"{m['role']}: {m['content']}" for m in messages
        )
        prompt = f"""请将以下对话压缩成简洁摘要，保留关键信息（用户意图、已解决的问题、重要结论），不超过200字：

{conversation}

摘要："""
        return llm.invoke(prompt)
    
    def get_context(self):
        """获取当前对话上下文（喂给 LLM）"""
        return list(self.messages)
```

## 三、工作流程示例

```
初始: messages = []
  ↓ 用户不断对话
messages = [m1, m2, m3, m4, m5, m6, m7, m8, m9, m10]
total_tokens = 12000 > 8000 上限

触发摘要:
  保留最近 keep_recent=6 条: [m5, m6, m7, m8, m9, m10]
  摘要最旧 summarize_batch=4 条: [m1, m2, m3, m4]
  → LLM 摘要成 summary_1
  → 插回队首

结果:
messages = [
  {system: "[历史摘要] summary_1"},
  m5, m6, m7, m8, m9, m10
]
total_tokens = 5000 < 8000 ✓

继续对话... 再次超限时，summary_1 可能被进一步摘要
```

## 四、关键设计点

### 1. token 计算
```python
# 精确：用 tiktoken（OpenAI 模型专用）
encoding = tiktoken.encoding_for_model("gpt-4")
tokens = len(encoding.encode(text))

# 估算：字符数 / 4（英文）或 / 1.5（中文）
estimated_tokens = len(text) // 4  # 粗略
```

不同模型 tokenizer 不同，用对应模型的 tiktoken 编码。

### 2. 保留策略
```
keep_recent（保留原文）的选择：
  - 太小（如2）：近期上下文不够，答非所问
  - 太大（如20）：原文占满，摘要空间不够
  - 经验：6-10 条（约 2-3 轮对话）
```

### 3. 摘要质量
```
摘要 prompt 要明确"保留什么"：
  ✅ 用户意图、已解决的问题、重要结论、关键决策
  ❌ 寒暄、重复内容、无关细节
```

### 4. 摘要累积问题
```
问题：多次摘要后，摘要越积越多，又超限
解法：
  - 摘要再摘要（summary of summary）
  - 或限制摘要条数（最多 N 条 system 摘要）
  - 或定期归档（旧摘要转存，不进 context）
```

## 五、变种：分层摘要

```python
class HierarchicalWindow:
    """分层摘要：近期原文 → 短期摘要 → 长期摘要"""
    def __init__(self):
        self.recent = deque(maxlen=6)        # 最近6条原文
        self.short_summary = None             # 短期摘要（最近20条）
        self.long_summary = None              # 长期摘要（全部历史）
    
    def add_message(self, msg):
        self.recent.append(msg)
        if len(self.recent) == self.recent.maxlen:
            # 满了，触发短期摘要
            self._update_short_summary()
    
    def get_context(self):
        context = []
        if self.long_summary:
            context.append({"role": "system", "content": f"[长期] {self.long_summary}"})
        if self.short_summary:
            context.append({"role": "system", "content": f"[短期] {self.short_summary}"})
        context.extend(self.recent)
        return context
```

## 六、加分点

- 说出 **不是简单截断，而是摘要**：截断丢信息，摘要压缩信息
- 说出 **token 计算要用对应模型的 tokenizer**（tiktoken）
- 说出 **摘要累积问题**：多次摘要越积越多，要分层或定期归档

## 七、雷区

- ❌ 简单 `messages = messages[-10:]` → 丢历史上下文
- ❌ 摘要 prompt 太宽泛 → 摘要丢失关键信息
- ❌ token 估算不准 → 实际超限报错

## 八、扩展

- **Claude 的 auto-compact**：到 90% context window 自动触发，保留近期 N 轮 + 历史摘要
- **prompt cache 配合**：摘要部分（固定）走 cache，近期消息（变化）不走，省成本
- **检索式替代摘要**：不摘要，而是把历史存向量库，每轮按 query 召回相关片段（避免摘要信息损失）

## 记忆要点

- 核心机制：保留近期Keep_recent条原文，一旦总Token超限，立即触发滑动窗口摘要最旧消息
- 摘要策略：每次从队首批量取N条旧消息，LLM压缩成一条系统摘要插回队首
- 数据结构：双端队列管理动态上下文，滑动更新实现历史信息的有损压缩


## 苏格拉底式面试追问

> 这组追问模拟面试官层层逼问，每一问先回答"为什么"，再回答"怎么做"，最后回答"如何证明"。

### 第一层：目标与动机

**Q：滑动窗口摘要截断为什么是"摘要"而不是"直接删除"最旧消息？**

直接删除会丢失关键信息。长对话中，最旧的消息可能包含"用户的核心需求"或"已确认的约束"（如"我要订明天去上海的票"）。直接删除后，Agent 忘了用户要干什么，后续回答跑偏。摘要是"压缩信息密度"——把多条旧消息的核心要点浓缩成一条，保留关键信息、丢弃冗余。本质是"有损压缩但不丢关键"，类似人脑记住"谈话要点"而非"每句原话"。

### 第二层：证据与定位

**Q：摘要截断后 Agent 行为异常（如忘了用户的核心需求），怎么定位是摘要算法丢了信息还是窗口设太小？**

看摘要内容和窗口配置。1) 摘要内容——摘要里是否包含核心需求（如"用户要订去上海的票"），如果没包含，是摘要算法漏了；2) 窗口大小——当前保留的原始消息数是否足够（如只保留最近 2 条，太激进），调大窗口看是否恢复。具体：把摘要前后的 context 对比，看核心信息是否在。用 probe 问题问 Agent "用户的核心需求是什么"，如果答不出，信息丢了。

### 第三层：根因深挖

**Q：摘要算法用 LLM 生成，但 LLM 摘要偶尔漏关键信息，根因是 LLM 能力不够还是摘要 prompt 不够明确？**

通常是摘要 prompt。LLM 摘要时如果没有明确"必须保留什么"，会按"它认为重要"的判断，可能漏掉用户认为关键的信息（如约束、未完成的需求）。根因是"重要性判断主观"。解法：1) 摘要 prompt 明确要求——"必须保留：用户的核心需求、已确认的约束、未完成的子任务、关键决策"；2) 结构化摘要——不生成自然语言段落，而是生成 JSON（{intention, constraints, pending_tasks, decisions}），降低信息丢失。

**Q：那为什么不直接保留所有原始消息（用超长 context 模型），避免摘要损失？**

成本和注意力。超长 context（如 200K）的推理成本是 8K 的 25 倍，且注意力衰减（lost in the middle）。摘要是"主动压缩信息流"，只保留高密度信息，让 LLM 聚焦。即使有超长 context 模型，对话超过一定长度后摘要仍比全量更高效（成本和注意力都优）。所以摘要不是"没有长 context 的妥协"，是"主动的信息管理策略"。

### 第四层：方案权衡

**Q：窗口大小（保留多少条原始消息）设多少合适？摘要触发的 token 阈值怎么定？**

权衡"信息保真 vs token 成本"。窗口太小（如 2 条）——最近信息保真但更早的丢；窗口太大（如 50 条）——token 多但信息全。经验上：保留最近 5-10 条原始消息（覆盖当前任务的上下文），更早的触发摘要。token 阈值：设 context window 的 60-70%（留 30-40% 给输出和新信息），超过即触发摘要。具体按任务调整：短任务（如单轮问答）窗口小，长任务（如多轮客服）窗口大。

**Q：为什么不直接用"摘要 + 全量存外部"（按需召回），而要在 context 里保留原始消息？**

因为最近的原始消息是"必读"的，不能靠概率召回。当前任务的最近几步是决策的关键依据，如果走外部召回（向量检索），召回率不是 100%（可能漏召关键步骤）。所以"最近 N 条原始消息全量保留 + 更早的摘要 + 更久之前的外部召回"是三层策略：最近保真、中间摘要、最久召回。每层的访问模式不同。

### 第五层：验证与沉淀

**Q：怎么衡量滑动窗口摘要的效果？**

三个指标：1) token 效率——摘要后的 token 数 vs 摘要前（应该减少 50%+）；2) 信息保真——摘要后关键信息（用 probe 问题检测）的一致性（应该 > 90%）；3) 任务表现——摘要 vs 不摘要（全量塞）的 task_success_rate（摘要应该不降）。A/B 测试：一组用摘要、一组全量塞（在 token 允许时），对比效果。沉淀为摘要配置规范：窗口大小、token 阈值、摘要 prompt、结构化输出格式。

## 结构化回答

**30 秒电梯演讲：** 滑动窗口实现长对话自动摘要截断，控制总 token 上限——维护一个窗口，新消息进来如果总 token 超限，就把最旧的几条摘要成一条再保留。用 deque 维护消息队列，tokenizer 计算 token 数。

**展开框架：**
1. **维护消息** — 维护消息deque，tokenizer算每条token数
2. **超限时摘除最** — 超限时摘除最旧几条 + LLM摘要 + 插入摘要消息
3. **保留近期原** — 保留近期原文(细节)，旧的摘要(压缩)

**收尾：** 您想深入聊：摘要本身也占 token，怎么避免"摘要越积越多"？


## 视频脚本

> 预计时长：3 分钟 | 由浅入深


| 时间 | 画面/字幕 | 口播台词 | 讲解要点 |
|------|----------|----------|----------|
| 0:00 | 标题卡：算法题：滑动窗口实现长对话自动摘要截断，控制总… | "像一个只能装10页的文件夹——新文件来了，文件夹满了，就把最旧的几页拍照压缩成一张摘要页放…" | 开场钩子 |
| 0:20 | 核心概念图 | "滑动窗口实现长对话自动摘要截断，控制总 token 上限——维护一个窗口，新消息进来如果总 token 超限，就把最旧的…" | 核心定义 |
| 0:55 | 维护消息示意图 | "维护消息——维护消息deque，tokenizer算每条token数" | 要点拆解1 |
| 1:30 | 对比/实战案例图 | "对比一下常见误区和工程实践，看真实场景里怎么取舍。" | 实战与对比 |
