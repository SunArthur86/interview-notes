---
id: note-bg-008
difficulty: L4
category: ai
subcategory: Infra
tags:
- 八股总结
- 面经
- 分布式训练
- Tensor Parallel
- Pipeline Parallel
- Data Parallel
- 通信开销
feynman:
  essence: TP切分模型每一层的参数到多卡（层内并行），PP切分模型的不同层到不同卡（层间流水线），DP让每卡持有完整模型副本处理不同数据（数据并行）。TP通信在层内（频繁但量小），PP通信在层间（不频繁但可能阻塞），DP通信在梯度同步（批量同步）。
  analogy: TP像多人合作画一幅画的"同一部分"（每人画几笔颜色，画完拼一起）。PP像流水线工厂——每人负责一道工序，画传到下一人。DP像多个画师各画一幅相同的画，最后对比笔记统一风格。
  first_principle: 分布式训练的本质是"把大模型+大数据的计算拆分到多卡"。三个维度可切分：层内参数(TP)、层间流水线(PP)、数据批次(DP)。切分带来并行加速，但引入通信开销。最优策略是"计算/通信比最大化"。
  key_points:
  - TP：矩阵按列/行切分到多卡，层内AllReduce通信（频繁）
  - PP：模型按层切分到多卡，层间P2P通信（流水线气泡）
  - DP：完整模型副本，梯度AllReduce同步（批量）
  - TP过大→通信占比升高→训练变慢（通信无法被计算掩盖）
  - 3D并行：TP×PP×DP组合（千卡规模必备）
first_principle:
  essence: 分布式训练的效率 = 计算时间 / (计算时间 + 通信时间)
  derivation: TP在每次前向传播的每一层都需要AllReduce同步（每层2次），通信频率高，当TP过大时通信无法被计算掩盖。PP通信只在层边界（每层1次），但有流水线气泡。DP通信在每个micro-batch梯度同步时（批量），容易被计算掩盖。三者各有适用规模。
  conclusion: 选型原则=小模型DP为主，中等模型TP+DP，千亿模型TP+PP+DP
follow_up:
- 如何选择TP/PP/DP的组合？有什么经验公式？
- Pipeline Parallel的bubble ratio怎么计算和降低？
- ZeRO、FSDP和传统DP有什么区别？
memory_points:
- 三者对比：DP切数据全量模型，TP层内切矩阵，PP层间切流水线
- DP机制：每卡独立算前向反向，最后AllReduce通信平均梯度
- TP变慢原因：因层内频繁AllReduce通信开销暴增，故切卡过多反降计算效率
- PP气泡问题：因层间串行执行需前后等待，导致GPU产生大量空闲流水线气泡
---

# 【八股总结】TP/PP/DP 分布式策略 & TP 开大为什么变慢

## 一、三种并行策略详解

### 1.1 Data Parallel（数据并行）

```
原理：每张卡持有完整模型副本，处理不同的数据batch

GPU 0: 完整模型 + Batch 0 → 前向 → 反向 → 梯度0
GPU 1: 完整模型 + Batch 1 → 前向 → 反向 → 梯度1
GPU 2: 完整模型 + Batch 2 → 前向 → 反向 → 梯度2
GPU 3: 完整模型 + Batch 3 → 前向 → 反向 → 梯度3
                                         ↓
                              AllReduce: 梯度平均
                                         ↓
                              所有GPU同步更新参数

特点：
- 显存：每卡存完整模型（参数+梯度+优化器状态）
- 通信：反向传播后AllReduce梯度（每step一次，批量）
- 限制：单卡装不下完整模型时无法用
- 适合：模型≤单卡显存（如7B在80G卡上）
```

```python
# PyTorch DDP示意
import torch.distributed as dist

model = MyModel().cuda()
model = DDP(model)  # 自动处理梯度AllReduce

for batch in dataloader:
    loss = model(batch)
    loss.backward()  # DDP自动在反向时AllReduce梯度
    optimizer.step()
```

### 1.2 Tensor Parallel（张量并行）

