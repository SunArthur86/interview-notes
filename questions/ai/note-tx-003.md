---
id: note-tx-003
difficulty: L3
category: ai
subcategory: Agent
tags:
- 腾讯
- 面经
- Skill
- Agent
- 工具设计
feynman:
  essence: 手动设计Skill=精确控制每个能力的行为，自动生成Skill=快但不稳定。生产环境优先手动，原型阶段可以用自动。
  analogy: 手动设计Skill像请专业厨师写菜谱（精确可控），Skill Creator像让AI生成菜谱（快但可能味道奇怪，需要试菜调整）。
  key_points:
  - 手动:可控/安全/可维护
  - 自动:快但不稳定/难调试
  - 生产环境优先手动
  - Skill Creator适合原型验证
first_principle:
follow_up:
- Skill Creator具体是什么？——让LLM根据自然语言描述自动生成工具定义和代码
- 怎么评估Skill质量？——调用成功率+执行时间+用户满意度+错误率
- Skill和Function Calling什么关系？——Skill封装了多个Tools+Prompt+流程
---

# 【腾讯面经】Skill 怎么设计的？为什么不用 Skill Creator（自动生成工具）？

## 核心问题

Agent 的 **Skill** 是对模型能力的封装单元，决定了 Agent 能做什么、做得多好。这道题考察的是：你对 Agent 能力设计的工程化思维，以及在**可控性 vs 效率**之间的权衡。

---

## 一、技术原理详解

### 1.1 什么是 Skill？

Skill 是 Agent 框架中**高于 Tool、低于 Agent** 的中间抽象层：

```
┌───────────────────────────────────────────────────┐
│                   Agent                           │
│  (规划、决策、多步推理、错误恢复)                     │
├───────────┬───────────┬───────────┬───────────────┤
│  Skill A  │  Skill B  │  Skill C  │   Skill D     │
│  (代码     │  (搜索    │  (数据    │   (部署       │
│   生成)    │   总结)   │   分析)   │   运维)       │
├──────┬────┼─────┬─────┼─────┬─────┼───────┬───────┤
│Tool 1│Tool2│Tool3│Tool4│Tool5│Tool6│Tool7  │Tool8  │
│(LLM) │(AST)│(API)│(RAG)│(SQL)│(Plot│(K8s) │(CI/CD)│
│      │解析)│     │     │     │)    │API)   │       │
└──────┴────┴─────┴─────┴─────┴─────┴───────┴───────┘
```

### 1.2 Skill vs Tool vs Function Calling

| 概念 | 粒度 | 组成 | 谁控制流程 |
|------|------|------|-----------|
| **Function Calling** | 单次调用 | 函数签名（name + parameters + description） | LLM 自主选择调用 |
| **Tool** | 单一能力 | 一个或多个 Function + 执行环境 | 框架执行 |
| **Skill** | 复合能力 | 多个 Tool + System Prompt + 执行流程 + 输入输出Schema + 异常处理 | Skill 内部编排 |

**关键区别：** Function Calling 只是让 LLM 调用一个函数；Skill 是一个完整的**工作流编排**，包含 Prompt 工程、多步工具调用、错误处理和输出格式化。

### 1.3 手动设计 Skill 的标准流程

```
需求分析 → Schema 定义 → Prompt 工程 → 工具依赖 → 异常处理 → 测试评估 → 迭代优化
   │          │            │            │           │           │           │
   ▼          ▼            ▼            ▼           ▼           ▼           ▼
 明确     输入/输出     System      依赖哪些    边界case    调用成功    A/B测试
 解决    Schema(类型   Prompt +    MCP Tools   超时/重试   率+准确率   线上监控
 什么    必填/枚举)    Few-shot    +执行权限    /降级                 持续优化
```

---

## 二、Skill 设计详解

### 2.1 手动 Skill 设计的五大原则

#### 原则 1：单一职责（Single Responsibility）

一个 Skill 只做一件事。错误示范：一个 "代码助手" Skill 既写代码又做 Code Review 还做部署。正确做法：拆分为 `Code Generation`、`Code Review`、`Deploy` 三个独立 Skill。

