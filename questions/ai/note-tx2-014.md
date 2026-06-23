---
id: note-tx2-014
difficulty: L2
category: ai
subcategory: 算法
tags:
- 腾讯
- 面经
- JSON校验
- Pydantic
- 算法题
feynman:
  essence: 实现函数校验模型输出 tool_call JSON 合法性，要 catch 字段缺失/类型错误/枚举越界/多余字段/格式错误五类。用 Pydantic 定义 schema 做自动校验，捕获 ValidationError 分类返回。校验流程：先 json.loads 解析格式 → 再 Pydantic 校验字段（类型/必填/枚举）→ 最后业务校验（如金额>0）。失败要让模型重写（错误信息塞回 prompt），最多重试2次。
  analogy: 像海关检查——先看护照是不是真的(json.loads格式)、再核对信息全不全(必填字段)、再看类型对不对(类型校验)、最后看有没有违禁品(业务规则)。不合格的退回去重新填。
  first_principle: JSON 校验本质是"用 schema 约束 + 分层校验"。先格式后字段后业务，每层 catch 不同错误，分类返回让模型能修正。
  key_points:
  - '五类错误: 字段缺失/类型错误/枚举越界/多余字段/格式错误'
  - 'Pydantic 定义schema自动校验，捕ValidationError分类返回'
  - '校验流程: json.loads解析 → Pydantic字段校验 → 业务校验'
  - '失败让模型重写(错误塞回prompt)，最多重试2次'
  - '错误信息要具体(哪个字段、期望什么、实际什么)'
first_principle:
  essence: JSON 校验 = schema 约束 + 分层校验
  derivation: 模型输出可能错 → 用 schema 约束 → 但错误多样 → 分层校验(格式/字段/业务) → 分类返回 → 让模型能修正
  conclusion: 校验不是"通过/不通过"二分，而是"具体哪里错了 + 怎么改"
follow_up:
- Pydantic v1 和 v2 的 ValidationError 区别？
- 枚举字段模糊匹配（"中国"→"China"）怎么做？
- 怎么设计错误信息让模型最容易修正？
---

# 【某讯面经】算法题：实现函数校验模型输出的 tool_call JSON 合法性

## 一、题目要求

实现一个函数，校验模型输出的 tool_call JSON 是否合法，捕获：
- 字段缺失（必填字段没给）
- 类型错误（要 number 给了 string）
- 枚举越界（不在允许的枚举值里）
- 多余字段（schema 里没有的）
- 格式错误（不是合法 JSON）

## 二、用 Pydantic 实现

