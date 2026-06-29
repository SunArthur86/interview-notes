---
id: note-netty-008
difficulty: L4
category: network
subcategory: Netty
tags:
- ChannelHandler
- ChannelPipeline
- 责任链
- 入站
- 出站
feynman:
  essence: ChannelHandler 是"处理一个事件的业务逻辑单元"，ChannelPipeline 是"把多个 Handler 串成处理链的容器"。两者合起来就是 Netty 的责任链模式——数据流过 Pipeline，被一个个 Handler 按顺序处理（入站从头到尾，出站从尾到头）。这正是事件驱动范式转成应用构件块的体现。
  analogy: ChannelPipeline 是"后厨流水线"，ChannelHandler 是流水线上的"工位"。一道菜（数据）从下单到上桌要经过：切菜工位（解码 Handler）→ 腌制工位（解析 Handler）→ 炒菜工位（业务 Handler）→ 装盘工位（编码 Handler）。入站（客人点单进来）顺序走，出站（菜端出去）反向走。
  key_points:
  - ChannelHandler=处理入站/出站数据逻辑的容器(Netty主要组件)
  - ChannelPipeline=ChannelHandler链的容器+事件传播API
  - 入站事件从头→尾传播,出站事件从尾→头传播
  - Netty提供大量预定义Handler(HTTP/粘包/SSL等)开箱即用
first_principle:
  problem: 一个网络请求的处理往往需要多个步骤（解码→解析→鉴权→业务→编码），如何组织这些步骤？
  axioms:
  - 单个Handler只做一件事(SRP原则)
  - 多个步骤需要按顺序协作(责任链模式)
  - 入站(收数据)和出站(发数据)方向相反
  - 步骤应该可插拔、可复用(解耦)
  rebuild: 从"分步处理请求"出发→每个步骤封装为一个ChannelHandler(只做一件事)→用ChannelPipeline把Handler按顺序串成链→定义入站事件(如channelRead)从头向尾传播,出站事件(如writeAndFlush)从尾向头传播→Handler可自由插拔组合(HTTP/SSL/粘包等都有现成实现)。
follow_up:
  - ChannelHandlerContext 在其中起什么作用？
  - 入站和出站 Handler 有什么区别？（ChannelInboundHandler vs ChannelOutboundHandler）
  - 如何在运行时动态添加/移除 Handler？
memory_points:
  - ChannelHandler 定位：接收并响应事件通知，是处理入站/出站数据的应用逻辑容器（开发者主要关注的组件）
  - ChannelHandler 用途：格式转换、异常通知、活动状态通知、注册注销通知、自定义事件通知
  - ChannelPipeline：提供 ChannelHandler 链的容器，定义在该链上传播入站/出站事件流的 API
  - 核心：ChannelPipeline 的关键是这些 ChannelHandler 的编排顺序
---

# ChannelHandler 和 ChannelPipeline 的关系？

## 一、ChannelHandler 是什么？（PPT slide28, 59-60）

> *ChannelHandler 是一个接口族的父接口，它的实现负责**接收并响应事件通知**。*

> *从应用程序开发人员的角度来看，Netty 的**主要组件**是 ChannelHandler，它充当了所有处理入站和出站数据的应用程序逻辑的容器。*

**一句话**：ChannelHandler 是你写业务逻辑的地方，是 Netty 留给开发者的核心扩展点。

### ChannelHandler 的典型用途（PPT slide60）

- 将数据从一种格式转换为另一种格式（编解码）
- 提供异常的通知（`exceptionCaught`）
- 提供 Channel 变为活动/非活动的通知（`channelActive/channelInactive`）
- 提供 Channel 注册到/从 EventLoop 注销时的通知
- 提供用户自定义事件的通知

### 常见实现

| Handler | 类型 | 作用 |
|---------|------|------|
| `ChannelInboundHandlerAdapter` | 入站 | 处理入站数据（如读到的消息） |
| `ChannelOutboundHandlerAdapter` | 出站 | 处理出站数据（如要发出的消息） |
| `ByteToMessageDecoder` | 入站 | 字节流→消息（解决粘包） |
| `MessageToByteEncoder` | 出站 | 消息→字节流 |
| `LengthFieldBasedFrameDecoder` | 入站 | 基于长度域的拆包 |
| `StringDecoder/StringEncoder` | 编解码 | 字符串编解码 |
| `HttpObjectDecoder` | 入站 | HTTP 请求解析 |

