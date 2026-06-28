---
id: note-gz-002
difficulty: L3
category: ai
subcategory: Agent
tags:
  - 瓜子二手车
  - 面经
  - RAG
  - 数据治理
feynman:
  essence: "大模型在数据密集型企业的价值在于三个方向：智能客服(RAG接入知识库)、用户画像增强(LLM解析非结构化数据)、辅助决策(理解维修描述等非标信息)"
  analogy: "瓜子二手车像一个大数据库——每辆车有2000多个因子。大模型就是数据库的智能查询接口，把'这车修过变速箱'这种自然语言变成可计算的特征"
  first_principle: "大模型的价值不在于替代现有系统，而在于处理现有系统处理不了的非结构化数据"
  key_points:
    - '智能客服: RAG接入实时车源知识库'
    - '画像增强: LLM从对话中提取隐式特征'
    - '辅助定价: 理解维修描述等非结构化信息'
    - '数据闭环: 对话数据→清洗→回流训练→反哺业务'
first_principle:
  essence: "大模型的核心优势是理解和生成自然语言，应用到数据治理领域就是'把文字变成数据'"
  derivation: "二手车是非标品 → 有大量文字描述(维修记录/车况描述) → 传统系统无法直接用 → LLM可以提取结构化特征 → 辅助定价/匹配/客服"
  conclusion: "大模型在数据企业的价值 = 非结构化→结构化的转换能力"
follow_up:
  - "数据闭环怎么落地？需要哪些基础设施？"
  - "RAG在车源知识库的文档切片策略？"
  - "如何衡量大模型对业务的实际贡献？"
---

# 如何利用大模型挖掘瓜子二手车的数据价值？

## 三大落地方向

```
┌──────────────────────────────────────────────────────┐
│            瓜子二手车大模型数据应用架构                │
├──────────────────────────────────────────────────────┤
│                                                      │
│  ┌──────────────┐  ┌──────────────┐  ┌────────────┐│
│  │ 智能客服大脑  │  │ 用户画像增强  │  │ 辅助定价    ││
│  │              │  │              │  │            ││
│  │ RAG接入      │  │ LLM解析对话  │  │ LLM理解    ││
│  │ 实时车源库   │  │ 提取隐式偏好  │  │ 维修描述    ││
│  │              │  │              │  │            ││
│  │ "这车有       │  │ "预算10万    │  │ "左前门     ││
│  │  事故吗？"   │  │  偏好日系    │  │  补过漆"    ││
│  │  →查车况库   │  │  自动挡"     │  │  →-2000元  ││
│  └──────────────┘  └──────────────┘  └────────────┘│
│                                                      │
│  ┌──────────────────────────────────────────────┐   │
│  │          数据闭环 (Flywheel)                   │   │
│  │  对话数据 → 清洗标注 → 回流训练 → 反哺业务     │   │
│  └──────────────────────────────────────────────┘   │
│                                                      │
└──────────────────────────────────────────────────────┘
```

## 方向1: 智能客服 RAG

```python
class CarSourceRAG:
    """接入实时车源知识库的客服Agent"""

    def __init__(self):
        self.knowledge_base = VectorDB(collection="car_sources")
        # 实时同步: MySQL车辆数据变更 → CDC → Kafka → 向量化 → 更新

    def answer(self, user_question, car_id=None):
        # 1. 检索车源信息
        car_info = self.knowledge_base.search(
            query=user_question,
            filter={"car_id": car_id} if car_id else None,
            top_k=3
        )

        # 2. 生成回答
        response = llm.chat(
            system="你是瓜子二手车客服，基于车况数据如实回答",
            context=car_info,
            user=user_question
        )
        return response

# 关键指标:
# - P99延迟 < 80ms (BERT-tiny做意图识别 + 缓存)
# - 车源数据延迟 < 5min (CDC近实时同步)
# - 回答准确率 > 90% (定期人工抽检)
```

## 方向2: 用户画像增强

```python
class ProfileExtractor:
    """从对话中提取用户隐式特征"""

    EXTRACTION_PROMPT = """
    分析以下用户对话，提取结构化画像特征:

    对话: {conversation}

    提取字段:
    - budget_range: 预算范围 (如 "8-12万")
    - brand_preference: 品牌偏好 (如 "日系/德系/国产")
    - body_type: 车型偏好 (如 "SUV/轿车/MPV")
    - transmission: 变速箱偏好 (如 "自动/手动")
    - fuel_type: 燃料偏好 (如 "燃油/新能源")
    - urgency: 购车紧迫度 (高/中/低)

    返回JSON格式。
    """

    def extract(self, conversation):
        result = llm.extract(EXTRACTION_PROMPT, conversation)
        # 更新到用户画像表
        user_profile.update(user_id, result)
        return result

# 价值: 传统画像只有"浏览过什么车"的行为数据
#       LLM画像补充了"为什么不买"的意图数据
#       → 推荐准确率提升15-25%
```

## 方向3: 辅助定价

```python
class PricingAssistant:
    """LLM理解非结构化维修/车况描述，辅助定价"""

    def adjust_price(self, car_description, base_price):
        # 1. LLM提取影响价格的因素
        factors = llm.extract(factors_prompt, car_description)
        """
        输入: "2023年上牌,左前门补漆,天窗正常,右后视镜有划痕"
        输出: [
            {"factor": "左前门补漆", "impact": -1500, "confidence": 0.9},
            {"factor": "右后视镜划痕", "impact": -500, "confidence": 0.8},
        ]
        """

        # 2. 结合传统AI定价模型
        adjusted = base_price
        for f in factors:
            adjusted += f["impact"] * f["confidence"]

        return adjusted

# 价值: 传统定价模型只看结构化数据(年份/里程/品牌)
#       LLM补充了非结构化描述(维修/外观/功能)
#       → 定价偏差率从±8%降到±3%
```

## 数据闭环

```
Step 1: 采集 — 客服对话/用户浏览/交易数据
Step 2: 清洗 — 去PII/去噪/质量校验
Step 3: 标注 — 高质量对话标注为训练数据
Step 4: 训练 — SFT微调/DPO对齐
Step 5: 评估 — AB实验验证模型效果
Step 6: 部署 — 替换线上模型
Step 7: 监控 — 收集新的bad case → 回到Step 1

关键: 闭环不是一次性的，是飞轮效应
     数据越多 → 模型越好 → 体验越好 → 更多数据
```

## 数据分层规范

```
ODS (原始层):   原始对话日志/车辆数据/用户行为
                → 不做处理, 原样存储

DWD (明细层):   清洗/脱敏/标准化
                → 对话文本去噪, 车辆字段标准化
                ⚠️ 必须做维度建模, 保证复用性

DWS (汇总层):   按主题汇总
                → 用户画像汇总, 车辆定价汇总

ADS (应用层):   直接服务业务
                → 推荐特征, 定价因子, 客服FAQ
```
