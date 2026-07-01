---
id: note-bz-agent-076
difficulty: L4
category: ai
subcategory: Agent
tags:
- B站面经
- Agent
- 高并发
- 防护
- 限流
feynman:
  essence: Agent高并发四层防护=网关限流(挡洪峰)+会话限流(防单用户刷)+模型熔断(保LLM不崩)+工具降级(保后端)。层层设防保证系统稳定。
  analogy: 像大坝防洪——主闸门(网关限流)、分洪道(会话限流)、应急泄洪(熔断)、备用电源(降级)，层层保护。
  first_principle: Agent依赖的LLM/工具都是有容量限制的外部服务，高并发下必须分层限流保护，否则雪崩。
  key_points:
  - 四层：网关限流/会话限流/模型熔断/工具降级
  - 核心：保护脆弱的LLM调用
  - 手段：限流/熔断/降级/队列/缓存
  - 目标：高可用不雪崩
first_principle:
  essence: Agent系统的瓶颈是LLM(贵且慢)，高并发必须保护LLM不被打爆。
  derivation: LLM推理慢(秒级)、贵(每次调用花钱)、有并发上限。直接暴露给高并发→LLM服务过载→超时→重试→更过载→雪崩。必须分层限流，让LLM在安全负载内运行。
  conclusion: 高并发防护 = 分层限流（网关→会话→模型→工具）保护LLM不雪崩
follow_up:
- 限流算法用什么？——令牌桶/滑动窗口
- 熔断怎么判断？——错误率/延迟超阈值
- 降级到什么？——缓存/小模型/规则/告知用户
memory_points:
- 四层防护链路：网关限流、会话限流、模型熔断、工具降级
- 网关挡全局洪峰，会话防单用户恶意刷量
- 模型层必做熔断：因为LLM调用慢且贵，过载不及时熔断会引发连环雪崩
- 工具调用失败时执行降级：保底返回缓存或默认回复以维持系统可用
---

# Agent 高并发如何做防护？（网关限流+会话限流+模型熔断+工具降级）

## 一、为什么 Agent 需要特殊的高并发防护

```
Agent系统的脆弱点：
  1. LLM调用慢（秒级）→ 高并发时请求堆积
  2. LLM调用贵 → 不限流成本爆炸
  3. LLM有并发上限 → 超了报错/超时
  4. 工具调用依赖外部服务 → 可能被拖垮
  5. Agent多轮循环 → 单请求放大N倍负载

不加防护的后果：
  流量高峰 → LLM过载 → 超时 → 用户重试 → 更过载 → 雪崩
```

## 二、四层防护架构

```
┌──────────────────────────────────────────────────┐
│              四层防护架构                           │
├──────────────────────────────────────────────────┤
│                                                    │
│  用户请求                                          │
│      │                                            │
│      ▼                                            │
│  ┌──────────────────────────────────┐            │
│  │ Layer 1: 网关限流 (Gateway)       │            │
│  │ 全局QPS控制，挡住流量洪峰          │            │
│  └──────────────┬───────────────────┘            │
│      │                                            │
│      ▼                                            │
│  ┌──────────────────────────────────┐            │
│  │ Layer 2: 会话限流 (Session)       │            │
│  │ 单用户/会话级限流，防刷            │            │
│  └──────────────┬───────────────────┘            │
│      │                                            │
│      ▼                                            │
│  ┌──────────────────────────────────┐            │
│  │ Layer 3: 模型熔断 (Circuit Break) │            │
│  │ LLM过载时熔断，防止雪崩            │            │
│  └──────────────┬───────────────────┘            │
│      │                                            │
│      ▼                                            │
│  ┌──────────────────────────────────┐            │
│  │ Layer 4: 工具降级 (Degradation)   │            │
│  │ 工具失败时降级，保证可用            │            │
│  └──────────────────────────────────┘            │
│                                                    │
└──────────────────────────────────────────────────┘
```

## 三、各层详解

### Layer 1：网关限流（全局）

```python
from collections import defaultdict
import time

class GatewayRateLimiter:
    """全局QPS限流，挡住洪峰"""
    
    def __init__(self, max_qps=1000):
        self.max_qps = max_qps
        self.requests = defaultdict(list)  # 时间窗口
    
    def allow(self):
        now = time.time()
        # 清理1秒前的记录
        self.requests['global'] = [
            t for t in self.requests['global'] if now - t < 1
        ]
        if len(self.requests['global']) >= self.max_qps:
            return False  # 超限拒绝
        self.requests['global'].append(now)
        return True

# 超限处理：返回429 + Retry-After
def handle_request(request):
    if not gateway_limiter.allow():
        return Response(429, "服务繁忙，请稍后重试", 
                       headers={"Retry-After": "5"})
```

