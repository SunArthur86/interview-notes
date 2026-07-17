---
id: note-bd3-011
difficulty: L3
category: ai
subcategory: 推理优化
tags:
- 字节跳动
- 面经
- 二面
feynman:
  essence: OOM排查从"谁在吃显存"出发——模型权重、KV Cache、激活值、框架开销四步定位
  analogy: 像水管爆裂排查——先关总阀(确认模型大小)，再查各支管(KV Cache/激活值/并发数)，最后找泄漏点(框架泄漏/碎片化)
  first_principle: GPU显存是有限资源，OOM意味着总需求超过供给。逐项排查每个显存消费者，找到最大的一项优化
  key_points:
  - '第一优先: 确认模型大小是否匹配GPU'
  - '第二优先: KV Cache随序列长度线性增长'
  - '第三优先: 并发请求 × 每请求KV Cache'
  - '第四优先: 框架开销(PagedAttention/激活值)'
first_principle:
  essence: 推理显存 = 模型权重 + KV Cache + 激活值 + 框架开销
  derivation: 模型权重是固定开销，KV Cache = f(seq_len × batch)，激活值 = g(seq_len × batch)。当batch或seq_len增大时，KV Cache是主要增长项
  conclusion: OOM排查应按"权重→KV Cache→并发→激活值"的优先级逐项优化
follow_up:
- 如何监控推理过程中的显存使用？
- PagedAttention如何减少KV Cache碎片？
- 长文本推理如何控制KV Cache显存？
memory_points:
- 排查顺口溜：权重定大小，KV吃变量，并发最吃紧，最后查激活
- 优先级1(模型权重)：模型装不下直接量化(INT8/INT4最立竿见影)
- 优先级2(KV Cache)：随并发和Seq_len呈倍数增长，是OOM最大变量
- 优先级3(并发控制)：通过限制batch_size和降低gpu_memory_utilization缓解
---

# 大模型推理时遇到OOM问题，你会从哪些方面入手排查和解决？

> 来源：字节跳动大模型技术面试二面

## 排查优先级决策树

```
                        OOM!
                         │
                    ┌────┴────┐
                    │ 模型放得下? │
                    └────┬────┘
                    否 ↙     ↘ 是
                      /        \
            ┌──────────┐   ┌──────────────┐
            │ 量化模型  │   │ KV Cache太大? │
            │ (第1优先) │   └──────┬───────┘
            └──────────┘     否 ↙   ↘ 是
                           /        \
                    ┌────────┐  ┌───────────────┐
                    │ 减并发  │  │ 减batch/seq_len│
                    │(第3优先)│  │   (第2优先)    │
                    └────────┘  └───────────────┘
```

## 按优先级详解

### 第1优先级：模型权重 (量化)

```
模型大小 vs GPU显存:

  LLaMA-2-7B FP16:  14 GB   → A100-40GB ✅
  LLaMA-2-13B FP16: 26 GB   → A100-40GB ✅ (剩余14GB给KV Cache)
  LLaMA-2-70B FP16: 140 GB  → 单卡 ❌ (需4×A100-40GB)

如果模型本身就占满或超过显存:
  → 量化! (最直接的解决方案)

  INT8:  7B → 7GB,   13B → 13GB,  70B → 70GB
  INT4:  7B → 3.5GB, 13B → 6.5GB, 70B → 35GB
```

### 第2优先级：KV Cache (减batch/seq_len)

```
KV Cache是推理时显存的最大变量:

  KV Cache = 2 × layers × heads × d_head × seq_len × batch × 2(fp16)

  LLaMA-2-7B (layers=32, heads=32, d=128):
    seq_len=2048, batch=1:   1.0 GB
    seq_len=2048, batch=8:   8.0 GB
    seq_len=8192, batch=1:   4.0 GB
    seq_len=8192, batch=8:  32.0 GB  ← OOM!

  优化手段:
    max_seq_len = 4096  (限制最大序列长度)
    max_batch_size = 4  (限制并发请求数)
```

### 第3优先级：并发请求数

```python
# vLLM配置
llm = LLM(
    model="llama-2-7b",
    # ★ 关键参数
    max_num_seqs=256,        # 最大并发序列数(默认256)
    gpu_memory_utilization=0.9,  # GPU显存使用率上限
    
    # 降低这些参数来减少KV Cache
    max_num_batched_tokens=8192,  # 每批最大token数
    max_seq_len=4096,            # 最大序列长度
)

# 如果OOM:
# 1. 降低 max_num_seqs (如256→64)
# 2. 降低 gpu_memory_utilization (如0.9→0.8)
# 3. 降低 max_seq_len (如4096→2048)
```

