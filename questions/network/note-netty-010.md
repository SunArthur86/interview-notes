---
id: note-netty-010
difficulty: L4
category: network
subcategory: Netty
tags:
- EventLoop
- EventLoopGroup
- 线程模型
- 无锁化
- Reactor
feynman:
  essence: EventLoop 是 Netty 处理连接生命周期内所有事件的核心抽象——它本质上是一个"绑定单一线程、死循环处理任务"的执行器。它的精妙在于串行无锁化设计：一个 EventLoop 终身绑定一个线程，一个 Channel 终身注册到一个 EventLoop，于是同一个 Channel 的所有 I/O 都在同一个线程串行执行，完全不需要加锁。
  analogy: EventLoop 像银行的"专属柜员"。一位柜员（EventLoop/线程）固定服务几个客户（Channel），客户的所有业务（I/O 事件）都由这位柜员一个人按顺序办，从不串台——因为只有一个柜员在动这个客户的资料，根本不需要锁柜子。EventLoopGroup 是整个柜台组（一群柜员），老板（Acceptor）把新来的客户分配给空闲的柜员。
  key_points:
  - EventLoop=处理连接生命周期事件的执行器,每个任务是Runnable
  - 五大关系:EventLoopGroup含多EventLoop;EventLoop终身绑一线程;I/O在专属线程处理;Channel终身注册一EventLoop;一EventLoop可被分给多Channel
  - 串行无锁化:同Channel的I/O由同线程串行执行→消除同步需要
first_principle:
  problem: 高并发下，如何调度线程处理海量连接的 I/O 事件，既高效又无竞争？
  axioms:
  - 线程切换和锁竞争是并发性能的大敌
  - 一个连接的所有I/O事件天然应该串行(避免数据错乱)
  - 把"一个连接的所有事件"绑定到"一个固定线程"可消除竞争
  - 事件循环(死循环拉取任务)是高效的事件处理模式
  rebuild: 从"消除锁竞争"出发→让一个EventLoop绑定一个线程(永不切换)→让一个Channel终身注册到一个EventLoop→于是该Channel的所有I/O事件都在这个线程串行处理→无竞争→无需加锁→这就是Netty高性能并发模型的根基(Reactor单线程串行化思想)。
follow_up:
  - BossGroup 和 WorkerGroup 的分工？
  - EventLoop 处理耗时的业务任务会阻塞 I/O 吗？
  - Netty 的 Reactor 模式有哪几种？
memory_points:
  - EventLoop 定义：处理连接生命周期中所发生的事件，运行任务（每个任务是个 Runnable 实例）
  - 五大绑定关系：①EventLoopGroup含1+EventLoop ②EventLoop终身绑1Thread ③I/O在专属Thread处理 ④Channel终身注册1EventLoop ⑤1EventLoop可分给多Channel
  - 王炸结论：给定 Channel 的 I/O 操作都由相同 Thread 执行，实际上消除了对同步的需要
---

# EventLoop 的核心原理与线程模型？

## 一、EventLoop 是什么？（PPT slide71-72）

> *事件循环，运行任务来处理在连接的生命周期内发生的事件，每个任务是个 Runnable 实例。*

> *EventLoop 定义了 Netty 的核心抽象，用于处理连接的生命周期中所发生的事件。*

**一句话**：EventLoop 是一个"死循环拉取并执行任务"的事件处理器，是 Netty 并发模型的核心。

---

## 二、五大绑定关系（核心考点，PPT slide73）

这是理解 Netty 线程模型的关键，必须记牢：

```
┌─────────────────────────────────────────────────────────┐
│              EventLoop 的五大绑定关系                      │
├─────────────────────────────────────────────────────────┤
│                                                         │
│  ① EventLoopGroup ──包含──► 1个或多个 EventLoop          │
│                                                         │
│  ② 1个 EventLoop ──生命周期内绑定──► 1个 Thread          │
│                                                         │
│  ③ 所有由 EventLoop 处理的 I/O 事件                       │
│     ──都在它专有的 Thread 上处理──                        │
│                                                         │
│  ④ 1个 Channel ──生命周期内注册于──► 1个 EventLoop        │
│                                                         │
│  ⑤ 1个 EventLoop ──可能被分配给──► 1个或多个 Channel      │
│                                                         │
│  结论：给定 Channel 的 I/O 操作都由相同 Thread 执行        │
│        → 实际上消除了对同步的需要                          │
└─────────────────────────────────────────────────────────┘
```

### 关系可视化

```
            EventLoopGroup (一组 EventLoop)
        ┌────────┬────────┬────────┐
        ▼        ▼        ▼        ▼
    ┌───────┐┌───────┐┌───────┐┌───────┐
    │Loop 1 ││Loop 2 ││Loop 3 ││Loop 4 │   ← ②每个Loop绑定一个Thread
    └───┬───┘└───┬───┘└───┬───┘└───┬───┘     (③I/O在专属Thread处理)
        │        │        │        │
   ④⑤  │        │        │        │
   ┌──┴──┐  ┌──┴──┐  ┌──┴──┐  ┌──┴──┐
   │Ch A │  │Ch C │  │Ch E │  │Ch G │  ← ④Channel终身注册一个Loop
   │Ch B │  │Ch D │  │Ch F │  │Ch H │    ⑤一个Loop服务多个Channel
   └─────┘  └─────┘  └─────┘  └─────┘
```

