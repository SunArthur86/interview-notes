---
id: note-xhs-net-016
difficulty: L4
category: network
subcategory: 协议
tags:
- WebSocket
- 全双工
- HTTP升级
- 实时通信
- 协议
feynman:
  essence: WebSocket是一种全双工通信协议，通过HTTP握手升级后保持长连接，服务器可以随时主动推送数据。主要用于实时通信（聊天、推送、协同编辑）。
  analogy: "HTTP像写信（你寄一封信等回信），WebSocket像打电话（接通后双方随时说话）。握手过程就是「喂，能听到吗？」「能，我们开始通话吧」（101 Switching Protocols）。"
  key_points:
  - WebSocket=全双工长连接，HTTP握手升级101
  - 解决HTTP轮询的低效问题
  - 数据帧格式：FIN+opcode+mask+payload
  - Java实现：@ServerEndpoint(简单)或Netty(高性能)
  - 工程化：Redis Pub/Sub做集群广播、心跳保活、断线重连
first_principle:
  problem: "HTTP是请求-响应模型，服务器无法主动推送数据。实时应用（聊天/推送/AI流式）需要服务器主动推送，如何解决？"
  axioms:
  - TCP本身就是全双工的，HTTP的限制是协议层面的
  - 长连接复用比反复建连更高效
  - 协议升级（HTTP→WebSocket）可以复用现有基础设施
  - 全双工通信需要独立的数据帧格式和状态管理
  rebuild: "从实时通信需求出发：HTTP轮询(低效)→长轮询(改善)→SSE(服务端单向推送)→WebSocket(全双工)。WebSocket通过HTTP握手建立TCP长连接，定义帧格式实现双向通信，是实时应用的最佳方案"
follow_up:
- WebSocket 和 SSE（Server-Sent Events）的区别？AI流式响应用哪个？
- WebSocket 集群部署时如何实现消息广播？
- WebSocket 如何做鉴权？在握手阶段还是连接后？
- Netty 实现 WebSocket 相比 Spring 有什么优势？
---

# WebSocket 主要是用来做什么的？如何设计实现一个 WebSocket 服务？（小红书Java一面）

## 一、WebSocket 是什么

WebSocket 是一种在单个 TCP 连接上进行 **全双工通信** 的协议，由 HTML5 规范定义。

```
HTTP 模式（半双工）：
  客户端 ──请求──→ 服务器
  客户端 ←─响应──  服务器
  （每次都要新建请求，服务器无法主动推送）

WebSocket 模式（全双工）：
  客户端 ←──────→ 服务器
         随时双向发送！
  （一次握手后保持长连接）
```

## 二、WebSocket vs HTTP 轮询

| 方式 | 实时性 | 服务器开销 | 带宽 | 复杂度 |
|------|--------|-----------|------|--------|
| **短轮询** | 差（定时请求） | 高（大量空请求） | 高 | 低 |
| **长轮询** | 中（等待新数据） | 中（保持请求） | 中 | 低 |
| **SSE** | 好（服务端推送） | 低 | 低 | 中（单向） |
| **WebSocket** | 最好（双向实时） | 低（长连接复用） | 低 | 高（双向） |

## 三、握手过程（HTTP 升级）

```
1. 客户端发起 HTTP 请求（带升级头）
   GET /ws HTTP/1.1
   Host: server.example.com
   Upgrade: websocket          ← 请求升级协议
   Connection: Upgrade
   Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==  ← 随机Base64
   Sec-WebSocket-Version: 13

2. 服务器响应 101 Switching Protocols
   HTTP/1.1 101 Switching Protocols
   Upgrade: websocket
   Connection: Upgrade
   Sec-WebSocket-Accept: s3pPLMBiTxaQ9kYGzzhZRbK+xOo=  ← 用Key计算

   计算方式：SHA1(Key + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11") → Base64

3. 握手成功后，TCP 连接升级为 WebSocket 连接
   双方可随时发送数据帧（WebSocket Frame）
```

## 四、WebSocket 数据帧格式

```
 0                   1                   2                   3
 0 1 2 3 4 5 6 7 8 9 0 1 2 3 4 5 6 7 8 9 0 1 2 3 4 5 6 7 8 9 0 1
+-+-+-+-+-------+-+-------------+-------------------------------+
|F|R|R|R| opcode|M| Payload len |    Extended payload length    |
|I|S|S|S|  (4)  |A|     (7)     |             (16/64)           |
|N|V|V|V|       |S|             |   (if payload len==126/127)   |
| |1|2|3|       |K|             |                               |
+-+-+-+-+-------+-+-------------+ - - - - - - - - - - - - - - - +
|     Extended payload length continued, if payload len == 127  |
+ - - - - - - - - - - - - - - - +-------------------------------+
|                               |Masking-key, if MASK set to 1  |
+-------------------------------+-------------------------------+
| Masking-key (continued)       |          Payload Data         |
+-------------------------------- - - - - - - - - - - - - - - - +
:                     Payload Data continued ...                :
```

