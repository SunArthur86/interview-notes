---
id: note-sp-ai-010
difficulty: L2
category: ai
subcategory: LLM
tags:
- Shopee
- 面经
- Transformer
feynman:
  essence: Transformer是纯注意力机制的编码器-解码器架构，抛弃了RNN
  analogy: Encoder像阅读理解——通读全文做笔记。Decoder像写作文——看着笔记一个字一个字写出来
  first_principle: 自注意力让每个词看到全句上下文，比RNN的顺序处理更高效且能并行
  key_points:
  - Encoder读完整输入，每个词融合全句上下文
  - Decoder逐词自回归生成，多一层交叉注意力
  - 每层结构：自注意力+前馈+残差+LayerNorm
  - N层堆叠（原论文N=6）
first_principle:
  essence: 用注意力机制替代RNN的递归——O(1)路径长度让任意两词直接交互，且可并行计算
  derivation: RNN→O(n)路径长度→远距离信息衰减。注意力→O(1)路径→任意距离直接交互。代价是O(n²)计算量
  conclusion: Transformer用自注意力实现全局感受野，并行计算解决RNN的训练瓶颈
follow_up:
- 为什么Encoder可以并行而Decoder不能？
- Pre-LN和Post-LN有什么区别？
- Decoder-only和Encoder-only分别适合什么任务？
memory_points:
- Transformer双核：Encoder负责双向看全句提取特征，Decoder负责单向看前文生成文本。
- Encoder结构：核心是全局Self-Attention（Q=K=V），不设掩码。
- Decoder特有Mask：因为有Masked Self-Attn遮挡未来词，所以只能按序自回归生成。
- Decoder特征融合：通过Cross-Attention（Q来自Decoder，K与V来自Encoder）获取源句信息。
---

# Transformer的整体结构是怎样的？Encoder和Decoder分别做什么？

## 整体架构

```
                    输入序列                    输出序列(已生成)
                       │                            │
                       ▼                            ▼
              ┌────────────────┐          ┌────────────────┐
              │   Embedding    │          │   Embedding    │
              │   + 位置编码    │          │   + 位置编码    │
              └───────┬────────┘          └───────┬────────┘
                      │                           │
                      ▼                           ▼
              ┌──────────────────┐      ┌──────────────────┐
              │     Encoder      │      │     Decoder      │
              │  ┌────────────┐  │      │  ┌────────────┐  │
              │  │ Self-Attn  │  │      │  │Masked       │  │
              │  │ (看全句)    │  │      │  │Self-Attn   │  │
              │  └──────┬─────┘  │      │  │(只看前面)   │  │
              │         ▼        │      │  └──────┬─────┘  │
              │  ┌────────────┐  │      │         ▼        │
              │  │ Feed-Forward│  │      │  ┌────────────┐  │
              │  │ +残差+LN   │  │      │  │Cross-Attn  │  │
              │  └────────────┘  │      │  │(看Encoder) │  │
              │  × N层(6层)     │      │  └──────┬─────┘  │
              └────────┬─────────┘      │         ▼        │
                       │                │  ┌────────────┐  │
                       └───────────────→│  │Feed-Forward│  │
                                        │  │ +残差+LN   │  │
                                        │  └──────┬─────┘  │
                                        │  × N层(6层)     │
                                        └────────┬─────────┘
                                                 ▼
                                        ┌────────────────┐
                                        │  Linear+Softmax│
                                        │  →输出概率分布   │
                                        └────────────────┘
```

## Encoder详解

**职责**：读完整输入序列，每个词融合全句上下文信息

```python
class EncoderLayer(nn.Module):
    def __init__(self, d_model=512, nhead=8, d_ff=2048):
        super().__init__()
        self.self_attn = MultiHeadAttention(d_model, nhead)
        self.ffn = FeedForward(d_model, d_ff)
        self.norm1 = nn.LayerNorm(d_model)
        self.norm2 = nn.LayerNorm(d_model)
    
    def forward(self, x):
        # 1. 多头自注意力（每个词看全句）
        attn_out = self.self_attn(x, x, x)  # Q=K=V=x
        x = self.norm1(x + attn_out)  # 残差+LayerNorm
        
        # 2. 前馈网络（每个位置独立变换）
        ffn_out = self.ffn(x)
        x = self.norm2(x + ffn_out)  # 残差+LayerNorm
        
        return x
```

**关键特点**：
- 自注意力：每个词可以看到所有其他词（双向）
- 并行计算：所有位置同时处理
- N层堆叠：低层学语法，高层学语义

## Decoder详解

**职责**：逐词自回归生成，通过交叉注意力参考Encoder输出

