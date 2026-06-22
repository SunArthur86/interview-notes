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
  - '任务对象、输入引用、产物对象、授权对象和通知对象是核心'
  - '任务和产物要分开，避免一个对象包太多责任'
  - '每个对象都能追到来源和下一步动作'
  - '任务中心能跨页面和窗口被复用'
first_principle:
  essence: 单一职责原则在AI任务建模中的应用
  derivation: 一个对象包揽所有→状态膨胀→难以测试→拆分为5个独立对象→通过ID引用关联→每个对象可独立演进和测试
  conclusion: 任务中心不是一个"大对象"，而是5个职责单一的对象通过引用关系组成的对象图
follow_up:
- 如果桌面端要接文件、网页和本地目录，你先画哪套权限边界？
- 这个产品要接入更多Agent能力时，哪层架构最不能乱？
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
