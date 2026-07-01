---
id: note-fl-009
difficulty: L3
category: ai
subcategory: Agent
tags:
- 字节
- 飞连
- 面经
- AICoding
- ClaudeCode
feynman:
  essence: AI 编程工具的使用流程是——先在 CLAUDE.md 写项目规则（架构约定/风格/禁忌）→ 用 plan 模式让它先出方案而非直接写代码 → 小步实施+每步跑测试 → 完成后人工 review diff + 跑完整测试套件。质量靠三层兜底：项目规则文件（约束生成方向）、单测/集成测试（防回归）、人工 Code Review（catch 设计问题）。
  analogy: 像带实习生——先给团队规范手册（CLAUDE.md），再让他先写方案（plan）你 review，然后小步实现每步验收，最后整体 Code Review。不能丢给他一个任务就不管，也不能事事自己来。
  first_principle: AI 生成代码的不确定性高，单点验证不可靠。必须用多层兜底（规则约束方向 + 测试防回归 + 人工 catch 设计问题），且每层都尽早介入（小步实施而非积压）。
  key_points:
  - CLAUDE.md 写架构约定/命名规范/禁忌操作 = AI 编程的"宪法"
  - Plan 优先：复杂改动先出方案，人 review plan 再写代码
  - 小步实施：每完成一个 Task 立刻跑测试/type check，绝不积压
  - 三层兜底：规则文件（方向）+ 测试（回归）+ Code Review（设计）
  - 留意 AI 代码三个典型问题：过度抽象、无意义兜底 try-catch、自作主张加新依赖
first_principle:
  essence: AI 编程 = 多层兜底 + 尽早验证
  derivation: AI 输出不确定 → 单点验证不可靠 → 多层兜底（规则/测试/review）→ 每层成本递增 → 尽早介入（小步实施）才能在低成本层 catch 问题
  conclusion: AI 编程的质量不在"AI 多强"，而在"你的兜底体系多完善"
follow_up:
- AI 生成的代码怎么判断"过度抽象"？
- 怎么写好 CLAUDE.md？哪些内容必须写？
- 多模型交叉验证（让 Codex/Gemini 互 review）实际怎么做？
memory_points:
- 标准流程：先写CLAUDE.md定规矩，复杂改动先出plan，小步实施每步跑测试
- 质量三层兜底：规则文件(约束方向)、单测/集成(防回归)、人工Review(抓设计)
- TDD驱动：让AI先写测试再写实现，或改完立刻跑测试验证，绝不积压改动
- Review抓AI典型问题：过度抽象、无意义兜底(try-except pass)、自作主张加新依赖
---

# 【字节飞连面经】AI 编程工具的使用流程？怎么保证 AI 生成代码质量？

## 一、标准使用流程

```
[1] 先在 CLAUDE.md 写项目规则
    │  架构约定、命名规范、禁忌操作
    │  （"不准 mock 数据库""不准跳过 lint"）
    │  这是 AI 编程的"宪法"
    ▼
[2] 用 plan 模式让它先出方案
    │  复杂改动先出 plan，人 review plan
    │  比让它一上来狂改文件靠谱
    ▼
[3] 小步实施 + 每步跑测试
    │  每完成一个 Task 立刻跑测试 / type check
    │  绝不积压一堆改动后才验证
    ▼
[4] 完成后人工 review diff
    │  + 跑完整测试套件
    │  + type check + lint
```

## 二、质量三层兜底

| 层 | 作用 | 成本 |
|----|------|------|
| **项目规则文件**（CLAUDE.md） | 约束生成方向（写什么、不写什么） | 低（写一次） |
| **单测/集成测试** | 防回归（改了不能坏） | 中（要维护） |
| **人工 Code Review** | catch 设计问题（AI 看不到的） | 高（每 PR 都要） |

**为什么必须三层**：单层都有盲区——规则文件管不住细节、测试管不住设计、Code Review 管不住大规模回归。

## 三、测试驱动

- 让 AI **先写测试再写实现**（TDD）
- 或改完立刻让它跑现有测试
- 测试覆盖率不够的地方，让 AI 先补测试再改

## 四、Code Review：留意 AI 三个典型问题

| 问题 | 表现 | 怎么 catch |
|------|------|-----------|
| **过度抽象** | 简单逻辑套一堆 interface/factory | 看是否有"用不到的抽象层" |
| **无意义的兜底 try-catch** | `try: ... except: pass` 吞掉异常 | 搜 `except Exception` / `except: pass` |
| **自作主张加新依赖** | 为了一个小功能引入整个库 | 看 `package.json` / `requirements.txt` diff |

## 五、加分点

- 提到自己有一套 **keyboard shortcut / hook 配置 / custom skill**，说明是深度用户而不是偶尔玩玩
- **多模型交叉验证**：复杂决策让另一个模型（Codex / Gemini）独立 review 一次，catch 单模型盲点

## 六、雷区

- ❌ "让 AI 一次性改完所有再 review" → 出问题定位困难
- ❌ "AI 写的代码跑通就 merge" → 没人工 review 容易埋雷
- ❌ "不写 CLAUDE.md，每次重新解释项目规则" → 重复劳动 + 不一致

## 七、扩展

- **CLAUDE.md 必写内容**：架构分层（哪层依赖哪层）、命名规范、禁忌操作（不准 mock DB / 不准跳过 lint）、测试约定（怎么跑）、性能红线
- **hook 配置**：pre-commit hook 自动跑 lint+test，AI 改完自动验证
- **AI 编程的边界**：架构决策、安全敏感（鉴权/加密）、业务核心逻辑，这些 AI 可以辅助但人来拍板

## 记忆要点

- 标准流程：先写CLAUDE.md定规矩，复杂改动先出plan，小步实施每步跑测试
- 质量三层兜底：规则文件(约束方向)、单测/集成(防回归)、人工Review(抓设计)
- TDD驱动：让AI先写测试再写实现，或改完立刻跑测试验证，绝不积压改动
- Review抓AI典型问题：过度抽象、无意义兜底(try-except pass)、自作主张加新依赖

