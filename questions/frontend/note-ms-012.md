---
id: note-ms-012
difficulty: L4
category: frontend
subcategory: AI-Native桌面
tags:
- 月之暗面
- 面经
- 结果回放
- 复盘
- 桌面产品
feynman:
  essence: 结果回放 = 执行过程录制 + 分步回看 + 可分支重跑。让用户看到AI每步推理和决策，支持从任意步骤重新执行。
  analogy: 就像游戏回放功能——不光看结果，还能回看每一步操作，甚至从某一步开始'如果换一个选择会怎样'(分支重跑)。
  first_principle: 回放 = 过程可视化 + 步骤可追溯 + 分支可重跑。
  key_points:
  - 记录每步推理/工具调用/中间结果
  - 时间轴分步回看
  - 支持从任意步骤分支重跑
  - 回放可分享(团队复盘)
first_principle:
  essence: AI决策的可解释性需要过程回放
  derivation: AI只给结果→黑盒→用户不信任→记录每步→可回看→可分支重跑→理解+信任+学习
  conclusion: 结果回放是AI产品从工具到教练的关键功能
follow_up:
- 回放数据怎么存储？会不会很大？
- 分支重跑怎么管理多个版本？
- 回放分享的隐私怎么保护？
memory_points:
- 价值定位：AI黑盒需透明化，回放是产品从工具升级为教练的核心
- 三层架构：录制管理层、持久化存储层、前端回放交互层
- 核心模型双管齐下：事件流记录动作轨迹，快照保障状态极速恢复
- 支持分支探索：利用 DAG（有向无环图）结构管理版本树，实现分支重跑对比
---

# 【月之暗面面经】AI-Native 桌面产品怎样做结果回放，才能支持问题复盘和用户学习？

## 一、问题本质：为什么需要结果回放

传统工具型产品只需要输出最终结果。但 AI-Native 桌面产品（如 AI 编程助手、AI 数据分析工具、AI 设计工具）的核心矛盾是：**AI 的推理过程是不透明的黑盒**。用户拿到结果后，无法理解"AI 为什么这样做""这一步推理是否合理""如果换一个选择会怎样"。

结果回放的核心价值链：

```
用户不信任AI结果 → 需要看到推理过程(过程录制)
                 → 需要逐步审查(分步回看)
                 → 需要探索替代方案(分支重跑)
                 → 理解+信任+学习 → 产品从工具升级为教练
```

三类目标用户的核心诉求：

| 用户类型 | 核心诉求 | 回放用法 |
|---------|---------|---------|
| 普通用户 | 理解 AI 为什么这样做 | 分步回看推理过程 |
| 专业用户 | 验证 AI 推理是否正确 | 逐步审查+分支重跑对比 |
| 团队/管理者 | 复盘失败任务、提炼经验 | 回放分享+批注讨论 |

## 二、核心架构：三层回放系统

### 2.1 整体架构图

```
┌─────────────────────────────────────────────────────────────────┐
│                         前端回放层                                │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────────┐    │
│  │ 时间轴UI  │  │ 步骤导航  │  │ 分支树    │  │ Diff对比视图  │    │
│  └─────┬────┘  └─────┬────┘  └─────┬────┘  └──────┬───────┘    │
│        └──────────────┴─────────────┴──────────────┘            │
│                         回放引擎                                 │
│         (状态快照管理 / 虚拟DOM时序回放 / 增量渲染)               │
└───────────────────────────┬─────────────────────────────────────┘
                            │ 回放事件流
┌───────────────────────────┴─────────────────────────────────────┐
│                         录制管理层                                │
│  ┌─────────────┐  ┌──────────────┐  ┌────────────────────┐     │
│  │ 执行拦截器   │  │ 事件序列化器  │  │ 快照压缩器         │     │
│  │(Hook Agent)  │  │(Event SaaS)  │  │(Snapshot Compactor)│     │
│  └──────┬──────┘  └──────┬───────┘  └─────────┬──────────┘     │
│         └────────────────┼─────────────────────┘                │
│                    录制协调器                                    │
│              (Recording Orchestrator)                           │
└───────────────────────────┬─────────────────────────────────────┘
                            │ 回放数据
┌───────────────────────────┴─────────────────────────────────────┐
│                         存储层                                    │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────┐      │
│  │ 事件流存储    │  │ 快照存储      │  │ 分支版本树        │      │
│  │ (IndexedDB)  │  │ (压缩JSON)   │  │ (DAG有向无环图)   │      │
│  └──────────────┘  └──────────────┘  └──────────────────┘      │
└─────────────────────────────────────────────────────────────────┘
```