#### 原则 2：明确边界（Clear Interface）

```python
from pydantic import BaseModel, Field
from typing import Literal, Optional
from enum import Enum


class CodeLanguage(str, Enum):
    PYTHON = "python"
    JAVA = "java"
    GO = "go"
    TYPESCRIPT = "typescript"


class CodeGenInput(BaseModel):
    """代码生成 Skill 的输入 Schema"""
    task_description: str = Field(
        ..., 
        description="要实现的功能描述，不超过500字",
        max_length=500
    )
    language: CodeLanguage = Field(
        ..., 
        description="目标编程语言"
    )
    style: Literal["production", "prototype", "educational"] = Field(
        default="production",
        description="代码风格"
    )
    max_lines: int = Field(
        default=200, 
        ge=10, 
        le=1000,
        description="最大代码行数"
    )


class CodeGenOutput(BaseModel):
    """代码生成 Skill 的输出 Schema"""
    code: str = Field(..., description="生成的代码")
    explanation: str = Field(..., description="代码说明")
    tests: Optional[str] = Field(None, description="配套测试代码")
    warnings: list[str] = Field(default_factory=list, description="注意事项")
```

#### 原则 3：版本管理（Version Control）

```python
@dataclass
class SkillMeta:
    name: str = "code_generation"
    version: str = "2.1.0"        # 语义版本号
    compatible_agent: str = ">=1.5.0"  # 兼容的Agent版本
    changelog: str = """
    v2.1.0: 增加TypeScript支持
    v2.0.0: 重构输出Schema（不向后兼容）
    v1.3.0: 增加Few-shot示例
    """
```

#### 原则 4：权限隔离（Least Privilege）

```python
class CodeGenSkill:
    """每个 Skill 只声明它需要的最小权限"""
    required_tools = ["ast_parser", "syntax_checker"]
    # ❌ 不需要: ["file_writer", "shell_executor", "network_access"]
    
    max_execution_time = 30  # 秒
    max_token_cost = 5000    # 限制Token消耗
```

#### 原则 5：异常处理与降级

```python
class CodeGenSkill:
    def execute(self, input: CodeGenInput) -> CodeGenOutput:
        try:
            return self._generate(input)
        except TokenLimitError:
            # 降级策略1: 简化输出
            return self._generate_compact(input)
        except ToolUnavailableError as e:
            # 降级策略2: 跳过工具依赖
            logger.warning(f"Tool unavailable: {e}, falling back")
            return self._generate_without_tools(input)
        except Exception as e:
            # 最终降级: 返回错误信息
            return CodeGenOutput(
                code="", 
                explanation=f"生成失败: {e}",
                warnings=["请重试或联系管理员"]
            )
```

### 2.2 完整 Skill 实现代码

