---
id: note-ma-ai-004
difficulty: L4
category: ai
subcategory: Agent/幻觉控制
tags:
- 后端开发二面
- Multi-Agent
- 大模型幻觉
- Hallucination
- Auto Fix
- 面经
feynman:
  essence: "降低幻觉的链路: 限制范围(Prompt约束)→外部验证(RAG/规则)→自动测试(Playwright)→自动修复(Auto Fix)→人工兜底。不是靠一个手段，而是多层防御"
  analogy: "降低幻觉就像防漏水——水龙头拧紧(Prompt约束减少幻觉)、接水盆兜底(RAG提供事实)、湿度报警器(自动测试检测错误)、自动修补(Auto Fix修复)、最后人工检查(Human-in-the-loop)"
  key_points:
  - "幻觉来源: 训练数据不足、Prompt模糊、Context缺失、温度过高"
  - "Prompt层: 明确约束、few-shot示例、思维链(CoT)"
  - "验证层: RAG提供事实、规则引擎校验、类型检查"
  - "测试层: Playwright E2E测试、TypeScript编译、ESLint"
  - "修复层: Test Agent反馈→Code Agent修复→限制循环次数"
  - "兜底层: 人工确认、高风险转人工"
first_principle:
  essence: "大模型本质是概率生成模型，无法保证100%正确。必须从'预防'和'检测修复'两个维度构建防御链"
  derivation: "模型预测=概率采样→必然有错误率→不能信任单次输出→需要外部验证→测试发现错误→自动修复→修复失败转人工→多层防御降低错误率到可接受水平"
  conclusion: "幻觉控制 = 预防(Prompt+RAG) + 检测(测试+编译) + 修复(Auto Fix) + 兜底(人工)"
follow_up:
- 如何评估幻觉率？用什么指标？
- Auto Fix如果无限循环怎么办？
- RAG检索到错误信息也会导致幻觉，怎么处理？
- 温度参数和幻觉的关系？设多少合适？
- 如何区分'创造性幻觉'和'事实性幻觉'？
memory_points:
- "多层防御: Prompt→RAG→编译检查→E2E测试→Auto Fix→人工兜底"
- "Auto Fix限制: 最多3轮，避免无限循环"
- "温度: 编码场景设0.1-0.3（低创造性=低幻觉）"
- "核心原则: 不信任单次输出，必须有外部验证"
---

# 【后端开发二面】如何降低大模型幻觉导致的错误代码？

> 来源：后端开发二面（贼难）小红书面经 — 原题：如何降低大模型幻觉（Hallucination）导致的错误代码？

## 一、费曼类比

```
幻觉防御 = 多重防漏水系统:

┌───────────────────────────────────────────────────┐
│  Level 1: 拧紧水龙头 (Prompt约束)                   │
│  → 明确指令、限制范围、few-shot示例                  │
│  → 减少50%幻觉                                      │
│                                                   │
│  Level 2: 接水盆 (RAG事实注入)                     │
│  → 提供准确的代码库上下文、API文档                   │
│  → 再减少20%幻觉                                    │
│                                                   │
│  Level 3: 湿度报警器 (编译+静态检查)                │
│  → TypeScript编译、ESLint、类型检查                 │
│  → 捕获语法/类型错误                                │
│                                                   │
│  Level 4: 自动修补 (Auto Fix)                      │
│  → Test Agent发现问题→反馈给Code Agent→自动修复     │
│  → 修复已知错误                                     │
│                                                   │
│  Level 5: 人工检查 (Human-in-the-loop)             │
│  → 高风险代码必须人工Review                         │
│  → 兜底安全网                                       │
└───────────────────────────────────────────────────┘
```

## 二、第一性原理分析

**幻觉从哪来？**

```
幻觉来源:
┌────────────────┬───────────────────────────────┐
│ 来源           │ 例子                           │
├────────────────┼───────────────────────────────┤
│ 训练数据不足    │ 用了不存在的API/方法名          │
│ 训练数据过时    │ 用了旧版本语法(React class组件) │
│ Prompt模糊     │ 没有说清需求→模型自由发挥       │
│ Context缺失    │ 不知道项目用了什么框架           │
│ 温度过高       │ 采样过于随机→生成错误代码       │
│ 推理链过长     │ CoT推理中间步骤出错→结论错      │
└────────────────┴───────────────────────────────┘
```

