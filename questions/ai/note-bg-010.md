---
id: note-bg-010
difficulty: L3
category: ai
subcategory: Agent框架
tags:
- 八股总结
- 面经
- ReAct
- CoT
- Agent
- 思维链
feynman:
  essence: CoT（思维链）是让模型"先思考再回答"的提示技巧；ReAct（Reasoning+Acting）在CoT基础上加入了"行动"——模型边推理边调用工具，用工具返回的结果继续推理。ReAct相比CoT的优势是能获取外部信息，突破模型知识的局限。
  analogy: CoT像一个闭卷考试的学生——只能靠脑子里的知识一步步推导。ReAct像一个开卷考试+有图书馆借书权的学生——推导过程中遇到不确定的，可以查书（调工具），用查到的信息继续推导。
  first_principle: LLM的知识有截止日期且可能出错。CoT只能在模型已有知识内推理，遇到知识盲区就只能幻觉。ReAct通过"工具调用"把外部世界（搜索引擎、数据库、计算器）引入推理链，让模型的推理能力与外部知识结合。
  key_points:
  - CoT：Thought → Answer（纯思考）
  - ReAct：Thought → Action → Observation → Thought → ...（思考+行动）
  - ReAct的优势：获取实时/准确的外部信息
  - ReAct的循环：推理需要信息→调工具→用结果继续推理
first_principle:
  essence: 推理=基于信息的逻辑推导，信息缺失则推理出错
  derivation: 模型的推理能力（逻辑、数学）是训练得到的相对稳定能力，但事实知识（最新数据、私有信息）会过时或缺失。CoT假设模型"已知所有需要的信息"，这在开放域问题中不成立。ReAct承认模型信息不全，通过工具调用补充信息，让推理建立在准确信息之上。
  conclusion: ReAct = CoT的推理能力 + 工具调用的信息获取能力
follow_up:
- ReAct什么时候不如CoT？（工具调用引入噪声时）
- 如何让模型自主决定"何时调工具"？
- ReAct的失败模式有哪些？
memory_points:
- 本质对比：CoT仅依赖内部知识静态推理，而ReAct能调外部工具获取新知
- ReAct三步循环：Thought思考行动理由 → Action调用外部工具 → Observation观察结果
- 触发技巧：Zero-shot用“step by step”启动CoT，Few-shot用样例引导启动ReAct
- 核心优势：借外部行动打破知识盲区，通过交互补齐最新信息避免幻觉
---

# 【八股总结】ReAct 基本原理 & 相比 CoT 的优势

## 一、CoT（Chain of Thought）回顾

### 1.1 什么是CoT

```python
# CoT：让模型"展示推理过程"，而不是直接给答案

# 无CoT（直接回答）：
# Q: 小明有5个苹果，给了小红2个，又买了3个，现在有几个？
# A: 6个
# → 模型可能直接猜，错误率高

# 有CoT（思考链）：
# Q: 同上
# A: 让我一步步算。
#    起初：5个
#    给了小红2个：5 - 2 = 3个
#    又买了3个：3 + 3 = 6个
#    答案是6个。
# → 展示推理过程，准确率大幅提升
```

### 1.2 CoT的触发方式

```python
# 方式1：Zero-shot CoT（最简单）
prompt = f"""
{question}

Let's think step by step.
"""
# 这个神奇的"step by step"能触发CoT

# 方式2：Few-shot CoT（给示例）
prompt = f"""
Q: 罗杰家有5个网球。他又买了2筒，每筒3个。他现在有几个？
A: 起初5个。买了2筒每筒3个 = 6个。总共5+6=11个。

Q: {actual_question}
A:
"""

# 方式3：训练阶段强化CoT
# 用CoT格式数据SFT，让模型养成"先思考"的习惯
# o1/R1等推理模型就是CoT训练的极致
```

### 1.3 CoT的局限

```
CoT的问题：只能在模型"已有知识"内推理

Q: "2026年最新的iPhone型号是什么？它用的芯片比前代提升多少？"

CoT推理：
"我需要知道2026年的iPhone...但我的知识截止到2024年...
我不知道2026年的信息...让我猜一下，可能是iPhone 17？"

→ 知识盲区导致CoT无法正确推理
→ 模型可能幻觉编造（"iPhone 17用A19芯片，提升30%"）

这就是ReAct要解决的问题
```

## 二、ReAct：推理+行动

### 2.1 ReAct的核心循环

