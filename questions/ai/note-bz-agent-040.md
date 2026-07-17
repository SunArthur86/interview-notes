---
id: note-bz-agent-040
difficulty: L3
category: ai
subcategory: Agent
tags:
- B站面经
- Prompt
- Skill
- 提示工程
feynman:
  essence: 把Prompt升级为Skill=给裸prompt加上"元数据(触发条件)+工具依赖+流程定义+输入输出Schema+示例"。从"一段话"变成"一个可复用的能力模块"。
  analogy: Prompt像便签纸上的菜谱(写完就扔)，Skill像装订成册的菜谱书(有目录/食材表/步骤图/营养信息)，可保存可分享可复用。
  first_principle: Prompt是一次性的指令，Skill是结构化的能力。升级=把隐性的prompt经验，显性化为可管理的资产。
  key_points:
  - Prompt→Skill五步：加元数据/加工具/加流程/加Schema/加示例
  - 核心区别：Skill是结构化可管理的，Prompt是扁平的
  - 升级价值：可复用/可分享/可迭代/可测试
  - 方法：提取共性+固化流程+定义边界
first_principle:
  essence: Skill是Prompt的"工程化升级"——从一次性指令到可管理资产。
  derivation: Prompt：写在代码/配置里的字符串，难管理难复用。Skill：结构化封装(触发/工具/流程/Schema)，可版本管理/分享/测试。升级=工程化。
  conclusion: Prompt→Skill = 结构化封装（元数据+工具+流程+Schema+示例）
follow_up:
- 所有Prompt都该升级成Skill吗？——不，高频复用的才值得
- Skill怎么版本管理？——语义版本号+向后兼容+变更日志
- 怎么判断Skill质量？——测试用例+成功率+用户反馈
memory_points:
- 对比差异：Prompt是低复用文本，Skill是高复用、可管理、带Schema的结构化模块。
- 核心五步：加元数据(可发现)→加工具依赖(声明式)→加流程(可复现)→加Schema(可测试)→加示例(提质量)。
- 总结口诀：从裸文本进化为带身份、依赖、流程、接口和例子的标准化组件。
---

# Prompt 不等于 Skill，怎么把 Prompt 升级为 Skill？

## 一、Prompt vs Skill 的区别

```
┌──────────────┬──────────────────┬──────────────────────┐
│ 维度          │ Prompt              │ Skill                   │
├──────────────┼──────────────────┼──────────────────────┤
│ 形态          │ 一段文本            │ 结构化模块               │
│ 复用性        │ 低（复制粘贴）      │ 高（按名调用）           │
│ 可管理        │ 难（散落各处）      │ 易（集中管理）           │
│ 可分享        │ 难（无标准格式）    │ 易（标准格式打包）       │
│ 可测试        │ 难                  │ 易（有Schema可验证）     │
│ 可迭代        │ 难（改了不知影响谁）│ 易（版本管理）           │
│ 工具依赖      │ 无（或硬编码）      │ 有（声明式）             │
└──────────────┴──────────────────┴──────────────────────┘
```

## 二、升级五步法

### Step 1：加元数据（让它可被发现）

```yaml
# 升级前（裸Prompt）
"你是一个翻译助手，把用户输入翻译成英文"

# 升级后（加元数据）
---
name: translator
description: 中英互译工具
triggers:
  - "翻译"
  - "translate"
  - "英文怎么说"
version: 1.0.0
author: team
---
```

### Step 2：加工具依赖（声明式）

```yaml
# 声明这个Skill需要什么工具
tools:
  - dictionary_lookup  # 查词典
  - web_search        # 搜索例句
---
```

```python
# 升级前：工具调用硬编码在prompt里
prompt = "你是翻译，如果不确定可以调用search工具..."

# 升级后：工具声明式管理
class TranslatorSkill:
    required_tools = ["dictionary_lookup", "web_search"]
    # Agent框架自动注入这些工具
```

### Step 3：加流程定义（可复现）

```yaml
# 定义执行流程
flow:
  - step: 1
    name: 理解原文
    action: 分析用户输入的语言和含义
    
  - step: 2
    name: 查阅参考
    action: 如有专业术语，调用dictionary_lookup
    condition: contains_technical_term
    
  - step: 3
    name: 翻译
    action: 生成译文
    
  - step: 4
    name: 校验
    action: 检查译文准确性，必要时搜索例句验证
    
  - step: 5
    name: 输出
    action: 返回译文+注释
---
```

