---
id: note-ks-003
difficulty: L3
category: system-design
subcategory: 并发编程
tags:
- 快手
- Java开发
- 一面
- 场景题
- ThreadLocal
- 内存泄漏
- 线程池
- 面经
feynman:
  essence: ThreadLocal内存泄漏的根因是线程池中线程存活时间长，ThreadLocalMap中的Entry虽然WeakReference引用ThreadLocal key，但value是强引用。如果用完不remove()，Entry和value不会被回收。解决方案：每次用完必须调用remove()，用try-finally保证。
  analogy: "ThreadLocal就像酒店房间的储物柜——每个线程(客人)有自己的柜子(ThreadLocalMap)。问题是：客人退房(ThreadLocal引用没了)但柜子里的东西(value)还在，因为酒店(线程池)不退房，柜子就一直占着空间。解决：客人离开前必须清空柜子(remove())。"
  key_points:
  - ThreadLocalMap的Entry是WeakReference(ThreadLocal) + StrongReference(value)
  - ThreadLocal引用被回收后key变null，但value仍被Entry强引用 → 泄漏
  - 线程池中线程长生不老 → ThreadLocalMap永不清理 → 泄漏持续累积
  - 解决方案：try-finally中调用remove()，或使用InheritableThreadLocal/TransmittableThreadLocal
  - MAT显示10万个ThreadLocalEntry未回收 → 典型的线程池+ThreadLocal泄漏
first_principle:
  essence: 内存泄漏 = 对象不再使用但无法被GC回收
  derivation: "ThreadLocalMap.Entry的设计：key是WeakReference(ThreadLocal可以被回收)，value是StrongReference(防止value被提前回收)。当ThreadLocal外部引用断开后，key被GC回收变为null，但value仍被Entry的强引用持有。在线程池场景下，线程不死→ThreadLocalMap不清理→value永远无法回收。"
  conclusion: 根因是ThreadLocal设计上value的强引用 + 线程池的长生命周期。解法：每次用完remove()
follow_up:
- ThreadLocal和Synchronized有什么区别？各自的适用场景？
- InheritableThreadLocal能解决线程池场景的问题吗？
- TransmittableThreadLocal(阿里开源)是如何解决线程池传递问题的？
- ThreadLocalMap的开放寻址法和HashMap的链表法有什么区别？
- 如何检测和诊断ThreadLocal内存泄漏？
memory_points:
- ThreadLocal泄漏根因：Entry.key=WeakReference(可被GC) + Entry.value=StrongReference(不会被GC)
- 线程池场景下线程长生不死→ThreadLocalMap永不清理→10万个Entry泄漏
- 铁律：ThreadLocal用完必须remove()，标准写法try{...}finally{tl.remove();}
- ThreadLocalMap用开放寻址法(非链表法)，弱引用key+强引用value的设计是泄漏的根源
---

# 【快手Java一面】MAT显示10万个ThreadLocalEntry未回收，如何解决？

> 来源：快手Java开发一面场景题复盘（小红书）

## 一、ThreadLocal 内存泄漏根因

### ThreadLocal 的内部结构

```
Thread 对象
  └── ThreadLocal.ThreadLocalMap threadLocals
        └── Entry[] table
              └── Entry extends WeakReference<ThreadLocal<?>>
                    ├── key:   WeakReference → ThreadLocal对象（弱引用）
                    └── value: Object        → 实际数据（强引用！）

内存引用链：

  ┌─────────┐    强引用     ┌──────────────┐
  │ Thread  │ ───────────→ │ ThreadLocalMap│
  │(线程池中) │              │  Entry[]      │
  └─────────┘              │ ┌───────────┐ │
                           │ │ Entry     │ │
                           │ │ key(弱)──→│─┼──→ ThreadLocal对象
                           │ │ value(强) │ │    ↑ 外部引用断了=被GC
                           │ │ ="大对象" │ │    但value不被回收！
                           │ └───────────┘ │
                           └──────────────┘
```

### 泄漏发生过程

```
Step 1: 正常使用
  ThreadLocal<UserContext> tl = new ThreadLocal<>();
  tl.set(userContext);  // Entry: key=tl(弱引用), value=userContext(强引用)
  UserContext ctx = tl.get();  // 正常获取

Step 2: ThreadLocal引用断开
  tl = null;  // ThreadLocal外部引用没了
  → WeakReference key被GC回收 → key变为null
  → 但value仍被Entry强引用持有 → 无法回收！

Step 3: 线程池场景（致命）
  线程池中的线程长生不老（corePoolSize不会销毁）
  → Thread.threadLocals (ThreadLocalMap) 永远存在
  → Entry中的value永远无法回收
  → 10万个ThreadLocalEntry堆积！

  ┌─────────────────────────────────────────────┐
  │ 时间线：                                      │
  │                                              │
  │ t1: 线程A → set(tl1, bigData1)              │
  │ t2: tl1 = null → key被GC，value=bigData1残留 │
  │ t3: 线程A → set(tl2, bigData2)              │
  │ t4: tl2 = null → key被GC，value=bigData2残留 │
  │ ...                                          │
  │ t100000: 10万个value堆积 → OOM               │
  └─────────────────────────────────────────────┘
```

