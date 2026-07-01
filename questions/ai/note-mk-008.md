---
id: note-mk-008
difficulty: L3
category: ai
subcategory: 桌面AI产品
tags:
- 月之暗面
- 面经
- AI-Native
- 草稿流
- 结果确认
feynman:
  essence: AI结果越接近真实产物，越不能一步到位直接落库。前端拆成三步——草稿态（AI结果先入草稿，避免误写正式文件）→编辑确认态（支持diff、局部接受和重生成）→发布态（确认后才触发导出/覆盖/发布），整条链路都能回看。
  analogy: 就像法律合同——律师先起草稿（草稿态），双方逐条审查修改（编辑确认态），最后签字盖章才生效（发布态）。不会草稿一写完就直接执行。
  first_principle: AI生成的内容具有不确定性——可能有错误、格式问题或不符合用户预期。直接写入正式产物是不可逆操作，存在数据安全风险。三步拆分的本质是"可逆性设计"——在不可逆操作前增加缓冲层。
  key_points:
  - AI结果先入草稿态，避免误写正式产物
  - 编辑态支持diff、局部接受和重生成
  - 确认后再触发导出、发布或覆盖动作
  - 整条链路都要能回看
first_principle:
  essence: 不可逆操作前的缓冲层设计
  derivation: AI输出有不确定性→直接写入是irreversible操作→需要reversible中间态→草稿(Draft)→审查(Review)→发布(Publish)→每一步都可回退
  conclusion: 三步拆分不是流程冗余，而是安全设计的必要环节——它把AI的不可控性限制在草稿层
follow_up:
- 如果桌面端要接文件、网页和本地目录，你先画哪套权限边界？
- 这个产品要接入更多Agent能力时，哪层架构最不能乱？
memory_points:
- 核心是状态隔离与可逆：因为直接覆盖文件不可逆，所以需拆分为草稿态、编辑态和发布态。
- 强调控制权：草稿不直接写入目标，而是进入隔离区供用户审查并对比。
- 版本机制兜底：即使到最后发布态不可逆，也必须依赖版本历史支持随时回退。
- 防患于未然：前置拆分能有效拦截AI幻觉或错误覆盖，保障数据安全。
---

# 【月之暗面面经】桌面端为什么要把结果编辑、确认和发布拆成三步？

## 一、为什么不能一步到位

```
一步到位的后果：
  用户请求 → AI直接覆盖文件 → 发现结果有问题 → 已无法回退 💥

三步拆分的流程：
  用户请求 → AI生成草稿 → 用户审查编辑 → 确认发布 → 可随时回看版本
     ↓            ↓            ↓           ↓
   发起        可逆          可逆       不可逆（但有版本历史）
```

## 二、三步状态机

```
┌──────────────────────────────────────────────────────────────┐
│                                                              │
│   ┌─────────┐     ┌─────────┐     ┌─────────┐              │
│   │  草稿态  │────→│  编辑态  │────→│  发布态  │              │
│   │ Draft   │     │ Review  │     │ Publish │              │
│   └────┬────┘     └────┬────┘     └─────────┘              │
│        │               │                                     │
│        │     ┌─────────┴─────────┐                          │
│        │     │                   │                          │
│        │     ▼                   ▼                          │
│        │  局部接受           整单重生成                       │
│        │     │                   │                          │
│        │     └───────┬───────────┘                          │
│        │             │                                      │
│        ▼             ▼                                      │
│   ┌──────────────────────┐                                 │
│   │   版本历史（可回退）    │                                 │
│   │   v1 → v2 → v3 → ...  │                                 │
│   └──────────────────────┘                                 │
│                                                              │
└──────────────────────────────────────────────────────────────┘
```

## 三、各步骤详细设计

### Step 1: 草稿态（Draft）

AI生成的内容**不直接写入目标文件**，而是进入草稿区：

