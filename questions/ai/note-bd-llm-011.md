---
id: note-bd-llm-011
difficulty: L4
category: ai
subcategory: Agent
tags:
- 字节
- 面经
- Agent
- 工具调用
- 容错
- 回滚
- 上下文管理
feynman:
  essence: Agent工具调用失败需要三层容错：自动重试→工具替换→任务降级，同时用摘要压缩控制上下文长度。
  analogy: 就像导航软件——一条路堵了(工具失败)先等一会儿(重试)，不行就换路(替代工具)，再不行就改目的地(降级)，同时只记住关键路况不记所有细节(摘要压缩)。
  first_principle: Agent容错 = 重试策略 + 状态回滚 + 上下文压缩，三者缺一不可。
  key_points:
  - 自动重试(指数退避,3次)
  - 工具替换(同类工具fallback)
  - 状态回滚(checkpoint恢复)
  - 上下文压缩(失败信息摘要化)
  - 步数限制(防止无限循环)
first_principle:
  essence: Agent的鲁棒性 = 容错深度 × 上下文控制力
  derivation: 工具失败→重试→仍失败→需要回滚到上一个checkpoint→历史信息膨胀→需要摘要压缩→每步只保留关键信息
  conclusion: Agent容错设计的核心是'优雅降级+上下文压缩'的平衡
follow_up:
- 如何设计Agent的checkpoint机制？
- 多个工具同时失败怎么处理？
- 如何监控Agent的成功率？
memory_points:
- 容错四步曲：因为参数错误不重试，所以需判断是否可重试；网络波动用指数退避重试，失败则换同类工具降级。
- 外挂状态隔离：因重试日志易撑爆窗口，故用外部数据库存状态与报错，上下文只留摘要。
- 多级记忆治理：重试失败错误折叠成总结，用KV缓存复用前缀，防止上下文膨胀。
- 回滚机制：失败时读取外部检查点，并在上下文中写入指令引导Agent退回上一安全步。
---

# 【字节面经】如果 Agent 在多步推理过程中某一步调用工具失败，你如何设计容错和回滚机制，同时不让上下文窗口膨胀失控？

## 一、问题拆解

这道题考的是两个紧密耦合的问题：

1. **容错与回滚**：工具调用失败后如何恢复——重试？换工具？回退状态？降级？
2. **上下文膨胀控制**：每一步的推理、工具调用、结果、错误信息都会写入上下文历史。多步Agent跑10步就可能产生数万token，失败重试更是成倍增加。

核心矛盾在于：**容错需要记录更多信息（错误日志、checkpoint、重试记录），但这些信息会让上下文膨胀**。设计目标是"优雅降级 + 精简上下文"的平衡。

## 二、容错四层策略

### 层级一：自动重试（指数退避）

```python
import asyncio
import time
from functools import wraps
from typing import Callable, Any

def retry_with_backoff(max_retries: int = 3, base_delay: float = 1.0, max_delay: float = 30.0):
    """
    指数退避重试装饰器
    - max_retries: 最大重试次数（不含首次）
    - base_delay: 初始延迟
    - max_delay: 最大延迟上限
    """
    def decorator(func: Callable) -> Callable:
        @wraps(func)
        async def wrapper(*args, **kwargs) -> Any:
            last_exception = None
            for attempt in range(max_retries + 1):
                try:
                    result = await func(*args, **kwargs)
                    if attempt > 0:
                        # 重试成功后，只记录摘要到上下文
                        return {
                            'success': True,
                            'result': result,
                            'retries': attempt,
                            'summary': f'工具{func.__name__}在第{attempt+1}次调用成功'
                        }
                    return {'success': True, 'result': result, 'retries': 0}

                except Exception as e:
                    last_exception = e
                    if attempt < max_retries:
                        # 判断是否值得重试（网络超时可重试，参数错误不重试）
                        if not _is_retryable(e):
                            break
                        delay = min(base_delay * (2 ** attempt), max_delay)
                        # 加入抖动避免雪崩
                        jitter = delay * 0.1 * (2 * (time.time() % 1) - 1)
                        await asyncio.sleep(delay + jitter)
                    else:
                        break

            # 重试全部失败
            return {
                'success': False,
                'error': str(last_exception),
                'retries': max_retries,
                'summary': f'工具{func.__name__}重试{max_retries}次后仍失败: {last_exception}'
            }
        return wrapper
    return decorator

def _is_retryable(error: Exception) -> bool:
    """判断错误是否值得重试"""
    retryable_keywords = ['timeout', 'connection', 'rate_limit', '503', '502', '429']
    error_str = str(error).lower()
    return any(kw in error_str for kw in retryable_keywords)
```

