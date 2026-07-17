---
id: note-tt-agent-004
difficulty: L4
category: ai
subcategory: Agent
tags:
- 淘天
- 面经
- 二面
- 状态机
- Planner
- Executor
- Reflector
- 容错
feynman:
  essence: Planner-Executor-Reflector闭环 = 规划任务→执行→反思校验→修复，用状态机管控重试/超时/异常兜底，实现Agent自我纠错
  analogy: 就像装修工程——设计师出图（Planner）→工人施工（Executor）→质检员验收（Reflector）→不合格返工（回到Planner调整）→验收通过交付
  first_principle: 单次LLM执行错误率随步骤数指数增长。闭环+反思将错误率从指数级降为多项式级——每步独立校验+修复阻断错误传播
  key_points:
  - Planner拆分任务为子步骤，输出结构化执行计划
  - Executor按计划逐步执行，调用工具/API
  - Reflector检查结果质量，决定通过/修复/放弃
  - 状态机管控：重试上限、超时熔断、异常兜底
  - 每步独立校验阻断错误传播
first_principle:
  essence: 串行执行n步的错误率为1-(1-p)^n，加入反思修复后变为1-(1-p·r)^n，其中r为修复成功率
  derivation: 设单步错误率p=0.15，5步串行准确率=(0.85)^5=44%。加入Reflector（检出率0.9）+Repair（修复率0.8）后，等效错误率=0.15×0.1+0.15×0.9×0.2=0.042，5步准确率=(0.958)^5=81%
  conclusion: 闭环架构的核心价值不是让每步更准，而是阻断错误传播链
follow_up:
- Reflector用什么模型？需要和Executor不同吗？
- 状态机中"放弃"后怎么兜底？降级策略有哪些？
- 闭环增加的延迟和成本如何控制？
memory_points:
- 口诀法：规划Planner、执行Executor、反思Reflector构成核心闭环状态机
- 因果句：因为大模型存在幻觉且不可控，所以必须引入Reflector节点做结果校验
- 对比句：反思通过则状态流转至完成，反思失败且重试超限则转入降级兜底状态
- 口诀法：状态机管理节点流转，精准控制重试次数超时限制与人工接管
---

# 简述Agent的Planner-Executor-Reflector闭环实现，工程如何用状态机管控？

## 闭环架构

```
用户意图
    │
    ▼
┌──────────┐
│ Planner  │──── 输出执行计划 [step1, step2, step3...]
│ 规划节点  │     每步含：目标、工具、参数、验收标准
└────┬─────┘
     │
     ▼
┌──────────┐     ┌──────────┐
│ Executor │────→│  结果     │
│ 执行节点  │     │  输出     │
└────┬─────┘     └────┬─────┘
     │                │
     │                ▼
     │          ┌──────────┐
     │          │ Reflector│──── pass? ────→ ✅ 完成
     │          │ 反思校验  │
     │          └────┬─────┘
     │               │ fail
     │               ▼
     │          ┌──────────┐
     │          │ Repair   │──── 修复后重新执行
     │          │ 修复节点  │
     │          └──────────┘
     │
     ▼ (retry_count >= 3)
┌──────────┐
│ Fallback │──── 降级处理
│ 兜底节点  │     （人工介入/默认回答/缓存）
└──────────┘
```

## 状态机实现

```python
from enum import Enum
from typing import Any

class AgentState(Enum):
    PLANNING = "planning"
    EXECUTING = "executing"
    REFLECTING = "reflecting"
    REPAIRING = "repairing"
    COMPLETED = "completed"
    FAILED = "failed"

class PlannerExecutorReflector:
    def __init__(self, max_retries=3, timeout_per_step=30):
        self.max_retries = max_retries
        self.timeout = timeout_per_step

    async def run(self, user_intent: str) -> dict:
        state = AgentState.PLANNING
        plan = []
        current_step = 0
        retry_count = 0

        while state not in (AgentState.COMPLETED, AgentState.FAILED):
            if state == AgentState.PLANNING:
                plan = await self._plan(user_intent)
                if not plan:
                    return {"status": "failed", "reason": "planning_failed"}
                state = AgentState.EXECUTING

            elif state == AgentState.EXECUTING:
                if current_step >= len(plan):
                    state = AgentState.COMPLETED
                    continue

                step = plan[current_step]
                try:
                    result = await self._execute_with_timeout(step)
                    state = AgentState.REFLECTING
                except TimeoutError:
                    if retry_count < self.max_retries:
                        retry_count += 1
                        # 超时重试：可能是API过载
                    else:
                        state = AgentState.FAILED
                except Exception as e:
                    if retry_count < self.max_retries:
                        retry_count += 1
                    else:
                        state = AgentState.FAILED

            elif state == AgentState.REFLECTING:
                step = plan[current_step]
                check_result = await self._reflect(step, result)
                if check_result['pass']:
                    current_step += 1
                    retry_count = 0  # 重置重试计数
                    state = AgentState.EXECUTING
                elif retry_count < self.max_retries:
                    retry_count += 1
                    state = AgentState.REPAIRING
                else:
                    state = AgentState.FAILED

            elif state == AgentState.REPAIRING:
                repair_result = await self._repair(step, result, check_result['issues'])
                result = repair_result  # 用修复后的结果替换
                state = AgentState.REFLECTING

        if state == AgentState.COMPLETED:
            return {"status": "success", "result": result}
        else:
            # 兜底策略
            return await self._fallback(user_intent, plan, current_step)
```

