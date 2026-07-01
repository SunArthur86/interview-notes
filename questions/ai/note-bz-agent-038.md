---
id: note-bz-agent-038
difficulty: L3
category: ai
subcategory: Agent
tags:
- B站面经
- Skill
- MCP
- 对比
feynman:
  essence: Skill=Agent的能力封装(prompt+flow)，MCP=工具的通信协议(标准化接口)。Skill是"做什么+怎么做"，MCP是"怎么连接"。互补而非替代。
  analogy: Skill像菜谱(做什么菜+怎么做)，MCP像厨房电器标准接口(所有厨具统一插座)。菜谱用电器的标准接口调用厨具。
  first_principle: Skill解决"能力复用"问题(怎么做事)，MCP解决"工具互联"问题(怎么连接工具)。两者正交。
  key_points:
  - Skill：能力封装(prompt+tools+flow)，面向任务
  - MCP：通信协议(标准化工具接口)，面向连接
  - 关系：Skill通过MCP调用工具
  - 类比：Skill=应用，MCP=USB标准
first_principle:
  essence: Skill和MCP解决不同层次的问题——Skill是应用层(做什么)，MCP是传输层(怎么连)。
  derivation: Agent要调用工具，需要1.知道做什么(Skill定义流程)2.怎么调用工具(MCP标准化接口)。没有MCP，每个工具接口不同，Skill要适配N种。有了MCP，工具统一接口，Skill只管流程。
  conclusion: Skill(应用层-做什么) + MCP(协议层-怎么连) = 完整的Agent能力体系
follow_up:
- MCP是谁提出的？——Anthropic，2024年开源
- 没有MCP能用Skill吗？——能，但工具接口不统一，集成成本高
- 两者会融合吗？——可能，Skill可能内置MCP客户端
memory_points:
- 定位不同：Skill聚焦应用层管“做什么与怎么做”，MCP聚焦协议层管“怎么连接”。
- 包含内容：Skill是包含Prompt+Tools+Flow的能力包；MCP是Server+Client的标准化接口。
- 互补关系：Skill定义业务执行流程，MCP负责将底层工具标准化暴露供Skill调用。
---

# Agent Skill 与 MCP 的区别？

## 一、定位对比

```
┌──────────────────────────────────────────────┐
│  Skill (能力)                MCP (协议)        │
│                                                │
│  "做什么 + 怎么做"           "怎么连接"          │
│                                                │
│  封装了完整的任务流程         标准化工具接口      │
│  (Prompt+Tools+Flow)         (Server+Client)   │
│                                                │
│  面向：任务/能力              面向：工具/连接     │
│  层次：应用层                  层次：协议层       │
│  例子："技术调研"技能          例子：数据库MCP    │
└──────────────────────────────────────────────┘
```

## 二、本质区别

### Skill：做什么 + 怎么做

```python
# Skill是"能力包"，包含完整逻辑
class ResearchSkill:
    """技术调研技能"""
    prompt = "你是调研专家，流程是..."  # 怎么做
    tools = ["search", "read", "write"]  # 用什么
    flow = "search→read→analyze→report"  # 流程
    
    def execute(self, topic):
        results = search(topic)      # 第1步
        insights = read(results)     # 第2步
        report = analyze(insights)   # 第3步
        return report

# Skill定义了"完成调研"这件事怎么做
```

### MCP：怎么连接

```python
# MCP是"协议"，标准化工具如何被Agent调用
# MCP Server暴露标准化接口
class DatabaseMCPServer:
    @mcp.tool
    def query(self, sql: str) -> dict:
        """标准化的查询接口"""
        return db.execute(sql)
    
    @mcp.tool
    def insert(self, table: str, data: dict) -> bool:
        """标准化的插入接口"""
        return db.insert(table, data)

# MCP不关心"做什么"，只关心"工具如何被标准化地暴露和调用"
# 任何支持MCP的Agent都能调用这个数据库，无需专门适配
```

