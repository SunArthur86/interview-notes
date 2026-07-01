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

