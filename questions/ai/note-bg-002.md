---
id: note-bg-002
difficulty: L3
category: ai
subcategory: LLM训练
tags:
- 八股总结
- 面经
- SFT
- RLHF
- 冷启动
- 后训练
feynman:
  essence: SFT冷启动是用监督数据教会模型"基本输出格式和指令遵循"，为后续RL提供稳定的行为策略起点。没有SFT直接RL，模型输出分布太混乱，reward信号噪声极大，RL无法有效学习。
  analogy: SFT冷启动像教小孩"说话的基本规矩"（先学会清晰表达），RL像"通过奖惩培养好习惯"（学会说什么更好）。如果小孩还不会说话就直接奖惩，他根本不知道为什么被奖/罚，学习效率极低。
  first_principle: 强化学习的有效性依赖于"策略空间可探索"。如果初始策略完全随机（输出乱码或格式混乱），reward的方差极大，梯度信噪比极低。SFT的作用是把初始策略收敛到"合理输出空间"，让RL的探索有意义的方向。
  key_points:
  - SFT提供RL的初始化策略π_0，决定了探索起点
  - 没有SFT直接RL：reward方差大、训练不稳定、容易reward hacking
  - SFT教"格式和基本能力"，RL优化"偏好和质量"
  - RL任务前SFT冷启动数据量不需要大（千到万级），但质量要求高
first_principle:
  essence: RL是"在已有行为策略上做微调优化"，不是"从零学习行为"
  derivation: Policy Gradient的梯度估计 ∇J = E[∇logπ(a|s) · R]。当π(a|s)接近均匀分布（未训练），几乎所有a的概率都微小，梯度方差爆炸。SFT把π收敛到合理分布后，RL的梯度才有意义。这就是为什么所有RLHF流程都是 SFT → RM → PPO，而不是直接RM → PPO。
  conclusion: SFT冷启动是RL的"地基"——它不直接提升上限，但决定了RL能否有效启动
follow_up:
- SFT冷启动数据需要多少条？质量vs数量怎么权衡？
- 能否跳过SFT直接RL？有什么失败案例？
- DPO为什么也需要SFT冷启动？
memory_points:
- RL前必须SFT：SFT教指令遵循和格式模板，RL在此子空间内优化执行质量
- 若跳过SFT直接RL：探索空间过大导致梯度方差爆炸，Reward信号被噪声淹没
- SFT收敛输出空间：让模型稳定输出对话格式，RL才能有效区分'好'与'更好
---

# 【八股总结】SFT 冷启动和后续 RL 的关系是什么？为什么 RL 前需要 SFT？

## 一、完整后训练流程回顾

```
大模型训练全流程：
┌─────────────┐     ┌──────────┐     ┌──────────┐     ┌──────────┐
│ 1.预训练     │ →  │ 2.SFT    │ →  │ 3.RM     │ →  │ 4.RLHF   │
│ Pretrain    │     │ 冷启动   │     │ Reward   │     │ PPO/DPO  │
│             │     │          │     │ Model    │     │          │
│ 学通用知识  │     │ 学指令   │     │ 学打分   │     │ 学偏好   │
│ next token  │     │ 遵循     │     │ 人类偏好 │     │ 优化策略 │
└─────────────┘     └──────────┘     └──────────┘     └──────────┘
    Base Model         SFT Model         RM            RLHF Model
```

**SFT的位置**：在预训练（Base Model）和RL之间，是RL的"启动器"。

## 二、为什么RL前必须SFT冷启动

### 2.1 没有SFT直接RL的问题

```python
# 假设：拿Base Model直接做RLHF（跳过SFT）
base_model = load("llama-7b-base")  # 只会续写，不会对话

# 给Base Model输入 "请解释什么是强化学习"
# Base Model可能的输出（续写模式）：
# "强化学习是...的一个分支，它包括以下几个方面..."
# 但也可能输出：
# "强化学习强化学习强化学习" （重复）
# "强化学习，参见Smith 2019的论文..." （学术续写，非对话）

# 这时reward model给分：
# - 对话格式的回答：高分
# - 重复/跑题：低分
# 问题：Base Model输出空间巨大，大部分输出都是低分
# RL的梯度 = ∇logπ(a) × R
# 当π(a)极小（输出概率低）但R极负，梯度震荡剧烈，训练崩溃
```

