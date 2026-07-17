---
id: note-lx-agent-013
difficulty: L4
category: ai
subcategory: Agent
tags:
- 联想
- 面经
- 一面
- 状态机
- 多模态
- 语音
- 异步处理
feynman:
  essence: 多模态Agent同时处理语音、文本和工具结果时，需要用分层状态机管理——每个模态独立状态追踪，通过事件队列异步汇总，中央调度器按优先级处理
  analogy: 就像电视台导播间——画面（视频）、声音（音频）、字幕（文本）、导播指令（工具）各有一个监控屏（独立状态），导播（调度器）根据优先级切换画面（状态转换）
  first_principle: 不同模态的数据到达时间、处理速度、优先级不同。强制同步会导致慢模态拖累快模态，需要异步事件驱动架构
  key_points:
  - 每个模态独立状态机：ASR状态/LLM状态/工具状态
  - 事件队列异步通信：模态间通过事件解耦
  - 优先级仲裁：语音打断文本、紧急工具结果优先
  - 状态合并：中央调度器汇总多模态状态做统一决策
first_principle:
  essence: 多模态处理的本质是异步事件流的管理和融合
  derivation: 语音流式输出100ms/帧，LLM推理3s/次，工具调用2s/次。如果同步等待，用户每说一句话要等5s才有反应。异步处理后：语音实时识别→意图就绪立即触发LLM→LLM输出即时流式返回。用户感知延迟从5s降到0.5s
  conclusion: 多模态状态机 = 模态独立状态 + 事件队列 + 优先级仲裁 + 状态融合
follow_up:
- 语音打断（Barge-in）怎么实现？正在说话时用户开口怎么处理？
- 多模态结果冲突时（如语音说"取消"但文本显示"确认"）怎么仲裁？
- 状态机的持久化怎么做？崩溃后怎么恢复？
memory_points:
- 多模态并发易冲突：语音、文本、工具结果同时到达，必须设置事件优先级
- 分层状态机：全局调度器把控主流程，各模态拥有独立子状态机
- 事件队列定优先级：因为用户中断(P0)最关键，所以必须打断ASR(P2)或LLM(P1)
---

# 如果一个Agent要同时处理语音、文本和工具结果，状态机应该怎么设计才不容易乱？

## 多模态状态冲突场景

```
用户正在语音说话："帮我查一下..."
    │
    │  ← ASR实时输出
    │  ← 同时文本框输入了"取消"
    │  ← 同时之前的工具调用返回了结果
    │
    ▼
┌──────────────────────────────────┐
│           状态混乱！               │
│  语音说"查询" → 应该继续           │
│  文本说"取消" → 应该中断           │
│  工具返回结果 → 应该处理           │
│  三个事件同时到达，谁优先？         │
└──────────────────────────────────┘
```

## 分层状态机架构

```
┌─────────────────────────────────────────────────┐
│              中央调度器 (Orchestrator)             │
│         状态: IDLE / LISTENING / THINKING         │
│              / EXECUTING / SPEAKING               │
│                                                   │
│    事件队列（按优先级排序）                         │
│    P0: 用户中断    P1: 工具完成                    │
│    P2: ASR结果     P3: 文本输入                    │
└────┬──────────┬──────────┬──────────────────────┘
     │          │          │
     ▼          ▼          ▼
┌─────────┐ ┌─────────┐ ┌─────────┐
│ ASR状态机 │ │ LLM状态机│ │工具状态机 │
│          │ │          │ │          │
│VAD→识别   │ │接收→推理  │ │调用→等待  │
│→输出     │ │→流式输出  │ │→完成/失败 │
│          │ │          │ │          │
│独立运行   │ │独立运行   │ │独立运行   │
└─────────┘ └─────────┘ └─────────┘
```

## 状态定义

