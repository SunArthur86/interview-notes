---
id: note-mk-010
difficulty: L4
category: ai
subcategory: 桌面AI产品
tags:
- 月之暗面
- 面经
- AI-Native
- 链路设计
- 本地与云端
feynman:
  essence: 本地索引、云端推理和产物导出是三段独立链路，前端要把它们的状态清晰分开（不用一个loading覆盖一切），每段失败提示要明确落在哪一段，traceId贯穿全链路便于复盘。
  analogy: 就像快递物流——揽收（本地索引）、运输（云端推理）、派送（产物导出）是三个独立环节。你不会看到"包裹处理中"就以为到了，而是分别看到"已揽收→运输中→已签收"。
  first_principle: 桌面AI的数据流跨越本地和云端两个执行域。这三段链路的延迟特征、失败模式和处理策略完全不同——本地索引是CPU密集型、云端推理是网络密集型、产物导出是IO密集型。前端必须分别管理每段的状态和错误。
  key_points:
  - '本地索引负责素材准备，云端推理负责生成，导出负责落地'
  - '三段链路的状态要清晰分开，不用一个loading覆盖一切'
  - '失败提示要明确落在哪一段'
  - 'traceId贯穿三段链路，便于复盘'
first_principle:
  essence: 分布式链路追踪在桌面AI中的应用
  derivation: 任务跨3个执行域(本地/云端/本地)→单一loading无法定位问题→分段状态机+统一traceId→每段可独立观察/重试/回滚
  conclusion: 三段链路的可观测性是桌面AI产品的工程核心——用户和开发者都需要知道"卡在哪一段"
follow_up:
- 如果桌面端要接文件、网页和本地目录，你先画哪套权限边界？
- 这个产品要接入更多Agent能力时，哪层架构最不能乱？
---

# 【月之暗面面经】本地索引、云端推理和产物导出是三段链路，前端怎样串起来？

## 一、三段链路全景图

```
┌──────────────────────────────────────────────────────────────────┐
│                     桌面AI任务全链路                               │
├──────────────────────────────────────────────────────────────────┤
│                                                                  │
│  ① 本地索引段        ② 云端推理段        ③ 产物导出段             │
│  (Local Index)       (Cloud Inference)    (Artifact Export)     │
│                                                                  │
│  ┌──────────┐       ┌──────────┐         ┌──────────┐          │
│  │ 文件解析  │       │ Prompt   │         │ 格式转换  │          │
│  │ 目录扫描  │──────→│ 组装     │────────→│ 文件写入  │          │
│  │ OCR提取  │       │ LLM推理  │         │ 导出打包  │          │
│  │ 摘要生成  │       │ 流式输出  │         │ 发布上传  │          │
│  └──────────┘       └──────────┘         └──────────┘          │
│                                                                  │
│  延迟: 秒~分钟        延迟: 秒~分钟         延迟: 毫秒~秒          │
│  失败: 文件不存在     失败: 网络/API         失败: 磁盘空间/权限     │
│  CPU密集              网络密集               IO密集                │
│                                                                  │
│  ←─────── traceId 贯穿全链路 ──────→                             │
│                                                                  │
└──────────────────────────────────────────────────────────────────┘
```

## 二、分段状态机

```typescript
// 每段链路有独立的状态机
type IndexPhase = 
  | { status: 'idle' }
  | { status: 'scanning'; filesProcessed: number; totalFiles: number }
  | { status: 'extracting'; currentFile: string }
  | { status: 'summarizing'; processed: number; total: number }
  | { status: 'done'; fileCount: number; totalTokens: number }
  | { status: 'failed'; error: string; partialResults: boolean };

type InferencePhase =
  | { status: 'idle' }
  | { status: 'preparing'; promptTokens: number }
  | { status: 'streaming'; receivedChars: number; receivedChunks: number }
  | { status: 'done'; outputTokens: number; duration: number }
  | { status: 'failed'; error: string; retryable: boolean }
  | { status: 'timeout'; duration: number };

type ExportPhase =
  | { status: 'idle' }
  | { status: 'converting'; artifactKind: string }
  | { status: 'writing'; bytesWritten: number; totalBytes: number }
  | { status: 'done'; exportPath: string; fileSize: number }
  | { status: 'failed'; error: string };

// 任务总状态 = 三段的组合
interface TaskPhases {
  traceId: string;
  index: IndexPhase;
  inference: InferencePhase;
  export: ExportPhase;
}
```

