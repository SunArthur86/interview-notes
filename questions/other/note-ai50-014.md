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