```python
from enum import Enum

class GlobalState(Enum):
    IDLE = "idle"                    # 空闲，等待输入
    LISTENING = "listening"          # 正在接收语音/文本输入
    PROCESSING = "processing"        # LLM推理中
    TOOL_EXECUTING = "tool_exec"     # 工具执行中
    RESPONDING = "responding"        # 正在输出回复（TTS/文本）
    INTERRUPTED = "interrupted"      # 被用户中断

class ModalState(Enum):
    """各模态独立状态"""
    ASR_IDLE = "asr_idle"
    ASR_STREAMING = "asr_streaming"  # 语音识别中
    ASR_FINAL = "asr_final"          # 识别完成

    LLM_IDLE = "llm_idle"
    LLM_THINKING = "llm_thinking"    # 推理中
    LLM_STREAMING = "llm_streaming"  # 流式输出中

    TOOL_IDLE = "tool_idle"
    TOOL_RUNNING = "tool_running"    # 执行中
    TOOL_DONE = "tool_done"          # 完成
    TOOL_FAILED = "tool_failed"      # 失败
```

## 中央调度器

```python
import asyncio
from dataclasses import dataclass
from datetime import datetime

@dataclass(order=True)
class Event:
    priority: int                    # 0=最高
    timestamp: datetime
    source: str                      # asr/llm/tool/text
    data: dict

class MultiModalOrchestrator:
    def __init__(self):
        self.global_state = GlobalState.IDLE
        self.modal_states = {
            'asr': ModalState.ASR_IDLE,
            'llm': ModalState.LLM_IDLE,
            'tool': ModalState.TOOL_IDLE,
        }
        self.event_queue = asyncio.PriorityQueue()
        self.context_buffer = {}     # 各模态的中间结果

    async def run(self):
        """主循环：从事件队列取事件处理"""
        while True:
            event = await self.event_queue.get()
            await self._handle_event(event)

    async def _handle_event(self, event: Event):
        """根据事件类型和当前状态做状态转换"""

        # P0: 用户中断（最高优先级）
        if event.priority == 0:
            if self.global_state in (GlobalState.RESPONDING, GlobalState.PROCESSING):
                # 打断当前操作
                await self._interrupt()
                self.global_state = GlobalState.LISTENING
            return

        # P1: 工具完成
        if event.source == 'tool' and event.priority == 1:
            self.modal_states['tool'] = ModalState.TOOL_DONE
            self.context_buffer['tool_result'] = event.data
            # 检查是否所有前置条件满足
            if self._can_generate_response():
                await self._trigger_llm()

        # P2: ASR最终结果
        if event.source == 'asr' and event.priority == 2:
            self.modal_states['asr'] = ModalState.ASR_FINAL
            self.context_buffer['user_input'] = event.data['text']
            # 检查是否可以开始处理
            if self.global_state == GlobalState.LISTENING:
                self.global_state = GlobalState.PROCESSING
                await self._start_processing(event.data['text'])

        # P3: 文本输入（低优先级，等ASR空闲时处理）
        if event.source == 'text' and event.priority == 3:
            if self.modal_states['asr'] == ModalState.ASR_IDLE:
                self.context_buffer['user_input'] = event.data['text']
                await self._start_processing(event.data['text'])
            else:
                # ASR正在工作，文本排队等待
                await asyncio.sleep(0.1)
                await self.event_queue.put(event)
```

## Barge-in（语音打断）处理

```python
async def _interrupt(self):
    """处理用户打断"""
    # 1. 停止TTS输出
    await self.tts_engine.stop()

    # 2. 中止正在运行的LLM推理（如果可能）
    if self.modal_states['llm'] == ModalState.LLM_STREAMING:
        await self.llm_engine.cancel()

    # 3. 清理中间状态
    self.context_buffer.pop('partial_response', None)
    self.modal_states['llm'] = ModalState.LLM_IDLE

    # 4. 记录中断事件（用于分析用户行为）
    self._log_interrupt()

    # 5. 立即转入监听状态
    self.global_state = GlobalState.LISTENING
```

