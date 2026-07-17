---
id: note-bd-llm-016
difficulty: L4
category: ai
subcategory: LLM
tags:
- 字节
- 面经
- KV Cache
- 推理优化
- 多轮对话
feynman:
  essence: KV Cache缓存Attention的Key和Value矩阵，避免重复计算历史token的KV。命中率低时用Prefix Caching/Session复用优化。
  analogy: 就像会议纪要——每轮对话不用重新记录所有历史发言(KV Cache缓存)，直接引用之前的纪要。换了话题(前缀变化)就要重新记(缓存未命中)。
  first_principle: Transformer推理时，历史token的KV不变，无需重复计算，缓存即可。
  key_points:
  - 'KV Cache: 缓存历史层的K和V矩阵'
  - '命中率低原因: 前缀变化/对话轮次多'
  - 'Prefix Caching: 缓存系统提示等公共前缀'
  - 'Session Reuse: 同会话复用KV'
  - 'PagedAttention: 分页管理KV碎片'
first_principle:
  essence: KV Cache = 避免重复计算的时空权衡
  derivation: 每轮对话重新算所有历史KV→计算量随轮次平方增长→缓存历史KV→每轮只算新token的KV→但前缀变化导致缓存失效→需要公共前缀缓存
  conclusion: KV Cache命中率优化的核心是最大化前缀复用
follow_up:
- PagedAttention(vLLM)的原理？
- KV Cache的内存怎么估算？
- 如何做KV Cache的淘汰策略？
memory_points:
- 原理：Attention计算中历史Token的K和V不变，缓存复用避免重复计算。
- 阶段：Prefill处理Prompt存入Cache，Decode每步只算新Token的QKV。
- 复杂度：计算量从O(N²)降为O(N)，显存随序列长度和层数线性增加。
- 优化：多轮对话Cache命中率低时，可用Prefix Caching/PD分离/Radix Tree优化。
---

# 【字节面经】KV Cache 的核心原理是什么？在多轮对话场景下，KV Cache 命中率低时你会怎么优化？

## 一、KV Cache 核心原理

### 1.1 为什么需要 KV Cache

Transformer 的 Self-Attention 计算公式：

```
Attention(Q, K, V) = softmax(QK^T / √d_k) · V
```

在**自回归生成**中，每生成一个新 token，都需要与之前所有 token 计算 Attention。如果不缓存，生成第 N 个 token 时要重新计算前 N-1 个 token 的 K 和 V 矩阵——**计算量随序列长度平方增长**。

**核心观察**：历史 token 的 K 和 V 在生成新 token 时**不会变化**（它们不依赖于后续 token），因此可以缓存复用。

### 1.2 KV Cache 工作机制

```
┌──────────────────────────────────────────────────────────────────┐
│                     KV Cache 原理图                               │
├──────────────────────────────────────────────────────────────────┤
│                                                                  │
│  Step 1: Prefill阶段 (处理Prompt "你好世界")                      │
│  ┌─────────┐                                                     │
│  │ Token 1 │ "你好" → 计算 K₁, V₁ → 存入Cache                     │
│  │ Token 2 │ "世界" → 计算 K₂, V₂ → 存入Cache                     │
│  └─────────┘                                                     │
│  Cache状态: [K₁V₁, K₂V₂]                                        │
│  当前输出: "很"                                                   │
│                                                                  │
│  Step 2: Decode阶段 (逐token生成)                                 │
│  ┌─────────┐                                                     │
│  │ Token 3 │ "很" → 只算 Q₃ (Query)                               │
│  │         │   → 与Cache中 K₁K₂ 计算 Attention                    │
│  │         │   → 只算新 K₃V₃ → 追加到Cache                        │
│  └─────────┘                                                     │
│  Cache状态: [K₁V₁, K₂V₂, K₃V₃]                                  │
│  当前输出: "高"                                                   │
│                                                                  │
│  ┌──────────────────────────────────────────────────────────┐     │
│  │ 每步只需计算:                                              │     │
│  │   新token的 Q (1×d) × 历史K^T (d×N) → Attention (1×N)    │     │
│  │   计算量: O(N) 而非 O(N²)                                 │     │
│  └──────────────────────────────────────────────────────────┘     │
└──────────────────────────────────────────────────────────────────┘
```

