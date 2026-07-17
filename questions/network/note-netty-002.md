---
id: note-netty-002
difficulty: L3
category: network
subcategory: Netty
tags:
- BIO
- NIO
- AIO
- IO模型
- 网络编程
feynman:
  essence: BIO 是"一对一专车"（一个连接独占一个线程傻等），NIO 是"定时巡检"（一个线程轮流问所有连接有没有数据），AIO 是"到货通知"（操作系统读完数据主动叫你）。三者的本质区别是"线程如何知道 I/O 就绪"。
  analogy: 用点外卖来理解——BIO：坐在门口小板凳死等外卖小哥到；NIO：每隔一段时间去门口看一眼，没到就回来写代码；AIO：外卖到了小哥主动打电话叫你去拿。
  key_points:
  - BIO=阻塞+一连接一线程→并发上万时线程爆炸
  - NIO=非阻塞+Selector事件通知→一个线程管多连接
  - AIO=异步回调+OS完成后通知→真正异步(但Linux下epoll模拟,无优势)
  - NIO三件套=Channel+Buffer+Selector
first_principle:
  problem: 网络I/O的本质是"线程要等数据从网卡到达用户空间"。如何高效地让线程处理海量连接的I/O就绪事件？
  axioms:
  - 线程是昂贵资源(栈内存约1MB + 上下文切换开销)
  - I/O等待是必然的(数据从网卡到用户空间需要时间)
  - 让线程在等待时去做别的事(而不是阻塞)是提升并发的关键
  - 操作系统内核能知道哪些连接就绪(事件通知)
  rebuild: 从"线程等I/O"出发→BIO让线程死等(浪费)→NIO让线程去问内核(轮询,一个线程问多个连接)→AIO让内核做完再通知(最理想)。NIO的Selector是关键:它用事件通知API判断哪些非阻塞socket就绪,所以一个线程能处理多个并发连接。
follow_up:
  - Selector 的底层实现（epoll/poll/select）？
  - 为什么 Netty 选 NIO 不选 AIO？
  - 零拷贝与 NIO 的关系？
memory_points:
  - BIO痛点：大量线程等待I/O就绪→每线程1MB栈→万连接万线程→上下文切换开销巨大+内存爆炸+网络利用率低
  - NIO两大优势：①较少线程处理多连接(省内存省切换)②无I/O时线程可做其他任务
  - NIO三件套：Channel(通道)+Buffer(缓冲)+Selector(选择器)
  - 外卖比喻：BIO死等/NIO定时看/AIO到货打电话
---

# Java 三种 IO 模型 BIO / NIO / AIO 的区别？

## 一、一句话区分

| 模型 | 全称 | 何时引入 | 核心机制 |
|------|------|---------|---------|
| **BIO** | Blocking IO（同步阻塞） | JDK 1.0 | 一连接一线程，线程阻塞等数据 |
| **NIO** | Non-blocking IO（同步非阻塞） | JDK 1.4 | 一个线程通过 Selector 管多连接，轮询就绪事件 |
| **AIO** | Asynchronous IO（异步非阻塞） | JDK 1.7 | OS 读完后主动回调通知应用 |

> **PPT 趣味比喻（点外卖）**：
> - **BIO**：坐在门口小板凳上等外卖小哥到（死等）
> - **NIO**：每隔一段时间去门口看一下，没到就回来写代码（定时巡检）
> - **AIO**：外卖到了之后，外卖小哥给你打电话，去门口拿（到货通知）

---

## 二、BIO（Blocking IO）—— 传统模型

### 工作方式
```
┌────────┐   连接1   ┌─────────┐
│ Client │──────────│ Thread1 │ ← 阻塞等待 read()
└────────┘          └─────────┘
┌────────┐   连接2   ┌─────────┐
│ Client │──────────│ Thread2 │ ← 阻塞等待 read()
└────────┘          └─────────┘
        ...每个连接独占一个线程...
```

### 致命缺点（来自 PPT slide6）
1. **大量线程等待 I/O 就绪**——线程大部分时间在阻塞，资源浪费
2. **每个线程栈内存约 1MB**——1 万连接 = 10GB 内存
3. **上下文切换开销巨大**——JVM 在线程极限前，万级线程的切换成本压垮系统
4. **网络资源利用率低**——线程都阻塞着，CPU 也用不满

> **结论**：BIO 无法支撑高并发，C10K（1 万并发）就是它的天花板。

---

## 三、NIO（Non-blocking IO）—— Netty 的选择

### 三大核心组件（PPT slide9）

