---
id: note-tx-007
difficulty: L3
category: ai
subcategory: Agent
tags:
- 腾讯
- 面经
- Agent
- 执行流程
- 架构设计
feynman:
  essence: Agent项目=编排引擎（大脑）+记忆（状态）+工具（手脚）+知识（参考书）+安全监控（免疫系统）。
  analogy: Agent像一个公司——编排引擎是CEO（决策），记忆是档案室，工具是各部门（执行），知识是公司知识库，安全是法务/审计。
  key_points:
  - '5大模块:编排/记忆/工具/知识/安全'
  - 编排=任务分解到路由到循环到聚合
  - '安全:权限控制+Trace+限流+人工确认'
  - 防死循环+超时+重试
first_principle:
follow_up:
- 怎么评估Agent的表现？——任务完成率+步骤效率+成本+用户满意度
- Agent项目的最大挑战是什么？——稳定性（概率性输出导致的不可预测性）
- 怎么做Agent的测试？——场景测试+Bad Case库+回归测试
---

# 【腾讯面经】你这个 Agent 项目怎么设计的？包含什么模块？Agent 整体运行流程是什么？

> 这是 Agent 方向的**系统性架构题**，面试官想看你是否真正做过 Agent 项目，而不只是调过 API。回答要像系统设计题一样展开：先给整体架构图，再逐模块讲设计决策，最后落到运行流程和工程细节。核心框架：五大模块 → 运行流程 → 关键设计决策 → 评估方法。

## 一、整体架构：五大核心模块

```
┌──────────────────────────────────────────────────────┐
│                  用户接口层（API / UI）                │
│              接收请求 · 流式返回 · 会话管理             │
└──────────────────────┬───────────────────────────────┘
                       │
┌──────────────────────┴───────────────────────────────┐
│              编排引擎（Orchestrator）                   │
│  意图理解 · 任务分解 · 路由决策 · 循环控制 · 结果聚合    │
└───┬──────────┬──────────┬──────────┬─────────────────┘
    │          │          │          │
    ▼          ▼          ▼          ▼
┌───────┐ ┌───────┐ ┌───────┐ ┌─────────────┐
│ 记忆  │ │ 工具  │ │ 知识  │ │ 安全与监控  │
│Memory │ │Tools  │ │ RAG   │ │ Security    │
├───────┤ ├───────┤ ├───────┤ ├─────────────┤
│工作记忆│ │MCP工具│ │向量检索│ │权限控制     │
│长期记忆│ │Skill  │ │Rerank │ │全链路Trace  │
│用户隔离│ │沙箱   │ │分块   │ │限流熔断     │
└───────┘ └───────┘ └───────┘ └─────────────┘
```

## 二、模块详解

### 模块一：编排引擎（Orchestrator）—— Agent 的大脑

编排引擎是整个系统的核心，负责五件事：

```python
class Orchestrator:
    def run(self, user_input: str) -> str:
        # 1. 意图理解：判断用户要做什么
        intent = self.understand_intent(user_input)

        # 2. 任务分解：复杂任务拆成子任务
        subtasks = self.decompose(intent)

        # 3. 路由决策：每个子任务用什么策略
        plan = self.plan(subtasks)

        # 4. 循环执行：ReAct / Plan-and-Execute
        for step in plan:
            result = self.execute_step(step)
            if self.is_complete(result):
                break

        # 5. 结果聚合：合并子结果，生成最终回复
        return self.synthesize(results)
```

**两种主流编排模式**：

| 模式 | 特点 | 适用场景 |
|------|------|---------|
| **ReAct** | 思考-行动-观察循环，边想边做 | 探索性任务、步骤不确定 |
| **Plan-and-Execute** | 先规划全量步骤再执行 | 步骤明确、可并行优化 |

生产中常用**混合模式**：先 Plan 出大致步骤，执行中允许 ReAct 动态调整。

### 模块二：记忆模块（Memory）—— Agent 的状态

