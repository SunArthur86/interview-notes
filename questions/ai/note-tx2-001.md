---
id: note-tx2-001
difficulty: L3
category: ai
subcategory: Agent
tags:
- 腾讯
- 面经
- Agent
- Planning
- Memory
feynman:
  essence: Agent 四大核心组件——Planning(规划)把复杂任务拆成步骤，Memory(记忆)存历史上下文，Tool(工具)扩展与外部世界交互，Action(行动)执行具体操作。四者构成"感知-决策-执行"闭环：Planning 决定做什么，Tool 提供能力，Action 执行，Memory 记录反馈。LLM 是大脑，四大组件是手脚和记事本。
  analogy: 像一个厨师——Planning 是菜谱步骤（先切后炒），Memory 是尝过的味道记事本，Tool 是锅碗刀灶，Action 是真正动手切菜/开火。大脑（LLM）指挥，但没手脚（Tool/Action）做不出菜，没记事本（Memory）记不住口味偏好。
  first_principle: Agent 区别于纯 LLM 的本质是"能行动"。LLM 只能说，Agent 能做。四组件分别解决：做什么(Planning)、记得什么(Memory)、能调用什么(Tool)、怎么执行(Action)。
  key_points:
  - 'Planning：把复杂任务拆解成步骤（CoT/ReAct/ToT/Plan&Execute）'
  - 'Memory：短期会话+长期向量记忆，存历史供检索'
  - 'Tool：扩展能力边界，调API/DB/代码/搜索引擎'
  - 'Action：执行具体操作（调工具/改状态/产出结果）'
  - '四者构成"感知-决策-执行-反馈"闭环'
first_principle:
  essence: Agent = LLM 大脑 + 四组件手脚
  derivation: LLM 只能说不能做 → 加 Tool 扩展能力 → 加 Planning 拆解复杂任务 → 加 Memory 积累经验 → 加 Action 执行 → 形成能行动的闭环
  conclusion: Agent 不是"更强的 LLM"，而是"LLM + 行动能力"的系统
follow_up:
- Planning 的四种范式（CoT/ReAct/ToT/Plan&Execute）怎么选？
- Memory 的短期/长期/向量记忆怎么分工？
- Tool 和 Action 有什么区别？
---

# 【某讯面经】什么是 Agent？核心组件（Planning、Memory、Tool、Action）作用分别是什么？

## 一、Agent 的定义

**Agent = LLM + 感知 + 记忆 + 规划 + 工具使用 + 行动**，目标导向、自主探索。

区别于纯 LLM：
- **LLM**：输入 → 生成文本 → 输出（一次性）
- **Agent**：输入 → 规划 → 调工具 → 观察结果 → 反思 → 再规划 → ... → 达成目标

## 二、四大核心组件

```
                ┌─────────────┐
                │  LLM（大脑）  │
                └──────┬──────┘
                       │
        ┌──────────────┼──────────────┐
        ▼              ▼              ▼
   ┌─────────┐   ┌─────────┐   ┌─────────┐
   │Planning │   │ Memory  │   │  Tool   │
   │ 规划    │   │  记忆   │   │  工具   │
   └────┬────┘   └─────────┘   └────┬────┘
        │                            │
        └──────────┬─────────────────┘
                   ▼
              ┌─────────┐
              │ Action  │
              │  行动   │
              └─────────┘
```

### 1. Planning（规划）—— 决定做什么
把复杂任务拆成可执行步骤。

```
用户："帮我分析这个月的销售数据并给出建议"

Planning 拆解：
  Step 1: 查询本月销售数据（调 DB）
  Step 2: 计算同比环比（调计算工具）
  Step 3: 分析趋势和异常（LLM 推理）
  Step 4: 生成建议（LLM 生成）
  Step 5: 输出报告（写文件）
```

**范式**：CoT（链式）、ReAct（思考-行动-观察循环）、ToT（树状探索）、Plan&Execute（先规划后执行）。

### 2. Memory（记忆）—— 记得什么
存历史上下文，供检索复用。

| 类型 | 内容 | 存储 |
|------|------|------|
| 短期记忆 | 当前会话上下文 | 内存 / Redis |
| 长期记忆 | 用户偏好、历史结论 | 数据库 |
| 向量记忆 | 知识库、文档 | 向量库（Milvus/FAISS） |

### 3. Tool（工具）—— 能调用什么
扩展能力边界，与外部世界交互。

```
工具类型：
  - 信息获取：搜索引擎、知识库检索、DB查询
  - 计算：代码执行（Python REPL）、计算器
  - 操作：发邮件、调API、改文件
  - 感知：图片识别、语音转文字
```

### 4. Action（行动）—— 怎么执行
真正执行操作（调工具、改状态、产出结果）。

**Tool vs Action 区别**：
- **Tool** 是"能力清单"（有哪些工具可用）
- **Action** 是"执行行为"（真正调用某工具产生效果）

## 三、四组件如何协作（闭环）

```
用户输入
  ↓
[Planning] 拆解任务，生成计划
  ↓
[Memory] 检索相关历史上下文
  ↓
[Tool] 选择合适的工具
  ↓
[Action] 执行工具调用
  ↓
观察结果
  ↓
[Planning] 反思：是否完成？需要再规划吗？
  ↓ (未完成) 回到 Planning
  ↓ (完成)
输出结果
  ↓
[Memory] 写入本次结论供未来复用
```

## 四、出行/客服场景实例

```
用户："我昨天打的订单多收钱了"

[Planning]
  Step 1: 查用户昨天订单 → [Tool] DB查询
  Step 2: 算实际应收金额 → [Tool] 计算工具
  Step 3: 对比多收多少 → [Action]
  Step 4: 如多收则退款 → [Tool] 退款API（需权限）
  Step 5: 记录客诉 → [Memory] 写客诉库

[Memory] 检索：该用户历史客诉（判断是否高频投诉）
[Tool] 调用：订单DB、计算、退款API
[Action] 执行：查单、算账、退款
```

## 五、加分点

- 说出 **Agent vs Workflow 区别**：Workflow 是固定流程（确定性），Agent 是 LLM 动态决策（灵活性）。复杂场景用 Agent，简单场景用 Workflow。
- 说出 **四组件的依赖关系**：Planning 依赖 Memory（历史上下文），Action 依赖 Tool（能力边界），Memory 依赖 Action（执行结果写入）。
- 说出 **Anthropic 的 Agent 定义**："Agent 是 LLM 动态指挥流程和工具使用，自主决定如何完成任务"（区别于固定流程的 Workflow）。

## 六、雷区

- ❌ "Agent 就是套了壳的 LLM" → 缺四组件就不是 Agent
- ❌ "Planning 就是 CoT" → CoT 只是 Planning 的一种范式
- ❌ "Memory 就是存对话历史" → 还有长期记忆和向量记忆

## 七、扩展

- **Reflection（反思）**：第五个隐性组件——执行后评估"做得对不对"，是 Agent 自我进化的关键
- **Multi-Agent**：多个 Agent 分工协作（Planner/Executor/Critic），处理更复杂任务
- **Computer Use**：Anthropic 的能力，Agent 直接操作电脑（点击/输入/截屏），Tool 扩展到 GUI
