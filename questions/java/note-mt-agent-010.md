---
id: note-mt-agent-010
difficulty: L2
category: java
subcategory: 并发
tags:
- 美团
- 面经
- Python
- 多线程
- 八股
feynman:
  essence: Python用threading模块创建Thread对象传入目标函数调用start启动但GIL限制了真正并行。
  analogy: 就像厨房只有一个灶台GIL可以雇多个厨师线程但同一时刻只有一个能炒菜。
  first_principle: CPython的GIL使得多线程同一时刻只有一个执行字节码。
  key_points:
  - threading.Thread创建线程
  - start启动join等待
  - GIL限制CPU密集并行
  - IO密集型多线程有意义
  - 继承Thread重写run
first_principle:
  essence: GIL等于CPython实现约束非语言特性
  derivation: CPython引用计数非线程安全GIL保护同一时刻一个线程CPU密集型多线程无效
  conclusion: Python多线程适合IO密集型CPU密集用multiprocessing
follow_up:
- GIL底层原理？
- asyncio和多线程哪个好？
- 如何绕过GIL实现真正并行？
memory_points:
- 核心用法：threading.Thread传target与args，调start()启动，join()阻塞等待
- 避坑指南：因start只能调一次，所以严禁直接调run()（那仅是普通函数执行）
- GIL限制：因GIL同一时刻只允许单线程执行，故多线程仅适合IO密集型任务
- 线程安全：多线程操作共享变量必须加锁，推荐用 with lock 上下文管理自动释放
---

# 【美团面经】Python怎么实现多线程？

## 一、核心回答

Python 通过标准库 `threading` 模块实现多线程。核心用法是创建 `threading.Thread` 对象，传入目标函数，调用 `start()` 启动线程，调用 `join()` 等待线程结束。但由于 CPython 存在 **GIL（全局解释器锁）**，同一时刻只有一个线程能执行 Python 字节码，因此多线程适合 **IO 密集型**任务，CPU 密集型任务需要用 `multiprocessing` 真正并行。

---

## 二、threading 模块基本用法

### 2.1 方式一：传入目标函数（推荐）

```python
import threading
import time

def worker(name, delay):
    for i in range(3):
        print(f"[{name}] 第 {i} 次执行")
        time.sleep(delay)

# 创建线程
t1 = threading.Thread(target=worker, args=("线程A", 0.5))
t2 = threading.Thread(target=worker, args=("线程B", 0.3))

t1.start()   # 启动线程（非阻塞，立即返回）
t2.start()

t1.join()    # 等待线程结束（阻塞主线程）
t2.join()

print("所有线程执行完毕")
```

**关键方法说明：**

| 方法 | 作用 | 是否阻塞 |
|------|------|----------|
| `Thread(target, args)` | 创建线程对象，绑定目标函数 | 否 |
| `start()` | 启动线程，调用 `run()` | 否（异步） |
| `join(timeout)` | 等待线程结束 | 是（阻塞） |
| `is_alive()` | 判断线程是否存活 | 否 |
| `daemon=True` | 设为守护线程，主线程结束即退出 | — |

> ⚠️ **注意**：`start()` 只能调用一次。重复调用会抛 `RuntimeError`。直接调 `run()` 是普通函数调用，不会启动新线程。

### 2.2 方式二：继承 Thread 重写 run

```python
class MyThread(threading.Thread):
    def __init__(self, task_id):
        super().__init__()
        self.task_id = task_id

    def run(self):  # 重写 run 方法
        print(f"Task-{self.task_id} 正在运行")

threads = [MyThread(i) for i in range(3)]
for t in threads:
    t.start()
for t in threads:
    t.join()
```

### 2.3 线程安全与锁

```python
lock = threading.Lock()
counter = 0

def increment():
    global counter
    for _ in range(100000):
        with lock:       # 使用上下文管理器自动加锁/释放
            counter += 1

t1 = threading.Thread(target=increment)
t2 = threading.Thread(target=increment)
t1.start(); t2.start()
t1.join();  t2.join()
print(counter)  # 200000，有锁保证正确性
```

---

## 三、GIL 原理详解

### 3.1 什么是 GIL

**GIL（Global Interpreter Lock）** 是 CPython 解释器中的一把全局互斥锁。它保证**同一时刻只有一个线程在执行 Python 字节码**。

### 3.2 为什么有 GIL

