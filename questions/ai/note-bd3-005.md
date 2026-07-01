---
id: note-bd3-005
difficulty: L4
category: ai
subcategory: 微调
tags:
- 字节跳动
- 面经
- 二面
feynman:
  essence: QLoRA将冻结的基础模型量化到4bit(NF4)存储，同时训练低秩LoRA适配器(fp16)，实现"大模型小显存训练"
  analogy: 就像在一本大部头教科书上做笔记——书本本身缩印成小字(NF4量化)节省空间，你只在书页边贴便签纸(LoRA低秩矩阵)做微调，不需要重印整本书
  first_principle: 微调的本质是更新权重。QLoRA观察到大多数参数更新是低秩的，因此冻结高精度的原始权重(量化存储)，只训练少量低秩增量
  key_points:
  - 'NF4量化: 信息论最优的4bit正态分布量化格式'
  - '双量化: 对量化常数再做量化，进一步省显存'
  - '分页优化器: 利用CPU内存处理显存峰值'
  - 'LoRA: 只训练A和B两个小矩阵，W_new = W_quantized + BA'
first_principle:
  essence: 大模型微调的参数更新具有低秩特性，可以用远少于原始参数的矩阵来表达
  derivation: LoRA假设权重更新ΔW是低秩的，分解为ΔW = B×A（rank r << d）。QLoRA进一步将原始W量化为4bit，只需存储量化后的W + fp16的A/B矩阵，总存储 = 0.5bytes×N + 4bytes×2×r×d
  conclusion: QLoRA使得65B模型可在单张48GB GPU上微调，而全参微调需要>40张A100
follow_up:
- 为什么选择NF4而不是INT4或FP4？
- LoRA的秩r应该怎么选？选大了和选小了各有什么问题？
- QLoRA微调的效果和全参微调差多少？
memory_points:
- 4bit冻结+16bit训练：NF4量化冻结原权重，仅训练fp16的LoRA低秩矩阵。
- NF4契合正态分布：传统INT4均匀划分导致0附近精度差，NF4按正态分位点信息论最优。
- 显存极限压榨：NF4减存储+Double Quant减常量+Paged Optim防峰值溢出。
---

# QLoRA降低训练资源成本的核心逻辑是什么？为什么选择NF4与FP16的组合？

> 来源：字节跳动大模型技术面试二面

## QLoRA = Quantization + LoRA

```
┌─────────────────────────────────────────────────────────┐
│                    QLoRA 核心思路                        │
│                                                         │
│  原始权重 W (fp16)                                       │
│      │                                                  │
│      ├──→ NF4量化 → W_q (4bit)  ← 冻结!不训练            │
│      │     (节省75%存储)           │                    │
│      │                             │                    │
│      │    ┌──────────────────┐    │                    │
│      │    │  LoRA适配器 (fp16) │◄──┘ 反量化回fp16参与    │
│      │    │  A: (r × d_in)   │     前向传播               │
│      │    │  B: (d_out × r)  │                          │
│      │    └──────────────────┘                          │
│      │         ↑                                         │
│      │      只训练这两个小矩阵 (梯度更新)                  │
│      │                                                  │
│      ▼                                                  │
│  W_new = dequant(W_q) + B × A                           │
│         (4bit反量化)    (fp16低秩更新)                    │
└─────────────────────────────────────────────────────────┘
```

## 三大核心技术

### 1. NF4 (Normal Float 4) 量化

**核心洞察**：预训练权重大致服从正态分布，标准INT4的均匀量化网格浪费了大量精度。

```
INT4 (均匀量化):
  网格: -8, -6, -4, -2, 0, 2, 4, 6, 8
  问题: 权重集中在0附近，但网格在0附近稀疏

NF4 (正态分布量化):
  网格: 按标准正态分布的分位点划分
  -1.0  -0.68 -0.52 -0.34  0.0  0.34  0.52  0.68  1.0
  ↑                                         ↑
  权重密集区域分配更多量化等级！

  NF4的16个值 (信息论最优):
  [-1.0, -0.6962, -0.5251, -0.4391, -0.3430, -0.2522, 
   -0.1631, -0.0796, 0.0, 0.0796, 0.1631, 0.2522,
   0.3430, 0.4391, 0.5251, 0.6962, 1.0]
```

**为什么NF4优于INT4/FP4？**
- INT4: 均匀分布假设 → 与正态分布权重不匹配 → 量化误差大
- FP4: 浮点格式 → 指数位浪费 → 0附近精度不足
- NF4: 正态分位点 → 理论最优 → 量化误差最小

### 2. Double Quantization (双量化)

```
普通量化:
  原始W → 每64个元素一组 → 存储一个scaling factor (fp32)
  
  问题: 当模型很大时, scaling factors本身也占大量显存!

双量化:
  原始W → 每64元素一组 → scaling_1 (fp32)
  scaling_1 → 每256个一组 → scaling_2 (fp8)
  
  节省: 额外减少约0.4 bits/参数的存储开销
  65B模型额外节省: ~2GB显存
```

