---
id: note-ai-dev-001
difficulty: L3
category: ai
subcategory: Agent
tags:
  - 面经
  - AI应用开发
  - 工程化
feynman:
  essence: Function Calling的工程容错需要三层防御——输入层Schema校验、模型层重试+修复、输出层降级兜底
  analogy: '像快递分拣系统——先检查包裹信息是否完整(校验)，分拣出错就重新扫描(重试)，实在不行就走人工通道(降级)'
  first_principle: 'LLM输出是非确定性的，Function Calling的JSON可能有格式错误、字段缺失、类型不匹配。工程上必须假设"每次输出都可能出错"来设计兜底'
  key_points:
    - '输入层: JSON Schema校验 + 参数类型检查'
    - '模型层: 自动重试 + Few-shot修复 + 格式约束Prompt'
    - '输出层: 降级方案 + 默认值 + 人工介入触发'
first_principle:
  essence: Function Calling的可靠性 = 模型能力 × 工程容错率
  derivation: '即使GPT-4的Function Calling准确率约95%，在1万次调用中仍有500次失败。生产系统需要将99.99%的可靠性目标通过工程手段弥补模型的不确定性'
  conclusion: 好的Function Calling系统不是靠"模型更强"，而是靠"工程更健壮"
follow_up:
  - 除了Function Calling还有哪些结构化输出方法？
  - 如何监控Function Calling的线上成功率？
  - 流式输出如何处理Function Calling？
---

# Function Calling工程实现：如何设计容错机制？

> 来源：小红书面经——AI应用开发面试

## 容错架构设计

```
┌──────────────────────────────────────────────────────────┐
│            Function Calling 三层容错架构                   │
│                                                          │
│  用户Query                                               │
│      │                                                   │
│      ▼                                                   │
│  ┌──────────────┐                                        │
│  │ LLM Function │ → 生成JSON                             │
│  │ Calling      │                                        │
│  └──────┬───────┘                                        │
│         │                                                │
│         ▼                                                │
│  ┌──────────────────────────────────────────────┐        │
│  │     第1层: Schema校验 (输入层防御)              │        │
│  │  • JSON格式是否合法?                           │        │
│  │  • 必填字段是否齐全?                           │        │
│  │  • 字段类型是否匹配?                           │        │
│  │  • 值是否在允许范围内?                         │        │
│  └──────┬───────────────┬───────────────────────┘        │
│         │ 通过           │ 失败                            │
│         ▼               ▼                                │
│    执行工具      ┌──────────────┐                         │
│         │       │ 第2层: 修复重试 │                        │
│         │       │ • 附加错误信息  │                        │
│         │       │ • Few-shot修复 │                        │
│         │       │ • 结构化Prompt │                        │
│         │       └───┬──────┬────┘                         │
│         │      成功 │      │ 仍失败                        │
│         │           ▼      ▼                              │
│         │      执行工具  ┌──────────────┐                 │
│         │               │ 第3层: 降级兜底 │                 │
│         │               │ • 返回默认值   │                 │
│         │               │ • 规则引擎兜底 │                 │
│         │               │ • 转人工      │                 │
│         │               └──────────────┘                  │
│         ▼                                                │
│    工具执行结果                                           │
│         │                                                │
│         ▼                                                │
│    LLM生成最终回答                                        │
└──────────────────────────────────────────────────────────┘
```

## 代码实现

