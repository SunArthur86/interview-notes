---
id: note-ms-005
difficulty: L4
category: frontend
subcategory: AI-Native桌面
tags:
- 月之暗面
- 面经
- Vue
- 状态管理
- 架构设计
feynman:
  essence: 输入框/浮层/选中态留页面层，任务状态/产物状态/文件索引上升到任务层。长任务不绑组件生命周期。
  analogy: 就像公司管理——日常事务(页面层)各组自己管，但项目进度/交付物/资源分配(任务层)必须统一管理。
  first_principle: 状态分层原则：UI临时状态归页面，业务持久状态归任务层。
  key_points:
  - 输入框/浮层/选中态留页面层
  - 任务状态/产物状态/文件索引上升任务层
  - 长任务不绑单组件生命周期
  - 跨窗口共享走统一store或事件总线
first_principle:
  essence: 状态生命周期决定归属层级
  derivation: UI临时状态→随组件生死→页面层→任务/产物状态→跨组件跨窗口→必须上升→否则组件销毁状态丢失
  conclusion: 状态分层的核心判据是状态的生命周期是否超出组件
follow_up:
- Pinia和Vuex在桌面端怎么选？
- 任务层状态怎么持久化？
- 跨窗口状态同步用什么方案？
memory_points:
- 核心判据：状态在用户切走页面后还需看到，就属于任务层
- 页面层存短暂UI状态：如草稿、弹窗开关、折叠状态，组件卸载即丢弃
- 任务层存跨页/长生命状态：如任务队列、文件索引、上下文，需持久化
---

# 【月之暗面面经】Vue 做桌面 AI 产品时，哪些状态应该在页面层，哪些要上升到任务层？

## 核心问题

桌面端 AI 产品有一个独特的架构痛点：**长任务的生命周期远超单页面组件**。用户发起一个文档分析任务（可能跑 3-5 分钟），然后切到另一个页面做别的事——如果任务状态绑定在发起页面的组件上，组件卸载时状态就丢了。

这道题的本质是：**状态的生命周期决定它的归属层级。** 组件销毁就消失的 → 页面层；跨组件/跨窗口/跨会话存活的 → 任务层。

---

## 一、状态分层架构总览

### 1.1 三层状态架构图

```
┌─────────────────────────────────────────────────────────────────┐
│                      全局应用层 (App Store)                       │
│   ┌──────────┐  ┌──────────┐  ┌───────────────┐               │
│   │ 用户配置   │  │ 主题/AI  │  │  窗口管理状态   │               │
│   │ settings  │  │ 模型选择  │  │  windowState  │               │
│   └──────────┘  └──────────┘  └───────────────┘               │
│   生命周期: 整个应用运行期  |  持久化: electron-store / localStorage  │
├─────────────────────────────────────────────────────────────────┤
│                     任务层 (Task Store) ★核心                    │
│   ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐      │
│   │ 任务队列   │  │ 产物管理  │  │ 文件索引   │  │ 上下文引用 │      │
│   │ taskQueue │  │ artifacts│  │ fileIndex │  │ context  │      │
│   └──────────┘  └──────────┘  └──────────┘  └──────────┘      │
│   生命周期: 任务创建到完成/用户清除 | 持久化: SQLite / IndexedDB     │
│   特征: 跨页面、跨窗口、跨组件存活，不随路由切换丢失                 │
├─────────────────────────────────────────────────────────────────┤
│                     页面层 (Page / Component)                    │
│   ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐      │
│   │ 输入框文本  │  │ 弹窗开关  │  │ 列表选中  │  │ 折叠/展开  │      │
│   │ draft    │  │ modalOpen│  │ selected │  │ collapsed│      │
│   └──────────┘  └──────────┘  └──────────┘  └──────────┘      │
│   生命周期: 组件挂载到卸载 | 持久化: 无（可选 sessionStorage）        │
│   特征: 纯UI交互状态，组件销毁即丢弃                                │
└─────────────────────────────────────────────────────────────────┘
```

### 1.2 分层判据：一张决策表

