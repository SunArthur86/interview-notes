---
id: note-xhs-sd-007
difficulty: L4
category: system-design
subcategory: 高并发
tags:
- SSE
- 流式响应
- 断线重连
- AI流式
- EventSource
feynman:
  essence: SSE是服务器单向推送的HTTP长连接协议，浏览器原生支持自动重连。断线重连的关键是Last-Event-ID机制——客户端记住最后收到的消息序号，重连时告诉服务端从哪里继续。
  analogy: "SSE像打电话时对方给你念文章（你只能听不能说）。如果电话断了，你重拨时说「我上次听到第3段了，从第4段继续念」（Last-Event-ID）。如果AI还在生成后面的内容，正好接着念。"
  key_points:
  - SSE=HTTP长连接+单向推送，浏览器EventSource自动重连
  - 每个事件带id字段，重连时浏览器自动发Last-Event-ID头
  - 服务端用SseEmitter(Spring)/text/event-stream实现
  - 断线重连核心：Redis缓存事件+seq序号+从断点重放
  - Nginx需proxy_buffering off + 长超时配置
first_principle:
  problem: "AI大模型生成是逐token流式的，网络不稳定可能导致连接中断，如何保证用户看到完整结果？"
  axioms:
  - SSE基于HTTP，不需要特殊协议升级（比WebSocket简单）
  - 浏览器EventSource原生支持自动重连和Last-Event-ID
  - 断线重连需要服务端有事件历史缓存才能从断点恢复
  - 幂等性保证：去重防止重连后重复显示
  rebuild: "从AI流式输出需求出发：LLM SSE流式→服务端SSE代理→每个chunk带seq→Redis缓存事件→客户端记录Last-Event-ID→断线自动重连→服务端从Redis重放历史+继续接收新内容"
follow_up:
- SSE 在 Nginx 反向代理时需要注意什么配置？
- AI流式输出如何在服务端做缓存（断线重连时不重新生成）？
- SSE 和 WebSocket 在AI流式场景下各有什么优劣？
- 如何实现SSE的多设备同步（同一个对话在手机和电脑上看）？
---

# AI应用中 SSE 流式响应如何设计断线重连？（入职Java复盘）

## 一、SSE（Server-Sent Events）基础

```
SSE = 服务器单向推送 + HTTP长连接

客户端                    服务器
  │                         │
  │ ── GET /api/chat ──→    │
  │                         │
  │ ←─ Content-Type:        │
  │     text/event-stream   │
  │                         │
  │ ←─ data: 你好           │  (逐字推送)
  │ ←─ data: ，我           │
  │ ←─ data: 是AI           │
  │ ←─ data: [DONE]         │  (结束标记)
  │                         │
```

**SSE vs WebSocket vs Streaming HTTP**：

| 特性 | SSE | WebSocket | Chunked HTTP |
|------|-----|-----------|-------------|
| 方向 | 服务器→客户端（单向） | 双向 | 服务器→客户端 |
| 协议 | HTTP | WebSocket | HTTP |
| 自动重连 | ✅ 浏览器内置 | ❌ 需手动 | ❌ |
| 适合场景 | AI流式输出 | 聊天/协同 | 大文件下载 |
| 复杂度 | 低 | 高 | 低 |

## 二、SSE 协议格式

```
HTTP/1.1 200 OK
Content-Type: text/event-stream
Cache-Control: no-cache
Connection: keep-alive

id: 1                          ← 事件ID（用于断线重连）
event: message                  ← 事件类型（可选）
data: {"text": "你好", "done": false}

id: 2
data: {"text": "，我是AI", "done": false}

id: 3
data: {"text": "", "done": true}

```

**关键**：每个事件块用 `\n\n` 分隔。`id` 字段记录事件序号，用于断线重连时告知服务器「上次收到到哪里」。

## 三、服务端实现（Spring Boot）