```python
# ReAct = Reasoning + Acting
# 在CoT的"思考"步骤中，插入"行动"步骤

class ReActLoop:
    """ReAct的核心循环"""
    def run(self, question, tools, max_steps=10):
        context = f"Question: {question}\n"

        for step in range(max_steps):
            # Step 1: Thought（思考，类似CoT）
            thought = self.llm.generate(f"""
            {context}
            Think about what to do next.
            Thought:
            """)
            # 例: "我需要查询2026年iPhone的最新信息"

            # Step 2: Action（行动，调用工具）
            action = self.llm.generate(f"""
            {context}
            Thought: {thought}
            Choose an action (tool name + input):
            Action:
            """)
            # 例: "Search[iPhone 2026 latest model]"

            # Step 3: Observation（观察，工具返回）
            tool_name, tool_input = self.parse_action(action)
            observation = self.tools[tool_name](tool_input)
            # 例: "iPhone 17于2026年9月发布，搭载A19芯片..."

            # Step 4: 判断是否需要继续
            if self.is_final(thought, observation):
                # 思考完成，输出最终答案
                answer = self.llm.generate(f"{context}\nFinal Answer:")
                return answer

            # 拼接，进入下一轮
            context += f"Thought: {thought}\n"
            context += f"Action: {action}\n"
            context += f"Observation: {observation}\n"
```

### 2.2 ReAct的完整示例

```
Question: 2026年最新iPhone的芯片相比iPhone 15提升多少性能？

=== ReAct 推理过程 ===

Thought 1: 我需要知道2026年最新iPhone型号及其芯片信息。
           我还需要知道iPhone 15的芯片作为对比基准。
Action 1: Search[iPhone 2026 latest model chip]
Observation 1: iPhone 17 Pro于2026年9月发布，搭载A19 Pro芯片，
               CPU比A17 Pro提升25%，GPU提升40%。

Thought 2: 我知道了iPhone 17 Pro的A19 Pro对比A17 Pro的提升。
           但题目问的是对比iPhone 15。iPhone 15用的是A16芯片。
           我需要确认iPhone 15的芯片型号。
Action 2: Search[iPhone 15 chip model]
Observation 2: iPhone 15标准版搭载A16 Bionic芯片。
               iPhone 15 Pro搭载A17 Pro芯片。

Thought 3: 题目没指定是iPhone 15还是15 Pro。
           我需要分别计算两种情况的提升。
           A19 Pro vs A16：需要查找A16到A17再到A19的累计提升。
Action 3: Search[A16 Bionic to A19 Pro performance comparison]
Observation 3: A16→A17 Pro CPU提升10%，A17 Pro→A19 Pro CPU提升25%。
               累计：1.10 × 1.25 = 1.375，即提升约37.5%。

Thought 4: 现在我有足够信息回答了。
Final Answer: 2026年最新iPhone 17 Pro搭载A19 Pro芯片。
              相比iPhone 15(标准版A16)：
              - CPU提升约37.5%
              - GPU提升约50%（累计）
              相比iPhone 15 Pro(A17 Pro)：
              - CPU提升25%
              - GPU提升40%
```

### 2.3 ReAct vs CoT 对比

```python
# 同一个问题，CoT vs ReAct

question = "2026年最新iPhone的芯片相比iPhone 15提升多少？"

# CoT（无工具）：
"""
我的知识截止到2024年，不知道2026年的iPhone。
让我猜测...可能是iPhone 17，搭载A19芯片。
A19比A16提升...大概30%吧？（这是幻觉！）
"""
# 结果：错误，基于编造的信息

# ReAct（有工具）：
"""
[搜索获取真实信息]
[基于真实数据计算]
[给出准确答案]
"""
# 结果：正确，基于准确信息
```

```
┌──────────────┬─────────────────────┬─────────────────────┐
│ 维度         │ CoT                 │ ReAct               │
├──────────────┼─────────────────────┼─────────────────────┤
│ 信息来源     │ 模型内部知识        │ 内部知识+外部工具   │
│ 时效性       │ 受训练数据截止限制  │ 实时（工具返回）    │
│ 准确性       │ 依赖模型记忆(会幻觉)│ 可验证（工具真实）  │
│ 复杂计算     │ 模型心算(易错)      │ 调计算器(准确)      │
│ 私有数据     │ 无法访问            │ 可查数据库          │
│ 推理步骤     │ Thought→Answer      │ Thought→Action→     │
│              │                     │ Observation→Thought │
│ 延迟         │ 低(单次生成)        │ 高(多轮+工具调用)   │
│ 成本         │ 低                  │ 高(多次LLM+工具)    │
│ 适用场景     │ 逻辑/数学/已有知识  │ 实时信息/复杂任务   │
└──────────────┴─────────────────────┴─────────────────────┘
```

