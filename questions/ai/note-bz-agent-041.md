---
id: note-bz-agent-041
difficulty: L3
category: ai
subcategory: Agent
tags:
- B站面经
- Skill
- 标准化
- 万物皆可Skill
feynman:
  essence: 万物皆可Skill=用统一规范把任何能力（API/脚本/知识/流程）封装成Skill。核心是标准化接口，让异构能力以统一形式被Agent调用。
  analogy: 像USB标准——不管U盘/摄像头/键盘，都用USB接口。Skill标准让不管什么能力，都以统一形式接入Agent。
  first_principle: 异构能力（API/脚本/知识）接口各异，集成成本高。统一Skill规范=统一接口，降低集成成本。
  key_points:
  - 统一规范：元数据+工具+流程+Schema
  - 万物：API/脚本/知识/流程/人都能封装
  - 价值：标准化集成，降低成本
  - 关键：接口统一，实现各异
first_principle:
  essence: 标准化是规模化的前提——统一接口才能批量管理和组合。
  derivation: N种能力×M个Agent=N×M适配。统一Skill规范后，能力只需实现一次标准接口，所有Agent通用，复杂度降为N+M。
  conclusion: 万物皆可Skill = 统一接口标准 + 异构能力适配器
follow_up:
- 万物具体指什么？——API/脚本/知识库/人工流程/RPA
- 怎么保证封装质量？——Schema校验+测试用例+评级
- 有现成标准吗？——SKILL.md/MCP是实践中的标准
memory_points:
- 万物指代：API、脚本、文档、SOP、外部服务等皆可封装为统一Skill。
- 统一规范六要素：元数据(身份)、触发器(何时用)、工具依赖、输入输出Schema、执行流程、示例。
- 核心价值：通过统一规范，让异构能力(AI/人工/数据)标准化，供Agent按需动态调度。
---

# 如何基于统一规范实现"万物皆可 Skill"？

## 一、"万物"指什么

```
┌──────────────────────────────────────────────────┐
│            可以封装为Skill的"万物"                  │
├──────────────────────────────────────────────────┤
│                                                    │
│  1. API 能力                                       │
│     天气API/地图API/支付API → 封装为Skill          │
│                                                    │
│  2. 脚本/代码                                      │
│     Python数据处理/SQL查询 → 封装为Skill           │
│                                                    │
│  3. 知识/文档                                      │
│     产品手册/SOP/FAQ → 封装为Skill                 │
│                                                    │
│  4. 流程/SOP                                       │
│     报销流程/入职流程 → 封装为Skill                 │
│                                                    │
│  5. 人工操作                                       │
│     人工审核/专家判断 → 封装为Skill（含人工节点）   │
│                                                    │
│  6. 外部服务                                       │
│     GitHub/Slack/Jira → 通过MCP封装为Skill         │
│                                                    │
└──────────────────────────────────────────────────┘
```

## 二、统一规范的核心要素

```yaml
# 万物皆可Skill的统一规范

---
# === 元数据（身份）===
name: unique_skill_name          # 唯一标识
description: 一句话描述            # Agent匹配用
version: 1.0.0                   # 版本
category: data/communication/... # 分类

# === 触发条件（何时用）===
triggers:
  keywords: ["分析数据", "生成报表"]
  intent: "数据分析"

# === 工具依赖（用什么）===
tools:
  - name: database_query
    required: true
  - name: chart_generator
    required: false

# === 输入输出（接口）===
input_schema:
  type: object
  properties:
    data_source: string
    analysis_type: string
output_schema:
  type: object
  properties:
    report: string
    charts: array

# === 执行流程（怎么做）===
flow:
  - query_data
  - analyze
  - generate_report
  - quality_check

# === 示例（怎么用）===
examples:
  - input: {...}
    output: {...}
---
```

## 三、不同类型能力的封装

### 类型 1：API → Skill

```python
class WeatherAPISkill:
    """把天气API封装为Skill"""
    name = "get_weather"
    
    async def execute(self, city, date):
        # 调用真实API
        response = await http.get(
            f"https://api.weather.com?city={city}&date={date}"
        )
        return self.format(response)  # 标准化输出
```

### 类型 2：知识文档 → Skill

