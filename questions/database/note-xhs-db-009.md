---
id: note-xhs-db-009
difficulty: L3
category: database
subcategory: Redis
tags:
- Redis
- Bitmap
- 位图
- 签到
- 位操作
feynman:
  essence: Bitmap就是用String的每个bit来表示一个布尔值。setbit就是定位到某个字节再通过位运算（与/或）修改某一位，getbit就是读出来再移位取值。
  analogy: "想象一排灯泡开关（每个开关=1个bit=1个位置）。setbit(3, 1)就是找到第3个开关把它打开。底层是先算出第几个字节（开关在哪排），再用位运算精确控制那一个开关。"
  key_points:
  - Bitmap不是独立类型，基于String的位操作
  - 'setbit: 定位byte→位运算置1/清0，O(1)'
  - 'getbit: 定位byte→移位取值，O(1)'
  - BITCOUNT统计1的个数，BITOP做位运算
  - 1亿用户签到仅需~12MB（1亿bit/8/1024/1024）
first_principle:
  problem: "海量布尔状态（签到/在线/活跃）需要高效存储和查询，用传统数据结构（Set/Hash）内存开销太大。"
  axioms:
  - 1个布尔值只需要1个bit（0或1）
  - 1字节=8bit，1MB可存800万个布尔值
  - 位运算是CPU原生操作，O(1)且极快
  - bit offset到byte offset的映射：byte=offset/8, bit=offset%8
  rebuild: "从布尔值存储需求出发：用String的字节数组→每个bit代表一个布尔值→位运算(set/get)实现高效读写→BITCOUNT做统计→BITOP做多集合运算。Bitmap是空间最优的布尔值存储方案"
follow_up:
- Bitmap 和 Set 的内存对比？1亿用户签到各占多少内存？
- BITFIELD 命令的作用是什么？能做什么位运算？
- 如果 offset 非常大（如 2^31），会有什么问题？
- Redis 的 HyperLogLog 和 Bitmap 在统计UV场景下怎么选？
---

# Redis Bitmap 是怎么实现的？set/get 一个 bit 底层做了什么？（小红书Java一面）

## 一、Bitmap 本质

Redis Bitmap **不是一种独立的数据类型**，而是基于 String 类型的位操作扩展。一个 String 最大 512MB，可存储 2^32 ≈ 42.9 亿个 bit。

```
String key = "user:sign:1001:202607"
     ↓ 底层是 SDS (Simple Dynamic String)
字节: [byte0]  [byte1]  [byte2]  ...
位:    76543210 76543210 76543210
       ↓↓↓↓↓↓↓↓ ↓↓↓↓↓↓↓↓ ↓↓↓↓↓↓↓↓
       每个bit代表某天是否签到(1=签到, 0=未签)
```

## 二、setbit 底层逻辑

```
SETBIT key offset value
         │
         ▼
① byte = offset / 8     ← 计算在第几个字节
   bit = offset % 8      ← 计算在字节内的第几位
         │
         ▼
② 检查 SDS 长度是否足够
   不够 → sdsgrowzero() 扩展SDS并用0填充新增部分
         │
         ▼
③ 位操作：
   value=1 → sds[byte] |= (1 << (7 - bit))   ← 置1
   value=0 → sds[byte] &= ~(1 << (7 - bit))  ← 清0
         │
         ▼
④ 更新 SDS 的长度、空闲空间元数据
```

**注意**：位序是从高位（MSB）到低位（LSB），即 byte 的第 0 位是最高位。

```bash
# 示例：用户1001在7月第1天和第3天签到
SETBIT user:sign:1001:202607 0 1   # 第1天
SETBIT user:sign:1001:202607 2 1   # 第3天
# 底层 byte0 = 10100000 = 0xA0

GETBIT user:sign:1001:202607 0     # 返回1
GETBIT user:sign:1001:202607 1     # 返回0
```

## 三、getbit 底层逻辑

```
GETBIT key offset
    │
    ▼
① byte = offset / 8
   bit = offset % 8
    │
    ▼
② SDS长度检查：offset超出范围直接返回0
    │
    ▼
③ return (sds[byte] >> (7 - bit)) & 1
```

**时间复杂度**：O(1) — 直接数组下标访问 + 位运算

## 四、常用统计命令

```bash
# 统计签到天数（值为1的bit数）
BITCOUNT user:sign:1001:202607

# 计算连续签到：位运算获取从offset开始的连续1
BITFIELD user:sign:1001:202607 GET u7 0
# 获取从第0位开始7个无符号位 → 返回一个数值

# 多用户活跃统计：N个用户同时在线人数
BITOP AND active_both user:active:20260701 user:active:20260702
# 两天都活跃的用户数
BITCOUNT active_both
```

## 五、典型应用场景

