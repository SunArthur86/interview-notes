---
id: note-dd-sl-008
difficulty: L4
category: system-design
subcategory: 分布式
tags:
- 滴滴
- 面经
- 短链系统
- 分库分表
- 路由
feynman:
  essence: 分库分表后，需要一个路由层记录短码到哪个分库分表的映射关系。
  analogy: 就像商场分区导览图——你知道店名但不知道在哪个楼层，路由表就是那个导览图。
  first_principle: 分片后数据分布在多个节点，查询必须先定位到正确节点。
  key_points:
  - 哈希路由（hash%N）
  - 一致性哈希
  - 路由表（元数据映射）
  - 路由缓存
first_principle:
  essence: 分布式系统的核心问题：数据定位
  derivation: 数据分片→需要定位→路由表存储分片元信息→查询时先查路由→再去目标分片
  conclusion: 路由表是分库分表架构的元数据中枢
follow_up:
- 路由表本身会不会成为瓶颈？
- 扩容时路由表怎么迁移？
- 路由表和一致性哈希哪个更好？
memory_points:
- 一句话定义：路由表就是“短码→分片节点”的显式映射中枢，决定数据读写物理位置
- 核心对比：哈希路由是“计算得出”而路由表是“查询得出”，路由表以极小计算开销换取灵活扩展
- 扩容优势：哈希取模扩容需迁移近全量数据，而路由表扩容只改部分记录指向，无需全量重算
- 适用场景：哈希定死规划，一致性Hash平滑扩容，路由表极致灵活细粒度可控，范围分片利于区间查询
---

# 【滴滴面经】短链接数据分片之后，你又加了路由表，这个路由表具体是什么概念？

## 一、什么是路由表？

路由表是分库分表架构中的**元数据映射中枢**——它记录了每一条数据（或每一类 Key）应该存储在哪个物理分片上，使得查询时能**精确定位**到目标节点。

在短链系统中，短链数据按短码（ShortCode）分片存储到多个数据库实例。当一条查询请求到来时，系统必须知道这个短码对应的数据在哪台机器上，这个"查找"过程就是路由。

> **面试回答的一句话定义**：路由表就是"短码 → 分片节点"的映射关系，它决定了数据写在哪里、从哪里读。

---

## 二、四种主流路由策略对比

### 2.1 哈希取模路由（Hash % N）

**原理**：对分片 Key 做 Hash 后对分片数取模，直接得到目标分片号。

```java
int shardIndex = Math.abs(shortCode.hashCode()) % shardCount;
// 例如：hash("aB3xK9") % 16 = 7 → 第7号分片
```

**优点**：计算简单，O(1) 定位，数据分布均匀。

**致命缺点**：**扩容噩梦**——从 16 个分片扩到 32 个分片时，约 **87.5% 的数据需要重新迁移**（几乎全部打乱重排）。

| 分片数变化 | 数据迁移比例 |
|-----------|------------|
| 16 → 17 | ~94%（几乎所有数据） |
| 16 → 32 | ~50%（翻倍扩容是最优情况） |

> **适用场景**：分片数固定不变、可提前规划的系统。

---

### 2.2 一致性哈希路由（Consistent Hashing）

**原理**：将整个哈希空间组织成一个虚拟圆环（0 ~ 2³²），节点和 Key 都映射到环上，Key 顺时针找到的第一个节点即为所属分片。

```
          0
     ┌────┴────┐
   Node_A    Node_C
     |          |
   Node_D    Node_B
     └────┬────┘
        2^32

Key hash → 顺时针找最近节点
```

**优点**：扩容/缩容时**只影响相邻节点**的数据，迁移量最小（约 1/N）。

**改进**：引入**虚拟节点（Virtual Node）**，每个物理节点对应 150-200 个虚拟节点，解决数据倾斜问题。

```java
// 一致性哈希路由核心实现
TreeMap<Integer, String> ring = new TreeMap<>(); // hashPoint → node

public String route(String key) {
    int hash = hash(key);
    // 顺时针找到第一个 >= hash 的虚拟节点
    SortedMap<Integer, String> tail = ring.tailMap(hash);
    int targetPoint = tail.isEmpty() ? ring.firstKey() : tail.firstKey();
    return ring.get(targetPoint);
}
```

