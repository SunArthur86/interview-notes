---
id: note-bd4-001
difficulty: L3
category: ai
subcategory: Agent
tags:
  - 字节
  - 面经
  - Golang
  - goroutine
feynman:
  essence: "GMP是Go运行时的协程调度模型，goroutine泄漏是指协程被阻塞后永远无法退出，导致内存和调度资源持续增长"
  analogy: "GMP就像一个出租车调度中心：G是乘客，M是出租车，P是发车牌（同时只能有GOMAXPROCS辆车在运营）。泄漏就像乘客上了车却永远到不了目的地，车就一直被占着"
  first_principle: "Go调度的本质是在用户态实现M:N线程模型，用少量OS线程承载海量协程，通过P的本地队列减少锁竞争"
  key_points:
    - 'G (Goroutine): 用户协程，存储栈和状态'
    - 'M (Machine): OS线程，真正执行代码'
    - 'P (Processor): 逻辑处理器，持有本地G队列，数量=GOMAXPROCS'
    - 'Work Stealing: 空闲P从其他P的队列尾部偷取一半G'
    - '泄漏原因: channel无接收者、context未取消、mutex死锁'
first_principle:
  essence: "调度器的核心目标是在有限OS线程上最大化CPU利用率"
  derivation: "线程切换成本高(~1μs) → 用户态协程切换成本低(~100ns) → 用P的本地队列避免全局锁 → 用work stealing实现负载均衡"
  conclusion: "GMP通过分层调度(本地队列+全局队列+work stealing)实现了高效的多对一映射"
follow_up:
  - "GOMAXPROCS设置过大会出现什么问题？"
  - "如何用pprof定位goroutine泄漏？"
  - "sysmon线程的作用是什么？"
---

# Golang 的 GMP 调度模型是什么？什么情况下会造成 goroutine 泄漏？

## GMP 调度模型

```
┌─────────────────────────────────────────────┐
│              Go Runtime Scheduler            │
│                                             │
│   ┌─────┐ ┌─────┐ ┌─────┐                  │
│   │ P_0 │ │ P_1 │ │ P_2 │  ← GOMAXPROCS=3  │
│   │[G G]│ │[G G]│ │[G]  │  本地队列(256)    │
│   └──┬──┘ └──┬──┘ └──┬──┘                  │
│      │       │       │                      │
│   ┌──▼──┐ ┌──▼──┐ ┌──▼──┐                  │
│   │ M_0 │ │ M_1 │ │ M_2 │  ← OS线程        │
│   └──┬──┘ └──┬──┘ └──┬──┘                  │
│      │       │       │                      │
│   ┌──▼──┐ ┌──▼──┐ ┌──▼──┐                  │
│   │Core0│ │Core1│ │Core2│  ← CPU核心       │
│   └─────┘ └─────┘ └─────┘                  │
│                                             │
│   全局队列 (Global Queue): [G] [G] [G]      │
│   ↕ Work Stealing: 空闲P从其他P偷一半G      │
└─────────────────────────────────────────────┘
```

### 三大核心组件

| 组件 | 全称 | 职责 | 数量 |
|------|------|------|------|
| **G** | Goroutine | 用户协程，包含栈、指令指针、状态 | 海量(百万级) |
| **M** | Machine | OS线程，真正执行G的代码 | 动态创建/回收 |
| **P** | Processor | 逻辑处理器，持有本地G队列和缓存 | GOMAXPROCS(默认=CPU核数) |

### 调度流程

1. **创建G**：`go func()` → G被放入当前P的本地队列(满了则放全局队列)
2. **获取G**：M从绑定的P的本地队列取G执行
3. **Work Stealing**：P本地队列空了 → 先从全局队列取 → 再从其他P偷一半
4. **系统调用**：G发起阻塞syscall → M和P解绑 → P找新M继续调度 → syscall返回后M尝试获取P，没有则G放全局队列、M休眠
5. **网络轮询**：`netpoller` 异步处理网络IO，不阻塞M

## Goroutine 泄漏

### 什么是泄漏

goroutine启动后因某种原因永远阻塞，无法退出，占用内存和调度资源。

### 常见泄漏场景及修复

```go
// 1. channel无接收者 — 最常见
func leak1() {
    ch := make(chan int) // 无缓冲channel
    go func() {
        ch <- 42 // 永久阻塞：没有接收者
    }()
    // 函数返回后，goroutine永远卡在这里
}

// ✅ 修复：使用缓冲channel或context
func fixed1(ctx context.Context) {
    ch := make(chan int, 1) // 缓冲为1，写入不阻塞
    go func() {
        select {
        case ch <- 42:
        case <-ctx.Done():
            return
        }
    }()
}

// 2. select缺少ctx分支
func leak2() {
    for {
        select {
        case <-time.After(5 * time.Second):
            // 如果永远等不到，goroutine永远不退出
        }
    }
}

// ✅ 修复：加context取消
func fixed2(ctx context.Context) {
    for {
        select {
        case <-time.After(5 * time.Second):
        case <-ctx.Done():
            return // 可以被外部取消
        }
    }
}

// 3. WaitGroup使用错误
func leak3() {
    var wg sync.WaitGroup
    for i := 0; i < 10; i++ {
        wg.Add(1)
        go func() {
            // 忘记写 wg.Done()
            // wg.Wait() 永远不会返回
        }()
    }
    wg.Wait() // 死锁
}
```

### 排查工具

```bash
# 使用 pprof 查看goroutine数量
import _ "net/http/pprof"

go tool pprof http://localhost:8080/debug/pprof/goroutine
# 输出会显示每个goroutine的调用栈，可定位阻塞位置

# 或使用 runtime.NumGoroutine() 监控
fmt.Println("goroutine count:", runtime.NumGoroutine())
```

## 面试加分点

- **sysmon线程**：独立于GMP的监控线程，负责抢占长时间运行的G(>10ms)、触发GC、回收闲置M
- **P的mcache**：每个P有独立的mcache，小对象分配无需加锁，这是Go高性能分配的关键
- **GOMAXPROCS过大**：P过多 → M过多 → OS线程过多 → 上下文切换开销激增 + cache miss增加
