---
id: note-bz-agent-033
difficulty: L3
category: ai
subcategory: Agent
tags:
  - B站面经
  - 工具管理
  - Tool Use
feynman:
  essence: 给Agent 30+工具可以，但有风险：选不准（描述太长LLM混淆）、成本高（token多）、误调用（相似工具混淆）。解法是工具检索(RAG选子集)+分层管理+工具路由。
  analogy: 像给新员工一把工具箱——工具太多他不知道用哪个。好做法是按场景分组，用到哪组拿哪组。
  first_principle: LLM注意力有限，工具越多选择准确率越降（选择困难症）。且工具描述占用token，成本线性增长。
  key_points:
    - 风险：选不准/成本高/误调用/上下文膨胀
    - 解法：RAG检索工具+分层分组+动态加载
    - 原则：只给当前任务相关的工具
    - 极限：50个以内可管理，100+必须检索
first_principle:
  essence: 工具数量与选择准确率呈反比——选择过多导致决策质量下降。
  derivation: 'LLM在N个工具中选对的概率随N增大而降（类似人类选择困难）。且每个工具描述占token，30个工具描述可能占2000+token，挤占有效上下文。'
  conclusion: 多工具管理 = 按需检索（只给相关的） + 分层分组（降低选择空间）
follow_up:
  - 工具检索怎么实现？——工具描述向量化，用RAG召回top-k
  - 多少工具开始需要检索？——>10个就建议检索
  - 工具有相似功能怎么办？——合并/明确区分条件
---

# 能不能直接给 Agent 30 个以上的工具？有什么风险？

## 一、给 30+ 工具的四大风险

```
┌──────────────────────────────────────────────┐
│  风险1：选择准确率下降                          │
│    30个工具，LLM"选择困难症"                    │
│    相似工具（query_order vs query_log）易混淆   │
│    研究：工具>10个，准确率开始显著下降          │
├──────────────────────────────────────────────┤
│  风险2：Token成本激增                          │
│    每个工具描述~100token                       │
│    30个工具=3000token/轮                       │
│    每轮多花3000token，长对话成本翻倍            │
├──────────────────────────────────────────────┤
│  风险3：上下文稀释                             │
│    工具描述占满上下文，挤占用户对话空间          │
│    重要信息被工具描述"淹没"                      │
├──────────────────────────────────────────────┤
│  风险4：误调用高风险工具                        │
│    工具多时LLM可能误选delete而非query           │
│    高危工具（删除/支付）被误触发                 │
└──────────────────────────────────────────────┘
```

## 二、解决方案：工具检索（Tool RAG）

```python
class ToolRetriever:
    """按需检索工具，只给LLM相关的子集"""
    
    def __init__(self, all_tools):
        self.tools = all_tools
        # 预计算所有工具描述的embedding
        self.tool_embeddings = {
            t.name: embed(t.description) for t in all_tools
        }
    
    def select(self, user_query, top_k=5):
        """根据用户查询检索最相关的工具"""
        query_emb = embed(user_query)
        
        # 计算相似度
        scores = {
            name: cosine_sim(query_emb, emb)
            for name, emb in self.tool_embeddings.items()
        }
        
        # 返回top-k最相关的工具
        relevant = sorted(scores, key=scores.get, reverse=True)[:top_k]
        return [self.tools[name] for name in relevant]

# 使用：从30个工具中选出5个最相关的
relevant_tools = tool_retriever.select("我要查订单物流", top_k=5)
# 只把这5个工具的描述给LLM
```

## 三、解决方案：工具分层分组

```python
# 按业务域分组，先选组再选工具
TOOL_CATEGORIES = {
    "订单管理": {
        "description": "订单查询、修改、退款相关",
        "tools": ["query_order", "cancel_order", "refund", "track_logistics"]
    },
    "用户管理": {
        "description": "用户信息、地址、偏好相关",
        "tools": ["get_profile", "update_address", "set_preference"]
    },
    "支付": {
        "description": "支付、充值、提现相关",
        "tools": ["pay", "recharge", "withdraw"]
    },
    # ... 每组4-6个工具
}

class HierarchicalToolSelector:
    def select(self, query):
        # 第一层：选类别（4个类别描述，token少）
        category = self.llm.select_category(query, TOOL_CATEGORIES)
        
        # 第二层：在选中类别内选工具（4-6个，准确率高）
        tools = TOOL_CATEGORIES[category]["tools"]
        selected = self.llm.select_tool(query, tools)
        
        return selected
```

## 四、解决方案：动态加载

```python
class DynamicToolManager:
    """根据对话上下文动态加载工具"""
    
    def get_tools_for_context(self, session_state):
        """基于会话状态判断需要哪些工具"""
        
        # 用户在讨论订单 → 加载订单相关工具
        if session_state.current_topic == "order":
            return self.load_tools(["query_order", "refund", ...])
        
        # 用户在闲聊 → 不需要工具
        if session_state.current_topic == "chat":
            return []
        
        # 默认：加载最常用的基础工具
        return self.load_tools(["search", "get_time"])
```

## 五、工具治理最佳实践

```
┌──────────────────────────────────────────────┐
│              多工具治理原则                      │
├──────────────────────────────────────────────┤
│                                                │
│  1. 描述优化（降数量感）                         │
│     - 合并相似工具（query_order + query_log）   │
│     - 用"何时用/何时不用"明确边界                │
│     - 描述尽量简短但精准                         │
│                                                │
│  2. 分层加载（降同时可见数）                     │
│     - 基础工具常驻（search, get_time）          │
│     - 业务工具按上下文动态加载                   │
│     - 高危工具默认隐藏，需显式激活               │
│                                                │
│  3. 检索增强（降选择难度）                       │
│     - 工具描述向量化                            │
│     - 用户查询时检索top-5相关工具               │
│     - 只把相关的给LLM                           │
│                                                │
│  4. 校验兜底（防误调用）                        │
│     - 高危工具二次确认                          │
│     - 参数校验+权限检查                         │
│     - 异常调用告警                              │
│                                                │
└──────────────────────────────────────────────┘
```

## 六、不同规模的推荐策略

| 工具数量 | 策略 | 说明 |
|---------|------|------|
| 1-5 | 全量给LLM | 描述少，直接选 |
| 5-10 | 全量+清晰描述 | 注意描述质量 |
| 10-20 | 分组+类别路由 | 先选组再选工具 |
| 20-50 | 工具RAG检索 | 按需召回子集 |
| 50+ | 多层检索+动态加载 | 必须分层管理 |

## 七、面试加分点

1. **不是"能不能"而是"怎么管理"**：30+工具可以用，但必须有检索/分层机制
2. **强调"选择困难症"**：LLM 和人一样，选择越多准确率越低
3. **工具 RAG**：这是解决多工具的核心方案，把工具检索当 RAG 做