```
记忆分层:
├── 工作记忆（Working Memory）
│   ├── 当前对话上下文（在 prompt 中）
│   └── 任务状态快照（外部存储）
│
├── 短期记忆（Short-term · Redis）
│   ├── 最近 N 轮对话摘要
│   └── 当前会话的工具调用结果
│
└── 长期记忆（Long-term · 向量DB）
    ├── 用户偏好（按 user_id 隔离）
    ├── 历史执行轨迹
    └── 抽取的事实知识
```

**关键设计**：上下文窗口不够时用 Auto-Compact 压缩 + Task State Snapshot 保证任务不丢；跨会话记忆走向量DB，按相关性 + 时间衰减检索。

### 模块三：工具模块（Tools）—— Agent 的手脚

```
工具体系:
├── MCP 工具（Model Context Protocol）
│   └── 标准化外部接口：文件系统、数据库、浏览器、代码执行
│
├── Skill（能力封装）
│   ├── 复用已验证的 Prompt + 工具组合
│   └── 如 "搜索并总结" 作为一个 Skill 封装
│
└── 安全沙箱
    ├── 代码执行工具 → Docker 容器隔离
    ├── 文件操作 → 限定目录 + 权限白名单
    └── 网络请求 → 域名白名单 + 超时控制
```

```python
# 工具注册示例
@tool(name="web_search", description="搜索互联网获取最新信息")
def web_search(query: str, max_results: int = 5) -> list:
    # 带超时 + 重试 + 结果缓存
    return search_api.search(query, timeout=3, retries=2)

@tool(name="execute_code", description="在沙箱中执行Python代码",
      risk_level="high")  # 高风险 → 需人工确认
def execute_code(code: str) -> str:
    return sandbox.run(code, timeout=10)
```

### 模块四：知识模块（RAG）—— Agent 的参考书

```
RAG 管线:
用户问题
  ↓ Query 改写（扩展/分解）
  ↓ 向量检索（top-K=10~20，高召回）
  ↓ Rerank 精排（top-N=3~5，高精度）
  ↓ 上下文组装（按相关性排序 + token 预算控制）
  ↓ 注入 Prompt
```

**分块策略**：固定大小 vs 语义分块 vs 按文档结构（标题/段落）。生产推荐语义分块 + overlap，保证检索完整性。

### 模块五：安全与可观测层（Security）—— Agent 的免疫系统

```
安全四件套:
├── 权限控制
│   ├── 工具白名单（只允许调用预授权工具）
│   ├── 最小权限原则（只给完成任务所需的最小权限）
│   └── 高风险操作人工确认（删数据/发邮件/付款）
│
├── 全链路 Trace
│   ├── 每步决策记录（LLM输入/输出/工具调用/耗时）
│   ├── Token 消费追踪（成本归因到每个请求）
│   └── 异常告警（连续失败/超时/异常输出）
│
├── 限流熔断
│   ├── 单用户 QPS 限制
│   ├── 全局并发控制
│   └── 连续失败熔断 → 降级
│
└── Prompt 注入防护
    ├── 输入清洗（去除注入模式）
    ├── 系统提示隔离（用户输入不覆盖 system prompt）
    └── 输出过滤（检测敏感信息泄露）
```

## 三、Agent 整体运行流程

