---
id: note-ms-015
difficulty: L4
category: frontend
subcategory: AI-Native桌面
tags:
- 月之暗面
- 面经
- 文件上下文
- 错误检测
- 前端验证
feynman:
  essence: 前端做三层校验：格式校验(类型对不对)→内容校验(数据对不对)→语义校验(跟任务相关吗)，尽早拦截错误输入。
  analogy: 就像机场安检——先查证件格式(格式校验)，再查行李有没有违禁品(内容校验)，最后看登机口对不对(语义校验)。
  first_principle: 输入校验 = 格式 × 内容 × 语义三层渐进式过滤。
  key_points:
  - '格式校验: 文件类型/大小/编码'
  - '内容校验: 空文件/损坏/格式错误'
  - '语义校验: 跟当前任务相关性预判'
  - '提示方式: 不阻塞但明显提示用户确认'
first_principle:
  essence: 垃圾进垃圾出(GIGO) prevention
  derivation: 错误文件→AI处理→错误结果→浪费成本→前端校验→尽早拦截→省时间省钱
follow_up:
- 语义校验怎么实现？用小模型预判吗？
- 用户坚持用错误文件怎么办？
- 校验规则的配置化管理？
memory_points:
- 核心策略快速失败：在前端尽早拦截错误，避免浪费后端算力和用户时间
- 三层校验架构：L1格式（硬拒绝）、L2内容（强提示）、L3语义（软提示）
- L1查类型大小、L2查可读结构、L3用轻量模型比对任务相关性
- 校验管道化：各层规则独立，支持异步串联执行并聚合反馈结果
---

# 【月之暗面面经】如果用户给了错误的文件上下文，前端怎样尽早发现并提示？

## 一、问题背景

在 AI 桌面应用中，用户经常上传文件作为 AI 处理的上下文。但用户可能上传错误文件：上传了 PDF 却要求解析 Excel、上传了空文件、上传了英文报告却要求中文摘要、上传了去年的数据做今年的分析……

如果不做前端校验，错误文件一路传递到后端 AI 服务，结果是：**浪费 Token 成本 + 浪费用户等待时间 + 产出错误结果 + 用户失去信任**。这就是经典的 GIGO（Garbage In, Garbage Out）问题。

核心理念是**快速失败（Fail Fast）**——在前端尽早拦截，不浪费后端资源。但要平衡用户体验：**不是硬性拦截**，而是充分提示后让用户决定是否继续。

## 二、三层校验架构总览

```
用户上传文件
      │
      ▼
┌─────────────────────────────────────────────────┐
│           Layer 1: 格式校验 (Format)              │
│  "这个文件的类型/大小/编码对不对？"                 │
│  策略: 硬拦截——格式都不对，直接拒绝                │
│  耗时: <10ms                                     │
└──────────────────────┬──────────────────────────┘
                       │ ✓ 通过
                       ▼
┌─────────────────────────────────────────────────┐
│           Layer 2: 内容校验 (Content)             │
│  "文件内容是否完整、可读、符合预期？"               │
│  策略: 硬拦截或强提示——内容有问题，需要确认         │
│  耗时: 50-500ms                                 │
└──────────────────────┬──────────────────────────┘
                       │ ✓ 通过
                       ▼
┌─────────────────────────────────────────────────┐
│           Layer 3: 语义校验 (Semantic)            │
│  "这个文件跟当前任务相关吗？"                      │
│  策略: 软提示——"看起来不太相关，确定要用吗？"      │
│  耗时: 200-2000ms（可异步）                      │
└──────────────────────┬──────────────────────────┘
                       │ ✓ 通过/用户确认
                       ▼
              文件进入AI处理流程
```

| 层级 | 校验内容 | 策略 | 用户感知 |
|------|---------|------|---------|
| L1 格式 | 类型、大小、编码 | 硬拒绝 | 立即报错，不让上传 |
| L2 内容 | 完整性、可读性、结构 | 硬拒绝/强确认 | 明显警告，需用户确认 |
| L3 语义 | 任务相关性、语言匹配 | 软提示 | 温和提示，可忽略继续 |

## 三、校验 Pipeline 完整实现

### 3.1 核心数据结构与类型

