---
id: note-bz-agent-077
difficulty: L3
category: ai
subcategory: Agent
tags:
- B站面经
- 大模型API
- 限流
- 熔断
feynman:
  essence: 大模型API限流熔断=令牌桶限流(控制QPS)+滑动窗口(防突发)+熔断器(故障隔离)+降级链(保可用)。核心是保护LLM网关不被打爆。
  analogy: 像高速公路收费站——令牌桶是发卡机(控制进入速率)、滑动窗口是监控(防拥堵)、熔断是封路(事故时隔离)、降级是绕行(走国道)。
  first_principle: LLM API有并发/速率/成本限制，设计限流熔断保证在其容量内稳定运行。
  key_points:
  - 限流：令牌桶(QPS)+滑动窗口(突发)
  - 熔断：错误率/延迟超阈值自动隔离
  - 降级：主模型→备模型→规则→缓存
  - 监控：实时告警+自动恢复
first_principle:
  essence: 分布式系统的限流熔断原则适用于LLM API。
  derivation: LLM API是远程服务，有容量上限。高并发/故障时必须限流(防过载)和熔断(防雪崩)。这是分布式系统经典问题，成熟方案(令牌桶/熔断器)直接适用。
  conclusion: LLM API限流熔断 = 令牌桶限流 + 熔断器隔离 + 多级降级链
follow_up:
- 令牌桶vs漏桶？——令牌桶允许突发，漏桶匀速
- 熔断恢复怎么判断？——半开状态试探，成功则恢复
- 多模型怎么做降级？——主模型挂→备模型→规则引擎
memory_points:
- LLM API特点：慢、贵、多维度限制（RPM/TPM限流）
- 限流首选令牌桶算法：因为既能控制平均速率，又能容忍瞬时突发流量
- 熔断器三态转换：正常放行、故障熔断、半开试探，恢复后自动闭合
- 必须多维度联合限流：因为厂商限制多，所以请求数和Token总数必须同时管控
---

# 大模型 API 的限流熔断如何设计？

## 一、LLM API 的特殊性

```
LLM API vs 普通API：
  ├─ 慢：单次调用1-30秒（普通API<100ms）
  ├─ 贵：每次调用几毛到几块（普通API几乎免费）
  ├─ 限并发：OpenAI有RPM/TPM限制
  ├─ 不稳定：偶尔429(限流)/500(服务异常)
  └─ 流式：支持SSE流式输出（连接时间长）

→ 需要更强的限流熔断设计
```

## 二、限流设计

### 令牌桶算法（推荐）

```python
import time
from collections import deque

class TokenBucket:
    """令牌桶：允许突发，控制平均速率"""
    
    def __init__(self, capacity, refill_rate):
        self.capacity = capacity      # 桶容量（最大突发）
        self.refill_rate = refill_rate  # 每秒补充令牌数
        self.tokens = capacity        # 当前令牌
        self.last_refill = time.time()
    
    def acquire(self, tokens=1):
        # 补充令牌
        now = time.time()
        elapsed = now - self.last_refill
        self.tokens = min(self.capacity, 
                         self.tokens + elapsed * self.refill_rate)
        self.last_refill = now
        
        if self.tokens >= tokens:
            self.tokens -= tokens
            return True
        return False

# 使用：容量100，每秒补50
# → 平均50 QPS，允许瞬时100的突发
limiter = TokenBucket(capacity=100, refill_rate=50)
```

### 滑动窗口（防突发）

```python
class SlidingWindowLimiter:
    """滑动窗口：精确控制时间窗口内的请求数"""
    
    def __init__(self, window_size, max_requests):
        self.window = window_size  # 窗口大小(秒)
        self.max_req = max_requests
        self.requests = deque()
    
    def allow(self):
        now = time.time()
        # 清理过期请求
        while self.requests and now - self.requests[0] > self.window:
            self.requests.popleft()
        
        if len(self.requests) < self.max_req:
            self.requests.append(now)
            return True
        return False

# 每分钟最多600次（RPM限制）
rpm_limiter = SlidingWindowLimiter(60, 600)
```

### 多维度限流

