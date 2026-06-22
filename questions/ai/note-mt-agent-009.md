---
id: note-mt-agent-009
difficulty: L3
category: ai
subcategory: Agent
tags:
- 美团
- 面经
- AI Coding
- 开发效率
feynman:
  essence: 这道题有坑面试官考察对AI辅助开发的真实理解和边界把控。
  analogy: 就像问厨师用了多少预制菜回答要有层次框架用AI核心手写测试AI辅助架构人工。
  first_principle: AI Coding最佳实践AI负责重复性模板化代码人负责架构设计核心逻辑安全边界。
  key_points:
  - 分层回答样板代码vs核心逻辑
  - 展示人机协作流程
  - 诚实但有策略
  - 不能全AI也不能全手写
first_principle:
  essence: AI辅助开发边界创造力归人执行力归AI
  derivation: 架构设计人样板代码AI核心算法人测试AI
  conclusion: 最佳答案是展示清晰的人机分工策略
follow_up:
- AI生成代码怎么保证质量？
- AI生成的bug怎么调试？
- AI能完全替代程序员吗？
---

# 【美团面经】你用了多少AI Coding来开发Agent系统？怎么用AI的？

## 一、面试官在考什么

这道题**表面问比例，实际考认知**。面试官想验证三件事：

1. **你有没有真正用 AI 做过开发**——全手写说明工具链落后，全AI说明缺乏掌控力
2. **你对 AI 能力边界的理解是否清晰**——哪些该交给AI、哪些必须人来把控
3. **你有没有代码质量意识**——AI生成的代码如何审查、测试、保证正确性

**回答策略**：不要给一个笼统的百分比（"大概70%用AI"），而是**按代码类型分层回答**，展示你有一套成熟的 AI 辅助开发方法论。

---

## 二、分层回答：按代码类型拆分 AI 参与度

| 代码类型 | AI 参与度 | 典型场景 | 人做什么 |
|------|------|------|------|
| **框架/样板代码** | ~60% AI | FastAPI 路由、Pydantic 模型、ORM 定义、配置文件 | 审查接口设计是否合理 |
| **核心业务逻辑** | ~20% AI | Agent 决策引擎、记忆管理、多Agent调度算法 | 主导设计思路，AI 只辅助补全 |
| **测试代码** | ~80% AI | 单元测试、集成测试、Mock 数据生成 | 审查测试覆盖率和边界条件 |
| **架构设计** | ~0% AI（100%人工） | 系统拆分、技术选型、数据流设计、安全边界 | 完全人工决策 |
| **文档/注释** | ~90% AI | API 文档、README、代码注释 | 审查准确性 |
| **Debug/排错** | ~50% AI | 分析报错堆栈、定位问题区域 | 确认根因、决定修复方案 |

**加权综合来看，大约 40%~50% 的代码由 AI 生成，但 100% 的代码经过人工审查。**

---

## 三、人机协作流程

```
    ┌────────────────────────────────────────────────────┐
    │                  开发一个新功能的完整流程               │
    └────────────────────────┬───────────────────────────┘
                             │
          ┌──────────────────┼──────────────────┐
          │                                     │
          ▼                                     ▼
   ┌──────────────┐                    ┌───────────────┐
   │  1. 人工环节    │                    │  2. AI 生成环节  │
   │              │                    │               │
   │ · 需求分析    │  ─── 设计文档 ──→  │ · 生成框架代码  │
   │ · 架构设计    │                    │ · 生成测试用例  │
   │ · 接口定义    │                    │ · 生成文档注释  │
   │ · 技术选型    │                    │ · 补全样板代码  │
   └──────┬───────┘                    └───────┬───────┘
          │                                     │
          └──────────────────┬──────────────────┘
                             │
                             ▼
                    ┌────────────────┐
                    │  3. 人工审查环节  │
                    │                │
                    │ · 代码Review   │
                    │ · 安全审查     │
                    │ · 边界条件检查  │
                    │ · 性能评估     │
                    └───────┬────────┘
                            │
                    ┌───────▼────────┐
                    │  4. AI 辅助测试  │
                    │                │
                    │ · 生成测试用例  │
                    │ · 运行测试     │
                    │ · 分析覆盖率   │
                    └───────┬────────┘
                            │
                    ┌───────▼────────┐
                    │  5. 人工修复    │
                    │                │
                    │ · 修复AI bug   │
                    │ · 补充边界case │
                    │ · 性能优化     │
                    └────────────────┘
```

