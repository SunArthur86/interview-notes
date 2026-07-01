---
id: note-bz-agent-078
difficulty: L3
category: ai
subcategory: Agent
tags:
- B站面经
- 推理优化
- 成本
- 部署
feynman:
  essence: 降低LLM推理成本和延迟=模型层面(量化/蒸馏/小模型路由)+推理层面(KV Cache/投机解码/批量)+应用层面(缓存/压缩/早停)。全链路优化。
  analogy: 像省油开车——选省油的车(小模型)、规划路线(路由)、匀速行驶(批量)、减少刹车(缓存)、轻装上路(压缩)。
  first_principle: 推理成本∝参数量×Token数。降本=减参数(量化/小模型)或减Token(缓存/压缩/早停)或提效(KV Cache/批量)。
  key_points:
  - 模型层：量化/蒸馏/路由小模型
  - 推理层：KV Cache/投机解码/连续批处理
  - 应用层：缓存/Prompt压缩/早停
  - 部署层：vLLM/TensorRT/边缘部署
first_principle:
  essence: 推理成本 = 参数量 × Token数 × 单位计算成本。
  derivation: 降本三途径：1.减参数(量化8bit/4bit，蒸馏小模型) 2.减Token(缓存复用，Prompt压缩，早停) 3.降单位成本(KV Cache避免重算，批量摊销，vLLM优化)。全链路优化。
  conclusion: 推理优化 = 减参数(量化) + 减Token(缓存/压缩) + 提效率(KV Cache/批量/vLLM)
follow_up:
- 量化损失大吗？——8bit几乎无损，4bit轻微损失
- vLLM为什么快？——PagedAttention+连续批处理
- 投机解码是什么？——小模型先猜，大模型验证，加速2-3倍
memory_points:
- 四层优化框架：应用层减Token、推理层提效率、模型层减参数、部署层搞基建
- 因为INT8几乎无损且省一半显存，所以是量化生产首选；显存极度紧张选INT4
- 简单任务走小模型，复杂走大模型，模型路由机制能降70%以上总成本
- 投机解码：小模型猜+大模型验，质量无损吞吐翻倍；KV Cache复用降计算量
---

# 如何降低大模型 API 推理延迟和成本？如何部署优化？

## 一、优化全链路

```
┌──────────────────────────────────────────────────┐
│              推理优化全链路                          │
├──────────────────────────────────────────────────┤
│                                                    │
│  模型层（减参数）                                   │
│    量化(INT8/INT4) / 蒸馏 / 模型路由              │
│                                                    │
│  推理层（提效率）                                   │
│    KV Cache / 投机解码 / 连续批处理 / vLLM        │
│                                                    │
│  应用层（减Token）                                  │
│    缓存 / Prompt压缩 / 早停 / 滑动窗口             │
│                                                    │
│  部署层（基础设施）                                 │
│    GPU选型 / 弹性伸缩 / 边缘部署                   │
│                                                    │
└──────────────────────────────────────────────────┘
```

## 二、模型层优化

### 量化（Quantization）

```python
# 把FP16权重压缩到INT8/INT4
# 减少显存占用和计算量

quantization_methods = {
    "INT8": {
        "显存节省": "50%",
        "精度损失": "几乎无",
        "推荐": "生产首选"
    },
    "INT4 (GPTQ/AWQ)": {
        "显存节省": "75%",
        "精度损失": "轻微",
        "推荐": "显存紧张时"
    },
    "GGUF": {
        "用途": "CPU推理/边缘设备",
        "优势": "无需GPU"
    }
}
```

### 模型蒸馏

```python
# 用大模型(老师)训练小模型(学生)
# 学生继承老师的能力但更小更快

# 例：GPT-4级别的能力 → 蒸馏到7B模型
# 推理成本降10倍，延迟降5倍
# 代价：能力有损，需要领域数据蒸馏
```

### 模型路由（分层）

```python
class ModelRouter:
    """简单任务用小模型，复杂才用大模型"""
    
    def select(self, query):
        complexity = self.assess(query)
        
        if complexity == "simple":    # 闲聊/简单QA
            return "qwen-7b"          # 快且便宜
        elif complexity == "medium":  # 一般任务
            return "gpt-4o"          # 平衡
        else:                         # 复杂推理
            return "claude-opus"     # 最强但贵
    # 80%请求走小模型，成本降70%+
```

## 三、推理层优化

### KV Cache

```python
# 问题：每生成一个token，要重新计算所有之前的attention
# KV Cache：缓存已计算的Key/Value，避免重复计算

# 无Cache: 生成N个token要O(N²)计算
# 有Cache: 生成N个token要O(N)计算（只算新的）

# 进阶：Prefix Caching
# 相同的system prompt，KV Cache可复用
# 多个请求共享同一system prompt → 只算一次
```