```
场景1：用户签到（1亿用户 × 365天 = 365亿bit ≈ 4.3GB）
  key = "sign:uid:202607"  ← 每月一个key

场景2：活跃用户统计
  key = "active:20260701"  ← 每天一个key
  SETBIT active:20260701 {uid} 1
  BITCOUNT active:20260701      ← 当日活跃用户数

场景3：用户在线状态
  SETBIT online {uid} 1/0
```
## 苏格拉底式面试追问

> 这组追问模拟面试官层层逼问，每一问先回答"为什么"，再回答"怎么做"，最后回答"如何证明"。

### 第一层：目标与动机

**Q：Redis Bitmap 你说是"用 String 类型按位存储"，那 SETBIT 底层到底做了什么？一个 bit 不够一个字节，Redis 怎么管理的？**

Redis 的 String 底层是 SDS（Simple Dynamic String），是字节数组。SETBIT key offset value 时，Redis 计算 offset 对应的字节位置 `byte = offset / 8` 和位位置 `bit = offset % 8`，然后把 SDS 的第 byte 个字节的第 bit 位设为 value。具体：如果 SDS 当前长度不足 byte+1 字节，先扩容（`sdsgrowzero` 用 0 填充新字节）；再用位运算（`p[byte] |= (1 << bit)` 设 1，`p[byte] &= ~(1 << bit)` 清 0）修改目标位。所以 SETBIT 一个 bit 实际操作的是一个字节（8 bit），只是其他 7 位保持不变。BITCOUNT 遍历所有字节，用 `__builtin_popcount` 或查表统计每个字节的 1 的个数。这就是 Bitmap 的本质——用 String 的字节空间按位寻址，实现"1 bit 存储一个布尔状态"。

### 第二层：证据与定位

**Q：你说 Bitmap 省内存（1 亿用户签到只占 ~12MB），但用户 ID 不连续（如最大 ID 是 10 亿）会怎样？怎么定位这个内存浪费？**

Bitmap 的内存占用由"最大 offset"决定，不是"实际置位的 bit 数"。如果用户 ID 从 1 到 10 亿，只有 1 亿实际用户签到，SETBIT 会把 SDS 扩展到 10亿/8 ≈ 125MB（因为 offset=10亿对应第 125MB 字节）。即使中间 9 亿位是 0，内存已分配。定位方法：`DEBUG OBJECT key` 看 `serializedlength`，或 `MEMORY USAGE key` 看实际占用。对比：如果 ID 连续（1 到 1 亿），只占 12.5MB；ID 稀疏（最大 10 亿），占 125MB，浪费 10 倍。解决方案：一、ID 映射——把稀疏的原始 ID 映射到连续空间（如自增序号），再 SETBIT；二、改用 HyperLogLog——如果是统计基数（去重数）而非精确签到，HLL 固定 12KB；三、分片 Bitmap——按 ID 范围分多个 key（如 bitmap:0_1M、bitmap:1M_2M），稀疏分片可以不分配。

### 第三层：根因深挖

**Q：SETBIT offset value 这个操作，如果两个客户端同时 SETBIT 同一字节的不同 bit，会互相覆盖吗？**

不会。Redis 是单线程，所有命令串行执行。SETBIT 是单条命令，内部对字节的"读-改-写"在单线程下天然原子。即使两个客户端同时发 `SETBIT key 0 1` 和 `SETBIT key 1 1`（offset 0 和 1 在同一字节内），Redis 也按到达顺序串行执行，两个 bit 都被正确设置，不会覆盖。这是 Redis 单线程模型的并发优势——无需加锁，单命令原子。但如果要用 Bitmap 做"计数器"（如多线程累加某 bit），SETBIT 不够（它只能设 0/1，不能读改写循环），要用 Lua 脚本或 SETBIT + GETBIT 组合。Bitmap 的典型场景（签到、在线状态）是"幂等设置"，无并发问题；"计数"场景要用 Hash 或 String 的 INCR。

**Q：那为什么不用 Hash 存签到（field=用户ID，value=1），而用 Bitmap？**

空间差异巨大。1 亿用户签到：Bitmap 占 1亿/8 = 12.5MB；Hash 每个元素约 60-80 字节（dictEntry + key SDS + value SDS），1 亿占 6-8GB。差 500 倍。原因：Bitmap 用"位"表示一个用户的签到状态（1 bit），Hash 用"键值对"（数十字节）。Bitmap 的代价是"只存布尔状态"（是/否签到），不能存额外信息（如签到时间、签到渠道）。如果要存额外信息，Bitmap 不够，要用 Hash 或 Sorted Set。所以选 Bitmap 的前提是"只需存布尔状态 + 用户量大 + ID 连续"。这三条都满足时（如纯签到状态、UV 统计），Bitmap 是最优；否则要权衡。

### 第四层：方案权衡

**Q：Bitmap 的 BITCOUNT 统计 1 的个数（如统计活跃用户数），如果 Bitmap 巨大（10 亿 bit）会慢吗？**