```
┌──────────────────────────────────────────┐
│              NIO 三件套                    │
│  ┌──────────┐  ┌──────────┐  ┌─────────┐ │
│  │ Channel  │  │  Buffer  │  │Selector │ │
│  │ 通道     │  │  缓冲区  │  │ 选择器  │ │
│  │数据载体  │  │读写容器  │  │事件分发 │ │
│  └──────────┘  └──────────┘  └─────────┘ │
└──────────────────────────────────────────┘
```

- **Channel（通道）**：双向数据通道，可读可写（对比 Stream 是单向的）
- **Buffer（缓冲区）**：数据读写都经过 Buffer，NIO 面向缓冲区
- **Selector（选择器）**：核心！监控多个 Channel 的事件就绪状态

### Selector 工作原理（PPT slide10）

> Selector 是 Java 非阻塞 I/O 实现的关键。它使用**事件通知 API**，确定一组非阻塞套接字中哪些已就绪能进行 I/O 操作。因为可以在任何时间检查任意读/写操作的完成状态，**一个单一的线程便可以处理多个并发的连接**。

```
                    ┌──────────┐
                    │ Selector │ ← 一个线程
                    └────┬─────┘
          ┌─────────┬───┴────┬─────────┐
          ▼         ▼        ▼         ▼
     ┌────────┐ ┌────────┐ ┌──────┐ ┌──────┐
     │Channel1│ │Channel2│ │Ch... │ │Ch N  │
     └────────┘ └────────┘ └──────┘ └──────┘
      (就绪)               (空闲)   (就绪)
```

### NIO 两大优势（PPT slide10）
1. **较少线程可以处理许多连接**，减少了内存管理和上下文切换开销
2. **当没有 I/O 操作需要处理时，线程也可以被用于其他任务**

> **PPT 注记**：NIO = new io（no-blocking io），自 JDK 1.4 引入。Java 14 与未来版本将强化它。

---

## 四、AIO（Asynchronous IO）—— 理论最优但实际少用

### 工作方式
应用发起 `read()` 后立即返回，OS 在后台把数据读完，**完成后通过回调/Future 主动通知应用**。

### 为什么实际少用（详见下一题）
PPT slide12 调侃：AIO 的资料只能"①google ②问老谢"——因为用得少。
核心原因：**在 Unix/Linux 系统上 AIO 并不比 NIO(epoll) 快**（Netty 官方结论），所以主流框架都选 NIO。

---

## 五、三者对比总结

| 维度 | BIO | NIO | AIO |
|------|-----|-----|-----|
| **通信** | 面向流（Stream） | 面向缓冲（Buffer） | 面向缓冲（Buffer） |
| **阻塞** | 阻塞 | 非阻塞 | 非阻塞 |
| **触发** | 无 | 水平触发/就绪通知 | 完成回调 |
| **线程模型** | 一连接一线程 | 一线程管多连接（Selector） | OS 完成后回调，线程更少 |
| **并发能力** | 低（C10K 天花板） | 高（C100K+） | 高（理论） |
| **实现复杂度** | 简单 | 复杂（手写难） | 中等 |
| **Netty 支持** | OIO | ✅ 主力 | 曾支持后移除 |

---

## 六、代码层面的差异

### BIO Server（阻塞）
```java
while (true) {
    Socket socket = serverSocket.accept();  // 阻塞！等连接
    new Thread(() -> {
        InputStream in = socket.getInputStream();
        in.read(buffer);  // 阻塞！等数据
    }).start();  // 每个连接一个线程
}
```

### NIO Server（非阻塞 + Selector）
```java
Selector selector = Selector.open();
ServerSocketChannel ssc = ServerSocketChannel.open();
ssc.configureBlocking(false);  // 关键：非阻塞
ssc.register(selector, SelectionKey.OP_ACCEPT);

while (true) {
    selector.select();  // 阻塞到至少一个通道就绪
    Set<SelectionKey> keys = selector.selectedKeys();
    for (SelectionKey key : keys) {
        if (key.isAcceptable()) { /* 处理连接 */ }
        if (key.isReadable())    { /* 处理读 */ }
    }
}
// 一个线程处理所有连接
```

> **记忆要点**：BIO 的痛在"线程等"，NIO 的巧在"Selector 问"，AIO 的好（理论）在"OS 喊"。Netty 选 NIO 是因为 Linux 下 epoll 已经够好。

## 苏格拉底式面试追问

> 这组追问模拟面试官层层逼问，每一问先回答"为什么"，再回答"怎么做"，最后回答"如何证明"。

### 第一层：目标与动机

**Q：BIO/NIO/AIO 你说本质是"阻塞模型 vs 多路复用 vs 异步回调"，但 AIO（异步 IO）听起来最先进，为什么没普及？**