```python
class ProductFAQSkill:
    """把产品FAQ封装为Skill"""
    name = "product_qa"
    
    def __init__(self):
        self.faq_index = build_vector_index(load_faq_docs())
    
    def execute(self, question):
        # 用RAG从FAQ检索答案
        relevant = self.faq_index.search(question, top_k=3)
        return synthesize_answer(question, relevant)
```

### 类型 3：人工流程 → Skill

```python
class ManualReviewSkill:
    """把人工审核封装为Skill"""
    name = "human_review"
    
    async def execute(self, document):
        # Skill可以包含人工节点
        task = create_review_task(document)
        notify_reviewer(task)
        result = await wait_for_human_input(task, timeout=3600)
        return result  # 人工审核结果
```

### 类型 4：复合流程 → Skill

```python
class OnboardingSkill:
    """把入职流程封装为Skill"""
    name = "employee_onboarding"
    flow = [
        "create_account",      # 创建账号
        "assign_equipment",    # 分配设备
        "schedule_training",   # 安排培训
        "send_welcome",        # 发送欢迎
        "manager_review"       # 主管确认
    ]
    # 多个步骤，每步可能是不同工具/人工
```

## 四、Skill 注册中心（万物管理）

```python
class SkillRegistry:
    """所有Skill的注册中心，Agent按需查询"""
    
    def __init__(self):
        self.skills = {}  # name → skill
    
    def register(self, skill):
        """注册新Skill"""
        self.validate(skill)  # 校验符合规范
        self.skills[skill.name] = skill
    
    def search(self, query, top_k=5):
        """Agent按需求搜索Skill"""
        # 用RAG检索相关Skill
        return self.index.search(query, top_k)
    
    def execute(self, name, input_data):
        """执行Skill"""
        skill = self.skills[name]
        validate_input(input_data, skill.input_schema)
        result = skill.execute(input_data)
        validate_output(result, skill.output_schema)
        return result

# 中心化管理：注册一次，所有Agent可用
```

## 五、统一规范的价值

```
┌──────────────────────────────────────────────┐
│  没有统一规范（各自为政）                       │
│    Agent A的天气工具格式 ≠ Agent B的           │
│    换Agent要重写所有工具集成                    │
│    N能力 × M Agent = N×M 适配                  │
├──────────────────────────────────────────────┤
│  有统一规范（万物皆可Skill）                    │
│    所有能力按同一规范封装                       │
│    所有Agent按同一规范调用                      │
│    N能力 + M Agent = N+M（解耦）               │
└──────────────────────────────────────────────┘

价值：
  1. 能力复用：一次封装，处处可用
  2. Agent无关：换Agent不用改Skill
  3. 生态繁荣：标准化催生Skill市场
  4. 降低门槛：非技术人员也能用标准模板创建Skill
```

## 六、实践中的标准

```
当前的"事实标准"：

1. SKILL.md 格式（Claude Code等采用）
   - Markdown + YAML frontmatter
   - 简单易读，人机友好

2. MCP 协议（Anthropic提出）
   - 标准化工具接口
   - JSON-RPC通信

3. OpenAPI / Function Calling Schema
   - 工具参数标准化
   - 主流LLM支持

趋势：这些标准在融合，最终形成统一的"Skill标准"
```

## 七、面试加分点

1. **"万物"要具体**：不是空谈，要能举出 API/知识/流程/人工 都能封装的例子
2. **核心是"标准化"**：统一接口让 N×M 变 N+M，这是软件工程经典思想
3. **提生态价值**：标准化催生 Skill 市场（类比 App Store），这是 Agent 生态的基础

## 记忆要点

- 万物指代：API、脚本、文档、SOP、外部服务等皆可封装为统一Skill。
- 统一规范六要素：元数据(身份)、触发器(何时用)、工具依赖、输入输出Schema、执行流程、示例。
- 核心价值：通过统一规范，让异构能力(AI/人工/数据)标准化，供Agent按需动态调度。


## 苏格拉底式面试追问

> 这组追问模拟面试官层层逼问，每一问先回答"为什么"，再回答"怎么做"，最后回答"如何证明"。

### 第一层：目标与动机

**Q："万物皆可 Skill"的核心是"用统一规范封装异构能力"，为什么不直接让 Agent 分别对接每种能力（API 调 API、脚本调脚本），非要统一成 Skill？**

