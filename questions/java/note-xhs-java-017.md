---
id: note-xhs-java-017
difficulty: L2
category: java
subcategory: 并发
tags:
- 线程
- Thread
- 生命周期
- 状态流转
- 并发
source: 拼多多Java三轮技术面一面
feynman:
  essence: Java线程有6种状态（NEW、RUNNABLE、BLOCKED、WAITING、TIMED_WAITING、TERMINATED），状态间的流转由JVM调度器和同步机制驱动。
  analogy: 线程就像餐厅里的服务员——刚入职还没开始工作是NEW，正在服务客人是RUNNABLE，等厨师出菜被卡住是BLOCKED，休息室等叫号是WAITING，定了闹钟休息是TIMED_WAITING，下班走人是TERMINATED。
  key_points:
  - 6种状态定义在Thread.State枚举中
  - BLOCKED只发生在竞争synchronized锁时
  - WAITING需要被其他线程notify/notifyAll唤醒
  - TIMED_WAITING到时间自动唤醒
  - 调用start()从NEW→RUNNABLE，只能调一次
first_principle:
  problem: 操作系统线程有就绪/运行/阻塞三种状态，为什么Java要定义6种？
  axioms:
  - 操作系统层面线程状态是底层真相
  - Java作为高层抽象需要区分不同的等待原因
  - BLOCKED（锁竞争）和WAITING（主动等待）的唤醒机制完全不同
  - 区分原因有助于调试和监控
  rebuild: 从OS三态出发，Java额外区分了"为什么等待"——等锁是BLOCKED，等通知是WAITING，等超时是TIMED_WAITING。这使得监控工具能精准定位线程卡住的原因。
follow_up:
  - BLOCKED和WAITING的本质区别是什么？能举例说明吗？
  - 一个线程调用了sleep(1000)后，另一个线程能获取它持有的synchronized锁吗？
  - 为什么start()方法不能调用两次？底层是怎么实现的？
  - 线程在RUNNABLE状态时一定在消耗CPU吗？
  - 如何用jstack诊断线程长时间处于BLOCKED状态的问题？
memory_points:
  - 六状态口诀：新建运行阻塞等，超时等待终了停
  - start()只能调一次——thread对象内部维护status标志
  - BLOCKED只认synchronized——Lock.lock()对应的是WAITING
  - sleep不释放锁，wait释放锁
---

# 【拼多多一面】Java 线程生命周期及状态流转

## 🎯 一句话本质

Java线程有 **6种状态**，定义在 `Thread.State` 枚举中，状态流转由JVM线程调度器和同步机制共同驱动。理解状态流转是排查死锁、线程泄漏、性能瓶颈的基础。

## 🧒 费曼类比

想象一个餐厅服务员的工作流程：

```
入职报到 ──→ 站位待命 ──→ 服务客人 ──→ 等厨房出菜 ──→ 休息等叫号 ──→ 定闹钟小憩 ──→ 下班
  NEW        RUNNABLE       RUNNABLE      BLOCKED        WAITING      TIMED_WAITING    TERMINATED
              (就绪/运行)    (运行中)      (等锁)         (wait)       (sleep/wait(ms))
```

关键区别：
- **BLOCKED**：服务员在厨房门口排队等出菜（竞争 `synchronized` 锁）
- **WAITING**：服务员在休息室等经理叫号（调了 `wait()`/`join()`/`LockSupport.park()`）
- **TIMED_WAITING**：服务员定了个10分钟闹钟在休息（`sleep(ms)` / `wait(ms)` / `join(ms)`）

## 📊 六状态流转图

```
                          start()
    ┌─────────┐ ──────────────────→ ┌──────────────────────────────────────┐
    │   NEW   │                      │             RUNNABLE                  │
    └─────────┘                      │  (Ready ←→ Running by OS scheduler)   │
                                     └──────┬──────────┬──────────┬─────────┘
                                            │          │          │
                              wait()        │  sleep() │  join()  │ run()结束
                         ┌─────────────────┘  wait(ms) │  join(ms)│
                         ▼                            ▼          ▼
                   ┌──────────┐              ┌──────────────┐  ┌───────────┐
                   │ WAITING  │              │ TIMED_WAITING│  │TERMINATED │
                   └────┬─────┘              └──────┬───────┘  └───────────┘
                        │ notify()/                 │ 超时自动
                        │ notifyAll()               │ 唤醒
                        └──────────┬────────────────┘
                                   │
                     竞争synchronized锁失败
                                   ▼
                              ┌──────────┐
                              │ BLOCKED  │ ──── 获取锁成功 ────→ RUNNABLE
                              └──────────┘
```

## 🔧 六种状态详解

### 1. NEW（新建）

线程对象已创建但 `start()` 尚未调用。

```java
Thread t = new Thread(() -> System.out.println("hello"));
// 此时 t.getState() == NEW
```

### 2. RUNNABLE（可运行）

调用了 `start()` 后进入。**注意：Java层面把"就绪"和"运行"合并为RUNNABLE**——实际是否在CPU上执行由操作系统调度决定。

```java
Thread t = new Thread(() -> {
    while (true) {} // 死循环，状态始终是RUNNABLE
});
t.start();
System.out.println(t.getState()); // RUNNABLE
```

### 3. BLOCKED（阻塞）

**仅当**等待获取 `synchronized` 监视器锁时进入此状态。

```java
Object lock = new Object();
Thread t1 = new Thread(() -> { synchronized(lock) { sleep(10s); } });
Thread t2 = new Thread(() -> { synchronized(lock) { } });
t1.start(); Thread.sleep(100); t2.start();
// t2.getState() == BLOCKED （等t1释放lock）
```

