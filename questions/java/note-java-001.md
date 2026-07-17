---
id: note-java-001
difficulty: L3
category: java
subcategory: 并发
tags:
- synchronized
- 锁
- 并发
feynman:
  essence: synchronized 是 JVM 内置的自动锁（简单但不够灵活），ReentrantLock 是 API 层的手动锁（灵活但需要小心释放）。
  analogy: synchronized 像自动门（进去自动关门出来自动开门），ReentrantLock 像手动门（自己锁自己开，忘开了就死锁）。
  key_points:
  - synchronized=JVM内置+自动释放
  - ReentrantLock=API层+手动释放
  - ReentrantLock支持公平/中断/超时/多Condition
  - JDK6+性能差距很小
first_principle: null
follow_up:
- 偏向锁什么时候升级为轻量级锁？
- AQS 的原理是什么？
memory_points:
- 层级与释放：synchronized是JVM关键字且自动释放锁，而ReentrantLock是API层需手动unlock
- 核心机制：synchronized基于Object Monitor，而ReentrantLock基于AQS队列
- 灵活性：synchronized仅支持非公平且不可中断，而ReentrantLock支持公平/超时/多Condition
- 选型口诀：因为底层优化差距极小，所以简单加锁用synchronized，高级特性选ReentrantLock
---

# synchronized 和 ReentrantLock 的区别？

## 一、核心定位

| 维度 | `synchronized` | `ReentrantLock` |
|------|---------------|-----------------|
| 层级 | JVM 内置关键字 | JDK API（`java.util.concurrent.locks`） |
| 底层实现 | `monitorenter` / `monitorexit` 字节码指令，基于 Object Monitor | 基于 **AQS**（AbstractQueuedSynchronizer） |
| 释放方式 | **自动释放**（代码块结束 / 异常抛出） | **手动释放**，必须放在 `finally` 中 |
| 灵活性 | 低（加锁/解锁固定） | 高（公平/中断/超时/多条件变量） |
| 可重入 | ✅ 可重入 | ✅ 可重入 |
| 性能（JDK 6+） | 经过锁优化后差距很小 | 略优但差距极小 |

> 一句话总结：**简单场景用 `synchronized`，需要高级功能（公平/超时/多 Condition）时用 `ReentrantLock`。**

---

## 二、七大核心区别详解

### 区别 1：实现机制

**synchronized** 是 JVM 层面的关键字，编译后生成 `monitorenter` 和 `monitorexit` 字节码指令。JVM 通过对象头中的 Mark Word 来管理锁状态。

**ReentrantLock** 是 JDK API 层面的类，内部维护一个 `volatile int state` 和一个 **FIFO 双向等待队列**（CLH 变体），通过 CAS 操作来获取和释放锁。核心代码位于 `AbstractQueuedSynchronizer`。

```
synchronized 锁对象内存布局：
┌─────────────────────────────┐
│  Object Header (Mark Word)   │  ← 锁状态记录在这里
├─────────────────────────────┤
│  Instance Data               │
├─────────────────────────────┤
│  Padding (对齐填充)          │
└─────────────────────────────┘

ReentrantLock 内部结构：
┌──────────────┐     CAS      ┌───────────────────┐
│  state = 0/1 │ ◄──────────► │  CLH 等待队列      │
│  (volatile)  │              │  Node ←→ Node ←→ … │
└──────────────┘              └───────────────────┘
```

### 区别 2：公平性

- **synchronized**：只支持**非公平锁**（不允许插队控制）。
- **ReentrantLock**：构造函数可选 `new ReentrantLock(true)` 公平锁或 `false`（默认）非公平锁。

```java
ReentrantLock fairLock = new ReentrantLock(true);     // 公平锁：严格 FIFO
ReentrantLock unfairLock = new ReentrantLock(false);  // 非公平锁：允许插队（默认）
```

