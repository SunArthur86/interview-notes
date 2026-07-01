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