### Step 4：加输入输出 Schema（可测试）

```yaml
input_schema:
  type: object
  properties:
    text: 
      type: string
      description: 要翻译的文本
    target_lang:
      type: string
      enum: [en, zh]
      default: en
  required: [text]

output_schema:
  type: object
  properties:
    translation: string
    notes: string  # 翻译注释
    confidence: number
---
```

### Step 5：加示例（提升质量）

```yaml
examples:
  - input: {text: "人工智能", target_lang: "en"}
    output: {translation: "Artificial Intelligence", notes: "缩写AI", confidence: 0.99}
    
  - input: {text: "yyds", target_lang: "en"}
    output: 
      translation: "GOAT (Greatest Of All Time)"
      notes: "网络用语，直译为'永远的神'"
      confidence: 0.8
---
```

## 三、完整 Skill 示例

```markdown
# SKILL.md - 技术文档翻译

---
name: tech_doc_translator
description: 翻译技术文档，保留术语准确性
triggers: ["翻译文档", "translate doc", "英文文档"]
version: 1.2.0
tools:
  - glossary_lookup
  - web_search
---

## 系统提示词
你是技术文档翻译专家。原则：
1. 专业术语保留英文（如Transformer、Attention）
2. 代码块不翻译
3. 长句拆分，符合中文表达习惯
4. 不确定的术语查glossary或搜索

## 流程
1. 识别文档类型（论文/教程/API文档）
2. 提取专业术语，查glossary
3. 逐段翻译
4. 术语一致性检查
5. 输出译文+术语表

## 输入
- content: 文档内容
- source_lang: 源语言
- target_lang: 目标语言

## 输出
- translation: 译文
- glossary: 术语对照表

## 示例
输入: "The Transformer uses self-attention mechanism..."
输出: 
  translation: "Transformer使用自注意力机制..."
  glossary: {"self-attention": "自注意力"}
```

## 四、判断哪些 Prompt 值得升级

```
值得升级为Skill的Prompt特征：
  ✓ 高频使用（每天都用）
  ✓ 复杂流程（多步骤）
  ✓ 依赖工具（需调API）
  ✓ 团队共用（多人需要）
  ✓ 质量关键（错了影响大）

不值得升级的：
  ✗ 一次性使用
  ✗ 简单任务（一句话能搞定）
  ✗ 个人临时使用

原则：把20%高频Prompt升级为Skill，覆盖80%使用场景
```

## 五、Skill 的生命周期管理

```python
class SkillLifecycle:
    """Skill也要管理生命周期"""
    
    # 版本管理
    def publish(self, skill, version):
        """发布新版本"""
        assert backward_compatible(skill, self.previous)
        self.registry.publish(skill, version)
    
    # 废弃
    def deprecate(self, skill_name):
        """标记废弃"""
        self.registry.mark_deprecated(skill_name)
        # 给使用者迁移时间
    
    # 监控
    def monitor(self, skill_name):
        """监控Skill使用情况"""
        return {
            "call_count": ...,
            "success_rate": ...,
            "avg_latency": ...,
            "user_rating": ...
        }
```

## 六、面试加分点

1. **五步升级法**：元数据→工具→流程→Schema→示例，结构化清晰
2. **不是所有 Prompt 都要升级**：只升级高频复用的，体现"投资回报"思维
3. **强调"资产管理"**：Skill 是组织的资产（可版本/分享/迭代），Prompt 是消耗品

## 记忆要点

- 对比差异：Prompt是低复用文本，Skill是高复用、可管理、带Schema的结构化模块。
- 核心五步：加元数据(可发现)→加工具依赖(声明式)→加流程(可复现)→加Schema(可测试)→加示例(提质量)。
- 总结口诀：从裸文本进化为带身份、依赖、流程、接口和例子的标准化组件。


## 苏格拉底式面试追问

> 这组追问模拟面试官层层逼问，每一问先回答"为什么"，再回答"怎么做"，最后回答"如何证明"。

### 第一层：目标与动机

**Q：把 Prompt 升级为 Skill 要加"触发条件+工具依赖+流程定义+Schema+示例"，这么多东西，为什么不直接用裸 Prompt（用户手动复制粘贴）？**

