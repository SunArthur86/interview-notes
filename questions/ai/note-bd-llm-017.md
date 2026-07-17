---
id: note-bd-llm-017
difficulty: L3
category: ai
subcategory: LLM
tags:
- 字节
- 面经
- JSON
- Schema
- 结构化输出
- Function Calling
feynman:
  essence: 稳定输出JSON的方法：Function Calling、Constrained Decoding(约束解码)、JSON Mode、后处理修复、Few-shot+Schema。
  analogy: 就像让学生填表格——Function Calling是给标准表格(强约束)，约束解码是限制学生只能填特定选项(token级约束)，后处理是交上来后老师帮改格式。
  first_principle: JSON输出的不稳定性源于LLM是概率生成模型，无法保证输出严格符合格式约束。
  key_points:
  - 'Function Calling: 厂商原生支持，最稳定'
  - 'Constrained Decoding: GBNF/Outlines，token级约束'
  - 'JSON Mode: OpenAI response_format'
  - '后处理: 正则修复/jsonschema验证重试'
  - 'Outlines/LMQL: 开源结构化生成框架'
first_principle:
  essence: 约束越靠前(解码层)越可靠，越靠后(后处理)越脆弱
  derivation: LLM概率生成→可能输出无效JSON→后处理修复(脆弱)→Few-shot引导(较稳定)→JSON Mode(更稳定)→约束解码(最稳定)→Function Calling(厂商保障)
  conclusion: 结构化输出的可靠性 = 约束施加的层级深度
follow_up:
- Outlines的GBNF语法怎么写？
- 约束解码对推理速度有什么影响？
- 如何处理嵌套深层JSON？
memory_points:
- 可靠性排序：后处理修复 < JSON Mode < 约束解码 < Function Calling。
- 约束解码：每步将非法Token的logit设为负无穷强制掩盖。
- 实现库：Outlines用FSM，llama.cpp用GBNF语法实现Schema限制。
- JSON Mode：API级约束保证整体是合法JSON，但不约束内部字段类型。
---

# 【字节面经】让模型稳定输出符合 Schema 的 JSON 数据，除了 Function Calling，你还用过哪些方法？各有什么适用边界？

## 一、问题本质：为什么 JSON 输出不稳定

LLM 本质是**下一个 token 概率预测器**，每次输出都是从词表概率分布中采样。没有任何机制能保证输出严格遵守 JSON 语法——模型可能多输出一个逗号、漏掉括号、混入自然语言等。约束的施加层级越深（越接近生成源头），越可靠：

```
可靠性排序 (从低到高):

后处理修复  <  Few-shot引导  <  JSON Mode  <  约束解码  <  Function Calling
 (事后补救)   (概率引导)       (API级约束)   (解码级强制)  (厂商原生保障)
```

---

## 二、五大方法详解

### 方法一：约束解码（Constrained Decoding）

#### 1.1 原理

在解码的**每一步**，计算当前输出状态下哪些 token 仍然能保持 JSON 合法性，将非法 token 的 logit 设为 `-inf`，再进行采样。

```
解码步骤示例（生成 {"name": "张三", "age": 25}）:

Step 1: 已输出 "{" → 合法后续: '"', '}', ' ', '\n', ... → 其他token logit=-inf
Step 2: 已输出 '{"na' → 合法后续: 'me', 'n', ... → 其他token logit=-inf
Step 3: 已输出 '{"name": "张三"' → 合法后续: ',', '}' → 其他token logit=-inf
Step 4: 已输出 '{"name": "张三", "age": 2' → 合法后续: '5', '0', ... → 其他token logit=-inf
```

#### 1.2 Outlines 实现（基于 Pydantic Schema 自动生成 FSM）

