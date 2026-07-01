---
id: note-by-002
difficulty: L5
category: ai
subcategory: 强化学习
tags:
- 字节
- 面经
- GRPO
- 重要性采样
- Token级别
- RLHF
feynman:
  essence: GRPO 的 token 级重要性采样是在 PPO 的序列级重要性采样基础上，进一步对序列内每个 token 计算重要性权重 ratio=π_new(token)/π_old(token)。作用是修正"off-policy 偏差"——采样用的旧策略和当前策略分布不同，直接用旧样本估梯度会有偏，重要性采样用权重修正这个偏差。token 级（而非序列级）让每个 token 的贡献被独立校正，提升梯度估计精度，尤其对长序列（序列级会平均化 token 差异）。
  analogy: 像用旧地图（旧策略）采样的路况数据规划新路线（新策略）——新路线和旧路线偏离的地方（分布差异），数据要按"新旧路况匹配度"加权（重要性权重）。token 级就是每个路口单独算匹配度，比整条路一起算更精确。
  first_principle: RL 训练时策略在变，采样用的是旧策略 π_old，估梯度用的是新策略 π_new。两者分布不同导致估计有偏。重要性采样用 w=π_new/π_old 修正权重，无偏估计 E_old[w·f]=E_new[f]。token 级是逐 token 算 w，比序列级（整条 w）更精细。
  key_points:
  - token级ratio = π_new(token|context) / π_old(token|context)
  - '作用: 修正off-policy偏差（采样用π_old，训练用π_new）'
  - '数学: E_old[ratio·f] = E_new[f]（重要性采样无偏）'
  - token级比序列级精细（长序列token贡献被独立校正）
  - PPO用clip防ratio爆炸，GRPO继承此机制
first_principle:
  essence: token 级重要性采样 = off-policy 偏差的逐 token 修正
  derivation: 策略变化 → 采样分布(π_old)≠当前分布(π_new) → 直接估梯度有偏 → 重要性采样加权修正 → token级比序列级更精细
  conclusion: token 级重要性采样让长序列 RL 训练的梯度估计更准
follow_up:
- token 级 ratio 和序列级 ratio 的关系？
- 为什么 PPO 要 clip ratio？
- GRPO 怎么处理 token 级 ratio？
memory_points:
- 核心对比：序列级是连乘易爆炸下溢，token级是独立计算比值，数值更稳定
- 计算公式：用log域算避免下溢，即 ratio = exp(logp_new - logp_old)
- 核心作用：修正off-policy偏差，因为采样用旧策略而训练更新新策略
- 安全机制：配合PPO clip，限制ratio在[1-ε, 1+ε]防极端权重
---

# 【字节面经】GRPO 中 Token 级别重要性采样的实现逻辑与作用

## 一、背景：为什么需要重要性采样

```
RL 训练时：
  - 采样阶段：用旧策略 π_old 生成数据（response）
  - 训练阶段：更新的是新策略 π_new

问题：π_old ≠ π_new（策略在更新中变化）
  → 用 π_old 采的样本，直接估 π_new 的梯度 → 有偏（off-policy 偏差）
  
解决：重要性采样（Importance Sampling）
  用权重 w = π_new / π_old 修正
  使得：E_{x~π_old}[w · f(x)] = E_{x~π_new}[f(x)]  （无偏）
```

## 二、序列级 vs Token 级重要性采样

### 序列级（传统做法）
```
对整个序列 o = (t_1, t_2, ..., t_L) 算一个 ratio：

ratio_seq = π_new(o|q) / π_old(o|q)
          = Π_{i=1}^{L} π_new(t_i | q, t_<i) / π_old(t_i | q, t_<i)

问题：L 个 token 的概率相乘
  → ratio 极易爆炸或下溢（连乘 L 次）
  → 长序列（L=1024）时数值不稳定
  → 每个token的贡献被序列级ratio平均化
```

### Token 级（GRPO/PPO 的做法）
```
对序列内每个 token 单独算 ratio：

ratio_i = π_new(t_i | q, t_<i) / π_old(t_i | q, t_<i)

梯度更新时每个 token 用自己的 ratio：
  L = E[ Σ_i ratio_i · A_i ]   （A_i 是该 token 的优势）
```

## 三、Token 级重要性采样的实现逻辑

