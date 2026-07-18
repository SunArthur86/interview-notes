---
id: note-xhs-db-013
difficulty: L3
category: database
subcategory: MySQL
tags:
- 拼多多
- Java服务端
- MySQL
- binlog
- redo-log
- undo-log
- 事务
- 面经
feynman:
  essence: "三种日志分别解决三个问题：redo log保证崩溃恢复（持久性），undo log保证回滚和MVCC（原子性+隔离性），binlog保证主从复制和数据归档"
  analogy: "三种日志就像三种不同的记录员：redo log是'黑匣子'——记录已经做了什么，飞机坠毁了也能恢复；undo log是'后悔药'——记录怎么撤销，事务失败时回退；binlog是'广播员'——把操作告诉所有从库"
  key_points:
  - "redo log: InnoDB引擎层，物理日志，记录'页X偏移Y改了什么'，保证崩溃恢复"
  - "undo log: InnoDB引擎层，逻辑日志，记录'反向操作'，保证回滚+MVCC"
  - "binlog: Server层，逻辑日志，记录'SQL语句/行变更'，保证主从复制"
  - redo log是循环写，binlog是追加写
  - 三者通过两阶段提交保证一致性（见note-xhs-db-014）
first_principle:
  essence: "每种日志解决一个不同的根本问题：崩溃恢复、事务回滚、数据复制"
  derivation: "数据库需要持久性(Durability)→断电不能丢数据→需要记录已做的修改→redo log→需要原子性(Atomicity)→事务失败要回滚→需要记录反向操作→undo log→需要高可用→主从复制→需要记录所有变更→binlog"
  conclusion: "三种日志不是冗余，而是各司其职：redo=持久性，undo=原子性+隔离性，binlog=可复制性"
follow_up:
- redo log和binlog的两阶段提交是怎么保证一致性的？（见note-xhs-db-014）
- 为什么redo log是物理日志而binlog是逻辑日志？各自的优缺点？
- MVCC是怎么利用undo log实现读已提交和可重复读的？
- redo log buffer → redo log file → fsync 的刷盘策略有哪些？
- 组提交(group commit)是什么？为什么能提升性能？
memory_points:
- redo log = InnoDB物理日志 → 崩溃恢复 → 循环写 → WAL机制
- undo log = InnoDB逻辑日志 → 回滚+MVCC → 随事务产生
- binlog = Server层逻辑日志 → 主从复制+归档 → 追加写
- 三者通过两阶段提交(2PC)保证一致性
---

# 【拼多多 Java服务端】binlog、redo log、undo log的作用和区别

> 来源：拼多多211本硕Java服务端面经（已OC）（小红书）

## 一、三种日志总览

```
┌──────────────────────────────────────────────────────────────┐
│                  MySQL 三大日志体系                            │
│                                                               │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐          │
│  │  redo log   │  │  undo log   │  │   binlog    │          │
│  │  (重做日志)  │  │  (回滚日志)  │  │  (归档日志)  │          │
│  ├─────────────┤  ├─────────────┤  ├─────────────┤          │
│  │ InnoDB引擎层 │  │ InnoDB引擎层 │  │  Server层   │          │
│  │ 物理日志     │  │ 逻辑日志     │  │  逻辑日志    │          │
│  │ 循环写      │  │ 随事务产生   │  │  追加写      │          │
│  │ 崩溃恢复    │  │ 回滚+MVCC   │  │ 主从复制+归档│          │
│  │ 保证持久性  │  │ 保证原子性   │  │ 保证可复制   │          │
│  └─────────────┘  └─────────────┘  └─────────────┘          │
│                                                               │
│  WAL (Write-Ahead Logging):                                   │
│  先写redo log → 再修改Buffer Pool数据页 → 最后异步刷磁盘       │
│  crash-safe: 即使数据页没刷盘，redo log已记录，重启可恢复      │
└──────────────────────────────────────────────────────────────┘
```

## 二、详细对比

| 维度 | redo log | undo log | binlog |
|------|----------|----------|--------|
| 所属层 | InnoDB引擎 | InnoDB引擎 | MySQL Server层 |
| 日志类型 | 物理日志（记录页+偏移+值） | 逻辑日志（记录反向操作） | 逻辑日志（SQL/行变更） |
| 写入方式 | 循环写（覆盖旧数据） | 随事务产生 | 追加写（永不覆盖） |
| 主要用途 | 崩溃恢复(crash-safe) | 事务回滚 + MVCC | 主从复制 + 数据归档 |
| 保证特性 | 持久性(Durability) | 原子性+隔离性(A+I) | 可复制性 |
| 格式 | 固定大小文件组 | 存在于系统表空间/undo表空间 | STATEMENT/ROW/MIXED |
| 是否必须 | 是（InnoDB必需） | 是（InnoDB必需） | 否（但主从复制必需） |

