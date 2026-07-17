---
id: note-bd-llm-006
difficulty: L4
category: ai
subcategory: 工程化
tags:
- 字节
- 面经
- API
- 超时
- 限流
- 重试
- 降级
feynman:
  essence: 大模型API不稳定是常态，必须设计指数退避重试+多级降级(模型降级/缓存降级/规则降级)保障可用性。
  analogy: 就像飞机出行——航班取消(超时)时先改签(重试)，改签不了换高铁(模型降级)，高铁也没有就住酒店等明天(缓存/规则降级)。
  first_principle: 大模型API = 不可控第三方依赖，必须按分布式系统容错原则设计。
  key_points:
  - 指数退避+抖动重试(3次上限)
  - 模型降级(GPT-4→GPT-3.5→本地模型)
  - 缓存降级(相似Query命中缓存)
  - 规则降级(关键词匹配兜底)
  - 熔断器模式(连续失败停止调用)
first_principle:
  essence: 依赖不可控时的多级降级策略
  derivation: API超时→重试→多次失败→熔断→降级到小模型→小模型也不行→缓存→缓存也没有→规则兜底
  conclusion: 大模型应用的SLA取决于降级链的深度而非主链路
follow_up:
- 如何设置重试的退避间隔？
- 熔断器的半开状态怎么设计？
- 如何监控降级触发频率？
memory_points:
- 系统定位：大模型API是不可控第三方依赖，因为存在超时与限流，所以必须构建多层容错链
- 重试策略：使用指数退避加抖动机制，因为可防止重试风暴，所以上限通常设为3次且仅针对429/5xx错误
- 多级降级链路：高优模型→低优模型→历史缓存→规则兜底，确保核心链路彻底崩溃时也能优雅响应
- 熔断机制：因为连续失败会导致整个服务雪崩，所以触发熔断阈值后直接拦截请求快速失败
- 缓存保护：利用Redis缓存相似Query结果，因为能在服务限流或宕机时提供良好的兜底体验
---

# 【字节面经】你在项目里遇到过大模型接口调用超时或限流的问题吗？怎么设计重试与降级机制？

## 一、问题本质：大模型 API 是不可控第三方依赖

在大模型应用中，调用外部 LLM API（OpenAI / Claude / 文心一言 / 通义千问等）是核心链路，但也是最脆弱的环节：

- **超时**：大模型推理耗时不稳定，高负载下 P99 延迟可达 30~60s
- **限流（Rate Limit）**：TPM（Token Per Minute）/ RPM（Request Per Minute）限制
- **服务波动**：GPU 集群过载、模型版本更新、网络抖动
- **完全宕机**：服务商区域性故障（2023 年 OpenAI 曾多次大规模宕机）

**核心原则**：大模型 API = **不可控第三方依赖**，必须按照分布式系统容错原则设计，构建从"重试"到"多级降级"的完整防护链。

类比飞机出行：
```
航班正常 → 直达目的地（API 正常调用）
航班延误 → 等一等再飞（超时重试）
航班取消 → 改签到其他航班（模型降级）
所有航班取消 → 坐高铁（缓存降级）
高铁也没有 → 找最近的酒店住下（规则兜底）
全部交通瘫痪 → 告诉旅客应急方案（优雅降级提示）
```

---

## 二、整体容错架构

```
                    用户请求
                       │
                       ▼
              ┌────────────────┐
              │   熔断器判断     │ ← Closed(正常) / Open(熔断中) / Half-Open(探测)
              └───────┬────────┘
                      │ (熔断器关闭)
                      ▼
              ┌────────────────┐
              │  缓存层（Redis） │ ← 命中缓存？直接返回（TTL 5~30min）
              └───────┬────────┘
                      │ (未命中)
                      ▼
              ┌────────────────┐
              │  指数退避重试     │ ← 最多3次，含抖动（Jitter）
              │  (Retry x 3)    │
              └───────┬────────┘
                      │ (重试仍失败)
                      ▼
              ┌────────────────┐
              │  模型降级链      │ ← GPT-4 → GPT-3.5 → 本地小模型
              └───────┬────────┘
                      │ (所有模型都失败)
                      ▼
              ┌────────────────┐
              │  缓存降级        │ ← 返回历史相似Query的缓存结果
              └───────┬────────┘
                      │ (缓存也没有)
                      ▼
              ┌────────────────┐
              │  规则兜底        │ ← 关键词匹配 / 模板回复 / 默认话术
              └───────┬────────┘
                      │
                      ▼
                   返回用户
```

