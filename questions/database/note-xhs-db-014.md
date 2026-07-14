---
id: note-xhs-db-014
difficulty: L4
category: database
subcategory: MySQL
tags:
- 拼多多
- Java服务端
- MySQL
- 两阶段提交
- 2PC
- 崩溃恢复
- binlog
- redo-log
- 面经
feynman:
  essence: "两阶段提交是MySQL保证redo log和binlog一致性的协议：先写redo log(prepare)→再写binlog→最后提交redo log(commit)。崩溃恢复时根据两个日志的状态决定提交或回滚"
  analogy: "两阶段提交就像签合同：第一步双方各签一份草稿（prepare），第二步互换确认无误后盖章生效（commit）。如果中途一方反悔（崩溃），根据草稿状态决定是作废还是继续"
  key_points:
  - "Phase 1: 写redo log(prepare状态)"
  - "Phase 2: 写binlog → 写redo log(commit状态)"
  - 崩溃恢复规则：有binlog+prepare → 提交；无binlog+prepare → 回滚
  - 核心矛盾：redo log(InnoDB)和binlog(Server)属于不同层，需要协议保证一致
  - 如果不2PC：redo写完binlog没写→主库有数据从库没有→主从不一致
first_principle:
  essence: "两阶段提交的本质是'跨系统原子性'——redo log和binlog必须同时成功或同时失败"
  derivation: "redo log和binlog是独立的→可能一个成功一个失败→不一致→需要协调→2PC：先prepare redo→写binlog→commit redo→如果崩溃→检查binlog是否存在决定提交或回滚"
  conclusion: "2PC = 分布式事务在MySQL内部的简化版，用prepare-commit两阶段+崩溃恢复规则保证日志一致性"
follow_up:
- 如果redo log写完了，binlog写完了，但commit标志没写就崩溃了，怎么恢复？
- MySQL的2PC和分布式事务的2PC(XA)有什么区别？
- 组提交(group commit)如何优化两阶段提交的性能？
- 如果只要求最终一致性，是否可以不用两阶段提交？
- 半同步复制(semi-sync)和两阶段提交是什么关系？
memory_points:
- 2PC三步：redo prepare → binlog write → redo commit
- 崩溃恢复：binlog有记录→提交；binlog无记录→回滚
- redo log和binlog不一致的后果：主从数据不一致
- commit标志在redo log中，用XA ID关联binlog
---

# 【拼多多 Java服务端】两阶段提交（2PC）讲一下。崩溃恢复时怎么处理？

> 来源：拼多多211本硕Java服务端面经（已OC）（小红书）

## 一、为什么需要两阶段提交？

```
┌──────────────────────────────────────────────────────────┐
│         不用2PC的问题                                     │
│                                                          │
│  场景: UPDATE t SET name='b' WHERE id=1                 │
│                                                          │
│  先写redo后写binlog:                                      │
│  ┌───────────────────────────────────┐                  │
│  │ 1. redo log写入 ✓                  │                  │
│  │ 2. ← 崩溃! →                       │                  │
│  │ 3. binlog未写 ✗                    │                  │
│  │                                   │                  │
│  │ 主库恢复: redo log有记录 → 提交    │                  │
│  │ 从库恢复: binlog无记录 → 不执行    │                  │
│  │ → 主从数据不一致! ✗                │                  │
│  └───────────────────────────────────┘                  │
│                                                          │
│  先写binlog后写redo:                                      │
│  ┌───────────────────────────────────┐                  │
│  │ 1. binlog写入 ✓                    │                  │
│  │ 2. ← 崩溃! →                       │                  │
│  │ 3. redo log未写 ✗                  │                  │
│  │                                   │                  │
│  │ 主库恢复: redo无记录 → 回滚        │                  │
│  │ 从库恢复: binlog有记录 → 执行      │                  │
│  │ → 主从数据不一致! ✗                │                  │
│  └───────────────────────────────────┘                  │
│                                                          │
│  结论: 不管先写哪个，中间崩溃都会不一致                   │
│        → 需要两阶段提交保证原子性                         │
└──────────────────────────────────────────────────────────┘
```

## 二、两阶段提交流程

