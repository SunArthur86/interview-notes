---
id: note-mk-009
difficulty: L5
category: ai
subcategory: 桌面AI产品
tags:
- 月之暗面
- 面经
- AI-Native
- 任务中心
- 对象建模
feynman:
  essence: 桌面Agent的任务中心需要建模五大关键对象——任务对象（Task）、输入引用（InputRef）、产物对象（Artifact）、授权对象（Permission）和通知对象（Notification）。每个对象职责单一、能追到来源和下一步动作、可跨页面和窗口复用。
  analogy: 就像飞机场的塔台控制系统——飞机（任务）、跑道（输入）、航站楼（产物）、空管许可（授权）、广播通知（通知）各自独立但协同运转，而不是把所有信息混在一个屏幕上。
  first_principle: 桌面AI产品的复杂度来自多任务、多产物、多窗口的并发管理。如果对象模型不清晰，状态会迅速混乱。任务中心的核心价值是把这些并发状态结构化为可管理、可追踪、可回看的对象体系。
  key_points:
  - 任务对象、输入引用、产物对象、授权对象和通知对象是核心
  - 任务和产物要分开，避免一个对象包太多责任
  - 每个对象都能追到来源和下一步动作
  - 任务中心能跨页面和窗口被复用
first_principle:
  essence: 单一职责原则在AI任务建模中的应用
  derivation: 一个对象包揽所有→状态膨胀→难以测试→拆分为5个独立对象→通过ID引用关联→每个对象可独立演进和测试
  conclusion: 任务中心不是一个"大对象"，而是5个职责单一的对象通过引用关系组成的对象图
follow_up:
- 如果桌面端要接文件、网页和本地目录，你先画哪套权限边界？
- 这个产品要接入更多Agent能力时，哪层架构最不能乱？
memory_points:
- 核心五大对象：Task(任务)、InputRef(输入引用)、Artifact(产物)、Permission(授权)、Notification(通知)。
- 对象关联链路：Task产出Artifact，Task需申请Permission，Artifact触发Notification。
- Task核心追踪：必须包含状态机、进度(0-100)、关联ID列表以及贯穿全局的traceId。
- 独立解耦设计：输入引用抽象为独立对象以便管理上下文，授权对象确保文件系统安全。
---

# 【月之暗面面经】如果让你设计桌面 Agent 的任务中心，会有哪些关键对象？

## 一、五大核心对象

```
┌──────────────────────────────────────────────────────────────────┐
│                      任务中心对象关系图                            │
├──────────────────────────────────────────────────────────────────┤
│                                                                  │
│   ┌──────────┐    引用    ┌──────────┐                          │
│   │  Task    │───────────→│ InputRef │                          │
│   │  任务    │            │ 输入引用  │                          │
│   └────┬─────┘            └──────────┘                          │
│        │                                                        │
│        │ 产出                                                      │
│        ▼                                                        │
│   ┌──────────┐    需要    ┌──────────┐                          │
│   │ Artifact │───────────→│Permission│                          │
│   │  产物    │            │  授权    │                          │
│   └────┬─────┘            └──────────┘                          │
│        │                                                        │
│        │ 触发                                                      │
│        ▼                                                        │
│   ┌──────────┐                                                  │
│   │Notification│                                                 │
│   │   通知    │                                                  │
│   └──────────┘                                                  │
│                                                                  │
└──────────────────────────────────────────────────────────────────┘
```

## 二、对象详细定义

### 1. Task（任务对象）

```typescript
interface Task {
  // 标识
  id: string;
  title: string;              // 用户可读的任务标题
  description?: string;       // 任务描述
  
  // 状态
  status: TaskStatus;         // queued/running/paused/review/done/failed
  progress?: number;          // 0-100
  
  // 关联
  inputRefIds: string[];      // 引用的输入对象ID列表
  artifactIds: string[];      // 产出的产物对象ID列表
  permissionIds: string[];    // 关联的授权对象ID列表
  
  // 追踪
  traceId: string;            // 链路追踪ID（贯穿本地→云端→产物）
  parentTaskId?: string;      // 父任务（如果是从另一个任务派生的）
  
  // 时间
  createdAt: number;
  updatedAt: number;
  startedAt?: number;
  completedAt?: number;
  
  // 错误
  error?: TaskError;
  
  // 元数据
  agentType: string;          // 执行此任务的Agent类型
  priority: 'low' | 'normal' | 'high';
  tags: string[];
}
```

