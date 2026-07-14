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
  - 输入框、浮层和选中态留在页面层
  - 任务状态、产物状态和文件索引状态上升到任务层
  - 长任务不要绑在单个组件生命周期上
  - 跨窗口共享的数据要走统一store或事件总线
first_principle:
  essence: 状态生命周期 vs 组件生命周期的解耦
  derivation: 组件生命周期（秒级）<< 任务生命周期（分钟到小时级）→ 状态必须独立于组件存储 → 全局TaskStore管理持久状态 → 组件只做展示和触发
  conclusion: 桌面AI产品的状态架构是"任务中心化"——所有长生命周期状态集中在TaskStore，页面层只管理短暂交互
follow_up:
- 如果桌面端要接文件、网页和本地目录，你先画哪套权限边界？
- 这个产品要接入更多Agent能力时，哪层架构最不能乱？
memory_points:
- 错配陷阱：因为组件生命周期秒级，所以长任务放其中必因卸载而中断丢失
- 三层状态模型：页面层管秒级UI，会话层管分钟级交互，任务层管小时级调度
- 核心结论：任务状态和产物对象必须上浮至全局任务层，严禁下沉至组件内部
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

## 记忆要点

- 错配陷阱：因为组件生命周期秒级，所以长任务放其中必因卸载而中断丢失
- 三层状态模型：页面层管秒级UI，会话层管分钟级交互，任务层管小时级调度
- 核心结论：任务状态和产物对象必须上浮至全局任务层，严禁下沉至组件内部

## 苏格拉底式面试追问

> 这组追问模拟面试官层层逼问，每一问先回答"为什么"，再回答"怎么做"，最后回答"如何证明"。

### 第一层：目标与动机

**Q：为什么长任务状态必须从组件里捞出来放到全局 TaskStore，在组件里用 keep-alive 保活不行吗？**

因为 keep-alive 保活的是"组件实例"，而不是"状态的可访问性和可恢复性"。keep-alive 的三个致命问题：(1) 单窗口局限——keep-alive 只在当前窗口的 Vue 实例内有效，用户在窗口 A 跑的长任务，窗口 B 完全看不到，跨窗口共享做不到；(2) 路由切换仍会失活——keep-alive 缓存的组件在路由栈过深时仍可能被清理（max 参数），长任务跑了 30 分钟后用户切了 5 个页面回来，组件已被销毁；(3) 应用重启全丢——keep-alive 是内存态，App 崩溃或重启后任务状态全部丢失。全局 TaskStore 的本质是把状态的生命周期从"组件实例（分钟级）"升级到"应用进程（天级）"+ 持久化到本地存储（永久）。任务状态、产物对象、文件索引这些"昂贵且不可丢"的状态必须脱离组件树，由独立的 store 统一管理，才能保证"组件随便卸载，任务不会中断"。

### 第二层：证据与定位

**Q：你怎么定位"任务跑到一半状态丢了"是状态分层问题，而不是网络中断或后端崩溃？**

用 traceId 链路追踪 + 状态快照定位。每个任务发起时生成唯一 traceId，在三个关键节点记录状态快照：(1) 前端发起任务时记录 TaskStore 中的 status=running；(2) 每次状态变更时记录到操作日志（taskId/status/timestamp/windowId）；(3) 任务异常时 dump 当前的 TaskStore 快照。如果日志显示任务状态从 running 直接消失（没有 failed 事件），说明是前端状态丢失（组件卸载导致）；如果日志显示 status=failed 但后端日志显示任务还在跑，说明是前后端状态不一致（网络问题）；如果后端日志显示任务已失败但前端仍显示 running，说明是回调通知丢失。定位到"状态消失"后，进一步看消失时的 windowId——如果总是发生在特定窗口的路由切换后，就能确认是组件卸载导致的状态丢失，根因是状态没有上浮到 TaskStore。

### 第三层：根因深挖

**Q：为什么用三层（页面层/会话层/任务层）而不是两层（组件/全局）？会话层是不是过度设计？**

不是过度设计，会话层解决的是"任务层太大、页面层太小"的中间地带问题。只分两层时会有两种极端：要么把"当前选中的任务""对话历史""筛选条件"都塞进 TaskStore（全局），导致所有窗口共享这些状态——但窗口 A 选中的任务和窗口 B 选中的任务可能不同，强行共享会互相覆盖；要么把这些塞进组件（页面层），导致路由切换后丢失——用户切出去看了一眼别的任务回来，之前选中的任务和筛选条件全没了。会话层的价值是定义了"窗口级/会话级"的生命周期：在同一个窗口内持久（切路由不丢），但不跨窗口共享（窗口 A 和 B 各自独立）。三层对应三个生命周期：页面层（秒级，组件卸载即失）、会话层（分钟级，窗口关闭即失）、任务层（小时到天级，跨窗口跨重启持久）。没有会话层，"窗口级状态"要么上浮污染全局，要么下沉随组件丢失。

**Q：那如果团队觉得三层太复杂，想统一用 Pinia 的全局 store 管所有状态，为什么不简化成一层全局？**

