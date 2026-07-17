---
id: note-bd4-005
difficulty: L3
category: ai
subcategory: Agent
tags:
- 字节
- 面经
- RAG
- Agent
feynman:
  essence: Agent无限循环是指Agent反复调用同一工具、在步骤间打转或目标漂移无法收敛，需要从Prompt约束、运行时硬限制、状态监控三层防御
  analogy: 像一个迷路的人不停兜圈——你要先告诉他别走回头路(Prompt)，再设个GPS步数上限(运行时)，最后装个检测器发现他在兜圈就拦住他(监控)
  first_principle: LLM的输出是非确定性的，Agent是多步决策系统，必须用确定性代码约束非确定性LLM
  key_points:
  - 'Prompt层: 规则约束、Few-shot反面案例、强制进度校验'
  - '运行时层: 最大轮数、调用历史去重、指数退避'
  - '监控层: 语义相似度检测、目标漂移校验、异常告警'
first_principle:
  essence: 防御的核心是用确定性机制约束非确定性行为
  derivation: LLM可能无限循环 → 不能只靠Prompt约束(软约束) → 需要代码硬限制(硬约束) → 需要语义检测发现隐性循环 → 三层叠加才能可靠
  conclusion: 生产级Agent必须有代码层硬限制，不能只依赖Prompt
follow_up:
- 怎么检测Agent在'隐性循环'(每步动作不同但语义相同)？
- Agent目标漂移怎么自动检测？
- 如果正常任务确实需要很多轮，怎么区分？
memory_points:
- 防御口诀：事前Prompt防漂移，事中硬限防死循环，事后语义防重复
- 事中运行时限制：最大轮数限制(兜底)、调用参数去重(拦截相同调用)
- 事前防御：用Few-shot禁止连续2次相同调用，强制要求汇报当前进度
- 事后监控：通过向量相似度检测输出结果是否发生隐性重复循环
---

# Agent 出现无限循环或规划混乱怎么防？

## 三层防御架构

```
┌─────────────────────────────────────────────┐
│  第三层: 状态语义监控 (高阶阻断)              │
│  语义相似度检测 / 目标漂移校验 / 告警         │
├─────────────────────────────────────────────┤
│  第二层: 运行时硬限制 (代码兜底, 最核心)      │
│  最大轮数 / 调用去重 / 退避重试              │
├─────────────────────────────────────────────┤
│  第一层: Prompt 事前防御 (模型侧)            │
│  规则约束 / Few-shot / 进度校验              │
└─────────────────────────────────────────────┘
```

## 第一层：Prompt 事前防御

```python
ANTI_LOOP_SYSTEM_PROMPT = """
你是任务执行Agent。严格遵守以下规则：

1. 禁止连续2次调用完全相同的工具(相同工具名+相同参数)
2. 如果工具返回结果与上一次相同，说明无新信息，必须改变策略或终止
3. 每轮思考前先回答："当前进度是什么？离目标还有多远？"
4. 如果连续3轮没有取得实质进展，向用户报告当前状态并请求指导

错误案例(Few-shot)：
❌ Step 1: search_weather("北京") → 25°C
❌ Step 2: search_weather("北京") → 25°C  # 重复！违反规则1
✅ Step 1: search_weather("北京") → 25°C
✅ Step 2: search_weather("上海") → 28°C  # 不同查询，OK
"""
```

## 第二层：运行时硬限制（最核心）

```python
class AgentLoopGuard:
    def __init__(self, max_steps=10, max_retries=2):
        self.max_steps = max_steps
        self.max_retries = max_retries
        self.tool_history = []  # 记录所有工具调用

    def check_before_tool_call(self, tool_name, params):
        # 1. 全局最大轮数
        if len(self.tool_history) >= self.max_steps:
            raise MaxStepsExceeded(
                f"已达最大轮数{self.max_steps}，终止执行"
            )

        # 2. 调用历史去重检测
        call_sig = f"{tool_name}:{json.dumps(params, sort_keys=True)}"
        if call_sig in self.tool_history[-3:]:  # 最近3轮内重复
            raise DuplicateCallDetected(
                f"检测到重复调用: {call_sig}，拦截执行"
            )

        self.tool_history.append(call_sig)

    def check_after_tool_call(self, result):
        # 3. 结果重复检测
        if self.tool_history.count(result_hash) >= 2:
            raise StaleResultDetected("工具返回重复结果")

    async def execute_with_backoff(self, tool_call):
        # 4. 指数退避重试
        for attempt in range(self.max_retries):
            try:
                return await tool_call()
            except Exception:
                if attempt == self.max_retries - 1:
                    return self.fallback()  # 降级
                await asyncio.sleep(2 ** attempt)
```