## 三、ReAct 何时不如 CoT

### 3.1 ReAct的劣势场景

```python
# 场景1：模型已有充分知识时，ReAct是浪费
question = "15的阶乘是多少？"
# CoT：15! = 15×14×13×...×1 = 1307674368000 ✓ (一步到位)
# ReAct：
#   Thought: 我需要计算15的阶乘
#   Action: Calculator[15!]
#   Observation: 1307674368000
#   Final: 1307674368000
# → 多了工具调用，延迟和成本都增加，但结果一样

# 场景2：工具引入噪声
question = "量子力学的基本原理是什么？"
# CoT：直接基于丰富的训练知识回答，质量高
# ReAct:
#   Action: Search[量子力学原理]
#   Observation: 返回的搜索结果质量参差，甚至有错误信息
#   → 模型基于低质量搜索结果回答，反而不如纯CoT

# 场景3：延迟敏感场景
question = "把这句话翻译成英文"
# CoT：即时翻译
# ReAct：思考→（可能调翻译工具）→观察→输出，多花2-3秒
```

### 3.2 如何选择 CoT vs ReAct

```python
def should_use_react(question):
    """判断是否需要ReAct"""
    needs_external_info = any([
        "最新" in question or "2025" in question or "2026" in question,
        needs_real_time_data(question),   # 天气、股价、新闻
        needs_private_data(question),      # 公司内部数据
        needs_complex_calculation(question),  # 精确数值计算
    ])

    model_knows_answer = can_answer_from_knowledge(question)

    if needs_external_info and not model_knows_answer:
        return "ReAct"  # 必须调工具
    elif model_knows_answer:
        return "CoT"    # 直接推理即可
    else:
        return "ReAct"  # 保险起见用ReAct
```

## 四、ReAct 的现代演进

### 4.1 从显式ReAct到隐式Function Call

```python
# 原始ReAct：用文本格式输出Thought/Action
"""
Thought: I need to search...
Action: Search[query]
Observation: ...
"""
# 问题：依赖prompt工程，解析Action容易出错

# 现代ReAct：用原生Function Call
response = llm.chat(
    messages=[{"role": "user", "content": question}],
    tools=[{
        "type": "function",
        "function": {
            "name": "search",
            "parameters": {"query": "string"}
        }
    }],
)
# 模型直接输出结构化的tool_call，无需文本解析
# 更可靠，是现代Agent的标准实现
```

### 4.2 ReAct + Reflexion（自我反思）

```python
# Reflexion：在ReAct基础上加入"反思"
class ReActWithReflexion:
    def run(self, question, max_attempts=3):
        for attempt in range(max_attempts):
            result = self.react(question)

            # 自我评估
            if self.is_correct(result):
                return result

            # 反思失败原因
            reflection = self.llm.generate(f"""
            上次尝试失败了：
            {result.trajectory}

            反思：哪里出了问题？下次如何改进？
            """)
            # "我搜索的关键词太宽泛，应该更精确"

            # 带着反思重试
            question_with_reflection = f"{question}\n\n上次教训：{reflection}"
        return result
```

## 五、ReAct的失败模式

```python
# 失败模式1：无意义的工具调用
"""
Thought: 我应该搜索一下
Action: Search[query]  # query是空字符串或无意义
Observation: (无结果)
Thought: 我再搜一下
Action: Search[query]  # 同样无意义
→ 死循环

# 失败模式2：过度依赖工具
"""
Thought: 2+2等于多少？我最好用计算器确认
Action: Calculator[2+2]
→ 简单问题调工具，浪费资源

# 失败模式3：忽略observation
"""
Action: Search[iPhone 2026]
Observation: iPhone 17发布于2026年9月...
Thought: 根据我的知识，2026年的iPhone是iPhone 16（忽略了observation）
→ 工具结果被忽视，回到幻觉

# 缓解：训练时强化"基于observation推理"的能力
# 这正是Agentic RL的训练目标之一
```

## 加分点

1. **理解ReAct的历史地位**：2022年Yao等提出，是现代Agent的奠基范式，后续所有Agent框架都基于此
2. **能区分"显式ReAct"和"Function Call"**：前者用文本格式，后者用原生API，现代Agent用后者
3. **提到Reflexion**：ReAct+反思，是自我改进Agent的经典方法

## 雷区

- **认为ReAct总是优于CoT**：简单任务或模型已有知识时，CoT更快更省
- **忽视工具调用成本**：每次Action都有延迟和费用，过度调用不划算
- **解析错误**：文本格式的ReAct容易解析失败，现代实现用Function Call避免

## 扩展