### 2.2 三层职责划分

- **录制管理层**：在 Agent 执行过程中，通过拦截器（Interceptor Pattern）Hook 每一步的输入、推理、工具调用和输出，序列化为标准事件流
- **存储层**：将事件流和状态快照持久化，支持增量存储和压缩，管理分支版本关系
- **前端回放层**：提供时间轴导航、分步回看、分支切换和 Diff 对比的交互界面

## 三、回放数据模型设计

### 3.1 核心数据模型

```typescript
/** 一次完整的 AI 任务执行会话 */
interface ReplaySession {
  sessionId: string;           // 会话唯一ID
  taskId: string;              // 关联任务ID
  userId: string;              // 执行者
  createdAt: number;           // 创建时间戳
  status: 'recording' | 'completed' | 'archived';
  rootStepId: string;          // 根步骤ID（树形结构入口）
  metadata: {
    model: string;             // 使用的模型
    inputTokens: number;       // 输入token消耗
    outputTokens: number;      // 输出token消耗
    totalDuration: number;     // 总执行时长(ms)
  };
}

/** 单个执行步骤——回放的最小单元 */
interface ReplayStep {
  stepId: string;              // 步骤唯一ID
  parentId: string | null;     // 父步骤ID（形成树/DAG）
  sessionBranchId: string;     // 所属分支ID
  sequence: number;            // 在分支中的序号

  stepType: StepType;          // 步骤类型
  // REASONING | TOOL_CALL | TOOL_RESULT | DECISION | ARTIFACT_OUTPUT | USER_INPUT

  // —— 时间信息 ——
  startedAt: number;           // 开始时间
  endedAt: number;             // 结束时间

  // —— 输入输出 ——
  input: StepInput;            // 该步骤的输入（含上下文摘要）
  output: StepOutput;          // 该步骤的输出
  reasoning: string;           // AI的推理过程文本

  // —— 状态快照 ——
  stateSnapshot?: StateSnapshot; // 关键时刻的应用状态快照

  // —— 元信息 ——
  modelVersion: string;        // 该步骤使用的模型版本
  confidence?: number;         // AI置信度
  tags: string[];              // 用户/系统打的标签
}

/** 状态快照——支持分步回看的关键 */
interface StateSnapshot {
  snapshotId: string;
  stepId: string;
  timestamp: number;
  type: 'full' | 'incremental';  // 全量快照 or 增量快照
  // 增量快照只记录与前一快照的差异
  diff?: SnapshotDiff;
  // 全量快照记录完整应用状态
  fullState?: {
    workspace: SerializedWorkspace;    // 工作区状态
    contextWindow: SerializedContext;  // 上下文窗口
    artifacts: SerializedArtifact[];   // 产出物状态
  };
}

/** 分支——支持分支重跑的关键 */
interface ReplayBranch {
  branchId: string;
  sessionId: string;
  parentStepId: string;        // 从哪个步骤分叉
  branchLabel: string;         // 分支名称（如"修改prompt后重跑"）
  createdAt: number;
  status: 'active' | 'merged' | 'abandoned';
  rootStepId: string;          // 分支起始步骤
}
```

### 3.2 事件序列化格式

录制阶段，每个 AI 步骤被拦截后序列化为标准事件：

```typescript
/** 录制阶段产生的事件流 */
interface ReplayEvent {
  eventType: 'STEP_START' | 'STEP_END' | 'STATE_CHANGE'
           | 'TOOL_INVOKE' | 'TOOL_RETURN' | 'ERROR'
           | 'BRANCH_CREATE' | 'USER_INTERCEPT';
  stepId: string;
  timestamp: number;
  payload: unknown;            // 类型相关的事件数据
}
```