## 关键容错机制

### 1. 重试策略

```python
async def _execute_with_timeout(self, step, timeout=None):
    """带超时和重试的执行"""
    timeout = timeout or self.timeout
    for attempt in range(self.max_retries):
        try:
            return await asyncio.wait_for(
                self._call_tool(step['tool'], step['params']),
                timeout=timeout
            )
        except asyncio.TimeoutError:
            wait_time = 2 ** attempt  # 指数退避
            await asyncio.sleep(wait_time)
    raise TimeoutError(f"Step timed out after {self.max_retries} retries")
```

### 2. 降级兜底

```python
async def _fallback(self, intent, plan, failed_step):
    """多级降级策略"""
    # Level 1: 跳过失败步骤，继续后续步骤
    if self._can_skip(plan, failed_step):
        return await self._continue_without_step(plan, failed_step)

    # Level 2: 使用缓存结果
    cached = self._get_cached_result(intent)
    if cached:
        return {"status": "degraded", "result": cached}

    # Level 3: 返回默认回答 + 标记需人工处理
    return {
        "status": "fallback",
        "result": "抱歉，当前无法完成此任务，已转人工处理。",
        "escalate": True,
    }
```

## 面试加分点

1. **量化对比**：单步执行准确率85%→加Reflector后等效97%（5步场景从44%→81%）
2. **Reflector设计**：不只是"对不对"，还要检查"是否完整"、"是否一致"、"是否安全"
3. **状态机优势**：可观测（每步有明确状态）、可恢复（崩溃后可从断点继续）、可审计（完整执行日志）
4. **成本控制**：Repair只改有问题的步骤而非全部重做，Token消耗降低60%+

## 记忆要点

- 口诀法：规划Planner、执行Executor、反思Reflector构成核心闭环状态机
- 因果句：因为大模型存在幻觉且不可控，所以必须引入Reflector节点做结果校验
- 对比句：反思通过则状态流转至完成，反思失败且重试超限则转入降级兜底状态
- 口诀法：状态机管理节点流转，精准控制重试次数超时限制与人工接管


## 苏格拉底式面试追问

> 这组追问模拟面试官层层逼问，每一问先回答"为什么"，再回答"怎么做"，最后回答"如何证明"。

### 第一层：目标与动机

**Q：Planner-Executor-Reflector 闭环为什么需要 Reflector？只有 Planner 和 Executor 不够吗？**

不够。Planner 是事前规划，基于不完整信息拆解任务；Executor 执行时可能遇到预期外情况（工具返回错误、中间结果不符合预期）。没有 Reflector，错误会沿着执行链路累积到最终输出。Reflector 在每步执行后校验结果是否符合预期，不符合则触发修复（重试、改方案、降级）。本质是把"开环执行"变成"闭环纠错"，类似控制系统的反馈回路。没有反馈的开环系统在长任务中必然会累积偏差。

### 第二层：证据与定位

**Q：Agent 在某一步执行失败后没有触发 Reflector 的修复，直接返回错误，怎么定位？**

看状态机的状态转移日志：1) Executor 返回失败后，状态是否转移到 REFLECTING 状态——如果没有转移，是状态机的转移条件写错了（如只看 status=success 才转移，失败直接终止）；2) 如果转移到了 REFLECTING 但 Reflector 判断"无需修复"，是 Reflector 的判断逻辑太宽松（如只对特定错误类型触发修复）；3) 如果 Reflector 决定修复但没执行，是修复动作的调度问题。用 trace 追每一步的状态值。

### 第三层：根因深挖

**Q：Reflector 判断"需要修复"但修复后还是失败，根因是修复策略不够还是原始任务不可行？**

