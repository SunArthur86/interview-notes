---
id: note-dd-sl-010
difficulty: L4
category: system-design
subcategory: 高并发
tags:
- 滴滴
- 面经
- 短链系统
- 分库分表
- 查询优化
feynman:
  essence: 64张表的全表扫描是性能灾难，必须用并发查询+结果合并或预聚合来解决。
  analogy: 就像在64个仓库里找一个客户的货物——逐个翻找太慢，要么同时派人去找，要么提前整理好清单。
  first_principle: 分布式查询优化 = 减少扫描节点数 × 增加查询并发度 × 缩小扫描范围。
  key_points:
  - 并发查询64张表+合并
  - 引入用户维度路由表
  - 数据冗余（用户ID+短码双写）
  - 冷热分离
first_principle:
  essence: 分布式查询的并行化+局部化
  derivation: 64表串行→延迟64x→并发查询→延迟=Max(单表)→引入用户索引表→只查1张表
  conclusion: 最优解是改变分片策略让同用户数据落在同一分片
follow_up:
- 并发查询64张表会不会耗尽连接池？
- 一张表也存不下怎么办？
- 这种极端情况出现的概率多大？
---

# 【滴滴面经】极端情况下，一个用户的短链可能分布在 64 张表里，这种情况下怎么提升查询性能？

## 一、问题背景分析

短链系统通常以短码（short\_code）作为分片键进行水平拆分——对 `short_code` 做 hash 取模路由到 64 张表。这在"通过短码查长链"的正向查询场景下是高效的，O(1) 定位到具体表。

但反向查询"某用户创建过哪些短链"时，因为数据是按 `short_code` 而非 `user_id` 分片的，该用户的短链可能散落在全部 64 张表中。如果**串行扫描 64 张表，延迟将是单表查询的 64 倍**，这在 P99 延迟要求 < 100ms 的线上系统中是不可接受的。

本质问题：**分片键（short\_code）与查询维度（user\_id）不匹配**，产生了"分布式全表扫描"。

## 二、方案一：CompletableFuture 并发查询 + 结果合并

最直接的方案——把 64 次串行查询变成并行查询，延迟从 `Σ(单表)` 降为 `Max(单表)`。

```java
/**
 * 并发查询64张表，合并结果
 */
public List<ShortLink> queryByUserId(Long userId) {
    List<CompletableFuture<List<ShortLink>>> futures = new ArrayList<>();

    for (int i = 0; i < 64; i++) {
        final int tableIndex = i;
        CompletableFuture<List<ShortLink>> future = CompletableFuture.supplyAsync(
            () -> shortLinkMapper.selectByUserId(tableIndex, userId),
            queryThreadPool  // ⚠️ 必须使用独立线程池
        );
        futures.add(future);
    }

    // 等待全部完成
    CompletableFuture.allOf(futures.toArray(new CompletableFuture[0])).join();

    // 合并 + 排序
    return futures.stream()
        .map(CompletableFuture::join)
        .flatMap(List::stream)
        .sorted(Comparator.comparing(ShortLink::getCreateTime).reversed())
        .collect(Collectors.toList());
}
```

**分页查询优化**——各表只取前 N 条，合并后再全局排序截取：

```java
public List<ShortLink> queryByUserIdPaged(Long userId, int pageNum, int pageSize) {
    List<CompletableFuture<List<ShortLink>>> futures = new ArrayList<>();

    for (int i = 0; i < 64; i++) {
        final int tableIndex = i;
        // 每张表只取 pageSize 条（浅分页足够，深分页需放大倍数）
        futures.add(CompletableFuture.supplyAsync(() ->
            shortLinkMapper.selectByUserIdPaged(tableIndex, userId, pageNum, pageSize),
            queryThreadPool
        ));
    }

    CompletableFuture.allOf(futures.toArray(new CompletableFuture[0])).join();

    return futures.stream()
        .map(CompletableFuture::join)
        .flatMap(List::stream)
        .sorted(Comparator.comparing(ShortLink::getCreateTime).reversed())
        .skip((long) (pageNum - 1) * pageSize)
        .limit(pageSize)
        .collect(Collectors.toList());
}
```

### 关键注意事项

| 要点 | 说明 |
|------|------|
| **线程池隔离** | 必须使用独立线程池（如核心 64、最大 128），不能复用业务线程池，否则 64 个并发任务耗尽公共线程池导致其他服务阻塞 |
| **连接池容量** | 64 个并发查询需要 64 个 DB 连接，HikariCP 的 `maximumPoolSize` 需调大到 70+（预留 buffer） |
| **超时控制** | 使用 `orTimeout(200, TimeUnit.MILLISECONDS)` 防止单表慢查询拖垮整体响应 |
| **分页放大** | 深分页时各表需多取数据，存在内存放大效应。建议改用**游标分页**（基于 `create_time` 的 WHERE 条件翻页） |

## 三、方案二：用户索引表（推荐）

**核心思想**：建立一张以 `user_id` 为分片键的索引表，存储 `user_id → short_code` 的映射，将 64 表全扫描降维到只扫描用户实际涉及的少数几张表。