```python
from abc import ABC, abstractmethod
from typing import Type, Generic, TypeVar

T = TypeVar('T')
R = TypeVar('R')


class BaseSkill(ABC, Generic[T, R]):
    """Skill 基类：标准化 Skill 生命周期"""
    
    @property
    @abstractmethod
    def name(self) -> str: ...
    
    @property
    @abstractmethod
    def description(self) -> str: ...
    
    @property
    @abstractmethod
    def input_schema(self) -> Type[T]: ...
    
    @property
    @abstractmethod
    def output_schema(self) -> Type[R]: ...
    
    @property
    def system_prompt(self) -> str:
        return ""
    
    @property
    def few_shot_examples(self) -> list[dict]:
        return []
    
    @property
    def required_tools(self) -> list[str]:
        return []
    
    @abstractmethod
    def execute(self, input: T) -> R: ...


class CodeReviewSkill(BaseSkill[CodeReviewInput, CodeReviewOutput]):
    """代码审查 Skill 完整实现"""
    
    @property
    def name(self) -> str:
        return "code_review"
    
    @property
    def description(self) -> str:
        return "对给定代码进行专业审查，输出问题列表和改进建议"
    
    @property
    def input_schema(self):
        return CodeReviewInput
    
    @property
    def output_schema(self):
        return CodeReviewOutput
    
    @property
    def system_prompt(self) -> str:
        return """你是一位资深代码审查专家。请按以下维度审查代码：
1. 安全性（SQL注入、XSS、敏感信息泄露）
2. 性能（时间复杂度、内存使用、N+1查询）
3. 可维护性（命名规范、注释、代码结构）
4. 错误处理（异常捕获、边界条件）
输出格式：严格按JSON Schema输出。"""
    
    @property
    def few_shot_examples(self) -> list[dict]:
        return [
            {
                "input": {"code": "eval(user_input)", "language": "python"},
                "output": {
                    "issues": [{"severity": "critical", 
                                "category": "security",
                                "description": "eval() 存在代码注入风险"}],
                    "score": 20
                }
            }
        ]
    
    @property
    def required_tools(self) -> list[str]:
        return ["ast_parser", "lint_checker"]
    
    def execute(self, input: CodeReviewInput) -> CodeReviewOutput:
        # Step 1: 输入校验
        validated = self.input_schema(**input.dict())
        
        # Step 2: 工具预处理（AST分析、lint检查）
        ast_issues = self._run_ast_analysis(validated.code)
        lint_issues = self._run_lint(validated.code, validated.language)
        
        # Step 3: LLM 深度审查
        prompt = self._build_prompt(validated, ast_issues, lint_issues)
        result = self._call_llm(prompt)
        
        # Step 4: 输出校验
        return self.output_schema(**result)
```

---

## 三、为什么不用 Skill Creator（自动生成工具）？

### 3.1 Skill Creator 是什么？

Skill Creator 是让 LLM **根据自然语言描述自动生成 Skill 定义和代码**的工具。输入 "我需要一个能分析CSV数据并生成图表的 Skill"，它自动生成 Schema、Prompt、工具依赖和执行代码。

### 3.2 手动 vs 自动对比

| 维度 | 手动设计 Skill | Skill Creator 自动生成 |
|------|--------------|----------------------|
| **可控性** | ★★★★★ 完全可控 | ★★☆☆☆ 黑箱，难调参 |
| **质量稳定性** | ★★★★★ | ★★☆☆☆ 每次生成结果不一致 |
| **开发速度** | ★★☆☆☆ 慢 | ★★★★★ 快 |
| **业务理解** | ★★★★★ 深度理解业务约束 | ★★☆☆☆ 无法理解业务上下文 |
| **安全性** | ★★★★★ 最小权限可控 | ★★☆☆☆ 可能生成危险操作 |
| **可维护性** | ★★★★★ 代码可读可改 | ★★☆☆☆ 生成的代码难理解 |
| **可调试性** | ★★★★★ | ★★☆☆☆ |
| **适用阶段** | 生产环境 | 原型验证 |

### 3.3 五个核心原因

1. **可控性差：** 自动生成的 Skill 质量不稳定，同样的描述可能生成不同的 Schema 和 Prompt，难以做回归测试。

2. **业务理解不足：** Skill Creator 无法理解业务特定的约束——比如金融场景需要合规检查、医疗场景需要隐私脱敏，这些需要手动编码到 Skill 中。

3. **安全风险：** 自动生成的工具可能包含危险的权限声明（如文件写入、网络访问、Shell 执行），在 Agent 框架中可能造成安全事故。

4. **可维护性：** 自动生成的代码和 Prompt 可读性差，出现 bug 时难以定位和修复。手动编写的 Skill 有清晰的代码结构和注释。

5. **性能：** 手动优化的 Skill 在 Token 效率（更精炼的 Prompt）和准确率（精心设计的 Few-shot 示例）上通常优于自动生成。

---

## 四、Skill 质量评估体系