### 1.3 内存估算

KV Cache 的显存占用计算：

```
显存 = 2 (K+V) × num_layers × seq_len × hidden_dim × num_heads × dtype_size

示例: LLaMA-2-7B
  layers=32, hidden_dim=128(每头), heads=32, seq_len=4096, fp16(2字节)

KV Cache = 2 × 32 × 4096 × 128 × 32 × 2 bytes
         ≈ 2.1 GB (满序列)
```

**关键结论**：KV Cache 的显存占用与序列长度线性正比，与模型层数和隐藏维度也成正比。长上下文场景下，KV Cache 可能比模型权重占用更多显存。

---

## 二、多轮对话命中率低的原因分析

### 2.1 问题场景

```
对话轮次1: [System Prompt] [User1] [Assistant1]
对话轮次2: [System Prompt] [User1] [Assistant1] [User2] [Assistant2]
对话轮次3: [System Prompt] [User1] [Assistant1] [User2] [Assistant2] [User3] [Assistant3]
```

理论上，轮次2的KV Cache包含轮次1的所有token，应该能复用。但实际命中率很低，原因如下：

### 2.2 根因分析

| 原因 | 说明 | 影响程度 |
|------|------|---------|
| **Chat Template变化** | 不同请求的System Prompt、特殊Token位置稍有不同，导致前缀不匹配 | ★★★★★ |
| **动态截断** | 历史对话过长时，中间消息被截断/压缩，改变了token序列 | ★★★★ |
| **多用户调度** | 服务端GPU显存有限，不同用户间切换时KV Cache被驱逐 | ★★★★ |
| **位置编码偏移** | RoPE等位置编码依赖绝对位置，截断后重新编号导致KV语义变化 | ★★★★ |
| **Tokenization不一致** | 对话模板拼接方式变化导致分词结果不同 | ★★★ |

### 2.3 核心矛盾：前缀匹配失效

```
KV Cache 命中条件: 新请求的前缀与已缓存序列 完全一致 (token级精确匹配)

请求A: <|system|>你是助手<|user|>你好<|assistant|>你好！<|user|>今天天气
缓存:   [s][y][s]...[你][好][！]...    ← 前缀完全匹配部分可复用

但如果请求B: <|system|>你是翻译助手<|user|>你好...  ← 第5个token就不同了
→ 几乎全部Cache失效！
```

---

## 三、优化方案：五大策略

### 3.1 Prefix Caching（前缀缓存）

**原理**：将**公共前缀**（System Prompt、Few-shot示例等）的KV Cache缓存为只读块，多个请求共享复用。

```
┌──────────────────────────────────────────────────────────────────┐
│                   Prefix Caching 架构                             │
├──────────────────────────────────────────────────────────────────┤
│                                                                  │
│   ┌─────────────────────────────────────┐                        │
│   │     全局KV Cache Pool (GPU显存)      │                        │
│   │  ┌───────────────────────────────┐  │                        │
│   │  │ System Prompt KV  [共享只读]   │  │  ← 多用户复用            │
│   │  │ Few-shot Examples KV [共享]    │  │                        │
│   │  └───────────────────────────────┘  │                        │
│   │  ┌───────────────────────────────┐  │                        │
│   │  │ User-A 对话历史KV  [私有]      │  │  ← 会话内复用            │
│   │  ├───────────────────────────────┤  │                        │
│   │  │ User-B 对话历史KV  [私有]      │  │                        │
│   │  └───────────────────────────────┘  │                        │
│   └─────────────────────────────────────┘                        │
│                                                                  │
│   请求处理流程:                                                   │
│   1. 计算请求的token hash前缀                                     │
│   2. 在Cache Pool中查找最长公共前缀                                │
│   3. 命中部分 → 直接引用，只计算增量token的KV                     │
│   4. 未命中部分 → 正常计算并缓存                                  │
│                                                                  │
│   命中率提升: System Prompt部分 100%命中                          │
│   首Token延迟(TTFT): 降低 40-70% (长System Prompt)               │
└──────────────────────────────────────────────────────────────────┘
```

