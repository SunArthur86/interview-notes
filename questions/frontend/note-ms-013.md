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


## 苏格拉底式面试追问

> 这组追问模拟面试官层层逼问，每一问先回答"为什么"，再回答"怎么做"，最后回答"如何证明"。

### 第一层：目标与动机

**Q：Diff 你设计成三层（摘要/块级/行级），但为什么不只做行级 Diff（最详细），让新手学习适应？**

行级 Diff 对新手是"信息过载"。新手看到一堆红绿行（如 `-old line\n+new line`），不知道"AI 整体改了什么""为什么改"，要逐行读才能理解，认知负担重。摘要层的价值：用自然语言说"AI 把第二章的结论部分从 X 改为 Y，因为 Z"，新手一眼看懂意图。行级是"细节"，摘要是"意图"，两者服务于不同需求（新手要意图、高手要细节）。强制新手看行级会导致"看不懂 → 不信任 → 弃用"，而非"学习适应"。渐进式披露（默认摘要、按需展开）是"覆盖两类用户"的方案，而非强制一种粒度。

### 第二层：证据与定位

**Q：用户说"Diff 显示的变更不准确（显示改了但实际没改）"，你怎么定位是 Diff 算法 bug 还是数据问题？**

分段定位：一、Diff 算法——Diff 算法（如 Myers、diff-match-patch）计算 v1 和 v2 的差异，如果算法 bug（如对 Unicode、空格处理不一致），会产生"假变更"。验证：用独立工具（如 Git diff）对相同输入算 Diff，对比结果；二、数据问题——v1 或 v2 数据本身错（如 v2 存储时序列化丢失字符），导致 Diff 算法认为是变更。验证：直接查看 v1/v2 的原文，确认数据正确；三、渲染问题——Diff 算法正确但渲染时 bug（如 HTML 转义导致显示不一致）。常见根因：Diff 算法对"无实质变化的格式调整"（如空格、换行）也标记为变更，应配置算法忽略空白差异（如 `diffIgnoreWhitespace`）。

### 第三层：根因深挖

**Q：大文件 Diff（如 1000 行代码）渲染慢，你做了虚拟滚动但还是卡，根因可能是什么？**

虚拟滚动只解决 DOM 节点数，但还有其他根因：一、Diff 计算慢——大文件的 Diff 算法（如 Myers）是 O(N×M) 复杂度，1000 行可能几百毫秒，如果每次切换都重算，卡顿。优化：Diff 结果缓存（v1/v2 对只算一次）；二、Diff 高亮渲染——每行的增删标记（红绿背景）是 CSS 样式，大量行的样式计算触发 reflow。优化：用 CSS class 而非 inline style，减少样式计算；三、响应式触发——Diff 数据存 Vue reactive，大数组的深度代理开销大。优化：用 shallowRef 或 markRaw 跳过代理。定位：Performance 火焰图看具体瓶颈（scripting 慢是 Diff 计算，rendering 慢是渲染，painting 慢是样式）。

**Q：那为什么不直接用 Monaco Editor 的 Diff Editor（成熟的代码 Diff 组件），而要自研？**

Monaco Diff Editor 的局限：一、只适合代码——它是为代码设计的（语法高亮、行号），AI 产物可能是文档（富文本）、配置（JSON）、混合内容，Monaco 的代码渲染不适合；二、不支持摘要层——Monaco 只做行级 Diff，不支持"自然语言摘要"（AI 解释改了什么），而 AI Diff 需要摘要层给新手；三、体积大——Monaco 是几 MB 的编辑器（VS Code 的核心），只为 Diff 引入太重；四、定制难——Monaco 的 API 复杂，定制 UI（如接受/拒绝按钮、分支重跑）成本高。自研 Diff 的优势：支持多类型产物（文本/代码/配置）、三层视图（摘要/块级/行级）、定制交互（接受/拒绝）。所以代码类产物可用 Monaco，通用 Diff 自研更灵活。

### 第四层：方案权衡

**Q：非文本产物（如图片、PPT）的 Diff 你怎么做，行级 Diff 不适用？**

非文本产物的 Diff 要按类型设计：一、图片 Diff——用视觉 Diff（如像素级对比，高亮差异区域）或 AI 描述 Diff（如"图片的左上角 Logo 从 A 改为 B"）；二、PPT Diff——按幻灯片对比（如"第 3 页的内容从 X 改为 Y"），每页可下钻到元素级（如"标题文字变了"）；三、表格 Diff——按行/列对比（如"第 5 行新增""第 3 列的值从 A 改为 B"），用颜色标注增删改；四、站点 Diff——DOM 树对比（如"导航栏新增了一个链接"），可可视化高亮变化区域。核心思路："非文本产物不能套用文本 Diff，要按产物的结构（像素/幻灯片/行列/DOM）设计结构化 Diff"，并配合 AI 的自然语言摘要（"这个产物改了什么"）。