**缺点**：数据分布不完全均匀（即使有虚拟节点），范围查询困难。

---

### 2.3 路由表路由（Routing Table — 本题核心）

**原理**：维护一张**显式的映射表**，记录每个 Key（或 Key 前缀/段）对应的目标分片。

```
┌──────────────────────────────────────────────────┐
│              路由表 (Routing Table)                │
├──────────────┬────────────┬───────────┬──────────┤
│ shortCode    │ shard_id   │ db_index  │ tbl_index│
├──────────────┼────────────┼───────────┼──────────┤
│ aB3xK9       │ shard_03   │ db_01     │ tbl_03   │
│ xK7mP2       │ shard_07   │ db_03     │ tbl_07   │
│ qW8nL5       │ shard_12   │ db_06     │ tbl_12   │
│ ...          │ ...        │ ...       │ ...      │
└──────────────┴────────────┴───────────┴──────────┘
```

**核心特征**：

- **显式映射**：不是靠算法计算，而是靠查表定位。
- **灵活可控**：可以手动调整任意 Key 的分片位置，支持细粒度迁移。
- **扩展性好**：扩容时只迁移路由表中部分记录的指向，不需要全量重算。

> **和哈希路由的本质区别**：哈希路由是"计算得出"，路由表是"查询得出"。路由表牺牲了一点计算开销，换来的是**极致的灵活性**。

---

### 2.4 范围分片路由（Range Sharding）

**原理**：按 Key 的值范围划分分片。

```
shortCode 范围          → 分片
─────────────────────────────────
0000000 ~ 1FFFFFFF     → shard_0
2000000 ~ 3FFFFFFF     → shard_1
4000000 ~ 5FFFFFFF     → shard_2
...
```

**优点**：范围查询高效（连续 Key 在同一分片）。

**缺点**：热点问题严重——如果短码是自增 ID，新创建的短链全部落在最后一个分片。

---

### 2.5 四种策略横向对比

| 维度 | 哈希取模 | 一致性哈希 | 路由表 | 范围分片 |
|------|---------|-----------|--------|---------|
| 定位速度 | O(1) 计算 | O(logN) 计算 | O(1) 查表 | O(1) 判断 |
| 扩容迁移量 | ~100% | ~1/N | **按需精确** | 范围分裂 |
| 数据均匀性 | 好 | 较好 | 完全可控 | 易倾斜 |
| 灵活性 | 低 | 中 | **最高** | 中 |
| 实现复杂度 | 低 | 中 | 高 | 低 |
| 范围查询 | 不支持 | 不支持 | 需扫描表 | **原生支持** |

---

## 三、路由表的架构设计

### 3.1 整体架构图

```
                        ┌─────────────────────┐
                        │   客户端请求          │
                        │   GET /aB3xK9       │
                        └──────────┬──────────┘
                                   │
                        ┌──────────▼──────────┐
                        │   API Gateway        │
                        └──────────┬──────────┘
                                   │
                    ┌──────────────▼──────────────┐
                    │       应用服务层               │
                    │  ┌───────────────────────┐  │
                    │  │   Routing Engine       │  │
                    │  │                        │  │
                    │  │  1. 查 Local Route     │  │ ← JVM 本地缓存路由表
                    │  │     Cache(Caffeine)    │  │
                    │  │       ↓ miss           │  │
                    │  │  2. 查 Redis Route     │  │ ← 分布式缓存路由表
                    │  │     Cache              │  │
                    │  │       ↓ miss           │  │
                    │  │  3. 查 MetaDB          │  │ ← MySQL 元数据库
                    │  │     (路由表持久化)       │  │
                    │  └───────────────────────┘  │
                    └──────────────┬──────────────┘
                                   │ 获取 shard_id=db_01_tbl_03
                                   │
              ┌─────────┬──────────┼──────────┬─────────┐
              ▼         ▼          ▼          ▼         ▼
          ┌──────┐ ┌──────┐  ┌──────┐  ┌──────┐  ┌──────┐
          │DB_00 │ │DB_01 │  │DB_02 │  │DB_03 │  │DB_04 │  ...分片集群
          │tbl_00│ │tbl_03│  │      │  │tbl_07│  │      │
          └──────┘ └──┬───┘  └──────┘  └──────┘  └──────┘
                      │ 命中目标分片
                      ▼
                   返回短链数据
```