```typescript
// 校验结果
interface ValidationResult {
  passed: boolean;
  level: ValidationLevel;
  errors: ValidationError[];
  warnings: ValidationWarning[];
  metadata?: Record<string, unknown>;  // 附加信息
}

interface ValidationError {
  code: string;                // 'FILE_TOO_LARGE'
  message: string;             // 用户可读的消息
  field?: string;              // 出错字段
  severity: 'fatal' | 'error' | 'warning' | 'info';
  details?: unknown;
}

type ValidationLevel = 'format' | 'content' | 'semantic';

// 校验规则接口
interface ValidationRule<T = unknown> {
  id: string;
  level: ValidationLevel;
  validate(context: ValidationContext): ValidationResult | Promise<ValidationResult>;
}

// 校验上下文
interface ValidationContext {
  file: File;                    // 浏览器File对象
  taskType: TaskType;            // 当前任务类型
  taskDescription?: string;      // 任务描述（语义校验用）
  fileMeta?: FileMetadata;       // 预解析的文件元信息
}

type TaskType =
  | 'summarize'    // 文档摘要
  | 'translate'    // 翻译
  | 'analyze'      // 数据分析
  | 'generate'     // 内容生成
  | 'code-review'  // 代码审查
  | 'custom';      // 自定义任务

interface FileMetadata {
  mimeType: string;
  extension: string;
  size: number;
  encoding?: string;
  preview?: string;             // 前500字符预览
}
```

### 3.2 Pipeline 引擎实现

```typescript
class FileValidationPipeline {
  private rules: ValidationRule[] = [];

  // 注册校验规则
  register(rule: ValidationRule): void {
    this.rules.push(rule);
  }

  // 批量注册
  registerAll(rules: ValidationRule[]): void {
    rules.forEach(r => this.register(r));
  }

  // 执行校验——逐层执行，前一层不过则不执行下一层
  async validate(ctx: ValidationContext): Promise<ValidationResult> {
    const allErrors: ValidationError[] = [];
    const allWarnings: ValidationWarning[] = [];

    // 按level分组
    const levels: ValidationLevel[] = ['format', 'content', 'semantic'];

    for (const level of levels) {
      const levelRules = this.rules.filter(r => r.level === level);

      // 执行该层所有规则
      const results = await Promise.all(
        levelRules.map(rule => this.runRule(rule, ctx))
      );

      for (const result of results) {
        allErrors.push(...result.errors);
        allWarnings.push(...result.warnings);

        // L1/L2有fatal或error → 硬阻断，不再继续下层校验
        const hasFatal = result.errors.some(e =>
          e.severity === 'fatal' || e.severity === 'error'
        );
        if (hasFatal && level !== 'semantic') {
          return {
            passed: false,
            level,
            errors: allErrors,
            warnings: allWarnings,
          };
        }
      }
    }

    return {
      passed: allErrors.length === 0,
      level: 'semantic',
      errors: allErrors,
      warnings: allWarnings,
    };
  }

  private async runRule(
    rule: ValidationRule,
    ctx: ValidationContext
  ): Promise<ValidationResult> {
    try {
      return await rule.validate(ctx);
    } catch (err) {
      return {
        passed: false,
        level: rule.level,
        errors: [{
          code: 'RULE_EXECUTION_ERROR',
          message: `校验规则 ${rule.id} 执行异常: ${err}`,
          severity: 'warning',
        }],
        warnings: [],
      };
    }
  }
}
```

### 3.3 Layer 1: 格式校验规则