```python
@dataclass
class SkillMetrics:
    """Skill 质量评估指标"""
    # 核心指标
    call_success_rate: float       # 调用成功率（>95%达标）
    output_accuracy: float         # 输出准确率（人工评估）
    avg_execution_time: float      # 平均执行时间（秒）
    avg_token_cost: int            # 平均Token消耗
    
    # 用户体验指标
    user_satisfaction: float       # 用户满意度评分（1-5）
    retry_rate: float              # 重试率（<10%达标）
    error_rate: float              # 错误率（<5%达标）
    
    # 可维护性指标
    test_coverage: float           # 测试覆盖率
    doc_completeness: float        # 文档完整度


def evaluate_skill(skill: BaseSkill, test_cases: list) -> SkillMetrics:
    """对 Skill 进行全面评估"""
    results = []
    for case in test_cases:
        start = time.time()
        try:
            output = skill.execute(case.input)
            success = True
            error = None
        except Exception as e:
            output = None
            success = False
            error = str(e)
        
        results.append({
            'success': success,
            'time': time.time() - start,
            'error': error,
            'output': output
        })
    
    return SkillMetrics(
        call_success_rate=sum(r['success'] for r in results) / len(results),
        avg_execution_time=sum(r['time'] for r in results) / len(results),
        # ... 其他指标
    )
```

---

## 五、面试高频追问点

### Q1: Skill Creator 具体是什么？

**答：** Skill Creator 是利用 LLM 自动生成 Skill 定义的元工具。输入自然语言需求描述，它自动产出：输入输出 Schema（JSON Schema / Pydantic）、System Prompt、Few-shot 示例、工具依赖声明、执行代码框架。本质上是 **Meta-Tooling**——用工具来生成工具。

### Q2: 怎么评估 Skill 质量？

**答：** 四维评估：
1. **功能正确性：** 测试用例通过率（调用成功率 > 95%）
2. **性能指标：** 执行时间、Token 消耗、并发处理能力
3. **用户体验：** 用户满意度、重试率、错误率
4. **工程质量：** 测试覆盖率、文档完整度、代码可读性

### Q3: Skill 和 Function Calling 什么关系？

**答：**
- **Function Calling** 是 LLM 层面的能力：让模型输出结构化的函数调用参数
- **Tool** 是 Function 的封装：加上执行环境、权限控制、错误处理
- **Skill** 是 Tool 的编排：多个 Tool + Prompt + 执行流程 + Schema，形成一个完整的能力单元

层次关系：`Agent → Skill → Tool → Function Calling`。Skill 是 Agent 能力设计的核心抽象。

### Q4: 如何处理 Skill 之间的依赖关系？

**答：** 两种模式：
- **串行依赖：** Skill B 的输入依赖 Skill A 的输出 → Agent 做编排（Orchestration）
- **并行独立：** 多个 Skill 可以同时执行 → 提升效率，Agent 用 DAG 管理依赖

---

## 六、实战经验

1. **Skill 设计的核心是「边界」：** 面试中要强调——好的 Skill 设计不是让 Skill 做更多事，而是让它**做更少的事但做得更好**。单一职责 + 明确的输入输出 Schema 是最重要的原则。

2. **Prompt 是 Skill 的灵魂：** 手动设计的核心价值之一是精心打磨 System Prompt 和 Few-shot 示例。一个好的 Prompt 可以将准确率从 70% 提升到 95%。这部分是自动生成工具最难替代的。

3. **Skill Creator 的正确用法：** 不是完全不用 Skill Creator，而是**用 Skill Creator 做初稿，再人工精修**。先用它快速生成原型（5分钟），再花时间打磨 Prompt、增加异常处理、优化 Schema（2小时）。这是效率和质量的最佳平衡。

4. **生产环境的 Skill 管理平台：** 大厂面试会追问"100+ Skill 怎么管理"。需要考虑：Skill 注册中心、版本管理、灰度发布、调用监控、自动降级、权限审计。这已经是一个完整的工程系统。

5. **面试加分点：** 提到 MCP（Model Context Protocol）——Skill 的工具依赖声明可以基于 MCP 标准化，实现跨 Agent 框架的 Skill 复用。这是 Agent 生态的发展方向。
