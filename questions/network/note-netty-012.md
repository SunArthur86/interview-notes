---
id: note-netty-012
difficulty: L3
category: network
subcategory: Netty
tags:
- Bootstrap
- ServerBootstrap
- 引导
- Echo服务
- Netty
feynman:
  essence: Bootstrap/ServerBootstrap 是 Netty 的"启动装配器"，它把分散的组件（EventLoopGroup、Channel 类型、Pipeline、Handler）像搭积木一样组装成一个可运行的服务端/客户端。服务端用两个 Group（Boss 接连接、Worker 处理 I/O），客户端用一个 Group，最后 bind()/connect() 启动。
  analogy: Bootstrap 像开店的"装修清单 + 开业流程"。你声明：用什么装修风格（Channel 类型）、招几类员工（EventLoopGroup）、每个工位的岗位职责（Pipeline/Handler），然后 ServerBootstrap.bind() = 正式剪彩开业接客；Bootstrap.connect() = 客户上门。Echo 服务端/客户端是经典的"回声"示例：客户端发什么，服务端就回什么。
  key_points:
  - Bootstrap=把EventLoopGroup+Channel+Pipeline+Handler组装成可运行应用
  - 服务端用ServerBootstrap+2个Group(Boss接连接/Worker处理I/O)
  - 客户端用Bootstrap+1个Group
  - Echo示例:客户端发"Netty rocks!"→服务端原样回送
first_principle:
  problem: Netty 组件众多（Channel/EventLoop/Pipeline/Handler），如何把它们组装成一个可运行的服务？
  axioms:
  - 组件需要按正确关系组合才能运行(声明式装配)
  - 服务端和客户端的组件需求不同(连接方/监听方)
  - 配置应该集中在一处(单一配置入口)
  rebuild: 从"装配组件"出发→设计Bootstrap作为装配器→链式API声明Channel类型/EventLoopGroup/Handler→服务端用ServerBootstrap配2个Group(Acceptor+IO处理)→调用bind()绑定端口监听→客户端用Bootstrap配1个Group→调用connect()连接远端→Echo示例验证:客户端发消息服务端原样回送。
follow_up:
  - 为什么服务端要拆 BossGroup 和 WorkerGroup？
  - childHandler 和 handler 的区别？
  - 如何优雅关闭 EventLoopGroup？
memory_points:
  - 服务端引导5步：创建ServerBootstrap → 分配NioEventLoopGroup → 指定InetSocketAddress → 用ChannelInitializer初始化Channel → bind()
  - 客户端引导5步：创建Bootstrap → 分配NioEventLoopGroup → 创建InetSocketAddress(连接目标) → 安装EchoClientHandler → connect()
  - Echo运行：客户端发"Netty rocks!" → 服务端接收并回送 → 客户端报告返回消息
  - 服务端 Ctrl+C 会触发客户端 exceptionCaught
---

# Bootstrap 和 ServerBootstrap 的引导流程？

## 一、Bootstrap 的定位

Bootstrap/ServerBootstrap 是 Netty 的**引导类**，负责把 Channel、EventLoop、ChannelPipeline、ChannelHandler 等组件组装成一个可运行的网络应用。

| 类 | 用途 | Group 数量 |
|----|------|-----------|
| **ServerBootstrap** | 引导服务端（监听端口） | 2 个（Boss + Worker） |
| **Bootstrap** | 引导客户端（连接服务端） | 1 个 |

---

## 二、服务端引导流程（PPT slide35-37）

### Echo Server 架构

```
┌─────────────────────────────────────────────┐
│                  Echo Server                 │
│  ┌─────────────┐   ┌──────────────────────┐ │
│  │  ServerBoot │   │   EchoServerHandler   │ │
│  │   strap     │   │  (implements 业务逻辑) │ │
│  │  (引导/绑定) │   │  channelRead→回写消息  │ │
│  └─────────────┘   └──────────────────────┘ │
│          │                                   │
│          ▼                                   │
│  ┌────────────────┐                          │
│  │NioEventLoopGroup│ (接受新连接+读写数据)    │
│  └────────────────┘                          │
└─────────────────────────────────────────────┘
```

### 服务端引导 5 步（PPT slide37）

```java
// 1. 创建 ServerBootstrap 实例以引导和绑定服务器
ServerBootstrap b = new ServerBootstrap();

// 2. 创建并分配 NioEventLoopGroup 以处理事件（接受新连接 + 读/写数据）
b.group(bossGroup, workerGroup)
 // 3. 指定 Channel 类型（NIO 服务端 Socket）
 .channel(NioServerSocketChannel.class)
 // 指定服务器绑定的本地地址
 .localAddress(new InetSocketAddress(port))
 // 4. 用 ChannelInitializer 初始化每个新 Channel（安装 Handler）
 .childHandler(new ChannelInitializer<SocketChannel>() {
     @Override
     public void initChannel(SocketChannel ch) {
         ch.pipeline().addLast(new EchoServerHandler());
     }
 });

// 5. 调用 bind() 绑定服务器
ChannelFuture f = b.bind().sync();
```

### 服务端 Handler（接收入站信息，PPT slide36）