## 状态一致性保障

```python
# 状态快照：定期保存状态，崩溃后可恢复
async def checkpoint(self):
    snapshot = {
        'global_state': self.global_state.value,
        'modal_states': {k: v.value for k, v in self.modal_states.items()},
        'context_buffer': self.context_buffer,
        'timestamp': datetime.now().isoformat(),
    }
    await redis.set('agent_state', json.dumps(snapshot))

# 状态转换合法性检查
VALID_TRANSITIONS = {
    GlobalState.IDLE: {GlobalState.LISTENING},
    GlobalState.LISTENING: {GlobalState.PROCESSING, GlobalState.IDLE},
    GlobalState.PROCESSING: {GlobalState.TOOL_EXECUTING, GlobalState.RESPONDING, GlobalState.INTERRUPTED},
    GlobalState.TOOL_EXECUTING: {GlobalState.PROCESSING, GlobalState.INTERRUPTED},
    GlobalState.RESPONDING: {GlobalState.IDLE, GlobalState.INTERRUPTED},
    GlobalState.INTERRUPTED: {GlobalState.LISTENING, GlobalState.IDLE},
}

def _validate_transition(self, new_state: GlobalState):
    valid = VALID_TRANSITIONS.get(self.global_state, set())
    if new_state not in valid:
        raise StateError(f"非法状态转换: {self.global_state} → {new_state}")
```

## 面试加分点

1. **事件溯源**：所有状态变更记录为事件日志，支持回放和调试——出问题时可以精确复现
2. **背压控制**：当ASR输出速度超过LLM处理速度时，需要背压机制防止队列爆炸
3. **超时兜底**：每个状态设置超时计时器，卡在某个状态超过30s自动重置为IDLE
4. **测试策略**：用 property-based testing 验证所有状态转换组合的合法性

## 记忆要点

- 多模态并发易冲突：语音、文本、工具结果同时到达，必须设置事件优先级
- 分层状态机：全局调度器把控主流程，各模态拥有独立子状态机
- 事件队列定优先级：因为用户中断(P0)最关键，所以必须打断ASR(P2)或LLM(P1)

## 苏格拉底式面试追问

> 这组追问模拟面试官层层逼问，每一问先回答"为什么"，再回答"怎么做"，最后回答"如何证明"。

### 第一层：目标与动机

**Q：多模态 Agent 用分层状态机（中央调度器 + 模态子状态机）管理。但为什么不直接用一个"大状态机"统一管理所有模态？分层增加了复杂度（状态同步、事件传递），有什么不可替代的好处？**

分层（中央 + 子状态机）的好处是"解耦 + 可扩展 + 局部自治"。单一状态机的问题：一是状态爆炸——所有模态状态组合成一个全局状态，状态数 = 各模态状态的笛卡尔积（如 ASR 3 状态 × LLM 4 状态 × Tool 3 状态 = 36 全局状态），状态转换矩阵指数复杂，维护难。二是修改风险——改一个模态（如 ASR 加新状态）影响全局状态机，可能破坏其他模态的逻辑，测试面大。三是并发难——单状态机假设所有模态同步推进，但实际异步（ASR 流式 100ms、LLM 推理 3s、工具 2s），同步会慢模态拖累快模态。分层的好处：一是状态分离——每个模态独立状态机（ASR 自己 3 状态、LLM 自己 4 状态），状态数线性（3+4+3=10）而非乘积（36），简单。二是局部自治——模态内部状态转换（ASR 的 streaming→final）自管，不依赖中央，并发执行。三是中央聚焦——中央调度器只管"全局状态"（IDLE/LISTENING/PROCESSING 等高级状态）和"模态间协调"（事件优先级、状态融合），不陷入模态细节。四是可扩展——加新模态（如视觉）只需加视觉子状态机，接入事件队列，不影响其他模态，扩展性好。五是故障隔离——某模态崩溃（如 ASR 挂）不影响其他模态（LLM、Tool 仍运行），中央检测后降级处理。所以分层是"用复杂度（分层架构）换可维护性和可扩展性"，对多模态（3+ 模态）是必要的。单模态或简单场景单状态机够用。