```typescript
// === L1 格式校验规则 ===

// 1. 文件类型校验
class FileTypeRule implements ValidationRule {
  id = 'format.file-type';
  level: ValidationLevel = 'format';

  // 任务类型→允许的文件类型映射
  private allowedTypes: Record<TaskType, string[]> = {
    summarize:  ['application/pdf', 'text/plain', 'text/markdown',
                 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
    translate:  ['application/pdf', 'text/plain', 'text/markdown'],
    analyze:    ['text/csv', 'application/vnd.ms-excel',
                 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'],
    'code-review': ['text/plain', 'text/javascript', 'text/x-python', 'text/x-typescript'],
    generate:   ['application/pdf', 'text/plain', 'text/markdown'],
    custom:     [],  // 不限制
  };

  validate(ctx: ValidationContext): ValidationResult {
    const allowed = this.allowedTypes[ctx.taskType];
    if (allowed.length === 0) return { passed: true, level: 'format', errors: [], warnings: [] };

    // 优先用MIME类型判断，fallback用扩展名
    const isAllowed = allowed.includes(ctx.file.type) ||
      allowed.some(type => ctx.file.name.endsWith(type.split('/')[1]));

    if (!isAllowed) {
      return {
        passed: false,
        level: 'format',
        errors: [{
          code: 'FILE_TYPE_MISMATCH',
          message: `当前任务"${this.getTaskLabel(ctx.taskType)}"不支持 ${ctx.file.type || '未知'} 格式的文件。支持的格式：${this.formatAllowedTypes(allowed)}`,
          severity: 'fatal',
        }],
        warnings: [],
      };
    }

    return { passed: true, level: 'format', errors: [], warnings: [] };
  }

  private getTaskLabel(type: TaskType): string {
    return { summarize: '摘要', translate: '翻译', analyze: '数据分析',
             'code-review': '代码审查', generate: '生成', custom: '自定义' }[type];
  }

  private formatAllowedTypes(types: string[]): string {
    return types.map(t => t.split('/').pop()).join('、');
  }
}

// 2. 文件大小校验
class FileSizeRule implements ValidationRule {
  id = 'format.file-size';
  level: ValidationLevel = 'format';

  private limits = {
    maxFileSize: 50 * 1024 * 1024,    // 50MB
    warnSize: 10 * 1024 * 1024,       // 10MB以上警告
  };

  validate(ctx: ValidationContext): ValidationResult {
    const size = ctx.file.size;

    if (size > this.limits.maxFileSize) {
      return {
        passed: false,
        level: 'format',
        errors: [{
          code: 'FILE_TOO_LARGE',
          message: `文件大小 ${(size / 1024 / 1024).toFixed(1)}MB 超过限制 ${this.limits.maxFileSize / 1024 / 1024}MB`,
          severity: 'fatal',
        }],
        warnings: [],
      };
    }

    if (size > this.limits.warnSize) {
      return {
        passed: true,
        level: 'format',
        errors: [],
        warnings: [{
          code: 'LARGE_FILE_WARNING',
          message: `文件较大 (${(size / 1024 / 1024).toFixed(1)}MB)，处理时间可能较长`,
        }],
      };
    }

    return { passed: true, level: 'format', errors: [], warnings: [] };
  }
}

// 3. 空文件校验
class EmptyFileRule implements ValidationRule {
  id = 'format.empty-file';
  level: ValidationLevel = 'format';

  validate(ctx: ValidationContext): ValidationResult {
    if (ctx.file.size === 0) {
      return {
        passed: false,
        level: 'format',
        errors: [{
          code: 'EMPTY_FILE',
          message: '文件为空，无法处理',
          severity: 'fatal',
        }],
        warnings: [],
      };
    }
    return { passed: true, level: 'format', errors: [], warnings: [] };
  }
}
```

### 3.4 Layer 2: 内容校验规则