```python
class PrefixCacheManager:
    """前缀缓存管理器"""

    def __init__(self, max_cache_size: int = 1000):
        self.cache = {}  # prefix_hash -> kv_cache
        self.max_size = max_cache_size
        self.lru = []    # LRU淘汰队列

    def get_prefix_hash(self, token_ids: list[int]) -> str:
        """计算token序列的hash作为缓存key"""
        import hashlib
        return hashlib.md5(bytes(token_ids)).hexdigest()

    def find_longest_prefix(self, token_ids: list[int]) -> tuple:
        """查找最长可复用前缀"""
        for end in range(len(token_ids), 0, -1):
            prefix_hash = self.get_prefix_hash(token_ids[:end])
            if prefix_hash in self.cache:
                cached_kv = self.cache[prefix_hash]
                remaining = token_ids[end:]
                return cached_kv, remaining, end
        return None, token_ids, 0

    def put(self, token_ids: list[int], kv_cache):
        """存入缓存"""
        prefix_hash = self.get_prefix_hash(token_ids)
        if prefix_hash not in self.cache:
            # LRU淘汰
            if len(self.cache) >= self.max_size:
                evicted = self.lru.pop(0)
                del self.cache[evicted]
            self.cache[prefix_hash] = kv_cache
            self.lru.append(prefix_hash)
```

**实现参考**：vLLM 的 `AutomaticPrefixCaching`、SGLang 的 `RadixAttention`。

### 3.2 PagedAttention（分页管理）

**原理**：借鉴操作系统的虚拟内存分页机制，将 KV Cache 按**固定大小的块（Block）**管理，解决显存碎片化问题。

```
┌──────────────────────────────────────────────────────────────────┐
│                 PagedAttention (vLLM) 原理                        │
├──────────────────────────────────────────────────────────────────┤
│                                                                  │
│  传统KV Cache分配:                                                │
│  ┌──────────────────────────────────┐                            │
│  │ Sequence A: [████████░░░░░░░░]   │ ← 预留max_len, 大量浪费    │
│  │ Sequence B: [██████░░░░░░░░░░]   │                            │
│  │ Internal Frag: ░░░░░░ (碎片)      │                            │
│  └──────────────────────────────────┘                            │
│  显存利用率: ~20-40%                                               │
│                                                                  │
│  PagedAttention:                                                  │
│  ┌──────────────────────────────────────────────────────┐        │
│  │  Block Pool (物理显存)                                │        │
│  │  ┌──┐┌──┐┌──┐┌──┐┌──┐┌──┐┌──┐┌──┐┌──┐┌──┐         │        │
│  │  │A1││A2││B1││A3││B2││C1││B3││A4││C2││B4│         │        │
│  │  └──┘└──┘└──┘└──┘└──┘└──┘└──┘└──┘└──┘└──┘         │        │
│  │                                                       │        │
│  │  Block Table (逻辑→物理映射)                          │        │
│  │  Seq A: Block#0 → Block#1 → Block#3 → Block#7        │        │
│  │  Seq B: Block#2 → Block#4 → Block#6 → Block#9        │        │
│  │  Seq C: Block#5 → Block#8                             │        │
│  └──────────────────────────────────────────────────────┘        │
│  显存利用率: ~95%+                                                │
│                                                                  │
│  优势:                                                            │
│  1. 按需分配Block, 无预分配浪费                                    │
│  2. 无内部碎片 (只有最后一块部分利用)                              │
│  3. Block可共享 (Prefix Caching自然支持)                          │
│  4. 上下文切换只需更新Block Table (指针), 无数据拷贝               │
└──────────────────────────────────────────────────────────────────┘
```

