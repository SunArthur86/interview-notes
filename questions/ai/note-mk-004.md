---
id: note-mk-004
difficulty: L4
category: ai
subcategory: 桌面AI产品
tags:
- 月之暗面
- 面经
- AI-Native
- 多模态
- 上下文管理
feynman:
  essence: 多模态上下文管理的核心是把来源对象、提取结果和当前任务引用拆开管理——用户能清楚看到哪些素材正在被当前任务消费，大对象优先存引用和摘要而非重复拷贝，上下文切换时保留历史版本方便回退。
  analogy: 就像侦探办案——桌上摊开很多证据（网页截图、文件、照片），但每次只拿起与当前调查相关的几样来分析，用完放回去换下一批，而不是把所有证据堆在一起。
  first_principle: AI的上下文窗口是有限的（即使是1M token也有边界）。多模态输入（网页+文档+截图）的数据量和异构性远超纯文本，前端必须做上下文的引用化、摘要化和可视化，让用户和AI都能高效管理注意力。
  key_points:
  - '把来源对象、提取结果和当前任务引用拆开'
  - '用户能看到哪些素材正在被当前任务消费'
  - '大对象优先存引用和摘要，不重复拷贝'
  - '上下文切换时保留历史版本，方便回退'
first_principle:
  essence: 上下文引用化 vs 上下文内联化
  derivation: 多模态输入数据量大→全部塞进prompt会超token限制→改为引用+摘要→按需展开完整内容→用户可控地选择哪些上下文进入当前任务
  conclusion: 桌面AI的上下文不是静态的prompt前缀，而是动态的、可视化的、用户可控的素材管理面板
follow_up:
- 如果桌面端要接文件、网页和本地目录，你先画哪套权限边界？
- 这个产品要接入更多Agent能力时，哪层架构最不能乱？
---

# 【月之暗面面经】多模态输入同时有网页、文档和本地截图时，桌面端该怎样做上下文管理？

## 一、问题本质：上下文爆炸

一个典型的桌面 AI 任务可能有这样的输入：

```
输入素材：
  ├── 网页URL × 3（每个约 5000 字 = 15000 字）
  ├── PDF文档 × 2（每个约 20 页 = 约 40000 字）
  ├── 本地截图 × 5（每张需OCR + 描述 = 约 5000 字）
  └── 历史对话 × 20条（约 8000 字）
  
总计：约 68000 字 ≈ 90000 tokens
```

如果把这些全部内联到 prompt 中，不仅消耗大量 token，还会导致 AI 注意力分散、关键信息被淹没。

## 二、上下文管理三层架构

```
┌──────────────────────────────────────────────────────────────────┐
│                    上下文管理三层架构                               │
├──────────────────────────────────────────────────────────────────┤
│                                                                  │
│  Layer 3: 引用层（Reference Layer）                               │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │ ContextSlot[] — 当前任务激活的上下文槽位                    │   │
│  │ 每个槽位引用一个来源对象，可随时增删                       │   │
│  └──────────────────────────────────────────────────────────┘   │
│                                                                  │
│  Layer 2: 提取层（Extraction Layer）                              │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │ 对每个来源对象做预处理：                                   │   │
│  │ 网页 → 正文提取 → 关键段落 + 摘要                         │   │
│  │ 文档 → 分页解析 → 关键页 + 摘要                           │   │
│  │ 截图 → OCR + 视觉描述 → 关键文字 + 布局摘要                │   │
│  └──────────────────────────────────────────────────────────┘   │
│                                                                  │
│  Layer 1: 来源层（Source Layer）                                  │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │ SourceObject[] — 原始素材仓库                              │   │
│  │ 网页URL / 文件路径 / 截图数据 / 历史任务                    │   │
│  │ 完整内容存储在本地索引，不重复拷贝                          │   │
│  └──────────────────────────────────────────────────────────┘   │
│                                                                  │
└──────────────────────────────────────────────────────────────────┘
```

## 三、上下文对象模型

```typescript
// 来源对象——原始素材
interface SourceObject {
  id: string;
  type: 'webpage' | 'document' | 'screenshot' | 'file' | 'task-history';
  
  // 原始信息
  uri: string;              // URL / 文件路径 / 数据引用
  rawContent?: string;      // 原始内容（可能很大）
  
  // 提取结果
  extracted: {
    summary: string;        // 一句话摘要
    keyPoints: string[];    // 关键要点
    fullText?: string;      // 完整文本（按需展开）
    metadata: {
      title?: string;
      author?: string;
      createdAt?: number;
      wordCount?: number;
      language?: string;
    };
  };
  
  // 消耗状态
  consumed: boolean;        // 是否已被当前任务引用
}

// 上下文槽位——当前任务激活的上下文
interface ContextSlot {
  id: string;
  sourceId: string;         // 引用的来源对象
  mode: 'summary' | 'keypoints' | 'fulltext' | 'reference-only';
  priority: 'high' | 'medium' | 'low';
  note?: string;            // 用户备注："这个网页是竞品定价页"
}
```

