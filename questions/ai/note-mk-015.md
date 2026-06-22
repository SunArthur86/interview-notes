---
id: note-mk-015
difficulty: L3
category: ai
subcategory: 桌面AI产品
tags:
- 月之暗面
- 面经
- AI-Native
- 上下文校验
- 风险提示
feynman:
  essence: 很多AI结果不好不是模型不行，而是上下文一开始就错了。前端越早暴露问题后面越省事——执行前展示引用文件摘要和关键字段、对缺失权限/空文件/异常格式做前置校验、提示用户上下文可能不完整或过期、允许快速替换文件或补充链接。
  analogy: 就像厨师做菜前先检查食材——如果发现鸡蛋过期了、盐用完了，会先告诉你"这些食材可能影响菜品质量"，而不是闷头做出一桌难吃的菜再让你排查原因。
  first_principle: AI的输出质量取决于输入质量（Garbage In Garbage Out）。前端是用户和AI之间的最后一道关卡，有责任在任务执行前检查上下文的完整性和正确性。前置校验的成本远低于事后重跑。
  key_points:
  - '在执行前展示引用文件摘要和关键字段'
  - '对缺失权限、空文件或异常格式做前置校验'
  - '提示用户当前上下文可能不完整或过期'
  - '允许快速替换文件或补充网页链接'
first_principle:
  essence: 前置校验优于事后重跑
  derivation: AI任务执行成本(时间+token)>>校验成本→在执行前检查上下文→发现问题时阻止执行→节省重跑成本
  conclusion: 上下文校验不是可选项，而是AI-Native桌面前端的标配功能——它是降低用户失败率的最有效手段
follow_up:
- 如果桌面端要接文件、网页和本地目录，你先画哪套权限边界？
- 这个产品要接入更多Agent能力时，哪层架构最不能乱？
---

# 【月之暗面面经】如果用户给了错误的文件上下文，前端怎样尽早发现并提示？

## 一、上下文错误的常见类型

| 错误类型 | 示例 | 影响 | 检测难度 |
|---------|------|------|---------|
| 格式不支持 | 给了.doc但Agent只支持.md/.pdf | 直接失败 | 容易 |
| 文件为空 | 0KB的文件 | AI无法提取信息 | 容易 |
| 权限缺失 | 没有目录读取权限 | 无法索引 | 容易 |
| 内容过期 | 用了2022年的报告分析2024年市场 | 结果不准确 | 中等 |
| 语言不匹配 | 给了日文文件但要求中文分析 | 翻译质量差 | 中等 |
| 格式混乱 | PDF是扫描件而非文字版 | OCR可能出错 | 中等 |
| 内容不相关 | 给了菜谱文件要求做代码审查 | 完全跑题 | 困难 |
| 文件损坏 | PDF损坏无法打开 | 直接失败 | 容易 |

## 二、前置校验流水线

```
┌──────────────────────────────────────────────────────────────────┐
│                  上下文前置校验流水线                               │
├──────────────────────────────────────────────────────────────────┤
│                                                                  │
│  用户选择文件/URL                                                 │
│         │                                                        │
│         ▼                                                        │
│  ┌──────────────┐                                               │
│  │ 格式校验      │ → 不支持的格式？→ ⚠️ 提示替换                  │
│  └──────┬───────┘                                               │
│         │                                                        │
│         ▼                                                        │
│  ┌──────────────┐                                               │
│  │ 完整性校验    │ → 空文件/损坏文件？→ ⚠️ 提示重新选择            │
│  └──────┬───────┘                                               │
│         │                                                        │
│         ▼                                                        │
│  ┌──────────────┐                                               │
│  │ 权限校验      │ → 无读取权限？→ ⚠️ 请求授权                     │
│  └──────┬───────┘                                               │
│         │                                                        │
│         ▼                                                        │
│  ┌──────────────┐                                               │
│  │ 内容预检      │ → 提取摘要+关键字段                            │
│  └──────┬───────┘                                               │
│         │                                                        │
│         ▼                                                        │
│  ┌──────────────┐                                               │
│  │ 相关性评估    │ → 内容与任务匹配？→ ⚠️ 提示可能不相关           │
│  └──────┬───────┘                                               │
│         │                                                        │
│         ▼                                                        │
│  ┌──────────────┐                                               │
│  │ 时效性检查    │ → 文件是否过时？→ ⚠️ 提示可能已过期             │
│  └──────┬───────┘                                               │
│         │                                                        │
│         ▼                                                        │
│  ✅ 校验通过 → 展示上下文摘要 → 用户确认 → 执行                   │
│                                                                  │
└──────────────────────────────────────────────────────────────────┘
```

## 三、上下文摘要展示

