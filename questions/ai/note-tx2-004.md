---
id: note-tx2-004
difficulty: L3
category: ai
subcategory: Agent
tags:
- 腾讯
- 面经
- 模型输出
- JSON
- 结构化输出
feynman:
  essence: 让模型稳定输出标准 JSON Schema 的五层手段：①Prompt 层明确要求+给few-shot ②Schema 设计精简(字段少/命名直观/加description) ③模型层用支持 Structured Output 的接口(response_format json_schema)④Constrained Decoding(FSM 约束生成)⑤后处理兜底(regex提取/Pydantic校验/失败重试)。越靠前越便宜，越靠后越兜底。
  analogy: 像让小学生写规范作文——先讲清楚要求(Prompt)，给范文(Schema+few-shot)，用作文格子纸(Structured Output API)，写错字涂改(Constrained Decoding)，最后老师检查批改(后处理)。
  first_principle: JSON 输出的不稳定源于 LLM 生成的随机性。解法是从"引导"到"约束"到"兜底"多层防御，每层成本递增、可靠性递增。
  key_points:
  - 'Prompt层: 明确要求+给few-shot示范'
  - 'Schema设计: 字段少/命名直观/加description/必填标required'
  - 'Structured Output API: response_format json_schema 服务端约束'
  - 'Constrained Decoding: FSM约束生成空间到合法JSON'
  - '后处理兜底: regex提取/Pydantic校验/失败重试'
first_principle:
  essence: JSON 稳定输出 = 引导 + 约束 + 兜底多层防御
  derivation: LLM 生成随机 → 单层不可靠 → Prompt引导(便宜) → Schema设计(便宜) → API约束(中) → Decoding约束(中) → 后处理兜底(贵) → 多层配合
  conclusion: 没有"一句话搞定"的方法，是 5 层防御体系的工程问题
follow_up:
- Constrained Decoding 的 FSM 怎么构造？
- Pydantic 和 JSON Schema 什么关系？
- 模型输出四类失败场景是哪四类？
memory_points:
- 五层防御体系：Prompt提示→Schema设计→API限制→约束解码→后处理兜底
- Schema设计铁律：字段少(防漏)、命名直观、必须加description(帮助理解)
- 因果逻辑：因为模型靠description理解字段，所以命名直观和描述详尽至关重要
- 约束解码原理：把JSON结构变FSM状态机，每步仅允许生成能转移到合法状态的token
- 参数经验：chunk_size推荐200-500，overlap设10-20%防边界切断关键信息
---

# 【某讯面经】如何稳定让模型输出标准 JSON Schema？

## 一、五层防御体系

```
[1] Prompt 层（最便宜）
    │  明确要求 + few-shot 示范
    ▼
[2] Schema 设计（便宜）
    │  字段精简 + 命名直观 + 加 description
    ▼
[3] Structured Output API（中）
    │  response_format: json_schema
    ▼
[4] Constrained Decoding（中）
    │  FSM 约束生成空间
    ▼
[5] 后处理兜底（最贵）
       regex 提取 / Pydantic 校验 / 失败重试
```

## 二、Prompt 层：明确要求 + few-shot

```python
prompt = """
请从用户输入中提取订单信息，输出严格符合以下 JSON Schema 的 JSON：

{
  "order_id": "字符串，订单号",
  "amount": "数字，金额",
  "currency": "字符串，CNY或USD"
}

要求：
1. 只输出 JSON，不要任何其他文字
2. 不要用 markdown 代码块包裹

示例：
输入: "订单12345金额100元"
输出: {"order_id": "12345", "amount": 100, "currency": "CNY"}

输入: "Order ABC cost $50"
输出: {"order_id": "ABC", "amount": 50, "currency": "USD"}

现在处理: {user_input}
"""
```

**关键**：给 2-3 个 few-shot，覆盖典型场景（中文/英文/数字）。

