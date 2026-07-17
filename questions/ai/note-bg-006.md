---
id: note-bg-006
difficulty: L4
category: ai
subcategory: Agentic RL
tags:
- 八股总结
- 面经
- Agentic RL
- Agent loop
- 工具调用
- token mask
feynman:
  essence: Agentic RL训练Agent用工具解决问题。Agent loop是"模型生成→解析工具调用→执行工具→拼接结果→继续生成"的循环。Token mask的关键：只有模型自己生成的token参与loss，工具返回的observation token被mask掉，否则模型会"偷懒"去记忆工具输出而非学习调用策略。
  analogy: 像训练实习生用计算器算账——他按计算器（生成调用）、看屏幕数字（observation）、继续算。考核时只看他"按对按钮的决策"（生成的token），不能因为他看到了屏幕数字就给分（否则他会变成背数字而不是学算账）。
  first_principle: RL的目标是优化策略π(a|s)。在Agent场景，a=生成的token（含工具调用指令），s=当前上下文。工具返回的observation是环境给的状态转移，不是模型的动作，因此不能算loss——否则模型会优化"如何更好地接收observation"而非"如何更好地决策调用哪个工具"。
  key_points:
  - Agent loop：generate → parse → execute → append → repeat
  - Loss只算模型生成的token（含tool_call指令）
  - observation/tool_result的token全部mask（不参与loss）
  - 多轮交互中，每轮的生成token都算loss
first_principle:
  essence: RL优化的是"动作"而非"状态"，模型生成的token是动作，工具返回是状态
  derivation: Policy gradient ∇J = E[∇logπ(a|s)·R]。在序列建模中，每个token是一个动作a_t，前面的所有token是状态s_t。工具返回的observation是由环境（外部API）产生的，不是从π中采样的，因此∇logπ=0，自然不参与梯度。强行加入会让loss计算错误。
  conclusion: Token mask规则=模型生成的token算loss，环境返回的token不算loss，这是Agent RL训练正确性的基础
follow_up:
- 如果工具返回的observation也参与loss会怎样？
- 多轮Agent中，reward应该给每一轮还是只给最终结果？
- Agent陷入死循环（反复调用同一工具）怎么处理？
memory_points:
- 核心口诀：模型生成token算Loss，环境返回observation全Mask掉
- Agent Loop闭环：模型生成动作→解析工具→环境执行→拼接结果→继续生成
- Loss Mask设计：因工具结果由系统产生，非模型能力，故必须置为False不参与反传
- 架构特点：通过上下文拼接把多轮交互展平，形成有监督的连续生成序列
---

# 【八股总结】Agentic RL 的 Agent loop 如何运行？哪些 token 参与 loss？

## 一、Agent Loop 完整流程

### 1.1 单轮Agent交互示例

```
用户: "北京明天天气怎么样？"

Agent Loop（一轮工具调用）：
┌─────────────────────────────────────────────────────────┐
│ Step 1: 模型生成（生成token，参与loss）                  │
│   "我查一下天气。<tool_call>weather(city=北京)</tool_call>"│
│   ↑ 这些token是模型"动作"，要算loss                       │
├─────────────────────────────────────────────────────────┤
│ Step 2: 解析工具调用                                     │
│   parse → tool="weather", args={"city":"北京"}          │
├─────────────────────────────────────────────────────────┤
│ Step 3: 执行工具（环境，不参与loss）                     │
│   result = weather_api(city="北京")                     │
│   result = "晴天，最高35°C，最低22°C"                    │
├─────────────────────────────────────────────────────────┤
│ Step 4: 拼接observation到上下文（不参与loss）            │
│   <tool_result>晴天，最高35°C，最低22°C</tool_result>   │
│   ↑ 这些token是环境返回的，mask掉                        │
├─────────────────────────────────────────────────────────┤
│ Step 5: 模型继续生成（生成token，参与loss）              │
│   "北京明天晴天，最高35度，最低22度，注意防晒。"          │
│   ↑ 模型基于observation生成最终回答，算loss              │
└─────────────────────────────────────────────────────────┘
```

### 1.2 代码实现