### 第4优先级：激活值与框架开销

```
激活值:
  - 前向传播的中间结果
  - ≈ batch × seq_len × hidden_dim × layers × 几个中间张量
  - Flash Attention已大幅减少激活值存储

框架开销:
  - PyTorch显存碎片: torch.cuda.empty_cache()
  - CUDA上下文: ~0.5-1GB
  - 临时buffer: 重用而非重复分配
```

## 排查工具

```python
# 1. PyTorch显存快照
import torch

def print_gpu_memory(tag=""):
    allocated = torch.cuda.memory_allocated() / 1024**3
    reserved = torch.cuda.memory_reserved() / 1024**3
    print(f"[{tag}] Allocated: {allocated:.2f} GB, Reserved: {reserved:.2f} GB")

# 2. 显存峰值追踪
print(f"Peak memory: {torch.cuda.max_memory_allocated() / 1024**3:.2f} GB")

# 3. 逐层显存profile
from torch.profiler import profile, ProfilerActivity

with profile(activities=[ProfilerActivity.CUDA], 
             record_shapes=True) as prof:
    model.generate(input_ids)

print(prof.key_averages().table(sort_by="cuda_memory_usage", row_limit=10))

# 4. nvidia-smi 实时监控
# watch -n 0.5 nvidia-smi
```

## 完整解决方案清单

| 优先级 | 方案 | 节省显存 | 代价 |
|--------|------|---------|------|
| 1 | INT4量化 (AWQ/GPTQ) | 75%权重 | 精度降0.5-1% |
| 2 | 减max_seq_len | 线性减KV Cache | 限制输入长度 |
| 3 | 减max_batch/concurrency | 线性减KV Cache | 吞吐量降低 |
| 4 | PagedAttention (vLLM) | 消除碎片40%+ | 需vLLM框架 |
| 5 | GQA (模型层面) | 减KV Cache 75% | 需重新选模型 |
| 6 | KV Cache量化 (INT8) | 减KV Cache 50% | 精度微降 |
| 7 | Tensor Parallel | 分摊到多卡 | 需多GPU |
| 8 | CPU Offloading | 理论无限 | 推理速度大降 |
| 9 | Sliding Window Attention | 固定KV Cache | 长距离信息丢失 |
| 10 | Flash Attention | 减激活值 | 无精度损失 |

## 实际排查案例

```
案例: LLaMA-2-13B 在 A100-40GB 上推理, batch=16, seq=4096

预估:
  模型权重: 26 GB
  KV Cache: 2×40×40×128×4096×16×2 / 1024^3 ≈ 15.6 GB
  激活值:   ~3 GB
  框架:     ~1 GB
  总计:     45.6 GB > 40 GB → OOM!

解决路径:
  Step 1: INT8量化 → 模型13GB, 总计32.6GB ✅
  Step 2: 如果还需更大batch → 降seq到2048 → KV Cache 7.8GB
  Step 3: 如果仍不够 → vLLM PagedAttention消除碎片
```

**面试加分点**：提到 `torch.cuda.memory_summary()` 获取详细显存分配报告；提到vLLM的profile_run功能可以自动测量显存峰值并设置安全余量；提到KV Cache量化(FP8/INT8)是最新的研究方向（如KIVI、FlexGen）；提到推理框架选择也很关键——vLLM和SGLang对显存管理远优于原生HuggingFace Transformers。

## 记忆要点

- 排查顺口溜：权重定大小，KV吃变量，并发最吃紧，最后查激活
- 优先级1(模型权重)：模型装不下直接量化(INT8/INT4最立竿见影)
- 优先级2(KV Cache)：随并发和Seq_len增长，是OOM最大变量
- 优先级3(并发控制)：通过限制batch_size和降低gpu_memory_utilization缓解

## 苏格拉底式面试追问

> 这组追问模拟面试官层层逼问，每一问先回答"为什么"，再回答"怎么做"，最后回答"如何证明"。

### 第一层：目标与动机

**Q：OOM 排查你按"权重 → KV Cache → 并发 → 激活"顺序。为什么是这个顺序？KV Cache 才是最大变量，为什么不先查它？**

按"确定性"和"可调节性"排序。权重是"确定大小"（模型参数固定，7B 模型 fp16 就是 14GB，INT4 就是 3.5GB），一眼能判断装不装得下，先排查（如果权重就超了，其他都不用看）。KV Cache 是"最大变量"（随并发数和 seq_len 倍数增长），但它的排查需要知道当前并发和 seq_len（运行时数据），比权重排查复杂。并发是"KV Cache 的驱动因素"（并发多 → KV Cache 大），排查并发能间接控制 KV Cache。激活值是"最小的且最难调"（激活值取决于 batch 和模型结构，通常不是 OOM 主因，且调起来复杂）。所以顺序是"先确定性的（权重），再变量的（KV Cache/并发），最后边缘的（激活）"。实际排查时，权重和 KV Cache 常同时看（权重大导致 KV Cache 空间少，触发 OOM）。

