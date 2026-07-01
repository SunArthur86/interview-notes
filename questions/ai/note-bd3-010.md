---
id: note-bd3-010
difficulty: L3
category: ai
subcategory: 推理优化
tags:
- 字节跳动
- 面经
- 二面
feynman:
  essence: 合并LoRA权重消除推理时额外计算开销，但失去多LoRA动态切换能力
  analogy: LoRA合并像把便签纸上的内容永久誊抄到书页上——查询速度快了（不用先看便签再看书），但如果想换便签内容就得重新买一本书
  first_principle: LoRA的本质是W_new = W_base + B×A。推理时要么先算B×A再加到W_base（额外矩阵乘法），要么预先计算好合并权重（零额外开销但不可逆）
  key_points:
  - '合并: W_merged = W_base + BA → 零额外推理开销'
  - '不合并: 推理时实时计算BA → 有额外延迟但可动态切换'
  - '多LoRA场景: 不合并更灵活，可按需路由不同适配器'
first_principle:
  essence: 权重合并是在"推理效率"与"灵活性"之间的trade-off
  derivation: 合并后单次前向传播只需W_merged × x，额外开销为0。不合并时需要两次矩阵乘法(B×A×x)或一次合并+一次乘法。但当需要同时服务多个LoRA适配器时，合并不可行
  conclusion: 单一LoRA → 合并最优；多LoRA → 保持分离+动态加载
follow_up:
- 多LoRA服务时如何降低切换延迟？
- LoRA合并后能否再分离？
- vLLM/SGLang如何高效服务多个LoRA适配器？
memory_points:
- 核心利弊：因为合并后失去动态灵活性，所以单LoRA适合合并而多LoRA不合并
- 合并收益：W_base直接相加B×A，实现零额外计算开销，延迟降到最低
- 不合并代价：虽占用极高显存(需存N个完整模型)，但额外延迟极低(r极小约增加1%)
- 决策口诀：多路复用/A-B测试不合并，边缘/单任务部署必合并
---

# 为了减少LoRA带来的延迟，你会不会做权重合并？有什么利弊？

> 来源：字节跳动大模型技术面试二面

## 核心权衡

```
┌─────────────────────────────────────────────────────────┐
│                 LoRA 推理两条路                          │
│                                                         │
│  方案A: 合并 (Merge)                方案B: 不合并       │
│                                                         │
│  W_merged = W_base + B×A           推理时实时计算:       │
│       ↓                            h = W_base × x       │
│  推理: h = W_merged × x            h = h + B×(A×x)      │
│       ↓                                 ↓               │
│  ✅ 零额外计算                     ❌ 额外2次矩阵乘法   │
│  ✅ 与基础模型推理完全一致          ✅ 可随时切换LoRA    │
│  ❌ 无法再切换LoRA                 ✅ 多LoRA动态路由    │
│  ❌ 每个LoRA占完整模型大小的显存    ✅ 只占0.1%额外显存  │
└─────────────────────────────────────────────────────────┘
```

## 详细分析

### 合并方案

```python
# 合并代码 (PEFT库)
from peft import PeftModel

model = AutoModelForCausalLM.from_pretrained("base_model")
model = PeftModel.from_pretrained(model, "lora_adapter")

# ★ 合并权重 — 不可逆
model = model.merge_and_unload()
model.save_pretrained("merged_model")

# 合并后推理 = 普通模型推理，零额外开销
# 但如果要换另一个LoRA，需要重新加载基础模型
```

```
合并后的显存占用:

  Base Model (7B):  14 GB (FP16)
  LoRA Adapter:     26 MB (0.2%)
  
  合并后: 1个合并模型 = 14 GB
  
  如果有5个不同任务的LoRA:
  5 × 合并模型 = 70 GB  ← 灾难!
```

### 不合并方案

```python
# 实时计算LoRA增量
def forward_with_lora(x, W_base, lora_A, lora_B, scaling):
    """
    不合并的推理路径
    """
    # 基础权重的前向传播
    h = F.linear(x, W_base)  # (batch, seq, d_out)
    
    # LoRA增量: 先降维再升维
    delta = F.linear(x, lora_A)       # (batch, seq, r)  ← 降维
    delta = F.linear(delta, lora_B)   # (batch, seq, d_out) ← 升维
    
    # 合并结果
    return h + scaling * delta

# 额外计算量:
# 矩阵乘法: x × A_T (seq×d_in → seq×r) + delta × B_T (seq×r → seq×d_out)
# 因为 r << d (如r=16, d=4096), 额外计算量 ≈ 2×r/d ≈ 0.8% 的原始计算
```

