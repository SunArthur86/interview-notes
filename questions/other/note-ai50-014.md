---
id: note-ai50-014
difficulty: L2
category: other
subcategory: Python
tags:
- 某厂
- 面经
- Python
- 异步编程
- asyncio
- Agent
feynman:
  essence: 异步编程让Agent在等待LLM/工具响应时不阻塞，可以同时处理多个请求或并行调用多个工具
  analogy: 就像服务员点餐——同步是等一道菜做完才点下一道(串行)，异步是同时点完所有菜然后等上菜(并发)，厨房(服务器)效率最大化
  first_principle: Agent的每一步都涉及I/O等待(LLM API调用、数据库查询、Web搜索)，CPU在此期间空闲。异步编程利用这些空闲时间处理其他任务，将I/O等待时间重叠
  key_points:
  - asyncio是Python异步编程的标准库
  - 'Agent中必须用异步的场景: 并行工具调用、流式输出、多用户并发'
  - '关键: await是"让出控制权"，不是"等待"'
  - '注意: CPU密集型任务不适合asyncio，要用多进程'
first_principle:
  essence: I/O等待是Agent系统的主要延迟来源，异步编程通过重叠这些等待提升吞吐量
  derivation: 'Agent调用3个工具，每个耗时1s。同步: 3×1=3s。异步并行: max(1,1,1)=1s。3倍提速。工具越多，加速比越大'
  conclusion: Agent系统天然适合异步编程，因为其工作负载是I/O密集型(LLM API + 工具调用)
follow_up:
- asyncio和threading在Agent场景下怎么选？
- 异步代码中如何处理异常和超时？
- FastAPI为什么天然支持异步？
memory_points:
- 因为Agent常遇网络I/O，所以用异步避免串行阻塞，大幅降低总耗时。
- 核心API：async def定义协程，await挂起等待，asyncio.gather并发调用。
- 核心场景：并行工具调用提效，流式输出（astream）提升前端交互体验。
---

# Python异步编程在Agent开发中的应用

## 为什么Agent必须用异步

```
同步执行 (3个工具调用, 各1秒):
Time: 0s    1s    2s    3s
      ├─工具A──┤
      │        ├─工具B──┤
      │        │        ├─工具C──┤
      总耗时: 3s (串行等待)

异步执行 (并行调用):
Time: 0s    1s
      ├─工具A──┤
      ├─工具B──┤  ← 三个工具同时执行!
      ├─工具C──┤
      总耗时: 1s (并发等待)
```

## 基础语法

```python
import asyncio

# 1. 定义异步函数
async def call_tool(tool_name, params):
    """模拟工具调用(网络I/O)"""
    await asyncio.sleep(1)  # 模拟1秒网络延迟
    return {"tool": tool_name, "result": f"processed {params}"}

# 2. 串行调用 (慢)
async def serial_calls():
    start = time.time()
    r1 = await call_tool("search", "query1")
    r2 = await call_tool("analyze", "data1")
    r3 = await call_tool("format", "result1")
    print(f"串行耗时: {time.time()-start:.1f}s")  # ~3s
    return [r1, r2, r3]

# 3. 并行调用 (快)
async def parallel_calls():
    start = time.time()
    # asyncio.gather 并行执行多个协程
    results = await asyncio.gather(
        call_tool("search", "query1"),
        call_tool("analyze", "data1"),
        call_tool("format", "result1")
    )
    print(f"并行耗时: {time.time()-start:.1f}s")  # ~1s
    return results
```

## Agent中的应用场景

### 场景1: 并行工具调用

```python
class ParallelAgent:
    async def run(self, query):
        # Agent决定需要调用3个工具
        tool_plan = self.plan_tools(query)
        # ["search_web", "query_database", "check_cache"]
        
        # 并行执行所有工具 (而不是串行)
        results = await asyncio.gather(*[
            self.execute_tool(tool, query) 
            for tool in tool_plan
        ])
        
        # 合并结果交给LLM
        merged = self.merge_results(results)
        return await self.llm.generate(merged)

    async def execute_tool(self, tool_name, query):
        """单个工具的异步执行"""
        try:
            result = await self.tools[tool_name].arun(query)
            return {"tool": tool_name, "status": "success", "data": result}
        except Exception as e:
            return {"tool": tool_name, "status": "error", "error": str(e)}
```

### 场景2: 流式输出

```python
async def stream_agent_response(query):
    """流式输出Agent的思考和回答"""
    async for chunk in agent.astream(query):
        if chunk.type == "thought":
            yield {"type": "thought", "content": chunk.content}
        elif chunk.type == "tool_call":
            yield {"type": "action", "tool": chunk.tool}
            # 异步等待工具结果
            result = await chunk.tool.execute()
            yield {"type": "observation", "data": result}
        elif chunk.type == "answer":
            yield {"type": "answer", "content": chunk.content}
```

