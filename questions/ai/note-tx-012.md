---
id: note-tx-012
difficulty: L4
category: ai
subcategory: LLM
tags:
- 腾讯
- 面经
- GRPO
- 强化学习
- 训练优化
feynman:
  essence: GRPO 去掉了 PPO 中的 Critic 网络，用组内相对优势来估计 baseline，大幅降低训练资源消耗。
  analogy: PPO 像是请一个私教（Critic）来评判你的表现，GRPO 是让一组同学互相比较——不需要额外请人，省了钱。
  first_principle: 强化学习中 baseline 估计是否一定要用额外的神经网络？不一定——同一 prompt 的多个采样可以互为 baseline。
  key_points:
  - 去掉 Critic 网络
  - 组内相对优势
  - KL 正则化防止策略崩溃
  - DeepSeek-R1 的核心算法
first_principle:
  essence: 信息论：用组内均值作为 baseline 是无偏估计
  derivation: PPO 需要 V(s)→训练 Critic 需要额外 GPU→GRPO 用 G 个采样的均值代替→省掉一半模型
  conclusion: GRPO 是 PPO 在 LLM 场景下的工程优化，用统计方法替代网络参数
follow_up:
- GRPO 的组大小 G 如何选择？太大太小有什么影响？
- GRPO 能否用于非 LLM 的强化学习任务？
- 为什么 DeepSeek 选择 GRPO 而不是 PPO？
memory_points:
- 对比定位：PPO需维护4个模型显存极高，而GRPO砍掉Critic省50%显存
- 核心原理：同Prompt多次采样，用组内奖励均值作Baseline替代Critic网络
- 数学本质：用蒙特卡洛经验均值估计优势函数，省去庞大的价值网络
- 工程意义：DeepSeek-R1借此实现纯RL驱动，验证大规模推理涌现能力
---

# 【腾讯面经】GRPO 算法的原理是什么？和 PPO 有什么区别？

## 一、背景：为什么需要 GRPO

在 RLHF（人类反馈强化学习）流程中，**PPO** 长期以来是标准算法。但在 LLM 场景下，PPO 存在一个严重的工程问题：

> **PPO 需要同时维护 4 个模型**：Actor（策略模型）、Critic（价值模型）、Reward Model（奖励模型）、Reference Model（参考模型）。其中 Critic 模型的参数量通常与 Actor 相当，这意味着训练时需要 **双倍的 GPU 显存**。

对于动辄数百亿参数的大模型来说，这个开销是巨大的。

