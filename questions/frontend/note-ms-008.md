---
id: note-ms-008
difficulty: L3
category: frontend
subcategory: AI-Native桌面
tags:
- 月之暗面
- 面经
- 结果编辑
- 确认发布
- 三步流程
feynman:
  essence: 拆三步确保用户对AI产出的完全控制：编辑(修改)→确认(审核)→发布(落地)，防止AI直接产出造成不可逆操作。
  analogy: 就像新闻发布流程——记者写稿(AI生成)→编辑审稿(用户确认)→排版发布(落地到文件)，不能记者写完直接发。
  first_principle: AI产出不可完全信任，必须人在回路(Human-in-the-loop)。
  key_points:
  - '编辑: 用户可修改AI产出'
  - '确认: 审核后再进入下一步'
  - '发布: 落地到文件/站点/系统'
  - 防止AI直接产出造成不可逆
  - 每步可回退
first_principle:
  essence: Human-in-the-loop = 安全+信任+控制
  derivation: AI直接发布→可能有错→不可逆→拆三步→编辑(可改)→确认(可控)→发布(可回退)→安全+信任
  conclusion: 三步流程是AI产品安全发布的最低标准
follow_up:
- 三步流程会不会太繁琐？如何平衡效率和安全性？
- 确认环节需要展示哪些信息？
- 发布后的回滚机制怎么设计？
memory_points:
- 核心原因：AI产出不可控，为防止不可逆操作，必须引入Human-in-the-loop
- 三步闭环：编辑(改草案) -> 确认(看Diff) -> 发布(真落地)
- 状态机设计：draft -> editing -> review -> published，每一步均可回退
---

# 【月之暗面面经】桌面端为什么要把结果编辑、确认和发布拆成三步？

## 核心问题

AI 生成的内容不可完全信任——可能有事实错误、格式问题、甚至幻觉。如果 AI 生成完直接落地（写入文件、发布到站点、发送邮件），用户就失去了对结果的**最后一道控制权**。一旦不可逆操作发生（如覆盖了重要文件、发布了错误内容），后果很难挽回。

因此，桌面端 AI 产品必须引入 **Human-in-the-loop（人在回路）** 机制，将"AI 生成 → 落地执行"这个过程拆分为三步：

```
AI 生成草案
    │
    ▼
┌─────────┐     ┌─────────┐     ┌─────────┐
│  编辑    │────►│  确认    │────►│  发布    │
│ (Editing)│     │(Confirm) │     │(Publish)│
└─────────┘     └─────────┘     └─────────┘
 用户可修改       审核后进入      落地到文件
 AI产出          发布步骤        /站点/系统
```

三步流程的本质是 **Human-in-the-loop = 安全 + 信任 + 控制**：

| 属性 | 对应步骤 | 保障 |
|------|---------|------|
| **安全** | 发布前的确认 | 不可逆操作执行前必须人工批准 |
| **信任** | 编辑+确认 | 用户有机会审查和修正 AI 产出 |
| **控制** | 每步可回退 | 发布后也能回滚到编辑阶段 |

---

## 一、状态机设计

### 1.1 完整状态流转图

```
                          ┌──────────────────────────────────────────────┐
                          │                                              │
                     AI 生成完成                                         │
                          │                                              │
                          ▼                                              │
                   ┌─────────────┐                                       │
                   │  draft      │  AI 产出初始草案                       │
                   │  (草稿态)    │                                       │
                   └──────┬──────┘                                       │
                          │ 用户开始编辑                                   │
                          ▼                                              │
                   ┌─────────────┐    用户修改后暂存     ┌──────────────┐ │
            ┌──────│  editing    │◄──────────────────── │ auto-saved   │ │
            │      │  (编辑态)    │                     │ (自动暂存)    │ │
            │      └──────┬──────┘                     └──────────────┘ │
            │             │ 用户完成编辑                                  │
            │             ▼                                              │
            │      ┌─────────────┐     发现问题                          │
            │      │ edited      │──────────────────────────────────────┘
            │      │ (已编辑)     │     返回 editing
            │      └──────┬──────┘
            │             │ 提交审核
            │             ▼
            │      ┌─────────────┐
            │      │  review     │  ★ 确认环节：展示完整 diff
            │      │  (审核态)    │     对比原始草案 vs 编辑后内容
            │      └──────┬──────┘
            │             │
            │     ┌───────┴───────┐
            │     │               │
            │     ▼               ▼
            │  ┌──────┐    ┌───────────┐
            │  │reject│    │ approved  │  审核通过
            │  │(驳回) │    │ (已批准)   │
            │  └──┬───┘    └─────┬─────┘
            │     │              │
            │     │ 返回编辑      │
            └─────┘              ▼
                         ┌─────────────┐
                         │  publishing │  发布中（执行落地操作）
                         │  (发布中)    │
                         └──────┬──────┘
                                │
                         ┌──────┴──────┐
                         │             │
                         ▼             ▼
                   ┌──────────┐  ┌──────────┐
                   │published │  │  failed  │  发布失败
                   │ (已发布)  │  │ (失败)    │
                   └────┬─────┘  └────┬─────┘
                        │             │
                        │ 可回滚      │ 可重试
                        ▼             │
                  ┌──────────┐       │
                  │rolled_back│◄──────┘
                  │ (已回滚)  │  发布失败后回滚
                  └──────────┘
```

