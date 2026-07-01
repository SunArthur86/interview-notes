---
id: note-xhs-db-011
difficulty: L3
category: database
subcategory: MySQL
tags:
- MySQL
- Redis
- 选型
- 场景设计
- 数据存储
feynman:
  essence: 笔记类型数据有关联关系、需要复杂查询和事务保证，所以主存储用MySQL。Redis只做缓存和计数。当需要范围查询、多表JOIN、事务一致性时必须用MySQL。
  analogy: "MySQL像图书馆（有分类目录、能按条件搜书、借还书有记录），Redis像你桌上的书架（放常看的书拿取快但容量有限、不适合做正式档案）。需要查「某月所有视频笔记按点赞排序」这种复杂操作，只能去图书馆。"
  key_points:
  - 关联数据+复杂查询→MySQL主存储
  - Redis做缓存/计数/排行榜，不做主存储
  - 必须用MySQL：范围查询、多表JOIN、事务一致性、精确聚合
  - 正确架构：MySQL主存+Redis缓存，保证最终一致性
  - Redis内存成本是磁盘的100倍以上
first_principle:
  problem: "不同数据存储引擎有根本性的能力差异。如何根据数据特征（关联性、查询复杂度、一致性要求、读写比例）选择正确的存储方案？"
  axioms:
  - 关系数据库的核心价值是关系（关联查询）+ ACID（事务一致性）
  - 内存数据库的核心价值是速度（O(1)读写）但牺牲了复杂查询能力
  - CAP理论：分布式环境下一致性(C)和可用性(A)不可兼得
  - 缓存模式是空间换时间：用内存存储热数据加速访问
  rebuild: "从数据存储需求出发：数据有关联关系和复杂查询→必须用MySQL；有高速读写需求→加Redis缓存层；有事务要求→MySQL事务保证。两者不是替代关系而是互补关系，通过Cache-Aside模式协作"
follow_up:
- 如何保证 MySQL 和 Redis 的数据一致性？
- 缓存击穿、缓存穿透、缓存雪崩怎么解决？
- MySQL 的复合索引和 Redis 的 ZSet 各自适合什么查询？
- 什么场景下 Redis 也可以做主存储？（如纯计数场景）
---

# 场景题：笔记类型数据（直播/图文/视频，有类型关联关系）应该用 MySQL 还是 Redis 存？什么场景必须用 MySQL？（小红书Java一面）

## 一、场景分析：笔记类型数据

```
数据特征：
  - 笔记有类型（直播、图文、视频）
  - 类型之间有关联关系
  - 需要查询某类型的所有笔记
  - 可能需要范围查询、聚合统计
```

### 推荐方案：MySQL 主存储 + Redis 缓存

```
用户请求
    │
    ▼
Redis 缓存命中？ ──是──→ 直接返回
    │ 否
    ▼
MySQL 查询（带类型条件、JOIN、聚合）
    │
    ▼
结果写入Redis缓存（TTL过期）
    │
    ▼
返回结果
```

### 为什么选 MySQL 做主存储？

| 需求 | MySQL能力 | Redis局限 |
|------|----------|-----------|
| 类型关联关系 | 外键、JOIN查询 | 无关联查询能力 |
| 复杂条件查询 | WHERE type='video' AND status=1 | 需要额外维护索引结构 |
| 范围查询 | WHERE create_time BETWEEN ... | ZSet只能按score范围 |
| 事务一致性 | ACID事务 | 仅Lua脚本保证原子性 |
| 数据持久可靠 | redo log + binlog 双保险 | RDB/AOF有窗口期 |
| 聚合统计 | GROUP BY、COUNT、SUM | 需要SCAN全量遍历 |

## 二、什么场景必须用 MySQL 不能用 Redis？

### 场景1：范围查询（面试官追问点）

```sql
-- 这类查询 Redis 基本无法实现
SELECT * FROM notes 
WHERE type = 'video' 
  AND create_time BETWEEN '2026-06-01' AND '2026-06-30'
  AND author_id IN (1001, 1002, 1003)
ORDER BY like_count DESC
LIMIT 20 OFFSET 0;
```

Redis 的 ZSet 只能按一个 score 排序，多维度范围+排序+分页几乎无法实现。

### 场景2：复杂关联查询

```sql
-- 三表JOIN：笔记←笔记类型←类型属性
SELECT n.*, t.type_name, t.icon_url, a.author_name
FROM notes n
JOIN note_types t ON n.type_id = t.id
JOIN authors a ON n.author_id = a.id
WHERE t.category = 'live_streaming'
  AND n.status = 1;
```

### 场景3：事务一致性

```sql
-- 发布笔记同时更新计数，必须事务保证
BEGIN;
INSERT INTO notes (title, content, type_id) VALUES (...);
UPDATE note_stats SET total_count = total_count + 1 WHERE type_id = ?;
COMMIT;
```

### 场景4：精确计数的财务/订单场景

```sql
-- 订单金额计算、对账等不允许任何误差
SELECT SUM(amount) FROM orders 
WHERE merchant_id = 1001 
  AND DATE(create_time) = '2026-07-01';
```

Redis 的 INCR 虽然原子但无法做复杂聚合，且数据可靠性不如MySQL。

## 三、Redis 的优势场景（反面对比）

```
✅ Redis 适合：
  - 热点笔记的列表缓存（ZSet排行榜）
  - 点赞计数（INCR原子操作）
  - 用户最近浏览历史（List）
  - 全局唯一ID生成（INCR）
  - 实时在线状态（Bitmap/Set）

❌ Redis 不适合做主存储：
  - 无复杂查询能力
  - 内存成本远高于磁盘
  - 持久化不如关系数据库可靠
  - 数据一致性保障弱
```

## 四、面试加分：正确架构设计

```
                        ┌─────────────┐
                        │   客户端     │
                        └──────┬──────┘
                               │
                    ┌──────────▼──────────┐
                    │   应用层 (Service)    │
                    │   读写分离 + 缓存策略  │
                    └──┬───────────────┬──┘
                       │               │
              ┌────────▼───┐    ┌─────▼─────┐
              │  Redis     │    │  MySQL    │
              │  (缓存层)  │    │ (主存储)  │
              │            │    │           │
              │ 热点列表    │    │ 笔记CRUD  │
              │ 计数器     │    │ 类型关联   │
              │ 会话      │    │ 事务操作   │
              └────────────┘    └───────────┘
```