## 四、UI 设计：上下文面板

```
┌──────────────────────────────────────────────────────────────────┐
│  当前任务：分析竞品定价策略                                        │
├──────────────────────────────────────────────────────────────────┤
│                                                                  │
│  📎 上下文素材（当前激活 4/12）                           [管理]  │
│                                                                  │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │ ✅ [高] 🌐 Notion定价页                      [摘要|全文]  │   │
│  │    "Free/Plus/Business/Enterprise四档，$0-$15/人/月..."   │   │
│  ├──────────────────────────────────────────────────────────┤   │
│  │ ✅ [高] 📄 竞品分析报告Q4.pdf                [摘要|全文]  │   │
│  │    "2024Q4市场份额：Notion 35%, 飞书28%, 语雀12%..."     │   │
│  ├──────────────────────────────────────────────────────────┤   │
│  │ ✅ [中] 📸 竞品首页截图.png                  [OCR|描述]   │   │
│  │    "飞书首页突出'免费'标签，Notion突出'AI'..."            │   │
│  ├──────────────────────────────────────────────────────────┤   │
│  │ ✅ [低] 📋 上次分析结果（任务#42）            [引用]      │   │
│  │    "上次结论：飞书在中小企业市场增长最快..."               │   │
│  ├──────────────────────────────────────────────────────────┤   │
│  │ ⬜ 📄 产品路线图2024.docx                    [未激活]     │   │
│  │ ⬜ 🌐 https://yuanbao.tencent.com             [未激活]    │   │
│  └──────────────────────────────────────────────────────────┘   │
│                                                                  │
│  Token预估：12,450 / 128,000 (9.7%)                      [优化]  │
└──────────────────────────────────────────────────────────────────┘
```

**设计要点**：
- 默认只展示摘要（省 token），用户点击「全文」才展开
- 支持调整优先级（高/中/低），高优先级内容更可能被AI关注
- 实时显示 Token 消耗预估
- 未激活的素材收起展示，避免视觉干扰

## 五、多模态来源的提取策略

```typescript
class ContextExtractor {
  // 网页：提取正文 + 关键段落
  async extractWebpage(url: string): Promise<ExtractResult> {
    const html = await fetch(url);
    const article = readabiliy(html);  // 正文提取
    
    return {
      summary: await llm.summarize(article.text, { maxWords: 100 }),
      keyPoints: await llm.extract(article.text, { type: 'key-points' }),
      fullText: article.text,
      metadata: { title: article.title, wordCount: article.length }
    };
  }
  
  // 文档：按页解析 + 关键页提取
  async extractDocument(filePath: string): Promise<ExtractResult> {
    const pages = await pdfParser(filePath);
    
    return {
      summary: await llm.summarize(pages.map(p => p.text).join('\n')),
      keyPoints: await llm.extract(pages, { type: 'key-pages' }),
      fullText: pages,  // 分页存储，按需加载
      metadata: { pageCount: pages.length }
    };
  }
  
  // 截图：OCR + 视觉理解
  async extractScreenshot(imagePath: string): Promise<ExtractResult> {
    const ocrText = await ocr(imagePath);
    const visualDesc = await visionModel.describe(imagePath);
    
    return {
      summary: visualDesc,
      keyPoints: ocrText.split('\n').filter(Boolean),
      fullText: ocrText,
      metadata: { type: 'image', ocrConfidence: 0.92 }
    };
  }
}
```

## 六、上下文切换与版本保留

当用户切换到另一个任务时，当前上下文不应丢失：

```typescript
// 任务级上下文快照
interface ContextSnapshot {
  taskId: string;
  slots: ContextSlot[];      // 激活的槽位
  timestamp: number;
  tokenCount: number;
}

// 切换任务时自动保存当前上下文快照
function switchTask(newTaskId: string) {
  // 1. 保存当前任务的上下文快照
  saveSnapshot(currentTask);
  
  // 2. 加载目标任务的上下文快照
  const snapshot = loadSnapshot(newTaskId);
  
  // 3. 检查素材是否过期
  for (const slot of snapshot.slots) {
    if (isStale(slot.sourceId)) {
      notify(`素材"${slot.sourceId}"可能已更新，是否重新加载？`);
    }
  }
}
```

## 七、常见坑

- **把所有素材全量塞进prompt**：token爆炸，AI注意力分散，成本飙升
- **来源对象不可见**：用户不知道AI用了哪些素材，无法调试结果不好的原因
- **上下文切换丢失**：切到另一个任务回来，之前的素材引用全没了
- **大对象重复拷贝**：同一个20MB的PDF在多个任务中各存一份，浪费内存