**Block共享与Copy-on-Write**：

```python
class PagedAttentionBlock:
    """vLLM PagedAttention 的 Block 抽象"""
    block_size = 16  # 每块16个token

    def __init__(self):
        self.kv_data = None  # [block_size, num_heads, head_dim]
        self.ref_count = 0   # 引用计数（共享时用）

class BlockTable:
    """逻辑序列到物理Block的映射表"""

    def __init__(self):
        self.physical_blocks: list[PagedAttentionBlock] = []

    def append_token(self, token_kv, block_pool):
        """追写一个新token的KV"""
        last_block = self.physical_blocks[-1]
        if last_block.is_full():
            # 需要新分配Block
            new_block = block_pool.alloc_block()
            self.physical_blocks.append(new_block)
            last_block = new_block
        last_block.write(token_kv)

    def copy_on_write(self, block_pool):
        """当共享Block需要修改时，复制一份"""
        for i, block in enumerate(self.physical_blocks):
            if block.ref_count > 1:
                # 共享Block, 需要CoW
                new_block = block_pool.alloc_block()
                new_block.copy_from(block)
                block.ref_count -= 1
                new_block.ref_count = 1
                self.physical_blocks[i] = new_block
```

### 3.3 Session Reuse（会话级缓存复用）

**原理**：在多轮对话中，将每个会话的KV Cache持久化保存在GPU或CPU内存中，下一轮对话直接追加新token的KV。

```python
class SessionKVCacheManager:
    """会话级KV Cache管理器"""

    def __init__(self, gpu_cache_size_gb: float = 8.0):
        self.sessions = {}  # session_id -> KVCache
        self.gpu_limit = gpu_cache_size_gb

    def get_or_create(self, session_id: str, system_prompt_tokens):
        """获取或创建会话缓存"""
        if session_id not in self.sessions:
            # 新会话: 初始化System Prompt的KV Cache
            kv = self.prefill(system_prompt_tokens)
            self.sessions[session_id] = {
                "kv_cache": kv,
                "token_ids": list(system_prompt_tokens),
            }
        return self.sessions[session_id]

    def append_turn(self, session_id: str, new_tokens: list[int]):
        """追加新一轮对话的token"""
        session = self.sessions[session_id]
        # 关键: 只计算新token的KV, 追加到已有Cache
        new_kv = self.compute_kv_incremental(
            new_tokens,
            existing_cache=session["kv_cache"],
        )
        session["kv_cache"].extend(new_kv)
        session["token_ids"].extend(new_tokens)
        return session["kv_cache"]

    def evict_if_needed(self):
        """显存不足时淘汰最久未使用的会话"""
        if self.current_gpu_usage() > self.gpu_limit:
            # LRU淘汰
            oldest = min(
                self.sessions.keys(),
                key=lambda sid: self.sessions[sid]["last_access"],
            )
            # 溢出到CPU内存 (可选)
            self.offload_to_cpu(oldest)
            del self.sessions[oldest]
```

**关键设计决策**：
- **Cache vs Recompute 权衡**：当历史KV Cache大小 > 重算开销时，应该淘汰
- **GPU↔CPU Swap**：不活跃会话的KV Cache转移到CPU内存，活跃时再加载回来
- **会话超时**：设置TTL，超时会话自动清理

### 3.4 RadixAttention（基数树缓存）

**原理**（SGLang提出）：用**Radix Tree（基数树）**管理所有请求的KV Cache，自动发现并复用任意长度的公共前缀，不仅仅是System Prompt。

```
                    RadixAttention 缓存树结构

                         [ROOT]
                           |
                    ┌──────┴──────┐
               [System Prompt]     [其他前缀]
                    |
              ┌─────┴─────┐
         [User-A 历史]   [User-B 历史]
              |               |
         [A的第3轮]      [B的第2轮]
```