> 公平锁吞吐量更低（线程切换开销大），但能避免线程饥饿。非公平锁性能更好，是默认选择。

### 区别 3：中断响应

- **synchronized**：一旦等待，**不可被中断**。其他线程调用 `interrupt()` 无法唤醒阻塞中的线程。
- **ReentrantLock**：支持 `lockInterruptibly()`，等待锁的过程中可以被中断并抛出 `InterruptedException`。

```java
ReentrantLock lock = new ReentrantLock();
try {
    lock.lockInterruptibly(); // 可被中断的获取锁
    // 临界区
} catch (InterruptedException e) {
    // 被中断时的处理
    Thread.currentThread().interrupt();
} finally {
    if (lock.isHeldByCurrentThread()) {
        lock.unlock();
    }
}
```

### 区别 4：超时获取

- **synchronized**：无法设置超时，拿不到锁就一直阻塞。
- **ReentrantLock**：支持 `tryLock()` 和 `tryLock(timeout, unit)`，避免死锁等待。

```java
if (lock.tryLock(3, TimeUnit.SECONDS)) {
    try {
        // 3秒内拿到锁，执行业务
    } finally {
        lock.unlock();
    }
} else {
    // 3秒内未拿到锁，执行降级逻辑
}
```

### 区别 5：多条件变量（Condition）

- **synchronized**：只有一把锁 + 一个等待队列（`wait()` / `notify()` / `notifyAll()`）。
- **ReentrantLock**：可以创建**多个 Condition**，每个 Condition 有独立的等待队列，实现精细化线程通信。

```java
ReentrantLock lock = new ReentrantLock();
Condition notEmpty = lock.newCondition();  // 非空条件
Condition notFull = lock.newCondition();   // 非满条件

// 生产者-消费者：精确唤醒
public void put(E e) throws InterruptedException {
    lock.lock();
    try {
        while (queue.size() == capacity)
            notFull.await();        // 队列满了，等待"非满"
        queue.add(e);
        notEmpty.signal();          // 通知消费者"非空"
    } finally {
        lock.unlock();
    }
}
```

> 多 Condition 是实现 `ArrayBlockingQueue`、`LinkedBlockingQueue` 等并发容器的底层基础。

### 区别 6：锁释放方式

- **synchronized**：JVM **自动释放**。正常退出或抛出异常时，`monitorexit` 都会被执行。
- **ReentrantLock**：**必须手动 `unlock()`**，且必须放在 `finally` 块中，否则异常时锁不会释放 → **死锁！**

```java
// ❌ 错误写法：异常时锁不会释放
lock.lock();
doSomething(); // 如果这里抛异常，锁永远不释放
lock.unlock();

// ✅ 正确写法
lock.lock();
try {
    doSomething();
} finally {
    lock.unlock(); // 无论是否异常，都会释放
}
```

### 区别 7：性能（JDK 6+ 锁优化）

在 JDK 1.5 及之前，`synchronized` 是重量级锁（直接调用 OS 的 mutex），性能远不如 `ReentrantLock`。**JDK 6 引入了锁升级机制**，性能差距大幅缩小：

```
synchronized 锁升级流程（不可降级）：

无锁 ──→ 偏向锁 ──→ 轻量级锁 ──→ 重量级锁
          │              │              │
     单线程访问     CAS 自旋       OS 级阻塞
     记录线程ID    两个线程竞争    多线程激烈竞争
```

| 锁状态 | 适用场景 | 性能开销 |
|--------|----------|----------|
| 偏向锁 | 同一线程反复进入（~99% 场景） | 极低（一次 CAS） |
| 轻量级锁 | 两个线程交替进入，无真正并发 | 低（CAS 自旋） |
| 重量级锁 | 多线程同时竞争 | 高（OS 级挂起/唤醒） |

> JDK 15 开始，偏向锁默认被废弃（`-XX:+UseBiasedLocking` 默认 false），因为维护成本高于收益。

---

## 三、完整代码对比

