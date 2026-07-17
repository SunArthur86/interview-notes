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
  - Z1省4倍显存，Z2再省一点，Z3让单卡只存1/N参数
  - '激活检查点: 用算力换显存(只存部分激活，反向时重算)'
  - 'Offload: 卸载到CPU/NVMe进一步省显存(慢但能训)'
  - 配合Megatron做张量并行+流水线并行(3D并行)
first_principle:
  essence: DeepSpeed = 消除数据并行的冗余
  derivation: 数据并行每卡存完整副本 → 显存冗余 → ZeRO 分片消除冗余 → 显存随GPU数线性降 → 大模型可训
  conclusion: ZeRO 不是新并行方式，是"数据并行 + 消除冗余"的极致优化
follow_up:
- ZeRO-3 的通信开销大不大？
- 激活检查点的"重算"代价多大？
- ZeRO 和 FSDP 什么关系？
memory_points:
- DeepSpeed核心：基于数据并行，通过ZeRO分片解决大模型显存冗余
- ZeRO三阶段口诀：Z1切优化器，Z2加切梯度，Z3全切（含参数）
- ZeRO-3代价：显存随卡数线性降，但前向反向通信开销巨大
- 激活检查点：用算力换显存，只存部分层，反向重算降显存
- RLHF扩展：多模型共存显存爆炸，靠ZeRO-3+CPU卸载解决
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

## 记忆要点

- DeepSpeed核心：基于数据并行，通过ZeRO分片解决大模型显存冗余
- ZeRO三阶段口诀：Z1切优化器，Z2加切梯度，Z3全切（含参数）
- ZeRO-3代价：显存随卡数线性降，但前向反向通信开销巨大
- 激活检查点：用算力换显存，只存部分层，反向重算降显存
- RLHF扩展：多模型共存显存爆炸，靠ZeRO-3+CPU卸载解决

## 苏格拉底式面试追问

> 这组追问模拟面试官层层逼问，每一问先回答"为什么"，再回答"怎么做"，最后回答"如何证明"。

### 第一层：目标与动机

**Q：DeepSpeed 的 ZeRO 本质是"消除数据并行的冗余"。但为什么不直接用模型并行（把模型切开分到多卡）？模型并行没冗余，岂不是更彻底？**

模型并行（TP/PP）确实没冗余，但有自己的代价，ZeRO 是不同维度的优化，两者互补。模型并行（张量并行 TP、流水线并行 PP）的问题：一是通信频繁——TP 每层矩阵乘法都要 all-reduce（通信量与隐藏维度成正比），PP 在层间传激活（bubble 浪费）；二是扩展性差——TP 超过 8 卡（单机 NVLink）通信成本爆炸，PP 的 bubble 随流水线深度增大；三是工程复杂——要改模型代码切分矩阵/层，调试难。ZeRO 的优势：一是语义简单（数据并行 + 分片），不改模型代码，即插即用；二是扩展性好（通信是 all-gather/reduce-scatter，通信量与卡数关系温和）；三是灵活性（Z1/Z2/Z3 可按需选择，显存不够再升级）。所以实践中两者结合（3D 并行：DP/ZeRO + TP + PP），用 TP/PP 切模型到单机内（NVLink 高带宽），用 ZeRO 做跨机的数据并行分片。ZeRO 不是"比模型并行更好"，是"数据并行维度的极致优化"，与模型并行正交互补。纯模型并行在超大模型（万亿参数）下必须用，但 ZeRO 让中等规模（百 B）训练更简单高效。

### 第二层：证据与定位

**Q：你说 ZeRO-3 让显存随卡数线性降。但实际跑起来，怎么确认 ZeRO 真的生效了？监控哪些指标能区分"ZeRO-3 正常工作"和"配置错了退化成 DDP"？**

