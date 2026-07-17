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
## 苏格拉底式面试追问

> 这组追问模拟面试官层层逼问，每一问先回答"为什么"，再回答"怎么做"，最后回答"如何证明"。

### 第一层：目标与动机

**Q：Redis 有 5 大基础类型 + 3 种特殊类型，你说 String 最通用，那为什么不所有场景都用 String？**

String 通用但非专用，特定场景用专用类型能省内存 + 提供原子操作。举例：存一个用户的所有字段，用 String 要把整个对象 JSON 序列化存一个 key，更新单个字段要"GET 反序列化→改→SET 序列化"，非原子且开销大；用 Hash（HSET user:1 name "abc"）每个字段独立，更新单字段是原子操作且无需反序列化。再如排行榜用 String 存要自己维护排序，用 Sorted Set（ZADD/ZRANGEBYSCORE）原生支持。所以专用类型的动机是"语义匹配 + 原子操作 + 内存优化"。String 适合"单值缓存"（如缓存一个 JSON、计数器），专用类型适合"结构化数据 + 复杂操作"。选型按数据结构和操作模式，不是图省事全用 String。

### 第二层：证据与定位

**Q：你怎么判断一个场景该用 Hash 还是 String 存对象？**

看"访问模式"。一、整体读写——如果总是整体读、整体写（如缓存一个商品详情页 JSON），用 String（一次 GET/SET，简单高效）；二、部分字段读写——如果经常读写单个字段（如更新用户昵称不改其他字段），用 Hash（HGET/HSET 单字段，避免整体反序列化）；三、字段数多少——字段少（< 10）且常整体访问用 String，字段多且部分访问用 Hash；四、过期需求——String 整体过期简单（EXPIRE key），Hash 整体过期也行但单字段不能独立过期（Redis 不支持 Hash field 级 TTL，除非用 RedisJSON 模块）。我的实践：缓存类（读多写少 + 整体读）用 String，业务对象（部分字段更新）用 Hash，没有"绝对标准"，按访问模式选。

### 第三层：根因深挖

**Q：Sorted Set 你说支持排行榜，底层是 Hash+跳表。但 List 也支持按顺序存储，为什么排行榜不用 List？**

List 是"插入顺序"存储（LPUSH/RPUSH 按插入位置），不支持"按 score 排序"。排行榜要按分数动态排序——用户分数变化后，排名实时更新。List 要实现这个要"每次分数变化就重新排序"，O(N logN) 且非原子。Sorted Set 原生按 score 排序——ZADD 时自动维护跳表顺序，ZREVRANGE 拿排名是 O(logN + M)（M 是返回数）。所以排行榜必须用 Sorted Set，List 只适合"消息队列"或"时间线"（按时间插入顺序）。混淆两者的常见错误：用 List 存"最近访问的 N 个商品"（正确，按时间序）、但用 List 存"热度排行"（错误，要按热度序）。

**Q：那为什么不用 Hash 存"用户→分数"，应用层排序？**

应用层排序的代价：一、每次查 TOP N 要把所有用户拉到应用层（百万用户就是百万条数据传输），网络带宽爆炸；二、排序在应用层 CPU 算，单机算力有限；三、不原子——用户分数更新（HINCRBY）和重新排序之间有时间窗口，并发更新乱序。Sorted Set 的优势：排序在 Redis 单线程内完成（原子），ZADD 更新分数即更新排名，ZREVRANGE 直接返回 TOP N（只传 N 条）。所以"用户量小（千以内）"可以用 Hash + 应用层排序，"用户量大（万以上）"必须用 Sorted Set 让 Redis 做排序。这是"把计算推到数据所在处"的设计原则——Redis 内排序避免数据搬迁。

### 第四层：方案权衡

**Q：Hash 存对象 vs JSON String 存对象，内存占用哪个小？**

取决于字段数和访问模式。Hash 用 ziplist/listpack 编码（小 Hash，字段数 ≤ 128 且单值 ≤ 64 字节）时，内存极省（紧凑连续存储，无指针开销），比 JSON String 小。但大 Hash（超阈值转 hashtable 编码）时，每个字段有 dictEntry + 两个 SDS（key 和 value），开销大，可能比 JSON String 还费。JSON String 是一段连续字符串，无 per-field 开销，但更新单字段要反序列化整体。所以：字段少（< 10）且整体访问——String 省内存 + 简单；字段多（> 10）且部分访问——Hash 的 listpack 编码省 + 原子更新；字段极多（> 128）——Hash 转 hashtable 可能反而费内存，要看实测。用 `MEMORY USAGE key` 对比，不要凭感觉。