### 层级二：工具替换（同类工具 Fallback）

当重试失败后，不直接放弃任务，而是尝试用**同类替代工具**完成相同功能。

```python
from dataclasses import dataclass, field
from typing import List, Dict, Optional

@dataclass
class ToolCallResult:
    success: bool
    result: Any = None
    error: str = ""
    tool_used: str = ""
    attempts: List[Dict] = field(default_factory=list)  # 精简的尝试记录

class ToolFallbackManager:
    """同类工具替换管理器"""

    # 工具分组：同类工具按优先级排列
    TOOL_GROUPS = {
        'web_search': ['google_search', 'bing_search', 'duckduckgo_search'],
        'code_execution': ['python_sandbox', 'code_interpreter', 'local_python'],
        'database_query': ['postgres_query', 'mysql_query', 'sqlite_fallback'],
    }

    async def call_with_fallback(
        self, tool_category: str, params: dict, context: 'AgentContext'
    ) -> ToolCallResult:
        tools = self.TOOL_GROUPS.get(tool_category, [])
        attempts_log = []

        for i, tool_name in enumerate(tools):
            attempt = {'tool': tool_name, 'status': 'pending'}

            try:
                result = await self._execute_tool(tool_name, params)
                attempt['status'] = 'success'
                attempts_log.append(attempt)
                # 成功后只保留精简摘要
                return ToolCallResult(
                    success=True,
                    result=result,
                    tool_used=tool_name,
                    attempts=[{'tool': tool_name, 'status': 'ok'}]
                )
            except Exception as e:
                attempt['status'] = 'failed'
                attempt['error_brief'] = str(e)[:100]  # 截断错误信息
                attempts_log.append(attempt)
                continue

        # 所有替代工具都失败
        return ToolCallResult(
            success=False,
            error=f"类别{tool_category}的所有工具均失败",
            tool_used="none",
            attempts=attempts_log
        )

    async def _execute_tool(self, tool_name: str, params: dict):
        # 实际工具执行逻辑
        tool_func = self._get_tool(tool_name)
        return await tool_func(**params)
```

### 层级三：状态回滚（Checkpoint 恢复）

Agent每完成一个关键步骤就保存checkpoint，失败时回滚到最近的成功状态。

```python
import copy
import json
from typing import Any, List
from dataclasses import dataclass, field

@dataclass
class Checkpoint:
    """Agent状态快照"""
    step: int                              # 步骤序号
    state: dict                            # Agent可变状态
    context_summary: str                   # 上下文摘要（不存全量）
    tool_calls_done: List[dict]            # 已完成工具调用（精简版）
    timestamp: float

class CheckpointManager:
    """Checkpoint管理器：支持状态回滚"""

    def __init__(self, max_checkpoints: int = 5):
        self.checkpoints: List[Checkpoint] = []
        self.max_checkpoints = max_checkpoints

    def save(self, step: int, state: dict, context_summary: str, tool_calls: List[dict]):
        """在关键步骤后保存checkpoint"""
        # 深拷贝防止后续修改影响快照
        cp = Checkpoint(
            step=step,
            state=copy.deepcopy(state),
            context_summary=context_summary,
            tool_calls_done=[{
                'step': tc.get('step'),
                'tool': tc.get('tool'),
                'success': tc.get('success')
            } for tc in tool_calls],  # 只保留关键字段
            timestamp=time.time()
        )
        self.checkpoints.append(cp)

        # 只保留最近N个checkpoint，避免内存膨胀
        if len(self.checkpoints) > self.max_checkpoints:
            self.checkpoints = self.checkpoints[-self.max_checkpoints:]

    def rollback(self, steps_back: int = 1) -> Optional[Checkpoint]:
        """回滚到N步前的checkpoint"""
        if len(self.checkpoints) > steps_back:
            target = self.checkpoints[-(steps_back + 1)]
            # 移除之后的checkpoint
            self.checkpoints = self.checkpoints[:-(steps_back)]
            return target
        elif self.checkpoints:
            return self.checkpoints[0]
        return None

    def get_latest_safe(self) -> Optional[Checkpoint]:
        """获取最近的成功checkpoint"""
        for cp in reversed(self.checkpoints):
            if cp.state.get('status') == 'stable':
                return cp
        return self.checkpoints[0] if self.checkpoints else None
```