监控几路信号。一是单卡显存峰值：ZeRO-3 生效时单卡显存应远小于模型大小（如 7B 模型 FP16+Adam，DDP 单卡 ~112GB 装不下，ZeRO-3 在 8 卡下 ~8GB）。如果显存接近模型大小，说明分片没生效。二是通信模式：ZeRO-3 的特征是前向/反向时大量 all-gather（收集完整参数）和 reduce-scatter（分片梯度），用 nvidia-smi 或 NCCL 日志看通信量——ZeRO-3 通信量远大于 ZeRO-1/2（因为频繁 gather 参数）。如果通信量很小，可能退化成 DDP。三是 DeepSpeed 的运行日志：启动时打印 ZeRO 配置（stage=3，各分片大小），训练中打印"param partition"日志。四是显存分解：DeepSpeed 有 memory logger，能看到显存花在哪些部分（参数/梯度/优化器/激活/碎片），ZeRO-3 生效时参数/梯度/优化器显存都应按 1/N 缩放。五是验证实验：故意把模型放大到 DDP 装不下（如 70B），如果 ZeRO-3 配置正确能跑，配置错了 OOM。定位配置错误：常见是 stage 设错（设成 1/2 而非 3）、或 CPU offload 没开导致 ZeRO-3 显存仍不够、或与 TP/PP 配置冲突。用 DeepSpeed 的 `--zero_stage=3` 显式指定，配合 memory logger 确认分片生效。

### 第三层：根因深挖

**Q：ZeRO-3 的代价是"前向/反向都要 all-gather 参数"。这个通信开销到底多大？会不会让 ZeRO-3 比 ZeRO-2 慢很多，反而得不偿失？**

ZeRO-3 的通信开销确实显著，但"得不偿失"取决于显存是否够用。通信分析：ZeRO-3 每层前向要 all-gather 完整参数（通信量 = 参数大小），反向也要 all-gather（重算用）+ reduce-scatter（梯度分片），总通信量约是 ZeRO-1 的 2-3 倍（Z1 只额外 all-reduce 梯度）。带宽利用：如果 GPU 间带宽高（NVLink 300GB/s 或 InfiniBand 50GB/s），all-gather 的延迟可被计算重叠（prefetch 预取下一层参数），实际开销可控；如果带宽低（普通以太网），all-gather 成为瓶颈，ZeRO-3 显著慢。实测：在 NVLink 内（8 卡 A100），ZeRO-3 比 ZeRO-2 慢约 10-20%（通信重叠好）；跨机（InfiniBand），慢 30-50%。权衡逻辑：如果 ZeRO-2 显存够（模型装得下），用 Z2 避免通信开销；如果 Z2 不够（模型太大），Z3 是"能训 vs 不能训"的问题，慢一点也值。所以不是"ZeRO-3 总是更好"，是"显存不够时才用 Z3，否则用 Z1/Z2"。DeepSpeed 的 ZeRO-Infinity（Z3 + CPU/NVMe offload）更进一步，通信更慢但能训 PB 级模型——是"研究能跑"的兜底，不是"生产最优"。

**Q：那如果 ZeRO-3 通信开销大，为什么不用"ZeRO-2 + 激活检查点 + 更大 batch"的组合省显存，避开 ZeRO-3 的通信？为什么不这么做？**

可以用"Z2 + 激活检查点"省显存，但省的维度不同，不能完全替代 Z3。显存分三块：参数 P、梯度 G、优化器状态 O、激活 A。ZeRO-2 分片 O+G（省 O+G 到 1/N），保留完整 P。激活检查点省 A（O(L) → O(√L)）。如果模型参数 P 本身就大（如 70B FP16 = 140GB），ZeRO-2 仍要每卡存完整 P（140GB），单卡装不下——这时必须 ZeRO-3 分片 P。"Z2 + 激活检查点"解决的是"O+G+A 占显存"的问题，解决不了"P 本身太大"的问题。增大 batch 省不了参数显存（P 与 batch 无关），只提高计算/通信比（摊薄 all-reduce 开销）。所以选择逻辑：如果 P 单卡装得下（如 7B/14B），用 Z2 + 激活检查点 + 大 batch，避免 Z3 通信；如果 P 单卡装不下（如 70B+），必须 Z3 分片 P。临界点大约是"单卡显存 ≥ 2×模型参数"（留余量给 G+O+A），低于这个就必须 Z3。实践中 70B 以上模型几乎都用 Z3 或 FSDP，7B-14B 用 Z2 足够。这是显存约束驱动的选择，不是"Z3 更先进所以用 Z3"。

