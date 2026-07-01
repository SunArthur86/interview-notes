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