---

## 三、第一层：指数退避 + 抖动重试

### 3.1 原理

- **指数退避（Exponential Backoff）**：每次重试间隔按指数增长（1s → 2s → 4s → 8s...），避免雪崩
- **抖动（Jitter）**：在退避时间上添加随机偏移，防止多个客户端同时重试（Thundering Herd 问题）
- **重试上限**：通常 3 次，避免无限重试消耗资源
- **区分错误类型**：429（限流）/ 503（服务不可用）→ 可重试；400（参数错误）/ 401（鉴权失败）→ 不重试

### 3.2 Python 实现

```python
import asyncio
import random
import httpx
from typing import Optional


class RetryConfig:
    """重试配置"""
    max_retries: int = 3
    base_delay: float = 1.0      # 基础延迟（秒）
    max_delay: float = 30.0      # 最大延迟上限
    retryable_status: set = {429, 500, 502, 503, 504}


async def call_llm_with_retry(
    prompt: str,
    model: str = "gpt-4",
    config: RetryConfig = RetryConfig(),
) -> Optional[dict]:
    """
    带指数退避 + 抖动的 LLM 调用重试
    """
    last_error = None

    for attempt in range(config.max_retries + 1):
        try:
            async with httpx.AsyncClient(timeout=30) as client:
                resp = await client.post(
                    "https://api.openai.com/v1/chat/completions",
                    json={
                        "model": model,
                        "messages": [{"role": "user", "content": prompt}],
                    },
                    headers={"Authorization": f"Bearer {API_KEY}"},
                )

                if resp.status_code == 200:
                    return resp.json()

                if resp.status_code not in config.retryable_status:
                    # 非可重试错误（如400参数错误），直接抛出
                    raise Exception(f"Non-retryable error: {resp.status_code}")

                # 可重试错误（429/503等）
                last_error = f"HTTP {resp.status_code}"

                # 检查 Retry-After 头（限流时服务端会返回建议等待时间）
                retry_after = resp.headers.get("Retry-After")
                if retry_after:
                    await asyncio.sleep(float(retry_after))
                    continue

        except (httpx.TimeoutException, httpx.ConnectionError) as e:
            last_error = str(e)

        # 如果还有重试机会，执行指数退避 + 抖动
        if attempt < config.max_retries:
            delay = min(
                config.base_delay * (2 ** attempt),  # 指数退避
                config.max_delay
            )
            jitter = random.uniform(0, delay * 0.3)  # 抖动：0~30% 的随机偏移
            wait_time = delay + jitter
            print(f"Attempt {attempt + 1} failed: {last_error}, "
                  f"retrying in {wait_time:.1f}s...")
            await asyncio.sleep(wait_time)

    print(f"All {config.max_retries} retries exhausted. Last error: {last_error}")
    return None
```

### 3.3 退避时间表示例

| 重试次数 | 基础延迟 | 抖动范围 | 实际等待 |
|----------|----------|----------|----------|
| 第1次失败后 | 1s | 0~0.3s | 1.0~1.3s |
| 第2次失败后 | 2s | 0~0.6s | 2.0~2.6s |
| 第3次失败后 | 4s | 0~1.2s | 4.0~5.2s |
| 第4次（上限） | 8s | 0~2.4s | 8.0~10.4s |

---

## 四、第二层：模型降级链

### 4.1 设计思路

当主模型（如 GPT-4）连续不可用时，**逐级降级到更便宜、更稳定的小模型**，保证服务可用性：

```
GPT-4o (最强，最贵，最不稳定)
   │ 失败降级
   ▼
GPT-4o-mini (快，便宜，更稳定)
   │ 失败降级
   ▼
GPT-3.5-turbo (兜底)
   │ 失败降级
   ▼
本地部署模型 (Ollama/Qwen-7B，完全自主可控)
   │ 失败降级
   ▼
规则引擎 (完全可靠，零延迟)
```

### 4.2 降级链实现