```python
from pydantic import BaseModel, Field, ValidationError, field_validator
from typing import Literal
import json

# 1. 定义 schema（Pydantic Model）
class GetWeatherParams(BaseModel):
    city: str = Field(..., description="城市名")
    date: str = Field(..., description="日期 YYYY-MM-DD")
    unit: Literal["C", "F"] = Field(default="C", description="温度单位")
    
    @field_validator('date')
    @classmethod
    def validate_date(cls, v):
        # 业务校验：日期格式
        from datetime import datetime
        try:
            datetime.strptime(v, '%Y-%m-%d')
        except ValueError:
            raise ValueError('date 必须是 YYYY-MM-DD 格式')
        return v

class ToolCall(BaseModel):
    name: str = Field(..., description="工具名")
    arguments: GetWeatherParams  # 嵌套参数
    
    # 拒绝多余字段
    model_config = {"extra": "forbid"}


# 2. 校验函数
def validate_tool_call(raw_output: str, allowed_tools: list[str]) -> dict:
    """
    校验模型输出的 tool_call JSON
    返回: {"valid": bool, "errors": [...], "data": ToolCall|None}
    """
    errors = []
    
    # 第1层：格式校验（json.loads）
    try:
        data = json.loads(raw_output)
    except json.JSONDecodeError as e:
        return {
            "valid": False,
            "errors": [f"JSON格式错误: {str(e)}"],
            "data": None
        }
    
    # 第2层：工具名校验
    tool_name = data.get('name')
    if tool_name not in allowed_tools:
        errors.append(
            f"工具名非法: '{tool_name}'，允许的工具: {allowed_tools}"
        )
    
    # 第3层：字段校验（Pydantic）
    try:
        tool_call = ToolCall(**data)
    except ValidationError as e:
        # 分类错误
        for err in e.errors():
            loc = '.'.join(str(x) for x in err['loc'])
            msg = err['msg']
            err_type = err['type']
            
            if err_type == 'missing':
                errors.append(f"字段缺失: {loc} - {msg}")
            elif err_type in ('int_parsing', 'string_type', 'float_parsing'):
                errors.append(f"类型错误: {loc} - {msg}")
            elif err_type == 'literal_error':
                errors.append(f"枚举越界: {loc} - {msg}")
            elif err_type == 'extra_forbidden':
                errors.append(f"多余字段: {loc} - {msg}")
            else:
                errors.append(f"校验失败: {loc} - {msg} ({err_type})")
    
    if errors:
        return {"valid": False, "errors": errors, "data": None}
    return {"valid": True, "errors": [], "data": tool_call}


# 3. 测试
allowed = ["get_weather", "get_news"]

# 测试各类错误
test_cases = [
    ('{"name": "get_weather", "arguments": {"city": "北京", "date": "2026-06-24"}}', "合法"),
    ('{"name": "get_weather", "arguments": {"city": "北京"}}', "缺 date"),
    ('{"name": "get_weather", "arguments": {"city": 123, "date": "2026-06-24"}}', "city 类型错"),
    ('{"name": "get_weather", "arguments": {"city": "北京", "date": "2026-06-24", "unit": "K"}}', "枚举越界"),
    ('{"name": "get_weather", "extra": "x", "arguments": {...}}', "多余字段"),
    ('not a json', "格式错"),
]

for raw, desc in test_cases:
    result = validate_tool_call(raw, allowed)
    print(f"[{desc}] valid={result['valid']}, errors={result['errors']}")
```

## 三、校验失败后怎么处理

```python
def call_with_validation(prompt, allowed_tools, max_retries=2):
    for attempt in range(max_retries + 1):
        raw = llm.invoke(prompt)
        result = validate_tool_call(raw, allowed_tools)
        
        if result['valid']:
            return result['data']
        
        if attempt < max_retries:
            # 把错误信息塞回 prompt，让模型重写
            error_msg = "\n".join(result['errors'])
            prompt = f"""
            你上次的输出有误：
            {raw}
            
            错误：
            {error_msg}
            
            请修正后重新输出合法 JSON。
            """
        else:
            # 重试耗尽，转人工
            raise ValidationFailed(result['errors'])
```

## 四、错误信息设计（让模型容易修正）

```python
# ❌ 差的错误信息（模型不知道怎么改）
"校验失败"

# ✅ 好的错误信息（具体+可操作）
"字段缺失: arguments.date - 字段必填 (type: missing)。期望格式: YYYY-MM-DD"
"类型错误: arguments.city - 输入是 int (123)，期望 str"
"枚举越界: arguments.unit - 输入 'K'，允许值 ['C', 'F']"
```

## 五、加分点

- 说出 **分层校验**：格式（json.loads）→ 字段（Pydantic）→ 业务（自定义 validator），每层 catch 不同错误
- 说出 **错误信息要可操作**：告诉模型"哪里错了+期望什么+怎么改"
- 说出 **重试机制**：错误塞回 prompt 让模型重写，最多 2 次（控成本）

## 六、雷区

- ❌ 只校验格式不校验字段 → 字段错了也能通过
- ❌ 错误信息太笼统 → 模型不知道怎么改
- ❌ 无限重试 → 烧钱，最多 2-3 次

## 七、扩展

- **Pydantic v2**：性能比 v1 快 5-50 倍，ValidationError 结构更清晰
- **模糊匹配**：枚举字段用 fuzzy match（"中国"→"China"），ratidio 库
- **Schema 热更新**：工具 schema 存配置中心，校验器动态加载，不改代码加新工具
