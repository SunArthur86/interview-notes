---
id: note-lx-agent-005
difficulty: L3
category: ai
subcategory: Agent
tags:
- 联想
- 面经
- 一面
- 意图识别
- 多轮对话
- 上下文
feynman:
  essence: 单轮分类器只看当前输入，忽略对话历史和上下文，无法处理省略句、指代消解和隐式意图。多轮意图识别需要结合上下文窗口+对话状态追踪
  analogy: 就像理解朋友说话——"帮我也来一个"单独看完全不懂（单轮分类器懵了），但上一句是"他点了一杯美式"，你就知道是要美式（多轮上下文理解）
  first_principle: 用户意图不是一个静态标签，而是一个随对话演进的动态状态。单轮分类器假设意图独立于上下文，这在真实对话中不成立
  key_points:
  - 单轮分类器忽略上下文：省略句、指代消解无法处理
  - 隐式意图：用户没明说但确实有需求
  - 多意图：一句话包含多个需求
  - 解决方案：对话状态追踪+上下文窗口+意图链
first_principle:
  essence: 意图是上下文相关的，不当前输入独立的
  derivation: 对话第5轮"那红色的呢？"——单轮分类器无法判断"红色"指什么（衣服？手机？）。需要回溯第3轮"我想看看卫衣"和第4轮"有蓝色吗"，才能推断意图=搜索红色卫衣
  conclusion: 意图识别 = 当前输入 + 对话历史 + 用户状态的三元组推理
follow_up:
- 对话状态追踪(DST)怎么做？用什么模型？
- 意图识别和槽位填充怎么联合训练？
- 开放域对话（闲聊）中怎么做意图识别？
memory_points:
- 三大盲区：单轮分类器搞不定省略句、指代消解与隐式意图
- 方案一：将最近 N 轮历史对话拼入 Prompt 供大模型综合识别
- 方案二：引入对话状态追踪 DST，持续更新实体与槽位状态
- 进阶机制：基于意图链推理，预测用户下一步动作以提前准备
---

# 主Agent的意图识别应该怎么做，为什么单轮分类器经常不够用？

## 单轮分类器的三大盲区

```
盲区1: 省略句（上下文依赖）
  轮1: "我想买一件卫衣"          → intent: search_product
  轮2: "有红色的吗"              → intent: ???
  单轮分类器: 看到"有红色的吗" → 可能分类为"询问颜色"
  正确意图: search_product(color=红色)  ← 依赖轮1的上下文

盲区2: 指代消解
  轮1: "推荐一款iPhone"          → intent: recommend
  轮2: "它支持5G吗"              → intent: ???
  单轮分类器: "它"是谁？无法确定
  正确意图: query_spec(product=iPhone, feature=5G)

盲区3: 隐式意图
  用户: "这个月话费好贵啊"        → intent: ???
  单轮分类器: 分类为"闲聊/抱怨"
  正确意图: recommend(cheap_plan)  ← 用户隐含希望推荐便宜套餐
```

## 多轮意图识别方案

### 方案一：上下文窗口拼接

```python
def intent_with_context(dialog_history: list, current_input: str):
    """将最近N轮对话拼入Prompt，让LLM做意图识别"""
    recent = dialog_history[-5:]  # 最近5轮

    prompt = f"""根据对话历史，识别用户当前意图。

对话历史：
{format_dialog(recent)}

当前输入：{current_input}

请输出：
1. 意图类别（从以下选择：search/recommend/query/order/refund/chat/other）
2. 关键实体和槽位
3. 是否为隐式意图（用户没明说但有明确需求）
"""
    return llm_call(prompt)
```

### 方案二：对话状态追踪（DST）

```python
class DialogStateTracker:
    """维护对话状态，支持指代消解和意图链"""

    def __init__(self):
        self.state = {
            'current_intent': None,
            'mentioned_entities': [],   # 对话中提到的实体
            'slots': {},                 # 已填充的槽位
            'intent_chain': [],          # 意图演变链
        }

    def update(self, user_input: str, llm_response: dict):
        # 1. 意图识别（结合当前状态）
        intent = self._classify_intent(user_input, self.state)

        # 2. 指代消解
        resolved_input = self._resolve_references(user_input, self.state)

        # 3. 槽位更新
        self.state['slots'].update(llm_response.get('slots', {}))

        # 4. 实体追踪
        entities = extract_entities(resolved_input)
        self.state['mentioned_entities'].extend(entities)

        # 5. 意图链
        self.state['intent_chain'].append(intent)
        self.state['current_intent'] = intent

        return resolved_input, intent
```

### 方案三：意图链推理

```python
# 用户可能在同一个目标下连续追问
INTENT_CHAINS = {
    'shopping': ['search', 'query_detail', 'compare', 'decide', 'order'],
    'support': ['describe_problem', 'provide_info', 'try_solution', 'feedback'],
}

def predict_next_intent(intent_chain: list) -> str:
    """根据意图链预测下一步可能意图，提前准备"""
    for chain_name, sequence in INTENT_CHAINS.items():
        # 模糊匹配当前意图链
        matched = match_sequence(intent_chain, sequence)
        if matched and len(matched) < len(sequence):
            return sequence[len(matched)]  # 预测下一个意图
    return 'unknown'
```

## 多意图处理

```python
def multi_intent_detection(user_input: str) -> list:
    """一句话包含多个意图时拆分处理"""
    intents = llm_parse(f"""
    用户输入：{user_input}
    
    请识别所有独立意图，输出JSON列表：
    示例输入："帮我查下快递，顺便推荐个手机壳"
    示例输出：[{{"intent": "query_logistics"}}, {{"intent": "recommend", "keyword": "手机壳"}}]
    """)
    return intents
```

## 面试加分点

1. **分级策略**：先轻量分类器做初筛（7B），低置信度再走LLM精判（32B），平衡延迟和准确率
2. **意图数据飞轮**：收集人工标注的意图数据持续微调分类器，形成闭环
3. **冷启动方案**：新意图类型出现时，先用LLM few-shot处理，积累数据后再训分类器
4. **意图冲突**：用户同时表达矛盾意图（"想买又觉得贵"），需要识别情绪+给出折中建议

## 记忆要点

- 三大盲区：单轮分类器搞不定省略句、指代消解与隐式意图
- 方案一：将最近 N 轮历史对话拼入 Prompt 供大模型综合识别
- 方案二：引入对话状态追踪 DST，持续更新实体与槽位状态
- 进阶机制：基于意图链推理，预测用户下一步动作以提前准备

