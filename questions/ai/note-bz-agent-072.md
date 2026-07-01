---
id: note-bz-agent-072
difficulty: L3
category: ai
subcategory: Prompt
tags:
- B站面经
- Prompt工程
- JSON
- 结构化输出
feynman:
  essence: 让LLM稳定输出JSON/XML=格式约束(明确schema)+Few-shot示例+后处理校验+重试机制。核心是"约束+验证+兜底"三层保障。
  analogy: 像让小学生填表——给模板(格式约束)、示范怎么填(示例)、检查填对没(校验)、填错重来(重试)。
  first_principle: LLM是概率模型，不保证格式正确。需要约束降低错误率+校验捕获错误+重试修复错误。
  key_points:
  - 约束：明确schema+Few-shot
  - 原生：Function Calling/Structured Output
  - 校验：JSON Schema验证
  - 兜底：解析失败重试/修复
first_principle:
  essence: 结构化输出=概率生成+确定性约束的结合。
  derivation: LLM生成是概率的，可能输出非法JSON。解法：1.用约束(明确格式)降低错误率 2.用校验(JSON Schema)捕获错误 3.用重试/修复处理错误。三层保障达到稳定。
  conclusion: 稳定结构化输出 = 约束（降低错误） + 校验（捕获错误） + 兜底（修复错误）
follow_up:
- 哪个模型JSON输出最稳？——GPT-4/Claude支持Structured Output
- XML还是JSON？——JSON更主流，XML适合带标签的文档
- 解析失败率多少正常？——约束好后<1%
memory_points:
- 口诀「约束+原生+兜底」三层保障：Prompt约束，原生API，后处理校验
- 最可靠方案：调用底层原生Function Calling或JSON模式，而非纯指望Prompt
- 兜底防线：程序解析必须正则清洗去冗余词，并搭配JSON Repair修复格式
---

# 如何稳定地让大模型输出符合业务规范的 JSON/XML 格式？

## 一、问题：LLM 输出格式不稳定

```
问题表现：
  要求输出JSON，LLM可能：
  - 加了Markdown代码块标记: ```json {...} ```
  - 前后加了解释文字: "好的，结果是：{...}"
  - JSON格式错误: 缺逗号/多逗号/引号不匹配
  - 字段名不对: 要求"name"输出"姓名"
  - 多了/少了字段

这些会导致程序解析失败 → 下游报错
```

## 二、解决方案：约束 + 校验 + 兜底

### 层 1：Prompt 约束（降低错误率）

```python
STRUCTURED_PROMPT = """
请严格按以下JSON格式输出，不要包含任何其他文字。

Schema:
{{
  "name": "string (必填)",
  "age": "integer (0-150)",
  "skills": ["array of string"],
  "level": "junior|senior|expert"
}}

要求：
1. 只输出JSON，不要Markdown标记（不要```json）
2. 不要在JSON前后加任何解释文字
3. 字段名必须与Schema完全一致
4. 字符串用双引号

