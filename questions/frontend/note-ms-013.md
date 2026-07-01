---
id: note-ms-013
difficulty: L4
category: frontend
subcategory: AI-Native桌面
tags:
- 月之暗面
- 面经
- Diff
- 产物对比
- 新手vs高手
feynman:
  essence: 分层Diff：新手看摘要级变化(改了什么/为什么)，高手看行级/Token级详细对比。可切换视图层级。
  analogy: 就像Git Diff——新手看Summary（修改了3个文件），高手看具体的每行代码变更，一个界面两种深度。
  first_principle: Diff设计 = 变更可视化 × 用户能力适配 × 渐进式披露。
  key_points:
  - '摘要层: 新手看"AI改了什么+为什么"'
  - '行级层: 高手看精确的行/Token对比'
  - '视图切换: 按需展开更多细节'
  - '颜色标注: 增删改用不同颜色'
  - '接受/拒绝: 可选择性接受变更'
first_principle:
  essence: 渐进式披露=同一信息的多分辨率呈现
  derivation: Diff太详细→新手看不懂→太简单→高手不够用→分层展示→默认摘要→按需展开→人人适用
  conclusion: Diff设计的核心是同一变更的多层级视图切换
follow_up:
- 大文件的Diff性能怎么优化？
- 非文本产物(图片/PPT)的Diff怎么做？
- Diff的接受/拒绝怎么做成批量操作？
memory_points:
- 核心理念渐进式披露：同一份变更多分辨率呈现，按需选择查看深度
- 三层 Diff 架构：L1自然语言摘要（新手）、L2块级/函数级（中级）、L3行/Token级（高手）
- 交互原则就地展开：从摘要下钻到行级不跳页面，且支持双向导航
- 精细化审查：每个变更单元支持独立接受/拒绝，而非全量覆盖
---

# 【月之暗面面经】如何设计 AI 桌面端的产物 diff，既能给新手看，也能给高手看？

## 一、问题背景

在 AI Native 桌面应用中，AI 生成的"产物"（文档、代码、配置文件等）需要展示给用户审阅。用户需要确认 AI 改了什么、是否接受这些修改。核心矛盾在于：**新手用户**面对一堆红色绿色的行级 Diff 完全不知道发生了什么，而**高手用户**又需要看到精确的 Token 级差异来做精细控制。如果只做一种粒度，必然有一方不满意。

这个问题的本质是 **渐进式披露（Progressive Disclosure）**——同一份变更信息，以多分辨率的方式呈现，让用户按需选择查看深度。

## 二、核心设计理念：三层 Diff 视图

### 2.1 渐进式披露金字塔

```
        ┌─────────────────┐
        │   摘要层(L1)     │  ← 新手默认视图
        │  "AI改了什么"    │
        ├─────────────────┤
        │   块级层(L2)     │  ← 中级视图(点击展开)
        │  "哪些段落变了"  │
        ├─────────────────┤
        │   行级层(L3)     │  ← 高手默认视图
        │  "具体每行差异"  │
        └─────────────────┘
```

- **L1 摘要层**：AI 用自然语言描述"我修改了 3 处：修正了标题措辞、补充了第二段的论据、调整了结论的格式"——新手一眼懂。
- **L2 块级层**：按段落/函数/章节粒度展示变更块，每个块有标题和变更类型标签——中级用户快速定位。
- **L3 行级层**：标准的 diff 格式，逐行甚至逐 Token 对比，增删改用颜色标注——高手精细审查。

### 2.2 关键设计原则

1. **默认分层**：根据用户画像（新手/专家）或上次偏好自动选择默认视图层级
2. **就地展开**：不跳页面，点击摘要项原地展开到块级，再点击展开到行级
3. **双向导航**：既能从摘要逐层下钻，也能从行级逐层回收到摘要
4. **选择性接受**：每个变更单元都可以独立接受/拒绝，不是全有或全无

## 三、Diff 组件架构设计

### 3.1 组件树结构

```
<DiffViewer>                    ← 根容器，管理状态
  ├── <DiffToolbar>             ← 视图切换、批量操作
  │     ├── ViewModeSwitcher    ← L1/L2/L3 切换
  │     ├── DiffActions         ← 全部接受/全部拒绝
  │     └── DiffSettings        ← 忽略空格/大小写等
  ├── <DiffSummary>             ← L1 摘要视图
  │     └── SummaryItem[]       ← 每个变更的卡片描述
  ├── <DiffBlocks>              ← L2 块级视图
  │     └── DiffBlock[]         ← 每个变更块
  │           ├── BlockHeader   ← 块标题 + 变更类型
  │           └── BlockContent  ← 块内容预览
  ├── <DiffUnified>             ← L3 行级统一视图
  │     └── DiffHunk[]          ← 连续变更段
  │           └── DiffLine[]    ← 逐行对比
  └── <DiffStatusBar>           ← 统计信息：12增/3删/5改
</DiffViewer>
```

### 3.2 核心数据结构

