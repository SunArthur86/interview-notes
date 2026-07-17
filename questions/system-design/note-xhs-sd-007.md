---
id: note-xhs-sd-007
difficulty: L4
category: system-design
subcategory: 高并发
tags:
- SSE
- 流式响应
- 断线重连
- AI流式
- EventSource
feynman:
  essence: SSE是服务器单向推送的HTTP长连接协议，浏览器原生支持自动重连。断线重连的关键是Last-Event-ID机制——客户端记住最后收到的消息序号，重连时告诉服务端从哪里继续。
  analogy: "SSE像打电话时对方给你念文章（你只能听不能说）。如果电话断了，你重拨时说「我上次听到第3段了，从第4段继续念」（Last-Event-ID）。如果AI还在生成后面的内容，正好接着念。"
  key_points:
  - SSE=HTTP长连接+单向推送，浏览器EventSource自动重连
  - 每个事件带id字段，重连时浏览器自动发Last-Event-ID头
  - 服务端用SseEmitter(Spring)/text/event-stream实现
  - 断线重连核心：Redis缓存事件+seq序号+从断点重放
  - Nginx需proxy_buffering off + 长超时配置
first_principle:
  problem: "AI大模型生成是逐token流式的，网络不稳定可能导致连接中断，如何保证用户看到完整结果？"
  axioms:
  - SSE基于HTTP，不需要特殊协议升级（比WebSocket简单）
  - 浏览器EventSource原生支持自动重连和Last-Event-ID
  - 断线重连需要服务端有事件历史缓存才能从断点恢复
  - 幂等性保证：去重防止重连后重复显示
  rebuild: "从AI流式输出需求出发：LLM SSE流式→服务端SSE代理→每个chunk带seq→Redis缓存事件→客户端记录Last-Event-ID→断线自动重连→服务端从Redis重放历史+继续接收新内容"
follow_up:
- SSE 在 Nginx 反向代理时需要注意什么配置？
- AI流式输出如何在服务端做缓存（断线重连时不重新生成）？
- SSE 和 WebSocket 在AI流式场景下各有什么优劣？
- 如何实现SSE的多设备同步（同一个对话在手机和电脑上看）？
---

# AI应用中 SSE 流式响应如何设计断线重连？（入职Java复盘）

## 一、SSE（Server-Sent Events）基础

```
SSE = 服务器单向推送 + HTTP长连接

客户端                    服务器
  │                         │
  │ ── GET /api/chat ──→    │
  │                         │
  │ ←─ Content-Type:        │
  │     text/event-stream   │
  │                         │
  │ ←─ data: 你好           │  (逐字推送)
  │ ←─ data: ，我           │
  │ ←─ data: 是AI           │
  │ ←─ data: [DONE]         │  (结束标记)
  │                         │
```

**SSE vs WebSocket vs Streaming HTTP**：

| 特性 | SSE | WebSocket | Chunked HTTP |
|------|-----|-----------|-------------|
| 方向 | 服务器→客户端（单向） | 双向 | 服务器→客户端 |
| 协议 | HTTP | WebSocket | HTTP |
| 自动重连 | ✅ 浏览器内置 | ❌ 需手动 | ❌ |
| 适合场景 | AI流式输出 | 聊天/协同 | 大文件下载 |
| 复杂度 | 低 | 高 | 低 |

## 二、SSE 协议格式

```
HTTP/1.1 200 OK
Content-Type: text/event-stream
Cache-Control: no-cache
Connection: keep-alive

id: 1                          ← 事件ID（用于断线重连）
event: message                  ← 事件类型（可选）
data: {"text": "你好", "done": false}

id: 2
data: {"text": "，我是AI", "done": false}

id: 3
data: {"text": "", "done": true}

```

**关键**：每个事件块用 `\n\n` 分隔。`id` 字段记录事件序号，用于断线重连时告知服务器「上次收到到哪里」。

## 三、服务端实现（Spring Boot）