### 层级四：上下文压缩（失败信息摘要化）

这是控制上下文窗口膨胀的核心机制。**原则：只保留关键决策和结果，丢弃中间过程细节。**

```python
from typing import List

class ContextCompressor:
    """上下文压缩器：将冗长的对话历史压缩为摘要"""

    # 触发压缩的token阈值
    COMPRESS_THRESHOLD = 4000  # 当历史超过此值时触发压缩
    TARGET_TOKENS = 2000       # 压缩后目标token数

    def __init__(self, llm_client):
        self.llm = llm_client

    def should_compress(self, context_messages: List[dict]) -> bool:
        estimated_tokens = sum(len(m['content']) // 2 for m in context_messages)
        return estimated_tokens > self.COMPRESS_THRESHOLD

    async def compress_context(
        self, messages: List[dict], current_goal: str
    ) -> List[dict]:
        """
        压缩上下文历史：
        - 保留最近2轮对话（短期记忆）
        - 将更早的历史用LLM摘要压缩为一段
        - 失败的工具调用只保留一句结论
        """
        if len(messages) <= 4:
            return messages

        # 分割：最近N轮保留原文，更早的压缩
        recent_keep = 4  # 保留最近4条消息
        to_compress = messages[:-recent_keep]
        recent = messages[-recent_keep:]

        # 构造压缩prompt
        compression_prompt = f"""
请将以下Agent执行历史压缩为简洁摘要。要求：
1. 保留关键决策点和最终结果
2. 失败的工具调用只保留"工具X失败，原因：Y"的结论
3. 保留与当前目标"{current_goal}"相关的关键信息
4. 压缩到200字以内

执行历史：
{self._format_messages(to_compress)}
"""
        summary = await self.llm.complete(compression_prompt)

        # 重构上下文：摘要 + 最近对话
        compressed = [
            {
                'role': 'system',
                'content': f'[历史摘要] {summary}'
            },
            *recent
        ]
        return compressed

    def _format_messages(self, messages: List[dict]) -> str:
        lines = []
        for m in messages:
            role = m['role']
            content = m['content']
            # 工具调用结果只保留前200字符
            if 'tool_result' in m.get('name', ''):
                content = content[:200] + '...' if len(content) > 200 else content
            lines.append(f"[{role}] {content}")
        return '\n'.join(lines)
```

## 三、完整 Agent 容错编排

将四层策略组合为完整的执行循环：

```python
class FaultTolerantAgent:
    """容错Agent主循环"""

    def __init__(self, llm_client, max_steps: int = 15):
        self.llm = llm_client
        self.max_steps = max_steps
        self.checkpoint_mgr = CheckpointManager()
        self.fallback_mgr = ToolFallbackManager()
        self.compressor = ContextCompressor(llm_client)

    async def run(self, task: str) -> dict:
        state = {'task': task, 'results': [], 'status': 'running'}
        context = [{'role': 'user', 'content': task}]

        for step in range(self.max_steps):
            # === 0. 上下文压缩检查 ===
            if self.compressor.should_compress(context):
                context = await self.compressor.compress_context(context, task)

            # === 1. LLM决策：下一步做什么 ===
            decision = await self.llm.complete(context, tools=self._get_tools())
            if decision.get('action') == 'finish':
                state['status'] = 'completed'
                break

            tool_category = decision['tool']
            params = decision.get('params', {})

            # === 2. 带容错的工具调用 ===
            result = await self.fallback_mgr.call_with_fallback(
                tool_category, params, context
            )

            if result.success:
                # === 3a. 成功：保存checkpoint ===
                state['results'].append({
                    'step': step, 'tool': result.tool_used, 'data': result.result
                })
                self.checkpoint_mgr.save(
                    step, state, self._summarize(context), state['results']
                )
                # 写入上下文（精简）
                context.append({
                    'role': 'tool',
                    'name': f'tool_result',
                    'content': json.dumps(result.result, ensure_ascii=False)[:500]
                })
            else:
                # === 3b. 失败：回滚 + 重试/降级 ===
                safe_cp = self.checkpoint_mgr.get_latest_safe()
                if safe_cp:
                    state = copy.deepcopy(safe_cp.state)
                    context.append({
                        'role': 'system',
                        'content': f'[步骤{step}失败，已回滚到步骤{safe_cp.step}] '
                                   f'失败原因: {result.error[:100]}'
                    })
                else:
                    # 没有checkpoint可回滚，任务降级
                    context.append({
                        'role': 'system',
                        'content': f'[步骤{step}失败且无法回滚，尝试降级处理] '
                                   f'原始目标: {task}'
                    })
                    # 让LLM决定如何降级
                    degraded_decision = await self.llm.complete(
                        context + [{'role': 'system',
                            'content': '请基于当前可用的信息给出最佳的部分结果。'}],
                    )
                    state['results'].append({
                        'step': step, 'action': 'degraded_result',
                        'data': degraded_decision
                    })
                    state['status'] = 'degraded'
                    break

        else:
            state['status'] = 'max_steps_reached'

        return state

    def _summarize(self, context):
        return context[-1]['content'][:200] if context else ''

    def _get_tools(self):
        return list(self.fallback_mgr.TOOL_GROUPS.keys())
```