**Opcode 类型**：
- 0x1: 文本帧 (UTF-8)
- 0x2: 二进制帧
- 0x8: 连接关闭
- 0x9: Ping
- 0xA: Pong

## 五、Java 实现 WebSocket 服务

### 方案1：Spring Boot + @ServerEndpoint（简单）

```java
@Component
@ServerEndpoint("/ws/chat/{roomId}")
public class ChatWebSocket {
    
    private static final Map<String, Session> sessions = new ConcurrentHashMap<>();
    
    @OnOpen
    public void onOpen(Session session, @PathParam("roomId") String roomId) {
        sessions.put(session.getId(), session);
        System.out.println("Connected: " + roomId);
    }
    
    @OnMessage
    public void onMessage(String message, Session session) {
        // 广播给所有连接
        for (Session s : sessions.values()) {
            s.getAsyncRemote().sendText(message);
        }
    }
    
    @OnClose
    public void onClose(Session session) {
        sessions.remove(session.getId());
    }
    
    @OnError
    public void onError(Session session, Throwable error) {
        error.printStackTrace();
    }
}
```

### 方案2：Netty + WebSocket（高性能）

```java
// Pipeline 配置
pipeline.addLast(new HttpServerCodec());
pipeline.addLast(new HttpObjectAggregator(64 * 1024));
pipeline.addLast(new WebSocketServerCompressionHandler());
pipeline.addLast(new WebSocketServerProtocolHandler("/ws"));
pipeline.addLast(new CustomWebSocketFrameHandler());

// 自定义Handler
class CustomWebSocketFrameHandler extends SimpleChannelInboundHandler<WebSocketFrame> {
    @Override
    protected void channelRead0(ChannelHandlerContext ctx, WebSocketFrame frame) {
        if (frame instanceof TextWebSocketFrame) {
            String text = ((TextWebSocketFrame) frame).text();
            // 处理文本消息，广播给所有Channel
            channels.writeAndFlush(new TextWebSocketFrame("Echo: " + text));
        }
    }
}
```

## 六、面试加分：WebSocket 工程化

### 1. 集群方案（多服务器间消息同步）

```
问题：WebSocket 连接在Server A，但消息从Server B发出
解决：Redis Pub/Sub 或 MQ 广播

  Server A ←──→ Redis Pub/Sub ←──→ Server B
     ↑                                   ↑
  Client1                              Client2
```

### 2. 心跳保活

```
客户端每30秒发 Ping → 服务器回 Pong
超过60秒未收到 → 判定断线 → 关闭连接

if (lastPongTime < now - 60000) {
    session.close(CloseReason.GOING_AWAY);
}
```

### 3. 断线重连

```javascript
// 客户端
const ws = new WebSocket('ws://server/ws');
ws.onclose = () => {
    setTimeout(() => reconnect(), 3000); // 3秒后重连
};
```

### 4. 安全性

```
- wss:// (WebSocket over TLS) 加密传输
- Origin 校验防 CSRF
- Token 认证（在握手URL或Header中携带JWT）
- 限流防止恶意连接
```
## 苏格拉底式面试追问

> 这组追问模拟面试官层层逼问，每一问先回答"为什么"，再回答"怎么做"，最后回答"如何证明"。

### 第一层：目标与动机

**Q：WebSocket 你说是"在 HTTP 握手基础上升级的双向通信"，但 HTTP/2 已经支持双向流，为什么还要 WebSocket？**

WebSocket 和 HTTP/2 的双向通信定位不同。一、设计目标——WebSocket 是"长连接的双向通信"（握手后保持连接，服务端可主动推），面向"实时应用"（如聊天、推送、协同编辑）；HTTP/2 的双向流是"多路复用"（一个 TCP 上多个请求并发），面向"提升 HTTP 性能"（减少连接数），服务端推（Server Push）是"主动推送资源"（如 CSS/JS）但语义仍是"请求-响应"。二、协议开销——WebSocket 握手后是"轻量帧"（2-10 字节头），适合高频小消息；HTTP/2 帧头更重（含 stream id 等）。三、部署——WebSocket 走 HTTP 端口（80/443），兼容现有基础设施；HTTP/2 需要 TLS（浏览器只支持 h2 over TLS）和服务器支持。所以"实时双向高频小消息"用 WebSocket、"提升 HTTP 吞吐"用 HTTP/2，场景不冲突。如果已有 HTTP/2 基础设施，用 HTTP/2 的 Server Push 或 SSE（Server-Sent Events）也能做推送，但 WebSocket 的"双向高频"仍是首选。