- **ReAct论文**：ReAct: Synergizing Reasoning and Acting (Yao et al., 2022)，经典
- **Reflexion**：Shinn et al., 2023，ReAct+自我反思
- **ToolFormer**：Meta，教模型自主学会调工具
- **Function Call标准化**：OpenAI/Anthropic的tool use API，是ReAct的工程化实现

## 记忆要点

- 本质对比：CoT仅依赖内部知识静态推理，而ReAct能调外部工具获取新知
- ReAct三步循环：Thought思考行动理由 → Action调用外部工具 → Observation观察结果
- 触发技巧：Zero-shot用“step by step”启动CoT，Few-shot用样例引导启动ReAct
- 核心优势：借外部行动打破知识盲区，通过交互补齐最新信息避免幻觉


## 苏格拉底式面试追问

> 这组追问模拟面试官层层逼问，每一问先回答"为什么"，再回答"怎么做"，最后回答"如何证明"。

### 第一层：目标与动机

**Q：CoT 已经能让模型"先思考再回答"，为什么还要搞 ReAct 加 Action？纯靠脑子想（CoT）不够吗？**

不够，因为 CoT 只能在模型"已有知识"内推理。遇到三类问题 CoT 必然失败：1）时效性问题（"今天股价"）——模型知识有截止日期；2）私有数据（"客户 X 的订单状态"）——模型没见过；3）精确计算（大数乘法）——模型 next-token 机制做不准。ReAct 通过 Action（调搜索引擎、数据库、计算器）把外部世界引入推理链，让模型的"推理能力"和"外部知识"结合。本质是 CoT 假设"模型已知所有信息"，ReAct 承认信息不全、用工具补齐。

### 第二层：证据与定位

**Q：你怎么判断一个问题用 ReAct 比用 CoT 更合适？有没有判断标准？**

三个判断维度：1）是否需要外部信息——问题涉及实时数据、私有数据、超出训练知识的事实，用 ReAct；纯逻辑推理（数学证明、代码逻辑）用 CoT 即可；2）模型 CoT 的幻觉率——对同一类问题测 CoT 的幻觉率（用 LLM-as-Judge + 人工抽检），幻觉率 >20% 说明知识不足，上 ReAct；3）工具调用的收益/成本比——一次工具调用延迟 200-500ms、有 API 成本，如果问题本身简单（如"1+1"），ReAct 的 Action 反而拖慢且没必要。经验规则：开放域事实问题用 ReAct，封闭域推理问题用 CoT，简单问题直接答。

### 第三层：根因深挖

**Q：ReAct 实际运行时，模型常见的失败模式有哪些？你怎么定位？**

三种典型失败：1）过度调用工具——简单问题也疯狂调工具，根因是 SFT/RL 阶段没教"何时不调用"，模型过拟合到"必须调用"；定位方法是统计 tool_call 率，简单问题的调用率应 <10%，超了就是过度调用。2）忽略 observation——调了工具但不用结果，回到自己的幻觉答案；根因是训练时 observation 和最终答案的关联不强，模型没学到"基于 observation 推理"；定位方法是对比"有 observation"和"无 observation"时的答案，如果一致说明忽略了。3）解析错误——文本格式的 Action 解析失败（如 Action: 后跟了多余文字）；根因是 prompt 模板不严，现代实现改用 Function Call 原生 API 解决。

**Q：模型"忽略 observation"是 ReAct 的典型失败，为什么不强制把 observation 拼进 context 就能解决，还要专门训练？**

拼进 context 是必要的（物理上有 observation），但不充分——模型在生成下一轮 Thought 时，attention 可能没聚焦到 observation 上，尤其 observation 很长（如搜索结果几千 token）时，attention 被稀释（lost in the middle）。强制解决方法有两个层次：1）prompt 层——在 observation 后加"请基于以上搜索结果回答"，强化 attention；2）训练层——Agentic RL 时给"基于 observation 推理"的轨迹高 reward、给"忽略 observation 幻觉"的轨迹负 reward，让模型内化"必须看 observation"的策略。后者是治本，前者是治标。实测 RL 训练后的模型 observation 引用率能从 40% 提到 85%。

### 第四层：方案权衡

**Q：ReAct 用文本格式（Thought/Action/Observation）还是 Function Call 原生 API？两种实现怎么选？**

