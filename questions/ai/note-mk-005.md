---
id: note-mk-005
difficulty: L4
category: ai
subcategory: 桌面AI产品
tags:
- 月之暗面
- 面经
- AI-Native
- Vue
- 状态分层
feynman:
  essence: 桌面AI产品需要严格的状态分层——输入框、浮层、选中态等短暂交互状态留在页面层；任务状态、产物状态、文件索引状态上升到任务层（全局store）；长任务不绑定单个组件生命周期，跨窗口共享数据走统一store或事件总线。
  analogy: 就像公司管理——员工工位上的东西（页面层）随时可以清理，但项目档案和合同（任务层）必须存在公司档案室，不会因为换了工位就丢失。
  first_principle: 桌面应用的生命周期远长于单页面。组件挂载/卸载会频繁发生，但长任务可能运行几十分钟。如果任务状态绑定在组件上，组件销毁时任务就丢了——这是桌面应用和Web页面最本质的区别。
  key_points:
  - '输入框、浮层和选中态留在页面层'
  - '任务状态、产物状态和文件索引状态上升到任务层'
  - '长任务不要绑在单个组件生命周期上'
  - '跨窗口共享的数据要走统一store或事件总线'
first_principle:
  essence: 状态生命周期 vs 组件生命周期的解耦
  derivation: 组件生命周期（秒级）<< 任务生命周期（分钟到小时级）→ 状态必须独立于组件存储 → 全局TaskStore管理持久状态 → 组件只做展示和触发
  conclusion: 桌面AI产品的状态架构是"任务中心化"——所有长生命周期状态集中在TaskStore，页面层只管理短暂交互
follow_up:
- 如果桌面端要接文件、网页和本地目录，你先画哪套权限边界？
- 这个产品要接入更多Agent能力时，哪层架构最不能乱？
---

# 【月之暗面面经】Vue 做桌面 AI 产品时，哪些状态应该在页面层，哪些要上升到任务层？

## 一、问题本质：状态生命周期错配

Vue 开发者习惯把状态放在组件 data 里或 Pinia store 里。但在桌面 AI 产品中，这会导致严重的生命周期错配：

```
组件生命周期：挂载 → 更新 → 卸载（秒级到分钟级）
任务生命周期：创建 → 排队 → 执行 → 产物确认 → 完成（分钟到小时级）

如果一个长任务（运行30分钟）的状态放在某个Vue组件里：
  用户切换页面 → 组件卸载 → 状态丢失 → 任务中断 → 数据丢失 💥
```

## 二、状态分层模型

```
┌──────────────────────────────────────────────────────────────────┐
│                     状态分层金字塔                                 │
├──────────────────────────────────────────────────────────────────┤
│                                                                  │
│  Layer 3: 全局任务层（TaskStore）—— 分钟到小时级                   │
│  ┌────────────────────────────────────────────────────────┐     │
│  │ • 任务队列和状态机                                      │     │
│  │ • 产物对象和版本历史                                    │     │
│  │ • 文件索引缓存                                          │     │
│  │ • 授权记录                                              │     │
│  │ • 长任务执行进度                                        │     │
│  │ • 跨窗口共享数据                                        │     │
│  └────────────────────────────────────────────────────────┘     │
│                                                                  │
│  Layer 2: 会话层（SessionStore）—— 分钟级                         │
│  ┌────────────────────────────────────────────────────────┐     │
│  │ • 当前选中的任务                                        │     │
│  │ • 当前展开的产物                                        │     │
│  │ • 对话历史                                              │     │
│  │ • 上下文素材引用                                        │     │
│  │ • 筛选和排序状态                                        │     │
│  └────────────────────────────────────────────────────────┘     │
│                                                                  │
│  Layer 1: 页面层（Component State）—— 秒级                        │
│  ┌────────────────────────────────────────────────────────┐     │
│  │ • 输入框内容                                            │     │
│  │ • 浮层/弹窗开关                                         │     │
│  │ • 列表选中/悬停态                                       │     │
│  │ • 拖拽中间态                                            │     │
│  │ • 动画状态                                              │     │
│  │ • 表单临时数据                                          │     │
│  └────────────────────────────────────────────────────────┘     │
│                                                                  │
└──────────────────────────────────────────────────────────────────┘
```

## 三、详细状态归属表