```typescript
// === L2 内容校验规则 ===

// 1. 文件内容完整性校验（能被正确解析吗？）
class FileIntegrityRule implements ValidationRule {
  id = 'content.integrity';
  level: ValidationLevel = 'content';

  async validate(ctx: ValidationContext): Promise<ValidationResult> {
    const { file } = ctx;

    // CSV/Excel：尝试解析头部
    if (file.type === 'text/csv') {
      try {
        const text = await file.slice(0, 2048).text();
        const lines = text.split('\n').filter(l => l.trim());
        if (lines.length === 0) {
          return this.error('EMPTY_CONTENT', 'CSV文件没有数据行');
        }
        // 检查分隔符一致性
        const firstLineCommas = (lines[0].match(/,/g) || []).length;
        const hasInconsistentDelimiter = lines.some(line =>
          Math.abs((line.match(/,/g) || []).length - firstLineCommas) > 2
        );
        if (hasInconsistentDelimiter) {
          return this.error('MALFORMED_CSV', 'CSV格式异常：列数不一致');
        }
      } catch {
        return this.error('PARSE_ERROR', '文件解析失败，可能已损坏');
      }
    }

    // PDF：读取魔数验证
    if (file.type === 'application/pdf') {
      const header = await file.slice(0, 5).text();
      if (!header.startsWith('%PDF')) {
        return this.error('CORRUPT_PDF', 'PDF文件已损坏或不是有效的PDF');
      }
    }

    // 图片：验证是否能正确解码
    if (file.type.startsWith('image/')) {
      try {
        const bitmap = await createImageBitmap(file);
        bitmap.close();
      } catch {
        return this.error('CORRUPT_IMAGE', '图片文件已损坏或格式不正确');
      }
    }

    return { passed: true, level: 'content', errors: [], warnings: [] };
  }

  private error(code: string, message: string): ValidationResult {
    return {
      passed: false,
      level: 'content',
      errors: [{ code, message, severity: 'error' }],
      warnings: [],
    };
  }
}

// 2. 文本可读性校验
class TextReadabilityRule implements ValidationRule {
  id = 'content.readability';
  level: ValidationLevel = 'content';

  async validate(ctx: ValidationContext): Promise<ValidationResult> {
    if (!ctx.file.type.startsWith('text/')) {
      return { passed: true, level: 'content', errors: [], warnings: [] };
    }

    const text = await file.slice(0, 5000).text();
    const warnings: ValidationWarning[] = [];

    // 检测是否是乱码（编码错误）
    const garbageRatio = this.detectGarbageText(text);
    if (garbageRatio > 0.3) {
      return {
        passed: false,
        level: 'content',
        errors: [{
          code: 'ENCODING_ERROR',
          message: '文件可能存在编码问题，显示为乱码。请确认文件编码为 UTF-8。',
          severity: 'error',
        }],
        warnings: [],
      };
    }

    // 检测文本是否过短（可能没有足够内容）
    const charCount = text.length;
    if (charCount < 50) {
      warnings.push({
        code: 'CONTENT_TOO_SHORT',
        message: '文件内容较少，AI 可能难以提取有效信息',
      });
    }

    return {
      passed: true,
      level: 'content',
      errors: [],
      warnings,
    };
  }

  private detectGarbageText(text: string): number {
    // 检测不可打印字符的比例
    const unprintable = text.split('').filter(c => {
      const code = c.charCodeAt(0);
      return code < 32 && code !== 9 && code !== 10 && code !== 13;
    }).length;
    return text.length > 0 ? unprintable / text.length : 0;
  }
}
```

### 3.5 Layer 3: 语义校验规则

