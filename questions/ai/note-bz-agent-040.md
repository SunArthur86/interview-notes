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

