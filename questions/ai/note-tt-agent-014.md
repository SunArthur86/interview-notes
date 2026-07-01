---
id: note-tt-agent-014
difficulty: L3
category: ai
subcategory: Agent
tags:
- 淘天
- 面经
- 二面
- Function Call
- 工具调用
- 容错
- 幂等
feynman:
  essence: 模型反复调用错误工具时，需从参数校验→幂等设计→工具黑名单→降级兜底四层防护，阻断错误循环并保障最终可用
  analogy: 就像快递投递出错——先检查地址对不对（参数校验），同一个包裹别重复发（幂等），连续投递失败的快递公司拉黑（黑名单），最后人工派送（降级兜底）
  first_principle: Agent工具调用错误源于模型对工具Schema理解偏差或参数生成错误。需要工程层面的"护栏"阻断错误传播，不能只依赖模型能力提升
  key_points:
  - 参数校验：调用前验证类型/范围/必填项
  - 幂等设计：同一请求多次调用结果一致
  - 工具黑名单：连续失败的工具临时禁用
  - 降级兜底：工具不可用时返回友好降级
first_principle:
  essence: 错误调用的根因是模型不确定性，工程护栏的价值在于将不确定性限制在可控范围
  derivation: 设模型选对工具的概率p=0.9。不加重试防护时3步全对概率=0.729。加入参数校验(拦截50%错误调用)+黑名单(再拦截30%)后，等效错误率=0.1×0.5×0.7=0.035，3步全对=0.965³=89.9%
  conclusion: 防护体系不是让模型更聪明，而是在模型犯错时"接住"
follow_up:
- 如何区分"工具真的不可用"和"模型参数写错了"？
- 幂等Key怎么设计？不同业务场景的差异？
- 工具黑名单的恢复策略？什么时候解除禁用？
memory_points:
- 口诀法：模型调错工具常表现为死循环重试、意图混淆、参数幻觉与忽略报错
- 因果句：因为模型容易编造参数死循环，所以第一层必须做Pydantic参数强校验
- 因果句：因为大模型易陷入重试泥潭，所以同一参数组合要设计幂等缓存直接返回
- 对比句：参数校验防幻觉，幂等缓存防死循环，连续失败超过阈值拉入工具黑名单
---

# 频繁出现模型反复调用错误工具怎么处理？

## 错误模式分析

```
Agent工具调用失败的常见模式：

模式1: 死循环调用
  → 调用search_products(price_range="invalid") → 报错
  → 再调search_products(price_range="invalid") → 报错
  → 再调...  ← 无限重试，烧Token

模式2: 工具混淆
  → 需要查询库存，却调用了下单接口
  → 需要搜索商品，却调用了推荐接口

模式3: 参数幻觉
  → 调用get_order(order_id="abc123")  ← 编造了不存在的order_id
  → 调用get_order(order_id="xyz789")  ← 又编了一个

模式4: 忽略错误信息
  → API返回"参数price_range必须为数字"
  → 模型不修正参数，继续传同样的错误值
```

## 四层防护体系

### 第一层：参数校验

```python
from pydantic import BaseModel, validator

class SearchProductsParams(BaseModel):
    keyword: str
    price_range: tuple[float, float] | None = None
    category: str | None = None

    @validator('price_range')
    def validate_price_range(cls, v):
        if v and v[0] >= v[1]:
            raise ValueError("price_range下限必须小于上限")
        if v and v[0] < 0:
            raise ValueError("价格不能为负")
        return v

def safe_tool_call(tool_name: str, params: dict, schemas: dict):
    """调用前校验参数"""
    schema = schemas.get(tool_name)
    if not schema:
        return {"error": f"未知工具: {tool_name}"}
    try:
        validated = schema(**params)
        return execute_tool(tool_name, validated.dict())
    except Exception as e:
        # 将校验错误信息反馈给模型，帮助它修正
        return {
            "error": f"参数校验失败: {e}",
            "hint": f"请检查参数格式，正确格式为: {schema.schema()}"
        }
```

### 第二层：幂等设计

```python
import hashlib

def idempotent_call(tool_name: str, params: dict, redis_client):
    """同一参数组合只执行一次"""
    # 生成幂等Key
    key_str = f"{tool_name}:{json.dumps(params, sort_keys=True)}"
    idempotency_key = hashlib.md5(key_str.encode()).hexdigest()

    # 检查是否已执行过
    cached = redis_client.get(f"idempotent:{idempotency_key}")
    if cached:
        return json.loads(cached)  # 返回缓存结果，不重复执行

    # 执行并缓存（TTL=300秒）
    result = execute_tool(tool_name, params)
    redis_client.setex(f"idempotent:{idempotency_key}", 300, json.dumps(result))
    return result
```

### 第三层：工具黑名单

```python
class ToolBlacklist:
    def __init__(self, failure_threshold=3, cooldown=300):
        self.failure_counts = {}  # tool_name → count
        self.blacklist = {}       # tool_name → unblock_time
        self.threshold = failure_threshold
        self.cooldown = cooldown

    def check(self, tool_name: str) -> bool:
        """检查工具是否被禁用"""
        if tool_name in self.blacklist:
            if time.time() < self.blacklist[token_name]:
                return False  # 被禁用
            else:
                del self.blacklist[tool_name]  # 冷却期过，解除
                self.failure_counts[tool_name] = 0
        return True

    def record_failure(self, tool_name: str):
        self.failure_counts[tool_name] = self.failure_counts.get(tool_name, 0) + 1
        if self.failure_counts[tool_name] >= self.threshold:
            self.blacklist[tool_name] = time.time() + self.cooldown
            return True  # 已加入黑名单
        return False
```

### 第四层：降级兜底

```python
def graceful_degradation(tool_name: str, user_intent: str):
    """工具不可用时的降级策略"""

    # Level 1: 尝试替代工具
    alternatives = TOOL_ALTERNATIVES.get(tool_name, [])
    for alt in alternatives:
        if blacklist.check(alt):
            return try_alternative(alt, user_intent)

    # Level 2: 使用缓存
    cached = cache.get_similar(user_intent)
    if cached:
        return {"status": "cached", "result": cached}

    # Level 3: 返回友好提示
    return {
        "status": "degraded",
        "message": "该功能暂时不可用，正在为您转接人工客服...",
        "escalate": True,
    }
```

## 面试加分点

1. **错误信息回传**：工具调用失败时，将错误信息+正确格式提示反馈给模型，帮助模型自我修正（而非简单重试）
2. **死循环检测**：监控同一工具连续调用次数，超过阈值（如5次）强制跳出循环
3. **Tool Description优化**：很多错误调用是因为工具描述不清，优化Description可以降低误调用率30%+
4. **成本防护**：设置单次会话Token预算上限，工具死循环时自动熔断止损

## 记忆要点

- 口诀法：模型调错工具常表现为死循环重试、意图混淆、参数幻觉与忽略报错
- 因果句：因为模型容易编造参数死循环，所以第一层必须做Pydantic参数强校验
- 因果句：因为大模型易陷入重试泥潭，所以同一参数组合要设计幂等缓存直接返回
- 对比句：参数校验防幻觉，幂等缓存防死循环，连续失败超过阈值拉入工具黑名单

