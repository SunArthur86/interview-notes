---
id: note-mk-021
difficulty: L4
category: ai
subcategory: 桌面AI产品
tags:
- 月之暗面
- 面经
- AI-Native
- 平台架构
- 架构决策
feynman:
  essence: 如果产品要扩到更多桌面能力，最该先做成平台的是产物协议层——它是所有Agent、所有产物类型和所有交互模式的交汇点。把产物对象模型、产物渲染器、产物编辑器和产物导出器统一成平台能力，新增Agent时只需实现业务逻辑而非重新搭建产物管理基础设施。
  analogy: 就像建购物中心——先建好商铺标准（产物协议：统一面积/水电接口/消防规范）、公共区域（产物面板：走廊/电梯/卫生间）、管理系统（版本/权限/导出），之后招商（新Agent）只需要按标准装修入驻，不用自己从地基开始盖。
  first_principle: 平台化的本质是"提取共性、隔离差异"。在所有桌面能力中，产物管理是共性最强的——无论什么Agent，产出的都是某种类型的产物对象。先把这一层平台化，后续扩展的成本最低、收益最大。
  key_points:
  - '统一产物对象模型是最先该平台化的'
  - '产物渲染/编辑/导出做成可扩展的渲染器注册表'
  - '新Agent接入只需注册产物类型和适配器'
  - '平台层稳定后，扩展成本从周级降到小时级'
first_principle:
  essence: 平台化优先级=共性×扩展频率
  derivation: 产物层=所有Agent共用的最大公约数×扩展最频繁的部分→平台化收益最大→应优先投入
  conclusion: 产物协议层是AI-Native桌面前端的"操作系统内核"——它决定了整个生态的上限
follow_up:
- 如果桌面端要接文件、网页和本地目录，你先画哪套权限边界？
- 这个产品要接入更多Agent能力时，哪层架构最不能乱？
---

# 【月之暗面面经】如果产品要扩到更多桌面能力，哪层前端架构最该先做成平台？

## 一、平台化优先级分析

```
┌──────────────────────────────────────────────────────────────────┐
│              平台化优先级矩阵                                      │
├──────────────────────────────────────────────────────────────────┤
│                                                                  │
│     高共性                                                        │
│      ▲    ┌──────────────┐                                      │
│      │    │ 产物协议层 ⭐ │ ← 共性最高 + 扩展最频繁 = 优先平台化   │
│      │    └──────────────┘                                      │
│      │    ┌──────────────┐                                      │
│      │    │ 任务中心      │ ← 共性高 + 扩展中等                   │
│      │    └──────────────┘                                      │
│      │    ┌──────────────┐    ┌──────────────┐                  │
│      │    │ 权限管理      │    │ 通知系统      │ ← 共性中          │
│      │    └──────────────┘    └──────────────┘                  │
│      │                                                          │
│     低共性    ┌──────────────┐                                  │
│      │        │ 输入系统      │ ← 不同Agent输入差异大             │
│      │        └──────────────┘                                  │
│      │        ┌──────────────┐                                  │
│      │        │ 回放系统      │ ← 不同Agent执行过程差异大          │
│      │        └──────────────┘                                  │
│      │                                                          │
│      └──────────────────────────────────→ 扩展频率               │
│         低                         高                             │
│                                                                  │
└──────────────────────────────────────────────────────────────────┘
```

**结论：产物协议层应该最先平台化。**

## 二、产物协议平台化设计

### 产物对象模型（统一标准）

```typescript
// 所有产物必须实现的接口
interface Artifact {
  id: string;
  taskId: string;
  
  // 类型标识（平台注册的产物类型）
  kind: string;                // 在产物类型注册表中注册
  
  // 内容（统一容器）
  content: ArtifactContent;
  
  // 版本
  version: number;
  
  // 状态
  status: ArtifactStatus;
  
  // 落地信息
  exportInfo?: ExportInfo;
}

// 内容容器——支持不同格式
interface ArtifactContent {
  format: 'json' | 'html' | 'markdown' | 'binary' | 'text';
  data: string | object | ArrayBuffer;
  encoding?: string;
}
```

### 产物类型注册表