```
┌──────────────────────────────────────────────────────────────────┐
│  📋 执行前确认                                                     │
├──────────────────────────────────────────────────────────────────┤
│                                                                  │
│  任务：分析竞品定价策略                                            │
│                                                                  │
│  📥 引用的素材（3个）：                                            │
│                                                                  │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │ 📄 竞品分析报告Q3.pdf                       ✅ 格式正确    │   │
│  │ 摘要：2024年Q3季度竞品市场分析报告                          │   │
│  │ 关键字段：                                                │   │
│  │   • 产品：Notion, 飞书, 语雀                              │   │
│  │   • 定价：$0-$15/人/月                                    │   │
│  │ ⚠️ 时效提醒：此文件是Q3报告(3个月前)，Q4数据可能有变化       │   │
│  │ [ 更换为最新文件 ]                                        │   │
│  ├──────────────────────────────────────────────────────────┤   │
│  │ 🌐 https://notion.so/pricing              ✅ 可访问      │   │
│  │ 摘要：Notion定价页面，4个套餐                              │   │
│  ├──────────────────────────────────────────────────────────┤   │
│  │ 📸 竞品截图.png                             ✅ 格式正确    │   │
│  │ OCR：飞书首页突出"免费"标签                                │   │
│  └──────────────────────────────────────────────────────────┘   │
│                                                                  │
│  ⚠️ 注意事项：                                                   │
│  • Q3报告可能不包含最新的Q4数据，结果可能有时效性偏差              │
│  • 建议补充最新的定价页面URL                                      │
│                                                                  │
│  Token预估：8,420 / 128,000 (6.6%)                              │
│                                                                  │
│  [ 确认执行 ]  [ 补充素材 ]  [ 替换过期文件 ]  [ 取消 ]          │
└──────────────────────────────────────────────────────────────────┘
```

## 四、校验器实现

```typescript
class ContextValidator {
  async validate(input: AgentInput): Promise<ValidationResult> {
    const issues: ValidationIssue[] = [];
    
    for (const ref of input.inputRefs) {
      // 1. 格式校验
      const formatIssue = this.checkFormat(ref);
      if (formatIssue) issues.push(formatIssue);
      
      // 2. 完整性校验
      const integrityIssue = await this.checkIntegrity(ref);
      if (integrityIssue) issues.push(integrityIssue);
      
      // 3. 权限校验
      const permissionIssue = await this.checkPermission(ref);
      if (permissionIssue) issues.push(permissionIssue);
      
      // 4. 内容预检
      const contentSummary = await this.summarize(ref);
      
      // 5. 相关性评估
      const relevanceIssue = this.checkRelevance(contentSummary, input.rawInput);
      if (relevanceIssue) issues.push(relevanceIssue);
      
      // 6. 时效性检查
      const freshnessIssue = this.checkFreshness(ref);
      if (freshnessIssue) issues.push(freshnessIssue);
    }
    
    return {
      passed: issues.every(i => i.severity !== 'blocker'),
      issues,
      summaries: contentSummaries,
    };
  }
  
  // 相关性评估——检查文件内容是否与任务相关
  private checkRelevance(summary: string, taskInput: string): ValidationIssue | null {
    const relevance = this.computeRelevance(summary, taskInput);
    
    if (relevance < 0.3) {
      return {
        severity: 'warning',
        type: 'irrelevant-content',
        message: `此文件内容可能与任务不相关（相关度 ${Math.round(relevance * 100)}%）`,
        suggestion: '确认此文件是否正确，或更换更相关的文件',
      };
    }
    
    return null;
  }
  
  // 时效性检查
  private checkFreshness(ref: InputRef): ValidationIssue | null {
    if (ref.metadata?.createdAt) {
      const age = Date.now() - ref.metadata.createdAt;
      const daysOld = age / (1000 * 60 * 60 * 24);
      
      if (daysOld > 90) {
        return {
          severity: 'warning',
          type: 'stale-content',
          message: `此文件创建于${Math.round(daysOld)}天前，内容可能已过时`,
          suggestion: '考虑更新为最新的数据源',
        };
      }
    }
    
    return null;
  }
}
```

## 五、快速替换流程

```typescript
// 用户发现问题后，可以快速替换素材
async function quickReplace(oldRefId: string): Promise<void> {
  // 弹出文件选择器
  const newPath = await showFilePicker({
    title: '替换文件',
    buttonLabel: '选择替换文件',
    properties: ['openFile'],
  });
  
  if (newPath) {
    // 校验新文件
    const validation = await validator.validateFile(newPath);
    
    if (validation.passed) {
      // 替换引用
      contextStore.replaceRef(oldRefId, {
        uri: newPath,
        summary: validation.summary,
      });
      
      toast.success('文件已替换');
    } else {
      toast.error(`新文件校验失败：${validation.issues[0].message}`);
    }
  }
}
```

## 六、常见坑

- **不做前置校验直接执行**：AI跑了几分钟后才发现文件格式不对，浪费时间
- **只报错不引导**：提示"文件格式不支持"但不提供替换建议
- **不展示内容摘要**：用户不知道文件里有什么，无法判断是否选对了
- **忽略时效性**：用了过期数据做分析，结果不准确但用户不知道原因