| 状态类型 | 生命周期 | 是否跨组件 | 是否需持久化 | 归属层级 | 示例 |
|---------|---------|-----------|------------|---------|------|
| 输入框草稿 | 组件内 | 否 | 否（可选） | **页面层** | `ref('')` |
| 弹窗/抽屉开关 | 组件内 | 否 | 否 | **页面层** | `ref(false)` |
| 列表选中/筛选 | 页面内 | 可能 | 否 | **页面层** | `ref([])` |
| 表单临时数据 | 页面内 | 否 | 否 | **页面层** | `reactive({})` |
| **任务执行状态** | **跨页面** | **是** | **是** | **任务层** | TaskStore |
| **任务产物结果** | **跨页面** | **是** | **是** | **任务层** | ArtifactStore |
| **文件/素材索引** | **跨页面** | **是** | **是** | **任务层** | FileIndexStore |
| **上下文引用关系** | **跨页面** | **是** | **是** | **任务层** | ContextStore |
| 用户偏好/主题 | 应用级 | 是 | 是 | **全局层** | AppStore |

**一句话原则：如果一个状态在用户切走页面后还需要回来看到 → 它属于任务层，不属于页面层。**

---

## 二、Pinia Store 分层设计

### 2.1 Store 依赖关系

```
                    ┌──────────────┐
                    │  useAppStore │ (全局配置)
                    └──────┬───────┘
                           │
           ┌───────────────┼───────────────┐
           ▼               ▼               ▼
    ┌────────────┐  ┌────────────┐  ┌──────────────┐
    │useTaskStore│  │useFileStore│  │useContextStore│ (任务层)
    │  ★核心     │  │  素材索引   │  │  上下文引用   │
    └──────┬─────┘  └─────┬──────┘  └──────┬───────┘
           │               │                │
           └───────────────┼────────────────┘
                           │ (页面层通过composable消费)
                           ▼
              ┌─────────────────────────┐
              │   useTaskPanel()        │ (页面层组合式函数)
              │   useDraftInput()       │
              │   useModalState()       │
              └─────────────────────────┘
```

### 2.2 TypeScript 类型定义

```typescript
// types/state.ts

// ============ 任务层类型 ============

/** 任务状态枚举 */
type TaskStatus =
  | 'pending'       // 等待中（排队）
  | 'running'       // 执行中
  | 'paused'        // 暂停（等待用户确认）
  | 'completed'     // 已完成
  | 'failed'        // 失败
  | 'cancelled'     // 用户取消

/** 任务类型 */
type TaskType = 'chat' | 'doc_analysis' | 'image_gen' | 'code_gen' | 'data_extract'

/** 任务实体 */
interface Task {
  id: string
  type: TaskType
  status: TaskStatus
  title: string                 // 用户可读标题
  prompt: string                // 原始指令
  progress: number              // 0-100
  createdAt: number
  updatedAt: number
  startedAt?: number
  completedAt?: number
  error?: string                // 失败原因
  retryCount: number            // 重试次数
  // 关联ID
  contextRefIds: string[]       // 引用的上下文素材
  artifactIds: string[]         // 产出的结果
  // 断点续传
  checkpoint?: TaskCheckpoint   // 检查点（用于断点续传）
}

/** 任务断点（用于失败后恢复） */
interface TaskCheckpoint {
  stepIndex: number             // 执行到第几步
  intermediateData?: string     // 中间数据引用
  savedAt: number
}

/** 任务产物 */
interface Artifact {
  id: string
  taskId: string
  type: 'text' | 'markdown' | 'image' | 'file' | 'json'
  title: string
  content: string               // 文本内容 / blob引用
  meta: {
    format: string
    size: number
    createdAt: number
  }
}

/** 文件索引条目 */
interface FileEntry {
  id: string
  sourcePath: string            // 原始路径
  displayName: string
  mimeType: string
  size: number
  taskId?: string               // 关联任务
  addedAt: number
  status: 'indexed' | 'processing' | 'ready'
}

// ============ 页面层类型 ============

/** 页面UI状态（不持久化） */
interface PageUIState {
  draftInput: string            // 输入框草稿
  isSettingsModalOpen: boolean  // 设置弹窗
  selectedTaskIds: string[]     // 任务列表选中项
  expandedTaskId: string | null // 展开的任务卡片
  sortBy: 'created' | 'updated' // 排序方式
  filterStatus: TaskStatus | 'all' // 筛选状态
}
```