### 3. Paged Optimizer (分页优化器)

```
┌──────────────┐    ┌──────────────┐
│  GPU 显存    │    │   CPU 内存   │
│              │    │              │
│  模型权重(4b)│    │   备用页面   │
│  LoRA参数    │←──→│ (optimizer   │
│  激活值      │    │   states)    │
│              │    │              │
│  ⚡ 峰值时   │    │              │
│  optimizer   │───→│  溢出到CPU   │
│  states溢出  │    │  NVIDIA统一  │
│              │←───│  内存管理    │
└──────────────┘    └──────────────┘
```

## 显存对比

以 65B 模型为例：

```
┌──────────────────┬───────────┬──────────────┬───────────┐
│       方法        │ 模型存储  │ 训练额外开销  │ 总显存    │
├──────────────────┼───────────┼──────────────┼───────────┤
│ 全参微调 (fp16)  │ ~130 GB   │ ~390 GB     │ >520 GB   │
│ LoRA (fp16)      │ ~130 GB   │ ~4 GB       │ ~134 GB   │
│ QLoRA (NF4)      │ ~33 GB    │ ~4 GB       │ ~37 GB    │
│ QLoRA+双量化     │ ~31 GB    │ ~3 GB       │ ~34 GB    │
└──────────────────┴───────────┴──────────────┴───────────┘

→ QLoRA使65B模型可在单张48GB A6000上微调！
```

## LoRA 冻结层和秩大小选择

### 秩 r 的选择

```python
# LoRA参数量 = 2 × r × (d_in + d_out)
# 对于d=4096的线性层:
r=8:   参数量 = 2 × 8 × 8192 = 131K    (原参数16.7M的0.8%)
r=16:  参数量 = 2 × 16 × 8192 = 262K   (1.6%)
r=64:  参数量 = 2 × 64 × 8192 = 1.05M  (6.3%)
```

| 秩 r | 适用场景 | 风险 |
|------|---------|------|
| 4-8 | 简单任务、小数据集 | 欠拟合(容量不足) |
| 16-32 | **通用推荐** | 平衡 |
| 64-128 | 复杂任务、大领域差异 | 过拟合+显存增加 |

### 冻结层选择

```python
# 通常策略: 微调所有线性层中的Q/K/V/O投影 + FFN
target_modules = [
    "q_proj", "k_proj", "v_proj", "o_proj",  # 注意力层
    "gate_proj", "up_proj", "down_proj"       # FFN层
]

# 实验经验:
# - 微调注意力层(Q/K/V/O): 对指令跟随、风格适配效果好
# - 微调FFN层: 对知识注入、领域适应效果好
# - 两层都微调: 效果最好，但参数量翻倍
```

## 代码示例 (PEFT库)

```python
from peft import LoraConfig, get_peft_model, prepare_model_for_kbit_training
from transformers import AutoModelForCausalLM
import torch

# 1. 以4bit加载模型 (NF4量化)
model = AutoModelForCausalLM.from_pretrained(
    "meta-llama/Llama-2-70B",
    load_in_4bit=True,           # ★ 启用4bit量化
    bnb_4bit_quant_type="nf4",   # ★ 使用NF4
    bnb_4bit_compute_dtype=torch.float16,  # 计算时反量化为fp16
    bnb_4bit_use_double_quant=True,        # ★ 双量化
    device_map="auto"
)

# 2. 准备QLoRA训练
model = prepare_model_for_kbit_training(model)

# 3. 配置LoRA
lora_config = LoraConfig(
    r=16,                        # 秩
    lora_alpha=32,               # 缩放因子(通常 = 2×r)
    target_modules=target_modules,
    lora_dropout=0.05,
    bias="none",
    task_type="CAUSAL_LM"
)

model = get_peft_model(model, lora_config)
model.print_trainable_parameters()
# 输出: trainable params: 26M || all params: 67B || trainable%: 0.04%
```

**面试加分点**：提到QLoRA论文(Dettmers et al., 2023)证明QLoRA效果与全参16bit微调相当（差距<1%）；提到GA-QoRA(Qi et al.)在QLoRA基础上用GQA进一步优化；提到LoRA的alpha参数控制适配器的影响力(scale = alpha/r)；提到推理时可以将LoRA权重合并回基础模型(merge_and_unload)实现零额外推理开销。

## 记忆要点

- 4bit冻结+16bit训练：NF4量化冻结原权重，仅训练fp16的LoRA低秩矩阵。
- NF4契合正态分布：传统INT4均匀划分导致0附近精度差，NF4按正态分位点信息论最优。
- 显存极限压榨：NF4减存储+Double Quant减常量+Paged Optim防峰值溢出。