## 三、详细答案

### 3.1 Level 1: Prompt层预防

```python
PROMPT_TEMPLATE = """
你是一个专业的{language}开发工程师。

## 严格约束
1. 只使用以下已确认的依赖: {dependencies}
2. 不要使用任何未在import列表中的API
3. 必须遵循项目的编码规范: {coding_style}
4. 如果不确定某个API的用法，标注 "// TODO: 需要确认"

## 项目上下文
技术栈: {tech_stack}
框架版本: {framework_version}

## 代码库知识
{relevant_knowledge_from_ast}

## 当前任务
{task_description}

## 要求
- 输出可直接运行的代码
- 不要猜测API签名，如果不确定请标注
"""

# 温度设置: 编码场景用低温度
llm.generate(prompt, temperature=0.1)  # 0.1-0.3 减少随机性
```

### 3.2 Level 2: RAG事实注入

```
RAG = 让大模型"看文档再回答"

幻觉场景(无RAG):
  Agent: "这个组件用 <StyledButton>"
  实际: 项目用的是 Ant Design <Button>

有RAG:
  1. 检索知识库 → 找到 components/Button.md
  2. 注入到Prompt: "项目使用Ant Design的Button组件"
  3. Agent: 用 <Button type="primary"> ✓

RAG关键:
  • 知识库来自AST解析的真实代码 (Source of Truth)
  • 按需加载，只注入相关上下文
  • 包含API签名、参数类型、返回值
```

### 3.3 Level 3: 编译+静态检查

```python
class CodeValidator:
    """代码生成后的自动校验"""
    
    def validate(self, code_diff):
        errors = []
        
        # 1. TypeScript编译检查
        ts_errors = self.tsc_compile(code_diff)
        errors.extend(ts_errors)
        # 捕获: 类型错误、不存在的属性/方法
        
        # 2. ESLint静态分析
        lint_errors = self.eslint(code_diff)
        errors.extend(lint_errors)
        # 捕获: 未使用变量、空函数、不规范代码
        
        # 3. Import验证
        import_errors = self.verify_imports(code_diff)
        errors.extend(import_errors)
        # 捕获: 导入了不存在的模块/组件
        
        # 4. API签名验证
        api_errors = self.check_api_signatures(code_diff)
        errors.extend(api_errors)
        # 捕获: 调用了不存在的API方法
        
        return errors
```

### 3.4 Level 4: Auto Fix自动修复

```python
class AutoFix:
    """Test Agent发现问题→反馈给Code Agent→自动修复"""
    
    MAX_FIX_ROUNDS = 3  # 限制循环次数，避免无限修复
    
    def __init__(self):
        self.test_agent = TestAgent()
        self.code_agent = CodeAgent()
        self.fix_count = 0
    
    async def run(self, code_diff, design):
        while self.fix_count < self.MAX_FIX_ROUNDS:
            # 1. 测试
            test_result = await self.test_agent.run(code_diff, design)
            
            if test_result.passed:
                return Success(code_diff)
            
            # 2. 收集错误信息
            errors = test_result.collect_errors()
            # 编译错误、E2E失败、UI差异等
            
            # 3. 反馈给Code Agent修复
            code_diff = await self.code_agent.fix(
                original_code=code_diff,
                errors=errors,
                context=test_result.screenshots  # 失败截图
            )
            
            self.fix_count += 1
        
        # 超过最大修复轮数 → 转人工
        return NeedHumanIntervention(
            code_diff, 
            reason=f"Auto Fix失败({self.fix_count}轮)",
            errors=errors
        )
```

### 3.5 Level 5: 人工兜底

```
必须人工确认的场景:
  • Auto Fix超过3轮未通过
  • 涉及核心业务逻辑（支付/认证/安全）
  • 修改公共组件/底层模块
  • 数据库Schema变更
  • 删除超过50行代码

Human-in-the-loop流程:
  1. Code Agent提交PR (Pull Request)
  2. CI自动运行测试 + 类型检查
  3. 人工Review: 检查逻辑、安全性、可维护性
  4. 人工Approve → 合并
  5. 人工Reject → 反馈给Code Agent修改
```

## 四、幻觉率量化指标

