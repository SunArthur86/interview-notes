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

## 苏格拉底式面试追问

> 这组追问模拟面试官层层逼问，每一问先回答"为什么"，再回答"怎么做"，最后回答"如何证明"。

### 第一层：目标与动机

**Q：Bootstrap 和 ServerBootstrap 你说是"引导"，为什么不直接 new EventLoopGroup + new Channel，要搞个 Bootstrap？**

直接 new 的痛点：一、配置散乱——EventLoopGroup、Channel 类型、Handler、Option、Attr 等配置散在多处，难管理；二、顺序约束——Channel 要先创建、再注册到 EventLoopGroup、再绑定 Handler、再 bind，顺序错会异常；三、Server vs Client 差异——Server 要"accept 子 Channel"（bossGroup accept、workerGroup 处理子 Channel），Client 直接 connect，两种流程不同。Bootstrap 把这些封装成"链式 API"——`.group().channel().handler().option().bind()`，配置集中、顺序保证、Server/Client 分别用 ServerBootstrap（支持 childHandler）和 Bootstrap（Client）。所以 Bootstrap 是"配置 + 流程编排"的封装，简化正确性（不漏步骤）、提升可读性（链式声明）。这是"Builder 模式 + 模板方法"在服务器引导的应用。

### 第二层：证据与定位

**Q：ServerBootstrap 有 handler() 和 childHandler()，区别是什么？为什么不只用一个？**

handler() 配置的是"ServerSocketChannel 的 Pipeline"——处理 accept 事件（接受新连接）。childHandler() 配置的是"子 SocketChannel 的 Pipeline"——处理已建立连接的读写。区别：ServerSocketChannel 只接受连接不处理业务（accept 后生子 Channel），子 Channel 处理业务。所以 handler 用于"accept 阶段"（通常不需要自定义 Handler，Netty 内置的 ServerBootstrapAcceptor 自动把子 Channel 注册到 workerGroup），childHandler 用于"业务处理"（编解码、业务 Handler）。如果只用 handler()，所有逻辑（accept + 业务）混在一个 Pipeline，且子 Channel 没有 Handler 处理业务。所以分开是"职责分离"——ServerSocketChannel 管 accept、子 Channel 管业务。99% 场景只用 childHandler()，handler() 不设（用默认 acceptor）。

### 第三层：根因深挖

**Q：Bootstrap.bind 你说是异步的，返回 ChannelFuture，那"bind 成功"和"服务可接受连接"是同一时刻吗？**

不是。bind 是"绑定端口"（bind 系统调用），返回 ChannelFuture 在"端口绑定完成"时完成（成功或失败）。但"可接受连接"还需要"端口开始 listen"（Netty 内部在 bind 后自动调 listen，绑定完成即开始 listen）。所以 bind 成功后，端口既绑定又 listen，可以接受连接。验证：bind 的 future 完成后，客户端 connect 应能连上（accept 成功）。如果 bind 成功但连接不上，可能是 listen 未调（Netty bug，罕见）或防火墙挡了端口。所以 bind 成功 = 服务可接受连接（Netty 保证）。注意：bind 成功不代表"业务 ready"——Handler 可能还要初始化（如加载配置、连 DB），业务 ready 要业务层判断（如 HealthCheck）。

**Q：那为什么不阻塞等 bind 完成再返回，像传统 ServerSocket.bind？**

异步 bind 让"启动流程不阻塞调用线程"。场景：应用启动时 bind 多个端口（如管理端口 + 业务端口），同步 bind 要串行等，异步 bind 可并行。且 Netty 的 bind 在 EventLoop 上执行（注册到 bossGroup 的 EventLoop），调用线程提交后立即返回 ChannelFuture，EventLoop 异步处理。如果同步 bind，调用线程要等 EventLoop 处理完，跨线程同步有开销。所以异步 bind 是"启动流程非阻塞"的设计。但实际 server 启动常用 `future.sync()` 或 `await()` 阻塞等 bind 成功（启动时无所谓阻塞），确保端口绑定后再继续（如健康检查上报"已 ready"）。所以 bind 是异步 API，但使用时可 sync 等待（启动场景）或异步回调（运行时动态开端口）。

### 第四层：方案权衡

**Q：Bootstrap 的 option() 和 childOption() 你说分别配置 ServerSocketChannel 和子 Channel，怎么记？**

option() 配置"接受连接的 ServerSocketChannel"——影响 accept 行为。如 SO_BACKLOG（accept 队列长度，默认 50，高并发调大如 1000+）、SO_REUSEADDR（端口重用，快速重启）。childOption() 配置"子 SocketChannel"——影响已建立连接的读写。如 TCP_NODELAY（禁用 Nagle，小包立即发，低延迟场景开）、SO_KEEPALIVE（TCP 保活，长连接开）、SO_RCVBUF/SO_SNDBUF（收发缓冲区大小）。记忆：option 是"server 端口级"、childOption 是"每连接级"。配置原则：一、SO_BACKLOG 按并发调（默认 50 太小，高并发 1000+）；二、TCP_NODELAY 默认开（Netty 建议禁用 Nagle）；三、SO_KEEPALIVE 长连接开（如 IM），短连接无所谓；四、缓冲区用默认（内核自调），除非明确知道需求。

