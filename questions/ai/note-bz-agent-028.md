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


## 苏格拉底式面试追问

> 这组追问模拟面试官层层逼问，每一问先回答"为什么"，再回答"怎么做"，最后回答"如何证明"。

### 第一层：目标与动机

**Q：多轮对话越聊越贵（context 越来越长，token 翻倍），你说用"任务拆解+记忆分层+滑动窗口"，为什么不直接限制最大轮数（如最多 20 轮）省事？**

限制最大轮数会切断合法的长任务（如复杂咨询、长代码调试需要 50+ 轮），用户体验差（任务没完成被强制结束）。token 成本问题的根因是"每轮都带全部历史"，治本是"减少每轮携带的历史量"而非"减少轮数"。任务拆解把大任务拆成独立子任务（每个子任务的 context 独立，不累积），记忆分层把历史存外部按需检索（不占 context），滑动窗口只带近期（控制 context 长度）。三招组合能在"不限制轮数"的前提下控制每轮 token 成本，兼顾体验和成本。

### 第二层：证据与定位

**Q：你怎么量化"越聊越贵"的程度？是看每轮 token 数，还是总成本？**

看每轮 token 增长曲线。记录每轮对话的 input token 数（发给 LLM 的 context 大小），画成"轮次 vs token"曲线。健康情况：token 应平稳（不随轮次无限增长），如每轮稳定在 2000-5000 token。不健康：token 线性甚至指数增长（如第 1 轮 1000、第 10 轮 10000、第 50 轮 50000），每轮成本翻倍。总成本 = Σ(各轮 token × 单价)，如果每轮 token 增长，总成本是 O(n²) 级（n 是轮数），非常贵。优化目标：让每轮 token 稳定（O(1)），总成本 O(n) 线性。监控这个曲线，增长率超阈值（如每轮涨 >500 token）告警。

### 第三层：根因深挖

**Q：滑动窗口（只带最近 N 轮）能控制 token，但会丢早期关键约束（如"只查 2024 年"），这个矛盾怎么解决？**

用"约束提取 + 单独保留"补滑动窗口的短板。滑动窗口负责"近期 context 的细节"（带最近 N 轮全文），约束提取负责"全局约束的持久化"。具体：每轮对话后，LLM 提取"全局约束/关键事实"（如时间范围、用户身份、已确认的信息），存入会话状态的"约束区"（不随窗口滑出）。每轮 context = 约束区（常驻）+ 滑动窗口（近期全文）+ 任务摘要（中期摘要）。这样早期约束在"约束区"保留（不丢），近期细节在窗口里（清晰），中期在摘要里（压缩）。token 受控（约束区小+窗口固定+摘要短），且关键约束不丢。

**Q：任务拆解（大任务拆独立子任务，各子任务 context 独立）听起来好，但子任务之间可能有依赖，context 独立会不会丢关联信息？**

会，所以要"接口化传递依赖信息"而非"全 context 共享"。任务拆解的正确姿势：1）子任务接口化——每个子任务有明确的"输入（前置任务的结论）+ 输出（本任务的结论）"，子任务间通过"结论"传递（而非共享全部 context），如子任务 A 的输出"用户想买 5000 以内的手机"传给子任务 B 作为输入；2）依赖管理——用 DAG 管理子任务依赖（B 依赖 A 的输出），A 完成后才启动 B；3）共享状态——少量"全局共享信息"（如用户身份）放共享区，所有子任务可读。这样每个子任务的 context 只含"自己的输入+少量共享"，不累积全局历史，token 受控且关联信息通过接口传递不丢。

### 第四层：方案权衡

**Q：记忆分层（重要的存外部按需检索）能省 context，但检索有延迟（每次要查向量库），会不会反而拖慢对话？**

检索延迟可控且值得。1）延迟——向量库检索通常 50-100ms（有 ANN 索引），相比 LLM forward 的 1-2s 是小头（<10%），用户几乎无感；2）选择性检索——不是每轮都检索，只在"当前对话涉及历史主题"时触发（如检测到"上次说的那个"才检索历史），多数轮不检索；3）缓存——高频检索的记忆结果缓存（如用户偏好每次都查，缓存后命中 <1ms），命中率高时延迟忽略不计。所以"记忆分层 + 检索"的延迟代价 <10%，换来的是 context 大幅缩短（从 50K 降到 5K），LLM forward 更快更省。净收益为正。