```
原理：把模型每一层的参数矩阵切分到多张卡，层内并行

以Linear层 Y = X·W 为例，W按列切分到2卡：

GPU 0: Y_0 = X · W_0   (W的前半列)
GPU 1: Y_1 = X · W_1   (W的后半列)
         ↓ AllReduce
Y = Y_0 + Y_1  (合并结果)

每层都需要AllReduce通信（前向+反向各一次）

特点：
- 显存：每卡只存部分参数（减N倍）
- 通信：每层2次AllReduce（非常频繁！）
- 优势：模型再大也能放下（切分到足够多的卡）
- 适合：单层参数太大（如4096×4096的矩阵）
```

```python
# Tensor Parallel的ColumnParallelLinear
class ColumnParallelLinear:
    """权重按列切分"""
    def __init__(self, in_features, out_features, tp_size):
        # 每卡只有 out_features/tp_size 列
        self.weight = nn.Parameter(torch.randn(
            in_features, out_features // tp_size
        ))

    def forward(self, x):
        y = x @ self.weight  # 每卡独立计算
        # 前向需要AllReduce合并（如果是非最后层）
        y = all_reduce(y)
        return y
```

### 1.3 Pipeline Parallel（流水线并行）

```
原理：把模型的不同层分配到不同卡，数据像流水线一样流过

GPU 0: Layer 0-7    → 产出传给GPU 1
GPU 1: Layer 8-15   → 产出传给GPU 2
GPU 2: Layer 16-23  → 产出传给GPU 3
GPU 3: Layer 24-31  → 输出

层间通信：P2P（点对点），只在层边界

问题：流水线气泡（Bubble）
时间 →
GPU0: [Batch0][----空----][Batch1][----空----]
GPU1: [----空----][Batch0][----空----][Batch1]
GPU2: ...（等GPU1完成后才能开始）

气泡=等待时间，降低了GPU利用率
```

```python
# Pipeline并行的1F1B调度（1 Forward 1 Backward）
def pipeline_schedule(model_stages, num_microbatches):
    """每个stage处理microbatch，交叉前向反向"""
    for step in range(num_microbatches):
        # 前向：microbatch从stage0流向stageN
        for stage in model_stages:
            activation = stage.forward(activation)
            send_to_next_stage(activation)

        # 反向：microbatch从stageN流回stage0
        for stage in reversed(model_stages):
            gradient = stage.backward(gradient)
            send_to_prev_stage(gradient)
```

## 二、TP/PP/DP 对比

```
┌──────────┬──────────────────┬──────────────────┬──────────────────┐
│          │ DP               │ TP               │ PP               │
├──────────┼──────────────────┼──────────────────┼──────────────────┤
│ 切分对象 │ 数据             │ 层内参数         │ 层间（不同层）   │
│ 通信频率 │ 每step一次       │ 每层2次          │ 每stage边界      │
│ 通信类型 │ AllReduce(批量)  │ AllReduce(频繁)  │ P2P(点对点)      │
│ 显存节省 │ 无（每卡完整）   │ 参数减N倍        │ 参数减N倍        │
│ 气泡     │ 无               │ 无               │ 有（流水线气泡） │
│ 实现难度 │ 简单(DDP)        │ 中(Megatron)     │ 中(PipeDream)    │
│ 典型规模 │ 8-64卡           │ 8卡内            │ 4-16 stages      │
└──────────┴──────────────────┴──────────────────┴──────────────────┘
```

## 三、TP 开大为什么变慢

### 3.1 通信开销分析

```python
# 单层Linear的TP通信成本
def tp_communication_cost(layer, tp_size, batch_size, seq_len, hidden):
    # 每层2次AllReduce（前向+反向）
    # 每次AllReduce传输的数据量 = batch_size × seq_len × hidden
    data_per_allreduce = batch_size * seq_len * hidden  # 激活值大小

    # AllReduce的通信复杂度：O(数据量 × log(tp_size))
    comm_time = data_per_allreduce * log2(tp_size) / bandwidth
    # tp_size越大，通信时间越长（log增长）

    # 计算时间（每卡只算 1/tp_size 的参数）
    compute_time = (batch_size * seq_len * hidden * hidden / tp_size) / flops

    # 计算/通信比
    ratio = compute_time / comm_time
    return ratio
    # 当tp_size增大：计算时间↓（线性），通信时间↑（log）
    # 比例下降 → 通信占比升高 → 训练变慢
```