```python
from dataclasses import dataclass
from typing import Optional
import logging

logger = logging.getLogger(__name__)


@dataclass
class ModelConfig:
    """单个模型配置"""
    name: str
    provider: str          # "openai" / "azure" / "local"
    api_key: str
    base_url: str
    timeout: int = 30
    max_tokens: int = 2048


# 降级链配置（按优先级排列）
MODEL_CHAIN = [
    ModelConfig("gpt-4o", "openai", API_KEY_1, "https://api.openai.com/v1"),
    ModelConfig("gpt-4o-mini", "openai", API_KEY_1, "https://api.openai.com/v1"),
    ModelConfig("gpt-35-turbo", "azure", AZURE_KEY, AZURE_ENDPOINT),
    ModelConfig("qwen-7b", "local", "", "http://localhost:11434/v1"),  # Ollama 本地
]


async def call_with_fallback(prompt: str) -> tuple[str, str]:
    """
    模型降级链调用
    返回: (response_text, model_used)
    """
    errors = []

    for model_cfg in MODEL_CHAIN:
        try:
            result = await call_llm_with_retry(
                prompt=prompt,
                model=model_cfg.name,
                config=RetryConfig(max_retries=2),  # 降级链中减少单模型重试次数
            )

            if result and result.get("choices"):
                response = result["choices"][0]["message"]["content"]
                logger.info(f"Success with model: {model_cfg.name}")
                return response, model_cfg.name
            else:
                errors.append(f"{model_cfg.name}: empty response")

        except Exception as e:
            errors.append(f"{model_cfg.name}: {str(e)}")
            logger.warning(f"Model {model_cfg.name} failed: {e}, "
                          f"falling back to next model...")

    logger.error(f"All models failed: {' | '.join(errors)}")
    return await cache_or_rule_fallback(prompt)
```

### 4.3 降级时的注意事项

| 注意点 | 说明 |
|--------|------|
| **Prompt 兼容性** | 不同模型的 system prompt 格式可能不同，需做适配 |
| **输出质量预期** | 降级后告知用户"当前回复来自轻量模型"（透明性） |
| **Token 限制变化** | GPT-4 支持 128K，GPT-3.5 只有 16K，需截断 |
| **流式响应** | 降级时可能从流式变为非流式，前端需适配 |
| **成本监控** | 降级频繁触发说明主链路有问题，需告警 |

---

## 五、第三层：缓存降级

### 5.1 两级缓存策略

```
                   Query
                     │
        ┌────────────┴────────────┐
        │                         │
   精确匹配缓存              语义相似缓存
   (Exact Match)             (Semantic Match)
   key = hash(query)         key = embedding(query)
   TTL = 30min               TTL = 24h
   Redis String              Redis + Vector DB
        │                         │
        ▼                         ▼
   命中率 ~15%               命中率 ~35%
   (高频问题)               (相似问题复用)
```

### 5.2 缓存降级实现

```python
import hashlib
import redis.asyncio as redis
import json

# Redis 连接池
redis_client = redis.from_url("redis://localhost:6379", decode_responses=True)

CACHE_TTL = 1800  # 30 分钟


def get_cache_key(query: str, model: str = "") -> str:
    """生成精确匹配缓存键"""
    content = f"{query}:{model}"
    return f"llm:cache:{hashlib.sha256(content.encode()).hexdigest()}"


async def llm_call_with_cache(prompt: str) -> str:
    """带缓存的 LLM 调用"""

    # 1. 先查精确匹配缓存
    cache_key = get_cache_key(prompt)
    cached = await redis_client.get(cache_key)
    if cached:
        print(f"✅ Exact cache hit")
        return json.loads(cached)["response"]

    # 2. 查语义相似缓存（可选，用向量检索）
    # similar = await semantic_cache_search(prompt, threshold=0.95)
    # if similar:
    #     print(f"✅ Semantic cache hit (score={similar['score']:.3f})")
    #     return similar["response"]

    # 3. 调用 LLM（含重试 + 模型降级）
    try:
        response, model_used = await call_with_fallback(prompt)

        # 写入缓存
        await redis_client.setex(
            cache_key,
            CACHE_TTL,
            json.dumps({
                "response": response,
                "model": model_used,
                "timestamp": int(time.time()),
            }),
        )
        return response

    except Exception as e:
        # 4. 降级：返回缓存中最相似的历史结果（即使已过期）
        stale = await redis_client.get(cache_key)  # 尝试获取可能过期的数据
        if stale:
            print(f"⚠️ Serving stale cache due to LLM failure")
            return json.loads(stale)["response"]
        raise


async def semantic_cache_search(query: str, threshold: float = 0.95):
    """
    语义缓存搜索：用 Embedding + 向量检索找历史相似问答
    需要额外维护 Redis Vector 或 Milvus
    """
    # query_embedding = await get_embedding(query)
    # results = await vector_db.search(
    #     collection="llm_cache",
    #     query_vector=query_embedding,
    #     top_k=1,
    #     filter_expr=f"score >= {threshold}"
    # )
    # return results[0] if results else None
    pass
```