```java
@RestController
@RequestMapping("/api/chat")
public class ChatSSEController {
    
    @Autowired
    private AIChatService aiChatService;
    
    @GetMapping(produces = MediaType.TEXT_EVENT_STREAM_VALUE)
    public SseEmitter chat(@RequestParam String prompt,
                          @RequestHeader(value = "Last-Event-ID", 
                                        required = false) String lastEventId) {
        // 超时设置5分钟（AI生成可能很慢）
        SseEmitter emitter = new SseEmitter(300_000L);
        
        // 从断点恢复
        int startSeq = lastEventId != null ? Integer.parseInt(lastEventId) : 0;
        
        aiChatService.streamChat(prompt, startSeq, new ChatCallback() {
            private int seq = startSeq;
            
            @Override
            public void onChunk(String chunk) throws IOException {
                seq++;
                // 发送带id的SSE事件（客户端断线重连时用）
                emitter.send(SseEmitter.event()
                    .id(String.valueOf(seq))
                    .data(Map.of("text", chunk, "done", false)));
            }
            
            @Override
            public void onComplete() throws IOException {
                seq++;
                emitter.send(SseEmitter.event()
                    .id(String.valueOf(seq))
                    .data(Map.of("text", "", "done", true)));
                emitter.complete();
            }
            
            @Override
            public void onError(Throwable e) {
                emitter.completeWithError(e);
            }
        });
        
        return emitter;
    }
}
```

## 四、断线重连方案（核心考点）

### 浏览器原生 EventSource

```javascript
// 浏览器 EventSource 自动重连！
const eventSource = new EventSource('/api/chat?prompt=你好');

eventSource.onmessage = (event) => {
    const data = JSON.parse(event.data);
    if (data.done) {
        eventSource.close();
    } else {
        appendToUI(data.text);  // 逐字显示
    }
};

// ⚠️ 浏览器自动处理：
// 1. 连接断开后自动重连（默认3秒）
// 2. 重连时自动携带 Last-Event-ID 头
// 3. Last-Event-ID = 最后收到的id字段值
```

### 自定义重连（fetch + ReadableStream）

```javascript
async function streamChat(prompt, lastEventId = 0) {
    try {
        const response = await fetch('/api/chat', {
            headers: { 'Last-Event-ID': lastEventId.toString() }
        });
        
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        
        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            
            const text = decoder.decode(value);
            // 解析SSE格式
            const events = parseSSE(text);
            for (const event of events) {
                lastEventId = event.id;
                appendToUI(event.data);
            }
        }
    } catch (error) {
        // 断线重连（带Last-Event-ID）
        console.log('Connection lost, reconnecting...');
        setTimeout(() => streamChat(prompt, lastEventId), 3000);
    }
}
```

## 五、断线重连的完整架构

```
┌────────────────────────────────────────────────────┐
│                    客户端                            │
│  ┌──────────────────────────────────────────┐      │
│  │  EventSource / Fetch                     │      │
│  │  ┌─────────────────────┐                 │      │
│  │  │ Last-Event-ID 缓存   │ ← 记住最后收到的id │      │
│  │  └─────────────────────┘                 │      │
│  └────────────────┬─────────────────────────┘      │
└───────────────────┼────────────────────────────────┘
                    │
                    ▼ 断线重连（携带 Last-Event-ID: 42）
┌────────────────────────────────────────────────────┐
│                    服务端                            │
│  ┌─────────────┐  ┌──────────────┐                 │
│  │ SSE Endpoint │←→│ 事件存储(Redis)│ ← 缓存AI生成   │
│  │              │  │ seq → content │   的历史片段    │
│  └──────┬──────┘  └──────────────┘                 │
│         │                                           │
│         ▼                                           │
│  ┌─────────────┐  ┌──────────────┐                 │
│  │ AI网关       │→ │ LLM API      │                 │
│  │ (流式代理)   │  │ (SSE Stream) │                 │
│  └─────────────┘  └──────────────┘                 │
└────────────────────────────────────────────────────┘

断线重连流程：
  1. 客户端记录最后收到的 event.id = 42
  2. 断线后发起重连：GET /api/chat?resumeFrom=42
  3. 服务端从Redis读取 seq > 42 的缓存片段，快速重放
  4. 然后继续接收LLM新生成的内容
```