---

## 四、具体分工边界（附代码示例）

### 4.1 AI 生成的代码（60%参与）——样板/框架代码

这类代码**模式固定、重复性高、有明确规范**，非常适合 AI 生成：

```python
# ============ AI 生成的示例：FastAPI 路由 + Pydantic 模型 ============
# Prompt: "帮我生成一个Agent任务的CRUD API，用FastAPI + Pydantic"

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field
from typing import Optional
from datetime import datetime

app = FastAPI(title="Agent Task API")

class TaskCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=100)
    description: Optional[str] = None
    priority: int = Field(default=0, ge=0, le=10)

class TaskResponse(BaseModel):
    id: str
    name: str
    status: str
    created_at: datetime

@app.post("/tasks", response_model=TaskResponse)
async def create_task(task: TaskCreate):
    # AI生成的标准CRUD —— 人工只审查接口设计
    ...
```

**人工审查重点**：接口设计是否符合 RESTful 规范、字段约束是否合理。

### 4.2 人工手写的代码（20% AI参与）——核心业务逻辑

这类代码**涉及业务理解、算法设计、系统行为**，必须人主导：

```python
# ============ 人工手写的示例：Agent 决策引擎核心 ============
# AI 只能辅助补全个别方法签名，核心逻辑必须人来写

class AgentDecisionEngine:
    """
    Agent决策引擎——决定下一步调用哪个工具

    为什么不能交给AI：
    1. 需要理解业务优先级（订单超时 > 库存不足 > 价格变动）
    2. 需要处理状态机转换的合法性约束
    3. 需要实现降级/熔断策略
    """

    def decide_next_action(self, context: AgentContext) -> Action:
        # 人工设计的决策树，结合业务规则
        if context.urgency_level >= UrgencyLevel.HIGH:
            if context.tool_available("express_delivery"):
                return Action(
                    tool="express_delivery",
                    params={"order_id": context.order_id},
                    fallback=self._fallback_plan(context),
                )

        # 降级策略——AI无法理解何时该降级
        if context.retry_count > self.MAX_RETRY:
            return self._escalate_to_human(context)

        return self._normal_decision(context)
```

**关键原则**：AI 可以帮你写代码，但不能帮你做决策。涉及系统行为的核心逻辑，设计师必须是人。

### 4.3 AI 高度参与的代码（80%参与）——测试代码

```python
# ============ AI 生成的示例：测试用例 ============
# Prompt: "为AgentDecisionEngine.decide_next_action生成完整的单元测试"

import pytest
from unittest.mock import Mock, patch

class TestAgentDecisionEngine:

    @pytest.fixture
    def engine(self):
        return AgentDecisionEngine()

    @pytest.fixture
    def high_urgency_context(self):
        ctx = Mock(spec=AgentContext)
        ctx.urgency_level = UrgencyLevel.HIGH
        ctx.order_id = "ORDER_001"
        ctx.retry_count = 0
        return ctx

    def test_high_urgency_uses_express_delivery(self, engine, high_urgency_context):
        """高紧急度应使用快递配送"""
        with patch.object(high_urgency_context, 'tool_available', return_value=True):
            action = engine.decide_next_action(high_urgency_context)
            assert action.tool == "express_delivery"

    def test_max_retry_escalates_to_human(self, engine):
        """超过最大重试次数应升级到人工"""
        ctx = Mock(spec=AgentContext)
        ctx.retry_count = engine.MAX_RETRY + 1
        action = engine.decide_next_action(ctx)
        assert action.tool == "escalate_human"

    # AI 通常会遗漏的边界 case —— 人工补充
    def test_concurrent_order_lock_contention(self, engine):
        """并发订单锁竞争场景（AI想不到这个）"""
        # 这个case必须人工补充
        ...
```

**人工补充重点**：并发场景、极端边界、安全相关测试用例。