### synchronized 版

```java
public class SyncCounter {
    private int count = 0;

    public synchronized void increment() {
        count++;
    }

    public synchronized int getCount() {
        return count;
    }
}
```

### ReentrantLock 版

```java
import java.util.concurrent.locks.ReentrantLock;

public class LockCounter {
    private int count = 0;
    private final ReentrantLock lock = new ReentrantLock();

    public void increment() {
        lock.lock();
        try {
            count++;
        } finally {
            lock.unlock(); // 必须在 finally 中释放
        }
    }

    public int getCount() {
        lock.lock();
        try {
            return count;
        } finally {
            lock.unlock();
        }
    }
}
```

---

## 四、选型决策指南

```
是否需要以下高级功能？
（公平锁 / 超时获取 / 中断响应 / 多 Condition）
        │
    ┌───┴───┐
   YES      NO
    │        │
    ▼        ▼
ReentrantLock   synchronized
    │        │
    │        ▼
    │    JDK 6+ 锁优化已足够？
    │        │
    │      YES → 用 synchronized（更简洁，自动释放）
    │
    ▼
用 ReentrantLock
```

### 最佳实践

1. **优先用 `synchronized`**：代码简洁、不会忘记释放锁、JVM 有充分优化。Josh Bloch 建议："除非确有高级需求，否则始终优先 `synchronized`。"
2. **需要以下功能时才用 `ReentrantLock`**：
   - 公平锁（避免饥饿）
   - 可中断的锁获取
   - 超时获取（`tryLock`）
   - 多条件变量（精细化线程通信）
3. **使用 `ReentrantLock` 时**：
   - `lock()` 后紧跟 `try-finally`，`unlock()` 放在 `finally` 第一行
   - 使用 `isHeldByCurrentThread()` 避免非法释放

---

## 五、面试高频追问

### Q1：偏向锁什么时候升级为轻量级锁？

当**第二个线程**尝试竞争同一个锁时，偏向锁会被撤销（revoke），升级为轻量级锁。此时不再使用 Mark Word 中的线程 ID，而是通过 CAS 操作将 Mark Word 指向栈帧中的锁记录（Lock Record）。如果 CAS 自旋失败（竞争激烈），再升级为重量级锁。

### Q2：AQS 的原理是什么？

AQS（AbstractQueuedSynchronizer）是 `ReentrantLock` 的底层框架。核心要素：

- **`state`（volatile int）**：表示同步状态。独占模式下 0=未锁，≥1=已锁（可重入时累加）。
- **CLH 等待队列**：一个 FIFO 双向链表，存放的是封装了线程引用和等待状态的 `Node`。
- **CAS + 自旋**：获取锁时先 CAS 尝试修改 `state`，失败则封装为 Node 入队，然后 `park()` 挂起。
- **模板方法模式**：AQS 定义了获取/释放的框架，子类（如 `ReentrantLock` 的内部类 `Sync`）只需实现 `tryAcquire()` / `tryRelease()`。

```java
// AQS 简化的非公平锁获取流程
final boolean nonfairTryAcquire(int acquires) {
    final Thread current = Thread.currentThread();
    int c = getState();
    if (c == 0) {                          // 锁未被持有
        if (compareAndSetState(0, acquires)) { // CAS 抢锁
            setExclusiveOwnerThread(current);
            return true;
        }
    } else if (current == getExclusiveOwnerThread()) { // 可重入
        setState(c + acquires);
        return true;
    }
    return false; // 获取失败 → 入队等待
}
```

---

## 六、速记总结

| 特性 | synchronized | ReentrantLock |
|------|:-----------:|:------------:|
| 自动释放 | ✅ | ❌（需手动） |
| 可中断 | ❌ | ✅ |
| 超时获取 | ❌ | ✅ |
| 公平锁 | ❌ | ✅ |
| 多 Condition | ❌（仅 1 个） | ✅（多个） |
| 代码简洁度 | ⭐⭐⭐ | ⭐⭐ |
| 灵活性 | ⭐⭐ | ⭐⭐⭐ |

