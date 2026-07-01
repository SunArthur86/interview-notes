---
id: note-mk-007
difficulty: L3
category: ai
subcategory: 桌面AI产品
tags:
- 月之暗面
- 面经
- AI-Native
- 输入系统
- 命令模式
feynman:
  essence: 命令式输入适合高频老用户（快速、精确），自然语言适合探索和复杂请求（灵活、低门槛）。两类输入都映射到同一任务模型，命令模式的参数缺失就地补全，历史记录能按两种方式回放。
  analogy: 就像使用Photoshop——专业用户用快捷键（命令式）秒操作，新手用菜单和搜索（自然语言）慢慢找。两种方式最终都触发同一个功能，但入口不同。
  first_principle: 人机交互的效率与灵活性存在权衡。命令式交互效率高但学习成本高，自然语言交互灵活但模糊且慢。AI-Native桌面产品同时服务两类用户，需要在同一输入层支持两种模式并统一到任务模型。
  key_points:
  - 命令式输入适合高频老用户，自然语言适合探索和复杂请求
  - 两类输入都映射到同一任务模型
  - 命令模式的参数缺失要就地补全
  - 历史记录能按命令和自然语言两种方式回放
first_principle:
  essence: 输入路由统一化
  derivation: 用户有两种输入习惯→命令式(/generate)和自然语言(帮我生成)→如果走两套系统会产生维护和一致性问题→统一映射到Task模型→差异在解析层处理
  conclusion: 输入层是路由器而非处理器——所有输入最终都变成Task对象，只是解析路径不同
follow_up:
- 如果桌面端要接文件、网页和本地目录，你先画哪套权限边界？
- 这个产品要接入更多Agent能力时，哪层架构最不能乱？
memory_points:
- 双轨定位：命令式主打高确定性与极速，自然语言主打低门槛与意图探索
- 统一入口路由：输入框接收指令，由路由器根据前缀分流至不同解析引擎
- 殊途同归：无论是正则提取还是AI推断，最终都需归一化为标准的Task对象
---

# 【月之暗面面经】如果产品要支持命令式输入和自然语言输入并存，前端会怎么做？

## 一、两种输入模式的定位

| 维度 | 命令式输入 | 自然语言输入 |
|------|-----------|------------|
| 典型用户 | 高频老用户、技术用户 | 新用户、非技术用户 |
| 典型场景 | "快速做一件事" | "探索性请求" |
| 效率 | 极高（精确、无歧义） | 中等（需要AI理解意图） |
| 示例 | `/gen-site --template=portfolio --src=./assets` | "用我assets文件夹里的内容做一个个人作品集网站" |
| 参数补全 | 有参数提示和自动补全 | AI自动推断参数 |
| 确定性 | 高（固定语法） | 中（AI可能误解） |

## 二、统一输入架构

```
┌──────────────────────────────────────────────────────────────────┐
│                       统一输入框                                  │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │ > /gen-site --template=portfolio  or  帮我做一个网站...   │   │
│  └──────────────────────────────────────────────────────────┘   │
│  命令补全提示 / 自然语言理解提示                                   │
├──────────────────────────────────────────────────────────────────┤
│                                                                  │
│                     输入路由器（Router）                          │
│                   ┌───────┴───────┐                              │
│                   │               │                              │
│              命令解析器        自然语言解析器                       │
│              (Command          (NLU
│               Parser)           Parser)                          │
│                   │               │                              │
│                   └───────┬───────┘                              │
│                           │                                      │
│                      Task 对象                                    │
│                  (统一的任务模型)                                  │
│                           │                                      │
│                    任务执行引擎                                    │
└──────────────────────────────────────────────────────────────────┘
```

## 三、输入路由器实现

```typescript
class InputRouter {
  parse(rawInput: string): ParsedInput {
    const trimmed = rawInput.trim();
    
    // 检测是否为命令式输入（以 / 开头）
    if (trimmed.startsWith('/')) {
      return this.parseCommand(trimmed);
    }
    
    // 检测是否为快捷命令（:开头，如 :site, :ppt）
    if (trimmed.startsWith(':')) {
      return this.parseQuickCommand(trimmed);
    }
    
    // 否则走自然语言解析
    return this.parseNaturalLanguage(trimmed);
  }
  
  // 命令解析
  private parseCommand(input: string): CommandInput {
    const tokens = this.tokenize(input);
    const cmd = tokens[0].slice(1);  // 去掉 /
    const args = this.parseArgs(tokens.slice(1));
    
    return {
      type: 'command',
      command: cmd,         // 'gen-site'
      args: args,           // { template: 'portfolio', src: './assets' }
      raw: input,
    };
  }
  
  // 自然语言解析
  private async parseNaturalLanguage(input: string): Promise<NLInput> {
    // 使用LLM将自然语言转为结构化任务
    const intent = await llm.parseIntent(input);
    
    return {
      type: 'natural',
      intent: intent.action,      // 'gen-site'
      params: intent.params,      // { template: 'portfolio' }
      confidence: intent.score,   // 0.85
      raw: input,
    };
  }
}

// 统一转为 Task 对象
function toTask(parsed: ParsedInput): Task {
  return {
    id: generateId(),
    action: parsed.command || parsed.intent,
    params: parsed.args || parsed.params,
    inputMode: parsed.type,   // 记录来源模式
    raw: parsed.raw,
    status: 'queued',
  };
}
```

