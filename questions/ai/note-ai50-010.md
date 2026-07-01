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

