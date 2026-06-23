---
id: note-jc-006
difficulty: L3
category: ai
subcategory: 分布式训练
tags:
- 阶跃星辰
- 面经
- DeepSpeed
- 分布式训练
- ZeRO
feynman:
  essence: DeepSpeed 是微软开源的大模型训练优化库，核心能力是 ZeRO（Zero Redundancy Optimizer）三阶段显存优化——ZeRO-1 分片优化器状态、ZeRO-2 分片梯度、ZeRO-3 分片模型参数，把单卡装不下的大模型分散到多卡。配套能力：混合精度、激活检查点（activation checkpointing，用算力换显存）、offload（卸载到 CPU/NVMe）。配合 Megatron-LM 做流水线/张量并行。
  analogy: 像搬家公司——一家搬不下的大件家具（大模型），DeepSpeed 拆散分到多辆车（多 GPU）上：优化器状态放车1（ZeRO-1）、梯度放车2（ZeRO-2）、连模型参数都分到各车（ZeRO-3）。激活检查点像"中途把不用的家具暂存仓库（CPU），要用再取回"，省空间但多跑腿。
  first_principle: 大模型训练的瓶颈是显存。DeepSpeed 的本质是"消除冗余"——传统数据并行每卡存完整副本（冗余），ZeRO 把优化器/梯度/参数分片到各卡，消除冗余让总显存只受 GPU 数限制。
  key_points:
  - 'ZeRO 三阶段: 优化器状态分片(Z1)+梯度分片(Z2)+参数分片(Z3)'
  - 'Z1省4倍显存，Z2再省一点，Z3让单卡只存1/N参数'
  - '激活检查点: 用算力换显存(只存部分激活，反向时重算)'
  - 'Offload: 卸载到CPU/NVMe进一步省显存(慢但能训)'
  - '配合Megatron做张量并行+流水线并行(3D并行)'
first_principle:
  essence: DeepSpeed = 消除数据并行的冗余
  derivation: 数据并行每卡存完整副本 → 显存冗余 → ZeRO 分片消除冗余 → 显存随GPU数线性降 → 大模型可训
  conclusion: ZeRO 不是新并行方式，是"数据并行 + 消除冗余"的极致优化
follow_up:
- ZeRO-3 的通信开销大不大？
- 激活检查点的"重算"代价多大？
- ZeRO 和 FSDP 什么关系？
---

# 【阶跃星辰面经】对 DeepSpeed 框架有没有了解

## 一、DeepSpeed 是什么

微软开源的**大模型训练优化库**，核心解决"单卡装不下大模型"的显存问题。配合 PyTorch / Megatron-LM 使用。

**核心能力**：
1. **ZeRO**（显存优化）—— 最重要
2. 混合精度训练
3. 激活检查点（activation checkpointing）
4. Offload（卸载到 CPU/NVMe）
5. 3D 并行（数据 + 张量 + 流水线）

## 二、ZeRO：三阶段显存优化（核心）

### 问题：数据并行的冗余

```
传统数据并行（DDP）：
  GPU 1: [完整模型参数 P] + [完整梯度 G] + [完整优化器状态 O]
  GPU 2: [完整模型参数 P] + [完整梯度 G] + [完整优化器状态 O]
  GPU 3: [完整模型参数 P] + [完整梯度 G] + [完整优化器状态 O]
  ...
  → 每卡都存完整副本，显存冗余严重
  → 7B 模型单卡要 ~28GB（FP16+Adam），A100 80GB 也只能训几十 B
```

### ZeRO 的分片思想：逐级消除冗余

