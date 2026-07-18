---
id: note-xhs-ai-050
difficulty: L3
category: ai
subcategory: 推理优化
tags:
- AI Infra
- LLM
- Prefix Cache
- KV Cache
- 推理优化
- 面经
feynman:
  essence: Prefix Cache是缓存公共Prompt前缀经过Attention计算后的KV状态，后续相同前缀的请求可以跳过Prefill阶段直接复用。它与普通KV Cache的区别在于跨请求共享——普通KV Cache属于单个序列，Prefix Cache跨请求复用可共享的公共前缀块。
  analogy: 就像备课——老师第一次讲新课需要认真备课（Prefill计算），但如果三个班上同一门课，备课内容可以复用（Prefix Cache），只需要为每个班补充不同的习题（Decode阶段）。
  key_points:
  - Prefix Cache保存公共前缀的KV状态，跳过重复Prefill计算
  - 普通KV Cache是单序列的，Prefix Cache跨请求共享
  - 缓存键需绑定tokenizer、模型版本、Adapter等参数
  - 部分匹配：可复用最长公共前缀块，块粒度影响命中率
  - 淘汰策略需综合考虑缓存大小、重算成本和命中频率
first_principle:
  essence: Prefix Cache = 避免对相同前缀重复做Attention计算，核心是"KV状态可复用"
  derivation: 多个请求共享相同System Prompt → 每次都对相同前缀做Prefill计算KV → 浪费 → 缓存公共前缀的KV状态 → 后续请求跳过Prefill直接Decode → 降低TTFT和计算量
  conclusion: Prefix Cache通过跨请求复用KV状态大幅降低首字延迟(TTFT)，对多轮对话和模板化Prompt场景效果显著
follow_up:
- Prefix Cache的命中率受什么影响？（前缀长度、块粒度、请求模式）
- 缓存淘汰策略怎么设计？（LRU + 重算成本权重 + 租户公平性）
- 多租户场景如何隔离Prefix Cache？（按tenant_id隔离+配额管理）
- Prefix Cache和Session Reuse有什么区别？
memory_points:
- 核心区别：普通KV Cache=单序列内复用；Prefix Cache=跨请求共享公共前缀
- 缓存键：tokenizer+模型版本+Adapter+前缀token hash 必须绑定
- 部分匹配：找最长公共前缀块复用，块粒度影响命中率（太粗=命中率低，太细=碎片多）
- 调度：cache-aware routing，优先路由到有缓存前缀的GPU节点
- 淘汰：综合缓存大小+重算成本+命中频率+租户配额
---

# 【AI Infra面经】Prefix Cache 的工作原理？为什么不同于 KV Cache 的普通复用？

> 来源：小红书 AI Infra 大厂面经 每日精选（7月12日）

## 一、背景——LLM推理为什么慢

```
LLM 推理两个阶段

1. Prefill 阶段（处理输入Prompt）
   ┌─────────────────────────────────┐
   │  System: 你是一个专业的翻译助手...  │  ← 公共前缀
   │  Context: 之前的对话历史...        │  ← 公共前缀
   │  User: 翻译这段话                  │  ← 变化部分
   └─────────────────────────────────┘
   → 计算所有输入token的KV状态（Attention计算）
   → 这个阶段是计算密集型，耗时较长（TTFT的主要来源）

2. Decode 阶段（逐个生成输出）
   → 利用Prefill阶段计算的KV Cache逐个生成token
   → 每个token生成都需要读取之前所有token的KV

问题：每次请求都重新计算相同的公共前缀 → 浪费算力
解决：Prefix Cache 缓存公共前缀的KV状态 → 跳过重复Prefill
```

## 二、Prefix Cache vs 普通 KV Cache

```
普通 KV Cache（单序列内复用）

请求1: [System] [Context] [User1] → 生成回答...
       └──────── KV Cache ────────┘
       只在这个请求的Decode阶段复用
       
请求2: [System] [Context] [User2] → 生成回答...
       └──────── 全部重新计算 ──────┘  ← 浪费！前缀和请求1相同


Prefix Cache（跨请求共享）

请求1: [System] [Context] [User1] → Prefill计算
       └── 公共前缀 ──┘└─ 新增 ─┘
       公共前缀的KV存入Prefix Cache

请求2: [System] [Context] [User2]
       └── 公共前缀 ──┘└─ 新增 ─┘
       │               │
       │  从Cache取     │ 只计算这部分
       └──────────────  └──────────
       跳过Prefill → 只计算新增部分 → TTFT大幅降低！
```

