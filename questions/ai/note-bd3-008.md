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

## 苏格拉底式面试追问

> 这组追问模拟面试官层层逼问，每一问先回答"为什么"，再回答"怎么做"，最后回答"如何证明"。

### 第一层：目标与动机

**Q：推理优化你提三个：KV Cache、PagedAttention、Continuous Batching。它们解决的是不同问题吗？为什么需要三个叠加？**

三者解决推理的不同瓶颈，叠加才能最大化吞吐。KV Cache 解决"计算冗余"——避免每生成一个 token 重复计算历史 KV，把单步复杂度从 O(N²) 降到 O(N)（attention 只算新 token 对历史 KV）。PagedAttention 解决"显存碎片"——KV Cache 的连续预分配导致显存利用率低（20-40%），分页管理提升到 97%，等于变相扩大可用显存（支持更多并发）。Continuous Batching 解决"GPU 空转"——传统 static batching 要等一批请求都生成完才能接新请求（短的等长的，GPU 空转），continuous batching 在请求级别动态组批（一个请求完成立即移出，新请求立即加入），GPU 始终满载。三者正交：KV Cache 是"算法优化"（减少计算），PagedAttention 是"显存优化"（减少浪费），Continuous Batching 是"调度优化"（提高利用率）。叠加后，vLLM 的吞吐比朴素实现高 10-20 倍。

### 第二层：证据与定位

**Q：推理服务吞吐不达标（QPS 只有预期的 30%）。你怎么定位是 KV Cache 命中率低、PagedAttention 碎片、还是 batch 调度问题？**

看各环节指标。一是 KV Cache 命中率（Prefix Caching 命中比例），如果 <50%，是命中率低（大量重新计算历史 KV，Prefill 慢），拖累吞吐；二是显存利用率（`nvidia-smi` 的显存占用 / 容量），如果只有 40-50%，是 PagedAttention 没生效或配置错（碎片仍存在，并发上不去）；三是 GPU 利用率（SM occupancy），如果 <60%，是 GPU 空转（batch 不够大或调度差，Continuous Batching 没做好）；四是 batch size 分布，如果平均 batch size 很小（如 2-3），是请求太少或调度没合并（新请求没及时加入 batch）。排查顺序：先看 GPU 利用率（如果低，是调度/batch 问题），再看显存利用率（如果低，是碎片/并发不够），最后看 KV Cache 命中率（如果低，是缓存策略问题）。

### 第三层：根因深挖

**Q：Continuous Batching 你说"请求级别动态拼 batch"。传统 static batching 为什么不行？根因差异是什么？**

根因是"请求长度不均导致的 GPU 空转"。Static batching 把多个请求组成一个 batch 一起推理，但要等 batch 内所有请求都生成完（达到 max_tokens 或 EOS）才能结束这批、接受新请求。如果 batch 内有长有短（如一个 50 token、一个 500 token），短请求早早生成完，但要等长请求，GPU 资源浪费在"已完成的请求"上（padding 占位）。Continuous Batching 的洞察是"请求级别动态进出"——一个请求生成完立即移出 batch，新请求立即加入，不需要等整批完成。每个 step，batch 的组成都可能变化（有的加、有的减），GPU 始终在处理有效请求（无 padding 浪费）。这把吞吐提升了 5-10 倍（取决于请求长度分布，长度越不均提升越大）。实现上需要"迭代级调度"（每个 decode step 重新组 batch），比 static batching 复杂，但吞吐收益巨大。

**Q：那为什么不直接限制所有请求的最大生成长度（如都 100 token），static batching 就没有"长短不均"问题，省得搞 continuous batching？**

限制生成长度损害用户体验且仍有浪费。一是用户需要长输出——很多场景（如写代码、写报告、长回答）需要几百到几千 token，限制到 100 会截断答案，体验差。二是即使限制长度仍有差异——100 token 的请求和 50 token 的请求一起 batch，50 的仍要等 100 的（只是等的时间短了）。三是限制长度不解决"请求到达不均"——即使所有请求长度相同，新请求要等当前 batch 处理完才能加入（如 batch 处理 100 token 要 2 秒，新请求要等 2 秒），延迟高。Continuous Batching 同时解决"长度不均"和"到达不均"（新请求随时加入），是根本解法。限制长度是"治标"（减少差异），continuous batching 是"治本"（动态调度）。

### 第四层：方案权衡

**Q：Continuous Batching 你用 vLLM 实现。为什么用 vLLM 而非 TGI（HuggingFace）或自研？**

vLLM 是"PagedAttention 的原产地"且生态最成熟。PagedAttention 是 vLLM 团队（UC Berkeley）提出的，vLLM 是其参考实现，优化最彻底（PagedAttention + Continuous Batching + Prefix Caching 三件套）。TGI（Text Generation Inference）是 HuggingFace 的推理框架，也支持 continuous batching，但 PagedAttention 的支持较晚且优化不如 vLLM。自研成本高（PagedAttention 需要改 CUDA kernel，工程量大）。vLLM 的优势：一是性能最优（PagedAttention 的原生实现，吞吐最高）；二是易用（支持 HuggingFace 模型格式，几行代码部署）；三是社区活跃（持续更新，支持新模型快）。选型看场景——追求吞吐用 vLLM，追求生态兼容（HuggingFace 生态）用 TGI，特殊需求（如定制 kernel）自研。当前 vLLM 是生产部署的主流（大多数 LLM 服务用它）。

