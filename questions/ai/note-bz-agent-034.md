---
id: note-bz-agent-034
difficulty: L3
category: ai
subcategory: Agent
tags:
  - B站面经
  - Skill
  - 工具命中率
feynman:
  essence: 工具多命中率低=LLM选不准。提升方法：工具分类索引+描述优化+RAG检索+few-shot示例+调用日志反馈学习。
  analogy: 像超市找商品——有清晰分区(分类)、商品标签(描述)、导购指引(检索)、你买过记住(反馈)，才能快速找到。
  first_principle: 命中率低是因为"选择空间大+描述不精准+上下文不足"。对症：缩小选择空间(检索)、提升描述质量、补充上下文(few-shot)。
  key_points:
    - 原因：选择空间大/描述不精/缺乏示例
    - 解法：分类索引+描述优化+RAG+few-shot+反馈学习
    - 评估：命中率=正确选择/总选择
    - 持续优化：调用日志分析+迭代
first_principle:
  essence: 工具命中率是信息检索准确率问题。
  derivation: '把"选对工具"看作检索问题：query=用户意图，doc=工具描述，目标=检索最相关的。提升检索准确率的标准方法（query改写/语义匹配/rerank/反馈）都适用。'
  conclusion: 提升命中率 = 工具描述质量 + 检索准确率 + 示例引导 + 持续反馈
follow_up:
  - 怎么评估命中率？——标注正确工具，统计LLM选择一致率
  - few-shot示例怎么构造？——从历史正确调用中提取
  - 命中率多少算合格？——简单任务>95%，复杂>80%
---

# Agent Skill/工具过多，如何提升命中率？

## 一、命中率低的根因分析

```
命中率 = 正确选中的工具 / 应该选的工具

低命中率原因：
  1. 选择空间太大（30个工具，LLM选晕）
  2. 工具描述不精准（描述模糊，LLM不确定）
  3. 相似工具混淆（query_order vs query_history）
  4. 缺少使用示例（LLM不知道什么场景用什么）
  5. 用户意图模糊（LLM理解错需求）
```

## 二、提升命中率的六种方法

### 方法 1：工具描述优化（基础）

```python
# 优化前：模糊
{"name": "search", "description": "搜索数据"}

# 优化后：精准+边界+示例
{"name": "search_order", "description": """
搜索订单。当用户提到'订单''购买记录''我的订单'时使用。
参数：keyword(可模糊匹配商品名/订单号)。
示例触发：'我上周买的手机''查下我的订单'
不要用于：查物流(用track)、退款(用refund)
"""}
```

### 方法 2：工具分类索引（缩小选择空间）

```python
# 建立工具索引，按类别组织
TOOL_INDEX = {
    "查询类": ["search_order", "search_product", "get_balance"],
    "操作类": ["create_order", "cancel_order", "pay"],
    "客服类": ["submit_complaint", "contact_human"],
}

def select_with_index(query):
    # 先判断用哪类
    category = llm.classify(f"用户'{query}'需要哪类工具: {list(TOOL_INDEX)}")
    # 只在该类里选（3-4个工具，命中率高）
    return llm.select_tool(query, TOOL_INDEX[category])
```

### 方法 3：RAG 检索工具（动态缩小）

```python
class ToolRAG:
    def __init__(self, tools):
        # 工具描述embedding建索引
        self.index = VectorIndex()
        for t in tools:
            self.index.add(embed(t.description), t)
    
    def retrieve(self, query, k=5):
        # 检索最相关的k个工具
        return self.index.search(embed(query), k=k)
```

### 方法 4：Few-shot 示例引导

```python
# 在工具列表后附上"什么意图选什么工具"的示例
TOOL_EXAMPLES = """
示例：
用户: "我的快递到哪了" → track_logistics
用户: "我要退那个手机" → refund
用户: "帮我看看余额" → get_balance
用户: "你好" → 无需工具
"""

# 这些示例帮LLM建立"意图→工具"的映射
```

### 方法 5：Rerank 精选

```python
def select_tool_with_rerank(query, tools):
    # 第1步：粗检索（召回top-10）
    candidates = tool_index.search(query, k=10)
    
    # 第2步：精排序（LLM从10个中选最好的）
    prompt = f"""
    用户意图: {query}
    候选工具: {[t.brief for t in candidates]}
    
    选出最合适的1个工具，或判断无需工具。
    """
    return llm.select(prompt)
```

### 方法 6：反馈学习（持续优化）

```python
class ToolSelectionLearner:
    """从调用日志中学习，持续优化"""
    
    def learn_from_log(self):
        """分析历史调用，发现模式"""
        logs = self.get_tool_call_logs()
        
        for log in logs:
            if log.was_correct:
                # 正确调用 → 提取为few-shot示例
                self.add_example(log.query, log.tool)
            else:
                # 错误调用 → 分析原因，优化描述
                self.improve_description(log.intended_tool, log.error)
        
        # 更新工具描述和示例库
        self.update_tool_prompts()
```

## 三、综合应用

```python
class HighAccuracyToolSelector:
    """组合多种方法，最大化命中率"""
    
    def select(self, query, context):
        # 1. RAG检索候选（缩小到top-5）
        candidates = self.rag.retrieve(query, k=5)
        
        # 2. 加入few-shot示例
        examples = self.get_relevant_examples(query)
        
        # 3. LLM精选
        selected = self.llm.select(
            query=query,
            tools=candidates,
            examples=examples,
            context=context
        )
        
        # 4. 置信度检查
        if selected.confidence < 0.7:
            return {"action": "clarify", "question": "您是想...还是...？"}
        
        # 5. 记录（用于反馈学习）
        self.log(query, selected)
        
        return selected
```

## 四、命中率评估

```python
def evaluate_hit_rate(test_cases):
    """
    test_cases: [{query, correct_tool}, ...]
    """
    correct = 0
    for case in test_cases:
        predicted = tool_selector.select(case.query)
        if predicted.tool == case.correct_tool:
            correct += 1
        else:
            # 分析错误原因
            log_error(case, predicted)
    
    return correct / len(test_cases)

# 目标：简单意图>95%，复杂>80%
```

## 五、面试加分点

1. **当成检索问题**：工具选择本质是信息检索，IR 的方法（召回+排序+反馈）都适用
2. **组合拳**：单一方法效果有限，描述优化+RAG+few-shot+反馈组合最优
3. **持续学习**：从调用日志中学习是最被忽略但最有效的——工具命中率会随使用越来越好