- 每个节点存储一段token序列的KV Cache
- 新请求到来时，在树上查找最长公共前缀路径
- 命中路径直接复用，分歧处新建子节点
- **命中率远高于简单Prefix Caching**：能发现动态公共前缀

### 3.5 注意力Sink + 滑动窗口

**原理**：保留序列开头的"注意力Sink"token（模型天然强烈关注的初始token）+ 最近N个token的KV，丢弃中间不重要的KV，在有限显存内处理超长对话。

```
全序列KV Cache: [t₁, t₂, t₃, ..., t₁₀₀₀₀]  ← 显存爆炸
优化后:         [t₁,t₂,t₃, t₄(t₁₀₀₀₀附近), ..., t₁₀₀₀₀]  ← 保留Sink+窗口
```

---

## 四、优化效果对比

| 优化策略 | 解决问题 | 命中率提升 | 显存节省 | 实现复杂度 | 代表框架 |
|---------|---------|-----------|---------|-----------|---------|
| **Prefix Caching** | System Prompt复用 | ★★★★ | ★★★ | 中 | vLLM |
| **PagedAttention** | 显存碎片 | ★★★ | ★★★★★ | 高 | vLLM |
| **Session Reuse** | 多轮对话复用 | ★★★★★ | ★★★ | 中 | 自研/TGI |
| **RadixAttention** | 动态前缀发现 | ★★★★★ | ★★★★ | 高 | SGLang |
| **Sink+滑动窗口** | 超长上下文 | ★★ | ★★★★★ | 中 | StreamLLM |

---

## 五、面试回答要点总结

> **一句话回答**：KV Cache 缓存历史 token 的 Key/Value 矩阵避免重复计算，将生成复杂度从 O(N²) 降到 O(N)。多轮对话命中率低的核心原因是**前缀不匹配**（Chat Template 变化、动态截断、多用户调度），优化方案是：**Prefix Caching 缓存公共前缀 + PagedAttention 消除显存碎片 + Session Reuse 复用会话 KV + RadixAttention 自动发现动态前缀**。

**关键加分点**：
1. 能推导 KV Cache 的显存计算公式，并指出长上下文下 KV Cache 可能比模型权重更大
2. 理解 PagedAttention 的 Copy-on-Write 机制在多会话共享中的作用
3. 知道 SGLang 的 RadixAttention 是 Prefix Caching 的进化版，能自动发现动态前缀
4. 提到注意力Sink现象——前几个token天然吸引注意力，不能丢弃
5. 知道 KV Cache 的淘汰策略需要权衡：显存节省 vs 重算开销（Recomputation Cost）

## 记忆要点

- 原理：Attention计算中历史Token的K和V不变，缓存复用避免重复计算。
- 阶段：Prefill处理Prompt存入Cache，Decode每步只算新Token的QKV。
- 复杂度：计算量从O(N²)降为O(N)，显存随序列长度和层数线性增加。
- 优化：多轮对话Cache命中率低时，可用Prefix Caching/PD分离/Radix Tree优化。

## 苏格拉底式面试追问

> 这组追问模拟面试官层层逼问，每一问先回答"为什么"，再回答"怎么做"，最后回答"如何证明"。

### 第一层：目标与动机

**Q：KV Cache 缓存 Attention 的 K/V 矩阵，为什么缓存的是 K/V 而不是 Q（Query）？**

因为 Attention 计算时，历史 token 的 K 和 V 会被当前 token 复用，但 Q 不复用。Attention 公式 $\text{Attention}(Q,K,V) = \text{softmax}(QK^T/\sqrt{d_k})V$，生成第 $t$ 个 token 时，需要算"第 $t$ 个 token 的 Q"对所有历史 token 的 K 的点积（$Q_t \cdot K_i$ for $i \le t$），再用 softmax 权重对所有历史 token 的 V 加权求和。历史 token 的 $K_i$ 和 $V_i$（$i < t$）不变，每生成一个新 token 都要重用它们。而 $Q$ 只有当前 token 的 $Q_t$ 是新的，历史的 $Q_i$（$i < t$）不再被使用（当前 token 不需要"作为 query 去查询"）。所以缓存 K/V 省去了重复计算历史 token 的 KV 投影，是 Attention 加速的关键。