**Q：多轮对话 token 优化到极致后，会不会影响对话质量（压太狠信息丢了）？怎么平衡？**

监控"质量 vs 成本"曲线找拐点。做 AB 测试：不同压缩强度（轻度/中度/重度摘要、不同窗口大小）下，对比对话质量（连贯性、准确率）和成本（token 数）。典型结果：轻度压缩质量持平、成本降 30%（值得）；中度压缩质量降 5%、成本降 60%（看业务能否接受）；重度压缩质量降 20%、成本降 80%（多数业务不可接受）。最优是"质量可接受范围内的最大压缩"，即曲线的拐点。还要分场景：高价值对话（如付费咨询）选轻压缩（保质量），低价值高频对话（如闲聊）选中度压缩（省成本）。不一刀切。

### 第五层：验证与沉淀

**Q：你怎么证明 token 优化策略真的省钱了且质量没降？**

量化对比。固定对话集，对比优化前后：1）成本——平均每轮 token 数、单对话总 token 数，优化后应显著降低（如降 50%+）；2）质量——连贯性（指代/约束遵守率）、准确率、用户满意度，优化后应持平或降幅 <5%；3）ROI——节省的 token 成本 vs 优化引入的额外开销（如摘要的 LLM 调用）。如果质量持平 + 成本降 50% + ROI 为正，证明优化有效。还要监控线上"质量投诉率"（优化后用户反馈变差的比例），如有上升说明压缩太激进，回调。

**Q：token 优化的三招怎么沉淀成框架能力？**

封装成 TokenOptimizer 组件：1）滑动窗口+约束提取——自动管理 context，约束区常驻+窗口滑动，开发者配窗口大小；2）记忆分层——自动把长尾历史转外部存储，按需检索回填；3）任务拆解——支持子任务编排（DAG），自动管理子任务 context 独立；4）成本监控——实时统计每轮 token、累计成本，超预算告警。开发者配置"压缩强度/窗口大小/记忆策略"，框架自动优化。这套写入团队对话框架 SOP，新对话系统接入即具备 token 优化，不重写压缩逻辑。

## 结构化回答

**30 秒电梯演讲：** 多轮对话Token优化三招——任务拆解(大任务变小任务独立处理)+记忆分层(重要的存、次要的摘要)+滑动窗口(只带最近相关)。核心是"按价值裁剪上下文"。

**展开框架：**
1. **三招** — 任务拆解+记忆分层+滑动窗口
2. **核心** — 按信息价值裁剪上下文
3. **进阶** — 增量计算+缓存复用+模型路由

**收尾：** 您想深入聊：压缩会影响回答质量吗？——会，需平衡压缩率和质量？


## 视频脚本

> 预计时长：4 分钟 | 由浅入深


| 时间 | 画面/字幕 | 口播台词 | 讲解要点 |
|------|----------|----------|----------|
| 0:00 | 标题卡：多轮对话越聊越贵，如何优化 Token 成本？ | "像出差收拾行李——只带必需品(任务拆解)、重要文件随身记忆分层)、换洗衣物按天数带(滑动窗…" | 开场钩子 |
| 0:20 | 核心概念图 | "多轮对话Token优化三招——任务拆解(大任务变小任务独立处理)+记忆分层(重要的存、次要的摘要)+滑动窗口(只带最近相…" | 核心定义 |
| 0:50 | 三招示意图 | "三招——任务拆解+记忆分层+滑动窗口" | 要点拆解1 |
| 1:30 | 对比/实战案例图 | "对比一下常见误区和工程实践，看真实场景里怎么取舍。" | 实战与对比 |
| 2:20 | 总结卡 | "记住核心要点。下期我们追问：压缩会影响回答质量吗？——会，需平衡压缩率和质量？" | 收尾与钩子 |