### Layer 2：会话限流（单用户）

```python
class SessionRateLimiter:
    """防止单用户刷请求"""
    
    LIMITS = {
        "free": {"rpm": 10, "rpd": 100},    # 免费用户
        "pro": {"rpm": 60, "rpd": 1000},    # 付费用户
        "vip": {"rpm": 200, "rpd": 10000},  # VIP
    }
    
    def check(self, user_id, tier):
        limits = self.LIMITS[tier]
        # 每分钟限流
        if self.count_recent(user_id, 60) >= limits["rpm"]:
            return False, "超出每分钟限制"
        # 每天限流
        if self.count_recent(user_id, 86400) >= limits["rpd"]:
            return False, "超出每日限制"
        return True, None
```

### Layer 3：模型熔断

```python
class ModelCircuitBreaker:
    """LLM过载时熔断，防止雪崩"""
    
    def __init__(self):
        self.state = "closed"  # closed/open/half_open
        self.failures = 0
        self.threshold = 10  # 连续失败10次熔断
    
    async def call_llm(self, prompt):
        if self.state == "open":
            # 熔断中，直接降级
            return await self.fallback()
        
        try:
            result = await llm.generate(prompt, timeout=30)
            self.failures = 0  # 成功，重置
            return result
        except (Timeout, OverloadError) as e:
            self.failures += 1
            if self.failures >= self.threshold:
                self.state = "open"  # 开启熔断
                self.schedule_recovery()  # 30秒后半开
            return await self.fallback()
    
    async def fallback(self):
        """熔断时的降级方案"""
        # 1. 用缓存
        if cached := cache.get(prompt_hash):
            return cached
        # 2. 用小模型
        return await small_llm.generate(prompt)
        # 3. 或返回"服务繁忙"
```

### Layer 4：工具降级

```python
class ToolDegradation:
    """工具调用失败时的降级"""
    
    async def call_tool(self, tool, args):
        try:
            return await tool.execute(args, timeout=10)
        except Exception:
            # 分级降级
            return await self.degrade(tool, args)
    
    async def degrade(self, tool, args):
        # Level 1: 用缓存
        if cached := self.cache.get(tool, args):
            return cached
        
        # Level 2: 用简化版
        if simpler := self.get_simpler(tool):
            return await simpler.execute(args)
        
        # Level 3: 返回默认值
        if default := self.get_default(tool):
            return default
        
        # Level 4: 告知失败
        return {"error": "服务暂时不可用", "degraded": True}
```

## 四、配套机制

### 请求队列（削峰填谷）

```python
import asyncio

class RequestQueue:
    """请求排队，控制并发"""
    
    def __init__(self, max_concurrent=100):
        self.semaphore = asyncio.Semaphore(max_concurrent)
    
    async def process(self, request):
        async with self.semaphore:  # 控制并发数
            return await handle(request)
```

### 缓存（减少LLM调用）

```python
class ResponseCache:
    """语义缓存，相似问题复用"""
    
    async def get_or_compute(self, query):
        # 精确缓存
        if cached := self.exact_cache.get(query):
            return cached
        # 语义缓存（相似问题）
        if similar := self.semantic_cache.search(query, threshold=0.95):
            return similar
        # 未命中，调LLM
        result = await llm.generate(query)
        self.cache.set(query, result)
        return result
```

## 五、高并发场景的参数设计

```
┌──────────────┬──────────────────────────────────┐
│ 参数          │ 建议值                              │
├──────────────┼──────────────────────────────────┤
│ 全局QPS       │ LLM并发上限的70%（留buffer）       │
│ 单用户RPM     │ free:10, pro:60, vip:200          │
│ LLM超时       │ 30秒（超了熔断）                   │
│ 工具超时      │ 10秒                              │
│ 熔断阈值      │ 连续10次失败或错误率>50%           │
│ 熔断恢复      │ 30秒后半开试探                     │
│ 队列长度      │ max_concurrent的2倍               │
│ 缓存TTL      │ 1小时（根据业务）                 │
└──────────────┴──────────────────────────────────┘
```

## 六、面试加分点

1. **四层防护**：网关→会话→模型→工具，层层设防——体系化
2. **核心是保护 LLM**：LLM 是最脆弱最贵的，所有防护围绕它
3. **降级而非报错**：熔断/降级保证"返回点什么"而非崩溃——用户体验优先

## 记忆要点

- 四层防护链路：网关限流、会话限流、模型熔断、工具降级
- 网关挡全局洪峰，会话防单用户恶意刷量
- 模型层必做熔断：因为LLM调用慢且贵，过载不及时熔断会引发连环雪崩
- 工具调用失败时执行降级：保底返回缓存或默认回复以维持系统可用