### 第二层：证据与定位

**Q：多轮对话系统，第 5 轮的响应延迟比第 1 轮慢很多。你怎么判断是 KV Cache 失效（重新算历史）还是 Decode 阶段本身变慢？**

看 Prefill 和 Decode 的时间分解。如果第 5 轮的 Prefill 时间剧增（如第 1 轮 200ms、第 5 轮 1500ms），是 KV Cache 失效——前几轮的历史 KV 没缓存住，每轮重新 Prefill 全部历史（历史越长 Prefill 越久）。如果 Prefill 时间稳定但 Decode 时间增加（如每 token 从 20ms 涨到 50ms），是 Decode 变慢——因为 Attention 要对更长的历史 KV 做 attention（KV Cache 命中但 size 大，attention 计算量随 history 长度增长）。前者查缓存失效原因（如 Session 复用没配、前缀变化、多用户调度驱逐），后者是 Attention 计算量增长（需要 Flash Attention 等优化）。

### 第三层：根因深挖

**Q：多轮对话中 KV Cache 命中率低，根因是什么？你说用 Prefix Caching 优化，原理是什么？**

根因是"前缀变化导致缓存失效"。KV Cache 命中的前提是"输入的前缀和缓存时一致"——系统 prompt + 历史对话作为前缀，每轮对话历史增长，如果每轮都重新拼接 prompt + 全历史且缓存策略简单（按完整输入 hash 缓存），每次输入不同（历史变长），缓存全失效。更隐蔽的是 Chat Template 变化（不同请求的特殊 token 位置不同）和动态截断（历史过长时中间消息被压缩）。Prefix Caching 的原理是"按前缀树存 KV"——系统 prompt 的 KV 固定不变（缓存一次），历史对话的 KV 增量缓存（每轮只缓存新增部分），新请求进来时按最长前缀匹配复用缓存。这样系统 prompt 的 KV 命中率 100%，历史部分也能部分命中。

**Q：那为什么不直接把所有历史 KV 永久缓存（永不淘汰），命中率不就 100% 了吗？**

显存吃不消。KV Cache 占用的是 GPU 显存（不是普通内存），每个 token 的 KV 大小 = $2 \times \text{layers} \times \text{hidden\_dim} \times \text{precision}$。以 Llama-2-70B 为例，每个 token 的 KV 约 2.5MB（FP16），一个 1000 token 的会话占 2.5GB 显存，多用户并发时显存爆炸。所以必须淘汰——LRU 策略淘汰最久未用的会话缓存，或按用户活跃度优先缓存。Prefix Caching 只缓存"高频共享的前缀"（如系统 prompt、常见 few-shot 模板），个性化历史部分按容量淘汰。显存是硬约束，命中率与并发数 tradeoff（缓存多 = 支持并发少）。

### 第四层：方案权衡

**Q：KV Cache 占显存大，你提到用 PagedAttention（vLLM）优化。原理是什么，为什么不直接增大显存？**

PagedAttention 借鉴操作系统的虚拟内存分页。传统 KV Cache 是"连续分配"——每个请求预分配一段连续显存（按 max_tokens 预留），但实际生成长度不定，大部分请求用不满，显存碎片化和浪费严重（内部碎片，利用率仅 20-40%）。PagedAttention 把 KV Cache 切成固定大小的"块"（如每块 16 token），按需分配——请求用多少块分配多少，不预留。显存利用率提升到 95%+。为什么不增大显存——显存贵且有限（A100 80GB），即使增大也浪费在碎片上；PagedAttention 是软件层面的优化，不增硬件即可提升 2-3 倍吞吐。增大显存是"加硬件"，PagedAttention 是"提效率"，后者更经济。

