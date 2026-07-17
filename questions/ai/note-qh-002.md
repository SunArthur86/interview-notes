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
  essence: Continuous Batching在token级别动态拼batch，让不同长度请求共享GPU；Cascade Attention在共享前缀场景下复用KV Cache，避免重复计算
  analogy: Continuous Batching像拼车——不停有人上下车但车一直在跑；Cascade Attention像共享笔记——前面讲的共同内容大家共用一份，只有各自不同的部分单独记
  first_principle: LLM推理瓶颈是显存(KV Cache)而非计算，Continuous Batching最大化GPU利用率，Cascade Attention最小化KV Cache冗余
  key_points:
  - 'Continuous Batching: iteration级别动态拼batch，消除队头阻塞'
  - 'PagedAttention: KV Cache分页管理，减少显存碎片'
  - 'Cascade Attention: 共享前缀复用KV Cache(few-shot/系统prompt场景)'
  - Continuous batching在前，cascade attention在其之上优化
first_principle:
  essence: GPU利用率最大化的核心是减少空闲等待
  derivation: '传统batching: 同一batch必须等最长的完成 → 短请求GPU空闲 → 改为token级别动态调度 → 每个iteration可以加入/移除请求 → GPU持续满载'
  conclusion: Continuous batching是在cascade attention之前实现的(它需要batch维度动态变化)
follow_up:
- PagedAttention和操作系统虚拟内存有什么关系？
- Prefix caching和cascade attention一样吗？
- VLM场景有什么特殊挑战？
memory_points:
- Continuous Batching解决队头阻塞：因为每步动态移出已完成请求并加入新请求，所以GPU持续满载。
- Cascade Attention做共享前缀复用：因为多请求常共享系统提示词，所以只算一次KV Cache供全局复用。
- 两者顺序：先Continuous Batching组batch，后Cascade Attention在组内检测并复用前缀。
- VLM显存挑战：因为单张图产生上千视觉Token，所以极度依赖PagedAttention按需分配防OOM。
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

## 记忆要点

- Continuous Batching解决队头阻塞：因为每步动态移出已完成请求并加入新请求，所以GPU持续满载。
- Cascade Attention做共享前缀复用：因为多请求常共享系统提示词，所以只算一次KV Cache供全局复用。
- 两者顺序：先Continuous Batching组batch，后Cascade Attention在组内检测并复用前缀。
- VLM显存挑战：因为单张图产生上千视觉Token，所以极度依赖PagedAttention按需分配防OOM。


## 苏格拉底式面试追问

> 这组追问模拟面试官层层逼问，每一问先回答"为什么"，再回答"怎么做"，最后回答"如何证明"。

### 第一层：目标与动机

**Q：Continuous Batching 为什么能在 token 级别动态拼 batch，而不是等请求凑齐？**

因为 LLM 推理的 decode 阶段是"逐 token 生成"，每个 token 都是一次 forward。Continuous Batching 在每次 forward 前检查：哪些请求生成了新 token、哪些请求已经完成可以踢出、有没有新请求可以插入。这样 batch 的组成是逐 token 变化的，不需要等。本质是把"请求粒度的 batch"细化成"token 粒度的 batch"，用 GPU 的并行能力处理多个请求的不同步进度。

### 第二层：证据与定位

**Q：开了 Continuous Batching 后 P99 延迟反而升高了，怎么定位？**

看两个指标：1) batch size 的分布——如果 P99 时刻 batch size 特别大（如 > 64），说明太多请求挤在一起，每个请求的 per-token 计算变慢；2) prefill 和 decode 的混批情况——如果长 prompt 的 prefill 和短请求的 decode 混在一个 batch，prefill 会阻塞 decode 导致短请求延迟升高。解法：prefill 和 decode 分离调度（chunked prefill），限制单 batch 最大 token 数。

### 第三层：根因深挖

**Q：Cascade Attention 复用共享前缀的 KV Cache，但前缀什么时候才算"共享"？根因判断标准是什么？**

判断标准是"多个请求的 system prompt + few-shot + 工具 schema 完全相同"。这些前缀在多个请求间是字节级一致的，只算一次 KV Cache 就能给所有请求复用。根因是"前缀相同"这个属性，不是"前缀相似"。如果前缀只是语义相似但 token 序列不同，Cascade Attention 无法复用（KV Cache 是 token 序列的函数，序列变了 Cache 就失效）。所以 Cascade Attention 的收益高度依赖"前缀是否真的一致"。

