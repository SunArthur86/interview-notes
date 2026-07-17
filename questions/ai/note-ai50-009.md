---
id: note-ai50-009
difficulty: L3
category: ai
subcategory: Agent
tags:
- 某厂
- 面经
- Agent
- JSON
- 输出稳定性
- 工具调用
feynman:
  essence: 通过Schema约束+格式校验+失败兜底三层机制，确保LLM输出可被程序可靠解析的JSON
  analogy: 就像快递填写收件地址——先给标准模板(Schema约束)，快递员检查地址完整性(格式校验)，填错了打回重填(兜底重试)
  first_principle: LLM是概率模型，无法保证100%输出合法JSON。工程上需要将"期望"变为"契约"——用Schema定义+校验+降级策略构建可靠性
  key_points:
  - '第一层: JSON Mode / Structured Output / Function Calling'
  - '第二层: Pydantic / JSON Schema校验'
  - '第三层: 自动修复 + 重试 + 正则提取兜底'
  - '关键: 永远不要假设LLM输出的JSON一定合法'
first_principle:
  essence: LLM生成的每个token都是概率采样，任何格式约束都无法达到100%保证
  derivation: 即使temperature=0，不同batch、不同版本模型仍可能输出微小差异。JSON语法是严格的(少一个逗号就parse失败)，而LLM输出是模糊的。必须用工程手段弥合
  conclusion: JSON输出的可靠性 = 模型能力 × 约束强度 × 兜底完整性
follow_up:
- JSON Mode和Function Calling有什么区别？
- 如果JSON嵌套很深(3层以上)，模型输出准确率会降多少？
- 用什么工具可以做JSON Schema的可视化设计？
memory_points:
- 核心策略：模型原生约束+校验拦截+兜底修复的三层保障机制
- 模型层：直接使用JSON Mode或Function Calling保证底座输出约90%合法
- 校验层：用Pydantic或JSON Schema验证字段，精准拦截格式异常
- 兜底层：遇错带提示重试、正则强行提取或默认值降级，保100%可用
---

# 怎么保证大模型稳定输出JSON？格式不对怎么兜底？

## 三层保障架构

```
┌────────────────────────────────────────────────┐
│  用户Query + System Prompt + JSON Schema        │
│              │                                  │
│  ┌───────────▼───────────┐                     │
│  │  第一层: 模型层约束     │                     │
│  │  • JSON Mode          │                     │
│  │  • Function Calling    │                     │
│  │  • Structured Output   │                     │
│  └───────────┬───────────┘                     │
│              │ ~90% 输出合法JSON                 │
│  ┌───────────▼───────────┐                     │
│  │  第二层: 校验层        │                     │
│  │  • Pydantic校验        │                     │
│  │  • JSON Schema校验     │                     │
│  └───────────┬───────────┘                     │
│              │ 拦截剩余~10%不合法输出            │
│  ┌───────────▼───────────┐                     │
│  │  第三层: 兜底层        │                     │
│  │  • 自动修复            │                     │
│  │  • 重试(带错误提示)    │                     │
│  │  • 正则提取            │                     │
│  │  • 默认值降级          │                     │
│  └───────────────────────┘                     │
│              │                                  │
│         100% 可靠的JSON输出                      │
└────────────────────────────────────────────────┐
```

## 第一层：模型层约束

### 方案1: JSON Mode (OpenAI)

```python
response = client.chat.completions.create(
    model="gpt-4",
    messages=[
        {"role": "system", "content": "你是数据提取助手，输出JSON"},
        {"role": "user", "content": "提取: 张三, 25岁, 北京"}
    ],
    response_format={"type": "json_object"}  # 强制JSON输出
)
# 注意: 使用JSON Mode时System Prompt中必须包含"JSON"字样
```

### 方案2: Structured Output (OpenAI 2024新功能)

```python
from pydantic import BaseModel

class PersonInfo(BaseModel):
    name: str
    age: int
    city: str
    hobbies: list[str]

response = client.beta.chat.completions.parse(
    model="gpt-4",
    messages=[{"role": "user", "content": "提取: 张三, 25岁, 北京, 爱好游泳和读书"}],
    response_format=PersonInfo,  # 直接传Pydantic模型
)
person = response.choices[0].message.parsed  # 直接得到Python对象
```