```typescript
// === L3 语义校验规则 ===

// 1. 语言匹配校验（任务语言 vs 文件语言）
class LanguageMatchRule implements ValidationRule {
  id = 'semantic.language';
  level: ValidationLevel = 'semantic';

  async validate(ctx: ValidationContext): Promise<ValidationResult> {
    const text = await ctx.file.slice(0, 5000).text();
    if (!text) return { passed: true, level: 'semantic', errors: [], warnings: [] };

    // 轻量级语言检测（前端实现，非AI）
    const detectedLang = this.detectLanguage(text);
    const taskLang = this.inferTaskLanguage(ctx.taskType, ctx.taskDescription);

    if (detectedLang !== taskLang && detectedLang !== 'unknown') {
      return {
        passed: true,  // 语义层不硬拦截
        level: 'semantic',
        errors: [],
        warnings: [{
          code: 'LANGUAGE_MISMATCH',
          message: `当前任务是${taskLang === 'zh' ? '中文' : '英文'}处理，但文件看起来是${detectedLang === 'zh' ? '中文' : '英文'}内容。确定要继续吗？`,
        }],
      };
    }

    return { passed: true, level: 'semantic', errors: [], warnings: [] };
  }

  // 简易语言检测：统计中英文字符比例
  private detectLanguage(text: string): string {
    const chineseChars = (text.match(/[\u4e00-\u9fff]/g) || []).length;
    const englishChars = (text.match(/[a-zA-Z]/g) || []).length;
    if (chineseChars > englishChars * 0.5) return 'zh';
    if (englishChars > chineseChars * 2) return 'en';
    return 'unknown';
  }

  private inferTaskLanguage(taskType: TaskType, desc?: string): string {
    if (!desc) return 'zh';  // 默认中文
    // 从任务描述推断预期语言
    if (/英文|English|translate to English/i.test(desc)) return 'en';
    return 'zh';
  }
}

// 2. 任务相关性校验（文件内容是否匹配任务类型）
class TaskRelevanceRule implements ValidationRule {
  id = 'semantic.relevance';
  level: ValidationLevel = 'semantic';

  async validate(ctx: ValidationContext): Promise<ValidationResult> {
    const text = await ctx.file.slice(0, 5000).text();
    if (!text || text.length < 100) {
      return { passed: true, level: 'semantic', errors: [], warnings: [] };
    }

    const warnings: ValidationWarning[] = [];

    // 基于规则的相关性预判
    switch (ctx.taskType) {
      case 'analyze':
        // 数据分析任务 → 检测文件是否包含表格/数字数据
        if (!this.looksLikeData(text)) {
          warnings.push({
            code: 'NOT_DATA_FILE',
            message: '当前是数据分析任务，但文件内容看起来不像结构化数据（表格/数字）。确定文件正确吗？',
          });
        }
        break;

      case 'code-review':
        // 代码审查 → 检测是否包含代码特征
        if (!this.looksLikeCode(text)) {
          warnings.push({
            code: 'NOT_CODE_FILE',
            message: '当前是代码审查任务，但文件内容看起来不像代码。确定文件正确吗？',
          });
        }
        break;

      case 'summarize':
        // 摘要任务 → 检测文本长度
        const sentences = text.split(/[。.!？?\n]/).filter(s => s.trim().length > 5);
        if (sentences.length < 3) {
          warnings.push({
            code: 'CONTENT_TOO_BRIEF',
            message: '文件内容较短，可能不需要摘要。确定要继续吗？',
          });
        }
        break;
    }

    return { passed: true, level: 'semantic', errors: [], warnings };
  }

  private looksLikeData(text: string): boolean {
    // 检测CSV/TSV/JSON特征
    const lines = text.split('\n').slice(0, 10);
    const hasDelimiters = lines.some(l => /[,\t|;]\s*\d/.test(l));
    const hasNumbers = lines.filter(l => /\d/.test(l)).length > lines.length * 0.5;
    const isJson = text.trimStart().startsWith('{') || text.trimStart().startsWith('[');
    return hasDelimiters || hasNumbers || isJson;
  }

  private looksLikeCode(text: string): boolean {
    const codePatterns = [
      /function\s+\w+/i, /def\s+\w+/i, /class\s+\w+/i,
      /import\s+/i, /const\s+\w+\s*=/i, /let\s+\w+\s*=/i,
      /\{[^}]*\}/, /<\/?\w+>/, /print\s*\(/, /console\.log/,
    ];
    const matches = codePatterns.filter(p => p.test(text)).length;
    return matches >= 2;
  }
}
```

### 3.6 Pipeline 组装与使用

```typescript
// 组装Pipeline
function createPipeline(): FileValidationPipeline {
  const pipeline = new FileValidationPipeline();

  // L1 格式层
  pipeline.registerAll([
    new EmptyFileRule(),
    new FileTypeRule(),
    new FileSizeRule(),
  ]);

  // L2 内容层
  pipeline.registerAll([
    new FileIntegrityRule(),
    new TextReadabilityRule(),
  ]);

  // L3 语义层
  pipeline.registerAll([
    new LanguageMatchRule(),
    new TaskRelevanceRule(),
  ]);

  return pipeline;
}

// 使用
const pipeline = createPipeline();

async function handleFileUpload(file: File, taskType: TaskType) {
  const ctx: ValidationContext = {
    file,
    taskType,
    taskDescription: currentTaskInput.value,
  };

  const result = await pipeline.validate(ctx);

  if (!result.passed) {
    // 有硬错误——直接拦截
    showErrorDialog(result.errors[0].message);
    return;
  }

  // 有警告——提示用户确认
  if (result.warnings.length > 0) {
    const confirmed = await showWarningDialog({
      title: '文件可能存在以下问题',
      items: result.warnings.map(w => w.message),
      confirmLabel: '仍然使用',
      cancelLabel: '更换文件',
    });
    if (!confirmed) return;
  }

  // 校验通过，提交给AI
  submitToAI(file, taskType);
}
```

### 3.7 UI 提示组件设计