```python
import outlines
from pydantic import BaseModel
from typing import List

# 定义输出Schema
class Person(BaseModel):
    name: str
    age: int
    skills: List[str]
    is_active: bool

# 加载模型
model = outlines.models.transformers("Qwen/Qwen2.5-7B-Instruct")

# 约束生成：自动从Pydantic模型生成FSM (有限状态机)
@outlines.generate.json(model, Person)
def generate_person(prompt: str) -> Person:
    """输出 100% 符合 Person Schema 的 JSON"""
    pass

# 调用
person = generate_person("生成一个名叫张三的软件工程师")
print(person)  # Person(name='张三', age=28, skills=['Python', 'Go'], is_active=True)
#  guaranteed: 输出一定符合Schema, 不会出现格式错误
```

**Outlines 的工作原理**：
1. 从 Pydantic Schema 生成 JSON Schema
2. 从 JSON Schema 生成正则表达式
3. 从正则表达式构建 FSM（有限状态机）
4. 解码时用 FSM 决定每步合法 token 集合 → mask logits

#### 1.3 GBNF 语法实现（llama.cpp）

```python
from llama_cpp import Llama

# GBNF语法：直接描述JSON结构
gbnf_grammar = r"""
root        ::= "{" ws "\"name\"" ws ":" ws string "," ws "\"age\"" ws ":" ws number "}"
string      ::= "\"" ([^"\\] | "\\" [\"\\/bfnrt])* "\""
number      ::= [0-9]+
ws          ::= [ \t\n]*
"""

llm = Llama(model_path="./model.gguf")

# 启用GBNF约束解码
response = llm(
    "请生成一个人物信息JSON",
    grammar=gbnf_grammar,
    max_tokens=128,
)
# 输出保证符合: {"name": "张三", "age": 28}
```

#### 1.4 LMQL 实现（声明式约束查询语言）

```python
import lmql

@lmql.query
def generate_structured(name: str):
    '''lmql
    """你是一个信息生成器。"""
    "{\"name\": \"{name}\", "
    " \"age\": {[AGE]}, "
    " \"role\": \"engineer\"}"
    AGE = lt(120) + gt(0)  # 约束：年龄为1-119之间的整数
    return {"name": name, "age": AGE, "role": "engineer"}
    '''
```

### 方法二：JSON Mode（API 原生支持）

```python
import openai

# OpenAI JSON Mode
response = openai.chat.completions.create(
    model="gpt-4o",
    response_format={"type": "json_object"},  # 启用JSON Mode
    messages=[
        {"role": "system", "content": "你是JSON生成器。输出必须是合法JSON。"},
        {"role": "user", "content": "生成一个用户信息"},
    ],
)
# 保证: 输出一定是合法JSON (但可能不符合特定Schema)
```

```python
# OpenAI Structured Outputs (2024年新功能, Schema级约束)
from pydantic import BaseModel

class UserInfo(BaseModel):
    name: str
    age: int
    email: str

response = openai.beta.chat.completions.parse(
    model="gpt-4o",
    response_format=UserInfo,  # 直接传Pydantic模型, API层强制Schema
    messages=[{"role": "user", "content": "生成用户信息"}],
)
user = response.choices[0].message.parsed  # 直接得到Pydantic对象
```

**JSON Mode vs Structured Outputs 的区别**：

| 特性 | JSON Mode (`json_object`) | Structured Outputs |
|------|--------------------------|-------------------|
| 保证合法JSON | ✅ | ✅ |
| 保证符合Schema | ❌ | ✅ |
| 需要提供Schema | ❌ | ✅ (json_schema) |
| 可靠性 | ~99% JSON合法 | ~100% Schema一致 |

### 方法三：Few-shot + Schema 引导

