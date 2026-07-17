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
  - Pydantic 定义schema自动校验，捕ValidationError分类返回
  - '校验流程: json.loads解析 → Pydantic字段校验 → 业务校验'
  - 失败让模型重写(错误塞回prompt)，最多重试2次
  - 错误信息要具体(哪个字段、期望什么、实际什么)
first_principle:
  essence: JSON 校验 = schema 约束 + 分层校验
  derivation: 模型输出可能错 → 用 schema 约束 → 但错误多样 → 分层校验(格式/字段/业务) → 分类返回 → 让模型能修正
  conclusion: 校验不是"通过/不通过"二分，而是"具体哪里错了 + 怎么改"
follow_up:
- Pydantic v1 和 v2 的 ValidationError 区别？
- 枚举字段模糊匹配（"中国"→"China"）怎么做？
- 怎么设计错误信息让模型最容易修正？
memory_points:
- 校验三层：先json.loads查格式，再查工具名是否越界，最后用Pydantic查参数
- Pydantic设计：用Literal约束枚举，extra='forbid'拒绝多余字段，写validator校验业务逻辑
- 错误分类：精准捕获缺失、类型错误、枚举越界等异常并返回，非简单抛出报错
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

## 记忆要点

- 校验三层：先json.loads查格式，再查工具名是否越界，最后用Pydantic查参数
- Pydantic设计：用Literal约束枚举，extra='forbid'拒绝多余字段，写validator校验业务逻辑
- 错误分类：精准捕获缺失、类型错误、枚举越界等异常并返回，非简单抛出报错


## 苏格拉底式面试追问

> 这组追问模拟面试官层层逼问，每一问先回答"为什么"，再回答"怎么做"，最后回答"如何证明"。

### 第一层：目标与动机

**Q：校验 tool_call JSON 合法性，为什么要 catch 五类错误（缺失/类型/枚举/多余/格式）？少 catch 一类会怎样？**

少 catch 一类会导致该类错误"漏网"，传到下游引发不可预期的故障。如：1) 漏 catch"字段缺失"——下游用 None 调 API，报错或返回错误数据；2) 漏 catch"类型错误"——order_id 是 int 但下游要 string，拼接 SQL 时类型混乱；3) 漏 catch"枚举越界"——status 是"已完成"但枚举只有"待支付/已支付"，下游逻辑混乱；4) 漏 catch"多余字段"——可能触发严格 schema 的拒绝或注入攻击；5) 漏 catch"格式错误"——日期格式错导致解析失败。五类是"输入校验的完整覆盖"，缺一有漏洞。

### 第二层：证据与定位

**Q：校验通过了但下游工具仍报错，怎么定位是校验逻辑漏了还是工具自身的问题？**

看工具报错的具体信息。1) 如果是"参数值不合理"（如 order_id 不存在）——校验只管"格式对"不管"值有效"（order_id 格式对但库里没有），是业务逻辑问题不是校验问题；2) 如果是"参数类型不对"——校验漏了类型检查；3) 如果是"必填字段缺失"——校验漏了 required 检查。区分方法：把 tool_call JSON 和工具的 schema 逐字段对比，确认哪个字段不合规但校验没 catch。

### 第三层：根因深挖

**Q：用 Pydantic 校验，但某些复杂嵌套结构（如 list of dict）校验不准，根因是 Pydantic 能力不够还是 schema 定义不清？**

通常是 schema 定义不清。Pydantic 支持复杂的嵌套类型（List[Dict[str, Any]]、Optional、Union），但要求 schema 定义精确。如果 schema 用了宽泛类型（如 Any）或没定义嵌套结构，Pydantic 无法严格校验。根因是"schema 的类型定义不够严格"。解法：1) 用具体的嵌套模型（如 List[OrderItem] 而非 List[dict]）；2) 用 Strict 模式（Pydantic v2 的 strict=True）禁止隐式类型转换；3) 加自定义 validator 校验业务规则。

