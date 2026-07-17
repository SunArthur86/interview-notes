---
id: note-bg-011
difficulty: L4
category: ai
subcategory: Agent框架
tags:
- 八股总结
- 面经
- 上下文管理
- 上下文压缩
- Claude Code
- 长上下文
feynman:
  essence: Agent上下文溢出时，策略有：截断（丢弃旧消息）、摘要（压缩历史）、选择性保留（保留关键信息）。工具返回结果太长时同理。不能轻易压缩的是：系统指令、当前任务、关键决策点、未完成的工具调用依赖。
  analogy: 像开会做笔记——会议太长笔记本写满时，你会：丢掉闲聊（截断）、把长讨论总结成要点（摘要）、但绝不能丢掉"会议目标"和"待办事项"（关键信息）。工具返回的长报告，你会提炼关键结论而非全文记录。
  first_principle: Agent上下文的核心价值是"维持任务连贯性"。溢出处理的本质是"信息保真度vs空间限制"的权衡——必须保留对当前决策有关键影响的上下文，可以损失细节但不能损失任务主线。Claude Code类系统的做法是"分层管理+智能检索"。
  key_points:
  - 溢出处理：截断/摘要/选择性保留/外部记忆
  - 工具结果太长：裁剪关键部分 or 摘要 or 存外部按需检索
  - 不能压缩：系统指令、当前任务、关键决策、工具调用契约
  - Claude Code等：分层上下文 + 自动摘要 + 文件系统作为外部记忆
first_principle:
  essence: 上下文窗口是有限的注意力资源，必须分配给"对当前决策最有价值的信息"
  derivation: LLM的注意力是softmax，上下文越长，每个token的注意力权重越分散（attention dilution）。即使窗口没满，过长上下文也会导致"中间遗忘"(lost in the middle)。因此上下文管理不仅是"装不装得下"，更是"注意力分配优化"。
  conclusion: 上下文管理 = 空间管理(防溢出) + 注意力管理(防稀释) + 连贯性管理(防遗忘)
follow_up:
- 如何检测上下文即将溢出？提前还是事后处理？
- 摘要会不会丢失关键信息？如何保证？
- RAG和上下文压缩有什么关系？
memory_points:
- 截断策略：丢弃最早消息，保系统设定和近期对话，可按角色智能优先丢弃
- 摘要压缩：把老旧历史用LLM总结为几百字概要，并拼接近期几轮原始对话
- 工具超长：调用前限制返回长度，或用LLM先抽取关键信息再喂回上下文
- 分层管理：核心区常驻不变，摘要区折叠历史，临时区存工具结果随用随丢
---

# 【八股总结】Agent 上下文窗口溢出怎么办？工具结果太长如何处理？

## 一、上下文溢出问题

### 1.1 为什么要管理上下文

```python
# 现代LLM的上下文窗口
models = {
    "GPT-4 Turbo": 128_000,      # ~100万字
    "Claude 3.5 Sonnet": 200_000, # ~150万字
    "Gemini 1.5 Pro": 2_000_000, # ~1500万字
    "LLaMA 3": 8_000,            # 较短
}

# 即使窗口很大，Agent场景仍会溢出：
# - 多轮对话积累
# - 工具返回大量数据
# - 代码库分析（整个项目）
# - 长文档处理

# 更关键的问题：即使不溢出，性能也会下降
# "Lost in the Middle"现象：
# - 上下文中间的信息容易被忽略
# - 注意力被稀释
# - 准确率随长度下降
```

### 1.2 上下文溢出的典型场景

```python
# 场景1：Agent多轮对话累积
context_growth = {
    "turn_1": system_prompt(2000) + user_msg(100) + response(500),
    "turn_2": + user_msg(100) + response(800),
    "turn_10": + tool_result(5000) + response(1000),  # 工具返回大
    "turn_20": context已超50K tokens，
    "turn_50": 接近窗口上限
}

# 场景2：工具返回超长结果
# 搜索引擎返回100条结果，每条500 tokens → 50K tokens
# 数据库查询返回1000行记录 → 巨量
# 代码分析读取整个文件 → 可能数万token

# 场景3：代码项目分析
# 一个中型项目可能有100个文件，每个1000行
# 全部塞入上下文 = 数百万token
```