**GRPO（Group Relative Policy Optimization）** 由 DeepSeek 团队在 [DeepSeekMath (2024)](https://arxiv.org/abs/2402.03300) 论文中提出，核心创新是：**去掉 Critic 网络，用同一 prompt 的多个采样的组内相对奖励来估计优势函数**。这在几乎不损失性能的前提下，节省了约 50% 的显存。

DeepSeek-R1（2025年1月发布）正是基于 GRPO 实现了纯 RL 驱动的推理能力涌现，验证了该算法在大规模场景下的有效性。

---

## 二、PPO 回顾：GRPO 要解决什么问题

### 2.1 PPO 的目标函数

PPO 的 clipped surrogate objective：

$$\mathcal{L}^{PPO} = \mathbb{E}\left[\min\left(r_t(\theta)\hat{A}_t,\ \text{clip}(r_t(\theta), 1-\epsilon, 1+\epsilon)\hat{A}_t\right)\right]$$

其中 $r_t(\theta) = \frac{\pi_\theta(a_t|s_t)}{\pi_{\theta_{old}}(a_t|s_t)}$ 是重要性采样比率。

### 2.2 PPO 的优势函数（GAE）

PPO 使用 **GAE（Generalized Advantage Estimation）** 计算优势函数，需要 Critic 网络 $V_\phi(s)$ 提供基线：

$$\hat{A}_t^{GAE} = \sum_{l=0}^{\infty}(\gamma\lambda)^l\delta_{t+l}, \quad \delta_t = r_t + \gamma V_\phi(s_{t+1}) - V_\phi(s_t)$$

**问题所在**：

- Critic $V_\phi(s)$ 需要单独训练一个与 Actor 同等规模的神经网络
- 在 LLM 场景中，输入 $s$ 是很长的 token 序列，Critic 需要对整个序列做编码再输出一个标量
- Critic 的训练本身就不稳定，且价值估计的方差会导致优势估计不准

---

## 三、GRPO 核心原理

### 3.1 关键洞察

GRPO 的核心思想极其简洁：

> **对于同一个 prompt，采样 G 个不同的回答，用这 G 个回答的奖励均值作为 baseline，计算每个回答的相对优势。**

这相当于用**经验均值**替代 Critic 网络估计的期望值。从统计角度看，这是一个蒙特卡洛估计。

### 3.2 GRPO 的采样过程

```
┌─────────────────────────────────────────────────────┐
│                  GRPO 采样与计算流程                  │
├─────────────────────────────────────────────────────┤
│                                                     │
│   Prompt q                                          │
│      │                                              │
│      ▼                                              │
│   ┌──────────┐                                      │
│   │ Policy π │ ──采样G次──→ {o_1, o_2, ..., o_G}    │
│   └──────────┘                                      │
│                              │                      │
│                              ▼                      │
│                    ┌──────────────────┐             │
│                    │  Reward Model R  │             │
│                    └────────┬─────────┘             │
│                             │                       │
│                    r_1, r_2, ..., r_G               │
│                             │                       │
│              ┌──────────────┼──────────────┐        │
│              ▼              ▼              ▼        │
│          Â_1 =          Â_2 =        Â_G =          │
│         r_1 - r̄        r_2 - r̄      r_G - r̄       │
│                                                     │
│         r̄ = (1/G) Σ r_i   (组内均值 baseline)       │
│                                                     │
│              Â_i 归一化(可选):                       │
│         Â_i = (r_i - mean) / (std + ε)             │
└─────────────────────────────────────────────────────┘
```

### 3.3 GRPO 的优势计算

给定 prompt $q$，从旧策略 $\pi_{\theta_{old}}$ 中采样 $G$ 个输出 $\{o_1, o_2, \ldots, o_G\}$，对每个输出用奖励模型打分得到 $\{r_1, r_2, \ldots, r_G\}$。

**组内相对优势**（Group Relative Advantage）：

$$\tilde{A}_i = \frac{r_i - \text{mean}(\mathbf{r})}{\text{std}(\mathbf{r}) + \epsilon}$$

其中 $\text{mean}(\mathbf{r}) = \frac{1}{G}\sum_{j=1}^{G} r_j$，$\text{std}(\mathbf{r})$ 是组内标准差。

这里有几个要点：
- **不需要 Critic**：baseline 直接用组内奖励的统计量
- **归一化**：除以标准差使得优势尺度稳定，有助于训练稳定性
- **序列级别**：优势是在**整个输出序列**层面计算的（而非 token 级别的 GAE），简化了计算

### 3.4 GRPO 的目标函数

GRPO 在 PPO 的 clipped objective 基础上增加了 **KL 正则化项**：

$$\mathcal{L}_{GRPO} = \underbrace{\mathbb{E}\left[\min\left(\rho_i\tilde{A}_i,\ \text{clip}(\rho_i, 1{-}\epsilon, 1{+}\epsilon)\tilde{A}_i\right)\right]}_{\text{PPO Clipped Objective}} - \beta \underbrace{\mathbb{E}\left[D_{KL}(\pi_\theta \| \pi_{ref})\right]}_{\text{KL 散度惩罚}}$$

其中 $\rho_i = \frac{\pi_\theta(o_i|q)}{\pi_{\theta_{old}}(o_i|q)}$ 是重要性采样比率。

### 3.5 KL 正则化的作用

KL 正则化项约束策略模型不要偏离参考模型太远，防止：

1. **奖励黑客（Reward Hacking）**：策略学会钻奖励模型的漏洞
2. **语言能力退化**：过度优化奖励导致流畅性下降、重复输出等问题
3. **训练崩溃**：策略分布漂移过大导致后续采样质量恶化

DeepSeek 在实际实现中使用了 [Schulman 提出的近似方法](http://joschu.net/blog/kl-approx.html)来高效计算 KL 散度：

$$D_{KL}(\pi_\theta \| \pi_{ref}) \approx \frac{\pi_{ref}(o_i|q)}{\pi_\theta(o_i|q)} - \log\frac{\pi_{ref}(o_i|q)}{\pi_\theta(o_i|q)} - 1$$

这个近似只需要一次前向传播即可计算，无需对每个 token 做精确的 KL 计算。

---

## 四、GRPO vs PPO 详细对比

| 维度 | PPO | GRPO |
|------|-----|------|
| **Critic 网络** | ✅ 需要（与 Actor 同等规模） | ❌ 不需要 |
| **模型数量** | 4 个（Actor, Critic, RM, Ref） | 3 个（Actor, RM, Ref） |
| **显存占用** | 基准（100%） | ~减少 40-50% |
| **优势估计** | GAE（token 级别，依赖 $V_\phi$） | 组内相对（序列级别，依赖统计） |
| **Baseline** | 学习的价值函数 $V_\phi(s)$ | 组内奖励均值 $\bar{r}$ |
| **KL 正则** | 通常在 reward 中隐式惩罚 | 显式 KL 散度项 |
| **采样方式** | 每个 prompt 采 1 个输出 | 每个 prompt 采 $G$ 个输出 |
| **方差** | Critic 估计方差可能较高 | 组内归一化后方差可控 |
| **适用场景** | 通用 RL（游戏控制、机器人等） | LLM 对齐训练 |
| **训练稳定性** | 依赖 Critic 质量 | 组内统计更稳定 |

### 关键区别详解

**1. 为什么去掉 Critic 是可行的？**

在传统 RL（如 Atari 游戏）中，状态空间是连续的，必须学习一个 $V(s)$ 函数来做基线。但在 LLM 场景中：
- 每个训练样本就是一个完整的 prompt → response 对
- 对同一 prompt 采样多个 response，它们的奖励天然构成一个分布
- 用组内均值做 baseline 是**无偏的**（蒙特卡洛估计）

**2. 采样 G 次是否增加了成本？**

表面上每个 prompt 需要采样 G 次（典型 G=4~8），增加了推理成本。但考虑到：
- Critic 的前向+反向传播本身就是巨大的开销
- Critic 的训练需要额外的梯度更新
- 实际总 FLOPs 通常还是低于 PPO（因为省掉了 Critic）

---

## 五、代码实现示例

### 5.1 GRPO 训练核心逻辑

```python
import torch
import torch.nn.functional as F
from typing import List

class GRPOTrainer:
    """GRPO 算法核心实现（简化版）"""

    def __init__(
        self,
        policy_model,       # Actor: π_θ
        reference_model,    # Reference: π_ref (frozen)
        reward_model,       # Reward Model (frozen)
        group_size: int = 8,
        clip_epsilon: float = 0.2,
        kl_beta: float = 0.04,
        device: str = "cuda",
    ):
        self.policy = policy_model
        self.ref_model = reference_model
        self.reward_model = reward_model
        self.G = group_size
        self.clip_eps = clip_epsilon
        self.beta = kl_beta
        self.device = device

    @torch.no_grad()
    def sample_group(self, prompts: List[str]) -> dict:
        """对每个 prompt 采样 G 个回复"""
        results = {"prompts": [], "responses": [], "ref_logprobs": []}

        for prompt in prompts:
            for _ in range(self.G):
                # 从当前策略采样回复（temperature > 0 确保多样性）
                response = self.policy.generate(
                    prompt, temperature=0.7, max_new_tokens=512
                )
                results["prompts"].append(prompt)
                results["responses"].append(response)

                # 计算参考模型的 log-prob（用于 KL 计算）
                ref_logp = self.ref_model.compute_logprob(prompt, response)
                results["ref_logprobs"].append(ref_logp)

        return results

    @torch.no_grad()
    def compute_rewards(self, prompts, responses) -> torch.Tensor:
        """用奖励模型对每个回复打分"""
        rewards = []
        for p, r in zip(prompts, responses):
            score = self.reward_model.score(p, r)  # 标量奖励
            rewards.append(score)
        return torch.tensor(rewards, device=self.device)

    def compute_advantages(self, rewards: torch.Tensor) -> torch.Tensor:
        """
        核心步骤：计算组内相对优势
        rewards shape: (batch_size * G,)
        需要按每 G 个为一组进行归一化
        """
        batch_size = rewards.shape[0] // self.G
        rewards_grouped = rewards.view(batch_size, self.G)  # (B, G)

        # 组内均值和标准差
        group_mean = rewards_grouped.mean(dim=1, keepdim=True)  # (B, 1)
        group_std = rewards_grouped.std(dim=1, keepdim=True)    # (B, 1)

        # 归一化优势：Â_i = (r_i - mean) / (std + ε)
        advantages = (rewards_grouped - group_mean) / (group_std + 1e-8)

        # 展平回 (B*G,)
        return advantages.view(-1)

    def compute_kl_penalty(
        self, policy_logprobs: torch.Tensor, ref_logprobs: torch.Tensor
    ) -> torch.Tensor:
        """
        Schulman 近似 KL 散度:
        KL ≈ exp(ref_logp - policy_logp) - (ref_logp - policy_logp) - 1
        """
        ratio = torch.exp(ref_logprobs - policy_logprobs)
        kl = ratio - (ref_logprobs - policy_logprobs) - 1
        return kl.mean()

    def compute_loss(self, batch: dict) -> torch.Tensor:
        """GRPO 完整 loss 计算"""
        prompts = batch["prompts"]
        responses = batch["responses"]
        old_logprobs = batch["old_logprobs"]     # π_old 的 log-prob
        ref_logprobs = batch["ref_logprobs"].to(self.device)

        # ── Step 1: 计算奖励和优势 ──
        with torch.no_grad():
            rewards = self.compute_rewards(prompts, responses)
            advantages = self.compute_advantages(rewards)  # (B*G,)

        # ── Step 2: 计算当前策略的 log-prob ──
        policy_logprobs = self.policy.compute_logprob_batch(
            prompts, responses
        )  # (B*G,)  需要梯度

        # ── Step 3: PPO Clipped Ratio ──
        ratio = torch.exp(policy_logprobs - old_logprobs.to(self.device))
        clipped_ratio = torch.clamp(ratio, 1 - self.clip_eps, 1 + self.clip_eps)

        surrogate = torch.min(ratio * advantages, clipped_ratio * advantages)
        policy_loss = -surrogate.mean()  # 取负号因为要最大化

        # ── Step 4: KL 正则化 ──
        kl_loss = self.compute_kl_penalty(policy_logprobs, ref_logprobs)

        # ── Step 5: 总 loss ──
        total_loss = policy_loss + self.beta * kl_loss

        return total_loss, {
            "policy_loss": policy_loss.item(),
            "kl_loss": kl_loss.item(),
            "mean_reward": rewards.mean().item(),
            "mean_advantage": advantages.mean().item(),
        }

    def train_step(self, prompts: List[str], optimizer):
        """完整的单步训练"""
        # 1. 采样
        samples = self.sample_group(prompts)
        old_logprobs = self.policy.compute_logprob_batch(
            samples["prompts"], samples["responses"]
        ).detach()
        samples["old_logprobs"] = old_logprobs

        # 2. 计算损失并更新
        loss, metrics = self.compute_loss(samples)
        loss.backward()
        torch.nn.utils.clip_grad_norm_(self.policy.parameters(), max_norm=1.0)
        optimizer.step()
        optimizer.zero_grad()

        return metrics
```

### 5.2 对比 PPO 的优势计算

```python
# ════════ PPO 的优势计算（需要 Critic）════════
def compute_ppo_advantages(rewards, values, gamma=1.0, lam=0.95):
    """GAE: 需要 Critic 提供 V(s) 的估计值"""
    advantages = torch.zeros_like(rewards)
    lastgaelam = 0
    for t in reversed(range(len(rewards))):
        nextvalues = values[t + 1] if t < len(rewards) - 1 else 0.0
        delta = rewards[t] + gamma * nextvalues - values[t]  # ← 依赖 Critic!
        lastgaelam = delta + gamma * lam * lastgaelam
        advantages[t] = lastgaelam
    return advantages

# ════════ GRPO 的优势计算（无需 Critic）════════
def compute_grpo_advantages(rewards, group_size):
    """组内相对优势：纯统计，无需任何神经网络"""
    grouped = rewards.view(-1, group_size)
    mean = grouped.mean(dim=1, keepdim=True)
    std = grouped.std(dim=1, keepdim=True)
    advantages = (grouped - mean) / (std + 1e-8)
    return advantages.view(-1)
```

---

## 六、DeepSeek-R1 中的 GRPO 应用

### 6.1 R1-Zero：纯 RL 训练

DeepSeek-R1-Zero 是一个里程碑式实验：**直接在基座模型上做 GRPO 强化学习，不经过任何 SFT（监督微调）**，就让模型涌现出了长链推理能力。

```
┌─────────────────────────────────────────────────┐
│           DeepSeek-R1 训练流程                    │
├─────────────────────────────────────────────────┤
│                                                 │
│  DeepSeek-V3 (基座模型)                          │
│       │                                         │
│       ▼                                         │
│  ┌─────────────────────┐                        │
│  │ GRPO 强化学习训练    │  ← R1-Zero 停在这里    │
│  │ (规则奖励 + 准确率)  │     涌现出推理能力       │
│  └──────────┬──────────┘                        │
│             │                                   │
│             ▼                                   │
│  ┌─────────────────────┐                        │
│  │ 冷启动 SFT 数据生成  │  ← 用 R1-Zero 生成数据 │
│  └──────────┬──────────┘                        │
│             │                                   │
│             ▼                                   │
│  ┌─────────────────────┐                        │
│  │ SFT + GRPO 对齐训练  │  ← R1 最终版           │
│  └─────────────────────┘                        │
└─────────────────────────────────────────────────┘
```

### 6.2 R1 使用的奖励函数

R1 采用了**规则驱动的奖励**而非学习的奖励模型：

| 奖励类型 | 说明 | 示例 |
|----------|------|------|
| **准确率奖励** | 对数学/编程题验证最终答案正确性 | 代码执行通过=1，否则=0 |
| **格式奖励** | 检查输出是否遵循 `<think>...</think>` 格式 | 格式正确=0.1 分 |
| **语言一致性奖励** | 检查推理过程和答案的语言一致性 | 中英文混杂扣分 |

**关键洞察**：用规则奖励替代学习的奖励模型，进一步减少了训练所需模型数量（从 3 个减到 2 个：Actor + Ref），这也是 GRPO 省资源的延续。

---

## 七、工程实践建议（面试加分）

### 7.1 组大小 G 的选择

| G 值 | 效果 | 适用场景 |
|------|------|----------|
| **G=4** | 方差较大，训练稍不稳定 | 资源受限时 |
| **G=8** | 推荐值，方差与成本平衡好 | 通用场景 |
| **G=16+** | 方差小，但采样成本线性增加 | 资源充足，追求最优效果 |

G 太小 → baseline 估计方差大 → 优势信号噪声大 → 训练不稳定
G 太大 → 虽然方差小，但采样和前向推理成本线性增加

### 7.2 KL 系数 β 的调整

- **β 太大**（如 0.1+）：策略几乎不更新，训练效果差
- **β 太小**（如 0.001）：策略漂移严重，可能出现 reward hacking
- **推荐**：从 β=0.04 开始，根据训练曲线的 KL 值动态调整（KL 目标值约 0.01-0.1）

### 7.3 采样温度

- 温度过低（< 0.3）：G 个回复过于相似，优势信号弱
- 温度过高（> 1.0）：输出质量下降，有效训练样本减少
- **推荐**：temperature=0.7-1.0

---

## 八、总结

GRPO 的精妙之处在于它用**最简洁的统计方法**替代了 PPO 中最昂贵的组件（Critic），是对"baseline 估计是否一定要用神经网络？"这一问题的优雅回答。

| 要素 | PPO | GRPO |
|------|------|------|
| Baseline | 学习的价值网络 $V_\phi(s)$ | 组内均值 $\bar{r} = \frac{1}{G}\sum r_i$ |
| 优势 | token 级 GAE | 序列级组内相对优势 |
| KL 约束 | 隐式（reward 中惩罚） | 显式 $D_{KL}(\pi_\theta \| \pi_{ref})$ |
| GPU 需求 | Actor + Critic + RM + Ref | Actor + RM + Ref |

面试核心表述：**GRPO 是 PPO 在 LLM 对齐场景下的工程优化，核心创新是用同一 prompt 的 G 个采样的组内统计量替代 Critic 网络做 baseline 估计，在不损失训练效果的前提下将显存开销减半。DeepSeek-R1 验证了 GRPO + 规则奖励可以实现纯 RL 驱动的推理能力涌现。**

## 记忆要点

- 对比定位：PPO需维护4个模型显存极高，而GRPO砍掉Critic省50%显存
- 核心原理：同Prompt多次采样，用组内奖励均值作Baseline替代Critic网络
- 数学本质：用蒙特卡洛经验均值估计优势函数，省去庞大的价值网络
- 工程意义：DeepSeek-R1借此实现纯RL驱动，验证大规模推理涌现能力


## 苏格拉底式面试追问

> 这组追问模拟面试官层层逼问，每一问先回答"为什么"，再回答"怎么做"，最后回答"如何证明"。

### 第一层：目标与动机

**Q：GRPO 去掉 Critic 网络的动机是什么？Critic 不是 PPO 的核心组件吗？**

Critic 是 PPO 估计"优势函数"（Advantage = Reward - Baseline）的工具，但 Critic 本身要训练（和价值网络一样大），显存和计算成本翻倍。GRPO 的洞察是"用组内相对奖励替代 Critic"——对同一个 prompt 采样 G 个回答，用这 G 个回答的奖励均值作为 baseline，优势 = 单个奖励 - 组均值。这绕过了 Critic 的训练，显存减半。动机是"用统计方法（组内均值）替代学习方法（Critic）估计 baseline"，在 RLHF 场景下更高效。DeepSeek 的 R1 训练用了 GRPO。

### 第二层：证据与定位

**Q：GRPO 训练的 loss 不收敛，怎么定位是组大小 G 不够还是奖励信号有问题？**

看训练曲线和奖励分布。1) 组大小 G——如果 G 太小（如 2），组内均值的估计方差大，baseline 不稳定，loss 震荡。增大 G（如 8 或 16）看是否收敛；2) 奖励信号——如果所有回答的奖励都相同（reward 方差为 0），组内没有相对优劣，GRPO 学不到信号。检查奖励函数是否有区分度（不同回答给不同奖励）。区分方法：看每组内奖励的方差，方差接近 0 是奖励问题，方差正常但不收敛是 G 或学习率问题。