```python
class MultiDimensionLimiter:
    """按多维度限流（匹配LLM厂商限制）"""
    
    def check(self, request):
        # 维度1: RPM (每分钟请求数)
        if not self.rpm_limiter.allow():
            raise RateLimitError("RPM超限")
        
        # 维度2: TPM (每分钟Token数)
        estimated_tokens = count_tokens(request)
        if not self.tpm_limiter.acquire(estimated_tokens):
            raise RateLimitError("TPM超限")
        
        # 维度3: 并发数
        if self.concurrent >= self.max_concurrent:
            raise RateLimitError("并发超限")
```

## 三、熔断设计

```python
class CircuitBreaker:
    """熔断器：故障时自动隔离，恢复后自动试探"""
    
    # 三状态
    CLOSED = "closed"      # 正常（放行）
    OPEN = "open"          # 熔断（拒绝，走降级）
    HALF_OPEN = "half_open"  # 半开（试探性放行）
    
    def __init__(self):
        self.state = self.CLOSED
        self.failure_count = 0
        self.failure_threshold = 5       # 连续失败5次熔断
        self.recovery_timeout = 30        # 30秒后尝试恢复
        self.last_failure_time = None
    
    async def call(self, func, *args):
        if self.state == self.OPEN:
            if time.time() - self.last_failure_time > self.recovery_timeout:
                self.state = self.HALF_OPEN  # 尝试恢复
            else:
                return await self.fallback(*args)  # 熔断中降级
        
        try:
            result = await func(*args)
            self.on_success()
            return result
        except Exception as e:
            self.on_failure()
            if self.state == self.OPEN:
                return await self.fallback(*args)
            raise
    
    def on_success(self):
        self.failure_count = 0
        self.state = self.CLOSED
    
    def on_failure(self):
        self.failure_count += 1
        self.last_failure_time = time.time()
        if self.failure_count >= self.failure_threshold:
            self.state = self.OPEN
```

## 四、降级链设计

```python
class DegradationChain:
    """多级降级，保证总返回结果"""
    
    async def generate(self, prompt):
        # Level 1: 主模型（GPT-4/Claude）
        try:
            return await self.primary_model.generate(prompt)
        except (OverloadError, TimeoutError):
            pass
        
        # Level 2: 备用模型（GPT-4o-mini/国产）
        try:
            return await self.backup_model.generate(prompt)
        except:
            pass
        
        # Level 3: 缓存
        if cached := self.cache.get(prompt):
            return cached
        
        # Level 4: 规则引擎（硬编码回复）
        if matched := self.rule_engine.match(prompt):
            return matched
        
        # Level 5: 最后兜底
        return "服务暂时繁忙，请稍后重试。"
```

## 五、完整 LLM 网关架构

```python
class LLMGateway:
    """统一的LLM调用网关，集成限流+熔断+降级"""
    
    def __init__(self):
        self.rate_limiter = TokenBucket(capacity=100, refill_rate=50)
        self.circuit_breaker = CircuitBreaker()
        self.degradation = DegradationChain()
        self.cache = SemanticCache()
    
    async def generate(self, request):
        # 1. 限流检查
        if not self.rate_limiter.acquire():
            return self.too_many_requests()
        
        # 2. 缓存检查
        if cached := self.cache.get(request):
            return cached
        
        # 3. 熔断检查
        if self.circuit_breaker.state == "open":
            return await self.degradation.generate(request)
        
        # 4. 调用LLM（带熔断包装）
        try:
            result = await self.circuit_breaker.call(
                self.llm.generate, request
            )
            self.cache.set(request, result)
            return result
        except:
            # 5. 降级
            return await self.degradation.generate(request)
```

## 六、监控告警

```python
class LLMonitor:
    """LLM API调用监控"""
    
    metrics = {
        "qps": "实时QPS",
        "p99_latency": "P99延迟",
        "error_rate": "错误率",
        "429_rate": "限流率",
        "cost_per_hour": "每小时成本",
        "circuit_state": "熔断状态",
    }
    
    alerts = {
        "error_rate > 10%": "错误率告警",
        "p99 > 10s": "延迟告警",
        "circuit_open": "熔断告警(立即)",
        "cost > budget": "成本告警",
    }
```