因为"一层全局"会导致"跨窗口状态污染"和"性能灾难"。桌面端是多窗口架构（Electron/Tauri），每个窗口有独立的 Vue 实例。如果所有状态都在全局 store，跨窗口同步时就要同步所有状态——包括 inputText（输入框文字）、showSuggest（下拉建议开关）、draggingFile（拖拽中间态）这些秒级的 UI 细节。同步这些细节的代价：(1) 性能——每次输入框打一个字就触发一次跨窗口 IPC 广播，高频操作会导致 IPC 通道拥堵；(2) 冲突——窗口 A 的输入框内容和窗口 B 互相覆盖，用户在 A 打字时 B 的输入框也在跳；(3) 认知混乱——用户在窗口 B 看到"输入框里有字"但那不是自己打的，是窗口 A 同步过来的。所以必须区分"该跨窗口同步的（任务/产物/权限）"和"不该同步的（输入框/浮层/选中态）"，这正是三层分层的核心价值。简化成一层全局会让跨窗口同步要么过重（全同步）要么失效（不同步），两层以上是必要复杂度。

### 第四层：方案权衡

**Q：跨窗口状态同步你用 BroadcastChannel 还是 Electron IPC（ipcMain/ipcRenderer）？怎么选？**

在 Electron 架构下选 IPC，不选 BroadcastChannel。根因是 BroadcastChannel 的限制：(1) BroadcastChannel 只在同一进程的多个上下文间有效，Electron 的多窗口如果分属不同渲染进程（BrowserWindow 各自独立），BroadcastChannel 无法跨进程；(2) BroadcastChannel 没有请求-响应模式，只能广播，如果窗口 A 需要查询窗口 B 的某个状态（如"你那边有没有在跑任务 X"），BroadcastChannel 做不到。Electron IPC 通过主进程中转，天然支持跨进程通信，而且可以走主进程做"单一数据源（single source of truth）"——所有窗口的状态变更先发给主进程，主进程更新权威状态后广播给所有窗口，避免多窗口间的状态分叉。代价是 IPC 比 BroadcastChannel 多一跳延迟（约 1-2ms），但对于任务状态同步这种低频更新（秒级而非毫秒级）完全可以接受。Tauri 架构下同理，用 Tauri 的 event 系统。

**Q：那如果团队担心 IPC 经过主进程中转会增加延迟，为什么不直接用渲染进程间的直接通信（如 SharedWorker 或 peer-to-peer）？**

因为"主进程中转"带来的延迟（1-2ms）远小于"绕过主进程导致的状态不一致"代价。渲染进程间直接通信（SharedWorker/MessageChannel）的问题：(1) 失去单一数据源——窗口 A 和窗口 B 各自维护状态，没有主进程做仲裁，一旦并发更新（A 和 B 同时修改同一任务的 status）就会出现"最后写入获胜"的数据覆盖；(2) 调试困难——状态变更链路分散在多个渲染进程间，排查问题时无法用主进程的统一日志；(3) 窗口生命周期管理复杂——SharedWorker 在所有窗口关闭时才销毁，如果某个窗口崩溃，SharedWorker 的状态可能残留导致脏数据。主进程中转的 1-2ms 延迟对任务状态同步（本身就是秒级更新）完全无感，换来的是状态一致性、可调试性、生命周期管理的全面改善。真正的低延迟场景（如协同编辑的光标同步）才需要绕过主进程，但任务状态同步不属于这个场景。

### 第五层：验证与沉淀

**Q：你怎么验证"三层状态分层"真的解决了状态丢失问题，而不是只是让代码更复杂了？**

用两个核心指标验证：(1) 状态丢失事故率 = 用户报告"任务状态丢失/产物消失"的工单数 / 日活用户数，三层架构上线后应从"每周都有"降到"几乎为零"；(2) 跨窗口一致性测试——写自动化测试模拟多窗口并发操作同一任务（窗口 A 改 status、窗口 B 改 artifact、窗口 C 查询状态），验证三个窗口最终看到的状态一致，这个测试在两层架构下会间歇性失败（因为窗口级状态污染全局），三层架构下应 100% 通过。还要监控一个辅助指标：TaskStore 的持久化恢复率——App 重启后能成功恢复的任务数 / 重启前的运行中任务数，应达到 100%。如果这个率低于 100%，说明持久化逻辑有遗漏（如某些状态字段没写入 storage）。

**Q：怎么让团队在写新功能时，自觉判断"这个状态该放哪一层"，而不是习惯性全放组件里或全放全局？**

把状态分层做成"决策树 + ESLint 强制约束"。第一，提供决策树文档："这个状态在路由切换后还需要吗？不需要→页面层。在窗口切换后还需要吗？不需要→会话层。在 App 重启后还需要吗？不需要→会话层。需要→任务层。"——开发者照着走就能定位。第二，在 ESLint 里加规则：组件内（非 setup 外的 ref/reactive）不允许定义以 task/artifact/permission 开头的变量名——这些语义命名暗示是任务层状态，强制开发者改用 useTaskStore() 访问。第三，Code Review 检查清单里加一条："新增的状态字段是否走了正确的 store？组件内 ref 的生命周期是否与状态语义匹配？"第四，提供一个 useStaleState 检测钩子——在开发模式下，如果一个组件卸载时其内部 ref 还持有 task/artifact 相关数据，控制台打 warning，提醒开发者这个状态应该上浮。这样分层就从"文档规范"变成了"工具链强制约束"。

