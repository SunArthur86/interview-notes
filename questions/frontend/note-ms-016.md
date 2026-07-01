---
id: note-ms-016
difficulty: L3
category: frontend
subcategory: AI-Native桌面
tags:
- 月之暗面
- 面经
- 指标
- 前端质量
- AI产品
feynman:
  essence: 三类指标：体验指标(TTI/流畅度/响应时间)、业务指标(任务完成率/产物采纳率/用户留存)、AI质量指标(准确率/幻觉率/用户满意度)。
  analogy: 就像评价一家餐厅——上菜速度(性能)、顾客回头率(业务)、菜品口味(AI质量)三个维度缺一不可。
  first_principle: AI前端质量 = 性能体验 × 业务效果 × AI质量 三维评价体系。
  key_points:
  - '体验: TTI/FCP/交互延迟/帧率'
  - '业务: 任务完成率/产物采纳率/D1D7留存'
  - 'AI质量: 回答准确率/幻觉率/用户满意度评分'
  - '工程: 错误率/崩溃率/API成功率'
first_principle:
  essence: AI前端的质量是多维的不能只看性能
  derivation: 传统前端只看性能→AI前端还需看AI产出质量→和用户是否真正用起来→三维评价缺一不可
  conclusion: AI前端质量评价=性能×业务×AI质量三维模型
follow_up:
- 产物采纳率怎么定义和埋点？
- 如何做A/B测试比较两个版本？
- 用户满意度怎么收集不干扰使用？
memory_points:
- 传统指标不够用：需构建「体验 × 业务 × AI质量」三维评价体系
- AI体验看速度：核心盯首字延迟(TTFW)与流式输出速率，防范主线程卡顿
- AI价值看采纳：产物采纳率与分步接受率是检验业务效果的核心标尺
- AI质量防幻觉：追踪重试率与任务放弃率，量化大模型输出不可靠的损耗
---

# 【月之暗面面经】你会用哪些指标判断桌面 AI 产品前端做得好不好？

## 一、为什么传统前端指标不够用

传统前端质量评估以性能为核心：FCP、TTI、Lighthouse 分数、包体积。这些指标在 AI-Native 桌面产品中仍然重要，但远远不够——因为 AI 产品引入了全新的质量维度：

- **AI 产出质量**：AI 回答是否准确？是否产生幻觉？用户是否采纳了 AI 生成的内容？
- **业务效果**：用户是否真正通过产品完成了任务？AI 帮助用户达成了什么？
- **AI 特有的体验问题**：流式输出的延迟感、长任务的等待焦虑、AI 不可靠时的降级体验

因此，需要一个**三维评价体系**：体验指标 × 业务指标 × AI 质量指标，三者缺一不可。

## 二、三维指标体系总表

### 2.1 维度一：体验指标（Experience Metrics）

| 指标 | 定义 | 目标值 | 埋点方式 |
|------|------|--------|---------|
| **首屏渲染时间 FCP** | 应用启动到首帧渲染完成 | < 800ms | PerformanceObserver API |
| **可交互时间 TTI** | 应用可响应用户输入的时间 | < 2s | PerformanceObserver + Input Latency |
| **AI 首字延迟 TTFW** | 用户发送到 AI 流式输出第一个 token 的时间 | < 1.5s | 自定义 timing 埋点 |
| **流式输出速度** | AI token 生成速率（tokens/s） | ≥ 30 tokens/s | 流式数据接收 timing |
| **交互帧率 FPS** | 滚动/拖拽/渲染时的帧率 | ≥ 55fps | requestAnimationFrame 采样 |
| **长任务冻结率** | 主线程阻塞 > 100ms 的任务占比 | < 5% | Performance LongTask API |
| **产物渲染时间** | AI 产物（代码/文档/图表）在 UI 中渲染完成时间 | < 500ms | 自定义 timing 埋点 |
| **窗口切换延迟** | 多窗口/多 Tab 间切换响应时间 | < 200ms | 事件 timing |
| **崩溃率** | 应用崩溃/无响应的会话占比 | < 0.1% | Crash reporter |

**桌面端特有指标（区别于 Web）：**
- 冷启动时间（Electron/Tauri 进程启动 + 窗口创建）
- 内存占用趋势（AI 流式渲染容易内存泄漏）
- 原生菜单/快捷键响应延迟
- 系统通知/文件拖拽集成延迟

### 2.2 维度二：业务指标（Business Metrics）