### 第二层：证据与定位

**Q：WebSocket 握手你说是"HTTP Upgrade"，具体哪些 header 标识？握手成功后连接性质变了吗？**

握手请求 header：`Upgrade: websocket`（要升级到 websocket）、`Connection: Upgrade`（这是升级请求）、`Sec-WebSocket-Key: <base64 随机>`（客户端生成的 key）、`Sec-WebSocket-Version: 13`（协议版本）。服务端响应：`HTTP/1.1 101 Switching Protocols`（同意升级）、`Upgrade: websocket`、`Connection: Upgrade`、`Sec-WebSocket-Accept: <计算值>`（用客户端的 key + 固定 GUID 做 SHA1 + base64）。握手成功后，TCP 连接不变（同一条 TCP），但"协议层"从 HTTP 切换到 WebSocket——后续不再是 HTTP 请求-响应，而是 WebSocket 帧（opcode 区分文本/二进制/关闭/ping/pong）。所以"连接性质变了"——从 HTTP（半双工、请求-响应）变成 WebSocket（全双工、自由帧）。这是 HTTP 的"Upgrade 机制"，也可升级到 HTTP/2（h2c）。

### 第三层：根因深挖

**Q：WebSocket 的帧（Frame）你说是"轻量"，帧结构是什么？opcode 区分什么？**

WebSocket 帧结构（RFC 6455）：FIN（1 bit，是否最后一帧）、RSV1-3（3 bit，保留，用于扩展如压缩）、opcode（4 bit，帧类型）、MASK（1 bit，客户端帧必须掩码）、Payload Len（7/16/64 bit，载荷长度）、Mask Key（32 bit，掩码密钥）、Payload（实际数据）。opcode 区分：0x1 文本帧（UTF-8）、0x2 二进制帧、0x8 关闭帧、0x9 ping 帧、0xA pong 帧、0x0 续帧（分片消息的后续）。帧头最少 2 字节（无掩码、短载荷），客户端帧因掩码至少 6 字节。相比 HTTP 请求（几十到几百字节头），WebSocket 帧极轻，适合高频小消息。掩码（客户端→服务端必须掩码）是安全设计——防止中间代理被恶意 WebSocket 数据欺骗（缓存投毒）。分片（FIN=0 + opcode=0）允许大消息分多帧发送，服务端按序组装。

**Q：那为什么不所有 WebSocket 帧都让服务端掩码？只客户端掩码是为了什么？**

只客户端→服务端掩码，服务端→客户端不掩码，是为了"性能"。掩码是"防中间代理被欺骗"——历史上有些代理（如透明代理、缓存）会被恶意的 WebSocket 数据（伪装成 HTTP 响应）欺骗，导致缓存投毒。客户端数据经过代理，要掩码防欺骗；服务端数据也要经过代理，但历史实践中"服务端不掩码"已成事实（且服务端可信度高），所以 RFC 规定只客户端掩码。性能上，掩码/解掩码是 XOR 操作（每 4 字节一次），服务端要解掩码客户端数据（必须做），但发往客户端的数据不掩码（省服务端 CPU）。所以"不对称掩码"是"安全 + 性能"的平衡——客户端数据要掩（防代理投毒）、服务端数据不掩（省 CPU，且服务端可信）。

### 第四层：方案权衡

**Q：实现 WebSocket 服务你选 Netty（加 WebSocketServerHandshaker），还是用 Spring WebSocket（STOMP）？怎么选？**

选型看"复杂度和控制需求"。Netty 的 WebSocketServerHandshaker：底层控制强（自己处理握手、帧、心跳）、性能高（直接 NIO）、但要写更多代码（握手逻辑、帧处理、Ping/Pong、断线重连）。适合"定制协议、超高性能、特殊需求"（如游戏、IM、海量连接）。Spring WebSocket（基于 Spring 的 WebSocketHandler）：开发快（注解配置、自动握手）、生态集成（与 Spring Security、Spring MVC 集成）、STOMP 子协议支持（消息路由、订阅-发布），但性能稍低（Spring 抽象层）、定制性弱。适合"Web 应用、企业应用、快速开发"（如通知、协同编辑）。我的实践：高并发 IM/推送用 Netty（性能极致）、企业应用的通知/协同用 Spring WebSocket（开发快）。如果用 STOMP（发布订阅模型），Spring WebSocket 是首选；如果是简单的"echo 服务"或定制协议，Netty 更灵活。

**Q：为什么不用 Socket.io（Node.js 生态）实现 WebSocket 服务，非要用 Java 的 Netty？**