```
用户输入: "帮我查一下最近三天的天气，然后给团队发邮件通知"
    │
    ▼
┌─────────────────────────────────┐
│ 1. 意图理解                      │
│    → 意图: 查天气 + 发邮件        │
│    → 类型: 多步骤工具任务          │
└──────────────┬──────────────────┘
               ▼
┌─────────────────────────────────┐
│ 2. 检索记忆 & 知识               │
│    → 长期记忆: 团队邮件列表       │
│    → RAG知识: 邮件格式模板        │
└──────────────┬──────────────────┘
               ▼
┌─────────────────────────────────┐
│ 3. 任务分解 & 规划               │
│    Step1: 调用天气API查3天天气    │
│    Step2: 生成邮件内容            │
│    Step3: 调用邮件API发送         │
└──────────────┬──────────────────┘
               ▼
┌─────────────────────────────────┐
│ 4. 循环执行（ReAct）             │
│    ┌→ Thought: 需要先查天气       │
│    │  Action: web_search(天气)   │
│    │  Observe: [25°C, 多云...]   │
│    │  Thought: 天气已获取,写邮件  │
│    │  Action: compose_email()    │
│    │  Observe: 邮件草稿已生成     │
│    │  Thought: 需发送(高风险!)    │
│    │  Action: send_email() ⚠️     │
│    │  → 人工确认 → 确认发送       │
│    │  Observe: 发送成功           │
│    └─ Thought: 任务完成          │
└──────────────┬──────────────────┘
               ▼
┌─────────────────────────────────┐
│ 5. 结果聚合 & 输出               │
│    → "已查询天气并通过邮件通知"    │
│    → 存入记忆: 本次执行轨迹       │
└─────────────────────────────────┘
```

### 循环执行的状态机

```python
class AgentLoop:
    MAX_STEPS = 20          # 防死循环
    STEP_TIMEOUT = 30       # 单步超时（秒）
    MAX_RETRIES = 3         # 单步重试

    def run(self, task):
        state = AgentState(task=task, step=0)
        while not state.is_complete:
            # 安全检查
            if state.step >= self.MAX_STEPS:
                return self.fallback(state, reason="超过最大步数")
            if state.total_cost > task.budget:
                return self.fallback(state, reason="超过成本预算")

            # 执行一步
            try:
                action = self.llm_decide(state)  # Thought + Action
                if action.is_high_risk:
                    if not self.human_confirm(action):
                        continue  # 用户拒绝，重新决策
                result = self.execute_with_timeout(action)
                state.observe(result)
            except TimeoutError:
                state.observe("工具执行超时")
            except Exception as e:
                state.observe(f"执行失败: {e}")

            state.step += 1

        return state.final_answer
```

## 四、关键设计决策

| 决策点 | 方案 | 理由 |
|--------|------|------|
| 最大循环次数 | 限制 20 步 | 防死循环，控制成本 |
| 单步超时 | 30 秒 | 防工具卡死，保障可用性 |
| 高风险操作 | 人工确认 | 防误操作（删数据/付款） |
| 全链路 Trace | 必须有 | 可调试、可审计、可优化 |
| 成本预算 | 每任务设上限 | 防异常消耗 |
| 失败处理 | 重试 → 降级 → 兜底 | 三级容错保障稳定性 |

## 五、Agent 评估方法

```
评估四维度:
├── 效果: 任务完成率（核心指标）
├── 效率: 平均步数（越少越好）、平均耗时
├── 成本: 平均 token 消耗、平均费用
└── 体验: 用户满意度评分、人工接管率

测试方法:
├── 场景测试: 覆盖典型用例 + 边界用例
├── Bad Case 库: 线上收集 → 回归测试
├── 对比测试: 新版本 vs 旧版本 A/B
└── 人工抽检: 每日抽样评分
```

## 六、面试加分点

1. **画架构图**：白板/纸上画出五大模块，体现系统设计能力。
2. **强调防死循环**：提到 MAX_STEPS + 超时 + 成本预算，这是有真实踩坑经验的标志。
3. **人工确认机制**：高风险操作人工介入，体现安全意识。
4. **全链路 Trace**：强调可调试性，"Agent 上线后 80% 的工作是调试和优化"。
5. **评估闭环**：不只讲怎么构建，还讲怎么评估和迭代——体现工程闭环思维。
6. **坦诚挑战**：主动说"Agent 最大的挑战是稳定性——概率性输出导致不可预测"，然后讲你怎么应对（重试/降级/兜底/限流），比硬夸效果好得多。