### 2.2 SFT冷启动解决的核心问题

```
问题1：输出格式不稳定
  Base Model: 可能输出对话、续写、代码、重复...格式混乱
  SFT后: 稳定输出"用户问→助手答"的对话格式

问题2：指令遵循能力缺失
  Base Model: 看到"翻译这句话"可能继续写"翻译这句话的方法有..."
  SFT后: 理解"翻译这句话"是指令，执行翻译任务

问题3：reward信号信噪比低
  Base Model直接RL: 大部分输出得低分，有效梯度信号被噪声淹没
  SFT后RL: 输出基本合理，reward能区分"好回答"和"更好回答"

问题4：探索空间过大
  Base Model: 输出空间 = 所有可能的token序列（天文数字）
  SFT后: 输出空间收敛到"合理回答"的子空间，RL探索有意义
```

### 2.3 数学视角：方差爆炸

```python
# Policy Gradient的方差分析
# ∇J(θ) = E_{τ~π_θ}[ Σ ∇logπ_θ(a_t|s_t) · (R_t - b) ]

# 方差来源：
# 1. ∇logπ_θ(a_t|s_t): 策略梯度，π越分散，梯度方差越大
# 2. (R_t - b): reward的波动，baseline b用来降低

# Base Model（未SFT）的情况：
# - π_θ接近均匀分布 → ∇logπ方差极大
# - reward大部分是负的（输出质量差）→ R-b波动大
# - 结果：梯度方差爆炸，训练发散

# SFT后：
# - π_θ集中到合理输出 → ∇logπ方差小
# - reward在合理范围内波动 → R-b稳定
# - 结果：梯度稳定，RL有效收敛
```

## 三、SFT冷启动教什么、不教什么

### 3.1 SFT教的是"行为模板"，不是"质量上限"

```python
# SFT数据示例（教格式和指令遵循）
sft_examples = [
    {
        "instruction": "翻译成英文",
        "input": "今天天气真好",
        "output": "The weather is really nice today."
        # 教：看到"翻译"指令，输出翻译结果（格式）
        # 不教：怎么翻译得信达雅（质量由RL优化）
    },
    {
        "instruction": "写一个快排",
        "input": "",
        "output": "def quicksort(arr):\n    ..."
        # 教：看到"写代码"指令，输出代码格式
        # 不教：代码是否最优（RL优化）
    },
]

# SFT的目标：让模型学会"如何执行各类指令"
# RL的目标：在学会执行的基础上，优化"执行得更好"
```

### 3.2 SFT数据的特点

```
SFT冷启动数据要求：
├── 数量：几千到几万条（不需要海量，质量优先）
│   - Alpaca: 52K
│   - Vicuna: 70K
│   - LLaMA-2-chat: 27K条高质量
│
├── 多样性：覆盖各种指令类型
│   - 开放问答、代码、数学、创作、推理、Agent...
│   - 避免单一类型导致过拟合
│
├── 质量：每条都是"高质量回答"
│   - 不需要是"最优回答"（RL负责找最优）
│   - 但必须格式正确、内容相关
│   - 低质量SFT数据会固化坏习惯
│
└── 格式：统一的prompt模板
    - 让模型学到稳定的输出格式
    - 为RL阶段的reward计算提供一致的基础
```

## 四、RL阶段如何与SFT衔接

### 4.1 RLHF中的衔接

```python
class RLHFPipeline:
    def __init__(self, base_model_path):
        # 1. 加载Base Model
        self.base = load(base_model_path)

        # 2. SFT冷启动
        self.sft_model = self.finetune_sft(
            self.base,
            data="high_quality_sft_50k.jsonl",
            epochs=3,
        )
        # SFT模型作为RL的初始策略 π_0

        # 3. 训练Reward Model
        self.rm = self.train_rm(
            self.sft_model,  # RM通常基于SFT模型初始化
            data="human_preference_pairs.jsonl",
        )

        # 4. PPO强化学习
        self.rl_model = self.ppo_train(
            policy=self.sft_model,      # π_θ 初始化为SFT模型
            reference=self.sft_model,   # π_ref 冻结的SFT模型（KL约束）
            reward_model=self.rm,
        )
```