```typescript
interface DraftArtifact {
  id: string;
  taskId: string;
  
  // 草稿内容
  content: string;          // AI生成的完整内容
  
  // 目标信息（草稿不会写入目标）
  targetType: 'file' | 'directory' | 'clipboard' | 'publish';
  targetPath?: string;      // 计划写入的路径
  
  // 对比信息
  originalContent?: string;  // 如果目标文件已存在，保存原始内容
  
  // 状态
  status: 'draft';
  createdAt: number;
}
```

```
草稿区展示：
┌────────────────────────────────────────────────────────────────┐
│  📝 草稿：报告.md                                草稿态 v1     │
├────────────────────────────────────────────────────────────────┤
│                                                                │
│  AI已生成报告草稿。此内容尚未写入任何文件。                      │
│                                                                │
│  目标文件：/Users/you/Documents/report.md                      │
│  当前状态：文件不存在（新建）                                    │
│                                                                │
│  草稿预览：                                                    │
│  ┌────────────────────────────────────────────────────────┐   │
│  │ # 2024 Q4 竞品分析报告                                 │   │
│  │                                                        │   │
│  ## 1. 市场概况                                          │   │
│  │ 本季度AI编程工具市场增长45%...                          │   │
│  │                                                        │   │
│  │ ## 2. 竞品对比                                         │   │
│  │ | 产品 | 市场份额 | 增长率 |                            │   │
│  │ |------|---------|--------|                            │   │
│  │ | Cursor | 35% | +120% |                              │   │
│  └────────────────────────────────────────────────────────┘   │
│                                                                │
│  [ 进入编辑 ]  [ 直接发布 ]  [ 重新生成 ]  [ 丢弃 ]            │
└────────────────────────────────────────────────────────────────┘
```

### Step 2: 编辑确认态（Review）

用户可以审查、修改、局部接受或拒绝草稿：

```
┌────────────────────────────────────────────────────────────────┐
│  ✏️ 编辑确认：报告.md                            编辑态 v1     │
├────────────────────────────────────────────────────────────────┤
│                                                                │
│  Diff 视图（原始 vs 草稿）：                                    │
│                                                                │
│  ┌──────────────────────┬──────────────────────┐              │
│  │     原始内容          │     AI草稿           │              │
│  ├──────────────────────┼──────────────────────┤              │
│  │ # 季度报告            │ # 2024 Q4 竞品分析报告│ ← 标题修改  │
│  │                      │ + 日期更新            │              │
│  │ ## 市场概况           │ ## 1. 市场概况        │ ← 编号添加  │
│  │ AI市场增长30%         │ AI编程工具市场增长45% │ ← 数据更新  │
│  │                      │ + 新增竞品对比表格     │ ← 新增内容  │
│  │ ## 结论               │ ## 3. 结论与建议      │ ← 扩充      │
│  └──────────────────────┴──────────────────────┘              │
│                                                                │
│  变更统计：+12行 | -3行 | ~5行修改                              │
│                                                                │
│  操作选项：                                                    │
│  [ 全部接受 ]  [ 全部拒绝 ]  [ 局部接受 ]  [ 继续编辑 ]        │
│                                                                │
│  局部接受（逐条勾选）：                                         │
│  ☑ 标题更新：「季度报告」→「2024 Q4 竞品分析报告」              │
│  ☑ 数据更新：增长30%→45%                                      │
│  ☐ 新增表格：竞品对比（点击预览）                               │
│  ☑ 结论扩充：新增建议部分                                      │
│                                                                │
│                                          [ 确认并发布 ]        │
└────────────────────────────────────────────────────────────────┘
```