```tsx
// 不阻塞的温和提示组件
function FileValidationBanner({ result }: { result: ValidationResult }) {
  if (result.passed && result.warnings.length === 0) return null;

  return (
    <div className={`validation-banner ${result.passed ? 'warning' : 'error'}`}>
      {/* 错误列表 */}
      {result.errors.map(err => (
        <div key={err.code} className="validation-item error">
          <Icon name="error-circle" />
          <span>{err.message}</span>
        </div>
      ))}

      {/* 警告列表——可忽略 */}
      {result.warnings.map(warn => (
        <div key={warn.code} className="validation-item warning">
          <Icon name="warning-triangle" />
          <span>{warn.message}</span>
          <Button size="small" variant="text">
            忽略并继续
          </Button>
        </div>
      ))}
    </div>
  );
}
```

## 四、校验规则配置化管理

```typescript
// 校验规则不应该硬编码，而是配置化
// validation.config.json
{
  "rules": {
    "format.file-type": {
      "enabled": true,
      "config": {
        "taskTypeMapping": {
          "summarize": ["pdf", "txt", "md", "docx"],
          "analyze": ["csv", "xlsx", "json"],
          "code-review": ["js", "ts", "py", "java"]
        }
      }
    },
    "format.file-size": {
      "enabled": true,
      "config": {
        "maxSize": "50MB",
        "warnSize": "10MB"
      }
    },
    "semantic.language": {
      "enabled": true,
      "config": {
        "defaultTaskLang": "zh"
      }
    }
  }
}

// 配置加载器
function loadValidationConfig(): Map<string, RuleConfig> {
  const config = fetch('/config/validation.config.json');
  // 按config调整每个规则的参数
}
```

## 五、总结

文件上下文校验的核心是 **三层渐进式过滤 + 快速失败 + 软硬结合的提示策略**：

| 层级 | 核心问题 | 技术手段 | 拦截策略 | 性能 |
|------|---------|---------|---------|------|
| **格式层** | 类型/大小/编码对不对 | MIME 检测、魔数验证、大小比较 | **硬拦截** | <10ms |
| **内容层** | 内容完整/可读吗 | 文件解析尝试、乱码检测、结构检查 | **强确认** | <500ms |
| **语义层** | 跟任务相关吗 | 轻量规则匹配（语言检测、内容特征） | **软提示** | <2000ms |

设计要点：

1. **逐层递进**：前一层不过不执行下一层，避免无意义计算
2. **软硬分离**：L1/L2 是"对不对"的问题（硬拦截），L3 是"该不该"的问题（软提示）
3. **不阻塞但明显**：语义层警告要足够醒目但不强制——尊重用户判断权
4. **配置驱动**：规则可配可关，不同场景灵活适配
5. **Pipeline 可扩展**：新增校验规则只需实现 `ValidationRule` 接口并注册

这套方案的收益是：在文件到达后端 AI 服务之前，前端已经拦截了 80%+ 的明显错误（格式错误、文件损坏、明显不相关），大幅节省了 Token 成本和用户等待时间，同时通过分层提示策略保证了优秀的用户体验——不让用户觉得被"管得太死"。

## 记忆要点

- 核心策略快速失败：在前端尽早拦截错误，避免浪费后端算力和用户时间
- 三层校验架构：L1格式（硬拒绝）、L2内容（强提示）、L3语义（软提示）
- L1查类型大小、L2查可读结构、L3用轻量模型比对任务相关性
- 校验管道化：各层规则独立，支持异步串联执行并聚合反馈结果


## 苏格拉底式面试追问

> 这组追问模拟面试官层层逼问，每一问先回答"为什么"，再回答"怎么做"，最后回答"如何证明"。

### 第一层：目标与动机

**Q：文件校验你做三层（格式/内容/语义），但为什么不只做格式校验（最简单），让 AI 处理其他错误？**

格式校验只解决"文件能不能解析"（如是不是真的 PDF、大小是否超限），解决不了"文件内容是否对"。如用户上传了去年的报告做今年分析，格式是对的（PDF），但语义是错的（时间不对）。如果只格式校验就交给 AI，AI 处理后才发现"数据是去年的"，浪费了 token 成本（一次推理几毛钱）和用户等待时间（几十秒）。三层校验的价值是"渐进式拦截"：格式校验（毫秒级、零成本）拦掉明显错误、内容校验（秒级、低成本）拦掉结构性错误（如空文件、损坏文件）、语义校验（秒级、小模型成本）拦掉语义错误（如时间不对、语言不对）。越早拦截成本越低，符合 Fail Fast 原则。

