---
id: note-bz-agent-035
difficulty: L3
category: ai
subcategory: Agent
tags:
  - B站面经
  - 工具调用
  - 容错
  - 稳定性
feynman:
  essence: 工具调用失败治理=重试+降级+换方案+告知用户。核心是"失败不崩溃"，把错误信息反馈给LLM让它自主决策下一步。
  analogy: 像开车遇到封路——先绕行(重试换参数)、走小路(降级)、实在不行打电话求助(人工)、最后告知乘客(用户)。
  first_principle: 工具调用是外部IO，必然失败（网络/超时/参数错）。关键不是避免失败，而是失败后的优雅处理。
  key_points:
    - 失败类型：超时/参数错/权限/服务不可用
    - 策略：重试→降级→换工具→告知用户
    - 关键：错误信息回传LLM，自主决策
    - 预防：超时/限流/熔断/兜底
first_principle:
  essence: 分布式系统的容错原则适用于工具调用——假设失败会发生，设计恢复机制。
  derivation: '工具是外部服务，受网络/可用性/数据正确性影响，100%成功不可能。解法：分类处理错误（可重试/可降级/不可恢复），保证用户体验不崩。'
  conclusion: 工具失败治理 = 分类容错（重试/降级/兜底） + 错误反馈（LLM自主调整）
follow_up:
  - 重试几次合适？——3次，指数退避
  - 降级到什么？——缓存/简化版/规则兜底
  - 怎么区分可重试和不可重试错误？——看错误类型（网络错可重试，参数错不可）
---

# 工具调用失败如何治理？

## 一、工具调用的失败类型

```
┌──────────────┬─────────────────────┬────────────────────┐
│ 失败类型      │ 原因                  │ 可恢复性            │
├──────────────┼─────────────────────┼────────────────────┤
│ 超时          │ 网络慢/服务负载高      │ 可重试              │
│ 网络错误      │ 连接断/DNS失败        │ 可重试              │
│ 参数错误      │ LLM生成的参数不合法    │ 改参数重试          │
│ 权限不足      │ 用户无权限            │ 不可恢复（告知用户）│
│ 服务不可用    │ 下游服务挂了          │ 降级/换方案         │
│ 结果异常      │ 返回了脏数据          │ 校验后换方案        │
│ 限流          │ 调用太频繁            │ 退避后重试          │
└──────────────┴─────────────────────┴────────────────────┘
```

## 二、四级容错策略

```
工具调用失败
     │
     ▼
┌─────────────────┐
│ Level 1: 重试    │ ← 瞬时错误（超时/网络）
│ 指数退避重试3次  │
└────────┬────────┘
         │ 仍失败
         ▼
┌─────────────────┐
│ Level 2: 降级    │ ← 服务不可用
│ 用缓存/简化版    │
└────────┬────────┘
         │ 无法降级
         ▼
┌─────────────────┐
│ Level 3: 换方案  │ ← 让LLM重新决策
│ 错误回传LLM      │
│ LLM选其他工具    │
└────────┬────────┘
         │ 无替代方案
         ▼
┌─────────────────┐
│ Level 4: 告知    │ ← 不可恢复
│ 诚实告知用户     │
│ 提供替代建议     │
└─────────────────┘
```

## 三、实现代码

```python
class ToolFailureHandler:
    def execute(self, tool_call):
        # Level 1: 带重试的执行
        result = self.execute_with_retry(tool_call, max_retries=3)
        if result.success:
            return result
        
        # Level 2: 尝试降级
        degraded = self.try_degrade(tool_call)
        if degraded:
            return degraded
        
        # Level 3: 错误回传LLM，换方案
        alternative = self.ask_llm_for_alternative(tool_call, result.error)
        if alternative:
            return self.execute(alternative)
        
        # Level 4: 告知用户
        return self.user_friendly_error(tool_call, result.error)
    
    def execute_with_retry(self, tool_call, max_retries=3):
        """指数退避重试"""
        for attempt in range(max_retries):
            try:
                result = self.tool.execute(tool_call, timeout=30)
                if self.validate(result):
                    return Success(result)
            except RetryableError as e:  # 超时/网络错
                wait = 2 ** attempt  # 1s, 2s, 4s
                sleep(wait)
            except ValidationError as e:
                # 参数错，让LLM修参数
                fixed = self.llm.fix_params(tool_call, str(e))
                tool_call.arguments = fixed.arguments
            except NonRetryableError as e:
                return Failure(e)  # 权限/致命错，不重试
        return Failure("重试耗尽")
    
    def try_degrade(self, tool_call):
        """降级策略"""
        # 缓存降级
        if cached := self.cache.get(tool_call.cache_key()):
            return Success(cached, source="cache")
        
        # 简化版降级
        if simpler := self.get_simpler_version(tool_call):
            return self.execute(simpler)
        
        return None
    
    def ask_llm_for_alternative(self, failed_call, error):
        """错误回传LLM，让它换方案"""
        message = {
            "role": "tool",
            "content": f"工具{failed_call.name}调用失败: {error}"
                       f"请换一种方式完成用户需求。"
        }
        # LLM看到错误，可能：
        # 1. 换个工具
        # 2. 用已有信息直接回答
        # 3. 告诉用户无法完成
        response = self.llm.replan(self.context + [message])
        return response.alternative_action
    
    def user_friendly_error(self, tool_call, error):
        """对用户友好的错误提示"""
        return {
            "response": f"抱歉，{tool_call.user_facing_name}暂时不可用。"
                       f"您可以稍后再试，或{self.suggest_alternative()}",
            "fallback": True
        }
```

## 四、预防性措施

```python
# 1. 超时控制
@timeout(30)
def execute_tool(tool_call):
    return tool.execute(tool_call)

# 2. 熔断（错误率过高停止调用）
class CircuitBreaker:
    def __init__(self):
        self.failures = 0
        self.threshold = 5
    
    def can_call(self):
        if self.failures >= self.threshold:
            return False  # 熔断，不再调
        return True
    
    def record_failure(self):
        self.failures += 1

# 3. 限流
@rate_limit(calls=100, per=60)
def execute_tool(tool_call):
    ...

# 4. 结果校验
def validate_result(result, schema):
    """校验工具返回是否符合预期"""
    if not schema.validate(result):
        raise DataError("工具返回数据异常")
```

## 五、错误回传 LLM 的威力

```
传统做法：工具失败→直接报错给用户
  用户体验差，且没有利用LLM的推理能力

智能做法：工具失败→错误回传LLM→LLM自主决策
  ┌──────────────────────────────────────────┐
  │ LLM看到: "search_flight 超时"              │
  │ LLM推理: "航班查询超时，可能是网络问题"     │
  │         "我可以先用get_time确认日期"       │
  │         "然后告诉用户稍后重试"              │
  │ LLM输出: 优雅的降级回复                    │
  └──────────────────────────────────────────┘
  
  → 用户感知不到后端失败，体验流畅
```

## 六、面试加分点

1. **分级容错**：重试→降级→换方案→告知，体系化而非单点
2. **错误回传 LLM**：这是 Agent 区别于传统程序的关键——失败后 LLM 自主决策而非硬编码
3. **预防+治理**：既要有事后治理（重试/降级），也要有事前预防（超时/熔断/限流）