## 四、容错流程图

```
┌──────────────────────────────────────────────────────────────────────┐
│                     Agent 容错与回滚流程                               │
├──────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  START                                                               │
│    │                                                                 │
│    ▼                                                                 │
│  ┌──────────────┐    超阈值     ┌──────────────────┐                │
│  │ 上下文压缩检查 │─────────────▶│  历史摘要化压缩    │                │
│  │ token < 阈值? │              │  只保留关键信息    │                │
│  └──────┬───────┘              └────────┬─────────┘                │
│         │ 正常                          │                           │
│         ▼                               │                           │
│  ┌──────────────┐                      │                           │
│  │ LLM决策:     │◀─────────────────────┘                           │
│  │ 下一步动作    │                                                  │
│  └──────┬───────┘                                                  │
│         │                                                          │
│         ▼                                                          │
│  ┌──────────────┐     成功      ┌──────────────────┐              │
│  │ 工具调用(重试) │────────────▶│  保存Checkpoint    │              │
│  │ 指数退避3次   │             │  state + 摘要      │              │
│  └──────┬───────┘             └────────┬─────────┘              │
│         │ 失败                         │                          │
│         ▼                              │                          │
│  ┌──────────────┐     成功      ┌───────▼──────────┐             │
│  │ 工具替换     │────────────▶│  继续下一步        │──────────┐   │
│  │ 同类fallback │             │  (写入精简上下文)  │          │   │
│  └──────┬───────┘             └──────────────────┘          │   │
│         │ 失败                                               │   │
│         ▼                                                    │   │
│  ┌──────────────┐     有CP    ┌──────────────────┐          │   │
│  │ 状态回滚     │────────────▶│  恢复到上一安全CP  │          │   │
│  │ Checkpoint   │             │  重新决策路径      │────┐     │   │
│  └──────┬───────┘             └──────────────────┘    │     │   │
│         │ 无CP                          │              │     │   │
│         ▼                               │              │     │   │
│  ┌──────────────┐                      │              │     │   │
│  │ 任务降级     │                      │              │     │   │
│  │ 部分结果返回  │                      │              │     │   │
│  └──────┬───────┘                      │              │     │   │
│         │                              │              │     │   │
│         ▼                              ▼              ▼     ▼   │
│      ┌──────┐                                          ┌──────┐  │
│      │ END  │◀─────────────────────────────────────────│ 循环 │──┘
│      └──────┘     (达到max_steps或LLM决定finish)        └──────┘  │
│                                                                    │
└────────────────────────────────────────────────────────────────────┘
```

## 五、关键设计原则总结

| 设计原则 | 具体做法 | 解决的问题 |
|---------|---------|-----------|
| 重试有界 | 指数退避，最多3次，区分可重试/不可重试错误 | 避免无限重试浪费资源 |
| 工具替换 | 同类工具fallback链，优先级排列 | 单一工具挂掉不影响整体任务 |
| Checkpoint精简 | 只存state快照+摘要，不存全量上下文 | 回滚本身不导致内存膨胀 |
| 上下文压缩 | 历史超过阈值时LLM摘要，保留最近2轮+摘要 | 控制token在可管理范围 |
| 步数硬限制 | max_steps=15，超时直接结束 | 防止Agent陷入无限循环 |
| 错误信息截断 | 失败信息只保留前100字符的结论 | 防止异常stack trace撑爆上下文 |
| 降级策略 | 无法恢复时让LLM基于已有信息给部分结果 | 保证用户至少能拿到有价值的输出 |