### 第二层：证据与定位

**Q：用户说"前端没提示错误，但 AI 处理结果不对"，你怎么定位是校验漏检还是 AI 处理 bug？**

分段定位：一、校验日志——查该文件的三层校验结果（格式/内容/语义是否通过），如果都通过，校验没拦截（可能是校验规则不全）；二、AI 处理日志——查 AI 的推理过程和输出，看是否有异常（如 AI 提示"数据格式不符"但前端没拦截）；三、对比验证——用其他工具（如手动打开文件）确认文件是否真的有问题。常见根因：一、语义校验规则不全——如只校验了文件类型和大小，没校验"时间相关性"（文件是去年的但要求今年分析），漏检；二、校验通过但 AI 幻觉——文件是对的，但 AI 处理时理解错（幻觉），这是 AI 质量问题非校验问题。修复：扩展语义校验规则（基于用户反馈补充），AI 幻觉靠模型优化或 prompt 调整。

### 第三层：根因深挖

**Q：语义校验你用轻量模型（如小 BERT）判断"文件与任务的相关性"，但小模型准确率不够（误报/漏报多），怎么平衡？**

小模型语义校验的准确率问题：误报（正确的文件被标记为"可能错误"，用户困扰）、漏报（错误文件没被拦截，校验失效）。平衡手段：一、校验作为"软提示"而非"硬拦截"——语义校验的提示是软的（"这个文件看起来与任务不太相关，确定继续吗？"），用户可忽略继续，避免误报阻断正常流程；二、置信度展示——校验结果带置信度（如"相关性低，置信度 70%"），让用户判断；三、反馈闭环——用户对校验结果反馈（如点"这个提示不对"），收集反馈数据微调小模型，提升准确率；四、只校验高风险场景——如"分析 2024 数据"但文件是 2023 的（明显时间错配），这种高置信度的错误才提示，低置信度的不打扰。核心："语义校验是辅助提示非硬拦截，靠置信度和用户反馈迭代，不追求 100% 准确"。

**Q：那为什么不直接用大模型（如 GPT-4）做语义校验，准确率更高？**

大模型校验的成本问题：一、延迟——大模型调用秒级，每次上传文件都校验，用户等待感差；二、成本——大模型每次调用几毛钱，高频上传成本高；三、过度——大多数文件是正确的（如 90%），用大模型校验所有文件是"用大炮打蚊子"。小模型的优势：毫秒级延迟、低成本、对"明显错误"（如时间错配、语言不符）足够准确。大模型用于"复杂语义判断"（如判断文件内容是否与任务深度相关），但这种场景少。所以"小模型为主（快速、低成本、覆盖明显错误）、大模型为辅（复杂场景、用户主动触发）"，成本和准确率兼顾。类似多模态提取的策略（ms-004 的 OCR 为主、多模态为辅）。

### 第四层：方案权衡

**Q：用户坚持用错误文件（前端提示了"可能错误"但用户要点继续），你硬拦截还是放行？**

放行。核心理由：一、用户主权——用户是最终决策者，AI 是辅助工具，用户有权用自己的文件（即使 AI 认为是错的）；二、可能用户是对的——AI 的语义校验可能误判（如用户确实想用去年数据做对比分析，但 AI 认为时间错配），硬拦截会阻碍合理需求；三、信任——硬拦截让用户觉得"AI 管太多"，降低信任。所以校验是"充分提示，用户决定"：一、软提示——显示"文件可能与任务不匹配（原因：...），确定继续？"，用户点"继续"则放行；二、记录——用户坚持继续的操作记录日志，用于后续分析（是真合理需求还是误判）；三、事后降级——如果 AI 处理后确实结果不好（如时间不对导致分析无意义），提示"可能是因为文件不匹配，建议更换"，这是事后兜底而非事前拦截。

**Q：为什么不把校验规则硬编码（如"PDF 文件大小 < 50MB"），而要配置化管理（用户可调整规则）？**

