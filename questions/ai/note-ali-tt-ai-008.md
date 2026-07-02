---
id: note-ali-tt-ai-008
difficulty: L2
category: ai
subcategory: 网络通信
tags:
- 阿里巴巴
- 淘天
- AI应用开发
- SSE
- WebSocket
- 流式输出
- 面经
feynman:
  essence: SSE是基于HTTP长连接的服务端单向推流技术，WebSocket是基于TCP的全双工双向通信协议。SSE适合服务器主动推流（如LLM流式输出），WebSocket适合双向实时通信（如聊天室）。本质区别：SSE是HTTP协议的延伸（单向），WebSocket是独立的双向协议。
  analogy: "SSE就像广播电台——只能电台→听众单向播放（服务器→客户端），听众不能给电台打电话。WebSocket就像电话通话——双方都能随时说话（双向通信）。想听广播用SSE（简单、够用），想打电话用WebSocket（灵活、复杂）。"
  key_points:
  - SSE基于HTTP，WebSocket基于TCP（需要握手升级协议）
  - SSE是单向（Server→Client），WebSocket是双向（全双工）
  - SSE自带断线重连和事件ID机制，WebSocket需要手动实现
  - SSE适合：LLM流式输出、通知推送、实时数据展示
  - WebSocket适合：聊天室、协同编辑、多人游戏、实时交易
first_principle:
  essence: 通信协议选择 = 通信方向需求 × 实现复杂度 × 兼容性
  derivation: "HTTP是请求-响应模型，服务器不能主动推送。SSE用HTTP长连接 + chunked transfer实现服务端推送（轻量级，兼容性好）。WebSocket通过HTTP Upgrade升级到独立的双向TCP连接（重量级，功能强大）。"
  conclusion: AI应用中LLM流式输出首选SSE（简单、兼容、单向够用），需要双向交互时选WebSocket
follow_up:
- SSE如何实现断线重连？Last-Event-ID机制是什么？
- WebSocket的心跳机制如何设计？
- 在LLM应用中，SSE如何实现打字机效果？
- WebSocket和HTTP/2 Server Push有什么区别？
- 如何处理SSE/WebSocket的代理穿透问题？
memory_points:
- SSE本质：HTTP长连接 + text/event-stream + Server单向推送，自带断线重连(Last-Event-ID)
- WebSocket本质：HTTP Upgrade握手→升级为独立TCP连接→全双工双向通信
- AI场景铁律：LLM流式输出(ChatGPT风格)用SSE，多人实时交互用WebSocket
- SSE更简单(5行代码)、更兼容(纯HTTP)、更省资源(一个TCP连接)；WebSocket更强大(双向)但更复杂
---

# 【阿里淘天AI二面】SSE和WebSocket的区别？

> 来源：阿里巴巴淘天淘工厂 AI应用开发 二面面经（小红书）

## 一、核心区别总览

```
                SSE                      WebSocket
             ┌──────────┐              ┌──────────────┐
  协议基础   │ HTTP长连接│              │ TCP独立连接    │
             ├──────────┤              ├──────────────┤
  通信方向   │ Server→   │              │ 双向(全双工)  │
             │ Client单向│              │ Server⇌Client│
             ├──────────┤              ├──────────────┤
  数据格式   │ 文本(UTF-8)│             │ 文本+二进制   │
             ├──────────┤              ├──────────────┤
  断线重连   │ 自动      │              │ 手动实现      │
             ├──────────┤              ├──────────────┤
  端口/代理  │ HTTP(80/  │              │ WS(80/443)+   │
             │ 443)兼容好│              │ 需要特殊配置   │
             ├──────────┤              ├──────────────┤
  复杂度    │ 低(5行代码)│              │ 中(API较复杂) │
             └──────────┘              └──────────────┘
```

| 对比维度 | SSE | WebSocket |
|---------|-----|-----------|
| **协议层** | HTTP/1.1 (长连接) | 独立的WebSocket协议(TCP之上) |
| **通信方向** | 单向(Server→Client) | 双向(全双工) |
| **握手** | 普通HTTP请求 | HTTP Upgrade → 协议升级 |
| **数据格式** | 仅文本(UTF-8) | 文本 + 二进制 |
| **连接数限制** | 浏览器对同域HTTP连接有限制(6个) | 无特殊限制 |
| **断线重连** | 自动(Last-Event-ID) | 需手动实现 |
| **代理/防火墙** | 兼容性好(纯HTTP) | 可能被代理拦截 |
| **适用场景** | 流式输出、推送、通知 | 聊天室、协同编辑、游戏 |

## 二、SSE（Server-Sent Events）

### 工作原理

```
SSE 通信流程：

  Client                          Server
    │                               │
    │── HTTP GET /events ──────────→│  Accept: text/event-stream
    │                               │
    │←── HTTP 200 ──────────────────│
    │    Content-Type: text/event-stream
    │    Connection: keep-alive
    │    Transfer-Encoding: chunked
    │                               │
    │←── data: {"msg":"hello"} ────│  ← 推送第1条
    │                               │
    │←── data: {"msg":"world"} ────│  ← 推送第2条
    │                               │
    │←── ... (持续推送) ────────────│
    │                               │
    │ ← 连接断开 →                   │
    │                               │
    │── GET /events ───────────────→│  自动重连！
    │   Last-Event-ID: 123          │  带上断线前的ID
    │←── 从ID=123之后继续推送 ───────│  Server从断点续传
```

