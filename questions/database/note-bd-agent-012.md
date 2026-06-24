---
id: note-bd-agent-012
difficulty: L2
category: database
subcategory: MySQL
tags:
  - 字节
  - 面经
  - MySQL
  - 事务隔离
feynman:
  essence: 脏读是读到未提交数据，幻读是范围查询行数变化，靠隔离级别和锁机制避免
  analogy: '脏读像偷看别人的草稿(还没交的作业)，幻读像看同一本书两次页数不一样(中间有人插了页)'
  first_principle: '事务隔离的本质是在并发访问下权衡一致性和性能——隔离级别越高越安全但并发越低'
  key_points:
    - 脏读=读到其他事务未提交的数据
    - 幻读=同一范围查询前后结果集行数不同
    - 脏读靠提升隔离级别避免(至少RC)
    - 幻读靠MVCC(快照读)和Gap Lock(当前读)避免
first_principle:
  essence: 并发事务间的干扰有程度之分，SQL标准定义了四种隔离级别对应四种干扰
  derivation: '读未提交→脏读→加写锁→读已提交→不可重复读→加读锁→可重复读→幻读→加范围锁→串行化'
  conclusion: InnoDB默认RR级别，用MVCC+Next-Key Lock在大多数场景下同时解决脏读、不可重复读和幻读
follow_up:
  - 'MVCC的Read View是怎么工作的？'
  - 'Gap Lock和Next-Key Lock的区别？'
  - '为什么MySQL默认RR而不是RC？'
---

# MySQL里脏读和幻读分别是什么？数据库怎么避免？

## 四种并发问题与隔离级别

```
隔离级别安全性递增、性能递减 →

读未提交    读已提交    可重复读    串行化
(RU)       (RC)       (RR)       (Serializable)
  │          │          │           │
  │          │          │           │
脏读 ✅      脏读 ❌    脏读 ❌     脏读 ❌
不可重复读✅  不可重复读✅ 不可重复读❌ 不可重复读❌
幻读 ✅      幻读 ✅    幻读 ❌*    幻读 ❌

* InnoDB的RR级别通过MVCC+Next-Key Lock在大多数场景下也能避免幻读

InnoDB默认隔离级别: RR (可重复读)
```

## 脏读（Dirty Read）

```
事务A                        事务B
  │                           │
  ├── UPDATE balance=500 ──→  │  (未提交)
  │                    │      │
  │                    └── 读取balance=500  ← 脏读！
  │                           │
  ├── ROLLBACK ───────────────┘  (回滚)
  │
  ▼
balance恢复为1000，但事务B已经读到了500这个不存在的数据
```

**避免方式**：将隔离级别提升到至少RC（读已提交）
- RC级别下，事务只能读到其他事务已提交的数据
- InnoDB在RC级别使用MVCC，每次SELECT生成新的Read View

## 幻读（Phantom Read）

```
事务A                        事务B
  │                           │
  ├── SELECT WHERE age>20 ──  │  返回5行
  │                    │      │
  │                    │      ├── INSERT(age=25) ──→ COMMIT
  │                    │      │
  ├── SELECT WHERE age>20 ──  │  返回6行 ← 幻读！
  │                           │    （多了一行，像"幻影"一样出现）
  ▼
同一条件两次查询结果集行数不同，新出现的行就是"幻行"
```

**幻读 vs 不可重复读**：
- 不可重复读：同一行数据被修改（UPDATE）
- 幻读：结果集中出现了新行或少了行（INSERT/DELETE）

## InnoDB如何避免幻读

### 方案一：MVCC（快照读）

```sql
-- 普通SELECT是快照读，不会幻读
SELECT * FROM users WHERE age > 20;
-- → 读取事务开始时的快照数据
-- → 即使其他事务INSERT了新行，也看不到
```

**MVCC原理**：
```
事务A开始 → 创建Read View（记录当前活跃事务列表）
           │
           ├── SELECT → 从Undo Log中读取版本链
           │             找到对当前Read View可见的版本
           │
           └── 无论其他事务怎么INSERT/UPDATE
               事务A始终看到一致的数据快照
```

### 方案二：Next-Key Lock（当前读）

```sql
-- 当前读需要加锁防止幻读
SELECT * FROM users WHERE age > 20 FOR UPDATE;
-- → 锁定 age > 20 的所有现有行 + 间隙
-- → 其他事务无法在这个范围INSERT新行

-- UPDATE/DELETE也是当前读
UPDATE users SET status = 1 WHERE age > 20;
-- → 同样加Next-Key Lock
```

**Next-Key Lock = Record Lock + Gap Lock**：

```
已有数据: age = [18, 20, 25, 30]

SELECT WHERE age > 20 FOR UPDATE 加锁：

Record Lock: 锁定 age=25 和 age=30 的行
Gap Lock:    锁定 (20,25), (25,30), (30, +∞) 的间隙

合在一起 = Next-Key Lock:
(20, 25], (25, 30], (30, +∞]

效果：其他事务无法在 age>20 范围INSERT任何新行
```

## 隔离级别对比表

| 隔离级别 | 脏读 | 不可重复读 | 幻读 | 性能 |
|---------|------|----------|------|------|
| Read Uncommitted | ✅发生 | ✅发生 | ✅发生 | 最高 |
| Read Committed | ❌避免 | ✅发生 | ✅发生 | 高 |
| Repeatable Read | ❌避免 | ❌避免 | ❌避免* | 中 |
| Serializable | ❌避免 | ❌避免 | ❌避免 | 最低 |

> *InnoDB的RR级别通过MVCC+Next-Key Lock在大多数场景避免了幻读，但不是SQL标准的严格要求。

## 面试加分点

1. **区分脏读和幻读**：脏读是读到未提交数据，幻读是结果集行数变化
2. **MVCC原理**：知道快照读通过Read View + Undo Log实现
3. **Next-Key Lock**：能解释Record Lock + Gap Lock的组合
4. **MySQL选RR的原因**：历史原因（binlog复制需要RR保证一致性），其他数据库大多默认RC