### 方案3: Function Calling

```python
response = client.chat.completions.create(
    model="gpt-4",
    messages=[{"role": "user", "content": query}],
    tools=[{
        "type": "function",
        "function": {
            "name": "extract_info",
            "description": "提取用户信息",
            "parameters": {
                "type": "object",
                "properties": {
                    "name": {"type": "string"},
                    "age": {"type": "integer"},
                },
                "required": ["name"]
            }
        }
    }],
    tool_choice={"type": "function", "function": {"name": "extract_info"}}
)
# tool_calls中的arguments就是合法JSON字符串
```

## 第二层：校验

```python
from pydantic import BaseModel, ValidationError

class ToolCall(BaseModel):
    tool_name: str
    parameters: dict
    confidence: float = 0.0

def validate_output(raw_output: str) -> dict | None:
    """校验LLM输出是否为合法JSON"""
    try:
        data = json.loads(raw_output)
        # Pydantic二次校验结构和类型
        validated = ToolCall(**data)
        return validated.model_dump()
    except json.JSONDecodeError as e:
        print(f"JSON解析失败: {e}")
        return None
    except ValidationError as e:
        print(f"结构校验失败: {e}")
        return None
```

## 第三层：兜底策略

### 策略1: 正则提取（模型输出了多余文本）

```python
def extract_json_from_text(text: str) -> dict | None:
    """从混合文本中提取JSON"""
    # 尝试直接parse
    try:
        return json.loads(text)
    except:
        pass
    
    # 尝试提取 ```json ... ``` 代码块
    match = re.search(r'```json\s*(.*?)\s*```', text, re.DOTALL)
    if match:
        try:
            return json.loads(match.group(1))
        except:
            pass
    
    # 尝试提取 { ... } 最外层括号
    match = re.search(r'\{[^{}]*(?:\{[^{}]*\}[^{}]*)*\}', text, re.DOTALL)
    if match:
        try:
            return json.loads(match.group(0))
        except:
            pass
    
    return None
```

### 策略2: 带错误提示的重试

```python
def generate_with_retry(prompt, max_retries=3):
    """生成JSON，失败时带错误提示重试"""
    messages = [{"role": "user", "content": prompt}]
    
    for attempt in range(max_retries):
        response = llm.generate(messages)
        
        try:
            return json.loads(response)
        except json.JSONDecodeError as e:
            # 把错误信息加入上下文，让模型修复
            messages.append({"role": "assistant", "content": response})
            messages.append({
                "role": "user",
                "content": f"你的输出JSON格式有误: {str(e)}。请修复后重新输出合法JSON。"
            })
    
    # 重试用尽，用默认值
    return default_fallback()
```

### 策略3: 自动修复常见错误

```python
def auto_fix_json(raw: str) -> str:
    """自动修复常见JSON格式错误"""
    # 去除首尾非JSON字符
    raw = raw.strip()
    if raw.startswith('```'):
        raw = re.sub(r'^```(?:json)?\s*', '', raw)
        raw = re.sub(r'\s*```$', '', raw)
    
    # 修复尾随逗号
    raw = re.sub(r',\s*}', '}', raw)
    raw = re.sub(r',\s*]', ']', raw)
    
    # 修复单引号 → 双引号
    raw = raw.replace("'", '"')
    
    # 修复缺失的闭合括号
    open_braces = raw.count('{') - raw.count('}')
    open_brackets = raw.count('[') - raw.count(']')
    raw += '}' * max(0, open_braces)
    raw += ']' * max(0, open_brackets)
    
    return raw
```

## 工业级完整实现

```python
def reliable_json_output(query, schema, max_retries=3):
    """工业级JSON输出保障"""
    
    for attempt in range(max_retries):
        # Step 1: 用Structured Output生成
        raw = llm.generate(query, response_format="json_object")
        
        # Step 2: 自动修复
        fixed = auto_fix_json(raw)
        
        # Step 3: 提取
        data = extract_json_from_text(fixed)
        
        # Step 4: Schema校验
        if data and validate_against_schema(data, schema):
            return data
        
        # Step 5: 带错误提示重试
        query = f"{query}\n\n上次输出有误，请严格按Schema输出: {schema}"
    
    # 所有重试失败 → 默认值
    return schema.default_value()
