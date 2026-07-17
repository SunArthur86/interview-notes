---
id: note-ai50-010
difficulty: L3
category: ai
subcategory: Agent
tags:
- 某厂
- 面经
- Agent
- 流式输出
- SSE
- 异步
feynman:
  essence: 用SSE(Server-Sent Events)或WebSocket将Agent中间步骤实时推送给前端，让用户看到思考和执行过程
  analogy: 就像看直播做饭——不是等菜全做好才端上来，而是从切菜、炒菜到装盘全程实时展示，用户不用干等
  first_principle: Agent多步任务总延迟 = Σ(每步LLM调用 + 工具执行)，可能长达30-60秒。用户在等待期间没有反馈会认为系统卡死。流式传输通过分段推送解决感知延迟问题
  key_points:
  - SSE是Agent流式传输的主流方案(单向推送, 基于HTTP)
  - WebSocket适合需要双向交互的场景
  - '流式内容: Thought流(逐token) + Action事件 + Observation事件 + Final Answer流'
  - 前端用EventSource(SSE)或WebSocket接收事件流
first_principle:
  essence: 用户感知延迟 < 实际计算延迟时体验急剧下降
  derivation: 'Nielsen可用性准则: 0.1秒以内感知瞬时，1秒以内不打断思路，10秒以上需要明确反馈。Agent多步执行通常10-60秒，必须有流式反馈'
  conclusion: 流式传输不是性能优化而是体验必需品，是Agent产品化的基础能力
follow_up:
- SSE和WebSocket在Agent场景下怎么选？
- 流式传输中前端如何优雅地渲染Markdown？
- 如果某个工具调用特别慢(>30s)，流式体验怎么保证？
memory_points:
- 底层协议：基于SSE（Server-Sent Events）实现前端流式传输
- 事件拆解：将Agent过程拆分为token流、action_start、observation等独立事件
- 后端实现：LangChain调用astream_events(version='v2')，按事件类型分别yield数据
- 前端体验：用EventSource接收，让用户实时看到思考与工具执行过程，消除等待焦虑
---

# Agent多步任务的流式传输怎么实现？

## 流式事件类型

```
时间轴 ──────────────────────────────────────────→

[Thought流]   "让我思考一下..." "我需要先查询..." 
                    ↓ SSE event: thought_chunk
[Action事件]   tool_call: search("Python异步")
                    ↓ SSE event: action_start
[执行中]       (工具执行中, 可推送进度)
                    ↓ SSE event: action_progress
[Observation]  "Python asyncio是..."
                    ↓ SSE event: observation
[Thought流]   "根据搜索结果..." "我可以总结为..."
                    ↓ SSE event: thought_chunk
[Final Answer] "Python异步编程..."
                    ↓ SSE event: answer_chunk
[完成]         
                    ↓ SSE event: done
```

## 后端实现：SSE + LangChain

```python
from fastapi import FastAPI
from fastapi.responses import StreamingResponse
from langchain.agents import AgentExecutor
import json
import asyncio

app = FastAPI()

@app.get("/agent/stream")
async def agent_stream(query: str):
    async def event_generator():
        # 初始化Agent
        agent_executor = create_agent()
        
        async for event in agent_executor.astream_events(
            {"input": query},
            version="v2"
        ):
            event_type = event["event"]
            
            if event_type == "on_chat_model_stream":
                # LLM输出的token流
                chunk = event["data"]["chunk"].content
                if chunk:
                    yield f"data: {json.dumps({'type': 'token', 'content': chunk})}\n\n"
            
            elif event_type == "on_tool_start":
                # 工具开始执行
                yield f"data: {json.dumps({
                    'type': 'action_start',
                    'tool': event['name'],
                    'input': str(event['data'].get('input', ''))
                })}\n\n"
            
            elif event_type == "on_tool_end":
                # 工具执行完成
                yield f"data: {json.dumps({
                    'type': 'observation',
                    'tool': event['name'],
                    'output': str(event['data'].get('output', ''))
                })}\n\n"
        
        yield f"data: {json.dumps({'type': 'done'})}\n\n"
    
    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream"
    )
```

## 前端实现：EventSource

