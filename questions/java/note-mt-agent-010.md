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
