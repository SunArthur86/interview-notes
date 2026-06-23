---
id: note-hw-005
difficulty: L3
category: ai
subcategory: 算法
tags:
- 华为
- 面经
- 优化器
- Adam
- SGD
- AdamW
feynman:
  essence: SGD是用"当前坡度"决定走哪一步，Adam是用"历史坡度的滑动平均+自适应步长"决定走哪一步。本质区别是Adam引入了"动量(惯性)"和"自适应学习率(每参数不同步长)"。
  analogy: SGD像一个蒙眼下山的人，每一步只看脚下坡度（容易在山谷里来回震荡）。Adam像一个有经验的山地向导——记住刚才走过的方向（动量，类似惯性），还能根据每处地形的崎岖程度调整步幅（自适应学习率，平坦处大步，崎岖处小步）。
  first_principle: 优化器的本质是"在参数空间中寻找loss的最小值"。SGD只用当前梯度∇L(θ)；Adam用历史梯度的指数移动平均（一阶动量）+ 历史梯度平方的指数移动平均（二阶动量），分别提供方向稳定性和自适应步长。大模型用AdamW而非Adam，是因为AdamW修正了权重衰减（L2正则）与自适应学习率的耦合bug。
  key_points:
  - SGD：θ←θ−η∇L，仅用当前梯度
  - Momentum：θ←θ−η·v，v=βv+(1-β)∇L，引入惯性
  - Adam：结合一阶动量(方向)和二阶动量(自适应步长)
  - AdamW：将权重衰减从梯度中解耦，正则化更有效
  - 大模型几乎只用AdamW（SGD泛化好但调参难，Adam收敛快）
first_principle:
  essence: 优化器的核心矛盾是"收敛速度" vs "泛化能力"
  derivation: SGD只用当前梯度，方差大、震荡严重，但能找到flat minima（泛化好）。Adam用动量平滑梯度方差，用自适应学习率加速稀疏参数更新，收敛快但易陷sharp minima（泛化差）。权重衰减（正则化）本应约束参数大小，但Adam的自适应学习率破坏了L2正则的尺度一致性——AdamW通过解耦修复了这个bug。
  conclusion: 大模型训练=AdamW（收敛快+正则正确），传统CV任务偶尔用SGD（追求泛化极限）
follow_up:
  - 为什么Adam有时泛化不如SGD？sharp/flat minima理论
  - 学习率warmup为什么对Adam很重要？
  - Lion、Adafactor等新优化器相比AdamW有什么改进？
---

# 【华为面经】优化器 Adam 与 SGD 的本质区别？大模型为什么用 AdamW？

## 一、优化器的演进脉络

```
SGD → Momentum → NAG → AdaGrad → RMSProp → Adam → AdamW
 ↓      ↓         ↓      ↓          ↓         ↓       ↓
朴素   加惯性   改惯性  自适应    改自适应  集大成   修bug
下山   方向     预判    学习率    学习率    动量+自适应  权重衰减
```

理解这条演进线，就能理解"为什么大模型用AdamW"。

## 二、SGD：最朴素的梯度下降

### 2.1 公式

```
θ_{t+1} = θ_t - η · ∇L(θ_t)
```

每个参数按"梯度反方向 × 固定学习率"更新。

### 2.2 SGD的问题

```python
# SGD在椭圆形loss等高线上的行为
# 想象一个狭长的山谷（一个方向陡，一个方向平缓）

import numpy as np
import matplotlib.pyplot as plt

# 椭圆loss: L(x,y) = 10x² + y²
def loss(x, y): return 10*x**2 + y**2
def grad(x, y): return np.array([20*x, 2*y])

# SGD轨迹
theta = np.array([5.0, 5.0])
lr = 0.08
trajectory = [theta.copy()]
for _ in range(50):
    g = grad(*theta)
    theta = theta - lr * g
    trajectory.append(theta.copy())

# 结果：在x方向(陡)剧烈震荡，y方向(平缓)前进缓慢
# 像走Z字形下山
```

**问题**：
1. **震荡严重**：陡峭方向梯度大，容易overshoot
2. **学习率难调**：全局一个lr，对陡峭方向太大，对平缓方向太小
3. **易陷局部最优**：没有"惯性"冲出浅谷

## 三、动量（Momentum）：引入惯性

### 3.1 公式

```
v_{t+1} = β · v_t + (1-β) · ∇L(θ_t)    # 一阶动量：历史梯度滑动平均
θ_{t+1} = θ_t - η · v_{t+1}              # 用动量更新
```

β（通常0.9）控制"惯性大小"：β越大越平滑，越小越接近纯SGD。

