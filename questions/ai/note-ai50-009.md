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