硬编码的问题：一、不灵活——不同用户场景不同（如企业用户的大数据文件可能 > 50MB，个人用户的小文件 < 5MB），硬编码的统一规则不适合所有用户；二、更新成本高——规则改了要重新发版（桌面应用更新慢），用户等不及；三、无法个性化——用户可能有特殊需求（如"我要上传 100MB 的 PDF，请放宽限制"），硬编码无法满足。配置化管理：一、规则存储在配置文件（如 JSON），用户可编辑（如调整大小限制）；二、默认规则 + 用户覆盖——默认规则适合大多数用户，特殊用户可覆盖；三、动态更新——规则配置可从云端拉取（用户无感更新），不需发版。所以配置化管理是"灵活性 + 可个性化 + 动态更新"，适合多样化的用户需求。

### 第五层：验证与沉淀

**Q：你怎么验证三层校验真的减少了错误文件上传（而非只是提示了用户）？**

核心指标是"错误文件拦截率"和"用户继续率"。一、错误文件拦截率——统计"校验提示可能错误的文件中，用户最终放弃上传的比例"（高说明校验有效）；二、用户继续率——"校验提示后用户坚持继续的比例"（适中说明提示既不过严也不过松，如 20-40% 继续合理，太高说明误报多、太低说明拦太严）；三、AI 处理失败率下降——校验上线后，AI 处理失败（因文件错误）的比例应下降（说明拦截有效）；四、用户满意度——问卷问"文件提示是否有帮助"（应正面）。A/B 测试：有校验 vs 无校验，对比 AI 处理失败率和用户满意度。

**Q：这道题沉淀出什么可复用的文件校验设计经验？**

四条原则：一、Fail Fast——前端三层校验（格式/内容/语义）尽早拦截错误文件，省 token 成本和用户时间；二、软提示非硬拦截——充分提示但用户决定是否继续，尊重用户主权，避免误报阻断；三、小模型为主、大模型为辅——语义校验用小模型（快、便宜、覆盖明显错误），复杂场景用大模型（用户主动触发）；四、配置化管理——校验规则配置化（可个性化、动态更新），不硬编码。核心洞察："文件校验本质是'GIGO prevention'——借鉴安检的分层过滤（格式=证件、内容=行李、语义=登机口），前端尽早拦截错误，核心是'快速失败 + 软提示 + 用户主权'，平衡拦截效果和用户体验。"


## 结构化回答

**30 秒电梯演讲：** 前端做三层校验：格式校验(类型对不对)→内容校验(数据对不对)→语义校验(跟任务相关吗)，尽早拦截错误输入。打个比方，就像机场安检——先查证件格式(格式校验)，再查行李有没有违禁品(内容校验)，最后看登机口对不对(语义校验)。

**展开框架：**
1. **核心策略快速失败** — 在前端尽早拦截错误，避免浪费后端算力和用户时间
2. **三层校验架构** — L1格式（硬拒绝）、L2内容（强提示）、L3语义（软提示）
3. **L1查类型大小** — L1查类型大小、L2查可读结构、L3用轻量模型比对任务相关性

**收尾：** 这块我踩过坑——要不要深入聊：语义校验怎么实现？用小模型预判吗？

## 视频脚本

> 预计时长：4 分钟 | 由浅入深

| 时间 | 画面/字幕 | 口播台词 | 讲解要点 |
|------|----------|----------|----------|
| 0:00 | 标题卡 | "AI-Native桌面一句话：前端做三层校验：格式校验(类型对不对)→内容校验(数据对不对)→语义校验(跟任务相关吗)…。" | 开场钩子 |
| 0:15 | 架构示意图 | "核心策略快速失败：在前端尽早拦截错误，避免浪费后端算力和用户时间" | 核心策略快速失败 |
| 1:08 | 架构示意图分步演示 | "三层校验架构：L1格式（硬拒绝）、L2内容（强提示）、L3语义（软提示）" | 三层校验架构 |
| 2:01 | 关键代码/伪代码片段 | "L1查类型大小、L2查可读结构、L3用轻量模型比对任务相关性" | L1查类型大小 |
| 2:54 | 对比表格 | "校验管道化：各层规则独立，支持异步串联执行并聚合反馈结果" | 校验管道化 |
| 3:50 | 总结卡 | "核心抓住这条主线，下期咱们接着聊：语义校验怎么实现？用小模型预判吗。" | 收尾 |