AIO 在不同平台实现差异大：Linux 的 AIO（libaio、io_uring）和 Java NIO.2 的 AsynchronousChannel 不完全契合，Linux 的 epoll 本质是"多路复用"（NIO），不是真异步。Java AIO 在 Linux 上底层仍用 epoll 模拟，性能优势不明显，且 API 复杂（CompletionHandler 回调嵌套深、调试难）。Windows 的 IOCP 是真异步，但服务器多用 Linux。所以 AIO 在 Linux 上的"先进性"没兑现，Netty 曾支持 AIO 但后来移除（社区认为收益不抵复杂度）。NIO（epoll 多路复用 + Reactor 模型）在 Linux 上已经足够高效（Netty/Dubbo/Redis 都基于它），AIO 没有压倒性优势。所以"没普及"不是 AIO 不好，是 Linux 生态下 NIO 够用且更简单。

### 第二层：证据与定位

**Q：BIO 是"一个连接一个线程"，NIO 是"一个线程管理多连接"，你怎么用代码演示两者的连接数能力差异？**

BIO 演示：写个 ServerSocket accept 循环，每个新连接 new Thread 处理。开 1 万客户端连接，Server 端会有 1 万线程（`jstack` 或 `jvisualvm` 看），内存占用数 GB，再开更多连接会 OOM（线程上限）。NIO 演示：用 Selector 注册 1 万个 SocketChannel，单线程 select 处理事件。1 万连接只有 1 个线程（或几个 EventLoop），内存几十 MB，可扩展到 10 万+ 连接。差异根因：BIO 的线程在 `socket.read()` 上阻塞（等数据），一个连接占一个线程；NIO 的 Selector.select() 监听所有 channel 的就绪事件，一个线程服务多个 channel，read 只在有数据时调用（不阻塞）。这就是"多路复用"的价值——少量线程管大量连接。

### 第三层：根因深挖

**Q：NIO 的 Selector 你说是"多路复用"，底层用什么系统调用？epoll 相比 select/poll 的优势是什么？**

Linux 下 Selector 底层是 epoll（其他平台有 kqueue/IOCP）。epoll 相比 select/poll 的优势：一、O(1) 事件通知——select/poll 每次返回都要遍历所有注册的 fd（O(N)），epoll 直接返回就绪 fd 列表（O(1)）；二、无 fd 数量限制——select 默认 1024 个 fd（FD_SETSIZE），poll 无限但仍是 O(N) 遍历，epoll 用红黑树管理 fd 无上限；三、内存拷贝少——select/poll 每次调用要把 fd 集合从用户态拷贝到内核态，epoll 用共享内存（epoll_wait 只返回就绪 fd，不重传全部）。所以 epoll 在"高连接数 + 低活跃度"（如 IM，1 万连接但只有少数有数据）场景远胜 select/poll。Java NIO 的 Selector 在 Linux 自动用 epoll（无需显式选择）。

**Q：那为什么不直接用 epoll 系统调用，而非要 Java NIO 的 Selector 封装？**

Java NIO 的价值是"跨平台 + 面向对象封装"。跨平台：Linux 是 epoll、macOS 是 kqueue、Windows 是 IOCP，Java NIO 的 Selector 统一了 API（`Selector.open()`、`select()`），JVM 自动用平台的最佳实现。直接调 epoll（通过 JNI）就绑死 Linux，失去跨平台。封装：Selector 把 fd 管理、事件注册、就绪返回包装成面向对象 API（SelectionKey、Channel），比 C 的 epoll_create/epoll_ctl/epoll_wait 易用。但封装也有代价——性能损耗（JIT、GC、对象分配）、灵活性差（无法用 epoll 的某些高级特性如 edge-triggered，Java NIO 默认 level-triggered）。所以高性能场景（如 DPDK、零拷贝）会绕过 Java NIO 直接 JNI，但通用网络编程用 NIO/Netty 够用。

### 第四层：方案权衡

**Q：NIO 你说"非阻塞"，但 read/write 仍可能返回 0（无数据），这跟"阻塞等到有数据"相比有什么实际差异？**

NIO 的"非阻塞"指"channel 配置 non-blocking 后，read/write 不阻塞线程"——read 无数据返回 0（或更少字节），write 缓冲区满返回写入字节数（可能小于预期）。线程不阻塞，可以"继续干别的"（如处理其他 channel）。BIO 的 read 会阻塞线程直到有数据（线程挂起）。实际差异：一、线程利用率——BIO 一个线程只能等一个连接（阻塞），NIO 一个线程可轮询多个连接（非阻塞）；二、编程模型——BIO 是"顺序流式读"（while read line），NIO 是"事件驱动"（selector 告诉你哪个 channel 就绪再读）；三、半包粘包——BIO 的流是"读一次是一次"，NIO 的 channel 是"读到的字节数不定"，要自己处理"一条消息分多次读"或"多条消息一次读"。所以 NIO 不是"更快的 BIO"，是"完全不同的编程模型"，复杂度也高。