```python
class FewShotJSONGenerator:
    """Few-shot + JSON Schema 引导生成"""

    SYSTEM_PROMPT = """你是一个JSON生成器。请严格按照以下Schema输出。

输出Schema:
{{
  "name": "string",
  "age": "integer (0-120)",
  "department": "string",
  "salary": "number"
}}

示例1:
输入: 张三，28岁，工程部
输出: {{"name": "张三", "age": 28, "department": "工程部", "salary": 25000.0}}

示例2:
输入: 李四，35岁，市场部
输出: {{"name": "李四", "age": 35, "department": "市场部", "salary": 30000.0}}

要求:
1. 只输出JSON，不要有任何其他文字
2. 所有字段都必须存在
3. 数字类型不要加引号
"""

    def __init__(self, llm_client):
        self.llm = llm_client

    def generate(self, user_input: str) -> dict:
        prompt = f"{self.SYSTEM_PROMPT}\n\n输入: {user_input}\n输出: "
        raw = self.llm.generate(prompt, temperature=0.0)  # 温度为0增加确定性
        # 仍然需要后处理兜底
        return self.parse_json_safe(raw)

    def parse_json_safe(self, text: str) -> dict:
        """安全解析JSON（兜底）"""
        import json
        import re
        # 提取JSON部分
        match = re.search(r'\{.*\}', text, re.DOTALL)
        if match:
            try:
                return json.loads(match.group())
            except json.JSONDecodeError:
                pass
        return None  # 解析失败
```

**Few-shot 的局限**：即使提供3-5个示例，在复杂嵌套Schema或特殊字符场景下，模型仍可能输出非法JSON。可靠性约 **90-95%**。

### 方法四：后处理修复（最后一道防线）

```python
import json
import re
from jsonschema import validate, ValidationError
from typing import Optional

class JSONRepairPipeline:
    """JSON后处理修复管线：多策略渐进修复"""

    def __init__(self, schema: dict = None):
        self.schema = schema

    def repair_and_validate(self, raw_text: str) -> Optional[dict]:
        """修复 + 验证"""
        # Step1: 直接解析
        result = self.try_parse(raw_text)
        if result:
            return self.validate_schema(result)

        # Step2: 提取JSON片段
        result = self.extract_json_block(raw_text)
        if result:
            return self.validate_schema(result)

        # Step3: 常见格式修复
        result = self.fix_common_errors(raw_text)
        if result:
            return self.validate_schema(result)

        # Step4: 使用json-repair库
        result = self.json_repair_library(raw_text)
        if result:
            return self.validate_schema(result)

        # Step5: LLM自修复
        result = self.llm_self_repair(raw_text)
        if result:
            return self.validate_schema(result)

        return None  # 所有策略失败

    def extract_json_block(self, text: str) -> Optional[dict]:
        """提取```json ... ```代码块或{...}片段"""
        # Markdown代码块
        match = re.search(r'```(?:json)?\s*\n?(.*?)\n?```', text, re.DOTALL)
        if match:
            return self.try_parse(match.group(1))

        # 直接花括号匹配
        match = re.search(r'\{[^{}]*(?:\{[^{}]*\}[^{}]*)*\}', text, re.DOTALL)
        if match:
            return self.try_parse(match.group())
        return None

    def fix_common_errors(self, text: str) -> Optional[dict]:
        """修复常见JSON错误"""
        # 提取JSON部分
        match = re.search(r'\{.*\}', text, re.DOTALL)
        if not match:
            return None
        json_str = match.group()

        # 修复1: 尾部逗号
        json_str = re.sub(r',\s*}', '}', json_str)
        json_str = re.sub(r',\s*]', ']', json_str)

        # 修复2: 单引号 → 双引号
        json_str = re.sub(r"'([^']+)':", r'"\1":', json_str)

        # 修复3: 未闭合的引号 (简化版)
        # 修复4: 控制字符
        json_str = re.sub(r'[\x00-\x1f]', ' ', json_str)

        return self.try_parse(json_str)

    def json_repair_library(self, text: str) -> Optional[dict]:
        """使用json-repair库 (专门修复LLM生成的坏JSON)"""
        try:
            from json_repair import repair_json
            repaired = repair_json(text, return_objects=True)
            return repaired if isinstance(repaired, dict) else None
        except ImportError:
            return None

    def llm_self_repair(self, raw_text: str) -> Optional[dict]:
        """LLM自修复：让模型修复自己的输出"""
        prompt = f"""以下文本应该是一个合法JSON，但存在格式问题。
请修复并输出合法JSON，不要输出其他内容。

原始文本：
{raw_text}

修复后的JSON："""

        # 这里调用LLM，可能需要多轮修复
        repaired = self.llm.generate(prompt, temperature=0.0)
        return self.try_parse(repaired)

    def try_parse(self, text: str) -> Optional[dict]:
        try:
            return json.loads(text)
        except (json.JSONDecodeError, TypeError):
            return None

    def validate_schema(self, data: dict) -> Optional[dict]:
        """使用jsonschema验证"""
        if not self.schema:
            return data
        try:
            validate(instance=data, schema=self.schema)
            return data
        except ValidationError:
            return None
```