事件流以 append-only 方式写入 IndexedDB，回放时按时间顺序重放。

### 3.3 分支版本树（DAG）数据结构

分支重跑的核心是维护一个有向无环图（DAG），每个分支从某个步骤节点分叉：

```
Session Root
├── Step 1: 理解需求
├── Step 2: 分析文件结构
├── Step 3: 选择方案A ←──────────┐
│   ├── Step 4: 生成代码          │ 分支B从Step 3分叉
│   ├── Step 5: 运行测试          │ 选择了不同方案
│   └── Step 6: 输出结果          │
│                                │
└── [Branch B] Step 3': 选择方案B─┘
    ├── Step 4': 生成代码(不同)
    ├── Step 5': 运行测试
    └── Step 6': 输出结果(对比A)
```

## 四、三大核心能力实现

### 4.1 过程录制（Recording）

录制阶段的核心是在 Agent 执行链路上设置拦截点：

```typescript
class RecordingInterceptor {
  private session: ReplaySession;
  private eventStream: ReplayEvent[] = [];

  /** Hook Agent 执行的每个节点 */
  interceptAgentStep(step: AgentExecutionStep): void {
    const replayStep: ReplayStep = {
      stepId: generateId(),
      parentId: this.currentStepId,
      sessionBranchId: this.branchId,
      sequence: this.nextSequence(),
      stepType: step.type,
      startedAt: Date.now(),
      input: this.serializeInput(step.input),
      reasoning: step.chainOfThought || '',
      // ...其他字段
    };

    // 记录步骤开始事件
    this.emit('STEP_START', replayStep);
  }

  /** 步骤完成后记录输出和状态快照 */
  onStepComplete(step: AgentExecutionStep, output: StepOutput): void {
    const snapshot = this.shouldSnapshot()
      ? this.captureSnapshot(output)
      : null;  // 不是每步都存全量快照，按策略采样

    this.emit('STEP_END', { stepId, output, snapshot });
  }

  /** 快照策略：关键节点全量，其余增量 */
  private shouldSnapshot(): boolean {
    // 每10步全量快照，其余增量；工具调用前/后必存；分支点必存
    return this.stepCount % 10 === 0
        || this.lastEvent?.eventType === 'TOOL_INVOKE'
        || this.isBranchPoint;
  }
}
```

**录制策略要点：**
- 全量快照与增量快照混合：关键节点（工具调用、决策点、分支点）存全量，其余存增量 diff
- 快照压缩：JSON 使用结构化压缩（如只存变化路径的 JSON Patch），长文本用差分编码
- 采样策略：不是每步都存全量快照，而是在关键里程碑存全量，中间步骤用增量 diff 补充

### 4.2 分步回看（Step-by-Step Playback）

回放引擎核心是状态还原 + 时间轴导航：

```typescript
class ReplayEngine {
  private steps: ReplayStep[];
  private currentStepIndex: number = 0;

  /** 跳转到指定步骤，还原应用状态 */
  async seekTo(stepId: string): Promise<void> {
    const targetStep = this.findStep(stepId);
    const targetIndex = this.steps.indexOf(targetStep);

    // 找到最近的全量快照
    const lastFullSnapshot = this.findNearestFullSnapshot(targetStep);
    const incrementalSteps = this.stepsBetween(lastFullSnapshot, targetStep);

    // 先还原全量快照
    await this.restoreSnapshot(lastFullSnapshot);

    // 再逐步 apply 增量变化
    for (const step of incrementalSteps) {
      await this.applyIncrementalChange(step);
    }

    this.currentStepIndex = targetIndex;
    this.renderStepView(targetStep);
  }

  /** 时间轴交互：前进/后退/拖拽 */
  next(): void { this.seekTo(this.steps[this.currentStepIndex + 1]); }
  prev(): void { this.seekTo(this.steps[this.currentStepIndex - 1]); }
  play(): void { /* 自动播放模式，按步骤间真实时间间隔逐步推进 */ }
}
```

