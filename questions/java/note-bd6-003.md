---
id: note-bd6-003
difficulty: L2
category: java
subcategory: 并发
tags:
- 字节
- Java
- 并发
- 单例模式
- DCL
- volatile
- 三面
- 面经
feynman:
  essence: 双重检查锁(DCL)是实现线程安全单例模式的高效方式——先检查null（无锁快速路径），为null才加锁，加锁后再检查一次防止重复创建。volatile防止指令重排导致的"获取未初始化对象"问题。
  analogy: 就像公厕门——先看门牌"有人吗"（第一次检查，无锁快），没人就推门进去锁上（加锁），进去了再看一眼确实没人（第二次检查，防两人同时进来），然后安心使用。
  key_points:
  - 第一次检查：无锁快速路径，对象已创建则直接返回
  - 第二次检查：加锁后再次确认，防止多线程同时通过第一次检查
  - volatile必须加：防止new操作的指令重排
  - 指令重排问题：new对象=分配内存→初始化→引用指向内存，可能被重排为分配→引用→初始化
  - volatile+双重检查=线程安全且高性能
first_principle:
  essence: DCL = 无锁快速路径 + 锁保护初始化，volatile = 防止指令重排破坏初始化语义
  derivation: 单例需要线程安全→synchronized包住整个方法太慢→只锁创建部分→但"检查+创建"非原子→双重检查→但new的指令可能重排→volatile禁止重排
  conclusion: DCL+volatile是延迟初始化单例的标准模式，兼顾线程安全和性能
follow_up:
- 为什么不加volatile会有问题？（指令重排导致拿到未初始化的对象）
- volatile是怎么禁止指令重排的？（内存屏障：Store-Store + Load-Load）
- 除了DCL还有哪些线程安全的单例实现？（静态内部类、枚举）
- 为什么枚举单例最好？（天然线程安全+防反射+防序列化）
memory_points:
- DCL三步：1.无锁检查null 2.加锁后再检查null 3.new对象
- volatile必须加！防止new的指令重排(分配→赋值→初始化 变成 分配→初始化→赋值)
- 没有volatile的风险：线程B拿到非null引用但对象还没初始化 → NPE
- 替代方案：静态内部类( JVM类加载保证线程安全)、枚举(最佳实践)
- 面试手撕：volatile + synchronized + 两次if null检查
---

# 【字节三面手撕】实现双重检查锁（DCL）单例模式

> 来源：小红书 字节后端一二三面面试全流程回顾

## 一、为什么需要双重检查锁

```
单例模式演进

方案1: 懒汉式（线程不安全）❌
public static Singleton getInstance() {
    if (instance == null)        // 线程A和B同时判断为null
        instance = new Singleton(); // 两个线程都创建了！
    return instance;
}

方案2: 同步方法（性能差）⚠️
public synchronized static Singleton getInstance() {
    if (instance == null)         // 每次调用都加锁！
        instance = new Singleton(); // 99%的情况下对象已存在，白加锁
    return instance;
}

方案3: 双重检查锁DCL（完美）✅
public static Singleton getInstance() {
    if (instance == null) {           // ① 第一次检查（无锁，快速路径）
        synchronized (Singleton.class) {
            if (instance == null) {   // ② 第二次检查（加锁后确认）
                instance = new Singleton(); // ③ 真正创建
            }
        }
    }
    return instance;
}
// 对象已存在时无锁直接返回 → 高性能
// 对象不存在时加锁+二次检查 → 线程安全
```

## 二、为什么必须加 volatile

```
new Singleton() 不是原子操作，分三步：

Step 1: 分配内存空间              memory = allocate()
Step 2: 初始化对象                ctorInstance(memory)  
Step 3: 引用指向内存地址           instance = memory

⚠️ JVM的指令重排可能将顺序变为：
Step 1: 分配内存空间              memory = allocate()
Step 3: 引用指向内存地址           instance = memory  ← 先赋值了！
Step 2: 初始化对象                ctorInstance(memory) ← 还没初始化！
```

