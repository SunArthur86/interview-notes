---
id: note-mk-012
difficulty: L4
category: ai
subcategory: 桌面AI产品
tags:
- 月之暗面
- 面经
- AI-Native
- 结果回放
- 问题复盘
feynman:
  essence: AI-Native桌面产品的回放不仅为排障服务，也帮用户学习如何更好地使用产品。回放页按输入→计划→执行→产物→人工修改五段组织，用户能看到每步用了哪些文件和指令，问题点位能直接回到对应产物版本，优秀任务可一键沉淀为模板。
  analogy: 就像游戏回放系统——你可以看自己上一局的操作录像（每一步做了什么），找到犯错的位置（问题复盘），也可以把精彩操作存为集锦（模板复用）。
  first_principle: AI执行过程是黑盒的——用户只看到输入和输出，中间过程不可见。回放的本质是把黑盒打开，让执行过程变成可观察、可定位、可学习的透明流程。
  key_points:
  - 回放页按输入、计划、执行、产物和人工修改组织
  - 用户能看到哪一步用了哪些文件和指令
  - 问题点位能直接回到对应产物版本
  - 优秀任务可以一键沉淀为模板
first_principle:
  essence: 执行过程可观测化
  derivation: AI执行=黑盒→用户不理解结果好坏的原因→回放=过程透明化→用户可定位问题→可学习最佳实践→可复用优秀任务
  conclusion: 回放不是调试工具的附属功能，而是AI-Native产品的核心体验——它决定了用户能否建立对AI的信任
follow_up:
- 如果桌面端要接文件、网页和本地目录，你先画哪套权限边界？
- 这个产品要接入更多Agent能力时，哪层架构最不能乱？
memory_points:
- 核心双价值：面向开发者做问题复盘找Bug，面向普通用户做过程回放学习AI逻辑。
- 五段式回放模型：完整记录输入、计划、执行、产物、人工修改全生命周期的切片。
- 时间线交互设计：提供类似视频播放器的进度轴，可自由拖拽定位到特定执行步骤。
- 快照上下文：选中任一历史节点时，能完整展示当时的输入素材、AI推理与产物变化。
---

# 【月之暗面面经】AI-Native 桌面产品怎样做结果回放，才能支持问题复盘和用户学习？

## 一、回放的两种价值

| 价值类型 | 目标用户 | 核心场景 |
|---------|---------|---------|
| 问题复盘 | 开发者/高级用户 | "AI生成的PPT第3页数据错了，是哪一步引入的错误？" |
| 用户学习 | 所有用户 | "这个任务做得很好，AI是怎么一步步完成的？我下次怎么更好地给指令？" |

## 二、五段回放模型

```
┌──────────────────────────────────────────────────────────────────┐
│                     回放时间线（五段）                             │
├──────────────────────────────────────────────────────────────────┤
│                                                                  │
│  ①输入     ②计划      ③执行       ④产物      ⑤人工修改            │
│  ────── ──────── ──────── ──────── ──────────                 │
│                                                                  │
│  用户输入   AI分解    AI逐步     AI输出    用户编辑               │
│  文件引用   为步骤    执行每步   最终产物   修改产物                │
│  上下文     计划                                          │
│                                                                  │
│  14:30     14:31      14:32-14:38 14:39     14:40-14:45        │
│                                                                  │
└──────────────────────────────────────────────────────────────────┘
```

## 三、回放页UI设计

```
┌──────────────────────────────────────────────────────────────────┐
│  ◀ 回放：竞品分析站点生成                          2024-01-15     │
├──────────────────────────────────────────────────────────────────┤
│                                                                  │
│  ┌─ 时间线 ──────────────────────────────────────────────────┐  │
│  │                                                            │  │
│  │  ●━━━●━━━●━━━●━━━●━━━●━━━●━━━●━━━●━━━●━━━●━━━●          │  │
│  │  ①   ②   ②   ③   ③   ③   ③   ④   ④   ⑤   ⑤   ⑤       │  │
│  │  输入 计划1 计划2 执行1 执行2 执行3 执行4 产物1 产物2 修改1 修改2 修改3│  │
│  │                                                            │  │
│  └────────────────────────────────────────────────────────────┘  │
│                                                                  │
│  ┌─ 当前选中：执行步骤3 ──────────────────────────────────────┐  │
│  │                                                            │  │
│  │  📋 步骤：分析竞品定价数据                                   │  │
│  │  ⏱ 时间：14:35 - 14:36 (耗时 45s)                         │  │
│  │                                                            │  │
│  │  📥 输入引用：                                              │  │
│  │  • 竞品URL × 3 (已提取正文)                                │  │
│  │  • 分析报告.pdf (第12-15页)                                │  │
│  │                                                            │  │
│  │  💬 AI执行过程：                                            │  │
│  │  "正在分析三个竞品的定价策略..."                            │  │
│  │  "提取到以下定价数据：Notion $8/月, 飞书免费..."            │  │
│  │  "生成定价对比表格..."                                     │  │
│  │                                                            │  │
│  │  📤 产出：定价对比表格 v1                                  │  │
│  │  [ 查看产物 ]  [ 查看完整Prompt ]  [ 查看Token消耗 ]       │  │
│  │                                                            │  │
│  │  💡 提示：这一步用了PDF第12-15页的数据，                    │  │
│  │  如果数据有误，可能是因为PDF内容过时                         │  │
│  │                                                            │  │
│  └────────────────────────────────────────────────────────────┘  │
│                                                                  │
│  [ ← 上一步 ]  [ 播放回放 ]  [ 下一步 → ]  [ 导出模板 ]          │
└──────────────────────────────────────────────────────────────────┘
```