### 3.2 动量的作用

```
没有动量：每步只看当前梯度 → 震荡
有动量  ：每步方向 = 0.9×上一步方向 + 0.1×当前梯度
        → 在一致方向上加速，在震荡方向上抵消
```

像滚下山的球——有了质量就有了惯性，能冲过小坑、平滑震荡。

## 四、Adam：自适应矩估计

### 4.1 核心思想

Adam = **Adaptive** + **Moment** = 自适应学习率 + 动量

它同时维护两个量：
- **一阶动量 m**（mean）：梯度的滑动平均 → 方向
- **二阶动量 v**（uncentered variance）：梯度平方的滑动平均 → 该参数历史梯度大小

```
# Adam更新公式
m_t = β1·m_{t-1} + (1-β1)·g_t          # 一阶动量（方向）
v_t = β2·v_{t-1} + (1-β2)·g_t²         # 二阶动量（自适应步长）

m̂_t = m_t / (1 - β1^t)                 # 偏差修正（初期m/v偏小）
v̂_t = v_t / (1 - β2^t)

θ_t = θ_{t-1} - η · m̂_t / (√v̂_t + ε)   # 自适应更新
```

### 4.2 Adam的"自适应"如何工作

关键在 `m̂_t / √v̂_t` 这一项：

```
某参数历史梯度大 → v̂_t大 → √v̂_t大 → 步长缩小
某参数历史梯度小 → v̂_t小 → √v̂_t小 → 步长放大

效果：每个参数有自己的有效学习率，自动适配
- 频繁更新的参数（如embedding中热门词）：步长自动缩小
- 稀疏更新的参数（如冷门词）：步长保持较大
```

```python
# 直观对比：在稀疏embedding场景
# 词"the"出现10000次 → 梯度大 → Adam自动减小步长 → 避免过拟合
# 词"pterodactyl"出现2次 → 梯度小 → Adam保持步长 → 充分学习
# SGD用同一学习率，无法区分
```

### 4.3 偏差修正为什么重要

```
初始化：m_0 = 0, v_0 = 0

t=1时：
m_1 = 0.1 · g_1            # 偏小（应为g_1）
v_1 = 0.001 · g_1²         # 偏小很多（应为g_1²）

如果不修正：步长 = m_1/√v_1 = 0.1·g_1 / √(0.001·g_1²) ≈ 3.16
                  但初期我们期望步长≈g_1（接近1）

修正后：
m̂_1 = m_1 / (1-0.9) = g_1       ✓
v̂_1 = v_1 / (1-0.999) = g_1²    ✓
步长 = g_1 / √g_1² = 1           ✓ 正确
```

## 五、AdamW：修复权重衰减的bug

### 5.1 问题：Adam的权重衰减耦合bug

**权重衰减（L2正则）** 的本意：在loss里加 `λ·||θ||²`，让参数不要太大，防止过拟合。等价于在梯度上加 `λ·θ`：

```
# 理想的权重衰减
g' = g + λ·θ          # 梯度上加正则项
θ ← θ - η · g'
```

但在Adam里，这个 `λ·θ` 会被塞进二阶动量v：

```
# Adam的"权重衰减"（其实是L2正则）
v_t = β2·v_{t-1} + (1-β2)·(g_t + λ·θ)²    # λ·θ也参与平方平均
                                                          ↑
                                            问题：正则项被自适应学习率缩放
```

**后果**：不同参数的权重衰减强度不一致——梯度大的参数，正则被削弱；梯度小的参数，正则被放大。这违背了L2正则"统一约束所有参数"的初衷。

### 5.2 AdamW的解耦修复

```
# AdamW：权重衰减与梯度更新解耦
m_t = β1·m_{t-1} + (1-β1)·g_t     # 注意：g_t是纯梯度，不含λ·θ
v_t = β2·v_{t-1} + (1-β2)·g_t²
m̂_t, v̂_t = 偏差修正

θ_t = θ_{t-1} - η · m̂_t / (√v̂_t + ε)   # Adam的更新
        - η · λ · θ_{t-1}                 # 独立的权重衰减项
```

权重衰减直接作用于参数本身，与自适应学习率解耦——**每个参数的衰减强度一致**。

### 5.3 效果对比

```
实验：在GPT-2规模模型上的对比

Adam + L2正则（耦合版）：loss收敛，但泛化较差
AdamW（解耦版）        ：相同收敛速度，泛化更好

论文(Decoupled Weight Decay Regularization, Loshchilov & Hutter, 2017)
实证：ImageNet上Adam+L2比SGD差，但AdamW追平甚至超过SGD
```

## 六、大模型为什么用AdamW而非SGD