### 1.2 状态机 TypeScript 实现

```typescript
// types/publish-flow.ts

/** 发布流程状态 */
type PublishState =
  | 'draft'        // AI 生成初始草案
  | 'editing'      // 用户正在编辑
  | 'edited'       // 用户完成编辑
  | 'review'       // 审核确认中
  | 'approved'     // 审核通过
  | 'rejected'     // 审核驳回（回到编辑）
  | 'publishing'   // 发布执行中
  | 'published'    // 发布成功
  | 'failed'       // 发布失败
  | 'rolled_back'  // 已回滚

/** 合法状态转换 */
const PUBLISH_TRANSITIONS: Record<PublishState, PublishState[]> = {
  draft:      ['editing'],
  editing:    ['edited', 'draft'],           // 可放弃编辑回到草稿
  edited:     ['review', 'editing'],          // 提交审核 or 继续编辑
  review:     ['approved', 'rejected'],       // 审核结果二选一
  approved:   ['publishing', 'review'],       // 进入发布 or 撤回审核
  rejected:   ['editing'],                    // 驳回回到编辑
  publishing: ['published', 'failed'],        // 发布成功 or 失败
  published:  ['rolled_back'],                // 终态，但可回滚
  failed:     ['publishing', 'editing'],      // 重试 or 回到编辑
  rolled_back: [],                            // 终态
}

/** 发布产物类型——决定落地方式 */
type ProductType =
  | 'file_write'     // 写入文件
  | 'file_overwrite' // 覆盖文件
  | 'directory'      // 创建目录结构
  | 'git_commit'     // Git 提交
  | 'deploy'         // 部署到站点
  | 'send_email'     // 发送邮件
  | 'api_call'       // 调用外部API

/** 内容变更单元 */
interface ChangeUnit {
  id: string
  type: 'create' | 'modify' | 'delete'
  target: string                    // 文件路径/目标地址
  original?: string                 // 原始内容（modify时有）
  current: string                   // 当前内容
  diff?: LineDiff[]                 // 行级 diff
  status: 'pending' | 'accepted' | 'rejected'  // 用户审核状态
}

interface LineDiff {
  type: 'added' | 'removed' | 'unchanged'
  lineNumber: number
  oldLineNumber?: number
  content: string
}

/** 发布流程实体 */
interface PublishFlow {
  id: string
  taskId: string                    // 关联的 AI 任务
  state: PublishState
  productType: ProductType
  changes: ChangeUnit[]             // 所有变更单元

  // —— 编辑阶段 ——
  originalDraft: string             // AI 原始产出
  editedContent?: string            // 用户编辑后内容
  editHistory: EditEntry[]          // 编辑历史（撤销栈）

  // —— 确认阶段 ——
  reviewNote?: string               // 审核备注
  reviewChecklist: ReviewChecklistItem[]  // 审核检查清单

  // —— 发布阶段 ——
  publishedAt?: number
  publishedBy?: string
  rollbackSnapshot?: RollbackSnapshot    // 回滚快照
  error?: PublishError

  createdAt: number
  updatedAt: number
}

interface EditEntry {
  timestamp: number
  field: string
  oldValue: string
  newValue: string
}

interface ReviewChecklistItem {
  id: string
  label: string                     // 如"检查文件路径是否正确"
  checked: boolean
  required: boolean                 // 是否必须勾选才能通过
}

interface RollbackSnapshot {
  backupPaths: string[]             // 备份的原始文件路径
  backupContents: Record<string, string>  // 备份内容
  createdAt: number
}

interface PublishError {
  code: string
  message: string
  failedAt: ChangeUnit['id']        // 在哪个变更单元失败
  retryable: boolean
}
```

### 1.3 状态机引擎

```typescript
// services/publish-state-machine.ts
import type { PublishState, PublishFlow } from '@/types/publish-flow'

export class PublishStateMachine {
  private flow: PublishFlow

  constructor(flow: PublishFlow) {
    this.flow = flow
  }

  /** 安全状态转换 */
  transition(to: PublishState): { ok: boolean; error?: string } {
    const allowed = PUBLISH_TRANSITIONS[this.flow.state]
    if (!allowed.includes(to)) {
      return {
        ok: false,
        error: `非法状态转换: ${this.flow.state} → ${to}`
      }
    }
    this.flow.state = to
    this.flow.updatedAt = Date.now()
    return { ok: true }
  }

  /** 判断当前状态是否允许编辑 */
  canEdit(): boolean {
    return ['draft', 'editing', 'edited', 'rejected'].includes(this.flow.state)
  }

  /** 判断当前状态是否允许审核 */
  canReview(): boolean {
    return this.flow.state === 'review'
  }

  /** 判断当前状态是否允许发布 */
  canPublish(): boolean {
    return this.flow.state === 'approved'
  }

  /** 判断当前状态是否允许回滚 */
  canRollback(): boolean {
    return this.flow.state === 'published' || this.flow.state === 'failed'
  }

  /** 获取当前步骤（1=编辑, 2=确认, 3=发布） */
  currentStep(): 1 | 2 | 3 {
    switch (this.flow.state) {
      case 'draft':
      case 'editing':
      case 'edited':
      case 'rejected':
        return 1  // 编辑阶段
      case 'review':
      case 'approved':
        return 2  // 确认阶段
      case 'publishing':
      case 'published':
      case 'failed':
      case 'rolled_back':
        return 3  // 发布阶段
    }
  }
}
```