## 四、命令补全系统

```
┌──────────────────────────────────────────────────────────────────┐
│  输入框                                                           │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │ /gen-s                          ▼                        │   │
│  └──────────────────────────────────────────────────────────┘   │
│                                                                  │
│  命令建议：                                                      │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │ /gen-site    生成网站       站点/PPT/表格                  │   │
│  │ /gen-sheet   生成表格       数据分析/报表                  │   │
│  │ /gen-ppt     生成PPT        演示文稿/汇报                  │   │
│  └──────────────────────────────────────────────────────────┘   │
│                                                                  │
│  ─ 用户选中 /gen-site 后 ─                                       │
│                                                                  │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │ /gen-site --template=               │                    │   │
│  └─────────────────────────────────────┘                    │   │
│                                                                  │
│  参数补全：                                                      │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │ --template=  portfolio | dashboard | blog | landing      │   │
│  │ --src=       [拖入文件或目录]                              │   │
│  │ --style=     modern | minimal | corporate                │   │
│  │ --output=    [选择导出路径]                                │   │
│  └──────────────────────────────────────────────────────────┘   │
│                                                                  │
│  参数缺失提示：                                                   │
│  ⚠️ --src 参数缺失。请拖入文件或输入路径。                       │
│  💡 也可以用自然语言："用assets文件夹做一个portfolio网站"         │
└──────────────────────────────────────────────────────────────────┘
```

## 五、就地参数补全

```typescript
// 当命令缺少必要参数时，就地补全而非报错
async function validateAndFill(command: CommandInput): Promise<Task | null> {
  const spec = commandRegistry.get(command.command);
  const missingParams = spec.required.filter(p => !(p in command.args));
  
  if (missingParams.length === 0) {
    return toTask(command);  // 参数完整，直接执行
  }
  
  // 参数缺失——就地补全
  for (const param of missingParams) {
    if (param === 'src') {
      // 文件类参数：弹出文件选择器
      const path = await showFilePicker(param.description);
      if (path) command.args[param.name] = path;
    } else if (param === 'template') {
      // 枚举类参数：弹出选择器
      const value = await showOptionPicker(param.options);
      if (value) command.args[param.name] = value;
    } else {
      // 文本类参数：在输入框就地提示
      promptInInput(`请输入 ${param.name}: ${param.description}`);
      return null;  // 等待用户补全
    }
  }
  
  return toTask(command);
}
```

## 六、历史记录双模式回放

```typescript
// 历史记录同时存储命令格式和自然语言格式
interface HistoryEntry {
  taskId: string;
  timestamp: number;
  command?: string;        // "/gen-site --template=portfolio --src=./assets"
  naturalLanguage?: string; // "用assets做一个portfolio网站"
  task: Task;
}

// 用户可以切换历史记录的显示方式
// 模式1：命令模式（适合老用户快速复用）
/history →
  /gen-site --template=portfolio --src=./assets
  /gen-ppt --src=./report.md
  /analyze --target=./src --type=code-review

// 模式2：自然语言模式（适合回顾和理解）
/history →
  "用assets做一个portfolio网站"
  "把report.md转成PPT"
  "分析src目录的代码质量"

// 用户可以一键将历史记录转为命令再执行
```

## 七、常见坑

- **两套输入走两套系统**：命令式和自然语言各自独立处理，导致功能不一致
- **命令参数报错不引导**：缺少参数直接报错退出，不提供补全路径
- **历史记录只存一种格式**：老用户看不到命令格式，新用户看不懂命令
- **没有命令发现机制**：用户不知道有哪些命令可用，没有 `/help` 或补全

## 记忆要点

- 双轨定位：命令式主打高确定性与极速，自然语言主打低门槛与意图探索
- 统一入口路由：输入框接收指令，由路由器根据前缀分流至不同解析引擎
- 殊途同归：无论是正则提取还是AI推断，最终都需归一化为标准的Task对象