**前端回放 UI 核心组件：**

```
┌──────────────────────────────────────────────────────────┐
│  ⏮  ⏪  ▶  ⏩  ⏭        [══════●══════════]  Step 3/7   │  ← 时间轴
├──────────────────────────────────────────────────────────┤
│                                                          │
│  📋 Step 3: 选择方案                                     │  ← 当前步骤标题
│                                                          │
│  💭 AI推理:                                              │
│  "检测到项目使用 React 18，建议使用 hooks 方案..."       │  ← 推理展示区
│                                                          │
│  🔧 工具调用: read_file("src/App.tsx")                  │  ← 工具调用
│                                                          │
│  📤 输出: 选择了 hooks 方案 (置信度: 92%)                │  ← 输出结果
│                                                          │
│  [🔄 从此步重跑]  [📋 复制推理]  [📌 标记问题]           │  ← 操作按钮
└──────────────────────────────────────────────────────────┘
```

### 4.3 分支重跑（Branch Replay）

分支重跑是最有价值但工程复杂度最高的能力。用户在回看过程中，可以在任意步骤"另起一路"：

```typescript
class BranchManager {
  /** 从指定步骤创建分支，重新执行 */
  async createBranch(
    fromStepId: string,
    modifications: BranchModification
  ): Promise<ReplayBranch> {

    // 1. 创建分支记录
    const branch: ReplayBranch = {
      branchId: generateId(),
      sessionId: this.sessionId,
      parentStepId: fromStepId,
      branchLabel: modifications.label,
      createdAt: Date.now(),
      status: 'active',
      rootStepId: fromStepId,
    };

    // 2. 复制父步骤的状态快照作为起点
    const parentSnapshot = await this.loadSnapshot(fromStepId);
    await this.saveSnapshot(branch.branchId, parentSnapshot);

    // 3. 注入用户的修改（修改prompt/修改参数/切换模型）
    const modifiedInput = this.applyModifications(
      this.steps[fromStepId].input,
      modifications
    );

    // 4. 启动新的 Agent 执行链，录制到新分支
    const agent = this.createAgent({
      branchId: branch.branchId,
      resumeFrom: fromStepId,
      modifiedInput,
    });
    await agent.run();

    return branch;
  }

  /** Diff对比：两个分支同一步骤的差异 */
  async diffBranches(
    branchA: string,
    branchB: string
  ): Promise<BranchDiff> {
    // 对比同一序号步骤的 output、reasoning、artifact
    // 生成结构化Diff视图
  }
}
```

**分支管理 UI：**

```
分支树视图：
┌─ Original Run (Step 1→7)                    ✓ 完成
│  └─ [Step 3] Branch: 换用GPT-4重跑           ✓ 完成
│     └─ [Step 5] Branch: 修改temperature=0.8  ✓ 完成
└─ [Step 3] Branch: 修改prompt重跑              🔄 运行中

Diff对比视图：
┌─────────────────┬─────────────────┐
│  Original       │  Branch A       │
│  Step 5: 代码   │  Step 5: 代码   │
│  ───────────    │  ───────────    │
│  const x = 1;   │  const x = 1;   │  ← 相同(灰)
│  let y = x * 2; │  let y = x ** 2;│  ← 差异(红/绿)
│  return y;      │  return y;      │  ← 相同(灰)
└─────────────────┴─────────────────┘
```

## 五、存储优化策略

### 5.1 存储分层

| 数据类型 | 存储方案 | 大小控制 | 保留策略 |
|---------|---------|---------|---------|
| 事件流 | IndexedDB (append-only) | 每事件 ~0.5-2KB | 7天滚动 |
| 全量快照 | 压缩JSON Blob | 每10步1次，~50-200KB | 30天 |
| 增量快照 | JSON Patch (RFC 6902) | 每步~1-10KB | 随事件流 |
| 分支元数据 | 结构化记录 | ~1KB/分支 | 永久 |
| 分享回放 | 服务端加密存储 | 按需上传 | 用户控制 |

### 5.2 压缩策略

