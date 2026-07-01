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