---

## 六、第四层：规则兜底

当所有 AI 链路都失败时，用**确定性规则**保证基本可用：

```python
async def rule_based_fallback(query: str) -> str:
    """规则兜底：关键词匹配 + 模板回复"""

    # 预设的 FAQ 规则库
    RULES = [
        {"keywords": ["你好", "hello", "hi"], "reply": "您好！我是智能助手，有什么可以帮助您的？"},
        {"keywords": ["退款", "退货", "售后"], "reply": "关于退款问题，请联系客服热线 400-xxx-xxxx。"},
        {"keywords": ["价格", "多少钱", "费用"], "reply": "产品详情请查看我们的定价页面：example.com/pricing"},
    ]

    # 关键词匹配
    for rule in RULES:
        if any(kw in query.lower() for kw in rule["keywords"]):
            return rule["reply"]

    # 默认兜底回复
    return (
        "抱歉，系统当前繁忙，暂时无法处理您的请求。\n"
        "您可以：\n"
        "1. 稍后重试\n"
        "2. 联系人工客服\n"
        "3. 访问帮助中心：help.example.com"
    )


async def cache_or_rule_fallback(prompt: str) -> tuple[str, str]:
    """缓存降级 → 规则兜底"""
    # 先试缓存降级
    cache_key = get_cache_key(prompt)
    stale = await redis_client.get(cache_key)
    if stale:
        logger.warning("Serving stale cache as final fallback")
        return json.loads(stale)["response"], "stale_cache"

    # 最后规则兜底
    logger.warning("Rule-based fallback activated")
    return rule_based_fallback(prompt), "rule_engine"
```

---

## 七、第五层：熔断器模式（Circuit Breaker）

### 7.1 三种状态

```
        CLOSED（正常）                OPEN（熔断）
    ┌──────────────────┐         ┌──────────────┐
    │ 正常调用 LLM API  │  失败率  │ 直接拒绝请求   │
    │ 统计成功/失败     │ ──────→ │ 不再调用API   │
    └──────────────────┘ > 阈值   │ 等待冷却期    │
          ↑                      └──────┬───────┘
          │                             │ 冷却期结束
          │ 探测成功                     ▼
    ┌─────┴───────────────┐    HALF_OPEN（半开）
    │ 恢复正常调用          │←──  放行少量请求探测
    └─────────────────────┘     成功→CLOSED 失败→OPEN
```

### 7.2 熔断器实现