> ⚠️ `ReentrantLock.lock()` 导致的等待是 **WAITING**，不是BLOCKED！这是高频考点。

### 4. WAITING（无限期等待）

需要被其他线程显式唤醒：

| 方法 | 唤醒方式 |
|------|---------|
| `Object.wait()` | `notify()` / `notifyAll()` |
| `Thread.join()` | 目标线程执行完毕 |
| `LockSupport.park()` | `LockSupport.unpark()` |
| `Lock.lock()`（无超时） | 锁被释放 |

### 5. TIMED_WAITING（限期等待）

到时间后自动唤醒：

| 方法 | 自动唤醒条件 |
|------|-------------|
| `Thread.sleep(ms)` | ms毫秒后 |
| `Object.wait(ms)` | ms毫秒后或被notify |
| `Thread.join(ms)` | ms毫秒后或目标线程结束 |
| `Lock.tryLock(time, unit)` | 超时或获取到锁 |

### 6. TERMINATED（终止）

`run()` 方法执行完毕或异常退出后进入，不可恢复。

## 💻 代码验证所有状态

```java
public class ThreadStateDemo {
    public static void main(String[] args) throws Exception {
        // === NEW ===
        Thread t = new Thread(() -> {});
        System.out.println("1. " + t.getState()); // NEW

        // === RUNNABLE ===
        t.start();
        Thread.sleep(10);
        System.out.println("2. " + t.getState()); // 可能TERMINATED（太快了）

        // === BLOCKED ===
        Object lock = new Object();
        Thread holder = new Thread(() -> {
            synchronized (lock) {
                try { Thread.sleep(3000); } catch (Exception e) {}
            }
        });
        Thread waiter = new Thread(() -> {
            synchronized (lock) {}
        });
        holder.start();
        Thread.sleep(100);
        waiter.start();
        Thread.sleep(100);
        System.out.println("3. " + waiter.getState()); // BLOCKED

        // === WAITING ===
        Thread t3 = new Thread(() -> {
            synchronized (lock) {
                try { lock.wait(); } catch (Exception e) {}
            }
        });
        t3.start();
        Thread.sleep(100);
        System.out.println("4. " + t3.getState()); // WAITING

        // === TIMED_WAITING ===
        Thread t4 = new Thread(() -> {
            try { Thread.sleep(5000); } catch (Exception e) {}
        });
        t4.start();
        Thread.sleep(100);
        System.out.println("5. " + t4.getState()); // TIMED_WAITING
    }
}
```

## 📋 面试加分点

1. **区分Java层面和OS层面**：Java RUNNABLE = OS的 Ready + Running
2. **BLOCKED只认synchronized**：ReentrantLock竞争时是WAITING（通过LockSupport.park）
3. **sleep vs wait**：sleep不释放锁、是Thread静态方法；wait释放锁、是Object方法
4. **start()只能调一次**：源码中检查`threadStatus`，非0抛`IllegalThreadStateException`
5. **线程诊断**：`jstack <pid>` 查看所有线程状态，定位死锁/阻塞

## ❓ 苏格拉底式面试追问

1. **"你说BLOCKED是等synchronized锁，那ReentrantLock竞争时是什么状态？为什么不一样？"**
   → 引导候选人理解AQS底层用LockSupport.park()实现等待，对应WAITING状态

2. **"如果线程在WAITING状态，CPU会调度它吗？它占内存吗？"**
   → 测试对线程栈、上下文切换开销的理解

3. **"一个线程先sleep(1000)再wait()，它的状态流转是什么？每次状态变化时锁的持有情况如何？"**
   → 测试sleep不释放锁、wait释放锁的深层理解

4. **"如何在线上快速定位哪些线程长时间处于BLOCKED状态？有什么工具和命令？"**
   → jstack + grep BLOCKED，Arthas thread命令

5. **"yield()方法调用后线程状态怎么变？它一定会让出CPU吗？"**
   → 提示Runnable状态内部变化，yield只是建议调度器


## 结构化回答

**30 秒电梯演讲：** Java线程有6种状态（NEW、RUNNABLE、BLOCKED、WAITING、TIMED_WAITING、TERMINATED），状态间的流转由JVM调度器和同步机制驱动。

**展开框架：**
1. **六状态口诀** — 新建运行阻塞等，超时等待终了停
2. **start()只能调一次** — —thread对象内部维护status标志
3. **BLOCKED只认** — BLOCKED只认synchronized——Lock.lock()对应的是WAITING

**收尾：** 这块我踩过坑——要不要深入聊：BLOCKED和WAITING的本质区别是什么？能举例说明吗？

## 视频脚本

> 预计时长：2 分钟 | 由浅入深

| 时间 | 画面/字幕 | 口播台词 | 讲解要点 |
|------|----------|----------|----------|
| 0:00 | 标题卡 | "并发一句话：Java线程有6种状态（NEW、RUNNABLE、BLOCKED、WAITING、TIMED_WAITING、TERMINATED）…。" | 开场钩子 |
| 0:15 | 加锁/解锁时序图 | "六状态口诀：新建运行阻塞等，超时等待终了停" | 六状态口诀 |
| 1:02 | 加锁/解锁时序图分步演示 | "start()只能调一次——thread对象内部维护status标志" | start()只能调一次 |
| 1:50 | 总结卡 | "核心抓住这条主线，下期咱们接着聊：BLOCKED和WAITING的本质区别是什么？能举例说明吗。" | 收尾 |