```sql
-- 用户索引表（按 user_id hash 分片，同一个用户的记录落在同一张表）
CREATE TABLE t_short_link_user_index (
    id          BIGINT PRIMARY KEY,
    user_id     BIGINT NOT NULL,
    short_code  VARCHAR(16) NOT NULL,
    create_time DATETIME NOT NULL,
    INDEX idx_user_time (user_id, create_time)
);
```

查询变为两步走：

```java
public List<ShortLink> queryByUserIdOptimized(Long userId) {
    // Step1: 从索引表精确查询（命中1张表，O(1)）
    List<String> shortCodes = userIndexMapper.selectByUserId(userId);

    if (shortCodes.isEmpty()) {
        return Collections.emptyList();
    }

    // Step2: 按short_code分组路由到各分片表，批量查询
    Map<Integer, List<String>> groupedByTable = shortCodes.stream()
        .collect(Collectors.groupingBy(this::getTableIndex));

    // 通常只有1~3张表需要查询
    List<CompletableFuture<List<ShortLink>>> futures = new ArrayList<>();
    groupedByTable.forEach((tableIndex, codes) -> {
        futures.add(CompletableFuture.supplyAsync(() ->
            shortLinkMapper.selectByCodes(tableIndex, codes),
            queryThreadPool
        ));
    });

    CompletableFuture.allOf(futures.toArray(new CompletableFuture[0])).join();

    return futures.stream()
        .map(CompletableFuture::join)
        .flatMap(List::stream)
        .collect(Collectors.toList());
}
```

**优势**：扫描表数从 64 → 1\~3，连接开销大幅降低。索引表数据量小（只有 user\_id + short\_code），查询极快。

## 四、方案三：数据冗余双写

更进一步——主表按 `short_code` 分片，同时维护一份按 `user_id` 分片的完整冗余副本。两份数据用不同维度分片，各自最优。

```
写流程：用户创建短链 → 写主表 → 发MQ → 异步写冗余表
读流程：按user_id查 → 直接读user_id分片表（O(1)命中单表）
```

```java
@Service
public class ShortLinkService {

    @Transactional(rollbackFor = Exception.class)
    public void createShortLink(ShortLink link) {
        // 写主表（按short_code分片）
        shortLinkMapper.insert(calcCodeTableIndex(link.getShortCode()), link);

        // 发送MQ异步双写到冗余表（按user_id分片）
        mqProducer.send("short-link-dual-write", link);
    }
}

// 冗余表消费者（独立监听器类）
@Component
@RocketMQMessageListener(topic = "short-link-dual-write", consumerGroup = "dual-write-group")
public class DualWriteConsumer implements RocketMQListener<ShortLink> {
    @Autowired
    private UserLinkMapper userLinkMapper;

    @Override
    public void onMessage(ShortLink link) {
        userLinkMapper.insert(calcUserTableIndex(link.getUserId()), link);
    }
}
```

**权衡**：双写引入一致性问题。主表写成功但 MQ 消费失败时需要补偿——通过**定时对账任务**比对两表差异并修复。

## 五、方案四：冷热分离

历史短链访问频率极低（帕累托分布：80% 请求集中在最近 7 天的短链）。将冷数据归档到冷存储（HBase / Elasticsearch），热表只保留近期数据，进一步缩小扫描范围。

## 六、性能对比表

| 方案 | 查询表数 | P99 延迟 | 开发成本 | 一致性风险 | 适用场景 |
|------|---------|---------|---------|-----------|---------|
| 串行全扫 64 表 | 64 | \~640ms | 低 | 无 | 临时方案/数据量极小 |
| CompletableFuture 并发查 | 64 | \~15ms | 中 | 无 | 中等规模、连接池充足 |
| 用户索引表 | 1\~3 | \~5ms | 中 | 低（需维护索引一致性） | **推荐**，通用最优解 |
| 数据冗余双写 | 1 | \~3ms | 高 | 中（双写一致性） | 高并发、强查询需求 |
| 冷热分离 + 索引表 | 1\~3 | \~3ms | 高 | 低 | 超大规模、数据量 TB 级 |

**演进路径建议**：先用并发查询快速止血 → 再加索引表做根本优化 → 流量继续增长时引入双写/冷热分离。

## 七、面试加分点

1. **布隆过滤器前置**：查询前先用 BloomFilter 快速判断 user\_id 是否存在短链记录，命中才查 DB，避免空查 64 张表的无效开销。
2. **根本解法——双分片键设计**：写入时同时按 user\_id 和 short\_code 各写一份路由信息，读时按需选择分片键路由。这是分布式系统 SaaS 化的通用方案。
3. **连接池隔离回答 follow-up**："并发查 64 表会不会耗尽连接池？会。所以更推荐索引表方案，将并发表数从 64 降到 1\~3，连接压力骤降。"
4. **异步并行校验**：如果某些校验规则之间无依赖关系，可以进一步用 `CompletableFuture.anyOf` 做并行而非串行链。