CPython 使用**引用计数**做内存管理，对象的 `ob_refcnt` 字段在多线程下非线程安全。GIL 是最简单的保护方式——加一把全局锁。Jython、IronPython 没有 GIL。

### 3.3 GIL 的释放时机

```
┌──────────────────────────────────────────────────────┐
│                  CPython GIL 调度示意                 │
│                                                      │
│   时间轴 ──────────────────────────────────────►     │
│                                                      │
│   线程A: ████ io等待 ████ 执行 ████ io等待 ████      │
│   线程B:      ────── 等GIL ──── 执行 ──── 等GIL      │
│                                                      │
│   GIL释放时机：                                       │
│   ① IO操作（read/write/socket.recv等）自动释放       │
│   ② 每执行约100条字节码（ticks）检查切换             │
│   ③ Python 3.2+：固定时间片（默认5ms）后强制切换     │
│   ④ C扩展中可手动释放（如numpy计算时）               │
└──────────────────────────────────────────────────────┘
```

### 3.4 GIL 对性能的影响

```
CPU密集型 — 2线程 vs 单线程：

  单线程：  ████████████████████████████  总时间 T
  双线程：  ████GIL██████████████████████  总时间 > T（甚至更慢！）
            ↑ 两个线程抢锁，上下文切换开销使性能不升反降

IO密集型 — 2线程 vs 单线程：

  单线程：  ████io等待██████io等待██████io等待██████
  双线程：  线程A ██等待██等待██等待██
            线程B    ██等待██等待██等待██
            ↑ 等待时释放GIL，另一个线程可以工作，总时间 ≈ T/2
```

---

## 四、IO 密集型 vs CPU 密集型

| 维度 | IO 密集型 | CPU 密集型 |
|------|-----------|------------|
| 瓶颈 | 网络/磁盘等待 | CPU计算 |
| GIL影响 | 小（IO时释放GIL） | 大（无法并行） |
| 推荐方案 | `threading` 或 `asyncio` | `multiprocessing` 或 C扩展 |
| 典型场景 | 爬虫、数据库查询、文件IO | 数值计算、图像处理 |

### 4.1 CPU 密集型正确方案：multiprocessing

```python
from multiprocessing import Pool

def cpu_task(n):
    return sum(i * i for i in range(n))

if __name__ == '__main__':
    with Pool(4) as p:          # 4个进程，真正并行
        results = p.map(cpu_task, [10**7] * 4)
    print(results)
```

### 4.2 IO 密集型方案：线程池

```python
from concurrent.futures import ThreadPoolExecutor
import requests

urls = ["https://example.com/1", "https://example.com/2", "https://example.com/3"]

with ThreadPoolExecutor(max_workers=5) as executor:
    futures = [executor.submit(requests.get, url) for url in urls]
    results = [f.result() for f in futures]
```

---

## 五、面试要点总结

1. **创建线程**：`threading.Thread(target=func, args=()).start()`，`join()` 等待
2. **GIL 本质**：CPython 实现层面的锁，保护引用计数，同一时刻只有一个线程执行字节码
3. **IO 密集型**：多线程有效（IO时释放GIL），如爬虫、网络请求
4. **CPU 密集型**：多线程无效甚至更慢，用 `multiprocessing` 绕过 GIL
5. **替代方案**：`asyncio`（协程，单线程并发IO）、C扩展（numpy等在C层释放GIL）、`concurrent.futures`

## 记忆要点

- 核心用法：threading.Thread传target与args，调start()启动，join()阻塞等待
- 避坑指南：因start只能调一次，所以严禁直接调run()（那仅是普通函数执行）
- GIL限制：因GIL同一时刻只允许单线程执行，故多线程仅适合IO密集型任务
- 线程安全：多线程操作共享变量必须加锁，推荐用 with lock 上下文管理自动释放


## 苏格拉底式面试追问

> 这组追问模拟面试官层层逼问，每一问先回答"为什么"，再回答"怎么做"，最后回答"如何证明"。

### 第一层：目标与动机

**Q：Python 多线程你说 `threading.Thread` 传 target/args，但为什么不推荐继承 Thread 类重写 run？两种方式有本质区别吗？**