因为异构对接会让 Agent 的"能力管理"复杂度爆炸。1）对接成本——每加一种能力，Agent 要写专门的适配代码（API 的 HTTP 调用、脚本的子进程调用、知识的向量检索），N 种能力 N 套适配；统一成 Skill 后，Agent 只对接一种接口（Skill 调用），N 种能力一套适配；2）能力管理——异构能力没有统一元数据（怎么发现/怎么选/怎么监控），Agent 难以全局管理；Skill 有标准元数据（触发条件/Schema/版本），可统一发现/调度/治理；3）组合复用——异构能力难以组合（接口不兼容），Skill 统一接口后可自由组合。所以"万物皆可 Skill"的价值是"用一个抽象层消除异构性，让 Agent 的能力管理从 N 复杂度降到 1"。

### 第二层：证据与定位

**Q：你用统一规范封装了一批 Skill，但某个 Skill 调用时报错（如"接口不符合规范"），怎么定位是封装错还是原能力本身有问题？**

三层排查。1）原能力——单独测原能力（如直接调那个 API/跑那个脚本），如果原能力报错，是原能力问题（API 挂了/脚本 bug），与封装无关；2）封装适配——如果原能力 OK 但 Skill 调用错，看封装的适配层（如 API 调用的参数转换/脚本的输入输出解析），适配错（参数名错了/输出解析漏字段）是封装问题；3）规范符合性——如果适配对但报"接口不符合规范"，是 Skill 的 schema/元数据不符合统一规范（如缺必填字段/类型错），用规范校验器检查。定位方法：从原能力往外测（原能力→适配层→Skill 接口），找第一层出错的。

### 第三层：根因深挖

**Q：统一规范要把"异构能力"封装成统一形式，但异构能力的"输入输出"差异很大（API 返回 JSON、脚本返回文本、知识返回片段），怎么统一？**

统一到"标准化的中间表示"。1）输入统一——所有 Skill 的输入用统一格式（如 JSON，含 query/context/params 等标准字段），异构能力的输入由适配层转换（如 API 的 query params 从 Skill 的 params 映射）；2）输出统一——所有 Skill 的输出用标准格式（如`{result: any, metadata: {source, confidence, ...}}`），异构能力的输出由适配层转换（如脚本文本输出解析成结构化 result）；3）类型声明——每个 Skill 用 Schema 声明其具体输入输出（在统一格式内的具体字段），Agent 据此理解。本质是"外层统一（格式）+ 内层具体（Schema）"，就像 REST API 都用 HTTP 但每个 API 的 body 不同。

**Q：统一规范要"标准化"，但不同团队/场景对 Skill 的需求不同（有的要轻量、有的要带流程），规范怎么兼顾灵活性？**

分层规范 + 扩展点。1）核心规范（必须遵守）——所有 Skill 必须有的（名称/描述/输入输出 Schema/调用接口），保证最小可互操作；2）可选能力（按需）——复杂 Skill 可选的（触发条件/工具依赖/流程定义/示例/版本），简单 Skill 可不带；3）扩展点——规范预留自定义字段（如`custom: {team_specific_field}`），团队可扩展不影响互操作。这样轻量 Skill 只实现核心规范（简单），复杂 Skill 用满可选能力（强大），但都能被统一调度（核心规范兼容）。原则：核心最小化（降低门槛），扩展最大化（兼顾复杂场景）。

### 第四层：方案权衡

**Q：统一规范 vs 直接用 MCP（MCP 也是标准化协议），两者什么关系？为什么要再搞一套 Skill 规范？**

层次不同。1）MCP——是"工具连接协议"（底层），标准化工具的发现/调用/通信，适合原子工具（如读文件/调 API）；2）Skill 规范——是"能力封装规范"（高层），标准化业务能力（prompt+工具+流程+元数据），适合复合能力（如代码审查）。关系：Skill 可以调用 MCP 工具（Skill 内部用 MCP 连接工具），Skill 规范定义"能力怎么封装"，MCP 定义"工具怎么连接"。不矛盾——MCP 提供原子工具生态，Skill 在其上封装业务能力。选型：原子工具用 MCP（底层共享），业务能力用 Skill（高层复用）。如果只用 MCP，复杂业务能力（带流程/prompt）无法表达；如果只用 Skill 规范不接 MCP，原子工具要重复造。

