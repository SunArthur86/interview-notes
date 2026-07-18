---
id: note-bd6-001
difficulty: L4
category: system-design
subcategory: 高并发
tags:
- 字节
- 后端
- 系统设计
- 大数据导出
- OSS
- 幂等
- 面经
feynman:
  essence: 千万级数据导出报表的核心是"分而治之"——按分片键切分数据，多线程并行处理，结果分片上传OSS，支持断点续传和幂等校验。关键挑战是内存控制（流式处理）和一致性保证（幂等+校验）。
  analogy: 像搬家——不可能一次性把所有东西塞一辆车（OOM），要分批次打包（分片），多辆车同时搬（并行），每车到了签收（校验），中途歇了知道从哪继续（续传）。
  key_points:
  - 数据切分：按ID范围或Hash分片，每片10-50万行
  - 并行处理：线程池并发处理多个分片，控制并发度防OOM
  - 流式写入：SXSSF或EasyExcel流式写，不全加载到内存
  - 幂等设计：任务ID+分片号做唯一标识，重试不重复
  - 断点续传：记录已完成分片状态，中断后从断点继续
first_principle:
  essence: 大数据导出 = 数据切分 + 并行处理 + 流式IO + 状态管理
  derivation: 千万级数据无法一次性加载内存→按分片键切分成N个独立子任务→多线程并行处理→流式写入避免OOM→记录状态支持续传和幂等→合并结果上传OSS
  conclusion: 核心是"把不可控的大任务分解为可控的小任务"，每个小任务可独立执行、重试、校验
follow_up:
- 如何控制内存使用？（游标分页+流式写入+限制并发度）
- 导出过程中数据变化了怎么办？（快照读+版本号）
- 如何保证数据一致性？（行数校验+checksum+幂等）
- 如果某个分片失败怎么处理？（独立重试+死信队列+人工补偿）
memory_points:
- 五大要求：数据切分、并行处理、续传、差错校验、幂等、内存控制、顺序保证、一致性
- 数据切分：按ID范围分片(每片10-50万行)，或按Hash均匀分布
- 流式写入：EasyExcel/SXSSF(窗口大小100行)，避免百万行全加载内存
- 幂等：任务ID+分片号唯一标识，重试跳过已完成的分片
- 续传：Redis记录分片状态(PENDING/RUNNING/DONE/FAILED)，重启后从断点继续
---

# 【字节一面】使用普通数据库和Java原生手段，设计一个千万级数据量导出报表到OSS的流程

> 来源：小红书 字节后端一二三面面试全流程回顾

## 一、整体架构

```
┌──────────────────────────────────────────────────────────┐
│                  千万级数据导出架构                         │
│                                                          │
│  用户发起导出                                              │
│       │                                                  │
│       ▼                                                  │
│  ┌──────────┐                                           │
│  │ 任务管理   │ → 生成task_id，状态=PENDING               │
│  │ Service  │ → 数据切分：分成N个分片                     │
│  └────┬─────┘                                           │
│       │                                                  │
│       ▼                                                  │
│  ┌──────────────────────────────────────┐               │
│  │ 线程池（核心8/最大16/队列100）          │               │
│  │                                      │               │
│  │  Worker1: 分片0 (ID: 1~500000)      │               │
│  │  Worker2: 分片1 (ID: 500001~1000000)│               │
│  │  Worker3: 分片2 (ID: 1000001~...)   │               │
│  │  ...                                 │               │
│  │  每个Worker:                          │               │
│  │    1. 游标分页查询(每页10000)          │               │
│  │    2. EasyExcel流式写入临时文件        │               │
│  │    3. 上传分片文件到OSS               │               │
│  │    4. 更新分片状态=DONE               │               │
│  └──────────────────────────────────────┘               │
│       │                                                  │
│       ▼                                                  │
│  ┌──────────┐                                           │
│  │ 合并Service│ → 检查所有分片DONE → 合并/记录OSS路径      │
│  │          │ → 更新任务状态=COMPLETED                   │
│  └──────────┘                                           │
│       │                                                  │
│       ▼                                                  │
│  通知用户（MQ/短信/邮件）→ 下载链接                        │
│                                                          │
└──────────────────────────────────────────────────────────┘
```

## 二、核心实现

### 数据切分

```java
@Service
public class ExportTaskService {
    
    @Transactional
    public String createExportTask(ExportRequest req) {
        // 1. 创建任务记录
        String taskId = UUID.randomUUID().toString();
        exportTaskMapper.insert(taskId, req, "PENDING");
        
        // 2. 数据切分：按ID范围分片
        long totalCount = dataMapper.count(req.getCondition());
        int shardSize = 500_000; // 每片50万行
        int shardCount = (int) Math.ceil((double) totalCount / shardSize);
        
        // 3. 创建分片记录
        for (int i = 0; i < shardCount; i++) {
            ExportShard shard = new ExportShard();
            shard.setTaskId(taskId);
            shard.setShardNo(i);
            shard.setStartId((long) i * shardSize + 1);
            shard.setEndId((long) (i + 1) * shardSize);
            shard.setStatus("PENDING");
            shardMapper.insert(shard);
        }
        
        // 4. 提交分片任务到线程池
        for (int i = 0; i < shardCount; i++) {
            exportExecutor.submit(() -> processShard(taskId, i));
        }
        
        return taskId;
    }
}
```