| 指标 | 定义 | 目标值 | 埋点方式 |
|------|------|--------|---------|
| **任务完成率** | 用户发起任务并成功获得结果的比例 | ≥ 85% | 任务状态埋点 |
| **产物采纳率** | 用户采纳/保存/导出 AI 产物的比例 | ≥ 60% | 产物操作埋点 |
| **分步采纳率** | 多步骤产出中用户逐步骤采纳的比例 | ≥ 70% | 逐步骤操作埋点 |
| **AI 使用深度** | 每用户每日 AI 交互次数（DAI/DAU） | ≥ 8 次 | 会话计数 |
| **D1 留存** | 次日回访率 | ≥ 40% | 用户活跃埋点 |
| **D7 留存** | 7日回访率 | ≥ 20% | 用户活跃埋点 |
| **任务完成时长** | 从用户发起任务到获得满意结果的耗时 | 因场景而异 | 任务生命周期 timing |
| **重试率** | 用户不满意后重新发起同一任务的比例 | < 30% | 任务关联追踪 |
| **分享率** | 用户将 AI 产物/对话分享给他人的比例 | ≥ 5% | 分享操作埋点 |

**产物采纳率的精确定义与埋点：**

```typescript
// 产物采纳的完整定义链
interface AdoptionEvent {
  taskId: string;
  artifactId: string;
  artifactType: 'code' | 'document' | 'chart' | 'file';
  // 采纳行为类型
  adoptionAction:
    | 'copy'           // 复制了内容
    | 'save'           // 保存到本地
    | 'export'         // 导出为文件
    | 'apply'          // 直接应用（如代码写入文件）
    | 'edit_then_save' // 编辑后保存（部分采纳）
    | 'reject';        // 明确拒绝了产出
  // 采纳延迟：从产物生成到采纳操作的时间
  timeToAdopt: number;
  // 采纳比例：多段内容中采纳了多少段
  adoptionRatio: number; // adopted_segments / total_segments
}
```

**任务完成率的分状态埋点：**

```typescript
// 任务并非只有"成功/失败"两种状态
type TaskOutcome =
  | 'completed_adopted'    // 完成 + 采纳 → 最理想
  | 'completed_rejected'   // 完成但未采纳 → AI质量有问题
  | 'completed_partial'    // 部分采纳
  | 'abandoned'            // 用户中途放弃 → 体验或质量问题
  | 'error'                // 技术错误导致失败 → 工程问题
  | 'timeout';             // 超时失败 → 性能问题
```

### 2.3 维度三：AI 质量指标（AI Quality Metrics）

| 指标 | 定义 | 目标值 | 埋点/采集方式 |
|------|------|--------|-------------|
| **回答准确率** | AI 回答正确/符合预期的比例 | ≥ 90% | 人工标注 + 用户反馈信号 |
| **幻觉率** | AI 生成虚假/编造信息的比例 | < 5% | 事实核查 + 用户举报 |
| **指令遵循率** | AI 按用户明确指令执行的比例 | ≥ 85% | 指令-产出对比分析 |
| **用户满意度** | 用户对 AI 产出的显式/隐式评分 | ≥ 4.0/5 | 点赞/点踩 + 隐式信号 |
| **上下文遗忘率** | AI 在对话中丢失/忽略关键上下文的比例 | < 10% | 对话分析 + 用户反馈 |
| **工具调用准确率** | Agent 模式下正确选择和调用工具的比例 | ≥ 92% | 工具调用日志分析 |
| **安全性指标** | AI 生成有害/不当内容的比例 | ≈ 0% | 安全审核 + 用户举报 |
| **一致性指标** | 相同输入多次执行的结果一致性 | ≥ 80% | 对比测试 |

**用户满意度的无干扰采集方案：**

```typescript
// 三级采集策略：从被动到主动
const satisfactionCollection = {
  // Level 1: 隐式信号（零打扰，覆盖100%会话）
  implicit: {
    copyFromResponse: '正面信号(+1)',      // 用户复制了AI回答
    regenerateRequest: '负面信号(-1)',      // 用户要求重新生成
    editAfterResponse: '中性偏负(-0.3)',    // 生成后大量编辑
    quickAbandon: '负面信号(-1)',           // 3秒内关闭结果
    longDwell: '正面信号(+0.5)',           // 停留阅读>15秒
  },

  // Level 2: 轻量显式（低打扰，覆盖率~30%）
  lightweight: {
    trigger: '在AI产出展示后，仅在特定条件下弹出',
    conditions: [
      '连续3次未采纳时',      // 可能质量有问题
      '用户编辑后保存时',     // 部分采纳场景
      '首次使用某功能时',     // 冷启动收集
    ],
    ui: '👍 / 👎 两个按钮，无文字输入框',
  },

  // Level 3: 深度反馈（仅对关键场景）
  deep: {
    trigger: '用户主动点击"报告问题"',
    ui: '结构化反馈：错误类型 + 可选描述',
  },
};
```