```python
class DecoderLayer(nn.Module):
    def __init__(self, d_model=512, nhead=8, d_ff=2048):
        super().__init__()
        self.masked_self_attn = MultiHeadAttention(d_model, nhead)
        self.cross_attn = MultiHeadAttention(d_model, nhead)
        self.ffn = FeedForward(d_model, d_ff)
        self.norm1 = nn.LayerNorm(d_model)
        self.norm2 = nn.LayerNorm(d_model)
        self.norm3 = nn.LayerNorm(d_model)
    
    def forward(self, x, encoder_output):
        # 1. Masked自注意力（只看当前位置及之前）
        attn_out = self.masked_self_attn(x, x, x, mask=causal_mask)
        x = self.norm1(x + attn_out)
        
        # 2. 交叉注意力（Q来自Decoder，K=V来自Encoder）
        cross_out = self.cross_attn(
            query=x,           # Q: Decoder当前状态
            key=encoder_output,  # K: Encoder输出
            value=encoder_output  # V: Encoder输出
        )
        x = self.norm2(x + cross_out)
        
        # 3. 前馈网络
        ffn_out = self.ffn(x)
        x = self.norm3(x + ffn_out)
        
        return x
```

**关键特点**：
- Masked自注意力：防止看到未来的词（自回归）
- 交叉注意力：Decoder的Query去查Encoder的Key和Value
- 逐词生成：每次生成一个token，然后作为下一步输入

## Encoder vs Decoder对比

| 维度 | Encoder | Decoder |
|------|---------|---------|
| **注意力** | 双向(看全句) | 单向(只看前面) + 交叉(看Encoder) |
| **并行性** | 全并行 | 训练时并行(teacher forcing)，推理时逐词 |
| **输出** | 上下文表示 | 生成概率分布 |
| **层数** | N层(原论文6层) | N层(原论文6层) |
| **角色** | 理解输入 | 生成输出 |

## 架构变体

```
┌──────────────┬──────────────────┬─────────────────┐
│ Encoder-only │ Encoder-Decoder  │ Decoder-only    │
├──────────────┼──────────────────┼─────────────────┤
│ BERT         │ T5, BART         │ GPT, LLaMA, Qwen│
│ 理解任务     │ 翻译/摘要        │ 生成任务         │
│ 双向注意力   │ 交叉注意力       │ 单向注意力       │
│ 适合分类/NER │ 适合seq2seq      │ 适合对话/创作    │
└──────────────┴──────────────────┴─────────────────┘

当前主流大模型(LLaMA/Qwen/GPT)都是Decoder-only架构
```

## 面试加分点

1. **三层结构**：Encoder=自注意力+FFN+残差，Decoder多一层交叉注意力
2. **Mask的作用**：Decoder的causal mask防止"偷看"未来词
3. **为什么Decoder-only成为主流**：统一架构、scaling简单、零样本能力强
4. **训练vs推理**：训练时teacher forcing可并行，推理时逐词自回归

## 记忆要点

- Transformer双核：Encoder负责双向看全句提取特征，Decoder负责单向看前文生成文本。
- Encoder结构：核心是全局Self-Attention（Q=K=V），不设掩码。
- Decoder特有Mask：因为有Masked Self-Attn遮挡未来词，所以只能按序自回归生成。
- Decoder特征融合：通过Cross-Attention（Q来自Decoder，K与V来自Encoder）获取源句信息。


## 苏格拉底式面试追问

> 这组追问模拟面试官层层逼问，每一问先回答"为什么"，再回答"怎么做"，最后回答"如何证明"。

### 第一层：目标与动机

**Q：Transformer 抛弃 RNN 用纯 Attention，动机是"并行"还是"长距离依赖"？哪个是决定性的？**

两者都是动机，但"并行训练"是决定性的。RNN 的长距离依赖问题已经被 LSTM 的门控机制部分缓解，真正限制 RNN 的是无法并行训练——序列长度 N 时 RNN 要做 N 步串行计算，GPU 利用率极低。Transformer 的 Self-Attention 是 N² 的矩阵运算，可以完全并行，训练效率提升 10-100 倍。没有并行训练，就没有"用更多数据训更大模型"的可能性，也就没有 LLM 的scaling law。并行是 scaling 的前提，决定性。

### 第二层：证据与定位

**Q：你的 Transformer 模型训练 loss 在某一步突然 spike，怎么定位是数据问题还是梯度爆炸？**

看三组指标：1) 数据——该 step 的 batch 是否有异常样本（超长序列、特殊字符、OOD 内容）；2) 梯度——梯度范数（grad norm）是否在该 step 飙升（> 10x 正常值是梯度爆炸）；3) loss 曲线——spike 后是快速恢复还是持续高位。如果是梯度爆炸，加 gradient clipping（max_norm=1.0）通常能缓解；如果是数据，该 batch 的样本需要过滤。具体看该 step 的 input data 和 grad norm 时序图。