## 三、Schema 设计：精简 + 直观

### 好的 Schema
```json
{
  "type": "object",
  "properties": {
    "order_id": {
      "type": "string",
      "description": "订单号，纯数字"
    },
    "amount": {
      "type": "number",
      "description": "订单金额，单位元"
    }
  },
  "required": ["order_id", "amount"]
}
```

### 设计原则
- **字段少**：5 个以内最好，超过 10 个模型容易漏
- **命名直观**：`order_id` 比 `oid` 好（模型一眼看懂）
- **加 description**：模型主要靠 description 理解字段含义
- **标 required**：必填字段明确标注
- **避免嵌套深**：超过 2 层嵌套准确率下降
- **枚举明确**：`"enum": ["CNY", "USD"]` 比 free text 好

### 反例（容易出错）
```json
{
  "properties": {
    "oid": {"type": "string"},          // 命名模糊
    "amt": {"type": "number"},           // 没说明单位
    "info": {                            // 嵌套深
      "user": {
        "addr": {...}
      }
    }
  }
}
```

## 四、Structured Output API

```python
# OpenAI / 混元 等
response = client.chat.completions.create(
    model="hunyuan-pro",
    response_format={
        "type": "json_schema",
        "json_schema": {
            "name": "order_info",
            "schema": {...},  # 你的 JSON Schema
            "strict": true    # 严格模式
        }
    },
    messages=[...]
)
# 服务端保证输出是合法 JSON
```

**strict: true** 的意义：服务端做 constrained decoding，强制输出合法。

## 五、Constrained Decoding（约束解码）

```
用 FSM（有限状态机）表示 JSON Schema：

状态: "期待 {"
  → 生成 "{" → 状态: "期待 key"
状态: "期待 key"
  → 只能生成 schema 里的 key 名（"order_id"/"amount"）
  → 生成 "order_id" → 状态: "期待 :"
状态: "期待 :"
  → 生成 ":" → 状态: "期待 value"
...

工具：outlines / guidance / lm-format-enforcer
```

**原理**：每一步只允许生成"能转移到合法状态"的 token，从根本上杜绝非法 JSON。

## 六、后处理兜底（最后一道防线）

```python
import json, re
from pydantic import BaseModel, ValidationError

class OrderInfo(BaseModel):
    order_id: str
    amount: float
    currency: str = "CNY"

def parse_model_output(raw: str) -> OrderInfo:
    # 1. 去除可能的 markdown 包裹
    raw = re.sub(r'^```json\s*|\s*```$', '', raw.strip())
    
    # 2. 尝试解析 JSON
    try:
        data = json.loads(raw)
    except json.JSONDecodeError:
        # 3. regex 提取 JSON 片段
        match = re.search(r'\{[^{}]*\}', raw, re.DOTALL)
        if not match:
            raise ValueError("无法提取 JSON")
        data = json.loads(match.group())
    
    # 4. Pydantic 校验
    try:
        return OrderInfo(**data)
    except ValidationError as e:
        # 5. 失败重试（把错误塞回 prompt 让模型重写）
        raise RetryNeeded(str(e))
```

## 七、模型输出四类失败场景

| 类型 | 表现 | 解法 |
|------|------|------|
| **格式错误** | 不是合法 JSON（多了逗号/少了括号） | Constrained Decoding + regex 兜底 |
| **字段缺失** | 漏了 required 字段 | Pydantic 校验 + 重试 |
| **类型错误** | amount 给了字符串"100"不是数字 100 | Pydantic 自动转换 + 校验 |
| **幻觉内容** | 编造了 schema 里没有的字段 | strict schema + 忽略多余字段 |

## 八、加分点

- 说出 **5 层防御的性价比**：前 3 层（Prompt+Schema+API）解决 90% 问题，后 2 层（Decoding+后处理）兜底剩余 10%
- 说出 **strict mode 的代价**：constrained decoding 会略微增加延迟（每步要查 FSM）
- 说出 **混元/各厂商的 Structured Output 能力差异**：有些只支持简单 schema，有些支持嵌套和 enum