### 2. InputRef（输入引用对象）

```typescript
interface InputRef {
  id: string;
  taskId: string;
  
  // 来源类型
  type: 'file' | 'directory' | 'webpage' | 'screenshot' | 'text' | 'task-output';
  
  // 来源信息
  uri: string;                // 文件路径 / URL / 数据引用
  displayName: string;        // 展示名称
  
  // 提取信息
  summary?: string;           // 一句话摘要
  keyPoints?: string[];       // 关键要点
  tokenCount?: number;        // 消耗的token数
  
  // 状态
  status: 'pending' | 'extracted' | 'stale' | 'failed';
  
  // 时间
  extractedAt?: number;       // 最后一次提取时间
  createdAt: number;
}
```

### 3. Artifact（产物对象）

```typescript
interface Artifact {
  id: string;
  taskId: string;
  
  // 产物信息
  kind: ArtifactKind;         // site/sheet/ppt/chart/document/code/image
  title: string;
  content: string;            // 产物内容（格式取决于kind）
  
  // 版本
  version: number;
  parentVersionId?: string;   // 基于哪个版本重生成
  
  // 状态
  status: ArtifactStatus;     // generating/draft/reviewing/confirmed/exported
  
  // 落地
  exportPath?: string;        // 已导出的路径
  targetPath?: string;        // 计划导出的路径
  
  // 来源
  sourceInputIds: string[];   // 基于哪些输入生成
  promptUsed?: string;        // 生成时使用的prompt
  
  // 时间
  createdAt: number;
  updatedAt: number;
}
```

### 4. Permission（授权对象）

```typescript
interface Permission {
  id: string;
  taskId: string;
  
  // 授权范围
  type: 'file-read' | 'file-write' | 'directory-index' | 'network' | 'system';
  target: string;             // 具体目标（文件路径/目录/域名）
  
  // 状态
  status: 'pending' | 'granted' | 'denied' | 'expired' | 'revoked';
  
  // 有效期
  scope: 'task' | 'session' | 'permanent';
  expiresAt?: number;
  
  // 使用记录
  accessedCount: number;      // 已使用次数
  lastAccessedAt?: number;
  
  // 时间
  grantedAt?: number;
  createdAt: number;
}
```

### 5. Notification（通知对象）

```typescript
interface Notification {
  id: string;
  taskId: string;
  
  // 通知内容
  level: 'critical' | 'important' | 'normal' | 'silent';
  title: string;
  body: string;
  
  // 交互
  actionType?: 'view' | 'confirm' | 'retry' | 'dismiss';
  actionTarget?: string;      // 跳转目标
  
  // 状态
  read: boolean;
  clicked: boolean;
  
  // 时间
  createdAt: number;
  readAt?: number;
}
```

## 三、任务中心的UI架构

```
┌──────────────────────────────────────────────────────────────────┐
│  任务中心                                                        │
├────────┬─────────────────────────────────────────────────────────┤
│        │                                                         │
│ 筛选栏  │  任务列表                              任务详情面板       │
│        │  ┌──────────────────────────────┐  ┌─────────────────┐ │
│ 全部(12)│  │ 🔄 生成站点    运行中 65%     │  │ 任务 #task-042  │ │
│ 进行(2) │  ├──────────────────────────────┤  │                 │ │
│ 待确认  │  │ ⏸️ PPT确认     等待用户       │  │ 📥 输入引用      │ │
│ 完成(8) │  ├──────────────────────────────┤  │ • 竞品URL ×3    │ │
│ 失败(1) │  │ ✅ 周报模板    完成  3产物    │  │ • 分析报告.pdf   │ │
│        │  ├──────────────────────────────┤  │                 │ │
│ 按Agent │  │ ✗ API文档     失败  可重试   │  │ 📤 产物          │ │
│ 按时间  │  └──────────────────────────────┘  │ • 站点 (预览)    │ │
│ 按类型  │                                   │ • 表格 (预览)    │ │
│        │                                   │                 │ │
│        │                                   │ 🔐 授权          │ │
│        │                                   │ • 读取3个URL ✓   │ │
│        │                                   │ • 写入report.md ✓│ │
│        │                                   │                 │ │
│        │                                   │ 🔔 通知          │ │
│        │                                   │ • 完成通知(未读)  │ │
│        │                                   └─────────────────┘ │
└────────┴─────────────────────────────────────────────────────────┘
```

## 四、跨窗口复用设计

