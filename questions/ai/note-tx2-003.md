---
id: note-tx2-003
difficulty: L4
category: ai
subcategory: LLM
tags:
- 腾讯
- 面经
- FunctionCalling
- 结构化输出
- SFT
feynman:
  essence: Function Calling 底层原理是模型经 SFT 学会"按JSON Schema格式生成工具调用意图"。SFT 阶段用大量(指令, 工具schema, 正确调用JSON)数据微调，让模型把"用户意图+工具描述"映射到"结构化JSON输出"。RLHF 起辅助作用——用偏好数据(正确调用>错误调用)优化，让模型在多个合法调用里选最优。本质是把"自然语言→结构化意图"这一映射通过监督学习+偏好优化固化进模型权重。
  analogy: 像教小孩填表——先给他看很多"问题+空白表+填好的表"的例子(SFT 监督学习)，他学会怎么填；再告诉他"这种填法比那种好"(RLHF 偏好优化)，他学会填得更准。最后看到新问题，他能自动填出正确的表。
  first_principle: 结构化输出的本质是"约束生成空间"。自然语言生成空间无限大，JSON Schema 把它约束到合法结构。SFT 让模型学会这个约束，RLHF 让模型在约束内选最优。
  key_points:
  - 'SFT 阶段: (指令+工具schema, 正确调用JSON) 监督微调'
  - 'RLHF 辅助: 偏好数据(正确调用>错误调用)优化选最优'
  - '本质: 自然语言→结构化意图 的映射，通过SFT+RLHF固化进权重'
  - JSON Schema 约束生成空间到合法结构
  - 推理时用 constrained decoding 强制合法JSON
first_principle:
  essence: 结构化输出 = 约束生成空间
  derivation: 自然语言空间无限 → JSON Schema 约束到合法结构 → SFT 学会约束 → RLHF 在约束内选最优 → 推理时 constrained decoding 强制合法
  conclusion: Function Calling 不是"模型理解了工具语义"，而是"模型学会了按 schema 生成结构化文本"
follow_up:
- Structured Output（response_format json_schema）和 Function Calling 区别？
- Constrained Decoding（如 outlines/guidance）怎么实现？
- 没有 SFT 的小模型怎么做 Function Calling？
memory_points:
- 本质澄清：FC并非理解语义，而是学会了将自然语言按schema映射为结构化JSON
- SFT的作用：用海量问答对数据，让模型学会合法JSON格式与参数字段抽取
- RLHF的作用：在SFT基础上，用偏好排序优化参数质量（如绝对日期优于相对词）
- 双保险机制：模型侧靠SFT学格式，推理侧靠约束解码(Constrained Decoding)兜底
- 底层实现：约束解码常将JSON结构转化为有限状态机(FSM)限制token生成空间
---

# 【某讯面经】Function Calling 底层原理：模型如何学会输出结构化工具参数？SFT/RLHF 起什么作用

## 一、Function Calling 的本质

```
用户："查一下北京明天的天气"
         +
工具 schema: get_weather(city, date)
         ↓
模型输出: {
  "name": "get_weather",
  "arguments": {"city": "北京", "date": "2026-06-24"}
}
```

**本质**：把"自然语言意图 + 工具描述"映射到"结构化 JSON 调用"。

这不是模型"理解"了工具语义，而是模型**学会了按 schema 生成结构化文本**。

## 二、SFT 的作用：学会映射

### 训练数据
```json
{
  "instruction": "查一下北京明天的天气",
  "tools": [{
    "name": "get_weather",
    "description": "查询指定城市天气",
    "parameters": {"city": "str", "date": "str"}
  }],
  "output": {
    "name": "get_weather",
    "arguments": {"city": "北京", "date": "2026-06-24"}
  }
}
```

数万到数十万条这样的数据，SFT 微调。

### SFT 学到了什么
- **格式**：输出是合法 JSON（不是自由文本）
- **字段映射**：用户说的"北京"→`city`，"明天"→`date`（还要算出具体日期）
- **工具选择**：从多个工具里选对的（天气问题选 `get_weather` 不是 `get_news`）
- **参数抽取**：从自然语言里抽出参数值