```typescript
// 变更的最小单元
interface ChangeUnit {
  id: string;
  type: 'add' | 'delete' | 'modify';
  // 摘要信息（L1用）
  summary: string;           // "修正了第三段的措辞"
  rationale: string;         // "原文'大约'不够准确，改为'约75%'"
  category: ChangeCategory;  // wording | structure | format | logic
  // 块级信息（L2用）
  blockTitle: string;        // "第三段：市场规模分析"
  blockRange: { start: number; end: number };
  // 行级信息（L3用）
  hunks: DiffHunk[];
  // 元数据
  confidence: number;        // AI 对此修改的置信度
  accepted?: boolean;        // 用户是否接受
}

// Diff Hunk（连续变更段）
interface DiffHunk {
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  lines: DiffLine[];
}

// Diff 单行
interface DiffLine {
  type: 'context' | 'add' | 'delete';
  oldNumber?: number;
  newNumber?: number;
  content: string;
  // Token级高亮（可选）
  tokens?: TokenDiff[];
}

interface TokenDiff {
  type: 'equal' | 'add' | 'delete';
  value: string;
}
```

### 3.3 视图切换状态机

```typescript
type ViewMode = 'summary' | 'block' | 'unified';

// 切换逻辑：不是完全替换视图，而是折叠/展开
function DiffViewer({ changes }: { changes: ChangeUnit[] }) {
  const [viewMode, setViewMode] = useState<ViewMode>(
    userPreference.expertLevel === 'novice' ? 'summary' : 'unified'
  );
  const [expandedUnits, setExpandedUnits] = useState<Set<string>>(new Set());

  // 摘要层：点击某个变更项 → 展开该项的块级视图
  // 块级层：点击块 → 展开行级视图
  // 行级层：可以折叠回块级

  const toggleExpand = (unitId: string) => {
    setExpandedUnits(prev => {
      const next = new Set(prev);
      next.has(unitId) ? next.delete(unitId) : next.add(unitId);
      return next;
    });
  };

  return (
    <div className="diff-viewer">
      <DiffToolbar mode={viewMode} onModeChange={setViewMode} />
      {changes.map(unit => (
        <ChangeUnitRenderer
          key={unit.id}
          unit={unit}
          viewMode={viewMode}
          expanded={expandedUnits.has(unit.id)}
          onToggle={() => toggleExpand(unit.id)}
        />
      ))}
    </div>
  );
}
```

### 3.4 ChangeUnitRenderer 渲染逻辑

```tsx
function ChangeUnitRenderer({ unit, viewMode, expanded, onToggle }) {
  // L1 摘要模式：显示卡片
  if (viewMode === 'summary') {
    return (
      <div className="summary-card" onClick={onToggle}>
        <ChangeBadge type={unit.type} />
        <span className="summary-text">{unit.summary}</span>
        <span className="rationale">{unit.rationale}</span>
        {expanded && <UnifiedDiff hunks={unit.hunks} />}
      </div>
    );
  }

  // L2 块级模式：显示块预览
  if (viewMode === 'block') {
    return (
      <div className="block-card" onClick={onToggle}>
        <BlockHeader title={unit.blockTitle} type={unit.type} range={unit.blockRange} />
        <BlockPreview lines={unit.hunks[0]?.lines.slice(0, 3)} />
        {expanded && <UnifiedDiff hunks={unit.hunks} />}
      </div>
    );
  }

  // L3 行级模式：直接显示完整 diff
  return <UnifiedDiff hunks={unit.hunks} showLineNumbers />;
}
```

## 四、关键实现细节

### 4.1 Diff 算法选择

```typescript
// 文本Diff：使用 diff-match-patch 或 jsdiff
import { diffLines, diffWordsWithSpace } from 'diff';

function computeChangeUnit(oldText: string, newText: string): ChangeUnit {
  const lineDiff = diffLines(oldText, newText);

  const hunks = groupIntoHunks(lineDiff);  // 连续变更分组成hunks

  // 对修改行，进一步做Token级Diff
  for (const hunk of hunks) {
    for (const line of hunk.lines) {
      if (line.type === 'modify') {
        line.tokens = diffWordsWithSpace(
          line.oldContent,
          line.newContent
        );
      }
    }
  }

  return { hunks, /* ... */ };
}
```

### 4.2 Token 级高亮（精确到词）

行级 Diff 有时粒度不够——比如一行里只改了一个词。Token 级 Diff 在"修改"行内部进一步高亮差异：

```
原文：市场规模大约5000亿
修改：市场规模约7500亿
           ~~大约~~ → ~~约7500~~
```

```tsx
function TokenLevelDiff({ tokens }: { tokens: TokenDiff[] }) {
  return (
    <span>
      {tokens.map((t, i) => (
        <span
          key={i}
          className={`token-${t.type}`}
          style={{
            backgroundColor: t.type === 'add' ? '#e6ffec' :
                             t.type === 'delete' ? '#ffebe9' : 'transparent'
          }}
        >
          {t.value}
        </span>
      ))}
    </span>
  );
}
```

### 4.3 接受/拒绝交互

