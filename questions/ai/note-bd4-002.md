---
id: note-bd4-002
difficulty: L3
category: ai
subcategory: Agent
tags:
- 字节
- 面经
- NLU
- 意图识别
feynman:
  essence: 意图识别判断用户想干什么(分类)，槽位填充提取关键参数(NER)，两者组合让系统理解自然语言指令
  analogy: 就像餐厅点菜——意图识别是判断你想'点菜'还是'退单'，槽位填充是提取你说的'川菜、人均50、订座'这些关键参数
  first_principle: 自然语言→结构化操作的映射，本质是NLU(自然语言理解)的两个核心子任务
  key_points:
  - 意图识别：文本分类任务，输出intent label
  - 槽位填充：序列标注任务(NER)，提取实体参数
  - 方案演进：规则→小模型(BERT)→LLM(Zero-shot/Few-shot)
  - 本地生活场景：意图=找店/订座/点评/导航，槽位=位置/菜系/价位/人数
first_principle:
  essence: 将非结构化文本映射为结构化操作意图
  derivation: 用户输入是自由文本 → 系统需要结构化指令执行操作 → 需要识别意图(做什么)+提取参数(怎么做)
  conclusion: 意图识别+槽位填充是任务型对话系统的NLU基础层
follow_up:
- 用LLM做意图识别时，怎么保证输出稳定JSON？
- 多轮对话中用户改需求(意图切换)怎么处理？
- 意图识别模块如何评测效果？
memory_points:
- 三大技术方案对比：规则+NER速度快泛化差，小模型微调需重训，LLM零样本启动灵活但延迟高
- 意图识别定动作(如订座)，槽位填充抓关键参数(如地点/价格/菜系)
- 因为LLM输出JSON不稳定，所以生产级最佳实践需增加结构化解析与兜底处理
- 小模型方案常采用BERT分类头定意图，配合BERT-CRF序列标注做槽位提取
---

# 本地生活场景下怎么做意图识别与槽位填充(Slot Filling)？

## 场景分析

用户输入："我想找个附近人均50左右好吃的川菜馆，最好能订座"

```
┌─────────────────────────────────────────────┐
│           用户自然语言输入                    │
│ "找个附近人均50的好吃的川菜馆，最好能订座"    │
└──────────────────┬──────────────────────────┘
                   ▼
┌──────────────────┴──────────────────────────┐
│              NLU 处理层                      │
├─────────────────────────────────────────────┤
│  意图识别(Intent)    │  槽位填充(Slot Filling)│
│  → intent: SEARCH   │  → location: 附近      │
│    RESTAURANT       │  → cuisine: 川菜       │
│                     │  → price: ~50/人       │
│                     │  → action: 订座        │
└──────────────────┬──────────────────────────┘
                   ▼
┌──────────────────┴──────────────────────────┐
│           后续 Agent 执行                    │
│  调用搜索API → 返回川菜馆列表 → 调用订座API  │
└─────────────────────────────────────────────┘
```

## 三种技术方案对比

### 方案一：规则+NER(传统方案)

```python
# 意图识别：关键词匹配
INTENT_RULES = {
    "SEARCH_RESTAURANT": ["找", "搜索", "推荐", "附近", "好吃"],
    "BOOK_TABLE": ["订座", "预约", "预订", "排队"],
    "WRITE_REVIEW": ["点评", "评价", "打分"],
}

# 槽位提取：NER模型(如BERT-CRF)
# 输入序列 → B-PERSON B-PRICE I-PRICE B-CUISINE
SLOT_DEFINITIONS = {
    "location": "位置",
    "cuisine": "菜系(川菜/粤菜/日料等)",
    "price_range": "人均价位",
    "party_size": "用餐人数",
    "time": "用餐时间",
}
```

**优点**：速度快、可控、成本低
**缺点**：维护成本高、泛化差、新意图需手动添加规则

### 方案二：小模型微调(BERT/RoBERTa)

```python
# 意图分类：BERT分类头
from transformers import BertForSequenceClassification

intent_model = BertForSequenceClassification.from_pretrained(
    "bert-base-chinese", num_labels=8  # 8种意图
)

# 槽位填充：BERT-CRF 或 BERT-Softmax
slot_model = BertForTokenClassification.from_pretrained(
    "bert-base-chinese", num_labels=20  # B-LOC I-LOC B-CUISINE O ...
)
```

**优点**：准确率高、推理速度快(BERT-tiny ~20ms)
**缺点**：需要标注数据、新意图需重新训练

### 方案三：LLM(Zero-shot / Few-shot) ← 推荐方案

```python
SYSTEM_PROMPT = """你是本地生活意图识别助手。分析用户输入，返回JSON。

意图类型：
- SEARCH_RESTAURANT: 搜索餐厅
- BOOK_TABLE: 预订座位
- GET_REVIEW: 查看评价
- NAVIGATE: 导航到店

槽位定义：
- location: 位置描述
- cuisine: 菜系偏好
- price_per_person: 人均价位(整数)
- party_size: 用餐人数(整数)
- reservation_time: 预订时间

输出格式：
{"intent": "...", "slots": {"key": "value"}, "confidence": 0.0-1.0}

示例：
输入：附近人均80的日料店
输出：{"intent": "SEARCH_RESTAURANT", "slots": {"location": "附近", "cuisine": "日料", "price_per_person": 80}, "confidence": 0.95}
"""

response = llm.chat(system=SYSTEM_PROMPT, user=user_input)
result = json.loads(response)  # 直接拿到结构化结果
```

**优点**：零样本启动、灵活扩展新意图、理解复杂表达
**缺点**：延迟高(200-500ms)、成本高、输出格式不稳定

## 生产级最佳实践：分层架构

```
┌──────────────────────────────────────┐
│  Layer 1: 缓存层 (Semantic Cache)    │ ← 相似query直接返回
├──────────────────────────────────────┤
│  Layer 2: 规则快通道                  │ ← 高频简单意图秒回
│  (正则+关键词)                        │
├──────────────────────────────────────┤
│  Layer 3: 小模型分类                  │ ← BERT-tiny 处理80%流量
│  (BERT分类+NER)                      │
├──────────────────────────────────────┤
│  Layer 4: LLM兜底                    │ ← 复杂query/低置信度走LLM
│  (GPT-4/GPT-3.5)                    │
└──────────────────────────────────────┘
```

## 保证LLM输出稳定JSON的技巧

1. **System Prompt约束**：明确要求JSON格式，提供few-shot示例
2. **Function Calling**：使用OpenAI function calling原生支持结构化输出
3. **JSON Mode**：启用response_format={"type": "json_object"}
4. **Schema验证**：输出后用Pydantic/jsonschema校验，失败则重试
5. **降级策略**：JSON解析失败→正则提取→规则兜底→人工客服

## 记忆要点

- 三大技术方案对比：规则+NER速度快泛化差，小模型微调需重训，LLM零样本启动灵活但延迟高
- 意图识别定动作(如订座)，槽位填充抓关键参数(如地点/价格/菜系)
- 因为LLM输出JSON不稳定，所以生产级最佳实践需增加结构化解析与兜底处理
- 小模型方案常采用BERT分类头定意图，配合BERT-CRF序列标注做槽位提取