### 第三层：根因深挖

**Q：GRPO 的组内均值 baseline 不如 Critic 准，根因是采样数不够还是方法本身的局限？**

方法本身有局限。Critic 学习的是"给定 state 的期望奖励"，能针对不同 prompt 给不同 baseline；GRPO 的组内均值是"这个 prompt 的这 G 个回答的平均奖励"，baseline 质量依赖 G 个回答的代表性。如果 G 个回答恰好都差（或都好），baseline 偏低（或偏高），优势估计有偏。根因是"用样本均值估计期望，样本少时方差大"。增大 G 能降低方差但不能消除偏差。GRPO 的优势是"不训练 Critic 省 显存"，代价是"baseline 不如 Critic 精确"，权衡后适合显存受限场景。

**Q：那为什么不直接用更大的 G（如 64）让组内均值更准，而要权衡 G 的大小？**

G 大了采样成本高。每个 prompt 采样 G 次意味着 G 次前向推理，G=64 比 G=8 多 8 倍推理成本。训练 RLHF 要百万级 prompt，G 从 8 到 64 意味着算力增加 8 倍。经验上 G=8-16 是性价比最高的——baseline 足够稳定，采样成本可控。G 再大，baseline 的边际改善递减，但成本线性增长。所以 G 的选择是"baseline 精度 vs 采样成本"的权衡，不是越大越好。

