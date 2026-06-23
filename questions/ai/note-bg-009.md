---
id: note-bg-009
difficulty: L3
category: ai
subcategory: Infra
tags:
- 八股总结
- 面经
- vLLM
- SGLang
- 推理框架
- PagedAttention
- Continuous Batching
feynman:
  essence: vLLM和SGLang都是高性能LLM推理框架。vLLM的核心创新是PagedAttention（类虚拟内存的KV-Cache管理）+ Continuous Batching（动态拼batch）；SGLang的核心是RadixAttention（前缀共享缓存）+ 结构化生成约束，适合Agent/多轮场景。
  analogy: vLLM像高效的"出租车调度"——用PagedAttention把显存当虚拟内存管理，不浪费碎片空间，Continuous Batching让请求随到随走不用等。SGLang像"共享班车"——多个请求有共同前缀（如system prompt）就共享同一份缓存，特别适合Agent反复调用同一套prompt。
  first_principle: LLM推理瓶颈是KV-Cache显存管理。vLLM用分页机制消除碎片（显存利用率从60%→95%+），用连续批处理消除padding浪费（吞吐提升3-5倍）。SGLang在此基础上发现"多请求常共享前缀"，用Radix Tree自动复用前缀缓存，进一步降低重复计算。
  key_points:
  - vLLM核心：PagedAttention(分页KV) + Continuous Batching(动态批)
  - SGLang核心：RadixAttention(前缀缓存树) + 结构化生成
  - vLLM适合：高并发通用推理服务
  - SGLang适合：Agent/多轮/结构化输出场景
first_principle:
  essence: 推理框架优化的本质是"最大化GPU计算/显存利用率"
  derivation: 传统推理的三大浪费：显存碎片（40%浪费）、padding（长短请求混合）、重复计算（相同前缀）。vLLM解决前两个，SGLang解决第三个。两者都是把"静态、粗粒度"的资源管理改为"动态、细粒度"。
  conclusion: vLLM是通用推理标配，SGLang在Agent/多轮场景更优
follow_up:
  - PagedAttention具体如何管理KV-Cache的物理块？
  - SGLang的Radix Tree如何检测前缀共享？
  - 推理框架如何支持流式输出(streaming)？
---

# 【八股总结】vLLM 和 SGLang 的核心原理与适用场景

## 一、LLM推理的核心瓶颈

### 1.1 为什么需要专门推理框架

```python
# 朴素推理的问题（用HuggingFace transformers）
from transformers import AutoModelForCausalLM

model = AutoModelForCausalLM.from_pretrained("llama-7b")

# 问题1：KV-Cache显存浪费严重
# 传统做法：为每个请求预分配"最大序列长度"的连续显存
# 实际生成长度不确定 → 大量预分配空间浪费
# 显存利用率仅40-60%

# 问题2：静态 batching
# 一个batch内的请求必须等最长的完成才能返回
# 短请求完成后空等，GPU闲置

# 问题3：重复计算
# 多个请求有相同system prompt → 每次都重新计算KV
# Agent多轮场景尤其浪费

# vLLM/SGLang就是解决这三个问题的
```

### 1.2 KV-Cache回顾

```
LLM生成时，每生成一个token，需要attention到前面所有token的Key/Value
如果不缓存：生成第n个token要重新计算前n-1个的KV → O(n²)复杂度
KV-Cache：把已计算的KV存在显存 → 生成第n个token只需算1个新KV → O(n)

代价：KV-Cache显存占用大
  LLaMA-7B, seq=2048, batch=32:
  KV-Cache显存 = 2(K+V) × 32层 × 32batch × 2048seq × 4096hidden × 2bytes(fp16)
              ≈ 32GB
  → 比模型参数本身(14GB)还大！
```

## 二、vLLM：通用推理引擎

### 2.1 PagedAttention（核心创新）

```python
# 问题：传统KV-Cache的显存碎片
# 传统做法：每个请求预分配 max_seq_len 的连续显存块

# 请求A（实际生成100 tokens）: 预分配2048 → 浪费1948
# [██████████████████████████████████████████████] 预分配2048
# [███]                                         实际用100
#      ← 1948个位置的碎片浪费

# PagedAttention：类虚拟内存的分页管理
# 把显存分成固定大小的"页"(block)，按需分配

class PagedAttention:
    """像操作系统的虚拟内存分页"""
    BLOCK_SIZE = 16  # 每页16个token的KV

    def __init__(self, num_blocks, block_size=16):
        # 物理块池（预先分配所有块）
        self.physical_blocks = allocate_blocks(num_blocks, block_size)
        # 逻辑到物理的映射表（每请求一个）
        self.block_tables = {}  # request_id → [block_idx, ...]

    def allocate(self, request_id):
        """按需分配块，不预分配"""
        self.block_tables[request_id] = []
        # 初始不分配，生成时按需扩展

    def append_token(self, request_id, token_kv):
        """生成新token时，追加到逻辑块链"""
        table = self.block_tables[request_id]
        if len(table) == 0 or block_full(table[-1]):
            # 当前块满了，分配新物理块
            new_block = self.physical_blocks.pop_free()
            table.append(new_block)
        # 写入KV（逻辑连续，物理可分散）
        write_kv(new_block, token_kv)

# 效果：
# - 显存碎片从40%降到<5%
# - 同等显存能服务更多并发请求
# - 显存利用率60% → 95%+
```