## 第三层：状态语义监控

```python
class SemanticLoopDetector:
    def __init__(self, similarity_threshold=0.85):
        self.threshold = similarity_threshold
        self.result_history = []
        self.original_goal = None

    def check_semantic_loop(self, current_output):
        """检测输出语义是否重复(隐性循环)"""
        if not self.result_history:
            self.result_history.append(current_output)
            return False

        # 计算与最近结果的语义相似度
        sim = cosine_similarity(
            embed(current_output),
            embed(self.result_history[-1])
        )

        if sim > self.threshold:
            print(f"⚠️ 语义相似度 {sim:.2f} 超阈值，判定为隐性循环")
            return True

        self.result_history.append(current_output)
        return False

    def check_goal_drift(self, current_action):
        """检测目标漂移"""
        prompt = f"""
        用户原始目标: {self.original_goal}
        当前Agent行为: {current_action}
        当前行为是否仍在为原始目标服务？
        回答YES或NO。
        """
        is_on_track = llm.classify(prompt)
        if not is_on_track:
            print("⚠️ 目标漂移检测：Agent偏离原始目标")
            return True
        return False
```

## 完整防御策略表

| 防御层 | 检测目标 | 实现方式 | 代码位置 |
|--------|---------|---------|---------|
| **Prompt** | LLM自我约束 | System Prompt规则+Few-shot | Prompt模板 |
| **运行时** | 明确重复调用 | 调用签名去重 | 工具调用拦截器 |
| **运行时** | 步数超限 | 全局step计数 | Agent主循环 |
| **运行时** | 重试失控 | 指数退避+最大次数 | HTTP客户端 |
| **语义** | 隐性循环 | 输出embedding相似度 | 后处理hook |
| **语义** | 目标漂移 | LLM判断目标一致性 | 每轮checkpoint |
| **告警** | 异常会话 | 指标埋点+阈值告警 | 监控系统 |

## 生产级建议

- **正常vs异常多轮区分**：用"每轮是否带来新信息"作为核心判据，而非简单步数
- **Human-in-the-loop**：检测到异常时不直接终止，而是暂停等待人工确认
- **Checkpoint恢复**：存储每步状态，异常后可从最后正常点恢复
- **A/B对比**：监控循环检测的误杀率，避免拦截正常的复杂任务

## 记忆要点

- 防御口诀：事前Prompt防漂移，事中硬限防死循环，事后语义防重复
- 事中运行时限制：最大轮数限制(兜底)、调用参数去重(拦截相同调用)
- 事前防御：用Few-shot禁止连续2次相同调用，强制要求汇报当前进度
- 事后监控：通过向量相似度检测输出结果是否发生隐性重复循环

## 苏格拉底式面试追问

> 这组追问模拟面试官层层逼问，每一问先回答"为什么"，再回答"怎么做"，最后回答"如何证明"。

### 第一层：目标与动机

**Q：Agent 无限循环你分"事前 Prompt / 事中硬限 / 事后语义"三层防御。为什么不只用事中硬限（max_rounds + 去重），最直接？**

事中硬限是"兜底"但不够精细。max_rounds（如 10 轮）能防止"无限循环"（硬终止），但问题是：如果 Agent 在第 9 轮才找到正确解法（复杂任务确实需要多轮），硬限到 10 轮刚好够；但如果硬限到 5 轮（太保守），正常的长任务被误杀。去重（拦截完全相同的调用）能防"完全重复"，但防不了"语义重复"（如 `search("机票")` 和 `search("航班")` 不同但语义重复，去重拦不住）。事前 Prompt 防御（如 few-shot 示范"不要连续两次相同调用"）从源头减少循环倾向（LLM 看了示例，更少做出重复行为），降低事中硬限的触发频率。事后语义监控（用 embedding 相似度检测输出是否语义重复）能抓"语义重复循环"（去重抓不到的）。三层各有盲区：事前不够强（LLM 可能不遵守 prompt）、事中抓不到语义重复、事后是被动检测（不能阻止），组合才全面。

### 第二层：证据与定位

**Q：Agent 跑了 10 轮（达到 max_rounds）仍未解决任务。怎么定位是"真的复杂任务"（需要更多轮）、还是"陷入了循环"（重复无效操作）？**