## 二、溢出处理策略

### 2.1 策略1：截断（Truncation）

```python
def simple_truncation(messages, max_tokens):
    """最简单：丢弃最早的消息"""
    while count_tokens(messages) > max_tokens:
        # 保留system prompt和最近的对话
        if len(messages) > 2:
            # 丢弃第二条（最早的user消息）
            messages.pop(1)  # 保留[0]=system
        else:
            break
    return messages

# 问题：丢失早期重要信息（如任务定义、用户偏好）
# 改进：智能截断
def smart_truncation(messages, max_tokens, preserve_keys):
    """保留关键消息，截断次要的"""
    important = []
    disposable = []

    for msg in messages:
        if msg.type in preserve_keys:  # ["system", "task_definition", "tool_contract"]
            important.append(msg)
        elif msg.type == "casual_chat":
            disposable.append(msg)
        else:
            disposable.append(msg)

    # 先丢弃闲聊
    while count_tokens(important + disposable) > max_tokens and disposable:
        disposable.pop(0)  # 丢最早的

    return important + disposable
```

### 2.2 策略2：摘要压缩（Summarization）

```python
def summarize_history(messages, llm):
    """把旧对话压缩成摘要"""
    old_messages = messages[:-4]  # 保留最近4轮
    recent = messages[-4:]

    # 用LLM摘要旧对话
    summary = llm.generate(f"""
    总结以下对话的关键信息，用于后续对话参考：

    {format_messages(old_messages)}

    输出格式：
    - 任务目标：...
    - 已完成步骤：...
    - 关键决策：...
    - 用户偏好：...
    - 待解决问题：...
    """, max_tokens=500)

    return [
        {"role": "system", "content": f"对话历史摘要：\n{summary}"},
        *recent,  # 保留最近的原始对话
    ]

# 效果：50K历史 → 500token摘要 + 最近4轮
# 信息损失：细节丢失，但主线保留
```

### 2.3 策略3：分层上下文管理

```python
class HierarchicalContextManager:
    """Claude Code类系统的分层管理"""

    def __init__(self):
        # L0：永久保留（核心）
        self.permanent = {
            "system_prompt": "...",      # 系统指令
            "task_definition": "...",    # 当前任务
            "tool_schemas": [...],       # 工具定义
            "user_preferences": {...},   # 用户偏好
        }

        # L1：当前活跃（最近N轮）
        self.active_window = []  # 最近5-10轮原始对话

        # L2：压缩存档（摘要）
        self.compressed_history = []  # 旧对话的摘要

        # L3：外部记忆（文件/数据库）
        self.external_memory = FileSystemMemory()  # 长期信息存文件

    def add_message(self, msg):
        self.active_window.append(msg)

        # 活跃窗口满了，压缩最旧的到L2
        if count_tokens(self.active_window) > ACTIVE_LIMIT:
            oldest = self.active_window[:3]
            summary = self.summarize(oldest)
            self.compressed_history.append(summary)
            self.active_window = self.active_window[3:]

        # 压缩历史也满了，转存L3
        if count_tokens(self.compressed_history) > COMPRESSED_LIMIT:
            self.archive_to_external(self.compressed_history)
            self.compressed_history = []

    def build_prompt(self):
        """构建发给LLM的上下文"""
        return [
            self.permanent["system_prompt"],
            f"历史摘要：{format_summaries(self.compressed_history)}",
            *self.active_window,
        ]
```

### 2.4 策略4：外部记忆 + 按需检索（RAG思路）

```python
class ExternalMemoryAgent:
    """把上下文存外部，需要时检索"""

    def __init__(self):
        self.memory_store = VectorStore()  # 向量数据库

    def remember(self, content, metadata=None):
        """存入长期记忆"""
        self.memory_store.add({
            "content": content,
            "embedding": embed(content),
            "metadata": metadata,
            "timestamp": now(),
        })

    def recall(self, query, top_k=5):
        """按需检索相关记忆"""
        return self.memory_store.search(
            embedding(query), top_k=top_k
        )

    def respond(self, user_msg):
        # 1. 检索相关历史
        relevant = self.recall(user_msg, top_k=3)

        # 2. 只把相关记忆+当前问题放入上下文
        context = [
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "system", "content": f"相关记忆：{relevant}"},
            {"role": "user", "content": user_msg},
        ]
        # 上下文很短，不会溢出

        response = self.llm.chat(context)

        # 3. 把这次交互存入记忆
        self.remember(f"User: {user_msg}\nAssistant: {response}")
        return response
```