### 第四层：方案权衡

**Q：GRPO vs PPO，什么场景选哪个？**

看显存和精度需求。1) 显存受限（如单卡 80G 训练 70B）——选 GRPO，省 Critic 的显存（Policy 7B + Critic 7B = 14B → 只需 7B）；2) 精度优先（有充足算力）——选 PPO，Critic 的 baseline 更精确，训练更稳；3) 快速实验——选 GRPO，少一个网络调参简单。DeepSeek 在 R1 上验证了 GRPO 的有效性，证明"省 Critic 不显著牺牲效果"。经验上大规模训练倾向 GRPO（省成本），小规模精调倾向 PPO（求精度）。

**Q：为什么不直接用 DPO（也不需要 Critic），而要用 GRPO？**

DPO 和 GRPO 解决不同问题。DPO 用偏好对（A > B）直接优化策略，不需要在线采样，但只能学"相对偏好"，无法建模"绝对奖励"（如"回答的安全等级"）。GRPO 是在线 RL 方法，可以实时采样、用奖励模型打分，适合"需要探索新策略"的场景（如提升数学推理能力）。DPO 适合"有大量偏好数据"的对齐，GRPO 适合"有奖励模型、要探索新行为"的能力提升。R1 的推理能力是 GRPO 探索出来的，DPO 做不到。

