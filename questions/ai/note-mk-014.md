---
id: note-mk-014
difficulty: L5
category: ai
subcategory: 桌面AI产品
tags:
- 月之暗面
- 面经
- AI-Native
- 扩展设计
- 平台化
feynman:
  essence: 要让前端在接入更多Agent时保持扩展能力，核心是统一三套协议（输入协议、结果协议、授权协议），把产物面板/任务中心/回放页做成共用模块，Agent差异放在能力描述和适配层，不让每个Agent自己重新做一套工作台。
  analogy: 就像手机App Store——所有App共用同一套系统UI（设置/通知/权限），开发者只需要写App逻辑，不需要自己重新实现操作系统。平台层收住共性，新App才能快速接入。
  first_principle: 当Agent从3个增长到30个时，如果每个Agent各自实现一套UI和工作流，前端代码会指数级膨胀。解决之道是"平台化"——把所有Agent共性的部分抽象为平台能力，Agent只提供差异化的能力描述和业务逻辑。
  key_points:
  - 统一输入协议、结果协议和授权协议
  - 把产物面板、任务中心和回放页做成共用模块
  - Agent差异放在能力描述和适配层
  - 不要让每个Agent自己重新做一套工作台
first_principle:
  essence: 平台化 vs 定制化的架构选择
  derivation: N个Agent×M个UI模块=N*M种组合→维护成本爆炸→抽象共性为平台层(3套协议+共用模块)→Agent只做差异化适配→复杂度从N*M降到N+M
  conclusion: AI-Native桌面前端的终局不是"更多页面"，而是"更强平台"——新Agent接入的时间应该以小时计而非周计
follow_up:
- 如果桌面端要接文件、网页和本地目录，你先画哪套权限边界？
- 这个产品要接入更多Agent能力时，哪层架构最不能乱？
memory_points:
- 坚决反模式：拒绝一Agent一套UI，避免重复造轮子导致维护成本呈指数级增长。
- 平台加插件架构：抽象统一输入、任务中心、产物面板作为平台底座，各Agent作为适配层接入。
- 统一三大协议：通过标准化的输入、结果、授权协议，实现底层与具体Agent的解耦。
- 配置化扩展：新增Agent只需编写配置文件描述其输入约束和产物渲染器，前端零侵入。
---

# 【月之暗面面经】如果产品要加更多 Agent，前端怎样保持扩展能力而不是越做越重？

## 一、反模式：一Agent一工作台

```
❌ 错误做法：
  代码生成Agent → 自己的输入框 + 自己的产物面板 + 自己的设置页
  PPT生成Agent  → 自己的输入框 + 自己的产物面板 + 自己的设置页
  数据分析Agent → 自己的输入框 + 自己的产物面板 + 自己的设置页
  网站生成Agent → 自己的输入框 + 自己的产物面板 + 自己的设置页

  结果：4个Agent = 4套UI = 维护噩梦
  增加第5个Agent = 再写一套UI
```

## 二、正确模式：平台 + 插件

```
┌──────────────────────────────────────────────────────────────────┐
│                    平台化架构                                      │
├──────────────────────────────────────────────────────────────────┤
│                                                                  │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │                    平台层（共用）                          │    │
│  │                                                         │    │
│  │  ┌──────────┐  ┌──────────┐  ┌──────────┐            │    │
│  │  │ 统一输入框 │  │ 任务中心  │  │ 产物面板  │            │    │
│  │  │          │  │          │  │          │            │    │
│  │  │ 命令补全   │  │ 任务队列  │  │ 预览/编辑  │            │    │
│  │  │ 自然语言   │  │ 状态机    │  │ 导出/发布  │            │    │
│  │  └──────────┘  └──────────┘  └──────────┘            │    │
│  │  ┌──────────┐  ┌──────────┐  ┌──────────┐            │    │
│  │  │ 回放页    │  │ 权限管理  │  │ 通知系统  │            │    │
│  │  └──────────┘  └──────────┘  └──────────┘            │    │
│  └─────────────────────────────────────────────────────────┘    │
│                              ↕                                   │
│                    三套统一协议                                   │
│              (输入协议/结果协议/授权协议)                           │
│                              ↕                                   │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │                    Agent适配层                             │    │
│  │                                                         │    │
│  │  ┌────────┐ ┌────────┐ ┌────────┐ ┌────────┐         │    │
│  │  │代码生成 │ │PPT生成  │ │数据分析 │ │网站生成 │         │    │
│  │  │Adapter │ │Adapter │ │Adapter │ │Adapter │         │    │
│  │  └────────┘ └────────┘ └────────┘ └────────┘         │    │
│  └─────────────────────────────────────────────────────────┘    │
│                                                                  │
└──────────────────────────────────────────────────────────────────┘
```

## 三、三套统一协议

### 1. 输入协议（Input Protocol）