> **面试一句话**：`synchronized` 是 JVM 内置的自动锁，简单安全；`ReentrantLock` 是基于 AQS 的 API 层手动锁，功能强大但需要小心释放。JDK 6+ 两者性能接近，无高级需求时优先 `synchronized`。

## 记忆要点

- 层级与释放：synchronized是JVM关键字且自动释放锁，而ReentrantLock是API层需手动unlock
- 核心机制：synchronized基于Object Monitor，而ReentrantLock基于AQS队列
- 灵活性：synchronized仅支持非公平且不可中断，而ReentrantLock支持公平/超时/多Condition
- 选型口诀：因为底层优化差距极小，所以简单加锁用synchronized，高级特性选ReentrantLock


## 苏格拉底式面试追问

> 这组追问模拟面试官层层逼问，每一问先回答"为什么"，再回答"怎么做"，最后回答"如何证明"。

### 第一层：目标与动机

**Q：synchronized 和 ReentrantLock 你说"简单用 synchronized、高级特性用 ReentrantLock"，但 ReentrantLock 功能更强，为什么不统一用 ReentrantLock？**

synchronized 在 JDK 6+ 经过了大量优化（偏向锁、轻量级锁、重量级锁升级），性能与 ReentrantLock 在无竞争/低竞争场景几乎无差异，且有三个 ReentrantLock 不具备的优势：一、JVM 原生支持，锁释放由 JVM 保证（异常时自动释放 monitorexit），不会因为开发者忘记 unlock() 导致死锁；二、锁信息在线程栈和对象头里，不占额外内存，ReentrantLock 要创建 AQS 队列和 Node 对象；三、JIT 可对 synchronized 做锁消除（逃逸分析）和锁粗化（合并相邻锁）。ReentrantLock 的优势是"高级特性"——公平锁、可中断（lockInterruptibly）、超时（tryLock）、多 Condition。所以选型逻辑：不需要这些特性时 synchronized 更省心安全（不会忘释放），需要时才上 ReentrantLock。统一用 ReentrantLock 是"为可能用不到的特性付成本"，过度设计。

### 第二层：证据与定位

**Q：线上出现死锁，你怎么快速定位是 synchronized 还是 ReentrantLock 引起的？**

用 `jstack <pid>` 抓线程栈，看死锁相关线程的状态。synchronized 死锁：jstack 会自动检测并输出 "Found one Java-level deadlock"，列出互等的线程和监视器（如 "waiting to lock <0x000000076b6f0238>"）。ReentrantLock 死锁：jstack 不自动检测（因为 ReentrantLock 是 API 层），要手动看线程栈——死锁线程状态是 WAITING (parking)，栈顶是 `LockSupport.park`，持有的是 `AbstractQueuedSynchronizer` 相关栈。区分：看锁对象的类，synchronized 是 Object monitor（`- locked <0x...>`），ReentrantLock 是 ReentrantLock$Sync 或其子类。进一步定位：synchronized 看"等的是哪个对象的 monitor"（地址）、ReentrantLock 看"等的是哪个 ReentrantLock 实例"（结合代码看变量名）。生产建议开启 `ThreadMXBean.findDeadlockedThreads()` 定时检测，发现死锁自动告警 + jstack dump。

### 第三层：根因深挖

**Q：ReentrantLock 基于 AQS，你说 AQS 是"CLH 队列变体"，CLH 队列是什么？AQS 怎么用它实现锁？**

