---
id: note-mk-022
difficulty: L3
category: ai
subcategory: 桌面AI产品
tags:
- 月之暗面
- 面经
- AI-Native
- 质量护栏
- 产物质量
feynman:
  essence: 桌面产物质量忽高忽低时，前端能做的护栏包括——前置上下文校验（防止输入错误导致输出差）、产物质量自评（AI生成后先自检再展示给用户）、结果对比基线（和历史优秀产物对比）、结构完整性校验（检查产物格式是否完整）、用户反馈闭环（收集Bad case持续改进）。
  analogy: 就像工厂质检流水线——原材料检查（前置校验）、生产过程监控（自评）、成品抽检（完整性校验）、与标准品对比（基线对比）、客户反馈收集（反馈闭环）。每一步都是一道质量关卡。
  first_principle: AI输出的不确定性是本质特征——同样的输入可能产生不同质量的输出。前端不能改变AI的不确定性，但可以通过多层护栏把"不可控"降低到"可接受"的范围。
  key_points:
  - '前置上下文校验防止输入错误'
  - '产物质量自评：AI生成后先自检再展示'
  - '结构完整性校验：检查格式和内容是否完整'
  - '用户反馈闭环：收集Bad case持续改进'
first_principle:
  essence: 质量护栏=多层防御体系
  derivation: AI输出不确定→单一检查不够→多层护栏(输入校验+自评+完整性+基线+反馈)→每层过滤不同类型的问题→整体质量可控
  conclusion: 前端不能保证AI每次都完美，但可以保证"有问题的产物不会直接到用户手里"
follow_up:
- 如果桌面端要接文件、网页和本地目录，你先画哪套权限边界？
- 这个产品要接入更多Agent能力时，哪层架构最不能乱？
---

# 【月之暗面面经】如果桌面产物质量忽高忽低，前端能做哪些护栏？

## 一、五层质量护栏体系

```
┌──────────────────────────────────────────────────────────────────┐
│                  五层产物质量护栏                                   │
├──────────────────────────────────────────────────────────────────┤
│                                                                  │
│  任务发起 → [护栏1] → AI执行 → [护栏2] → [护栏3] → [护栏4] → 用户│
│            前置校验      自评      完整性     基线对比              │
│                                                                  │
│                                            [护栏5]                │
│                                            用户反馈闭环            │
│                                            （离线持续改进）         │
│                                                                  │
└──────────────────────────────────────────────────────────────────┘
```

## 二、护栏详解

### 护栏1: 前置上下文校验

**作用**：在AI执行前过滤掉"输入不对"的情况。

```typescript
class PreExecutionGuardrail {
  async check(input: AgentInput): Promise<GuardrailResult> {
    const checks = await Promise.all([
      this.checkFileFormats(input),      // 格式是否支持
      this.checkFileIntegrity(input),    // 文件是否完整
      this.checkContentRelevance(input), // 内容是否与任务相关
      this.checkFreshness(input),        // 数据是否过期
      this.checkTokenBudget(input),      // Token是否超限
    ]);
    
    const blockers = checks.filter(c => c.severity === 'blocker');
    if (blockers.length > 0) {
      return { pass: false, issues: blockers };
    }
    
    return { pass: true, warnings: checks.filter(c => c.severity === 'warning') };
  }
}
```

**典型拦截**：
- 给了.doc文件但只支持.pdf → 拦截并建议转换
- 文件为空 → 拦截并提示重新选择
- 引用的数据明显过期 → 警告并建议更新

### 护栏2: AI产物自评

**作用**：AI生成产物后，先自我评估质量，低质量产物不直接展示给用户。

```typescript
class SelfEvaluationGuardrail {
  async evaluate(artifact: Artifact, task: Task): Promise<EvaluationResult> {
    // 用另一个LLM调用评估产物质量
    const evaluation = await llm.evaluate({
      artifact: artifact.content,
      task: task.rawInput,
      criteria: [
        '内容是否完整回答了用户的问题',
        '数据是否准确（与引用来源一致）',
        '格式是否正确（表格/列表/代码块）',
        '语言是否流畅自然',
        '是否包含错误信息或矛盾',
      ],
    });
    
    return {
      score: evaluation.score,          // 0-100
      issues: evaluation.issues,        // 发现的问题
      recommendation: evaluation.score > 60 ? 'show' : 'regenerate',
    };
  }
}

// 低分产物的处理流程
if (evaluation.score < 60) {
  // 1. 尝试自动修复
  const fixed = await autoFix(artifact, evaluation.issues);
  if (fixed.score > 70) {
    showToUser(fixed);  // 修复后展示
  } else {
    // 2. 自动重试（最多2次）
    const retried = await regenerate(task, evaluation.feedback);
    if (retried.score > 60) {
      showToUser(retried);
    } else {
      // 3. 降级展示——告诉用户结果可能不理想
      showWithWarning(retried, 'AI对这个任务的处理可能不够理想，建议调整输入后重试');
    }
  }
}
```

### 护栏3: 结构完整性校验

**作用**：检查产物格式是否符合规范。