看每轮的 Action 和 Observation 是否"有进展"。一是 Action 多样性——如果 10 轮的 Action 是不同的工具或显著不同的参数（如轮 1 search A、轮 2 calculate B、轮 3 search C），是正常探索（任务复杂）；如果 Action 重复或高度相似（如轮 1 search A、轮 3 search A、轮 5 search A），是循环（重复试同一方法）。二是 Observation 增量——每轮的 Observation（工具返回）是否带来新信息，如果每轮都是"无结果"或"重复结果"，是循环（没进展）；如果每轮有新信息但 Agent 没利用，是 Agent 推理问题（给了信息不会用）。三是 Agent 的 Thought——每轮的推理是否在"反思换策略"，如果 Thought 总是"再试一次"而非"换思路"，是循环。用"Action 序列的 embedding 相似度"量化——计算 10 轮 Action 两两相似度，如果高（如 >0.8），是循环；如果低（分散），是正常探索。

### 第三层：根因深挖

**Q：你提到"事后语义监控"（用 embedding 相似度检测输出重复）。为什么需要语义检测？参数去重（精确匹配）不够吗？**

精确匹配抓不到"语义重复"。Agent 循环时可能不调用"完全相同"的参数，而是"相似但不完全相同"的参数——如轮 1 `search("北京到上海的机票")`、轮 3 `search("北京飞上海的航班")`、轮 5 `search("北京去上海的机票价格")`。这三个 query 参数不同（精确匹配不拦），但语义高度相似（都是查京沪机票），是"语义重复循环"。LLM 这种"换词不换意"的重复很常见（它会想"换个说法可能搜到不同结果"，但实际搜到的是同样的无关结果）。语义检测用 embedding 相似度——把每轮的 Action（或 query）embedding，计算相似度矩阵，如果某轮和之前某轮相似度 >0.9（阈值），判定为语义重复，拦截或警告。这能抓"精确匹配漏掉"的循环，是更智能的检测。代价是计算 embedding 的开销（每轮 Action 要 embedding，几 ms），但相比循环的浪费（每轮几秒 + token），值得。

**Q：那为什么不直接用更强的模型（如 GPT-4）让它"不重复"（推理能力强，自然不会循环），省得搞三层防御？**

强模型减少循环但不消除。GPT-4 的推理和"元认知"比 GPT-3.5 强（遇到重复倾向更可能换策略），但在"工具返回模糊信息"（如 search 返回"无结果"无建议）或"任务本身需要大量探索"时，仍可能循环。且强模型贵（前面讨论过），循环时成本爆炸（10 轮 GPT-4 可能几美元）。更关键的是"很多场景用不起 GPT-4"（开源模型），必须靠工程手段（三层防御）让中等模型也可靠。工程防御是"模型无关的"（任何模型都有效），是可靠性的基础。强模型 + 三层防御结合最稳，但即使强模型也不能省防御（兜底是必须的）。生产 Agent 无论用什么模型，三层防御是标配（防御的边际成本远低于循环的损失）。

### 第四层：方案权衡

**Q：事中硬限你用"最大轮数 + 参数去重"。max_rounds 设多少合适？太大（如 50）浪费，太小（如 5）误杀。**

按"任务复杂度"动态设。简单任务（如"查天气"，1-2 步）max_rounds=5 够（正常 2-3 步，留余量）；中等任务（如"订机票"，5-8 步）max_rounds=15；复杂任务（如"研究并写报告"，20+ 步）max_rounds=30。关键是"根据任务类型配 max_rounds"——在意图识别后（知道是什么任务），动态设 max_rounds。或用"自适应"——默认 max_rounds=10，Agent 每轮汇报"任务完成度"（如 30%、60%），如果连续 3 轮完成度不涨（卡住），提前终止。max_rounds 太大的风险是"循环时浪费多"（50 轮的循环消耗大），但配合参数去重 + 语义检测，循环会在前几轮被拦（不会真跑满 50 轮），所以 max_rounds 设大些（如 30）配合其他检测，比设小（5）更安全（不误杀正常长任务）。经验值：大多数场景 max_rounds=15-20（覆盖中复杂度，配合检测防循环）。

**Q：为什么不直接用"进度检测"（每轮让 Agent 汇报进度，不涨就停），而非设硬轮数？**