### 第二层：证据与定位

**Q：你说事件队列用优先级（P0 用户中断 > P1 工具 > P2 ASR > P3 文本）。但优先级是静态的，某些场景可能不对（如工具结果对当前任务关键，应比 ASR 高）。静态优先级的局限是什么？要不要动态优先级？**

静态优先级的局限是"一刀切"，不适配场景变化。问题场景：一是工具结果的关键性变化——某些工具（如支付确认）结果对任务关键，应高优先级（立即处理）；某些工具（如后台统计）非关键，可低优先级。静态把所有工具设 P1，关键和非关键不分。二是 ASR 的实时性——语音流式 ASR 需实时反馈（否则延迟高），但静态设 P2（低于工具 P1），工具事件多时 ASR 排队，延迟。三是中断的细分——用户中断（P0）可能是"完全打断"（停止当前）或"补充信息"（不打断，等当前完成），静态 P0 都立即打断，过度。动态优先级的方案：一是基于事件属性——事件携带优先级（工具事件自带 priority 字段，关键工具设高、非关键设低），队列按事件优先级排序，而非固定来源优先级。二是基于上下文——中央调度器根据当前状态动态调整（如 RESPONDING 状态时，用户中断优先级最高；PROCESSING 状态时，工具结果优先级高，因为是当前任务所需）。三是基于时间敏感——实时性要求高的事件（ASR 流式、TTS 输出）优先级随时间衰减（排队久则升优先级，防饿死），非实时的（后台统计）可低。四是抢占 vs 非抢占——高优先级事件是否抢占当前处理（用户中断抢占，工具结果不抢占等当前完成）。动态优先级复杂但更优，权衡是"简单（静态）vs 灵活（动态）"。实践：起步用静态优先级（简单，覆盖大多数场景），监控优先级不合理的情况（如关键工具被低优先级排队），逐步引入动态（事件属性优先级、上下文调整）。完全动态优先级复杂，按需引入，不一上来就全动态。

### 第三层：根因深挖

**Q：Barge-in（语音打断）是 P0 优先级，立即打断 TTS 和 LLM。但 LLM 推理（尤其大模型）是"长任务"（几秒），强行中止可能产生不一致状态（部分输出生成了，状态半更新）。怎么安全中止 LLM？中止后的中间状态怎么清理？**

LLM 的安全中止涉及资源清理和状态一致性。中止的难点：一是流式输出已部分发出——LLM 流式生成时，部分 token 已发给 TTS 并播放给用户，中止时这些已播放的无法收回，用户听到了部分回答。二是状态半更新——LLM 推理过程中可能已更新内部状态（如 scratchpad、工具调用计划），中止后状态不一致（部分计划的工具没执行）。三是资源释放——LLM 推理占用 GPU、KV cache，中止需释放这些资源，否则泄漏。安全中止的策略：一是可取消的推理——LLM 推理设计为可取消（保留 cancel 句柄，调用 cancel 立即停止生成），现代推理引擎（vLLM、TGI）支持。二是状态事务化——LLM 的状态更新用事务（要么全部提交，要么全部回滚），中止时回滚未完成的事务，保持一致。三是部分输出的处理——已播放的 TTS 无法收回，但记录"被打断的回答"（用于分析用户为何打断，优化回答质量），新请求从头开始（不基于半成品续）。四是清理顺序——中止时按顺序清理：停 TTS（停止播放）→ 取消 LLM（停止生成）→ 清理 KV cache → 回滚状态 → 重置模态状态机（LLM 回 IDLE）→ 转入 LISTENING。五是超时兜底——如果 cancel 未及时生效（LLM 不响应取消），设超时（如 500ms），超时后强制释放资源（即使 LLM 还在跑，标记结果丢弃）。六是幂等设计——中止后重新开始的推理与之前无关（不依赖中止时的中间状态），避免不一致。实践中止流程：用户开口（VAD 检测）→ 触发 P0 中断 → 停 TTS + 取消 LLM + 清理状态 → 重置 → LISTENING。关键是"快速响应中断 + 清理一致 + 重新开始"，让用户感知"立即被打断、立即能说话"，背后是复杂的资源清理。