### 3.2 路由表数据结构

**持久化层（MySQL MetaDB）**：

```sql
CREATE TABLE route_table (
    short_code    VARCHAR(16) PRIMARY KEY COMMENT '短码',
    shard_key     VARCHAR(32) NOT NULL    COMMENT '分片标识，如 db_01_tbl_03',
    db_index      TINYINT     NOT NULL    COMMENT '库序号 0-15',
    table_index   TINYINT     NOT NULL    COMMENT '表序号 0-15',
    create_time   DATETIME    DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_shard (shard_key)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb8;
```

**缓存层（Redis）**：

```
Key:   route:{shortCode}      例: route:aB3xK9
Value: db_01_tbl_03           (JSON 或紧凑字符串)
TTL:   永不过期（或 24h 兜底）
```

**本地缓存层（Caffeine）**：

```java
Cache<String, ShardInfo> routeCache = Caffeine.newBuilder()
    .maximumSize(1_000_000)       // 100万条路由
    .expireAfterWrite(60, TimeUnit.SECONDS)  // 60s 刷新
    .build();
```

---

## 四、Java 代码实现

### 4.1 路由引擎核心

```java
public class RoutingEngine {

    // L1: 本地缓存
    private final Cache<String, ShardInfo> localCache;
    // L2: Redis 分布式缓存
    private final RedisTemplate<String, ShardInfo> redisTemplate;
    // L3: MetaDB 持久化路由表
    private final RouteTableMapper routeTableMapper;

    public RoutingEngine(RedisTemplate<String, ShardInfo> redisTemplate,
                         RouteTableMapper routeTableMapper) {
        this.redisTemplate = redisTemplate;
        this.routeTableMapper = routeTableMapper;
        this.localCache = Caffeine.newBuilder()
                .maximumSize(1_000_000)
                .expireAfterWrite(60, TimeUnit.SECONDS)
                .build();
    }

    /**
     * 路由查询：三级缓存穿透
     */
    public ShardInfo route(String shortCode) {
        // L1: 本地缓存
        ShardInfo shard = localCache.getIfPresent(shortCode);
        if (shard != null) {
            return shard;
        }

        // L2: Redis 缓存
        String redisKey = "route:" + shortCode;
        shard = redisTemplate.opsForValue().get(redisKey);
        if (shard != null) {
            localCache.put(shortCode, shard);
            return shard;
        }

        // L3: MetaDB 查询（兜底）
        RouteEntity entity = routeTableMapper.selectByShortCode(shortCode);
        if (entity == null) {
            throw new RouteNotFoundException("No route for: " + shortCode);
        }

        shard = new ShardInfo(entity.getDbIndex(), entity.getTableIndex());

        // 回填 L2 和 L1
        redisTemplate.opsForValue().set(redisKey, shard, 24, TimeUnit.HOURS);
        localCache.put(shortCode, shard);

        return shard;
    }
}
```

### 4.2 分片定位与数据访问

```java
public class ShardingDataSource {

    private final Map<Integer, DataSource> dbDataSources;  // dbIndex → DataSource
    private final RoutingEngine routingEngine;

    /**
     * 根据短码获取对应的数据源连接
     */
    public Connection getConnection(String shortCode) throws SQLException {
        ShardInfo shard = routingEngine.route(shortCode);
        DataSource ds = dbDataSources.get(shard.getDbIndex());
        return ds.getConnection();
    }

    /**
     * 构建分表名的实际表名
     */
    public String getTableName(String shortCode) {
        ShardInfo shard = routingEngine.route(shortCode);
        return String.format("short_url_%04d", shard.getTableIndex());
    }
}
```

### 4.3 短链创建时写入路由表