---

## 二、编辑阶段（Step 1）

### 2.1 编辑器设计要点

编辑阶段是用户修改 AI 产出的环节。核心设计要点：

1. **保留原始草案**：`originalDraft` 始终保留，用户可随时对比修改前后差异
2. **行级 Diff 展示**：用户修改时实时计算行级 diff，高亮变更行
3. **自动暂存**：编辑过程中每 10 秒自动暂存，防止意外丢失
4. **编辑历史**：支持 Ctrl+Z 撤销，记录每次修改操作

### 2.2 Diff 计算服务

```typescript
// services/diff-service.ts
import type { LineDiff, ChangeUnit } from '@/types/publish-flow'

export class DiffService {
  /** 计算行级 diff（基于 LCS 算法） */
  computeLineDiff(original: string, current: string): LineDiff[] {
    const oldLines = original.split('\n')
    const newLines = current.split('\n')
    const lcs = this.longestCommonSubsequence(oldLines, newLines)

    const result: LineDiff[] = []
    let oi = 0, ni = 0, li = 0

    while (oi < oldLines.length || ni < newLines.length) {
      if (li < lcs.length && oi < oldLines.length && ni < newLines.length
          && oldLines[oi] === lcs[li] && newLines[ni] === lcs[li]) {
        result.push({ type: 'unchanged', lineNumber: ni + 1, oldLineNumber: oi + 1, content: newLines[ni] })
        oi++; ni++; li++
      } else if (oi < oldLines.length && (li >= lcs.length || oldLines[oi] !== lcs[li])) {
        result.push({ type: 'removed', lineNumber: 0, oldLineNumber: oi + 1, content: oldLines[oi] })
        oi++
      } else {
        result.push({ type: 'added', lineNumber: ni + 1, content: newLines[ni] })
        ni++
      }
    }

    return result
  }

  /** 最长公共子序列（简化实现） */
  private longestCommonSubsequence(a: string[], b: string[]): string[] {
    const m = a.length, n = b.length
    const dp: number[][] = Array(m + 1).fill(0).map(() => Array(n + 1).fill(0))

    for (let i = 1; i <= m; i++) {
      for (let j = 1; j <= n; j++) {
        if (a[i - 1] === b[j - 1]) {
          dp[i][j] = dp[i - 1][j - 1] + 1
        } else {
          dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1])
        }
      }
    }

    // 回溯
    const result: string[] = []
    let i = m, j = n
    while (i > 0 && j > 0) {
      if (a[i - 1] === b[j - 1]) {
        result.unshift(a[i - 1])
        i--; j--
      } else if (dp[i - 1][j] > dp[i][j - 1]) {
        i--
      } else {
        j--
      }
    }
    return result
  }

  /** 从变更单元生成 diff */
  computeChangesDiff(changes: ChangeUnit[]): Map<string, LineDiff[]> {
    const diffMap = new Map<string, LineDiff[]>()
    for (const change of changes) {
      if (change.type === 'modify' && change.original) {
        diffMap.set(change.id, this.computeLineDiff(change.original, change.current))
      }
    }
    return diffMap
  }
}
```

---

## 三、确认阶段（Step 2）

### 3.1 确认环节展示信息

确认环节是安全发布的关键屏障。必须向用户展示足够的信息来做决策：

| 展示内容 | 目的 | 重要性 |
|---------|------|--------|
| **变更 Diff 总览** | 一目了然看到所有修改点 | ⭐⭐⭐ |
| **文件路径校验** | 确认写入路径是否正确 | ⭐⭐⭐ |
| **影响的文件列表** | 本次发布涉及哪些文件 | ⭐⭐⭐ |
| **不可逆操作警告** | 覆盖/删除等操作的醒目提示 | ⭐⭐⭐ |
| **原始内容 vs 修改后** | 并排对比 | ⭐⭐ |
| **审核检查清单** | 强制确认关键事项 | ⭐⭐⭐ |

### 3.2 审核检查清单

```typescript
// config/review-checklist.ts
import type { ReviewChecklistItem } from '@/types/publish-flow'

/** 根据产物类型生成不同的审核检查清单 */
function buildReviewChecklist(productType: ProductType): ReviewChecklistItem[] {
  const baseChecklist: ReviewChecklistItem[] = [
    {
      id: 'content-accuracy',
      label: '我已检查内容准确性，无事实错误',
      checked: false,
      required: true
    },
    {
      id: 'no-hallucination',
      label: '内容中无 AI 幻觉（编造的事实/引用）',
      checked: false,
      required: true
    }
  ]

  const typeSpecific: Record<ProductType, ReviewChecklistItem[]> = {
    file_write: [
      { id: 'path-correct', label: '文件写入路径正确', checked: false, required: true },
      { id: 'no-overwrite', label: '此操作不会覆盖已有文件', checked: false, required: true },
    ],
    file_overwrite: [
      { id: 'path-correct', label: '文件覆盖路径正确', checked: false, required: true },
      { id: 'backup-created', label: '已知原始文件将备份', checked: false, required: true },
      { id: 'irreversible-warning', label: '我理解覆盖操作不可撤销（可回滚）', checked: false, required: true },
    ],
    directory: [
      { id: 'structure-correct', label: '目录结构符合预期', checked: false, required: true },
    ],
    git_commit: [
      { id: 'commit-msg', label: '提交信息准确', checked: false, required: true },
      { id: 'correct-branch', label: '提交到正确的分支', checked: false, required: true },
    ],
    deploy: [
      { id: 'target-env', label: '部署目标环境正确（非生产？）', checked: false, required: true },
      { id: 'rollback-plan', label: '已知回滚方案', checked: false, required: true },
    ],
    send_email: [
      { id: 'recipients', label: '收件人地址正确', checked: false, required: true },
      { id: 'attachments', label: '附件完整', checked: false, required: false },
    ],
    api_call: [
      { id: 'endpoint', label: 'API 端点正确', checked: false, required: true },
      { id: 'params', label: '请求参数正确', checked: false, required: true },
    ],
  }

  return [...baseChecklist, ...(typeSpecific[productType] || [])]
}
```

