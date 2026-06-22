---
id: note-dd-lt-005
difficulty: L4
category: system-design
subcategory: 高并发
tags:
- 滴滴
- 面经
- 抽奖系统
- 热更新
- 并发安全
feynman:
  essence: 用 Copy-On-Write 思想：新配置构建新概率数组，原子替换引用，旧数组等GC回收。
  analogy: 就像换书架上的书——你不是一本一本换，而是提前摆好新书架然后一把整体换掉。
  first_principle: 并发更新的核心矛盾：读多写少。COW让读操作永远无锁。
  key_points:
  - Copy-On-Write替换引用
  - volatile保证可见性
  - 双缓冲切换
  - 原子引用AtomicReference
first_principle:
  essence: COW：读无锁+写整体替换=最优并发策略
  derivation: 直接修改数组→并发读到中间状态→不安全→加锁→阻塞读→COW：构建新数组→原子替换引用
  conclusion: 查找表更新用COW+原子引用实现无锁读+安全写
follow_up:
- COW的内存开销大吗？
- 更新很频繁时COW还合适吗？
- 除了COW还有什么并发更新方案？
---

# 【滴滴面经】如果奖品概率配置临时变了，概率查找表怎么更新？

## 一、问题背景：并发更新的核心矛盾

在抽奖系统中，概率查找表一旦构建完成就处于**持续被读**的状态——每秒可能有上万个线程在并发读取 `table[]`。当运营临时调整奖品概率（比如：临时增加 iPhone 中奖率从 1% 到 5%），就需要更新查找表。

这里的核心矛盾是：

```
读操作：极高频率（QPS 万级），对延迟敏感
写操作：极低频率（每天几次），但不能阻塞读
```

如果更新方式不当，会引发以下问题：

| 错误做法 | 问题 |
|---------|------|
| 直接原地修改 `table[]` | 读线程可能读到**半新半旧**的中间状态 |
| 加 `synchronized` 读写锁 | **写操作阻塞所有读**，QPS 瞬降 |
| 加 `ReadWriteLock` | 写锁会饥饿读线程，高并发下延迟飙升 |
| 停服更新 | 业务不可接受 |

## 二、解决方案：Copy-On-Write（写时复制）

### 2.1 核心思想

**不要修改旧表，而是构建一张完整的新表，然后原子性地替换引用**：

```
旧表 table[] ───────────────→ [在用中，继续服务读请求]
                                    ↓
新表 newTable[] ──(构建完成)──→ 原子替换引用
                                    ↓
旧表 table[] ───────────────→ [无引用，等 GC 回收]
```

**类比**：就像更换图书馆的书架。你不是一本一本替换书架上的书（读者会看到混乱的中间状态），而是提前在旁边摆好一个全新的书架，等一切就绪后，一把将入口指示牌指向新书架。

### 2.2 COW 的并发语义

| 操作 | 并发行为 | 性能影响 |
|------|---------|---------|
| **读（抽奖）** | 直接读引用指向的表，**无锁** | 零额外开销 |
| **写（更新概率）** | 构建新表 → 原子替换引用 | 不阻塞任何读操作 |
| **引用切换瞬间** | 原子操作（CAS/volatile），纳秒级 | 无感知 |

### 2.3 为什么 COW 适合抽奖场景？

COW 的适用条件是 **「读多写少」**，抽奖系统完美匹配：
- 读频率：QPS 万级（每次抽奖都读表）
- 写频率：每天 0-5 次（运营改配置）
- 读写比：**10⁶ : 1**

## 三、完整 Java 代码实现

### 3.1 基于 AtomicReference 的 COW 更新

