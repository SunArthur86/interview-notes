---
id: note-bd-agent-011
difficulty: L2
category: database
subcategory: Redis
tags:
- 字节
- 面经
- Redis
- ZSet
feynman:
  essence: ZSet大数据量用HashTable+SkipList，小数据量用ListPack压缩存储省内存
  analogy: 就像新华字典——HashTable是拼音索引(快速查字)，SkipList是页码排序(按序浏览)，薄字典用压缩排版(ListPack省空间)
  first_principle: 有序集合需要同时满足O(1)精确查找和O(logN)范围查询，单一数据结构无法兼顾，需要组合
  key_points:
  - HashTable负责member→score的O(1)查找
  - SkipList负责按score排序和范围查询O(logN)
  - 小数据量用ListPack(Redis 7.0+)压缩省内存
  - 数据量超阈值自动升级为HashTable+SkipList
first_principle:
  essence: 有序集合需要两种正交查询能力——按member查找和按score范围查找
  derivation: 只HashTable→无法按score排序。只SkipList→按member查找O(logN)。组合→两种查询都高效
  conclusion: ZSet底层=HashTable(member→score) + SkipList(score排序)，空间换时间
follow_up:
- SkipList为什么用多级链表而不是平衡树？
- ListPack和ziplist有什么区别？
- ZSet的zadd时间复杂度是多少？
memory_points:
- 一句话总结：ZSet底层是Hash表加跳表的组合，小数据量下退化用Listpack紧凑存储
- 双核职责：Hash表负责O(1)快速查分数，跳表负责O(logN)范围排名查询
- 关键阈值：元素数>128或单元素>64字节时触发底层结构升级（Listpack升级为Hash+跳表）
- 跳表优势：相较于红黑树，跳表实现更简单，且范围查询直接通过层级链表顺序遍历，天然高效
---

# Redis的ZSet底层是怎么实现的？

## 底层结构全景

```
┌─────────────────────────────────────────────┐
│              Sorted Set (ZSet)               │
├─────────────────────────────────────────────┤
│                                              │
│  数据量 > 128 或 单元素 > 64字节              │
│  ┌────────────────┐  ┌────────────────────┐ │
│  │   HashTable     │  │    SkipList        │ │
│  │                  │  │                    │ │
│  │  member → score  │  │  按 score 排序的   │ │
│  │  O(1)查找        │  │  多级跳表           │ │
│  │  "alice" → 95    │  │  O(logN)范围查询   │ │
│  │  "bob" → 87      │  │                    │ │
│  │  "carol" → 92    │  │  L3: ──→95────────│ │
│  │                  │  │  L2: ──→87─→92─→95│ │
│  │                  │  │  L1: →80→87→90→92→95│
│  └────────────────┘  └────────────────────┘ │
│                                              │
│  ────────────────────────────────────────    │
│                                              │
│  数据量 ≤ 128 且 单元素 ≤ 64字节              │
│  ┌────────────────────────────────────────┐ │
│  │            ListPack (Redis 7.0+)        │ │
│  │  紧凑连续内存，省空间                    │ │
│  │  [score1, member1, score2, member2, ...]│ │
│  │  遍历查找（数据少所以够快）              │ │
│  └────────────────────────────────────────┘ │
└─────────────────────────────────────────────┘
```

## HashTable（Dict）

```
职责：member → score 的快速映射

HashTable:
┌──────────┬───────┐
│  member  │ score │
├──────────┼───────┤
│ "alice"  │  95   │   ← ZSCORE "alice" → O(1)
│ "bob"    │  87   │   ← ZSCORE "bob" → O(1)
│ "carol"  │  92   │
│ "dave"   │  80   │
└──────────┴───────┘

支持操作：ZSCORE, ZRANK(需配合SkipList)
```

## SkipList（跳跃表）

```
职责：按score排序 + 范围查询

Level 3: head ──────────────────────→ [95, alice] → nil
Level 2: head ──────→ [87, bob] ───→ [92, carol] → [95, alice] → nil
Level 1: head → [80, dave] → [87, bob] → [90, eve] → [92, carol] → [95, alice] → nil

节点结构：
┌──────────────────────────────────┐
│ score: 92  │ member: "carol"     │
│ backward: → [87, bob]            │  ← 后退指针（便于反向遍历）
│ forward[0]: → [95, alice]        │  ← 第0层前进指针
│ forward[1]: → [95, alice]        │  ← 第1层前进指针
│ span[0]: 1                        │  ← 跨度（用于ZRANK计算排名）
│ span[1]: 1                        │
└──────────────────────────────────┘

支持操作：
- ZRANGEBYSCORE 85 95 → O(logN + M)
- ZREVRANK → O(logN)
- ZRANGE → O(logN + M)
```

### 为什么SkipList不用红黑树？

| 对比 | SkipList | 红黑树 |
|------|---------|--------|
| 范围查询 | O(logN + M)，顺着链表扫 | O(logN + M)，但需中序遍历 |
| 实现复杂度 | 简单（链表+随机层数） | 复杂（旋转+着色） |
| 并发友好 | 局部加锁即可 | 旋转影响多个节点 |
| 内存 | 多级指针，额外O(N) | 每节点3指针（左/右/父） |
| 缓存 | 不友好（指针跳跃） | 不友好 |

Redis作者Antirez选择SkipList的理由：**实现简单 + 范围查询高效 + 并发友好**。

## ListPack（Redis 7.0+替代ziplist）

```
紧凑存储格式：

内存布局（连续内存块）：
┌─────┬───────┬────────┬───────┬────────┬───────┬─────┐
│ total│ score │ member │ score │ member │ score │ end │
│ bytes│  80   │ "dave" │  87   │ "bob"  │  92   │ 0xFF│
│  =4  │  =2   │  =5    │  =2   │  =4    │  =2   │     │
└─────┴───────┴────────┴───────┴────────┴───────┴─────┘

特点：
- 连续内存，无指针开销
- 按score排序存储
- 查找需要遍历（但数据少所以够快）
- 修改需要 realloc + memmove
```

**升级阈值**（满足任一条件即升级为HashTable+SkipList）：
- 元素数量 > 128（`zset-max-listpack-entries`）
- 任一元素长度 > 64字节（`zset-max-listpack-value`）

## 各操作时间复杂度

| 操作 | HashTable | SkipList | 整体 |
|------|-----------|----------|------|
| ZADD | O(1) 插入 | O(logN) | O(logN) |
| ZSCORE | O(1) | - | O(1) |
| ZRANK | - | O(logN) | O(logN) |
| ZRANGE | - | O(logN+M) | O(logN+M) |
| ZRANGEBYSCORE | - | O(logN+M) | O(logN+M) |
| ZREM | O(1) 删除 | O(logN) | O(logN) |

## 面试加分点

1. **组合数据结构**：解释为什么需要HashTable+SkipList两种结构
2. **编码切换**：知道ListPack和HashTable+SkipList的切换阈值
3. **SkipList vs B+Tree**：SkipList偏内存(指针跳转)，B+Tree偏磁盘(页组织)
4. **ListPack进化**：Redis 7.0用ListPack替代了ziplist，解决了级联更新问题

## 记忆要点

- 一句话总结：ZSet底层是Hash表加跳表的组合，小数据量下退化用Listpack紧凑存储
- 双核职责：Hash表负责O(1)快速查分数，跳表负责O(logN)范围排名查询
- 关键阈值：元素数>128或单元素>64字节时触发底层结构升级（Listpack升级为Hash+跳表）
- 跳表优势：相较于红黑树，跳表实现更简单，且范围查询直接通过层级链表顺序遍历，天然高效

