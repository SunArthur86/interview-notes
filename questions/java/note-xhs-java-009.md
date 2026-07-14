---
id: note-xhs-java-009
difficulty: L3
category: java
subcategory: 并发
tags:
- 拼多多
- Java服务端
- synchronized
- 锁升级
- 偏向锁
- 轻量级锁
- 重量级锁
- 对象头
- 面经
feynman:
  essence: "synchronized锁升级是JVM自适应性优化——从无锁到偏向锁到轻量级锁到重量级锁，根据竞争程度逐步升级，不可降级（JDK15前可批量撤销偏向）"
  analogy: "就像公共厕所的门锁进化：一开始不锁门（无锁），后来装个弹簧锁谁推谁进（偏向锁），再后来加个旋钮锁有人等就排队自旋（轻量级锁），最后升级成密码锁由管理员调度（重量级锁）"
  key_points:
  - 对象头Mark Word存储锁状态（32位/64位）
  - 无锁→偏向锁：首次有线程进入
  - 偏向锁→轻量级锁：出现第二个线程竞争
  - 轻量级锁→重量级锁：自旋超过阈值或有多线程等待
  - JDK15后偏向锁默认关闭（JEP 374），因维护成本高于收益
first_principle:
  essence: "锁的本质是'保证多线程对共享资源的互斥访问'。锁升级的原理是'按需付费'——竞争越激烈才用越重的锁"
  derivation: "大多数场景锁竞争很少→全局重量级锁浪费→引入偏向锁（只记线程ID，CAS都不用）→有时有竞争→轻量级锁（CAS自旋）→竞争激烈→重量级锁（OS互斥量，线程阻塞）"
  conclusion: "锁升级是性能与正确性的平衡——轻量级方案减少上下文切换，重量级方案保证强互斥"
follow_up:
- "JDK15为什么默认禁用偏向锁？（Hint: 维护成本、CAS指令开销增加）"
- 偏向锁撤销为什么需要全局安全点（Safepoint）？
- 轻量级锁的自旋次数如何确定？自适应自旋是什么？
- synchronized和ReentrantLock在锁实现上有什么本质区别？
- 对象头中Mark Word的详细布局你了解吗？
memory_points:
- Mark Word存储锁状态标志位：01(无锁/偏向) 00(轻量级) 10(重量级)
- 偏向锁→记录线程ID到Mark Word，不加锁不CAS
- 轻量级锁→CAS替换Mark Word为指向Lock Record的指针
- 重量级锁→Mark Word指向Monitor对象(ObjectMonitor)
---

# 【拼多多 Java服务端】synchronized锁升级过程，每个状态的标志位在对象头哪里？

> 来源：拼多多211本硕Java服务端面经（已OC）（小红书）

## 一、对象头 Mark Word 结构（64位JVM）

```
┌──────────────────────────────────────────────────────────────┐
│              64位 Mark Word 布局                               │
│                                                               │
│  ┌─────────┬───────────────────────┬───────────────────────┐  │
│  |  无锁    | hashcode(31) age(4) 0│ unused(1) 01 (未偏向)  │  │
│  ├─────────┼───────────────────────┼───────────────────────┤  │
│  |  偏向锁  | threadID(54) epoch(2)│ age(4) 1 01 (已偏向)   │  │
│  ├─────────┼───────────────────────┼───────────────────────┤  │
│  | 轻量级锁 | ptr_to_lock_record(62)│ 00                     │  │
│  ├─────────┼───────────────────────┼───────────────────────┤  │
│  | 重量级锁 | ptr_to_heavy_monitor(62)│ 10                    │  │
│  ├─────────┼───────────────────────┼───────────────────────┤  │
│  |  GC标记 |                       │ 11                     │  │
│  └─────────┴───────────────────────┴───────────────────────┘  │
│                                                               │
│  关键标志位: 最后3位 (2位锁标志 + 1位偏向标志)                  │
│  001 = 无锁(未偏向) / 101 = 偏向锁                             │
│  000 = 轻量级锁    / 010 = 重量级锁    / 011 = GC标记          │
└──────────────────────────────────────────────────────────────┘
```

## 二、锁升级全流程

```
          ┌──────────┐
          │   无锁    │  Mark Word: hashcode + age + 001
          │ (初始状态) │  没有任何线程访问同步块
          └─────┬─────┘
                │ 线程A第一次进入同步块
                │ CAS将线程ID写入Mark Word
                ▼
          ┌──────────┐
          │  偏向锁   │  Mark Word: threadID + epoch + 101
          │ (Biased)  │  只有一个线程访问，零开销(连CAS都不需要)
          └─────┬─────┘
                │ 线程B尝试进入，发现threadID≠自己
                │ 暂停在安全点，撤销偏向锁
                ▼
          ┌──────────┐
          │ 轻量级锁  │  Mark Word: ptr_to_lock_record + 000
          │ (Thin)    │  CAS竞争Lock Record，失败则自旋等待
          └─────┬─────┘
                │ 自旋超过阈值(~10次) 或 有第三个线程等待
                │ 锁膨胀（Inflation）
                ▼
          ┌──────────┐
          │ 重量级锁  │  Mark Word: ptr_to_monitor + 010
          │ (Inflated)│  依赖OS Mutex，未获锁线程进入BLOCKED状态
          └──────────┘
```