### 方法五：重试 + 退避策略

```python
class RetryWithBackoff:
    """带退避的JSON重试策略"""

    def __init__(self, max_retries: int = 3):
        self.max_retries = max_retries

    def generate_json(self, prompt: str, llm_client, schema: dict) -> dict:
        repair = JSONRepairPipeline(schema)

        for attempt in range(self.max_retries):
            # 每次重试调整策略
            if attempt == 0:
                # 第一次: 正常请求
                raw = llm_client.generate(prompt)
            elif attempt == 1:
                # 第二次: 追加更强的指令
                raw = llm_client.generate(
                    prompt + "\n\n重要：请只输出合法JSON，不要输出任何其他内容。"
                )
            else:
                # 第三次: 温度降为0
                raw = llm_client.generate(prompt, temperature=0.0)

            result = repair.repair_and_validate(raw)
            if result is not None:
                return result

        raise ValueError(f"经过{self.max_retries}次尝试仍无法生成合法JSON")
```

---

## 三、可靠性对比表

| 方法 | 可靠性 | 延迟开销 | 适用模型 | Schema约束 | 实现复杂度 | 适用场景 |
|------|--------|---------|---------|-----------|-----------|---------|
| **Function Calling** | ~99.9% | 无额外 | 需厂商支持 | ✅ 强约束 | 低 | 商业API (GPT/Claude) |
| **Structured Outputs** | ~100% | 无额外 | GPT-4o等 | ✅ 强约束 | 低 | OpenAI生态 |
| **约束解码 (Outlines)** | ~100% | +10-20% | 任意开源模型 | ✅ 强约束 | 中 | 开源模型本地部署 |
| **GBNF (llama.cpp)** | ~100% | +10-15% | GGUF量化模型 | ✅ 强约束 | 中 | 边缘部署/量化模型 |
| **JSON Mode** | ~99% | 无额外 | OpenAI/部分API | ❌ 仅合法JSON | 极低 | 快速接入OpenAI |
| **Few-shot + Schema** | ~90-95% | 无额外 | 任意模型 | ❌ 软引导 | 低 | 不支持约束解码时 |
| **后处理修复** | ~85-95% | +50-200ms | 任意模型 | ⚠️ 可验证 | 中 | 兜底方案 |
| **重试策略** | 视基础方法而定 | N倍延迟 | 任意模型 | ⚠️ 可验证 | 低 | 配合其他方法 |

---

## 四、生产环境推荐组合方案