```typescript
// 所有Agent使用统一的输入格式
interface AgentInput {
  // Agent标识
  agentType: string;
  
  // 用户输入
  rawInput: string;              // 原始输入（命令或自然语言）
  
  // 上下文
  inputRefs: InputRef[];         // 引用的文件/URL
  contextSummary: string;        // 上下文摘要
  
  // 参数
  params: Record<string, any>;   // 结构化参数
  
  // 偏好
  preferences: {
    outputFormat?: string;       // 输出格式偏好
    language?: string;
    style?: string;
  };
}

// 每个Agent声明自己接受的输入类型
interface AgentCapability {
  agentType: string;
  displayName: string;
  
  // 接受的输入类型
  acceptedInputs: {
    fileTypes: string[];         // ['.md', '.pdf', '.png']
    urlSchemes: string[];        // ['https://', 'file://']
    textInput: boolean;          // 是否接受纯文本输入
  };
  
  // 输出类型
  outputTypes: ArtifactKind[];   // ['site', 'ppt', 'sheet']
  
  // 命令别名
  commands: string[];            // ['/gen-site', '/make-website']
}
```

### 2. 结果协议（Result Protocol）

```typescript
// 所有Agent返回统一的结果格式
interface AgentResult {
  // 标识
  taskId: string;
  agentType: string;
  
  // 状态
  status: 'success' | 'partial' | 'failed';
  
  // 产物
  artifacts: Artifact[];         // 统一产物格式
  
  // 执行过程
  executionLog: ExecutionStep[]; // 统一执行日志
  
  // 元数据
  metadata: {
    duration: number;
    tokenUsage: { input: number; output: number };
    cost?: number;
  };
  
  // 下一步建议
  nextActions?: SuggestedAction[];
}
```

### 3. 授权协议（Permission Protocol）

```typescript
// 所有Agent使用统一的权限声明
interface AgentPermissionSpec {
  agentType: string;
  
  // 必需权限
  required: PermissionRequirement[];
  
  // 可选权限
  optional?: PermissionRequirement[];
  
  // 数据处理声明
  dataHandling: {
    localProcessing: boolean;    // 是否本地处理
    cloudUpload: boolean;        // 是否上传云端
    dataRetention: string;       // 数据保留策略
  };
}
```

## 四、Agent适配层

```typescript
// 新Agent只需实现适配器接口
interface AgentAdapter {
  // 能力声明
  capability: AgentCapability;
  
  // 权限声明
  permissions: AgentPermissionSpec;
  
  // 执行
  execute(input: AgentInput): Promise<AgentResult>;
  
  // 流式输出（可选）
  streamExecute?(input: AgentInput): AsyncGenerator<StreamChunk>;
  
  // 产物预览（可选，如果需要特殊渲染）
  renderPreview?(artifact: Artifact): Vue.VNode;
}

// 注册新Agent只需几行代码
agentRegistry.register({
  capability: {
    agentType: 'code-review',
    displayName: '代码审查',
    acceptedInputs: { fileTypes: ['.ts', '.js', '.py'], textInput: true },
    outputTypes: ['document'],
    commands: ['/review', '/code-review'],
  },
  permissions: {
    required: [{ type: 'file-read', target: 'selected' }],
  },
  execute: async (input) => { /* ... */ },
});
```

## 五、新Agent接入流程

```
┌──────────────────────────────────────────────────────────────────┐
│  新Agent接入清单（理想情况 < 1天完成）                             │
├──────────────────────────────────────────────────────────────────┤
│                                                                  │
│  ✅ 1. 实现AgentAdapter接口（execute + streamExecute）           │
│  ✅ 2. 声明AgentCapability（接受什么输入，产出什么产物）           │
│  ✅ 3. 声明AgentPermissionSpec（需要什么权限）                    │
│  ✅ 4. （可选）实现自定义产物预览渲染器                            │
│  ✅ 5. 注册到agentRegistry                                       │
│                                                                  │
│  不需要做的事：                                                   │
│  ❌ 不需要写新的输入框                                            │
│  ❌ 不需要写新的任务中心                                          │
│  ❌ 不需要写新的产物面板                                          │
│  ❌ 不需要写新的权限管理页面                                       │
│  ❌ 不需要写新的通知系统                                          │
│  ❌ 不需要写新的回放页                                            │
│                                                                  │
└──────────────────────────────────────────────────────────────────┘
```

## 六、常见坑

- **每个Agent一套工作台**：UI代码膨胀，新Agent接入成本高
- **协议不统一**：每个Agent定义自己的输入输出格式，平台层无法复用
- **差异散落在平台层**：Agent的特殊逻辑侵入共用组件，if-else越来越多
- **没有能力描述**：用户不知道新Agent能做什么、接受什么输入

## 记忆要点

- 坚决反模式：拒绝一Agent一套UI，避免重复造轮子导致维护成本呈指数级增长。
- 平台加插件架构：抽象统一输入、任务中心、产物面板作为平台底座，各Agent作为适配层接入。
- 统一三大协议：通过标准化的输入、结果、授权协议，实现底层与具体Agent的解耦。
- 配置化扩展：新增Agent只需编写配置文件描述其输入约束和产物渲染器，前端零侵入。