### 2.3 任务层 Store 实现

```typescript
// stores/task.store.ts
import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import type { Task, TaskStatus, Artifact, FileEntry } from '@/types/state'

/** ★ 核心：任务管理 Store — 跨页面存活 */
export const useTaskStore = defineStore('task', () => {
  // ---- 状态 ----
  const tasks = ref<Map<string, Task>>(new Map())
  const artifacts = ref<Map<string, Artifact>>(new Map())
  const fileEntries = ref<FileEntry[]>([])

  // ---- 计算属性 ----
  const runningTasks = computed(() =>
    [...tasks.value.values()].filter(t => t.status === 'running')
  )

  const pendingTasks = computed(() =>
    [...tasks.value.values()].filter(t => t.status === 'pending')
  )

  const sortedTasks = computed(() => {
    const all = [...tasks.value.values()]
    return all.sort((a, b) => b.updatedAt - a.updatedAt)
  })

  /** 某个任务的完整快照（含产物和引用） */
  function getTaskSnapshot(taskId: string) {
    const task = tasks.value.get(taskId)
    if (!task) return null

    return {
      task,
      artifacts: task.artifactIds
        .map(id => artifacts.value.get(id))
        .filter(Boolean) as Artifact[],
      files: fileEntries.value.filter(f => f.taskId === taskId)
    }
  }

  // ---- 动作 ----

  /** 创建任务 */
  function createTask(data: Pick<Task, 'type' | 'title' | 'prompt' | 'contextRefIds'>): string {
    const id = `task_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
    const now = Date.now()

    tasks.value.set(id, {
      id, ...data,
      status: 'pending',
      progress: 0,
      createdAt: now,
      updatedAt: now,
      retryCount: 0,
      artifactIds: []
    })
    return id
  }

  /** 更新任务状态（核心：任务状态变更不依赖任何组件） */
  function updateTaskStatus(taskId: string, status: TaskStatus, error?: string) {
    const task = tasks.value.get(taskId)
    if (!task) return

    task.status = status
    task.updatedAt = Date.now()
    task.error = error

    if (status === 'running' && !task.startedAt) task.startedAt = Date.now()
    if (status === 'completed') task.completedAt = Date.now()

    // 触发响应式更新
    tasks.value = new Map(tasks.value)
  }

  /** 添加产物 */
  function addArtifact(taskId: string, artifact: Omit<Artifact, 'id' | 'taskId'>) {
    const id = `art_${Date.now()}`
    const fullArtifact: Artifact = { ...artifact, id, taskId }
    artifacts.value.set(id, fullArtifact)

    const task = tasks.value.get(taskId)
    if (task) task.artifactIds.push(id)
  }

  /** 重试任务（断点续传） */
  function retryTask(taskId: string) {
    const task = tasks.value.get(taskId)
    if (!task) return
    task.retryCount++
    task.error = undefined
    updateTaskStatus(taskId, 'pending')
    // 触发任务执行引擎重新拾取
  }

  /** 持久化到 IndexedDB（防刷新丢失） */
  async function persist() {
    const db = await openDB('task-store', 1)
    await db.put('meta', JSON.stringify([...tasks.value]), 'tasks')
    await db.put('meta', JSON.stringify([...artifacts.value]), 'artifacts')
  }

  /** 从 IndexedDB 恢复 */
  async function restore() {
    const db = await openDB('task-store', 1)
    const taskData = await db.get('meta', 'tasks')
    if (taskData) tasks.value = new Map(JSON.parse(taskData))
    const artData = await db.get('meta', 'artifacts')
    if (artData) artifacts.value = new Map(JSON.parse(artData))
  }

  return {
    tasks, artifacts, fileEntries,
    runningTasks, pendingTasks, sortedTasks,
    getTaskSnapshot, createTask, updateTaskStatus,
    addArtifact, retryTask, persist, restore
  }
})
```

### 2.4 页面层状态：组合式函数（不进 Store）

```typescript
// composables/usePageUI.ts
import { ref, reactive } from 'vue'

/**
 * 页面层UI状态 — 通过组合式函数管理，不进入全局Store
 * 组件卸载即销毁，不持久化
 */