```java
import java.util.*;
import java.util.concurrent.ThreadLocalRandom;
import java.util.concurrent.atomic.AtomicReference;

/**
 * 支持 COW 热更新的 O(1) 抽奖引擎
 * 读操作完全无锁，写操作通过原子引用替换实现
 */
public class ConcurrentLotteryEngine {

    /**
     * 概率表快照 —— 不可变对象
     * 一旦构建，内容永不修改（final 数组 + final 字段）
     */
    private static final class TableSnapshot {
        final int[] table;          // 概率展开表（不可变）
        final Map<Integer, Prize> prizeMap;
        final int tableSize;
        final long version;         // 版本号，用于追踪配置变更
        final long createdAt;       // 创建时间戳

        TableSnapshot(int[] table, Map<Integer, Prize> prizeMap, int tableSize, long version) {
            this.table = table;
            this.prizeMap = prizeMap;
            this.tableSize = tableSize;
            this.version = version;
            this.createdAt = System.currentTimeMillis();
        }
    }

    /** 原子引用：所有读操作通过这个引用获取当前表快照 */
    private final AtomicReference<TableSnapshot> current;

    /** 版本号生成器 */
    private volatile long versionCounter = 0;

    /**
     * 构造函数：初始概率配置
     */
    public ConcurrentLotteryEngine(List<Prize> initialPrizes) {
        this.current = new AtomicReference<>(buildSnapshot(initialPrizes, 0));
    }

    // ==================== 读操作（无锁） ====================

    /**
     * O(1) 抽奖 —— 读操作完全不加锁
     * ThreadLocalRandom + 原子引用读 = 零竞争
     */
    public Prize draw() {
        TableSnapshot snapshot = current.get();  // 原子读引用
        int randomIndex = ThreadLocalRandom.current().nextInt(snapshot.tableSize);
        int prizeId = snapshot.table[randomIndex];
        return snapshot.prizeMap.get(prizeId);
    }

    /**
     * 获取当前配置版本号（用于监控/调试）
     */
    public long getCurrentVersion() {
        return current.get().version;
    }

    // ==================== 写操作（COW） ====================

    /**
     * 更新概率配置 —— COW 核心方法
     * 构建新表 → 原子替换引用 → 旧表等 GC 回收
     */
    public void updatePrizes(List<Prize> newPrizes) {
        long newVersion = ++versionCounter;
        TableSnapshot newSnapshot = buildSnapshot(newPrizes, newVersion);

        // 原子替换：CAS 语义，不阻塞任何读操作
        TableSnapshot oldSnapshot = current.getAndSet(newSnapshot);

        // oldSnapshot 此时已经没有新引用了，GC 会自动回收
        // 可以在这里做一些清理/日志
        System.out.printf("[配置更新] v%d → v%d, 旧表大小=%d, 新表大小=%d%n",
            oldSnapshot.version, newVersion,
            oldSnapshot.tableSize, newSnapshot.tableSize);
    }

    /**
     * CAS 更新：确保基于特定版本更新（乐观锁）
     * 防止并发更新覆盖彼此（「先读版本号 → 构建 → CAS 替换」的标准模式）
     *
     * 注意：不能用 current.compareAndSet(current.get(), newSnapshot) 这样写，
     * 因为 current.get() 调用两次之间存在 TOCTOU 竞态。
     * 正确做法是在同一个循环中先快照引用，再判断版本，最后 CAS：
     */
    public boolean updatePrizesIfVersion(List<Prize> newPrizes, long expectedVersion) {
        TableSnapshot newSnapshot = buildSnapshot(newPrizes, versionCounter + 1);

        while (true) {
            TableSnapshot snapshot = current.get();        // ① 快照当前引用
            if (snapshot.version != expectedVersion) {
                return false;                               // ② 版本不匹配，放弃
            }
            if (current.compareAndSet(snapshot, newSnapshot)) { // ③ CAS 原子替换
                versionCounter++;                           // ④ 更新成功，推进版本
                return true;
            }
            // CAS 失败说明有其他线程抢先更新，自旋重试
        }
    }

    // ==================== 构建表快照 ====================

    /**
     * 构建不可变快照（在更新线程中执行，不影响读线程）
     */
    private TableSnapshot buildSnapshot(List<Prize> prizes, long version) {
        int tableSize = 10_000;
        int[] table = new int[tableSize];
        Map<Integer, Prize> prizeMap = new HashMap<>();

        List<Prize> sorted = new ArrayList<>(prizes);
        sorted.sort((a, b) -> Double.compare(b.probability, a.probability));

        int index = 0;
        for (Prize prize : sorted) {
            prizeMap.put(prize.id, prize);
            int slots = (int) Math.round(prize.probability * tableSize);
            if (slots == 0 && prize.probability > 0) slots = 1;
            for (int i = 0; i < slots && index < tableSize; i++) {
                table[index++] = prize.id;
            }
        }
        // 兜底：剩余槽位填入最高概率奖品
        if (index < tableSize && !sorted.isEmpty()) {
            int fallback = sorted.get(0).id;
            while (index < tableSize) {
                table[index++] = fallback;
            }
        }

        return new TableSnapshot(table, prizeMap, tableSize, version);
    }

    // ==================== 奖品实体 ====================

    public static class Prize {
        final int id;
        final String name;
        final double probability;

        public Prize(int id, String name, double probability) {
            this.id = id;
            this.name = name;
            this.probability = probability;
        }
    }

    // ==================== 测试 ====================

    public static void main(String[] args) throws InterruptedException {
        // 初始配置
        List<Prize> prizes = Arrays.asList(
            new Prize(1, "iPhone",   0.01),
            new Prize(2, "AirPods",  0.05),
            new Prize(3, "优惠券",    0.30),
            new Prize(4, "谢谢参与",  0.64)
        );

        ConcurrentLotteryEngine engine = new ConcurrentLotteryEngine(prizes);
        System.out.println("初始版本: v" + engine.getCurrentVersion());

        // 模拟并发抽奖
        Runnable lotteryTask = () -> {
            for (int i = 0; i < 100_000; i++) {
                engine.draw(); // 无锁读
            }
        };

        // 启动 10 个抽奖线程
        List<Thread> threads = new ArrayList<>();
        for (int i = 0; i < 10; i++) {
            threads.add(new Thread(lotteryTask));
            threads.get(i).start();
        }

        // 主线程在并发抽奖过程中更新概率配置
        Thread.sleep(100); // 等抽奖线程跑起来

        // 临时调整：iPhone 概率 1% → 5%
        List<Prize> newPrizes = Arrays.asList(
            new Prize(1, "iPhone",   0.05),
            new Prize(2, "AirPods",  0.05),
            new Prize(3, "优惠券",    0.30),
            new Prize(4, "谢谢参与",  0.60)
        );
        engine.updatePrizes(newPrizes);
        System.out.println("更新后版本: v" + engine.getCurrentVersion());

        // 等待所有线程完成
        for (Thread t : threads) t.join();
        System.out.println("全部抽奖完成，无异常。");
    }
}
```

