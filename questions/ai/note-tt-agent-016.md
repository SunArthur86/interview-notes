---
id: note-tt-agent-016
difficulty: L3
category: ai
subcategory: Agent
tags:
- 淘天
- 面经
- 二面
- Function Call
- 准确率
- Prompt优化
feynman:
  essence: 提升Function Call准确率从Prompt、Schema、Few-shot、异常重试四个维度系统优化，将准确率从70%提升至95%+
  analogy: 就像训练新员工打电话——给他清晰的话术模板（Prompt），标准的操作手册格式（Schema），几个成功案例参考（Few-shot），以及犯了错怎么纠正的机制（异常重试）
  first_principle: Function Call本质是"自然语言→结构化参数"的映射。准确率取决于模型对工具语义的理解程度和参数生成的精确度
  key_points:
  - Prompt维度：工具选择决策树、使用时机约束、负面示例
  - Schema维度：参数描述精确化、枚举值约束、必填校验
  - Few-shot维度：正例+反例+边界case的示范
  - 异常重试：错误信息回传→修正参数→重试（最多3次）
first_principle:
  essence: Function Call错误率 = 选错工具概率 + 选对工具但参数错误概率
  derivation: 设选对工具概率P_tool=0.85，选对后参数正确概率P_param=0.90。总准确率=0.85×0.90=76.5%。优化Prompt→P_tool=0.95，优化Schema+Few-shot→P_param=0.97。总准确率=0.95×0.97=92.2%
  conclusion: 准确率是乘法关系，需同时优化工具选择和参数生成
follow_up:
- 怎么评估Function Call准确率？有专门的benchmark吗？
- 不同模型（GPT-4/Claude/GLM）的Function Call能力差异大吗？
- 能否用SFT专门训练模型的Function Call能力？
memory_points:
- 口诀法：四大维度全面提升调用准确率：决策树提示词、精确Schema、正反例示范、异常重试
- 因果句：因为模型不知道何时该用工具，所以Prompt必须规定明确的工具选择优先级
- 对比句：模糊Schema导致乱传参，加入枚举类型与提取示例的精确Schema能大幅提效
- 因果句：因为大模型缺乏边界感，所以必须注入意图明确的正反例Few-shot防误调用
---

# 怎么提升Function Call准确率？Prompt、Schema、Few-shot、异常重试四个维度优化方案？

## 四维度优化框架

```
                  Function Call准确率
                   /    |    \    \
                  /     |     \    \
           Prompt  Schema  Few-shot  Retry
           优化     优化    示范      机制
            |        |       |        |
         工具选择   参数生成  边界case  错误恢复
         决策树     精确描述  正反例    回传修正
```

## 维度一：Prompt优化

```python
SYSTEM_PROMPT = """你是一个电商智能助手的工具调用引擎。

## 工具选择规则（按优先级）：
1. 用户问"有没有/多少钱/在不在" → 用 search_products 或 check_inventory
2. 用户说"我要买/下单" → 用 place_order（需确认后才执行）
3. 用户说"退货/退款" → 用 process_refund
4. 不确定用户意图时 → 用 ask_clarification（不要猜！）

## 关键约束：
- ❌ 不要在用户只是"看看"时就调用 place_order
- ❌ 不要编造不存在的参数值（如product_id）
- ✅ 必须的工具参数缺失时，先问用户补全
- ✅ 一次只调用一个工具，不要并行多个

## 当工具返回错误时：
- 仔细阅读错误信息
- 修正参数格式后重试
- 如果连续3次失败，告诉用户"暂时无法处理"并转人工
"""
```

## 维度二：Schema精确化

```python
# ❌ 差的Schema（模糊）
BAD_SCHEMA = {
    "name": "search_products",
    "description": "搜索商品",
    "parameters": {
        "keyword": {"type": "string"},
        "price": {"type": "string"},
    }
}

# ✅ 好的Schema（精确）
GOOD_SCHEMA = {
    "name": "search_products",
    "description": "根据关键词搜索商品列表。当用户想了解商品信息、比价、查看库存时使用。",
    "parameters": {
        "keyword": {
            "type": "string",
            "description": "商品搜索关键词，如'红色卫衣'、'iPhone 15手机壳'。从用户原话中提取。",
            "example": "用户说'有没有便宜的蓝牙耳机' → keyword='蓝牙耳机'"
        },
        "price_min": {
            "type": "number",
            "description": "最低价格（元）。用户说'200以内'时设为0，price_max=200。",
            "default": 0
        },
        "price_max": {
            "type": "number",
            "description": "最高价格（元）。用户未提预算时设为null。",
            "default": null
        },
        "category": {
            "type": "string",
            "enum": ["数码", "服装", "家居", "食品", "美妆", "其他"],
            "description": "商品分类。从用户上下文推断，不确定时设为'其他'。"
        }
    },
    "required": ["keyword"]
}
```

