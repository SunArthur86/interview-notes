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
  - 前置上下文校验防止输入错误
  - 产物质量自评：AI生成后先自检再展示
  - 结构完整性校验：检查格式和内容是否完整
  - 用户反馈闭环：收集Bad case持续改进
first_principle:
  essence: 质量护栏=多层防御体系
  derivation: AI输出不确定→单一检查不够→多层护栏(输入校验+自评+完整性+基线+反馈)→每层过滤不同类型的问题→整体质量可控
  conclusion: 前端不能保证AI每次都完美，但可以保证"有问题的产物不会直接到用户手里"
follow_up:
- 如果桌面端要接文件、网页和本地目录，你先画哪套权限边界？
- 这个产品要接入更多Agent能力时，哪层架构最不能乱？
memory_points:
- 五层质量护栏：前置校验、AI自评、完整性检查、基线对比、用户反馈闭环
- 前置校验：拦截空文件或超限Token，将错误输入阻挡在AI执行前
- AI自评与完整检查：生成后用LLM自评打分，并校验字段与格式完整性
- 用户反馈闭环：对低分产物触发自动重试，并收集采纳率离线迭代
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

## 记忆要点

- 五层质量护栏：前置校验、AI自评、完整性检查、基线对比、用户反馈闭环
- 前置校验：拦截空文件或超限Token，将错误输入阻挡在AI执行前
- AI自评与完整检查：生成后用LLM自评打分，并校验字段与格式完整性
- 用户反馈闭环：对低分产物触发自动重试，并收集采纳率离线迭代

## 苏格拉底式面试追问

> 这组追问模拟面试官层层逼问，每一问先回答"为什么"，再回答"怎么做"，最后回答"如何证明"。

### 第一层：目标与动机

**Q：为什么前端要做"五层质量护栏"，质量不是 AI 模型（后端）的责任吗？前端只管展示不就行了？**

因为"AI 输出的不确定性是本质特征"，前端不能改变不确定性，但可以把"不可控"降低到"可接受"。只管展示的问题：AI 偶尔生成低质量产物（幻觉、格式错误、数据不准），直接展示给用户后用户看到垃圾内容，对产品的信任崩塌——用户不会区分"AI 模型不行"和"产品不行"，他们只会觉得"这个产品不靠谱"。五层护栏的价值是在"AI 生成"和"用户看到"之间建立多层过滤：前置校验拦截"输入不对"导致的低质量、AI 自评拦截"生成不好"的低质量、完整性校验拦截"格式错误"的低质量、基线对比拦截"明显偏离历史优秀水平"的低质量、用户反馈闭环持续改进。这样即使 AI 模型有 20% 的概率生成低质量内容，经过五层护栏后用户实际看到的低质量内容降到 5% 以下——前端的护栏把"模型的不确定性"对用户隐藏了。所以前端质量护栏不是"越俎代庖"做后端的事，而是"在用户接触点建立最后一道防线"——这是工具型产品的基本责任。

### 第二层：证据与定位

**Q：你怎么定位"产物质量低"是哪一层护栏该拦截但没拦截的问题？**

用"护栏穿透率"定位。对每个被用户标记为"质量低"（👎 或拒绝）的产物，回溯它穿过了哪几层护栏：(1) 如果前置校验通过但产物质量低——说明前置校验没发现输入问题（如文件过期没检测到），要优化前置校验；(2) 如果自评打分高（>80）但用户标为低质量——说明 AI 自评不准（模型自评假阳性），要调自评 prompt 或加更严格的评分标准；(3) 如果完整性校验通过但产物内容错误——说明完整性校验只检查了格式没检查语义（如 HTML 结构完整但数据是幻觉的），要加语义校验；(4) 如果基线对比没报警但产物明显偏离——说明基线数据不足或偏差阈值太宽，要积累更多历史数据或调阈值。统计各类"穿透"的频率——如果 60% 的低质量产物是"自评打分高但实际低"，说明自评层是最大短板，优先优化自评 prompt 和评分 rubric。这样就能精确定位"哪层护栏失效"而非笼统说"质量不好"。

### 第三层：根因深挖

**Q：为什么 AI 自评要"生成后用另一个 LLM 调用评估"，而不是让生成模型自己附带质量分数？**