```python
class AgentLoop:
    def __init__(self, model, tools):
        self.model = model
        self.tools = tools

    def run(self, user_query, max_turns=10):
        context = [{"role": "user", "content": user_query}]
        loss_mask = []  # 标记每个token是否参与loss
        all_tokens = []

        for turn in range(max_turns):
            # Step 1: 模型生成
            gen_tokens, gen_mask = self.model.generate(
                context, return_mask=True
            )
            # gen_mask: True表示模型生成的token（参与loss）
            all_tokens.extend(gen_tokens)
            loss_mask.extend(gen_mask)  # [True, True, ...] 生成部分

            # 解析是否调用了工具
            text = self.model.decode(gen_tokens)
            tool_call = self.parse_tool_call(text)

            if tool_call is None:
                # 没有工具调用，生成结束
                break

            # Step 2-3: 执行工具
            result = self.tools[tool_call.name](**tool_call.args)

            # Step 4: 拼接observation（不参与loss）
            obs_tokens = self.model.encode(f"<tool_result>{result}</tool_result>")
            obs_mask = [False] * len(obs_tokens)  # observation全mask
            all_tokens.extend(obs_tokens)
            loss_mask.extend(obs_mask)  # [False, False, ...]

            # 更新context供下一轮生成
            context.append({"role": "assistant", "content": text})
            context.append({"role": "tool", "content": result})

        return all_tokens, loss_mask
```

## 二、Token Mask 详解

### 2.1 哪些token参与loss

```python
# 完整序列的mask示意
sequence = """
[USER] 北京明天天气怎么样？
[ASSISTANT] 我查一下天气。<tool_call>weather(city=北京)</tool_call>
[TOOL_RESULT] 晴天，最高35°C，最低22°C
[ASSISTANT] 北京明天晴天，最高35度，注意防晒。
"""

# Token级别的mask
token_masks = {
    "[USER] 北京明天天气怎么样？":                False,  # 用户输入
    "[ASSISTANT] 我查一下天气。<tool_call>...":   True,   # 模型生成 ✓
    "[TOOL_RESULT] 晴天，最高35°C...":            False,  # 工具返回 ✗
    "[ASSISTANT] 北京明天晴天，注意防晒。":        True,   # 模型生成 ✓
}

# 规则总结：
# - 模型生成的所有token（含tool_call指令）：参与loss ✓
# - 用户输入的token：不参与 ✗
# - 工具返回的observation token：不参与 ✗
# - 系统prompt：不参与 ✗
```

### 2.2 为什么observation不参与loss

```python
# 错误做法：observation参与loss
def wrong_loss(model, full_sequence):
    """把整个序列（含observation）都算loss"""
    logits = model(full_sequence)
    loss = cross_entropy(logits, full_sequence)
    # 问题：模型会优化"如何更好地预测observation"
    # 即学会"记忆/预测工具返回值"
    # 而不是学习"何时调用工具、调用哪个工具"
    return loss

# 后果：
# - 模型可能学会"天气预报API通常返回25-35度"，直接编造结果
# - 不调用工具，而是幻觉生成observation
# - 这完全违背了训练Agent的初衷

# 正确做法：只对模型生成的token算loss
def correct_loss(model, full_sequence, loss_mask):
    """只对mask=True的token（模型生成的）算loss"""
    logits = model(full_sequence)
    # 只取mask为True的位置
    loss = cross_entropy(logits[loss_mask], full_sequence[loss_mask])
    return loss
```

### 2.3 Token mask的实现

```python
# PyTorch实现
import torch

def agentic_rl_loss(logits, labels, loss_mask, advantages):
    """
    logits: [batch, seq_len, vocab_size] 模型输出
    labels: [batch, seq_len] 真实token
    loss_mask: [batch, seq_len] bool，True=参与loss
    advantages: [batch, seq_len] 每个token的优势
    """
    # 1. 计算每个位置的log概率
    log_probs = log_softmax(logits, dim=-1)
    selected_log_probs = log_probs.gather(-1, labels.unsqueeze(-1)).squeeze(-1)
    # [batch, seq_len]

    # 2. 应用mask（只保留模型生成的token）
    masked_log_probs = selected_log_probs * loss_mask.float()
    # observation位置被置0

    # 3. Policy gradient loss
    pg_loss = -(masked_log_probs * advantages).sum() / loss_mask.sum()
    # 每个有效token的loss = -logπ(a) × advantage
    return pg_loss
```

## 三、多轮Agent的训练

### 3.1 多轮轨迹的reward分配

```python
# 多轮Agent的reward分配策略

class MultiTurnAgentTraining:
    def rollout(self, query, max_turns=10):
        trajectory = []
        context = [query]

        for turn in range(max_turns):
            # 模型生成（含可能的tool_call）
            generated = self.model.generate(context)

            # 判断是否完成
            if is_final_answer(generated):
                # 最终答案，计算reward
                reward = self.reward_model(query, generated)
                trajectory.append({
                    "tokens": generated,
                    "mask": True,
                    "reward": reward,
                    "turn": turn,
                })
                break
            else:
                # 工具调用轮
                tool_result = self.execute_tool(generated)
                trajectory.append({
                    "tokens": generated,
                    "mask": True,
                    "reward": 0,  # 中间轮无即时reward
                    "turn": turn,
                })
                trajectory.append({
                    "tokens": tool_result,
                    "mask": False,  # observation不参与loss
                    "reward": 0,
                    "turn": turn,
                })
                context.append(generated)
                context.append(tool_result)

        return trajectory
```

