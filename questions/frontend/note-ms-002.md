---
id: note-ms-002
difficulty: L4
category: frontend
subcategory: AI-Native桌面
tags:
- 月之暗面
- 面经
- 权限
- 文件系统
- 桌面产品
feynman:
  essence: 按文件/目录/动作区分授权粒度，授权前说明读取什么/产出什么/保留多久，高影响写入要二次确认。
  analogy: 就像App请求相机权限——不是一次给所有权限，而是每次操作前明确说明用途和范围。
  first_principle: 桌面AI权限 = 最小授权原则 + 透明告知 + 可撤销。
  key_points:
  - 按文件/目录/动作区分授权粒度
  - 授权前说明读取/产出/保留时长
  - 高影响写入二次确认
  - 设置页可回看撤销授权
first_principle:
  essence: 信任 = 透明度 × 可控性
  derivation: AI读取本地文件→用户担心隐私→不告知=不信任→分层授权+透明说明+可撤销→建立信任
  conclusion: 权限设计的核心是让用户随时知道AI在访问什么
follow_up:
- 如何防止AI意外修改用户文件？
- 权限撤销后已产生的数据怎么处理？
memory_points:
- 核心矛盾：既要给AI文件能力，又要保障用户的知情与控制权
- 分层授权金字塔：从下到上为会话只读、文件级、目录级、全盘授权
- 动作越重提示越强：只读轻提示，写入需确认，批量删除等高危操作强警告
---

# 【月之暗面面经】桌面 AI 产品接入本地文件和目录时，前端如何设计权限提示？

## 一、为什么桌面端文件权限比 Web 复杂得多

Web 端文件操作受浏览器沙箱约束——上传即临时副本，页面关闭即销毁。桌面端则完全不同：

- **读取范围不可控**：AI 可以读整个磁盘的任意目录（如果给了权限）
- **写入会修改原件**：不是临时副本，而是直接改用户的真实文件
- **上下文持久化**：AI 可能长期持有文件引用，文件内容被缓存到云端
- **Agent 自主操作**：Agent 多步执行中可能自行决定读/写文件，用户不一定实时盯着

因此权限设计的核心矛盾是：**给 AI 足够的文件能力来完成任务，同时让用户始终保有控制感和知情权。**

## 二、权限模型设计：四层金字塔

### 2.1 分层授权模型总览

```
                    ┌─────────────┐
           L4       │  全盘授权    │  ← 仅用户主动设置，永不默认
                    └──────┬──────┘
                  ┌────────┴────────┐
           L3     │   目录级授权     │  ← 绑定到特定目录（如 ~/Projects）
                  └────────┬────────┘
                ┌──────────┴──────────┐
           L2   │    文件级授权        │  ← 绑定到特定文件
                └──────────┬──────────┘
              ┌────────────┴────────────┐
           L1 │     只读（临时会话级）    │  ← 仅本次任务可读，任务结束失效
              └─────────────────────────┘

    动作维度：read | write | create | delete
    时间维度：session | persistent | once
```

### 2.2 授权粒度矩阵

| 授权对象 | 默认动作 | 可选动作 | 提示强度 |
|---|---|---|---|
| 单个文件（只读） | 允许（会话级） | 升级为持久 | 轻提示（Toast） |
| 单个文件（写入/修改） | 需确认 | — | 二次确认对话框 |
| 目录（只读） | 需确认 | 限定子目录 | 明确对话框 |
| 目录（写入） | 需确认 + 列出影响文件 | — | 详细确认对话框 |
| 批量删除/移动 | 需确认 + 不可撤销警告 | — | 红色高危对话框 |
| 全盘访问 | 永不默认 | 仅设置页手动开启 | 设置页强提示 |

### 2.3 权限生命周期

```
用户操作 → [前端拦截层] → 判断是否有权限
                            │
                ┌───────────┴───────────┐
              有权限                    无权限
                │                         │
         执行操作              弹出权限请求对话框
                │                    │
         [访问日志记录]         用户授权 / 拒绝
                                     │
                            ┌────────┴────────┐
                          授权                  拒绝
                            │                    │
                    执行操作 + 记录        取消操作 + 友好降级
```

## 三、四条设计原则及落地

### 原则一：分层授权（最小权限原则）

**设计**：永远从最小粒度开始请求。AI 需要读一个文件就只请该文件的读权限，不索要目录权限；需要会话级权限就不默认升级为持久权限。