因为"自己评估自己"存在系统性偏差——生成模型倾向于高估自己的输出。让生成模型附带质量分数，它会基于"我按照指令生成了内容"的自我认知打分，而非基于"内容是否真正准确、是否满足用户需求"的客观标准。这就像让学生自己给自己的考试打分——分数普遍虚高。用另一个 LLM 调用做评估（self-evaluation），评估模型以"旁观者"视角审查产物，参考的是明确的评分 rubric（"内容是否完整回答了问题""数据是否准确""格式是否正确"），比生成模型自评更客观。另一个 LLM 调用还可以用不同的 prompt（评估 prompt vs 生成 prompt），专门优化为"挑错"而非"生成"——评估模型的任务是找问题，生成模型的任务是写内容，两者的能力倾向不同。代价是多一次 LLM 调用（成本和延迟），但对高风险任务（如生成给客户的重要报告）值得——低风险任务（如内部草稿）可以跳过自评省成本。

**Q：那如果评估模型的判断也不准（评估模型也幻觉，把好的判为差的或反之），为什么不直接相信用户反馈？**

因为"用户反馈是滞后的"——等用户标了👎产物已经展示给用户了，伤害已经造成。自评的价值是"前置拦截"——在产物展示给用户之前就判断质量，低分的自动重试或降级展示，用户根本看不到低质量内容。如果完全依赖用户反馈，每个低质量产物至少要被一个用户"受害"后才能改进，这个用户就是"代价"。自评虽然不完美，但它能在"用户看到之前"拦截一部分低质量产物——假设自评的准确率是 70%，它就能拦住 70% 的低质量内容，剩余 30% 穿透后由用户反馈兜底。所以两者是互补关系：自评做前置拦截（拦住大部分），用户反馈做事后兜底（拦住穿透的少数）+ 离线改进（用反馈数据训练更好的自评模型）。自评模型不准的解法是"用用户反馈数据持续校准自评"——收集"自评打分 vs 用户实际反馈"的对照数据，发现自评系统性偏差（如自评对"PPT 美观度"的判断偏高），针对性调整评分 prompt 或 rubric，让自评逐渐逼近用户的真实判断。

### 第四层：方案权衡

**Q：五层护栏你主张"全部启用"，为什么不根据任务风险等级选择性启用（低风险任务只启用前置校验 + 完整性）？**

因为正好相反——护栏应该根据任务风险等级选择性启用，低风险任务不启用全部护栏（省成本），高风险任务启用全部（保质量）。五层护栏的启用策略：(1) 前置校验和完整性校验——成本极低（本地计算 <1s），所有任务都启用；(2) AI 自评——成本中等（多一次 LLM 调用，约 2-5 秒 + Token 成本），只在"高风险任务"启用（如生成给客户的报告、修改用户重要文件），低风险任务（如内部草稿、临时笔记）跳过；(3) 基线对比——成本极低（本地计算），但需要历史数据积累，新产物类型初期无法启用，积累足够数据后启用；(4) 用户反馈闭环——所有任务都启用（只是加个👍👎按钮，零成本）。所以不是"全部启用"或"只启用部分"的二元选择，而是"按任务风险分级启用"——高风险走五层全量护栏，低风险走轻量护栏（前置+完整性+反馈）。这样既保证高风险产物的质量，又不让低风险任务承担不必要的延迟和成本。

**Q：那如果用户抱怨"同样的任务上次没自评这次突然自评了，体验不一致"，为什么不统一全部启用自评保证一致性？**

因为"体验不一致"的根因是"自评触发的规则不透明"，解法是"让规则透明"而非"全部启用"。如果用户知道"生成给客户的报告会自评、内部草稿不自评"，这种不一致是可理解的（用户知道规则）。如果触发规则是黑盒（有时候自评有时候不自评，用户不知道为什么），才会觉得"体验不一致"。解法：(1) 触发规则透明化——在任务发起时显示"本次任务将进行质量自评（因为是高风险任务）"，让用户有预期；(2) 触发规则可配置——用户可以在设置里选"所有任务都自评（慢但稳）"或"仅高风险任务自评（快）"，把选择权交给用户；(3) 自评结果可见——自评通过时显示"✓ 质量检查通过"，自评拦截时显示"质量检查未通过，正在自动重试"，让用户感知到护栏在工作而非黑盒。全部启用自评的代价是"低风险任务也要多等 2-5 秒"——对于"帮我格式化这段 JSON"这种简单任务，等自评是纯粹的浪费，用户体验反而更差。

