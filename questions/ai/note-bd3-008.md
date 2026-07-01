---
id: note-bd3-008
difficulty: L3
category: ai
subcategory: 推理优化
tags:
- 字节跳动
- 面经
- 二面
feynman:
  essence: KV Cache缓存已计算的Key/Value避免重复计算；PagedAttention像操作系统的虚拟内存分页管理KV Cache；Continuous Batching像流水线动态组批
  analogy: KV Cache像读书时做笔记——翻过的页不用重新读，只看笔记。PagedAttention像图书馆——不必每人搬一整套书，按页借阅用完归还。Continuous Batching像超市收银——不等所有人到齐才开收银台，来一个结一个
  first_principle: 自回归生成的每一步都要重新计算所有token的attention，但历史token的K/V不变，缓存它们可以避免O(n²)的重复计算
  key_points:
  - 'KV Cache: 存储历史token的K/V矩阵，推理时只计算新token'
  - 'PagedAttention: 分块存储KV Cache，消除碎片化，显存利用率从60%→97%'
  - 'Continuous Batching: 请求级别动态调度，不同请求可随时加入/退出batch'
first_principle:
  essence: Transformer自回归推理的瓶颈是内存带宽而非计算
  derivation: 每生成一个token需要读取所有历史token的KV Cache。显存读写量 = 2 × L × hidden × seq_len。当seq_len很大时，这是HBM带宽的主要消耗。PagedAttention通过减少碎片和共享前缀来优化这一开销
  conclusion: vLLM的两大优化分别解决了KV Cache的显存碎片问题和batch调度的效率问题
follow_up:
- Prefix Caching如何加速多轮对话？
- Speculative Decoding如何减少推理延迟？
- Tensor Parallel和Pipeline Parallel在推理中如何应用？
memory_points:
- KV Cache省算力：避免重复计算历史token，将推理复杂度从O(n³)降至O(n²)。
- PagedAttention治碎片：仿OS虚拟内存按块离散分配，打破连续预分配，显存利用达97%。
- Continuous Batching提吞吐：请求级别动态拼Batch，消除队列等待，GPU不空转。
---

# KV Cache的工作原理是什么？vLLM的PagedAttention和Continuous Batching解决了什么问题？

> 来源：字节跳动大模型技术面试二面

## KV Cache 原理

### 问题：自回归推理的重复计算

```
Step 1: 输入 [A]            → 计算 K₁,V₁ → 输出 B
Step 2: 输入 [A,B]          → 重新计算 K₁,V₁ + K₂,V₂ → 输出 C  ← K₁,V₁重复!
Step 3: 输入 [A,B,C]        → 重新计算 K₁~₃ → 输出 D           ← K₁,V₁ K₂,V₂重复!
...

没有KV Cache: 计算量 = O(n³)  灾难!
```

### 解决方案：缓存历史K/V

```
Step 1: 输入 [A]     → 计算 K₁,V₁ → 存入Cache → 输出 B
Step 2: 输入 [B]     → 计算 K₂,V₂ → 存入Cache → 用[K₁V₁,K₂V₂]算attention → 输出 C
Step 3: 输入 [C]     → 计算 K₃,V₃ → 存入Cache → 用[K₁~₃V₁~₃] → 输出 D

有KV Cache: 每步只需计算1个新token的K/V，计算量 = O(n²)
```

### KV Cache 显存计算

```
KV Cache大小 = 2 × n_layers × n_heads × d_head × seq_len × batch × bytes

以LLaMA-2-70B为例:
  2 × 80层 × 64头 × 128维 × seq_len × batch × 2(fp16)
  = 2,621,440 × seq_len × batch bytes
  ≈ 2.5 MB × seq_len × batch

  seq_len=4096, batch=1: ~10 GB
  seq_len=32768, batch=1: ~80 GB  ← 比模型权重(140GB)还大!
```

## PagedAttention

### 问题：KV Cache显存碎片化

```
┌─────────────────────────────────────────────────┐
│  传统KV Cache分配 (连续分配)                      │
│                                                 │
│  请求A (需要3块): [A][A][A][____________________]│
│  请求B (需要2块): [B][B][________________________]│
│  请求C (需要5块): [C][C][C][C][C][______________]│
│                                                 │
│  问题: 每个请求预分配最大长度的连续内存            │
│  → 大量显存浪费在"预分配但未使用"的空间           │
│  → 内部碎片 + 外部碎片                           │
│  → 实际显存利用率 ~20-40%                        │
└─────────────────────────────────────────────────┘
```

### 解决方案：分页管理（类比OS虚拟内存）

