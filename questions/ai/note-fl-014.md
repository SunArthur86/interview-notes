---
id: note-fl-014
difficulty: L3
category: ai
subcategory: LLM
tags:
- 字节
- 飞连
- 面经
- Transformer
- Attention
feynman:
  essence: Self-Attention 每个 token 算 Q/K/V 三向量，注意力分数 = softmax(Q·K^T/√d_k)·V，除√d_k 防止大 d_k 下梯度消失。Multi-Head 把 Q/K/V 切 h 份并行做注意力，让模型在不同子空间关注不同信息（句法/语义/位置），最后 concat+线性层融合。GPT 是 Decoder-only+因果mask 适合生成；BERT 是 Encoder-only+双向 适合理解分类抽取。现代主流全是 Decoder-only。
  analogy: Self-Attention 像开会时每个人同时听所有人说话并决定关注谁（Q=我想问什么，K=别人能答什么，V=别人实际说的）。Multi-Head 像派多个分身同时关注不同方面（一个听内容、一个听语气、一个看位置）。GPT 像只能听前面人说话（因果mask），BERT 像能听到全场。
  first_principle: 注意力的本质是"加权聚合信息"。Q/K 决定权重（谁和谁相关），V 决定聚合内容。多头让模型在不同子空间学不同关系，提升表达力。
  key_points:
  - 'Self-Attention: softmax(Q·K^T/√d_k)·V，除√d_k 防梯度消失'
  - 'Multi-Head: 切h份并行注意力，不同子空间关注不同信息，concat+线性融合'
  - 'GPT: Decoder-only+因果mask，next token prediction，适合生成'
  - 'BERT: Encoder-only+双向，MLM+NSP，适合理解/分类/抽取'
  - 现代主流(Claude/GPT/豆包)全 Decoder-only，生成上限高且能 zero-shot 理解
first_principle:
  essence: 注意力 = 加权聚合信息
  derivation: 序列建模需让每个 token 看到其他 token → 全连接参数爆炸 → 用 Q·K 算相关性权重 → 用 V 聚合 → 多头并行提升表达力
  conclusion: Transformer 的核心创新是用注意力替代 RNN 的递归，实现并行 + 长距离依赖
follow_up:
- 为什么除√d_k 不除d_k？方差推导
- Multi-Head 每个 head 的 d_k 怎么算？head 数怎么选？
- Decoder-only 为什么能 zero-shot 做理解任务？
memory_points:
- 公式核心：Attention = softmax(Q·K^T / √d_k) · V，除以√d_k是为防点积过大导致梯度消失。
- 多头机制：把 Q/K/V 切成 h 份（如 8 头）并行算，让模型在不同子空间学不同特征。
- GPT vs BERT：GPT 是 Decoder 做单向生成（续写），BERT 是 Encoder 做双向理解（完形填空）。
- 主流原因：现代大模型全用 Decoder-only，因其生成上限高、支持 Zero-shot 理解且 Scaling 表现好。
---

# 【字节飞连面经】Transformer 基础：Self-Attention / 多头 / GPT vs BERT

## 一、Self-Attention

每个 token 算 Q / K / V 三个向量：

```
注意力分数 = softmax(Q · K^T / √d_k) · V
                ↑           ↑          ↑
            query-key相似度  缩放    加权聚合value
```

**为什么除√d_k**：防止大 d_k 下点积过大导致 softmax 进饱和区，梯度消失。
- 假设 Q、K 分量是均值0、方差1的独立随机变量
- 点积 `Q·K^T = Σ q_i·k_i`，方差 = d_k
- d_k 大 → 点积方差大 → softmax 饱和 → 梯度消失
- 除√d_k 把方差缩回1

## 二、Multi-Head Attention

把 Q/K/V 切成 h 份并行做注意力：

```
d_model = 512, h = 8
  → 每个 head: d_k = d_v = 512/8 = 64
  → 8 个 head 并行算 attention
  → concat 8 个 head 输出 → 线性层融合回 512
```

**为什么多头**：让模型在不同子空间关注不同信息——
- 有的 head 学句法关系（主谓宾）
- 有的 head 学语义关系（同义/反义）
- 有的 head 学位置关系（相邻/远距离）

单头注意力表达力有限，多头并行提升模型容量。

## 三、GPT vs BERT

| 维度 | GPT | BERT |
|------|-----|------|
| 架构 | Decoder-only | Encoder-only |
| 注意力 | **因果 mask**（只能看前文） | **双向 attention**（看全句） |
| 训练目标 | next token prediction | MLM（遮盖词预测）+ NSP（句子连贯） |
| 适合 | **生成**（对话、续写） | **理解**（分类、抽取、相似度） |

**为什么现代主流（Claude / GPT / 豆包）全是 Decoder-only**：
1. **生成能力上限更高**：因果 mask + next token prediction 是通用生成范式
2. **能 zero-shot 做理解任务**：把分类/抽取转成生成（"这段话的情感是[正/负]"）
3. **Scaling law 友好**：Decoder-only 架构在 scale up 时收益更稳定
4. **训练效率高**：next token prediction 天然适合自回归并行训练

## 四、加分点

- 说出 **Decoder-only 能 zero-shot 理解的原因**：把理解任务转成"生成答案"，比如分类 → "这段话的情感标签是 ___"，抽取 → "实体有 ___"
- 说出 **MLM vs next token 的本质差异**：MLM 是"完形填空"（双向但破坏原始分布），next token 是"续写"（保序且通用）

## 五、扩展

- **RoPE 位置编码**（某讯笔试考点）：用旋转矩阵编码相对位置，支持长上下文外推
- **Flash Attention**：通过分块计算减少 HBM 读写，把 attention 速度提升 2-4 倍（不改变数学结果）
- **MQA / GQA**：Multi-Query Attention / Grouped-Query Attention，多个 head 共享 K/V，减少 KV cache 内存，提升推理速度
- **KV Cache**：自回归生成时缓存已计算的 K/V，避免重复计算，是 LLM 推理优化的核心

## 记忆要点

- 公式核心：Attention = softmax(Q·K^T / √d_k) · V，除以√d_k是为防点积过大导致梯度消失。
- 多头机制：把 Q/K/V 切成 h 份（如 8 头）并行算，让模型在不同子空间学不同特征。
- GPT vs BERT：GPT 是 Decoder 做单向生成（续写），BERT 是 Encoder 做双向理解（完形填空）。
- 主流原因：现代大模型全用 Decoder-only，因其生成上限高、支持 Zero-shot 理解且 Scaling 表现好。