CLH（Craig, Landin, Hagersten）队列是"自旋锁链表"——每个线程在队列里有一个前驱节点的引用，线程自旋检查前驱的 state，前驱释放锁（state 改变）后自己获锁。AQS 改进了 CLH：一、不自旋而是 park（阻塞），避免 CPU 空转——线程入队后调用 `LockSupport.park()` 挂起，前驱释放时调用 `unpark()` 唤醒后继；二、state 用 volatile int 表示锁状态（0 未锁、>0 重入次数），CAS 修改；三、支持独占（ReentrantLock）和共享（Semaphore、CountDownLatch）两种模式。获锁流程：CAS 把 state 从 0 改为 1 成功 → 设当前线程为 owner → 获锁；失败 → 创建 Node 入队 → park 等待。释放流程：state 减 1，归零时 unpark 队列首节点的后继。AQS 是 JUC 锁的"骨架"，ReentrantLock、ReentrantReadWriteLock、Semaphore、CountDownLatch 都基于它。

**Q：那为什么不直接用 CAS 自旋锁（无队列），性能不是更高吗（无 park 开销）？**

CAS 自旋锁在高竞争下是灾难——多个线程同时 CAS，只有一个成功，其他全部空转占 CPU，N 个线程争一把锁会让 CPU 飙到 N×100%。而且自旋期间不释放 CPU，其他有用线程被饿死。AQS 的 park（阻塞）把"等锁的线程"挂起，不占 CPU，让 CPU 给"正在工作的线程"。代价是 park/unpark 有系统调用开销（约微秒级），但远小于自旋浪费的 CPU。AQS 的设计哲学是"短锁自旋 + 长锁阻塞"——tryAcquire 失败时会先自旋一小段（`acquireQueued` 里的自旋检查前驱），如果前驱是 head 就再试一次（快速路径），仍失败才 park。这平衡了"低竞争时快速获锁"和"高竞争时不浪费 CPU"。所以纯自旋锁只适合"锁持有时间极短（纳秒级）+ 低竞争"，AQS 适用范围广得多。

### 第四层：方案权衡

**Q：ReentrantLock 支持公平锁，你说默认是非公平，为什么？什么时候该用公平锁？**

非公平锁性能更好——线程 tryAcquire 时不检查队列，直接 CAS 抢，抢到就插队（即使队列里有等待线程）。这避免了"唤醒队列头线程"的开销（unpark + 线程调度延迟，约微秒级），吞吐量比公平锁高 10-30%。公平锁严格 FIFO——tryAcquire 前先 `hasQueuedPredecessors()` 检查队列有无先到的线程，有则不抢。代价是吞吐降低（每次锁切换都要唤醒队列头，不能让刚释放的线程顺手再抢）。选公平锁的场景：一、避免线程饥饿——非公平锁下某线程可能长期抢不到（被不断插队），公平锁保证每个线程都能获锁；二、响应时间可预测——公平锁的等待时间可估算（FIFO 顺序），非公平锁方差大。生产场景：默认非公平（吞吐优先），只有明确"不能让任何线程饿死"（如交易系统）才用公平锁。我的实践：99% 用非公平，公平锁只用在"对延迟敏感 + 公平性要求高"的场景。

**Q：为什么不直接用 CAS + synchronized 组合（CAS 试抢，失败用 synchronized 阻塞），而要单独搞 AQS？**

CAS + synchronized 组合有几个问题：一、synchronized 是对象监视器，没法表达"共享/独占模式"——Semaphore 的"允许多个许可"用 synchronized 难表达；二、synchronized 的等待集是单一 wait set，不支持"多个 Condition"——ReentrantLock 的 `await(signal)` 配合 Condition 可以分组等待/唤醒，synchronized 只能 notifyAll 全唤醒；三、synchronized 无法做"可中断、超时"——这些都是 API 层特性，synchronized 是 JVM 内置不支持。AQS 提供了统一的"队列 + state + 模式"框架，子类只需实现 tryAcquire/tryRelease 等模板方法，就能组合出各种锁语义。所以 AQS 是"为 JUC 锁家族设计的通用骨架"，比 synchronized 灵活，比纯 CAS 安全（有队列兜底防自旋爆炸）。这是 Doug Lea 的设计杰作。