```
┌─────────────────────────────────────────────────────────────────┐
│                  生产级 JSON 输出架构                              │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  优先级决策树:                                                    │
│                                                                 │
│  使用商业API (OpenAI/Claude)?                                    │
│    ├─ YES → Structured Outputs (response_format=schema)         │
│    │        可靠性最高, 无额外开发                                │
│    │                                                             │
│    └─ NO → 使用开源模型?                                         │
│             ├─ 本地部署 (有GPU) → Outlines 约束解码               │
│             │    100% Schema一致, 需Outlines库                    │
│             │                                                    │
│             ├─ llama.cpp 部署 → GBNF 约束解码                     │
│             │    100% Schema一致, 需手写GBNF                      │
│             │                                                    │
│             └─ 无约束解码能力 → Few-shot + 后处理修复 + 重试      │
│                  作为最后手段, 仍有90%+可靠性                     │
│                                                                 │
│  所有方案都要加: jsonschema验证 (确保输出符合Schema)              │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

```python
# 生产级组合方案示例
class ProductionJSONGenerator:
    """生产级JSON生成器：约束解码优先 + 后处理兜底"""

    def __init__(self, model, schema: dict):
        self.model = model
        self.schema = schema
        self.repair = JSONRepairPipeline(schema)

    @outlines.generate.json(model, SchemaClass)
    def constrained_generate(self, prompt: str):
        """约束解码（主路径）"""
        pass

    def generate(self, prompt: str) -> dict:
        try:
            # 主路径: 约束解码 (100% Schema一致)
            result = self.constrained_generate(prompt)
            # 额外验证
            validate(instance=result, schema=self.schema)
            return {"data": result, "method": "constrained", "reliable": True}
        except Exception:
            # 降级路径: 后处理修复
            raw = self.model.generate(prompt)
            repaired = self.repair.repair_and_validate(raw)
            if repaired:
                return {"data": repaired, "method": "repaired", "reliable": True}
            else:
                raise ValueError("无法生成合法JSON")