export function useTaskPageUI() {
  // 输入框草稿（仅当前页面有效）
  const draftInput = ref('')

  // 设置弹窗
  const isSettingsOpen = ref(false)

  // 任务列表选中/展开
  const selectedTaskIds = ref<string[]>([])
  const expandedTaskId = ref<string | null>(null)

  // 筛选/排序（纯UI偏好，刷新即重置）
  const sortBy = ref<'created' | 'updated'>('updated')
  const filterStatus = ref<TaskStatus | 'all'>('all')

  // 拖拽中的素材（临时状态）
  const draggingFile = ref<FileEntry | null>(null)

  return {
    draftInput, isSettingsOpen,
    selectedTaskIds, expandedTaskId,
    sortBy, filterStatus, draggingFile
  }
}
```

### 2.5 组件中使用两层状态

```vue
<!-- views/TaskCenter.vue -->
<script setup lang="ts">
import { useTaskStore } from '@/stores/task.store'
import { useTaskPageUI } from '@/composables/usePageUI'

// ★ 任务层状态（来自全局Store，跨页面存活）
const taskStore = useTaskStore()

// ★ 页面层状态（来自组合式函数，组件卸载即销毁）
const { draftInput, isSettingsOpen, expandedTaskId, filterStatus } = useTaskPageUI()

// 提交任务：页面层 → 任务层
function submitTask() {
  if (!draftInput.value.trim()) return

  taskStore.createTask({
    type: 'chat',
    title: draftInput.value.slice(0, 50),
    prompt: draftInput.value,
    contextRefIds: []
  })

  draftInput.value = ''  // 清空输入框（页面层状态）
}

onMounted(() => taskStore.restore())  // 从持久化恢复
watch(() => taskStore.tasks, () => taskStore.persist(), { deep: true })
</script>

<template>
  <div class="task-center">
    <!-- 任务列表来自任务层Store -->
    <div v-for="task in taskStore.sortedTasks" :key="task.id">
      <TaskCard :task="task" :expanded="expandedTaskId === task.id"
                @click="expandedTaskId = task.id" />
    </div>

    <!-- 输入框是页面层状态 -->
    <input v-model="draftInput" @keyup.enter="submitTask" />
  </div>
</template>
```

---

## 三、核心决策：什么状态不该上升？

### 3.1 反模式：什么都塞进 Store

```typescript
// ❌ 反模式：把输入框草稿也放全局Store
const useBadStore = defineStore('bad', () => {
  const inputDraft = ref('')  // 错！输入框文本是纯UI状态
  const modalOpen = ref(false) // 错！弹窗开关是页面级状态
  // ... 这些状态污染了全局store，且组件销毁后还在内存中
})
```

**问题：**
- 全局 Store 膨胀，难以维护
- UI 状态被全局化 → 每个页面打开都共享同一个草稿（跨页面串台）
- 性能：全局响应式追踪范围过大

### 3.2 判据清单

在决定状态归属时，问三个问题：

```
Q1: 用户离开当前页面再回来，这个状态还需要吗？
    → 是 → 任务层
    → 否 → 页面层

Q2: 这个状态需要在另一个窗口中看到吗？
    → 是 → 任务层（+ 跨窗口同步）
    → 否 → 页面层

Q3: 应用重启后这个状态需要恢复吗？
    → 是 → 任务层（+ 持久化）
    → 否 → 页面层
```

### 3.3 灰色地带处理

| 状态 | 分析 | 结论 |
|------|------|------|
| 搜索关键词 | 切走再回来需要？可能。 | **页面层** + sessionStorage（短暂保留） |
| 对话历史 | 跨页面？是。 | **任务层**（每个对话=一个Task） |
| 加载动画 | UI 临时 | **页面层** |
| 任务进度条数值 | 跨页面需要 | **任务层**（task.progress） |
| 当前选中的AI模型 | 全局偏好 | **全局层**（AppStore） |
| 表单未提交数据 | 离开即丢 | **页面层**（或 sessionStorage） |

---

## 四、跨窗口状态同步（Electron 特有）

桌面端可能有多个窗口（主窗口 + 迷你悬浮窗 + 设置窗口），任务层状态需要跨窗口共享：

```typescript
// services/crossWindowSync.ts