### 第五层：验证与沉淀

**Q：你怎么验证 synchronized 的锁升级（偏向→轻量→重量）在实际运行中发生？**

JVM 参数 `-XX:+UseBiasedLocking -XX:BiasedLockingStartupDelayMillis=0` 开启偏向锁（JDK 15 后默认禁用偏向锁）。用 `jol`（Java Object Layout）库打印对象头 `ClassLayout.parseInstance(obj).toPrintable()`，看 mark word 的状态位：001（无锁）、101（偏向锁，含线程 ID）、000（轻量级锁，含指向栈帧锁记录的指针）、010（重量级锁，含 monitor 指针）。测试：单线程访问对象 → 101 偏向；另一线程访问触发撤销 → 000 轻量级（CAS 自旋）；高竞争（多线程同时访问）→ 010 重量级（park 等待）。验证 ReentrantLock：用 `jstack` 看等待线程状态（应为 WAITING parking，栈顶是 AQS 相关）。线上监控：锁竞争指标 `sun.rt._sync_lock_attempts` 或通过 JMX 的 `ThreadInfo` 看阻塞线程数。

**Q：这道题做完，你沉淀出了什么可复用的 Java 锁选型经验？**

四维选型法：一、复杂度——简单互斥用 synchronized（JVM 保证不漏释放），需要 Condition/超时/公平/可中断用 ReentrantLock；二、读多写少用 ReentrantReadWriteLock（读读不互斥），更进一步用 StampedLock（乐观读）；三、协调多个线程用 Semaphore（许可）、CountDownLatch（一次性等待）、CyclicBarrier（可重置屏障）；四、单变量原子更新用 AtomicXxx（CAS），多变量原子用 AtomicReference 包装 + CAS。核心原则："按需求选锁，不要无脑 synchronized 也不要无脑 ReentrantLock。" 这套选型法也适用于其他并发场景——读多写少别用独占锁、协调用同步器别用 wait/notify、原子更新用 CAS 别用锁。


## 结构化回答

**30 秒电梯演讲：** synchronized 是 JVM 内置的自动锁（简单但不够灵活），ReentrantLock 是 API 层的手动锁（灵活但需要小心释放）。打个比方，synchronized 像自动门（进去自动关门出来自动开门），ReentrantLock 像手动门（自己锁自己开，忘开了就死锁）。

**展开框架：**
1. **层级与释放** — synchronized是JVM关键字且自动释放锁，而ReentrantLock是API层需手动unlock
2. **核心机制** — synchronized基于Object Monitor，而ReentrantLock基于AQS队列
3. **灵活性** — synchronized仅支持非公平且不可中断，而ReentrantLock支持公平/超时/多Condition

**收尾：** 这块我踩过坑——要不要深入聊：偏向锁什么时候升级为轻量级锁？

## 视频脚本

> 预计时长：3 分钟 | 由浅入深

| 时间 | 画面/字幕 | 口播台词 | 讲解要点 |
|------|----------|----------|----------|
| 0:00 | 标题卡 | "并发一句话：synchronized 是 JVM 内置的自动锁（简单但不够灵活），ReentrantLock…。" | 开场钩子 |
| 0:15 | JVM 内存结构图 | "层级与释放：synchronized是JVM关键字且自动释放锁，而ReentrantLock是API层需手动unlock" | 层级与释放 |
| 1:06 | JVM 内存结构图分步演示 | "核心机制：synchronized基于Object Monitor，而ReentrantLock基于AQS队列" | 核心机制 |
| 1:57 | 关键代码/伪代码片段 | "灵活性：synchronized仅支持非公平且不可中断，而ReentrantLock支持公平/超时/多Condition" | 灵活性 |
| 2:50 | 总结卡 | "核心抓住这条主线，下期咱们接着聊：偏向锁什么时候升级为轻量级锁。" | 收尾 |