### 第四层：方案权衡

**Q：激活检查点"用算力换显存"（前向重算降显存，代价多 ~33% 计算）。这个 33% 是怎么算的？什么场景下值得用，什么场景不值得？**

33% 的来源：激活检查点把 L 层分成 √L 个检查点段，每段 √L 层。前向时只存 √L 个检查点的激活（O(√L) 显存），反向时每段重新前向计算 √L 层的激活。重算的总层数 = √L 段 × √L 层/段 = L 层（但实际是分段重算，总重算约 L - √L ≈ L 层的前向计算）。原前向是 L 层，重算再加约 L 层前向，但重算只算前向（不算反向），而原训练是前向 + 反向（约 2L 计算量），所以总计算量 = 2L（原）+ L（重算）= 3L，相对原 2L 多 50%。但实践中不是所有层都检查点（只对大激活层如注意力），实际开销约 20-33%。值得用的场景：一是显存是瓶颈（OOM 或被迫用小 batch），激活检查点省显存换更大 batch，整体吞吐反而提升（大 batch 更好利用 GPU）。二是长序列（激活随序列长度平方增长，attention 激活巨大），检查点收益高。不值得的场景：一是显存充裕（小模型或大显存卡），检查点的重算纯亏（没换到 batch 提升）。二是计算是瓶颈（GPU 利用率已满），重算增加计算无益。实践中大模型训练几乎都开激活检查点（显存总是瓶颈），小模型或推理不用。

**Q：ZeRO-Offload 把优化器状态卸载到 CPU。但 CPU↔GPU 通信慢（PCIe 带宽远低于 NVLink）。这个卸载会不会让训练慢到不可用？什么时候值得用 offload？**

ZeRO-Offload 确实慢，但"能训 vs 不能训"的权衡下值得用。通信分析：优化器状态更新（Adam 的 m/v 更新）在 CPU 上做，每步要把梯度从 GPU 传到 CPU（PCIe ~32GB/s），更新后再传回（或部分传回）。相比纯 GPU（NVLink 300GB/s），PCIe 慢约 10 倍。实测：ZeRO-Offload 比纯 GPU 训练慢 1.5-3 倍（取决于 offload 比例和 overlap）。值得用的场景：一是显存严重不足（GPU 装不下模型 + 优化器），offload 是"能跑起来"的唯一选择——研究/调试阶段，慢但能验证正确性。二是利用闲置 CPU：如果 CPU 内存大（如 1TB）且 GPU 显存小，offload 把优化器放 CPU，GPU 专注计算，整体可行。三是不频繁更新的部分：优化器状态更新频率低（每步一次），offload 的通信可被计算 overlap 一部分。不值得的场景：一是生产训练（追求吞吐），offload 太慢。二是有足够 GPU（用 ZeRO-3 纯 GPU 分片更高效）。所以 offload 是"显存不够时的兜底"，不是"默认选择"。实践中常见于：单卡/少卡调试大模型（开发阶段）、或 GPU 显存特别小的环境（如消费级显卡训大模型），生产训练用纯 GPU ZeRO-3 或 3D 并行。

### 第五层：验证与沉淀

**Q：RLHF 要同时驻留 Actor + Critic + RM + Reference 四个模型，显存爆炸。怎么用 DeepSpeed 配置让这四个模型在有限 GPU 上跑得动？具体怎么分片和 offload？**