/** 跨窗口状态同步：通过IPC事件广播 */
export function setupCrossWindowSync(taskStore: ReturnType<typeof useTaskStore>) {
  const { ipcRenderer } = window.electron

  // 窗口A更新任务 → 广播 → 所有窗口同步
  taskStore.$subscribe((mutation, state) => {
    ipcRenderer.send('task-state-broadcast', {
      type: mutation.type,
      storeId: mutation.storeId,
      // 只传变更的delta，不传全量
      payload: extractDelta(mutation)
    })
  })

  // 接收其他窗口的广播 → 更新本窗口Store
  ipcRenderer.on('task-state-update', (_event, data) => {
    applyDeltaToStore(taskStore, data)
  })
}

/** 主进程作为消息中继 */
// main.ts (Electron主进程)
ipcMain.on('task-state-broadcast', (event, data) => {
  // 广播给除发送者外的所有窗口
  BrowserWindow.getAllWindows().forEach(win => {
    if (win.webContents.id !== event.sender.id) {
      win.webContents.send('task-state-update', data)
    }
  })
})
```

---

## 五、面试高频追问点

### Q1: Pinia 和 Vuex 在桌面端怎么选？

**答：** 毫不犹豫选 Pinia。原因：(1) 组合式 API 天然契合 Vue 3 setup 语法；(2) 支持 TypeScript 类型推断，Vuex 的类型体操痛苦；(3) Pinia 支持模块化拆分（每个 Store 独立），天然适配三层架构；(4) 体积更小。Vuex 是 Vue 2 时代的遗产，新项目不应再选。

### Q2: 任务层状态怎么持久化？

**答：** 分级持久化策略：
- **任务列表 + 元数据** → SQLite（Electron 环境 `better-sqlite3`），结构化查询高效
- **任务产物（大文本/图片）** → 文件系统 + 索引（SQLite 存路径），不存进数据库
- **上下文引用关系** → 随任务一起存入 SQLite JSON 字段
- **用户偏好** → `electron-store`（底层是 JSON 文件）

关键：持久化是**异步的**，不能阻塞 UI。用 debounce + Web Worker（或主进程）执行写入。

### Q3: 为什么不把所有状态都放 Pinia？

**答：** 全局 Store 不是越满越好。纯 UI 状态放 Store 有三个代价：(1) 响应式追踪开销——每个 Store 状态变更都会通知所有订阅者；(2) 跨页面串台——A 页面修改了 `modalOpen`，B 页面的弹窗也变了；(3) 心智负担——开发者不知道某个状态在哪个 Store 里。**页面层状态用 `ref`/`reactive` 在组件内管理，是 Vue 的设计意图。**

### Q4: 长任务执行时，用户关闭了发起页面怎么办？

**答：** 这正是分层设计的核心价值——任务执行逻辑在后端/Worker 中运行，状态在 `useTaskStore` 中。页面组件卸载不影响 Store。用户关闭页面后：(1) 任务继续在后台运行；(2) 系统通知推送结果；(3) 用户重新打开任务中心，`taskStore.restore()` 从持久化恢复所有任务状态。**任务的生命周期独立于任何 UI 组件——这是架构设计的底线。**

---

## 六、实战经验

1. **分层的第一判据：生命周期**。面试中用一句话总结——"状态跟着谁活就归谁管"。组件销毁就死的归页面，跨组件跨窗口活的归任务层。

2. **Pinia Store 不是越多越好**。任务层建议 2-3 个 Store（TaskStore + FileStore + ContextStore），不要按页面拆 Store。全局层 1 个 AppStore 足够。

3. **组合式函数是页面层的最佳实践**。`useTaskPageUI()` 这种 composable 既隔离了页面状态，又比 Store 轻量。多个组件共享页面状态时，composable 单例模式（模块级 `ref`）即可。

4. **持久化是任务层的隐性要求**。桌面端用户可能直接关窗口甚至关应用。任务层状态必须持久化到磁盘（SQLite/IndexedDB），重启后恢复。这不是可选功能，是桌面产品的基本要求。

## 记忆要点

- 核心判据：状态在用户切走页面后还需看到，就属于任务层
- 页面层存短暂UI状态：如草稿、弹窗开关、折叠状态，组件卸载即丢弃
- 任务层存跨页/长生命状态：如任务队列、文件索引、上下文，需持久化