```python
import time
from enum import Enum
from dataclasses import dataclass, field


class CircuitState(Enum):
    CLOSED = "closed"      # 正常，允许调用
    OPEN = "open"          # 熔断，拒绝调用
    HALF_OPEN = "half_open"  # 半开，探测中


@dataclass
class CircuitBreaker:
    """熔断器"""
    failure_threshold: int = 5        # 连续失败 N 次触发熔断
    recovery_timeout: float = 60.0    # 熔断后冷却时间（秒）
    half_open_max_calls: int = 3      # 半开状态最多探测请求数

    _state: CircuitState = CircuitState.CLOSED
    _failure_count: int = 0
    _last_failure_time: float = 0.0
    _half_open_calls: int = 0

    @property
    def state(self) -> CircuitState:
        """获取当前状态（含自动转换逻辑）"""
        if self._state == CircuitState.OPEN:
            # 检查是否已过冷却期
            if time.time() - self._last_failure_time >= self.recovery_timeout:
                self._state = CircuitState.HALF_OPEN
                self._half_open_calls = 0
                logger.info("Circuit breaker → HALF_OPEN (probing)")
        return self._state

    def can_call(self) -> bool:
        """是否允许调用"""
        if self.state == CircuitState.CLOSED:
            return True
        elif self.state == CircuitState.HALF_OPEN:
            if self._half_open_calls < self.half_open_max_calls:
                self._half_open_calls += 1
                return True
            return False
        else:  # OPEN
            return False

    def record_success(self):
        """记录成功"""
        if self._state == CircuitState.HALF_OPEN:
            logger.info("Circuit breaker → CLOSED (recovered)")
        self._state = CircuitState.CLOSED
        self._failure_count = 0

    def record_failure(self):
        """记录失败"""
        self._failure_count += 1
        self._last_failure_time = time.time()

        if self._state == CircuitState.HALF_OPEN:
            # 半开状态失败 → 重新熔断
            self._state = CircuitState.OPEN
            logger.warning("Circuit breaker → OPEN (probe failed)")
        elif self._failure_count >= self.failure_threshold:
            self._state = CircuitState.OPEN
            logger.warning(f"Circuit breaker → OPEN "
                         f"(failures={self._failure_count})")


# 使用示例
breaker = CircuitBreaker(failure_threshold=5, recovery_timeout=60)

async def call_with_circuit_breaker(prompt: str):
    if not breaker.can_call():
        # 熔断中，直接走降级
        logger.warning("Circuit breaker OPEN, skipping LLM call")
        return await cache_or_rule_fallback(prompt)

    try:
        result = await call_with_fallback(prompt)
        breaker.record_success()
        return result
    except Exception as e:
        breaker.record_failure()
        raise
```

---

## 八、完整调用链整合

```python
async def robust_llm_call(prompt: str) -> dict:
    """
    完整的容错调用链：
    熔断器 → 缓存 → 重试 → 模型降级 → 缓存降级 → 规则兜底
    """
    # 1. 熔断器检查
    if not breaker.can_call():
        logger.warning("Circuit open, serving fallback")
        response, source = await cache_or_rule_fallback(prompt)
        return {"response": response, "source": f"fallback_{source}"}

    # 2. 缓存检查
    cache_key = get_cache_key(prompt)
    cached = await redis_client.get(cache_key)
    if cached:
        return {"response": json.loads(cached)["response"], "source": "exact_cache"}

    # 3. 调用 LLM（内含重试 + 模型降级链）
    try:
        response, model_used = await call_with_fallback(prompt)
        breaker.record_success()

        # 写缓存
        await redis_client.setex(cache_key, CACHE_TTL,
            json.dumps({"response": response, "model": model_used}))

        return {"response": response, "source": f"model:{model_used}"}

    except Exception as e:
        breaker.record_failure()

        # 4. 缓存降级 → 规则兜底
        response, source = await cache_or_rule_fallback(prompt)
        return {"response": response, "source": f"fallback_{source}"}
```

---

## 九、监控与告警

容错机制只是兜底，**监控降级触发频率才是根本**：

| 监控指标 | 含义 | 告警阈值 |
|----------|------|----------|
| `retry_rate` | 重试触发率 | > 10% 告警 |
| `fallback_rate` | 模型降级触发率 | > 5% 告警 |
| `cache_hit_rate` | 缓存命中率 | < 10% 告警 |
| `circuit_open_count` | 熔断器 Open 次数 | > 0 立即告警 |
| `rule_fallback_rate` | 规则兜底触发率 | > 1% 立即告警 |
| `p99_latency` | P99 延迟 | > 10s 告警 |

```python
# Prometheus 指标上报示例
from prometheus_client import Counter, Histogram

llm_retry_total = Counter("llm_retry_total", "LLM retry count", ["model"])
llm_fallback_total = Counter("llm_fallback_total", "Model fallback count")
circuit_open_total = Counter("circuit_open_total", "Circuit breaker open count")
llm_latency = Histogram("llm_latency_seconds", "LLM call latency",
                        buckets=[0.5, 1, 2, 5, 10, 30, 60])
```

---

## 十、面试回答要点总结