## 三、工具返回结果太长的处理

### 3.1 工具返回的典型情况

```python
# 工具返回的数据量差异巨大
tool_returns = {
    "weather_api": 50,           # tokens，小
    "calculator": 10,            # 极小
    "web_search": 5000,          # 大（多条结果）
    "database_query": 50000,     # 很大（大量记录）
    "file_read": 100000,         # 巨大（整个文件）
    "git_log": 200000,           # 超大（完整历史）
}
```

### 3.2 处理策略决策树

```python
def handle_tool_result(tool_name, result, context_remaining):
    """根据结果大小选择处理策略"""
    result_tokens = count_tokens(result)
    budget = context_remaining * 0.5  # 最多占用一半剩余空间

    if result_tokens < budget * 0.1:
        # 很小：直接用
        return result

    elif result_tokens < budget:
        # 中等：裁剪关键部分
        return self.smart_extract(result, tool_name)

    elif result_tokens < budget * 5:
        # 较大：摘要
        return self.summarize_result(result, tool_name)

    else:
        # 极大：存外部，返回索引
        return self.archive_and_return_pointer(result, tool_name)
```

### 3.3 各策略详解

#### 裁剪（Smart Extract）

```python
def smart_extract(result, tool_type):
    """按工具类型裁剪"""
    if tool_type == "web_search":
        # 只保留标题+摘要，丢弃全文
        return [{
            "title": r.title,
            "snippet": r.snippet[:200],  # 摘要前200字
            "url": r.url,
        } for r in result[:5]]  # 只取前5条

    elif tool_type == "database_query":
        # 只保留schema + 前几行样本 + 统计信息
        return {
            "schema": result.schema,
            "sample_rows": result.rows[:3],
            "total_count": len(result.rows),
            "column_stats": result.stats,
        }

    elif tool_type == "file_read":
        # 只保留结构概要 + 关键函数
        return {
            "file_structure": extract_structure(result),
            "imports": extract_imports(result),
            "key_functions": extract_functions(result)[:5],
        }
```

#### 摘要（Summarize）

```python
def summarize_result(result, tool_type):
    """用LLM摘要工具结果"""
    summary = llm.generate(f"""
    这是一个{tool_type}的返回结果。请提取关键信息：

    {result[:8000]}  # 截断输入到LLM能处理

    输出格式：
    - 主要内容：...
    - 关键数据：...
    - 与任务相关的信息：...
    """, max_tokens=500)
    return summary
```

#### 归档+指针（Archive + Pointer）

```python
def archive_and_return_pointer(result, tool_type):
    """极长结果存文件，上下文只放指针"""
    file_id = save_to_filesystem(result)

    return f"""
    [{tool_type}返回结果过大({count_tokens(result)}tokens)，已存档]
    文件ID: {file_id}
    摘要: {quick_summary(result)}
    如需查看详情，调用 read_archive(file_id="{file_id}", section="...")
    """
    # Agent需要详情时，再调read_archive按需读取特定部分
```

## 四、哪些上下文不能轻易压缩

### 4.1 绝对不能丢的信息

```python
NON_COMPRESSIBLE = {
    # 1. 系统指令（定义Agent身份和行为边界）
    "system_prompt": "You are a coding assistant...",

    # 2. 当前任务定义（用户的核心诉求）
    "task_definition": "重构这个函数，使其支持异步调用",

    # 3. 工具调用契约（工具的schema和返回格式）
    "tool_schemas": [{"name": "search", "params": {...}}],

    # 4. 关键决策点（已确定的方案选择）
    "key_decisions": "用户确认使用PostgreSQL而非MySQL",

    # 5. 用户显式偏好
    "preferences": "用户要求用Python 3.12，遵循PEP8",

    # 6. 未完成的工具调用依赖
    "pending_tool_state": "上次调用了db_query，结果待处理",

    # 7. 错误上下文（正在debug的问题）
    "error_context": "当前在解决ImportError: no module named 'xxx'",
}
```