```typescript
// React前端接收SSE流
import { useState, useEffect } from 'react'

function AgentChat() {
  const [thoughts, setThoughts] = useState('')
  const [actions, setActions] = useState([])
  const [answer, setAnswer] = useState('')
  
  const startAgent = (query: string) => {
    // 清空状态
    setThoughts('')
    setActions([])
    setAnswer('')
    
    // 建立SSE连接
    const eventSource = new EventSource(
      `/agent/stream?query=${encodeURIComponent(query)}`
    )
    
    eventSource.onmessage = (event) => {
      const data = JSON.parse(event.data)
      
      switch (data.type) {
        case 'token':
          // LLM思考流 - 追加到Thought区域
          setThoughts(prev => prev + data.content)
          break
        case 'action_start':
          // 工具调用开始
          setActions(prev => [...prev, {
            tool: data.tool,
            input: data.input,
            status: 'running'
          }])
          break
        case 'observation':
          // 工具返回结果
          setActions(prev => prev.map((a, i) => 
            i === prev.length - 1 
              ? {...a, status: 'done', output: data.output}
              : a
          ))
          break
        case 'answer_chunk':
          // 最终答案流
          setAnswer(prev => prev + data.content)
          break
        case 'done':
          eventSource.close()
          break
      }
    }
    
    eventSource.onerror = () => {
      eventSource.close()
    }
  }
  
  return (
    <div>
      <div className="thought-panel">{thoughts}</div>
      <div className="actions-panel">
        {actions.map((a, i) => (
          <div key={i}>
            {a.tool}({a.input}) → {a.status === 'running' ? '⏳' : a.output}
          </div>
        ))}
      </div>
      <div className="answer-panel">{answer}</div>
    </div>
  )
}
```

## SSE vs WebSocket

| 维度 | SSE | WebSocket |
|------|-----|-----------|
| 协议 | HTTP | 独立协议 |
| 方向 | 服务器→客户端(单向) | 双向 |
| 重连 | 浏览器自动重连 | 需手动实现 |
| 适用 | Agent流式输出(推荐) | 需要中途取消/修改 |
| 复杂度 | 低 | 中 |
| 代理兼容 | 好(HTTP) | 差(需Upgrade) |

**结论**: Agent场景用SSE就够了，用户中途想取消可以直接关闭EventSource。

## 工具执行进度推送

```python
async def execute_tool_with_progress(tool_name, tool_input, progress_callback):
    """执行耗时工具并推送进度"""
    await progress_callback({
        "type": "action_progress",
        "tool": tool_name,
        "message": "开始执行..."
    })
    
    # 分阶段执行
    if tool_name == "search":
        await progress_callback({"message": "正在搜索..."})
        results = await async_search(tool_input)
        
        await progress_callback({
            "message": f"找到{len(results)}条结果，正在处理..."
        })
        processed = await process_results(results)
        
        await progress_callback({"message": "处理完成"})
        return processed
    
    return await tool.execute(tool_input)
```

## 异常处理

```python
async def safe_agent_stream(query):
    async def event_generator():
        try:
            async for event in agent.astream_events({"input": query}):
                yield format_sse(event)
        except asyncio.TimeoutError:
            yield f"data: {json.dumps({'type': 'error', 'message': '执行超时'})}\n\n"
        except Exception as e:
            yield f"data: {json.dumps({'type': 'error', 'message': str(e)})}\n\n"
        finally:
            yield f"data: {json.dumps({'type': 'done'})}\n\n"
    
    return StreamingResponse(event_generator(), media_type="text/event-stream")
```

## 记忆要点

- 底层协议：基于SSE（Server-Sent Events）实现前端流式传输
- 事件拆解：将Agent过程拆分为token流、action_start、observation等独立事件
- 后端实现：LangChain调用astream_events(version='v2')，按事件类型分别yield数据
- 前端体验：用EventSource接收，让用户实时看到思考与工具执行过程，消除等待焦虑

## 苏格拉底式面试追问

> 这组追问模拟面试官层层逼问，每一问先回答"为什么"，再回答"怎么做"，最后回答"如何证明"。

### 第一层：目标与动机

**Q：Agent 流式输出为什么要拆成 token 流、action_start、observation 等独立事件，而不是等最终结果一次性返回？**

动机是用户体验和感知延迟。Agent 多步任务可能跑 10-30 秒，一次性返回让用户干等，体感"卡死了"；流式输出让用户实时看到"模型正在思考...→ 调用搜索工具 → 拿到结果 → 正在总结"，把 30 秒的等待拆成可感知的进度。拆成独立事件是因为不同事件的前端渲染不同——token 流增量渲染文字、action_start 渲染工具卡片、observation 渲染结果区，不能混在一起。

### 第二层：证据与定位

**Q：用户反馈"Agent 卡住没反应"，但后端日志显示在正常跑。你怎么定位是哪个环节断了？**

按链路分段排查：一是后端 LangChain 的 `astream_events` 是否在 yield——看后端日志的事件时间戳是否连续推进；二是 SSE 连接是否断开——看 nginx/gateway 的连接日志，是否有 timeout 或 connection reset；三是前端 EventSource 是否在接收——看浏览器 DevTools 的 Network 面板，SSE 请求是否在持续收 data。最常见的是中间网关（如 nginx）默认 60 秒断长连接，要配 `proxy_read_timeout` 和心跳。

### 第三层：根因深挖

**Q：SSE 流式输出在移动端弱网下频繁断连重连，每次重连丢一段事件。根因是什么？**

根因是 SSE 基于 HTTP 长连接，弱网下连接不稳定且没有断点续传。SSE 协议有 `Last-Event-ID` 头支持续传，但需要后端配合——给每个事件分配递增 id，重连时前端带上最后收到的 id，后端从该 id 之后继续发。如果不实现这个，弱网重连就丢事件。治本是实现 `Last-Event-ID` 续传，或改用 WebSocket（有状态连接、支持心跳和重连），或在事件层做幂等（前端用事件 id 去重，后端重发）。