```
指令重排导致的问题场景

线程A                          线程B
  │                              │
  │ instance = new Singleton()   │
  │ ├── 分配内存 ✅               │
  │ ├── instance = memory ✅      │
  │ │  (此时instance != null      │
  │ │   但对象还没初始化!)          │
  │ │                  ┌──────────┤
  │ │                  │          │
  │ │                  │ if (instance == null) 
  │ │                  │ → false! 直接返回
  │ │                  │ → 拿到未初始化的对象 ❌
  │ │                  │ → 使用时 NPE！
  │ ├── 初始化对象 ✅  │          │
  │ │  (但线程B已经用了) │          │
  │ ▼                  ▼          │
```

## 三、正确实现

```java
public class Singleton {
    
    // volatile 防止指令重排！
    private static volatile Singleton instance;
    
    // 私有构造器
    private Singleton() {
        // 防止反射攻击
        if (instance != null) {
            throw new RuntimeException("Use getInstance()");
        }
    }
    
    // 双重检查锁
    public static Singleton getInstance() {
        // 第一次检查：对象已存在时无锁直接返回（99%的情况）
        Singleton result = instance;
        if (result == null) {
            synchronized (Singleton.class) {
                result = instance;
                // 第二次检查：加锁后再次确认，防止多线程同时通过第一次检查
                if (result == null) {
                    instance = result = new Singleton();
                }
            }
        }
        return result;
    }
    
    // 防止序列化破坏单例
    private Object readResolve() {
        return getInstance();
    }
}
```

> **注意局部变量 `result`**：引入局部变量是因为volatile读有一定开销，使用局部变量确保volatile字段只读一次（在锁外和锁内），这是优化技巧。

## 四、volatile 如何禁止指令重排

```
volatile 的内存屏障

写操作前：插入 StoreStore 屏障 → 禁止前面的写与volatile写重排
写操作后：插入 StoreLoad 屏障  → 禁止后面的读/写与volatile写重排

所以 new Singleton() 的三步：
  allocate()           ← StoreStore
  ctorInstance()       
  instance = memory    ← volatile写，插入 StoreLoad
  
→ 保证 ctorInstance() 一定在 instance 赋值之前完成
→ 其他线程看到 instance != null 时，对象一定已初始化
```

## 五、其他线程安全单例方案对比

| 方案 | 线程安全 | 延迟加载 | 性能 | 防反射 | 推荐 |
|------|---------|---------|------|--------|------|
| 饿汉式 | ✅ | ❌ | 高 | ❌ | ⭐⭐ |
| DCL | ✅ | ✅ | 高 | ❌ | ⭐⭐⭐ |
| 静态内部类 | ✅ | ✅ | 高 | ❌ | ⭐⭐⭐⭐ |
| 枚举 | ✅ | ❌ | 高 | ✅ | ⭐⭐⭐⭐⭐ |

### 静态内部类方案（推荐）

```java
public class Singleton {
    private Singleton() {}
    
    // JVM类加载机制保证线程安全
    // 只有调用getInstance时才加载Holder类 → 延迟初始化
    private static class Holder {
        private static final Singleton INSTANCE = new Singleton();
    }
    
    public static Singleton getInstance() {
        return Holder.INSTANCE;
    }
}
```

### 枚举方案（最佳实践）

```java
public enum Singleton {
    INSTANCE;
    
    public void doSomething() { ... }
}
// 天然线程安全（JVM保证）
// 天然防反射（enum类型不能通过反射创建）
// 天然防序列化（enum序列化由JVM特殊处理）
```

## 六、面试加分点

1. **指令重排是核心考点**：能画出"分配→赋值→初始化"被重排为"分配→初始化→赋值"导致的问题
2. **volatile的原理**：能说出内存屏障(Store-Store/Store-Load)禁止指令重排
3. **局部变量优化**：提到引入`result`局部变量减少volatile读次数
4. **知道替代方案**：静态内部类（利用类加载机制）和枚举（Effective Java推荐）
5. **防反射**：在构造器中加`if (instance != null) throw`防止反射破坏单例