---

## 四、发布阶段（Step 3）+ 回滚机制

### 4.1 发布执行器

```typescript
// services/publish-executor.ts
import type { PublishFlow, ChangeUnit, RollbackSnapshot } from '@/types/publish-flow'
import { PublishStateMachine } from './publish-state-machine'
import * as fs from 'fs/promises'
import * as path from 'path'

export class PublishExecutor {
  private sm: PublishStateMachine
  private flow: PublishFlow

  constructor(flow: PublishFlow) {
    this.flow = flow
    this.sm = new PublishStateMachine(flow)
  }

  /** 执行发布 */
  async publish(): Promise<{ ok: boolean; error?: string }> {
    // 1. 状态校验
    const transitionResult = this.sm.transition('publishing')
    if (!transitionResult.ok) return transitionResult

    try {
      // 2. 创建回滚快照（发布前备份）
      this.flow.rollbackSnapshot = await this.createRollbackSnapshot()

      // 3. 逐个执行变更单元
      for (const change of this.flow.changes) {
        if (change.status === 'rejected') continue   // 用户拒绝的变更跳过

        await this.executeChange(change)
        change.status = 'accepted'
      }

      // 4. 发布成功
      this.sm.transition('published')
      this.flow.publishedAt = Date.now()
      return { ok: true }

    } catch (err) {
      // 5. 发布失败 → 自动回滚
      this.sm.transition('failed')
      this.flow.error = {
        code: 'PUBLISH_ERROR',
        message: (err as Error).message,
        retryable: true
      }
      await this.rollback()
      return { ok: false, error: (err as Error).message }
    }
  }

  /** 执行单个变更 */
  private async executeChange(change: ChangeUnit): Promise<void> {
    switch (change.type) {
      case 'create':
        await fs.writeFile(change.target, change.current, 'utf-8')
        break
      case 'modify':
        // 先备份（已在快照中完成），再写入
        await fs.writeFile(change.target, change.current, 'utf-8')
        break
      case 'delete':
        await fs.unlink(change.target)
        break
    }
  }

  /** 创建回滚快照 */
  private async createRollbackSnapshot(): Promise<RollbackSnapshot> {
    const backupContents: Record<string, string> = {}
    const backupPaths: string[] = []

    for (const change of this.flow.changes) {
      if (change.type === 'modify' || change.type === 'delete') {
        try {
          const content = await fs.readFile(change.target, 'utf-8')
          backupContents[change.target] = content
          backupPaths.push(change.target)
        } catch {
          // 文件可能不存在（新建场景），跳过备份
        }
      }
    }

    return { backupPaths, backupContents, createdAt: Date.now() }
  }

  /** 回滚到发布前状态 */
  async rollback(): Promise<void> {
    if (!this.flow.rollbackSnapshot) return

    // 恢复备份文件
    for (const [filePath, content] of Object.entries(this.flow.rollbackSnapshot.backupContents)) {
      await fs.writeFile(filePath, content, 'utf-8')
    }

    // 删除新创建的文件
    for (const change of this.flow.changes) {
      if (change.type === 'create') {
        try { await fs.unlink(change.target) } catch {}
      }
    }

    this.sm.transition('rolled_back')
  }
}
```

---

## 五、Vue 三步流程组件

### 5.1 主流程容器组件