**Q：那为什么不直接手写 if-else 校验（更可控），而要用 Pydantic？**

手写 if-else 在字段多时维护噩梦。10 个字段、5 种校验类型 = 50 个 if 分支，代码冗长、易漏、难测。Pydantic 用"声明式 schema"（定义模型类），自动生成校验逻辑，代码简洁、覆盖完整、可复用。且 Pydantic 的错误信息结构化（每个字段的错误类型），便于分类处理。手写校验适合"极简单的 1-2 个字段"，Pydantic 适合"结构化的 schema 校验"。生产用 Pydantic（或类似的 marshmallow、jsonschema）。

### 第四层：方案权衡

**Q：校验失败后"让模型重写"（把错误塞回 prompt 重新调 LLM）vs 直接报错，怎么选？**

按"是否可恢复"判断。1) 格式/类型错误——大概率可恢复（模型理解错格式，重写能修正），让模型重写，最多 2 次；2) 业务逻辑错误（如金额为负）——可能可恢复（模型理解错业务规则），重写 1 次；3) 枚举越界——看模型是否有正确选项的上下文，有则重写。报错（不重写）适合：重试过 2 次仍错（模型学不会）、或错误不可恢复（如缺少必填信息）。权衡"重试成本 vs 成功概率"。

**Q：为什么不直接用 Constrained Decoding（强制输出合法 JSON），而要事后校验？**

Constrained Decoding 保证"格式合法"但不保证"语义正确"。它能保证输出是合法 JSON 且字段类型对，但无法保证"order_id 真实存在"或"金额 > 0"这种业务约束（需要查库）。所以 Constrained Decoding 解决格式层，校验解决业务层。两者配合：Constrained Decoding 兜底格式（省去格式校验），Pydantic 校验业务规则（如金额范围、枚举值）。纯校验（无 Constrained Decoding）也能工作，但要处理更多格式错误。

### 第五层：验证与沉淀

**Q：怎么衡量校验逻辑的覆盖率（五类错误都 catch 到了）？**

构造测试集覆盖五类：1) 缺失——必填字段不传；2) 类型——传错类型（int 传 string）；3) 枚举——传超范围的值；4) 多余——传 schema 没有的字段；5) 格式——传格式错的值（如日期 "2021-13-45"）。每个 case 标注 expected error，校验函数跑一遍对比。沉淀为校验测试规范：每个工具 schema 的五类测试 case + 边界 case（如 null、空字符串、超大数字）。

## 结构化回答

**30 秒电梯演讲：** 实现函数校验模型输出 tool_call JSON 合法性，要 catch 字段缺失/类型错误/枚举越界/多余字段/格式错误五类。用 Pydantic 定义 schema 做自动校验。

**展开框架：**
1. **五类错误** — 字段缺失/类型错误/枚举越界/多余字段/格式错误
2. **Pydantic** — Pydantic 定义schema自动校验，捕ValidationError分类返回
3. **校验流程** — json.loads解析 → Pydantic字段校验 → 业务校验

**收尾：** 您想深入聊：Pydantic v1 和 v2 的 ValidationError 区别？


## 视频脚本

> 预计时长：3 分钟 | 由浅入深


| 时间 | 画面/字幕 | 口播台词 | 讲解要点 |
|------|----------|----------|----------|
| 0:00 | 标题卡：算法题：实现函数校验模型输出的 tool_… | "像海关检查——先看护照是不是真的(json.loads格式)、再核对信息全不全(必填字段)…" | 开场钩子 |
| 0:20 | 核心概念图 | "实现函数校验模型输出 tool_call JSON 合法性，要 catch 字段缺失/类型错误/枚举越界/多余字段/格式…" | 核心定义 |
| 0:55 | 五类错误示意图 | "五类错误——字段缺失/类型错误/枚举越界/多余字段/格式错误" | 要点拆解1 |
| 1:30 | 对比/实战案例图 | "对比一下常见误区和工程实践，看真实场景里怎么取舍。" | 实战与对比 |