### 4.2 可以压缩/丢弃的信息

```python
COMPRESSIBLE = {
    # 1. 闲聊/寒暄
    "small_talk": "你好/谢谢/再见",

    # 2. 已完成的中间步骤
    "completed_steps": "（已搜索/已计算，保留结果即可）",

    # 3. 工具返回的原始大块数据
    "raw_tool_output": "（保留摘要，丢原文）",

    # 4. 重复的确认信息
    "redundant_confirmations": "（用户多次确认同一件事）",

    # 5. 失败的尝试记录
    "failed_attempts": "（保留教训，丢弃详细轨迹）",
}
```

## 五、Claude Code 类系统的上下文管理

```python
class ClaudeCodeContextManager:
    """Claude Code（Anthropic的CLI Agent）的实际做法"""

    def __init__(self, workspace):
        self.workspace = workspace  # 文件系统作为外部记忆

        # 上下文分层
        self.layers = {
            "persistent": self.load_persistent(),  # CLAUDE.md等
            "session": [],       # 当前会话
            "file_cache": {},    # 已读文件的缓存
        }

    def manage_context(self):
        """自动上下文管理"""
        total = self.count_all_tokens()

        if total > WARNING_THRESHOLD:  # 80%
            # 自动触发压缩
            self.auto_compress()

        if total > CRITICAL_THRESHOLD:  # 95%
            # 紧急压缩
            self.emergency_compress()

    def auto_compress(self):
        """自动摘要旧对话"""
        old_session = self.layers["session"][:-5]
        recent = self.layers["session"][-5:]

        summary = self.llm.summarize(old_session)
        self.layers["session"] = [
            {"role": "system", "content": f"[历史摘要] {summary}"},
            *recent,
        ]

    def read_file_smartly(self, filepath):
        """智能读文件：不全读，按需"""
        if filepath in self.layers["file_cache"]:
            return self.layers["file_cache"][filepath]

        file_size = os.path.getsize(filepath)
        if file_size > LARGE_FILE_THRESHOLD:
            # 大文件：先读结构
            structure = self.read_file_structure(filepath)
            self.layers["file_cache"][filepath] = structure
            return structure  # 后续按需读具体部分
        else:
            content = read_file(filepath)
            self.layers["file_cache"][filepath] = content
            return content

    def write_memory(self, key, value):
        """把重要信息写入文件系统（持久记忆）"""
        path = f"{self.workspace}/.agent_memory/{key}.md"
        write_file(path, value)
        # 下次会话可以读到，实现跨会话记忆
```

## 加分点

1. **提到"Lost in the Middle"现象**：即使不溢出，长上下文也会导致性能下降，体现深度理解
2. **文件系统作为外部记忆**：Claude Code/Cursor等IDE Agent的真实做法
3. **分层管理思维**：永久层/活跃层/压缩层/外部层，不是一刀切

## 雷区

- **简单截断丢任务定义**：把最重要的"用户要做什么"截掉了，Agent失去方向
- **忽视工具结果的格式契约**：压缩了工具返回，导致模型不知道如何解析
- **过度依赖RAG**：检索式记忆有召回率问题，关键信息可能检索不到

## 扩展

- **Lost in the Middle**：Liu et al. 2023，长上下文性能下降的经典论文
- **Claude Code的设计**：Anthropic公开分享了其上下文管理策略
- **MemGPT**：用OS的虚拟内存思想管理LLM上下文，分层+分页
- **Cursor的上下文管理**：代码索引 + 相关性检索 + 智能裁剪

## 记忆要点

- 截断策略：丢弃最早消息，保系统设定和近期对话，可按角色智能优先丢弃
- 摘要压缩：把老旧历史用LLM总结为几百字概要，并拼接近期几轮原始对话
- 工具超长：调用前限制返回长度，或用LLM先抽取关键信息再喂回上下文
- 分层管理：核心区常驻不变，摘要区折叠历史，临时区存工具结果随用随丢


## 苏格拉底式面试追问

> 这组追问模拟面试官层层逼问，每一问先回答"为什么"，再回答"怎么做"，最后回答"如何证明"。