**Q：为什么不把所有 Option 都设成"最优值"（大 backlog、大缓冲区、所有特性都开）？**

"最优"是场景相关的，不是越大越好。一、SO_BACKLOG 过大——内存占用增加（内核为每个 accept 维护结构），且"积压太多连接"可能是问题信号（处理不过来），不如限流；二、SO_RCVBUF/SO_SNDBUF 过大——内存占用增加，且"大缓冲区"掩盖了"对端慢"的问题（数据堆在缓冲区），不如背压；三、TCP_NODELAY 禁 Nagle 增加小包数量（更多包头开销），适合交互式（低延迟）不适合批量传输（高吞吐）；四、SO_KEEPALIVE 的默认间隔长（如 2 小时），实际应用要应用层心跳（如 Netty 的 IdleStateHandler）而非依赖 TCP keepalive。所以"最优配置"要看场景，不是堆最大值。Netty 默认值是"通用场景合理"，特殊场景按需调。

### 第五层：验证与沉淀

**Q：你怎么验证 Bootstrap 配置正确（端口绑定、Handler 注册、Option 生效）？**

三类验证：一、端口绑定——`ss -tlnp | grep <port>` 看端口是否监听，bind 的 ChannelFuture 应成功（`future.isSuccess()`）；二、Handler 注册——客户端 connect 后，在 childHandler 的 channelActive 里打日志，应触发（说明子 Channel 注册了 Handler）；三、Option 生效——`ss -tnli | grep <port>` 看 Send-Q（backlog）、`cat /proc/<pid>/net/sockstat` 看缓冲区，验证配置生效。验证 bind 异步：bind 后立即检查 future.isDone()（可能 false），等一会儿再查（true）。线上监控：绑定端口列表（应匹配配置）、各端口的连接数、accept 速率（过高可能是攻击或下游慢导致 accept 队列堆积）。

**Q：这道题做完，你沉淀出了什么可复用的 Bootstrap 配置经验？**

五条经验：一、Server 用 ServerBootstrap（childHandler 业务）、Client 用 Bootstrap（handler 业务）；二、bossGroup 1 个线程够（单端口单 acceptor）、workerGroup = CPU×2（业务处理）；三、SO_BACKLOG 调大（1000+，防高并发 accept 队列满）；四、TCP_NODELAY 默认开（低延迟）；五、childHandler 用 ChannelInitializer 懒加载（避免每次 new Handler 链）。核心："Bootstrap 是 Netty 的启动入口，正确配置（线程模型、Handler、Option）是服务稳定的基础，错误配置（如 bossGroup 过大、Option 不当）会导致性能问题或连接异常。"


## 结构化回答

**30 秒电梯演讲：** Bootstrap/ServerBootstrap 是 Netty 的"启动装配器"，它把分散的组件（EventLoopGroup、Channel 类型、Pipeline、Handler）像搭积木一样组装成一个可运行的服务端/客户端。服务端用两个 Group（Boss 接连接、Worker 处理 I/O），客户端用一个 Group，最后 bind()/connect() 启动。

**展开框架：**
1. **服务端引导5步** — 创建ServerBootstrap → 分配NioEventLoopGroup → 指定InetSocketAddress → 用ChannelInitializer初始化Channel → bind()
2. **客户端引导5步** — 创建Bootstrap → 分配NioEventLoopGroup → 创建InetSocketAddress(连接目标) → 安装EchoClientHandler → connect()
3. **Echo运行** — 客户端发"Netty rocks!" → 服务端接收并回送 → 客户端报告返回消息

**收尾：** 这块我踩过坑——要不要深入聊：为什么服务端要拆 BossGroup 和 WorkerGroup？

## 视频脚本

> 预计时长：3 分钟 | 由浅入深

| 时间 | 画面/字幕 | 口播台词 | 讲解要点 |
|------|----------|----------|----------|
| 0:00 | 标题卡 | "Netty一句话：Bootstrap/ServerBootstrap 是 Netty 的'启动装配器'…。" | 开场钩子 |
| 0:15 | Netty Reactor 线程模型图 | "服务端引导5步：创建ServerBootstrap 到 分配NioEventLoopGroup 到 指定InetSo…" | 服务端引导5步 |
| 1:06 | Netty Reactor 线程模型图分步演示 | "客户端引导5步：创建Bootstrap 到 分配NioEventLoopGroup 到 创建InetSocketAd…" | 客户端引导5步 |
| 1:57 | 关键代码/伪代码片段 | "Echo运行：客户端发'Netty rocks!' 到 服务端接收并回送 到 客户端报告返回消息" | Echo运行 |
| 2:50 | 总结卡 | "核心抓住这条主线，下期咱们接着聊：为什么服务端要拆 BossGroup 和 WorkerGroup。" | 收尾 |
