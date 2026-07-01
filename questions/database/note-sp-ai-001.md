---
id: note-sp-ai-001
difficulty: L2
category: database
subcategory: MySQL
tags:
- Shopee
- 面经
- MySQL
- PostgreSQL
feynman:
  essence: MySQL用聚簇索引(数据在叶子节点)，PgSQL用非聚簇索引(叶子存物理地址需回表)
  analogy: MySQL像按字典序排列的词典——拼音索引直接翻到页就有解释(聚簇)。PgSQL像普通书的索引——索引页指向正文页码需要翻过去(非聚簇)
  first_principle: 索引组织方式决定了数据物理存储——聚簇索引数据按主键物理排列，非聚簇索引数据独立存储
  key_points:
  - MySQL(InnoDB)是聚簇索引，数据存在主键B+树叶子节点
  - PgSQL是非聚簇索引，叶子节点存物理地址(CTID)
  - MySQL主键查询快(一次IO)，PgSQL支持复杂查询和JSON/向量
  - 都用B+树作为底层结构
first_principle:
  essence: 聚簇索引将索引和数据合一，非聚簇索引将索引和数据分离
  derivation: 聚簇→主键查询一次到位→但二级索引需回表。非聚簇→所有索引平等→但主键查询也需要回表
  conclusion: 读多写少+主键查询为主选MySQL，复杂查询+JSON/向量场景选PgSQL
follow_up:
- MySQL的二级索引为什么需要回表？
- PgSQL的CTID是什么？
- 什么场景下PgSQL比MySQL更合适？
memory_points:
- 底层结构相同：MySQL和PgSQL均用B+树，核心区别在表组织方式不同
- 表组织对比：MySQL聚簇索引（主键存行数据），而PgSQL非聚簇（堆表存行）
- 回表机制差异：MySQL二级索引存主键需回表，而PgSQL所有索引存CTID必回表
- 性能与场景：MySQL主键查询极快适合KV模式，PgSQL因JSONB和pgvector生态适合复杂查询
---

# MySQL和PgSQL的区别？分别用什么数据结构实现索引？

## 索引组织方式对比

```
MySQL (InnoDB) — 聚簇索引

主键索引B+树的叶子节点 = 完整行数据

         [30]
        /     \
    [10, 20]  [40, 50]
    /  |  \    /  |  \
  [5行][15行][20行] [40行][50行]
   ↑    ↑    ↑      ↑    ↑
   叶子节点存的就是完整行数据！

二级索引叶子节点 = 主键值
  需要回主键索引找完整行（回表）


PostgreSQL — 非聚簇索引

所有B+树索引的叶子节点 = CTID(物理地址)

         [30]
        /     \
    [10, 20]  [40, 50]
    /  |  \    /  |  \
  (0,1)(0,2)(0,3)(1,1)(1,2)
   ↑    ↑    ↑     ↑    ↑
   CTID → 回表读取真实数据
   
表数据独立存储在Heap中，所有索引都指向Heap
```

## 全面对比

| 维度 | MySQL (InnoDB) | PostgreSQL |
|------|---------------|------------|
| **索引结构** | B+树(都一样) | B+树(也用B+树) |
| **组织方式** | 聚簇索引 | 非聚簇(Heap表) |
| **数据位置** | 主键索引叶子节点=行数据 | 所有索引叶子=CTID→回表Heap |
| **主键查询** | 极快(一次IO到数据) | 需回表(两步) |
| **二级索引** | 需回表(存主键值) | 需回表(存CTID) |
| **范围查询** | 快(叶子链表顺序IO) | 快(同样B+树) |
| **JSON支持** | JSON类型(功能有限) | JSONB(强大，可索引) |
| **向量搜索** | 无原生支持 | pgvector扩展(流行) |
| **事务实现** | MVCC(Undo Log) | MVCC(多版本行) |
| **适合场景** | 读多写少、主键查询为主 | 复杂查询、JSON、向量搜索 |

## MySQL聚簇索引详解

```sql
-- InnoDB的主键索引就是聚簇索引
CREATE TABLE users (
    id INT PRIMARY KEY,    -- 聚簇索引：叶子节点存完整行
    name VARCHAR(100),
    age INT,
    INDEX idx_name(name)   -- 二级索引：叶子节点存id值
);

-- 主键查询：1次IO直接到数据
SELECT * FROM users WHERE id = 1;
-- → 从聚簇索引叶子节点直接获取 → 极快

-- 二级索引查询：需要回表
SELECT * FROM users WHERE name = 'Alice';
-- Step 1: 从idx_name找到 name='Alice' → id=5
-- Step 2: 从聚簇索引找到 id=5 的完整行 (回表)
```

## PostgreSQL非聚簇索引详解

```sql
CREATE TABLE users (
    id SERIAL PRIMARY KEY,
    name VARCHAR(100),
    age INT
);

-- PgSQL中主键索引也指向CTID
-- CTID = (页号, 行偏移) = 物理位置

-- 所有索引(包括主键)都需要回表
SELECT * FROM users WHERE id = 1;
-- Step 1: 从主键索引找到 id=1 → CTID=(0, 5)
-- Step 2: 根据CTID读取Heap中的行数据 (回表)

-- 但是！PgSQL支持Index-Only Scan(覆盖索引优化)
SELECT id FROM users WHERE id = 1;
-- → 索引中就有id值 → 不需要回表
```

## 什么场景选什么？

```
选 MySQL:
✅ 读多写少的Web应用
✅ 主键查询为主(GET /user/123)
✅ 分库分表水平扩展
✅ 团队更熟悉MySQL运维

选 PostgreSQL:
✅ 复杂分析查询(WINDOW/GROUPING SETS)
✅ JSON/JSONB大量使用
✅ 需要向量搜索(pgvector)
✅ 地理空间数据(PostGIS)
✅ 强一致性要求(DDL事务)
```

## 面试加分点

1. **底层都是B+树**：核心区别不是数据结构，而是组织方式（聚簇vs非聚簇）
2. **回表性能**：MySQL二级索引需回表(存主键值→再查主键)，PgSQL所有索引都回表(存CTID)
3. **PgSQL优势**：JSONB可索引、pgvector、PostGIS等扩展生态丰富
4. **MySQL优势**：聚簇索引主键查询极快，适合KV式访问模式

## 记忆要点

- 底层结构相同：MySQL和PgSQL均用B+树，核心区别在表组织方式不同
- 表组织对比：MySQL聚簇索引（主键存行数据），而PgSQL非聚簇（堆表存行）
- 回表机制差异：MySQL二级索引存主键需回表，而PgSQL所有索引存CTID必回表
- 性能与场景：MySQL主键查询极快适合KV模式，PgSQL因JSONB和pgvector生态适合复杂查询

