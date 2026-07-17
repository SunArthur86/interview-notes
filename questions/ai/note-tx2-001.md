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
  - Planning：把复杂任务拆解成步骤（CoT/ReAct/ToT/Plan&Execute）
  - Memory：短期会话+长期向量记忆，存历史供检索
  - Tool：扩展能力边界，调API/DB/代码/搜索引擎
  - Action：执行具体操作（调工具/改状态/产出结果）
  - 四者构成"感知-决策-执行-反馈"闭环
first_principle:
  essence: Agent = LLM 大脑 + 四组件手脚
  derivation: LLM 只能说不能做 → 加 Tool 扩展能力 → 加 Planning 拆解复杂任务 → 加 Memory 积累经验 → 加 Action 执行 → 形成能行动的闭环
  conclusion: Agent 不是"更强的 LLM"，而是"LLM + 行动能力"的系统
follow_up:
- Planning 的四种范式（CoT/ReAct/ToT/Plan&Execute）怎么选？
- Memory 的短期/长期/向量记忆怎么分工？
- Tool 和 Action 有什么区别？
memory_points:
- 一句话定义：Agent=LLM+感知+记忆+规划+工具+行动，目标导向的动态自控系统
- 四大组件闭环：Planning拆任务，Memory供上下文，Tool给能力，Action去执行
- 概念辨析：Tool是静态的能力清单，而Action是动态的具体执行行为
- 核心区分：Agent是LLM动态决策（灵活），而Workflow是固定流程（确定）
- 隐性加分项：Reflection（反思机制）是Agent自我纠错与进化的关键
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

## 记忆要点

- 一句话定义：Agent=LLM+感知+记忆+规划+工具+行动，目标导向的动态自控系统
- 四大组件闭环：Planning拆任务，Memory供上下文，Tool给能力，Action去执行
- 概念辨析：Tool是静态的能力清单，而Action是动态的具体执行行为
- 核心区分：Agent是LLM动态决策（灵活），而Workflow是固定流程（确定）
- 隐性加分项：Reflection（反思机制）是Agent自我纠错与进化的关键


## 苏格拉底式面试追问

> 这组追问模拟面试官层层逼问，每一问先回答"为什么"，再回答"怎么做"，最后回答"如何证明"。

### 第一层：目标与动机

**Q：Agent 的四大组件（Planning、Memory、Tool、Action）为什么是这四个，少了哪个不行？**

少 Planning 不行——没有规划，LLM 只能"被动响应"单步指令，无法拆解复杂任务；少 Memory 不行——没有记忆，每步都是"失忆状态"，无法积累上下文；少 Tool 不行——没有工具，LLM 只能"动嘴"不能"动手"（不能查数据库、调 API）；少 Action 不行——没有执行，规划永远是"纸上谈兵"。四者构成"感知-决策-执行"闭环：Planning 决定做什么，Tool 提供能力，Action 执行，Memory 记录反馈。任何一个缺失，闭环断开，就不叫 Agent 而是 LLM。

### 第二层：证据与定位

**Q：Agent 在某步"卡住"（不调用工具也不输出），怎么定位是 Planning 坏了还是 Tool 坏了？**

看 LLM 的输出。1) 如果 LLM 输出了 Thought 但没输出 tool_call（如"我应该查一下订单"但没调 search_order），是 Planning 或 Tool 选择环节的问题（可能工具 schema 没拼进 prompt，或 LLM 不知道何时调用）；2) 如果 LLM 输出了 tool_call 但工具执行报错后 LLM 没继续，是 Action 后的反馈处理问题（错误信息没正确拼回 context）。用 trace 看 LLM 的 raw output，区分"没想调用"和"调用了但失败"。

### 第三层：根因深挖

**Q：Agent 在多步任务里越走越偏，根因是 Planning 能力不够还是 Memory 丢信息？**

看 Planning 的 input context。1) 如果 input context 里缺少关键前置结果（如第 3 步的结果没传给第 5 步的 Planning），是 Memory 的召回/拼装问题；2) 如果 input context 信息完整但 Planner 还是规划错，是 LLM 的规划能力问题（可能模型太小或 prompt 不够明确）。区分方法：人工检查每步 Planning 的 input，看是否有"应该有但没有"的信息。Memory 问题的修复（优化召回）通常比 Planning 问题的修复（换大模型）成本低，先查 Memory。