## 结构化回答

**30 秒电梯演讲：** 双重检查锁(DCL)是实现线程安全单例模式的高效方式——先检查null（无锁快速路径），为null才加锁，加锁后再检查一次防止重复创建。

**展开框架：**
1. **DCL三步** — 1.无锁检查null 2.加锁后再检查null 3.new对象
2. **volatile必须加** — volatile必须加！防止new的指令重排(分配→赋值→初始化 变成 分配→初始化→赋值)
3. **没有volatile的风** — 线程B拿到非null引用但对象还没初始化 → NPE

**收尾：** 这块我踩过坑——要不要深入聊：为什么不加volatile会有问题？（指令重排导致拿到未初始化的对象）？

## 视频脚本

> 预计时长：2 分钟 | 由浅入深

| 时间 | 画面/字幕 | 口播台词 | 讲解要点 |
|------|----------|----------|----------|
| 0:00 | 标题卡 | "并发一句话：双重检查锁(DCL)是实现线程安全单例模式的高效方式——先检查null（无锁快速路径）…。" | 开场钩子 |
| 0:15 | 加锁/解锁时序图 | "DCL三步：1.无锁检查null 2.加锁后再检查null 3.new对象" | DCL三步 |
| 1:02 | 加锁/解锁时序图分步演示 | "volatile必须加！防止new的指令重排(分配到赋值到初始化 变成 分配到初始化到赋值)" | volatile必须加 |
| 1:50 | 总结卡 | "核心抓住这条主线，下期咱们接着聊：为什么不加volatile会有问题？（指令重排导致拿到未初始化的对象）。" | 收尾 |

## 苏格拉底式面试追问

| 追问层级 | 面试官可能这样问 | 高分回答方向 |
|----------|------------------|--------------|
| 目标追问 | 双重检查锁（DCL）单例想解决的核心问题是什么？ | 解决懒加载+线程安全+高性能三者的平衡——避免每次获取实例都加锁的性能损耗，同时保证只创建一次 |
| 证据追问 | DCL里volatile关键字去掉会怎样？你怎么证明会出现问题？ | 去掉volatile会发生指令重排：构造函数未执行完就把对象暴露，其他线程拿到未初始化对象；可用JCStress压测或内存屏障原理证明 |
| 边界追问 | 什么时候不该用DCL，有更简单的替代方案？ | 单线程场景直接懒汉即可；如果不在乎懒加载用饿汉；最佳替代是静态内部类（利用类加载机制）或枚举单例（防反射攻击） |
| 反例追问 | 只做一次null检查加synchronized行不行？为什么非要两次检查？ | 一次检查每次获取都加锁性能差；外层无锁快速路径、内层加锁后再检查一次防止并发重复创建，这才是DCL精髓 |
| 风险追问 | DCL在低版本JDK（<1.5）为什么不安全？ | JMM在1.5才完善volatile的happens-before语义，之前volatile不能完全禁止重排，DCL会失效；现1.5+才可靠 |
| 验证追问 | 怎么验证你的DCL实现真的是单例且线程安全？ | 多线程并发获取实例断言hashCode相同、用CountDownLatch模拟并发起跑、JMH压测吞吐对比synchronized版本 |
| 沉淀追问 | 团队里单例模式选型有没有统一规范？ | 沉淀为编码规范：优先枚举>静态内部类>DCL，禁止用饿汉式Singleton Holder以外的反射敏感写法 |

### 现场对话示例
**面试官**：实现一个双重检查锁单例模式，写一下。
**候选人**：private static volatile Singleton instance；外层判null、加synchronized后内层再判null、再new，volatile防止构造指令重排。
**面试官**：volatile这里去掉行不行？
**候选人**：不行，new对象分分配内存、初始化、赋值三步可能重排，其他线程可能拿到未初始化对象；volatile用内存屏障禁止重排。
**面试官**：有没有更优雅的单例写法？
**候选人**：静态内部类利用类加载机制天然线程安全且懒加载；枚举单例还能防反射攻击，是Effective Java推荐写法。