### 额外延迟量化

```
以7B模型, d=4096, r=16, seq_len=128为例:

基础前向: W×x = 128×4096 × 4096 ≈ 2.1 GFLOPs/层
LoRA增量: A×x + B×(Ax) = 128×4096×16 + 128×16×4096 ≈ 16.8 MFLOPs/层

延迟增加 ≈ 16.8M / 2.1G ≈ 0.8%  ← 几乎可忽略!

结论: 对于小rank(r≤32)的LoRA，额外延迟不到1%
```

## 决策矩阵

| 场景 | 合并? | 原因 |
|------|-------|------|
| 单一LoRA部署 | **✅ 合并** | 零开销，简单 |
| 多LoRA需动态切换 | ❌ 不合并 | 合并需N倍显存 |
| A/B测试不同LoRA | ❌ 不合并 | 需快速切换 |
| 多租户服务 | ❌ 不合并 | 不同用户不同LoRA |
| LoRA效果不确定需随时回退 | ❌ 不合并 | 合并不可逆 |
| 边缘设备部署 | **✅ 合并** | 减少计算，省电 |

## 多LoRA服务优化

当不合并时，如何优化多LoRA推理：

```
┌──────────────────────────────────────────────────────┐
│              Multi-LoRA Serving Architecture          │
│                                                      │
│              ┌─────────────────────┐                 │
│              │   Base Model (共享)  │                 │
│              │   (常驻GPU显存)      │                 │
│              └──────────┬──────────┘                 │
│                         │                            │
│          ┌──────────────┼──────────────┐             │
│          │              │              │             │
│    ┌─────┴─────┐  ┌────┴────┐  ┌─────┴─────┐        │
│    │ LoRA-A    │  │ LoRA-B  │  │ LoRA-C    │        │
│    │ (hot)     │  │ (hot)   │  │ (cold→CPU)│        │
│    └───────────┘  └─────────┘  └───────────┘        │
│                                                      │
│  策略:                                               │
│  1. 热门LoRA常驻GPU显存                               │
│  2. 冷门LoRA放CPU内存，按需加载                       │
│  3. LRU策略管理LoRA缓存                              │
│  4. 批量请求按LoRA-ID分组                            │
└──────────────────────────────────────────────────────┘
```

```python
# vLLM多LoRA服务
from vllm import LLM, SamplingParams

llm = LLM(
    model="base_model",
    enable_lora=True,            # ★ 启用LoRA推理
    max_loras=4,                 # GPU上最多同时保持4个LoRA
    max_lora_rank=16,            # 支持的最大rank
    max_cpu_loras=16,            # CPU内存中缓存16个LoRA
)

# 不同请求使用不同LoRA
prompts = [
    {"lora_request": LoRARequest("task_a", 1, "lora_a_path"), "prompt": "..."},
    {"lora_request": LoRARequest("task_b", 2, "lora_b_path"), "prompt": "..."},
]
```

## 其他优化方法

```
1. CUDA Graph + LoRA
   - 预编译LoRA增量计算图
   - 消除kernel launch开销
   - 适合固定shape的推理

2. LoRA SVD分离
   - 将A和B预计算为连续内存
   - 使用 fused GEMM kernel
   - 一次kernel完成两次矩阵乘法

3. 稀疏LoRA路由
   - 只对部分层应用LoRA（如仅注意力层）
   - 减少需要实时计算的LoRA层数

4. LoRA量化
   - 将LoRA权重本身量化为INT8
   - 进一步减少显存和计算
```

**面试加分点**：提到vLLM从v0.5开始支持Multi-LoRA高效服务；提到SGLang的LoRA路由在多LoRA场景下比vLLM更快；提到合并后的模型可以通过重新加载LoRA权重来"反合并"（但需要保存原始LoRA文件）；提到rank较大的LoRA(r≥64)额外延迟可能达到5%以上，此时合并更有意义。

## 记忆要点

- 核心利弊：因为合并后失去动态灵活性，所以单LoRA适合合并而多LoRA不合并
- 合并收益：W_base直接相加B×A，实现零额外计算开销，延迟降到最低
- 不合并代价：虽占用极高显存(需存N个完整模型)，但额外延迟极低(r极小约增加1%)
- 决策口诀：多路复用/A-B测试不合并，边缘/单任务部署必合并

