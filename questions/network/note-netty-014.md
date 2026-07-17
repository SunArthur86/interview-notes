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

## 苏格拉底式面试追问

> 这组追问模拟面试官层层逼问，每一问先回答"为什么"，再回答"怎么做"，最后回答"如何证明"。

### 第一层：目标与动机

**Q：Netty 的编解码器你说是"Handler 的特化"，为什么要分编解码器而不是用普通 Handler 手动处理？**

编解码器解决"半包粘包 + 类型转换"两个高频痛点。普通 Handler 处理原始 ByteBuf 要自己：一、处理半包——TCP 是流，一次 read 可能是半条消息或两条半消息拼接，要自己维护"已读缓冲"，拼接完整消息才处理；二、粘包——多条消息在一次 read 里，要自己分割；三、字节到对象——手动从 ByteBuf 读字段构造对象（如 readInt、readBytes），易错。编解码器（如 LengthFieldBasedFrameDecoder + ProtobufDecoder）封装这些——Decoder 自动处理半包粘包（按长度字段分帧）+ 自动反序列化（Protobuf 解码），业务 Handler 直接拿到完整对象。所以编解码器是"为协议处理优化的 Handler 基类"，把高频逻辑（分帧、序列化）封装，让业务聚焦"对象处理"。Netty 自带几十种编解码器（HTTP、WebSocket、Protobuf、Redis 协议等），覆盖主流协议。

### 第二层：证据与定位

**Q：半包粘包你说是 TCP 流的特性，具体表现是什么？怎么用 Netty 的 FrameDecoder 解决？**

表现：一、半包——一条业务消息（如 1000 字节）被 TCP 拆成两次 read（先 500 字节、再 500 字节），Handler 第一次 channelRead 拿到的是半条消息；二、粘包——两条消息（各 500 字节）被 TCP 合并成一次 read（1000 字节），Handler 一次 channelRead 拿到两条消息拼接。FrameDecoder 的解决：一、LengthFieldBasedFrameDecoder——协议里有"长度字段"（如前 4 字节是消息长度），Decoder 读长度字段，按长度从已读缓冲里切出完整消息（不够则继续读，多了则剩余留给下次）；二、LineBasedFrameDecoder——按换行符分帧（文本协议）；三、DelimiterBasedFrameDecoder——按自定义分隔符分帧。Decoder 内部维护"累积缓冲"（ByteBuf），每次 read 追加，按规则切出完整消息传给下一个 Handler，不完整的留着等下次。所以 FrameDecoder 是"分帧层"，处理 TCP 流到消息的边界。

### 第三层：根因深挖

**Q：LengthFieldBasedFrameDecoder 你说按"长度字段"分帧，但长度字段的位置、长度、字节序怎么配？配错会怎样？**

LengthFieldBasedFrameDecoder 的核心参数：maxFrameLength（最大帧长，防 OOM）、lengthFieldOffset（长度字段的偏移，如协议头有 magic 则 offset=4）、lengthFieldLength（长度字段本身的字节数，1/2/4/8）、lengthAdjustment（长度字段值到实际消息体的调整，如长度字段包含自己则 adjust=-4）、initialBytesToStrip（分帧后丢弃的字节数，如丢掉长度字段则 strip=4）。配错的后果：一、长度字段读错——读到错误长度，切错帧，业务解析失败；二、字节序——Netty 默认大端（网络字节序），如果协议是小端要配 lengthFieldOrder（但 Netty 不直接支持，要自定义）；三、OOM——maxFrameLength 过大，恶意发送超大长度字段，Decoder 累积大缓冲 OOM。所以 LengthFieldBasedFrameDecoder 的配置要严格匹配协议规范，配错会解析错误或被攻击。

**Q：那为什么不直接用 Protobuf 的 Decoder（自动处理长度），而要先 LengthFieldBasedFrameDecoder 再 ProtobufDecoder？**

因为 Protobuf 的二进制格式内部没有"长度字段"——Protobuf 编码后是"紧凑的字段序列"，不知道整体消息边界。所以 Protobuf 协议通常约定"4 字节长度 + Protobuf 数据"（长度前缀），解码时分两步：一、LengthFieldBasedFrameDecoder 按 4 字节长度切出完整消息（ByteBuf）；二、ProtobufDecoder 把 ByteBuf 反序列化成 Protobuf 对象。两步分离让"分帧"和"反序列化"解耦——LengthFieldBasedFrameDecoder 通用（任何带长度前缀的协议都能用）、ProtobufDecoder 专用（只处理 Protobuf 格式）。组合起来灵活（如换 JSON 序列化，只换第二步 Decoder）。所以"分帧 + 反序列化"分层是 Netty 编解码器的标准设计。

### 第四层：方案权衡

**Q：编码器（Encoder）和解码器（Decoder）你说方向相反，为什么不合成一个 Codec？**