## 六、面试回答话术

> "我的设计分为四个层次。**第一层是自动重试**，用指数退避策略，但关键是要区分可重试错误（超时、限流）和不可重试错误（参数错误），不可重试的直接跳过。**第二层是工具替换**，我会预先定义同类工具的fallback链，比如Google搜索失败就自动切Bing，这样单一工具故障不会中断任务。**第三层是状态回滚**，每步成功后保存checkpoint，但checkpoint只存state快照和上下文摘要，不存全量历史，这样回滚不会引入额外内存开销。**第四层也是最关键的上下文压缩**，当历史超过阈值时，用LLM将早期对话摘要为一段文字，只保留最近2轮原文和关键决策点，失败的工具调用只留一句结论。四个层次叠加，Agent既能优雅降级，又能把上下文控制在可管理的token范围内。整体上设一个15步硬限制兜底，防止极端情况下的无限循环。"

## 记忆要点

- 容错四步曲：因为参数错误不重试，所以需判断是否可重试；网络波动用指数退避重试，失败则换同类工具降级。
- 外挂状态隔离：因重试日志易撑爆窗口，故用外部数据库存状态与报错，上下文只留摘要。
- 多级记忆治理：重试失败错误折叠成总结，用KV缓存复用前缀，防止上下文膨胀。
- 回滚机制：失败时读取外部检查点，并在上下文中写入指令引导Agent退回上一安全步。

## 苏格拉底式面试追问

> 这组追问模拟面试官层层逼问，每一问先回答"为什么"，再回答"怎么做"，最后回答"如何证明"。

### 第一层：目标与动机

**Q：Agent 工具调用失败你做"重试+换工具+降级"容错，为什么不让 LLM 自己判断失败后怎么办，省得写规则？**

因为 LLM 对"失败处理"的判断不可靠且会膨胀上下文。LLM 看到工具失败后，可能：瞎重试（同样的参数再调一次，注定失败）、过度反思（写一大段失败分析占满 context）、或放弃（直接返回"无法完成"）。显式容错规则（重试几次、何时换工具、何时降级）是确定性的，不依赖 LLM 判断，且能控制上下文不膨胀。动机是"把容错逻辑从 LLM 的不确定决策中剥离出来，用确定性代码保证"。

### 第二层：证据与定位

**Q：Agent 任务在第 5 步工具调用失败后卡住了，你怎么定位是重试逻辑没触发、降级没生效、还是回滚失败？**

看 Trace 的工具调用段。检查：一是失败工具的 error 是否被正确捕获（如果是 unhandled exception 导致 Agent 崩溃，是异常处理 bug）；二是重试是否触发（看是否有重试日志、重试次数）；三是重试仍失败后是否切了备用工具（看是否有 tool_switch 事件）；四是回滚是否执行（看是否回到检查点）。每一步都有埋点的话，Trace 能精确定位卡在哪一环。常见根因：error 类型不在重试白名单里（如参数错误被当成可重试错误重试了 3 次都失败）。

### 第三层：根因深挖

**Q：你发现工具调用的"参数错误"（如类型不对）被当成可重试错误重试了 3 次都失败，浪费了时间和 token。根因和解法？**

根因是错误分类不当。"参数错误"（400 Bad Request）是确定性错误——同样的参数再调还是错，重试无意义。只有"网络错误""超时""429 限流""5xx 服务端错误"是可重试的（偶发性，重试可能成功）。解法是在重试前判断错误类型：HTTP 状态码 4xx（除 429）不重试（参数/权限问题，重试无用），5xx 和网络错误重试。对参数错误，应该把错误信息反馈给 LLM 让它修正参数（"上次调用失败，参数 X 应该是 int 不是 string，请修正"），而非盲目重试。

**Q：那为什么不直接对所有失败都"反馈给 LLM 修正"，省得区分错误类型？**

因为有些失败 LLM 修不了。网络超时、服务不可用、权限不足，这些 LLM 改参数也没用（不是参数问题）。且反馈给 LLM 要消耗一次 LLM 调用（延迟+成本），对确定性的网络错误，直接重试（不经过 LLM）更快。正确策略是分层：网络/超时类（偶发）直接重试不告诉 LLM；参数类（LLM 能修）反馈给 LLM 修正；权限/服务不可用类（LLM 修不了）切备用工具或降级。错误分类是优化的前提，不分类一律反馈 LLM 是浪费。