```vue
<!-- components/PublishFlow/PublishWizard.vue -->
<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { usePublishStore } from '@/stores/publish.store'
import EditPanel from './EditPanel.vue'
import ReviewPanel from './ReviewPanel.vue'
import PublishPanel from './PublishPanel.vue'
import type { PublishFlow } from '@/types/publish-flow'

const props = defineProps<{
  flowId: string
}>()

const publishStore = usePublishStore()
const flow = computed<PublishFlow | null>(() =>
  publishStore.flows.get(props.flowId) ?? null
)

// 当前步骤（由状态机推导）
const currentStep = computed(() => {
  if (!flow.value) return 1
  const state = flow.value.state
  if (['draft', 'editing', 'edited', 'rejected'].includes(state)) return 1
  if (['review', 'approved'].includes(state)) return 2
  return 3
})

const stepLabels = ['编辑', '确认', '发布']

// —— 步骤1：编辑完成 → 提交审核 ——
async function onSubmitForReview() {
  await publishStore.submitForReview(props.flowId)
}

// —— 步骤2：审核结果 ——
async function onApprove() {
  await publishStore.approve(props.flowId)
}
async function onReject(note: string) {
  await publishStore.reject(props.flowId, note)
}

// —— 步骤3：发布 ——
async function onPublish() {
  await publishStore.executePublish(props.flowId)
}

// —— 回滚 ——
async function onRollback() {
  await publishStore.rollback(props.flowId)
}

// —— 返回编辑 ——
async function backToEdit() {
  await publishStore.backToEdit(props.flowId)
}
</script>

<template>
  <div class="publish-wizard" v-if="flow">
    <!-- 步骤指示器 -->
    <div class="step-indicator">
      <div
        v-for="(label, i) in stepLabels"
        :key="i"
        class="step"
        :class="{
          active: currentStep === i + 1,
          done: currentStep > i + 1,
        }"
      >
        <div class="step-circle">
          <span v-if="currentStep > i + 1">✓</span>
          <span v-else>{{ i + 1 }}</span>
        </div>
        <span class="step-label">{{ label }}</span>
        <div v-if="i < stepLabels.length - 1" class="step-line" />
      </div>
    </div>

    <!-- 步骤内容 -->
    <div class="step-content">
      <!-- Step 1: 编辑 -->
      <EditPanel
        v-if="currentStep === 1"
        :flow="flow"
        @submit="onSubmitForReview"
      />

      <!-- Step 2: 确认 -->
      <ReviewPanel
        v-if="currentStep === 2"
        :flow="flow"
        @approve="onApprove"
        @reject="onReject"
        @back="backToEdit"
      />

      <!-- Step 3: 发布 -->
      <PublishPanel
        v-if="currentStep === 3"
        :flow="flow"
        @publish="onPublish"
        @rollback="onRollback"
      />
    </div>
  </div>
</template>

<style scoped>
.publish-wizard {
  max-width: 900px;
  margin: 0 auto;
}

.step-indicator {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0;
  margin-bottom: 32px;
  padding: 24px 0;
}

.step {
  display: flex;
  align-items: center;
  gap: 8px;
}

.step-circle {
  width: 32px;
  height: 32px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 14px;
  font-weight: 600;
  background: #e5e7eb;
  color: #9ca3af;
  transition: all 0.3s;
}

.step.active .step-circle {
  background: #4f46e5;
  color: white;
  box-shadow: 0 0 0 4px rgba(79, 70, 229, 0.15);
}

.step.done .step-circle {
  background: #10b981;
  color: white;
}

.step-label {
  font-size: 13px;
  color: #6b7280;
}

.step.active .step-label {
  color: #4f46e5;
  font-weight: 600;
}

.step.done .step-label {
  color: #10b981;
}

.step-line {
  width: 60px;
  height: 2px;
  background: #e5e7eb;
  margin: 0 12px;
}

.step.done + .step .step-line,
.step-line.done {
  background: #10b981;
}

.step-content {
  background: white;
  border-radius: 12px;
  padding: 24px;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.08);
}
</style>
```

### 5.2 编辑面板组件