## 三、分段UI展示

```
┌──────────────────────────────────────────────────────────────────┐
│  任务：生成竞品分析站点                           traceId: a1b2c3 │
├──────────────────────────────────────────────────────────────────┤
│                                                                  │
│  ① 本地索引    ✅ 完成 (3.2s)                                    │
│  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ 100%                          │
│  扫描了 3 个URL + 1 个PDF (共 12,450 tokens)                    │
│                                                                  │
│  ② 云端推理    🔄 流式输出中...                                   │
│  ━━━━━━━━━━━━━━━━━━━━━━━○━━━━━━━ 78%                           │
│  已接收 3,420 字符 | 预计剩余 15s                                │
│                                                                  │
│  ③ 产物导出    ⏳ 等待推理完成                                     │
│  ─────────────────────────────────  0%                          │
│                                                                  │
│  ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─  │
│                                                                  │
│  [ 查看索引详情 ]  [ 查看推理流 ]  [ 暂停 ]  [ 取消 ]            │
└──────────────────────────────────────────────────────────────────┘
```

**关键设计**：
- 三段进度条**独立显示**，不用一个混合 loading
- 每段显示**具体数据**（文件数/token数/字符数）
- 当前活跃段高亮，未开始的段灰显
- 每段可独立展开查看详情

## 四、分段错误处理

```
┌──────────────────────────────────────────────────────────────────┐
│  任务失败                                                        │
├──────────────────────────────────────────────────────────────────┤
│                                                                  │
│  ① 本地索引    ✅ 完成                                           │
│  ② 云端推理    ❌ 失败                                           │
│     ┌────────────────────────────────────────────────┐          │
│     │ 错误：请求超时 (30s)                             │          │
│     │ 原因：云端推理服务响应超时                        │          │
│     │ 建议：检查网络连接或减少输入素材                   │          │
│     │                                                 │          │
│     │ [ 重试此段 ]  [ 减少上下文后重试 ]  [ 查看日志 ] │          │
│     └────────────────────────────────────────────────┘          │
│  ③ 产物导出    ⏳ 未开始（因上一步失败）                           │
│                                                                  │
└──────────────────────────────────────────────────────────────────┘
```

```typescript
// 分段重试：只重试失败的段
async function retryPhase(taskId: string, phase: 'index' | 'inference' | 'export') {
  const task = await taskStore.getTask(taskId);
  
  switch (phase) {
    case 'index':
      // 重新索引（云端推理和导出需要重新执行）
      await reindexInputs(task);
      break;
      
    case 'inference':
      // 只重试推理（复用已有的索引结果）
      const indexResult = task.phases.index;
      if (indexResult.status === 'done') {
        await retryInference(task, indexResult);
      }
      break;
      
    case 'export':
      // 只重试导出（复用推理结果）
      const inferenceResult = task.phases.inference;
      if (inferenceResult.status === 'done') {
        await retryExport(task, inferenceResult);
      }
      break;
  }
}
```

## 五、traceId 全链路追踪

```typescript
// 生成唯一traceId贯穿三段链路
function createTask(): Task {
  const traceId = generateTraceId();  // 如 "task-2024-01-15-a1b2c3"
  
  return {
    id: generateId(),
    traceId,
    phases: {
      index: { status: 'idle' },
      inference: { status: 'idle' },
      export: { status: 'idle' },
    },
    // ...
  };
}

// 每段链路携带traceId
// 本地索引日志
indexLogger.info({ traceId, msg: '开始索引', files: inputRefs });

// 云端请求携带traceId
const response = await fetch('/api/inference', {
  headers: { 'X-Trace-Id': task.traceId },
  body: JSON.stringify({ prompt, context }),
});

// 导出日志
exportLogger.info({ traceId, msg: '开始导出', path: exportPath });

// 用户可以通过traceId查询全链路日志
// GET /api/traces/task-2024-01-15-a1b2c3
// → [索引日志, 推理日志, 导出日志] 按时间排序
```

## 六、常见坑

- **一个loading覆盖一切**：用户不知道当前在索引、推理还是导出，也不知道卡在哪里
- **失败提示不区分**：只显示"任务失败"，不说明是哪一段失败、什么原因
- **整单重试**：索引已经完成了，失败在推理，却要重新索引
- **没有traceId**：出问题后无法关联本地日志和云端日志进行排查