## 七、面试加分点

1. **令牌桶+滑动窗口**：令牌桶控均值允许突发，滑动窗口防短时洪峰——组合使用
2. **三态熔断器**：closed→open→half_open，自动恢复而非人工干预
3. **降级链**：主→备→缓存→规则→兜底，保证总返回结果——用户体验优先

## 记忆要点

- LLM API特点：慢、贵、多维度限制（RPM/TPM限流）
- 限流首选令牌桶算法：因为既能控制平均速率，又能容忍瞬时突发流量
- 熔断器三态转换：正常放行、故障熔断、半开试探，恢复后自动闭合
- 必须多维度联合限流：因为厂商限制多，所以请求数和Token总数必须同时管控

## 苏格拉底式面试追问

> 这组追问模拟面试官层层逼问，每一问先回答"为什么"，再回答"怎么做"，最后回答"如何证明"。

### 第一层：目标与动机

**Q：你说限流首选令牌桶，但 LLM 厂商本身就有 RPM/TPM 限制会返回 429，我们为什么还要自己限流，不是多此一举吗？**

因为厂商限流是"事后惩罚"，自己限流是"事前防护"，两者目标不同。厂商 429 是你超了配额后拒绝你，这时请求已经发出、已经占用了网络和服务端资源，且 429 后你得做重试/退避，用户体验已经受损。自己限流是在发请求前就控制，让请求要么被允许（大概率成功）、要么在网关层直接排队或拒绝（不消耗厂商配额）。而且厂商配额是共享的——你一个服务打爆配额，公司其他服务也用不了。自己限流是为了"在配额内主动调度"，不是重复厂商的动作。

### 第二层：证据与定位

**Q：线上 LLM 调用 429 错误率从 0.1% 涨到 15%，怎么定位是自己的限流没配对，还是厂商那边降配了？**

看两个数据的差值。第一看自己网关的"允许/拒绝"比例——如果网关自己已经拒绝了 20% 请求（限流生效）但厂商 429 还是 15%，说明厂商那侧降配了（你的配额被砍），和自己限流无关。第二看厂商控制台的配额用量——如果实际消耗 < 配额但还 429，是厂商侧故障（多发于高峰期），开工单问。如果自己网关几乎没拒绝（限流没触发）但厂商 429 多，是自己限流阈值配太高、没拦住。两个数据对比就知道是自己配置问题还是厂商问题。

### 第三层：根因深挖

**Q：令牌桶的 capacity（桶容量）和 refill_rate（补充速率）你怎么定？随便填个 100/50 行不行？**

不能随便填，要对着厂商配额算。refill_rate 对应厂商的 RPM——如果厂商给 600 RPM，refill_rate = 600/60 = 10 token/秒。capacity 对应允许的瞬时突发——这个值要看业务容忍度，一般设 refill_rate 的 2-3 倍（允许 2-3 秒的突发）。但还有个硬约束：capacity 不能超过厂商的并发上限。比如厂商 max_concurrent=50，capacity 设 100 就会同时发 100 个请求打爆并发。所以定参数是：refill_rate = 厂商 RPM/60，capacity = min(refill_rate×3, 厂商并发上限×0.7)，留 30% buffer 给其他服务。

**Q：那为什么不直接 capacity 设成 1（不允许突发），严格匀速不是更安全？**

因为会牺牲吞吐和延迟。capacity=1 等价于漏桶（严格匀速），10 个并发请求只能一个个串行处理，第 10 个用户要等 10 倍单次延迟。LLM 单次 5 秒，第 10 个用户等 50 秒，体验崩了。令牌桶的突发能力让前几个请求并发出去（并行等 LLM 返回），整体延迟由 max 决定而非 sum。突发是 LLM 场景必需的（因为单次慢，必须并发），capacity=1 只适合"快且必须严格匀速"的场景（比如对下游强一致数据库的写入），不适合 LLM。

### 第四层：方案权衡

**Q：熔断器的 failure_threshold 你设 5 次，但 LLM 偶发超时很常见（比如一次长生成），5 次就熔断会不会太敏感？**