**Q：状态机持久化（checkpoint 到 Redis）能在崩溃后恢复。但恢复时，多模态的子状态机各自恢复，可能状态不一致（如 ASR 恢复到 streaming 但 LLM 恢复到 idle，实际应该是 ASR final + LLM thinking）。怎么保证恢复的一致性？**

崩溃恢复的一致性是多模态状态机的难点。不一致的来源：各模态子状态机可能在不同时刻 checkpoint（非原子），崩溃时部分模态是旧快照、部分是新，组合后不一致。保证一致性的策略：一是原子 checkpoint——所有模态 + 中央状态在同一事务内 checkpoint（同时快照），恢复时整体恢复，保证一致。实现：用分布式事务或单点原子写入（Redis 的 SET 是原子的，整体 JSON 序列化一次写入）。二是版本号/时间戳——checkpoint 带全局版本号（单调递增），恢复时取最新版本，丢弃过期的部分快照。各模态的 checkpoint 标版本号，恢复时按版本号对齐（只恢复同版本的各模态状态）。三是状态合法性校验——恢复后校验状态组合的合法性（如 ASR streaming + LLM thinking 是合法的，ASR idle + LLM streaming 不合法，因为 LLM streaming 需 ASR 已 final）。用 VALID_TRANSITIONS 校验，非法组合触发重置（回到 IDLE）。四是回退到安全点——如果恢复的状态不一致，回退到最近的"安全点"（如 IDLE 或 LISTENING），丢弃中间状态，让用户重新开始。这是"宁重做不做错"的策略，避免基于不一致状态继续导致更大错误。五是幂等恢复——恢复后的操作幂等（重新触发 ASR 或 LLM，结果一致），即使恢复状态有偏差，重做也能收敛到正确。五是用户感知——恢复时如果状态不一致，向用户说明（"刚才中断了，我们从...重新开始"），而非假装无中断。实践：原子 checkpoint（整体快照）+ 版本号对齐 + 合法性校验 + 不一致回退 + 用户感知。关键是"原子快照保证一致 + 校验兜底 + 不一致回退到安全"，让恢复可可靠。多模态恢复比单模态复杂，需整体设计而非各自恢复。

### 第四层：方案权衡

**Q：中央调度器用事件队列（asyncio.PriorityQueue）异步处理。但 Python 的 asyncio 是单线程，事件多时可能积压（处理不过来），延迟增加。要不要用多线程或多进程？异步 vs 多线程的权衡是什么？**