### 3.2 Credit Assignment：reward如何分配到各轮

```python
# 策略1：所有reward归给最后一轮（简单但credit assignment差）
def reward_only_final(trajectory, final_reward):
    for step in trajectory:
        step["advantage"] = final_reward if step["turn"] == trajectory[-1]["turn"] else 0
    # 问题：中间的工具调用轮得不到正向信号，学不到"何时调用工具"

# 策略2：reward均分给所有模型生成轮（GAE/折扣）
def reward_discounted(trajectory, final_reward, gamma=0.95):
    model_turns = [t for t in trajectory if t["mask"]]
    n = len(model_turns)
    for i, step in enumerate(model_turns):
        # 离最终结果越近，reward权重越大
        discount = gamma ** (n - 1 - i)
        step["advantage"] = final_reward * discount
    # 好处：中间轮也能获得部分reward信号

# 策略3：过程奖励（每轮单独打分）
def process_reward(trajectory):
    for step in trajectory:
        if step["mask"]:  # 模型生成轮
            # 每轮单独评估：是否选对了工具、参数是否正确
            step["advantage"] = self.step_reward_model(step)
```

## 四、Agent陷入死循环的处理

### 4.1 死循环的典型模式

```python
# 模型陷入死循环的case
turn 1: <tool_call>search("天气")</tool_call>
turn 2: <tool_call>search("天气")</tool_call>  # 重复！
turn 3: <tool_call>search("天气")</tool_call>  # 继续重复...
turn 4: <tool_call>search("天气")</tool_call>
# ...直到max_turns耗尽

# 根因：
# - 模型没学到"工具已调用过"的意识
# - observation可能不够有用，模型以为"再调一次会变好"
# - RL训练时这类轨迹得低reward，但模型陷入局部最优
```

### 4.2 处理方案

```python
class AntiLoopAgent:
    def run(self, query, max_turns=10):
        tool_call_history = []  # 记录已调用的工具

        for turn in range(max_turns):
            generated = self.model.generate(context)

            tool_call = self.parse(generated)

            # 防重复检查
            call_key = (tool_call.name, str(tool_call.args))
            if call_key in tool_call_history:
                # 重复调用，注入提示
                context.append({
                    "role": "system",
                    "content": f"你刚才已经调用过{tool_call.name}，请尝试其他方法"
                })
                continue  # 不执行，让模型重新生成

            tool_call_history.append(call_key)
            result = self.execute(tool_call)
            context.append(result)

        return context
```

### 4.3 RL训练中的反死循环

```python
# 在RL训练时，对死循环轨迹给惩罚reward
def anti_loop_reward(trajectory, task_success):
    base_reward = 1.0 if task_success else -0.5

    # 检测重复工具调用
    tool_calls = [t for t in trajectory if t["mask"] and is_tool_call(t)]
    unique_calls = set((c.name, str(c.args)) for c in tool_calls)

    if len(tool_calls) > len(unique_calls) * 1.5:
        # 重复率超过50%，给惩罚
        base_reward -= 0.3

    # turn数过多也惩罚（鼓励效率）
    if len(trajectory) > 5:
        base_reward -= 0.1 * (len(trajectory) - 5)

    return base_reward
```

## 五、训练流程总览

```python
def agentic_rl_training(model, tools, tasks, reward_model):
    """完整的Agentic RL训练流程"""
    for epoch in range(num_epochs):
        # 1. Rollout：让模型在任务上运行Agent loop
        trajectories = []
        for task in sample_batch(tasks):
            traj = agent_loop(model, tools, task, max_turns=10)
            # 计算最终reward
            traj.reward = reward_model(task, traj.final_answer)
            trajectories.append(traj)

        # 2. 计算advantage（GRPO组内相对，或GAE）
        advantages = compute_advantages(trajectories)

        # 3. 策略更新（只对mask=True的token算loss）
        for traj in trajectories:
            loss = agentic_rl_loss(
                logits=model(traj.tokens),
                labels=traj.tokens,
                loss_mask=traj.mask,  # 关键：只算模型生成的
                advantages=advantages,
            )
            loss.backward()
            optimizer.step()
```

## 加分点