**Q：为什么不用 RedisJSON 模块（Redis 7.0+）替代 String 存 JSON？它不是支持 JSON 路径操作吗？**

RedisJSON 确实强大——支持 `JSON.SET user:1 $.name "abc"` 按路径修改 JSON 字段，无需反序列化整体。优势：一、原子字段更新——改单个字段不读改写整体；二、类型检查——原生 JSON 类型，不用字符串存数字。劣势：一、模块依赖——RedisJSON 是 Redis Stack 的模块，开源 Redis 默认不含，要装模块或用 Redis Cloud；二、内存占用——JSON 树结构比扁平 String 费内存；三、兼容性——客户端库要支持 RedisJSON 命令。所以选型：如果已经用 Redis Stack/Cloud，RedisJSON 是存 JSON 对象的最优解；如果用开源 Redis 不想加模块，退而用 Hash 或 String。我的实践：新项目用 Redis Stack 直接上 RedisJSON，老项目保持 String/Hash。

### 第五层：验证与沉淀

**Q：你怎么验证不同数据类型在具体场景下的内存占用和性能？**

两类测试：一、内存对比——相同数据（如 100 万用户对象）分别用 String/Hash/JSON 存，`MEMORY USAGE` 或 `INFO memory` 对比 `used_memory`；二、性能对比——`redis-benchmark -t set,get,hset,hget,zadd,zrange -n 100000` 测各类型 QPS 和延迟。典型结论：String 计数器（INCR）QPS 最高（10万+），Hash HSET 稍低（8万），Sorted Set ZADD 再低（5万，跳表维护）。内存：小 Hash（listpack 编码）比 String JSON 省 30-50%，大 Hash（hashtable 编码）可能反超。这些基准数据用于选型决策。线上监控：`INFO memory` 看 used_memory 和 fragmentation_ratio（碎片率，>1.5 说明内存碎片多，要 jemalloc 调优）。

**Q：这道题做完，你沉淀出了什么可复用的 Redis 类型选型方法论？**

按数据结构和操作模式匹配类型：一、单值缓存——String（简单高效）；二、对象字段——Hash（部分字段原子更新）；三、列表/队列——List（FIFO 顺序）或 Stream（可靠队列）；四、集合/去重——Set（无序去重）；五、排行榜/排序——Sorted Set（按 score 排序）；六、布尔状态——Bitmap（省内存）；七、基数统计——HyperLogLog（固定 12KB）；八、地理位置——Geo（基于 ZSet）。这套匹配是 Redis 设计的核心——每种类型针对一类问题优化。面试遇到"用 Redis 存什么"，先问"数据结构是什么 + 操作是什么"，再选类型，不要无脑 String。


## 结构化回答

**30 秒电梯演讲：** Redis有5种核心数据结构，每种都针对特定场景优化了底层编码。String是最通用的，Hash适合存对象，List适合队列，Set适合集合运算，ZSet适合排行榜。

**展开框架：**
1. **5大基础类型** — String/Hash/List/Set/ZSet
2. **每种类型有小编码** — 每种类型有小编码(ziplist/intset)和大编码(hashtable/skiplist)两种
3. **String=缓存/计数** — String=缓存/计数/锁；Hash=对象；List=队列；Set=去重/集合运算；ZSet=排行榜/延迟队列

**收尾：** 这块我踩过坑——要不要深入聊：ZSet 为什么用跳表而不是红黑树？

## 视频脚本

> 预计时长：3 分钟 | 由浅入深

| 时间 | 画面/字幕 | 口播台词 | 讲解要点 |
|------|----------|----------|----------|
| 0:00 | 标题卡 | "Redis一句话：Redis有5种核心数据结构，每种都针对特定场景优化了底层编码。String是最通用的…。" | 开场钩子 |
| 0:15 | Redis Lua 脚本执行截图 | "5大基础类型：String/Hash/List/Set/ZSet" | 5大基础类型 |
| 1:06 | Redis Lua 脚本执行截图分步演示 | "每种类型有小编码(ziplist/intset)和大编码(hashtable/skiplist)两种" | 每种类型有小编码 |
| 1:57 | 关键代码/伪代码片段 | "String就是缓存/计数/锁；Hash就是对象；List就是队列；Set就是去重/集合运算；ZSet就是排行榜/延…" | String=缓存/计数 |
| 2:50 | 总结卡 | "核心抓住这条主线，下期咱们接着聊：ZSet 为什么用跳表而不是红黑树。" | 收尾 |