### 3.2 通信无法被计算掩盖

```
理想情况：通信和计算重叠（overlap），通信时间被"藏"在计算时间里
  计算 ──────┐
  通信    ───┘  ← 通信在计算时进行，不额外耗时

TP的实际问题：通信依赖计算结果，无法完全overlap
  前向：先计算 → 再通信（AllReduce合并）
  GPU0: [计算Y_0]→[等AllReduce]→[计算下一层]
                              ↑ 这段时间其他卡也在等
  当tp_size大，AllReduce耗时长，GPU空闲等待

TP=8时的通信时间占比（典型）：
├── 隐藏层4096：通信占15%（可接受）
├── 隐藏层8192：通信占25%（偏高）
└── TP=16时：通信占比可能达40%（明显变慢）
```

### 3.3 NCCL AllReduce的实际瓶颈

```python
# AllReduce的实际性能（NCCL实现）
# Ring AllReduce: 每个节点发送/接收 2×(N-1)/N × 数据量

def all_reduce_time(data_size, n_gpus, bandwidth=100e9):  # 100GB/s NVLink
    # Ring算法：需要2(n-1)步
    steps = 2 * (n_gpus - 1)
    data_per_step = data_size * (n_gpus - 1) / n_gpus
    latency = steps * 1e-6  # 每步1μs延迟
    transfer = data_per_step / bandwidth
    return latency + transfer

# TP=4: 2.5μs + 0.3ms ≈ 0.3ms
# TP=8: 4.5μs + 0.4ms ≈ 0.4ms
# TP=16: 8.5μs + 0.5ms ≈ 0.5ms
# 看起来不多，但乘以层数（32层×2次=64次/step）：
# TP=4: 64 × 0.3ms = 19ms
# TP=16: 64 × 0.5ms = 32ms  ← 多出13ms/step
```

### 3.4 TP过大的其他问题

```
1. NVLink拓扑限制
   - 单机8卡内NVLink全连接，通信快
   - 跨机TP需要走InfiniBand，带宽骤降10倍
   - TP>8（跨机）几乎不可行

2. GPU利用率下降
   - TP切分后每卡的计算量减少
   - 小矩阵乘法的GPU利用率低于大矩阵
   - TP=16时每卡只算1/16的矩阵，SM利用率低

3. 显存碎片
   - 频繁的AllReduce导致显存碎片化
   - 影响KV-cache等其他显存使用
```

## 四、如何选择并行策略

### 4.1 经验法则

```python
def choose_parallel_strategy(model_size, gpu_count, gpu_memory=80e9):
    """
    model_size: 模型参数量
    gpu_count: GPU数量
    """
    # 单卡能放下？→ 用DP
    model_memory = model_size * 16  # 参数(2)+梯度(2)+优化器(12) bytes
    if model_memory < gpu_memory * 0.7:
        return {"dp": gpu_count, "tp": 1, "pp": 1}

    # 中等模型（10-70B）：TP + DP
    if model_size < 70e9:
        tp = 8  # 单机8卡TP
        dp = gpu_count // tp
        return {"dp": dp, "tp": tp, "pp": 1}

    # 大模型（70B+）：TP + PP + DP（3D并行）
    tp = 8       # 单机内TP
    pp = 4       # 跨机PP
    dp = gpu_count // (tp * pp)
    return {"dp": dp, "tp": tp, "pp": pp}

# 示例：
# 7B模型, 8卡:   DP=8 (纯数据并行)
# 70B模型, 64卡:  TP=8, DP=8
# 175B模型, 1024卡: TP=8, PP=8, DP=16
```

### 4.2 典型配置