## 三、三种日志工作流程

```
┌──────────────────────────────────────────────────────────┐
│           UPDATE t SET name='b' WHERE id=1               │
│                    执行流程与日志记录                      │
│                                                          │
│  1. 执行器调用InnoDB接口，读取id=1的行                    │
│                                                          │
│  2. InnoDB找到数据页(Buffer Pool或磁盘)                   │
│                                                          │
│  3. 记录 undo log                                        │
│     ┌──────────────────────────────────────┐             │
│     │ undo: UPDATE t SET name='a'           │             │
│     │       WHERE id=1 (反向操作)           │             │
│     │ → 支持ROLLBACK + MVCC版本链           │             │
│     └──────────────────────────────────────┘             │
│                                                          │
│  4. 更新Buffer Pool中的数据页                             │
│     ┌──────────────────────────────────────┐             │
│     │ Buffer Pool: 页#5 偏移#100 = 'b'     │             │
│     └──────────────────────────────────────┘             │
│                                                          │
│  5. 写 redo log (prepare状态)                             │
│     ┌──────────────────────────────────────┐             │
│     │ redo: 页#5 偏移#100 改为'b'           │             │
│     │ 状态: PREPARE                         │             │
│     └──────────────────────────────────────┘             │
│                                                          │
│  6. 写 binlog                                            │
│     ┌──────────────────────────────────────┐             │
│     │ binlog: UPDATE t SET name='b'         │             │
│     │         WHERE id=1 (行变更)           │             │
│     └──────────────────────────────────────┘             │
│                                                          │
│  7. 提交 redo log (commit状态) ← 两阶段提交!              │
│     ┌──────────────────────────────────────┐             │
│     │ redo: 状态改为 COMMIT                  │             │
│     └──────────────────────────────────────┘             │
│                                                          │
│  8. 返回成功给客户端                                      │
│                                                          │
│  9. (异步) Buffer Pool脏页刷盘                            │
│  10. (异步) undo log在无事务引用时清理                     │
└──────────────────────────────────────────────────────────┘
```

## 四、WAL (Write-Ahead Logging) 机制

```
┌──────────────────────────────────────────────────┐
│  WAL: 先写日志，后写数据                            │
│                                                   │
│  传统方式(没有WAL):                                │
│  修改数据 → 刷盘 → 如果断电 → 数据丢失!            │
│                                                   │
│  WAL方式:                                          │
│  写redo log → 刷盘 → 修改Buffer Pool              │
│  → (异步)刷数据页                                  │
│  → 如果断电 → 重启时重放redo log → 恢复数据        │
│                                                   │
│  好处:                                             │
│  ① 随机写变顺序写（redo log顺序追加）              │
│  ② 性能提升（不用每次修改都刷数据页）              │
│  ③ crash-safe（日志已落盘即可恢复）                │
│                                                   │
│  redo log刷盘策略 (innodb_flush_log_at_trx_commit):│
│  0 = 每秒刷 (性能好，可能丢1秒数据)                 │
│  1 = 每次提交刷 (安全，性能略低) ⭐推荐             │
│  2 = 每次提交写OS Cache，每秒刷盘                  │
└──────────────────────────────────────────────────┘
```

## 五、面试加分点

1. **redo log vs binlog为什么要两阶段提交**：如果不一致（如redo写完binlog没写完），从库用binlog恢复会丢数据。详见note-xhs-db-014
2. **redo log循环写机制**：固定大小（如4个1GB文件），write pos追着check point跑，check point之前的日志对应的数据已刷盘可以被覆盖
3. **binlog三种格式**：STATEMENT（记SQL，可能有函数不一致问题）、ROW（记行变更，体积大但准确）、MIXED（自动选择，MySQL默认）
4. **undo log版本链**：每行数据有隐藏字段roll_ptr指向上一版本，形成版本链。MVCC通过ReadView + 版本链实现RC和RR隔离级别
5. **binlog和redo log的区别本质**：redo log是"物理日志"（哪个页哪个偏移改成什么），binlog是"逻辑日志"（执行了什么操作）。物理日志恢复更快，逻辑日志跨引擎兼容