**Q：那为什么不直接用 WebSocket 替代 SSE，双向通信更可靠还支持心跳？**

SSE 对 Agent 流式场景更合适：一是 SSE 是单向（服务端推），Agent 输出正好是单向流，用 WebSocket 是过度设计；二是 SSE 基于 HTTP，走现有基础设施（nginx、CDN、鉴权）无需额外配置，WebSocket 要单独配 upgrade 和 keepalive；三是 SSE 浏览器原生支持 EventSource API，断线自动重连，WebSocket 要手写重连逻辑。只有需要客户端实时发指令（如中途取消任务）时才上 WebSocket，纯输出流用 SSE 足够。

### 第四层：方案权衡

**Q：你用 LangChain 的 `astream_events(version='v2')`，事件类型有哪些？为什么这么拆？**

核心事件包括：`on_chat_model_stream`（LLM token 流，增量渲染文字）、`on_tool_start`（工具开始调用，渲染工具卡片）、`on_tool_end`（工具返回，渲染结果）、`on_chain_end`（整个链路结束，收尾）。这么拆是因为前端要按事件类型做不同 UI——token 流要增量拼接且打字机效果，tool_start 要展示工具名和参数，tool_end 要展示结果且可能折叠。如果只给一个"最终结果"事件，就退化成非流式，失去体验优势。

**Q：为什么不直接用 OpenAI 的 stream=True（纯 token 流），省得拆事件类型？**

OpenAI 的纯 token 流只能渲染文字，渲染不了"工具调用"这个动作。Agent 的核心价值是调用工具，用户要看到"现在在调哪个工具、参数是什么、结果是什么"，这些不是 token 流能表达的——工具调用是结构化事件，不是自然语言 token。纯 token 流适合单轮问答（ChatGPT 风格），Agent 场景必须用结构化事件流才能完整表达执行过程。LangChain 的 `astream_events` 就是为了把 LLM token 流和工具事件流统一抽象。

### 第五层：验证与沉淀

**Q：你怎么证明流式输出比非流式提升了用户体验，而不是只是"看着好看"？**

量化两个指标：一是感知延迟（Time to First Token，TTFT）——流式 <500ms 用户感觉"开始响应了"，非流式要等 10-30 秒用户感觉"卡死"；二是任务放弃率（用户在等待中刷新/关闭的比例）——流式应显著低于非流式。做 A/B 实验：对照组非流式，实验组流式，各 50% 流量跑 1 周。如果实验组放弃率降 40%+ 且 TTFT <1s，证明流式的体验价值。这是产品指标，不是技术指标。

**Q：流式输出的工程框架怎么沉淀成可复用能力？**

封装统一的 `agent_stream(agent, query)` 异步生成器，内部调 LangChain `astream_events`，对外 yield 标准化事件（type: token/tool_start/tool_end/done，payload）。前端封装统一的 `useAgentStream()` hook，自动处理 EventSource 连接、事件分发、断线重连、错误兜底。沉淀"SSE 网关配置模板（nginx timeout/心跳）""弱网续传方案""事件类型设计规范"，新 Agent 接入时按模板，不重复踩坑。

## 结构化回答

**30 秒电梯演讲：** 用SSE(Server-Sent Events)或WebSocket将Agent中间步骤实时推送给前端，让用户看到思考和执行过程。

**展开框架：**
1. **SSE** — SSE是Agent流式传输的主流方案(单向推送, 基于HTTP)
2. **WebSocket** — WebSocket适合需要双向交互的场景
3. **流式内容** — Thought流(逐token) + Action事件 + Observation事件 + Final Answer流

**收尾：** 您想深入聊：SSE和WebSocket在Agent场景下怎么选？


## 视频脚本

> 预计时长：4 分钟 | 由浅入深


| 时间 | 画面/字幕 | 口播台词 | 讲解要点 |
|------|----------|----------|----------|
| 0:00 | 标题卡：Agent多步任务的流式传输怎么实现？ | "就像看直播做饭——不是等菜全做好才端上来，而是从切菜、炒菜到装盘全程实时展示，用户不用干等" | 开场钩子 |
| 0:20 | 核心概念图 | "用SSE(Server-Sent Events)或WebSocket将Agent中间步骤实时推送给前端，让用户看到思考和…" | 核心定义 |
| 0:50 | SSE示意图 | "SSE——SSE是Agent流式传输的主流方案(单向推送, 基于HTTP)" | 要点拆解1 |
| 1:30 | 对比/实战案例图 | "对比一下常见误区和工程实践，看真实场景里怎么取舍。" | 实战与对比 |
| 2:20 | 总结卡 | "记住核心要点。下期我们追问：SSE和WebSocket在Agent场景下怎么选？" | 收尾与钩子 |