```typescript
class StructureValidator {
  validate(artifact: Artifact): ValidationResult {
    switch (artifact.kind) {
      case 'site':
        return this.validateSite(artifact);
      case 'ppt':
        return this.validatePPT(artifact);
      case 'sheet':
        return this.validateSheet(artifact);
    }
  }
  
  private validateSite(artifact: Artifact): ValidationResult {
    const html = artifact.content.data as string;
    const issues: string[] = [];
    
    // 检查HTML结构完整性
    if (!html.includes('<html')) issues.push('缺少HTML根标签');
    if (!html.includes('</body>')) issues.push('缺少body闭合标签');
    
    // 检查资源引用
    const imgs = html.match(/<img[^>]+src=["']([^"']+)["']/g);
    if (imgs) {
      for (const img of imgs) {
        const src = img.match(/src=["']([^"']+)["']/)?.[1];
        if (src && !src.startsWith('data:') && !src.startsWith('http')) {
          issues.push(`图片引用可能失效: ${src}`);
        }
      }
    }
    
    // 检查CSS完整性
    if (html.includes('class=') && !html.includes('<style')) {
      issues.push('使用了class但缺少样式定义');
    }
    
    return { valid: issues.length === 0, issues };
  }
  
  private validatePPT(artifact: Artifact): ValidationResult {
    const slides = JSON.parse(artifact.content.data as string);
    const issues: string[] = [];
    
    if (slides.length === 0) issues.push('PPT没有任何幻灯片');
    
    for (let i = 0; i < slides.length; i++) {
      if (!slides[i].title) issues.push(`第${i+1}页缺少标题`);
      if (!slides[i].content) issues.push(`第${i+1}页缺少内容`);
    }
    
    return { valid: issues.length === 0, issues };
  }
}
```

### 护栏4: 基线对比

**作用**：与历史优秀产物对比，判断当前产物质量。

```typescript
class BaselineComparison {
  private baselines: Map<string, Baseline[]> = new Map();
  
  // 从历史任务中学习"好产物"的特征
  async learnFromHistory(artifactKind: string) {
    // 找出被用户完全接受的产物（采纳率=100%）
    const goodArtifacts = await db.query(`
      SELECT * FROM artifacts 
      WHERE kind = ? AND status = 'accepted_full'
      ORDER BY user_rating DESC LIMIT 100
    `, [artifactKind]);
    
    // 提取特征
    const baseline: Baseline = {
      kind: artifactKind,
      avgLength: average(goodArtifacts.map(a => a.content.length)),
      avgSections: average(goodArtifacts.map(a => countSections(a))),
      commonKeywords: extractKeywords(goodArtifacts),
      structurePattern: extractStructure(goodArtifacts),
    };
    
    this.baselines.set(artifactKind, [...(this.baselines.get(artifactKind) || []), baseline]);
  }
  
  // 对比当前产物与基线
  compare(artifact: Artifact): ComparisonResult {
    const baseline = this.baselines.get(artifact.kind)?.pop();
    if (!baseline) return { hasBaseline: false };
    
    const deviations: string[] = [];
    
    if (artifact.content.length < baseline.avgLength * 0.3) {
      deviations.push('产物内容明显偏短，可能不够完整');
    }
    
    if (countSections(artifact) < baseline.avgSections * 0.5) {
      deviations.push('产物结构过于简单');
    }
    
    return { hasBaseline: true, deviations };
  }
}
```

### 护栏5: 用户反馈闭环

**作用**：收集用户对产物的反馈，持续改进质量。

```typescript
// 产物展示时的反馈收集
class FeedbackCollector {
  // 在产物上添加快捷反馈入口
  renderFeedback(artifact: Artifact) {
    return h('div', { class: 'artifact-feedback' }, [
      h('button', { onClick: () => this.thumbsUp(artifact) }, '👍 好'),
      h('button', { onClick: () => this.thumbsDown(artifact) }, '👎 差'),
      h('button', { onClick: () => this.reportIssue(artifact) }, '⚠️ 报告问题'),
    ]);
  }
  
  // 收集Bad case
  async reportIssue(artifact: Artifact) {
    const issue = await showReportDialog({
      categories: ['内容错误', '格式问题', '数据不准', '完全不相关', '其他'],
      description: true,
    });
    
    // 存入Bad case库
    await db.insert('bad_cases', {
      artifactId: artifact.id,
      taskId: artifact.taskId,
      category: issue.category,
      description: issue.description,
      createdAt: Date.now(),
    });
    
    // 反馈给AI改进
    await this.feedToImprovement(artifact, issue);
  }
}
```

## 三、护栏联动流程

```
任务发起
  │
  ├─→ 护栏1: 前置校验 → 不通过？→ 提示用户修正
  │
  ├─→ AI执行
  │
  ├─→ 护栏2: 自评 → 低分？→ 自动修复/重试/降级展示
  │
  ├─→ 护栏3: 完整性 → 不通过？→ 自动修复/标记问题
  │
  ├─→ 护栏4: 基线对比 → 偏差大？→ 添加警告标记
  │
  ├─→ 展示给用户（附带质量标记）
  │
  └─→ 护栏5: 收集反馈 → 持续改进
```

## 四、常见坑

- **只靠后端质检**：前端不做事，低质量产物直接到用户手里
- **自评消耗太多Token**：每次生成后都做完整自评，成本翻倍——应该只在高风险任务时启用
- **没有基线数据**：新上线的产物类型没有历史数据做对比基线
- **反馈入口太重**：弹大表单让用户填，用户懒得填——应该一键👍/👎就够了