## 四、五段数据模型

```typescript
interface ReplayTimeline {
  taskId: string;
  
  // ① 输入段
  inputs: {
    timestamp: number;
    rawInput: string;            // 用户原始输入
    inputRefs: InputRefSnapshot[]; // 引用的文件/URL
    contextSlots: ContextSlot[];  // 激活的上下文
  };
  
  // ② 计划段
  plan: {
    timestamp: number;
    steps: PlanStep[];           // AI分解的执行步骤
    reasoning: string;           // AI为什么这样分解
  };
  
  // ③ 执行段
  executions: ExecutionStep[];
  
  // ④ 产物段
  artifacts: ArtifactSnapshot[];
  
  // ⑤ 人工修改段
  modifications: Modification[];
}

interface ExecutionStep {
  index: number;
  stepName: string;
  startedAt: number;
  completedAt: number;
  
  // 消耗的输入
  consumedInputs: string[];      // 引用了哪些输入
  
  // AI推理过程
  promptSent?: string;           // 发给LLM的prompt
  responseReceived?: string;     // LLM的回复
  tokenUsage?: { input: number; output: number };
  
  // 产出
  outputArtifacts?: string[];    // 产出了哪些产物
  outputSummary?: string;        // 本步骤产出摘要
  
  // 异常
  warnings?: string[];
  errors?: string[];
}
```

## 五、问题定位与跳转

```typescript
// 用户点击产物中的某个问题位置 → 跳转到对应的执行步骤
function locateProblem(artifactId: string, section: string) {
  // 1. 找到产物版本
  const artifact = artifactStore.get(artifactId);
  
  // 2. 找到生成这个版本的执行步骤
  const step = replayTimeline.executions.find(
    s => s.outputArtifacts?.includes(artifactId)
  );
  
  // 3. 定位到具体段落
  const promptSection = findPromptSection(step.promptSent, section);
  
  // 4. 跳转到回放的对应时间点
  replayPlayer.seekTo(step.index);
  
  // 5. 高亮可能引入问题的部分
  highlightPotentialIssue(promptSection);
}
```

```
┌──────────────────────────────────────────────────────────────────┐
│  问题定位示例                                                     │
├──────────────────────────────────────────────────────────────────┤
│                                                                  │
│  用户在PPT第3页发现数据错误：                                     │
│  "增长率写的是30%，但应该是45%"                                   │
│                                                                  │
│  → 点击"定位来源"                                                │
│  → 跳转到回放：执行步骤2（14:33）                                 │
│  → 高亮：AI在这一步引用了旧的报告数据                             │
│  → 提示：此数据来自"分析报告Q3.pdf"，可能已过时                   │
│  → 建议：更新到Q4报告后重新生成                                   │
│                                                                  │
│  [ 更新数据源并重跑此步骤 ]                                      │
│                                                                  │
└──────────────────────────────────────────────────────────────────┘
```

## 六、模板沉淀

```typescript
// 优秀任务一键沉淀为模板
interface TaskTemplate {
  id: string;
  name: string;
  description: string;
  
  // 来源
  sourceTaskId: string;
  
  // 模板内容
  inputPattern: string;         // 输入模式（如"分析{competitor}的{aspect}"）
  requiredInputs: string[];     // 需要的输入类型
  expectedOutputs: ArtifactKind[]; // 预期产物类型
  
  // 执行策略
  plan: PlanStep[];             // 执行步骤模板
  agentType: string;            // 使用的Agent
  
  // 统计
  usageCount: number;
  successRate: number;
  avgDuration: number;
}

// 从回放中创建模板
function createTemplateFromReplay(taskId: string): TaskTemplate {
  const replay = replayStore.get(taskId);
  
  return {
    name: `基于"${replay.inputs.rawInput}"的模板`,
    inputPattern: generalizeInput(replay.inputs.rawInput),
    requiredInputs: replay.inputs.inputRefs.map(r => r.type),
    expectedOutputs: replay.artifacts.map(a => a.kind),
    plan: replay.plan.steps,
    sourceTaskId: taskId,
    // ...
  };
}
```

## 七、常见坑

- **回放只展示最终结果**：没有中间过程，用户无法理解AI是怎么得到结果的
- **无法从产物跳转到执行步骤**：发现问题后无法定位是哪一步引入的
- **不能沉淀模板**：每次都从头写指令，优秀任务无法复用
- **回放数据太大**：记录了所有中间token，导致存储和加载都很慢

## 记忆要点

- 核心双价值：面向开发者做问题复盘找Bug，面向普通用户做过程回放学习AI逻辑。
- 五段式回放模型：完整记录输入、计划、执行、产物、人工修改全生命周期的切片。
- 时间线交互设计：提供类似视频播放器的进度轴，可自由拖拽定位到特定执行步骤。
- 快照上下文：选中任一历史节点时，能完整展示当时的输入素材、AI推理与产物变化。