**Q：统一规范听起来好，但落地要让所有团队把现有能力都改造成 Skill，改造成本高，怎么推进？**

渐进迁移 + 价值驱动。1）优先级——先封装"高频复用+跨团队"的能力（如用户查询/数据检索，这些被多场景用，封装价值高），低频/单团队的暂缓；2）脚手架——提供封装工具（如自动把现有 API 包装成 Skill 的 CLI），降低改造成本（开发者不用手写适配）；3）价值示范——先做几个标杆 Skill（展示封装后多场景复用/自动调度的收益），用数据说服其他团队跟进；4）不强制——允许新旧并存（原生能力+Skill），新能力鼓励用 Skill 规范，老能力按价值逐步迁移。原则：用价值驱动而非行政命令，让团队看到"封装成 Skill 更省事"自然跟进。

### 第五层：验证与沉淀

**Q：你怎么衡量"万物皆可 Skill"的统一规范是否落地成功（而非只是一堆文档没人用）？**

四个指标。1）Skill 覆盖率——团队核心能力有多少被封装成 Skill（如 20 个核心能力封装了 15 个，覆盖率 75%），高说明规范被采纳；2）Skill 复用度——每个 Skill 被多少场景/Agent 调用，高复用证明统一规范的价值（异构能力被统一复用）；3）新能力采纳——新开发的能力是否默认按 Skill 规范做（而非裸 API），高采纳说明规范成为默认习惯；4）跨团队共享——不同团队的 Skill 是否互相复用（如 A 团队用了 B 团队的 Skill），高共享证明规范打通了壁垒。综合：高覆盖+高复用+高新采纳+高跨团队共享 = 规范落地成功。

**Q：统一规范怎么沉淀成团队的 Skill 平台？**

建 Skill 平台：1）规范定义——明确 Skill 的标准结构（核心规范+可选能力+扩展点），文档化；2）封装工具——提供 CLI/SDK，自动把 API/脚本/知识包装成 Skill（降低改造成本）；3）注册中心——Skill 市场支持注册/发现/版本管理；4）调度引擎——Agent 接收请求后，按意图匹配 Skill 并调度（基于触发条件/Schema）；5）质量治理——Skill 上线前过规范校验+测试，带评分，低质的淘汰；6）监控——使用频率/成功率/复用度自动统计。这套写入团队 Agent 平台 SOP，让"万物皆可 Skill"从理念变成"开发者封装→平台注册→Agent 调度→质量监控"的闭环。

## 结构化回答

**30 秒电梯演讲：** 万物皆可Skill=用统一规范把任何能力（API/脚本/知识/流程）封装成Skill。核心是标准化接口，让异构能力以统一形式被Agent调用。

**展开框架：**
1. **统一规范** — 元数据+工具+流程+Schema
2. **万物** — API/脚本/知识/流程/人都能封装
3. **价值** — 标准化集成，降低成本

**收尾：** 您想深入聊：万物具体指什么？——API/脚本/知识库/人工流程/RPA？


## 视频脚本

> 预计时长：4 分钟 | 由浅入深


| 时间 | 画面/字幕 | 口播台词 | 讲解要点 |
|------|----------|----------|----------|
| 0:00 | 标题卡：如何基于统一规范实现"万物皆可 Skill"？ | "像USB标准——不管U盘/摄像头/键盘，都用USB接口。Skill标准让不管什么能力，都以…" | 开场钩子 |
| 0:20 | 核心概念图 | "万物皆可Skill=用统一规范把任何能力（API/脚本/知识/流程）封装成Skill。核心是标准化接口，让异构能力以统一…" | 核心定义 |
| 0:50 | 统一规范示意图 | "统一规范——元数据+工具+流程+Schema" | 要点拆解1 |
| 1:30 | 对比/实战案例图 | "对比一下常见误区和工程实践，看真实场景里怎么取舍。" | 实战与对比 |
| 2:20 | 总结卡 | "记住核心要点。下期我们追问：万物具体指什么？——API/脚本/知识库/人工流程/RPA？" | 收尾与钩子 |
