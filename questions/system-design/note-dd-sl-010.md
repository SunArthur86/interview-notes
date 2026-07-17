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
memory_points:
- 核心思路：把64表串行扫描变并发查询，因为串行是64倍延迟，所以并行降至Max(单表)延迟
- 并发控权：必须配独立线程池+调大HikariCP连接池(>64)，否则耗尽资源拖垮全系统
- 分页优化：各表只取前N条合并，深分页必须改用游标分页(WHERE create_time < ?)防内存溢出
- 终极方案：并发查询治标，新建用户维度(user_id)索引表才是治本首选
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

## 记忆要点

- 核心思路：把64表串行扫描变并发查询，因为串行是64倍延迟，所以并行降至Max(单表)延迟
- 并发控权：必须配独立线程池+调大HikariCP连接池(>64)，否则耗尽资源拖垮全系统
- 分页优化：各表只取前N条合并，深分页必须改用游标分页(WHERE create_time < ?)防内存溢出
- 终极方案：并发查询治标，新建用户维度(user_id)索引表才是治本首选


## 苏格拉底式面试追问

> 这组追问模拟面试官层层逼问，每一问先回答"为什么"，再回答"怎么做"，最后回答"如何证明"。

### 第一层：目标与动机

**Q：用户短链分布在 64 张表，你为什么不能直接串行查 64 张表，而要并发查询或建索引表？**

因为串行的延迟是 64 倍。单表查询 5ms，串行 64 张 = 320ms，用户感知明显卡顿。并发查询 64 张表（并行），延迟 = max（单表查询）≈ 10ms（并行执行最慢的那个决定总时长），快 30 倍。更彻底的方案是建 user_id 维度的索引表，只查 1 张表，延迟 5ms。决策依据：串行 64 表的延迟（320ms）远超用户体验阈值（100ms），必须用并发或索引表优化。

### 第二层：证据与定位

**Q：并发查 64 张表后，TP99 还是 200ms，怎么定位是哪张表拖慢了？**

看各表查询耗时分布：
1. 并发查询的 future 结果——每张表的查询耗时单独记录（`future.get(timeout)`），找出最慢的几张表。
2. DB 慢查询——查慢查询日志，看哪张表有慢查询（可能是数据量不均，某张表数据特别多）。
3. 连接池——并发查 64 张表要 64 个数据库连接，如果连接池大小 < 64，部分查询排队等连接，拉高延迟。

### 第三层：根因深挖

**Q：64 张表数据量均匀（各约 100 万条），但某张表查询特别慢（50ms vs 其他 5ms），根因是什么？**

最可能是该表的热点或锁竞争。几种可能：① 该表恰好有大量并发写（创建短链时 short_code hash 都落到这张表），行锁竞争拖慢；② 该表的索引失效或没建好（如 user_id 字段没索引，全表扫描）；③ 该表所在的 DB 实例负载高（与其他表共享实例，争抢 IO）。要看该表的执行计划（`EXPLAIN`）确认是否走索引，以及该 DB 实例的 CPU/IO 监控。

**Q：为什么不直接把 64 张表合并成 1 张大表（用 TiDB 等分布式数据库），查询不用跨表了？**

因为单表数据量太大。亿级短链放一张表，即使 TiDB 自动分片，查询"按 user_id 过滤"仍然要跨多个分片（TiDB 按 short_code 还是 user_id 分片？如果按 short_code，问题没变）。除非按 user_id 分片，但又会影响"按 short_code 查"的主查询。分布式数据库解决了"单表容量上限"问题，但没解决"多维度查询"问题——任何分片策略都只能优化一个维度。所以多维度查询要么用异构索引（不同分片维度的多份数据），要么用 ES（倒排索引支持多维度）。合并成单表不能解决根本问题。

### 第四层：方案权衡

**Q：并发查 64 张表，你说要配独立线程池 + 调大连接池，会不会资源浪费（平时用不上）？**

