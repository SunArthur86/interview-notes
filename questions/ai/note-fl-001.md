---
id: note-fl-001
difficulty: L4
category: ai
subcategory: Agent
tags:
- 字节
- 飞连
- 面经
- Agent架构
- 状态机
feynman:
  essence: Agent 项目的本质是把"创造性决策"（理解意图、规划）和"确定性执行"（API调用、字段校验）分离，前段交 LLM，后段交 Workflow；状态用 Redis（短期）+ Postgres（长期可追溯）双写；多 Agent 通过共享 State 通信而非直接对话。
  analogy: 就像开一家餐厅——前厅服务员（LLM）负责理解客人需求、推荐菜品（规划），后厨流水线（Workflow）负责确定性执行（煎牛排、结账）。订单状态写在白板（Redis 短期）和流水账本（Postgres 长期）上，服务员之间不直接吵架，都对着白板沟通。
  first_principle: LLM 每多调用一次，成本、延迟、失败概率全部叠加。因此"能用 if-else 写出来的不交给 LLM"。状态机显式化（State/Node/Edge）才能调试、回放、断点。
  key_points:
  - '意图识别 → 计划生成 → 工具执行 → 结果聚合 → 反思 五段拆分'
  - '创造性环节交 LLM，确定性环节交 Workflow'
  - 'Redis Hash 存短期会话状态（TTL 30min），Postgres 存 agent_steps 长期日志'
  - '多 Agent 通信走共享 State，禁止直接对话（避免扯皮）'
  - '硬步数上限（10-15 步）+ 去重 + 降权 防止死循环'
first_principle:
  essence: Agent = 状态机 + LLM 决策点 + 确定性 Workflow
  derivation: 纯 LLM 不可控（成本/延迟/失败叠加）→ 把确定性逻辑剥离成 Workflow → 把"下一步做什么"抽象成状态机 → LLM 只在关键决策点介入 → 整体可调试、可回放、可熔断
  conclusion: Agent 项目架构的核心不是"LLM 多强"，而是"状态机多干净 + Workflow/LLM 边界多清晰"
follow_up:
- 多 Agent 直接对话（如 AutoGen）vs 共享状态（LangGraph）各自什么坑？
- agent_steps 表怎么设计才能支持完整回放？
- 长任务中途断了，断点续传怎么实现？
---

# 【字节飞连面经】介绍 Agent 项目整体流程：为什么这么拆？状态怎么存？多 Agent 怎么协作？

## 一、整体流程：五段拆分

```
用户输入
  │
  ▼
[1] 意图识别（LLM）  ── 判断"用户到底想干什么"
  │
  ▼
[2] 计划生成（LLM）  ── 拆成 N 个可执行步骤
  │
  ▼
[3] 工具执行（Workflow，确定性）── 调 API、读 DB、跑脚本
  │
  ▼
[4] 结果聚合（规则模板）── 把多个工具结果拼成统一结构
  │
  ▼
[5] 反思（LLM）      ── 评估"是否完成 / 是否要补刀"
```

**拆分原则**：能 `if-else` 写出来的坚决不交给 LLM。"判断用户是否登录""检查工单类型在白名单"全是 Workflow；"猜用户真实意图""生成派单摘要"交给 LLM。

## 二、失败分支与重试

每个节点都包 `try / retry / fallback` 三段：

| 失败类型 | 处理 |
|---------|------|
| LLM 节点失败 | 换更小的兜底模型（豆包 1.6 失败 → 豆包 lite） |
| 工具节点失败 | 指数退避重试 3 次（1s, 2s, 4s）→ 进人工兜底队列 |
| 业务侧拒绝（权限不足） | 立即终止 + 透传给用户 |

**关键原则：fail loud，不要 fail silent**。失败必须落日志 + 上指标，否则线上出了问题靠猜。

## 三、状态怎么存：双层存储

```
短期会话：Redis Hash
  key = session:{user_id}:{conversation_id}
  字段：current_step, plan_json, tool_history, step_count
  TTL = 30 min

长期日志：Postgres
  表 agent_steps:
    (step_id, parent_step, tool_name, 
     input_json, output_json, status, ts, trace_id)
  → 支持完整回放、bad case 定位、审计
```

**为什么双层**：Redis 撑低延迟读写（每步都要读状态），Postgres 撑可追溯性（出问题能查）。两者双写，Redis 是热数据，Postgres 是冷账本。

## 四、多 Agent 分工 / 通信 / 终止

**Planner + Executor + Critic 三角色**：
- Planner 出计划
- Executor 执行工具
- Critic 评估"是否完成"

**通信方式（关键）**：共享状态对象（LangGraph 里的 `State`），**禁止 Agent 之间直接对话**。直接对话（AutoGen 那种）很容易扯皮——你说做完了，我说没做完，无限循环。

**终止条件三重上限**：
1. 硬上限：最多 N 步（典型 10–15）
2. 软上限：Critic 连续 2 次说"已完成"
3. 异常上限：连续 3 次工具失败

## 五、避免死循环 / 扯皮

- **硬步数上限**：到了强制返回当前最优结果
- **去重**：同工具 + 同参数在同一会话调用过 → 直接返回缓存
- **降权**：连续两次失败的工具，第三次从可选工具列表剔除

## 六、加分点

能画出 LangGraph `State` 的字段表：

```typescript
interface AgentState {
  messages: BaseMessage[];     // 对话历史
  current_plan: PlanStep[];    // 当前计划
  tool_history: ToolCall[];    // 工具调用历史
  step_count: number;          // 步数计数
  should_continue: boolean;    // 是否继续
}
```

提到 `interrupt()` / human-in-the-loop 兜复杂决策。

## 七、雷区

- ❌ "多 Agent 全交给 AutoGen 自己跑" → 立刻被追问"超时和死循环你怎么治"
- ❌ "状态存内存里就行" → 被追问"服务重启怎么办、水平扩展怎么办"
- ❌ 指标没数字（"效果很好"=没效果）

## 八、扩展

- LangGraph 的 `CheckpointSaver` 接口可以接 Redis/Postgres，实现状态持久化和断点续传
- 真正生产级的多 Agent 系统会用 message bus（如 NATS/Kafka）做异步通信，而非同步共享内存
- 反思阶段如果用 LLM，反思结果要**摘要后再写回**，不留原始错误文本，否则会污染上下文