### 第一层：目标与动机

**Q：Agent 上下文窗口现在都 128K/200K 了，为什么还要做上下文管理？直接全塞进去不行吗？**

塞不进去也不该塞。1）窗口有上限——复杂 Agent 任务（多轮工具调用+长文档分析+代码库遍历）很容易超过 200K，硬塞会 OOM 或截断。2）即使塞得下，attention dilution 导致"中间遗忘"（lost in the middle）——斯坦福研究显示，长上下文中间信息的召回率比首尾低 20-30%。3）成本和延迟——上下文越长，prefill 计算量 O(n²) 增长，128K context 的 prefill 要几秒、API 按 token 计费成本翻倍。所以上下文管理不是"装不装得下"，是"注意力资源的最优分配"——把窗口留给当前决策最有价值的信息。

### 第二层：证据与定位

**Q：你怎么检测 Agent 的上下文"即将溢出"或"已经稀释"？是事后发现还是提前预警？**

提前预警 + 实时监控。1）token 计数——每轮拼 context 前算总 token 数，超过窗口的 80%（如 128K 窗口的 100K）触发压缩流程；2）attention 分析——用 interpretability 工具（如 attention rollout）看模型对历史各轮的 attention 权重，如果早期轮次权重接近 0，说明已被稀释（即使没溢出）；3）效果信号——如果 Agent 开始"忘记"早期约束（如重复问已回答的问题、违反 system prompt 的规则），是上下文稀释的行为信号。实务上以 token 计数为主（简单可靠），attention 分析为辅（研发用），行为信号做兜底告警。

### 第三层：根因深挖

**Q：上下文要压缩时，哪些信息绝对不能丢，哪些可以放心截断？**

不能丢的四类：1）系统指令（system prompt）——定义 Agent 角色和约束，丢了 Agent 失忆；2）当前任务和用户最新意图——丢了答非所问；3）关键决策点（如已选择的方案、已排除的选项）——丢了重复探索；4）未完成的工具调用依赖（如刚调了工具还没用结果）——丢了逻辑断裂。可以放心截断的：冗余的中间 Thought（只保留结论）、已用完的工具返回全文（保留摘要）、寒暄和重复确认。判断原则：保留"因果关系链"上的关键节点，截断"过程细节"——类似人类开会只记决议不记每句话。

**Q：摘要压缩历史会丢失关键信息，你怎么保证摘要没把重要细节丢了？**

三层保障。1）结构化摘要——不是让 LLM 自由摘要，而是用固定 schema（如"本轮目标/关键发现/决策/待办"），强制保留关键信息；2）关键信息抽取前置——摘要前先用规则/LLM 抽取"必须保留的实体"（如文件路径、数值结果、用户明确要求），摘要后再校验这些实体是否都在，丢了就补回；3）外部记忆兜底——把原始历史存到向量库/文件系统，摘要里只放索引（如"详见 memory_store/turn_5.md"），Agent 需要细节时按需检索回填。这样即使摘要丢了细节，也能通过外部记忆找回，不会永久丢失。实测这套组合能让关键信息保留率从自由摘要的 70% 提到 95%+。

### 第四层：方案权衡

**Q：工具返回结果太长（如搜索返回 5000 token、代码库 read 返回整文件），你有哪些处理策略？**

分场景处理：1）搜索结果——只取 top-3 的摘要（snippet），不要全文，用 LLM 做"答案抽取"（让 LLM 从搜索结果里提取与问题相关的几句）再喂回 context；2）代码文件——先读结构（AST/目录树），按需读具体函数，不要一次 read 整文件（Claude Code 的做法）；3）长文档——分块读，每块摘要，多轮渐进式获取细节；4）通用策略——工具返回时自带"裁剪逻辑"（如 API 支持 limit/fields 参数），从源头控制返回长度。核心思想是"按需获取"而非"全量加载"——Agent 应该像人类查资料一样先看目录再看章节，而不是把整本书塞进脑子。

**Q：为什么不直接用支持无限上下文的模型（如 Gemini 的 1M context）或 RAG 替代上下文管理？**