```java
@Transactional(rollbackFor = Exception.class)
public String createShortUrl(String longUrl, Long userId) {
    // 1. 生成短码
    String shortCode = shortCodeGenerator.generate();

    // 2. 计算分片位置（可结合哈希路由 + 负载均衡策略）
    int dbIndex = pickDbIndex(shortCode);       // 基于负载选择
    int tableIndex = pickTableIndex(shortCode);

    // 3. 写入路由表（先写路由表）
    RouteEntity route = new RouteEntity();
    route.setShortCode(shortCode);
    route.setDbIndex(dbIndex);
    route.setTableIndex(tableIndex);
    routeTableMapper.insert(route);

    // 4. 写入实际数据到目标分片
    ShardInfo shard = new ShardInfo(dbIndex, tableIndex);
    String tableName = String.format("short_url_%04d", tableIndex);
    shortUrlMapper.insertToShard(tableName, shortCode, longUrl, userId);

    // 5. 预热路由缓存
    redisTemplate.opsForValue().set("route:" + shortCode, shard, 24, TimeUnit.HOURS);

    return shortCode;
}
```

---

## 五、路由表的缓存策略

### 5.1 三级缓存模型

```
L1 Caffeine(JVM内存)  ──→  L2 Redis(分布式)  ──→  L3 MetaDB(MySQL)

延迟:    ~0.01ms              ~0.5ms              ~3ms
容量:    ~100万条             ~5000万条           无限
命中率:  80-90%               95%+                兜底
```

### 5.2 缓存更新策略

- **写时更新（Write-Through）**：创建短链时同步写入路由表和缓存。
- **定时全量刷新**：凌晨低峰期，从 MetaDB 全量加载路由表到 Redis（防止缓存丢失）。
- **Pub/Sub 广播**：路由表变更时通过 Redis Pub/Sub 通知所有应用节点更新本地缓存。

---

## 六、扩容迁移方案

### 6.1 双写迁移法（推荐）

```
扩容前: 16分片 → 扩容后: 32分片

Step 1: 开启双写（新数据同时写旧路由和新路由表）
Step 2: 灰度迁移旧数据（按 shortCode 范围，分批迁移 1/32）
Step 3: 校验数据一致性（对账程序）
Step 4: 切换读取到新路由表
Step 5: 下线旧分片
```

### 6.2 路由表迁移的优势

- **精确控制**：可以逐条迁移，每条只改路由指向，不搬数据（因为数据本身不动，只是路由表指向新的分片）。
- **可灰度**：按用户、按时间灰度切换。
- **可回滚**：如果新分片出问题，只需改回路由表指向即可。

> **面试金句**："路由表的最大价值在于**将数据迁移从物理搬移变成了指针调整**——这是它比纯哈希路由优越的地方。"

---

## 七、面试加分项

### 7.1 路由表 vs 一致性哈希的选择

| 场景 | 推荐方案 | 原因 |
|------|---------|------|
| 数据量大、扩容频繁 | 路由表 | 精确迁移，可灰度 |
| 数据量中等、分片固定 | 哈希取模 | 简单高效 |
| 节点动态增减 | 一致性哈希 | 自动重平衡 |
| 需要运维可控 | 路由表 | 人工干预灵活 |

### 7.2 路由表的高可用

- **MetaDB 主从复制**：路由表元数据库做主从，避免单点。
- **全量缓存兜底**：应用启动时从 MetaDB 全量加载路由到本地，即使 MetaDB 挂了也能靠缓存继续运行。
- **配置中心（Apollo / Nacos）**：路由表变更推送通过配置中心实现。

### 7.3 混合路由策略

实际生产中常用**混合方案**：

```
短码前2位 → 范围分片确定 db_index
短码后6位 → 哈希取模确定 table_index
路由表    → 记录异常情况和手动调整
```

这样兼顾了计算效率和灵活性。

---

## 八、总结

> "路由表是分库分表后的**元数据中枢**。它的本质是一张显式的映射表，记录了每条数据对应的物理分片位置。
>
> 相比哈希取模和一致性哈希，路由表最大的优势是**灵活性**——扩容时不需要全量数据迁移，只需要修改路由指向；运维时可以精确控制每条数据的分片位置。
>
> 在实现上，路由表配合三级缓存（Caffeine + Redis + MetaDB）可以做到 **<0.1ms 的平均路由延迟**，完全不会成为系统瓶颈。核心设计要点是：路由表持久化在 MetaDB、热数据缓存在 Redis、高频路由缓存到 JVM 本地，并通过 Pub/Sub 保证缓存一致性。"