看修复的尝试和结果。1) 如果修复策略是"重试同样的工具调用"且连续失败，根因可能是工具本身不可用（如外部 API 挂了），重试无效，要换工具或降级；2) 如果修复策略是"换方案"（如从查询数据库换成搜索文档）但仍失败，可能是任务目标本身有问题（如查询的数据不存在）；3) 如果修复后部分成功，是修复策略不完整。区分方法：看修复前后的错误信息是否相同——相同错误重试无效是工具问题，不同错误是任务复杂度超预期。

**Q：那为什么不直接设置"无限重试 + 换策略"，而要限制重试次数？**

无限重试会导致：1) 成本爆炸——每次重试消耗 token 和工具调用费用；2) 延迟不可控——用户等不了一个无限重试的 Agent；3) 死循环——某些错误（如权限不足）无论怎么重试都失败，无限重试是浪费。限制重试次数（如 3 次）+ 降级兜底（重试失败转人工或返回默认答案）是"在可用性和成本间权衡"。经验上 3 次重试覆盖 90% 的瞬时故障，超过 3 次通常是确定性故障，重试无意义。

### 第四层：方案权衡

**Q：用状态机管控 Planner-Executor-Reflector，vs 用纯函数式编排（如 LangChain 的 LCEL），怎么选？**

状态机适合"有复杂状态转移和异常处理"的场景——每个状态有明确的转移条件，异常路径（超时、失败、降级）可以显式定义，可调试性强（看状态转移图就知道 Agent 走到哪）。纯函数式编排适合"线性流程"——happy path 清晰，异常少，代码简洁。Agent 任务通常有多种异常路径和重试逻辑，状态机的显式管理更可控。经验上，生产级 Agent 用状态机（如 LangGraph），原型阶段用函数式（快速验证逻辑）。

**Q：为什么不直接用 try-catch 异常处理代替状态机？**

try-catch 是"代码层的异常捕获"，状态机是"业务层的状态管理"。Agent 的执行不是简单的函数调用，而是"多步骤、有状态、可重试、可降级"的复杂流程。try-catch 只能捕获异常，无法表达"执行失败后重试 3 次、仍失败则降级到缓存、缓存也没有则转人工"这种多层兜底逻辑。状态机把这些逻辑显式建模为状态和转移，可读、可测、可监控。try-catch 适合简单异常，状态机适合复杂流程控制。

### 第五层：验证与沉淀

**Q：怎么衡量 Reflector 闭环真的提升了任务成功率？**

对比实验：1) 开启 Reflector vs 关闭 Reflector，跑同一批多步任务（如 100 个），看 task_success_rate——开启应该高 10-20%（因为错误被中途修复）；2) 分析 Reflector 的触发率和修复成功率——触发率（多少比例的步骤触发 Reflector）反映任务复杂度，修复成功率（触发后多少比例成功修复）反映 Reflector 有效性；3) 成本对比——开启 Reflector 会增加 token 消耗（额外的反思调用），算"成功率提升 vs 成本增加"的 ROI。沉淀为闭环调优手册：重试策略、降级策略、状态转移图的版本管理。

## 结构化回答

**30 秒电梯演讲：** Planner-Executor-Reflector闭环 = 规划任务→执行→反思校验→修复，用状态机管控重试/超时/异常兜底，实现Agent自我纠错。

**展开框架：**
1. **Planner** — Planner拆分任务为子步骤，输出结构化执行计划
2. **Executor** — Executor按计划逐步执行，调用工具/API
3. **Reflector** — Reflector检查结果质量，决定通过/修复/放弃

**收尾：** 您想深入聊：Reflector用什么模型？需要和Executor不同吗？


## 视频脚本

> 预计时长：5 分钟 | 由浅入深


| 时间 | 画面/字幕 | 口播台词 | 讲解要点 |
|------|----------|----------|----------|
| 0:00 | 标题卡：简述Agent的Planner-Executor… | "就像装修工程——设计师出图（Planner）→工人施工（Executor）→质检员验收（…" | 开场钩子 |
| 0:20 | 核心概念图 | "Planner-Executor-Reflector闭环 = 规划任务→执行→反思校验→修复，用状态机管控重试/超时/异…" | 核心定义 |
| 0:50 | Planner示意图 | "Planner——Planner拆分任务为子步骤，输出结构化执行计划" | 要点拆解1 |
| 1:30 | Executor示意图 | "Executor——Executor按计划逐步执行，调用工具/API" | 要点拆解2 |
| 2:20 | 对比/实战案例图 | "对比一下常见误区和工程实践，看真实场景里怎么取舍。" | 实战与对比 |
| 3:10 | 总结卡 | "记住核心要点。下期我们追问：Reflector用什么模型？需要和Executor不同吗？" | 收尾与钩子 |
