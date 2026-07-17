---
id: note-xhs-db-015
difficulty: L4
category: database
subcategory: 事务/MVCC
tags:
- 拼多多
- Java服务端
- MySQL
- 事务隔离
- MVCC
- ReadView
- 面经
feynman:
  essence: "MySQL用4种隔离级别平衡并发与一致性。RR级别通过MVCC(多版本并发控制)实现快照读避免幻读，通过Next-Key Lock实现当前读避免幻读"
  analogy: "MVCC就像'拍照'——每个事务开始时拍一张数据快照(ReadView)，之后读自己的照片，互不干扰。有人改了数据，你看到的还是老照片，不会受影响"
  key_points:
  - 4种隔离级别：读未提交(RU)、读已提交(RC)、可重复读(RR)、串行化(S)
  - MVCC = Undo Log版本链 + ReadView可见性判断
  - "RC级别: 每次SELECT生成新ReadView → 不可重复读"
  - "RR级别: 第一次SELECT生成ReadView，之后复用 → 可重复读"
  - 当前读用Next-Key Lock(Record Lock + Gap Lock)防止幻读
first_principle:
  essence: "并发事务相互影响产生3类问题(脏读/不可重复读/幻读)，隔离级别是'一致性vs并发性'的权衡"
  derivation: "完全串行=最强一致但无并发 → 放松约束提升并发 → 但产生脏读/不可重复读/幻读 → MVCC用版本链让读不阻塞写、写不阻塞读 → ReadView决定看到哪个版本"
  conclusion: "MVCC = 空间换并发，通过Undo Log版本链+ReadView实现非阻塞一致性读"
follow_up:
- MVCC的Undo Log版本链是怎么组织的？
- RR级别下快照读和当前读有什么区别？
- Gap Lock和Next-Key Lock的区别？
- 为什么MySQL默认RR而不是RC？
- MVCC如何解决幻读？还有没有漏洞？
memory_points:
- "4级别: RU< RC < RR < Serializable (隔离性递增，并发性递减)"
- "MVCC核心: Undo Log版本链 + ReadView(创建者事务ID、活跃事务列表)"
- "RC vs RR关键: RC每次SELECT新建ReadView；RR复用第一次的ReadView"
- "当前读: SELECT...FOR UPDATE / UPDATE / DELETE 加Next-Key Lock"
---

# 【拼多多 Java服务端】MySQL事务隔离等级有了解吗？是如何实现的？

> 来源：拼多多复活赛一面面经（小红书）— 原题：MySQL事务隔离等级有了解吗？MySQL事务隔离等级是如何实现的？（基于MVCC+行锁、临键锁、readView等机制）

## 一、费曼类比

```
三个并发问题 = 三种尴尬场景:

脏读 (Dirty Read):
  事务A: "UPDATE balance=200" (还没提交!)
  事务B: 读到balance=200 ← 看到了还没确认的数据!
  事务A: "ROLLBACK" (撤销了)
  事务B: 基于200做的决策全错了!

不可重复读 (Non-Repeatable Read):
  事务B: 第一次读 balance=100
  事务A: "UPDATE balance=200; COMMIT;"
  事务B: 第二次读 balance=200 ← 同一事务内两次读结果不一样!

幻读 (Phantom Read):
  事务B: SELECT COUNT(*) → 10条
  事务A: INSERT 一条新记录; COMMIT;
  事务B: SELECT COUNT(*) → 11条 ← 多了一条"幽灵"记录!
```

## 二、第一性原理分析

```
一致性 ←─────────────────────→ 并发性
  │                               │
  │  串行化(最强)                   │  读未提交(最弱)
  │  所有事务排队执行               │  什么都能看到
  │  性能最差                      │  性能最好
  │                               │
  └─────── 4个隔离级别 ────────────┘
            RU → RC → RR → S
            ↑               ↑
         并发高            一致强
         一致弱            并发低
```

## 三、详细答案

### 3.1 四种隔离级别

| 隔离级别 | 脏读 | 不可重复读 | 幻读 | 性能 |
|---------|------|----------|------|------|
| **读未提交** (Read Uncommitted) | 可能 | 可能 | 可能 | 最高 |
| **读已提交** (Read Committed, RC) | 避免 | 可能 | 可能 | 高 |
| **可重复读** (Repeatable Read, RR) | 避免 | 避免 | InnoDB避免 | 中 |
| **串行化** (Serializable) | 避免 | 避免 | 避免 | 最低 |

> MySQL InnoDB默认隔离级别是 **RR**（Oracle/PostgreSQL默认RC）

