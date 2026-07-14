---
id: note-xhs-java-010
difficulty: L2
category: java
subcategory: 并发
tags:
- 拼多多
- Java服务端
- 死锁
- jstack
- CPU飙高
- 死循环排查
- 面经
feynman:
  essence: "死锁是两个或多个线程互相持有对方需要的锁导致永久阻塞；CPU飙高通常是死循环或频繁GC，用top -Hp定位线程再jstack看堆栈"
  analogy: "死锁就像两个人过独木桥：A拿了桥这端的通行证，B拿了桥那端的通行证，A要B的通行证才肯让路，B要A的通行证才肯让路——谁也不让，永远僵持"
  key_points:
  - 死锁四条件：互斥、持有等待、不可剥夺、循环等待
  - jstack可直接检测死锁：自动打印"Found one Java-level deadlock"
  - CPU飙高排查：top找进程 → top -Hp找线程 → printf线程ID转16进制 → jstack过滤
  - 死循环 vs 死锁：死锁是BLOCKED状态CPU低，死循环是RUNNABLE状态CPU高
  - 面试要求手写死锁代码并说出排查命令
first_principle:
  essence: "死锁的本质是'资源竞争中的循环依赖'。打破任一条件即可预防"
  derivation: "多线程需共享资源→需要锁→锁是互斥的→线程持有锁A同时请求锁B→另一线程持有B请求A→循环等待→永久阻塞→必须打破四条件之一"
  conclusion: "预防死锁：固定锁顺序(打破循环等待)、锁超时(打破不可剥夺)、死锁检测+回滚"
follow_up:
- 如何用代码层面预防死锁？（锁排序、tryLock超时）
- 数据库的死锁和Java死锁有什么区别？数据库如何自动检测？
- 分布式锁会不会死锁？如何解决？
- jstack除了排查死锁还能排查什么问题？（线程阻塞、锁竞争、CPU飙高）
- 如果jstack显示线程在BLOCKED状态，但jstack没检测到死锁，可能是什么原因？
memory_points:
- 死锁四条件：互斥+持有等待+不可剥夺+循环等待
- jstack自动检测死锁，CPU飙高用top -Hp + jstack组合排查
- 死锁=BLOCKED(CPU低)，死循环=RUNNABLE(CPU高)
- 十六进制nid是排查关键：printf "%x\n" tid
---

# 【拼多多 Java服务端】手写死锁代码，如何排查？CPU飙高怎么排查？

> 来源：拼多多211本硕Java服务端面经（已OC）（小红书）

## 一、手写死锁代码

```java
public class DeadLockDemo {
    private static final Object lockA = new Object();
    private static final Object lockB = new Object();

    public static void main(String[] args) {
        // 线程1：先锁A，再锁B
        new Thread(() -> {
            synchronized (lockA) {
                System.out.println("Thread-1 持有 lockA，等待 lockB");
                try { Thread.sleep(100); } catch (InterruptedException e) {}
                synchronized (lockB) {
                    System.out.println("Thread-1 持有 lockA + lockB");
                }
            }
        }, "Thread-1").start();

        // 线程2：先锁B，再锁A（相反顺序 → 死锁）
        new Thread(() -> {
            synchronized (lockB) {
                System.out.println("Thread-2 持有 lockB，等待 lockA");
                try { Thread.sleep(100); } catch (InterruptedException e) {}
                synchronized (lockA) {
                    System.out.println("Thread-2 持有 lockB + lockA");
                }
            }
        }, "Thread-2").start();
    }
}
```

```
┌──────────────────────────────────────────────────┐
│              死锁形成过程                          │
│                                                   │
│  Thread-1              Thread-2                   │
│  ┌─────────┐          ┌─────────┐                │
│  │持锁A    │          │持锁B    │                │
│  │等锁B ✗  │◄────────►│等锁A ✗  │                │
│  └─────────┘          └─────────┘                │
│                                                   │
│  互持对方需要的锁 → 循环等待 → 永久阻塞           │
│                                                   │
│  四条件:                                          │
│  ① 互斥: lockA/lockB一次只能一个线程持有          │
│  ② 持有等待: 持有A的同时请求B                     │
│  ③ 不可剥夺: 锁不能被强制夺走                     │
│  ④ 循环等待: T1等T2的B，T2等T1的A                 │
└──────────────────────────────────────────────────┘
```

## 二、死锁排查：jstack

```bash
# Step 1: 找到Java进程PID
jps -l
# 输出: 12345 DeadLockDemo

# Step 2: jstack一键检测死锁
jstack 12345
```