```typescript
interface AcceptRejectState {
  // 三种状态：pending(待决定) / accepted / rejected
  status: 'pending' | 'accepted' | 'rejected';
}

// 每个变更单元独立接受/拒绝
// 批量操作：全部接受、全部拒绝、接受所有格式类修改
function batchAccept(changes: ChangeUnit[], filter?: ChangeCategory) {
  return changes
    .filter(c => !filter || c.category === filter)
    .map(c => ({ ...c, accepted: true }));
}
```

### 4.4 大文件性能优化

```typescript
// 虚拟滚动：只渲染可见区域的diff行
import { useVirtualizer } from '@tanstack/react-virtual';

function VirtualizedDiffList({ hunks }: { hunks: DiffHunk[] }) {
  const allLines = hunks.flatMap(h => h.lines);
  const rowVirtualizer = useVirtualizer({
    count: allLines.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 24, // 每行高度
  });

  return (
    <div ref={scrollRef} style={{ height: '600px', overflow: 'auto' }}>
      <div style={{ height: `${rowVirtualizer.getTotalSize()}px` }}>
        {rowVirtualizer.getVirtualItems().map(vRow => (
          <DiffLine
            key={vRow.key}
            line={allLines[vRow.index]}
            style={{ position: 'absolute', top: vRow.start }}
          />
        ))}
      </div>
    </div>
  );
}

// Web Worker 异步计算Diff，避免阻塞主线程
const diffWorker = new Worker('./diff-worker.ts');
diffWorker.postMessage({ oldText, newText });
diffWorker.onmessage = (e) => setChanges(e.data);
```

### 4.5 非文本产物的 Diff

| 产物类型 | Diff 策略 |
|---------|----------|
| **图片** | 并排对比 + 滑块叠加（拖动滑块切换新旧） |
| **PPT/设计稿** | 缩略图对比 + 热区标注变更位置 |
| **表格/CSV** | 单元格级对比，高亮变化单元格 |
| **结构化数据** | JSON Patch（RFC 6902）格式，path 级展示 |

## 五、视觉设计规范

```
颜色规范：
┌─────────────┬───────────┬────────────────────────┐
│  变更类型    │  背景色    │  含义                   │
├─────────────┼───────────┼────────────────────────┤
│  新增(add)   │  #e6ffec   │  绿色系，安全感           │
│  删除(delete)│  #ffebe9   │  红色系，警示             │
│  修改(modify)│  #fff8c5   │  黄色系，需关注           │
│  上下文      │  transparent│  无背景，不变            │
└─────────────┴───────────┴────────────────────────┘

布局规范：
- 摘要卡：圆角卡片，左侧色条标注变更类型，右侧接受/拒绝按钮
- 行级Diff：左右双列（旧文本 | 新文本）或单列统一视图
- 行号：左侧灰色小号字体，旧/新行号并排
```

## 六、用户画像驱动的默认视图

```typescript
interface UserDiffPreference {
  expertise: 'novice' | 'intermediate' | 'expert';
  preferredView: ViewMode;
  autoExpandRationale: boolean;  // 新手自动展示AI修改理由
  showTokenDiff: boolean;        // 高手是否默认显示Token级
}

// 智能默认：根据用户画像自动选择
function getDefaultView(pref: UserDiffPreference): ViewMode {
  if (pref.preferredView) return pref.preferredView;
  switch (pref.expertise) {
    case 'novice':     return 'summary';
    case 'intermediate': return 'block';
    case 'expert':     return 'unified';
  }
}

// 渐进引导：新手用过几次后，提示"试试行级视图看更多细节？"
function progressiveGuidance(usageCount: number, expertise: string) {
  if (expertise === 'novice' && usageCount > 5) {
    return {
      tip: '你现在可以切换到「详细视图」查看精确的行级变化',
      action: { label: '试试看', onViewChange: 'block' }
    };
  }
}
```

## 七、总结

产物 Diff 的分层设计本质上是 **信息密度的用户适配**：

| 层级 | 目标用户 | 信息密度 | 交互复杂度 | 视觉复杂度 |
|------|---------|---------|-----------|-----------|
| L1 摘要 | 新手 | 低 | 低（看/接受） | 卡片+文字 |
| L2 块级 | 中级 | 中 | 中（定位/展开） | 块预览 |
| L3 行级 | 高手 | 高 | 高（精细审查） | 标准 diff |

核心理念：**不要强迫所有用户看同一个粒度**。让新手先看到 AI 改了什么、为什么改（摘要+理由），建立信任后自然过渡到更细的视图；让高手直接进入行级 Diff 做精细控制，不被摘要干扰。两者共用同一套底层数据（`ChangeUnit[]`），只是渲染粒度不同。

这套设计的关键成功因素是：(1) AI 能生成高质量的摘要和修改理由（`summary` + `rationale` 字段）；(2) 组件设计做到真正的渐进式展开而非页面跳转；(3) 性能优化到位，大文件 Diff 也不卡顿。

## 记忆要点

- 核心理念渐进式披露：同一份变更多分辨率呈现，按需选择查看深度
- 三层 Diff 架构：L1自然语言摘要（新手）、L2块级/函数级（中级）、L3行/Token级（高手）
- 交互原则就地展开：从摘要下钻到行级不跳页面，且支持双向导航
- 精细化审查：每个变更单元支持独立接受/拒绝，而非全量覆盖