```typescript
// 任务中心是全局单例，所有窗口共享
class TaskCenter {
  private static instance: TaskCenter;
  private tasks: Map<string, Task> = new Map();
  
  // 事件订阅（跨窗口同步）
  private subscribers: Set<TaskSubscriber> = new Set();
  
  // 获取任务（任何窗口都能调用）
  getTask(taskId: string): Task | undefined {
    return this.tasks.get(taskId);
  }
  
  // 更新任务状态（会通知所有窗口）
  updateTask(taskId: string, updates: Partial<Task>) {
    const task = this.tasks.get(taskId);
    if (task) {
      Object.assign(task, updates, { updatedAt: Date.now() });
      this.notifySubscribers({ type: 'task-updated', task });
    }
  }
  
  // 订阅变化
  subscribe(callback: TaskSubscriber): () => void {
    this.subscribers.add(callback);
    return () => this.subscribers.delete(callback);
  }
}
```

## 五、常见坑

- **一个对象包太多职责**：Task 对象里直接嵌套产物内容、权限信息、通知列表，导致对象膨胀、难以序列化
- **对象之间没有引用关系**：所有数据平铺，查询"这个任务用了哪些输入"需要遍历全量数据
- **不能跨窗口复用**：每个窗口各自维护任务列表，状态不同步
- **没有追踪链路**：出了问题无法从产物追溯到输入和执行过程

## 记忆要点

- 核心五大对象：Task(任务)、InputRef(输入引用)、Artifact(产物)、Permission(授权)、Notification(通知)。
- 对象关联链路：Task产出Artifact，Task需申请Permission，Artifact触发Notification。
- Task核心追踪：必须包含状态机、进度(0-100)、关联ID列表以及贯穿全局的traceId。
- 独立解耦设计：输入引用抽象为独立对象以便管理上下文，授权对象确保文件系统安全。

## 苏格拉底式面试追问

> 这组追问模拟面试官层层逼问，每一问先回答"为什么"，再回答"怎么做"，最后回答"如何证明"。

### 第一层：目标与动机

**Q：为什么要把任务中心拆成五大对象（Task/InputRef/Artifact/Permission/Notification），而不是用一个大的 Task 对象把所有信息嵌套进去？**

因为"大对象"会导致三个工程灾难：(1) 职责膨胀——Task 对象里嵌套产物内容、权限信息、通知列表，一个对象几十个字段，任何修改都可能影响不相关的功能；(2) 序列化爆炸——Task 对象里嵌套了 5 个 Artifact 的完整 HTML 内容，每次持久化 Task 都要序列化几 MB 数据，性能极差；(3) 查询低效——想知道"这个用户授权过哪些文件"，如果权限嵌在 Task 里，要遍历所有 Task 再提取权限字段；如果 Permission 是独立对象，直接查 Permission 表即可。五大对象的本质是"单一职责原则"在 AI 任务建模中的应用：Task 管状态机和追踪（traceId）、InputRef 管上下文引用、Artifact 管产物内容和版本、Permission 管授权范围和有效期、Notification 管通知分发和交互。它们通过 ID 引用关联（Task.inputRefIds 指向 InputRef 列表），形成对象图而非嵌套对象，每个对象可独立演进、独立查询、独立持久化。

### 第二层：证据与定位

**Q：你怎么定位"任务状态混乱"是对象模型设计问题，而不是状态管理代码的 bug？**

用"对象不变式验证"定位。五大对象各自有不变式（如 Task.status 只能按 queued→running→review→done 流转，不能跳过 running 直接到 done；Artifact.version 必须递增；Permission.status=granted 时 expiresAt 必须 >now）。如果状态混乱是因为不变式被破坏（如出现 status=done 但 progress=50 的 Task），说明是对象模型缺乏约束——状态机没有在对象层做校验，允许了非法状态转换；如果不变式都成立但用户仍看到混乱（如任务列表顺序不对、产物归属错乱），说明是 UI 层的查询/排序逻辑 bug，与对象模型无关。具体定位方法：写一个对象不变式检查器（运行时遍历所有对象验证不变式），在开发模式下持续运行。如果检查器频繁报警，根因是对象模型设计；如果不报警但 UI 仍乱，根因是 UI 逻辑。

### 第三层：根因深挖

**Q：为什么 InputRef 要独立成对象，而不是直接在 Task 里存一个文件路径数组（inputFiles: string[]）？**

