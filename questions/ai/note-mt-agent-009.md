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
memory_points:
- 回答策略：切忌抛出笼统百分比，必须按代码类型分层拆解AI参与度，展示方法论。
- 放权与收权：样板代码与测试用例（~80%）放权给AI，而核心业务与架构设计（~0%）人工主导。
- 人机协作流：人工定架构接口 -> AI生成框架与测试 -> 人工强审查 -> AI辅助排错。
- 核心价值定调：虽然约半数代码由AI生成，但100%的逻辑与安全必须经过人工把关。
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

## 记忆要点

- 回答策略：切忌抛出笼统百分比，必须按代码类型分层拆解AI参与度，展示方法论。
- 放权与收权：样板代码与测试用例（~80%）放权给AI，而核心业务与架构设计（~0%）人工主导。
- 人机协作流：人工定架构接口 -> AI生成框架与测试 -> 人工强审查 -> AI辅助排错。
- 核心价值定调：虽然约半数代码由AI生成，但100%的逻辑与安全必须经过人工把关。


## 苏格拉底式面试追问

> 这组追问模拟面试官层层逼问，每一问先回答"为什么"，再回答"怎么做"，最后回答"如何证明"。

### 第一层：目标与动机

**Q：你说用了 AI Coding 开发 Agent，到底用在哪几个环节？为什么不全程用或完全不用？**

用在三个"确定性高、可验证"的环节：1) 样板代码生成（CRUD、配置、单测骨架）；2) 已有模式的重构（提取函数、改签名）；3) 文档/注释生成。不用的环节：核心业务逻辑（Agent 编排状态机）、安全相关代码（鉴权、权限校验）、性能关键路径（KV Cache 管理代码）。原因是 AI 生成的代码"看起来对"但可能有微妙 bug，核心逻辑必须人写 + 严格 review。完全不用是浪费生产力，全程用是放任风险。

### 第二层：证据与定位

**Q：AI 生成的代码上线后出了 bug，怎么定位是 AI 写错了还是人 review 漏了？**

看代码的"作者标记"和 review 记录。1) 如果是 AI 生成、人直接 merge 没改过，是 review 漏了——人没尽到把关责任；2) 如果 AI 生成后人改过但引入了 bug，是人的修改有问题；3) 如果 AI 生成的代码在边界条件（null 处理、并发、异常路径）出错，是 AI 的已知弱点，review 时应该重点查这些。关键原则：AI 生成的代码 bug，责任人永远是 merge 它的人，不是 AI。

### 第三层：根因深挖

**Q：AI 生成的代码经常在"错误处理"和"边界条件"上出问题，根因是模型能力不够还是训练数据的问题？**

根因是训练数据里"错误处理"代码的稀缺和模式单一。开源代码里 happy path 占绝大多数，健壮的错误处理（重试、降级、熔断、幂等）是少数资深工程师的实践，训练语料里这种模式密度低。所以 AI 生成的 try-catch 经常是空的或只 log 不处理。这不是某个模型的弱点，是所有 LLM 的通病。解法不是换模型，是在 prompt 里明确要求"列出所有异常路径并给出处理策略"，用 prompt 补足训练数据的稀疏。

**Q：那为什么不直接用专门训练过的代码模型（如 DeepSeek-Coder、Codex）来做错误处理，而要靠 prompt 补？**

专门代码模型在"语法正确性"和"常见模式"上更强，但在"工程健壮性"上提升有限——因为它们的训练语料同样是 happy path 为主的 GitHub 代码。错误处理的健壮性更多来自"领域经验"和"故障案例"，这些在公开语料里稀缺。所以即使换代码模型，错误处理仍要 prompt 引导 + 人工 review。prompt 补是最性价比的方案，换模型是边际收益递减。

### 第四层：方案权衡

**Q：AI Coding 能提升多少开发效率？这个效率提升的代价是什么？**

量化上，样板代码环节效率提升 30-50%，复杂业务逻辑提升 10-20%（因为 review 和修改成本高）。代价是：1) 代码可读性的方差变大——AI 生成的代码风格不一致，后续维护成本上升；2) 隐性技术债——AI 倾向于"堆代码"而不是"抽象复用"，长期看代码重复度上升；3) 团队能力退化风险——新人过度依赖 AI 生成，不理解底层逻辑。权衡方式：定 AI 生成代码占比上限（建议 < 50%），核心模块强制手写。

**Q：为什么不直接让 AI 全自动生成整个 Agent 系统，人只做验收？**

因为 Agent 系统的"正确性标准"很难自动化验证。Agent 是非确定性的——同样输入可能多步路径不同，单元测试覆盖不了所有路径。全自动生成后人无法判断"这个 Agent 的行为是否正确"，验收本身成了难题。Agent 系统的核心是"决策逻辑"和"护栏设计"，这些需要人对业务、安全、用户体验的深度理解，AI 替代不了。AI 适合做"执行"，人必须掌控"设计"和"验收"。

### 第五层：验证与沉淀

**Q：怎么衡量 AI Coding 在团队里的实际收益，而不是"感觉快了"？**

三个量化指标：1) PR 的 AI 生成代码占比（用 git blame + AI 工具标记统计）；2) 单个 feature 的开发周期（从开工到上线的小时数），对比引入 AI 前后；3) AI 生成代码的缺陷率（上线后 bug 数 / AI 生成代码行数），对比人写代码的缺陷率。如果缺陷率显著高于人写，说明 AI 用过头了，要收缩使用范围。沉淀为团队 AI Coding 规范：哪些模块可用、review 标准、占比上限，每季度 review 调整。

## 结构化回答




**30 秒电梯演讲：** 就像问厨师用了多少预制菜回答要有层次框架用AI核心手写测试AI辅助架构人工。

**展开框架：**
1. **分层回答样板** — 分层回答样板代码vs核心逻辑
2. **展示人机协作** — 展示人机协作流程
3. **诚实但** — 诚实但有策略

**收尾：** AI生成代码怎么保证质量？





## 视频脚本

> 预计时长：4 分钟 | 由浅入深


| 时间 | 画面/字幕 | 口播台词 | 讲解要点 |
|------|----------|----------|----------|
| 0:00 | 标题卡：你用了多少AI Coding来开发Agent系统… | "就像问厨师用了多少预制菜回答要有层次框架用AI核心手写测试AI辅助架构人工。" | 开场钩子 |
| 0:20 | 核心概念图 | "这道题有坑面试官考察对AI辅助开发的真实理解和边界把控。" | 核心定义 |
| 0:50 | 分层回答样板示意图 | "分层回答样板——分层回答样板代码vs核心逻辑" | 要点拆解1 |
| 1:30 | 对比/实战案例图 | "对比一下常见误区和工程实践，看真实场景里怎么取舍。" | 实战与对比 |
| 2:20 | 总结卡 | "记住核心要点。下期我们追问：AI生成代码怎么保证质量？" | 收尾与钩子 |