## 三、埋点架构方案

### 3.1 整体埋点架构

```
┌───────────────────────────────────────────────────────┐
│                    前端埋点 SDK                         │
│                                                       │
│  ┌─────────────┐  ┌──────────────┐  ┌──────────────┐ │
│  │ 性能埋点     │  │ 业务行为埋点  │  │ AI质量埋点   │ │
│  │ Performance │  │ Behavior     │  │ AIQuality    │ │
│  │ Observer    │  │ Tracker      │  │ Tracker      │ │
│  └──────┬──────┘  └──────┬───────┘  └──────┬───────┘ │
│         └────────────────┼─────────────────┘          │
│                    事件总线                            │
│              (Event Bus / 统一格式)                     │
│                    ┌────┴────┐                         │
│                批量缓冲队列                             │
│              (Batch Buffer Queue)                      │
│                    ┌────┴────┐                         │
│              上传策略管理器                              │
│         (优先级/采样/网络感知/离线缓存)                   │
└───────────────────────┬───────────────────────────────┘
                        │ HTTPS
┌───────────────────────┴───────────────────────────────┐
│                    数据采集服务                         │
│  ┌──────────┐  ┌────────────┐  ┌──────────────────┐  │
│  │ 事件校验  │  │ 实时流处理  │  │ 数据仓库(Olap)   │  │
│  │ + 脱敏    │  │ (Flink)    │  │ ClickHouse/      │  │
│  │          │  │            │  │ Doris            │  │
│  └──────────┘  └────────────┘  └──────────────────┘  │
└───────────────────────────────────────────────────────┘
```

### 3.2 统一事件格式

```typescript
interface AnalyticsEvent {
  // —— 标准字段 ——
  eventId: string;
  eventType: 'performance' | 'business' | 'ai_quality' | 'error';
  eventName: string;
  timestamp: number;
  sessionId: string;
  userId: string;
  appVersion: string;
  platform: 'macos' | 'windows' | 'linux';

  // —— 业务字段 ——
  taskId?: string;              // 关联的任务ID
  artifactId?: string;          // 关联的产出物ID
  stepIndex?: number;           // 多步骤中的序号

  // —— 指标数据 ——
  metrics: Record<string, number>;  // 量化指标
  properties: Record<string, unknown>; // 上下文属性

  // —— 隐私控制 ——
  piiScrubbed: boolean;         // 是否已脱敏
  consentLevel: 'full' | 'anonymous' | 'minimal';
}
```

### 3.3 上传策略

```typescript
class AnalyticsUploader {
  // 分优先级上传
  private priorityConfig = {
    critical: {          // 崩溃/错误 → 立即上传
      batchSize: 1,
      flushInterval: 0,
    },
    high: {              // 业务关键事件 → 5秒或攒够20条
      batchSize: 20,
      flushInterval: 5000,
    },
    normal: {            // 一般业务事件 → 30秒或攒够50条
      batchSize: 50,
      flushInterval: 30000,
    },
    low: {               // 性能采样数据 → 2分钟或攒够200条
      batchSize: 200,
      flushInterval: 120000,
    },
  };

  // 离线缓存：网络不可用时写入 IndexedDB，恢复后补传
  // 网络感知：弱网环境下降低上传频率，只传 critical 和 high
  // 采样策略：高频性能指标（如FPS）只采样 10% 用户
}
```

### 3.4 关键埋点实现示例