```python
import torch
import torch.nn.functional as F

def grpo_loss_with_token_is(policy_new, policy_old, responses, advantages, ref_policy):
    """
    policy_new: 当前策略（待更新）
    policy_old: 采样时的旧策略（固定）
    responses: 采样的回答序列 [batch, seq_len]
    advantages: 每个 token 的优势 [batch, seq_len]
    """
    # 1. 算新策略对每个 token 的 log 概率
    logits_new = policy_new(responses)
    logp_new = F.log_softmax(logits_new, dim=-1)
    logp_new_tokens = logp_new.gather(-1, responses.unsqueeze(-1)).squeeze(-1)
    # [batch, seq_len] 每个token的logπ_new
    
    # 2. 算旧策略的 log 概率（采样时已记录，no_grad）
    with torch.no_grad():
        logits_old = policy_old(responses)
        logp_old = F.log_softmax(logits_old, dim=-1)
        logp_old_tokens = logp_old.gather(-1, responses.unsqueeze(-1)).squeeze(-1)
    
    # 3. token 级 ratio = π_new / π_old = exp(logp_new - logp_old)
    #    用 log 域避免连乘下溢
    ratio = torch.exp(logp_new_tokens - logp_old_tokens)  # [batch, seq_len]
    
    # 4. PPO clip 防 ratio 爆炸
    clipped_ratio = torch.clamp(ratio, 1 - epsilon, 1 + epsilon)
    
    # 5. 损失 = min(ratio·A, clipped_ratio·A) 对每个 token
    loss_per_token = -torch.min(ratio * advantages, clipped_ratio * advantages)
    
    # 6. 对序列内 token 求平均（或求和）
    loss = loss_per_token.mean()
    return loss
```

**关键点**：
- **用 log 域**：`ratio = exp(logp_new - logp_old)`，避免概率连乘下溢
- **逐 token 算**：每个 token 独立 ratio，不连乘整条序列
- **PPO clip**：限制 ratio 在 [1-ε, 1+ε]，防极端权重

## 四、Token 级重要性采样的作用

### 作用1：修正 off-policy 偏差
```
采样用 π_old，训练更新 π_new
  → 不修正：梯度估的是 π_old 方向，有偏
  → 修正：乘 ratio=π_new/π_old，无偏估 π_new 方向
```

### 作用2：长序列数值稳定
```
序列级 ratio = Π_{L} π_new/π_old → L=1024 时连乘爆炸/下溢
token 级 ratio = 单个 token 的 π_new/π_old → 数值稳定

即使要算序列级，也是 exp(Σ log ratio_i) 而非 Π ratio_i（log 域求和）
```

### 作用3：token 级优势的精细校正
```
长序列中：
  - 前面的 token（如问候语）：π_new≈π_old，ratio≈1（权重正常）
  - 后面的 token（如关键结论）：π_new 大幅调整，ratio 偏离1（权重大）

序列级 ratio 会把这些 token 的差异"平均掉"
token 级 ratio 让每个 token 按自己的偏离程度独立校正
→ 梯度估计更精确
```

## 五、GRPO 中的具体实现

```
GRPO 流程：
  1. 对每个 prompt 采样 G 个回答（用 π_old）
  2. 算每个回答的奖励 R，组内归一化得优势 A
  3. 算每个 token 的 ratio = π_new(token)/π_old(token)
  4. 损失 = E[ Σ_tokens min(ratio·A, clip(ratio)·A) ]
  5. 更新 π_new

GRPO 的 token 级 IS 和 PPO 一致，区别在于：
  - PPO 的 A 来自 Critic + GAE
  - GRPO 的 A 来自组内统计（无 Critic）
```

## 六、加分点

- 说出 **token 级 ratio 用 log 域实现**：`exp(logp_new - logp_old)`，避免连乘下溢
- 说出 **修正 off-policy 偏差是 IS 的核心作用**：让旧样本无偏估新策略梯度
- 说出 **PPO clip 防 ratio 爆炸**：限制在 [1-ε, 1+ε]，GRPO 继承

## 七、雷区

- ❌ "ratio 直接用概率连乘" → 数值不稳定，要用 log 域
- ❌ "不需要重要性采样" → 策略变化导致 off-policy 偏差，必须修正
- ❌ "token 级和序列级等价" → 长序列时序列级平均化 token 差异

## 八、扩展

- **PPO clip 的 ε**：通常 0.1-0.2，限制单步策略更新幅度（trust region 的近似）
- **GSPO 对 token 级 IS 的优化**：结合 MoE 的稀疏激活特性调整权重
- **ReMax / RLOO**：其他无需重要性采样的 RL 方法（on-policy，但样本效率低）

## 记忆要点

- 核心对比：序列级是连乘易爆炸下溢，token级是独立计算比值，数值更稳定
- 计算公式：用log域算避免下溢，即 ratio = exp(logp_new - logp_old)
- 核心作用：修正off-policy偏差，因为采样用旧策略而训练更新新策略
- 安全机制：配合PPO clip，限制ratio在[1-ε, 1+ε]防极端权重