合成 Codec 的场景存在（如 ChannelDuplexHandler 兼顾入站解码和出站编码），但分开更常见。分开的理由：一、职责清晰——Decoder 是 Inbound（处理读到的字节）、Encoder 是 Outbound（处理要写的对象），方向不同、Pipeline 位置不同；二、可复用——Decoder 可在"只读"场景用（如客户端只收不发）、Encoder 在"只写"场景用（如服务端只发不收），合在一起则冗余；三、Netty 提供 MessageToByteEncoder（出站对象→字节）、ByteToMessageDecoder（入站字节→对象），子类只需实现 encode/decode 方法，比 Duplex 简单。所以分开是"单一职责 + 灵活组合"的体现。但确有"既编又解"的场景（如字符串编解码 StringEncoder/StringDecoder 在同一协议用），可用 Codec（Netty 的 StringUtil 提供），按需选。

**Q：为什么不直接用序列化框架（如 Jackson、Gson）替代 Netty 的编解码器？**

序列化框架（Jackson/Gson）只做"对象↔JSON 字符串"，不处理"半包粘包"和"字节↔对象"的完整链路。Netty 的编解码器是"分帧 + 序列化"一体的——Decoder 先按长度分帧（得到完整消息的字节），再调 Jackson 反序列化（字节→对象）。如果只用 Jackson，要自己先处理半包粘包（拿完整字节），再交给 Jackson，等于手动实现了 FrameDecoder 部分。所以 Netty 编解码器和序列化框架是"互补"——Netty 管"分帧和 Pipeline 集成"、序列化框架管"对象↔字节"。实际用法：自定义 FrameDecoder（分帧）+ Jackson/Gson（反序列化），或直接用 Netty 的 JsonObjectDecoder（自带 JSON 分帧）+ Jackson。所以两者不是替代，是协作。

### 第五层：验证与沉淀

**Q：你怎么验证编解码器配置正确（分帧准确、序列化无丢失）？**

三类验证：一、分帧——构造"半包"（模拟 TCP 拆包，分两次发一条消息）和"粘包"（一次发两条消息）的测试用例，Decoder 应正确切分（不丢消息、不错位）；二、序列化——对象编码后解码，对比解码结果与原对象（深比较），应完全一致（特别是大对象、嵌套对象、特殊字符）；三、压力测试——百万消息压测，解码无误（如计数错误说明某消息被丢或重复）。验证 OOM 防护：发送超长消息（如长度字段声明 1GB），Decoder 应抛 TooLongFrameException（不 OOM）。线上监控：解码失败次数（持续增长说明协议不兼容或恶意数据）、平均消息大小（异常大可能是攻击或 bug）、解码耗时（长说明消息过大或反序列化慢）。

**Q：这道题做完，你沉淀出了什么可复用的编解码器设计经验？**

五条经验：一、先分帧再反序列化——LengthFieldBasedFrameDecoder（或 LineBased/Delimiter）切出完整消息，再交给 ProtobufDecoder/Jackson 反序列化；二、maxFrameLength 必须设——防恶意大消息 OOM；三、Decoder 内累积缓冲要释放——继承 ByteToMessageDecoder，框架自动管理；四、Encoder 简单——MessageToByteEncoder 实现 encode，对象写 ByteBuf 即可；五、对称设计——Encoder 写什么格式、Decoder 就按什么格式读（如都用大端、都用长度前缀）。核心："编解码器是 Netty 处理协议的核心，正确配置分帧参数 + 选对序列化框架，能让业务 Handler 拿到干净的对象，聚焦业务逻辑而非协议细节。"


## 结构化回答

**30 秒电梯演讲：** 编解码器（Codec）是特殊的 ChannelHandler——解码器（Decoder）把入站的原始字节流翻译成业务消息（解决粘包/半包、协议解析），编码器（Encoder）把业务消息翻译成出站的字节流。Netty 把编解码逻辑从业务 Handler 中剥离出来，让业务只关心 Java 对象。

**展开框架：**
1. **核心** — decode（解码，入站字节→消息）+ encode（编码，出站消息→字节）
2. **关键基类** — ByteToMessageCodec（字节↔消息）、MessageToMessageCodec（消息↔消息）
3. **解码基于分隔符的协议** — 解码基于分隔符的协议和基于长度的协议（拆包）

**收尾：** 这块我踩过坑——要不要深入聊：TCP 粘包/半包是怎么产生的？Netty 如何解决？

## 视频脚本

> 预计时长：4 分钟 | 由浅入深

| 时间 | 画面/字幕 | 口播台词 | 讲解要点 |
|------|----------|----------|----------|
| 0:00 | 标题卡 | "Netty一句话：编解码器（Codec）是特殊的 ChannelHandler——解码器（Decoder）把入站的原始字节流翻译成业务消息（解决粘包/半包、协议解析）…。" | 开场钩子 |
| 0:15 | dp 数组填表过程动画 | "核心：decode（解码，入站字节到消息）+ encode（编码，出站消息到字节）" | 核心 |
| 1:08 | dp 数组填表过程动画分步演示 | "关键基类：ByteToMessageCodec（字节↔消息）、MessageToMessageCodec（消息↔消息）" | 关键基类 |
| 2:01 | 关键代码/伪代码片段 | "解码基于分隔符的协议和基于长度的协议（拆包）" | 解码基于分隔符的协议 |
| 2:54 | 对比表格 | "预置能力：SSL（SslHandler）/ HTTP（FullHttpRequest/Response）/ WebS…" | 预置能力 |
| 3:50 | 总结卡 | "核心抓住这条主线，下期咱们接着聊：TCP 粘包/半包是怎么产生的？Netty 如何解决。" | 收尾 |