策略是"按模型特性差异化配置"。一是冻结模型（RM + Reference）不训：用 ZeRO-3 分片（省显存）但不配优化器状态（无反向传播），只驻留参数分片。或进一步 offload 到 CPU（推理时 gather 回 GPU，推理完 offload 回去），用时间换显存。二是训练模型（Actor + Critic）要反向传播：用 ZeRO-3 + 激活检查点 + 优化器状态分片，峰值显存控制在单卡容量内。如果仍不够，优化器状态 offload 到 CPU（更新时传回）。三是时序错峰：RLHF 的 rollout 阶段只用 Actor + RM（生成 + 打分），update 阶段只用 Actor + Critic + Reference（算 ratio 和 KL），可以把不用的模型 offload 到 CPU，用时再 load，用"时间换空间"。四是具体配置（DeepSpeed-Chat / OpenRLHF 风格）：Actor 用 ZeRO-3 + 激活检查点 + 优化器 offload；Critic 用 ZeRO-3 + 激活检查点；RM 和 Reference 用 ZeRO-3 参数分片（无优化器）；配合时序调度（rollout 时 load RM，update 时 load Reference）。五是替代方案：用 LoRA 只训少量参数，冻结 base 模型，大幅降显存（只存 LoRA 参数的优化器状态），适合资源极有限场景。配置目标是"四个模型的峰值显存总和 ≤ GPU 总显存"，通过分片 + offload + 时序调度实现。

**Q：怎么让团队在选 ZeRO 阶段时不乱选？沉淀一套"按模型规模和硬件选 ZeRO 阶段"的决策流程。**

沉淀决策树和配置模板。一是决策树：按"单卡显存 vs 模型参数"判断——模型参数 ×2 ≤ 单卡显存，用 DDP 或 ZeRO-1（够用）；模型参数 ×4 ≤ 单卡显存 × 卡数，用 ZeRO-2（分片 O+G）；模型参数 ×4 > 单卡显存 × 卡数，用 ZeRO-3（全分片）；ZeRO-3 仍不够，加 CPU offload（ZeRO-Offload）或 NVMe offload（ZeRO-Infinity）。二是配置模板：每个阶段的 DeepSpeed config 模板（stage、offload、activation checkpointing 开关、batch size 建议），开箱即用。三是性能调优指南：ZeRO-3 配合 prefetch（预取下一层参数 overlap 通信）、增大 batch（摊薄 all-gather 开销）、启用 activation checkpointing（省激活显存）；offload 时优化 CPU 多线程（Adam 更新并行化）。四是监控规范：训练中监控显存峰值（确认分片生效）、通信/计算比（GPU 利用率，判断是否通信瓶颈）、吞吐（samples/sec，对比基线）。五是踩坑库：常见问题（stage 配错退化 DDP、offload 太慢、与 TP/PP 冲突）及解决方案。让 ZeRO 选择是"按模型/硬件查决策树 → 用模板配置 → 监控验证 → 调优"的工程流程，不靠"试最高级的"。

## 结构化回答

**30 秒电梯演讲：** DeepSpeed 是微软开源的大模型训练优化库，核心能力是 ZeRO（Zero Redundancy Optimizer）三阶段显存优化——ZeRO-1 分片优化器状态、ZeRO-2 分片梯度。

**展开框架：**
1. **ZeRO 三阶段** — 优化器状态分片(Z1)+梯度分片(Z2)+参数分片(Z3)
2. **Z1** — Z1省4倍显存，Z2再省一点，Z3让单卡只存1/N参数
3. **激活检查点** — 用算力换显存(只存部分激活，反向时重算)

**收尾：** 您想深入聊：ZeRO-3 的通信开销大不大？


## 视频脚本

> 预计时长：4 分钟 | 由浅入深


| 时间 | 画面/字幕 | 口播台词 | 讲解要点 |
|------|----------|----------|----------|
| 0:00 | 标题卡：对 DeepSpeed 框架有没有了解 | "像搬家公司——一家搬不下的大件家具（大模型），DeepSpeed 拆散分到多辆车（多…" | 开场钩子 |
| 0:20 | 核心概念图 | "DeepSpeed 是微软开源的大模型训练优化库，核心能力是 ZeRO（Zero Redundancy…" | 核心定义 |
| 0:50 | ZeRO 三阶段示意图 | "ZeRO 三阶段——优化器状态分片(Z1)+梯度分片(Z2)+参数分片(Z3)" | 要点拆解1 |
| 1:30 | 对比/实战案例图 | "对比一下常见误区和工程实践，看真实场景里怎么取舍。" | 实战与对比 |
| 2:20 | 总结卡 | "记住核心要点。下期我们追问：ZeRO-3 的通信开销大不大？" | 收尾与钩子 |
