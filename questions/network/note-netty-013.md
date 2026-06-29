---
id: note-netty-013
difficulty: L3
category: network
subcategory: Netty
tags:
- 生命周期
- Channel
- ChannelHandler
- ChannelInboundHandler
- Netty
feynman:
  essence: Netty 的两个生命周期——Channel 生命周期描述"一个连接从注册到注销"的状态变迁（registered→active→inactive→unregistered）；ChannelHandler 生命周期描述"一个处理器被加入到链、被调用、被移除"的回调节点。两者交织，让你能在连接/处理器的每个关键节点插入自定义逻辑。
  analogy: Channel 生命周期像"一个员工从入职到离职"——入职登记(registered)、上班打卡(active)、下班(inactive)、注销工号(unregistered)。ChannelHandler 生命周期像"一个项目被分配给你"——分给你(handlerAdded)、激活开始干活(channelRegistered/Active)、结束移除(handlerRemoved)。
  key_points:
  - Channel生命周期:unregistered→registered→active→inactive→unregistered
  - ChannelHandler生命周期:handlerAdded→channelRegistered→...(业务事件)→handlerRemoved
  - ChannelInboundHandler是处理入站事件的核心接口(含生命周期回调)
  - 在生命周期的各回调节点可插入自定义逻辑
first_principle:
  problem: 网络连接和处理器都有"从生到死"的过程，如何让开发者在每个关键节点能介入处理（如初始化资源、清理资源）？
  axioms:
  - 资源(连接/缓冲区)有生命周期,必须在合适的时机创建和释放
  - 生命周期节点是确定性的(注册/激活/失活/注销)
  - 回调是"在特定时机介入"的最佳方式
  rebuild: 从"资源生命周期管理"出发→定义Channel的4个状态(注册/活跃/失活/注销)→为每个状态变迁提供回调方法→ChannelHandler复用这套回调+自己的添加/移除回调→开发者在对应回调里做资源初始化/清理→实现连接全生命周期的可控管理。
follow_up:
  - channelActive 和 channelRegistered 的区别？时序？
  - 如何在 handlerAdded 里做资源初始化，handlerRemoved 里清理？
  - IdleStateHandler 如何利用生命周期做空闲检测？
memory_points:
  - Channel 生命周期四状态变迁：channelRegistered → channelActive → channelInactive → channelUnregistered
  - ChannelHandler 生命周期：handlerAdded → channelRegistered → ... → channelInactive → handlerRemoved
  - ChannelInboundHandler：处理入站事件，是生命周期回调的核心接口
  - 实战：在 channelActive 初始化连接资源，在 channelInactive/handlerRemoved 清理
---

# Channel 和 ChannelHandler 的生命周期？

## 一、为什么关注生命周期？

网络连接（Channel）和处理器（ChannelHandler）都有"从生到死"的过程。Netty 把这些过程抽象成**生命周期回调**，让开发者在关键节点（如连接建立、断开）插入自定义逻辑——初始化资源、清理资源、记录日志、触发业务。

---

## 二、Channel 生命周期（PPT slide79）

一个 Channel 的状态变迁：

```
┌──────────────────────────────────────────────────────────┐
│                Channel 生命周期状态机                      │
├──────────────────────────────────────────────────────────┤
│                                                          │
│   ┌────────────┐  注册到EventLoop  ┌────────────┐        │
│   │ unregistered│ ──────────────► │ registered │        │
│   │  (未注册)   │                  │  (已注册)   │        │
│   └────────────┘                  └─────┬──────┘        │
│       ▲                                  │ 连接变为活跃    │
│       │                                  ▼                │
│   ┌───┴────────┐                  ┌────────────┐        │
│   │ unregistered│ ◄────────────── │  active    │        │
│   │  (注销)     │  从EventLoop注销 │  (活跃)     │        │
│   └────────────┘                  └─────┬──────┘        │
│       ▲                                  │ 连接断开        │
│       │                                  ▼                │
│       │                            ┌────────────┐        │
│       └────────────────────────────│ inactive   │        │
│                失活后注销           │  (不活跃)   │        │
│                                    └────────────┘        │
└──────────────────────────────────────────────────────────┘
```

### Channel 生命周期回调方法

| 状态变迁 | 回调方法 | 含义 |
|---------|---------|------|
| → registered | `channelRegistered()` | Channel 注册到 EventLoop |
| registered → active | `channelActive()` | Channel 变为活跃（连接已建立） |
| active → inactive | `channelInactive()` | Channel 变为不活跃（连接断开） |
| → unregistered | `channelUnregistered()` | Channel 从 EventLoop 注销 |

**完整顺序**：
```
channelRegistered → channelActive → [业务事件] → channelInactive → channelUnregistered
```

---

## 三、ChannelHandler 生命周期（PPT slide80）

ChannelHandler 自身也有生命周期，由 ChannelPipeline 管理：

| 时机 | 回调方法 | 含义 |
|------|---------|------|
| 被添加到 Pipeline | `handlerAdded()` | Handler 加入处理链 |
| Channel 注册 | `channelRegistered()` | （继承自 Channel 事件） |
| ... | （各种入站事件） | |
| Channel 注销 | `channelUnregistered()` | |
| 被从 Pipeline 移除 | `handlerRemoved()` | Handler 从处理链移除 |