```
┌──────────┬──────┬──────┬──────┬────────────────┐
│ 模型规模 │ TP   │ PP   │ DP   │ 总GPU          │
├──────────┼──────┼──────┼──────┼────────────────┤
│ 7B       │ 1    │ 1    │ 8    │ 8 (单机)       │
│ 13B      │ 2    │ 1    │ 4    │ 8              │
│ 70B      │ 8    │ 1    │ 8    │ 64             │
│ 175B     │ 8    │ 8    │ 16   │ 1024           │
│ 405B     │ 8    │ 16   │ 32   │ 4096           │
└──────────┴──────┴──────┴──────┴────────────────┘

经验：
- TP通常=8（单机内，NVLink全连接）
- PP根据模型层数和GPU数调整（通常4-16）
- DP用剩余GPU（越大吞吐越高）
```

## 五、现代优化：ZeRO/FSDP

### 5.1 ZeRO：DP的显存优化

```python
# 传统DP：每卡存完整（参数+梯度+优化器状态）
# ZeRO：把这三部分也切分到多卡

ZeRO-1: 切分优化器状态（省4x）
  GPU0: 完整参数 + 优化器状态0
  GPU1: 完整参数 + 优化器状态1
  # 参数仍在每卡，但优化器状态分片

ZeRO-2: 切分优化器状态 + 梯度（省8x）
  GPU0: 完整参数 + 梯度0 + 优化器状态0
  # 梯度也分片，反向后Reduce-Scatter

ZeRO-3: 切分优化器状态 + 梯度 + 参数（省Nx，即FSDP）
  GPU0: 参数0(用时all-gather) + 梯度0 + 优化器状态0
  # 参数也分片，前向时all-gather收集
  # = FSDP (Fully Sharded Data Parallel)
```

### 5.2 FSDP vs TP

```python
# FSDP和TP都能减显存，但通信模式不同：

# FSDP（ZeRO-3）：
# - 通信：前向all-gather参数，反向reduce-scatter梯度
# - 频率：每层2次（类似TP）
# - 区别：FSDP通信的是参数（大），TP通信的是激活（小）
# - FSDP通信量更大，但实现简单（不需改模型代码）

# TP：
# - 通信：AllReduce激活值
# - 需要修改模型代码（ColumnParallelLinear等）
# - 通信量更小，效率更高

# 实践：FSDP适合≤100B（实现简单），TP+PP适合≥100B（效率优先）
```

## 加分点

1. **理解通信和计算的overlap**：TP变慢的本质是"通信无法被计算完全掩盖"，体现对硬件的理解
2. **知道NVLink拓扑限制**：TP>8（跨机）不现实，因为跨机带宽骤降
3. **提到3D并行**：千亿模型必须TP+PP+DP组合，单一策略不够

## 雷区

- **认为TP越大越好**：TP过大会因通信开销变慢，通常不超过8（单机）
- **混淆FSDP和TP**：FSDP是数据并行+参数分片，TP是模型并行，通信模式不同
- **忽视PP的气泡**：PP有空闲等待，需要1F1B等调度算法缓解

## 扩展

- **Megatron-LM**：NVIDIA的TP+PP+DP实现框架，3D并行的标杆
- **DeepSpeed ZeRO**：微软的显存优化方案，ZeRO-3即FSDP
- **Sequence Parallel**：TP的变体，把序列维度也切分，进一步减通信
- **Ring Attention**：长序列场景的特殊并行，跨GPU分布式attention

## 记忆要点

- 三者对比：DP切数据全量模型，TP层内切矩阵，PP层间切流水线
- DP机制：每卡独立算前向反向，最后AllReduce通信平均梯度
- TP变慢原因：因层内频繁AllReduce通信开销暴增，故切卡过多反降计算效率
- PP气泡问题：因层间串行执行需前后等待，导致GPU产生大量空闲流水线气泡


## 苏格拉底式面试追问

> 这组追问模拟面试官层层逼问，每一问先回答"为什么"，再回答"怎么做"，最后回答"如何证明"。

### 第一层：目标与动机

**Q：你训一个 70B 模型，单卡 A100 80G 放不下，为什么首先想到 TP（Tensor Parallel）而不是 PP（Pipeline Parallel）或 DP（Data Parallel）？**

