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
  derivation: '语音流式输出100ms/帧，LLM推理3s/次，工具调用2s/次。如果同步等待，用户每说一句话要等5s才有反应。异步处理后：语音实时识别→意图就绪立即触发LLM→LLM输出即时流式返回。用户感知延迟从5s降到0.5s'
  conclusion: 多模态状态机 = 模态独立状态 + 事件队列 + 优先级仲裁 + 状态融合
follow_up:
  - 语音打断（Barge-in）怎么实现？正在说话时用户开口怎么处理？
  - 多模态结果冲突时（如语音说"取消"但文本显示"确认"）怎么仲裁？
  - 状态机的持久化怎么做？崩溃后怎么恢复？
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