```
┌──────────────────────────────────────────────────────────────┐
│                  两阶段提交 (2PC)                              │
│                                                               │
│  Phase 1: Prepare (准备阶段)                                   │
│  ┌─────────────────────────────────────────────┐             │
│  │ ① InnoDB写redo log，标记为PREPARE状态          │             │
│  │ ② redo log包含XA ID（事务ID）                  │             │
│  │ ③ redo log刷盘 (fsync)                        │             │
│  │                                               │             │
│  │ 此时如果崩溃 → 恢复时检查binlog决定提交/回滚    │             │
│  └───────────────────────┬─────────────────────┘             │
│                           │                                   │
│  Phase 2: Commit (提交阶段)                                    │
│  ┌─────────────────────────────────────────────┐             │
│  │ ④ Server层写binlog                            │             │
│  │    binlog包含相同的XA ID                       │             │
│  │ ⑤ binlog刷盘 (sync_binlog=1时)                │             │
│  │ ⑥ InnoDB写redo log，标记为COMMIT状态           │             │
│  │ ⑦ 返回成功给客户端                             │             │
│  └─────────────────────────────────────────────┘             │
│                                                               │
│  时间线:                                                       │
│  ─────────────────────────────────────────────────→          │
│  │ undo   │ redo(PREPARE) │ binlog │ redo(COMMIT) │         │
│  │ log    │     fsync     │ fsync  │              │          │
│  └────────┴───────────────┴────────┴──────────────┘          │
│                        ↑                ↑                     │
│                     崩溃点1          崩溃点2                   │
│                     (见下方)         (见下方)                   │
└──────────────────────────────────────────────────────────────┘
```

## 三、崩溃恢复规则

```
┌──────────────────────────────────────────────────────────────┐
│              崩溃恢复决策表                                     │
│                                                               │
│  扫描redo log中的PREPARE记录                                   │
│       │                                                       │
│       ├── PREPARE记录对应的XA ID在binlog中找到?                │
│       │                                                       │
│       │   ┌─── YES (binlog已写入) ───┐                        │
│       │   │                          │                        │
│       │   │  redo有COMMIT标记?       │                        │
│       │   │  ├── YES → 已提交，跳过   │                        │
│       │   │  └── NO  → 补提交(COMMIT) │                        │
│       │   │      ↑ 崩溃点2的场景      │                        │
│       │   │                          │                        │
│       │   └──────────────────────────┘                        │
│       │                                                       │
│       │   ┌─── NO (binlog未写入) ────┐                        │
│       │   │                          │                        │
│       │   │  → 回滚事务(ROLLBACK)     │                        │
│       │   │  → 使用undo log反向操作   │                        │
│       │   │      ↑ 崩溃点1的场景      │                        │
│       │   │                          │                        │
│       │   └──────────────────────────┘                        │
│                                                               │
│  核心原则: binlog是否完整 = 事务是否应该提交                   │
│  binlog完整 → 提交 (因为从库会用binlog恢复)                   │
│  binlog不完整 → 回滚 (从库也不会执行这条)                     │
└──────────────────────────────────────────────────────────────┘
```

### 面试官追问场景

**Q: redo log写完了，binlog没写完，崩溃恢复怎么处理？**

```
崩溃点1: redo(PREPARE)已写, binlog未写

恢复过程:
1. 扫描redo log → 发现PREPARE记录, XA ID = T1
2. 去binlog查找XA ID = T1 → 未找到
3. 判定: binlog不完整 → 回滚
4. 使用undo log执行反向操作，恢复数据

结果: 主库回滚, 从库也不会执行 → 主从一致 ✓
```

**Q: redo log写完了，binlog写完了，但commit标志没写就崩溃了？**

```
崩溃点2: redo(PREPARE) + binlog已写, redo(COMMIT)未写

恢复过程:
1. 扫描redo log → 发现PREPARE记录, XA ID = T1
2. 去binlog查找XA ID = T1 → 找到完整记录!
3. 判定: binlog完整 → 补提交
4. 写入redo(COMMIT)标记，事务提交

结果: 主库提交, 从库也执行 → 主从一致 ✓
```

## 四、关键参数

```sql
-- 控制redo log刷盘
innodb_flush_log_at_trx_commit = 1  -- 每次提交都fsync (推荐)

-- 控制binlog刷盘
sync_binlog = 1  -- 每次提交都fsync binlog (推荐)

-- 这两个参数称为"双1配置"，是MySQL最安全的事务配置
-- 代价：每次事务提交都需两次fsync，性能影响约10-20%
```

| 参数值 | 安全性 | 性能 | 适用场景 |
|--------|--------|------|---------|
| 双1 (flush=1, sync=1) | 最高 | 中 | 金融、核心交易 |
| flush=2, sync=0 | 低 | 最高 | 日志、监控类 |
| flush=1, sync=100 | 中 | 高 | 一般业务 |

## 五、面试加分点

1. **组提交优化(Group Commit)**：多个事务的redo log/binlog合并成一次fsync，大幅提升性能。MySQL 5.7+默认开启binlog组提交
2. **半同步复制(Semi-Sync)**：主库写完binlog后等至少一个从库ACK才返回客户端成功，比异步复制更安全但延迟更高
3. **XA ID关联机制**：binlog中的XID事件与redo log中的XA ID对应，恢复时通过这个ID匹配两个日志
4. **MySQL 8.0改进**：redo log改为双buffer+并行写入，减少临界区竞争，提升并发提交性能
5. **分布式事务2PC vs MySQL内部2PC**：MySQL内部的2PC是InnoDB和Server层之间的协调，而分布式XA是多个资源管理器之间的协调，但原理类似
