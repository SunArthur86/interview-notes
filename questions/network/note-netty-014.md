---
id: note-netty-014
difficulty: L4
category: network
subcategory: Netty
tags:
- 编解码器
- Codec
- 解码
- 编码
- 粘包
- HTTP
- WebSocket
feynman:
  essence: 编解码器（Codec）是特殊的 ChannelHandler——解码器（Decoder）把入站的原始字节流翻译成业务消息（解决粘包/半包、协议解析），编码器（Encoder）把业务消息翻译成出站的字节流。Netty 把编解码逻辑从业务 Handler 中剥离出来，让业务只关心 Java 对象。
  analogy: 编解码器像"翻译官"。客户端和服务端都说着不同的"方言"——网络上只能传字节，但你的业务逻辑只懂 Java 对象。Decoder 把收到的字节"翻译"成对象给业务用；Encoder 把业务要发的对象"翻译"成字节发出去。Netty 还预装了各协议的翻译官（HTTP/SSL/WebSocket）。
  key_points:
  - 编解码器=特殊的ChannelHandler,分离编解码逻辑与业务逻辑
  - 核心:Decoder(decode)字节→对象;Encoder(encode)对象→字节
  - 关键基类:ByteToMessageCodec/MessageToMessageCodec
  - Netty预置:分隔符协议/长度协议/SSL/HTTP/WebSocket/UDP/序列化(PB)
first_principle:
  problem: TCP 是字节流协议，没有"消息边界"，直接读会粘包/半包；且业务处理的是对象不是字节。如何屏蔽这些？
  axioms:
  - TCP面向字节流,应用面向消息,需要"拆包"确定边界
  - 业务逻辑应只处理对象,字节↔对象的转换应被封装
  - 入站需要解码(字节→对象),出站需要编码(对象→字节)
  rebuild: 从"屏蔽字节流复杂性"出发→把字节→对象的转换封装为Decoder→把对象→字节的转换封装为Encoder→两者都是特殊的ChannelHandler,挂在Pipeline上自动处理→业务Handler只收到完整对象→再针对粘包提供基于分隔符/长度的拆包Decoder→针对HTTP/SSL/WebSocket等协议预置现成编解码器开箱即用。
follow_up:
  - TCP 粘包/半包是怎么产生的？Netty 如何解决？
  - LengthFieldBasedFrameDecoder 的工作原理？
  - 如何自定义一个协议的编解码器？
memory_points:
  - 核心：decode（解码，入站字节→消息）+ encode（编码，出站消息→字节）
  - 关键基类：ByteToMessageCodec（字节↔消息）、MessageToMessageCodec（消息↔消息）
  - 解码基于分隔符的协议和基于长度的协议（拆包）
  - 预置能力：SSL（SslHandler）/ HTTP（FullHttpRequest/Response）/ WebSocket / UDP / 序列化（PB 等）
---

# Netty 的编解码器（Codec）机制？

## 一、为什么需要编解码器？

TCP 是**面向字节流**的协议，它保证字节按顺序到达，但**不保证消息边界**——这会导致两个经典问题：

```
问题1：粘包（多个消息粘在一起）
  发送：[msg1][msg2][msg3]
  接收：[msg1msg2msg3]  ← 三个消息粘成一坨

问题2：半包（一个消息被拆开）
  发送：[完整的大消息]
  接收：[半个][半个]    ← 一个消息被拆成两次接收
```

而且，业务逻辑处理的是 **Java 对象**，不是原始字节。**编解码器就是解决"字节流 ↔ 业务对象"转换的。**

---

## 二、编解码器的本质：特殊的 ChannelHandler（PPT slide82）

```
┌──────────────────────────────────────────────────────┐
│              ChannelPipeline 中的编解码器              │
│                                                      │
│   入站（收到数据）：                                   │
│   字节流 → [Decoder解码器] → 完整消息对象 → [业务Handler]│
│                                                      │
│   出站（发送数据）：                                   │
│   [业务Handler] → 消息对象 → [Encoder编码器] → 字节流    │
└──────────────────────────────────────────────────────┘
```

- **Decoder（解码器）**：入站方向，`decode()` 把字节/原始消息转成业务消息
- **Encoder（编码器）**：出站方向，`encode()` 把业务消息转成字节/原始消息
- **Codec（编解码器）**：把 Decoder 和 Encoder 合二为一

---

## 三、核心基类（PPT slide83）

### 1. ByteToMessageCodec（字节 ↔ 消息）

```java
// 处理 TCP 字节流 → 业务消息（最常用，解决粘包/半包）
public class MyCodec extends ByteToMessageCodec<MyMessage> {
    @Override
    protected void decode(ChannelHandlerContext ctx, ByteBuf in, List<Object> out) {
        // in 是收到的字节缓冲，可能有粘包/半包
        // 解析出完整消息，加入 out 列表（可能解析出 0 个或多个）
        if (in.readableBytes() < 4) return;  // 不够一个长度头，等下次
        int length = in.readInt();
        if (in.readableBytes() < length) {   // 不够消息体，等下次
            in.resetReaderIndex();
            return;
        }
        byte[] data = new byte[length];
        in.readBytes(data);
        out.add(new MyMessage(data));  // 解析出完整消息
    }
    
    @Override
    protected void encode(ChannelHandlerContext ctx, MyMessage msg, ByteBuf out) {
        // 业务消息 → 字节
        out.writeInt(msg.getData().length);
        out.writeBytes(msg.getData());
    }
}
```

