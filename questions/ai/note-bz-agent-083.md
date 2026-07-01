---
id: note-bz-agent-083
difficulty: L3
category: ai
subcategory: Agent
tags:
- B站面经
- 推理优化
- vLLM
- 部署
feynman:
  essence: 大模型推理性能优化=引擎层(vLLM/TensorRT-LLM的PagedAttention+连续批处理)+算法层(KV Cache/投机解码/量化)+架构层(MoE/并行)。全栈优化。
  analogy: 像F1赛车提速——引擎升级(vLLM)、空气动力学(量化减重)、驾驶技术(批处理)、赛道策略(路由)。
  first_principle: 推理瓶颈在显存带宽和计算量。优化=减少显存占用(量化/Cache)+提高计算效率(批处理/并行)+减少计算量(MoE/投机)。
  key_points:
  - 引擎：vLLM/TensorRT-LLM/TGI
  - 算法：KV Cache/投机解码/量化
  - 架构：MoE/张量并行/流水线并行
  - 核心：PagedAttention+连续批处理
first_principle:
  essence: 推理性能受限于显存带宽和GPU利用率。
  derivation: LLM推理是memory-bound(显存带宽限制)。优化方向：1.减少显存占用(量化/KV Cache复用) 2.提高GPU利用率(连续批处理) 3.减少冗余计算(投机解码/MoE)。vLLM的PagedAttention同时优化了1和2。
  conclusion: 推理优化 = 减显存(量化) + 提利用率(批处理) + 减计算(投机/MoE)
follow_up:
- vLLM为什么快？——PagedAttention解决显存碎片+连续批处理
- 量化选INT8还是INT4？——8bit无损，4bit轻微损失
- 多卡怎么并行？——张量并行(单层多卡)+流水线(不同层不同卡)
memory_points:
- 推理三大瓶颈：显存带宽受限、KV Cache占显存、自回归生成导致串行
- vLLM双核心：PagedAttention像虚拟内存消除显存碎片，连续批处理动态进出防GPU等待
- 投机解码：小模型先猜大模型验证，实现质量无损的2-3倍加速
- 量化降显存提速：INT8无感，INT4极致压缩；MoE架构按需激活提速
---

# 大模型推理性能优化方案？

## 一、推理性能瓶颈

```
LLM推理的瓶颈：

1. 显存带宽限制(Memory-Bound)
   生成每个token需读取全部权重
   7B模型FP16需14GB显存
   → 带宽是瓶颈，不是算力

2. KV Cache显存占用
   每个token的Key/Value都要存
   长上下文(100K)的KV Cache可能占几十GB

3. 批处理效率
   不同请求长度不同，简单批处理浪费GPU

4. 自回归串行
   必须逐token生成，无法并行
```

## 二、三大优化方向

```
┌──────────────────────────────────────────────────┐
│              推理优化三大方向                        │
├──────────────────────────────────────────────────┤
│                                                    │
│  1. 引擎优化（提升GPU利用率）                       │
│     vLLM / TensorRT-LLM / TGI                    │
│     PagedAttention + 连续批处理                   │
│                                                    │
│  2. 算法优化（减少计算量）                          │
│     KV Cache + 投机解码 + 量化                    │
│                                                    │
│  3. 架构优化（模型层面）                            │
│     MoE + 张量并行 + Flash Attention              │
│                                                    │
└──────────────────────────────────────────────────┘
```

## 三、引擎优化：vLLM（最重要）

```python
# vLLM的两大核心技术：

# 1. PagedAttention（解决KV Cache显存碎片）
"""
传统：每个请求预分配最大KV Cache空间
      → 大量浪费（实际用不完）
      → 显存碎片，无法服务更多请求

PagedAttention：像OS虚拟内存一样分页管理
  - KV Cache分成固定大小的block(如16个token一块)
  - 按需分配，不预分配
  - 显存利用率从~60%提到~95%
  - 可服务更多并发请求
"""

# 2. 连续批处理（Continuous Batching）
"""
传统批处理：等一批请求都完成才开始下一批
  → 长请求拖慢短请求，GPU空闲

连续批处理：动态插入/移除请求
  - 某请求完成 → 立即移除，插入新请求
  - GPU永远不空闲
  - 吞吐量提升3-5倍
"""

# 使用vLLM
from vllm import LLM, SamplingParams
llm = LLM(model="qwen-7b", tensor_parallel_size=1)
outputs = llm.generate(["问题1", "问题2", "问题3"])  # 高效批量
```

## 四、算法优化

### KV Cache 优化