## 维度三：Few-shot示范

```python
FEW_SHOT_EXAMPLES = [
    # 正例：明确的购买意图
    {
        "user": "帮我找一件200块左右的红色卫衣，L码的",
        "tool_calls": [
            {"name": "search_products", "arguments": {
                "keyword": "红色卫衣L码",
                "price_min": 150, "price_max": 250,
                "category": "服装"
            }}
        ]
    },
    # 反例：只是随便看看，不该下单
    {
        "user": "我想看看你们有什么手机",
        "tool_calls": [
            {"name": "search_products", "arguments": {
                "keyword": "手机", "category": "数码"
            }}
            # ❌ 不应该调用 place_order
        ],
        "explanation": "用户只是浏览，没有下单意图"
    },
    # 边界case：信息不完整
    {
        "user": "帮我下单",
        "tool_calls": [
            {"name": "ask_clarification", "arguments": {
                "question": "请问您想购买什么商品？请提供商品名称或链接。"
            }}
        ],
        "explanation": "下单需要商品信息，用户未提供时应先追问"
    },
]
```

## 维度四：异常重试

```python
async def function_call_with_retry(
    llm_call, tool_schemas, user_input, max_retries=3
):
    for attempt in range(max_retries):
        result = await llm_call(user_input, tools=tool_schemas)

        if result.tool_calls:
            for call in result.tool_calls:
                # 参数校验
                validation = validate_params(call.name, call.arguments)
                if not validation.ok:
                    # 将错误信息回传给模型
                    user_input += f"\n\n[工具{call.name}返回错误: {validation.error}]"
                    user_input += f"\n[正确参数格式: {get_schema_hint(call.name)}]"
                    break  # 重新让模型生成

                # 执行工具
                try:
                    tool_result = await execute_tool(call.name, call.arguments)
                    return tool_result
                except Exception as e:
                    user_input += f"\n\n[工具执行失败: {e}. 请尝试不同参数或换一个工具。]"
                    break
            else:
                continue  # 所有工具都成功
            continue  # 有错误，重试

        return result  # 模型选择不调用工具，直接回答

    return {"error": "连续3次调用失败", "escalate": True}
```

## 优化效果

| 优化维度 | 优化前准确率 | 优化后准确率 | 提升幅度 |
|---------|------------|------------|---------|
| 基线 | 70% | - | - |
| +Prompt | 70% | 78% | +8% |
| +Schema | 78% | 86% | +8% |
| +Few-shot | 86% | 92% | +6% |
| +Retry | 92% | 96% | +4% |

## 面试加分点

1. **错误归因**：分析Function Call错误是"选错工具"还是"参数错误"，分别用不同策略优化
2. **持续迭代**：收集线上错误case补充到Few-shot，形成数据飞轮
3. **温度调参**：Function Call场景Temperature应设为0（确定性输出），避免随机性导致参数变化
4. **模型选型**：GPT-4/Claude在Function Call上比开源模型好10-15%，但对成本敏感场景可用SFT微调小模型

## 记忆要点

- 口诀法：四大维度全面提升调用准确率：决策树提示词、精确Schema、正反例示范、异常重试
- 因果句：因为模型不知道何时该用工具，所以Prompt必须规定明确的工具选择优先级
- 对比句：模糊Schema导致乱传参，加入枚举类型与提取示例的精确Schema能大幅提效
- 因果句：因为大模型缺乏边界感，所以必须注入意图明确的正反例Few-shot防误调用


## 苏格拉底式面试追问

> 这组追问模拟面试官层层逼问，每一问先回答"为什么"，再回答"怎么做"，最后回答"如何证明"。

### 第一层：目标与动机

**Q：提升 Function Call 准确率为什么要从 Prompt、Schema、Few-shot、异常重试四个维度，而不是只优化一个？**

因为这四个维度解决不同类型的错误。Prompt 解决"意图理解"错误（模型没理解用户要什么）；Schema 解决"参数生成"错误（参数格式或值错）；Few-shot 解决"边界 case"错误（少见场景没参照）；异常重试解决"瞬时"错误（偶发的输出偏差）。单一维度优化有天花板——Prompt 再好，Schema 模糊时参数仍会错。四维组合是"层层兜底"，每一层拦截一类错误，累计把准确率从 70% 提到 95%+。

### 第二层：证据与定位

**Q：准确率从 70% 提到 95%，怎么知道是哪个维度的优化贡献最大？**

消融实验。每个维度单独开关，测准确率变化：1) 只优化 Prompt（其他保持基线）→ 准确率 78%（+8%）；2) 只优化 Schema → 82%（+12%）；3) 只加 Few-shot → 80%（+10%）；4) 只加异常重试 → 75%（+5%）。四个维度全开 → 95%（+25%，超过单维度之和是因为协同效应）。通过消融知道 Schema 优化贡献最大，后续重点投入。