| 维度 | 普通 KV Cache | Prefix Cache |
|------|-------------|--------------|
| **作用域** | 单个请求/序列内 | 跨请求共享 |
| **复用对象** | Decode阶段的历史KV | Prefill阶段的前缀KV |
| **生命周期** | 随请求结束释放 | 跨请求保留，按策略淘汰 |
| **存储位置** | GPU显存 | GPU显存（LRU管理） |
| **典型场景** | 所有LLM推理 | 多轮对话、模板化Prompt |

## 三、Prefix Cache 的核心机制

### 缓存键设计

```python
# 缓存键必须绑定以下参数，确保不会错误复用
cache_key = hash(
    model_name,         # 不同模型的KV不兼容
    model_version,      # 模型版本变了KV语义不同
    tokenizer_version,  # 分词器变了token_id映射不同
    adapter_id,         # LoRA Adapter不同则KV不同
    prefix_tokens       # 前缀token序列的hash
)
```

### 部分匹配机制

```
场景：请求1的前缀是 [A B C D E]，请求2的前缀是 [A B C F G]

Prefix Cache中存储:
  Block 0: [A B]  ← KV状态
  Block 1: [C D]  ← KV状态  
  Block 2: [E]    ← KV状态

请求2来了 [A B C F G]:
  Block 0: [A B]  ← 命中！直接复用
  Block 1: [C ?]  ← 部分命中，C复用，D不同
  → 需要重新计算 C 之后的KV

块粒度的影响:
  粗粒度(64 tokens/block): 命中率高但容易因一token不同整块失效
  细粒度(8 tokens/block):  灵活匹配但碎片多，管理开销大
  实践: 通常16-32 tokens/block
```

### Cache-Aware Routing

```
多GPU推理场景的调度优化

GPU 0: Prefix Cache = {[System+Context_1] → KV}
GPU 1: Prefix Cache = {[System+Context_2] → KV}

新请求 [System+Context_1+User_new] 来了:
  → Cache-Aware Router 检查哪个GPU有匹配的前缀缓存
  → GPU 0 有！路由到GPU 0
  → GPU 0 直接复用前缀KV，只计算新增部分
  → TTFT降低 60%+

如果不路由到有缓存的GPU:
  → 所有计算从头开始 → 浪费
```

## 四、淘汰策略

```
Prefix Cache 淘汰决策因素

┌─────────────────────────────────────────────┐
│  1. 缓存大小 (Size)                          │
│     → 显存有限，超限必须淘汰                   │
│                                              │
│  2. 重算成本 (Recomputation Cost)            │
│     → 长前缀重算成本高 → 优先保留             │
│     → 短前缀重算成本低 → 优先淘汰             │
│                                              │
│  3. 命中频率 (Hit Frequency)                 │
│     → 高频访问的前缀优先保留                   │
│     → LRU策略淘汰最久未访问的                  │
│                                              │
│  4. 租户配额 (Tenant Quota)                  │
│     → 多租户场景需公平分配缓存空间              │
│     → 避免一个大租户占满全部缓存                │
│                                              │
│  综合公式: priority = f(size, cost, freq,    │
│                        tenant_quota)          │
└─────────────────────────────────────────────┘
```

## 五、实际效果

| 指标 | 无Prefix Cache | 有Prefix Cache | 提升 |
|------|---------------|---------------|------|
| TTFT (首字延迟) | 800ms | 300ms | -62% |
| Prefill计算量 | 2048 tokens | 256 tokens | -87% |
| GPU利用率 | 85% | 60% | 有余量接更多请求 |

> 效果取决于前缀复用率——多轮对话（System Prompt固定）效果最好，单次请求无明显效果。

## 六、面试加分点

1. **核心区别讲清楚**：普通KV Cache=单序列Decode复用，Prefix Cache=跨请求Prefill复用
2. **缓存键设计**：能说出必须绑定model_version/tokenizer/adapter等参数
3. **块粒度权衡**：粗=高命中易失效，细=灵活但碎片多，实践选16-32 tokens/block
4. **Cache-Aware Routing**：提到调度器应优先路由到有缓存前缀的GPU节点
5. **淘汰策略全面**：不只说LRU，还要考虑重算成本和租户公平性