---

## 五、AI 生成代码的质量保证策略

### 5.1 三道质量关卡

```
AI 生成代码 → [关卡1: 自动化Lint] → [关卡2: 单元测试] → [关卡3: 人工Review]
                  │                      │                     │
                  ▼                      ▼                     ▼
             ruff/mypy             pytest覆盖率              重点审查:
             类型检查              必须 ≥ 80%               · 安全漏洞
             风格规范                                     · 业务逻辑正确性
                                                         · 边界条件
```

### 5.2 实际的质量保证代码

```python
# CI/CD 中的 AI 代码质量检查脚本
import subprocess
import sys

def quality_gate():
    """AI生成代码必须通过的质量关卡"""

    # 关卡1：代码规范检查
    result = subprocess.run(["ruff", "check", "src/"], capture_output=True)
    if result.returncode != 0:
        print("❌ Lint 检查未通过")
        sys.exit(1)

    # 关卡2：类型检查
    result = subprocess.run(["mypy", "src/", "--strict"], capture_output=True)
    if result.returncode != 0:
        print("❌ 类型检查未通过")
        sys.exit(1)

    # 关卡3：测试覆盖率
    result = subprocess.run(
        ["pytest", "--cov=src", "--cov-min=80"],
        capture_output=True,
    )
    if result.returncode != 0:
        print("❌ 测试覆盖率不足 80%")
        sys.exit(1)

    print("✅ 所有关卡通过")

if __name__ == "__main__":
    quality_gate()
```

---

## 六、回答这道题的实战话术

> "我大概 **40%~50% 的代码用 AI 辅助生成**，但具体比例取决于代码类型。
>
> **框架和样板代码**，比如 API 路由、数据模型定义、配置文件，大概 60% 用 AI 生成，因为这些模式固定、有明确规范，AI 生成后我做 Review 就行。
>
> **核心业务逻辑**，比如 Agent 的决策引擎、记忆管理、调度算法，我只让 AI 辅助 20% 左右——主要是方法签名补全和简单工具函数。核心逻辑必须我来设计，因为涉及业务理解和系统行为决策。
>
> **测试代码**是 AI 参与度最高的，大概 80%。我会让 AI 根据接口定义生成基础测试用例，然后人工补充并发场景和边界条件。
>
> **架构设计完全不做 AI 辅助**——技术选型、系统拆分、数据流设计这些需要全局视角和业务判断，AI 目前还做不好。
>
> 最关键的一点：**不管 AI 参与多少，100% 的代码都经过人工 Review**。AI 生成的代码必须通过 lint、类型检查、单元测试三道关卡才允许合入。"

---

## 七、面试加分点

1. **诚实是第一位**：不要说"我不用AI"（显得落后），也不要说"90%都是AI写的"（显得没有掌控力）。**分层回答展示成熟度**。

2. **主动谈风险**："AI 生成的代码最大的风险是**看起来正确但隐含逻辑错误**——类型对、能跑通，但业务语义是错的。所以我坚持核心逻辑手写。"

3. **展示工具链**：具体说用了什么工具（Cursor / Copilot / Claude Code），怎么用（Prompt 技巧、上下文管理）。不要泛泛而谈。

4. **谈效率提升的数据**：比如"用了 AI 辅助后，开发一个 CRUD 模块从 2 小时缩短到 30 分钟，测试覆盖率从 60% 提升到 85%"。数据比感受有说服力。

5. **回答 follow-up**：
   - **AI生成代码怎么保证质量？** 三道关卡：自动化 lint + 类型检查 + 单元测试 ≥ 80% 覆盖率，加上人工 Code Review。
   - **AI 生成的 bug 怎么调试？** 先让 AI 分析报错堆栈给出假设，人工验证假设是否正确，定位到根因后决定是自己修还是让 AI 修——安全相关 bug 必须人工修。
   - **AI 能完全替代程序员吗？** 短期内不能。AI 擅长"执行力"（把明确需求转化为代码），但不擅长"创造力"（架构设计、需求理解、业务决策）。未来程序员的角色会从"写代码的人"转变为"设计系统 + 指导 AI 写代码的人"。