两种方式都能创建线程，但"传 target 函数"是组合，"继承 Thread"是继承。组合优于继承的理由：一、Python 是多继承语言，继承 Thread 占用了一个继承位（虽然可以多继承但复杂）；二、传函数更灵活——同一个函数可以给多个 Thread 用（不同参数）、也可以用线程池（ThreadPoolExecutor）执行，继承 Thread 的类只能实例化 Thread 对象；三、关注点分离——线程的"执行逻辑"（函数）和"线程管理"（Thread 类）分离，函数可独立测试。继承 Thread 的合理场景是"需要重写线程的生命周期方法"（如 start 前后做 hook、自定义 is_alive 逻辑），但 99% 场景不需要。所以推荐"传 target"，符合"组合优于继承"的通用设计原则。

### 第二层：证据与定位

**Q：你强调"严禁直接调 run()，要调 start()"，调 run() 会怎样？怎么向面试官演示这个错误？**

`start()` 创建新操作系统线程并在新线程里调 `run()`；直接调 `run()` 是"普通方法调用"，在当前线程同步执行，没有新线程。演示：写一个继承 Thread 的类，`run` 里 `print(threading.current_thread().name)`，`start()` 后打印的是 "Thread-N"（新线程），`run()` 直接调打印的是 "MainThread"（当前线程）。所以"start 只能调一次"（线程已启动再调 start 抛 RuntimeError），run 可以多次调（但只是普通方法）。这个区别是初学者常犯的错误——以为"调 run 就是多线程"，实际是单线程同步执行，完全失去了多线程的意义。

### 第三层：根因深挖

**Q：GIL 你说"同一时刻只允许单线程执行字节码"，但 threading.Thread 创建的线程在操作系统层面是真的多线程吗？**

是的，Python 的 threading.Thread 是真正的操作系统线程（POSIX thread 或 Windows thread）。可以用 `top -H` 或 `ps -eLf` 看到 Python 进程下有多个线程。GIL 是"Python 解释器层的锁"，限制的是"哪个线程能执行 Python 字节码"，不是限制线程的存在。多线程在操作系统调度下都处于"可运行"状态，但抢到 GIL 的才能执行 Python 代码，其他线程在操作系统层面可能 Running（CPU 上跑）但"等待 GIL"（空转或 park）。所以 Python 多线程的代价：一、创建线程有系统开销（线程栈默认 8MB、调度开销）；二、GIL 切换有开销（约微秒级）；三、但 I/O 阻塞时 GIL 释放，线程真正在 I/O 上阻塞，其他线程能执行。所以 Python 多线程"I/O 密集有效、CPU 密集无效"的根源是 GIL 的释放时机，不是线程本身是假线程。

**Q：那为什么 Python 多线程操作共享变量要加锁？不是有 GIL 保护吗？**

GIL 保证"同一时刻只有一个线程执行字节码"，但一条 Python 语句可能对应多条字节码。如 `count += 1` 编译成 LOAD（读 count）、ADD（加 1）、STORE（写 count）三条字节码。GIL 在每条字节码后可能切换（每 100 tick 检查），所以线程 A 执行到 LOAD 和 ADD 之间，GIL 可能切给线程 B，B 也 LOAD 读到旧值，A 和 B 都基于旧值加 1，最终 count 只加了 1（应该加 2）。GIL 保护的是"单条字节码的原子性"，不保护"多字节码组合的原子性"。所以要加锁（threading.Lock）把"读改写"包成临界区。锁的语义是"多字节码的原子性"，GIL 是"单字节码的原子性"，两者层级不同。这是 Python 多线程最常见的坑——以为有 GIL 就线程安全，实际仍要加锁。

### 第四层：方案权衡

**Q：Python 多线程受 GIL 限制，那为什么还有那么多框架（如 Flask、Django）用多线程处理请求？**

因为 Web 请求是"I/O 密集"——大部分时间在等数据库、等下游 API、等网络。GIL 在 I/O 阻塞时释放，所以一个请求等 I/O 时，其他请求的线程能执行 Python 代码。多线程在 Web 场景能提升并发——单线程只能串行处理请求（一个请求等 I/O 时其他请求都阻塞），多线程让多个请求的 I/O 等待重叠。Flask/Django 默认用线程池（如 gunicorn 的 worker）处理请求，每个 worker 内多线程。但要注意"CPU 密集的请求"在多线程下不会加速（GIL 限制），如果业务有 CPU 密集计算（如大 JSON 解析、正则匹配），多线程反而因 GIL 切换变慢。这类场景要异步（asyncio）或多进程。所以 Web 框架用多线程是"I/O 密集场景的合理选择"，不是"无视 GIL"。