```
物理显存（分页后）：
┌────┬────┬────┬────┬────┬────┬────┬────┐
│ B0 │ B1 │ B2 │ B3 │ B4 │ B5 │ B6 │ B7 │ ...
└────┴────┴────┴────┴────┴────┴────┴────┘

请求A的逻辑视图：B0 → B3 → B5（不连续，但逻辑连续）
请求B的逻辑视图：B1 → B2 → B6
请求C的逻辑视图：B4 → B7

→ 没有碎片，显存利用率95%+
```

### 2.2 Continuous Batching（连续批处理）

```python
# 问题：静态batching的等待浪费
# 传统：batch=4，4个请求一起进，必须等最慢的完成

# 时间 →
# Req1: [████]完成 → 空等...
# Req2: [████████████]完成 → 空等...
# Req3: [██████]完成 → 空等...
# Req4: [████████████████████████] ← 最慢，其他都等

# Continuous Batching：请求动态进出
# 某请求完成 → 立即移出 → 新请求加入 → 不等

class ContinuousBatchingScheduler:
    def __init__(self):
        self.running_queue = []  # 正在运行的请求
        self.waiting_queue = []  # 等待加入的请求

    def step(self):
        # 1. 检查完成的请求，移出
        finished = [r for r in self.running_queue if r.is_done()]
        for r in finished:
            self.running_queue.remove(r)
            self.free_blocks(r)  # 释放KV-Cache块

        # 2. 从等待队列补充新请求
        while len(self.running_queue) < self.max_batch_size:
            if not self.waiting_queue:
                break
            new_req = self.waiting_queue.pop(0)
            self.running_queue.append(new_req)

        # 3. 对当前running队列做一次forward
        # 不同请求处于不同生成阶段，但能拼在同一个batch
        self.forward_step(self.running_queue)

# 效果：吞吐量提升3-5倍
```

### 2.3 vLLM的架构

```
┌─────────────────────────────────────┐
│           vLLM Engine               │
├─────────────────────────────────────┤
│  ┌─────────────┐  ┌──────────────┐ │
│  │ Scheduler   │  │ PagedAttention│ │
│  │ (Continuous │  │ Manager      │ │
│  │  Batching)  │  │ (分页KV管理) │ │
│  └─────────────┘  └──────────────┘ │
│         ↓                ↓          │
│  ┌──────────────────────────────┐  │
│  │     Model Worker (GPU)       │  │
│  │  - 前向计算                   │  │
│  │  - PagedAttention kernel      │  │
│  └──────────────────────────────┘  │
└─────────────────────────────────────┘

特点：
- 兼容OpenAI API格式
- 支持tensor parallel
- 流式输出(streaming)
- 显存利用率95%+
```

## 三、SGLang：Agent/结构化场景优化

### 3.1 RadixAttention（前缀缓存复用）

```python
# 问题：多个请求常共享相同前缀
# 例：Agent场景，所有请求都有相同的system prompt
# "You are a helpful assistant. Current time: ... Rules: ..."

# 传统vLLM：每个请求都重新计算前缀的KV → 浪费

# SGLang的RadixAttention：用Radix Tree自动检测和复用前缀

class RadixAttentionCache:
    """基数树管理前缀共享"""
    def __init__(self):
        self.tree = RadixTree()  # 前缀树，节点存KV

    def get_or_compute(self, tokens):
        """获取KV，命中前缀则复用"""
        # 1. 在树中找最长匹配前缀
        matched_node, matched_len = self.tree.longest_match(tokens)

        if matched_len > 0:
            # 前缀命中！复用已有KV
            prefix_kv = matched_node.kv_cache
            # 只需计算剩余部分
            new_tokens = tokens[matched_len:]
            new_kv = self.compute_kv(new_tokens, prefix_kv)
            # 扩展树
            self.tree.insert(tokens, prefix_kv + new_kv)
            return prefix_kv + new_kv
        else:
            # 无匹配，全量计算
            kv = self.compute_kv(tokens)
            self.tree.insert(tokens, kv)
            return kv

# 效果：
# Agent多轮对话：第2轮起，system prompt的KV完全复用
# 多请求相同prompt：第一个计算，后续直接命中
# 延迟降低50%+（前缀越长收益越大）
```

```
Radix Tree示例：
                    [system_prompt]
                   /               \
        [user_query_1]          [user_query_2]
           /        \               |
       [resp_1a] [resp_1b]      [resp_2]

多轮对话时：
第1轮：You are... + Q1 → 全量计算，存入树
第2轮：You are... + Q1 + A1 + Q2 → "You are...+Q1"命中，只算A1+Q2
第3轮：进一步复用 → 几乎只算新增部分
```

### 3.2 结构化生成约束