### 第三层：根因深挖

**Q：Transformer 的注意力矩阵是 N² 的，长序列时显存爆炸，根因是计算量还是存储？**

主要是存储。N=8192 时注意力矩阵是 8192×8192×num_heads×batch_size×float16 字节，单层就要几 GB，多层累加到几十 GB。计算量虽然也是 N² 但 GPU 算力够，存储是瓶颈。根因是"显式 materialize 整个注意力矩阵"。解法：Flash Attention 不显式存储完整矩阵，用 tiling 在 SRAM 里分块计算，显存从 O(N²) 降到 O(N)，同时计算也更高效（减少 HBM 读写）。

**Q：那为什么不直接限制序列长度（如 2048），而要搞 Flash Attention 和长上下文优化？**

因为很多任务需要长上下文。RAG 要塞检索到的多个 chunk，代码理解要看整个仓库，Agent 要记多轮对话历史，2048 不够用。限制序列长度是"削足适履"——为了工程方便牺牲任务能力。Flash Attention、Ring Attention、稀疏注意力等技术是在"不牺牲序列长度的前提下优化存储和计算"，让模型能处理 32K、128K 甚至 1M token。长上下文是能力扩展，限制长度是能力天花板。

### 第四层：方案权衡

**Q：Encoder-Decoder、Decoder-Only、Encoder-Only 三种架构，为什么 LLM 主流用 Decoder-Only？**

三个原因：1) 训练效率——Decoder-Only 用 causal mask 做下一个 token 预测，每个位置都能做监督（teacher forcing），训练信号最密集；Encoder-Decoder 只有 decoder 部分有生成损失，encoder 部分靠 masked LM 信号较弱；2) Scaling 友好——Decoder-Only 在 scaling up 时能力提升最稳定（GPT 系列验证）；3) 通用性——Decoder-Only 用同一套架构做理解和生成（GPT-4 既能 chat 也能推理），Encoder-Only（BERT）只适合理解任务。经验上 Decoder-Only 在同等参数量下能力更强。

**Q：为什么不针对不同任务用不同架构（理解任务用 Encoder-Only，生成任务用 Decoder-Only），而要统一用 Decoder-Only？**

统一架构的收益是"工程简化 + 模型复用"。维护多套架构意味着多套训练 pipeline、多套推理优化、多套部署。统一 Decoder-Only 后，所有任务用同一个模型，通过 prompt 适配不同任务。代价是某些理解任务（如分类）Decoder-Only 的效率低于 Encoder-Only（要逐 token 生成而不是一次 forward）。但随着模型能力提升，Decoder-Only 在理解任务上也能达到甚至超越 Encoder-Only，统一架构的收益超过了专业化架构的边际优势。

### 第五层：验证与沉淀

**Q：怎么验证 Transformer 实现的正确性，而不是"能跑就行"？**

三层验证：1) 单元测试——Self-Attention 的输出形状、LayerNorm 的统计特性、位置编码的正交性，每个模块独立测；2) 梯度检查——对随机输入做数值梯度（有限差分）和反向传播梯度对比，误差 < 1e-5 确认反向传播正确；3) 收敛性验证——在小型数据集（如 tiny-shakespeare）上训练，loss 应该稳定下降到 < 1.5，生成样本应该有语法结构。三层都通过才能确认实现正确，能跑通不等于正确（可能梯度没流过某层但 loss 仍下降）。

## 结构化回答

**30 秒电梯演讲：** Transformer是纯注意力机制的编码器-解码器架构，抛弃了RNN——Encoder像阅读理解。

**展开框架：**
1. **Encoder** — Encoder读完整输入，每个词融合全句上下文
2. **Decoder** — Decoder逐词自回归生成，多一层交叉注意力
3. **每层结构** — 自注意力+前馈+残差+LayerNorm

**收尾：** 您想深入聊：为什么Encoder可以并行而Decoder不能？


## 视频脚本

> 预计时长：3 分钟 | 由浅入深


| 时间 | 画面/字幕 | 口播台词 | 讲解要点 |
|------|----------|----------|----------|
| 0:00 | 标题卡：Transformer的整体结构是怎样的？… | "Encoder像阅读理解——通读全文做笔记。Decoder像写作文——看着笔记一个字一个字…" | 开场钩子 |
| 0:20 | 核心概念图 | "Transformer是纯注意力机制的编码器-解码器架构，抛弃了RNN" | 核心定义 |
| 0:55 | Encoder示意图 | "Encoder——Encoder读完整输入，每个词融合全句上下文" | 要点拆解1 |
| 1:30 | 对比/实战案例图 | "对比一下常见误区和工程实践，看真实场景里怎么取舍。" | 实战与对比 |