先排除 DP——DP 要求每卡放完整模型副本，70B 模型 fp16 要 140GB，单卡 80G 放不下，DP 直接不可行。再看 TP vs PP：TP 把每一层的权重矩阵切到多卡，单卡只需放 1/N 的参数，70B 切到 8 卡每卡约 17.5GB 参数，激活值也能放下。TP 的优势是层内 AllReduce 通信在高带宽 NVLink（单机内 600GB/s）下能被计算掩盖，延迟低。PP 虽然也能切参数，但层间串行产生流水线气泡（bubble），且首尾 stage 空闲。所以单机 8 卡内优先 TP，跨机才考虑加 PP。

### 第二层：证据与定位

**Q：你说 TP 开太大（如 TP=16）反而变慢，怎么从指标上发现这个问题？**

看两个指标。1）通信占比——用 Nsight Systems 抓 profile，看 AllReduce 通信时间占 step 总时间的比例。TP=2 时通信占比通常 <15%（被计算掩盖），TP=8 升到 30%，TP=16（跨机）可能到 60%+。2）计算效率——TFLOPS 实测值除以峰值（A100 fp16 约 312 TFLOPS），TP=2 时 MFU（Model FLOPs Utilization）能到 50%，TP=16 可能降到 20%。当通信占比超过 40%、MFU 跌破 30%，就说明 TP 切太多，通信开销已经无法被计算掩盖，要降 TP 引入 PP。

### 第三层：根因深挖

**Q：TP 的通信是 AllReduce（层内同步），为什么会成为瓶颈？通信量到底有多大？**

TP 在每一层的前向和反向各有一次 AllReduce。通信量 = batch_size × sequence_length × hidden_dim × 4 bytes（fp32）。以 70B 模型为例，hidden_dim=8192，batch=8，seq=4096，单次 AllReduce 通信量 = 8×4096×8192×4 ≈ 1GB。TP=N 时 AllReduce 要做 ring-allreduce，通信轮次和 N 相关，跨机时带宽从 NVLink 的 600GB/s 骤降到 IB 网络的 50-100GB/s，单次 AllReduce 从 1.6ms 升到 20ms+。每层 2 次 AllReduce，70B 有 80 层，一步训练 160 次 AllReduce，跨机 TP 的通信总时间能到 3 秒，比计算时间还长。

**Q：既然 TP 通信这么贵，为什么不全部用 PP（层间只 P2P 通信，通信量小）？**

PP 有两个 TP 没有的硬伤。1）流水线气泡——PP 是层间串行，前向时第一个 stage 算完第二 stage 才开始，反向时反过来，首尾 stage 大量空闲。bubble ratio = (stages-1)/micro_batches，micro_batches 不够大时气泡占比能到 30-50%。2）负载不均——不同 stage 的计算量可能不同（如 embedding 层和 transformer 层），导致最慢的 stage 拖累全局。TP 没有气泡问题（层内并行同步）。所以实务是 TP+PP 组合——单机内 TP（NVLink 掩盖通信），跨机 PP（减少跨机通信频率），这就是千亿模型的 3D 并行。

### 第四层：方案权衡

**Q：TP、PP、DP 怎么组合？给一个 70B 模型训 8 机 64 卡（每机 8×A100）的配置。**

经验公式：TP=单机卡数=8（NVLink 内），PP=模型层数/单卡能放的层数，DP=总卡数/(TP×PP)。70B 模型 80 层，单卡 80G 放不下完整层，TP=8 后单卡约 17.5GB 参数+激活，每卡能放约 10-20 层，PP=4-8。取 PP=4，则 DP=64/(8×4)=2。最终配置：TP=8（机内）× PP=4（跨机，每 stage 20 层）× DP=2（数据并行）。再配合 1F1B 调度减少气泡、ZeRO-1 切优化器状态。这个配置 MFU 能到 45%+。如果是 7B 小模型，单机 8 卡 TP=8 就够，PP=1，DP=机数。

**Q：为什么不直接用 FSDP（ZeRO-3）切参数，而要上 TP+PP 这么复杂？FSDP 不用改模型代码，多省事。**