1. **理解"动作vs状态"的区分**：这是RL的基础概念，Agent场景中生成token是动作、observation是状态
2. **提到credit assignment**：多轮Agent的reward分配是难点，体现对RL深度理解
3. **防死循环的工程方案**：实际训练中的痛点，能提出具体解法体现工程经验

## 雷区

- **observation参与loss**：这是Agent RL训练最危险的bug，会导致模型幻觉而非调用工具
- **忽视中间轮reward**：只给最终reward，模型学不到"何时调用工具"
- **max_turns设置不当**：太短任务完不成，太长容易死循环浪费算力

## 扩展

- **ReAct论文**：Reasoning+Acting范式，定义了Agent loop的基本结构
- **ToolFormer**：Meta的工作，教模型自主学会调用工具
- **Reinforcement Fine-tuning (RFT)**：OpenAI o1/R1的训练范式，Agentic RL的具体实现

## 记忆要点

- 核心口诀：模型生成token算Loss，环境返回observation全Mask掉
- Agent Loop闭环：模型生成动作→解析工具→环境执行→拼接结果→继续生成
- Loss Mask设计：因工具结果由系统产生，非模型能力，故必须置为False不参与反传
- 架构特点：通过上下文拼接把多轮交互展平，形成有监督的连续生成序列


## 苏格拉底式面试追问

> 这组追问模拟面试官层层逼问，每一问先回答"为什么"，再回答"怎么做"，最后回答"如何证明"。

### 第一层：目标与动机

**Q：Agentic RL 训练 Agent 时，为什么工具返回的 observation token 必须 mask 掉不参与 loss，让模型一起学不行吗？**

Agent loop 里模型生成的 token 是"动作"（如决定调用什么工具、传什么参数），工具返回的 observation 是"环境状态"（如搜索结果、代码执行输出）。如果让 observation 参与 loss，模型会被优化去"预测/记忆工具返回的内容"，而不是学习"什么时候调用什么工具"——这是两个完全不同的学习目标。更糟的是 observation 通常很长（搜索结果几千 token），它们的 loss 会淹没模型生成动作的 loss，导致模型不学调用策略而学背诵工具输出。所以必须 mask observation，只对模型自己生成的 token 算 loss。

### 第二层：证据与定位

**Q：你怎么验证训练时 mask 真的生效了，observation token 没有参与梯度更新？**

两个层面验证：1）代码层——在 loss 计算前打印 labels 的 mask 分布，确认 observation 区间的 label 是 -100（PyTorch 的 ignore_index）；2）梯度层——做一个反向实验，分别跑"有 mask"和"无 mask"两版，对比相同步数下模型在 tool_call_success_rate 上的表现。如果无 mask 版本的 tool_call 成功率明显低（如 40% vs 75%）且模型倾向输出长篇工具结果复述，就证明 mask 是必要的。还可以看 loss 曲线——无 mask 版本 loss 会偏低（observation 容易预测），mask 版本 loss 反映真实动作学习难度。

### 第三层：根因深挖

**Q：假设 Agent 训练后 tool_call_success_rate 很低（只有 30%），你怎么定位是 mask 没做对，还是模型本身没学会调用策略？**

分层排查。第一步：确认 mask——检查训练数据的 token 序列，确认 observation 区间 label=-100，工具调用的参数 token label 是真实值（参与 loss）。第二步：确认 reward 信号——看 reward 分布，如果 reward 全 0 或全相同，模型根本没有学习信号，问题在 reward 设计不在 mask。第三步：看模型生成——采样模型在 eval prompt 上的输出，如果模型会输出 `<tool_call>` 标记和合理参数但工具执行失败，是参数学习不够；如果模型根本不输出工具调用标记，是 mask 问题导致模型没学到"何时调用"的信号。

**Q：为什么不把工具调用的参数 token 和推理 token（Thought）都用同一个权重参与 loss，而是要分别赋权？**

Thought（推理过程）和 Action（工具调用参数）的学习难度和重要性不同。Thought 是自由文本，错误成本相对低；Action 的参数必须严格符合工具 schema（如 JSON 格式、参数类型），错误一个字段工具就调用失败。如果用等权 loss，模型会在 Thought 上"偷分"（生成长篇推理降低 loss）而忽视 Action 准确性。正确做法是 Action token 的 loss 权重 > Thought（如 2:1），或者在 Action 区间用 label smoothing 容忍格式噪声。DeepSeek R1 的做法是对 Action 区间单独计算 token-level accuracy 监控，确保格式正确率 >95%。

### 第四层：方案权衡