### 分片处理（游标分页 + 流式写入）

```java
public void processShard(String taskId, int shardNo) {
    ExportShard shard = shardMapper.find(taskId, shardNo);
    
    // 幂等检查：已完成的分片直接跳过
    if ("DONE".equals(shard.getStatus())) {
        return;
    }
    
    // 标记为运行中
    shardMapper.updateStatus(taskId, shardNo, "RUNNING");
    
    String tempFile = "/tmp/export/" + taskId + "_shard_" + shardNo + ".xlsx";
    
    try {
        // 使用EasyExcel流式写入（内存只保留窗口内数据）
        ExcelWriter writer = EasyExcel.write(tempFile, ExportData.class)
            .registerWriteHandler(new SimpleColumnWidthStyleStrategy(20))
            .build();
        WriteSheet sheet = EasyExcel.writerSheet("data").build();
        
        // 游标分页查询（避免OFFSET性能问题）
        long cursor = shard.getStartId();
        int pageSize = 10_000;
        int totalRows = 0;
        
        while (cursor <= shard.getEndId()) {
            // SELECT * FROM data WHERE id > cursor AND id <= endId 
            //   AND condition ORDER BY id LIMIT pageSize
            List<ExportData> batch = dataMapper.findByCursor(
                cursor, shard.getEndId(), condition, pageSize);
            
            if (batch.isEmpty()) break;
            
            // 流式写入（不在内存累积所有数据）
            writer.write(batch, sheet);
            
            cursor = batch.get(batch.size() - 1).getId();
            totalRows += batch.size();
        }
        
        writer.finish();
        
        // 上传到OSS
        String ossKey = "exports/" + taskId + "/shard_" + shardNo + ".xlsx";
        ossClient.uploadFile(ossKey, tempFile);
        
        // 差错校验：记录行数用于后续比对
        shardMapper.updateStatusAndCount(taskId, shardNo, "DONE", totalRows);
        
        // 删除临时文件
        new File(tempFile).delete();
        
    } catch (Exception e) {
        shardMapper.updateStatus(taskId, shardNo, "FAILED");
        // 失败的分片可以独立重试
        throw new RuntimeException(e);
    }
    
    // 检查所有分片是否完成
    checkAllShardsDone(taskId);
}
```

### 断点续传与幂等

```java
// 服务重启后：扫描RUNNING状态的分片 → 重新执行（幂等设计保证安全）
@Scheduled(fixedRate = 60000)
public void resumeStalledShards() {
    // 找出超过5分钟仍在RUNNING的分片（可能Worker挂了）
    List<ExportShard> stalled = shardMapper.findStalled("RUNNING", 5);
    for (ExportShard shard : stalled) {
        // 重新提交执行（幂等：已上传的OSS文件会被覆盖，已DONE的跳过）
        exportExecutor.submit(() -> processShard(shard.getTaskId(), shard.getShardNo()));
    }
}

// 幂等保证：
// 1. 分片状态检查：DONE的直接跳过
// 2. OSS覆盖：同key上传会覆盖，不会产生重复文件
// 3. 行数校验：合并时比对各分片行数总和与DB总行数
```

### 差错校验与一致性

```java
public void checkAllShardsDone(String taskId) {
    int doneCount = shardMapper.countByStatus(taskId, "DONE");
    int totalCount = shardMapper.countByTaskId(taskId);
    
    if (doneCount == totalCount) {
        // 所有分片完成 → 校验行数
        long exportedRows = shardMapper.sumRowCount(taskId);
        long dbRows = dataMapper.count(exportTaskMapper.getCondition(taskId));
        
        if (exportedRows != dbRows) {
            // 行数不一致 → 标记异常，人工介入
            exportTaskMapper.updateStatus(taskId, "VERIFICATION_FAILED");
            alertService.notify("导出行数不一致: exported=" + exportedRows + " db=" + dbRows);
            return;
        }
        
        // 校验通过 → 记录OSS路径 → 通知用户
        List<String> ossPaths = shardMapper.findOssPaths(taskId);
        exportTaskMapper.updateStatusAndResult(taskId, "COMPLETED", 
            JSON.toJSONString(ossPaths));
        notifyService.sendDownloadLink(taskId);
    }
}
```

## 三、关键设计决策