会，BITCOUNT 是 O(N) 遍历所有字节，10 亿 bit = 125MB，遍历要数百毫秒（Redis 单线程，期间阻塞其他命令）。优化手段：一、分时段 Bitmap——每天一个 key（如 `active:20260713`），BITCOUNT 只统计当天，数据量小；二、BITCOUNT 加 start end 参数——只统计某字节范围，`BITCOUNT key 0 1000` 统计前 1000 字节；三、预计算——每天离线算好 BITCOUNT 存到一个 String 值，在线只读结果；四、HyperLogLog——如果只是统计基数（去重数）允许 0.81% 误差，HLL 固定 12KB，BITCOUNT 用 PFADD/PFCOUNT，远快于 Bitmap。所以"活跃统计"场景，要精确用分片 Bitmap + 预计算，要近似用 HLL。不要对巨型 Bitmap 直接 BITCOUNT。

**Q：为什么 HyperLogLog 只能统计基数（去重数），不能像 Bitmap 那样查"某用户是否活跃"？**

HLL 是概率算法，内部用"哈希 + 概率计数"估算基数，但不保存"哪些元素被加入"。HLL 的 `PFADD key user1` 把 user1 的哈希映射到寄存器，更新寄存器值，但 user1 这个身份被"消化"掉了——你无法从 HLL 反查"user1 是否在集合里"。Bitmap 保存每个 bit 的状态（0/1），可以 `GETBIT key offset` 查"用户 offset 是否活跃"。所以 HLL 适合"统计总数"（如 UV），Bitmap 适合"查询个体状态 + 统计总数"。如果要"查询个体 + 统计总数"，用 Bitmap 或 Set；只要"统计总数"且数据量大，HLL 最省内存。选型看需求：要查个体用 Bitmap/Set，只要总数用 HLL。

### 第五层：验证与沉淀

**Q：你怎么验证 Bitmap 的 SETBIT/GETBIT/BITCOUNT 在边界场景下正确？**

四类边界测试：一、offset=0——`SETBIT key 0 1` 后 `GETBIT key 0` 应返回 1；二、大 offset——`SETBIT key 1000000000 1`（10 亿），`STRLEN key` 应返回约 125MB（验证扩容）；三、跨字节——`SETBIT key 7 1` 和 `SETBIT key 8 1`（跨第 0 和第 1 字节），`BITCOUNT key` 应返回 2；四、清 bit——`SETBIT key 0 1` 后 `SETBIT key 0 0`，`GETBIT key 0` 应返回 0，`BITCOUNT key` 应返回 0。验证内存：`MEMORY USAGE key` 对比理论值（offset/8 字节）。线上监控：大 key 报警（Bitmap 可能因 ID 稀疏变成大 key），用 `redis-cli --bigkeys` 扫描。

**Q：这道题做完，你沉淀出了什么可复用的"位图状态存储"设计经验？**

三条经验：一、"布尔状态首选 Bitmap"——大量布尔标志（签到、在线、特征标记）用 Bitmap 比用 Hash/Set 省数百倍内存；二、"ID 要连续或可映射"——稀疏 ID 导致内存浪费，要先做 ID 映射到连续空间；三、"统计基数用 HLL，查个体用 Bitmap"——按需求选结构，不要混用。这套经验也适用于布隆过滤器（多 Hash 映射到 Bitmap 判存在性）、Bitfield（多字段位图）。Redis 的位运算家族（SETBIT/GETBIT/BITCOUNT/BITOP/BITFIELD）是高效状态存储的利器，遇到"海量布尔状态"场景优先考虑。


## 结构化回答

**30 秒电梯演讲：** Bitmap就是用String的每个bit来表示一个布尔值。setbit就是定位到某个字节再通过位运算（与/或）修改某一位，getbit就是读出来再移位取值。

**展开框架：**
1. **Bitmap不是独立类型** — Bitmap不是独立类型，基于String的位操作
2. **setbit** — 定位byte→位运算置1/清0，O(1)
3. **getbit** — 定位byte→移位取值，O(1)

**收尾：** 这块我踩过坑——要不要深入聊：Bitmap 和 Set 的内存对比？1亿用户签到各占多少内存？

## 视频脚本

> 预计时长：3 分钟 | 由浅入深

| 时间 | 画面/字幕 | 口播台词 | 讲解要点 |
|------|----------|----------|----------|
| 0:00 | 标题卡 | "Redis一句话：Bitmap就是用String的每个bit来表示一个布尔值。setbit就是定位到某个字节再通过位运算（与/或）修改某一位…。" | 开场钩子 |
| 0:15 | Redis Lua 脚本执行截图 | "Bitmap不是独立类型，基于String的位操作" | Bitmap不是独立类型 |
| 1:06 | Redis Lua 脚本执行截图分步演示 | "setbit: 定位byte到位运算置1/清0，O(1)" | setbit |
| 1:57 | 关键代码/伪代码片段 | "getbit: 定位byte到移位取值，O(1)" | getbit |
| 2:50 | 总结卡 | "核心抓住这条主线，下期咱们接着聊：Bitmap 和 Set 的内存对比？1亿用户签到各占多少内存。" | 收尾 |