### 场景3: 多用户并发

```python
from fastapi import FastAPI
import asyncio

app = FastAPI()

# 每个用户请求是独立的异步任务
@app.post("/chat")
async def chat(request: ChatRequest):
    """多用户同时请求时不会互相阻塞"""
    # 用户A的请求在等待LLM响应时
    # 用户B的请求可以同时开始处理
    response = await agent.arun(request.message)
    return {"reply": response}
```

### 场景4: 带超时和重试的工具调用

```python
async def call_tool_with_timeout(tool, query, timeout=10, retries=3):
    """带超时和重试的异步工具调用"""
    for attempt in range(retries):
        try:
            # asyncio.wait_for 设置超时
            result = await asyncio.wait_for(
                tool.arun(query),
                timeout=timeout
            )
            return result
        except asyncio.TimeoutError:
            print(f"工具{tool.name}第{attempt+1}次超时, 重试...")
        except Exception as e:
            print(f"工具{tool.name}出错: {e}")
            await asyncio.sleep(1 * (attempt + 1))  # 指数退避
    
    raise RuntimeError(f"工具{tool.name}在{retries}次重试后仍失败")
```

### 场景5: 并行RAG检索

```python
async def parallel_rag_retrieval(query, stores):
    """同时查多个知识库"""
    tasks = [
        store.asimilarity_search(query, k=5)
        for store in stores  # [es_store, milvus_store, redis_store]
    ]
    results = await asyncio.gather(*tasks, return_exceptions=True)
    
    # 合并多路检索结果
    merged = []
    for store_name, result in zip(["es", "milvus", "redis"], results):
        if isinstance(result, Exception):
            print(f"{store_name}检索失败: {result}")
        else:
            merged.extend(result)
    
    return merged
```

## 异步编程的坑

### 坑1: 在异步代码中调用同步函数

```python
# ❌ 错误: requests是同步库，会阻塞事件循环
async def bad_agent(query):
    response = requests.post("https://api.llm.com/v1/chat", json={...})  # 阻塞!
    return response.json()

# ✅ 正确: 使用httpx或aiohttp
import httpx

async def good_agent(query):
    async with httpx.AsyncClient() as client:
        response = await client.post("https://api.llm.com/v1/chat", json={...})
        return response.json()

# ✅ 或者: 把同步函数放到线程池
async def ok_agent(query):
    loop = asyncio.get_event_loop()
    response = await loop.run_in_executor(None, requests.post, url, json_data)
```

### 坑2: 混用async和sync库

| 同步库 | 异步替代 | 说明 |
|--------|---------|------|
| requests | httpx / aiohttp | HTTP客户端 |
| openai(同步) | openai.AsyncOpenAI | OpenAI API |
| redis-py(同步) | redis.asyncio | Redis客户端 |
| pymongo | motor | MongoDB客户端 |
| sqlalchemy | sqlalchemy async | ORM |

### 坑3: CPU密集型任务

```python
# asyncio不适合CPU密集型任务(CPU不会空闲)
# ❌ 这样写会阻塞事件循环
async def cpu_heavy():
    result = heavy_computation()  # 阻塞整个事件循环!

# ✅ 用进程池处理CPU密集型任务
async def cpu_heavy_correct():
    loop = asyncio.get_event_loop()
    result = await loop.run_in_executor(
        ProcessPoolExecutor(),  # 进程池(不是线程池)
        heavy_computation
    )
```

## 性能对比

| 场景 | 同步 | 异步 | 加速比 |
|------|------|------|--------|
| 串行3工具 | 3.0s | - | 1× |
| 并行3工具 | 3.0s | 1.0s | 3× |
| 并行10工具 | 10.0s | 1.0s | 10× |
| 100并发用户 | 排队 | 同时处理 | 100× |
| LLM流式输出 | 等完整响应 | 逐token返回 | 感知延迟↓90% |

## 记忆要点

- 因为Agent常遇网络I/O，所以用异步避免串行阻塞，大幅降低总耗时。
- 核心API：async def定义协程，await挂起等待，asyncio.gather并发调用。
- 核心场景：并行工具调用提效，流式输出（astream）提升前端交互体验。


## 苏格拉底式面试追问

> 这组追问模拟面试官层层逼问，每一问先回答"为什么"，再回答"怎么做"，最后回答"如何证明"。

### 第一层：目标与动机

**Q：Agent 开发为什么必须用异步（asyncio），用同步（串行 await）不行吗？**

