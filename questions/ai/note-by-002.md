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


## 苏格拉底式面试追问

> 这组追问模拟面试官层层逼问，每一问先回答"为什么"，再回答"怎么做"，最后回答"如何证明"。

### 第一层：目标与动机

**Q：GRPO 已经用组内 reward 归一化解决了 baseline 问题，为什么还要搞 token 级重要性采样？多此一举吗？**

不多余。GRPO 的组内归一化解决的是"优势值 A 怎么算"的问题（免去 Critic），但没解决"off-policy 偏差"的问题。RL 训练时策略在更新：采样 rollout 用的是旧策略 π_old，但参数更新时的梯度是按新策略 π_new 算的，两者分布不同直接估梯度会有偏。重要性采样用权重 ratio=π_new/π_old 修正这个偏差，保证 E_old[ratio·f]=E_new[f] 的无偏性。token 级（逐 token 算 ratio）比序列级（整条序列一个 ratio）更精细——长序列里不同 token 的 π_new/π_old 偏差不同，序列级会平均化，token 级让每个 token 的贡献独立校正，梯度估计更准。

### 第二层：证据与定位

**Q：你怎么衡量 token 级重要性采样确实比序列级更准？有量化指标吗？**

看两个信号。1）梯度估计方差——分别用 token 级和序列级 ratio 算梯度，跨多个 batch 看梯度方差。token 级的方差应更小（因为逐 token 校正，不像序列级把所有 token 的偏差耦合在一起）。2）长序列训练稳定性——在长输出任务（如代码生成，输出几百 token）上，序列级 ratio 容易出现极端值（个别 token 偏差大被平均后掩盖或放大），导致训练不稳定（KL 飙升）。token 级因为每个 token 独立 clip，极端 token 被单独裁剪（PPO clip 到 [1-ε,1+ε]），不会污染整条序列。实测：长序列任务用 token 级 ratio，KL 稳定性提升、最终 reward 更高 2-3 个点。

### 第三层：根因深挖

**Q：token 级 ratio 在长序列里为什么会比序列级更稳？数学上解释一下偏差怎么累积的。**

序列级 ratio = Π(π_new(t)/π_old(t))，是所有 token ratio 的连乘。长序列（如 500 token）里即使每个 token 偏差很小（如平均 ratio=1.01），连乘后 1.01^500 ≈ 145，序列级 ratio 爆炸。这意味着序列级要么极小（所有 token 都偏小）要么极大（连乘放大），梯度信号失真。token 级 ratio 是逐 token 的 1.01，配合 PPO clip 到 [0.8, 1.2]，每个 token 的贡献被限制在合理范围，不会因连乘放大。数学上：序列级的方差 = O(Π var_t)，token 级的方差 = O(Σ var_t)，长序列下前者指数级增长，后者线性级。

**Q：既然 token 级 ratio 更准，为什么不直接用，还要配合 PPO clip？重要性采样本身不是无偏的吗？**

重要性采样无偏的前提是 ratio 的方差有界。但实际中 π_new 和 π_old 偏离大时（策略更新激进），ratio 会出现极端值（如 100 或 0.01），导致梯度估计虽然无偏但方差爆炸（单条样本主导梯度，训练震荡）。PPO clip 是"用一点偏差换方差可控"的工程妥协——把 ratio 裁剪到 [1-ε, 1+ε]（ε 通常 0.2），极端值被截断，方差大幅下降，代价是引入轻微偏差（裁剪后的期望不再严格等于新策略期望）。实务证明这个 trade-off 划算：clip 后训练稳定收敛，最终效果好于"无偏但震荡"的纯重要性采样。这就是 PPO 的 "Proximal"（近端）含义——限制策略更新别离太远。

### 第四层：方案权衡

**Q：token 级 ratio 要对每个 token 算 π_new/π_old，计算开销不小，这个开销值得吗？**

值得，开销可控。每个 token 的 ratio 计算是一次 softmax 概率查表（π_new(t) 和 π_old(t) 都是模型 forward 时 logits 的 softmax 值），不额外 forward。rollout 时用 π_old 采样已经算了 π_old(t)，训练时用 π_new forward 也算了 π_new(t)，ratio 只是两者相除，O(1) per token。总开销相对 forward 的 O(n²) attention 可忽略（<1%）。收益是长序列训练稳定性和最终效果提升。所以 DeepSeekMath/R1 都用 token 级 ratio，开销不是瓶颈，实现复杂度才是（要正确处理 log-prob 的数值稳定性，用 log-sum-exp 避免 underflow）。