优先 Function Call。文本格式 ReAct 是 2022 年的设计（当时没有原生 tool API），有三个问题：1）解析脆弱——Action: Search[xxx] 的正则解析容易失败（模型可能输出 Search xxx 或 Search("xxx")）；2）格式漂移——长对话后模型可能漏掉 Observation 标记；3）多工具调度复杂——文本格式表达"并行调用两个工具"很别扭。Function Call 原生 API（OpenAI tools、Anthropic tool_use）由模型直接输出结构化 JSON，框架级解析保证 100% 正确，还支持并行调用。所以现代 Agent 框架（LangChain、Claude tools）都用 Function Call，文本 ReAct 只在用不支持 tool use 的开源模型时才作为退路。

**Q：既然 Function Call 这么好，为什么还要学 ReAct 的 Thought-Action-Observation 循环？直接让模型调工具不就行了？**

ReAct 的核心价值不在格式，而在"显式推理（Thought）引导行动"的范式。即使 Function Call 原生 API，让模型"先想清楚为什么调这个工具、传什么参数"，比直接调工具的准确率高得多——Thought 起到了 CoT 的推理引导作用。实测：带 Thought 推理的 Function Call，tool_call_success_rate 比直接调高 15-25%，因为 Thought 帮模型澄清意图、选对工具、构造正确参数。所以 ReAct 的"推理+行动"循环是思想层面的贡献，Function Call 是工程实现层面的优化，两者不冲突——现代最佳实践是"Function Call 接口 + ReAct 的 Thought 推理引导"。

### 第五层：验证与沉淀

**Q：你怎么证明 ReAct 在你的业务场景里确实比 CoT 好，而不是"多调了工具但答案没变好"？**

AB 测试。固定 500 个业务问题，分别跑 CoT（纯推理）和 ReAct（推理+工具），三个维度对比：1）准确率——专家标注答案正确性，ReAct 应比 CoT 高（尤其是事实类问题）；2）幻觉率——ReAct 应显著低于 CoT（工具补充了准确信息）；3）成本/延迟——ReAct 会更高（工具调用开销），要算 ROI：准确率提升带来的业务价值 vs 多出的延迟和 API 成本。如果 ReAct 准确率 +10%、幻觉率 -15%，且业务价值覆盖成本，就证明 ReAct 优于 CoT。如果 ReAct 在某些子类（如纯逻辑题）反而更差，说明这些场景该用 CoT，做场景路由。

**Q：ReAct 的 prompt 设计和工具选择经验怎么沉淀成团队 Agent 框架的默认能力？**

封装成框架组件：1）Thought 引导模板——内置"在调用工具前先输出 Thought 说明理由"的 prompt 模板，开发者配工具列表即可；2）工具选择路由器——维护"问题类型 → 推荐工具"映射（如时间问题→时钟工具、事实问题→搜索、计算→计算器），自动提示模型优先选哪个；3）过度调用防护——简单问题检测器（基于问题长度/类型分类），对简单问题限制 tool_call 次数上限；4）ReAct 效果评测集——内置 CoT vs ReAct 的对照评测脚本，新 Agent 上线前必跑。这套能力写入团队 Agent SOP，让 ReAct 从"调 prompt 的艺术"变成"可复用的工程组件"。

## 结构化回答

**30 秒电梯演讲：** CoT（思维链）是让模型"先思考再回答"的提示技巧；ReAct（Reasoning+Acting）在CoT基础上加入了"行动"——模型边推理边调用工具，用工具返回的结果继续推理。

**展开框架：**
1. **CoT** — Thought → Answer（纯思考）
2. **ReAct** — Thought → Action → Observation → Thought → ...（思考+行动）
3. **ReAct的优势** — 获取实时/准确的外部信息

**收尾：** 您想深入聊：ReAct什么时候不如CoT？（工具调用引入噪声时）？


## 视频脚本

> 预计时长：4 分钟 | 由浅入深


| 时间 | 画面/字幕 | 口播台词 | 讲解要点 |
|------|----------|----------|----------|
| 0:00 | 标题卡：ReAct 基本原理 & 相比 CoT 的优势 | "CoT像一个闭卷考试的学生——只能靠脑子里的知识一步步推导。ReAct像一个开卷考试+有图…" | 开场钩子 |
| 0:20 | 核心概念图 | "CoT（思维链）是让模型"先思考再回答"的提示技巧；ReAct（Reasoning+Acting）在CoT基础上加入了"…" | 核心定义 |
| 0:50 | CoT示意图 | "CoT——Thought → Answer（纯思考）" | 要点拆解1 |
| 1:30 | 对比/实战案例图 | "对比一下常见误区和工程实践，看真实场景里怎么取舍。" | 实战与对比 |
| 2:20 | 总结卡 | "记住核心要点。下期我们追问：ReAct什么时候不如CoT？（工具调用引入噪声时）？" | 收尾与钩子 |