## 记忆要点

- 一句话定义：路由表就是“短码→分片节点”的显式映射中枢，决定数据读写物理位置
- 核心对比：哈希路由是“计算得出”而路由表是“查询得出”，路由表以极小计算开销换取灵活扩展
- 扩容优势：哈希取模扩容需迁移近全量数据，而路由表扩容只改部分记录指向，无需全量重算
- 适用场景：哈希定死规划，一致性Hash平滑扩容，路由表极致灵活细粒度可控，范围分片利于区间查询


## 苏格拉底式面试追问

> 这组追问模拟面试官层层逼问，每一问先回答"为什么"，再回答"怎么做"，最后回答"如何证明"。

### 第一层：目标与动机

**Q：分库分表后你已经用 hash 取模路由了（short_code % 64 = 表号），为什么还要单独搞个"路由表"？**

因为 hash 取模扩容时数据迁移代价巨大。hash 取模 short_code % 64，如果要扩到 128 张表，short_code % 128 的结果与 % 64 完全不同，几乎每条数据都要重新分布——迁移近全量数据。路由表是显式映射（short_code → 物理表号），扩容时只把"需要迁移的记录"在路由表里改指向（如把部分记录从表 1 指向表 65），不用全量重算 hash。决策依据：预期会扩容 + 数据量大（迁移成本高），用路由表换扩容灵活性。hash 取模适合"数据量稳定、不扩容"的场景。

### 第二层：证据与定位

**Q：用户访问短链报"找不到数据"，但短链确实存在，你怎么定位是路由表错误还是数据丢失？**

查路由表 + 物理表：
1. 路由表——查路由表里 short_code 对应的物理表号（如表 17）。
2. 物理表——去表 17 查 `SELECT * FROM short_link_17 WHERE short_code = ?`。如果有数据，是路由对了但查询逻辑有 bug；如果没数据，查其他 63 张表确认数据是否在别的表（路由表指向错误）。
3. 创建记录——查短链创建日志，确认创建时写入的是哪张表，与路由表当前指向是否一致。

### 第三层：根因深挖

**Q：路由表指向表 17，但数据实际在表 23，根因是什么？**

最可能是扩容迁移时路由表没同步更新。扩容流程应该是：迁移数据（从表 17 复制到表 23）→ 更新路由表（指向表 23）→ 删除旧数据（表 17 的记录）。如果流程执行到一半中断（迁移完成但路由表没更新，或路由表更新了但旧数据没删），就会出现路由表与实际数据位置不一致。根因是扩容流程不是原子的，中间失败导致状态不一致。要查扩容任务日志，确认哪一步失败。

**Q：为什么不直接用一致性哈希（consistent hashing）替代路由表，扩容时只迁移少量数据且不用维护路由表？**

一致性哈希确实是扩容友好的方案——增减节点时只影响相邻区间的数据（迁移量 = 总数据 / 节点数），比 hash 取模好很多。但一致性哈希的局限是：① 数据分布不均（虚拟节点缓解但不消除）；② 查询要计算 hash 环定位（比直接查路由表略慢，虽然也是 O(1)）；③ 无法精细控制某条数据的物理位置（路由表可以手动调整某条数据的归属）。路由表的优势是"绝对灵活"——可以按业务需要把"热点短链"集中到高性能节点、"冷短链"放到廉价存储。一致性哈希是"自动均衡"，路由表是"精细控制"。短链数据量极大且无特殊分布需求时，一致性哈希更简单；有精细控制需求时用路由表。

### 第四层：方案权衡

**Q：路由表本身会不会成为瓶颈（每次查询都要先查路由表）？**

不会，因为路由表可以缓存。路由表是"短码 → 表号"的映射，表号只有 64 个（或 128 个），实际是"短码 → 0-63 的整数"。两种优化：① 路由表很小（64 个表号），可以全量加载到内存（Map），查询 O(1) 内存访问；② 如果路由是"按 hash 分段"（如 short_code hash 的前 6 bit 决定表号），就是计算而非查询，零开销。真正的"显式路由表"（每条数据一行映射记录）数据量大时才需要缓存/分片。短链场景通常用"hash 取模 + 配置化表号映射"，路由查询是纯计算，无瓶颈。