## 九、雷区

- ❌ 只靠 prompt 不加约束 → 偶尔失败
- ❌ Schema 字段太多（>15）→ 模型容易漏字段
- ❌ 没有后处理兜底 → 上线后偶发崩溃

## 十、扩展

- **Pydantic vs JSON Schema**：Pydantic 是 Python 的数据校验库，能从 Pydantic Model 自动生成 JSON Schema（`Model.model_json_schema()`），两者配合用
- **OpenAI 的 Structured Output**：`response_format: {type: "json_schema", strict: true}` 是 2024 年新功能，比 function calling 更严格
- **多 Schema 选择**：让模型先选 schema 类型再填充（如"这是订单还是退款"→选对应 schema）

## 记忆要点

- 五层防御体系：Prompt提示→Schema设计→API限制→约束解码→后处理兜底
- Schema设计铁律：字段少(防漏)、命名直观、必须加description(帮助理解)
- 因果逻辑：因为模型靠description理解字段，所以命名直观和描述详尽至关重要
- 约束解码原理：把JSON结构变FSM状态机，每步仅允许生成能转移到合法状态的token
- 参数经验：chunk_size推荐200-500，overlap设10-20%防边界切断关键信息


## 苏格拉底式面试追问

> 这组追问模拟面试官层层逼问，每一问先回答"为什么"，再回答"怎么做"，最后回答"如何证明"。

### 第一层：目标与动机

**Q：让模型输出标准 JSON Schema 为什么要五层手段（Prompt→Schema 设计→Structured Output→Constrained Decoding→后处理）？一层不够吗？**

一层不够，因为每层的"保障力度"不同。Prompt 层——LLM 可能不遵循（5-15% 格式错）；Schema 设计——减少歧义但不能保证输出；Structured Output 接口——模型层面约束但仍可能漏；Constrained Decoding——强制解码时合法，但有性能开销；后处理——兜底但增加延迟。五层是"纵深防御"——每层拦截一类的错误，层层兜底累计把成功率到 99.9%+。生产环境对格式正确性要求极高（一个错 JSON 可能导致整个流程挂），单层保障不够。

### 第二层：证据与定位

**Q：开了 Constrained Decoding 后格式 100% 合法了，但内容质量下降（模型硬凑字段），怎么定位？**

这是 Constrained Decoding 的已知副作用。强制约束让模型在解码时"优先满足格式"而非"优先语义正确"。如模型想输出"不知道"但没有对应字段，它会硬填一个看起来合法但语义错的值（如 amount=0）。定位：对比开/关 Constrained Decoding 的语义准确率（不是格式准确率），如果开了后语义准确率降 10%+，是约束太严。解法：1) Schema 设计留"escape hatch"（如 optional 字段或 nullable）；2) 弱化约束（只约束关键字段，非关键字段自由）。

### 第三层：根因深挖

**Q：LLM 输出 JSON 不稳定，根因是预训练数据 JSON 少还是 JSON 本身和自然语言冲突？**

两者都有，但"和自然语言冲突"是根本。LLM 预训练学的是"自然语言的统计分布"（token 序列），JSON 是"结构化的标记语言"，两者生成模式不同。LLM 生成自然语言时是"流畅续写"，生成 JSON 时要"严格按结构"，这两种模式的注意力分配不同。预训练数据里 JSON 稀缺（即使代码数据多，纯 JSON API 响应占比小），加剧了不稳定。根因是"JSON 是 LLM 的非自然输出形态"，SFT 和 Constrained Decoding 都是在"补偿这个非自然性"。

**Q：那为什么不直接用专门的 JSON 生成模型（如专门训练输出 JSON），而要通用大模型 + 多层保障？**