## 二、解决方案

### 方案一：try-finally + remove()（标准解法）

```java
// ✅ 正确写法：每次使用ThreadLocal必须remove
public class OrderService {

    private static final ThreadLocal<UserContext> userContextHolder = new ThreadLocal<>();

    public void processOrder(Long userId) {
        try {
            // 设置ThreadLocal
            userContextHolder.set(getUserContext(userId));

            // 业务逻辑
            doSomething();
            doSomethingElse();

        } finally {
            // 🔴 关键：无论是否异常都必须remove
            userContextHolder.remove();
        }
    }
}

// ❌ 错误写法（会导致泄漏）
public void processOrder(Long userId) {
    userContextHolder.set(getUserContext(userId));
    doSomething();  // 如果这里抛异常，remove不会执行
    userContextHolder.remove();  // 不可靠！
}
```

### 方案二：使用 AOP 统一清理

```java
// 自定义注解
@Target(ElementType.METHOD)
@Retention(RetentionPolicy.RUNTIME)
public @interface ClearThreadLocal {
    String[] value();  // 要清理的ThreadLocal字段名
}

// AOP切面：方法执行后自动清理ThreadLocal
@Aspect
@Component
public class ThreadLocalCleanAspect {

    @After("@annotation(clearThreadLocal)")
    public void cleanThreadLocals(JoinPoint joinPoint, ClearThreadLocal clearThreadLocal) {
        ThreadContextHolder.remove(clearThreadLocal.value());
    }
}

// 使用：方法上加注解，执行完自动清理
@ClearThreadLocal({"userContext", "traceId"})
public void processOrder(Long userId) {
    // 业务逻辑
}
```

### 方案三：使用线程安全的替代方案

```
场景：需要在父子线程间传递上下文

  普通ThreadLocal：
    父线程set → 子线程get不到 ❌
    解决 → InheritableThreadLocal

  InheritableThreadLocal：
    父线程set → 子线程能get ✅
    但线程池场景：
    线程被复用 → 第二次提交任务时拿到旧的上下文 ❌

  TransmittableThreadLocal (阿里开源)：
    线程池场景下正确传递 ✅
    每次提交任务时"快照"上下文 → 执行时"恢复" → 执行后"清理"
    完美解决线程池场景的ThreadLocal传递和泄漏问题
```

```java
// 使用TransmittableThreadLocal替代ThreadLocal
private static final TransmittableThreadLocal<UserContext> context =
    new TransmittableThreadLocal<>();

// 配合TtlExecutors包装线程池
ExecutorService executor = TtlExecutors.getTtlExecutorService(
    Executors.newFixedThreadPool(10)
);

// 这样线程池中也能正确传递上下文，且不会泄漏
executor.submit(() -> {
    UserContext ctx = context.get();  // ✅ 正确获取父线程的上下文
});
```

## 三、MAT 分析方法

```
MAT中如何确认ThreadLocal泄漏：

1. 打开heapdump文件
2. Leak Suspects Report → 发现大量ThreadLocalMap.Entry
3. 点击 ThreadLocal$ThreadLocalMap$Entry
4. 查看引用链：

  ┌────────────────────────────────────────────────────┐
  │ ThreadLocal$ThreadLocalMap$Entry (10万个实例)       │
  │   └── referent = null (key已被GC)                  │
  │   └── value = BigDataObject@0x7f8a... (强引用!)   │
  │       └── 100KB                                    │
  │                                                    │
  │ 总泄漏：10万 × 100KB = 10GB ❌                     │
  └────────────────────────────────────────────────────┘

5. 查看value对象 → 定位是哪个ThreadLocal设置的
6. 在代码中找到对应位置 → 加上remove()
```

## 四、面试加分点

1. **提到ThreadLocalMap的清理机制**：在get/set/remove时会顺带清理key为null的Entry(expungeStaleEntry)，但这不是保证清理的——如果后续不再get/set，value永远不会被回收
2. **提到为什么Entry用WeakReference**：如果用强引用，ThreadLocal对象本身也无法被回收，泄漏会更严重
3. **提到Netty的FastThreadLocal**：Netty通过常量索引优化了ThreadLocal的访问速度，避免了hash冲突
4. **提到检测工具**：Arthas的`vmtool`命令可以在线查看ThreadLocal实例，定位泄漏
5. **提到最佳实践**：Spring的RequestContextFilter用ThreadLocal存RequestContext，请求结束后RequestContextHolder.resetRequestAttributes()清理——这是框架级的标准做法