### 4.2 KL约束：RL不能偏离SFT太远

```python
# PPO的loss中有一个KL惩罚项
def ppo_loss(policy, reference, reward_model, prompt):
    # 1. 生成回答
    response = policy.generate(prompt)

    # 2. 计算reward
    reward = reward_model.score(prompt, response)

    # 3. KL惩罚：防止policy偏离reference（SFT模型）太远
    kl = KL_divergence(policy(prompt), reference(prompt))

    # 4. 总目标
    objective = reward - β * kl
    #                   ↑ β控制偏离程度
    # β大：紧贴SFT，安全但提升有限
    # β小：自由探索，但可能学到reward hacking
    return -objective  # 最大化→最小化负值
```

**KL约束的意义**：RL优化的是"在SFT基础上的改进"，不是"推翻SFT重来"。防止RL为了刷reward而输出奇怪内容（reward hacking）。

### 4.3 DPO为什么也需要SFT

```python
# DPO（Direct Preference Optimization）看似不需要RM
# 但DPO的loss也有reference model
def dpo_loss(policy, reference, chosen, rejected):
    # DPO直接用偏好对训练，省略RM
    # 但仍然需要reference model（SFT模型）做约束
    log_ratio_chosen = logπ_policy(chosen) - logπ_reference(chosen)
    log_ratio_rejected = logπ_policy(rejected) - logπ_reference(rejected)

    loss = -log_sigmoid(β * (log_ratio_chosen - log_ratio_rejected))
    # reference就是SFT模型，DPO在SFT基础上优化偏好
    return loss

# 所以DPO的流程也是：Base → SFT → DPO
# 没有SFT的DPO同样会输出混乱
```

## 五、冷启动的"度"：SFT多少才够

### 5.1 SFT过少的问题

```
SFT数据太少（如只有100条）：
- 指令遵循不稳定，偶尔输出格式错误
- RL探索时，格式错误的输出得低分，但模型不知道是格式问题还是内容问题
- RL信号混乱，训练效率低
```

### 5.2 SFT过多的问题

```
SFT数据太多（如100万条低质量数据）：
- 模型过拟合到SFT数据的"风格"
- RL阶段难以改进（模型已经固化）
- 输出同质化，缺乏多样性
```

### 5.3 经验值

```
SFT数据量推荐：
├── 通用对话模型：50K-100K条高质量
├── 代码增强：+20K-50K代码指令
├── 数学增强：+10K-20K数学指令
└── Agent能力：+10K-20K Agent轨迹

关键不是数量，是：
1. 覆盖度（指令类型多样）
2. 质量（每条都是合格回答）
3. 格式一致性（统一模板）
```

## 六、反例：跳过SFT直接RL的失败

```python
# 实验对比（参考InstructGPT论文的消融实验）

# 方案A：Base → SFT → RLHF（标准流程）
# 结果：模型表现优秀，指令遵循+回答质量都好

# 方案B：Base → 直接RLHF（跳过SFT）
# 结果：
# - 训练初期reward剧烈波动，PPO难以收敛
# - 即使收敛，模型经常输出格式混乱的内容
# - reward hacking严重（学会刷分但不回答问题）
# - 需要极长的训练时间和大量调参

# 结论：SFT冷启动是不可省略的"地基"
```

## 加分点

1. **理解"冷启动"的"冷"**：指RL从一个"冷"（未成型）的策略开始，需要SFT"预热"到可探索的状态
2. **能解释reward hacking**：没有SFT约束的RL，模型可能学会输出能骗reward model的奇怪内容，而非真正好的回答
3. **知道KL约束的双重作用**：既防止偏离SFT太远，也作为正则防止reward hacking

## 雷区

- **认为SFT和RL是独立的**：实际上RL是在SFT策略上做"微调"，KL约束让两者紧密耦合
- **SFT数据贪多**：低质量大数据反而固化坏习惯，不如少量高质量
- **忽视SFT的格式统一**：格式混乱的SFT数据会让RL阶段reward计算不稳定

## 扩展