Agent 的工作负载是 I/O 密集型（LLM API 调用、工具调用、数据库查询），每次 I/O 等待几百毫秒到几秒。同步代码在等待时 CPU 空闲（阻塞），无法处理其他请求；异步代码在等待时"让出控制权"（await 挂起协程），事件循环调度其他协程，I/O 等待时间重叠。例如 Agent 并行调 3 个工具（各 1 秒），同步 3 秒、异步 1 秒（3 倍提速）。如果 Agent 服务串行处理，单请求 3 秒，QPS 只能 0.3；异步并发处理，单请求仍 1 秒（并行工具），且能同时处理多用户请求（协程轻量，单进程可跑上万协程）。所以异步是 Agent 高并发和低延迟的必要条件，同步在 I/O 密集场景吞吐量极低。

### 第二层：证据与定位

**Q：线上 Agent 服务延迟突然升高（P99 从 2s 涨到 10s），你怎么确认是异步代码退化还是下游（LLM API）变慢？**

分段计时定位。在 Agent 代码里打时间戳：一、LLM API 调用耗时——记录 `await llm.call()` 的开始和结束时间，如果 API 耗时从 1s 涨到 5s，是 LLM 服务变慢（下游问题）；二、工具调用耗时——同理记录每个工具的耗时，定位是否某工具变慢；三、事件循环延迟——用 `asyncio.get_event_loop().time()` 测量事件循环的调度延迟，如果协程从 `await` 恢复后到实际执行的延迟大（如 100ms），说明事件循环阻塞（如有同步代码阻塞了循环）；四、并发度——统计同时在飞的协程数，如果并发度骤降（如从 100 降到 10），可能是某处串行化（如误用 `await` 代替 `gather`）。常见根因：LLM API 限流（429 重试）、事件循环被同步代码阻塞（如 `time.sleep` 或 CPU 密集计算未用 `run_in_executor`）。

### 第三层：根因深挖

**Q：异步代码里你不小心写了 `time.sleep(1)`（同步阻塞），导致整个事件循环卡住 1 秒，所有协程都停了，根因是什么？**

根因是"同步代码阻塞事件循环"。asyncio 是单线程事件循环模型——事件循环在一个线程里调度协程，`await` 是"让出控制权"给事件循环（事件循环可调度其他协程）。但 `time.sleep(1)` 是同步调用——它不"让出控制权"，直接阻塞当前线程 1 秒，事件循环无法调度其他协程，所有协程都停。正确做法是用 `await asyncio.sleep(1)`——它"让出控制权"，事件循环在 1 秒内可调度其他协程。同理，CPU 密集计算（如大数据处理）也会阻塞事件循环，要用 `await loop.run_in_executor(None, cpu_func)` 把 CPU 任务丢到线程池，不阻塞事件循环。核心："事件循环里不能有同步阻塞代码（sleep/IO/CPU），必须用 await 版本或丢线程池"。

**Q：那为什么不直接用多线程（threading）处理 I/O 并发，每个请求一个线程，不阻塞？**

多线程在 Python I/O 并发的问题：一、GIL 限制——Python 的 GIL（全局解释器锁）使多线程不能真正并行执行 Python 字节码（虽然 I/O 等待时释放 GIL，但线程切换有开销）；二、线程开销大——每个线程默认占 8MB 栈空间，1000 并发要 8GB 内存，且线程创建/切换是内核态操作（毫秒级开销），高并发性能差；三、竞态条件——多线程共享内存，要加锁保护共享状态（如字典、计数器），锁竞争和死锁风险。协程（asyncio）的优势：一、单线程无 GIL 并行问题（协程在单线程内协作调度）；二、极轻量——每个协程占 KB 级内存，单进程可跑 10 万协程；三、无锁——单线程内协程顺序执行（await 点切换），共享状态无需加锁。所以高并发 I/O 场景，协程远优于多线程（轻量 + 无锁 + 高并发）。

### 第四层：方案权衡

**Q：并行工具调用你用 `asyncio.gather`，但某个工具失败会导致整个 gather 失败（默认行为），怎么让其他工具继续？**

`asyncio.gather` 默认是"fast fail"——任一协程抛异常，gather 立即抛异常，其他协程不等待。要让其他工具继续，用 `return_exceptions=True`：`await asyncio.gather(*tasks, return_exceptions=True)`，失败的协程返回异常对象（而非抛出），成功的正常返回结果。然后遍历结果，区分成功和失败（`isinstance(result, Exception)`）。这样 Agent 能拿到部分结果（成功的工具），失败的工具降级处理（如返回默认值或提示用户）。另一种方案是 `asyncio.as_completed`——工具完成一个返回一个（不等待全部），适合"流式展示工具结果"（如第一个工具完成立即展示，不等其他）。选择依据：要"全部完成才处理"用 gather，要"完成一个处理一个"用 as_completed。

