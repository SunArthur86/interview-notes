---
id: note-xhs-db-010
difficulty: L3
category: database
subcategory: Redis
tags:
- Redis
- 数据类型
- String
- Hash
- List
- Set
- ZSet
feynman:
  essence: Redis有5种核心数据结构，每种都针对特定场景优化了底层编码。String是最通用的，Hash适合存对象，List适合队列，Set适合集合运算，ZSet适合排行榜。
  analogy: "想象一个工具箱：String是万能刀（啥都能干），Hash是收纳盒（分格放东西），List是传送带（有序进出），Set是筛子（去重+交集），ZSet是奖牌榜（排序+带分数）。"
  key_points:
  - 5大基础类型：String/Hash/List/Set/ZSet
  - 每种类型有小编码(ziplist/intset)和大编码(hashtable/skiplist)两种
  - String=缓存/计数/锁；Hash=对象；List=队列；Set=去重/集合运算；ZSet=排行榜/延迟队列
  - ZSet底层=跳表+字典，跳表O(logN)范围查询+字典O(1)成员查找
  - 特殊类型：Bitmap(签到)、HyperLogLog(UV去重)、Geo(位置)
first_principle:
  problem: "内存数据库需要高效存储和操作不同类型的数据，如何在有限内存中为不同数据形态选择最优结构？"
  axioms:
  - 数据量小时紧凑编码(ziplist)更省内存
  - 数据量大时标准结构(hashtable/skiplist)更高效
  - 有序+带分数的需求需要跳表(平衡查询和范围扫描)
  - 集合运算(交并差)需要hash表O(1)查找支撑
  rebuild: "从内存数据存储需求出发：K/V(String)→字段映射(Hash)→有序序列(List)→无序去重(Set)→有序带分(ZSet)，每种类型都提供了小数据量紧凑编码+大数据量高效编码的自适应切换"
follow_up:
- ZSet 为什么用跳表而不是红黑树？
- ziplist 和 hashtable 的转换阈值是什么？为什么有这个设计？
- Redis 的 Stream 和 List 做消息队列有什么区别？
- 如何用 Redis 实现延迟队列？有哪些方案？
---

# Redis 数据类型有哪些？各自的应用场景？（华为od Java一面）

## 一、五大基础数据类型

| 类型 | 底层结构 | 特点 | 典型场景 |
|------|---------|------|---------|
| **String** | SDS | 二进制安全，最大512MB | 缓存、计数器、分布式锁 |
| **Hash** | ziplist / hashtable | 字段-值映射 | 对象存储、商品信息 |
| **List** | quicklist (ziplist+链表) | 有序、可重复、双端操作 | 消息队列、最新列表 |
| **Set** | intset / hashtable | 无序、不可重复 | 标签、共同好友、去重 |
| **ZSet** | ziplist / skiplist+hash | 有序、不可重复、带分数 | 排行榜、延迟队列 |

## 二、String — 最常用

```bash
# 基本操作
SET key value [EX seconds]    # 设值+过期
GET key                       # 取值
INCR / DECR key               # 原子计数
SETEX key seconds value       # 设值+过期（原子）

# 应用场景
SET token:{token} {userId} EX 7200  # 会话管理
INCR article:read:{id}              # 阅读计数
SET lock:{resource} {uuid} NX EX 30 # 分布式锁
```

**底层 SDS (Simple Dynamic String)**：
```
struct sdshdr {
    int len;      // 已使用长度
    int free;     // 剩余空间
    char buf[];   // 字符数组（二进制安全）
}
```

## 三、Hash — 对象存储

```bash
# 基本操作
HSET user:1001 name "张三" age 25
HGET user:1001 name
HGETALL user:1001
HINCRBY user:1001 age 1

# 应用场景
HSET product:1001 name "iPhone" price 9999 stock 100  # 商品信息
```

**编码转换**：
- 元素数 ≤ 128 且单个值 ≤ 64字节 → **ziplist**（紧凑连续内存）
- 超过阈值 → **hashtable**（两层数组+链表）

## 四、List — 有序列表

```bash
# 基本操作
LPUSH list a b c    # 左插入 → [c, b, a]
RPUSH list d e      # 右插入 → [c, b, a, d, e]
LPOP list           # 左弹出 → c
LRANGE list 0 -1    # 查看全部
BLPOP list 30       # 阻塞左弹出（30秒超时）

# 应用场景
LPUSH messages:{uid} {msg}      # 消息队列
LRANGE messages:{uid} 0 9       # 最新10条消息
```

**底层 quicklist**：双向链表，每个节点是一个 ziplist，兼顾内存紧凑和快速增删。

## 五、Set — 集合运算

```bash
# 基本操作
SADD tags:1001 "Java" "Redis" "MySQL"
SMEMBERS tags:1001
SINTER set1 set2     # 交集
SUNION set1 set2     # 并集
SDIFF set1 set2      # 差集

# 应用场景
SADD user:tags:1001 "科技" "数码"        # 用户标签
SINTER user:tags:1001 user:tags:1002     # 共同标签
SADD daily:active:20260701 {uid}         # 日活去重
SCARD daily:active:20260701              # 日活人数
```

## 六、ZSet — 有序集合（高频考点）

```bash
# 基本操作
ZADD rank 100 "user1" 200 "user2" 150 "user3"
ZREVRANGE rank 0 2 WITHSCORES   # Top3
ZINCRBY rank 10 "user1"         # 加分

# 应用场景
ZADD leaderboard:game 9999 "player1"   # 排行榜
ZADD delay:tasks {timestamp} {taskId}  # 延迟队列
ZRANGEBYSCORE delay:tasks 0 {now}      # 获取到期任务
```

**底层 skiplist（跳表）**：
```
Level 3:  head ──────────────→ [20] ──────→ null
Level 2:  head ────→ [10] ──→ [20] ────→ [30] → null
Level 1:  head → [5] → [10] → [15] → [20] → [25] → [30] → null

查询 O(log n)，每个节点随机层数（概率p=0.25晋升）
同时维护 hash(dict) 实现O(1)查找成员→分数
```

## 七、三种特殊类型（了解）

| 类型 | 用途 |
|------|------|
| Bitmap | 签到、在线状态、布隆过滤器 |
| HyperLogLog | 基数统计（UV，误差0.81%，固定12KB） |
| Geo | 地理位置（基于ZSet，GeoHash编码） |