### 3.2 双缓冲（Double Buffering）方案

如果需要**原子性更强**的更新（比如同时更新多张表），可以使用双缓冲：

```java
/**
 * 双缓冲抽奖引擎
 * 用两个数组交替切换，写完后翻转 active 标志
 */
public class DoubleBufferLottery {

    // 两张表：buffer[0] 和 buffer[1]
    private final int[][] buffers = new int[2][];
    
    // volatile 保证可见性：写线程翻转标志后，读线程立刻看到
    private volatile int activeIndex = 0;

    public DoubleBufferLottery(int[] initialTable) {
        buffers[0] = initialTable;
        buffers[1] = new int[initialTable.length]; // 预分配
    }

    /** 读操作：通过 volatile 读 activeIndex，选择当前活跃缓冲区 */
    public int draw(int tableSize) {
        int idx = activeIndex;           // volatile 读
        int[] table = buffers[idx];      // 读活跃缓冲区
        int rand = ThreadLocalRandom.current().nextInt(tableSize);
        return table[rand];
    }

    /** 写操作：在后台缓冲区构建新表，然后翻转 */
    public void update(int[] newTable) {
        int backIndex = 1 - activeIndex; // 后台缓冲区索引
        System.arraycopy(newTable, 0, buffers[backIndex], 0, newTable.length);
        
        // memory barrier：确保新表完全写入后再翻转标志
        // volatile 写天然有 happens-before 语义
        activeIndex = backIndex;         // 原子翻转
    }
}
```

**双缓冲 vs AtomicReference**：

| 维度 | AtomicReference | 双缓冲 |
|------|----------------|--------|
| 内存 | 每次更新创建新数组 | 固定 2 个数组，复用 |
| GC 压力 | 旧表等 GC 回收 | 无 GC 压力 |
| 实现复杂度 | 简单 | 中等 |
| 适用场景 | **推荐（更新不频繁）** | 更新较频繁 |

## 四、并发安全深度分析

### 4.1 为什么 COW 是安全的？

**Java 内存模型（JMM）保证**：

1. **`final` 字段的初始化安全**：`TableSnapshot` 中的所有字段都是 `final`，构造完成后其他线程一定能看到完整的初始化状态（不需要额外同步）。

2. **`AtomicReference.get()` 的原子性**：引用读取是原子的，不可能读到「半个引用」。

3. **`AtomicReference.getAndSet()` 的原子性**：引用替换是原子的，要么所有读线程看到旧表，要么看到新表，**不可能看到半新半旧的中间状态**。

4. **Happens-Before 保证**：写线程构建新表的所有操作 happens-before 读线程通过 `get()` 看到新引用。

### 4.2 竞态条件分析

```
时间线：
  读线程 R1: snapshot = current.get()  → 拿到旧表引用
  写线程 W:  current.getAndSet(newSnapshot) → 替换为新表
  读线程 R2: snapshot = current.get()  → 拿到新表引用

R1 用旧表完成抽奖，R2 用新表完成抽奖 —— 两者都完全安全
R1 不会看到新表，R2 不会看到旧表 —— 不存在不一致
```

**关键点**：引用替换是原子的，不存在「读线程拿到新引用但数组还没构建完」的情况，因为**新表在替换引用之前已经完全构建好**。

### 4.3 并发更新的竞态处理

当多个线程同时更新配置时：