```
ZeRO-1：分片优化器状态（O）
  每卡只存 1/N 的优化器状态
  → 显存 ≈ P + G + O/N
  → 省约 4 倍显存（O 通常是 P 的 4-8 倍）

ZeRO-2：分片优化器状态 + 梯度（O + G）
  每卡只存 1/N 的优化器状态和梯度
  → 显存 ≈ P + (G+O)/N
  → 再省一点（G 和 P 同量级）

ZeRO-3：分片优化器状态 + 梯度 + 参数（O + G + P）
  每卡只存 1/N 的所有东西
  → 显存 ≈ (P+G+O)/N
  → 显存随 GPU 数线性降，可训超大模型
  → 代价：通信开销大（前向/反向都要 all-gather 参数）
```

### 显存对比（7B 模型，FP16，Adam）

| 方案 | 单卡显存 |
|------|---------|
| DDP（无分片） | ~112 GB（装不下） |
| ZeRO-1 | ~28 GB（P+G + O/8） |
| ZeRO-2 | ~18 GB |
| ZeRO-3 | ~8 GB（8 卡） |

## 三、激活检查点（Gradient Checkpointing）

```
问题：前向计算中间激活值要存着供反向传播，激活值随序列长度爆炸

激活检查点思路：用算力换显存
  - 前向时只存部分层的激活（检查点）
  - 反向时重新前向计算中间激活
  → 显存从 O(L) 降到 O(√L)（L=层数）
  → 代价：前向多算 ~33%（重算部分层）
```

**适合长序列/大 batch**：激活值是显存大头时效果显著。

## 四、Offload：卸载到 CPU/NVMe

```
ZeRO-Offload：
  把优化器状态卸载到 CPU 内存（甚至 NVMe 磁盘）
  → GPU 显存不够时还能训
  → 代价：CPU↔GPU 通信慢，训练速度降

ZeRO-Infinity：
  进一步扩展到 NVMe，支持 PB 级模型
  → 极慢但能训（研究/调试用）
```

## 五、3D 并行（配合 Megatron-LM）

```
1. 数据并行（DP）：不同 GPU 处理不同 batch
2. 张量并行（TP）：矩阵乘法切到不同 GPU（Megatron）
3. 流水线并行（PP）：模型按层切到不同 GPU（前几层在GPU1，后几层在GPU2）

3D 并行 = DP × TP × PP
  → 超大规模训练（万亿参数）
  → DeepSpeed 负责 DP/ZeRO，Megatron 负责 TP/PP
```

## 六、DeepSpeed 在 RLHF 中的应用

```
RLHF 训练要同时驻留多个模型：
  - Actor（策略模型）
  - Critic（价值模型，PPO 用）
  - Reward Model（奖励模型，冻结）
  - Reference Model（参考模型，冻结）

显存爆炸！DeepSpeed-Chat / OpenRLHF 用 ZeRO-3 + offload：
  - 每个模型都分片
  - 不用的模型 offload 到 CPU
  → 让 RLHF 在有限 GPU 上跑得动
```

## 七、加分点

- 说出 **ZeRO 三阶段的递进关系**：Z1 分 O，Z2 加 G，Z3 加 P
- 说出 **ZeRO-3 的代价是通信**：前向/反向都要 all-gather 参数，通信量大
- 说出 **DeepSpeed-Chat**：DeepSpeed 专门为 RLHF 做的集成（多个模型共存）

## 八、雷区

- ❌ "ZeRO 是新的并行方式" → 它是数据并行 + 消除冗余
- ❌ "ZeRO-3 一定比 ZeRO-1 好" → ZeRO-3 通信开销大，小模型用 Z1/Z2 够
- ❌ 混淆 ZeRO 和 FSDP → FSDP（PyTorch 原生）类似 ZeRO-3，DeepSpeed 是先驱

## 九、扩展

- **FSDP（Fully Sharded Data Parallel）**：PyTorch 原生的 ZeRO-3 实现，逐渐成为标准
- **Megatron-LM**：NVIDIA 的张量并行库，和 DeepSpeed 配合做 3D 并行
- **ZeRO 的通信复杂度**：Z1 额外 all-reduce（梯度），Z3 额外 all-gather（参数），Z3 通信最重