**jstack输出关键信息**：
```
Found one Java-level deadlock:
=============================
"Thread-1":
  waiting to lock monitor 0x00007f8b0c0062b8 (object 0x000000076b6a0a90, a java.lang.Object),
  which is held by "Thread-2"
"Thread-2":
  waiting to lock monitor 0x00007f8b0c003ed8 (object 0x000000076b6a0a80, a java.lang.Object),
  which is held by "Thread-1"

Java stack information for the threads listed above:
===================================================
"Thread-1":
    at DeadLockDemo.lambda$main$0(DeadLockDemo.java:12)
    - waiting to lock <0x000000076b6a0a90> (a java.lang.Object)   ← 等待lockB
    - locked <0x000000076b6a0a80> (a java.lang.Object)            ← 已持有lockA
"Thread-2":
    at DeadLockDemo.lambda$main$1(DeadLockDemo.java:22)
    - waiting to lock <0x000000076b6a0a80> (a java.lang.Object)   ← 等待lockA
    - locked <0x000000076b6a0a90> (a java.lang.Object)            ← 已持有lockB

Found 1 deadlock.   ← jstack自动检测到死锁!
```

## 三、CPU飙高排查：top -Hp + jstack

```
┌──────────────────────────────────────────────────────┐
│            CPU飙高排查四步法                            │
│                                                       │
│  Step 1: top 找Java进程                               │
│  ┌──────────────────────────────────┐                │
│  │ $ top                             │                │
│  │   PID  USER   %CPU  COMMAND       │                │
│  │  12345 app    300%  java          │ ← CPU 300%!   │
│  └──────────────────────────────────┘                │
│                     │                                 │
│  Step 2: top -Hp 找高CPU线程                          │
│  ┌──────────────────────────────────┐                │
│  │ $ top -Hp 12345                   │                │
│  │   PID  %CPU  COMMAND              │                │
│  │  12350  98%   java                │ ← nid=12350   │
│  └──────────────────────────────────┘                │
│                     │                                 │
│  Step 3: 线程ID转十六进制                              │
│  ┌──────────────────────────────────┐                │
│  │ $ printf "%x\n" 12350             │                │
│  │ 304e                              │ ← nid=0x304e  │
│  └──────────────────────────────────┘                │
│                     │                                 │
│  Step 4: jstack过滤对应线程                           │
│  ┌──────────────────────────────────┐                │
│  │ $ jstack 12345 | grep -A 30 304e │                │
│  │ "http-nio-8080-exec-3" nid=0x304e│                │
│  │   java.lang.Thread.State:RUNNABLE│                │
│  │   at xxx.while(true){...}         │ ← 找到死循环! │
│  └──────────────────────────────────┘                │
└──────────────────────────────────────────────────────┘
```

### CPU飙高常见原因

| 原因 | 线程状态 | 排查命令 | 特征 |
|------|---------|---------|------|
| 死循环 | RUNNABLE | top -Hp + jstack | 单线程CPU接近100% |
| 频繁GC | RUNNABLE | jstat -gc + jstack | 多线程都在GC线程 |
| 正则回溯 | RUNNABLE | jstack看堆栈 | Pattern.matcher卡住 |
| 序列化大对象 | RUNNABLE | jstack看堆栈 | JSON/XML解析 |
| 死锁 | BLOCKED | jstack直接检测 | CPU反而不高 |

## 四、死锁预防最佳实践

```java
// 方案1: 固定锁顺序（打破循环等待）
private static final Object lockA = new Object();
private static final Object lockB = new Object();

// 所有线程都按 lockA → lockB 顺序加锁
public void safeMethod() {
    synchronized (lockA) {   // 永远先锁A
        synchronized (lockB) { // 再锁B
            // 业务逻辑
        }
    }
}

// 方案2: tryLock超时（打破不可剥夺）
private static final ReentrantLock lockA = new ReentrantLock();
private static final ReentrantLock lockB = new ReentrantLock();

public void safeMethodWithTimeout() {
    try {
        if (lockA.tryLock(1, TimeUnit.SECONDS)) {
            try {
                if (lockB.tryLock(1, TimeUnit.SECONDS)) {
                    try {
                        // 业务逻辑
                    } finally { lockB.unlock(); }
                }
            } finally { lockA.unlock(); }
        }
    } catch (InterruptedException e) {
        Thread.currentThread().interrupt();
    }
}
```

## 五、面试加分点

1. **jcmd替代jstack**：JDK11+推荐使用 `jcmd <pid> Thread.print` 替代jstack，功能更强大
2. **Arthas一键排查**：阿里开源工具Arthas的 `thread -b` 命令直接定位阻塞其他线程的"罪魁祸首"线程
3. **JVM参数自动Dump**：`-XX:+HeapDumpOnOutOfMemoryError` 在OOM时自动生成堆转储，配合jstack做线程分析
4. **死锁检测API**：`ManagementFactory.getThreadMXBean().findDeadlockedThreads()` 可在代码中编程式检测死锁
5. **线上CPU飙高排查**：如果无法用top（容器环境），可用 `jstat -gc <pid> 1000` 查看GC频率判断是否频繁GC导致