**Q：为什么不所有 IO 都用 NIO，BIO 不是更简单吗？**

BIO 简单但连接数受限——每个连接一个线程，千级连接就吃力。NIO 复杂但能扛万级连接。选型看连接数：一、低连接数（百级以内）+ 业务简单——BIO 够用且代码清晰（如内部管理工具、RPC 的少量调用）；二、高连接数（万级）+ 高吞吐——必须 NIO（如 IM、推送、网关）；三、超低延迟（如游戏）——可能用 AIO 或更底层（netty native epoll transport 绕过 Java NIO）。实际工程：99% 用 Netty（封装了 NIO），1% 用 BIO（极简场景）。Spring Boot 的 Tomcat 默认 NIO（Tomcat 8+），不是 BIO——说明即使是 Web 服务器也普遍用 NIO。所以"都用 NIO"是工程主流，BIO 主要在教学和极简工具里。

### 第五层：验证与沉淀

**Q：你怎么验证 BIO 和 NIO 在高连接数下的性能差异？**

压测对比：写 BIO Server（thread per connection）和 NIO Server（Selector 单线程），用同一客户端程序开 N 个连接（N=100、1000、10000、100000）。监控：一、内存——BIO 的线程栈占用（`jmap` 或 RSS），N=10000 时 BIO 应数 GB，NIO 几十 MB；二、CPU——BIO 的线程切换开销（`top -H` 看线程数），NIO 单线程无切换；三、连接建立时间——BIO 每连接 new Thread 的开销，NIO 注册 channel 几乎瞬时；四、吞吐——相同负载下 NIO 吞吐应远高于 BIO（N 大时）。验证 epoll：`strace -e epoll_wait, epoll_ctl -p <pid>` 看 Java NIO 实际调用的系统调用，应看到 epoll_create1/epoll_ctl/epoll_wait。这些验证直观展示 IO 模型的性能差异。

**Q：这道题做完，你沉淀出了什么可复用的 IO 模型选型经验？**

三场景选型：一、低连接 + 简单业务——BIO（代码清晰，如内部工具）；二、高连接 + 通用网络服务——NIO（用 Netty 封装，如 IM/RPC/网关）；三、极致性能 + 平台特定——AIO 或 native transport（绕过 Java NIO，如高频交易）。核心原则："连接数决定 IO 模型，BIO 适合百级，NIO 适合万级以上；不直接用 NIO API（太复杂），用 Netty 等框架封装；EventLoop 不阻塞是 NIO 的核心约束。" 这套经验也适用于其他语言（Go 的 net 包本质是 NIO + goroutine，Rust 的 tokio 类似 Netty），底层都是"多路复用 + 事件驱动"。


## 结构化回答

**30 秒电梯演讲：** BIO 是"一对一专车"（一个连接独占一个线程傻等），NIO 是"定时巡检"（一个线程轮流问所有连接有没有数据），AIO 是"到货通知"（操作系统读完数据主动叫你）。

**展开框架：**
1. **BIO痛点** — 大量线程等待I/O就绪→每线程1MB栈→万连接万线程→上下文切换开销巨大+内存爆炸+网络利用率低
2. **NIO两大优势** — ①较少线程处理多连接(省内存省切换)②无I/O时线程可做其他任务
3. **NIO三件套** — Channel(通道)+Buffer(缓冲)+Selector(选择器)

**收尾：** 这块我踩过坑——要不要深入聊：Selector 的底层实现（epoll/poll/select）？

## 视频脚本

> 预计时长：3 分钟 | 由浅入深

| 时间 | 画面/字幕 | 口播台词 | 讲解要点 |
|------|----------|----------|----------|
| 0:00 | 标题卡 | "Netty一句话：BIO 是'一对一专车'（一个连接独占一个线程傻等），NIO 是'定时巡检'（一个线程轮流问所有连接有没有数据）…。" | 开场钩子 |
| 0:15 | Netty Reactor 线程模型图 | "BIO痛点：大量线程等待I/O就绪到每线程1MB栈到万连接万线程到上下文切换开销巨大+内存爆炸+网络利用率低" | BIO痛点 |
| 1:06 | Netty Reactor 线程模型图分步演示 | "NIO两大优势：①较少线程处理多连接(省内存省切换)②无I/O时线程可做其他任务" | NIO两大优势 |
| 1:57 | 关键代码/伪代码片段 | "NIO三件套：Channel(通道)+Buffer(缓冲)+Selector(选择器)" | NIO三件套 |
| 2:50 | 总结卡 | "核心抓住这条主线，下期咱们接着聊：Selector 的底层实现（epoll/poll/select）。" | 收尾 |