示例：
输入: "张三，30岁，会Python和Java，高级"
输出: {"name": "张三", "age": 30, "skills": ["Python", "Java"], "level": "senior"}
"""
```

### 层 2：原生 Structured Output（最可靠）

```python
# 方法A: OpenAI的response_format
response = client.chat.completions.create(
    model="gpt-4",
    messages=[...],
    response_format={"type": "json_object"}  # 强制JSON输出
)

# 方法B: Function Calling（带schema约束）
response = client.chat.completions.create(
    model="gpt-4",
    messages=[...],
    tools=[{
        "type": "function",
        "function": {
            "name": "extract_info",
            "parameters": {
                "type": "object",
                "properties": {
                    "name": {"type": "string"},
                    "age": {"type": "integer"}
                },
                "required": ["name", "age"]
            }
        }
    }]
)

# 方法C: Claude的prefill（预填充）
response = client.messages.create(
    model="claude-3",
    messages=[
        {"role": "user", "content": "提取信息为JSON"},
        {"role": "assistant", "content": "{"}  # 预填充{，强制JSON开始
    ]
)
```

### 层 3：后处理校验（捕获错误）

```python
import json
from jsonschema import validate

def parse_llm_output(raw_output: str, schema: dict):
    """解析并校验LLM输出"""
    
    # Step 1: 清理（去Markdown标记/多余文字）
    cleaned = clean_output(raw_output)
    
    # Step 2: JSON解析
    try:
        data = json.loads(cleaned)
    except json.JSONDecodeError as e:
        # 解析失败，尝试修复
        data = try_repair_json(cleaned)
        if data is None:
            raise ParseError(f"JSON解析失败: {e}")
    
    # Step 3: Schema校验
    try:
        validate(instance=data, schema=schema)
    except ValidationError as e:
        raise ValidationError(f"不符合Schema: {e}")
    
    return data

def clean_output(raw: str) -> str:
    """清理LLM输出的多余内容"""
    # 去Markdown代码块
    raw = re.sub(r'```(?:json)?\s*', '', raw)
    raw = raw.replace('```', '')
    # 提取第一个{...}（去前后解释文字）
    match = re.search(r'\{.*\}', raw, re.DOTALL)
    return match.group() if match else raw
```

### 层 4：失败重试与修复

```python
async def get_structured_output(prompt, schema, max_retries=3):
    """带重试的结构化输出"""
    
    for attempt in range(max_retries):
        raw = await llm.generate(prompt)
        
        try:
            return parse_llm_output(raw, schema)
        except (ParseError, ValidationError) as e:
            if attempt < max_retries - 1:
                # 把错误信息反馈给LLM，让它修复
                prompt = f"""
                上次输出有误：{e}
                你的输出: {raw}
                
                请修正后重新输出正确的JSON。
                """
            else:
                raise  # 重试耗尽
```

## 三、XML 输出的控制

```python
XML_PROMPT = """
请按以下XML格式输出：

<result>
  <entity type="person">
    <name>姓名</name>
    <attributes>
      <age>年龄</age>
      <occupation>职业</occupation>
    </attributes>
  </entity>
</result>

规则：
1. 所有标签必须闭合
2. 属性值用双引号
3. 不要在XML外加其他文字

示例：
<result>
  <entity type="person">
    <name>张三</name>
    <attributes>
      <age>30</age>
      <occupation>工程师</occupation>
    </attributes>
  </entity>
</result>
"""

# XML解析（比JSON更宽容）
from lxml import etree
def parse_xml(raw):
    try:
        return etree.fromstring(raw)
    except etree.XMLSyntaxError:
        # 尝试修复（闭合标签等）
        repaired = repair_xml(raw)
        return etree.fromstring(repaired)
```

## 四、JSON vs XML 选择

```
┌──────────────┬──────────────────┬──────────────────────┐
│ 维度          │ JSON                 │ XML                    │
├──────────────┼──────────────────┼──────────────────────┤
│ LLM友好度     │ 高（训练数据多）     │ 中                    │
│ 解析难度      │ 简单                 │ 稍复杂                 │
│ 嵌套表达      │ 好                   │ 更好（标签语义明确）   │
│ 错误率        │ 较低                 │ 中（标签闭合易错）     │
│ 主流程度      │ ★★★★★              │ ★★★                   │
│ 适合          │ API/数据交换         │ 文档/带语义标签        │
└──────────────┴──────────────────┴──────────────────────┘

建议：优先JSON（LLM更熟悉），需要标签语义时用XML
```

## 五、面试加分点

1. **三层保障**：约束(降错误)+校验(捕错误)+兜底(修错误)，系统性
2. **原生 Structured Output**：能用模型原生能力就用，比纯 Prompt 约束可靠
3. **错误反馈重试**：把解析错误告诉 LLM 让它修——这是"让 LLM 自我纠正"的实用技巧

## 记忆要点

- 口诀「约束+原生+兜底」三层保障：Prompt约束，原生API，后处理校验
- 最可靠方案：调用底层原生Function Calling或JSON模式，而非纯指望Prompt
- 兜底防线：程序解析必须正则清洗去冗余词，并搭配JSON Repair修复格式