FSDP 适合 ≤100B 的模型，但有两个 TP 没有的问题。1）通信量更大——FSDP 每层前向要 all-gather 完整参数（通信参数量大小），反向要 reduce-scatter 梯度，而 TP 通信的是激活值（远小于参数）。70B 参数 fp16 是 140GB，每层 all-gather 通信量巨大。2）TP 的通信（激活值 AllReduce）量小且在高带宽 NVLink 内，FSDP 的大通信量在跨机时瓶颈明显。实测 70B 规模，TP+PP 的 MFU 比 FSDP 高 15-20%。所以追求效率的大模型选 TP+PP（需改模型代码用 ColumnParallelLinear），FSDP 适合快速原型或 ≤30B 的中小模型。

### 第五层：验证与沉淀

**Q：你怎么证明你的 TP/PP/DP 配置是最优的，而不是"能跑但浪费"？**

做配置搜索：固定模型和数据，跑几组配置（TP=8/PP=4/DP=2、TP=4/PP=8/DP=2、TP=8/PP=2/DP=4 等），每组跑相同步数，对比：1）MFU——越高越好，目标 >45%；2）单步时间——越短越好；3）显存占用——不 OOM 的前提下。最优配置是"MFU 最高且单步最快"的那个。还要验证气泡比例——用 profile 工具看 PP 的 stage 空闲时间占比，目标 <15%（通过增加 micro_batches 优化）。最终配置定型前，跑一个 1000 步的稳定性测试，确认 loss 曲线正常、无 OOM、无通信超时。

**Q：分布式策略选型经验怎么沉淀成团队 SOP，避免每个新模型都重新搜配置？**

整理成"模型规模 → 并行配置"对照表：7B→TP=8/PP=1（单机）；70B→TP=8/PP=4/DP=2（多机）；175B→TP=8/PP=8/DP=4+ZeRO-1。配上每种的 MFU 基线、气泡比例、通信参数。再把配置搜索脚本（自动遍历 TP/PP/DP 组合、跑 100 步、输出 MFU）集成到训练框架，新模型输入参数规模自动推荐配置。最后建一个分布式训练 troubleshooting 手册：OOM 怎么调（降 batch/加 ZeRO/加 PP）、通信超时怎么查（NCCL debug、拓扑）、MFU 低怎么诊断（profile 看 compute/comm 占比），新人照着 SOP 走能少走 80% 弯路。

## 结构化回答

**30 秒电梯演讲：** TP切分模型每一层的参数到多卡（层内并行），PP切分模型的不同层到不同卡（层间流水线），DP让每卡持有完整模型副本处理不同数据（数据并行）。TP通信在层内（频繁但量小），PP通信在层间（不频繁但可能阻塞）。

**展开框架：**
1. **TP** — 矩阵按列/行切分到多卡，层内AllReduce通信（频繁）
2. **PP** — 模型按层切分到多卡，层间P2P通信（流水线气泡）
3. **DP** — 完整模型副本，梯度AllReduce同步（批量）

**收尾：** 您想深入聊：如何选择TP/PP/DP的组合？有什么经验公式？


## 视频脚本

> 预计时长：5 分钟 | 由浅入深


| 时间 | 画面/字幕 | 口播台词 | 讲解要点 |
|------|----------|----------|----------|
| 0:00 | 标题卡：TP/PP/DP 分布式策略 & TP 开大为什… | "TP像多人合作画一幅画的"同一部分"（每人画几笔颜色，画完拼一起）。PP像流水线工厂——每…" | 开场钩子 |
| 0:20 | 核心概念图 | "TP切分模型每一层的参数到多卡（层内并行），PP切分模型的不同层到不同卡（层间流水线），DP让每卡持有完整模型副本处理不…" | 核心定义 |
| 0:50 | TP示意图 | "TP——矩阵按列/行切分到多卡，层内AllReduce通信（频繁）" | 要点拆解1 |
| 1:30 | PP示意图 | "PP——模型按层切分到多卡，层间P2P通信（流水线气泡）" | 要点拆解2 |
| 2:20 | 对比/实战案例图 | "对比一下常见误区和工程实践，看真实场景里怎么取舍。" | 实战与对比 |
| 3:10 | 总结卡 | "记住核心要点。下期我们追问：如何选择TP/PP/DP的组合？有什么经验公式？" | 收尾与钩子 |