---

## 二、ChannelPipeline 是什么？（PPT slide62-65）

> *ChannelPipeline 提供了 ChannelHandler 链的容器，并定义了用于在该链上传播**入站和出站事件流的 API**。*

> *ChannelPipeline 的关键是这些 ChannelHandler 的**编排顺序**。*

**一句话**：ChannelPipeline 是把多个 Handler 串成一条处理链的容器，决定事件如何流经这些 Handler。

---

## 三、责任链模式：事件如何传播

```
                  ChannelPipeline（责任链）
  ┌──────┬──────┬──────┬──────┬──────┬──────┐
  │ Head │  H1  │  H2  │  H3  │  H4  │ Tail │
  └──┬───┴──┬───┴──┬───┴──┬───┴──┬───┴──┬───┘
     │      │      │      │      │      │
     │      │ 入站 Handler  │ 出站 Handler  │
     
  ◄──┼──────┼──────┼──────┼      │      │   入站事件（channelRead）
     │      │      │      │      │      │   从 Head → Tail 方向传播
     │      │      │      │      │      │
     │      │      │      ├──────┼──────┼──► 出站事件（writeAndFlush）
     │      │      │      │      │      │   从 Tail → Head 方向传播
```

### 入站（Inbound）事件
- 如 `channelRead`、`channelActive`
- 从 Pipeline 的 **Head → Tail** 方向传播
- 只有 `ChannelInboundHandler` 会处理

### 出站（Outbound）事件
- 如 `write`、`bind`、`connect`
- 从 Pipeline 的 **Tail → Head** 方向传播
- 只有 `ChannelOutboundHandler` 会处理

---

## 四、一个典型 Pipeline 配置

```java
// 服务端典型 Pipeline（PPT slide36-37 的 Echo 服务延伸）
serverBootstrap.childHandler(new ChannelInitializer<SocketChannel>() {
    @Override
    protected void initChannel(SocketChannel ch) {
        ChannelPipeline p = ch.pipeline();
        // 入站：解决粘包（基于分隔符/长度）
        p.addLast("framer", new DelimiterBasedFrameDecoder(8192, delimiter));
        // 编解码
        p.addLast("decoder", new StringDecoder(CharsetUtil.UTF_8));
        p.addLast("encoder", new StringEncoder(CharsetUtil.UTF_8));
        // 业务逻辑（自定义 Handler）
        p.addLast("business", new MyServerHandler());
    }
});
```

**数据流向**：
```
入站：客户端数据 → framer(拆包) → decoder(解码成String) → business(处理业务)
出站：business(返回结果) → encoder(编码成字节) → 发给客户端
```

---

## 五、预定义 Handler 开箱即用（PPT slide29）

> *Netty 提供很多预定义的开箱即用的 ChannelHandler，比如 HTTP、粘包等。*

这意味着你不用从零写协议解析，Netty 自带大量 Handler：
- HTTP/HTTPS：`HttpServerCodec`、`HttpObjectAggregator`
- WebSocket：`WebSocketServerProtocolHandler`
- 粘包/拆包：`LengthFieldBasedFrameDecoder`、`LineBasedFrameDecoder`
- SSL/TLS：`SslHandler`
- 空闲检测：`IdleStateHandler`
- 日志：`LoggingHandler`

---

## 六、ChannelHandler 与 ChannelPipeline 的关系总结

```
ChannelPipeline（容器，编排顺序）
    │
    │ 包含（一对多）
    ▼
[ChannelHandler1] ↔ [ChannelHandler2] ↔ ... ↔ [ChannelHandlerN]
    │                    │                          │
    │  每个关联            │                          │
    ▼                    ▼                          ▼
ChannelHandlerContext  ChannelHandlerContext  ChannelHandlerContext
(Handler 与 Pipeline 的关联，详见下一题)
```

**关系要点**：
1. **一对多**：一个 Pipeline 包含多个 Handler
2. **有序**：addLast/addFirst/addBefore 决定 Handler 顺序，顺序决定处理顺序
3. **双向**：入站和出站各自有方向，同一 Pipeline 同时承载两个方向
4. **可动态调整**：运行时可 add/remove Handler

> **面试记忆口诀**：**"Handler 是工位，Pipeline 是流水线"**。入站从头到尾走，出站从尾到头走，Netty 自带的 Handler（HTTP/粘包/SSL）让你开箱即用，不用自己造轮子。