异步（asyncio）vs 多线程/多进程的权衡取决于瓶颈类型。asyncio 单线程的优势：一是 I/O 密集适合——多模态 Agent 的事件多为 I/O（ASR 流、LLM API 调用、工具调用），asyncio 的协程在 I/O 等待时让出（不阻塞），单线程能处理大量并发 I/O。二是无锁——单线程无需锁（协程间无抢占），简化并发编程，避免死锁。三是轻量——协程比线程轻（协程 KB 级，线程 MB 级），能开大量协程。劣势：一是 CPU 密集受限——单线程的 asyncio 在 CPU 密集任务（如本地模型推理）时阻塞（GIL），其他协程等。多模态 Agent 的 CPU 密集（如果本地跑小模型）会卡 event loop。二是单核——单线程只用一个核，多核利用需多进程。多线程/多进程的优势：CPU 密集可并行（多核），但引入锁和同步复杂度。权衡：一是 I/O 密集（LLM API、工具调用、网络）用 asyncio（够用，简单）。二是 CPU 密集（本地模型推理）用多进程（ProcessPool，绕过 GIL）或 C 扩展（如 torch 释放 GIL）。三是混合——asyncio 主循环（处理 I/O 事件），CPU 密集任务 offload 到进程池（asyncio.run_in_executor），结合两者优势。积压的处理：一是背压——事件队列设上限，超出时背压（通知生产者减速，如 ASR 降帧率），避免无限积压。二是优先级队列——重要事件优先处理（不被低优先级积压阻塞）。三是水平扩展——单实例处理不过来时，多实例分担（用户分流到不同实例）。实践：asyncio + 进程池（CPU 密集 offload）+ 背压控制，是 I/O+CPU 混合场景的常用架构。纯 asyncio 适合轻量 I/O，多进程适合 CPU 密集，结合适配多模态的混合负载。

**Q：事件溯源（所有状态变更记为事件日志）支持回放和调试。但事件日志增长快（每次状态变一条记录），长期运行日志爆炸。怎么管理事件日志的存储和保留？**

事件日志的管理需分层保留。存储策略：一是近期完整保留——近期（如 7 天）的事件日志完整存（支持近期问题回放调试），存 hot storage（Redis/ES，快速查询）。二是中期聚合——中期（如 30-90 天）聚合存（按 session/用户聚合关键事件，非每条状态变更），存 warm storage（数据库，中等查询速度）。三是长期归档——长期（> 90 天）归档（压缩存对象存储，如 S3），仅用于合规审计或长期分析，不常查。日志爆炸的控制：一是事件分级——关键事件（状态转换、错误、用户中断）完整记，次要事件（心跳、常规流式输出）采样记或不记，减少日志量。二是聚合——同一 session 的连续状态变聚合为"会话摘要"（session 级的关键事件序列），而非每条原子事件。三是采样——高频事件（如 ASR 每 100ms 的流式输出）采样记（每秒记一次），不记每帧。四是压缩——日志压缩存储（如 Parquet 列存），减少存储占用。五是 TTL——自动过期删除（hot 7 天、warm 90 天、archive 1 年），避免无限增长。保留的权衡：一是调试需求——近期完整保留支持快速调试（问题发生后 7 天内可回放）。二是合规需求——某些场景（金融、医疗）要求长期保留（审计），归档存。三是存储成本——完整保留成本高，分级保留平衡成本和可用性。实践：近期完整 + 中期聚合 + 长期归档 + 事件分级 + 采样 + TTL，控制日志量同时满足调试和合规。事件溯源的价值（可回放、可调试）大于存储成本，但需管理存储避免爆炸。

### 第五层：验证与沉淀

**Q：多模态状态机设计后，怎么验证它的正确性？状态转换组合很多（尤其多模态并发），怎么测试覆盖所有可能的不一致或冲突？**

状态机的正确性验证需多策略。一是状态转换合法性测试——用 VALID_TRANSITIONS 校验所有可能的状态转换，非法转换（如 RESPONDING→LISTENING 不经 INTERRUPTED）应报错。遍历所有状态对，验证合法/非法判定正确。二是 property-based testing——生成随机事件序列（随机优先级、随机时序），跑状态机，验证不变量（如"任何时刻状态合法"、"中断后总能回到 LISTENING"、"不出现死锁"）。工具如 Hypothesis，自动生成大量测试用例，覆盖人工想不到的边界。三是并发场景测试——构造并发事件（同时 ASR final + 工具完成 + 文本输入），验证优先级处理正确（P0 先、不饿死低优先级）。四是故障注入——注入故障（LLM 推理超时、工具失败、崩溃），验证状态机正确处理（超时重置、失败降级、崩溃恢复）。五是形式化验证——对关键状态机用模型检查（如 TLA+、Promela）验证属性（如"无死锁"、"最终一致"），数学保证。六是线上监控——监控状态转换的异常（非法转换告警、状态卡住超时告警），线上发现测试漏掉的问题。七是压力测试——高并发事件（如 100 用户同时中断），验证状态机在负载下正确（无竞争、无丢失）。证明逻辑是"合法性测试 + property-based + 并发测试 + 故障注入 + 形式化 + 线上监控 + 压测"，多维验证。状态机的 bug 常在并发和故障场景，重点测这些。完全覆盖所有组合不可能（组合爆炸），用 property-based 和形式化补全覆盖。