## 三、各阶段详解

### 3.1 偏向锁（Biased Locking）

```java
// 偏向锁获取流程
synchronized(obj) {
    // 1. 检查Mark Word是否为当前线程的偏向锁
    //    threadID == 当前线程ID → 直接进入（零开销）
    //    threadID == 空 → CAS设置threadID → 进入
    
    // 2. 如果threadID != 当前线程 → 偏向撤销
    //    等待全局安全点(Safepoint)
    //    检查原持有线程是否在同步块中
    //      不在 → 撤销偏向，设为无锁 → 重新竞争
    //      在   → 升级为轻量级锁
}
```

**JDK15+ 变化**：偏向锁默认关闭（JEP 374）。原因：
- 维护成本高（需要Safepoint撤销）
- 现代应用竞争场景增多，偏向锁收益下降
- CAS指令在现代CPU上已经很廉价

### 3.2 轻量级锁（Thin Lock）

```
┌────────────────────────────────────────────────────┐
│  轻量级锁加锁过程                                    │
│                                                     │
│  线程栈帧              对象头                        │
│  ┌──────────┐        ┌──────────┐                  │
│  │Lock Record│←──CAS──│ Mark Word │                 │
│  │  ┌───────┤  替换   │ (指向LR)  │                 │
│  │  │displaced│       └──────────┘                  │
│  │  │ Mark   │──保存─→ 原Mark Word                  │
│  │  │ Word   │        (hashcode+age)               │
│  │  └───────┤                                       │
│  └──────────┘                                       │
│                                                     │
│  CAS成功 → 获得锁                                   │
│  CAS失败 → 自旋等待(自适应自旋)                      │
│           自旋超过阈值 → 升级重量级锁                │
└────────────────────────────────────────────────────┘
```

### 3.3 重量级锁（Heavyweight Lock）

```
┌────────────────────────────────────────────────────┐
│  ObjectMonitor 结构 (HotSpot源码)                   │
│                                                     │
│  ┌─────────────────────────────────────┐           │
│  │  ObjectMonitor                       │           │
│  │    ├── _owner    → 持有锁的线程       │           │
│  │    ├── _EntryList → 阻塞等待队列      │           │
│  │    ├── _WaitSet   → wait()等待集合    │           │
│  │    ├── _count    → 重入计数          │           │
│  │    └── _recursions → 递归次数        │           │
│  └─────────────────────────────────────┘           │
│                                                     │
│  加锁: pthread_mutex_lock (Linux)                  │
│  线程状态: RUNNABLE → BLOCKED                       │
│  代价: 内核态切换 ~1-3μs                            │
└────────────────────────────────────────────────────┘
```

## 四、验证代码：观察锁状态

```java
import org.openjdk.jol.info.ClassLayout;

public class LockUpgradeDemo {
    static final Object lock = new Object();

    public static void main(String[] args) throws InterruptedException {
        // 打印对象头（无锁状态）
        System.out.println("=== 无锁 ===");
        System.out.println(ClassLayout.parseInstance(lock).toPrintable());

        // 偏向锁（JDK15前）
        synchronized (lock) {
            System.out.println("=== 偏向锁 ===");
            System.out.println(ClassLayout.parseInstance(lock).toPrintable());
        }

        // 轻量级锁（多线程竞争但不激烈）
        Thread t = new Thread(() -> {
            synchronized (lock) {
                System.out.println("=== 轻量级锁 ===");
                System.out.println(ClassLayout.parseInstance(lock).toPrintable());
            }
        });
        t.start();
        t.join();
    }
}
// JVM参数: -XX:+UseBiasedLocking -XX:BiasedLockingStartupDelayMillis=0
```

## 五、面试加分点

1. **锁升级不可逆**：一旦升级到重量级锁就不会降级（JVM没有实现降级逻辑），除非GC回收对象
2. **自适应自旋**：JVM根据历史成功率动态调整自旋次数——上次自旋成功就多旋几次，失败就少旋或不旋
3. **批量重偏向（Bulk Rebias）**：同一类的对象撤销偏向超过阈值（默认20次）后，JVM批量重偏向到新线程
4. **批量撤销（Bulk Revoke）**：撤销超过40次后，该类所有对象禁用偏向锁
5. **synchronized vs ReentrantLock**：synchronized是JVM层面（monitorenter/monitorexit），ReentrantLock是API层面（AQS + CAS）
