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