**落地**：
- 文件选择器返回的是单个文件引用（safePath），不是目录句柄
- 每个权限绑定 `scope`（file/dir）+ `action`（r/w）+ `ttl`（session/persistent）

### 原则二：透明告知（让用户知道 AI 要做什么）

**设计**：权限对话框不是冰冷的"允许/拒绝"，而是用自然语言说明 AI **要做什么、为什么要、结果如何使用**。

**落地 UI 结构**：

```
┌─────────────────────────────────────────────────┐
│  🔒 Kimi 请求访问文件                            │
│                                                   │
│  📄 report_Q4.xlsx                                │
│                                                   │
│  AI 需要读取这个文件来完成：                       │
│  "生成 Q4 季度数据总结"                            │
│                                                   │
│  ┌─ 将执行的操作 ─────────────────────────┐       │
│  │ ✓ 读取文件内容                          │       │
│  │ ✓ 文件内容将发送至云端 AI 模型处理       │       │
│  │ ✗ 不会修改或删除该文件                   │       │
│  │ ✗ 不会保存文件副本（处理完即丢弃）        │       │
│  └────────────────────────────────────────┘       │
│                                                   │
│  授权范围：  ○ 仅本次任务   ● 永久允许该文件       │
│                                                   │
│           [ 拒绝 ]              [ 允许 ]           │
└─────────────────────────────────────────────────┘
```

### 原则三：可撤销（随时收回权限）

**设计**：所有已授予权限在设置页统一管理，可单条撤销或一键全清。撤销后立即终止 AI 对该资源的访问。

**落地**：设置页 → "文件与权限" → 授权列表（文件名、权限类型、授权时间、来源任务）→ 每条可撤销。

### 原则四：二次确认（高影响操作必须确认）

**设计**：写入、修改、删除、批量操作、全盘访问——这五类操作必须有明确的二次确认，且 UI 要视觉区分（高危用红色/橙色）。

## 四、Vue + Electron 代码实现

### 4.1 权限数据模型

```typescript
// types/permission.ts
interface FilePermission {
  id: string
  path: string              // 文件/目录绝对路径
  scope: 'file' | 'directory'
  actions: ('read' | 'write' | 'create' | 'delete')[]
  ttl: 'once' | 'session' | 'persistent'
  grantedAt: number
  grantedBy: string         // 任务 ID
  taskTitle: string         // 来源任务标题（透明告知）
}

interface PermissionRequest {
  path: string
  scope: 'file' | 'directory'
  actions: ('read' | 'write' | 'create' | 'delete')[]
  reason: string            // AI 生成的自然语言说明
  taskContext: string       // 触发此请求的任务描述
  riskLevel: 'low' | 'medium' | 'high'  // 风险等级
}
```

### 4.2 前端权限拦截层（Pinia Store）

```typescript
// stores/permission.ts
import { defineStore } from 'pinia'
import { ipcRenderer } from 'electron'

export const usePermissionStore = defineStore('permission', {
  state: () => ({
    permissions: [] as FilePermission[],
    pendingRequests: [] as PermissionRequest[],
    accessLog: [] as AccessLogEntry[],
  }),

  actions: {
    /**
     * 检查是否有权限，无权限则弹出请求对话框
     * 返回 true 表示有权限（已授予或刚授予），false 表示用户拒绝
     */
    async requestAccess(req: PermissionRequest): Promise<boolean> {
      // 1. 先检查已有权限
      const existing = this.findMatchingPermission(req)
      if (existing) {
        this.logAccess(req, 'auto-approved')
        return true
      }

      // 2. 高风险操作强制二次确认
      if (req.riskLevel === 'high') {
        const confirmed = await this.showHighRiskConfirm(req)
        if (!confirmed) return false
      }

      // 3. 弹出权限请求对话框（用户选择）
      const granted = await this.showPermissionDialog(req)
      if (!granted) {
        this.logAccess(req, 'denied')
        return false
      }

      // 4. 记录权限
      this.permissions.push({
        id: crypto.randomUUID(),
        path: req.path,
        scope: req.scope,
        actions: req.actions,
        ttl: granted.ttl,
        grantedAt: Date.now(),
        grantedBy: req.taskContext,
        taskTitle: req.taskContext,
      })
      this.logAccess(req, 'granted')
      return true
    },

    /** 撤销权限 */
    revokePermission(permissionId: string) {
      this.permissions = this.permissions.filter(p => p.id !== permissionId)
      // 同步通知主进程清除文件 watcher
      ipcRenderer.send('permission:revoke', permissionId)
    },

    /** 会话结束清理临时权限 */
    clearSessionPermissions() {
      this.permissions = this.permissions.filter(
        p => p.ttl !== 'session' && p.ttl !== 'once'
      )
    },
  },
})
```