| 优化器 | 收敛速度 | 调参难度 | 泛化 | 显存 | 适用场景 |
|--------|---------|---------|------|------|---------|
| **SGD** | 慢 | 难（需调lr+momentum） | 好（flat minima） | 少 | CV、传统深度学习 |
| **Adam** | 快 | 易（默认参数即可） | 中 | 多（2倍动量状态） | NLP早期、RNN |
| **AdamW** | 快 | 易 | 好（正则正确） | 多 | **大模型标配** |

### 6.1 大模型用AdamW的原因

1. **参数规模巨大（数十亿到万亿）**：SGD的固定学习率无法适配这么多参数的不同特性，AdamW的自适应学习率是必需的
2. **训练成本极高**：AdamW收敛快，节省GPU/NPU时间。SGD慢一倍意味着训练成本翻倍
3. **稀疏参数多**：大模型的embedding层极度稀疏（词表几万到百万），AdamW的自适应步长对稀疏更新更友好
4. **正则化必须正确**：大模型容易过拟合，AdamW的正确权重衰减比Adam的耦合L2更有效

### 6.2 大模型训练中AdamW的典型超参

```python
# GPT-3 / LLaMA 等大模型的典型配置
optimizer = AdamW(
    lr=3e-4,           # 峰值学习率（配合warmup）
    betas=(0.9, 0.95), # 注意β2用0.95而非0.999（大模型惯例，响应更快）
    weight_decay=0.1,  # 权重衰减（解耦，比Adam的L2可以设大）
    eps=1e-8,
)

# 学习率调度：warmup + cosine decay
scheduler = CosineAnnealingWithWarmup(
    warmup_steps=2000,     # 前2000步线性warmup
    max_lr=3e-4,
    min_lr=3e-5,
    total_steps=100000,
)
```

## 七、为什么大模型必须warmup

Adam的初期方差估计 v̂_t 不稳定（样本少），如果一开始就用大学习率，会导致参数剧烈抖动甚至发散。Warmup的作用：

```
训练初期（前2000步）：
  - v̂_t估计不准（梯度方差大）
  - 学习率从小线性增长，给v̂_t积累样本的时间
  - 避免初期梯度噪声导致的参数崩坏

训练中期：
  - v̂_t估计稳定
  - 学习率达到峰值，快速收敛

训练后期：
  - cosine decay，学习率缓慢下降
  - 精细调整，找到更优解
```

## 八、典型配置对比代码

```python
import torch

# 1. 传统CV任务（追求泛化极限）
optimizer_cv = torch.optim.SGD(
    model.parameters(),
    lr=0.01,
    momentum=0.9,
    weight_decay=1e-4,  # 这里的weight_decay其实是L2正则
)

# 2. 早期NLP任务
optimizer_nlp = torch.optim.Adam(
    model.parameters(),
    lr=1e-3,
    betas=(0.9, 0.999),
    weight_decay=0,  # Adam的weight_decay=耦合L2，有bug
)

# 3. 大模型标配
optimizer_llm = torch.optim.AdamW(
    model.parameters(),
    lr=3e-4,
    betas=(0.9, 0.95),
    weight_decay=0.1,  # 解耦的权重衰减，正确
)
```

## 加分点

1. **知道偏差修正的原因**：m_0/v_0初始化为0导致初期估计偏小，修正项 `1-β^t` 补偿
2. **能解释sharp vs flat minima**：SGD因噪声大能逃出sharp minima找到flat minima（泛化好），Adam收敛快但易陷sharp（这是Adam泛化不如SGD的理论解释）
3. **了解新优化器**：Lion（符号函数，省显存）、Adafactor（省二阶动量显存）、Sophia（用Hessian对角线）

## 雷区

- **混淆Adam的weight_decay和AdamW的weight_decay**：前者是耦合L2（有bug），后者是解耦正则（正确）——PyTorch的Adam也有weight_decay参数，但实现的是耦合版
- **忽视β2的选择**：传统任务用0.999，但大模型普遍用0.95——这影响二阶动量对近期梯度的敏感度
- **以为Adam不需要调学习率**：Adam对学习率相对鲁棒，但3e-4和1e-4效果差异巨大，仍需调

## 扩展

- **Lion优化器**（Google 2023）：用符号函数 `sign(m_t)` 替代 `m_t/√v_t`，省去二阶动量v，显存减半，效果相当
- **Sophia**（Stanford 2023）：用Hessian对角线估计替代二阶动量，理论上更接近二阶方法，收敛更快
- **学习率与batch size的关系**：大batch训练需线性放大学习率（sqrt scaling rule for Adam）