### 第五层：验证与沉淀

**Q：你怎么证明"五层护栏"真的提升了产物质量，而不是只是增加了延迟和成本？**

用"质量拦截漏斗 + 用户满意度"联合验证。质量拦截漏斗统计每层护栏拦截了多少低质量产物：(1) 前置校验拦截了 N1 个（格式不对/文件过期的输入）；(2) 自评拦截了 N2 个（生成后打分低于阈值的）；(3) 完整性校验拦截了 N3 个（格式不完整的）；(4) 基线对比拦截了 N4 个（偏离历史优秀水平的）。这些被拦截的低质量产物如果没有护栏会直接展示给用户——所以"拦截数 N1+N2+N3+N4"就是护栏避免的"用户受害次数"。用户满意度指标：对比有护栏 vs 无护栏（或关闭某层护栏）的对照组，产物满意度（👍率/采纳率）应显著提升——如果采纳率从 55% 提升到 72%，且自评拦截了 15% 的低质量产物（这些走了自动重试后采纳率更高），就证明护栏有效。还要监控成本指标：自评的额外 Token 成本占总成本的比例——如果自评成本占比 <10% 但拦截了 15% 的低质量产物（省下了这些低质量产物的重跑成本和用户流失成本），ROI 为正。

**Q：怎么让团队在新增产物类型时，自觉接入五层护栏，而不是为了赶进度只做"生成+展示"就上线？**

把五层护栏做成"产物类型注册"的强制插槽。第一，ArtifactTypeSpec 接口里必须实现 validator（对应完整性校验）和 qualityChecker（对应自评适配器）两个方法，缺一个不允许注册——这从类型系统层强制每种产物都有护栏；第二，前置校验和基线对比由平台层自动托管——产物类型注册时声明 acceptedInputs 和 qualityBaseline，平台层自动执行校验，开发者不需要手写；第三，用户反馈闭环是平台层统一提供的——所有产物展示时自动附带👍👎按钮（由平台层渲染），开发者不需要自己加反馈 UI；第四，护栏配置通过产物类型的 riskLevel 字段控制——低风险产物类型（如内部笔记）自动跳过自评，高风险产物类型（如客户报告）强制自评，开发者声明 riskLevel 后平台层自动路由。这样五层护栏就从"每开发者自觉实现"变成了"注册时强制 + 平台层托管"，不遵循就无法注册产物类型。

## 结构化回答

**30 秒电梯演讲：** 桌面产物质量忽高忽低时，前端能做的护栏包括——前置上下文校验（防止输入错误导致输出差）、产物质量自评（AI生成后先自检再展示给用户）、结果对比基线（和历史优秀产物对比）、结构完整性校验（检查产物格式是否完整）。

**展开框架：**
1. **前置上下文** — 前置上下文校验防止输入错误
2. **产物质量自评** — AI生成后先自检再展示
3. **结构完整性校验** — 检查格式和内容是否完整

**收尾：** 您想深入聊：如果桌面端要接文件、网页和本地目录，你先画哪套权限边界？


## 视频脚本

> 预计时长：4 分钟 | 由浅入深


| 时间 | 画面/字幕 | 口播台词 | 讲解要点 |
|------|----------|----------|----------|
| 0:00 | 标题卡：如果桌面产物质量忽高忽低，前端能做哪些护栏？ | "就像工厂质检流水线——原材料检查（前置校验）、生产过程监控（自评）、成品抽检（完整性校验）…" | 开场钩子 |
| 0:20 | 核心概念图 | "桌面产物质量忽高忽低时，前端能做的护栏包括——前置上下文校验（防止输入错误导致输出差）、产物质量自评（AI生成后先自检再…" | 核心定义 |
| 0:50 | 前置上下文示意图 | "前置上下文——前置上下文校验防止输入错误" | 要点拆解1 |
| 1:30 | 对比/实战案例图 | "对比一下常见误区和工程实践，看真实场景里怎么取舍。" | 实战与对比 |
| 2:20 | 总结卡 | "记住核心要点。下期我们追问：如果桌面端要接文件、网页和本地目录，你先画哪套权限边界？" | 收尾与钩子 |