**Q：为什么不直接用 TiDB（分布式数据库）替代 MySQL 分库分表 + 路由表，它自动分布式？**

因为成本和成熟度。TiDB 是优秀的分布式数据库，自动分片 + 强一致 + SQL 兼容，但① 成本高——TiDB 要至少 3 个 PD + 3 个 TiKV + 若干 TiDB 节点，硬件成本远高于 MySQL 主从；② 延迟——TiDB 的分布式事务延迟（Raft 复制）比 MySQL 单机事务高 2-5 倍，短链场景对延迟敏感；③ 运维复杂——TiDB 集群的运维（扩缩容、版本升级、故障排查）比 MySQL 复杂。对于"KV 查询为主 + 高 QPS + 低延迟"的短链场景，MySQL 分库分表 + Redis 缓存是性价比最高的方案。TiDB 适合"数据量超大 + 复杂 SQL + 强一致"的场景（如交易、对账），不是所有分布式场景都该用 TiDB。

### 第五层：验证与沉淀

**Q：你怎么证明路由表的正确性（每条数据都能被正确定位）？**

对账 + 校验：
1. 全量对账——定时（每天）遍历所有物理表，对每条数据验证"路由表指向的表号 == 数据实际所在表号"，不一致告警。
2. 查询成功率——线上短链跳转的 404 率（排除真正不存在的短链），异常升高说明路由错误。
3. 扩容演练——定期（每季度）模拟扩容（迁移一批数据 + 更新路由表），验证扩容流程的正确性和耗时。

**Q：分库分表 + 路由表的架构怎么沉淀？**

1. 分片中间件——用 ShardingSphere 或自研分片层，封装"路由计算 + 跨表查询合并"，业务层无感知分库分表。
2. 扩容工具——把"数据迁移 + 路由更新 + 旧数据清理"自动化成扩容工具，一键扩容，避免手动操作出错。
3. 路由策略规范——制定"什么时候用 hash 取模、什么时候用一致性哈希、什么时候用路由表"的决策框架，团队统一。


## 结构化回答

**30 秒电梯演讲：** 分库分表后，需要一个路由层记录短码到哪个分库分表的映射关系。打个比方，就像商场分区导览图——你知道店名但不知道在哪个楼层，路由表就是那个导览图。

**展开框架：**
1. **一句话定义** — 路由表就是“短码→分片节点”的显式映射中枢，决定数据读写物理位置
2. **核心对比** — 哈希路由是“计算得出”而路由表是“查询得出”，路由表以极小计算开销换取灵活扩展
3. **扩容优势** — 哈希取模扩容需迁移近全量数据，而路由表扩容只改部分记录指向，无需全量重算

**收尾：** 这块我踩过坑——要不要深入聊：路由表本身会不会成为瓶颈？

## 视频脚本

> 预计时长：4 分钟 | 由浅入深

| 时间 | 画面/字幕 | 口播台词 | 讲解要点 |
|------|----------|----------|----------|
| 0:00 | 标题卡 | "分布式一句话：分库分表后，需要一个路由层记录短码到哪个分库分表的映射关系。" | 开场钩子 |
| 0:15 | 缓存读写策略流程图 | "一句话定义：路由表就是“短码到分片节点”的显式映射中枢，决定数据读写物理位置" | 一句话定义 |
| 1:08 | 缓存读写策略流程图分步演示 | "核心对比：哈希路由是“计算得出”而路由表是“查询得出”，路由表以极小计算开销换取灵活扩展" | 核心对比 |
| 2:01 | 关键代码/伪代码片段 | "扩容优势：哈希取模扩容需迁移近全量数据，而路由表扩容只改部分记录指向，无需全量重算" | 扩容优势 |
| 2:54 | 对比表格 | "适用场景：哈希定死规划，一致性Hash平滑扩容，路由表极致灵活细粒度可控，范围分片利于区间查询" | 适用场景 |
| 3:50 | 总结卡 | "核心抓住这条主线，下期咱们接着聊：路由表本身会不会成为瓶颈。" | 收尾 |