### 4.3 Vue 权限请求对话框组件

```vue
<!-- components/PermissionDialog.vue -->
<template>
  <Teleport to="body">
    <Transition name="dialog-fade">
      <div v-if="visible" class="permission-overlay" @click.self="onDeny">
        <div class="permission-card" :class="`risk-${request.riskLevel}`">
          <div class="header">
            <span class="icon">{{ riskIcon }}</span>
            <span class="title">Kimi 请求访问{{ scopeLabel }}</span>
          </div>

          <!-- 文件路径 -->
          <div class="file-path">
            <FileIcon :path="request.path" />
            <span class="path-text">{{ shortPath(request.path) }}</span>
          </div>

          <!-- 透明告知：AI 要做什么 -->
          <div class="purpose">
            <p class="purpose-title">AI 需要访问来完成：</p>
            <p class="purpose-desc">"{{ request.taskContext }}"</p>
          </div>

          <!-- 操作明细 -->
          <div class="actions-detail">
            <div
              v-for="action in actionDetails"
              :key="action.label"
              class="action-row"
            >
              <span :class="action.allowed ? 'check' : 'cross'">
                {{ action.allowed ? '✓' : '✗' }}
              </span>
              <span>{{ action.label }}</span>
            </div>
          </div>

          <!-- 授权范围选择 -->
          <div class="scope-selector">
            <label>
              <input type="radio" v-model="selectedTtl" value="once" />
              仅本次任务
            </label>
            <label>
              <input type="radio" v-model="selectedTtl" value="persistent" />
              永久允许该{{ scopeLabel }}
            </label>
          </div>

          <!-- 高危警告 -->
          <div v-if="request.riskLevel === 'high'" class="warning-banner">
            ⚠️ 此操作将修改您的原始文件，且不可撤销
          </div>

          <div class="actions">
            <button class="btn-deny" @click="onDeny">拒绝</button>
            <button
              class="btn-allow"
              :class="{ 'btn-danger': request.riskLevel === 'high' }"
              @click="onAllow"
            >
              {{ request.riskLevel === 'high' ? '确认修改' : '允许' }}
            </button>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'
import type { PermissionRequest } from '@/types/permission'

const props = defineProps<{
  visible: boolean
  request: PermissionRequest
}>()

const emit = defineEmits<{
  allow: [ttl: string]
  deny: []
}>()

const selectedTtl = ref('once')

const riskIcon = computed(() =>
  props.request.riskLevel === 'high' ? '⚠️' : '🔒'
)

const scopeLabel = computed(() =>
  props.request.scope === 'directory' ? '该目录' : '该文件'
)

const actionDetails = computed(() => {
  const actions = props.request.actions
  return [
    {
      label: actions.includes('read') ? '读取文件内容' : '不读取文件',
      allowed: actions.includes('read'),
    },
    {
      label: '文件内容将发送至云端 AI 模型处理',
      allowed: actions.includes('read'),
    },
    {
      label: actions.includes('write') ? '将修改原始文件' : '不会修改该文件',
      allowed: actions.includes('write'),
    },
    {
      label: '不保存文件副本（处理完即丢弃）',
      allowed: false,
    },
  ]
})

function onAllow() {
  emit('allow', selectedTtl.value)
}

function onDeny() {
  emit('deny')
}

function shortPath(path: string): string {
  const parts = path.split('/')
  return parts.slice(-2).join('/')
}
</script>
```

### 4.4 Electron 主进程文件操作拦截