1. **先表态**：大模型 API 超时/限流是常态，不是异常，必须在架构层面设计容错
2. **分层回答**：重试（指数退避+抖动）→ 模型降级（多模型 fallback chain）→ 缓存降级 → 规则兜底 → 熔断器保护
3. **代码能力**：现场写出指数退避重试的核心逻辑（含 Jitter）
4. **架构视野**：画出完整的容错架构图，说明每一层的触发条件和回退逻辑
5. **工程深度**：提到熔断器的三种状态（Closed/Open/Half-Open）和自动恢复
6. **可观测性**：降级不是终点，必须监控降级触发频率并告警
7. **追问准备**：退避间隔如何设置（base_delay 和 max_delay）、半开状态如何设计（探测请求数）、如何监控降级频率（Prometheus 指标）

## 记忆要点

- 系统定位：大模型API是不可控第三方依赖，因为存在超时与限流，所以必须构建多层容错链
- 重试策略：使用指数退避加抖动机制，因为可防止重试风暴，所以上限通常设为3次且仅针对429/5xx错误
- 多级降级链路：高优模型→低优模型→历史缓存→规则兜底，确保核心链路彻底崩溃时也能优雅响应
- 熔断机制：因为连续失败会导致整个服务雪崩，所以触发熔断阈值后直接拦截请求快速失败
- 缓存保护：利用Redis缓存相似Query结果，因为能在服务限流或宕机时提供良好的兜底体验

## 苏格拉底式面试追问

> 这组追问模拟面试官层层逼问，每一问先回答"为什么"，再回答"怎么做"，最后回答"如何证明"。

### 第一层：目标与动机

**Q：大模型 API 超时/限流你搞了"重试+降级+熔断+缓存"四件套，为什么不直接多备几个 API key 轮询，解决限流？**

多 key 只解决限流，解决不了超时、服务故障、模型抽风。即使有 10 个 key，如果 OpenAI 整体服务故障（如 region down），所有 key 都不可用。四件套分别防不同失败：重试防偶发网络抖动，降级防主模型不可用（切备用模型），熔崩防级联雪崩（连续失败时快速失败保护下游），缓存防重复计算（相似 query 直接返回历史结果）。多 key 是"横向扩容"，四件套是"纵深防御"，两者互补。生产级可用性（99.9%+）必须纵深防御，不能只靠多 key。

### 第二层：证据与定位

**Q：你的 AI 服务 P99 延迟从 3 秒飙到 30 秒，怎么定位是 LLM API 慢、重试风暴、还是熔断没生效？**

看三个指标。一是 LLM API 的响应时间——如果是 API 端慢（如 OpenAI 返回 10 秒），是上游问题；二是重试次数——如果每个请求重试 3 次才成功，是重试拖高了延迟（可能 API 限流导致首次总失败）；三是熔断状态——如果熔断该触发没触发（连续失败但没快速失败），请求还在傻等超时。常见根因：API 限流返回 429，客户端重试但 API 持续 429，重试 3 次耗 30 秒。治本是重试前判断 429 的 retry-after 头，或快速切换到备用模型而非重试同一模型。

### 第三层：根因深挖

**Q：你用指数退避重试（1s→2s→4s），但在大促时所有请求同时重试，反而加剧了 API 压力。根因和解法？**

根因是"重试风暴"——大量请求同时失败、同时按相同退避节奏重试，形成同步重试波峰，给已过载的 API 雪上加霜。解法是退避加"抖动"（jitter）——每个请求的退避时间加一个随机偏移（如 1s + random(0, 1s)），打散重试时间，避免同步波峰。更激进的是"退避客户端限流"——当检测到大量 429 时，客户端主动降速（令牌桶限流），减少发往 API 的请求量，而非靠重试硬扛。抖动是标配，客户端限流是高并发场景的进阶。

**Q：那为什么不直接在 API 持续 429 时熔断（快速失败），省得重试加剧问题？**

熔断和重试的服务影响不同。熔断是"放弃这个请求"（用户拿到错误），重试是"再试一次"（可能成功）。如果 API 只是偶发 429（如 10% 请求被限流），重试能挽回大部分用户体验；直接熔断会让所有用户（包括本可成功的）拿到错误。正确策略是分层：偶发 429 用重试（带抖动）挽回，持续高 429 率（如 >50% 持续 30 秒）才触发熔断（切备用模型或快速失败）。熔断是最后手段，不是首选。

### 第四层：方案权衡

