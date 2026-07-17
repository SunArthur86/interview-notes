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

## 苏格拉底式面试追问

> 这组追问模拟面试官层层逼问，每一问先回答"为什么"，再回答"怎么做"，最后回答"如何证明"。

### 第一层：目标与动机

**Q：所有主流 LLM（ChatGPT/Claude/Gemini）的流式输出都用 SSE 而不是 WebSocket，为什么？SSE 哪里比 WebSocket 适合这个场景？**

因为 LLM 流式输出是"服务端单向推流"，SSE 天然契合。SSE 基于标准 HTTP（走 80/443 端口、过 nginx/CDN/负载均衡无需特殊配置、复用 HTTP 鉴权），而 WebSocket 需要协议升级（Upgrade: websocket）、独立端口配置、且中间件（nginx/CDN）要单独支持。SSE 自带断线重连（浏览器 EventSource 自动重连）和事件 ID（Last-Event-ID 续传），WebSocket 要手写这些。LLM 输出是单向的（模型 → 用户），不需要双向，用 WebSocket 是过度设计。SSE 的简单性是它在 AI 场景胜出的关键。

### 第二层：证据与定位

**Q：你的 SSE 流式输出在用户端偶尔卡顿（流到一半停了），怎么定位是网络问题、nginx 配置、还是后端？**

分段排查。一是看后端是否在持续 yield 事件——查后端日志的事件时间戳是否连续；二是看 nginx 是否有 buffering——SSE 要求 `proxy_buffering off` 和 `X-Accel-Buffering: no`，否则 nginx 会攒一批再发，造成卡顿；三是看是否有超时——nginx 默认 `proxy_read_timeout 60s`，如果模型思考超过 60 秒没输出，连接被断。最常见的是 nginx buffering 没关，用 `curl -N`（无缓冲）直连后端验证，如果直连流畅但过 nginx 卡，确认是 nginx 配置。

### 第三层：根因深挖

**Q：SSE 流式在移动端弱网下频繁断连，每次断连丢一段 token，根因是什么？**

根因是 SSE 的断线重连不保证不丢事件。SSE 协议有 `Last-Event-ID` 头支持续传，但需要后端配合——给每个事件分配递增 id，重连时前端带 `Last-Event-ID: <最后收到的 id>`，后端从该 id 之后继续发。如果没实现这个，弱网重连就丢事件。对 LLM 流式更麻烦——token 是增量生成的，重连后模型不会从中间继续生成，要重新跑。治本：对弱网用户做"整体重试"（断连后重新发起完整请求），或用 WebSocket（有状态连接、支持心跳检测连接活性、断连更快感知）。

**Q：那为什么不直接用 WebSocket 替代 SSE，双向通信、有心跳、断连感知更可靠？**

LLM 流式输出是单向场景（服务端推、客户端只接收），WebSocket 的双向能力和心跳是"用不上的复杂度"。WebSocket 要手写重连逻辑、心跳机制、消息边界处理，而 SSE 浏览器原生支持 EventSource（自动重连、自动解析事件）。只有需要客户端实时发指令（如中途取消生成、追加要求）时才值得用 WebSocket。纯输出流用 SSE 的工程成本低 3-5 倍。且 SSE 过 CDN/反向代理零配置，WebSocket 要逐个配 upgrade，运维成本高。

### 第四层：方案权衡

**Q：SSE 你说走 HTTP，那 HTTP/1.1 的浏览器连接数限制（同域 6 个）会不会卡住多会话场景？**

会。HTTP/1.1 下浏览器对同域最多 6 个并发连接，如果用户开多个 tab 每个都有 SSE 流，6 个就占满，第 7 个连接阻塞。解法有三种：一是上 HTTP/2（多路复用，一个 TCP 连接跑多个流，无 6 连接限制），现代浏览器和 nginx 都支持；二是用不同子域名分散连接（如 sse1.example.com、sse2.example.com，绕过同域限制）；三是限制客户端并发流数（同时只允许一个活跃 SSE）。生产环境首选 HTTP/2，一劳永逸。

**Q：为什么不直接用 HTTP chunked transfer（分块传输）做流式，省得搞 SSE 协议？**

HTTP chunked 是传输层机制（把响应体分块发送），没有事件语义。SSE 在 chunked 之上定义了事件格式（`data: ...\n\n`、`event: type`、`id: xxx`、`retry: ms`），让客户端能按事件解析而非按字节流解析。直接用 chunked 要自己定义事件边界和解析逻辑，且没有断线重连和 Last-Event-ID 续传。SSE 是"chunked + 事件语义 + 重连机制"的标准化封装，对 AI 流式场景开箱即用。重复造轮子不如用标准协议。

### 第五层：验证与沉淀

**Q：你怎么验证 SSE 流式输出的体验质量，而不是只看"能跑通"？**

量化两个指标：TTFT（Time To First Token，首 token 延迟）——用户发出请求到收到第一个 token 的时间，应 <500ms 才有"开始响应"的体感；token 间隔（连续 token 之间的时间间隔）——应 <100ms 才有"流畅打字"的体感，间隔过大用户感觉卡。用前端埋点采集这两个指标，做 A/B 实验（如对比 SSE vs 非流式），看用户满意度和任务完成率。同时监控弱网场景的重连率和事件丢失率。

**Q：SSE 的工程实现怎么沉淀成团队通用能力？**

封装统一的 SSE 工具链：后端 `sse_stream(events)` 生成器（自动加事件 id、heartbeat 保活、错误处理），前端 `useSSE()` hook（自动重连、Last-Event-ID 续传、事件分发）。沉淀"nginx SSE 配置模板（buffering off + timeout 调长）""HTTP/2 部署 checklist""弱网降级策略（重试/WebSocket fallback）"。新 AI 流式场景接入时按模板，不重复踩 buffering 和 timeout 的坑。

## 结构化回答

**30 秒电梯演讲：** SSE是基于HTTP长连接的服务端单向推流技术，WebSocket是基于TCP的全双工双向通信协议。SSE适合服务器主动推流（如LLM流式输出），WebSocket适合双向实时通信（如聊天室）。

**展开框架：**
1. **SSE** — SSE基于HTTP，WebSocket基于TCP（需要握手升级协议）
2. **SSE适合** — LLM流式输出、通知推送、实时数据展示
3. **WebSocket适合** — 聊天室、协同编辑、多人游戏、实时交易

**收尾：** 您想深入聊：SSE如何实现断线重连？Last-Event-ID机制是什么？


## 视频脚本

> 预计时长：3 分钟 | 由浅入深


| 时间 | 画面/字幕 | 口播台词 | 讲解要点 |
|------|----------|----------|----------|
| 0:00 | 标题卡：SSE和WebSocket的区别？ | "SSE就像广播电台——只能电台→听众单向播放（服务器→客户端），听众不能给电台打电话。…" | 开场钩子 |
| 0:20 | 核心概念图 | "SSE是基于HTTP长连接的服务端单向推流技术，WebSocket是基于TCP的全双工双向通信协议。SSE适合服务器主动…" | 核心定义 |
| 0:55 | SSE示意图 | "SSE——SSE基于HTTP，WebSocket基于TCP（需要握手升级协议）" | 要点拆解1 |
| 1:30 | 对比/实战案例图 | "对比一下常见误区和工程实践，看真实场景里怎么取舍。" | 实战与对比 |