## 三、关系：互补而非替代

```
┌──────────────────────────────────────────────────┐
│                  Agent                            │
│                                                    │
│  ┌─────────────────────────────────────┐         │
│  │  Skill: "数据分析报告"                │         │
│  │  ┌──────────────────────────────┐   │         │
│  │  │ 1. 查数据(用DB工具)            │   │         │
│  │  │ 2. 分析(用Python工具)         │   │         │
│  │  │ 3. 画图(用Chart工具)          │   │         │
│  │  │ 4. 生成报告                    │   │         │
│  │  └──────────────────────────────┘   │         │
│  └──────────────┬──────────────────────┘         │
│                 │ 调用工具                          │
│                 ▼                                  │
│  ┌─────────────────────────────────────┐         │
│  │  MCP (标准化工具接口)                 │         │
│  │  ┌────────┐ ┌────────┐ ┌────────┐  │         │
│  │  │ DB MCP │ │ Py MCP │ │Chart MCP│ │         │
│  │  │ Server │ │ Server │ │ Server  │ │         │
│  │  └────────┘ └────────┘ └────────┘  │         │
│  └─────────────────────────────────────┘         │
│                                                    │
│  Skill定义"做什么"(应用层)                         │
│  MCP定义"怎么连工具"(协议层)                       │
│  Skill通过MCP调用工具                              │
└──────────────────────────────────────────────────┘
```

## 四、对比表

| 维度 | Skill | MCP |
|------|-------|-----|
| **本质** | 能力封装 | 通信协议 |
| **层次** | 应用层 | 协议层 |
| **关注** | 做什么/怎么做 | 怎么连接工具 |
| **组成** | Prompt+Tools+Flow | Server+Client+Protocol |
| **类比** | App/菜谱 | USB/插座标准 |
| **提出者** | 各Agent框架（Claude等） | Anthropic |
| **互换性** | Skill可跨Agent用 | 工具可跨Agent用 |
| **关系** | Skill调用MCP暴露的工具 | MCP为Skill提供工具 |

## 五、为什么需要两者

```
只有Skill没有MCP：
  Skill里硬编码每个工具的调用方式
  → 工具升级，Skill要改
  → 换个工具，Skill要改
  → N个Skill × M个工具 = N×M 适配

只有MCP没有Skill：
  工具接口标准了，但复杂任务流程没人封装
  → 每次都要从零编排
  → 流程质量不稳定

两者结合：
  Skill定义流程（做什么）
  MCP标准化工具接口（怎么连）
  → Skill通过MCP调用工具，解耦
  → 工具升级不影响Skill
  → N个Skill + M个MCP工具，自由组合
```

## 六、实际例子

```
任务：分析销售数据并生成报告

Skill层：
  "数据分析报告"Skill定义流程：
  1. 查销售数据
  2. 统计分析
  3. 生成图表
  4. 撰写报告

MCP层：
  - Database MCP: 提供query接口（查数据）
  - Python MCP: 提供execute接口（分析）
  - Chart MCP: 提供render接口（画图）

Skill通过MCP的标准化接口调用这些工具
工具可以替换（换DB），Skill不用改
```

## 七、面试加分点

1. **层次不同**：Skill 是应用层（做什么），MCP 是协议层（怎么连）——不是同一层面的东西
2. **互补关系**：Skill 通过 MCP 调用工具，两者结合才是完整方案
3. **用 USB 类比**：Skill=USB 设备（U 盘/摄像头），MCP=USB 接口标准——设备通过标准接口连接

## 记忆要点

- 定位不同：Skill聚焦应用层管“做什么与怎么做”，MCP聚焦协议层管“怎么连接”。
- 包含内容：Skill是包含Prompt+Tools+Flow的能力包；MCP是Server+Client的标准化接口。
- 互补关系：Skill定义业务执行流程，MCP负责将底层工具标准化暴露供Skill调用。