因为"输入"不只是"文件路径"，它是一个有自己生命周期的实体。InputRef 独立成对象的三个理由：(1) 输入需要提取状态管理——一个网页 URL 作为输入，需要经过"抓取→正文提取→摘要→Token 计算"的异步流程，状态从 pending→extracted→stale 流转，这个生命周期独立于 Task（Task 可能在 InputRef 还在提取时就已创建）；(2) 输入需要跨任务复用——同一个竞品分析报告 PDF 可能被 3 个不同任务引用，如果每个 Task 各存一份路径，无法做"素材去重"和"提取结果缓存"；InputRef 独立后，多个 Task 引用同一个 InputRef.id，提取只做一次；(3) 输入需要"过期检测"——文件可能被用户删除或修改，InputRef 独立后可以定期检查 stale 状态（对比文件 hash），通知所有引用它的 Task"你的输入素材已过期"。如果只是路径数组，这些能力都无法实现——路径不携带状态、不可复用、不可检测。

**Q：那如果团队觉得五个对象太多，想把 Permission 和 Notification 合并进 Task（只保留 Task/InputRef/Artifact 三个），为什么不简化？**

因为"合并 Permission 和 Notification 进 Task"会丧失两个核心能力。Permission 独立的价值：(1) 权限可以跨任务复用——用户授权了"读取 /Users/you/projects 目录"，这个授权对后续所有任务都有效，不需要每个 Task 各申请一次；如果权限嵌在 Task 里，每个新任务都要重新授权，体验灾难；(2) 权限需要独立撤销——用户在设置页"撤销某项授权"时，如果权限嵌在 Task 里，要遍历所有 Task 找到嵌套的权限记录逐个撤销；Permission 独立后，撤销操作只需改一条 Permission 记录的状态。Notification 独立的价值：(1) 通知需要独立查询——用户查看"所有未读通知"时，如果通知嵌在 Task 里，要遍历所有 Task 提取通知字段再过滤未读；Notification 独立后直接查 Notification 表；(2) 通知有独立生命周期——一条通知从创建到已读到点击，状态流转独立于 Task（Task 可能已完成但通知还没读）。所以五个对象不是"过度设计"，而是各自有不可合并的生命周期和查询需求。

### 第四层：方案权衡

**Q：对象之间的关联你用 ID 引用（Task.artifactIds: string[]）还是嵌套对象（Task.artifacts: Artifact[]），怎么选？**

选 ID 引用，不选嵌套。根因是"序列化/反序列化成本"和"数据一致性"。嵌套的问题：(1) 序列化爆炸——Task 对象嵌套了 Artifact 列表，每个 Artifact 的 content 可能是几 MB 的 HTML，序列化一个 Task 就是几十 MB，持久化和跨窗口传输都极慢；(2) 数据重复——同一个 Artifact 出现在 Task.artifacts 和 ArtifactStore 中两份，更新时要同步两处，容易不一致；(3) 查询僵化——想查"所有 status=draft 的 Artifact"，如果嵌套在 Task 里，要遍历所有 Task 再展开 artifacts 字段过滤；ID 引用时直接查 ArtifactStore。ID 引用的代价是"查询时需要 join"（拿到 Task 后要再查 ArtifactStore 获取详情），但这在本地存储（IndexedDB/SQLite）中是 O(1) 的主键查询，成本极低。所以"ID 引用 + 独立 Store"是大对象图的标准实践（关系型数据库的设计理念），嵌套只适用于"子对象完全属于父对象且不会被独立查询"的场景（如 Task.error 嵌套在 Task 里）。

**Q：那如果团队觉得 ID 引用导致查询链太长（查 Task→查 InputRef→查提取结果，三次查询），为什么不把高频关联的 InputRef 直接嵌套进 Task？**

因为"查询链长"是 Store 层应该优化的性能问题，不是"破坏对象独立性"的理由。优化方法：(1) 批量预加载——TaskStore.getTaskWithDetails(taskId) 一次性 join 查询 Task + 关联的 InputRef + Artifact，返回一个聚合视图（DTO），前端只调一次接口；(2) 缓存层——对高频访问的 InputRef（如最近 7 天的提取结果）做内存缓存，第二次查询直接命中缓存无需 IO；(3) 响应式订阅——前端首次加载 Task 后订阅关联对象的变化（InputRef 提取完成时推送更新），避免轮询。这三种优化都保留了对象的独立性（InputRef 仍在独立的 Store 里），只是在查询层做了聚合。嵌套 InputRef 进 Task 的代价是丧失了"InputRef 跨任务复用""独立过期检测""独立提取状态管理"等能力——这些能力的丧失远比"多一次查询"的成本高。所以根因是"查询性能要用查询层的手段优化（预加载/缓存/订阅），而非用数据层的反范式（嵌套）来交换"。