**Q：为什么不直接让 AI 用自然语言描述所有变更（"AI 改了标题、新增了第 3 段..."），不用结构化 Diff？**

纯自然语言描述的问题：一、不精确——AI 说"改了标题"，但具体从什么改成什么？用户要精确对比时自然语言不够；二、不可操作——用户想"接受这个变更拒绝那个"，自然语言描述无法精确对应到"哪个变更单元"；三、不可信——AI 可能遗漏或错误描述（幻觉），用户无法验证。结构化 Diff 的优势：精确（行/元素级）、可操作（每个变更单元独立接受/拒绝）、可信（算法算出，非 AI 主观）。所以"结构化 Diff 为主（精确、可操作），AI 摘要为辅（解释意图）"，两者结合。AI 摘要给"为什么改"，结构化 Diff 给"具体改了什么"，用户既理解意图又能精确控制。

### 第五层：验证与沉淀

**Q：你怎么验证三层 Diff 设计比单层（只行级或只摘要）更优？**

分用户群体 A/B 测试：一、新手组——三层（默认摘要）vs 只行级，测"理解变更的耗时"（三层应更短，新手看摘要快）和"误接受率"（三层应更低，新手理解后才接受）；二、高手组——三层（可切行级）vs 只摘要，测"精确审查的完成率"（三层应更高，高手能切到行级）和"满意度"（三层应更高，高手要细粒度）；三、切换率——三层 Diff 中用户从摘要切到行级的比例（应有一定比例，说明渐进式披露有效）。核心指标："两类用户的满意度都高"（三层覆盖广），而非单层的"某类用户满意、另一类不满"。

**Q：这道题沉淀出什么可复用的 Diff 设计经验？**

四条原则：一、渐进式披露——默认摘要（新手友好），按需展开到块级/行级（高手精确），三层视图切换，不强制一种粒度；二、结构化 Diff 为主、AI 摘要为辅——结构化 Diff 精确可操作，AI 摘要解释意图，两者互补；三、按产物类型设计——文本用行级、图片用视觉/描述、PPT 用幻灯片级、表格用行列级，不套用统一 Diff；四、性能优化——Diff 结果缓存（避免重算）、虚拟滚动（大文件）、shallowRef（避免响应式开销）。核心洞察："Diff 设计本质是'信息的多分辨率呈现'——借鉴 Git Diff（行级）+ AI 摘要（意图层），用渐进式披露让同一变更适配新手和高手，核心是'用户能力适配'而非'技术先进性'。"


## 结构化回答

**30 秒电梯演讲：** 分层Diff：新手看摘要级变化(改了什么/为什么)，高手看行级/Token级详细对比。打个比方，就像Git Diff——新手看Summary（修改了3个文件），高手看具体的每行代码变更，一个界面两种深度。

**展开框架：**
1. **核心理念渐进式披露** — 同一份变更多分辨率呈现，按需选择查看深度
2. **三层 Diff 架构** — L1自然语言摘要（新手）、L2块级/函数级（中级）、L3行/Token级（高手）
3. **交互原则就地展开** — 从摘要下钻到行级不跳页面，且支持双向导航

**收尾：** 这块我踩过坑——要不要深入聊：大文件的Diff性能怎么优化？

## 视频脚本

> 预计时长：4 分钟 | 由浅入深

| 时间 | 画面/字幕 | 口播台词 | 讲解要点 |
|------|----------|----------|----------|
| 0:00 | 标题卡 | "AI-Native桌面一句话：分层Diff：新手看摘要级变化(改了什么/为什么)，高手看行级/Token级详细对比。可切换视图层级。" | 开场钩子 |
| 0:15 | 图遍历示意图 | "核心理念渐进式披露：同一份变更多分辨率呈现，按需选择查看深度" | 核心理念渐进式披露 |
| 1:08 | 图遍历示意图分步演示 | "三层 Diff 架构：L1自然语言摘要（新手）、L2块级/函数级（中级）、L3行/Token级（高手）" | 三层 Diff 架构 |
| 2:01 | 关键代码/伪代码片段 | "交互原则就地展开：从摘要下钻到行级不跳页面，且支持双向导航" | 交互原则就地展开 |
| 2:54 | 对比表格 | "精细化审查：每个变更单元支持独立接受/拒绝，而非全量覆盖" | 精细化审查 |
| 3:50 | 总结卡 | "核心抓住这条主线，下期咱们接着聊：大文件的Diff性能怎么优化。" | 收尾 |
