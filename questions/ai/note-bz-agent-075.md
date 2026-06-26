---
id: note-bz-agent-075
difficulty: L3
category: ai
subcategory: LLM
tags:
  - B站面经
  - 上下文窗口
  - 长上下文
feynman:
  essence: 上下文窗口=LLM单次能"看到"的token数。突破长上下文的技术：位置编码扩展(RoPE)、滑动窗口注意力、RAG外置记忆、摘要压缩、分层处理。
  analogy: 像人的工作记忆——一次只能记几件事(上下文窗口)。要处理更多，靠笔记(RAG)、总结(摘要)、分批看(滑动窗口)。
  first_principle: 注意力机制是O(n²)复杂度，上下文越长计算量平方增长。突破=降低计算量或外置存储。
  key_points:
    - 上下文窗口：LLM单次处理的token上限
    - 突破技术：RoPE扩展/滑动窗口/RAG/摘要/分层
    - 趋势：从4K→128K→1M+
    - 权衡：越长越贵且"中间遗忘"
first_principle:
  essence: 上下文窗口受限于注意力计算的O(n²)复杂度和位置编码的表达能力。
  derivation: '标准注意力：每个token关注所有token，计算量O(n²)。100K token需10^10次运算。位置编码也需覆盖长距离。突破=优化注意力计算(滑动窗口/Flash)或扩展位置编码(RoPE)。'
  conclusion: 长上下文突破 = 计算优化（滑动注意力/Flash）+ 位置编码扩展（RoPE）+ 外部策略（RAG/摘要）
follow_up:
  - 长上下文有什么问题？——中间遗忘/成本高/精度下降
  - 多长算长？——32K以上算长，100K+算超长
  - 无限长可能吗？——理论上有，但精度和成本是瓶颈
---

# 上下文窗口是什么？突破长上下文有哪些技术？

## 一、上下文窗口定义

```
上下文窗口(Context Window)
  = LLM单次推理能处理的token数量上限

  GPT-3:        2K tokens
  GPT-4:        8K / 32K / 128K
  Claude 3:     200K
  Gemini 1.5:   1M / 2M
  国产(通义/Kimi): 128K - 1M+

  意义：
  - 窗口大 → 能处理更长的文档/对话
  - 但更大 ≠ 更好（成本高/中间遗忘/精度下降）
```

## 二、为什么有上限

```
限制因素：

1. 注意力计算的O(n²)复杂度
   每个token要关注所有其他token
   n=100K → 10^10次运算 → 显存爆炸

2. 位置编码的表达能力
   训练时的最大长度限制了推理长度
   超过训练长度，位置编码外推效果差

3. 显存限制
   KV Cache随序列长度线性增长
   100K token的KV Cache可能占几十GB

4. "中间遗忘"(Lost in the Middle)
   即使支持长上下文，模型对中间部分的处理质量下降
```

## 三、突破技术：模型层面

### 1. 位置编码扩展（RoPE）

```python
# RoPE (Rotary Position Embedding)
# 通过旋转矩阵编码相对位置
# 优势：可外推到训练时没见过的长度

# 扩展方法：
# - NTK-aware: 调整RoPE基频，平滑外推
# - YaRN: 分段插值，兼顾近远距离
# - Dynamic NTK: 推理时动态调整

# 效果：训练4K的模型，通过RoPE扩展可处理32K+
```

### 2. 滑动窗口注意力

```python
# 标准注意力：每个token看所有token O(n²)
# 滑动窗口：每个token只看附近W个token O(n×W)

class SlidingWindowAttention:
    def __init__(self, window_size=4096):
        self.window = window_size
    
    def attention(self, query, key, value, positions):
        # 每个位置只关注 [pos-W, pos+W] 范围
        for i in range(len(query)):
            start = max(0, i - self.window)
            end = min(len(key), i + self.window)
            # 只在这个窗口内做attention
            attend(query[i], key[start:end], value[start:end])

# Mistral等模型用此技术支持32K+
```

### 3. Flash Attention

```python
# 不改变注意力结果，但优化GPU内存访问
# 把注意力计算分块，减少HBM读写
# 效果：同样的上下文，显存占用降3-5倍，速度提升2-4倍

# 不是"算法突破"而是"工程优化"
# 让长上下文在有限显存下可行
```

### 4. 稀疏注意力 / 线性注意力

```python
# 稀疏：只关注"重要"的token（如Longformer）
# 线性：用核函数近似，降到O(n)（如Performer/Linformer）
# 代价：精度有损，目前不如标准注意力准
```

## 四、突破技术：应用层面

### 1. RAG（外置记忆）

```python
# 不把所有文档塞进上下文，而是按需检索
# 这是处理"超大知识库"的标准方案

def answer_with_rag(question, huge_docs):
    # 从百万文档中检索相关的5-10个片段
    relevant = retriever.search(question, top_k=5)
    # 只把相关的塞进上下文
    context = format(relevant)  # ~2000 tokens
    return llm.generate(question, context)
# 突破窗口限制：外部存储无限，上下文只放精华
```

### 2. 摘要压缩

```python
# 长文档→摘要→塞进上下文
def handle_long_doc(long_doc):
    if count_tokens(long_doc) > window:
        # 分块摘要
        chunks = split(long_doc, size=window)
        summaries = [llm.summarize(c) for c in chunks]
        # 摘要的摘要（层次化）
        final_summary = llm.summarize("\n".join(summaries))
        return final_summary
    return long_doc
```

### 3. 滑动窗口处理

```python
# 分批处理超长输入
def process_long_text(text, window=8000, overlap=500):
    chunks = []
    for i in range(0, len(text), window - overlap):
        chunk = text[i:i+window]
        result = llm.process(chunk)
        chunks.append(result)
    return merge(chunks)
```

### 4. Map-Reduce 模式

```python
# Map: 分块独立处理
# Reduce: 汇总结果
def map_reduce_long_doc(docs, question):
    # Map: 每块独立找答案
    partial_answers = []
    for chunk in split(docs, window):
        ans = llm.ask(question, chunk)
        partial_answers.append(ans)
    
    # Reduce: 汇总
    final = llm.synthesize(question, partial_answers)
    return final
```

## 五、长上下文的问题

```
┌──────────────┬──────────────────────────────────┐
│ 问题          │ 说明                                │
├──────────────┼──────────────────────────────────┤
│ 中间遗忘      │ 模型对上下文中间部分处理质量下降      │
│ (Lost in     │ 首尾好，中间差                      │
│  Middle)     │                                    │
├──────────────┼──────────────────────────────────┤
│ 成本高        │ Token数∝成本，100K输入很贵          │
├──────────────┼──────────────────────────────────┤
│ 延迟高        │ 更长上下文=更慢的首token延迟         │
├──────────────┼──────────────────────────────────┤
│ 精度下降      │ 信息过多会"稀释"注意力              │
│              │ 关键信息被淹没                      │
├──────────────┼──────────────────────────────────┤
│ 位置外推      │ 超过训练长度效果下降                │
└──────────────┴──────────────────────────────────┘

应对：
  - 重要信息放首尾（避免中间）
  - 能用RAG就别硬塞（成本+精度）
  - 摘要压缩减少token
```

## 六、面试加分点

1. **两层突破**：模型层(RoPE/滑动窗口/Flash) + 应用层(RAG/摘要/Map-Reduce)
2. **中间遗忘**：长上下文不是万能的，重要信息放首尾——体现实战经验
3. **RAG 仍是主流**：即使有 1M 窗口，RAG 在成本和精度上仍更优——务实判断
