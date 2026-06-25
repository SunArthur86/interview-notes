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
  analogy: '像水管爆裂排查——先关总阀(确认模型大小)，再查各支管(KV Cache/激活值/并发数)，最后找泄漏点(框架泄漏/碎片化)'
  first_principle: 'GPU显存是有限资源，OOM意味着总需求超过供给。逐项排查每个显存消费者，找到最大的一项优化'
  key_points:
    - '第一优先: 确认模型大小是否匹配GPU'
    - '第二优先: KV Cache随序列长度线性增长'
    - '第三优先: 并发请求 × 每请求KV Cache'
    - '第四优先: 框架开销(PagedAttention/激活值)'
first_principle:
  essence: 推理显存 = 模型权重 + KV Cache + 激活值 + 框架开销
  derivation: '模型权重是固定开销，KV Cache = f(seq_len × batch)，激活值 = g(seq_len × batch)。当batch或seq_len增大时，KV Cache是主要增长项'
  conclusion: OOM排查应按"权重→KV Cache→并发→激活值"的优先级逐项优化
follow_up:
  - 如何监控推理过程中的显存使用？
  - PagedAttention如何减少KV Cache碎片？
  - 长文本推理如何控制KV Cache显存？
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