**Q：为什么不直接用 `asyncio.create_task` 逐个创建任务然后 await，而要用 gather？**

`create_task` + 手动 await 的问题：一、繁琐——要手动收集任务对象、逐个 await、处理异常，代码冗长；二、不保证顺序——手动 await 的顺序和任务完成顺序可能不一致（如先 await 慢任务，快任务已完成但没被 await 收集），容易出错。`gather` 的优势：一、简洁——一行 `await gather(*tasks)` 并发执行并收集结果；二、保证顺序——结果顺序和传入的任务顺序一致（无论完成先后）；三、异常处理——`return_exceptions=True` 统一处理异常。所以 gather 是"并发执行 + 顺序结果 + 异常处理"的封装，比手动 create_task 更安全简洁。但 gather 有局限：它等待所有任务完成，如果要"完成一个处理一个"（流式），用 `as_completed`。

### 第五层：验证与沉淀

**Q：你怎么验证异步改造真的提升了 Agent 性能（而非只是改了代码）？**

对比指标：一、总耗时——同步 vs 异步，并行工具调用的总耗时（异步应接近最慢工具的耗时，同步是所有工具耗时之和）；二、吞吐量（QPS）——异步改造前后，Agent 服务的 QPS（异步应显著提升，因为单进程可并发处理多请求）；三、资源占用——异步改造前后，CPU 和内存占用（异步应更高效，协程轻量）；四、延迟分布——P50/P99 延迟（异步应更低，I/O 等待重叠）。压测工具（如 locust、wrk）模拟并发请求，对比同步和异步版本的指标。例如：同步版 QPS 10、P99 5s；异步版 QPS 1000、P99 1s，证明异步改造有效。

**Q：这道题沉淀出什么可复用的 Agent 异步编程经验？**

四条原则：一、I/O 密集用 asyncio——Agent 的 LLM/工具调用是 I/O 密集，异步并发重叠等待时间，同步串行吞吐量低；二、事件循环不能阻塞——`time.sleep`/同步 IO/CPU 密集都会阻塞事件循环，用 `await asyncio.sleep`/异步 IO/`run_in_executor`；三、gather 并行工具——`asyncio.gather(*tasks, return_exceptions=True)` 并发调用 + 容错（失败返回异常不中断其他）；四、协程优于多线程——高并发 I/O 场景，协程轻量（KB 级）+ 无锁（单线程），多线程受 GIL 限制 + 开销大（MB 级栈）。核心洞察："Agent 异步编程本质是'I/O 并发优化'——核心是 await（让出控制权重叠 I/O 等待）+ gather（并行工具调用）+ 不阻塞事件循环（sleep/IO/CPU 都要异步版），借鉴 Node.js 的事件循环模型，Python 用 asyncio 实现。"


## 结构化回答

**30 秒电梯演讲：** 异步编程让Agent在等待LLM/工具响应时不阻塞，可以同时处理多个请求或并行调用多个工具。打个比方，就像服务员点餐——同步是等一道菜做完才点下一道(串行)，异步是同时点完所有菜然后等上菜(并发)，厨房(服务器)效率最大化。

**展开框架：**
1. **Agent常遇网络I/O** — 因为Agent常遇网络I/O，所以用异步避免串行阻塞，大幅降低总耗时。
2. **核心API** — async def定义协程，await挂起等待，asyncio.gather并发调用。
3. **核心场景** — 并行工具调用提效，流式输出（astream）提升前端交互体验。

**收尾：** 这块我踩过坑——要不要深入聊：asyncio和threading在Agent场景下怎么选？

## 视频脚本

> 预计时长：2 分钟 | 由浅入深

| 时间 | 画面/字幕 | 口播台词 | 讲解要点 |
|------|----------|----------|----------|
| 0:00 | 标题卡 | "Python一句话：异步编程让Agent在等待LLM/工具响应时不阻塞，可以同时处理多个请求或并行调用多个工具。" | 开场钩子 |
| 0:15 | 进程/线程状态转换图 | "因为Agent常遇网络I/O，所以用异步避免串行阻塞，大幅降低总耗时。" | Agent常遇网络I/O |
| 1:02 | 进程/线程状态转换图分步演示 | "核心API：async def定义协程，await挂起等待，asyncio.gather并发调用。" | 核心API |
| 1:50 | 总结卡 | "核心抓住这条主线，下期咱们接着聊：asyncio和threading在Agent场景下怎么选。" | 收尾 |