```vue
<!-- components/PublishFlow/EditPanel.vue -->
<script setup lang="ts">
import { ref, computed, watch, onMounted, onUnmounted } from 'vue'
import type { PublishFlow } from '@/types/publish-flow'
import { DiffService } from '@/services/diff-service'

const props = defineProps<{
  flow: PublishFlow
}>()

const emit = defineEmits<{
  submit: []
}>()

const diffService = new DiffService()

// —— 编辑器状态 ——
const activeTab = ref<'edit' | 'diff' | 'original'>('edit')
const editedContent = ref(props.flow.editedContent ?? props.flow.originalDraft)
const autoSaveStatus = ref<'idle' | 'saving' | 'saved'>('idle')

// —— 自动暂存 ——
let autoSaveTimer: ReturnType<typeof setInterval>

onMounted(() => {
  autoSaveTimer = setInterval(async () => {
    if (editedContent.value !== (props.flow.editedContent ?? props.flow.originalDraft)) {
      autoSaveStatus.value = 'saving'
      // 存储到 IndexedDB
      await saveToIndexedDB(props.flow.id, editedContent.value)
      autoSaveStatus.value = 'saved'
      setTimeout(() => { autoSaveStatus.value = 'idle' }, 2000)
    }
  }, 10000)
})

onUnmounted(() => clearInterval(autoSaveTimer))

// —— 计算变更统计 ——
const changeStats = computed(() => {
  const diff = diffService.computeLineDiff(
    props.flow.originalDraft,
    editedContent.value
  )
  return {
    added: diff.filter(d => d.type === 'added').length,
    removed: diff.filter(d => d.type === 'removed').length,
    unchanged: diff.filter(d => d.type === 'unchanged').length,
  }
})

// —— Diff 视图数据 ——
const diffLines = computed(() => {
  return diffService.computeLineDiff(
    props.flow.originalDraft,
    editedContent.value
  )
})

// —— 提交编辑 ——
function handleSubmit() {
  props.flow.editedContent = editedContent.value
  emit('submit')
}

async function saveToIndexedDB(flowId: string, content: string) {
  // 实际实现中调用 IndexedDB API
}

function resetToOriginal() {
  editedContent.value = props.flow.originalDraft
}
</script>

<template>
  <div class="edit-panel">
    <div class="panel-header">
      <h2>📝 编辑 AI 产出</h2>
      <div class="auto-save-status">
        <span v-if="autoSaveStatus === 'saving'" class="saving">暂存中...</span>
        <span v-else-if="autoSaveStatus === 'saved'" class="saved">✓ 已暂存</span>
      </div>
    </div>

    <!-- 变更统计 -->
    <div class="change-stats">
      <span class="stat added">+{{ changeStats.added }} 行</span>
      <span class="stat removed">-{{ changeStats.removed }} 行</span>
      <span class="stat unchanged">={{ changeStats.unchanged }} 行</span>
    </div>

    <!-- 编辑器 Tab -->
    <div class="editor-tabs">
      <button
        :class="{ active: activeTab === 'edit' }"
        @click="activeTab = 'edit'"
      >编辑</button>
      <button
        :class="{ active: activeTab === 'diff' }"
        @click="activeTab = 'diff'"
      >对比变更</button>
      <button
        :class="{ active: activeTab === 'original' }"
        @click="activeTab = 'original'"
      >原始草案</button>
    </div>

    <!-- 编辑器 -->
    <div class="editor-area">
      <textarea
        v-if="activeTab === 'edit'"
        v-model="editedContent"
        class="content-editor"
        spellcheck="false"
      />

      <div v-if="activeTab === 'diff'" class="diff-view">
        <div
          v-for="(line, i) in diffLines"
          :key="i"
          class="diff-line"
          :class="line.type"
        >
          <span class="line-number">{{ line.lineNumber || '' }}</span>
          <span class="line-prefix">
            {{ line.type === 'added' ? '+' : line.type === 'removed' ? '-' : ' ' }}
          </span>
          <span class="line-content">{{ line.content }}</span>
        </div>
      </div>

      <pre v-if="activeTab === 'original'" class="original-view">{{ flow.originalDraft }}</pre>
    </div>

    <!-- 底部操作 -->
    <div class="edit-actions">
      <button class="btn-secondary" @click="resetToOriginal">
        ↺ 恢复原始草案
      </button>
      <button class="btn-primary" @click="handleSubmit">
        完成编辑，提交审核 →
      </button>
    </div>
  </div>
</template>

<style scoped>
.edit-panel { display: flex; flex-direction: column; gap: 16px; }
.panel-header { display: flex; justify-content: space-between; align-items: center; }
.panel-header h2 { margin: 0; font-size: 18px; }
.change-stats { display: flex; gap: 12px; font-size: 13px; }
.stat.added { color: #10b981; }
.stat.removed { color: #ef4444; }
.stat.unchanged { color: #9ca3af; }

.editor-tabs { display: flex; gap: 4px; border-bottom: 1px solid #e5e7eb; }
.editor-tabs button {
  padding: 8px 16px; border: none; background: transparent; cursor: pointer;
  font-size: 13px; color: #6b7280; border-bottom: 2px solid transparent;
}
.editor-tabs button.active { color: #4f46e5; border-bottom-color: #4f46e5; }

.content-editor {
  width: 100%; min-height: 400px; padding: 12px; border: 1px solid #e5e7eb;
  border-radius: 8px; font-family: 'Monaco', monospace; font-size: 13px;
  resize: vertical; outline: none; line-height: 1.6;
}
.content-editor:focus { border-color: #4f46e5; }

.diff-view { max-height: 400px; overflow-y: auto; border: 1px solid #e5e7eb; border-radius: 8px; }
.diff-line { display: flex; font-family: monospace; font-size: 13px; padding: 2px 8px; line-height: 1.4; }
.diff-line.added { background: #ecfdf5; }
.diff-line.removed { background: #fef2f2; }
.line-number { width: 40px; text-align: right; color: #9ca3af; margin-right: 8px; }
.line-prefix { width: 20px; font-weight: 600; }

.edit-actions { display: flex; justify-content: space-between; padding-top: 12px; border-top: 1px solid #e5e7eb; }
.btn-primary { padding: 10px 24px; background: #4f46e5; color: white; border: none; border-radius: 8px; cursor: pointer; font-size: 14px; }
.btn-secondary { padding: 10px 20px; background: #f3f4f6; color: #374151; border: none; border-radius: 8px; cursor: pointer; font-size: 14px; }
</style>
```

### 5.3 确认面板组件

