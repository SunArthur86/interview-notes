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