### 代码实现

```javascript
// === 前端（浏览器原生支持，无需库）===
const eventSource = new EventSource('/api/chat/stream');

eventSource.onmessage = (event) => {
    const data = JSON.parse(event.data);
    console.log('收到:', data);
    // 流式追加到UI（打字机效果）
    appendToUI(data.text);
};

eventSource.onerror = (e) => {
    console.log('连接断开，浏览器会自动重连...');
};

// === 后端（Java Spring Boot示例）===
@GetMapping(value = "/api/chat/stream", produces = MediaType.TEXT_EVENT_STREAM_VALUE)
public SseEmitter streamChat(@RequestParam String prompt) {
    SseEmitter emitter = new SseEmitter(0L); // 无超时

    // 异步调用LLM并流式返回
    CompletableFuture.runAsync(() -> {
        try {
            llmClient.streamCompletion(prompt, (token) -> {
                emitter.send(SseEmitter.event()
                    .data(Map.of("text", token))
                    .id(String.valueOf(System.currentTimeMillis())));
            });
            emitter.complete();
        } catch (Exception e) {
            emitter.completeWithError(e);
        }
    });

    return emitter;
}
```

### AI应用中的典型使用

```javascript
// ChatGPT/Claude等LLM的流式输出就是用SSE
// 前端接收LLM token流：
const eventSource = new EventSource('/api/llm/chat?prompt=你好');

eventSource.onmessage = (e) => {
    const chunk = JSON.parse(e.data);
    // 逐token追加，形成打字机效果
    if (chunk.content) {
        chatDiv.innerHTML += chunk.content;
    }
};
```

## 三、WebSocket

### 工作原理

```
WebSocket 通信流程：

  Client                              Server
    │                                    │
    │── HTTP GET /ws (Upgrade) ────────→│  Upgrade: websocket
    │   Connection: Upgrade              │  Connection: Upgrade
    │   Sec-WebSocket-Key: xxx           │
    │                                    │
    │←── HTTP 101 Switching ────────────│  升级成功！
    │    Sec-WebSocket-Accept: yyy       │  现在是WebSocket连接
    │                                    │
    │════ WebSocket双向通信 ═════════════│
    │←→  双向消息                        │
    │←→  双向消息                        │
    │←→  双向消息                        │
    │                                    │
    │── Ping ────────────────────────→  │  心跳保活
    │←── Pong ────────────────────────  │
```

### 代码实现

```javascript
// === 前端 ===
const ws = new WebSocket('ws://localhost:8080/chat');

ws.onopen = () => {
    console.log('连接建立');
    ws.send(JSON.stringify({type: 'message', content: '你好'}));
};

ws.onmessage = (event) => {
    const data = JSON.parse(event.data);
    console.log('收到:', data);
};

ws.onclose = () => {
    console.log('连接关闭，需要手动重连');
    // 手动重连逻辑
    setTimeout(() => reconnect(), 3000);
};

// 心跳保活
setInterval(() => {
    if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({type: 'ping'}));
    }
}, 30000);
```

## 四、什么场景用什么？

```
选型决策树：

  需要服务器→客户端单向推送？
  ├── 是 → 需要客户端→服务器？
  │        ├── 否 → ✅ SSE（简单、够用）
  │        └── 是 → 需要实时双向？
  │                 ├── 是 → ✅ WebSocket
  │                 └── 否 → ✅ HTTP轮询/SSE + HTTP POST
  └── 否 → 需要双向实时通信？
           ├── 是 → ✅ WebSocket
           └── 否 → ✅ 普通HTTP请求

具体场景：

  ✅ SSE:
  - LLM流式输出（ChatGPT、Claude等）
  - 股票行情推送
  - 通知/告警推送
  - 日志实时展示
  - 进度条更新

  ✅ WebSocket:
  - 多人聊天室
  - 协同编辑（Google Docs）
  - 多人在线游戏
  - 实时交易系统
  - 视频会议信令
```

## 五、面试加分点

1. **提到SSE在AI应用中的核心地位**：所有主流LLM（ChatGPT/Claude/Gemini）的流式输出都用SSE，因为简单、兼容、单向够用
2. **提到HTTP/2的影响**：HTTP/2的多路复用解决了浏览器对同域连接数限制（6个），SSE在HTTP/2下可以开更多并行连接
3. **提到SSE vs WebSocket的性能对比**：SSE连接更轻量（纯HTTP头），WebSocket握手开销更大但连接后效率更高
4. **提到安全性**：SSE天然走HTTPS，WebSocket的wss://也需要TLS，两者安全等级相同
5. **提到边缘场景**：如果需要二进制传输（如音视频流），必须用WebSocket（SSE只支持文本）
