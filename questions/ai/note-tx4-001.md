---
id: note-tx4-001
difficulty: L4
category: ai
subcategory: LLM
tags:
  - 腾讯
  - 面经
  - Function Calling
  - SFT
  - DPO
feynman:
  essence: "大模型的工具调用能力不是预训练自带的，而是通过SFT教会格式+DPO/RLHF优化决策质量两阶段训练获得的"
  analogy: "SFT是驾校学基本操作(打方向盘、踩油门)；DPO是教练告诉你哪种变道方式更好、什么时候不该变道——教的是判断力"
  first_principle: "预训练只学到语言知识，不知道工具调用的JSON格式和调用时机，必须通过后训练注入"
  key_points:
    - '预训练阶段不具备工具调用能力'
    - 'SFT: 构造工具调用数据集，教会格式和参数填充'
    - 'DPO/RLHF: 构造偏好对，优化调用决策(何时调/调什么/何时停)'
    - 'SFT只能复刻样本，DPO让模型学会判断好坏'
first_principle:
  essence: "工具调用 = 格式能力(SFT) + 决策能力(DPO)"
  derivation: "LLM预训练只学了文本生成 → 不知道结构化JSON输出 → SFT教会格式 → 但SFT只是模仿，不知道什么情况该调/不该调 → DPO通过偏好对优化决策"
  conclusion: "工业界标配是SFT打底 + DPO轻量化对齐"
follow_up:
  - "工具调用数据集怎么构造？需要多少条？"
  - "DPO和RLHF在工具调用场景的区别？"
  - "开源模型不微调能做Function Calling吗？"
---

# 大模型工具调用(Function Calling)能力是如何训练出来的？SFT和DPO分别解决什么问题？

## 训练全流程

```
┌──────────────────────────────────────────────────┐
│                                                  │
│  阶段1: 预训练 (Pre-training)                     │
│  ────────────────────────────                    │
│  海量文本 → 语言理解能力                          │
│  ⚠️ 不具备工具调用能力                            │
│                                                  │
│  阶段2: SFT 监督微调 (Supervised Fine-Tuning)    │
│  ─────────────────────────────────────           │
│  工具调用数据集 → 学会格式 + 参数填充             │
│  ✅ 教会: 输出合法JSON、何时调用、补齐必填参数     │
│  ❌ 缺陷: 只能复刻样本，无法区分调用好坏          │
│                                                  │
│  阶段3: DPO/RLHF 偏好对齐 (Preference Alignment)  │
│  ────────────────────────────────────────        │
│  偏好对(好vs坏调用) → 优化决策质量                │
│  ✅ 教会: 自主判断要不要调、调用顺序、何时停止    │
│  ✅ 减少: 死循环、无效调用、幻觉调用              │
│                                                  │
└──────────────────────────────────────────────────┘
```

## SFT 阶段详解

### 数据集构造

```python
# 每条训练数据包含：工具描述 + 用户问题 + 标准调用JSON
training_example = {
    "tools": [
        {
            "name": "search_restaurant",
            "description": "搜索餐厅",
            "parameters": {
                "type": "object",
                "properties": {
                    "cuisine": {"type": "string"},
                    "location": {"type": "string"},
                    "price_max": {"type": "integer"}
                },
                "required": ["location"]
            }
        }
    ],
    "messages": [
        {"role": "user", "content": "附近有什么川菜馆"},
        {"role": "assistant", "content": None,
         "tool_calls": [{
             "name": "search_restaurant",
             "arguments": {"cuisine": "川菜", "location": "附近"}
         }]},
        {"role": "tool", "content": '{"results": [...]}'},
        {"role": "assistant", "content": "为您找到以下川菜馆..."}
    ]
}
```

### SFT 解决的问题

| 能力 | 说明 |
|------|------|
| **格式正确** | 输出合法JSON Schema，不是自然语言 |
| **参数完整** | 补齐必填参数，从用户输入中提取 |
| **时机判断** | 识别何时需要调用工具 vs 直接回答 |
| **多工具选择** | 从N个工具中选择正确的工具 |

### SFT 的局限

- 无法区分"好的调用"和"坏的调用"(都是合法JSON)
- 可能产生无意义的重复调用(格式对但逻辑错)
- 可能调用不存在的工具(幻觉调用)

## DPO/RLHF 阶段详解

### 偏好对构造

```python
# 同一个问题下，构造好vs坏的调用对
preference_pair = {
    "prompt": "帮我订明天晚上的川菜馆",

    "chosen": {  # ✅ 好的调用
        "tool": "book_restaurant",
        "arguments": {
            "cuisine": "川菜",
            "date": "2026-06-29",
            "meal": "dinner"
        },
        "reason": "参数完整，意图正确"
    },

    "rejected": {  # ❌ 坏的调用
        "tool": "search_restaurant",
        "arguments": {"cuisine": "川菜"},
        "reason": "用户要订座不是搜索，且缺少日期参数"
    }
}
```

### DPO vs RLHF 对比

| 维度 | DPO | RLHF |
|------|-----|------|
| **训练信号** | 偏好对(chosen vs rejected) | Reward Model打分 + PPO |
| **训练流程** | 直接优化(无需RM) | 先训RM，再PPO优化 |
| **计算成本** | 低(类似SFT) | 高(需要RM+Actor+Critic) |
| **收敛速度** | 快 | 慢(需多轮迭代) |
| **稳定性** | 高 | 低(PPO超参敏感) |
| **工业界偏好** | ⭐首选 | 大厂复杂场景用 |

### DPO 训练公式

```
L_DPO = -E[log σ(β · (log π(y_w|x)/π_ref(y_w|x) - log π(y_l|x)/π_ref(y_l|x)))]

其中:
  y_w = chosen(好的调用)
  y_l = rejected(坏的调用)
  π = 当前策略, π_ref = 参考策略(SFT模型)
  β = 温度参数, σ = sigmoid
```

## 无微调方案：纯Prompt模拟

```python
# 开源模型不微调，纯靠Prompt也能模拟Function Calling
# 但稳定性远低于原生微调模型
FUNCTION_CALLING_PROMPT = """
你可以使用以下工具：
{tools_schema}

用户问题：{user_input}

如果需要调用工具，输出：
<tool_call>{"name": "...", "arguments": {...}}</tool_call>
"""

# ⚠️ 问题：
# 1. 格式不稳定(可能输出纯文本)
# 2. 参数提取不准
# 3. 无法可靠判断何时停止调用
# 4. 复杂多工具场景容易混乱
```

## 工业界最佳实践

```
工具调用能力 = SFT(70%能力) + DPO(30%提升)

SFT数据量: 5K-50K条高质量工具调用样本
DPO偏好对: 1K-10K对好/坏调用对比
评估指标:
  - 格式准确率: JSON Schema合规率
  - 参数准确率: 必填参数完整率
  - 工具选择准确率: 选对工具的比例
  - 冗余调用率: 不必要的重复调用比例
```