**Q：那如果用户 prompt 各不相同，Cascade Attention 不就没用了？为什么不直接每个请求独立算 KV Cache？**

要看前缀结构。即使 user query 不同，system prompt（如"你是一个客服 Agent"）+ tool schema（一堆工具定义）通常是相同的，这部分前缀可能占 2000+ token。100 个并发请求共享这 2000 token 的 KV Cache，节省 2000 * 100 = 20 万 token 的 prefill 计算，收益巨大。独立算的话每个请求都要重新 prefill 这 2000 token，是纯浪费。所以 Cascade Attention 的价值在"前缀相同的部分"，哪怕 user query 各异。

### 第四层：方案权衡

**Q：Cascade Attention 要识别共享前缀，引入了前缀匹配和 Cache 管理的开销，什么时候不值得用？**

当请求的前缀完全随机、没有共同部分时不值得。比如每个请求的 system prompt 都不同（动态生成），或者前缀很短（< 100 token），Cascade Attention 的匹配开销 > 复用收益。经验阈值：共享前缀 > 500 token 且并发请求 > 10 个时，Cascade Attention 明显正向。短前缀 + 低并发场景，直接独立计算更简单。

**Q：为什么不直接把 system prompt 的 KV Cache 常驻内存，所有请求都用，而要搞 Cascade Attention 的动态匹配？**

system prompt 常驻是 Cascade Attention 的一个简化版，适用于"前缀完全固定且只有一层"的场景。但实际场景更复杂：不同 Agent 实例有不同的 system prompt（客服 Agent vs 推荐 Agent），不同租户有不同的工具 schema，用户还可能带不同的 few-shot 示例。前缀是"分层的"（system → tools → few-shot → history → query），需要树形结构管理 KV Cache，按请求的实际前缀路径匹配。常驻内存只解决最简单的场景，Cascade Attention 解决通用的树形共享。

### 第五层：验证与沉淀

**Q：怎么衡量 Cascade Attention 的实际收益？**

对比开/关 Cascade Attention 的两个指标：1) prefill 阶段的 GPU FLOPS 利用率——开启后应该下降（计算量减少）；2) 单请求的 TTFT（Time To First Token）——开启后应该下降 30-50%（共享前缀不重算）。同时监控 Cache 命中率（prefix_cache_hit_rate）和内存占用（KV Cache 总内存），确保没有因为 Cache 管理开销吃掉收益。沉淀为推理引擎调优手册：前缀长度阈值、Cache 淘汰策略（LRU）、共享检测算法的选型。

## 结构化回答

**30 秒电梯演讲：** Continuous Batching在token级别动态拼batch，让不同长度请求共享GPU；Cascade Attention在共享前缀场景下复用KV Cache，避免重复计算。

**展开框架：**
1. **Continuous** — iteration级别动态拼batch，消除队头阻塞
2. **PagedAttention** — KV Cache分页管理，减少显存碎片
3. **Cascade** — 共享前缀复用KV Cache(few-shot/系统prompt场景)

**收尾：** 您想深入聊：PagedAttention和操作系统虚拟内存有什么关系？


## 视频脚本

> 预计时长：5 分钟 | 由浅入深


| 时间 | 画面/字幕 | 口播台词 | 讲解要点 |
|------|----------|----------|----------|
| 0:00 | 标题卡：VLM 的 Continuous… | "Continuous Batching像拼车——不停有人上下车但车一直在跑；Cascade…" | 开场钩子 |
| 0:20 | 核心概念图 | "Continuous Batching在token级别动态拼batch，让不同长度请求共享GPU；Cascade…" | 核心定义 |
| 0:50 | Continuous示意图 | "Continuous——iteration级别动态拼batch，消除队头阻塞" | 要点拆解1 |
| 1:30 | PagedAttention示意图 | "PagedAttention——KV Cache分页管理，减少显存碎片" | 要点拆解2 |
| 2:20 | 对比/实战案例图 | "对比一下常见误区和工程实践，看真实场景里怎么取舍。" | 实战与对比 |
| 3:10 | 总结卡 | "记住核心要点。下期我们追问：PagedAttention和操作系统虚拟内存有什么关系？" | 收尾与钩子 |
