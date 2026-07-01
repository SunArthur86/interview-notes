---
id: note-bz-agent-031
difficulty: L3
category: ai
subcategory: Agent
tags:
- B站面经
- 工具选择
- Tool Use
- 意图决策
feynman:
  essence: Agent选工具=意图理解+工具匹配+决策校验。LLM基于用户意图和工具描述做语义匹配，关键是工具描述清晰+提供few-shot示例+决策后校验。
  analogy: 像医生开药——先诊断(意图理解)，再从药柜选药(工具匹配)，最后核对(校验)。
  first_principle: 工具选择本质是"需求与能力的语义匹配"。LLM理解用户要什么，再匹配工具能做什么。
  key_points:
  - 核心：意图理解+工具描述匹配+决策校验
  - 工具描述要清晰（何时用/怎么用/参数）
  - few-shot示例提升准确率
  - 多工具时用RAG检索工具
first_principle:
  essence: 工具选择是分类/检索问题——把用户意图映射到正确的工具。
  derivation: 少量工具：LLM看描述直接选（分类）。大量工具：先检索相关工具子集再选（检索+分类）。准确率取决于描述质量和模型能力。
  conclusion: 工具选择 = 意图理解（要什么） + 工具匹配（有什么） + 校验（对不对）
follow_up:
- 工具选错怎么办？——校验层拦截+错误反馈重选+人工兜底
- 怎么提升准确率？——清晰描述+few-shot+工具分组
- 30+工具怎么选？——RAG检索工具子集，而非全塞给LLM
memory_points:
- 核心结论：工具选不准，90%是因为工具描述（能力+触发+反例）写得模糊不清
- 应对多工具：使用RAG检索机制，先向量召回最相关的Top-K工具子集再给LLM
- 决策校验防误选：执行前必须检查意图匹配度、必填参数是否齐全及合法
- 低置信度处理：显式分析意图，置信度不足时宁可向用户追问，绝不乱猜
---

# Agent 怎么选工具？如何确保意图决策正确、选中合适工具？

## 一、工具选择的流程

```
用户输入 → 意图理解 → 工具匹配 → 决策校验 → 执行
            ↑            ↑          ↑
         LLM理解      语义匹配    合理性检查
         用户要什么   匹配工具描述  防止误选
```

## 二、工具描述的关键

```python
# 好的 vs 坏的工具描述
BAD = {
    "name": "search",
    "description": "搜索功能"  # 太模糊，LLM不知道何时用
}

GOOD = {
    "name": "web_search",
    "description": """搜索互联网获取实时信息。
    使用场景：用户问最新新闻/天气/股价/时事时。
    不使用：用户问常识/历史/定义时（这些模型知道）。
    参数：q(搜索词，用关键词而非整句)""",
    "parameters": {"q": {"type": "string", "description": "搜索关键词"}}
}
# 关键：说清"何时用"、"何时不用"、"参数怎么填"
```

## 三、确保选中正确工具的手段

### 1. 清晰的工具描述（基础）

```python
# 每个工具描述包含：能力 + 触发条件 + 反例
TOOL_PROMPT = """
可用工具：

1. query_order
   功能：查询订单物流状态
   用：用户问"我的订单""到哪了""物流"
   参数：order_id（订单号）

2. refund
   功能：发起退款
   用：用户明确要求退款/退货
   不用：用户只是抱怨，需先确认是否要退款
   参数：order_id, reason
"""
```

### 2. Few-shot 示例

```python
# 给LLM看"什么意图该选什么工具"的例子
EXAMPLES = [
    {"input": "我的快递到哪了", "tool": "query_order", "args": {"order_id": "?"}},
    {"input": "我要退款", "tool": "refund", "args": {"order_id": "?", "reason": "?"}},
    {"input": "你好", "tool": "none", "args": {}},  # 闲聊不调工具
]
```

### 3. 决策校验（防误选）

```python
def validate_tool_choice(choice, user_intent):
    """校验工具选择是否合理"""
    checks = [
        # 工具能力是否匹配意图
        intent_matches_tool(user_intent, choice.tool),
        # 参数是否齐全
        all_required_params_present(choice),
        # 参数值是否合法
        validate_param_values(choice.args),
    ]
    if not all(checks):
        return {"valid": False, "reason": "..."}
    return {"valid": True}
```

### 4. 多工具时：RAG 检索工具

```python
# 工具多时，先检索相关工具子集
def select_tools(user_query, all_tools):
    # 把工具描述向量化
    tool_embeddings = {t: embed(t.description) for t in all_tools}
    query_emb = embed(user_query)
    
    # 检索top-k最相关的工具
    relevant = top_k_by_similarity(query_emb, tool_embeddings, k=5)
    
    # 只把相关的5个工具给LLM选（而非全部30个）
    return relevant
```

## 四、意图理解增强

```python
class IntentAnalyzer:
    def analyze(self, user_message):
        """显式的意图分析，而非让LLM隐式判断"""
        intent = self.llm.analyze(f"""
        分析用户意图：
        消息: {user_message}
        
        返回：
        - primary_intent: 主要意图（查信息/操作/闲聊/投诉）
        - required_action: 需要什么动作（查询/修改/创建/删除）
        - entities: 关键实体（订单号/产品名/时间）
        - confidence: 置信度
        """)
        
        if intent.confidence < 0.6:
            # 低置信度，追问而非乱猜
            return {"action": "clarify", "question": "您是想查询还是...？"}
        return intent
```

## 五、面试加分点

1. **描述质量是基础**：工具选不准，90%是描述没写好——这是最容易被忽略的
2. **RAG 选工具**：工具多时先检索子集再让 LLM 选，而非全塞
3. **校验+追问**：低置信度时主动追问比乱选工具更可靠

## 记忆要点

- 核心结论：工具选不准，90%是因为工具描述（能力+触发+反例）写得模糊不清
- 应对多工具：使用RAG检索机制，先向量召回最相关的Top-K工具子集再给LLM
- 决策校验防误选：执行前必须检查意图匹配度、必填参数是否齐全及合法
- 低置信度处理：显式分析意图，置信度不足时宁可向用户追问，绝不乱猜