```typescript
// main/ipc-file-permission.ts
import { ipcMain, dialog, BrowserWindow } from 'electron'
import { PermissionStore } from './permission-store'

const store = new PermissionStore()

/**
 * 渲染进程所有文件操作都经过这里
 * 在真正调用 fs API 之前检查权限
 */
ipcMain.handle('file:read', async (event, { path, taskId, reason }) => {
  // 1. 检查已有权限
  if (store.hasPermission(path, 'read')) {
    store.logAccess(path, 'read', taskId, 'auto-approved')
    return await readFileContent(path)
  }

  // 2. 无权限 → 发送给渲染进程弹对话框
  const granted = await requestPermissionFromRenderer(event.sender, {
    path,
    action: 'read',
    reason,
    taskId,
    riskLevel: 'low',
  })

  if (!granted) {
    return { error: 'PERMISSION_DENIED', message: '用户拒绝了文件访问' }
  }

  store.addPermission(path, 'read', granted.ttl, taskId)
  store.logAccess(path, 'read', taskId, 'granted')
  return await readFileContent(path)
})

ipcMain.handle('file:write', async (event, { path, content, taskId, reason }) => {
  // 写入操作风险等级为 high，必须二次确认
  const granted = await requestPermissionFromRenderer(event.sender, {
    path,
    action: 'write',
    reason,
    taskId,
    riskLevel: 'high',
  })

  if (!granted) {
    return { error: 'PERMISSION_DENIED' }
  }

  // 写入前自动备份（防止意外修改）
  await backupFile(path)
  store.logAccess(path, 'write', taskId, 'granted')
  return await writeFileContent(path, content)
})

/**
 * 权限撤销后，通知所有渲染进程清除相关文件引用
 */
ipcMain.on('permission:revoke', (_, permissionId) => {
  const perm = store.revoke(permissionId)
  if (perm) {
    // 停止文件监听
    stopWatching(perm.path)
    // 通知所有窗口
    BrowserWindow.getAllWindows().forEach(win => {
      win.webContents.send('permission:revoked', perm.path)
    })
  }
})
```

### 4.5 访问日志与设置页

```vue
<!-- components/PermissionSettings.vue -->
<template>
  <div class="permission-settings">
    <h3>文件访问权限</h3>

    <!-- 当前授权列表 -->
    <div v-for="perm in permissions" :key="perm.id" class="perm-row">
      <FileIcon :path="perm.path" size="small" />
      <div class="perm-info">
        <div class="perm-path">{{ perm.path }}</div>
        <div class="perm-meta">
          {{ actionLabel(perm.actions) }} · {{ ttlLabel(perm.ttl) }}
          · 授权于 {{ formatDate(perm.grantedAt) }}
        </div>
        <div class="perm-source">来源任务：{{ perm.taskTitle }}</div>
      </div>
      <button class="btn-revoke" @click="revoke(perm.id)">撤销</button>
    </div>

    <!-- 访问日志 -->
    <details class="access-log">
      <summary>访问日志（最近 100 条）</summary>
      <div v-for="log in accessLog" :key="log.id" class="log-row">
        <span class="log-time">{{ formatTime(log.timestamp) }}</span>
        <span class="log-action">{{ log.action }}</span>
        <span class="log-path">{{ log.path }}</span>
        <span :class="`log-status log-${log.status}`">{{ log.status }}</span>
      </div>
    </details>
  </div>
</template>
```

## 五、安全增强措施

| 措施 | 说明 |
|---|---|
| **写入前自动备份** | AI 修改文件前自动创建 `.bak` 副本，支持一键恢复 |
| **沙箱执行** | Agent 的文件操作限制在授权目录内，路径穿越（`../`）被拦截 |
| **脱敏传输** | 敏感字段（身份证号、密码等）在发送给云端模型前自动打码 |
| **离线模式声明** | 标注哪些操作纯本地、哪些需要上传云端，让用户选择 |
| **权限过期机制** | persistent 权限每 30 天提醒用户重新确认 |

## 六、面试加分点

- **类比移动端权限模型**：iOS/Android 的权限请求是"每次操作触发 + 设置页统一管理"，桌面 AI 应该复用这套已被验证的心智模型
- **信任方程式**：信任 = 透明度 × 可控性。权限设计的每一个决策都应回到这个等式验证
- **Agent 场景的特别挑战**：Agent 多步执行中可能自主决定访问文件，所以需要在 Agent 编排层注入权限检查点（per-step permission gate），而不是只在入口检查一次
- **合规层面**：如果产品面向企业市场，权限日志是审计要求（SOC 2 / GDPR），访问日志必须持久化且不可篡改

## 记忆要点

- 核心矛盾：既要给AI文件能力，又要保障用户的知情与控制权
- 分层授权金字塔：从下到上为会话只读、文件级、目录级、全盘授权
- 动作越重提示越强：只读轻提示，写入需确认，批量删除等高危操作强警告