## 结构化回答

**30 秒电梯演讲：** Prefix Cache是缓存公共Prompt前缀经过Attention计算后的KV状态，后续相同前缀的请求可以跳过Prefill阶段直接复用。

**展开框架：**
1. **Prefix** — Prefix Cache保存公共前缀的KV状态，跳过重复Prefill计算
2. **普通** — 普通KV Cache是单序列的，Prefix Cache跨请求共享
3. **缓存键需绑定** — 缓存键需绑定tokenizer、模型版本、Adapter等参数

**收尾：** 您想深入聊：Prefix Cache的命中率受什么影响？（前缀长度、块粒度、请求模式）？


## 视频脚本

> 预计时长：4 分钟 | 由浅入深


| 时间 | 画面/字幕 | 口播台词 | 讲解要点 |
|------|----------|----------|----------|
| 0:00 | 标题卡：Prefix Cache 的工作原理？为什么不同… | "就像备课——老师第一次讲新课需要认真备课（Prefill计算），但如果三个班上同一门课，备…" | 开场钩子 |
| 0:20 | 核心概念图 | "Prefix Cache是缓存公共Prompt前缀经过Attention计算后的KV状态，后续相同前缀的请求可以跳过…" | 核心定义 |
| 0:50 | Prefix示意图 | "Prefix——Prefix Cache保存公共前缀的KV状态，跳过重复Prefill计算" | 要点拆解1 |
| 1:30 | 对比/实战案例图 | "对比一下常见误区和工程实践，看真实场景里怎么取舍。" | 实战与对比 |
| 2:20 | 总结卡 | "记住核心要点。下期我们追问：Prefix Cache的命中率受什么影响？（前缀长度、块粒？" | 收尾与钩子 |

## 苏格拉底式面试追问

| 追问层级 | 面试官可能这样问 | 高分回答方向 |
|----------|------------------|--------------|
| 目标追问 | Prefix Cache想解决什么问题？和普通KV Cache复用有什么本质区别？ | 解决重复前缀（system prompt、few-shot）的重复计算问题；本质区别是Prefix Cache按前缀hash命中可跨请求复用，普通KV Cache是单请求生命周期 |
| 证据追问 | Prefix Cache怎么命中？怎么知道前缀重复？ | 对token序列按前缀计算hash（或树形结构Trie），新请求前缀hash匹配则命中，直接复用已计算的KV，跳过prefill |
| 边界追问 | 什么场景Prefix Cache收益最大？什么场景几乎无收益？ | 固定system prompt+few-shot、多轮对话相同前缀收益最大；每次请求前缀都不同（用户输入各异）几乎无收益 |
| 反例追问 | Prefix Cache一定比普通KV Cache好吗？ | 不一定。缓存管理有内存和淘汰开销、hash计算有成本、命中率低时反而浪费；要按命中率决定是否启用 |
| 风险追问 | Prefix Cache有什么风险？ | 缓存淘汰策略不当导致命中率低、内存占用大、hash冲突误命中、前缀变化导致全量失效 |
| 验证追问 | 怎么验证Prefix Cache有效？ | 监控命中率、首token延迟（TTFT）下降、对比启用前后prefill计算量、内存占用监控 |
| 沉淀追问 | Prefix Cache怎么沉淀？ | 规范：固定前缀放最前、监控命中率、合理设置缓存大小和淘汰策略、低命中率场景关闭 |

### 现场对话示例
**面试官**：Prefix Cache的工作原理？为什么不同于KV Cache的普通复用？
**候选人**：Prefix Cache按前缀hash命中可跨请求复用（system prompt、few-shot），跳过prefill计算；普通KV Cache是单请求生命周期不能跨请求，这是本质区别。
**面试官**：什么场景收益最大？
**候选人**：固定system prompt+few-shot、多轮对话相同前缀收益最大；每次请求前缀都不同几乎无收益。
**面试官**：Prefix Cache一定比普通KV Cache好吗？
**候选人**：不一定，缓存管理和hash计算有开销，命中率低时反而浪费，要监控命中率和TTFT下降决定是否启用。