### 3.2 MVCC核心机制

```
MVCC = Multi-Version Concurrency Control（多版本并发控制）

核心三件套:
  1. 隐藏列: 每行有 trx_id(最后修改事务ID) + roll_pointer(指向Undo Log)
  2. Undo Log版本链: 每次修改的旧版本通过roll_pointer串成链表
  3. ReadView: 决定当前事务能看到哪个版本

┌─────────────────────────────────────────────────────────┐
│                    数据行 (当前版本)                      │
│  id=1 | name='Alice' | trx_id=300 | roll_pointer ──────│─┐
└─────────────────────────────────────────────────────────┘ │
                                                            ↓
┌───────────────────────────────────────────────────┐
│              Undo Log 版本链                        │
│                                                   │
│  旧版本2: name='Bob'  | trx_id=200 | roll_ptr ───│─┐
└───────────────────────────────────────────────────┘ │
                                                      ↓
┌───────────────────────────────────────────────────┐
│  旧版本1: name='Tom'  | trx_id=100 | roll_ptr=null│
└───────────────────────────────────────────────────┘
```

### 3.3 ReadView 可见性判断

```java
// ReadView 结构:
class ReadView {
    long creator_trx_id;        // 创建ReadView的事务ID
    long[] m_ids;               // 创建时活跃(未提交)事务ID列表
    long min_trx_id;            // m_ids中最小值
    long max_trx_id;            // 下一个将分配的事务ID(最大值+1)
}

// 可见性判断算法:
boolean isVisible(trx_id) {
    if (trx_id == creator_trx_id)  return true;  // 自己改的，可见
    if (trx_id < min_trx_id)       return true;  // 在ReadView前已提交
    if (trx_id >= max_trx_id)      return false; // 在ReadView后才开始
    if (m_ids.contains(trx_id))    return false; // 在活跃列表中(未提交)
    return true;                                // 不在活跃列表(已提交)
}
```

### 3.4 RC vs RR 的本质区别

```
RC (读已提交):
  事务B开始 ──→ SELECT ──→ SELECT ──→ SELECT
                  │           │           │
               新ReadView  新ReadView  新ReadView
                  ↓           ↓           ↓
              看到A提交前的  看到A提交后  看到A提交后
              旧版本        新版本      新版本
              
  → 同一事务内两次读可能不同 → 不可重复读!

RR (可重复读):
  事务B开始 ──→ SELECT ──→ SELECT ──→ SELECT
                  │           │           │
               新ReadView  复用ReadView 复用ReadView
                  ↓           ↓           ↓
              看到A提交前的  看到A提交前  看到A提交前
              旧版本        旧版本      旧版本
              
  → 同一事务内多次读结果一致 → 可重复读!
```

### 3.5 当前读与Next-Key Lock

```
快照读 (普通SELECT):
  → 走MVCC，读ReadView对应的版本，不加锁

当前读 (SELECT...FOR UPDATE / UPDATE / DELETE / INSERT):
  → 读最新已提交版本，加锁

RR级别防止幻读:
  ┌─────────────────────────────────────┐
  │  表数据: id=5, 10, 15, 20           │
  │                                     │
  │  事务A: SELECT * FROM t WHERE       │
  │         id BETWEEN 8 AND 18         │
  │         FOR UPDATE;                 │
  │                                     │
  │  加锁范围 (Next-Key Lock):           │
  │  (5, 10]  (10, 15]  (15, 20]        │
  │  ← Gap Lock →←Record Lock→          │
  │                                     │
  │  事务B: INSERT id=12;               │
  │  → 阻塞! (落在Gap Lock范围内)        │
  │                                     │
  │  → 防止了幻读!                       │
  └─────────────────────────────────────┘

Next-Key Lock = Gap Lock(间隙锁) + Record Lock(行锁)
  - Record Lock: 锁定索引记录本身
  - Gap Lock: 锁定索引记录之间的间隙
  - Next-Key Lock: 锁定记录+前面的间隙
```

### 3.6 为什么MySQL默认RR而不是RC？

```
原因: 主从复制
  MySQL早期binlog使用STATEMENT格式:
  
  主库:
    事务A: BEGIN; UPDATE t SET x=1 WHERE x=0; COMMIT;
    事务B: BEGIN; INSERT INTO t VALUES(0); COMMIT;
    
  从库binlog回放顺序不确定 → 结果可能不一致!
  
  RR级别 + STATEMENT binlog = 保证主从一致性
  (因为RR下事务A的UPDATE会锁定间隙，B的INSERT被阻塞)
  
  现在: binlog=ROW格式 + RC级别 也可以保证一致性
  但MySQL历史遗留默认值仍是RR
```