```typescript
// 产物类型注册——新Agent注册新产物类型
class ArtifactTypeRegistry {
  private types: Map<string, ArtifactTypeSpec> = new Map();
  
  register(spec: ArtifactTypeSpec) {
    this.types.set(spec.kind, spec);
  }
  
  get(kind: string): ArtifactTypeSpec | undefined {
    return this.types.get(kind);
  }
}

// 每种产物类型提供：渲染器 + 编辑器 + 导出器 + Diff器
interface ArtifactTypeSpec {
  kind: string;                 // 'site' / 'ppt' / 'sheet' / 'chart'
  displayName: string;
  icon: string;
  
  // 渲染器——如何预览产物
  renderer: {
    component: Vue.Component;   // 预览组件
    thumbnail?: Vue.Component;  // 缩略图组件
  };
  
  // 编辑器——如何编辑产物
  editor?: {
    component: Vue.Component;   // 编辑组件
    capabilities: string[];     // 支持的编辑能力
  };
  
  // 导出器——如何导出产物
  exporters: ArtifactExporter[];
  
  // Diff器——如何比较两个版本
  differ?: ArtifactDiffer;
  
  // 校验器——如何验证产物内容
  validator?: ArtifactValidator;
}
```

### 平台层架构图

```
┌──────────────────────────────────────────────────────────────────┐
│                    产物协议平台层                                   │
├──────────────────────────────────────────────────────────────────┤
│                                                                  │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │                   产物管理器（Artifact Manager）           │    │
│  │                                                         │    │
│  │  • 创建/读取/更新/删除产物                                │    │
│  │  • 版本管理                                              │    │
│  │  • 状态机管理                                            │    │
│  └────────────────────────┬────────────────────────────────┘    │
│                           │                                      │
│         ┌─────────────────┼─────────────────┐                   │
│         │                 │                 │                   │
│  ┌──────┴──────┐  ┌──────┴──────┐  ┌──────┴──────┐            │
│  │  渲染器      │  │  编辑器      │  │  导出器      │            │
│  │  Registry   │  │  Registry   │  │  Registry   │            │
│  └──────┬──────┘  └──────┬──────┘  └──────┬──────┘            │
│         │                │                 │                   │
│    ┌────┴────┐      ┌────┴────┐       ┌────┴────┐              │
│    │Site渲染 │      │Site编辑 │       │HTML导出 │              │
│    │PPT渲染  │      │PPT编辑  │       │PPTX导出 │              │
│    │Sheet渲染│      │Sheet编辑│       │XLSX导出 │              │
│    │Chart渲染│      │Chart编辑│       │PNG导出  │              │
│    └─────────┘      └─────────┘       └─────────┘              │
│                                                                  │
└──────────────────────────────────────────────────────────────────┘
```

## 三、新Agent接入示例

```typescript
// 新增"思维导图"产物类型
artifactRegistry.register({
  kind: 'mindmap',
  displayName: '思维导图',
  icon: '🧩',
  
  renderer: {
    component: MindmapPreview,     // 自定义预览组件
    thumbnail: MindmapThumbnail,
  },
  
  editor: {
    component: MindmapEditor,       // 自定义编辑组件
    capabilities: ['add-node', 'edit-text', 'rearrange', 'collapse'],
  },
  
  exporters: [
    { format: 'png', handler: exportMindmapPNG },
    { format: 'svg', handler: exportMindmapSVG },
    { format: 'json', handler: exportMindmapJSON },
  ],
  
  differ: {
    compare: diffMindmap,           // 自定义Diff算法
    render: renderMindmapDiff,
  },
  
  validator: {
    validate: validateMindmapStructure,
  },
});

// 注册完成后，产物面板、任务中心、回放页自动支持思维导图
// 不需要修改任何共用模块
```

## 四、平台化的收益

```
平台化前：                          平台化后：
                                    
新增Agent需要：                      新增Agent需要：
  ❌ 写产物对象定义                    ✅ 注册产物类型spec
  ❌ 写产物预览组件                    ✅ （已由renderer提供）
  ❌ 写产物编辑组件                    ✅ （已由editor提供）
  ❌ 写导出逻辑                        ✅ （已由exporter提供）
  ❌ 写Diff逻辑                        ✅ （已由differ提供）
  ❌ 改产物面板组件                    ✅ （自动支持新类型）
  ❌ 改任务中心                        ✅ （自动支持新类型）
  ❌ 改回放页                          ✅ （自动支持新类型）
                                    
工时：1-2周                          工时：1-2天
```

## 五、常见坑

- **先平台化输入系统**：输入差异大，强行统一会导致灵活性丧失，应后做
- **产物类型硬编码**：在共用组件里 `if (kind === 'site')` 判断，违反开闭原则
- **渲染器耦合业务逻辑**：渲染器应该纯展示，不包含Agent业务逻辑
- **没有注册表机制**：新增类型需要改多处代码，而非只注册一次
