---
id: note-xhs-fe-001
difficulty: L3
category: frontend
subcategory: 性能
tags:
- 前端
- SSE
- 流式渲染
- Web Worker
- 性能优化
- AI对话
- 面经
feynman:
  essence: AI对话产品的SSE流式渲染如果在前端主线程处理，每个token到达都触发DOM更新，会导致Long Task和FPS骤降。优化核心是把渲染逻辑移到Web Worker，主线程只负责接收Buffer，用RequestAnimationFrame做节流。
  analogy: 就像流水线包饺子——你一个人又接面又包又煮（主线程做所有事），手忙脚乱。优化是分工：一个人专门接面（Worker接收数据），一个人按节奏包（RAF节流渲染），一个人煮（主线程绘制）。
  key_points:
  - 问题根因：每来一个token就setState→重渲染→Long Task→掉帧
  - Web Worker接收数据流，主线程不阻塞
  - RAF(RequestAnimationFrame)做节流，不满一帧不刷
  - ReadableStream Buffer模式，批量更新而非逐个更新
  - 断线处理：Last-Event-ID续传+UI淡入过渡让用户无感知
first_principle:
  essence: AI流式渲染 = 高频数据更新 + DOM重绘的矛盾，解法是将数据接收和UI渲染解耦
  derivation: SSE每秒推送几十个token→每次都触发React重渲染→主线程被占满→FPS掉到20→卡顿→将数据接收放到Worker→主线程用RAF按帧率刷新→60FPS稳定
  conclusion: 架构上分离"接收"和"渲染"，技术上用Worker+RAF+Buffer实现帧率控制
follow_up:
- Web Worker能否直接操作DOM？（不能，需要postMessage通信）
- SSE和WebSocket在AI流式场景哪个更好？（SSE更轻量，单向推送够用）
- 如何处理SSE断线重连的体验？（Last-Event-ID续传+淡入动画）
- 大文本渲染（200万字PDF）有什么优化方案？（Segment Tree+Canvas覆盖层）
memory_points:
- 核心矛盾：SSE高频推送 + DOM逐次渲染 = Long Task + FPS骤降
- 三招优化：Web Worker接收 → RAF节流渲染 → ReadableStream Buffer批量更新
- 每个token触发一次setState是性能杀手 → 改为Buffer累积+RAF按帧刷新
- 断线体验：Last-Event-ID续传 + 0.1s淡入过渡 → 用户无感知
- 面试工程思维："用户体验无感知"比"网络错误弹窗"高一个层次
---

# 【前端面试】AI 对话产品中 SSE 流式渲染如何优化？前端主线程被堵塞怎么解决？

> 来源：小红书"我们组新来的AI前端Leader"技术分享

## 一、问题分析——为什么主线程会堵

```
传统做法（每个token触发一次渲染）

AI Server ──SSE──► 前端主线程
  token1 ──►  setState("你")  ──► React重渲染 ──► DOM更新
  token2 ──►  setState("你好") ──► React重渲染 ──► DOM更新
  token3 ──►  setState("你好，")──► React重渲染 ──► DOM更新
  ...每秒30-50个token...
  
主线程被占满 → Long Task → FPS从60掉到20 → 卡顿！
```

```
Performance 火焰图对比

传统做法（主线程渲染）:
主线程 ████████████████████████████████  ← 被渲染占满
       [Long Task 200ms] [Long Task 150ms]...
FPS: ████████░░░░░░░░██░░░░░░░░  (20-30 FPS，卡顿)

优化后（Worker+RAF）:
Worker ████████████████████████████████  ← 接收数据
主线程 ███░░░███░░░███░░░███░░░███░░░    ← 按帧渲染
FPS:   ████████████████████████████████  (稳定60 FPS)
```

## 二、优化方案一：Web Worker + RAF 节流

```
┌──────────────────────────────────────────────────┐
│                 优化架构                           │
├──────────────────────────────────────────────────┤
│                                                   │
│  AI Server                                        │
│     │ SSE                                         │
│     ▼                                             │
│  ┌─────────────┐     postMessage     ┌─────────┐ │
│  │ Web Worker  │ ──────────────────► │  主线程  │ │
│  │             │   (批量Buffer)      │         │ │
│  │ 接收token   │                     │ RAF     │ │
│  │ 累积Buffer  │                     │ 按帧渲染 │ │
│  │             │                     │ DOM更新  │ │
│  └─────────────┘                     └─────────┘ │
│                                                   │
│  Worker：高频接收数据，累积到Buffer                │
│  主线程：RAF按帧率(60fps)取Buffer渲染             │
│                                                   │
└──────────────────────────────────────────────────┘
```