## 六、面试加分点

```
1. 事件缓存：用Redis缓存SSE事件（TTL 5分钟），断线重连时快速重放
2. 幂等设计：每个chunk带唯一seq，客户端去重防止重复显示
3. 超时处理：AI生成超过3分钟 → 转异步任务 + 通知
4. 压缩传输：SSE支持gzip压缩，减少带宽
5. Nginx配置：proxy_buffering off 开启流式透传
6. 多设备同步：同一会话多设备连接，用Redis Pub/Sub广播
```
## 苏格拉底式面试追问

> 这组追问模拟面试官层层逼问，每一问先回答"为什么"，再回答"怎么做"，最后回答"如何证明"。

### 第一层：目标与动机

**Q：AI 流式输出你为什么选 SSE 而不是 WebSocket？**

因为 SSE 更简单且够用。AI 对话是"服务端推送、客户端只接收"的单向场景，SSE 基于普通 HTTP（不需要协议升级），浏览器原生 EventSource 自动重连 + Last-Event-ID 机制，服务端用 Spring 的 SseEmitter 几行代码实现。WebSocket 是双向通信（客户端也能发），协议升级（Upgrade: websocket）更复杂，而且 WebSocket 的断线重连要自己实现（没有 Last-Event-ID）。决策依据：单向推送场景用 SSE，双向交互（如多人协作、游戏）用 WebSocket。AI 流式是典型的单向推送，SSE 是最简方案。

### 第二层：证据与定位

**Q：用户反馈"AI 回答断了一半，重连后从头开始念"，你怎么定位是 Last-Event-ID 没传还是服务端没缓存？**

查两端：
1. 客户端——浏览器重连时的请求头是否带 `Last-Event-ID: 42`。如果没带，是客户端没记录最后的事件 ID（EventSource 自动带，但如果自定义实现可能遗漏）。
2. 服务端——重连请求是否正确处理 Last-Event-ID。如果服务端忽略了它从头重放，是服务端逻辑 bug。如果服务端从 ID 42 重放但 Redis 里没有缓存（过期了），是缓存 TTL 太短。

### 第三层：根因深挖

**Q：客户端带了 Last-Event-ID: 42，服务端也处理了，但重放的内容和之前重复了（用户看到重复 token），根因是什么？**

最可能是事件序号（seq）设计有 off-by-one 错误。Last-Event-ID: 42 表示"客户端最后收到的是 ID 42"，服务端应该从 ID 43 开始重放。如果服务端从 ID 42 开始重放（包含 42），ID 42 的内容会重复显示。根因是重放逻辑的边界错误——应该是"从 Last-Event-ID + 1 开始"而非"从 Last-Event-ID 开始"。另一种可能是 AI 生成的内容被重新生成了（重连后服务端重新调 LLM，生成了新内容），而非从缓存重放——要确认重连走的是"缓存重放"而非"重新生成"。

**Q：为什么不直接让客户端自己缓存已收到的内容，断线重连后客户端拼上缓存 + 继续接收，不依赖服务端重放？**

因为客户端缓存不可靠。① 浏览器刷新或关闭后缓存丢失，用户重新打开对话看到一半的回答，无法恢复；② 多设备同步（手机看一半，电脑接着看）时客户端缓存不跨设备；③ 客户端缓存只解决"拼接显示"，不解决"服务端是否继续生成"——如果服务端在断线后停止了 LLM 生成，重连后没有新内容可发。服务端缓存 + 重放是权威方案——服务端知道"生成到哪了"和"发给客户端到哪了"，重连时精准恢复。

### 第四层：方案权衡

**Q：断线重连你用 Redis 缓存事件，但如果 LLM 生成很慢（几十秒），Redis 缓存的 TTL 设多久？**

设 LLM 生成总时长的上限 + 余量。LLM 流式生成一般 10-60 秒，Redis 缓存 TTL 设 5-10 分钟（覆盖生成 + 断线重连窗口）。TTL 太短（如 30 秒），用户断线后过一会重连，缓存已过期，无法重放，只能重新生成（浪费 token 费用）。TTL 太长（如 1 小时），Redis 内存浪费（每个对话的事件缓存几 KB，万级并发 = 几十 GB）。权衡：TTL = LLM 生成上限 × 10，5-10 分钟是经验值。也可以用"对话结束时主动删除缓存"（生成完成后发事件通知，客户端确认收到后删 Redis）。