```

---

## 五、面试回答要点总结

> **一句话回答**：除了 Function Calling，让模型稳定输出 JSON 的方法按可靠性排序为：**约束解码（Outlines/GBNF，token级mask保证100%合法）> JSON Mode（API级保证JSON合法）> Structured Outputs（API级Schema强制）> Few-shot引导（概率层面约90-95%）> 后处理修复（json-repair库+LLM自修复兜底）**。核心原则是**约束越靠近生成源头越可靠**。

**关键加分点**：
1. 理解约束解码的本质是 **logits masking**——在每一步解码时将非法token的logit设为 `-inf`
2. 知道 Outlines 能从 Pydantic 自动构建 FSM，无需手写语法
3. 能区分 OpenAI 的 `json_object`（仅合法JSON）和 `json_schema`（Schema级约束）
4. 提到后处理修复的具体策略：尾部逗号、单引号→双引号、`json-repair` 库
5. 强调生产环境要**组合使用**：约束解码为主 + schema验证为辅 + 后处理为兜底

## 记忆要点

- 可靠性排序：后处理修复 < JSON Mode < 约束解码 < Function Calling。
- 约束解码：每步将非法Token的logit设为负无穷强制掩盖。
- 实现库：Outlines用FSM，llama.cpp用GBNF语法实现Schema限制。
- JSON Mode：API级约束保证整体是合法JSON，但不约束内部字段类型。

## 苏格拉底式面试追问

> 这组追问模拟面试官层层逼问，每一问先回答"为什么"，再回答"怎么做"，最后回答"如何证明"。

### 第一层：目标与动机

**Q：你把 JSON 输出方案排成"Function Calling > 约束解码 > JSON Mode > 后处理 > Few-shot"。为什么 Function Calling 最可靠，它和约束解码本质区别是什么？**

Function Calling 是"模型 + API 协议"双重约束。模型训练时就学了"生成 tool_call 要符合声明的 Schema"（如 OpenAI 的 function calling 模型经过专门微调），API 层面传入 tools 参数声明 Schema，模型生成时受训练约束 + Schema 引导，可靠性最高（99%+）。约束解码（如 Outlines/GBNF）是"推理时 token 级掩码"——用有限状态机（FSM）跟踪当前生成位置允许的 token，非法 token 的 logit 设 $-\infty$（概率归零），保证语法正确（100% 合法 JSON），但不保证语义（字段值可能错，如 age 写成 "abc" 虽然类型对但值错）。区别：Function Calling 靠模型学到的语义理解 + API 约束（语义和格式都对），约束解码靠硬掩码（只保证格式）。前者更自然，后者更硬核。

### 第二层：证据与定位

**Q：线上用 Function Calling，突然某天 JSON 解析失败率从 0.1% 飙到 5%。怎么定位是模型版本变了、Schema 设计问题、还是 API bug？**

三步定位。一是看失败样本——失败的 tool_call 长什么样，是格式错（缺括号/非法 JSON）还是 Schema 不符（字段类型错/缺必填字段）。如果格式错（Function Calling 不该出格式错），查 API/模型版本（是否升级了模型，新版本 function calling 行为变了）；如果 Schema 不符（如某个枚举字段生成了非法值），查 Schema 设计（枚举值是否清晰、是否有歧义）和输入（某些复杂 query 是否让模型困惑）。二是查模型版本——服务端是否切换了模型（如从 GPT-4-0613 换成新版本，新版本的 function calling 训练可能有 regression）。三是查 API 响应——看 tool_call 的原始返回，是否有 finish_reason 异常（如 length 截断导致 JSON 不完整）。通常 5% 飙升多因模型版本 regression 或 Schema 边界 case。

### 第三层：根因深挖

**Q：约束解码（Outlines/GBNF）你说用 FSM 保证语法正确，但如果字段值语义错（如 age="abc" 但类型是 string），约束解码能拦住吗？**

约束解码拦不住语义错误，只拦语法。FSM 基于"语法规则"（如 JSON 的 GBNF 文法：object = "{" members "}"，string = '"' chars '"'），它能保证 age 字段的值是合法的 string（有引号、合法字符），但保证不了 age 的值是合理的数字（如 "abc" 是合法 string 但语义错）。要拦语义错，需要在 FSM 里加"语义约束"——如定义 age 字段的值匹配 `\d+`（只允许数字字符串），这样 "abc" 会被 FSM 拒绝。Outlines 支持用正则/Pydantic 模型定义更细的约束（如 `age: int` 会让 FSM 只允许数字 token）。所以约束解码能拦"类型级语义错"（age 不是数字），但拦不住"业务级语义错"（age=999 是合法数字但不合理）——后者要靠后处理校验。

**Q：那为什么不直接用 Pydantic 模型做约束解码（Outlines 支持），把所有字段约束写死，连业务级语义错也拦住？**

Pydantic 能定义字段级约束（如 `age: int = Field(ge=0, le=150)`，约束解码时 FSM 只允许 0-150 的数字），但局限在于：一是复杂业务规则难用 Pydantic 表达（如"如果 type=A 则 field_b 必填，否则选填"这种条件约束，Pydantic 的 validator 能写但 Outlines 转 FSM 困难）；二是 FSM 越复杂，生成时可选 token 越少，模型可能"卡住"（无合法 token 可选）或生成质量下降（约束太强，模型被迫生成不自然的表达）；三是性能开销——复杂 FSM 的每步 token 掩码计算开销大，推理速度降。所以约束解码适合"结构化约束"（字段类型、枚举值、简单范围），复杂业务规则用后处理校验（Pydantic validate + 业务逻辑校验 + 重试）。

### 第四层：方案权衡

**Q：Function Calling 最可靠，但有些场景你用 JSON Mode（OpenAI 原生）而非 Function Calling。为什么？什么时候选 JSON Mode？**

JSON Mode 适合"只要合法 JSON，不需要严格 Schema"的场景。Function Calling 要求预先定义 tool 的 Schema（字段名、类型、描述），适合"调用工具"场景（如查天气、下单）。但如果场景是"自由生成结构化内容"（如生成一份报告，字段不固定），用 Function Calling 强制 Schema 会限制模型灵活性（模型被迫按 Schema 填，可能漏掉想表达的内容）。JSON Mode 只保证"输出是合法 JSON"（格式对），不约束 Schema（字段随意），模型能自由组织内容。代价是字段不可控（可能多字段、少字段、字段名变），需要后处理适配。选型：工具调用用 Function Calling，自由结构化用 JSON Mode + 后处理容错。

**Q：为什么不直接用 Prompt + Few-shot（给几个 JSON 示例让模型学），省得依赖 Function Calling 或约束解码这些特殊机制？**

Prompt + Few-shot 是"软约束"——模型"大概率"按示例格式输出，但没有强制保证（可能漏字段、加字段、格式跑偏），可靠性约 90-95%（看模型和 prompt）。Function Calling 和约束解码是"硬约束"——可靠性 99%+。生产场景（如对接下游系统解析 JSON）对可靠性要求高（一次失败可能导致流水线中断），软约束不够。Few-shot 的优势是"零依赖"（任何模型都能用，不依赖 Function Calling API 或约束解码框架），适合"原型验证"或"模型不支持 FC/约束解码"的场景。工程优先级：原型阶段用 Few-shot 快速验证，生产化时升级到 Function Calling 或约束解码保证可靠性。

### 第五层：验证与沉淀

**Q：你怎么衡量 JSON 输出方案的可靠性，证明 Function Calling 比 Few-shot 好？**

定义 JSON 成功率指标：在测试集（覆盖各种 query 类型）上跑，统计"输出能被正确解析且符合 Schema"的比例。Few-shot 基线如 92%，Function Calling 如 99.5%，约束解码如 99.9%（语法 100% 但语义可能有少量错）。细分失败类型：格式错（非法 JSON）、Schema 不符（字段类型错/缺字段）、语义错（字段值不合理），看各方案的失败分布。做 A/B 测试：线上对照组（Few-shot）vs 实验组（Function Calling），看下游系统的"JSON 解析失败率"和"重试率"是否降。关键是验证"可靠性提升对业务的影响"——如解析失败导致工单流失，成功率从 92% 到 99.5% 直接减少 7.5% 的流失。

**Q：JSON 输出方案怎么沉淀成团队的标配？**

封装成"结构化输出 SDK"：统一接口 `generate_structured(prompt, schema, mode)`，mode 可选 function_calling/constrained_decoding/json_mode/few_shot，根据模型能力自动选最优模式。内置 Schema 模板库（常见业务结构的 Schema 定义）、后处理修复器（非法 JSON 修复、字段补全、类型转换）、重试机制（失败自动重试 + 降级到更可靠的模式）。沉淀"各模型的 JSON 能力对照表"（如 GPT-4 FC 可靠、Llama-3 用约束解码）、"Schema 设计规范"（字段命名、枚举值、可选/必填的最佳实践）。把"结构化输出"作为 LLM 调用的默认能力，开发者只管定义 Schema，可靠性由 SDK 保证。

## 结构化回答

**30 秒电梯演讲：** 稳定输出JSON的方法：Function Calling、Constrained Decoding(约束解码)、JSON Mode、后处理修复、Few-shot+Schema。

**展开框架：**
1. **Function** — 厂商原生支持，最稳定
2. **Constrained** — GBNF/Outlines，token级约束
3. **JSON Mode** — OpenAI response_format

**收尾：** 您想深入聊：Outlines的GBNF语法怎么写？


## 视频脚本

> 预计时长：4 分钟 | 由浅入深


| 时间 | 画面/字幕 | 口播台词 | 讲解要点 |
|------|----------|----------|----------|
| 0:00 | 标题卡：让模型稳定输出符合 Schema 的 JSON… | "就像让学生填表格——Function Calling是给标准表格(强约束)，约束解码是限制…" | 开场钩子 |
| 0:20 | 核心概念图 | "稳定输出JSON的方法：Function Calling、Constrained Decoding(约束解码)、JSON…" | 核心定义 |
| 0:50 | Function示意图 | "Function——厂商原生支持，最稳定" | 要点拆解1 |
| 1:30 | 对比/实战案例图 | "对比一下常见误区和工程实践，看真实场景里怎么取舍。" | 实战与对比 |
| 2:20 | 总结卡 | "记住核心要点。下期我们追问：Outlines的GBNF语法怎么写？" | 收尾与钩子 |