```javascript
// === Web Worker (stream-worker.js) ===
let buffer = '';

self.onmessage = async (e) => {
    if (e.data.type === 'start') {
        const response = await fetch(e.data.url, {
            method: 'POST',
            body: JSON.stringify(e.data.payload),
            headers: { 'Content-Type': 'application/json' }
        });
        
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        
        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            
            // 累积token到Buffer
            buffer += decoder.decode(value, { stream: true });
            
            // 通知主线程有新数据（但不强制渲染）
            postMessage({ type: 'update', text: buffer });
        }
        
        postMessage({ type: 'done', text: buffer });
    }
};

// === 主线程 ===
class StreamRenderer {
    constructor() {
        this.displayText = '';
        this.targetText = '';
        this.worker = new Worker('stream-worker.js');
        
        // Worker发来的数据只更新target，不直接渲染
        this.worker.onmessage = (e) => {
            if (e.data.type === 'update') {
                this.targetText = e.data.text;
                // 不在这里setState！等RAF回调统一渲染
            }
        };
        
        // RAF按帧率渲染（60fps = 每16ms一次）
        this.render();
    }
    
    render() {
        if (this.displayText !== this.targetText) {
            // 只在帧间隔时更新DOM
            this.displayText = this.targetText;
            this.updateDOM(this.displayText);
        }
        requestAnimationFrame(() => this.render());
    }
    
    updateDOM(text) {
        const el = document.getElementById('ai-output');
        el.textContent = text;
        // 自动滚动到底部
        el.scrollTop = el.scrollHeight;
    }
}
```

## 三、优化方案二：SSE 断线无感续传

```
┌────────────────────────────────────────────────┐
│           断线续传体验设计                       │
├────────────────────────────────────────────────┤
│                                                 │
│  SSE连接正常                                     │
│  AI正在输出: "你好，我是一个AI助手..."            │
│                                                 │
│  突然网络断开 ❌                                 │
│  │                                              │
│  ├── 传统做法：                                  │
│  │   弹Toast: "网络错误"  ← 用户感知到系统崩溃    │
│  │                                             │
│  ├── 工程化做法：                                │
│  │   1. UI做0.1s淡入过渡 ← 让用户以为是网络抖动   │
│  │   2. 用Last-Event-ID自动重连                  │
│  │   3. 续续输出，用户无感知                      │
│  │                                             │
└────────────────────────────────────────────────┘
```

```javascript
class SSEManager {
    constructor(url, onMessage) {
        this.url = url;
        this.onMessage = onMessage;
        this.lastEventId = null;
        this.connect();
    }
    
    connect() {
        // EventSource原生支持Last-Event-ID
        const eventSource = new EventSource(
            this.url + (this.lastEventId ? `?lastId=${this.lastEventId}` : '')
        );
        
        eventSource.onmessage = (event) => {
            this.lastEventId = event.lastEventId;
            this.onMessage(event.data);
        };
        
        eventSource.onerror = () => {
            eventSource.close();
            // 指数退避重连
            setTimeout(() => this.connect(), 1000);
        };
    }
}

// 服务端需支持Last-Event-ID续传
// GET /api/chat/stream?lastId=123
// → 从ID=123之后的消息开始推送
```

## 四、进阶优化——大文本渲染

```
200万字PDF渲染场景

传统DOM方案（会爆内存）:
┌──────────────────────────────────┐
│ DOM Tree                          │
│ <div>                             │
│   <span>字1</span>               │
│   <span>字2</span>               │
│   ... 200万个Text Node            │ ← 内存爆炸！
│   <span>字200万</span>            │
│ </div>                            │
└──────────────────────────────────┘

优化方案：Segment Tree + Canvas覆盖层
┌──────────────────────────────────┐
│ DOM：只负责排版结构（章节/段落）    │ ← 轻量
│                                   │
│ Canvas：高亮/选中/标注画在上面     │ ← 不创建Text Node
│                                   │
│ Segment Tree：索引段落位置         │ ← 快速定位
│ → 只渲染可视区域的内容              │
└──────────────────────────────────┘
```

## 五、面试加分点

1. **工程思维**："用户体验无感知"比"弹Toast报错"高一个层次——这是区分初级和高级前端的关键
2. **数据接收和渲染解耦**：核心架构思想，Worker接收+RAF渲染+Buffer批量更新
3. **能说出具体数字**：FPS从20回到60，TTFB（首字延迟）能压到200ms以内
4. **端云协同成本意识**：提到"100万DAU全走云端API一年几千万，简单意图放端侧WebGPU跑1B量化模型"
5. **不只是SSE**：能延伸到ReadableStream、WebGPU端侧推理等前沿方案