```java
// 方案1：CAS + 版本号（乐观锁）
updatePrizesIfVersion(newPrizes, expectedVersion);

// 方案2：外部加锁串行化更新
private final Object updateLock = new Object();
public void safeUpdate(List<Prize> newPrizes) {
    synchronized (updateLock) {
        updatePrizes(newPrizes);
    }
}
```

> 最佳实践：更新频率极低（每天几次），用 `synchronized` 串行化即可，无需复杂 CAS。

## 五、面试加分点

### 5.1 volatile vs AtomicReference

| 维度 | `volatile` | `AtomicReference` |
|------|----------|------------------|
| 原子读 | ✅ | ✅ |
| 原子写 | ✅ | ✅ |
| CAS | ❌ | ✅ |
| 适用场景 | 简单引用替换 | 需要 CAS 的复杂场景 |

对于 COW 更新，如果不需要 CAS（版本检查），`volatile` 就够了：

```java
private volatile TableSnapshot current; // volatile 足够

public void update(List<Prize> newPrizes) {
    current = buildSnapshot(newPrizes); // volatile 写 = 可见性保证
}
```

### 5.2 COW 的内存开销分析

每次更新创建新数组，旧数组等 GC 回收。开销估算：

```
单表大小：10,000 × 4 bytes = 40 KB
每次更新额外内存：40 KB（临时存在）
GC 回收频率：每天几次 → 几乎无 GC 压力

对比：如果每次更新 100 次/秒（不合理），每秒 4 MB 临时对象 → 可能触发 Minor GC
```

**结论**：对于每天几次的更新频率，COW 的内存开销可以忽略。

### 5.3 更新频繁时的替代方案

如果更新频率高（比如每秒多次），COW 的 GC 压力会增加，替代方案：

| 方案 | 原理 | 优点 | 缺点 |
|------|------|------|------|
| **双缓冲** | 两个数组交替复用 | 无 GC 压力 | 实现稍复杂 |
| **分段更新** | 将大表分成多个 segment，逐段更新 | 减少单次 COW 开销 | 短暂不一致 |
| **版本化读取** | 每次读操作带版本号，读到旧版本时重试 | 无 COW | 读有重试开销 |
| **RCU（Read-Copy-Update）** | 类似 COW，但延迟回收旧数据 | 读完全无开销 | 实现复杂 |

### 5.4 Java 中的 COW 实践

Java 标准库中已有 COW 的实践：
- **`CopyOnWriteArrayList`**：每次写操作复制整个底层数组
- **`CopyOnWriteArraySet`**：基于 `CopyOnWriteArrayList` 实现
- **`String`**：不可变字符串，每次「修改」都创建新对象

```java
// CopyOnWriteArrayList 的实现原理（简化）
public class CopyOnWriteArrayList<E> {
    private transient volatile Object[] array;
    
    public boolean add(E e) {
        synchronized (lock) {
            Object[] elements = array;
            Object[] newElements = Arrays.copyOf(elements, elements.length + 1); // COW
            newElements[elements.length] = e;
            array = newElements; // 原子替换
            return true;
        }
    }
    
    public E get(int index) {
        return (E) array[index]; // 无锁读
    }
}
```

我们的抽奖引擎 COW 方案与 `CopyOnWriteArrayList` **思想完全一致**，只是数据结构从 `Object[]` 换成了 `int[]`（更紧凑、缓存更友好）。

### 5.5 完整的生产级实践建议

```java
// 1. 配置变更监听（从配置中心拉取）
@ConfigListener(pattern = "lottery.prizes")
public void onConfigChange(ConfigEvent event) {
    List<Prize> newPrizes = parsePrizes(event.getValue());
    engine.updatePrizes(newPrizes);  // COW 原子更新
}

// 2. 健康检查（验证当前配置版本）
@HealthCheck
public HealthStatus check() {
    long version = engine.getCurrentVersion();
    return HealthStatus.up("lottery_version", version);
}

// 3. 灰度发布（先在部分节点更新）
// 通过配置中心的 push 机制，逐台更新而非全量
```

## 六、总结

```
概率查找表热更新方案：COW + AtomicReference

核心三步：
1. 构建新表（在更新线程中，不影响读线程）
2. 原子替换引用（AtomicReference.getAndSet，纳秒级）
3. 旧表等 GC 回收（无引用后自动清理）

并发安全保证：
- final 字段的初始化安全 → 构建完成即完整可见
- AtomicReference 的原子性 → 引用替换无竞态
- JMM happens-before → 写操作对后续读操作可见

适用条件：
- 读多写少（抽奖场景读写比 > 10⁶:1）
- 更新频率低（每天几次）
- 可以容忍短暂的双表并存（旧表+新表在 GC 前共存）

一句话总结：
  读永远无锁，写整体替换 —— COW 是读多写少场景的并发最优解。
```