```typescript
// 快照压缩：全量→增量→差分
function compressSnapshots(steps: ReplayStep[]): ReplayStep[] {
  const result: ReplayStep[] = [];
  let lastFullSnapshot: StateSnapshot | null = null;

  for (const step of steps) {
    if (!step.stateSnapshot) continue;

    if (step.stateSnapshot.type === 'full') {
      lastFullSnapshot = step.stateSnapshot;
      result.push(step);
    } else {
      // 将全量快照对比生成 JSON Patch
      const patch = jsonPatch.compare(
        lastFullSnapshot.fullState,
        step.stateSnapshot.diff
      );
      step.stateSnapshot.compressedPatch = compress(patch);
      result.push(step);
    }
  }
  return result;
}
```

一个典型 7 步任务录制后的数据量预估：
- 事件流：7步 × ~1.5KB = ~10KB
- 全量快照：1个 × ~100KB = ~100KB
- 增量快照：6个 × ~5KB = ~30KB
- **总计约 ~140KB**，对桌面应用完全可以接受

## 六、回放分享与隐私保护

团队复盘场景需要分享回放。隐私保护策略：

```typescript
interface ShareableReplay {
  // 脱敏后的步骤数据
  sanitizedSteps: SanitizedStep[];
  // 敏感字段列表（分享时自动移除）
  redactedFields: string[];  // 如 fileContent、apiKey、userEmail
  // 权限控制
  permissions: {
    viewable: boolean;
    forkable: boolean;       // 允许接收者从此分支重跑
    expiresAt: number;
  };
  // 加密
  encryption: 'AES-256-GCM';
}
```

脱敏规则：
- 文件内容：只保留结构，内容替换为 `<redacted>` 或摘要
- 工具调用参数：移除路径中的用户名等敏感信息
- 推理文本：可选是否包含原始 AI 推理链

## 七、总结与关键设计原则

| 设计原则 | 实现要点 |
|---------|---------|
| **录制不侵入** | 通过 Interceptor/Hook 模式，对 Agent 执行链路零侵入 |
| **快照分层** | 全量+增量混合，平衡存储成本与回放性能 |
| **分支即数据** | 分支是 DAG 节点关系，不是独立会话，支持无限嵌套 |
| **回放即重放** | 回放引擎是确定性的状态还原器，不是简单视频播放 |
| **隐私可控** | 分享时脱敏，本地回放保留完整信息 |

结果回放从"工具产品"升级为"教练产品"的关键基础设施。核心价值不只是"看 AI 怎么做的"，而是"让用户学会 AI 是怎么想的"——分步回看建立理解，分支重跑激发探索，分享复盘沉淀组织知识。这是 AI-Native 桌面产品与普通工具的本质差异。

## 记忆要点

- 价值定位：AI黑盒需透明化，回放是产品从工具升级为教练的核心
- 三层架构：录制管理层、持久化存储层、前端回放交互层
- 核心模型双管齐下：事件流记录动作轨迹，快照保障状态极速恢复
- 支持分支探索：利用 DAG（有向无环图）结构管理版本树，实现分支重跑对比


## 苏格拉底式面试追问

> 这组追问模拟面试官层层逼问，每一问先回答"为什么"，再回答"怎么做"，最后回答"如何证明"。

### 第一层：目标与动机

**Q：结果回放你设计成"录制执行过程 + 分步回看 + 分支重跑"，但这套功能很重，为什么不只保留"最终结果展示"，省成本？**

最终结果展示是"工具型"产品（用户要结果），结果回放是"教练型"产品（用户要理解）。AI 桌面产品的差异化价值是"可解释 + 可学习"：一、可解释——用户看到 AI 的推理过程（"为什么这样生成"），建立信任，否则 AI 是黑盒用户不敢用（尤其高 stakes 场景如代码生成、数据分析）；二、可学习——用户通过回放学习 AI 的方法（如"AI 怎么分析的这份数据"），提升自己的能力，产品从工具升级为教练；三、可复盘——AI 出错时用户能定位"哪步推理错了"，反馈给产品改进。所以回放不是"省成本的牺牲品"，而是"AI 产品的核心差异化"。成本可通过"事件流 + 快照"压缩（不录视频，录结构化数据）。