```

## 不同方案的可靠性对比

| 方案 | JSON合法率 | Schema符合率 | 实现复杂度 | 延迟 |
|------|-----------|-------------|-----------|------|
| 纯Prompt要求 | ~70% | ~50% | 低 | 1× |
| +JSON Mode | ~95% | ~80% | 低 | 1× |
| +Function Calling | ~98% | ~90% | 中 | 1× |
| +Pydantic校验 | ~98% | ~95% | 中 | 1× |
| +重试+自动修复 | ~99.5% | ~98% | 高 | 1.2× |
| +Structured Output | ~99.9% | ~99% | 低 | 1× |

## 记忆要点

- 核心策略：模型原生约束+校验拦截+兜底修复的三层保障机制
- 模型层：直接使用JSON Mode或Function Calling保证底座输出约90%合法
- 校验层：用Pydantic或JSON Schema验证字段，精准拦截格式异常
- 兜底层：遇错带提示重试、正则强行提取或默认值降级，保100%可用

## 苏格拉底式面试追问

> 这组追问模拟面试官层层逼问，每一问先回答"为什么"，再回答"怎么做"，最后回答"如何证明"。

### 第一层：目标与动机

**Q：保证 LLM 输出 JSON 为什么不能只靠 prompt 说"请输出 JSON"，还要搞 JSON Mode + 校验 + 兜底三层？**

prompt 约束是软的，模型基于概率生成，即使 99% 的 case 遵守，仍有 1% 会输出自然语言或畸变 JSON（如多一个逗号、字段名拼错）。生产环境 SLA 是 99.9%+，单靠 prompt 拿不到。JSON Mode（OpenAI）从解码层约束 token 只能生成合法 JSON，把格式合法率拉到 ~99%；但"格式合法"不等于"字段齐全/值域正确"（如 age 填成 -1），仍需 Pydantic 校验；校验失败的要兜底重试或降级。三层分别防"格式错""语义错""彻底失败"，动机是逼近 100% 可用。

### 第二层：证据与定位

**Q：你的 JSON 输出成功率从 99% 掉到 95%，怎么定位是 JSON Mode 失效、还是 schema 变了、还是模型抽风？**

看三层数据：第一层 JSON Mode 的解析失败率（JSON.parse 报错占比）——如果飙升，是 JSON Mode 失效（可能 model 版本被切或 prompt 里冲突指令）；第二层 Pydantic 校验失败率——如果飙升且集中在某字段，是 schema 变了（如新增了 required 字段但 prompt 没更新）；第三层兜底触发率——如果飙升说明前两层都漏了。每个失败 case 带 trace_id 能回溯到原始 prompt 和 model 响应，按失败码归因。

### 第三层：根因深挖

**Q：你发现 Pydantic 校验失败集中在"枚举值越界"（模型输出了 schema 之外的 enum 值），根因是什么？**

根因是 prompt 里对 enum 的描述和实际 Pydantic schema 不一致，或 enum 列表更新了没同步到 prompt。模型是基于 prompt 描述生成的，如果 prompt 里 enum 写的是 ["A","B","C"] 但 schema 是 ["A","B","C","D"]，模型不会输出 D；反过来模型可能输出 prompt 里"看起来合理"但 schema 里没有的值。治本是 prompt 和 schema 单一数据源（从 Pydantic model 自动生成 prompt 里的 enum 描述），杜绝手工同步。

**Q：那为什么不直接用约束解码（constrained decoding，如 outlines/lm-format-enforcer），从 token 生成层就禁止非法 enum，一劳永逸？**

约束解码能保证 enum 值合法（从 token 层面禁止生成 schema 外的值），但它的代价是延迟增加 20-50%（每步生成要查 trie）且只适用于自部署模型（API 模型如 GPT-4 不支持自定义解码逻辑）。对 OpenAI/Anthropic API 用户，JSON Mode + Structured Outputs 是他们提供的约束解码，但功能受限（如不支持复杂 enum 联合类型）。工程上：自部署模型上 outlines 约束解码 + Pydantic 校验；API 模型上 JSON Mode + Pydantic 校验 + 兜底。

### 第四层：方案权衡

**Q：兜底层你设的是"带提示重试 3 次 → 正则提取 → 默认值"，为什么是这个顺序，而不是直接默认值省事？**

按"精度优先、兜底在后"排序。重试带提示（"上次输出字段缺失，请补全 required 字段"）能挽回 80% 的失败且保持原语义；正则提取（从畸形输出里硬抠出能用的字段）精度次之，但比默认值好；默认值是最后兜底，保证 100% 不报错但语义可能错（如 age 默认 0）。直接默认值会浪费那些"99% 正确只差一个字段"的输出。三层兜底是"尽力挽回到最后"，不是"失败就放弃"。

**Q：为什么不直接换 GPT-4o（JSON 能力更强）替代三层兜底，省掉工程复杂度？**

GPT-4o 的 JSON 成功率约 99.5%，仍不到生产 SLA 的 99.9%，且成本是 GPT-4o-mini 的 10 倍。万 QPS 场景下，工程兜底（跑在便宜模型上）的机器成本远低于全量 GPT-4o 的 token 成本。更关键的是模型会抽风会下线（GPT-3.5 Turbo 突然变更行为），工程兜底层是模型无关的，换模型时不动。把可靠性绑死在单一模型能力上是脆弱架构。

### 第五层：验证与沉淀

**Q：你怎么证明三层保障把 JSON 可用性从 90% 拉到 100%，各层的贡献分别多少？**

埋点统计每层的拦截率。总调用 100 万次：JSON Mode 解析失败 1 万次（1%），其中 Pydantic 校验又拦下 0.8 万次（0.8%），剩下 0.2 万次走兜底重试挽回 0.15 万次（0.15%），最后 0.05 万次（0.005%）走默认值。各层贡献：JSON Mode 把基线从 85% 提到 99%，Pydantic 把 99% 提到 99.8%，兜底把 99.8% 提到 99.995%。这套归因表证明每一层都有不可替代的价值，不是冗余。

**Q：这套 JSON 输出保障怎么沉淀成团队 SDK？**

封装 `json_llm_call(prompt, schema)` 函数：内部自动 JSON Mode、Pydantic 校验、分级兜底、全链路埋点。业务方只传 prompt 和 Pydantic model，不感知三层逻辑。配套 SLO 看板（各层失败率、端到端成功率、P99 延迟）和告警（成功率 <99.9% 触发）。把"常见 schema 设计坑""enum 同步规范""兜底策略选型表"沉淀成文档，新人按规范写 schema 即可获得 99.9% 可用性。

## 结构化回答

**30 秒电梯演讲：** 通过Schema约束+格式校验+失败兜底三层机制，确保LLM输出可被程序可靠解析的JSON——就像快递填写收件地址。

**展开框架：**
1. **第一层** — JSON Mode / Structured Output / Function Calling
2. **第二层** — Pydantic / JSON Schema校验
3. **第三层** — 自动修复 + 重试 + 正则提取兜底

**收尾：** 您想深入聊：JSON Mode和Function Calling有什么区别？


## 视频脚本

> 预计时长：4 分钟 | 由浅入深


| 时间 | 画面/字幕 | 口播台词 | 讲解要点 |
|------|----------|----------|----------|
| 0:00 | 标题卡：怎么保证大模型稳定输出JSON？格式不对怎么兜底… | "就像快递填写收件地址——先给标准模板(Schema约束)，快递员检查地址完整性(格式校验)…" | 开场钩子 |
| 0:20 | 核心概念图 | "通过Schema约束+格式校验+失败兜底三层机制，确保LLM输出可被程序可靠解析的JSON" | 核心定义 |
| 0:50 | 第一层示意图 | "第一层——JSON Mode / Structured Output / Function Calling" | 要点拆解1 |
| 1:30 | 对比/实战案例图 | "对比一下常见误区和工程实践，看真实场景里怎么取舍。" | 实战与对比 |
| 2:20 | 总结卡 | "记住核心要点。下期我们追问：JSON Mode和Function Calling有什么区？" | 收尾与钩子 |