**Q：为什么不用 asyncio（协程）替代多线程处理 Web 请求？协程不是更轻量吗？**

协程确实更轻量（单线程内调度，无线程切换开销），但要"全栈 async"——框架（FastAPI、aiohttp）、HTTP 客户端（httpx.AsyncClient）、数据库驱动（asyncpg、aiomysql）都要 async。如果混用同步库（如 requests、pymysql），会在事件循环里阻塞，整个服务卡住。Flask 是同步框架（route 函数是 def 不是 async def），强行用 asyncio 要用 `run_in_executor` 把同步代码丢线程池，复杂度高。Django 3.0+ 支持 async view 但生态仍在迁移。所以"用协程"要看生态——新项目用 FastAPI + async 全栈最优，老项目（Flask/Django 同步生态）保持多线程。我的实践：新项目首选 FastAPI（协程 + 自动文档），老项目维护用 gunicorn + 多线程。

### 第五层：验证与沉淀

**Q：你怎么验证 Python 多线程在 I/O 密集场景真的提升并发，而不是被 GIL 拖累？**

对比实验：一、I/O 密集任务（如 `time.sleep(1)` 模拟网络等待）——单线程串行 10 次 = 10 秒，10 线程并发 ≈1 秒（GIL 在 sleep 时释放，并发有效）；二、CPU 密集任务（如 `sum(range(10**7))`）——单线程 10 次 = 10 秒，10 线程 ≈10 秒（GIL 限制，无加速甚至更慢因切换）；三、混合任务（I/O + CPU）——10 线程比单线程快但不达 10 倍（I/O 部分并发、CPU 部分串行）。验证手段：用 `time.perf_counter()` 计时，用 `py-spy record` 抓火焰图看"GIL 持有时间 vs I/O 等待时间"。线上监控：线程数（`threading.active_count()`）、各线程 CPU 时间（`thread.get_native_id()` + top -H）。这些验证确保"多线程用对了场景"。

**Q：这道题做完，你沉淀出了什么可复用的 Python 并发模式选择经验？**

三场景模式：一、I/O 密集 + 同步库 → 多线程（threading 或 concurrent.futures.ThreadPoolExecutor）；二、I/O 密集 + async 库 → asyncio 协程（单线程高并发）；三、CPU 密集 → 多进程（multiprocessing 或 concurrent.futures.ProcessPoolExecutor）。核心原则："先看任务类型（I/O 还是 CPU），再看库生态（async 还是 sync），最后选并发模式。" 这套模式也适用于其他语言——Java 的 I/O 用线程池、CPU 用 ForkJoinPool、Go 的 goroutine 天然并发（无 GIL 限制）。理解了 GIL 的本质，遇到任何 Python 性能问题都能快速定位"是 GIL 瓶颈还是别的"。


## 结构化回答

**30 秒电梯演讲：** Python用threading模块创建Thread对象传入目标函数调用start启动但GIL限制了真正并行。打个比方，就像厨房只有一个灶台GIL可以雇多个厨师线程但同一时刻只有一个能炒菜。

**展开框架：**
1. **核心用法** — threading.Thread传target与args，调start()启动，join()阻塞等待
2. **避坑指南** — 因start只能调一次，所以严禁直接调run()（那仅是普通函数执行）
3. **GIL限制** — 因GIL同一时刻只允许单线程执行，故多线程仅适合IO密集型任务

**收尾：** 这块我踩过坑——要不要深入聊：GIL底层原理？

## 视频脚本

> 预计时长：2 分钟 | 由浅入深

| 时间 | 画面/字幕 | 口播台词 | 讲解要点 |
|------|----------|----------|----------|
| 0:00 | 标题卡 | "并发一句话：Python用threading模块创建Thread对象传入目标函数调用start启动但GIL限…。" | 开场钩子 |
| 0:15 | IO 模型对比图 | "核心用法：threading.Thread传target与args，调start()启动，join()阻塞等待" | 核心用法 |
| 1:02 | IO 模型对比图分步演示 | "避坑指南：因start只能调一次，所以严禁直接调run()（那仅是普通函数执行）" | 避坑指南 |
| 1:50 | 总结卡 | "核心抓住这条主线，下期咱们接着聊：GIL底层原理。" | 收尾 |
