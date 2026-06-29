---
id: note-netty-003
difficulty: L4
category: network
subcategory: Netty
tags:
- NIO
- AIO
- epoll
- Netty
- 架构选型
feynman:
  essence: Netty 选 NIO 而非 AIO，本质是因为在 Linux（服务端主流 OS）上，AIO 是用 epoll 强行模拟出来的，并不比直接用 NIO(epoll) 快，反而带来额外复杂度和回调地狱。既然底层是同一个东西，不如直接用更简单可控的 NIO。
  analogy: AIO 像是"代驾服务"——你把车钥匙交给代驾（OS），它开完通知你。但 Linux 这个代驾公司其实没有真正的代驾，它是临时雇了个会开车的 epoll 司机来冒充（用 epoll 模拟 AIO）。既然最后都是同一个司机在开，你还不如直接雇这个 epoll 司机（NIO），省去中间转手，还能自己盯着路线。
  key_points:
  - Netty官方结论:AIO在Unix系统上不比NIO(epoll)快
  - Linux没有真正的异步IO,AIO是用epoll模拟的
  - NIO更简单可控(主动轮询)vs AIO回调复杂(回调地狱+线程模型难)
  - Netty曾支持AIO(NioSocketChannel的AIO版)后因收益不足移除
first_principle:
  problem: 既然 AIO 理论上是"真正的异步"，为什么 Netty 这个追求高性能的框架反而放弃了它？
  axioms:
  - 性能选型取决于底层OS的真实能力,而非API的理论先进性
  - Linux的AIO是用epoll模拟的(并非OS级真异步),所以AIO和NIO性能一样
  - 框架选择要权衡"性能收益"vs"实现复杂度",无收益的复杂度是负担
  rebuild: 从"性能"出发→理论AIO最好,但Linux下AIO=epoll模拟→性能=NIO→AIO的异步回调模型反而让线程模型和异常处理更复杂→收益为0成本却上升→所以Netty果断回归NIO,用epoll+事件驱动+Future/回调自己实现"异步效果",反而更可控。
follow_up:
  - Linux AIO (io_uring) 出现后，Netty 会转向 AIO 吗？
  - Windows 的 IOCP 是真正的 AIO，Netty 在 Windows 上会更快吗？
  - epoll 的 LT（水平触发）和 ET（边缘触发）区别？
memory_points:
  - 一句话：Not faster than NIO(epoll) on unix systems —— Netty 官方原话
  - 根因：Linux 没有真正的 AIO，AIO 是用 epoll 模拟的，底层和 NIO 一样
  - 权衡：AIO 回调复杂（回调地狱、线程模型难），NIO 主动轮询更简单可控
  - 历史：Netty 曾有 AIO 支持，后因收益不足移除
---

# 为什么 Netty 使用 NIO 而不是 AIO？

## 一、核心结论（Netty 官方原话）

> **Not faster than NIO (epoll) on unix systems.**
> —— Netty 官方文档

**一句话**：在 Unix/Linux 系统上，AIO 并不比 NIO(epoll) 快，所以 Netty 选择 NIO。

> 参考：https://www.jianshu.com/p/df1d6d8c3f9d

---

## 二、为什么"理论上更好"的 AIO 反而落败？

### 根本原因：Linux 没有真正的异步 I/O

这是整个问题的核心，必须理解 OS 层面的真相：

```
┌─────────────────────────────────────────────────────┐
│              操作系统 I/O 能力对比                     │
├──────────┬──────────────────┬───────────────────────┤
│   OS     │   异步 I/O 支持   │       说明             │
├──────────┼──────────────────┼───────────────────────┤
│ Windows  │  ✅ IOCP（真异步）│ OS 内核级完成端口      │
│ Linux    │  ❌ 用 epoll 模拟 │ AIO 本质还是 epoll     │
│ macOS    │  ❌ 用 kqueue 模拟│ 同上                   │
└──────────┴──────────────────┴───────────────────────┘
```

**关键点**：
- Java 服务端 99% 跑在 Linux 上
- Linux 的 AIO 是用 **epoll** 强行模拟出来的，**底层调用和 NIO 一模一样**
- 既然底层是同一个 epoll，那 AIO 的性能上限 = NIO 的性能上限

> **结论**：在 Linux 上，`AIO 性能 ≡ NIO 性能`，AIO 没有任何性能优势。

---

## 三、NIO 反而更优的三个维度

### 1. 简单可控 vs 回调地狱

```
NIO（主动轮询）：
  while(selector.select()) {
      if (key.isReadable()) {  // 我主动问，我掌控节奏
          handle(key);
      }
  }
  → 流程线性、可调试、异常处理直接

AIO（被动回调）：
  channel.read(buffer, attachment, new CompletionHandler() {
      public void completed() { 
          channel.read(..., new CompletionHandler() {  // 嵌套回调
              public void completed() { /* 回调地狱 */ }
          });
      }
  });
  → 回调嵌套深、控制流跳跃、异常难追踪
```

### 2. 线程模型更清晰

NIO 的 Reactor 模式（EventLoop）已经被业界验证：
- 一个 EventLoop 绑定一个线程
- 所有 I/O 事件都在这个线程串行处理
- 无锁化、无竞争

AIO 的回调由 OS 的线程池触发，**你无法控制回调在哪个线程执行**，线程模型反而更难管理。

### 3. 历史验证

Netty 早期（3.x 时代）确实提供过 AIO 的实现（`AioSocketChannel` 等），但：
- 实际压测发现性能没有提升
- 代码复杂度大幅增加
- 用户极少使用
- 最终被**移除**

> 这是最有力的证据：Netty 团队亲手试过 AIO，发现没用，于是放弃了。

---

## 四、第一性原理总结

```
问：为什么要追求异步 I/O？
答：为了高性能（让线程不等 I/O）。

问：Linux 上 AIO 真的更快吗？
答：不，它就是 epoll 模拟的，和 NIO 同速。

问：既然不快，为什么还要用它？
答：没有理由——还要承担回调复杂的成本。

结论：性能相同 → 选更简单的 NIO。
```

---

## 五、扩展：io_uring 会改变这个结论吗？

Linux 5.1+ 引入了 **io_uring**，这是 Linux 第一次有了真正的高性能异步 I/O 接口（不再是 epoll 模拟）。

- 未来如果 Java 封装了 io_uring，AIO 可能真正变快
- 目前 Netty 社区也在关注，但短期内 NIO 仍是主力
- 工程界的主流判断：**在 io_uring 成熟并被 Java 原生支持前，NIO 仍是最佳选择**

> **面试记忆口诀**：**"Linux 的 AIO 是 epoll 假装的"**——这一句就能解释为什么 Netty 选 NIO。性能相同，自然选更简单可控的那个。