进度检测更智能但不可靠。让 Agent 每轮输出"当前进度 X%"或"离完成还有多远"，如果连续几轮进度不涨（卡住），判定循环，终止。这比硬轮数更精准（基于实际进度，而非武断的步数）。但问题：一是 Agent 的自评不准——LLM 对"进度"的判断不可靠（可能虚报进度，如每轮都说 80%，实际没进展）；二是"进度定义难"——有些任务的进度难量化（如"创意写作"写到哪算 80%？）；三是额外开销——每轮要多生成"进度评估"（多一次 LLM 推理或额外 token）。折中：用进度检测做"软提示"（进度不涨时，prompt 提醒 Agent"你似乎卡住了，请换策略"），硬轮数做"硬兜底"（即使进度虚涨，硬轮数到也终止）。两者结合——软提示让 Agent 自我纠正，硬兜底防 Agent 失控。单独用进度检测风险大（Agent 可能谎报进度绕过检测）。

### 第五层：验证与沉淀

**Q：你怎么衡量防循环机制的效果，证明"三层防御"减少了循环？**

定义指标：一是循环率（Agent 达到 max_rounds 且任务未完成的比例，优化后应 <5%）；二是平均轮数（完成任务的平均轮数，优化后应降低，效率提升）；三是"语义重复拦截率"（语义检测拦截的比例，应抓到精确匹配漏掉的）；四是 max_rounds 误杀率（正常任务被 max_rounds 终止的比例，应 <1%，高说明 max_rounds 太小）。做对比实验：无防御 vs 仅 max_rounds vs max_rounds + 去重 vs 三层全开，对比循环率/平均轮数/误杀率。关键验证"语义检测的价值"——对比"去重"和"去重 + 语义检测"，后者应多抓 X% 的循环（语义重复的）。故障注入测试——故意构造"语义重复循环"场景（如让 Agent 面对一个无解的 search），看三层防御是否拦截。监控"接近 max_rounds 的任务比例"（高则说明任务常卡，需优化 Agent 或调大 max_rounds）。

**Q：防循环机制怎么沉淀成 Agent 框架标配？**

固化成"Agent 循环防护套件"：事前（few-shot prompt 模板，含"不要重复"的示例）、事中（max_rounds 配置表 + 参数去重 + 进度提示）、事后（语义相似度检测 + 循环告警）。沉淀"各任务的 max_rounds 经验值"（客服 5、研究 20）、"语义相似度阈值"（0.9 拦截）、"进度 prompt 模板"（让 Agent 汇报进度）。配套监控（循环率、平均轮数、语义拦截率、误杀率），异常告警。把"三层防御"作为 Agent 的默认配置，新 Agent 按任务类型选 max_rounds，自动获得防护。积累"常见循环模式 + 解法"（如"search 无结果循环"的解法是"失败反馈带建议"），帮助优化 prompt 和工具返回。code review 检查 Agent 是否配了 max_rounds（没有则拒绝上线）。

## 结构化回答

**30 秒电梯演讲：** Agent无限循环是指Agent反复调用同一工具、在步骤间打转或目标漂移无法收敛，需要从Prompt约束、运行时硬限制、状态监控三层防御。

**展开框架：**
1. **Prompt层** — 规则约束、Few-shot反面案例、强制进度校验
2. **运行时层** — 最大轮数、调用历史去重、指数退避
3. **监控层** — 语义相似度检测、目标漂移校验、异常告警

**收尾：** 您想深入聊：怎么检测Agent在'隐性循环'(每步动作不同但语义相同)？


## 视频脚本

> 预计时长：4 分钟 | 由浅入深


| 时间 | 画面/字幕 | 口播台词 | 讲解要点 |
|------|----------|----------|----------|
| 0:00 | 标题卡：Agent 出现无限循环或规划混乱怎么防？ | "像一个迷路的人不停兜圈——你要先告诉他别走回头路(Prompt)，再设个GPS步数上限(运…" | 开场钩子 |
| 0:20 | 核心概念图 | "Agent无限循环是指Agent反复调用同一工具、在步骤间打转或目标漂移无法收敛，需要从Prompt约束、运行时硬限制…" | 核心定义 |
| 0:50 | Prompt层示意图 | "Prompt层——规则约束、Few-shot反面案例、强制进度校验" | 要点拆解1 |
| 1:30 | 对比/实战案例图 | "对比一下常见误区和工程实践，看真实场景里怎么取舍。" | 实战与对比 |
| 2:20 | 总结卡 | "记住核心要点。下期我们追问：怎么检测Agent在'隐性循环'(每步动作不同但语义相同)？" | 收尾与钩子 |