**Q：怎么让团队在设计多模态 Agent 时不各自实现状态机（有人单状态机、有人分层、有人事件驱动不一致），而是统一的状态机架构？**

沉淀状态机架构规范和设计模式。一是架构规范：统一的"中央调度器 + 模态子状态机 + 事件队列"分层架构，各多模态 Agent 遵循。二是状态定义规范：统一的 GlobalState 和 ModalState 枚举（IDLE/LISTENING/PROCESSING 等标准状态），跨 Agent 一致。三是事件规范：统一的事件格式（priority/timestamp/source/data）、优先级体系（P0-P3 标准），跨 Agent 可比。四是转换规范：统一的 VALID_TRANSITIONS 矩阵（哪些转换合法），避免非法状态。五是设计模式库：沉淀常见模式——Barge-in 处理、并发事件仲裁、故障降级、崩溃恢复，新人按模式设计。六是测试规范：统一的测试方法（property-based、并发测试、故障注入、形式化验证），确保状态机正确。七是监控规范：统一的监控指标（状态分布、转换频率、异常告警），跨 Agent 可比。八是踩坑库：常见错误（静态优先级不合理、中止清理不全、恢复不一致、单线程 CPU 密集卡死）及案例。让多模态状态机是"统一架构 + 规范状态/事件 + 设计模式 + 测试/监控体系"的系统工程，不靠各团队重复造轮子。

## 结构化回答



**30 秒电梯演讲：** 就像电视台导播间——画面（视频）、声音（音频）、字幕（文本）、导播指令（工具）各有一个监控屏（独立状态），导播（调度器）根据优先级切换画面（状态转换）

**展开框架：**
1. **每个模态独立状态机** — ASR状态/LLM状态/工具状态
2. **事件队列异步通信** — 模态间通过事件解耦
3. **优先级仲裁** — 语音打断文本、紧急工具结果优先

**收尾：** 语音打断（Barge-in）怎么实现？正在说话时用户开口怎么处理？




## 视频脚本

> 预计时长：5 分钟 | 由浅入深


| 时间 | 画面/字幕 | 口播台词 | 讲解要点 |
|------|----------|----------|----------|
| 0:00 | 标题卡：如果一个Agent要同时处理语音、文本和工具结果… | "就像电视台导播间——画面（视频）、声音（音频）、字幕（文本）、导播指令（工具）各有一个监控…" | 开场钩子 |
| 0:20 | 核心概念图 | "多模态Agent同时处理语音、文本和工具结果时，需要用分层状态机管理——每个模态独立状态追踪，通过事件队列异步汇总，中央…" | 核心定义 |
| 0:50 | 每个模态独立状态机示意图 | "每个模态独立状态机——ASR状态/LLM状态/工具状态" | 要点拆解1 |
| 1:30 | 事件队列异步通信示意图 | "事件队列异步通信——模态间通过事件解耦" | 要点拆解2 |
| 2:20 | 对比/实战案例图 | "对比一下常见误区和工程实践，看真实场景里怎么取舍。" | 实战与对比 |
| 3:10 | 总结卡 | "记住核心要点。下期我们追问：语音打断（Barge-in）怎么实现？正在说话时用户开口怎么？" | 收尾与钩子 |