因为裸 Prompt 不可复用、不可管理、不可组合。1）不可复用——裸 Prompt 存在文档里，每次用要手动复制粘贴，容易遗漏/改错；Skill 注册后可被 Agent 自动触发，无需手动；2）不可管理——裸 Prompt 没版本/没作者/没触发逻辑，改了不知道、用错没感知；Skill 有元数据（版本/触发条件/依赖），可追踪可维护；3）不可组合——裸 Prompt 是孤立的，不能和其他 Skill 组合构建复杂能力；Skill 可被其他 Skill/Agent 调用，组合复用。所以升级为 Skill 的价值是"从一次性文本变成可管理的能力模块"，类似从"个人笔记"到"标准库函数"。

### 第二层：证据与定位

**Q：升级后的 Skill 效果不稳定（有时好有时差），怎么定位是 Prompt 内容问题、触发条件问题，还是工具/流程问题？**

分层隔离测试。1）触发条件——固定输入跑 Skill，看是否正确触发（该触发没触发/误触发），错则触发条件不准；2）Prompt 内容——单独把 Skill 的 Prompt（固定输入+固定工具返回）跑出来，看输出质量，差则 Prompt 写得不好；3）工具/流程——看 Skill 内部调用的工具返回是否正确（工具失败会拖垮 Skill）、流程顺序是否合理（如该先查后改却反了），错则工具/流程问题。定位方法：trace Skill 执行的每一步（触发判断/Prompt 渲染/工具调用/流程节点），找第一个"输入对输出错"的环节。常见根因：Prompt 的指令模糊（LLM 不知怎么做）、触发条件太宽（误触发到不适用场景）、工具不稳（返回错导致输出错）。

### 第三层：根因深挖

**Q：Skill 要定义"输入输出 Schema"（结构化输入输出），但很多 Prompt 的输入输出是自然语言（非结构化），怎么定义 Schema？**

对自然语言输入输出做"结构化约束"。1）输入 Schema——虽然输入是自然语言，但可以约束必填字段（如"必须有 user_query 字符串"）和可选字段（如"context 可选，提供上下文"），LLM/调用方据此构造输入；2）输出 Schema——要求 LLM 输出结构化格式（如 JSON），定义字段（如`{summary: string, action_items: array, sentiment: enum}`），用 JSON Schema 声明，LLM 按格式输出（配合 function calling/structured output）；3）自然语言字段——允许部分字段是自由文本（如 summary），但整体结构是固定的。Schema 的价值是让 Skill 可被程序化调用（其他 Skill/框架知道传什么收什么），而非只能人读。

**Q：Skill 要带"示例"（few-shot 例子），但示例加多了 Prompt 变长（费 token），加少了 LLM 学不会，怎么平衡？**

精选少量高质量示例。1）数量——2-5 个示例足够（多了 token 贵且 attention 稀释），研究表明 few-shot 的边际效益在 5 个后递减；2）质量——示例要覆盖典型情况（正常用例）+ 边界情况（易错的，如歧义输入该怎么处理），让 LLM 学到"正确行为模式"；3）多样性——示例不要雷同（都是简单情况），要覆盖不同输入模式，让 LLM 泛化；4）动态——对高频/复杂 Skill 多加示例，简单 Skill 少加甚至零示例（靠 prompt 指令）。验证：加示例后跑测试集，看准确率提升是否值回 token 成本（提升 5% 但 token 翻倍可能不值）。

### 第四层：方案权衡

**Q：Skill 既能用 Prompt 实现，也能用代码实现（纯函数逻辑），什么时候用 Prompt 什么时候用代码？**

按"是否需要语义理解"决策。1）Prompt 实现——任务需要 LLM 的语义理解/推理/生成能力（如"总结文档""分类情感""生成文案"），用 Prompt（让 LLM 做语义处理）；2）代码实现——任务是确定性逻辑（如"格式化日期""计算 hash""调 HTTP 接口"），用代码（确定性逻辑 LLM 反而可能出错且费 token）；3）混合——Skill 内部"代码处理确定性步骤 + Prompt 处理语义步骤"（如"查询数据(代码) → 总结数据(Prompt) → 格式化输出(代码)"）。原则：确定性用代码（准且省），语义性用 Prompt（灵活），能代码解决的别浪费 LLM。