```typescript
// AI 流式输出体验埋点
function trackAIStreamingExperience(taskId: string) {
  const timings = {
    requestSent: Date.now(),
    firstTokenAt: 0,
    lastTokenAt: 0,
    tokenCount: 0,
    renderStartAt: 0,
    renderEndAt: 0,
  };

  // 监听流式数据
  stream.on('data', (chunk) => {
    if (timings.tokenCount === 0) {
      timings.firstTokenAt = Date.now();
      track('ai_first_token', {
        taskId,
        ttfw: timings.firstTokenAt - timings.requestSent,
      });
    }
    timings.tokenCount += chunk.tokens;
    timings.lastTokenAt = Date.now();
  });

  // 流结束 + 渲染完成
  stream.on('end', async () => {
    await waitForRender();
    timings.renderEndAt = Date.now();

    track('ai_response_complete', {
      taskId,
      totalDuration: timings.renderEndAt - timings.requestSent,
      ttfw: timings.firstTokenAt - timings.requestSent,
      streamingDuration: timings.lastTokenAt - timings.firstTokenAt,
      renderDuration: timings.renderEndAt - timings.lastTokenAt,
      tokensPerSecond: timings.tokenCount / 
        ((timings.lastTokenAt - timings.firstTokenAt) / 1000),
    });
  });
}
```

## 四、指标看板与告警

### 4.1 分层看板设计

| 看板层级 | 使用者 | 核心指标 |
|---------|--------|---------|
| **L0 健康看板** | 全员 | 崩溃率、API成功率、DAU |
| **L1 体验看板** | 前端团队 | FCP/TTI/TTFW/FPS、长任务率 |
| **L2 业务看板** | 产品团队 | 任务完成率、采纳率、留存率 |
| **L3 AI质量看板** | AI/算法团队 | 准确率、幻觉率、满意度趋势 |
| **L4 深度分析** | 数据分析 | 漏斗、归因、AB实验 |

### 4.2 告警规则

```yaml
alerts:
  # 体验告警
  - name: TTFW劣化
    condition: P95_ttfw > 3000ms
    window: 5min
    severity: warning

  # 业务告警
  - name: 任务完成率下降
    condition: completion_rate < 75%
    window: 1h
    severity: critical

  # AI质量告警
  - name: 满意度下降
    condition: thumbs_down_rate > 25%
    window: 30min
    severity: critical

  # 工程告警
  - name: 崩溃率
    condition: crash_rate > 0.5%
    window: 10min
    severity: critical
```

## 五、A/B 测试方案

比较两个版本的效果时，需要三维指标的联合评估：

```typescript
interface ABTestConfig {
  experimentId: string;
  variants: {
    control: { version: 'A', model: 'v1', features: [] };
    treatment: { version: 'B', model: 'v2', features: ['new_reasoning'] };
  };
  // 流量分配
  trafficAllocation: { control: 50, treatment: 50 };
  // 三维评估指标
  metrics: {
    experience: ['ttfw', 'fps', 'crash_rate'],
    business: ['completion_rate', 'adoption_rate', 'd1_retention'],
    ai_quality: ['accuracy', 'satisfaction_score', 'hallucination_rate'],
  };
  // 统计显著性要求
  significanceLevel: 0.05;
  minimumSampleSize: 1000; // 每组
}
```

**评估原则：**
- **不能只看一个维度**：模型升级可能提高 AI 质量但降低流式速度（体验变差）
- **关注北极星指标**：以"产物采纳率"作为综合判断——它同时反映 AI 质量（内容好才会采纳）和体验（流畅度影响采纳意愿）
- **防止局部优化**：任务完成率提升但 D1 留存下降，说明短期效果好但长期伤害了用户体验

## 六、总结：三维指标体系的核心要点

| 维度 | 核心问题 | 北极星指标 |
|------|---------|-----------|
| **体验指标** | "用起来流畅吗？" | AI 首字延迟 TTFW |
| **业务指标** | "用户真正用起来了吗？" | 产物采纳率 |
| **AI 质量指标** | "AI 产出可靠吗？" | 综合满意度（显式+隐式） |

AI-Native 桌面前端的质量评估，**不能照搬传统 Web 前端的纯性能思维**。三维模型的核心洞察是：AI 产品引入了"产出质量"和"业务效果"两个全新维度，且三个维度之间相互制约——提高 AI 质量可能降低响应速度，优化性能可能牺牲功能深度。**好的 AI 前端不是在单一维度上极致优化，而是在三维约束中找到最优平衡点。** 最终判断标准只有一个：用户是否真正通过产品完成了任务并采纳了 AI 的产出。

## 记忆要点

- 传统指标不够用：需构建「体验 × 业务 × AI质量」三维评价体系
- AI体验看速度：核心盯首字延迟(TTFW)与流式输出速率，防范主线程卡顿
- AI价值看采纳：产物采纳率与分步接受率是检验业务效果的核心标尺
- AI质量防幻觉：追踪重试率与任务放弃率，量化大模型输出不可靠的损耗