会，所以不能只看次数，要看"时间窗口内的失败率"。我的熔断条件是双重判定：60 秒内失败率 > 50% 且失败数 > 20 次（保证样本量）。单看次数的坑是：凌晨低峰期 5 个请求偶然全超时（比如厂商重启），就误熔断了，但其实服务正常。用"失败率 + 最小样本数"能过滤掉小样本噪声。另外熔断后 half_open 试探也用同样逻辑——放 3 个请求，2 个成功就恢复，1 个失败继续熔断，避免单个偶发失败又触发熔断抖动。

**Q：为什么不直接用成熟的 Resilience4j/Hystrix 这些熔断库，要自己写？**

能用成熟库就用，不要自己写。我的回答是：生产环境直接用 Resilience4j（Java）或 sentinel（Go），它的熔断策略（慢调用比例/异常比例）、半开试探、指标暴露都成熟。自己写只在一种情况——需要"LLM 专属语义"的熔断判断，比如把 429 和 500 区分对待（429 是限流不熔断只退避，500 是故障才熔断），成熟库的默认策略不区分错误码。这时基于成熟库做扩展（自定义异常判定），而不是从头写状态机。所以答案是优先用库，只在语义不匹配时做轻量扩展。

### 第五层：验证与沉淀

**Q：你怎么证明这套限流熔断的阈值是合理的，而不是凭厂商文档拍出来的？**

压测验证 + 线上灰度观察两步。压测：用 wrk/k6 模拟 2 倍、5 倍、10 倍正常 QPS 打网关，看限流是否按预期生效（超过阈值的被拒、没超的放行）、熔断是否在故障注入时触发、降级链是否逐级兜住。线上灰度：先放 5% 流量，观察一周的 429 率、P99 延迟、熔断触发次数、降级触发次数。如果 429 率 > 1%，说明阈值偏松要收紧；如果正常流量下也频繁熔断，说明阈值偏紧要放宽。有压测数据 + 灰度曲线，阈值才不是拍的。

**Q：这套网关怎么让团队复用？**

抽象成"LLM Gateway 中间件"，统一封装限流/熔断/降级/缓存/监控，业务方只调 `gateway.generate(prompt)` 不碰底层。配置（限流阈值、熔断条件、降级链）在配置中心按"模型+租户"维度管理，业务方按场景选预设档位（高可用档/经济档/极速档）。这样全公司的 LLM 调用都走同一个网关，阈值调优、故障排查、成本统计都在一处，不是每个服务自己实现一套限流逻辑。

## 结构化回答

**30 秒电梯演讲：** 大模型API限流熔断=令牌桶限流(控制QPS)+滑动窗口(防突发)+熔断器(故障隔离)+降级链(保可用)。核心是保护LLM网关不被打爆。

**展开框架：**
1. **限流** — 令牌桶(QPS)+滑动窗口(突发)
2. **熔断** — 错误率/延迟超阈值自动隔离
3. **降级** — 主模型→备模型→规则→缓存

**收尾：** 您想深入聊：令牌桶vs漏桶？——令牌桶允许突发，漏桶匀速？


## 视频脚本

> 预计时长：4 分钟 | 由浅入深


| 时间 | 画面/字幕 | 口播台词 | 讲解要点 |
|------|----------|----------|----------|
| 0:00 | 标题卡：大模型 API 的限流熔断如何设计？ | "像高速公路收费站——令牌桶是发卡机(控制进入速率)、滑动窗口是监控(防拥堵)、熔断是封路(…" | 开场钩子 |
| 0:20 | 核心概念图 | "大模型API限流熔断=令牌桶限流(控制QPS)+滑动窗口(防突发)+熔断器(故障隔离)+降级链(保可用)。核心是保护…" | 核心定义 |
| 0:50 | 限流示意图 | "限流——令牌桶(QPS)+滑动窗口(突发)" | 要点拆解1 |
| 1:30 | 对比/实战案例图 | "对比一下常见误区和工程实践，看真实场景里怎么取舍。" | 实战与对比 |
| 2:20 | 总结卡 | "记住核心要点。下期我们追问：令牌桶vs漏桶？——令牌桶允许突发，漏桶匀速？" | 收尾与钩子 |
