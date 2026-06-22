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
