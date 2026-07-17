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


## 苏格拉底式面试追问

> 这组追问模拟面试官层层逼问，每一问先回答"为什么"，再回答"怎么做"，最后回答"如何证明"。

### 第一层：目标与动机

**Q：Skill 是"做什么+怎么做"（能力封装），MCP 是"怎么连接"（通信协议），为什么要分两层？合成一层不行吗？**

因为职责正交。Skill 关注"能力内容"（执行什么任务、用什么 prompt、调什么工具、什么流程），MCP 关注"连接机制"（如何发现工具、如何调用、如何传参、如何标准化）。合成一层会导致：1）耦合——改通信协议要动 Skill 内容，改 Skill 要碰通信，互相干扰；2）不可复用——Skill 绑死特定协议，换协议要重写；3）生态封闭——只能用"Skill+协议"一体的方案，不能复用其他生态（如 MCP 生态的工具）。分层后：Skill 专注能力（用任何工具实现），MCP 专注连接（连接任何工具），Skill 可以调用 MCP 协议的工具，也可以调用非 MCP 工具，灵活组合。

### 第二层：证据与定位

**Q：一个 Skill 调用 MCP Server 提供的工具失败了，怎么定位是 Skill 的问题（调用逻辑错）还是 MCP 的问题（协议/Server 错）？**

分层 trace。1）MCP 层——看 MCP Client 和 Server 的通信日志（请求/响应/错误），如果 Server 返回错误（如工具不存在/参数错/Server 内部异常），是 MCP/Server 问题；2）Skill 层——如果 MCP 返回正确结果但 Skill 用错了（如 Skill 没正确解析返回值、或 Skill 调用参数不对），是 Skill 问题。定位方法：隔离测试——单独用 MCP Client 直接调那个工具（绕过 Skill），如果成功，是 Skill 调用逻辑错；如果失败，是 MCP/Server 错。MCP 层的错误再细分：工具不存在（Server 注册问题）、参数 schema 不符（Client/Server schema 不一致）、Server 故障（实现 bug）。

### 第三层：根因深挖

**Q：MCP 是"标准化协议"，但不同 MCP Server 的工具质量参差不齐（有的工具描述清晰、有的很烂），MCP 怎么保证工具质量？**

MCP 不保证质量，质量由 Server 实现者负责，MCP 只保证"连接标准化"。但平台层可加质量治理：1）工具描述规范——MCP Server 注册工具时强制要求描述含"功能+参数+示例"，不符合的拒绝注册（或低评分标记）；2）工具测试——平台对注册的工具跑标准测试集（如"这个工具能否正确响应典型请求"），失败的下线；3）使用反馈——用户使用工具后的反馈（成功/失败/满意度）作为工具评分，低分的自然被淘汰（市场机制）。所以"工具质量"靠"规范+测试+市场反馈"三层治理，MCP 协议本身只管连接，质量是生态治理的职责。

**Q：Skill 调用工具时，工具是 MCP 提供的还是 Skill 自带的，怎么决策？**

按"工具通用性"决策。1）通用工具（如文件操作、搜索、HTTP 请求）——用 MCP 提供的（标准化、跨 Skill 复用，如多个 Skill 都用"读文件"工具，共享一个 MCP Server 的实现）；2）专用工具（如某 Skill 特有的业务工具）——Skill 自带（只为这个 Skill 服务，不值得做成 MCP Server）。决策标准：工具会被多个 Skill/Agent 用→做成 MCP Server（复用）；只一个 Skill 用→Skill 内部自带（简单）。实务：核心通用工具走 MCP 生态（如 GitHub MCP、DB MCP），长尾专用工具 Skill 自带。

### 第四层：方案权衡

**Q：Skill 和 MCP 都是为了"能力复用"，为什么不统一成一种（要么全 Skill 要么全 MCP）？**

两者复用的维度不同。1）MCP——复用"原子工具"（如读文件、调 API），跨 Skill/Agent/模型复用，是底层能力共享；2）Skill——复用"业务能力"（如代码审查、文档生成），跨场景复用，是高层能力共享。统一成 MCP——业务能力（代码审查）做成 MCP 太重（MCP 适合原子工具，不适合复杂流程）；统一成 Skill——原子工具（读文件）做成 Skill 太轻（Skill 适合业务封装，原子能力不值得）。所以两者分层：MCP 提供原子工具生态，Skill 在其上构建业务能力，各司其职。类比：MCP 是"标准零件"（螺丝/齿轮），Skill 是"组件"（电机/变速箱），不能合成一层。