### 第五层：验证与沉淀

**Q：你怎么验证"五大对象模型"比"单一大对象"更优，怎么证明拆分是值得的？**

用工程效率指标验证：(1) 新功能开发成本——新增一个"通知批量已读"功能，在五大对象模型下只需操作 NotificationStore（一个对象），改动约 20 行代码；在单一大对象下要遍历所有 Task、提取嵌套的通知字段、逐个修改再写回，改动约 100 行且容易出 bug。统计团队一个月内的平均功能开发成本，如果拆分后降低 30% 以上，证明有效。(2) 状态事故率——状态不一致导致的 bug 数，拆分后因对象边界清晰、各自有独立 Store 做校验，事故率应显著下降。(3) 单元测试覆盖率——五大对象各自可独立测试（TaskStore 的测试不依赖 ArtifactStore），拆分后单元测试覆盖率应达到 80% 以上；单一大对象因为耦合严重，覆盖率通常不到 40%。如果这三个指标都显著改善，就证明五大对象的拆分成本（多写几个 Store）远小于其工程收益。

**Q：怎么让团队在扩展对象模型（如新增第六个对象 Schedule，或给 Task 新增字段）时，自觉遵循五大对象的设计原则，而不是随意给 Task 加字段或新建孤立对象？**

把对象模型做成"类型系统 + 代码生成"的强制约束。第一，五大对象的 TypeScript 接口定义在中央 schema 文件里（如 types/domain.ts），所有对象必须继承自 BaseDomainObject（包含 id/createdAt/updatedAt/traceId），新增字段必须走 schema review；第二，每个对象有对应的 Store（TaskStore/InputRefStore/...），UI 层只能通过 Store 的 API 访问对象，不允许直接构造对象字面量——这通过 ESLint 规则禁止 `new Task()`，强制走 `taskStore.create()`；第三，新增对象必须提交"对象设计 RFC"——说明这个对象的职责边界、与现有五大对象的关联关系、不可合并进现有对象的理由，RFC 通过后才能加 schema；第四，给 Task 加字段时自动触发"职责审查"——如果新字段（如 permissions: Permission[]）与现有对象（PermissionStore）职责重叠，CI 报警提示"这个字段应该用 permissionIds: string[] 引用 Permission 对象"。这样对象模型就从"个人随意改"变成了"受约束的演进"。

## 结构化回答

**30 秒电梯演讲：** 桌面Agent的任务中心需要建模五大关键对象——任务对象（Task）、输入引用（InputRef）、产物对象（Artifact）、授权对象（Permission）和通知对象（Notification）。每个对象职责单一。

**展开框架：**
1. **任务对象** — 任务对象、输入引用、产物对象、授权对象和通知对象是核心
2. **任务** — 任务和产物要分开，避免一个对象包太多责任
3. **每个对象都** — 每个对象都能追到来源和下一步动作

**收尾：** 您想深入聊：如果桌面端要接文件、网页和本地目录，你先画哪套权限边界？


## 视频脚本

> 预计时长：5 分钟 | 由浅入深


| 时间 | 画面/字幕 | 口播台词 | 讲解要点 |
|------|----------|----------|----------|
| 0:00 | 标题卡：如果让你设计桌面 Agent 的任务中心，会有哪… | "就像飞机场的塔台控制系统——飞机（任务）、跑道（输入）、航站楼（产物）、空管许可（授权）…" | 开场钩子 |
| 0:20 | 核心概念图 | "桌面Agent的任务中心需要建模五大关键对象——任务对象（Task）、输入引用（InputRef）、产物对象（…" | 核心定义 |
| 0:50 | 任务对象示意图 | "任务对象——任务对象、输入引用、产物对象、授权对象和通知对象是核心" | 要点拆解1 |
| 1:30 | 任务示意图 | "任务——任务和产物要分开，避免一个对象包太多责任" | 要点拆解2 |
| 2:20 | 对比/实战案例图 | "对比一下常见误区和工程实践，看真实场景里怎么取舍。" | 实战与对比 |
| 3:10 | 总结卡 | "记住核心要点。下期我们追问：如果桌面端要接文件、网页和本地目录，你先画哪套权限边界？" | 收尾与钩子 |