**Q：为什么不直接把整个 AI 对话存 DB（不依赖 Redis 缓存），重连时从 DB 读历史？**

因为延迟。DB 查询 5-10ms，而 SSE 重连要求"瞬间恢复"（用户重连后立即看到内容继续输出）。DB 查询 + 反序列化 + 重放，延迟几十毫秒，用户能感知到卡顿。而且 DB 写入是持久化（每次 SSE 推一个 token 就写 DB，高频率写入打挂 DB）。Redis 是"会话级临时缓存"（TTL 几分钟，高吞吐低延迟），DB 是"持久化存储"（对话结束后归档）。重连用 Redis（快），历史查询用 DB（全量）。两者分工，不是二选一。

### 第五层：验证与沉淀

**Q：你怎么证明断线重连机制可靠（任何断线都能恢复）？**

混沌测试：
1. 主动断线——在 AI 流式输出过程中，用 Nginx 主动切断连接（模拟网络抖动），观察客户端是否自动重连 + 从断点继续。
2. 各种断线时机——在生成的 10%、50%、90% 处分别断线，验证重连后的内容完整性（无丢失无重复）。
3. 极端场景——重连时服务端正在重启（Pod 滚动更新），验证重连路由到新实例后能否从 Redis 恢复。

**Q：SSE 断线重连方案怎么沉淀？**

1. SSE 框架封装——把"事件序号 + Redis 缓存 + Last-Event-ID 重放 + 幂等去重"封装成通用 SSE 组件，其他流式场景（实时通知、股票行情）复用。
2. 监控指标——SSE 连接数、平均连接时长、断线重连率、重连成功率，重连失败告警。
3. Nginx 配置规范——`proxy_buffering off`、`proxy_read_timeout 300s`、`proxy_http_version 1.1`，写入运维规范，避免 Nginx 默认配置导致 SSE 失效。


## 结构化回答

**30 秒电梯演讲：** SSE是服务器单向推送的HTTP长连接协议，浏览器原生支持自动重连。断线重连的关键是Last-Event-ID机制——客户端记住最后收到的消息序号，重连时告诉服务端从哪里继续。

**展开框架：**
1. **SSE=HTTP长连接** — SSE=HTTP长连接+单向推送，浏览器EventSource自动重连
2. **每个事件带id字段** — 每个事件带id字段，重连时浏览器自动发Last-Event-ID头
3. **服务端用** — 服务端用SseEmitter(Spring)/text/event-stream实现

**收尾：** 这块我踩过坑——要不要深入聊：SSE 在 Nginx 反向代理时需要注意什么配置？

## 视频脚本

> 预计时长：4 分钟 | 由浅入深

| 时间 | 画面/字幕 | 口播台词 | 讲解要点 |
|------|----------|----------|----------|
| 0:00 | 标题卡 | "高并发一句话：SSE是服务器单向推送的HTTP长连接协议，浏览器原生支持自动重连。断线重连的关键是Last-Event-ID机制——客户端记住最后收到的消息序号…。" | 开场钩子 |
| 0:15 | Redis Lua 脚本执行截图 | "SSE就是HTTP长连接+单向推送，浏览器EventSource自动重连" | SSE=HTTP长连接 |
| 1:08 | Redis Lua 脚本执行截图分步演示 | "每个事件带id字段，重连时浏览器自动发Last-Event-ID头" | 每个事件带id字段 |
| 2:01 | 关键代码/伪代码片段 | "服务端用SseEmitter(Spring)/text/event-stream实现" | 服务端用 |
| 2:54 | 对比表格 | "断线重连核心：Redis缓存事件+seq序号+从断点重放" | 断线重连核心 |
| 3:50 | 总结卡 | "核心抓住这条主线，下期咱们接着聊：SSE 在 Nginx 反向代理时需要注意什么配置。" | 收尾 |