**Q：为什么不直接用 GQA/MQA（减少 KV 头数）从模型层面减少 KV Cache 大小，省得搞 PagedAttention？**

GQA/MQA 确实减少 KV Cache（MQA 把 KV 头数从全部减到 1 个，KV Cache 缩小 N 倍），但有精度损失——KV 头数少意味着多个 Q 头共享 KV，表达能力下降，模型质量降（benchmark 掉 1-3%）。且 GQA/MQA 是"训练时的模型设计"，推理时无法改（要重新训练或微调）。PagedAttention 是"推理时的显存管理优化"，不碰模型结构，精度零损失，适用于任何模型。两者不冲突——可以同时用 GQA 模型 + PagedAttention 推理，双重省显存。但如果模型已训练好（如用 Llama 标准版），只能用 PagedAttention，不能改 GQA。

### 第五层：验证与沉淀

**Q：你怎么衡量 KV Cache 优化的效果，证明 Prefix Caching / PagedAttention 真的提速了？**

定义指标：一是 KV Cache 命中率（Prefix Caching 命中的 token 数 / 总 token 数），应 >70%；二是 Prefill 时间（首 token 延迟 TTFT），优化后应降低（如从 800ms 降到 200ms）；三是吞吐量（tokens/s 或并发请求数），PagedAttention 应提升 2-3 倍；四是显存利用率（实际用 / 总容量），应 >80%。做对照实验：关闭 Prefix Caching vs 开启，同负载下测 TTFT 和吞吐；关闭 PagedAttention（连续分配）vs 开启，测最大并发数。关键指标是"成本效率"——同等延迟下支持多少并发，或同等并发下延迟降多少。

**Q：KV Cache 优化方案怎么沉淀成推理服务的标配？**

固化成"推理服务优化基线"：默认开启 Prefix Caching（系统 prompt + few-shot 前缀）、PagedAttention（分页管理）、Continuous Batching（动态组批）。沉淀"各模型的 KV Cache 大小估算表"（token 数 × 每 token KV 大小 = 显存需求）、"并发数与延迟的 tradeoff 曲线"、"缓存淘汰策略的配置经验"。配套监控：KV Cache 命中率、显存利用率、TTFT、吞吐量，异常（命中率骤降/显存 OOM）告警。把"KV Cache 优化"作为推理服务的默认配置，而非可选项，新模型部署即获得基础优化。

## 结构化回答

**30 秒电梯演讲：** KV Cache缓存Attention的Key和Value矩阵，避免重复计算历史token的KV。命中率低时用Prefix Caching/Session复用优化。

**展开框架：**
1. **KV Cache** — 缓存历史层的K和V矩阵
2. **命中率低原因** — 前缀变化/对话轮次多
3. **Prefix Caching** — 缓存系统提示等公共前缀

**收尾：** 您想深入聊：PagedAttention(vLLM)的原理？


## 视频脚本

> 预计时长：5 分钟 | 由浅入深


| 时间 | 画面/字幕 | 口播台词 | 讲解要点 |
|------|----------|----------|----------|
| 0:00 | 标题卡：KV Cache 的核心原理是什么？在多轮对话场… | "就像会议纪要——每轮对话不用重新记录所有历史发言(KV Cache缓存)，直接引用之前的纪…" | 开场钩子 |
| 0:20 | 核心概念图 | "KV Cache缓存Attention的Key和Value矩阵，避免重复计算历史token的KV。命中率低时用…" | 核心定义 |
| 0:50 | KV Cache示意图 | "KV Cache——缓存历史层的K和V矩阵" | 要点拆解1 |
| 1:30 | 命中率低原因示意图 | "命中率低原因——前缀变化/对话轮次多" | 要点拆解2 |
| 2:20 | 对比/实战案例图 | "对比一下常见误区和工程实践，看真实场景里怎么取舍。" | 实战与对比 |
| 3:10 | 总结卡 | "记住核心要点。下期我们追问：PagedAttention(vLLM)的原理？" | 收尾与钩子 |