## 三、RLHF 的作用：选最优

SFT 后模型能生成合法调用，但多个合法调用里哪个更好？RLHF 优化这个。

### 偏好数据
```json
{
  "instruction": "查一下北京明天的天气",
  "chosen": {"name": "get_weather", "arguments": {"city": "北京", "date": "2026-06-24"}},
  "rejected": {"name": "get_weather", "arguments": {"city": "Beijing", "date": "明天"}}
}
```

- chosen：日期转成具体格式（工具能识别）
- rejected：保留"明天"原文（工具可能不识别）

### RLHF 优化
- 用 DPO/PPO 让模型偏好 chosen
- 学到的不仅是"格式对"，还有"参数质量高"（具体日期 > 相对日期，标准城市名 > 别名）

## 四、推理时怎么保证合法 JSON

光靠 SFT/RLHF 不够（模型偶尔会生成非法 JSON），推理时要加约束：

### 1. Constrained Decoding（约束解码）
```
生成时只允许输出符合 JSON Schema 的 token：
  生成 "{" 后 → 只能是 "name"/"arguments"
  生成 "name": " 后 → 只能是工具列表里的名字
  ...
  
实现：outlines / guidance / OpenAI 的 response_format: json_schema
```

### 2. Function Calling API（厂商封装）
```
OpenAI/Anthropic/混元 的 function calling 接口：
  - 服务端做 constrained decoding
  - 保证输出是合法工具调用
  - 模型侧 SFT + 推理侧约束 双保险
```

## 五、完整训练流程

```
[1] 预训练 → 学会语言能力
[2] 通用 SFT → 学会指令跟随
[3] Function Calling SFT → 学会按 schema 生成工具调用
    │  数据：(指令+工具schema, 正确调用JSON)
    │  量级：数万-数十万条
    ▼
[4] Function Calling RLHF/DPO → 优化参数质量
    │  数据：(指令, 好调用, 坏调用)
    ▼
[5] 推理时 Constrained Decoding → 强制合法 JSON
```

## 六、混元模型的工具调用特点

腾讯混元的 Function Calling 特点（面试加分）：
- 支持多工具并行调用（一次生成多个 tool_call）
- 支持工具嵌套（工具 A 的输出作为工具 B 的输入）
- 中文场景优化（城市名/日期格式的中文理解强）
- 与腾讯生态集成（微信/小程序/企业微信工具开箱即用）

## 七、加分点

- 说出 **Structured Output vs Function Calling**：
  - Function Calling：模型决定"调哪个工具+参数"
  - Structured Output（`response_format: json_schema`）：约束输出格式，不一定调工具
- 说出 **Constrained Decoding 的实现**：用 FSM（有限状态机）表示 JSON Schema，生成时只允许状态转移合法的 token
- 说出 **没有 SFT 的小模型怎么做**：纯 prompt + few-shot + 后处理 regex 兜底（准确率低但能用）

## 八、雷区

- ❌ "Function Calling 是模型理解了工具语义" → 本质是学会了按 schema 生成结构化文本
- ❌ "只靠 prompt 就能做 Function Calling" → 小模型准确率低，大模型靠 SFT 才稳
- ❌ "SFT 完就够了" → 推理时不加 constrained decoding 偶尔会生成非法 JSON

## 九、扩展

- **MCP（Model Context Protocol）**：标准化工具描述和发现，让 Function Calling 跨厂商复用
- **Parallel Function Calling**：一次生成多个 tool_call 并行执行（GPT-4 Turbo 支持）
- **Multi-turn Function Calling**：工具返回结果后，模型继续调下一个工具（ReAct 的基础）

## 记忆要点

- 本质澄清：FC并非理解语义，而是学会了将自然语言按schema映射为结构化JSON
- SFT的作用：用海量问答对数据，让模型学会合法JSON格式与参数字段抽取
- RLHF的作用：在SFT基础上，用偏好排序优化参数质量（如绝对日期优于相对词）
- 双保险机制：模型侧靠SFT学格式，推理侧靠约束解码(Constrained Decoding)兜底
- 底层实现：约束解码常将JSON结构转化为有限状态机(FSM)限制token生成空间