```python
import json
from jsonschema import validate, ValidationError
from dataclasses import dataclass
from typing import Optional, Any

@dataclass
class FunctionCallResult:
    success: bool
    function_name: Optional[str]
    arguments: Optional[dict]
    error: Optional[str]
    fallback_used: bool = False

class RobustFunctionCaller:
    """生产级Function Calling容错系统"""
    
    def __init__(self, llm_client):
        self.llm = llm_client
        self.max_retries = 3
        self.tool_schemas = {}  # 注册的工具schema
    
    def register_tool(self, name, description, parameters_schema):
        """注册工具及其JSON Schema"""
        self.tool_schemas[name] = {
            "description": description,
            "parameters": parameters_schema
        }
    
    def call(self, user_query, context=None):
        """完整的Function Calling容错流程"""
        
        for attempt in range(self.max_retries):
            # Step 1: LLM生成Function Call
            raw_output = self.llm.generate(
                self._build_prompt(user_query, context, attempt)
            )
            
            # Step 2: 解析JSON
            parsed = self._safe_parse_json(raw_output)
            if not parsed:
                continue  # JSON解析失败，重试
            
            # Step 3: Schema校验
            func_name = parsed.get("function_name") or parsed.get("name")
            args = parsed.get("arguments") or parsed.get("args")
            
            if func_name not in self.tool_schemas:
                continue  # 未知函数名
            
            try:
                validate(instance=args, schema=self.tool_schemas[func_name]["parameters"])
                # ★ 校验通过 → 执行工具
                return FunctionCallResult(
                    success=True,
                    function_name=func_name,
                    arguments=args,
                    error=None
                )
            except ValidationError as e:
                # Schema校验失败 → 附加错误信息重试
                context = self._add_error_context(context, str(e))
                continue
        
        # ★ 所有重试失败 → 降级处理
        return self._fallback(user_query, context)
    
    def _safe_parse_json(self, raw_output):
        """安全的JSON解析，处理常见格式问题"""
        
        # 策略1: 直接解析
        try:
            return json.loads(raw_output)
        except json.JSONDecodeError:
            pass
        
        # 策略2: 提取JSON块
        import re
        json_match = re.search(r'\{[^{}]*\}', raw_output, re.DOTALL)
        if json_match:
            try:
                return json.loads(json_match.group())
            except json.JSONDecodeError:
                pass
        
        # 策略3: 修复常见错误
        fixed = raw_output.strip()
        fixed = fixed.replace("'", '"')      # 单引号→双引号
        fixed = fixed.rstrip(',')             # 移除尾部逗号
        fixed = re.sub(r',\s*}', '}', fixed)  # 移除对象尾部逗号
        fixed = re.sub(r',\s*]', ']', fixed)  # 移除数组尾部逗号
        
        try:
            return json.loads(fixed)
        except json.JSONDecodeError:
            return None
    
    def _build_prompt(self, query, context, attempt):
        """构建带容错提示的Prompt"""
        prompt = f"""
用户请求: {query}

可用工具: {json.dumps(self.tool_schemas, ensure_ascii=False)}

请输出Function Call (严格JSON格式):
{{
  "function_name": "工具名",
  "arguments": {{...}}
}}
"""
        if attempt > 0:
            prompt += f"""
⚠️ 上一次调用失败了，错误信息: {context.get('last_error', 'unknown')}
请仔细检查格式，确保JSON合法且参数类型正确。
"""
        return prompt
    
    def _fallback(self, query, context):
        """降级兜底策略"""
        
        # 策略1: 尝试基于规则的简单匹配
        rule_result = self._rule_based_match(query)
        if rule_result:
            return FunctionCallResult(
                success=True,
                function_name=rule_result["function"],
                arguments=rule_result["args"],
                error=None,
                fallback_used=True
            )
        
        # 策略2: 返回默认值
        return FunctionCallResult(
            success=False,
            function_name=None,
            arguments=None,
            error="Function calling failed after all retries",
            fallback_used=True
        )
```

## 工程最佳实践

```
┌────────────────────────────────────────────────┐
│         Function Calling 工程检查清单           │
├────────────────────────────────────────────────┤
│ ✅ Schema定义: 每个工具都有JSON Schema          │
│ ✅ 类型校验: string/number/array/boolean       │
│ ✅ 必填检查: required字段标注                   │
│ ✅ 枚举约束: enum限定可选值                    │
│ ✅ 范围约束: minimum/maximum/pattern           │
│ ✅ 超时控制: 单次LLM调用+工具执行超时           │
│ ✅ 重试策略: 指数退避 + 最大3次                 │
│ ✅ 降级方案: 默认值/规则匹配/人工转接           │
│ ✅ 监控告警: 成功率/失败率/平均延迟             │
│ ✅ 日志审计: 记录原始输出+解析结果+错误信息     │
│ ✅ Bad Case: 收集失败案例用于优化Prompt         │
└────────────────────────────────────────────────┘
```

| 常见错误 | 频率 | 解决方案 |
|---------|------|---------|
| JSON格式错误 | 15% | 多策略JSON解析+修复 |
| 缺少必填字段 | 10% | Schema校验+错误提示重试 |
| 字段类型错误 | 8% | 类型强制转换+校验 |
| 函数名不存在 | 5% | 函数名模糊匹配 |
| 参数值越界 | 3% | range/enum约束 |
| 幻觉参数 | 2% | schema additionalProperties:false |

**面试加分点**：提到OpenAI的Structured Outputs（2024）通过约束解码保证JSON格式100%合法；提到Pydantic做Python原生的参数校验比JSON Schema更简洁；提到在生产环境中应该监控Function Calling的P99延迟和成功率，设置告警阈值（如成功率<95%触发告警）；提到Prompt中加入few-shot示例可以提高首次调用成功率10-20%。
