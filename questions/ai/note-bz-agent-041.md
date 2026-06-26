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
  derivation: 'N种能力×M个Agent=N×M适配。统一Skill规范后，能力只需实现一次标准接口，所有Agent通用，复杂度降为N+M。'
  conclusion: 万物皆可Skill = 统一接口标准 + 异构能力适配器
follow_up:
  - 万物具体指什么？——API/脚本/知识库/人工流程/RPA
  - 怎么保证封装质量？——Schema校验+测试用例+评级
  - 有现成标准吗？——SKILL.md/MCP是实践中的标准
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