两个方案各有局限。1）超长上下文模型——1M context 的 prefill 成本是 128K 的 8 倍，延迟从 2 秒到 15 秒，且 lost-in-the-middle 问题依然存在（1M context 的中间召回率更差），不经济也不可靠。2）RAG——适合"事实检索"（如查文档里某句话），但不适合"连贯对话"——Agent 多轮交互的上下文是有时序和因果关系的，RAG 的相似度检索可能召回无关历史、漏掉关键因果链。上下文管理（分层摘要 + 外部记忆）是介于两者之间的最优解：主 context 保持精简连贯，细节存外部按需检索。所以即使有长窗口和 RAG，仍需要上下文管理做"注意力最优分配"。

### 第五层：验证与沉淀

**Q：你怎么证明上下文管理策略真的提升了 Agent 效果，而不是"压缩了但丢信息导致变差"？**

AB 测试。固定一组复杂任务（如多轮代码调试、长文档问答），对比：1）无压缩（全塞进 context）vs 2）分层摘要压缩 vs 3）外部记忆+按需检索。指标：1）任务成功率——压缩版应持平或更高（如果显著低，说明丢信息了）；2）关键信息保留率——人工检查压缩后的 context 是否包含完成任务必需的信息；3）延迟和成本——压缩版应降低（prefill token 数减少）。最优策略是"任务成功率持平 + 成本降低"的那个。如果压缩版任务成功率掉超过 5%，说明压缩太激进，要调保留策略（如增加关键决策点保留、降低截断阈值）。

**Q：Agent 的上下文管理策略怎么沉淀成团队框架的默认能力，而不是每个项目重新设计？**

封装成框架的 ContextManager 组件：1）分层结构——core 区（system prompt+当前任务，常驻不压缩）、summary 区（历史摘要，滚动更新）、scratch 区（当前工具结果，用完即丢），开发者配每层 token 预算即可；2）压缩触发器——token 达到阈值自动触发摘要，用固定 schema 保证关键信息；3）外部记忆接口——自动把原始历史存到向量库/文件系统，context 里放索引，Agent 主动调 retrieve 工具回填；4）效果监控——内置任务成功率对比（压缩前后），异常告警。这套写入团队 Agent 框架 SOP，让上下文管理从"每个 Agent 手工调"变成"框架默认能力"。

## 结构化回答

**30 秒电梯演讲：** Agent上下文溢出时，策略有：截断（丢弃旧消息）、摘要（压缩历史）、选择性保留（保留关键信息）。工具返回结果太长时同理。不能轻易压缩的是：系统指令、当前任务、关键决策点、未完成的工具调用依赖。

**展开框架：**
1. **溢出处理** — 截断/摘要/选择性保留/外部记忆
2. **工具结果太长** — 裁剪关键部分 or 摘要 or 存外部按需检索
3. **不能压缩** — 系统指令、当前任务、关键决策、工具调用契约

**收尾：** 您想深入聊：如何检测上下文即将溢出？提前还是事后处理？


## 视频脚本

> 预计时长：5 分钟 | 由浅入深


| 时间 | 画面/字幕 | 口播台词 | 讲解要点 |
|------|----------|----------|----------|
| 0:00 | 标题卡：Agent 上下文窗口溢出怎么办？工具结果太长如… | "像开会做笔记——会议太长笔记本写满时，你会：丢掉闲聊（截断）、把长讨论总结成要点（摘要）…" | 开场钩子 |
| 0:20 | 核心概念图 | "Agent上下文溢出时，策略有：截断（丢弃旧消息）、摘要（压缩历史）、选择性保留（保留关键信息）。工具返回结果太长时同理…" | 核心定义 |
| 0:50 | 溢出处理示意图 | "溢出处理——截断/摘要/选择性保留/外部记忆" | 要点拆解1 |
| 1:30 | 工具结果太长示意图 | "工具结果太长——裁剪关键部分 or 摘要 or 存外部按需检索" | 要点拆解2 |
| 2:20 | 对比/实战案例图 | "对比一下常见误区和工程实践，看真实场景里怎么取舍。" | 实战与对比 |
| 3:10 | 总结卡 | "记住核心要点。下期我们追问：如何检测上下文即将溢出？提前还是事后处理？" | 收尾与钩子 |
