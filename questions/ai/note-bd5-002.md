---
id: note-bd5-002
difficulty: L3
category: ai
subcategory: Agent
tags:
  - 字节
  - 面经
  - MCP
  - Skills
  - Agent
feynman:
  essence: "Rules是全局行为约束(永远生效)，Skills是可调用的能力模块(按需执行)；不合并因为关注点不同——Rules管行为边界，Skills管能力执行"
  analogy: "Rules像交通法规(红灯停绿灯行，永远生效)；Skills像开车技能(需要时才用)。你不会把'红灯停'写进'如何开车'的说明书里——法规和技能是两个层次"
  first_principle: "Agent系统需要两层控制：行为约束(Rules)和能力扩展(Skills)，分层解耦才能独立演进"
  key_points:
    - 'Rules: 系统级约束，不可违反(安全/合规/格式)'
    - 'Skills: 工具能力，按需调用(搜索/计算/生成)'
    - 'MCP: 标准化工具协议，统一Skills的注册和调用'
    - 'Instructions: 最高层prompt，定义Agent角色和目标'
first_principle:
  essence: "分层控制 = 策略层(Instructions) + 约束层(Rules) + 能力层(Skills) + 协议层(MCP)"
  derivation: "Agent需要知道目标 → Instructions → 需要知道边界 → Rules → 需要有能力 → Skills → 需要标准接口 → MCP → 四层缺一不可"
  conclusion: "不合并Rules和Skills因为它们的生命周期、更新频率、影响范围完全不同"
follow_up:
  - "MCP协议的核心设计是什么？"
  - "Skill版本管理怎么做？"
  - "Rules冲突怎么解决？"
---

# Rules 和 Skills 有什么区别？为什么不把 Skills 的指导写进 Rules？

## Agent 四层架构

```
┌──────────────────────────────────────────────┐
│  Layer 1: Instructions (指令层)               │
│  "你是一个本地生活助手，帮助用户找餐厅订座"    │
│  → 定义角色、目标、语气                        │
├──────────────────────────────────────────────┤
│  Layer 2: Rules (规则层)                      │
│  "不能推荐竞品平台"                            │
│  "价格信息必须来自实时API，不能编造"           │
│  "用户隐私数据不写入日志"                      │
│  → 全局约束，永远生效，不可违反                │
├──────────────────────────────────────────────┤
│  Layer 3: Skills/MCP (能力层)                 │
│  search_restaurant, book_table, get_reviews   │
│  → 可调用的工具，按需执行                     │
├──────────────────────────────────────────────┤
│  Layer 4: MCP Protocol (协议层)               │
│  统一的Tool注册/发现/调用协议                  │
│  → 标准化接口，解耦工具实现                   │
└──────────────────────────────────────────────┘
```

## Rules vs Skills 核心区别

| 维度 | Rules | Skills |
|------|-------|--------|
| **本质** | 行为约束(Constraint) | 能力执行(Capability) |
| **生命周期** | 永久生效 | 按需调用 |
| **影响范围** | 全局(所有步骤) | 局部(调用时) |
| **更新频率** | 低(合规要求稳定) | 高(新工具不断添加) |
| **失败处理** | 违反=严重错误 | 失败=降级或重试 |
| **来源** | 产品/法务/安全 | 开发团队 |
| **类比** | 交通法规 | 开车技能 |

## 为什么不合并

```python
# ❌ 合并的问题: 把Skill指导写进Rules
RULES = """
1. 不能推荐竞品平台              # ← 这是Rule
2. 价格必须来自实时API           # ← 这是Rule
3. 搜索餐厅时调用search_restaurant,
   参数: location必填, cuisine可选,
   返回JSON格式的餐厅列表         # ← 这是Skill说明!
4. 订座时调用book_table,
   参数: restaurant_id, time    # ← 这是Skill说明!
"""

# 问题:
# 1. 膨胀: Rules越来越长, 挤占context window
# 2. 耦合: 每次加新工具都要改Rules
# 3. 冲突: Rule说"不能编造价格", Skill说"调用API获取价格" → 重叠
# 4. 更新不同步: 工具改了API但Rules没更新 → 调用失败

# ✅ 分离: Rules管约束, Skills管能力
RULES = """
1. 不能推荐竞品平台
2. 价格信息必须来自实时API，不能编造
3. 用户隐私数据不写入日志
4. 任何工具调用失败时，降级处理而非崩溃
"""

SKILLS = {
    "search_restaurant": {
        "description": "搜索餐厅",
        "params": {"location": "required", "cuisine": "optional"},
        "returns": "JSON array of restaurants"
    },
    "book_table": {
        "description": "预订座位",
        "params": {"restaurant_id": "required", "time": "required"},
        "returns": "booking confirmation"
    }
}
```

## MCP (Model Context Protocol) 的角色

```
MCP解决: 不同工具如何标准化地注册和调用

传统方式:
  Agent代码中硬编码每个工具的调用方式
  → 工具变更需要改Agent代码
  → 多个Agent无法共享工具

MCP方式:
  ┌─────────┐     MCP Protocol     ┌──────────┐
  │  Agent   │ ←──────────────────→ │ MCP Server│
  │          │                      │           │
  │ 统一接口  │  1. discover tools   │ search    │
  │ 调用方式  │  2. call tool(name)  │ book      │
  │          │  3. get result       │ review    │
  └─────────┘                      └──────────┘

  工具变更只改MCP Server, Agent代码不变
  多个Agent可以连同一个MCP Server共享工具
```

## Skill 描述漂移问题

```python
# 问题描述: Skill的description变了, 但模型还按旧的选工具

# Version 1: search_restaurant description = "搜索餐厅"
# Version 2: search_restaurant description = "搜索餐厅和外卖"

# 模型用Version 1训练的 → 只在"搜索餐厅"时调用
# 但用户说"我要点外卖" → 模型不调用search_restaurant
# → Skill描述漂移导致工具选择错误

# 防止方案:
# 1. 版本管理: 每个Skill有version号
# 2. 描述锁定: description变更需要重新评估
# 3. 别名机制: 一个Skill可以有多个description别名
# 4. A/B测试: 新description先灰度, 监控调用率变化
```