### 第四层：方案权衡

**Q：你用"外部数据库存状态和报错，上下文只留摘要"控制上下文膨胀。具体存什么、摘要怎么生成？**

存"完整的工具调用记录"（请求参数、响应、错误堆栈、重试历史）到外部 DB（如 Redis/Postgres），按 trace_id 索引。上下文里只保留摘要——成功调用保留"调用了工具 X，返回了 Y（关键字段）"；失败调用保留"工具 X 失败，原因：参数错误，已切备用工具 Y"。摘要可以用固定模板（提取关键字段）或 LLM 生成（对长响应做总结）。关键是上下文里只放"模型决策需要的信息"（如工具是否成功、返回了什么关键结果），完整日志在外部供 debug。这样上下文不随步数爆炸。

**Q：为什么不直接用滑动窗口（只保留最近 N 步的完整记录），省得搞外部存储和摘要？**

滑动窗口会丢历史信息。如果第 1 步的工具返回了关键数据（如用户 ID），第 8 步还需要这个数据，滑动窗口只保留最近 3 步的话第 1 步被丢弃，第 8 步拿不到。外部存储 + 摘要的价值是"历史信息被压缩但可回查"——摘要保留关键信息（用户 ID）在上下文里，完整记录在外部，模型需要细节时可以通过工具查询外部存储。滑动窗口是"丢弃"，外部存储是"压缩+可回查"，后者信息保全更好。

### 第五层：验证与沉淀

**Q：你怎么衡量容错机制有效，而非"配了但不知道有没有用"？**

统计容错各环节的触发率和成功率。重试触发率（多少失败触发了重试）、重试成功率（重试后成功的比例，应 >50% 否则重试无意义）、工具切换触发率、降级触发率。线上注入故障测试（模拟工具超时/返回错误），验证容错是否正确触发。对比"有容错 vs 无容错"的任务完成率（无容错时工具失败=任务失败，有容错可能挽回），量化容错挽回的任务比例。如果容错挽回率 >10%，证明价值显著。

**Q：Agent 容错怎么沉淀成框架能力？**

封装成 `tool_call_with_resilience(tool, params)` 函数：内置错误分类（可重试/可修正/不可恢复）、重试策略（指数退避、最大次数）、工具切换（同类工具 fallback 列表）、降级（返回默认/切规则）、状态外挂（完整记录存外部、摘要进上下文）。业务侧只定义工具和 fallback，不写容错逻辑。沉淀"常见工具的错误分类规则""各工具的 fallback 推荐表""摘要模板库"，新 Agent 接入即获得容错。配套 Trace 看板展示容错各环节触发情况。

## 结构化回答




**30 秒电梯演讲：** 就像导航软件——一条路堵了(工具失败)先等一会儿(重试)，不行就换路(替代工具)，再不行就改目的地(降级)，同时只记住关键路况不记所有细节(摘要压缩)。

**展开框架：**
1. **自动重试** — 自动重试(指数退避,3次)
2. **工具替换** — 工具替换(同类工具fallback)
3. **状态回滚** — 状态回滚(checkpoint恢复)

**收尾：** 如何设计Agent的checkpoint机制？





## 视频脚本

> 预计时长：5 分钟 | 由浅入深


| 时间 | 画面/字幕 | 口播台词 | 讲解要点 |
|------|----------|----------|----------|
| 0:00 | 标题卡：如果 Agent 在多步推理过程中某一步调用工具… | "就像导航软件——一条路堵了(工具失败)先等一会儿(重试)，不行就换路(替代工具)，再不行就…" | 开场钩子 |
| 0:20 | 核心概念图 | "Agent工具调用失败需要三层容错：自动重试→工具替换→任务降级，同时用摘要压缩控制上下文长度。" | 核心定义 |
| 0:50 | 自动重试(示意图 | "自动重试(——自动重试(指数退避,3次)" | 要点拆解1 |
| 1:30 | 工具替换(同示意图 | "工具替换(同——工具替换(同类工具fallback)" | 要点拆解2 |
| 2:20 | 对比/实战案例图 | "对比一下常见误区和工程实践，看真实场景里怎么取舍。" | 实战与对比 |
| 3:10 | 总结卡 | "记住核心要点。下期我们追问：如何设计Agent的checkpoint机制？" | 收尾与钩子 |