### 第二层：证据与定位

**Q：用户说"回放时某一步显示空白（AI 的推理没录上）"，你怎么定位是录制 bug 还是回放 bug？**

分段定位：一、录制层——查该任务的录制日志（事件流），看对应步骤是否有事件记录（如 step-3 的 reasoning 事件），如果没有，是录制时没录上（如该步骤的 hook 没触发录制）；二、存储层——如果录制了事件，查存储（如 IndexedDB），看事件是否持久化成功（可能存储失败导致丢失）；三、回放层——如果事件存在，查回放逻辑，看是否能正确渲染该事件（如 reasoning 事件的渲染组件 bug 导致空白）。常见根因：一、异步录制丢事件——AI 执行很快，录制是异步的（如 await 调用），事件未写完就进入下一步，丢失；二、事件 schema 不匹配——录制时的事件格式和回放时的解析格式不一致（如字段名变了）。

### 第三层：根因深挖

**Q：回放数据你用"事件流 + 快照"存储，但事件流可能很长（如 100 步），回放时跳到第 50 步要重放前 49 步才能恢复状态，慢，根因是什么？**

根因是"事件回放"的固有缺陷。事件流记录的是"状态变化"（如 step-1 改了字段 A，step-2 改了字段 B...），要恢复第 50 步的状态，必须从初始状态依次应用 1-49 步的变化，计算量大。快照解决：定期存"完整状态快照"（如每 10 步存一次），回放时加载最近的快照（如第 40 步的快照），再应用 41-49 步的事件，从 50 步重放降到 9 步重放。这是"事件溯源 + 快照"的经典模式（借鉴数据库的 WAL + checkpoint）。快照频率权衡：频率高（如每步存）恢复快但存储大，频率低（如每 50 步存）存储小但恢复慢。实践中每 10 步或每秒存一次快照。

**Q：那为什么不每步都存快照（完整状态），不用事件流，回放直接加载快照？**

每步存快照的问题：一、存储爆炸——每个快照是完整状态（可能几 MB），100 步存 100 个快照（几百 MB），一个任务就这么大，存储成本高；二、冗余大——相邻步骤的状态差异小（如只改了一个字段），存完整快照大部分数据是冗余的；三、Diff 困难——用户想看"第 5 步和第 6 步的变化"，快照要 Diff 两个完整状态，计算量大。事件流的优势：一、增量存储——只存变化部分（如"字段 A 从 X 改为 Y"），存储小；二、天然 Diff——事件本身就是变化记录，直接展示；三、细粒度回放——可逐步重放，控制粒度。所以"事件流为主（增量、Diff）、快照为辅（加速恢复）"是最佳组合，不是纯快照。

### 第四层：方案权衡

**Q：分支重跑你用 DAG（有向无环图）管理版本树，但为什么不简单用线性列表（每次重跑加到列表末尾）？**

线性列表的问题：无法表达"分支关系"。如用户从第 5 步分支重跑（换不同参数），产生新版本（v2），原版本（v1）继续保留。线性列表里 v1 和 v2 是平铺的，用户看不出"v2 是从第 5 步分支的"。DAG 表达分支关系：v1 是主干（step1→step2→...→step10），v2 是从 step5 分支的（step1→...→step5→step6'→...→step10'），用户能看出"v2 和 v1 在 step5 后分叉"。DAG 支持对比（如 v1 的 step6 vs v2 的 step6'）、合并（如把 v2 的 step6' 合并回主干）。线性列表只支持"回看"，DAG 支持"回看 + 分支对比 + 合并"。AI 回放需要分支探索（"如果换参数会怎样"），DAG 是必要抽象。

**Q：为什么不直接用 Git（成熟的版本管理），而要自研 DAG 管理？**