```typescript
// 局部接受实现
interface PartialAccept {
  changes: Array<{
    id: string;
    type: 'add' | 'modify' | 'delete';
    accepted: boolean;        // 是否接受此变更
    originalRange?: [number, number];  // 原始行范围
    draftRange?: [number, number];     // 草稿行范围
  }>;
}

function applyPartialAccept(draft: DraftArtifact, accept: PartialAccept): string {
  let result = draft.originalContent || '';
  
  for (const change of accept.changes) {
    if (!change.accepted) continue;
    
    switch (change.type) {
      case 'add':
        result = insertLines(result, change.draftRange, draft.content);
        break;
      case 'modify':
        result = replaceLines(result, change.originalRange, change.draftRange, draft.content);
        break;
      case 'delete':
        result = removeLines(result, change.originalRange);
        break;
    }
  }
  
  return result;
}
```

### Step 3: 发布态（Publish）

确认后才执行实际写入操作：

```typescript
async function publish(draft: DraftArtifact, reviewedContent: string) {
  // 1. 创建版本快照（可回退）
  const version = await versionStore.createSnapshot({
    taskId: draft.taskId,
    artifactId: draft.id,
    content: reviewedContent,
    previousContent: draft.originalContent,
  });
  
  // 2. 执行写入
  switch (draft.targetType) {
    case 'file':
      await fs.writeFile(draft.targetPath, reviewedContent);
      break;
    case 'directory':
      await exportToDirectory(draft.targetPath, reviewedContent);
      break;
    case 'clipboard':
      await clipboard.writeText(reviewedContent);
      break;
    case 'publish':
      await publishToRemote(reviewedContent);
      break;
  }
  
  // 3. 更新状态
  draft.status = 'published';
  
  // 4. 记录审计日志
  auditLog.record({
    action: 'publish',
    artifactId: draft.id,
    target: draft.targetPath,
    version: version.id,
    timestamp: Date.now(),
  });
}
```

## 四、整条链路回看

```
┌──────────────────────────────────────────────────────────────────┐
│  版本历史：report.md                                              │
├──────────────────────────────────────────────────────────────────┤
│                                                                  │
│  v3  2024-01-15 15:30  ✅ 已发布                                 │
│  │   操作：用户编辑后确认发布                                     │
│  │   变更：+5行 / -2行                                           │
│  │   [ 查看 ] [ 对比v2 ] [ 回退到此版本 ]                        │
│  │                                                               │
│  v2  2024-01-15 14:35  ✅ 已发布                                 │
│  │   操作：AI生成后局部接受                                       │
│  │   变更：+12行 / -3行                                          │
│  │   [ 查看 ] [ 对比v1 ] [ 回退到此版本 ]                        │
│  │                                                               │
│  v1  2024-01-15 14:00  ✅ 原始版本                               │
│      操作：手动创建                                               │
│      [ 查看 ]                                                    │
│                                                                  │
└──────────────────────────────────────────────────────────────────┘
```

## 五、不同产物类型的三步差异

| 产物类型 | 草稿态 | 编辑态 | 发布态 |
|---------|--------|--------|--------|
| 文本文件 | Markdown预览 | Diff视图+局部接受 | 写入文件 |
| 站点 | 内嵌预览 | 代码编辑+实时预览 | 导出HTML压缩包 |
| PPT | 幻灯片缩略图 | 逐页编辑 | 导出PPTX |
| 表格 | 表格预览 | 单元格编辑 | 导出XLSX |

## 六、常见坑

- **AI直接覆盖文件**：没有草稿缓冲层，用户无法控制风险
- **编辑态不支持局部接受**：只能全盘接受或全盘拒绝，用户无法精细控制
- **发布后没有版本历史**：出了问题无法回退到之前的版本
- **没有审计日志**：无法追踪谁在什么时候改了什么

## 记忆要点

- 核心是状态隔离与可逆：因为直接覆盖文件不可逆，所以需拆分为草稿态、编辑态和发布态。
- 强调控制权：草稿不直接写入目标，而是进入隔离区供用户审查并对比。
- 版本机制兜底：即使到最后发布态不可逆，也必须依赖版本历史支持随时回退。
- 防患于未然：前置拆分能有效拦截AI幻觉或错误覆盖，保障数据安全。

