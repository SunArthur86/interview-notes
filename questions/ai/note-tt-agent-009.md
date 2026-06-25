---
id: note-tt-agent-009
difficulty: L3
category: ai
subcategory: Agent
tags:
  - 淘天
  - 面经
  - 二面
  - Workflow
  - Agent选型
  - 架构设计
feynman:
  essence: Workflow是固定流程（确定性高、可控），Agent是自主决策（灵活但不可控）。标准化高频场景用Workflow，复杂多变场景用Agent
  analogy: 就像流水线 vs 高级技工——流水线（Workflow）固定流程效率高但不能处理意外，高级技工（Agent）能随机应变但成本高且需要监督
  first_principle: 确定性和灵活性是Trade-off。Workflow牺牲灵活性换取确定性（每步可预测），Agent牺牲确定性换取灵活性（能处理未见过的场景）
  key_points:
    - Workflow：预定义DAG，节点固定，流程可预测
    - Agent：动态规划，自主决策路径，能处理异常
    - 选Workflow：流程标准化、高频重复、合规要求高
    - 选Agent：输入多变、需灵活决策、探索性任务
    - 混合模式：Workflow做骨架，Agent处理异常分支
first_principle:
  essence: 系统的确定性应与业务场景的标准化程度匹配
  derivation: '客服场景中80%是标准问题（退货流程固定），20%是复杂问题（需多轮沟通判断）。对80%用Workflow（成本低、可控），对20%用Agent（灵活但贵）。全用Agent会浪费80%场景的成本'
  conclusion: 选型原则 = 标准化程度×频率 决定Workflow占比，复杂度×不确定性 决定Agent占比
follow_up:
  - Workflow和Agent混合架构怎么做？什么节点该固定什么该灵活？
  - 如何评估一个场景是否值得从Workflow升级为Agent？
  - Agent的"自主决策"边界怎么界定？防止Agent乱跑？
---

# Workflow固定工作流和自主决策Agent怎么区分？什么场景选Workflow、什么必须自研Agent？

## 核心区别

```
Workflow（固定工作流）              Agent（自主决策）
┌─────┐                            ┌─────┐
│ 输入 │                            │ 输入 │
└──┬──┘                            └──┬──┘
   │                                  │
   ▼                                  ▼
┌─────┐  ┌─────┐  ┌─────┐      ┌──────────┐
│ 步骤A│→ │ 步骤B│→ │ 步骤C│      │  规划器   │←── LLM决策
│ 固定 │  │ 固定 │  │ 固定 │      │ Planner  │
└─────┘  └─────┘  └─────┘      └────┬─────┘
   │                                  │ 自主选择路径
   ▼                                  ▼
┌─────┐                          ┌─────┐ 或 ┌─────┐
│ 输出 │                          │ 步骤A│    │ 步骤C│
└─────┘                          └─────┘    └─────┘
                                     │          │
                                     └────┬─────┘
                                          ▼
                                     ┌──────────┐
                                     │  反思器   │── 不满意? 重新规划
                                     └────┬─────┘
                                          ▼
                                     ┌─────┐
                                     │ 输出 │
                                     └─────┘
确定性: ✅ 高                          确定性: ❌ 低
灵活性: ❌ 低                          灵活性: ✅ 高
成本: 💰 低                           成本: 💰💰💰 高
```

## 选型决策矩阵

| 维度 | Workflow | Agent | 判断依据 |
|------|----------|-------|---------|
| **流程标准化** | ✅ 步骤固定 | ❌ 步骤动态 | 能否预先列出所有步骤？ |
| **输入可变性** | 低（格式固定） | 高（自然语言多变） | 输入是否结构化？ |
| **合规要求** | ✅ 可审计 | ❌ 难以预测 | 是否需要每步留痕？ |
| **错误成本** | 低（可回滚） | 高（可能越跑越偏） | 错误后能否撤销？ |
| **频率** | ✅ 高频重复 | ❌ 低频复杂 | 量级是否支持自定义开发？ |
| **延迟要求** | ✅ 低延迟 | ❌ 多轮LLM调用 | 用户能等多久？ |

## 场景选型示例

```python
SCENARIOS = {
    # ✅ Workflow场景
    "退货处理": {
        "type": "workflow",
        "reason": "流程固定：申请→审核→取件→退款，90%+标准化",
        "steps": ["validate_order", "check_policy", "arrange_pickup", "process_refund"],
    },

    # ✅ Agent场景
    "客诉处理": {
        "type": "agent",
        "reason": "每条客诉不同，需理解情绪、判断严重度、灵活应对",
        "capabilities": ["intent_recognition", "emotion_analysis", "dynamic_response"],
    },

    # ✅ 混合场景
    "商品推荐": {
        "type": "hybrid",
        "workflow_part": "召回→过滤→排序",  # 固定流程
        "agent_part": "理解用户意图+个性化解释",  # 灵活决策
    },
}
```

## 混合架构设计

```
用户请求
    │
    ▼
┌──────────┐
│ 路由判断   │── 标准问题 ──→ Workflow（80%流量）
│ Router    │── 复杂问题 ──→ Agent（20%流量）
└──────────┘

Workflow路径（快速、低成本）：
  固定步骤A → B → C → 输出
  ⚠️ 如果执行中检测到异常 → 转交Agent处理

Agent路径（灵活、高成本）：
  Planner规划 → Executor执行 → Reflector检查
  ⚠️ 如果能匹配到标准流程 → 降级为Workflow
```

## 面试加分点

1. **成本量化**：Workflow每请求~0.01元（固定API调用），Agent每请求~0.5元（3-5轮LLM），50倍差距
2. **渐进式架构**：先用Workflow跑通主流程，遇到瓶颈再逐步引入Agent处理异常分支
3. **监控指标**：Workflow看成功率/延迟，Agent看完成率/平均轮数/成本/用户满意度
4. **Anthropic的建议**："能用Workflow就别用Agent"——Workflow可控性远高于Agent
