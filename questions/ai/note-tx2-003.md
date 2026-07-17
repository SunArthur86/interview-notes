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


## 苏格拉底式面试追问

> 这组追问模拟面试官层层逼问，每一问先回答"为什么"，再回答"怎么做"，最后回答"如何证明"。

### 第一层：目标与动机

**Q：Function Calling 的能力是 SFT 训出来的，为什么不靠 prompt 就能实现？SFT 解决了 prompt 解决不了的问题吗？**

SFT 把"输出结构化 JSON"固化成了模型的"本能"。纯 prompt 方式让模型"理解指令后生成 JSON"，但模型预训练时学的是自然语言，JSON 是"外语"，prompt 再好也有 5-15% 概率格式错（多 markdown、加解释、字段名错）。SFT 用大量"(指令, 工具 schema, 正确 JSON)"数据微调，让模型把"看到工具 schema → 输出 JSON"变成条件反射，格式准确率提到 99%+。SFT 解决的是"把概率性的格式遵从变成稳定的结构化输出能力"。

### 第二层：证据与定位

**Q：SFT 训练后 Function Calling 准确率只从 70% 提到 85%，没到 95%+ 预期，怎么定位是数据不够还是方法不对？**

看数据和方法。1) 数据——SFT 数据量（< 10000 条可能不够）、数据多样性（是否覆盖所有工具和意图）、数据质量（标注的 JSON 是否正确）。用更大量数据（50000+）或多轮场景数据补；2) 方法——学习率（太大过拟合、太小学不到）、训练轮数（太少欠拟合）。诊断：看训练 loss 曲线，如果 loss 下降但 eval 准确率不升，是过拟合或数据分布不匹配。消融实验：加数据 vs 调方法，看哪个收益大。

### 第三层：根因深挖

**Q：SFT 后的模型在"训练见过的工具"上表现好，但遇到"新工具"准确率下降，根因是什么？**

根因是 SFT 学到了"特定工具的调用模式"而非"通用的 Function Calling 能力"。如果训练数据里 search_order 出现 1000 次、search_user 出现 10 次，模型对 search_order 学得好、对 search_user 差。更深层：遇到完全没见过的工具（如 search_payment），模型可能不会泛化。解法：1) 训练数据要覆盖工具类型的多样性（不只多量，要多类型）；2) 加入"工具无关"的训练样本（如随机生成工具 schema，让模型学"按 schema 输出"的通用能力）；3) 用 instruction tuning 提升泛化。

**Q：那为什么不直接用 RLHF/DPO 做对齐优化，而要先 SFT？**

SFT 是"教会格式"，RLHF/DPO 是"优化决策"。两者解决不同问题：1) 模型不会输出 JSON 时，SFT 教它"输出合法 JSON"（格式问题）；2) 模型会输出 JSON 但选错工具或参数错时，RLHF/DPO 用偏好数据（正确调用 > 错误调用）优化"决策质量"。SFT 是基础（没有格式能力谈不上决策），RLHF/DPO 是提升。经验上先 SFT 把格式准确率到 95%+，再 DPO 把决策准确率提升 5-10%。两者顺序不能反（DPO 要基于已会格式的模型）。

### 第四层：方案权衡

**Q：Function Calling 训练用 SFT 还是 SFT + DPO，怎么权衡？**

看准确率瓶颈在哪。1) 如果瓶颈是"格式错"（JSON 不合法、字段缺失）——SFT 够，DPO 对格式问题帮助有限；2) 如果瓶颈是"决策错"（选错工具、参数语义错）——DPO 更有效，用偏好对（正确调用 vs 常见错误调用）训练模型区分。经验上 SFT 后格式准确率 95%+，决策准确率 85-90%，DPO 能把决策提到 92-95%。成本上 DPO 要偏好数据（标注成本高于 SFT 的直接标注），所以先 SFT 把能解决的解决，再 DPO 补决策。

**Q：为什么不直接用更大模型（免训练），靠 prompt 实现 Function Calling？**

成本和延迟。大模型（如 GPT-4）的 Function Calling 能力强（95%+），但：1) API 成本高（大规模调用每月数万美元）；2) 延迟高（大模型推理慢）。小模型（7B）SFT 后的 Function Calling 准确率能接近大模型（93-95%），但成本低 10-50 倍、延迟低 3-5 倍。所以"小模型 + SFT"比"大模型 + prompt"性价比高。只有当任务复杂度超出小模型能力时才用大模型。

### 第五层：验证与沉淀

**Q：怎么衡量 Function Calling 训练的效果，确保线上可用？**

三层评估：1) 格式准确率——输出是否是合法 JSON、字段是否齐全（应该 > 98%）；2) 工具选择准确率——选对工具的比例（应该 > 92%）；3) 参数准确率——选对工具且参数正确的比例（应该 > 88%）。三个指标分层看，定位瓶颈在格式、选择还是参数。沉淀为 Function Calling 训练规范：SFT 数据量（50000+）、数据多样性要求、SFT + DPO 的组合配方、eval 集的构建。

## 结构化回答

**30 秒电梯演讲：** Function Calling 底层原理是模型经 SFT 学会"按JSON Schema格式生成工具调用意图"。SFT 阶段用大量(指令, 工具schema, 正确调用JSON)数据微调。

**展开框架：**
1. **SFT 阶段** — (指令+工具schema, 正确调用JSON) 监督微调
2. **RLHF 辅助** — 偏好数据(正确调用>错误调用)优化选最优
3. **本质** — 自然语言→结构化意图 的映射，通过SFT+RLHF固化进权重

**收尾：** 您想深入聊：Structured Output（response_format json_schema）和 Function Calling 区别？


## 视频脚本

> 预计时长：5 分钟 | 由浅入深


| 时间 | 画面/字幕 | 口播台词 | 讲解要点 |
|------|----------|----------|----------|
| 0:00 | 标题卡：Function Calling 底层原理：模型… | "像教小孩填表——先给他看很多"问题+空白表+填好的表"的例子(SFT 监督学习)，他学会怎…" | 开场钩子 |
| 0:20 | 核心概念图 | "Function Calling 底层原理是模型经 SFT 学会"按JSON Schema格式生成工具调用意图"。SFT…" | 核心定义 |
| 0:50 | SFT 阶段示意图 | "SFT 阶段——(指令+工具schema, 正确调用JSON) 监督微调" | 要点拆解1 |
| 1:30 | RLHF 辅助示意图 | "RLHF 辅助——偏好数据(正确调用>错误调用)优化选最优" | 要点拆解2 |
| 2:20 | 对比/实战案例图 | "对比一下常见误区和工程实践，看真实场景里怎么取舍。" | 实战与对比 |
| 3:10 | 总结卡 | "记住核心要点。下期我们追问：Structured Output（response_for？" | 收尾与钩子 |