```
多层防御效果:

┌───────────────┬──────────┬──────────────┐
│ 防御层         │ 幻觉率    │ 累计降幅      │
├───────────────┼──────────┼──────────────┤
│ 无防御(裸LLM)  │ ~15-20%  │ -            │
│ +Prompt约束    │ ~8-10%   │ ↓ 50%        │
│ +RAG事实注入   │ ~4-5%    │ ↓ 75%        │
│ +编译检查      │ ~2-3%    │ ↓ 85%        │
│ +Auto Fix(3轮) │ ~0.5-1%  │ ↓ 97%        │
│ +人工Review    │ ~0.1%    │ ↓ 99.5%      │
└───────────────┴──────────┴──────────────┘

关键: 不是靠单一手段，而是多层防御叠加
```

## 五、扩展知识

- **CoT (Chain of Thought)**: 让模型"思考过程"外显，中间步骤可检查
- **Self-Consistency**: 多次采样取多数投票，降低随机幻觉
- **Constrained Generation**: 用 grammar/JSON Schema 约束输出格式
- **Cross-Check**: 多个Agent交叉验证彼此的输出

## 六、苏格拉底式面试提问

1. **"你说Auto Fix最多3轮，但如果是同一个错误反复修不好呢？"** — 引出错误分类、升级机制、转人工的判断逻辑
2. **"RAG注入的知识本身就错了（知识库过期），怎么发现？"** — 引出Source of Truth原则、源码编译验证、CI检查
3. **"温度设0.1，是不是模型就没有创造性了？"** — 编码场景不需要创造性，需要确定性；创意场景(文案/UI)可适当提高
4. **"如何区分模型是'幻觉'还是'创新解法'？"** — 幻觉=不符合事实/编译失败；创新=可运行但非主流方案
5. **"多层防御每一层都有成本（Token/计算），怎么平衡防御深度和效率？"** — 引出风险分级（简单代码少检查、核心代码多重检查）

## 七、面试加分点

1. **量化每层防御的幻觉降幅** — 15%→8%→4%→2%→0.5%→0.1%
2. **强调Auto Fix循环限制** — 最多3轮，避免无限循环
3. **知道温度参数对幻觉的影响** — 编码场景0.1-0.3
4. **提到5层防御不是独立的** — 是层层递进的过滤链
5. **强调Human-in-the-loop的必要性** — AI不是万能的，关键决策需要人
6. **提到Self-Consistency/Cross-Check** — 展示对幻觉控制的广度理解

## 结构化回答

**30 秒电梯演讲：** 降低幻觉的链路: 限制范围(Prompt约束)→外部验证(RAG/规则)→自动测试(Playwright)→自动修复(Auto Fix)→人工兜底。不是靠一个手段，而是多层防御。

**展开框架：**
1. **幻觉来源** — 训练数据不足、Prompt模糊、Context缺失、温度过高
2. **Prompt层** — 明确约束、few-shot示例、思维链(CoT)
3. **验证层** — RAG提供事实、规则引擎校验、类型检查

**收尾：** 您想深入聊：如何评估幻觉率？用什么指标？


## 视频脚本

> 预计时长：5 分钟 | 由浅入深


| 时间 | 画面/字幕 | 口播台词 | 讲解要点 |
|------|----------|----------|----------|
| 0:00 | 标题卡：如何降低大模型幻觉导致的错误代码？ | "降低幻觉就像防漏水——水龙头拧紧(Prompt约束减少幻觉)、接水盆兜底(RAG提供事实)…" | 开场钩子 |
| 0:20 | 核心概念图 | "降低幻觉的链路: 限制范围(Prompt约束)→外部验证(RAG/规则)→自动测试(Playwright)→自动修复(…" | 核心定义 |
| 0:50 | 幻觉来源示意图 | "幻觉来源——训练数据不足、Prompt模糊、Context缺失、温度过高" | 要点拆解1 |
| 1:30 | Prompt层示意图 | "Prompt层——明确约束、few-shot示例、思维链(CoT)" | 要点拆解2 |
| 2:20 | 对比/实战案例图 | "对比一下常见误区和工程实践，看真实场景里怎么取舍。" | 实战与对比 |
| 3:10 | 总结卡 | "记住核心要点。下期我们追问：如何评估幻觉率？用什么指标？" | 收尾与钩子 |
