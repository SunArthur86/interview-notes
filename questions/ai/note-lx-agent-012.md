---
id: note-lx-agent-012
difficulty: L4
category: ai
subcategory: Agent
tags:
  - 联想
  - 面经
  - 一面
  - Skill
  - 渐进式披露
  - Agent稳定性
feynman:
  essence: 渐进式披露是按需加载Skill信息——初始只给模型工具名和简介，使用时再展开完整Schema和示例。减少上下文Token占用，避免信息过载导致模型"选择困难"
  analogy: 就像APP商店——不会把所有APP的说明书都塞给你（全量披露），而是先显示图标和一句话简介（一级披露），点进去看功能列表（二级），再看详细教程（三级）
  first_principle: 模型的注意力是有限资源。上下文中工具描述越多，每个工具获得的注意力越少，选择准确率下降。渐进式披露通过分层减少注意力分散
  key_points:
    - 一级披露：工具名+一句话描述（常驻上下文）
    - 二级披露：参数Schema+使用约束（按需展开）
    - 三级披露：Few-shot示例+边界case（使用时注入）
    - 减少常驻Token：100个工具从50K Token降至5K Token
first_principle:
  essence: 信息过载导致决策质量下降（Choice Paradox）
  derivation: '设上下文窗口128K，100个工具全量Schema占50K（39%），留给对话的空间只剩78K。模型需要在100个工具中选择，选择准确率随工具数量对数下降。渐进式披露后常驻只需5K（4%），选择范围通过预筛选缩小到5个'
  conclusion: 渐进式披露 = 分层加载 + 按需展开 + 预筛选，核心是减少注意力分散
follow_up:
  - 如何做工具预筛选？用embedding还是关键词匹配？
  - 渐进式披露增加的延迟（多一轮LLM调用）怎么平衡？
  - 1000+工具场景下，渐进式披露的效果有多大提升？
---

# Skill的渐进式披露是什么意思，为什么它能提升Agent的稳定性？

## 全量披露 vs 渐进式披露

```
全量披露（传统方式）：
┌──────────────────────────────────────┐
│ 上下文 = System Prompt + 全部工具定义   │
│                                        │
│ 工具1: search_products (完整Schema)    │  ← 800 Token
│ 工具2: place_order (完整Schema)        │  ← 600 Token
│ 工具3: process_refund (完整Schema)     │  ← 500 Token
│ ...                                    │
│ 工具100: export_report (完整Schema)    │  ← 400 Token
│                                        │
│ 总计: 50,000 Token（占窗口39%）        │
│                                        │
│ 问题：                                 │
│ ❌ 上下文被工具定义占满，对话空间不足   │
│ ❌ 100个工具选择困难，准确率下降        │
│ ❌ 模型被无关工具描述干扰               │
└──────────────────────────────────────┘

渐进式披露（分层加载）：
┌──────────────────────────────────────┐
│ Level 1: 常驻上下文（仅工具名+简介）    │
│   "search_products: 搜索商品"          │  ← 20 Token
│   "place_order: 下单购买"              │  ← 15 Token
│   "process_refund: 退款处理"           │  ← 15 Token
│   ...100个工具                          │
│   总计: 2,000 Token（占窗口1.6%）     │
└───────────────┬──────────────────────┘
                │ 模型选择search_products
                ▼
┌──────────────────────────────────────┐
│ Level 2: 按需展开（选中工具的完整Schema）│
│   search_products完整参数定义+约束     │  ← 800 Token
│   总计: 仅+800 Token                  │
└──────────────────────────────────────┘
```

## 实现架构

```python
class ProgressiveSkillDisclosure:
    """三级渐进式披露系统"""

    def __init__(self):
        # Level 1: 常驻摘要（所有工具的一句话描述）
        self.skill_summaries = {}
        # Level 2: 完整Schema（按需加载）
        self.skill_schemas = {}
        # Level 3: 使用示例（执行时注入）
        self.skill_examples = {}

    def build_context(self, available_skills: list, user_input: str) -> dict:
        """构建分层上下文"""

        # Step 1: 预筛选（从100个工具中选Top-5最相关的）
        top_skills = self._pre_filter(available_skills, user_input, k=5)

        # Step 2: 构建分层上下文
        context = {
            # Level 1: 所有工具的摘要（常驻）
            'skill_menu': [
                f"- {s['name']}: {s['brief']}"
                for s in available_skills
            ],  # ~2000 Token

            # Level 2: 预筛选工具的完整Schema
            'skill_details': [
                self.skill_schemas[s] for s in top_skills
            ],  # ~4000 Token（5个×800）

            # Level 3: 暂不加载，执行时再注入
        }
        return context

    def _pre_filter(self, skills: list, query: str, k: int = 5) -> list:
        """用embedding预筛选最相关的k个工具"""
        query_emb = embed(query)
        skill_embs = [embed(s['brief']) for s in skills]
        scores = cosine_similarity(query_emb, skill_embs)
        # 取Top-K
        top_indices = np.argsort(scores)[-k:]
        return [skills[i] for i in top_indices]
```

## 稳定性提升机制

```python
async def execute_with_progressive_disclosure(
    self, user_input: str, skills: list
):
    """渐进式披露执行流程"""

    # Round 1: 从工具菜单中选择（Level 1→2）
    selected = await self.llm_call(
        prompt=f"""用户需求：{user_input}

可用工具：
{self._format_menu(skills)}

请选择最合适的工具（1-3个），返回工具名："""
    )

    # Round 2: 用选中工具的完整Schema执行（Level 2→3）
    for skill_name in selected:
        schema = self.skill_schemas[skill_name]
        examples = self.skill_examples.get(skill_name, [])

        result = await self.llm_call(
            prompt=f"""使用工具 {skill_name} 完成任务。

工具定义：
{json.dumps(schema, ensure_ascii=False)}

使用示例：
{examples}

用户需求：{user_input}

请生成工具调用参数：""",
            tools=[schema]  # 只传入选中的工具
        )

    return result
```

## 效果对比

| 指标 | 全量披露 | 渐进式披露 | 提升 |
|------|---------|-----------|------|
| 常驻Token | 50,000 | 2,000 | -96% |
| 工具选择准确率 | 72% | 91% | +19% |
| 参数生成准确率 | 85% | 93% | +8% |
| 平均延迟 | 3.2s | 3.8s | +0.6s（多一轮） |
| 幻觉工具调用 | 8% | 1.5% | -81% |

## 面试加分点

1. **多轮权衡**：渐进式披露增加一轮LLM调用（+0.6s延迟），但准确率提升省去了后续重试成本，总延迟反而可能更低
2. **预筛选优化**：用轻量embedding模型做预筛选（~10ms），不需要大模型参与
3. **动态K值**：简单需求预筛选Top-3，复杂需求Top-8，动态调整而非固定
4. **Claude Code的实践**：Claude Code的Skill系统就是渐进式披露的典型案例——SKILL.md先给摘要，使用时才加载完整内容
