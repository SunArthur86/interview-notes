---
id: note-bz-agent-037
difficulty: L3
category: ai
subcategory: Agent
tags:
  - B站面经
  - Skill
  - 渐进式披露
  - Progressive Disclosure
feynman:
  essence: 渐进式披露=不一开始把所有信息塞给LLM，而是按需逐步展示。像剥洋葱——先用概述判断方向，需要细节时再深入，控制上下文长度。
  analogy: 像查百科——先看目录(概述)，找到相关章节再看摘要，确实需要才读全文。而非一开始把整本书塞给你。
  first_principle: LLM上下文有限，信息过多会稀释注意力。按需加载相关内容，既省token又提准确率。
  key_points:
    - 核心：按需加载，非全量展示
    - 层次：概述→摘要→全文
    - 价值：省token+提准确率+降延迟
    - 应用：工具/Skill/记忆/RAG
first_principle:
  essence: 信息展示应匹配当前需求——给多了浪费且干扰，给少了不够用。
  derivation: 'LLM注意力是稀缺资源。一次性展示所有信息，关键信息被淹没。按任务的当前阶段，只展示必要的，减少噪音、聚焦关键。'
  conclusion: 渐进式披露 = 按需展示（匹配当前需求的信息粒度）
follow_up:
  - 什么时候披露更多？——LLM判断信息不足时主动请求
  - 怎么分层？——概述(L1)/摘要(L2)/详情(L3)
  - 和RAG什么关系？——RAG是一种披露方式（检索即披露）
---

# 什么是渐进式披露（Progressive Disclosure）？

## 一、核心思想

```
传统做法（一次性全给）：
  给LLM: 所有文档全文 + 所有工具描述 + 完整记忆
  问题：上下文爆炸 + 关键信息被稀释 + 成本高

渐进式披露（按需给）：
  Level 1: 给概述（工具一句话描述）
       ↓ LLM判断需要哪个
  Level 2: 给摘要（选中工具的详细描述）
       ↓ LLM决定调用
  Level 3: 给详情（执行时的完整文档）
  
  每一层只展示必要信息，按需深入
```

## 二、三层披露模型

```
┌──────────────────────────────────────────────┐
│  Level 1: 概述层（Always visible）             │
│    工具名 + 一句话功能                         │
│    Token: ~50/工具                            │
│    作用：让LLM知道"有什么能力"                  │
│    示例: "web_search: 搜索互联网"              │
├──────────────────────────────────────────────┤
│  Level 2: 详情层（On demand）                  │
│    完整描述 + 参数schema + 使用示例             │
│    Token: ~200/工具                           │
│    作用：让LLM知道"怎么用"                     │
│    触发：LLM从L1选中后展开                     │
├──────────────────────────────────────────────┤
│  Level 3: 全文层（Just-in-time）               │
│    完整文档 + 所有示例 + 边界case               │
│    Token: ~1000+/工具                         │
│    作用：让LLM"精通使用"                       │
│    触发：复杂场景/LLM主动请求                   │
└──────────────────────────────────────────────┘
```

## 三、应用场景

### 场景 1：工具披露

```python
class ProgressiveToolDisclosure:
    def get_tools(self, query, level="L1"):
        if level == "L1":
            # 只给工具名+一句话（让LLM选）
            return [{"name": t.name, "brief": t.one_liner} 
                    for t in self.tools]
        elif level == "L2":
            # LLM选中后，给详细描述
            return [{"name": t.name, "description": t.full_desc,
                     "parameters": t.schema}
                    for t in self.selected_tools]
        elif level == "L3":
            # 执行时，给完整文档
            return self.tools[name].full_documentation
```

### 场景 2：记忆/RAG 披露

```python
class ProgressiveRAG:
    def retrieve(self, query):
        # L1: 先返回文档标题列表
        titles = self.get_titles(query)
        # "相关文档: [A概述, B概述, C概述]"
        
        # L2: LLM选中感兴趣的，返回摘要
        summary = self.get_summary(selected_doc)
        
        # L3: 确实需要细节，返回相关段落
        passage = self.get_passage(doc, query)
```

### 场景 3：Skill 披露

```
Agent有很多Skill，怎么让LLM知道用哪个？

L1: Skill索引（始终可见）
    "可用技能: 调研/写代码/做图表/翻译..."
    
L2: Skill详情（选中后）
    "调研技能: 用于技术调研，需要search+read工具"
    
L3: Skill完整指令（执行时）
    完整的prompt + 流程 + 示例
```

## 四、实现机制

```python
class ProgressiveDisclosureSystem:
    def __init__(self):
        self.layers = {}  # 信息分层存储
    
    def serve(self, query, current_context):
        """根据当前需求，提供合适层级的信息"""
        
        # 判断当前需要哪个层级
        needed_level = self.assess_needs(query, current_context)
        
        if needed_level == "overview":
            # 信息充足，给概述即可
            return self.get_overview(query)
        
        elif needed_level == "detail":
            # 需要细节，展开
            return self.get_detail(query, focus=self.identify_focus(query))
        
        elif needed_level == "full":
            # 需要全部
            return self.get_full(query)
    
    def assess_needs(self, query, context):
        """评估当前需要哪个层级"""
        if context.has_seen_overview:
            if context.needs_detail:
                return "detail"
            return "overview"
        return "overview"
```

## 五、价值

```
┌──────────────┬──────────────────┬──────────────────────┐
│ 维度          │ 全量展示            │ 渐进式披露             │
├──────────────┼──────────────────┼──────────────────────┤
│ Token成本    │ 高（全给）          │ 低（按需）             │
│ 准确率       │ 中（信息多易稀释）  │ 高（聚焦关键）         │
│ 延迟         │ 高（处理大量token） │ 低（处理少量）         │
│ 可扩展性     │ 差（工具多就爆）    │ 好（始终可控）         │
└──────────────┴──────────────────┴──────────────────────┘

特别适合：
  - 工具/Skill数量多（20+）
  - 文档库大（RAG）
  - 长期记忆丰富
```

## 六、面试加分点

1. **"剥洋葱"类比**：从概述到详情逐层深入，形象易懂
2. **核心是"匹配需求"**：不是藏信息，而是给当前最需要的粒度
3. **解决规模化问题**：工具/记忆越多，渐进式披露越重要——这是 Agent 规模化的关键