---

## 四、ChannelInboundHandler（PPT slide81）

> *ChannelInboundHandler 是处理入站事件的核心接口。*

它继承了 ChannelHandler，并定义了所有入站事件（包括 Channel 生命周期）的回调方法：

```java
public interface ChannelInboundHandler extends ChannelHandler {
    void channelRegistered(ChannelHandlerContext ctx);     // 注册
    void channelUnregistered(ChannelHandlerContext ctx);   // 注销
    void channelActive(ChannelHandlerContext ctx);         // 活跃
    void channelInactive(ChannelHandlerContext ctx);       // 不活跃
    void channelRead(ChannelHandlerContext ctx, Object msg); // 数据到达
    void channelReadComplete(ChannelHandlerContext ctx);   // 读完成
    void userEventTriggered(ChannelHandlerContext ctx, Object evt); // 用户事件
    void exceptionCaught(ChannelHandlerContext ctx, Throwable cause); // 异常
    void handlerAdded(ChannelHandlerContext ctx);          // Handler 添加
    void handlerRemoved(ChannelHandlerContext ctx);        // Handler 移除
}
```

### 两种实现方式

| 基类 | 特点 | 适用 |
|------|------|------|
| `ChannelInboundHandlerAdapter` | 需手动调用 `fireChannelXxx` 传递事件 | 需要精细控制事件传播 |
| `SimpleChannelInboundHandler<T>` | 自动释放 ByteBuf，自动传递 | 处理特定类型消息（推荐） |

---

## 五、完整生命周期示例

```java
public class LifecycleHandler extends ChannelInboundHandlerAdapter {
    
    // ===== ChannelHandler 自身生命周期 =====
    @Override
    public void handlerAdded(ChannelHandlerContext ctx) {
        System.out.println("Handler 被添加到 Pipeline");
        // 初始化 Handler 级资源（如计数器）
    }
    
    @Override
    public void handlerRemoved(ChannelHandlerContext ctx) {
        System.out.println("Handler 从 Pipeline 移除");
        // 清理 Handler 级资源
    }
    
    // ===== Channel 生命周期 =====
    @Override
    public void channelRegistered(ChannelHandlerContext ctx) {
        System.out.println("Channel 注册到 EventLoop");
        ctx.fireChannelRegistered();  // 传给下一个 Handler
    }
    
    @Override
    public void channelActive(ChannelHandlerContext ctx) {
        System.out.println("连接建立（活跃），初始化连接级资源");
        // 如：分配连接缓冲区、记录连接日志
        ctx.fireChannelActive();
    }
    
    @Override
    public void channelRead(ChannelHandlerContext ctx, Object msg) {
        // 业务核心：处理数据
        ByteBuf buf = (ByteBuf) msg;
        try {
            System.out.println("收到数据：" + buf.toString(UTF_8));
        } finally {
            ReferenceCountUtil.release(msg);  // 释放 ByteBuf
        }
    }
    
    @Override
    public void channelInactive(ChannelHandlerContext ctx) {
        System.out.println("连接断开（不活跃），清理连接级资源");
        // 如：归还缓冲区、通知业务层连接断开
        ctx.fireChannelInactive();
    }
    
    @Override
    public void channelUnregistered(ChannelHandlerContext ctx) {
        System.out.println("Channel 从 EventLoop 注销");
        ctx.fireChannelUnregistered();
    }
    
    @Override
    public void exceptionCaught(ChannelHandlerContext ctx, Throwable cause) {
        cause.printStackTrace();
        ctx.close();  // 发生异常时关闭连接
    }
}
```

### 执行时序（一个完整连接的生命）

```
1. handlerAdded          ← Handler 加入 Pipeline
2. channelRegistered     ← Channel 注册到 EventLoop
3. channelActive         ← 连接建立（可开始通信）
4. channelRead (多次)    ← 收发数据
5. channelReadComplete
6. channelInactive       ← 连接断开
7. channelUnregistered   ← 从 EventLoop 注销
8. handlerRemoved        ← Handler 移除
```

---

## 六、实战应用场景

| 回调 | 典型用途 |
|------|---------|
| `handlerAdded` | 初始化 Handler 级状态（如计数器、定时器） |
| `channelActive` | 连接建立时：发送握手、记录在线、启动心跳 |
| `channelRead` | 处理业务数据（核心逻辑） |
| `channelInactive` | 连接断开时：清理资源、通知业务、记录离线 |
| `exceptionCaught` | 异常处理：关闭连接、记录错误、降级 |
| `handlerRemoved` | 清理 Handler 级资源 |

### 经典应用：IdleStateHandler（空闲检测）

```java
// 在 channelActive 时启用空闲检测，channelInactive 时自动清理
pipeline.addLast(new IdleStateHandler(60, 30, 0));  // 60秒读空闲/30秒写空闲
pipeline.addLast(new HeartbeatHandler());  // 处理空闲事件，发心跳
```

> **面试记忆口诀**：**"Channel 四态：注册→活跃→失活→注销；Handler 两端：添加→移除"**。ChannelInboundHandler 把这些回调集中定义，你只需在关心的节点 override 对应方法。