**Q：为什么不直接 on-policy（采样后立即用新策略更新，不要重要性采样），不就没偏差了吗？**

纯 on-policy 效率太低。每采样一个 batch 就要更新参数，更新后旧样本作废（因为 π_new≠π_old 了），每个样本只用一次。对 Agentic RL 这种 rollout 昂贵的场景（每个轨迹要跑几十轮工具调用），样本只用一次浪费极大。重要性采样的价值是"让旧样本在新策略下复用"——通过 ratio 修正，一个 batch 可以做多次梯度更新（PPO 的 multi-epoch，通常 4 epoch），样本利用率提升 4 倍。代价是引入 ratio 偏差（靠 clip 控制）。所以工程上是"近 on-policy"——sample 一批，用 token 级 ratio + clip 复用 4 次，兼顾效率和稳定性。

### 第五层：验证与沉淀

**Q：你怎么证明 token 级重要性采样的实现是对的，没有数值 bug（如 log-prob underflow）？**

单元测试 + 数值监控。1）单元测试——构造已知 π_old/π_new 的简单 case（如均匀分布），手算期望 ratio，对比代码输出；构造极端 case（π_new/π_old=1000）测 clip 是否生效。2）数值监控——训练时统计 ratio 分布（mean、std、max、min），健康的 ratio 应集中在 [0.5, 2]，max 不应超过 clip 上限（1+ε），如果出现 nan/inf 就是数值 bug（通常是 log-prob underflow，要用 log-sum-exp 或 fp32 算 log-prob）。3）KL 监控——π_new 和 π_old 的 KL 应平稳在 0.01-0.1，如果飙升说明 ratio 失控。这三个检查通过，实现基本正确。

**Q：GRPO/PPO 的 token 级重要性采样实现经验怎么沉淀成团队 RL 框架的标准模块？**

封装成框架的 ImportanceSampling 模块：1）token-level ratio 计算——内置 log-prob 的数值稳定实现（log-sum-exp + fp32），开发者不用手写；2）clip 策略可配置——默认 PPO clip（[1-ε,1+ε]），可切换 GRPO 的组内归一化模式；3）ratio 监控——自动上报 ratio 分布（mean/std/max/clip 率）到 dashboard，clip 率（被裁剪的 token 比例）超 30% 告警（说明策略更新太激进）；4）数值安全——自动检测 nan/inf 并 fallback 到上一个稳定 checkpoint。这套写入团队 RL 框架，新算法（PPO/GRPO/DAPO）共享同一个 ratio 计算模块，避免每个算法重写踩数值坑。

## 结构化回答

**30 秒电梯演讲：** GRPO 的 token 级重要性采样是在 PPO 的序列级重要性采样基础上，进一步对序列内每个 token 计算重要性权重 ratio=π_new(token)/π_old(token)。

**展开框架：**
1. **token** — token级ratio = π_new(token|context) / π_old(token|context)
2. **作用** — 修正off-policy偏差（采样用π_old，训练用π_new）
3. **数学** — E_old[ratio·f] = E_new[f]（重要性采样无偏）

**收尾：** 您想深入聊：token 级 ratio 和序列级 ratio 的关系？


## 视频脚本

> 预计时长：5 分钟 | 由浅入深


| 时间 | 画面/字幕 | 口播台词 | 讲解要点 |
|------|----------|----------|----------|
| 0:00 | 标题卡：GRPO 中 Token 级别重要性采样的实现逻… | "像用旧地图（旧策略）采样的路况数据规划新路线（新策略）——新路线和旧路线偏离的地方（分布差…" | 开场钩子 |
| 0:20 | 核心概念图 | "GRPO 的 token 级重要性采样是在 PPO 的序列级重要性采样基础上，进一步对序列内每个 token 计算重要性…" | 核心定义 |
| 0:50 | token示意图 | "token——token级ratio = π_new(token|context) / π_old(token|context)" | 要点拆解1 |
| 1:30 | 作用示意图 | "作用——修正off-policy偏差（采样用π_old，训练用π_new）" | 要点拆解2 |
| 2:20 | 对比/实战案例图 | "对比一下常见误区和工程实践，看真实场景里怎么取舍。" | 实战与对比 |
| 3:10 | 总结卡 | "记住核心要点。下期我们追问：token 级 ratio 和序列级 ratio 的关系？" | 收尾与钩子 |