---

## 三、串行无锁化设计（精妙之处）

> *在这种设计中，一个给定 Channel 的 I/O 操作都是由相同的 Thread 执行的，**实际上消除了对于同步的需要**。*

**推导链**：
```
Channel A 注册到 EventLoop 1
    ↓
EventLoop 1 绑定 Thread-1
    ↓
Channel A 的所有 I/O 事件（read/write/连接/断开）
    ↓
全部在 Thread-1 上执行
    ↓
单线程串行 → 无并发竞争 → 无需 synchronized/Lock
```

**对比传统模型**：
```
传统线程池模型（多线程争抢处理一个连接）：
    Channel A 的 read  → Thread-1 处理
    Channel A 的 write → Thread-2 处理  ← 竞争！需要加锁！
    
Netty 模型（单线程串行）：
    Channel A 的 read  → Thread-1 处理
    Channel A 的 write → Thread-1 处理  ← 同线程，无竞争，无锁！
```

---

## 四、BossGroup 与 WorkerGroup（PPT slide75-76）

Netty 服务端通常用两个 EventLoopGroup（Reactor 主从模式）：

```
┌──────────────────────────────────────────────────────────┐
│              主从 Reactor 模型（2个 Groups）              │
├──────────────────────────────────────────────────────────┤
│                                                          │
│   BossGroup（接受连接）                                   │
│   ┌─────────────┐                                        │
│   │ EventLoop   │ ── 接收新连接请求                       │
│   │ (Acceptor)  │ ── 创建新 Channel                      │
│   └──────┬──────┘                                        │
│          │ 把新 Channel 分配给                            │
│          ▼                                               │
│   WorkerGroup（处理 I/O）                                 │
│   ┌─────────┬─────────┬─────────┐                        │
│   │Loop 1   │Loop 2   │Loop 3   │ ── 读写数据            │
│   │Ch A,B   │Ch C,D   │Ch E,F   │ ── 业务事件处理         │
│   └─────────┴─────────┴─────────┘                        │
└──────────────────────────────────────────────────────────┘
```

> PPT slide76 原文：*与 ServerChannel 相关联的 EventLoopGroup 将分配一个负责为传入连接请求创建 Channel 的 EventLoop。一旦连接被接受，第二个 EventLoopGroup 就会给它的 Channel 分配一个 EventLoop。*

### 分工
| Group | 职责 | 数量 |
|-------|------|------|
| **BossGroup** | 接受新连接（OP_ACCEPT），创建 Channel | 通常 1 个线程 |
| **WorkerGroup** | 处理已接受连接的 I/O 读写 | 通常 CPU 核数 × 2 |

---

## 五、EventLoop 的类层次结构（PPT slide74）

```
            ScheduledExecutorService (JDK)
                    ↑ (继承)
            EventExecutorGroup (Netty)
                    ↑ (继承)
            EventLoopGroup (Netty)
                    ↑ (继承)
               EventLoop (Netty)
                    ↑ (实现)
            SingleThreadEventLoop
                    ↑
            NioEventLoop  /  EpollEventLoop  /  ...
```

EventLoop 不仅处理 I/O，还实现了 `ScheduledExecutorService`，所以它还能：
- 执行普通任务（`execute(Runnable)`）
- 执行定时任务（`scheduleAtFixedRate`）
- 这就是为什么 PPT 说"每个任务是个 Runnable"

---

## 六、实战代码（PPT slide37 的引导过程）

```java
// 服务端引导
ServerBootstrap b = new ServerBootstrap();
// 2个 Group（主从 Reactor）
b.group(bossGroup, workerGroup)           // boss=接连接, worker=处理I/O
 .channel(NioServerSocketChannel.class)
 .childHandler(new ChannelInitializer<SocketChannel>() {
     @Override
     protected void initChannel(SocketChannel ch) {
         ch.pipeline().addLast(new MyHandler());
     }
 });
b.bind(port);
```

---

## 七、⚠️ 重要陷阱：不要在 EventLoop 线程做耗时操作

因为 EventLoop 是单线程串行的，如果在 Handler 里执行耗时操作（如 DB 查询、远程调用），会**阻塞这个 EventLoop 上的所有 Channel**：

```java
// ❌ 错误：阻塞 EventLoop
public void channelRead(ChannelHandlerContext ctx, Object msg) {
    Thread.sleep(5000);  // 这个 EventLoop 上的所有 Channel 都卡 5 秒！
}

// ✅ 正确：耗时任务丢到业务线程池
public void channelRead(ChannelHandlerContext ctx, Object msg) {
    executor.submit(() -> {  // 业务线程池
        // 耗时操作
        ctx.writeAndFlush(result);  // 回到 EventLoop 线程
    });
}
```

> **面试记忆口诀**：**"一 Loop 一线程，一 Channel 一 Loop"**——这五个绑定关系推导出"无锁化"，是 Netty 高性能的根基。BossGroup 接连接，WorkerGroup 干活，耗时任务千万别在 EventLoop 里干。
