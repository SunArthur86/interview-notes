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