**Q：多级降级你设的是"高优模型→低优模型→缓存→规则兜底"，为什么是这个顺序？**

按"质量从高到低、可用性从高到低"排序。高优模型（GPT-4）质量最好但最不可控（贵、易限流）；低优模型（GPT-3.5）质量次之但更稳定；缓存（历史相似 query 的结果）质量取决于历史但零依赖；规则兜底（如返回固定话术或 FAQ 匹配）质量最低但 100% 可用。降级顺序是"逐级牺牲质量换可用性"——先尽量保质量（切低优模型），质量保不住保可用性（缓存/规则）。每一级降级要有明确的触发条件（如高优模型连续失败 3 次切低优），不能手动干预。

**Q：为什么不直接全用低优模型（便宜稳定），省得降级切换的复杂度？**

质量不够。低优模型（GPT-3.5）在复杂推理、长文生成、工具调用上明显弱于高优模型（GPT-4），直接全用会导致业务质量下降。降级的意义是"平时用最好的（高优），出问题时切可用的（低优）"，在质量和可用性间动态平衡。且高优和低优的成本差可能 5-10 倍，平时用高优（量可控、成本可接受），只在故障时切低优（保可用性），整体成本远低于"全用高优"，质量远好于"全用低优"。

### 第五层：验证与沉淀

**Q：你怎么验证容错机制真的提升了可用性，而不是"配了但从没触发过"？**

做混沌测试——主动注入故障（模拟 API 超时、429 限流、服务不可用），验证重试/降级/熔断是否正确触发。统计线上各机制的触发率：重试触发率（多少请求重试过）、降级触发率（多少请求切了备用）、熔断触发率（多少时段熔断了）、缓存命中率。如果某机制从没触发，可能是"阈值设太严"（该触发没触发）或"服务太稳定"（好事但要确认机制可用）。目标是"平时不触发，故障时必触发"，通过混沌测试验证后者。

**Q：容错机制怎么沉淀成 AI 服务的标配？**

封装成统一的 `llm_call_with_resilience(prompt, tier)` 函数：内置重试（指数退避+抖动）、降级（按 tier 切模型）、熔断（连续失败阈值）、缓存（相似 query）。业务侧只传 prompt 和质量要求（tier），不感知容错逻辑。配套 SLO 看板（成功率、P99 延迟、各机制触发率、降级占比）和告警（成功率 <99% 触发 PagerDuty）。沉淀"各模型的 SLA 基线""降级链路配置模板""混沌测试用例库"，新 AI 服务接入即获得容错能力。

## 结构化回答




**30 秒电梯演讲：** 就像飞机出行——航班取消(超时)时先改签(重试)，改签不了换高铁(模型降级)，高铁也没有就住酒店等明天(缓存/规则降级)。

**展开框架：**
1. **指数退避+抖** — 指数退避+抖动重试(3次上限)
2. **GPT** — 模型降级(GPT-4→GPT-3.5→本地模型)
3. **Query** — 缓存降级(相似Query命中缓存)

**收尾：** 如何设置重试的退避间隔？





## 视频脚本

> 预计时长：5 分钟 | 由浅入深


| 时间 | 画面/字幕 | 口播台词 | 讲解要点 |
|------|----------|----------|----------|
| 0:00 | 标题卡：你在项目里遇到过大模型接口调用超时或限流的问题吗… | "就像飞机出行——航班取消(超时)时先改签(重试)，改签不了换高铁(模型降级)，高铁也没有就…" | 开场钩子 |
| 0:20 | 核心概念图 | "大模型API不稳定是常态，必须设计指数退避重试+多级降级(模型降级/缓存降级/规则降级)保障可用性。" | 核心定义 |
| 0:50 | 指数退避示意图 | "指数退避——指数退避+抖动重试(3次上限)" | 要点拆解1 |
| 1:30 | 模型降级(G示意图 | "模型降级(G——模型降级(GPT-4→GPT-3.5→本地模型)" | 要点拆解2 |
| 2:20 | 对比/实战案例图 | "对比一下常见误区和工程实践，看真实场景里怎么取舍。" | 实战与对比 |
| 3:10 | 总结卡 | "记住核心要点。下期我们追问：如何设置重试的退避间隔？" | 收尾与钩子 |