**Q：那为什么不直接用支持超长 context 的模型（如 1M），把所有历史都塞进去，避免 Memory 丢失？**

成本和注意力。1M context 的推理成本是 8K 的 100+ 倍，且注意力衰减严重（lost in the middle）。更关键的是"塞进去不等于用得上"——LLM 在长 context 里对中间位置信息的利用率显著下降。Memory 的价值不是"装得多"而是"按需精准召回"——只把当前步骤相关的信息拼进 context，信噪比最高。所以 Memory 是"主动管理信息流"，超长 context 是"被动全量塞入"，前者效果通常更好。

### 第四层：方案权衡

**Q：Planning 用"一次规划完整流程"还是"逐步规划"（ReAct 式），怎么选？**

权衡"全局视野 vs 执行灵活性"。一次规划（Plan & Execute）——开始就规划所有步骤，全局视野好，但中间结果出来后可能要重规划；逐步规划（ReAct）——每步根据上一步结果决定下一步，灵活，但缺乏全局视野（可能走偏）。经验上：步骤明确的长任务（如"查数据→分析→生成报告"）用一次规划；探索性任务（如"调试一个 bug"）用逐步规划。混合方案：先一次规划骨架，执行时允许局部调整。

**Q：为什么不直接把 Planning、Memory、Tool 全塞进一个大模型（不分离组件），简化架构？**

能力会相互干扰。一个模型同时做规划、记忆管理、工具选择，每项的准确率都下降（注意力被稀释）。分离组件让每个组件专注一项，准确率更高。如 Memory 单独做向量召回（精准）、Tool 选择单独做（schema 清晰）、Planning 用大模型（推理强）。代价是组件间通信开销，但通过结构化接口可以最小化。所以组件化是"用工程复杂度换模型准确度"，在能力多样时净收益为正。

### 第五层：验证与沉淀

**Q：怎么衡量 Agent 各组件的协作是否有效？**

端到端 + 组件级双层指标。1) 端到端——task_success_rate、平均步数、用户满意度；2) 组件级——Planning 的规划准确率（是否符合预期步骤）、Memory 的召回精确率、Tool 的 tool_call_success_rate、Action 的执行成功率。如果端到端成功率低但各组件指标都高，说明组件间衔接有问题（如 Memory 召回了但没拼进 Planning 的 context）。沉淀为组件协作诊断手册：每层指标的基线和异常排查路径。

## 结构化回答

**30 秒电梯演讲：** Agent 四大核心组件——Planning(规划)把复杂任务拆成步骤，Memory(记忆)存历史上下文，Tool(工具)扩展与外部世界交互，Action(行动)执行具体操作。

**展开框架：**
1. **Planning** — 把复杂任务拆解成步骤（CoT/ReAct/ToT/Plan&Execute）
2. **Memory** — 短期会话+长期向量记忆，存历史供检索
3. **Tool** — 扩展能力边界，调API/DB/代码/搜索引擎

**收尾：** 您想深入聊：Planning 的四种范式（CoT/ReAct/ToT/Plan&Execute）怎么选？


## 视频脚本

> 预计时长：4 分钟 | 由浅入深


| 时间 | 画面/字幕 | 口播台词 | 讲解要点 |
|------|----------|----------|----------|
| 0:00 | 标题卡：什么是 Agent？核心组件（Planning… | "像一个厨师——Planning 是菜谱步骤（先切后炒），Memory 是尝过的味道记事本…" | 开场钩子 |
| 0:20 | 核心概念图 | "Agent 四大核心组件——Planning(规划)把复杂任务拆成步骤，Memory(记忆)存历史上下文，Tool(工具…" | 核心定义 |
| 0:50 | Planning示意图 | "Planning——把复杂任务拆解成步骤（CoT/ReAct/ToT/Plan&Execute）" | 要点拆解1 |
| 1:30 | 对比/实战案例图 | "对比一下常见误区和工程实践，看真实场景里怎么取舍。" | 实战与对比 |
| 2:20 | 总结卡 | "记住核心要点。下期我们追问：Planning 的四种范式（CoT/ReAct/ToT/P？" | 收尾与钩子 |
