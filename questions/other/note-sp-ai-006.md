---
id: note-sp-ai-006
difficulty: L2
category: other
subcategory: 操作系统
tags:
- Shopee
- 面经
- Python
- GIL
- 并发
feynman:
  essence: GIL是CPython的全局解释器锁，同一时刻只允许一个线程执行Python字节码
  analogy: GIL像一个办公室只有一间会议室——虽然有很多员工(线程)，但同一时间只有一个人能用会议室(CPU)
  first_principle: CPython内存管理不是线程安全的(引用计数)，用GIL做最粗粒度的互斥保证安全
  key_points:
  - GIL是CPython特有的，同一时刻只有一个线程执行字节码
  - 进程是资源分配最小单位，独立内存可利用多核
  - 线程共享内存但受GIL限制不能并行CPU
  - 协程是用户态轻量线程，适合高并发IO
first_principle:
  essence: Python的并发模型选择取决于任务是CPU密集还是IO密集
  derivation: CPU密集→GIL限制→用多进程。IO密集→等待时释放GIL→用多线程或协程
  conclusion: CPU密集用multiprocessing，IO密集用asyncio/多线程
follow_up:
- GIL能被移除吗？PEP 703是什么？
- 多线程在Python中什么时候有用？
- asyncio和线程池的区别？
memory_points:
- GIL本质是全局锁：因为保护引用计数，所以同一时刻仅单线程执行Python字节码。
- 场景对比：CPU密集多进程绕GIL，而IO密集多线程/协程遇阻塞会自动释放GIL。
- 概念对比：进程资源独立开销大，线程共享内存受GIL限，协程极轻量单线程内并发。
---

# Python的GIL是什么？什么是进程？什么是协程？

## GIL（全局解释器锁）

```
┌──────────────────────────────────────────────┐
│            CPython 进程                      │
│  ┌──────────────────────────────────────┐    │
│  │              GIL                      │    │
│  │   ┌──────┐  ┌──────┐  ┌──────┐      │    │
│  │   │Thread│  │Thread│  │Thread│      │    │
│  │   │  1   │  │  2   │  │  3   │      │    │
│  │   └──┬───┘  └──┬───┘  └──┬───┘      │    │
│  │      │         │         │           │    │
│  │   持有GIL    等待GIL   等待GIL       │    │
│  │   执行中     阻塞      阻塞          │    │
│  └──────────────────────────────────────┘    │
│                                               │
│  同一时刻只有持有GIL的线程在执行字节码         │
└──────────────────────────────────────────────┘
```

### GIL的影响

| 场景 | GIL影响 | 推荐方案 |
|------|---------|---------|
| **CPU密集型**（计算） | ❌ 多线程无法并行 | multiprocessing |
| **IO密集型**（网络/文件） | ✅ IO时释放GIL | 多线程/asyncio |
| **C扩展**（NumPy等） | ✅ 可手动释放GIL | C扩展不受限 |

### GIL为什么存在？

```python
# Python对象的引用计数不是线程安全的
a = MyObject()    # refcount = 1
b = a             # refcount = 2 ← 线程安全问题！

# 线程A: refcount++ 
# 线程B: refcount++ 
# 如果不加锁 → 可能都读到旧值 → refcount错误 → 内存泄漏或提前回收

# GIL是最简单的解决方案：一把锁保护所有Python对象
# 代价：多线程不能真正并行执行Python代码
```

## 进程 vs 线程 vs 协程

```
┌─────────────┬──────────────┬──────────────┐
│    进程      │     线程      │     协程      │
├─────────────┼──────────────┼──────────────┤
│ 资源分配单位  │ CPU调度单位   │ 用户态轻量线程 │
│ 独立内存空间  │ 共享进程内存   │ 共享线程内存   │
│ 创建开销大    │ 创建开销中     │ 创建开销极小   │
│ 可利用多核    │ Python受GIL限 │ 单线程内并发   │
│ 进程间通信复杂│ 线程间通信简单 │ 协程间通信简单 │
├─────────────┼──────────────┼──────────────┤
│ 适合CPU密集  │ 适合IO密集    │ 适合高并发IO   │
│ multiprocessing│ threading   │ asyncio      │
└─────────────┴──────────────┴──────────────┘
```

### 进程（Process）

```python
from multiprocessing import Process

def worker(num):
    result = num ** 2  # CPU密集计算
    print(f"Process {num}: {result}")

# 每个进程独立内存，真正并行（不受GIL限制）
processes = []
for i in range(4):
    p = Process(target=worker, args=(i,))
    processes.append(p)
    p.start()

for p in processes:
    p.join()
```

### 线程（Thread）

```python
import threading

def fetch_url(url):
    response = requests.get(url)  # IO操作，释放GIL
    print(f"Got {url}: {len(response.text)}")

# 多线程适合IO密集任务
threads = []
for url in urls:
    t = threading.Thread(target=fetch_url, args=(url,))
    threads.append(t)
    t.start()

for t in threads:
    t.join()
```

### 协程（Coroutine）

```python
import asyncio

async def fetch_url(url):
    async with aiohttp.ClientSession() as session:
        async with session.get(url) as response:
            data = await response.text()
            print(f"Got {url}: {len(data)}")
            return data

# 协程：单线程内高并发，无线程切换开销
async def main():
    tasks = [fetch_url(url) for url in urls]
    results = await asyncio.gather(*tasks)

asyncio.run(main())
```

## 三者对比

| 维度 | 进程 | 线程 | 协程 |
|------|------|------|------|
| **内存** | 独立(MB级) | 共享(KB级) | 共享(字节级) |
| **切换开销** | 大(~10μs) | 中(~1μs) | 小(~100ns) |
| **数量上限** | 几十~几百 | 几百~几千 | 几万~几十万 |
| **多核利用** | ✅ | ❌(GIL) | ❌(单线程) |
| **编程复杂度** | 高(IPC) | 中(锁) | 低(无锁) |
| **适用场景** | CPU密集 | IO密集 | 高并发IO |

## 面试加分点

1. **GIL本质**：不是Python语言特性，而是CPython实现细节（Jython/PyPy无GIL）
2. **GIL释放时机**：IO操作和每100条字节码（Python 3.2+基于时间5ms）
3. **PEP 703**：Python 3.13开始实验性支持可选GIL（自由线程）
4. **选型公式**：CPU密集→进程，IO密集→协程，简单IO→线程

## 记忆要点

- GIL本质是全局锁：因为保护引用计数，所以同一时刻仅单线程执行Python字节码。
- 场景对比：CPU密集多进程绕GIL，而IO密集多线程/协程遇阻塞会自动释放GIL。
- 概念对比：进程资源独立开销大，线程共享内存受GIL限，协程极轻量单线程内并发。