### 投机解码（Speculative Decoding）

```python
# 原理：小模型快速"猜"多个token，大模型并行"验证"
# 小模型猜得对 → 省时间（用了小模型的速度）
# 小模型猜错 → 大模型纠正（保证质量）

# 效果：吞吐提升2-3倍，质量无损
class SpeculativeDecoding:
    def generate(self, prompt):
        # 1. 小模型快速生成5个候选token
        draft = small_model.generate(prompt, n=5)
        
        # 2. 大模型并行验证5个
        verified = large_model.verify(prompt, draft)
        
        # 3. 接受正确的，重新生成错误的
        accepted = verified.accepted
        if not verified.all_accepted:
            accepted += large_model.regenerate(verified.rejected_pos)
        
        return accepted
```

### vLLM（推理引擎）

```python
# vLLM的核心优化：
# 1. PagedAttention：像OS管理虚拟内存一样管理KV Cache
#    → 显存利用率从60%提到95%
# 2. 连续批处理（Continuous Batching）
#    → 动态插入/移除请求，GPU不空闲
# 3. 高效的CUDA kernel

# 效果：吞吐量比HuggingFace高3-5倍

# 使用
from vllm import LLM
llm = LLM(model="qwen-7b")
outputs = llm.generate(["问题1", "问题2"])  # 批量高效
```

## 四、应用层优化

### 缓存

```python
class InferenceCache:
    """多级缓存减少LLM调用"""
    
    async def get_or_infer(self, query):
        # L1: 精确缓存
        if hit := self.exact_cache.get(query_hash):
            return hit  # 省一次调用
        
        # L2: 语义缓存（相似问题）
        if similar := self.semantic_cache.search(query, 0.95):
            return similar
        
        # 未命中才调用
        result = await llm.generate(query)
        self.cache(query, result)
        return result
# 缓存命中率30-50% → 成本降30-50%
```

### Prompt 压缩

```python
# 长prompt压缩，减少输入token
def compress_prompt(prompt):
    # 方法1：去掉冗余（重复/无用内容）
    # 方法2：摘要历史对话
    # 方法3：工具：LLMLingua等
    return compressed  # 可能省50%+ token
```

### 早停（Early Stopping）

```python
# Agent循环时，满足条件立即停止
def agent_loop(goal):
    for step in range(MAX_STEPS):
        result = execute_step()
        if is_goal_achieved(result):
            return result  # 达标即停，不浪费步数
        if confidence > 0.95:
            return result  # 高置信即停
```

## 五、部署层优化

```
GPU选型：
  ├─ 推理为主：A10/A100（性价比）
  ├─ 高吞吐：H100（贵但快）
  └─ 边缘：消费级GPU/Mac（低成本）

部署方式：
  ├─ 云GPU（灵活，按需）
  ├─ 自建集群（量大划算）
  ├─ Serverless（流量波动大）
  └─ 边缘部署（低延迟要求）

弹性伸缩：
  ├─ 按QPS自动扩缩容
  ├─ 低峰缩容省钱
  └─ 高峰快速扩容
```

## 六、效果汇总

```
┌──────────────────┬────────────┬────────────┐
│ 优化手段          │ 成本降低    │ 延迟降低    │
├──────────────────┼────────────┼────────────┤
│ 模型路由(小模型)  │ 70%        │ 60%        │
│ 量化(INT8)       │ 50%(显存)  │ 30%        │
│ KV Cache         │ -          │ 70%        │
│ vLLM            │ 60%(吞吐)  │ -          │
│ 缓存             │ 40%        │ 90%(命中)  │
│ 投机解码          │ -          │ 50%        │
│ Prompt压缩       │ 40%        │ 30%        │
│ 组合             │ 80%+       │ 80%+       │
└──────────────────┴────────────┴────────────┘
```

## 七、面试加分点

1. **全链路**：模型+推理+应用+部署，系统性优化而非单点
2. **模型路由最有效**：80%请求用小模型，成本降70%——ROI 最高
3. **vLLM 是标杆**：PagedAttention+连续批处理是推理引擎的核心技术

## 记忆要点

- 四层优化框架：应用层减Token、推理层提效率、模型层减参数、部署层搞基建
- 因为INT8几乎无损且省一半显存，所以是量化生产首选；显存极度紧张选INT4
- 简单任务走小模型，复杂走大模型，模型路由机制能降70%以上总成本
- 投机解码：小模型猜+大模型验，质量无损吞吐翻倍；KV Cache复用降计算量

