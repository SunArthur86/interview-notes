---
id: note-bz-agent-082
difficulty: L3
category: ai
subcategory: Agent
tags:
  - B站面经
  - 意图识别
  - NLU
feynman:
  essence: 大模型意图识别=理解用户"想干什么"。方法：基于LLM的零样本/少样本分类、微调专用分类器、规则+LLM混合。核心是准确+快速+可扩展。
  analogy: 像前台接待——听客人说一句话，判断他要找哪个部门(意图分类)。
  first_principle: 意图识别是分类问题——把用户输入映射到预定义意图类别。LLM擅长这个，且无需训练即可支持新意图。
  key_points:
    - 方法：LLM分类/微调分类器/规则+LLM混合
    - 优势：零样本扩展新意图
    - 挑战：意图模糊/多意图/长尾
    - 评估：准确率/召回率/F1
first_principle:
  essence: 意图识别本质是文本分类，LLM天然适合且零样本能力强。
  derivation: '传统NLU需标注数据训练分类器。LLM理解语义，无需训练即可分类（零样本）。新意图只需更新prompt，无需重训。这大幅降低了意图系统的维护成本。'
  conclusion: 意图识别 = LLM零样本分类（快速扩展） + 规则兜底（高频确定意图）
follow_up:
  - 意图识别准确率怎么提升？——Few-shot示例+意图描述清晰
  - 多意图怎么处理？——多标签分类+优先级
  - 和槽位填充什么关系？——先识别意图，再提取槽位参数
---

# 大模型意图识别是怎么做的？

## 一、意图识别的定义

```
意图识别(Intent Recognition)
  = 理解用户输入"想做什么"，映射到预定义意图类别

例：
  "我要查订单"         → intent: query_order
  "退款"              → intent: refund
  "天气怎么样"         → intent: query_weather
  "帮我写首诗"         → intent: creative_writing
  "你好"              → intent: greeting
```

## 二、三种实现方法

### 方法 1：LLM 零样本/少样本分类（推荐）

```python
INTENT_PROMPT = """
判断用户意图，从以下选项中选择：

可用意图：
- query_order: 查询订单/物流
- refund: 退款/退货
- product_info: 产品咨询
- complaint: 投诉/不满
- greeting: 问候/闲聊
- other: 其他

用户输入: {user_input}

示例:
"我的快递到哪了" → query_order
"我要退那个手机" → refund
"你好" → greeting

只输出意图名称。
"""

intent = llm.classify(INTENT_PROMPT.format(user_input=user_msg))
# 优势：新增意图只需改prompt，无需训练
```

### 方法 2：微调专用分类器

```python
# 数据量大时，微调小模型更快更准
from transformers import AutoModelForSequenceClassification

# 标注数据
train_data = [
    ("查订单", "query_order"),
    ("退款", "refund"),
    # ... 几千条
]

# 微调BERT等小模型
model = AutoModelForSequenceClassification.from_pretrained("bert-base-chinese")
model.fit(train_data)
# 优势：快(ms级)、便宜、可离线
# 劣势：新意图需重训
```

### 方法 3：规则 + LLM 混合

```python
class HybridIntentRecognizer:
    """高频意图走规则(快)，长尾走LLM(准)"""
    
    RULES = {
        "query_order": ["订单", "快递", "物流", "到哪"],
        "refund": ["退款", "退货", "退钱"],
        "greeting": ["你好", "hi", "hello"],
    }
    
    def recognize(self, text):
        # 先走规则（快速）
        for intent, keywords in self.RULES.items():
            if any(kw in text for kw in keywords):
                return intent, 1.0  # 高置信
        
        # 规则未命中，走LLM（处理长尾）
        return self.llm_classify(text)  # 准但慢
```

## 三、多意图与槽位

```python
# 多意图识别（一句话多个意图）
def multi_intent(text):
    prompt = f"""
    用户输入可能包含多个意图。列出所有:
    
    输入: "{text}"
    输出: JSON数组，如 ["query_order", "refund"]
    """
    intents = llm.parse(prompt)
    # "查下我的订单，不对要退款" → ["query_order", "refund"]

# 槽位填充（意图确定后，提取参数）
def slot_filling(text, intent):
    if intent == "query_order":
        slots = llm.extract(f"""
        从以下文本提取: order_id(订单号)
        文本: {text}
        """)
        # "查我的订单A123" → {order_id: "A123"}
```

## 四、意图识别的挑战

```
┌──────────────┬──────────────────────────────────┐
│ 挑战          │ 对策                                │
├──────────────┼──────────────────────────────────┤
│ 意图模糊      │ 让LLM输出置信度，低的追问          │
│ "那个东西"   │ → "您是指查询还是购买？"            │
├──────────────┼──────────────────────────────────┤
│ 多意图        │ 多标签分类，按优先级处理            │
├──────────────┼──────────────────────────────────┤
│ 长尾意图      │ LLM兜底+定期把高频长尾加入规则     │
├──────────────┼──────────────────────────────────┤
│ 新意图出现    │ LLM零样本支持/识别unknown聚类      │
├──────────────┼──────────────────────────────────┤
│ 实时性        │ 规则优先(快)，LLM兜底              │
└──────────────┴──────────────────────────────────┘
```

## 五、面试加分点

1. **LLM 零样本是革命**：新增意图无需训练，只改 prompt——这是比传统 NLU 的巨大优势
2. **混合方案最实用**：规则(快)+LLM(准)结合，兼顾延迟和覆盖
3. **意图+槽位配合**：识别意图后还要提取参数，是完整的 NLU