```
┌─────────────────────────────────────────────────┐
│  PagedAttention (分页分配)                       │
│                                                 │
│  物理块 (Block Size = 16 tokens):               │
│  ┌──┬──┬──┬──┬──┬──┬──┬──┬──┬──┬──┬──┐        │
│  │A0│A1│B0│C0│A2│C1│C2│D0│C3│C4│B1│E0│        │
│  └──┴──┴──┴──┴──┴──┴──┴──┴──┴──┴──┴──┘        │
│                                                 │
│  逻辑视图 (通过页表映射):                        │
│  请求A: Block0(A0) → Block1(A1) → Block4(A2)    │
│  请求B: Block2(B0) → Block10(B1)                │
│  请求C: Block3(C0) → Block5(C1) → Block6(C2)   │
│         → Block8(C3) → Block9(C4)              │
│                                                 │
│  ✅ 按需分配, 无预分配浪费                        │
│  ✅ 无外部碎片, 显存利用率 97%+                   │
│  ✅ 不同请求的块可以散布在任何位置                 │
└─────────────────────────────────────────────────┘
```

```python
# PagedAttention核心: block table
# 每个请求维护一个页表，映射逻辑块→物理块

request_A = {
    "block_table": [0, 1, 4],        # 逻辑块0→物理块0, 1→1, 2→4
    "num_tokens": 42,                 # 实际token数
    "max_blocks": 256                 # 逻辑上限
}

# 当生成新token时:
# 1. 计算当前block是否已满(16 tokens/block)
# 2. 如果满了, 分配新物理块, 更新页表
# 3. 将新KV写入对应的物理块位置
# 4. attention计算时通过页表索引读取KV
```

### Copy-on-Write 共享前缀

```
请求A: [系统提示][用户问题1] → 生成回答
请求B: [系统提示][用户问题2] → 生成回答

PagedAttention:
  系统提示的KV Cache只存一份，两个请求共享物理块
  当请求B需要修改时(实际不会修改历史KV), COW复制
  
  节省: 系统提示长度 × KV大小 × (请求数-1)
```

## Continuous Batching

### 问题：Static Batching的Padding浪费

```
传统Static Batching:
  请求1 (输出100 tokens): [████████████████████] ← 先完成
  请求2 (输出200 tokens): [████████████████████████████████]
  请求3 (输出50 tokens):  [██████████]          ← 很早完成但要等
  
  → 请求1完成后，GPU空等请求2的剩余100步
  → 请求3提前结束后，它的计算资源被浪费
  → 整体GPU利用率 < 40%
```

### 解决方案：动态调度

```
┌──────────────────────────────────────────────────────┐
│          Continuous Batching (iteration级调度)         │
│                                                      │
│  Step:  1    2    3    4    5    6    7    8         │
│  ─────────────────────────────────────────────────── │
│  Req A:  ✓    ✓    ✓    ✓    ✓    DONE              │
│  Req B:  ✓    ✓    ✓    ✓    ✓    ✓    ✓    ✓       │
│  Req C:  ✓    ✓    DONE                            │
│  Req D:  ─    ─    ─    ✓    ✓    ✓    ✓    ✓  ← 新加入│
│  Req E:  ─    ─    ─    ─    ─    ✓    ✓    DONE  ← 新加入│
│                                                      │
│  ✅ C完成后立即移出batch，D立即加入                    │
│  ✅ 每个iteration都是动态batch                        │
│  ✅ GPU利用率 > 90%                                   │
└──────────────────────────────────────────────────────┘
```

## 性能对比

```
┌───────────────────┬────────────┬────────────┐
│       指标        │  HF Transformers  │   vLLM   │
├───────────────────┼────────────┼────────────┤
│ 吞吐量 (tokens/s) │     1×     │    14-24×  │
│ 显存利用率        │   ~30%     │    ~97%    │
│ 并发请求数        │   ~32      │   ~256+    │
│ PagedAttention   │    ❌      │    ✅      │
│ Continuous Batch │    ❌      │    ✅      │
│ Prefix Caching   │    ❌      │    ✅      │
└───────────────────┴────────────┴────────────┘
```

**面试加分点**：提到vLLM论文(Kwon et al., 2023, SOSP)；提到PagedAttention灵感来自OS的虚拟内存分页机制；提到Continuous Batching也称为Iteration-Level Batching；提到Prefix Caching可以加速多用户共享相同system prompt的场景；提到TensorRT-LLM也实现了类似优化（In-flight Batching）。

## 记忆要点

- KV Cache省算力：避免重复计算历史token，将推理复杂度从O(n³)降至O(n²)。
- PagedAttention治碎片：仿OS虚拟内存按块离散分配，打破连续预分配，显存利用达97%。
- Continuous Batching提吞吐：请求级别动态拼Batch，消除队列等待，GPU不空转。