### 第二层：证据与定位

**Q：推理服务在并发到 50 时 OOM，但 40 时正常。怎么定位是 KV Cache 超了、激活值超了、还是框架开销（如 CUDA context）？**

看 OOM 时的显存分解。一是 KV Cache 占用——50 并发 × 每请求 KV Cache（如 200MB）= 10GB，如果总显存 80GB、权重 14GB、剩余 66GB，10GB KV Cache 应该够，但加上其他开销可能超；二是激活值——推理时的激活值（每 batch 的中间输出），并发 50 时 batch 大、激活值大（如 5GB），叠加 KV Cache 可能超；三是框架开销——PyTorch 的 CUDA context、workspace、临时 buffer，通常占 2-5GB（固定开销），容易被忽略。排查方法：用 `nvidia-smi` 看总显存，用 PyTorch 的 `torch.cuda.memory_summary()` 看各部分占用（权重/KV Cache/激活/buffer）。如果是 KV Cache 超（占 60GB+），降并发或限 seq_len；如果是框架开销超（buffer 占 10GB），调 PyTorch 的内存碎片策略或 vLLM 的 `gpu_memory_utilization`（给框架留更多余量）。

### 第三层：根因深挖

**Q：KV Cache 你说是 OOM 的最大变量。为什么它随"并发和 seq_len 倍数增长"？数学上怎么算？**

KV Cache 大小 = $2 \times \text{layers} \times \text{seq\_len} \times \text{hidden\_dim} \times \text{num\_requests} \times \text{precision}$。以 Llama-2-7B（layers=32、hidden_dim=4096、fp16）为例，单个请求的单 token KV Cache = $2 \times 32 \times 1 \times 4096 \times 2 = 512\text{KB}$。一个 2048 token 的请求 KV Cache = $512\text{KB} \times 2048 = 1\text{GB}$。50 个并发请求各 2048 token = 50GB。这是"乘法增长"——并发数 × seq_len，两者都大时 KV Cache 爆炸（如 50 并发 × 4096 token = 100GB，远超显存）。权重是固定的（14GB），KV Cache 是随负载动态变化的，所以是 OOM 的主要变量。控制 KV Cache 的方法：限制并发数（如 max_num_seqs=32）、限制 seq_len（如 max_model_len=2048）、用 GQA/MQA 减少 KV 头数、用 PagedAttention 减少碎片。

**Q：那为什么不直接用无限显存（如加更多 GPU 或用 CPU offload），省得精打细算 KV Cache？**

加 GPU 贵且不治本，CPU offload 慢。加 GPU 能增加总显存（如 4 卡 A100 = 320GB），但 KV Cache 随并发线性增长，高并发（如 200 用户）仍可能超（200 × 1GB = 200GB）。且加 GPU 增加成本（A100 昂贵）和复杂度（多卡通信）。CPU offload（把 KV Cache swap 到 CPU 内存）能缓解显存，但 PCIe 传输慢（GPU↔CPU 的带宽约 32GB/s，远低于 GPU 内部带宽），swap 时推理延迟暴涨（用户可感知的卡顿）。正确做法是"优化 KV Cache 使用效率"——用 PagedAttention 消除碎片（提升利用率）、用 GQA 减少 KV 大小、合理设置并发和 seq_len 上限、对长对话做摘要压缩（减少历史 token）。把显存用在刀刃上，而非盲目加硬件。KV Cache 管理是推理服务的核心优化点。

### 第四层：方案权衡

**Q：KV Cache 超了，你是限制并发（max_num_seqs）还是限制 seq_len（max_model_len）？两者都损害用户体验，怎么权衡？**

看业务场景的"敏感维度"。限制并发（如从 50 降到 30）——更多请求排队，延迟增加（用户等更久），但单请求的生成长度不限。适合"单请求质量优先"（如代码生成需要长输出，不能截断）。限制 seq_len（如从 4096 降到 2048）——单请求的上下文/输出被截断，但并发数高（更多用户同时服务）。适合"并发优先"（如客服对话，短交互多）。权衡方法：看业务的长请求比例——如果 90% 请求 <2048 token，限制到 2048 影响小（只截断 10% 长请求）；如果长请求多（如文档总结），限制 seq_len 损害大，优先限制并发。折中方案是"动态调节"——低峰期放宽（高并发 + 长 seq_len），高峰期收紧（降并发或 seq_len），根据负载动态调。vLLM 的 `gpu_memory_utilization` 可以让框架自动管理（设定利用率上限，框架自动算能支持多少并发）。