```vue
<!-- components/PublishFlow/ReviewPanel.vue -->
<script setup lang="ts">
import { ref, computed } from 'vue'
import type { PublishFlow, ReviewChecklistItem } from '@/types/publish-flow'
import { DiffService } from '@/services/diff-service'

const props = defineProps<{
  flow: PublishFlow
}>()

const emit = defineEmits<{
  approve: []
  reject: [note: string]
  back: []
}>()

const diffService = new DiffService()
const reviewNote = ref('')

// 审核检查清单
const checklist = ref<ReviewChecklistItem[]>(props.flow.reviewChecklist)

// 所有必填项是否已勾选
const allRequiredChecked = computed(() =>
  checklist.value.filter(c => c.required).every(c => c.checked)
)

// 影响的文件列表
const affectedFiles = computed(() =>
  props.flow.changes.map(c => ({
    path: c.target,
    type: c.type,
    status: c.status,
  }))
)

// 不可逆操作警告
const hasIrreversible = computed(() =>
  props.flow.changes.some(c => c.type === 'delete' || props.flow.productType === 'file_overwrite')
)

function handleApprove() {
  if (!allRequiredChecked.value) return
  emit('approve')
}

function handleReject() {
  emit('reject', reviewNote.value)
}
</script>

<template>
  <div class="review-panel">
    <h2>🔍 确认审核</h2>

    <!-- 不可逆操作警告 -->
    <div v-if="hasIrreversible" class="danger-zone">
      ⚠️ <strong>注意：</strong> 本次发布包含
      <span v-if="flow.productType === 'file_overwrite'">文件覆盖</span>
      <span v-if="flow.changes.some(c => c.type === 'delete')">文件删除</span>
      操作。发布后可通过回滚恢复，但请务必确认。
    </div>

    <!-- 影响文件列表 -->
    <div class="affected-files">
      <h3>本次发布将影响 {{ affectedFiles.length }} 个文件：</h3>
      <div v-for="file in affectedFiles" :key="file.path" class="file-item">
        <span class="file-type-badge" :class="file.type">
          {{ file.type === 'create' ? '新建' : file.type === 'modify' ? '修改' : '删除' }}
        </span>
        <code>{{ file.path }}</code>
      </div>
    </div>

    <!-- 变更预览（只读 diff） -->
    <div class="change-preview">
      <h3>变更预览：</h3>
      <div class="diff-preview">
        <div
          v-for="(line, i) in diffService.computeLineDiff(flow.originalDraft, flow.editedContent ?? flow.originalDraft).slice(0, 30)"
          :key="i"
          class="diff-line"
          :class="line.type"
        >
          <span class="line-prefix">
            {{ line.type === 'added' ? '+' : line.type === 'removed' ? '-' : ' ' }}
          </span>
          <span>{{ line.content }}</span>
        </div>
        <div v-if="diffService.computeLineDiff(flow.originalDraft, flow.editedContent ?? flow.originalDraft).length > 30"
             class="more-lines">
          ... 更多行请查看编辑面板
        </div>
      </div>
    </div>

    <!-- 审核检查清单 -->
    <div class="review-checklist">
      <h3>请确认以下事项：</h3>
      <label
        v-for="item in checklist"
        :key="item.id"
        class="checklist-item"
        :class="{ required: item.required }"
      >
        <input type="checkbox" v-model="item.checked" />
        <span>{{ item.label }}</span>
        <span v-if="item.required" class="required-tag">必填</span>
      </label>
    </div>

    <!-- 驳回备注 -->
    <div class="reject-area">
      <textarea
        v-model="reviewNote"
        placeholder="如需驳回，请填写修改建议（可选）"
        class="reject-input"
      />
    </div>

    <!-- 操作按钮 -->
    <div class="review-actions">
      <button class="btn-back" @click="emit('back')">
        ← 返回编辑
      </button>
      <div class="action-group">
        <button class="btn-reject" @click="handleReject">
          ✕ 驳回修改
        </button>
        <button
          class="btn-approve"
          :disabled="!allRequiredChecked"
          @click="handleApprove"
        >
          ✓ 审核通过，准备发布 →
        </button>
      </div>
    </div>

    <div v-if="!allRequiredChecked" class="hint">
      请完成所有必填确认项后才能通过审核
    </div>
  </div>
</template>

<style scoped>
.review-panel { display: flex; flex-direction: column; gap: 16px; }
.review-panel h2 { margin: 0; font-size: 18px; }
.review-panel h3 { margin: 0 0 8px; font-size: 14px; color: #374151; }

.danger-zone {
  padding: 12px 16px; background: #fffbeb; border: 1px solid #fcd34d;
  border-radius: 8px; font-size: 13px; color: #92400e;
}

.affected-files { padding: 12px; background: #f9fafb; border-radius: 8px; }
.file-item { display: flex; align-items: center; gap: 8px; padding: 4px 0; font-size: 13px; }
.file-type-badge { padding: 2px 8px; border-radius: 4px; font-size: 11px; font-weight: 600; }
.file-type-badge.create { background: #d1fae5; color: #065f46; }
.file-type-badge.modify { background: #dbeafe; color: #1e40af; }
.file-type-badge.delete { background: #fee2e2; color: #991b1b; }

.change-preview { max-height: 200px; overflow-y: auto; border: 1px solid #e5e7eb; border-radius: 8px; padding: 8px; }
.diff-line { font-family: monospace; font-size: 12px; padding: 1px 4px; }
.diff-line.added { background: #ecfdf5; color: #065f46; }
.diff-line.removed { background: #fef2f2; color: #991b1b; }

.review-checklist { display: flex; flex-direction: column; gap: 8px; }
.checklist-item { display: flex; align-items: center; gap: 8px; font-size: 13px; cursor: pointer; }
.checklist-item.required .required-tag { color: #dc2626; font-size: 11px; }
.reject-input { width: 100%; min-height: 60px; padding: 8px; border: 1px solid #e5e7eb; border-radius: 8px; font-size: 13px; resize: vertical; }

.review-actions { display: flex; justify-content: space-between; padding-top: 12px; border-top: 1px solid #e5e7eb; }
.action-group { display: flex; gap: 12px; }
.btn-approve { padding: 10px 20px; background: #10b981; color: white; border: none; border-radius: 8px; cursor: pointer; font-size: 14px; }
.btn-approve:disabled { background: #d1d5db; cursor: not-allowed; }
.btn-reject { padding: 10px 20px; background: #fef2f2; color: #dc2626; border: 1px solid #fecaca; border-radius: 8px; cursor: pointer; font-size: 14px; }
.btn-back { padding: 10px 20px; background: transparent; color: #6b7280; border: none; cursor: pointer; font-size: 14px; }

.hint { font-size: 12px; color: #dc2626; text-align: right; }
</style>
```

