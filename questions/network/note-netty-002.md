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