```java
@ChannelHandler.Sharable
public class EchoServerHandler extends ChannelInboundHandlerAdapter {
    @Override
    public void channelRead(ChannelHandlerContext ctx, Object msg) {
        // 接收入站信息，原样回写
        ctx.write(msg);
    }
    @Override
    public void channelReadComplete(ChannelHandlerContext ctx) {
        ctx.flush();
    }
    @Override
    public void exceptionCaught(ChannelHandlerContext ctx, Throwable cause) {
        cause.printStackTrace();
        ctx.close();
    }
}
```

---

## 三、客户端引导流程（PPT slide38-40）

### 客户端 Handler（PPT slide39）

客户端需要重写三个方法：
- `channelActive()` —— 到服务器的连接建立后被调用
- `channelRead0()` —— 从服务器接收到消息时被调用
- `exceptionCaught()` —— 处理过程中引发异常时被调用

> PPT 注：*作为一个面向流的协议，TCP 保证了字节数组将按照服务器发送它们的顺序被接收。*

### 客户端引导 5 步（PPT slide40）

```java
// 1. 为初始化客户端，创建 Bootstrap 实例
Bootstrap b = new Bootstrap();

// 2. 为事件处理分配 NioEventLoopGroup（创建新连接 + 处理入站/出站数据）
b.group(group)
 .channel(NioSocketChannel.class)
 // 3. 为服务器连接创建 InetSocketAddress
 .remoteAddress(new InetSocketAddress(host, port))
 // 4. 当连接建立时，EchoClientHandler 会被安装到 ChannelPipeline 中
 .handler(new ChannelInitializer<SocketChannel>() {
     @Override
     public void initChannel(SocketChannel ch) {
         ch.pipeline().addLast(new EchoClientHandler());
     }
 });

// 5. 设置完成后，调用 connect() 连接远程节点
ChannelFuture f = b.connect().sync();
```

### 客户端 Handler

```java
public class EchoClientHandler extends SimpleChannelInboundHandler<ByteBuf> {
    @Override
    public void channelActive(ChannelHandlerContext ctx) {
        // 连接建立后发送消息
        ctx.writeAndFlush(Unpooled.copiedBuffer("Netty rocks!", CharsetUtil.UTF_8));
    }
    @Override
    protected void channelRead0(ChannelHandlerContext ctx, ByteBuf msg) {
        // 接收服务器返回的消息
        System.out.println("Client received: " + msg.toString(CharsetUtil.UTF_8));
    }
    @Override
    public void exceptionCaught(ChannelHandlerContext ctx, Throwable cause) {
        cause.printStackTrace();
        ctx.close();
    }
}
```

---

## 四、Echo 运行流程（PPT slide41-42）

```
┌──────────┐                              ┌──────────┐
│  Client  │                              │  Server  │
└────┬─────┘                              └────┬─────┘
     │ (1) 建立连接并发送 "Netty rocks!"      │
     │ ─────────────────────────────────────► │
     │                                        │ (2) 报告接收，回送
     │ ◄───────────────────────────────────── │
     │ (3) 报告返回消息并退出                   │
     │                                        │
     │     ⚠️ 服务端 Ctrl+C                    │
     │ ◄─── 连接断开 ───────────────────────── │
     │ 触发客户端 exceptionCaught              │
└────────────────────────────────────────────┘
```

**PPT slide42 原文**：
1. 一旦客户端建立连接，它就发送消息——**"Netty rocks!"**
2. 服务器报告接收到的消息，并将其回送给客户端
3. 客户端报告返回的消息并退出
4. 服务端 Ctrl+C，会被 EchoClientHandler 的 `exceptionCaught` 捕获异常

---

## 五、服务端 vs 客户端对比

| 维度 | ServerBootstrap（服务端） | Bootstrap（客户端） |
|------|--------------------------|-------------------|
| **Group** | 2 个（boss + worker） | 1 个 |
| **Channel** | NioServerSocketChannel | NioSocketChannel |
| **启动方法** | `bind()`（绑定端口监听） | `connect()`（连接远端） |
| **Handler 安装** | `childHandler`（每个新连接） | `handler`（自身连接） |
| **角色** | 被动等待连接 | 主动发起连接 |

---

## 六、为什么服务端要两个 Group？（PPT slide76）

> *与 ServerChannel 相关联的 EventLoopGroup 将分配一个负责为传入连接请求创建 Channel 的 EventLoop。一旦连接被接受，第二个 EventLoopGroup 就会给它的 Channel 分配一个 EventLoop。*

```
BossGroup：只做一件事——accept() 接受新连接（CPU 占用极低，通常 1 线程）
WorkerGroup：处理所有已建立连接的 I/O 读写（CPU 密集，通常 CPU核数×2 线程）

分离的好处：
  - 接受连接不被 I/O 处理阻塞（防止新连接超时）
  - I/O 处理不被 accept 干扰
```

> **面试记忆口诀**：**"服务端两 Group，Boss 接客 Worker 干活；客户端一 Group，connect 上门"**。Echo 示例三步走：连接→发"Netty rocks!"→服务端原样回送。