## 结构化回答

**30 秒电梯演讲：** 三种日志分别解决三个问题：redo log保证崩溃恢复（持久性），undo log保证回滚和MVCC（原子性+隔离性），binlog保证主从复制和数据归档。

**展开框架：**
1. **redo log** — redo log = InnoDB物理日志 → 崩溃恢复 → 循环写 → WAL机制
2. **undo log** — undo log = InnoDB逻辑日志 → 回滚+MVCC → 随事务产生
3. **binlog** — binlog = Server层逻辑日志 → 主从复制+归档 → 追加写

**收尾：** 这块我踩过坑——要不要深入聊：redo log和binlog的两阶段提交是怎么保证一致性的？（见note-xhs-db-014）？

## 视频脚本

> 预计时长：3 分钟 | 由浅入深

| 时间 | 画面/字幕 | 口播台词 | 讲解要点 |
|------|----------|----------|----------|
| 0:00 | 标题卡 | "MySQL一句话：三种日志分别解决三个问题：redo log保证崩溃恢复（持久性），undo log保证回滚和MVCC（原子性+隔离性）…。" | 开场钩子 |
| 0:15 | MySQL EXPLAIN 执行计划截图 | "redo log 就是 InnoDB物理日志 到 崩溃恢复 到 循环写 到 WAL机制" | redo log |
| 1:06 | MySQL EXPLAIN 执行计划截图分步演示 | "undo log 就是 InnoDB逻辑日志 到 回滚+MVCC 到 随事务产生" | undo log |
| 1:57 | 关键代码/伪代码片段 | "binlog 就是 Server层逻辑日志 到 主从复制+归档 到 追加写" | binlog |
| 2:50 | 总结卡 | "核心抓住这条主线，下期咱们接着聊：redo log和binlog的两阶段提交是怎么保证一致性的？（见note-xhs-db-014）。" | 收尾 |

## 苏格拉底式面试追问

| 追问层级 | 面试官可能这样问 | 高分回答方向 |
|----------|------------------|--------------|
| 目标追问 | MySQL为什么要搞三种不同的日志，一种不行吗？ | 三种日志服务不同目标：redo保证崩溃恢复（持久性）、undo保证回滚和MVCC（原子性+隔离性）、binlog保证主从复制和归档，职责单一互不替代 |
| 证据追问 | 你说redo log是WAL机制，怎么证明它比直接刷脏页快？ | redo是顺序写、固定大小循环写，性能远高于数据页随机写；可通过innodb_flush_log_at_trx_commit参数和benchmark对比证明 |
| 边界追问 | redo log和binlog分别在MySQL架构的哪一层？为什么binlog在Server层？ | redo是InnoDB存储引擎层物理日志；binlog是Server层逻辑日志，所有引擎共用，所以放在Server层做主从复制 |
| 反例追问 | 如果只保留binlog不要redo log，MySQL能正常工作吗？ | 不能。binlog是逻辑日志按语句/行记录，崩溃恢复时无法知道哪些脏页没刷盘；只有redo的物理日志能精确恢复崩溃前状态 |
| 风险追问 | redo log写满了会怎样？对业务有什么影响？ | redo log写满会触发强制刷脏页（checkpoint推进），此时所有更新操作被阻塞，业务出现明显延迟，需监控redo使用率 |
| 验证追问 | 怎么确认一次崩溃恢复中redo log到底做了什么？ | 看error log的recovery日志、innodb_metrics、SHOW ENGINE INNODB STATUS的LOG段，确认恢复的LSN范围 |
| 沉淀追问 | 三种日志的配置参数你们团队是怎么定规范的？ | 沉淀为DBA规范：innodb_flush_log_at_trx_commit=1、sync_binlog=1、binlog_format=ROW，并纳入变更评审 |

### 现场对话示例
**面试官**：binlog、redo log、undo log的作用和区别讲一下。
**候选人**：redo保证崩溃恢复的持久性、undo保证回滚和MVCC的原子性隔离性、binlog保证主从复制和归档，redo在引擎层是物理日志，另两个偏逻辑。
**面试官**：为什么binlog不能替代redo做崩溃恢复？
**候选人**：binlog是逻辑日志，无法记录哪些脏页未刷盘；redo是物理页级别日志，崩溃时能精确重放恢复，这是WAL的核心。
**面试官**：redo log写满了会怎样？
**候选人**：触发强制checkpoint推进刷脏页，期间所有写请求被阻塞，所以线上要监控redo使用率并合理设置大小。