### 2. MessageToMessageCodec（消息 ↔ 消息）

```java
// 一种消息对象 → 另一种消息对象（如协议转换）
public class MyMessageCodec extends MessageToMessageCodec<ByteBuf, String> {
    @Override
    protected void decode(ChannelHandlerContext ctx, ByteBuf msg, List<Object> out) {
        out.add(msg.toString(UTF_8));  // ByteBuf → String
    }
    @Override
    protected void encode(ChannelHandlerContext ctx, String msg, List<Object> out) {
        out.add(Unpooled.copiedBuffer(msg, UTF_8));  // String → ByteBuf
    }
}
```

---

## 四、Netty 预置的拆包解码器（PPT slide86）

> *解码基于分隔符的协议和基于长度的协议。序列化数据：PB 等。*

### 解决粘包/半包的 4 大解码器

| 解码器 | 原理 | 适用协议 |
|--------|------|---------|
| **FixedLengthFrameDecoder** | 固定长度拆包 | 定长协议 |
| **LineBasedFrameDecoder** | 按换行符 `\n` 拆包 | 文本协议 |
| **DelimiterBasedFrameDecoder** | 按自定义分隔符拆包 | 自定义分隔符协议 |
| **LengthFieldBasedFrameDecoder** | 按长度字段拆包（最通用） | 大多数自定义协议 |

```java
// LengthFieldBasedFrameDecoder（最常用）
// 协议格式：[长度字段(4字节)][消息体(N字节)]
pipeline.addLast(new LengthFieldBasedFrameDecoder(
    1024 * 1024,  // 最大长度 1MB
    0,            // 长度字段偏移量
    4,            // 长度字段长度
    0,            // 长度调整值
    4             // 跳过长度字段本身
));
```

---

## 五、协议编解码器（PPT slide84-87）

### 1. SSL/TLS（slide84）
```java
pipeline.addLast(sslContext.newHandler(ch.alloc()));  // SslHandler 加密通信
```

### 2. HTTP（slide85）
PPT slide85 指出 HTTP 编解码涉及：HTTP 请求组成、HTTP 响应组成、FullHttpRequest、FullHttpResponse。

```java
// HTTP 编解码（请求解码 + 响应编码 + 聚合）
pipeline.addLast(new HttpServerCodec());           // = HttpRequestDecoder + HttpResponseEncoder
pipeline.addLast(new HttpObjectAggregator(64*1024)); // 聚合成 FullHttpRequest/FullHttpResponse
pipeline.addLast(new HttpServerHandler());         // 业务处理 FullHttpRequest
```

### 3. WebSocket / UDP（slide87）
```java
// WebSocket：基于 HTTP 升级
pipeline.addLast(new HttpServerCodec());
pipeline.addLast(new HttpObjectAggregator(64*1024));
pipeline.addLast(new WebSocketServerProtocolHandler("/ws"));
pipeline.addLast(new WebSocketFrameHandler());
```

### 4. 序列化（slide86）
PPT 提到"序列化数据：PB 等"——支持 Protobuf 等二进制序列化协议：
```java
pipeline.addLast(new ProtobufVarint32FrameDecoder());
pipeline.addLast(new ProtobufDecoder(MyMessage.getDefaultInstance()));
pipeline.addLast(new ProtobufVarint32LengthFieldPrepender());
pipeline.addLast(new ProtobufEncoder());
```

---

## 六、一个完整自定义协议 Pipeline

```java
// 自定义协议：[魔数(4)][长度(4)][消息类型(1)][消息体(N)]
pipeline.addLast(new LengthFieldBasedFrameDecoder(1024*1024, 4, 4, 1, 0)); // 拆包
pipeline.addLast(new MagicNumberValidator());     // 校验魔数
pipeline.addLast(new MyProtobufDecoder());        // 反序列化
pipeline.addLast(new MyProtobufEncoder());        // 序列化
pipeline.addLast(new MyBusinessHandler());        // 业务逻辑（只收到完整对象）
```

**关键理念**：业务 Handler 只收到**完整、正确、类型化**的消息对象，所有字节流/粘包/协议解析的脏活累活都由编解码器在前面搞定了。

---

## 七、对比总结

| 关注点 | 说明 |
|--------|------|
| **Decoder 入站** | `decode()`：字节/原始消息 → 业务消息 |
| **Encoder 出站** | `encode()`：业务消息 → 字节/原始消息 |
| **Codec** | 编码+解码二合一 |
| **核心基类** | `ByteToMessageCodec` / `MessageToMessageCodec` |
| **拆包解码器** | 解决 TCP 粘包半包（分隔符/长度/行/定长） |
| **协议预置** | SSL / HTTP / WebSocket / UDP / PB |

> **面试记忆口诀**：**"解码入站字节变对象，编码出站对象变字节，拆包解码器治粘包半包，预置编解码器覆盖 HTTP/SSL/WebSocket"**。Codec 是特殊的 ChannelHandler，让业务只关心对象。