```java
@RestController
@RequestMapping("/api/chat")
public class ChatSSEController {
    
    @Autowired
    private AIChatService aiChatService;
    
    @GetMapping(produces = MediaType.TEXT_EVENT_STREAM_VALUE)
    public SseEmitter chat(@RequestParam String prompt,
                          @RequestHeader(value = "Last-Event-ID", 
                                        required = false) String lastEventId) {
        // 超时设置5分钟（AI生成可能很慢）
        SseEmitter emitter = new SseEmitter(300_000L);
        
        // 从断点恢复
        int startSeq = lastEventId != null ? Integer.parseInt(lastEventId) : 0;
        
        aiChatService.streamChat(prompt, startSeq, new ChatCallback() {
            private int seq = startSeq;
            
            @Override
            public void onChunk(String chunk) throws IOException {
                seq++;
                // 发送带id的SSE事件（客户端断线重连时用）
                emitter.send(SseEmitter.event()
                    .id(String.valueOf(seq))
                    .data(Map.of("text", chunk, "done", false)));
            }
            
            @Override
            public void onComplete() throws IOException {
                seq++;
                emitter.send(SseEmitter.event()
                    .id(String.valueOf(seq))
                    .data(Map.of("text", "", "done", true)));
                emitter.complete();
            }
            
            @Override
            public void onError(Throwable e) {
                emitter.completeWithError(e);
            }
        });
        
        return emitter;
    }
}
```

## 四、断线重连方案（核心考点）

### 浏览器原生 EventSource

```javascript
// 浏览器 EventSource 自动重连！
const eventSource = new EventSource('/api/chat?prompt=你好');

eventSource.onmessage = (event) => {
    const data = JSON.parse(event.data);
    if (data.done) {
        eventSource.close();
    } else {
        appendToUI(data.text);  // 逐字显示
    }
};

// ⚠️ 浏览器自动处理：
// 1. 连接断开后自动重连（默认3秒）
// 2. 重连时自动携带 Last-Event-ID 头
// 3. Last-Event-ID = 最后收到的id字段值
```

### 自定义重连（fetch + ReadableStream）

```javascript
async function streamChat(prompt, lastEventId = 0) {
    try {
        const response = await fetch('/api/chat', {
            headers: { 'Last-Event-ID': lastEventId.toString() }
        });
        
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        
        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            
            const text = decoder.decode(value);
            // 解析SSE格式
            const events = parseSSE(text);
            for (const event of events) {
                lastEventId = event.id;
                appendToUI(event.data);
            }
        }
    } catch (error) {
        // 断线重连（带Last-Event-ID）
        console.log('Connection lost, reconnecting...');
        setTimeout(() => streamChat(prompt, lastEventId), 3000);
    }
}
```

## 五、断线重连的完整架构

```
┌────────────────────────────────────────────────────┐
│                    客户端                            │
│  ┌──────────────────────────────────────────┐      │
│  │  EventSource / Fetch                     │      │
│  │  ┌─────────────────────┐                 │      │
│  │  │ Last-Event-ID 缓存   │ ← 记住最后收到的id │      │
│  │  └─────────────────────┘                 │      │
│  └────────────────┬─────────────────────────┘      │
└───────────────────┼────────────────────────────────┘
                    │
                    ▼ 断线重连（携带 Last-Event-ID: 42）
┌────────────────────────────────────────────────────┐
│                    服务端                            │
│  ┌─────────────┐  ┌──────────────┐                 │
│  │ SSE Endpoint │←→│ 事件存储(Redis)│ ← 缓存AI生成   │
│  │              │  │ seq → content │   的历史片段    │
│  └──────┬──────┘  └──────────────┘                 │
│         │                                           │
│         ▼                                           │
│  ┌─────────────┐  ┌──────────────┐                 │
│  │ AI网关       │→ │ LLM API      │                 │
│  │ (流式代理)   │  │ (SSE Stream) │                 │
│  └─────────────┘  └──────────────┘                 │
└────────────────────────────────────────────────────┘

断线重连流程：
  1. 客户端记录最后收到的 event.id = 42
  2. 断线后发起重连：GET /api/chat?resumeFrom=42
  3. 服务端从Redis读取 seq > 42 的缓存片段，快速重放
  4. 然后继续接收LLM新生成的内容
```

## 六、面试加分点

```
1. 事件缓存：用Redis缓存SSE事件（TTL 5分钟），断线重连时快速重放
2. 幂等设计：每个chunk带唯一seq，客户端去重防止重复显示
3. 超时处理：AI生成超过3分钟 → 转异步任务 + 通知
4. 压缩传输：SSE支持gzip压缩，减少带宽
5. Nginx配置：proxy_buffering off 开启流式透传
6. 多设备同步：同一会话多设备连接，用Redis Pub/Sub广播
```