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

