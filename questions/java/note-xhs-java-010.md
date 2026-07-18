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


## 结构化回答

**30 秒电梯演讲：** 死锁是两个或多个线程互相持有对方需要的锁导致永久阻塞；CPU飙高通常是死循环或频繁GC，用top -Hp定位线程再jstack看堆栈。打个比方，死锁就像两个人过独木桥：A拿了桥这端的通行证，B拿了桥那端的通行证，A要B的通行证才肯让路，B要A的通行证才肯让路——谁也不让，永远僵持。

**展开框架：**
1. **死锁四条件** — 互斥+持有等待+不可剥夺+循环等待
2. **jstack自动检测死锁** — jstack自动检测死锁，CPU飙高用top -Hp + jstack组合排查
3. **死锁=BLOCKED** — 死锁=BLOCKED(CPU低)，死循环=RUNNABLE(CPU高)

**收尾：** 这块我踩过坑——要不要深入聊：如何用代码层面预防死锁？（锁排序、tryLock超时）？

## 视频脚本

> 预计时长：2 分钟 | 由浅入深

| 时间 | 画面/字幕 | 口播台词 | 讲解要点 |
|------|----------|----------|----------|
| 0:00 | 标题卡 | "并发一句话：死锁是两个或多个线程互相持有对方需要的锁导致永久阻塞；CPU飙高通常是死循环或频繁GC…。" | 开场钩子 |
| 0:15 | 加锁/解锁时序图 | "死锁四条件：互斥+持有等待+不可剥夺+循环等待" | 死锁四条件 |
| 1:02 | 加锁/解锁时序图分步演示 | "jstack自动检测死锁，CPU飙高用top -Hp + jstack组合排查" | jstack自动检测死锁 |
| 1:50 | 总结卡 | "核心抓住这条主线，下期咱们接着聊：如何用代码层面预防死锁？（锁排序、tryLock超时）。" | 收尾 |

## 苏格拉底式面试追问

| 追问层级 | 面试官可能这样问 | 高分回答方向 |
|----------|------------------|--------------|
| 目标追问 | 死锁排查和CPU飙高排查，你第一步想确认什么？ | 死锁第一步jstack看线程是否BLOCKED并找锁的循环等待环；CPU飙高第一步top -Hp找占CPU最高的线程，再jstack看它在干什么 |
| 证据追问 | jstack里怎么识别死锁？有什么关键字？ | 找'Found one Java-level deadlock'段落、看线程状态BLOCKED和'waiting to lock <0x...>'形成环；jstack会自动检测标记死锁 |
| 边界追问 | CPU飙高一定是死循环或GC吗？还有什么可能？ | 还可能是：正则回溯爆炸、序列化大对象、加密计算、JIT编译、线程数爆炸上下文切换、被攻击做大量计算 |
| 反例追问 | 线程状态是RUNNABLE但CPU不高，是什么情况？ | 可能在等IO（socket read、文件读），Java层面是RUNNABLE但实际阻塞在native层；要看是否卡在socketRead0等native方法 |
| 风险追问 | 线上抓jstack有风险吗？怎么降低影响？ | jstack本身触发safepoint会短暂STW；要避免高峰期、多次抓取间隔采样、用jcmd替代减少开销、只抓必要次数 |
| 验证追问 | 怎么验证死锁修复后真的没有了？ | 持续jstack监控无deadlock、压测复现场景验证、加锁超时tryLock兜底告警、监控线程BLOCKED数量 |
| 沉淀追问 | 死锁和CPU飙高的排查SOP怎么沉淀？ | 死锁SOP：jstack→找环→定位锁→改顺序/超时；CPU飙高SOP：top→线程ID→jstack→定位代码，配套监控告警 |

### 现场对话示例
**面试官**：手写一个死锁代码，然后说说怎么排查。
**候选人**：两个线程互锁对方持有的锁即可；排查用jstack找'Found deadlock'和waiting to lock形成的环，定位锁对象调整获取顺序。
**面试官**：CPU飙高怎么排查？
**候选人**：top -Hp找占CPU最高的线程，nid转16进制在jstack里找对应栈，定位是死循环、频繁GC还是正则回溯等。
**面试官**：线程RUNNABLE但CPU不高是什么情况？
**候选人**：多半在等IO，Java层面RUNNABLE但native层阻塞在socketRead0，要看栈是否卡在IO的native方法上。