**Q：为什么不直接用 INT4 量化 KV Cache（而非量化权重），专门省 KV Cache？**

INT4 KV Cache 量化有效但精度风险。KV Cache 量化（把 fp16 的 K/V 压到 INT4）能把 KV Cache 缩小 4 倍（50GB → 12.5GB），直接解决并发 OOM。但 KV Cache 的精度对 attention 计算敏感——量化误差会被 softmax 放大（一个 K 的量化误差影响整个 attention 权重分布），导致生成质量下降（尤其在长序列，误差累积）。INT8 KV Cache 量化（缩 2 倍）精度损失小，INT4（缩 4 倍）风险大。当前主流是"权重 INT4 + KV Cache INT8"（权重对量化鲁棒，KV Cache 用较温和的 INT8），而非"KV Cache INT4"。KV Cache INT4 是研究前沿（如 KIVI、KVQuant），未来可能成熟，当前生产用 INT8 KV Cache 或不量化（保留 fp16）。权衡：KV Cache fp16 的并发低但质量好，INT8 的并发翻倍质量略降，INT4 的并发高但质量风险大。

### 第五层：验证与沉淀

**Q：你怎么衡量 OOM 排查的效果，证明"优化后能支持更高并发"？**

定义指标：一是最大并发数（优化前后，如从 30 提到 50），直接反映容量；二是显存利用率（优化后应 >85%，碎片消除）；三是 KV Cache 占比（应占总显存的 60-70%，权重 20-30%，其余开销 <10%）；四是延迟（并发提升后延迟不应显著涨，P99 <1s）。做压力测试：逐步增加并发（10/20/50/100），观察显存占用和是否 OOM，找到"不 OOM 的最大并发"。验证"PagedAttention 的效果"——对比开/关 PagedAttention 的最大并发（应提升 2-3 倍）。验证"GQA 的效果"——MHA vs GQA 的 KV Cache 大小（GQA 应小 4 倍）。关键监控"KV Cache 占用趋势"——随并发增长是否线性，有没有异常（如某请求的 KV Cache 异常大，可能是 seq_len 没限制）。

**Q：OOM 排查和显存优化怎么沉淀成推理服务运维标配？**

固化成"显存容量规划模板"：输入模型（参数量/量化精度）、SLA（最大并发/seq_len），输出所需 GPU 数和配置（max_num_seqs/max_model_len/gpu_memory_utilization）。沉淀"各模型的 KV Cache 估算公式"（token 数 × 每 token KV 大小）、"并发与 KV Cache 的换算"、"常见 OOM 场景的排查清单"（权重超 → 量化；KV Cache 超 → 限并发/seq_len；碎片 → PagedAttention）。配套监控（实时显存占用、KV Cache 占比、并发数、OOM 告警），显存利用率 >90% 预警（接近 OOM）。把"容量规划 + 实时监控 + OOM 应急预案"作为推理服务的标配运维能力，新服务上线前做容量评估，避免线上 OOM。

## 结构化回答

**30 秒电梯演讲：** OOM排查从"谁在吃显存"出发——模型权重、KV Cache、激活值、框架开销四步定位——像水管爆裂排查。

**展开框架：**
1. **第一优先** — 确认模型大小是否匹配GPU
2. **第二优先** — KV Cache随序列长度线性增长
3. **第三优先** — 并发请求 × 每请求KV Cache

**收尾：** 您想深入聊：如何监控推理过程中的显存使用？


## 视频脚本

> 预计时长：4 分钟 | 由浅入深


| 时间 | 画面/字幕 | 口播台词 | 讲解要点 |
|------|----------|----------|----------|
| 0:00 | 标题卡：大模型推理时遇到OOM问题，你会从哪些方面入手排… | "像水管爆裂排查——先关总阀(确认模型大小)，再查各支管(KV Cache/激活值/并发数)…" | 开场钩子 |
| 0:20 | 核心概念图 | "OOM排查从"谁在吃显存"出发——模型权重、KV Cache、激活值、框架开销四步定位" | 核心定义 |
| 0:50 | 第一优先示意图 | "第一优先——确认模型大小是否匹配GPU" | 要点拆解1 |
| 1:30 | 对比/实战案例图 | "对比一下常见误区和工程实践，看真实场景里怎么取舍。" | 实战与对比 |
| 2:20 | 总结卡 | "记住核心要点。下期我们追问：如何监控推理过程中的显存使用？" | 收尾与钩子 |