| 状态 | 归属层 | 理由 |
|------|--------|------|
| 输入框文字 | 页面层 | 短暂交互，切走即失 |
| 命令补全下拉 | 页面层 | 短暂交互 |
| 拖拽中间状态 | 页面层 | 交互中间态 |
| 任务执行状态 | 任务层 | 长生命周期，不可丢失 |
| 产物版本列表 | 任务层 | 持久数据 |
| 文件索引结果 | 任务层 | 昂贵的计算结果，需缓存 |
| 当前选中的任务 | 会话层 | 会话内有效 |
| 当前展开的产物 | 会话层 | 会话内有效 |
| 对话消息历史 | 会话层 | 可按需加载 |
| 上下文素材引用 | 会话层 | 与任务关联但可独立管理 |
| 系统授权状态 | 任务层 | 安全关键，需持久 |
| 多窗口同步状态 | 任务层 | 跨窗口共享 |

## 四、Vue 实现架构

```typescript
// stores/task.ts — 全局任务层（Pinia）
import { defineStore } from 'pinia';

export const useTaskStore = defineStore('task', () => {
  // ===== 持久状态 =====
  const tasks = ref<DesktopTask[]>([]);
  const artifacts = ref<Map<string, Artifact[]>>(new Map());
  const fileIndex = ref<Map<string, FileIndexEntry>>(new Map());
  const permissions = ref<PermissionRecord[]>([]);
  
  // ===== 状态机 =====
  function updateTaskStatus(taskId: string, status: TaskStatus) {
    const task = tasks.value.find(t => t.id === taskId);
    if (task) {
      task.status = status;
      task.updatedAt = Date.now();
    }
  }
  
  // ===== 产物管理 =====
  function addArtifact(taskId: string, artifact: Artifact) {
    if (!artifacts.value.has(taskId)) {
      artifacts.value.set(taskId, []);
    }
    artifacts.value.get(taskId)!.push(artifact);
  }
  
  // ===== 持久化 =====
  // 状态变更时自动持久化到本地存储
  watch([tasks, artifacts, permissions], () => {
    saveToStorage({ tasks: tasks.value, artifacts: [...artifacts.value], permissions: permissions.value });
  }, { deep: true });
  
  return { tasks, artifacts, fileIndex, permissions, updateTaskStatus, addArtifact };
});

// stores/session.ts — 会话层
export const useSessionStore = defineStore('session', () => {
  const currentTaskId = ref<string | null>(null);
  const expandedArtifactId = ref<string | null>(null);
  const messages = ref<ChatMessage[]>([]);
  const contextSlots = ref<ContextSlot[]>([]);
  const filters = ref({ category: 'all', sort: 'recent' });
  
  return { currentTaskId, expandedArtifactId, messages, contextSlots, filters };
});

// 组件内 — 页面层
// InputBox.vue
const inputText = ref('');
const showSuggest = ref(false);
const draggingFile = ref(false);
```

## 五、DesktopTask 类型定义

```typescript
type DesktopTask = {
  id: string;
  inputRefs: string[];    // 引用的文件/URL/截图
  outputs: Array<{
    kind: 'site' | 'sheet' | 'ppt';
    path?: string;        // 导出路径
  }>;
  status: 'queued' | 'running' | 'review' | 'done' | 'failed';
};
```

## 六、多窗口状态同步

Electron/Tauri 多窗口架构下，每个窗口有自己的 Vue 实例和 Pinia store。状态同步需要：

```typescript
// 使用 IPC 或 BroadcastChannel 同步关键状态
class CrossWindowSync {
  private channel: BroadcastChannel;
  
  constructor() {
    this.channel = new BroadcastChannel('task-sync');
    this.channel.onmessage = this.handleMessage.bind(this);
  }
  
  // 只同步高价值事实，不同步所有UI细节
  broadcast(event: SyncEvent) {
    this.channel.postMessage(event);
  }
  
  handleMessage(event: MessageEvent) {
    const data = event.data;
    switch (data.type) {
      case 'task-updated':
        taskStore.updateTaskStatus(data.taskId, data.status);
        break;
      case 'artifact-added':
        taskStore.addArtifact(data.taskId, data.artifact);
        break;
      case 'permission-changed':
        taskStore.updatePermission(data.permission);
        break;
      // 注意：不同步 inputText、showSuggest 等页面层状态
    }
  }
}
```

## 七、常见坑

- **长任务状态绑在组件上**：组件卸载时任务中断，数据丢失
- **全量同步所有状态**：跨窗口同步所有 UI 细节，性能差且容易冲突
- **没有持久化**：应用重启后任务历史和产物全部丢失
- **文件索引不缓存**：每次进入目录都重新索引，浪费 CPU 和 I/O
