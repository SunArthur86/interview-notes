---
id: note-ks-004
difficulty: L3
category: system-design
subcategory: 分布式ID
tags:
- 快手
- Java开发
- 一面
- 场景题
- 雪花算法
- Snowflake
- 分布式ID
- 面经
feynman:
  essence: 雪花算法(Snowflake)生成64位ID：1位符号+41位时间戳+10位机器ID+12位序列号。ID冲突的两大原因：(1)时钟回拨——系统时间回退导致同一毫秒内生成重复的时间戳；(2)WorkerID重复——多台机器配置了相同的机器号。解决方案：时钟回拨检测+WorkerID通过ZK/数据库全局分配。
  analogy: "雪花算法就像一个工厂给产品打编号——时间戳是'日期'(41位精确到毫秒)，机器ID是'车间号'(10位)，序列号是'当天产线序号'(12位)。冲突原因：(1)车间时钟走慢了(时钟回拨)→和别的车间撞了日期；(2)两个车间挂了同一个车牌(WorkerID重复)。"
  key_points:
  - Snowflake结构：1+41+10+12=64位，每毫秒每机器最多4096个ID
  - 冲突根因1：时钟回拨(NTP同步导致时间回退)
  - 冲突根因2：WorkerID重复(手动配置相同机器号)
  - 时钟回拨方案：记录上次时间戳→回拨时抛异常/等待/使用历史最大时间
  - WorkerID方案：ZK/数据库/Redis全局分配，启动时获取，宕机时释放
first_principle:
  essence: 分布式ID唯一性 = 时间戳唯一性 × 机器标识唯一性 × 序列号不溢出
  derivation: "ID = f(timestamp, workerId, sequence)。唯一性条件：(1)timestamp单调递增（时钟回拨破坏此条件）；(2)workerId全局唯一（配置重复破坏此条件）；(3)sequence在每毫秒内从0递增，不超过4095。"
  conclusion: 确保唯一性需要保证时钟单调递增 + WorkerID全局唯一分配
follow_up:
- 雪花算法为什么用64位？128位有什么问题？
- 除了Snowflake，还有哪些分布式ID方案？(UUID/数据库自增/Redis INCR/Leaf)
- 美团Leaf和百度UidGenerator是如何改进Snowflake的？
- 时钟回拨最大容忍多少毫秒？如何配置？
- 分库分表后，分布式ID如何与分片路由配合？
memory_points:
- Snowflake结构：1位符号+41位毫秒时间戳(69年)+10位机器ID(1024台)+12位序列号(4096/ms)
- 冲突两大根因：时钟回播(NTP同步) + WorkerID重复(手动配置)
- 时钟回拨解法：记录lastTimestamp→回拨<5ms则等待→>5ms则抛异常/借用未来时间
- WorkerID解法：ZK临时顺序节点分配→启动时获取→宕机时自动释放
---

# 【快手Java一面】分库分表后，雪花算法生成的ID出现冲突，如何解决？

> 来源：快手Java开发一面场景题复盘（小红书）

## 一、雪花算法（Snowflake）原理

```
Snowflake ID 结构（64位）：

  0    41                51           63
  ├────┼─────────────────┼────────────┤
  │符号位│  时间戳(41位)   │机器ID(10位) │序列号(12位)│
  │ 1位 │  毫秒级         │            │           │
  └────┴─────────────────┴────────────┘

  - 符号位：1位，固定为0（正数）
  - 时间戳：41位，毫秒级，可用约69年（2^41ms ≈ 69.7年）
  - 机器ID：10位，最多1024台机器（可拆分5位数据中心+5位机器）
  - 序列号：12位，每毫秒每机器最多4096个ID

  每秒最大生成：4096 × 1000 = 409.6万 ID/秒/机器
```

```java
// Snowflake 标准实现
public class SnowflakeIdGenerator {

    private final long workerId;        // 机器ID (0-1023)
    private long sequence = 0L;         // 序列号
    private long lastTimestamp = -1L;   // 上次生成ID的时间戳

    public synchronized long nextId() {
        long currentTimestamp = timeGen();

        // 🔴 时钟回拨检测
        if (currentTimestamp < lastTimestamp) {
            throw new RuntimeException(
                "时钟回拨！拒绝生成ID，回拨" +
                (lastTimestamp - currentTimestamp) + "ms");
        }

        if (currentTimestamp == lastTimestamp) {
            // 同一毫秒内，序列号递增
            sequence = (sequence + 1) & 0xFFF;  // 12位掩码
            if (sequence == 0) {
                // 序列号溢出，等待下一毫秒
                currentTimestamp = tilNextMillis(lastTimestamp);
            }
        } else {
            sequence = 0L;
        }

        lastTimestamp = currentTimestamp;

        return (currentTimestamp - EPOCH) << 22    // 时间戳左移22位
             | (workerId << 12)                    // 机器ID左移12位
             | sequence;                           // 序列号
    }
}
```

## 二、冲突根因分析

### 根因一：时钟回拨

```
正常情况（时钟单调递增）：
  t=100ms: Machine-A 生成 ID(timestamp=100, seq=0)
  t=100ms: Machine-A 生成 ID(timestamp=100, seq=1)
  t=101ms: Machine-A 生成 ID(timestamp=101, seq=0) ← 时间前进，正常

时钟回拨（NTP时间同步导致）：
  t=200ms: Machine-A 生成 ID(timestamp=200, seq=0)
  → NTP同步：系统时间从 200ms 回退到 195ms
  t=195ms: Machine-A 生成 ID(timestamp=195, seq=0) ← 🔴 回到更早的毫秒！

  如果之前在 t=195ms 已经生成过 ID → 冲突！

  ┌─────────────────────────────────────────┐
  │ 之前生成：195ms + WorkerID=1 + seq=0    │
  │ 回拨生成：195ms + WorkerID=1 + seq=0    │ ← 完全相同！冲突！
  └─────────────────────────────────────────┘
```