- **InstructGPT论文**：OpenAI的系统消融实验，证明SFT→RM→PPO的必要性
- **Constitutional AI**：Anthropic的方案，用AI反馈代替部分人类标注，但SFT冷启动仍然必需
- **KTO/ORPO**：新的偏好优化方法，尝试减少对SFT的依赖，但目前仍需冷启动

## 记忆要点

- RL前必须SFT：SFT教指令遵循和格式模板，RL在此子空间内优化执行质量
- 若跳过SFT直接RL：探索空间过大导致梯度方差爆炸，Reward信号被噪声淹没
- SFT收敛输出空间：让模型稳定输出对话格式，RL才能有效区分'好'与'更好


## 苏格拉底式面试追问

> 这组追问模拟面试官层层逼问，每一问先回答"为什么"，再回答"怎么做"，最后回答"如何证明"。

### 第一层：目标与动机

**Q：RLHF 标准流程是 SFT → RM → PPO，为什么不能直接拿 Base Model 做 RM → PPO，省掉 SFT？**

Base Model 只会续写不会对话，输出分布太散——同一句"解释强化学习"，可能输出对话、学术续写、重复 token，概率 π(a) 都极小。Policy Gradient 的 ∇J=∇logπ(a)·(R-b) 在这种接近均匀分布下梯度方差爆炸，训练直接发散。SFT 的作用是把 π_θ 从均匀分布收敛到"合理回答子空间"，让 RL 的 reward 能区分"好回答"和"更好回答"，而不是被一堆低质量输出噪声淹没。本质是 RL 需要"可探索的策略空间"，SFT 提供这个起点。

### 第二层：证据与定位

**Q：你说 SFT 后 RL 更稳定，怎么用数据证明这一点？**

跑两组对照实验：A 组跳过 SFT 直接 PPO，B 组 SFT→PPO，同样步数。看三个指标：1）KL 散度——A 组 policy 与 ref 的 KL 通常在前 100 步就冲过 10（发散信号），B 组平稳在 0.05-0.2；2）reward 曲线——A 组 reward 抖动幅度 ±5，B 组单调上升；3）grad_norm——A 组会出现 nan 或超过 10 的尖峰，B 组稳定在 0.1-1。再看最终效果：A 组通常 reward hacking（模型学会输出固定模板骗高分），B 组能在 MMLU/AlpacaEval 上稳定提升。

### 第三层：根因深挖

**Q：假设跳过 SFT 做 RL 时训练崩溃了，你怎么定位是"初始策略太散"导致的，而不是 reward model 训练得不好？**

排查 RM：用 RM 对一批 golden answer 和随机续写打分，看区分度（正确答案分数比随机高 1.5 分以上）。如果 RM 区分度正常，再排查初始策略——采样 Base Model 在 prompt 上的 100 个输出，看格式分布，如果对话格式占比低于 30%、续写/重复占比超过 50%，就是初始策略太散。还可以做一个对照：把 SFT 模型当 init 但用同样的 RM 做 RL，如果稳定收敛，反推 Base Model 不稳的原因是策略而非 RM。

**Q：为什么不直接把 SFT 数据量从 1 万条加到 100 万条，让 SFT 更充分，RL 就更容易启动？**

SFT 数据不是越多越好，过量会过拟合到 SFT 数据的风格，反而压制 RL 的探索空间——模型会变成 SFT 数据的复读机，RL 阶段 reward 给的"更好回答"和 SFT 学到的风格冲突，PPO 的 KL penalty 会把模型拉回 SFT 分布，RL 提升被锁死。LLaMA-2-chat 的经验是 27K 条高质量 SFT 数据就够了，质量比数量重要。正确做法是 SFT 训到 loss 平稳就停（通常 2-3 epoch），把优化空间留给 RL。

### 第四层：方案权衡

**Q：DPO 也需要 SFT 冷启动，但 DPO 没有 RM 也没有 PPO，它的"SFT 作用"和 PPO 路线一样吗？**

不完全一样。PPO 路线里 SFT 主要解决"策略方差爆炸"。DPO 路线里 SFT 还多一个作用：DPO 的损失 L=-logσ(βlog(π_θ(yw)/π_ref(yw)) - βlog(π_θ(yl)/π_ref(yl))) 依赖 π_ref 作为参考，如果 π_ref（就是 SFT 后的模型）本身分布混乱，β 缩放后 win/lose 的 logit 差会失真，DPO 学不出偏好。所以 DPO 的 SFT 必须训得更稳，让 π_ref 在偏好对上的概率都合理（不能 win 和 lose 概率都接近 0），否则梯度信号无效。

