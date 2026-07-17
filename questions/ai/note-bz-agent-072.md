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

## 苏格拉底式面试追问

> 这组追问模拟面试官层层逼问，每一问先回答"为什么"，再回答"怎么做"，最后回答"如何证明"。

### 第一层：目标与动机

**Q：你强调"约束+原生+兜底"三层，为什么不直接全程用兜底（正则清洗 + JSON Repair）省事？反正最后都能修。**

因为兜底是"有损修复"，不是无损。正则清洗能去掉"好的，结果是："这种前缀，但去不掉结构错乱——比如模型把数组写成 `[a, b, c]` 没加引号，JSON Repair 虽然能猜，但猜错了就是业务数据错误，这种错不在解析层在语义层。而且兜底处理路径复杂、分支多，维护成本高。三层架构的本质是"把错误率降到兜底层几乎不触发"——上游 Prompt+原生模式挡 99.9%，兜底只兜那 0.1%，这样兜底逻辑简单、稳定、可审计。

### 第二层：证据与定位

**Q：你线上 JSON 解析失败率突然飙升到 5%，怎么区分是模型不行、Prompt 不行、还是温度参数太高？**

三组证据定位。第一看失败样本的原始输出——如果输出是合法 JSON 但字段缺失，是 Prompt 没约束全；如果输出多了 Markdown 包裹（"```json..."），是格式锚点不够；如果输出是一堆乱码或半截，是 max_tokens 不够被截断。第二看 Temperature——如果 temperature > 0.7 失败率飙升，降到 0 重测，归零就是温度问题。第三看模型版本切换日志——如果时间吻合，是模型行为漂移。三个证据交叉就能定位到具体环节。

### 第三层：根因深挖

**Q：你用 Function Calling / Structured Output 说最可靠，但有些场景（比如输出一篇带结构的长文）Function Calling 装不下，怎么办？**

Function Calling 的局限是它约束的是 schema（字段名/类型），不适合长自由文本字段。根因是 schema 把字段当成结构化数据，但内容是叙事性的。解法是混合输出：用 Function Calling 约束"元数据字段"（标题/作者/分类/标签），把长正文放到一个 `content` 字段里，这个字段不加 schema 约束只加 Prompt 约束。这样元数据 100% 可解析（走 Function Calling），正文的格式靠 Prompt + 后处理校验（检查是否含必含小节）。

**Q：那为什么不直接用 OpenAI 的 Structured Output（JSON Schema 强约束），比 Function Calling 还严？**

因为 Structured Output 有代价——它内部用约束解码（constrained decoding）限制采样空间，对长文本字段会导致重复和退化（模型被框死在合法 token 路径上，创造力下降）。我在长正文场景实测过，Structured Output 下正文重复率比无约束高 15%。所以不是越严越好，是要分字段：结构字段用强约束（schema），内容字段用弱约束（Prompt + 校验）。这是质量 vs 可靠性的权衡。

### 第四层：方案权衡

**Q：兜底你提到把解析错误反馈给 LLM 让它自修。但万一它修十次还修不对，死循环怎么办？**

必须设最大重试次数（max_retries=2）和递增退避。我的策略是：第一次解析失败，把 `json.loads` 的报错信息（比如 "Expecting ',' delimiter at line 3 col 12"）拼进 Prompt 让 LLM 修；第二次还失败就不再调 LLM，直接走 JSON Repair（基于规则的修复库，如 `json-repair`）；还不行就降级——返回 `{"error": "parse_failed", "raw": 原始输出}` 给上游业务。死循环靠硬上限（max_retries）切断，超时靠总耗时阈值（如 10s）兜底。

**Q：为什么不直接放弃重试，失败就报错让用户重发？**

因为重试的成功率很高且成本低。我统计过，第一次重试（带错误信息反馈）能修好 70% 的失败 case，第二次再修好 15%，两次合计 85%。这 85% 如果直接报错，对用户就是一次失败体验，而重试只多花一次 API 调用（几百毫秒）。剩下的 15% 才走 JSON Repair 或报错。所以重试的 ROI 是正的——用一次 API 调用换 85% 的成功率挽回。

### 第五层：验证与沉淀

**Q：你怎么量化"三层保障"各自的贡献，证明每层都不是冗余？**

埋点统计每层的拦截率。我会在三层各埋一个计数器：第一层（Prompt+原生模式）成功通过的比例、第二层（重试）挽救的比例、第三层（JSON Repair）挽救的比例、最终报错的比例。理想分布是 99.5% / 0.3% / 0.15% / 0.05%。如果第一层占比低于 99%，说明 Prompt/原生模式该优化；如果第三层占比高于 1%，说明上游兜不住、需要加 schema 约束。用这个分布做归因，每层的投入都有数据支撑。

**Q：这套兜底逻辑怎么沉淀成可复用组件？**

抽象成一个 `StructuredOutputParser` SDK，对外暴露 `parse(raw_output, schema)` 一个方法，内部封装三层逻辑和重试上限。Schema 用 JSON Schema 定义，团队所有调 LLM 的服务统一走这个 SDK。这样兜底逻辑改一处全公司受益（比如发现 `json-repair` 库有 bug，改 SDK 一处全修复），而不是每个服务自己写正则。

## 结构化回答

**30 秒电梯演讲：** 让LLM稳定输出JSON/XML=格式约束(明确schema)+Few-shot示例+后处理校验+重试机制。核心是"约束+验证+兜底"三层保障。

**展开框架：**
1. **约束** — 明确schema+Few-shot
2. **原生** — Function Calling/Structured Output
3. **校验** — JSON Schema验证

**收尾：** 您想深入聊：哪个模型JSON输出最稳？——GPT-4/Claude支持Structured Output？


## 视频脚本

> 预计时长：4 分钟 | 由浅入深


| 时间 | 画面/字幕 | 口播台词 | 讲解要点 |
|------|----------|----------|----------|
| 0:00 | 标题卡：如何稳定地让大模型输出符合业务规范的 JSON/… | "像让小学生填表——给模板(格式约束)、示范怎么填(示例)、检查填对没(校验)、填错重来(重…" | 开场钩子 |
| 0:20 | 核心概念图 | "让LLM稳定输出JSON/XML=格式约束(明确schema)+Few-shot示例+后处理校验+重试机制。核心是"约束…" | 核心定义 |
| 0:50 | 约束示意图 | "约束——明确schema+Few-shot" | 要点拆解1 |
| 1:30 | 对比/实战案例图 | "对比一下常见误区和工程实践，看真实场景里怎么取舍。" | 实战与对比 |
| 2:20 | 总结卡 | "记住核心要点。下期我们追问：哪个模型JSON输出最稳？——GPT-4/Claude支持S？" | 收尾与钩子 |