### 根因二：WorkerID 重复

```
手动配置WorkerID（常见运维错误）：

  ┌─────────────────────────────────────────┐
  │ Machine-A: workerId=1  (配置文件写死)   │
  │ Machine-B: workerId=1  (复制配置忘改!)  │
  └─────────────────────────────────────────┘

  同一毫秒内：
    Machine-A: timestamp=100, workerId=1, seq=0 → ID=A
    Machine-B: timestamp=100, workerId=1, seq=0 → ID=A ← 🔴 完全相同！

  问题本质：workerId不是全局唯一的
```

## 三、解决方案

### 方案一：时钟回拨处理

```java
public synchronized long nextId() {
    long currentTimestamp = timeGen();

    if (currentTimestamp < lastTimestamp) {
        long offset = lastTimestamp - currentTimestamp;

        if (offset <= 5) {
            // 🟡 小幅回拨（≤5ms）：等待追平
            try {
                Thread.sleep(offset + 1);
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
            }
            currentTimestamp = timeGen();
            if (currentTimestamp < lastTimestamp) {
                throw new RuntimeException("时钟回拨仍未恢复");
            }
        } else {
            // 🔴 大幅回拨（>5ms）：抛异常 + 告警
            // 或者：使用lastTimestamp作为基准（借用未来时间）
            // 但这可能导致ID不单调递增
            throw new RuntimeException(
                "时钟回拨" + offset + "ms，拒绝生成ID");
        }
    }

    // ... 正常生成逻辑
}
```

### 方案二：WorkerID 全局分配（推荐）

```
方案A：ZooKeeper 分配 WorkerID

  ┌───────────────────────────────────────────────┐
  │ ZooKeeper                                      │
  │                                               │
  │ /snowflake/workers/                            │
  │   ├── 00000001 (临时顺序节点, Machine-A)        │
  │   ├── 00000002 (临时顺序节点, Machine-B)        │
  │   └── 00000003 (临时顺序节点, Machine-C)        │
  │                                               │
  │ Machine启动 → 创建临时顺序节点 → 获取序号作为WorkerID│
  │ Machine宕机 → 临时节点自动删除 → WorkerID释放     │
  └───────────────────────────────────────────────┘
```

```java
// ZK分配WorkerID
public class ZkWorkerIdAssigner {

    public long assignWorkerId() {
        // 1. 连接ZK
        CuratorFramework client = CuratorFrameworkFactory.newClient(zkAddr, ...);
        client.start();

        // 2. 创建临时顺序节点
        String path = client.create()
            .creatingParentsIfNeeded()
            .withMode(CreateMode.EPHEMERAL_SEQUENTIAL)
            .forPath("/snowflake/workers/worker-");

        // 3. 提取序号作为WorkerID
        String seqStr = path.substring(path.lastIndexOf("-") + 1);
        return Long.parseLong(seqStr) % 1024;  // 确保不超10位
    }
    // 宕机时临时节点自动删除，WorkerID自动释放
}
```

```
方案B：数据库分配 WorkerID

  WorkerID分配表：
  ┌──────────┬─────────────┬──────────┐
  │ worker_id│ host        │ status   │
  ├──────────┼─────────────┼──────────┤
  │ 1        │ 10.0.0.1    │ ACTIVE   │
  │ 2        │ 10.0.0.2    │ ACTIVE   │
  │ 3        │ (空,可分配)  │ IDLE     │
  └──────────┴─────────────┴──────────┘

  启动时：SELECT一个IDLE的WorkerID → UPDATE为ACTIVE
  心跳：定期更新last_heartbeat
  宕机：其他实例检测心跳超时 → 标记为IDLE → 回收
```

### 方案三：扩展位数

```
标准Snowflake：41+10+12 = 63位
自定义扩展：   40+12+11 = 63位

  方案A：增加WorkerID位数（10→12位）
  → 支持4096台机器
  → 序列号减少到11位 = 2048/ms（仍足够）

  方案B：增加序列号位数（12→14位）
  → 每毫秒16384个ID
  → 机器ID减少到8位 = 256台机器

  根据实际场景调整位数分配
```

## 四、工业界方案

```
美团 Leaf：
  - Segment模式：基于数据库号段预分配，性能高
  - Snowflake模式：ZK分配WorkerID + 双buffer预加载
  - 解决了时钟回拨问题（等待策略+报警）

百度 UidGenerator：
  - DefaultUidGenerator：标准Snowflake + 数据库分配WorkerID
  - CachedUidGenerator：RingBuffer预生成，无锁高性能
  - 时间戳改为秒级(28位)，WorkerId 22位，序列号13位

两者都比原生Snowflake更可靠：
  ✅ WorkerID自动分配，不会重复
  ✅ 时钟回拨防护
  ✅ 高性能预生成
```

## 五、面试加分点

1. **提到时钟回拨的根因**：NTP(Network Time Protocol)同步时间时可能回拨，特别是虚拟机/容器环境
2. **提到分布式时钟问题**：本质上这是分布式系统时钟同步问题，Google Spanner用TrueTime(原子钟)解决，是终极方案但成本极高
3. **提到ID的趋势递增**：Snowflake ID是趋势递增的（时间戳在高位），对B+树索引友好，而UUID完全随机会导致索引碎片
4. **提到业务场景选择**：不需要全局唯一时可以用数据库自增+分库步长，需要全局唯一时才用Snowflake
5. **提到监控告警**：WorkerID分配冲突、时钟回拨都应该有监控，不要等线上出现重复ID才发现