**Q：为什么不直接用预训练数据继续 pretrain 多轮，让模型自然学会对话格式，而要专门做 SFT？**

预训练数据是 next-token 续写（web/wiki），没有"指令-回答"结构。继续 pretrain 只会让模型更会续写，不会变成对话格式。SFT 的核心是用 instruction-output 对教模型"用户输入→助手回答"的角色扮演，这是结构性的格式转换，不是知识补充。实测：纯 pretrain 多轮的模型 RLHF 后，AlpacaEval 胜率比 SFT 初始化的版本低 20+ 点，因为它根本不会以助手身份回答。

### 第五层：验证与沉淀

**Q：你怎么确定 SFT 训练已经"充分"了，可以切到 RL 阶段，而不是欠训或过训？**

看三个信号交叉判断：1）SFT loss 曲线进入平台期（连续 500 步下降 <0.01），说明指令跟随能力收敛；2）在 held-out 的 SFT eval set 上 BLEU/ROUGE 不再上升；3）最关键——在 RL 的 warmup 阶段（前 100 步）观察 reward 是否单调上升、KL 是否平稳（<0.5）。如果 RL warmup 不稳，说明 SFT 还不够；如果 SFT eval 已开始下降但 train loss 还在降，说明过拟合要 early stop。最优切换点通常是 RL warmup 表现最稳的那个 SFT checkpoint。

**Q：这次 SFT→RL 的经验怎么沉淀，让团队下次不必重新摸索 SFT 数据量？**

建一个 SFT 数据量曲线实验库：分别用 1K/5K/10K/30K/100K SFT 数据各跑一版 SFT→RL，记录每组在 AlpacaEval、MMLU、reward 曲线、KL 稳定性上的表现，画成"数据量 vs 效果"曲线入库。再总结一条规则——SFT 数据量 = ceil(任务类型数 × 500)（每类指令至少 500 条保证多样性），作为团队默认配方。同时把"SFT loss 进入平台期 + RL warmup 100 步 KL<0.5"做成自动检测脚本，集成到训练 pipeline，达到就提示可以切 RL。

## 结构化回答

**30 秒电梯演讲：** SFT冷启动是用监督数据教会模型"基本输出格式和指令遵循"，为后续RL提供稳定的行为策略起点。没有SFT直接RL，模型输出分布太混乱，reward信号噪声极大，RL无法有效学习。

**展开框架：**
1. **SFT** — SFT提供RL的初始化策略π_0，决定了探索起点
2. **没有SFT直接RL** — reward方差大、训练不稳定、容易reward hacking
3. **RL** — RL任务前SFT冷启动数据量不需要大（千到万级），但质量要求高

**收尾：** 您想深入聊：SFT冷启动数据需要多少条？质量vs数量怎么权衡？


## 视频脚本

> 预计时长：4 分钟 | 由浅入深


| 时间 | 画面/字幕 | 口播台词 | 讲解要点 |
|------|----------|----------|----------|
| 0:00 | 标题卡：SFT 冷启动和后续 RL 的关系是什么？为什么… | "SFT冷启动像教小孩"说话的基本规矩"（先学会清晰表达），RL像"通过奖惩培养好习惯"（学…" | 开场钩子 |
| 0:20 | 核心概念图 | "SFT冷启动是用监督数据教会模型"基本输出格式和指令遵循"，为后续RL提供稳定的行为策略起点。没有SFT直接RL，模型输…" | 核心定义 |
| 0:50 | SFT示意图 | "SFT——SFT提供RL的初始化策略π_0，决定了探索起点" | 要点拆解1 |
| 1:30 | 对比/实战案例图 | "对比一下常见误区和工程实践，看真实场景里怎么取舍。" | 实战与对比 |
| 2:20 | 总结卡 | "记住核心要点。下期我们追问：SFT冷启动数据需要多少条？质量vs数量怎么权衡？" | 收尾与钩子 |