---

## 六、Pinia Store

```typescript
// stores/publish.store.ts
import { defineStore } from 'pinia'
import { ref } from 'vue'
import type { PublishFlow } from '@/types/publish-flow'
import { PublishStateMachine } from '@/services/publish-state-machine'
import { PublishExecutor } from '@/services/publish-executor'
import { buildReviewChecklist } from '@/config/review-checklist'

export const usePublishStore = defineStore('publish', () => {
  const flows = ref<Map<string, PublishFlow>>(new Map())

  /** 创建发布流程（AI 生成完成后调用） */
  function createFlow(taskId: string, draft: string, productType: ProductType): string {
    const flowId = crypto.randomUUID()
    const flow: PublishFlow = {
      id: flowId,
      taskId,
      state: 'draft',
      productType,
      changes: [],
      originalDraft: draft,
      editHistory: [],
      reviewChecklist: buildReviewChecklist(productType),
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }
    flows.value.set(flowId, flow)
    return flowId
  }

  /** 提交审核 */
  async function submitForReview(flowId: string) {
    const flow = flows.value.get(flowId)
    if (!flow) return
    const sm = new PublishStateMachine(flow)
    sm.transition('edited')
    sm.transition('review')
  }

  /** 审核通过 */
  async function approve(flowId: string) {
    const flow = flows.value.get(flowId)
    if (!flow) return
    const sm = new PublishStateMachine(flow)
    sm.transition('approved')
  }

  /** 审核驳回 */
  async function reject(flowId: string, note: string) {
    const flow = flows.value.get(flowId)
    if (!flow) return
    flow.reviewNote = note
    const sm = new PublishStateMachine(flow)
    sm.transition('rejected')
  }

  /** 返回编辑 */
  async function backToEdit(flowId: string) {
    const flow = flows.value.get(flowId)
    if (!flow) return
    const sm = new PublishStateMachine(flow)
    if (flow.state === 'review') {
      sm.transition('rejected') // review → rejected → editing
    } else if (flow.state === 'approved') {
      sm.transition('review')
      sm.transition('rejected')
    }
  }

  /** 执行发布 */
  async function executePublish(flowId: string) {
    const flow = flows.value.get(flowId)
    if (!flow) return
    const executor = new PublishExecutor(flow)
    await executor.publish()
  }

  /** 回滚 */
  async function rollback(flowId: string) {
    const flow = flows.value.get(flowId)
    if (!flow) return
    const executor = new PublishExecutor(flow)
    await executor.rollback()
  }

  return {
    flows,
    createFlow, submitForReview, approve, reject,
    backToEdit, executePublish, rollback
  }
})
```

---

## 七、效率与安全性的平衡

### 7.1 三步流程是否太繁琐？

**不一定**。根据场景灵活调整：

| 场景 | 调整策略 | 仍然安全吗？ |
|------|---------|-------------|
| **低风险**（新建文件、非覆盖） | 编辑和确认合并为一步，自动跳过检查清单中的部分项 | ✅ 仍有发布前预览 |
| **中风险**（修改已有文件） | 标准三步流程 | ✅ 完整审核 |
| **高风险**（覆盖/删除/部署到生产） | 强制三步 + 额外二次确认（输入路径确认） | ✅ 多重保障 |

```typescript
/** 根据风险等级动态调整流程 */
function determineFlowDepth(productType: ProductType): 'fast' | 'standard' | 'strict' {
  if (productType === 'file_write') return 'fast'       // 新建文件，低风险
  if (productType === 'file_overwrite') return 'strict' // 覆盖文件，高风险
  if (productType === 'deploy') return 'strict'         // 部署，高风险
  return 'standard'                                      // 其他，标准流程
}
```

### 7.2 回答追问

**Q1: 三步流程会不会太繁琐？如何平衡效率和安全性？**
按风险等级动态调整：低风险操作（新建文件）合并编辑和确认为一步，跳过部分检查项；高风险操作（覆盖、删除、部署）强制全流程甚至增加二次确认。核心原则是**安全开销与风险等级成正比**。

**Q2: 确认环节需要展示哪些信息？**
核心五项：① 变更 Diff 总览（行级修改一目了然）② 影响文件列表（新建/修改/删除标注）③ 文件路径校验（防止写入错误位置）④ 不可逆操作警告（覆盖/删除醒目提示）⑤ 审核检查清单（按产物类型生成，必填项强制确认）。

**Q3: 发布后的回滚机制怎么设计？**
发布前创建 `RollbackSnapshot`（备份所有将被覆盖/删除的文件内容），发布失败或用户主动回滚时：① 恢复备份文件到原始内容 ② 删除新创建的文件。回滚快照与变更单元一一对应，保证操作可逆。已回滚状态 (`rolled_back`) 是终态，不可再次回滚。

## 记忆要点

- 核心原因：AI产出不可控，为防止不可逆操作，必须引入Human-in-the-loop
- 三步闭环：编辑(改草案) -> 确认(看Diff) -> 发布(真落地)
- 状态机设计：draft -> editing -> review -> published，每一步均可回退