```python
# 基础KV Cache：避免重复计算已生成部分
# 进阶优化：

# 1. Prefix Caching（前缀复用）
# 相同system prompt的KV Cache复用
# 多请求共享system prompt → 只算一次

# 2. KV Cache量化
# 把KV Cache从FP16压到INT8
# 显存减半，几乎无损

# 3. KV Cache Offloading
# 不常用的KV Cache换出到CPU内存
# 需要时再换回GPU
```

### 投机解码（Speculative Decoding）

```python
# 小模型先猜，大模型验证
# 猜对 → 用了小模型速度
# 猜错 → 大模型纠正，保质量

# 效果：2-3倍加速，质量无损
# 适合：对延迟敏感的场景
```

### 量化

```python
quantization = {
    "FP16(基线)": {"显存": "100%", "速度": "1x", "精度": "无损"},
    "INT8": {"显存": "50%", "速度": "1.5x", "精度": "几乎无损"},
    "INT4(GPTQ)": {"显存": "25%", "速度": "2x", "精度": "轻微损失"},
    "INT4(AWQ)": {"显存": "25%", "速度": "2x", "精度": "比GPTQ好"},
    "GGUF(Q4_K_M)": {"显存": "30%", "速度": "1.5x", "适合": "CPU"},
}
```

## 五、架构优化

### MoE（混合专家）

```python
# 不是所有参数都激活，按需路由
# Mixtral 8x7B: 总参数47B，每次只激活13B
# → 推理速度快接近13B模型，能力强接近47B

# 优势：参数容量大但推理快
# 劣势：显存仍需全部加载
```

### Flash Attention

```python
# 不改变注意力结果，优化GPU内存访问
# 把attention计算分块(tiling)，减少HBM读写
# 效果：显存省3-5倍，速度快2-4倍
# 现在是长上下文的标配
```

### 多卡并行

```python
# 模型太大单卡放不下时

# 1. 张量并行(Tensor Parallel)
#    单层计算拆到多卡
#    如7B分到4卡，每卡1.75B
#    通信开销大，需NVLink

# 2. 流水线并行(Pipeline Parallel)
#    不同层放不同卡
#    如24层模型，卡1放1-6层，卡2放7-12层...

# 3. 数据并行(Data Parallel)
#    多份模型副本，各自处理不同请求
#    最简单，提升吞吐

# vLLM配置
llm = LLM(model="llama-70b", tensor_parallel_size=4)  # 4卡张量并行
```

## 六、推理引擎对比

```
┌─────────────┬──────────────────┬──────────────────────┐
│ 引擎          │ 特点                │ 适用                   │
├─────────────┼──────────────────┼──────────────────────┤
│ vLLM        │ PagedAttention    │ 通用首选，吞吐最高      │
│             │ 开源活跃           │                       │
├─────────────┼──────────────────┼──────────────────────┤
│ TensorRT-LLM│ NVIDIA官方        │ NVIDIA GPU极致性能     │
│             │ 编译优化           │ 部署复杂               │
├─────────────┼──────────────────┼──────────────────────┤
│ TGI         │ HuggingFace       │ 与HF生态集成好         │
│ (Text Gen   │ 易用               │                       │
│  Inference) │                   │                       │
├─────────────┼──────────────────┼──────────────────────┤
│ llama.cpp   │ CPU/Mac友好       │ 本地/边缘/无GPU        │
│             │ GGUF量化          │                       │
├─────────────┼──────────────────┼──────────────────────┤
│ SGLang      │ vLLM团队新作      │ 结构化输出/Agent场景   │
│             │ 更快               │                       │
└─────────────┴──────────────────┴──────────────────────┘
```

## 七、优化效果汇总

```
组合优化的效果（以7B模型为例）：

基线(HuggingFace):    吞吐 1x
+vLLM:                吞吐 4x  (PagedAttention+连续批处理)
+INT8量化:             显存减半
+Flash Attention:      延迟降40%
+投机解码:             延迟降50%
全部组合:              吞吐 5-8x，延迟降60%+

生产推荐：vLLM + INT8/FP8 + Flash Attention
```

## 八、面试加分点

1. **vLLM 的 PagedAttention**：这是推理优化的核心突破，类比 OS 虚拟内存
2. **连续批处理**：动态插入移除请求，GPU 不空闲——吞吐提升关键
3. **全栈优化**：引擎+算法+架构，系统性而非单点

## 记忆要点

- 推理三大瓶颈：显存带宽受限、KV Cache占显存、自回归生成导致串行
- vLLM双核心：PagedAttention像虚拟内存消除显存碎片，连续批处理动态进出防GPU等待
- 投机解码：小模型先猜大模型验证，实现质量无损的2-3倍加速
- 量化降显存提速：INT8无感，INT4极致压缩；MoE架构按需激活提速