**Q：为什么不直接用张量并行（TP，多卡切模型）提升吞吐，省得搞 batch 调度？**

TP 和 batch 调度解决不同问题。TP 解决"单请求延迟"——大模型单卡装不下或单卡计算慢，用多卡并行计算（每卡算一部分），降低单请求延迟（生成更快）。但 TP 的吞吐提升有限——多卡服务一个请求，并发数没增（N 卡服务 1 个请求 vs N 卡各服务 1 个请求，后者吞吐更高）。Batch 调度（Continuous Batching）解决"吞吐"——让单卡同时处理更多请求（增大 batch），提升单位时间的 token 生成量。TP 提升"单请求速度"（降低延迟），batch 调度提升"多请求并发"（提升吞吐）。两者互补——TP 让单卡装下大模型（能服务），batch 调度让单卡服务更多请求（高吞吐）。生产部署通常 TP（跨卡切模型）+ Continuous Batching（动态组批）结合。如果单卡能装下模型（如 7B 在 A100-80G），优先 batch 调度（吞吐高），不一定要 TP。

### 第五层：验证与沉淀

**Q：你怎么衡量推理优化的效果，证明"KV Cache + PagedAttention + Continuous Batching"的组合优于朴素实现？**

定义指标：一是吞吐（tokens/s 或 QPS），优化后应比朴素高 10-20 倍；二是延迟（TTFT 首 token 延迟、TPOT 每 token 延迟），应在可接受范围（TTFT <500ms、TPOT <50ms）；三是显存利用率（应 >90%）；四是并发数（单卡支持的并发请求数，优化后应提升 5-10 倍）。做对比实验：朴素实现（无 KV Cache/PagedAttention/Continuous Batching）vs 各优化逐层开启，测吞吐/延迟/显存/并发。关键验证"PagedAttention 的碎片消除"——对比连续分配（static）和分页分配（paged）的显存利用率，paged 应到 95%+。验证"Continuous Batching 的 GPU 利用率"——对比 static batching（GPU 利用率 30-50%）和 continuous（80%+）。在"长度不均"的请求分布下测（最能体现 continuous batching 的优势）。

**Q：推理优化方案怎么沉淀成推理服务标配？**

固化成"推理服务部署模板"：默认用 vLLM（PagedAttention + Continuous Batching + Prefix Caching），根据模型规模配置 GPU 数和 TP 度。沉淀"各模型的部署配置"（7B 单卡 A100、70B 4 卡 TP=4）、"batch size 和并发数推荐"（根据延迟 SLA 调）、"Prefix Caching 配置"（系统 prompt 模板）。配套监控（吞吐、延迟、显存利用率、GPU 利用率、KV Cache 命中率），吞吐降/GPU 利用率低告警（可能 batch 调度异常）。把"vLLM + 三件套优化"作为推理服务的默认部署方案，新模型上线即获得高吞吐。积累"各场景的优化基线"（如客服场景 QPS 100、代码生成场景 QPS 20），帮助容量规划。

## 结构化回答

**30 秒电梯演讲：** KV Cache缓存已计算的Key/Value避免重复计算；PagedAttention像操作系统的虚拟内存分页管理KV Cache；Continuous Batching像流水线动态组批。

**展开框架：**
1. **KV Cache** — 存储历史token的K/V矩阵，推理时只计算新token
2. **PagedAttention** — 分块存储KV Cache，消除碎片化，显存利用率从60%→97%
3. **Continuous** — 请求级别动态调度，不同请求可随时加入/退出batch

**收尾：** 您想深入聊：Prefix Caching如何加速多轮对话？


## 视频脚本

> 预计时长：4 分钟 | 由浅入深


| 时间 | 画面/字幕 | 口播台词 | 讲解要点 |
|------|----------|----------|----------|
| 0:00 | 标题卡：KV Cache的工作原理是什么？vLLM的… | "KV Cache像读书时做笔记——翻过的页不用重新读，只看笔记。…" | 开场钩子 |
| 0:20 | 核心概念图 | "KV Cache缓存已计算的Key/Value避免重复计算；PagedAttention像操作系统的虚拟内存分页管理KV…" | 核心定义 |
| 0:50 | KV Cache示意图 | "KV Cache——存储历史token的K/V矩阵，推理时只计算新token" | 要点拆解1 |
| 1:30 | 对比/实战案例图 | "对比一下常见误区和工程实践，看真实场景里怎么取舍。" | 实战与对比 |
| 2:20 | 总结卡 | "记住核心要点。下期我们追问：Prefix Caching如何加速多轮对话？" | 收尾与钩子 |