| 决策点 | 方案 | 理由 |
|-------|------|------|
| **分页方式** | 游标分页(cursor) | OFFSET在大数据量下性能急剧下降 |
| **写入方式** | EasyExcel/SXSSF流式 | 传统POI全加载到内存会OOM |
| **并发度** | 8-16个线程 | 太多压DB，太少导出慢 |
| **临时文件** | 本地磁盘 | 内存不可靠，磁盘可续传 |
| **分片大小** | 50万行/片 | 平衡并行度和单片处理时间 |
| **状态存储** | MySQL | 持久化，重启可恢复 |

## 四、面试加分点

1. **游标分页 vs OFFSET**：能说出OFFSET在大数据量下扫描大量无用行，游标分页利用索引直接定位
2. **流式写入**：EasyExcel/SXSSF内部维护固定大小的窗口（如100行），超出写磁盘不全留内存
3. **幂等设计贯穿全程**：分片状态检查、OSS覆盖写入、行数校验三重保证
4. **断点续传**：Worker宕机后定时任务扫描RUNNING状态的分片自动重试
5. **差错校验**：导出行数 vs DB行数比对，checksum校验文件完整性


## 结构化回答

**30 秒电梯演讲：** 千万级数据导出报表的核心是"分而治之"——按分片键切分数据，多线程并行处理，结果分片上传OSS，支持断点续传和幂等校验。

**展开框架：**
1. **五大要求** — 数据切分、并行处理、续传、差错校验、幂等、内存控制、顺序保证、一致性
2. **数据切分** — 按ID范围分片(每片10-50万行)，或按Hash均匀分布
3. **流式写入** — EasyExcel/SXSSF(窗口大小100行)，避免百万行全加载内存

**收尾：** 这块我踩过坑——要不要深入聊：如何控制内存使用？（游标分页+流式写入+限制并发度）？

## 视频脚本

> 预计时长：4 分钟 | 由浅入深

| 时间 | 画面/字幕 | 口播台词 | 讲解要点 |
|------|----------|----------|----------|
| 0:00 | 标题卡 | "高并发一句话：千万级数据导出报表的核心是'分而治之'——按分片键切分数据，多线程并行处理…。" | 开场钩子 |
| 0:15 | JVM 内存结构图 | "五大要求：数据切分、并行处理、续传、差错校验、幂等、内存控制、顺序保证、一致性" | 五大要求 |
| 1:08 | JVM 内存结构图分步演示 | "数据切分：按ID范围分片(每片10-50万行)，或按Hash均匀分布" | 数据切分 |
| 2:01 | 关键代码/伪代码片段 | "流式写入：EasyExcel/SXSSF(窗口大小100行)，避免百万行全加载内存" | 流式写入 |
| 2:54 | 对比表格 | "幂等：任务ID+分片号唯一标识，重试跳过已完成的分片" | 幂等 |
| 3:50 | 总结卡 | "核心抓住这条主线，下期咱们接着聊：如何控制内存使用？（游标分页+流式写入+限制并发度）。" | 收尾 |

## 苏格拉底式面试追问

| 追问层级 | 面试官可能这样问 | 高分回答方向 |
|----------|------------------|--------------|
| 目标追问 | 千万级数据导出报表的核心挑战是什么？ | 数据量大不能一次性加载、耗时久不能同步阻塞用户、并发导出占资源、失败要可恢复——核心是分而治之+异步+可控并发 |
| 证据追问 | 为什么用分片键切分？怎么切？ | 按时间/ID范围/Hash分片，多线程并行处理各分片；分片保证每个任务数据量可控、可并行、失败可重试单分片 |
| 边界追问 | 同步导出和异步导出怎么选？ | 小数据量（<10万）同步直接返回；千万级必须异步——提交任务返回任务ID，后台处理完通知下载，避免连接超时 |
| 反例追问 | 用SELECT *一次性查千万行导出会怎样？ | OOM（结果集撑爆内存）、长事务锁表、连接超时、阻塞其他业务——必须流式查询+分批处理 |
| 风险追问 | 千万级导出的风险有哪些？ | 数据库压力（慢查询影响在线）、内存OOM、任务堆积、文件存储压力、失败重试风暴 |
| 验证追问 | 怎么验证方案可靠？ | 压测导出耗时和资源占用、断点续传测试、失败重试测试、监控任务成功率和数据库负载 |
| 沉淀追问 | 导出方案怎么沉淀？ | 规范：分片+异步+流式+OSS存储、限流控并发、失败重试、进度查询、数据库读写分离 |

### 现场对话示例
**面试官**：用普通数据库和Java原生手段，设计千万级数据导出报表到OSS的流程。
**候选人**：分而治之：按分片键切分数据，多线程并行处理各分片，流式查询避免OOM，结果写OSS，异步任务+进度查询，失败可重试单分片。
**面试官**：为什么不能SELECT *一次性导出？
**候选人**：千万行结果集会OOM、长事务锁表、连接超时、阻塞在线业务，必须流式查询分批处理。
**面试官**：怎么控制对数据库的影响？
**候选人**：读写分离走从库、限流控并发、避开高峰、流式查询、分片小事务，监控数据库负载必要时降级。