专门的 JSON 生成模型不存在通用性。Function Calling 的难点不是"输出 JSON"而是"理解用户意图 + 选对工具 + 填对参数值"，这需要通用语言理解能力。专门的 JSON 模型可能格式准但语义差（不知道该填什么值）。所以用通用大模型（理解强）+ 多层保障（补格式稳定性）是更优组合。类比：不雇"只会写字的人"，雇"懂业务的人 + 文字处理工具"。

### 第四层：方案权衡

**Q：Constrained Decoding 的性能开销（推理慢 10-30%），什么场景值得用，什么场景不值得？**

看"格式错误的代价"。1) 格式错误代价高（如 JSON 解析失败导致整个 Agent 流程中断、需要人工介入）——值得用 Constrained Decoding，性能开销换稳定性；2) 格式错误代价低（如可以重试，重试成本低）——不值得用，用后处理 + 重试更便宜。经验上：生产 Function Calling（高 QPS、错误不可接受）用 Constrained Decoding；原型或低频场景用 Prompt + 后处理。权衡性能 vs 稳定性。

**Q：为什么不直接在后端做强校验 + 重试（Pydantic 校验失败就重新调 LLM），而要前端（模型层）做约束？**

重试有累积成本。每次重试是一次完整的 LLM 调用（延迟和费用），如果格式错误率 10%，平均要重试 1.1 次，10% 的请求延迟翻倍。Constrained Decoding 在单次调用内保证格式（不重试），延迟更稳定。权衡：Constrained Decoding 单次慢 20% 但稳定；重试单次快但有 10% 概率翻倍。在高 QPS 场景，Constrained Decoding 的"稳定延迟"优于重试的"平均延迟"。两者也可以组合——Constrained Decoding 兜底 + 偶发错误时重试。

### 第五层：验证与沉淀

**Q：怎么衡量 JSON 输出稳定性的保障措施是否到位？**

三个指标：1) 格式合法率——json.loads 成功率（应该 > 99.9%）；2) Schema 符合率——Pydantic 校验通过率（应该 > 99%）；3) 语义准确率——字段值是否正确（如 amount 是真实金额不是硬凑的 0）。三个指标分层看，格式好不代表语义对。沉淀为 JSON 输出保障规范：每层手段的启用条件、Schema 设计规范（字段必填/可选/nullable 约定）、校验和重试策略。

## 结构化回答

**30 秒电梯演讲：** 让模型稳定输出标准 JSON Schema 的五层手段：①Prompt 层明确要求+给few-shot ②Schema 设计精简(字段少/命名直观/加description) ③模型层用支持 Structured Ou…

**展开框架：**
1. **Prompt层** — 明确要求+给few-shot示范
2. **Schema设计** — 字段少/命名直观/加description/必填标required
3. **Structured** — response_format json_schema 服务端约束

**收尾：** 您想深入聊：Constrained Decoding 的 FSM 怎么构造？


## 视频脚本

> 预计时长：4 分钟 | 由浅入深


| 时间 | 画面/字幕 | 口播台词 | 讲解要点 |
|------|----------|----------|----------|
| 0:00 | 标题卡：如何稳定让模型输出标准 JSON Schema？ | "像让小学生写规范作文——先讲清楚要求(Prompt)，给范文(Schema+few…" | 开场钩子 |
| 0:20 | 核心概念图 | "让模型稳定输出标准 JSON Schema 的五层手段：①Prompt 层明确要求+给few-shot ②Schema…" | 核心定义 |
| 0:50 | Prompt层示意图 | "Prompt层——明确要求+给few-shot示范" | 要点拆解1 |
| 1:30 | 对比/实战案例图 | "对比一下常见误区和工程实践，看真实场景里怎么取舍。" | 实战与对比 |
| 2:20 | 总结卡 | "记住核心要点。下期我们追问：Constrained Decoding 的 FSM 怎么构？" | 收尾与钩子 |