Socket.io 是"WebSocket 库 + 协议"——它不只是 WebSocket，还有"降级"（不支持 WebSocket 的浏览器用 long polling）、"自动重连"、"房间/命名空间"等高级特性。但 Socket.io 主要 Node.js 生态（Java 有 netty-socketio 但维护一般），且"Socket.io 协议"不是标准 WebSocket（客户端要用 socket.io 客户端，不能用标准 WebSocket API）。所以选 Socket.io 的场景：一、Node.js 技术栈——前后端都用 JS，Socket.io 自然；二、需要降级和自动重连——老浏览器支持差。选 Java Netty 的场景：一、Java 技术栈——与现有 Java 服务集成；二、标准 WebSocket——客户端用浏览器原生 WebSocket API 或任意 WebSocket 库；三、高性能——Java 在高并发上比 Node.js 有优势（线程模型）。所以选型看技术栈和需求，不是"哪个更好"。

### 第五层：验证与沉淀

**Q：你怎么验证 WebSocket 服务在生产中稳定（连接稳定、消息可靠、心跳生效）？**

三类验证：一、连接稳定性——开大量连接（如 10 万），持续 24 小时，连接数应稳定（无故断开少）、重连机制有效（断网后恢复）；二、消息可靠性——客户端发消息服务端收、服务端推消息客户端收，消息不丢不重（如用消息 ID 去重）；三、心跳生效——配置 IdleStateHandler（如 60 秒读空闲），客户端定期发 Ping，服务端回 Pong，长时间无心跳的连接应被关闭（防僵尸连接）。验证手段：用 WebSocket 客户端库（如 Java 的 okhttp WebSocket 或浏览器）压测、Chaos 注入网络抖动。线上监控：连接数（应稳定，突降说明网络问题或服务异常）、消息吞吐、心跳超时关闭数（异常多说明客户端不健康）。Netty 的 IdleStateHandler 配置在 Pipeline 里，监控其触发的 IdleStateEvent。

**Q：这道题做完，你沉淀出了什么可复用的 WebSocket 设计经验？**

五条经验：一、握手用 WebSocketServerHandshaker（Netty）或 Spring 注解——不要自己解析 Upgrade header；二、心跳必备——IdleStateHandler 检测空闲 + Ping/Pong 维持连接 + 超时关闭僵尸连接；三、帧处理——用 BinaryWebSocketFrame/TextWebSocketFrame，大消息支持分片（处理 ContinuationWebSocketFrame）；四、背压——WebSocket 也可能被慢客户端拖累（写缓冲堆积），用 channel.isWritable() 判断；五、安全——wss（WebSocket over TLS）、Origin 校验（防 CSRF）、鉴权（握手时验证 token）。核心："WebSocket 是实时双向通信的基础，正确实现（握手 + 心跳 + 帧处理 + 背压 + 安全）能支撑高并发实时服务，错误实现会导致连接泄漏或消息丢失。"


## 结构化回答



**30 秒电梯演讲：** HTTP像写信（你寄一封信等回信），WebSocket像打电话（接通后双方随时说话）。握手过程就是「喂，能听到吗？」「能，我们开始通话吧」（101 Switching Protocols）。

**展开框架：**
1. **WebSocket** — WebSocket=全双工长连接，HTTP握手升级101
2. **HTTP** — 解决HTTP轮询的低效问题
3. **数据帧格式** — FIN+opcode+mask+payload

**收尾：** WebSocket 和 SSE（Server-Sent Events）的区别？AI流式响应用哪个？



## 视频脚本

> 预计时长：4 分钟 | 由浅入深

| 时间 | 画面/字幕 | 口播台词 | 讲解要点 |
|------|----------|----------|----------|
| 0:00 | 标题卡 | "协议一句话：WebSocket是一种全双工通信协议，通过HTTP握手升级后保持长连接…。" | 开场钩子 |
| 0:15 | Redis Lua 脚本执行截图 | "WebSocket就是全双工长连接，HTTP握手升级101" | WebSocket=全双 |
| 1:08 | Redis Lua 脚本执行截图分步演示 | "解决HTTP轮询的低效问题" | 解决HTTP轮询的低效问 |
| 2:01 | 关键代码/伪代码片段 | "数据帧格式：FIN+opcode+mask+payload" | 数据帧格式 |
| 2:54 | 对比表格 | "Java实现：@ServerEndpoint(简单)或Netty(高性能)" | Java实现 |
| 3:50 | 总结卡 | "核心抓住这条主线，下期咱们接着聊：WebSocket 和 SSE（Server-Sent Events）的区别？AI流式响应用哪个。" | 收尾 |