会，所以要用弹性资源。两种方案：
1. 固定线程池 + 合理大小——64 张表并发，线程池设 64，连接池（HikariCP）设 64+。平时（非跨表查询）这些资源闲置，但短链列表查询是常规功能（用户经常看自己的列表），不是极端 case，资源利用率不算低。
2. 弹性扩缩——按需创建线程（`CompletableFuture.supplyAsync(task, executor)`），线程池设上限（如 128），超出的请求降级为串行或分批并发。权衡：固定池简单但闲置，弹性池复杂但省资源。短链列表查询频率不高（用户不会一直刷列表），用固定池 64 可接受。

**Q：为什么不直接限制"用户最多看最近 100 条短链"，避免全量查询的复杂度？**

这是产品层面的优化，确实有效。限制"最近 100 条"可以用"按 user_id 分片的索引表 + 时间倒序 + limit 100"，只查 1 张表，不用并发 64 表。但前提是建了 user_id 索引表。如果没建索引表，限制 100 条也没用（还是要扫 64 表找这个用户的记录）。产品限制 + 技术索引表结合是最优解——产品限制结果集大小，技术保证查询效率。大多数用户也不会有几百条短链，限制 100 条覆盖 99% 用户，少数大 V 用分页逐批查。

### 第五层：验证与沉淀

**Q：你怎么证明并发查询优化有效（延迟从 320ms 降到 10ms）？**

压测对比：
1. 优化前后对比——同数据量下，串行查 vs 并发查 vs 索引表查，记录 TP50/TP99/TP999。并发应比串行快 30 倍，索引表应最快（单表）。
2. 资源监控——并发查询时的线程池使用率、连接池等待时间、DB 负载，确认资源没被打满。
3. 极端 case——模拟"大 V 用户"（短链分布在全部 64 表），验证并发查询的延迟和资源消耗可接受。

**Q：跨分片查询的方案怎么沉淀？**

1. 并发查询框架——封装"并发查多表 + 结果合并 + 超时降级 + 分页"成通用组件，其他跨分片场景复用。
2. 索引表自动化——把"主表写入 → MQ → 索引表写入 → 对账"做成自动化管道，新业务接入只声明索引维度。
3. 分片设计 review——新系统设计时强制 review"有哪些查询维度""分片键选什么""是否需要索引表"，避免上线后才发现跨分片查询难题。


## 结构化回答

**30 秒电梯演讲：** 64张表的全表扫描是性能灾难，必须用并发查询+结果合并或预聚合来解决。打个比方，就像在64个仓库里找一个客户的货物——逐个翻找太慢，要么同时派人去找，要么提前整理好清单。

**展开框架：**
1. **核心思路** — 把64表串行扫描变并发查询，因为串行是64倍延迟，所以并行降至Max(单表)延迟
2. **并发控权** — 必须配独立线程池+调大HikariCP连接池(>64)，否则耗尽资源拖垮全系统
3. **分页优化** — 各表只取前N条合并，深分页必须改用游标分页(WHERE create_time < ?)防内存溢出

**收尾：** 这块我踩过坑——要不要深入聊：并发查询64张表会不会耗尽连接池？

## 视频脚本

> 预计时长：4 分钟 | 由浅入深

| 时间 | 画面/字幕 | 口播台词 | 讲解要点 |
|------|----------|----------|----------|
| 0:00 | 标题卡 | "高并发一句话：64张表的全表扫描是性能灾难，必须用并发查询+结果合并或预聚合来解决。" | 开场钩子 |
| 0:15 | 架构示意图 | "核心思路：把64表串行扫描变并发查询，因为串行是64倍延迟，所以并行降至Max(单表)延迟" | 核心思路 |
| 1:08 | 架构示意图分步演示 | "并发控权：必须配独立线程池+调大HikariCP连接池(>64)，否则耗尽资源拖垮全系统" | 并发控权 |
| 2:01 | 关键代码/伪代码片段 | "分页优化：各表只取前N条合并，深分页必须改用游标分页(WHERE create_time < ?)防内存溢出" | 分页优化 |
| 2:54 | 对比表格 | "终极方案：并发查询治标，新建用户维度(user_id)索引表才是治本首选" | 终极方案 |
| 3:50 | 总结卡 | "核心抓住这条主线，下期咱们接着聊：并发查询64张表会不会耗尽连接池。" | 收尾 |