**Q：Skill 升级后要加这么多东西（元数据/Schema/示例），开发成本比写裸 Prompt 高很多，值得吗？**

按"使用频率和复用度"判断。1）高频复用——这个 Prompt 被多次用/多场景用，值得升级成 Skill（投入分摊到多次使用，且可管理可演进）；2）一次性——只某次任务用，不值得（写裸 Prompt 快，升级反而过度工程）。判断标准：预期使用次数 >10 次 或 多场景复用 → 升级 Skill；一次性/低频 → 裸 Prompt。实务：核心业务能力（如代码审查、数据分析）升级 Skill（高频复用），临时探索性任务用裸 Prompt（快）。Skill 平台可提供脚手架（自动生成元数据模板），降低升级成本。

### 第五层：验证与沉淀

**Q：你怎么证明把 Prompt 升级成 Skill 后效果真的变好（而非只是"更规范但没提升"）？**

AB 对比。固定测试集，对比：1）裸 Prompt（手动复制粘贴执行）；2）Skill（自动触发+结构化）。指标：1）输出质量——准确率/满意度，Skill 应持平或更高（如果低，说明升级时加了不必要的约束反而干扰 LLM）；2）一致性——多次执行同样输入，Skill 输出更稳定（有 Schema 约束+流程固定），裸 Prompt 可能因手动遗漏而不稳；3）开发效率——升级后新场景接入 Skill 的时间 vs 每次重写 Prompt 的时间，Skill 应显著快。最优是"质量持平/提升 + 一致性高 + 接入快"。还要看触发准确率（Skill 该触发时触发的比例），低则触发条件没写好。

**Q：Prompt 升级 Skill 的流程怎么沉淀成团队的 SOP？**

建 Skill 升级规范：1）升级 checklist——裸 Prompt 升级 Skill 必须含（触发条件/工具依赖/流程/输入输出 Schema/2-5 示例），不完整的拒绝注册；2）脚手架工具——提供 CLI/模板，自动生成 Skill 骨架（填空式开发），降低升级成本；3）Skill 市场——升级后的 Skill 注册到市场，跨团队复用；4）质量门禁——Skill 上线前跑标准测试集（触发准确率/输出质量/Schema 符合性），过线才发布；5）持续维护——Skill 有 owner，定期 review（使用频率/效果），低质的下线。这套写入团队 Agent 开发 SOP，让"Prompt 变 Skill"从"个人拍脑袋"变成"标准化产出"。

## 结构化回答

**30 秒电梯演讲：** 把Prompt升级为Skill=给裸prompt加上"元数据(触发条件)+工具依赖+流程定义+输入输出Schema+示例"。从"一段话"变成"一个可复用的能力模块"。

**展开框架：**
1. **Prompt→Skill五步** — 加元数据/加工具/加流程/加Schema/加示例
2. **核心区别** — Skill是结构化可管理的，Prompt是扁平的
3. **升级价值** — 可复用/可分享/可迭代/可测试

**收尾：** 您想深入聊：所有Prompt都该升级成Skill吗？——不，高频复用的才值得？


## 视频脚本

> 预计时长：4 分钟 | 由浅入深


| 时间 | 画面/字幕 | 口播台词 | 讲解要点 |
|------|----------|----------|----------|
| 0:00 | 标题卡：Prompt 不等于 Skill，怎么把… | "Prompt像便签纸上的菜谱(写完就扔)，Skill像装订成册的菜谱书(有目录/食材表/步…" | 开场钩子 |
| 0:20 | 核心概念图 | "把Prompt升级为Skill=给裸prompt加上"元数据(触发条件)+工具依赖+流程定义+输入输出Schema+示例…" | 核心定义 |
| 0:50 | Prompt→Skill五步示意图 | "Prompt→Skill五步——加元数据/加工具/加流程/加Schema/加示例" | 要点拆解1 |
| 1:30 | 对比/实战案例图 | "对比一下常见误区和工程实践，看真实场景里怎么取舍。" | 实战与对比 |
| 2:20 | 总结卡 | "记住核心要点。下期我们追问：所有Prompt都该升级成Skill吗？——不，高频复用的才？" | 收尾与钩子 |