```python
# SGLang的另一个核心：约束生成（JSON/正则/选择）

from sglang import gen

# 场景：Agent需要输出结构化的工具调用
@function
def tool_call(s, query):
    s += "You must respond in JSON: "
    s += gen(
        "response",
        max_tokens=256,
        regex=r'\{"tool":\s*"\w+",\s*"args":\s*\{.*\}\}'  # 强制JSON格式
    )
    # SGLang在解码时只采样符合正则的token → 100%合法JSON

# 对比vLLM：vLLM也可能输出非法JSON，需要重试
# SGLang的结构化约束保证一次生成成功

# 适合场景：
# - Agent工具调用（必须合法JSON）
# - 数据提取（必须符合schema）
# - 分类任务（必须输出指定类别之一）
```

### 3.3 SGLang的程序化定义

```python
# SGLang允许用Python代码定义复杂的生成流程
from sglang import function, gen, set_default_args

@function
def multi_step_reasoning(s, question):
    # Step 1: 分解问题
    s += "Break down the question: "
    s += gen("decomposition", max_tokens=128)

    # Step 2: 逐步推理
    s += "Now solve step by step: "
    s += gen("reasoning", max_tokens=512)

    # Step 3: 给出答案（约束格式）
    s += "Final answer (number only): "
    s += gen("answer", max_tokens=10, regex=r'\d+')

    # 多轮、多分支都能用代码编排
    # 比纯prompt更可控

# 优势：复杂Agent逻辑用代码定义，SGLang自动优化中间KV复用
```

## 四、vLLM vs SGLang 对比

```
┌──────────────┬────────────────────┬────────────────────┐
│              │ vLLM              │ SGLang             │
├──────────────┼────────────────────┼────────────────────┤
│ KV管理       │ PagedAttention    │ RadixAttention     │
│              │ (分页，无碎片)     │ (分页+前缀复用)    │
│ Batching     │ Continuous        │ Continuous         │
│              │ (动态拼批)        │ + 前缀感知调度     │
│ 结构化输出   │ 支持(outlines)    │ 原生支持(regex)    │
│ 多轮优化     │ 有限              │ 优秀(前缀共享)     │
│ 编程接口     │ OpenAI API兼容    │ Python DSL         │
│ 吞吐(通用)   │ 高                │ 高                 │
│ 吞吐(Agent)  │ 中                │ 高(前缀复用)       │
│ 延迟(首token)│ 中                │ 低(缓存命中)       │
│ 成熟度       │ 非常成熟          │ 较新，快速迭代     │
│ 适用场景     │ 通用API服务       │ Agent/结构化/多轮  │
└──────────────┴────────────────────┴────────────────────┘
```

### 选型建议

```python
def choose_inference_engine(use_case):
    if use_case == "general_api":
        # 通用API服务（如聊天、问答）
        return "vLLM"  # 成熟稳定，兼容性好

    elif use_case == "agent_multi_turn":
        # Agent多轮对话
        return "SGLang"  # 前缀复用大幅降延迟

    elif use_case == "structured_output":
        # 需要严格JSON/正则输出
        return "SGLang"  # 原生约束生成

    elif use_case == "batch_offline":
        # 离线批量推理
        return "vLLM"  # Continuous Batching吞吐高

    elif use_case == "production_critical":
        # 生产环境，求稳
        return "vLLM"  # 最成熟，社区最大

    else:
        return "vLLM"  # 默认选择
```

## 五、性能对比（实测参考）

```
场景：LLaMA-70B, A100×8

┌─────────────────┬──────────┬──────────┐
│ 指标            │ vLLM     │ SGLang   │
├─────────────────┼──────────┼──────────┤
│ 通用吞吐(req/s) │ 150      │ 155      │
│ Agent多轮吞吐   │ 80       │ 140 ★    │
│ 首token延迟     │ 200ms    │ 80ms ★   │
│ 结构化成功率    │ 95%      │ 100% ★   │
│ 显存利用率      │ 95%      │ 95%      │
└─────────────────┴──────────┴──────────┘

★ = 显著优势
SGLang在Agent/多轮场景优势明显（前缀复用）
vLLM在通用场景持平或略优（更成熟的kernel优化）
```

## 加分点

1. **理解PagedAttention的虚拟内存类比**：把操作系统的分页机制用到GPU显存，是经典创新
2. **能解释RadixAttention的场景价值**：Agent多轮场景前缀复用收益巨大，体现对应用场景的理解
3. **提到Continuous Batching**：这是推理服务吞吐提升的核心，比PagedAttention更基础

## 雷区

- **混淆训练框架和推理框架**：vLLM/SGLang是推理（inference），Megatron/DeepSpeed是训练（training）
- **忽视场景差异**：vLLM不是所有场景都最优，Agent场景SGLang更好
- **以为PagedAttention改变了模型**：它只改了KV-Cache的存储管理，模型计算完全不变

## 扩展

- **vLLM论文**：Efficient Memory Management for LLM Serving (SOSP 2023)，PagedAttention的出处
- **SGLang**：Lianmin Zheng等，RadixAttention + 结构化生成
- **TensorRT-LLM**：NVIDIA的推理框架，与硬件深度优化
- **Speculative Decoding**：推测解码，用小模型加速大模型推理，vLLM/SGLang都支持
