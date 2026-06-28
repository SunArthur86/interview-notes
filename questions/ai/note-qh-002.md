---
id: note-qh-002
difficulty: L4
category: ai
subcategory: 推理优化
tags:
  - 群核
  - 面经
  - vLLM
  - Continuous Batching
  - PagedAttention
feynman:
  essence: "Continuous Batching在token级别动态拼batch，让不同长度请求共享GPU；Cascade Attention在共享前缀场景下复用KV Cache，避免重复计算"
  analogy: "Continuous Batching像拼车——不停有人上下车但车一直在跑；Cascade Attention像共享笔记——前面讲的共同内容大家共用一份，只有各自不同的部分单独记"
  first_principle: "LLM推理瓶颈是显存(KV Cache)而非计算，Continuous Batching最大化GPU利用率，Cascade Attention最小化KV Cache冗余"
  key_points:
    - 'Continuous Batching: iteration级别动态拼batch，消除队头阻塞'
    - 'PagedAttention: KV Cache分页管理，减少显存碎片'
    - 'Cascade Attention: 共享前缀复用KV Cache(few-shot/系统prompt场景)'
    - 'Continuous batching在前，cascade attention在其之上优化'
first_principle:
  essence: "GPU利用率最大化的核心是减少空闲等待"
  derivation: "传统batching: 同一batch必须等最长的完成 → 短请求GPU空闲 → 改为token级别动态调度 → 每个iteration可以加入/移除请求 → GPU持续满载"
  conclusion: "Continuous batching是在cascade attention之前实现的(它需要batch维度动态变化)"
follow_up:
  - "PagedAttention和操作系统虚拟内存有什么关系？"
  - "Prefix caching和cascade attention一样吗？"
  - "VLM场景有什么特殊挑战？"
---

# VLM 的 Continuous Batching 是什么？Cascade Attention 在 Continuous Batch 之前还是之后做？

## Continuous Batching 详解

### 传统 Batching 的问题

```
Static Batching (传统):
  时间 →
  Req A: ████████████████████done  (20 tokens)
  Req B: ████████done             (8 tokens, 等了12步!)
  Req C: ████████████████done     (16 tokens)

  问题: B虽然早完成了，但必须等A也完成才能处理下一batch
  → GPU在B完成后就空闲了 (队头阻塞)
```

### Continuous Batching

```
Continuous Batching (vLLM):
  时间 →  t1    t2    t3    t4    t5    t6
  Req A: ████  ████  ████  ████  ████  done
  Req B: ████  ████  done  ───   ───   ───    ← t3完成，立即移出
  Req C:                    ████  ████  ████  ← t4新请求加入
  Req D:                          ████  ████  ← t5新请求加入

  每个iteration(每个token step):
  1. 检查哪些请求完成了 → 移出batch
  2. 从等待队列加入新请求
  3. 所有活跃请求一起做一次forward
  → GPU持续满载，无队头阻塞
```

### PagedAttention (KV Cache 管理)

```
传统KV Cache:
  每个请求预分配 max_length 的连续显存
  → 浪费严重(实际生成长度 < max_length)
  → 显存碎片化

PagedAttention (借鉴OS虚拟内存):
  ┌──────┬──────┬──────┬──────┐
  │ Block│ Block│ Block│ Block│  ← 固定大小block(如16个token)
  │  #0  │  #1  │  #2  │  #3  │
  ├──────┼──────┼──────┼──────┤
  │Req A │Req A │Req B │Req C │  ← 按需分配
  │tok0-15│16-31│tok0-15│tok0-15│
  └──────┴──────┴──────┴──────┘

  Req A: Block #0 → #1 (32 tokens, 需要时再分配#4)
  Req B: Block #2 (16 tokens, 够了不用再分)
  → 按需分配，零浪费
```

## Cascade Attention (前缀复用)

### 应用场景

```
场景: 1000个请求共享同一个System Prompt (2000 tokens)

传统方式: 每个请求独立计算和存储2000 token的KV Cache
  → 1000 × 2000 tokens = 200万token的KV Cache (浪费!)

Cascade Attention:
  ┌─────────────────────────────┐
  │  Shared KV Cache (1份)       │  ← 系统Prompt的KV Cache
  │  "你是一个有用的助手..."     │     只计算一次，所有请求共享
  │  2000 tokens                 │
  ├─────────────────────────────┤
  │  Req A独有: "今天天气怎样"   │  ← 每个请求只有自己的部分
  │  Req B独有: "写一首诗"       │
  │  Req C独有: "解释量子力学"   │
  └─────────────────────────────┘
```

### Cascade Attention vs Continuous Batching

```
执行顺序: Continuous Batching 先执行

┌─────────────────────────────────────────┐
│  Layer 1: Continuous Batching (底层)    │
│  管理请求的生命周期和batch调度            │
│  每个iteration动态组合活跃请求           │
├─────────────────────────────────────────┤
│  Layer 2: Cascade Attention (上层)      │
│  在batch内部检测共享前缀                  │
│  复用共享前缀的KV Cache                  │
│  减少重复计算和显存占用                   │
└─────────────────────────────────────────┘

为什么cascade在continuous之后:
  - Continuous batching先确定当前batch有哪些请求
  - 然后cascade分析这些请求是否有共享前缀
  - 对共享部分复用KV Cache，对差异部分独立计算
```

## VLM (视觉语言模型) 的特殊挑战

```python
# VLM推理的额外复杂性:
# 1. 图像Token数量巨大 (一张图=256~4096个visual tokens)
#    → KV Cache占用是纯文本的10-100倍
#    → PagedAttention更重要

# 2. 图像编码和文本解码分离
#    → Vision Encoder (CLIP/SigLIP) + LLM Decoder
#    → Continuous batching需要同时管理两种模态

# 3. 混合长度 (图片token固定 + 文本token变长)
#    → batch内部长度差异更大
#    → 需要更智能的调度策略
```

## 面试回答要点

```
Q: Cascade attention在continuous batch之前还是之后做?
A: 之后。Continuous batching先组装batch（决定哪些请求在当前iteration中），
   然后cascade attention在batch内部优化共享前缀的KV Cache复用。
   两者是互补关系：continuous batching解决batch调度效率，
   cascade attention解决batch内的KV Cache冗余。
```