### 第三层：根因深挖

**Q：Schema 优化贡献最大，根因是原来的 Schema 太差还是 Schema 对 Function Call 影响最大？**

两者都有，但 Schema 对 Function Call 的影响是根本性的。模型生成工具调用参数靠的是 Schema 的字段名、类型、description。如果 Schema 写得模糊（如 param: "the id"），模型要猜 id 的格式和来源，错误率高；如果 Schema 精确（如 order_id: "string, 12-digit order ID from user's recent order, required"），模型有明确指引。根因是"Schema 是模型理解工具的唯一契约"，契约模糊则调用必错。所以 Schema 优化是 ROI 最高的。

**Q：那为什么不直接用更大的模型（如 GPT-4）替代小模型，靠模型能力弥补 Schema 模糊？**

成本和延迟。GPT-4 的单次调用成本是 7B 模型的 50-100 倍，Function Call 场景通常高频调用（如客服每秒几十次），成本不可承受。而且大模型对模糊 Schema 的容忍度也不是无限的——Schema 完全没说明时 GPT-4 也会猜错。正确策略是"小模型 + 精确 Schema"，用工程优化（Schema）弥补模型能力的不足，比"大模型 + 模糊 Schema"性价比高 10 倍以上。

### 第四层：方案权衡

**Q：Few-shot 示例占了 context 的 1500 token，增加成本，怎么权衡示例数量和准确率？**

看边际收益。加第 1 个示例，准确率 +8%；加第 2 个，+4%；加第 3 个，+2%；加第 4 个，+0.5%。边际收益递减。经验上 3-5 个高质量示例的性价比最高——覆盖主要场景，token 成本可控。示例的选择比数量重要：1 个边界 case 示例（如"用户说查询但其实是退款"）比 3 个普通 case 示例更有价值。用 eval 集测不同示例组合的准确率，选最优子集。

**Q：异常重试会增加延迟（失败后重新调用 LLM），怎么权衡准确率和延迟？**

按错误类型决定重试策略。1) 格式错误（JSON 解析失败）→ 重试，附加"请输出合法 JSON"的提示，通常 1 次重试就修复；2) 参数错误（类型不对）→ 重试，附加错误信息让模型修正，最多 2 次；3) 工具选择错误 → 不重试（模型大概率还会选错），直接降级。重试的延迟成本（+3-5s）要和错误导致的用户体验损失权衡。对实时性要求高的场景（如客服），限制重试 1 次；对准确性要求高的场景（如数据处理），允许重试 3 次。

### 第五层：验证与沉淀

**Q：怎么持续监控 Function Call 准确率，避免迭代退化？**

建立 eval 流水线：1) 标注集——500+ 个 (用户 query, 正确工具调用) 对，覆盖所有工具和常见意图；2) 自动评估——每次 prompt/schema/模型变更，跑全量 eval 集统计准确率，下降 > 2% 阻断上线；3) 线上监控——采样 1% 流量做人工/自动标注，跟踪实时准确率，异常告警。沉淀为 Function Call 质量门禁：eval 准确率、线上准确率、各工具的 per-tool accuracy 三个指标的基线和告警阈值。

## 结构化回答

**30 秒电梯演讲：** 提升Function Call准确率从Prompt、Schema、Few-shot、异常重试四个维度系统优化，将准确率从70%提升至95%+。

**展开框架：**
1. **Prompt维度** — 工具选择决策树、使用时机约束、负面示例
2. **Schema维度** — 参数描述精确化、枚举值约束、必填校验
3. **Few-shot维度** — 正例+反例+边界case的示范

**收尾：** 您想深入聊：怎么评估Function Call准确率？有专门的benchmark吗？


## 视频脚本

> 预计时长：4 分钟 | 由浅入深


| 时间 | 画面/字幕 | 口播台词 | 讲解要点 |
|------|----------|----------|----------|
| 0:00 | 标题卡：怎么提升Function Call准确率？… | "就像训练新员工打电话——给他清晰的话术模板（Prompt），标准的操作手册格式（…" | 开场钩子 |
| 0:20 | 核心概念图 | "提升Function Call准确率从Prompt、Schema、Few-shot、异常重试四个维度系统优化，将准确率从…" | 核心定义 |
| 0:50 | Prompt维度示意图 | "Prompt维度——工具选择决策树、使用时机约束、负面示例" | 要点拆解1 |
| 1:30 | 对比/实战案例图 | "对比一下常见误区和工程实践，看真实场景里怎么取舍。" | 实战与对比 |
| 2:20 | 总结卡 | "记住核心要点。下期我们追问：怎么评估Function Call准确率？有专门的bench？" | 收尾与钩子 |