## 四、实际例子

```sql
-- 查看当前隔离级别
SELECT @@transaction_isolation;  -- MySQL 5.7+: REPEATABLE-READ

-- 修改隔离级别
SET SESSION TRANSACTION ISOLATION LEVEL READ COMMITTED;

-- RR级别下演示MVCC
-- Session A:
BEGIN;
SELECT * FROM account WHERE id=1;  -- balance=100 (ReadView创建)

-- Session B:
UPDATE account SET balance=200 WHERE id=1;
COMMIT;

-- Session A 再次查询:
SELECT * FROM account WHERE id=1;  -- 仍然balance=100 (复用ReadView)

-- Session A 当前读:
SELECT * FROM account WHERE id=1 FOR UPDATE;  -- balance=200 (最新版本)
```

## 五、扩展知识

- **MVCC只在InnoDB引擎中实现**，MyISAM没有事务
- **RR级别下MVCC的幻读漏洞**: 先快照读（不加锁），再INSERT一条（刚好和另一个事务INSERT的记录相同），会触发唯一键冲突，再SELECT能看到新记录 → 幻读
- **Gap Lock在RC级别下不生效**（RC只有Record Lock）

## 六、苏格拉底式面试提问

1. **"你说RR通过MVCC避免幻读，但INSERT时唯一键冲突怎么办？"** — 引出RR下MVCC幻读的特殊漏洞（先快照读再INSERT场景）
2. **"ReadView的活跃事务列表是怎么维护的？"** — 引出事务系统段(trx_sys)的全局活跃事务链表
3. **"Gap Lock在什么情况下会退化为Record Lock？"** — 唯一索引等值查询命中记录时，不需要Gap Lock
4. **"如果隔离级别设为Serializable，MVCC还生效吗？"** — Serializable下所有读都加共享锁，退化为当前读
5. **"MVCC的Undo Log会无限增长吗？什么时候清理？"** — 引出purge线程、最小活跃ReadView

## 七、面试加分点

1. **能画出Undo Log版本链** — 展示对MVCC底层存储的理解
2. **解释RC和RR的唯一区别** — ReadView创建时机（每次SELECT vs 首次SELECT）
3. **知道Next-Key Lock组成** — Gap Lock + Record Lock，防止幻读
4. **能说出MySQL默认RR的历史原因** — 主从复制+STATEMENT binlog
5. **提到MVCC幻读漏洞** — 先快照读再INSERT触发唯一键冲突的场景


## 结构化回答

**30 秒电梯演讲：** MySQL用4种隔离级别平衡并发与一致性。RR级别通过MVCC(多版本并发控制)实现快照读避免幻读，通过Next-Key Lock实现当前读避免幻读。

**展开框架：**
1. **4级别** — RU< RC < RR < Serializable (隔离性递增，并发性递减)
2. **MVCC核心** — Undo Log版本链 + ReadView(创建者事务ID、活跃事务列表)
3. **RC vs RR关键** — RC每次SELECT新建ReadView；RR复用第一次的ReadView

**收尾：** 这块我踩过坑——要不要深入聊：MVCC的Undo Log版本链是怎么组织的？

## 视频脚本

> 预计时长：4 分钟 | 由浅入深

| 时间 | 画面/字幕 | 口播台词 | 讲解要点 |
|------|----------|----------|----------|
| 0:00 | 标题卡 | "事务/MVCC一句话：MySQL用4种隔离级别平衡并发与一致性。RR级别通过MVCC(多版本并发控制)实现快照读避免幻读…。" | 开场钩子 |
| 0:15 | 事务隔离级别对比表 | "4级别: RU< RC < RR < Serializable (隔离性递增，并发性递减)" | 4级别 |
| 1:08 | 事务隔离级别对比表分步演示 | "MVCC核心: Undo Log版本链 + ReadView(创建者事务ID、活跃事务列表)" | MVCC核心 |
| 2:01 | 关键代码/伪代码片段 | "RC vs RR关键: RC每次SELECT新建ReadView；RR复用第一次的ReadView" | RC vs RR关键 |
| 2:54 | 对比表格 | "当前读: SELECT...FOR UPDATE / UPDATE / DELETE 加Next-Key Lock" | 当前读 |
| 3:50 | 总结卡 | "核心抓住这条主线，下期咱们接着聊：MVCC的Undo Log版本链是怎么组织的。" | 收尾 |