Git 的问题：一、粒度不匹配——Git 是"文件级"版本管理（整个代码仓库），AI 回放是"步骤级"（每个 AI 推理步骤），粒度不同；二、性能——Git 操作（commit/branch/merge）是命令行调用，延迟高（秒级），AI 回放需要毫秒级响应；三、集成成本——Git 的 API 复杂（libgit2 或 shell 调用），与 Vue/React 集成成本高；四、过度功能——Git 的分布式同步、冲突合并等，AI 回放不需要（单用户本地）。自研 DAG 的好处：粒度匹配（步骤级）、性能可控（内存数据结构）、集成简单（JS 对象）。借鉴 Git 的"DAG + 分支 + 合并"概念，但实现轻量化。所以"概念借鉴 Git，实现自研"，匹配 AI 回放的特殊性。

### 第五层：验证与沉淀

**Q：你怎么验证结果回放的设计真的提升了用户信任和学习效果？**

两个维度：一、信任——问卷调研"看完回放后你对 AI 结果的信任度"（应提升）；对比"看结果 vs 看回放"两组用户的"采纳率"（看回放的采纳率应更高，因为理解了推理）；二、学习——追踪用户"从回放学到的模式"（如用户在后续任务中是否模仿 AI 的方法），可量化为"用户独立完成类似任务的比例"（应提升）；三、使用率——回放功能的使用率（用户主动看回放的比例，应 > 30% 否则功能没价值）；四、分享率——回放分享给团队的比例（团队复盘场景的价值）。A/B 测试：有回放 vs 无回放，对比用户满意度和留存。

**Q：这道题沉淀出什么可复用的结果回放设计经验？**

四条原则：一、事件流 + 快照——事件流增量存储（省空间、天然 Diff），快照定期存（加速恢复），不用纯事件（慢）或纯快照（大）；二、DAG 版本管理——分支重跑用 DAG 表达分支关系，支持对比和合并，不用线性列表（无法表达分支）；三、概念借鉴 Git，实现自研——Git 的 DAG/分支/合并概念好，但粒度（文件级）和性能（秒级）不匹配 AI 回放（步骤级、毫秒级），自研轻量 DAG；四、回放是差异化价值——不是成本中心，是"可解释 + 可学习 + 可复盘"的核心，提升用户信任和留存。核心洞察："结果回放本质是'AI 决策的可解释性'——借鉴游戏回放（录制+回看+分支）和 Git（DAG+版本），让 AI 从黑盒变透明，产品从工具升级为教练。"


## 结构化回答

**30 秒电梯演讲：** 结果回放 就是 执行过程录制 + 分步回看 + 可分支重跑。让用户看到AI每步推理和决策，支持从任意步骤重新执行。打个比方，就像游戏回放功能——不光看结果，还能回看每一步操作，甚至从某一步开始'如果换一个选择会怎样'(分支重跑)。

**展开框架：**
1. **价值定位** — AI黑盒需透明化，回放是产品从工具升级为教练的核心
2. **三层架构** — 录制管理层、持久化存储层、前端回放交互层
3. **核心模型双管齐下** — 事件流记录动作轨迹，快照保障状态极速恢复

**收尾：** 这块我踩过坑——要不要深入聊：回放数据怎么存储？会不会很大？

## 视频脚本

> 预计时长：4 分钟 | 由浅入深

| 时间 | 画面/字幕 | 口播台词 | 讲解要点 |
|------|----------|----------|----------|
| 0:00 | 标题卡 | "AI-Native桌面一句话：结果回放 就是 执行过程录制 + 分步回看 + 可分支重跑。让用户看到AI每步推理和决策…。" | 开场钩子 |
| 0:15 | 架构示意图 | "价值定位：AI黑盒需透明化，回放是产品从工具升级为教练的核心" | 价值定位 |
| 1:08 | 架构示意图分步演示 | "三层架构：录制管理层、持久化存储层、前端回放交互层" | 三层架构 |
| 2:01 | 关键代码/伪代码片段 | "核心模型双管齐下：事件流记录动作轨迹，快照保障状态极速恢复" | 核心模型双管齐下 |
| 2:54 | 对比表格 | "支持分支探索：利用 DAG（有向无环图）结构管理版本树，实现分支重跑对比" | 支持分支探索 |
| 3:50 | 总结卡 | "核心抓住这条主线，下期咱们接着聊：回放数据怎么存储？会不会很大。" | 收尾 |