### 第五层：验证与沉淀

**Q：怎么验证 GRPO 训练真的有效（模型能力提升）？**

三个维度：1) 训练指标——reward 均值上升、KL 散度可控（不偏离 reference policy 太远）、loss 收敛；2) 能力指标——在目标 benchmark（如 GSM8K、MATH）上的准确率提升；3) 通用能力保持——在其他 benchmark（如 MMLU）上不退化（避免"对齐税"）。如果训练 reward 升但 benchmark 没升，可能是 reward hacking（模型学会刷奖励但不解决真问题）。沉淀为 GRPO 训练 checklist：G 大小、学习率、KL 系数、reward 函数的区分度。

## 结构化回答




**30 秒电梯演讲：** PPO 像是请一个私教（Critic）来评判你的表现，GRPO 是让一组同学互相比较——不需要额外请人，省了钱。

**展开框架：**
1. **Critic** — 去掉 Critic 网络
2. **组内相对优势** — 组内相对优势（核心概念）
3. **KL** — KL 正则化防止策略崩溃

**收尾：** GRPO 的组大小 G 如何选择？太大太小有什么影响？





## 视频脚本

> 预计时长：5 分钟 | 由浅入深


| 时间 | 画面/字幕 | 口播台词 | 讲解要点 |
|------|----------|----------|----------|
| 0:00 | 标题卡：GRPO 算法的原理是什么？和 PPO 有什么区… | "PPO 像是请一个私教（Critic）来评判你的表现，GRPO 是让一组同学互相比较——不…" | 开场钩子 |
| 0:20 | 核心概念图 | "GRPO 去掉了 PPO 中的 Critic 网络，用组内相对优势来估计 baseline，大幅降低训练资源消耗。" | 核心定义 |
| 0:50 | 去掉示意图 | "去掉——去掉 Critic 网络" | 要点拆解1 |
| 1:30 | 组内相对优势示意图 | "组内相对优势——组内相对优势" | 要点拆解2 |
| 2:20 | 对比/实战案例图 | "对比一下常见误区和工程实践，看真实场景里怎么取舍。" | 实战与对比 |
| 3:10 | 总结卡 | "记住核心要点。下期我们追问：GRPO 的组大小 G 如何选择？太大太小有什么影响？" | 收尾与钩子 |