**Q：Skill 调用 MCP 工具增加了"协议层"开销（序列化/网络），为什么不直接函数调用（Skill 内部直接调工具函数）省开销？**

按部署架构决定。1）同进程部署——Skill 和工具在同一进程，直接函数调用最快（无协议开销），适合"工具和 Skill 紧耦合、同团队维护"；2）跨进程/跨服务部署——工具是独立服务（如公司统一的 GitHub MCP Server），Skill 跨网络调用，用 MCP 协议标准化，适合"工具跨团队/跨服务复用"。MCP 的开销（序列化+网络）在跨服务场景是必然的（不用 MCP 也要用别的 RPC 协议），MCP 的价值是"标准化"（所有工具统一协议，不每个工具自定义 RPC）。所以同进程用直接调用（快），跨服务用 MCP（标准），按部署架构选。

### 第五层：验证与沉淀

**Q：你怎么衡量 Skill 和 MCP 的分层架构是否有效（Skill 灵活组合、MCP 工具被复用）？**

两个维度的指标。1）MCP 工具复用度——每个 MCP 工具被多少 Skill/Agent 调用，高复用（如"读文件"被 10 个 Skill 用）证明 MCP 价值；低复用（只 1 个 Skill 用）说明该工具不该做成 MCP（该内联）；2）Skill 组合度——Skill 是否能有效组合 MCP 工具构建复杂能力，看 Skill 的平均工具数（组合多工具的 Skill 价值高）和 Skill 复用度（被多少场景用）。还要看"维护成本"——MCP 工具和 Skill 独立演进的频率（高频说明分层解耦有效，低频可能耦合）。

**Q：Skill+MCP 的分层架构怎么沉淀成团队 Agent 平台？**

建两层平台：1）MCP 工具市场——标准化协议的工具注册中心（每个工具符合 MCP 规范），跨团队复用，带质量评分；2）Skill 市场——业务能力的注册中心（每个 Skill 声明依赖哪些 MCP 工具/prompt/流程），跨场景复用；3）调度引擎——Agent 接收请求后，匹配 Skill（按意图）→ Skill 调用 MCP 工具（按需），框架自动编排；4）质量治理——MCP 工具和 Skill 各自的质量监控（成功率/复用度/满意度），低质的淘汰。这套写入团队 Agent 平台 SOP，让"构建 Agent"变成"组合 Skill 和 MCP 工具"，不再从零开发。

## 结构化回答

**30 秒电梯演讲：** Skill=Agent的能力封装(prompt+flow)，MCP=工具的通信协议(标准化接口)。Skill是"做什么+怎么做"，MCP是"怎么连接"。互补而非替代。

**展开框架：**
1. **Skill** — 能力封装(prompt+tools+flow)，面向任务
2. **MCP** — 通信协议(标准化工具接口)，面向连接
3. **关系** — Skill通过MCP调用工具

**收尾：** 您想深入聊：MCP是谁提出的？——Anthropic，2024年开源？


## 视频脚本

> 预计时长：4 分钟 | 由浅入深


| 时间 | 画面/字幕 | 口播台词 | 讲解要点 |
|------|----------|----------|----------|
| 0:00 | 标题卡：Agent Skill 与 MCP 的区别？ | "Skill像菜谱(做什么菜+怎么做)，MCP像厨房电器标准接口(所有厨具统一插座)。菜谱用…" | 开场钩子 |
| 0:20 | 核心概念图 | "Skill=Agent的能力封装(prompt+flow)，MCP=工具的通信协议(标准化接口)。Skill是"做什么+…" | 核心定义 |
| 0:50 | Skill示意图 | "Skill——能力封装(prompt+tools+flow)，面向任务" | 要点拆解1 |
| 1:30 | 对比/实战案例图 | "对比一下常见误区和工程实践，看真实场景里怎么取舍。" | 实战与对比 |
| 2:20 | 总结卡 | "记住核心要点。下期我们追问：MCP是谁提出的？——Anthropic，2024年开源？" | 收尾与钩子 |