**Q：observation 被 mask，但有些 observation 里包含关键信息（如搜索到的正确答案），模型下一轮要基于它推理，这种"跨轮信息"模型怎么学到？**

靠下一轮生成时 observation 作为 context 输入，模型在前向时 attention 到这些 token，影响后续生成。loss 只是不对 observation 反传，但 observation 在前向计算中是可见的（attention 权重会用到）。所以模型学到的是"如何在 context 里有 observation 的情况下生成下一步"——这是 in-context learning，不是参数记忆。验证方法：测同一模型在"observation 在 context"和"observation 被 mask 掉"两种输入下的 tool_call 成功率，前者应显著高，证明模型确实在用 observation 做条件推理。

**Q：为什么不直接把工具返回结果也当训练数据让模型学，像 SFT 那样让模型模仿工具输出，不就学到工具知识了吗？**

这会让模型混淆"动作"和"状态"的边界。如果模型学会"输出工具结果"，它在推理时会自己编造工具返回（幻觉），而不是真正去调用工具——因为它被训成"预测 observation"了。这违反 Agent 的核心设计：工具调用是模型主动发起的 action，结果是环境给的 feedback，两者角色不能混。SFT 阶段教模型"如何生成工具调用参数"是对的（这些是动作），但教模型"生成工具结果"是错的。所以 mask 不是为了省 loss，是为了维护正确的因果关系——模型只对自己的动作负责。

### 第五层：验证与沉淀

**Q：你怎么证明 Agentic RL 训练后模型真的学会了"何时调用工具"的策略，而不是过拟合到训练集的工具调用模板？**

泛化测试：1）新工具测试——给模型一个训练时没见过的工具（新 schema、新描述），看它能否根据 description 正确调用，能调用说明学到了通用调用策略而非背模板；2）反例测试——给一个不需要工具的简单问题（如"1+1=?"），看模型是否克制不调用工具直接回答，如果疯狂调用工具就是过拟合到"必须调用"；3）工具选择测试——给多个工具，看模型能否选对最合适的（如查天气选 weather_api 而非 search）。三个测试都通过才证明学到了真正的策略，过拟合的模型会在新工具/反例上崩溃。

**Q：Agent loop 的 mask 设计和 reward 设计怎么沉淀成团队框架的默认能力，避免每个项目重新踩坑？**

封装成训练框架的标准组件：1）mask 自动生成——数据预处理时根据 `<tool_call>...</tool_call>` 和 `<observation>...</observation>` 标记自动生成 mask，开发者不用手写；2）Action/Thought loss 权重可配置——默认 Action:Thought=2:1，提供 knob 调整；3）reward 模板——内置常见 reward（tool_call_success_rate、final_answer_accuracy、format_validity）的组合模板，按场景选；4）泛化测试集——框架自带新工具/反例/工具选择测试用例，训练完自动跑一遍出报告。这套能力写入 Agent RL 训练 SOP，新项目一键复用。

## 结构化回答

**30 秒电梯演讲：** Agentic RL训练Agent用工具解决问题。Agent loop是"模型生成→解析工具调用→执行工具→拼接结果→继续生成"的循环。Token mask的关键：只有模型自己生成的token参与loss。

**展开框架：**
1. **Agent loop** — generate → parse → execute → append → repeat
2. **Loss** — Loss只算模型生成的token（含tool_call指令）
3. **observation** — observation/tool_result的token全部mask（不参与loss）

**收尾：** 您想深入聊：如果工具返回的observation也参与loss会怎样？


## 视频脚本

> 预计时长：5 分钟 | 由浅入深


| 时间 | 画面/字幕 | 口播台词 | 讲解要点 |
|------|----------|----------|----------|
| 0:00 | 标题卡：Agentic RL 的 Agent loop… | "像训练实习生用计算器算账——他按计算器（生成调用）、看屏幕数字（observation）…" | 开场钩子 |
| 0:20 | 核心概念图 | "Agentic RL训练Agent用工具解决问题。Agent loop是"模型生成→解析工具调用→执行工具→拼接结果→继…" | 核心定义 |
| 0:50 | Agent loop示意图 | "Agent loop——generate → parse → execute → append → repeat" | 要点拆解1 |
| 1:30 | Loss示意图 | "Loss——Loss只算模型生成的token（含tool_call指令）" | 要点拆解2 |
| 2:20 | 对比/实战案例图 | "对比一下常见误区和工程实践，看真实场景里怎么取舍。" | 实战与对比 |
| 3:10 | 总结卡 | "记住核心要点。下期我们追问：如果工具返回的observation也参与loss会怎样？" | 收尾与钩子 |
