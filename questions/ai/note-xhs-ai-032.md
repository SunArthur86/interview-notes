---
id: note-xhs-ai-032
difficulty: L3
category: ai
subcategory: inference-optimization
tags:
- AI-Infra
- KVCache
- OOM
- vLLM
- 故障处置
- 面经
feynman:
  essence: "OOM紧急处置是推理服务线上事故的标准止血流程——从最小影响的参数调整开始，逐步加码，每步验证后再进下一步"
  analogy: "像急诊分诊：先量体温吃退烧药（降利用率参数），不行再打点滴（降并发），再不行上呼吸机（开量化），最后才考虑手术（权重量化）。不能一上来就全部手段同时上，否则分不清哪个起了作用"
  key_points:
  - 五步止血法：降utilization→降并发→开量化→开prefix cache→权重量化
  - 每步验证后再进下一步，避免叠加变更导致问题难定位
  - gpu_memory_utilization 0.95→0.85 留安全余量
  - FP8→INT8→FP16回退是量化降级的优先顺序
  - AWQ/GPTQ是最后的核武器——影响模型质量
first_principle:
  essence: "GPU OOM的本质是 物理显存 < (模型权重 + KV Cache + 激活值 + 临时buffer)。止血就是压缩这四个分量"
  derivation: "vLLM启动时预留 gpu_memory_utilization × 总显存 给KV Cache，其余给模型权重和activation。当实际运行时KV Cache超出预留空间，触发OOM。止血策略按影响范围从小到大：调参数(影响最小)→降并发(影响吞吐)→量化KV(影响精度)→量化权重(影响最大)"
  conclusion: "线上事故处置的第一原则是可追溯性——每次只改一个变量，确认效果后再改下一个"
follow_up:
- gpu_memory_utilization设多少最安全？默认0.9合适吗？
- max_num_seqs降到多少合适？有没有动态调整的方案？
- OOM后正在处理的请求怎么处理？是中断还是排队等待？
- 怎么预防OOM？有没有提前预警的方案？
memory_points:
- 五步：降util→降并发→开量化→开prefix cache→权重量化
- 每步验证后再进下一步，不叠加变更
- gpu_memory_utilization 0.95→0.85
- 量化降级顺序：FP8→INT8→FP16
---

# 【AI Infra推理优化】OOM紧急处置优先级是什么？

> 来源：小红书「ai infra面试：kv cache夺命追问破局指南下」

## 一、OOM根因分析

```
GPU显存分配 (vLLM启动时):
┌─────────────────────────────────────────┐
│         80GB HBM 总显存                  │
├──────────────┬──────────────────────────┤
│ 模型权重      │  KV Cache空间             │
│ ~35GB(70B    │  = 80GB × utilization     │
│  FP16)       │    - 模型权重 - activation │
├──────────────┼──────────────────────────┤
│ Activation   │  临时buffer               │
│ ~2GB         │  ~1GB                    │
└──────────────┴──────────────────────────┘

当 KV Cache实际需求 > 预留空间 → OOM!

触发场景:
  1. 突发大量长上下文请求 → KV Cache暴涨
  2. batch size过大 → 并发KV块超出预算
  3. Prefix cache未命中 → 重复计算消耗额外显存
```

## 二、五步止血法

```
步骤1: 降gpu_memory_utilization     影响范围: 小
  ↓ (验证OOM是否消失)
步骤2: 减max_num_seqs降并发          影响范围: 中(吞吐下降)
  ↓
步骤3: 开KV Cache量化(FP8/INT8)      影响范围: 中(精度下降)
  ↓
步骤4: 启用prefix cache + 统一prompt  影响范围: 无(纯优化)
  ↓
步骤5: 权重量化(AWQ/GPTQ)            影响范围: 大(模型质量)
  ↓
OOM消除 ✅
```

### 步骤1：降低gpu_memory_utilization

```python
# vLLM启动参数
# 原来
python -m vllm.entrypoints.openai.api_server \
  --gpu-memory-utilization 0.95  # 几乎吃满显存

# 紧急止血
python -m vllm.entrypoints.openai.api_server \
  --gpu-memory-utilization 0.85  # 留15%安全余量

# 原理：减少KV Cache预留空间，留出buffer应对突发流量
# 代价：最大batch size略降，但通常可接受
```

### 步骤2：减少max_num_seqs

```python
# 限制最大并发序列数
python -m vllm.entrypoints.openai.api_server \
  --max-num-seqs 64    # 原来128，降到64
  --max-model-len 4096 # 限制最大上下文长度

# 原理：每个并发序列都有自己的KV Cache，降并发直接减显存
# 代价：吞吐量下降，请求排队时间增加
```

### 步骤3：开启KV Cache量化

```python
# FP8量化（H100优先）
python -m vllm.entrypoints.openai.api_server \
  --kv-cache-dtype fp8     # KV Cache用FP8存储

# INT8量化（A100）
python -m vllm.entrypoints.openai.api_server \
  --kv-cache-dtype int8 \
  --quantization fp8       # 配合权重量化

# 回退策略: 如果FP8质量差，回退到FP16
python -m vllm.entrypoints.openai.api_server \
  --kv-cache-dtype auto    # 不量化，用默认FP16
```

### 步骤4：启用Prefix Cache

```python
# 统一system prompt + 启用prefix cache
python -m vllm.entrypoints.openai.api_server \
  --enable-prefix-caching  # 自动缓存相同前缀的KV

# 最佳实践：
# 1. 所有请求使用相同的system prompt → KV Cache共享
# 2. Prompt模板标准化 → 提高缓存命中率
# 3. 避免在system prompt中放时间戳等动态内容
```

### 步骤5：模型权重量化（最后手段）

```python
# AWQ量化（激活感知权重量化）
model_path = quantize_awq(model, w_bit=4, group_size=128)

# GPTQ量化（训练后量化）
model_path = quantize_gptq(model, w_bit=4, desc_act=False)

# 效果：权重从FP16(140GB) → INT4(35GB)，释放~100GB显存
# 代价：模型精度有损，需要在业务数据上评估
```

## 三、处置决策表

| 步骤 | 操作 | 显存释放 | 质量影响 | 吞吐影响 | 恢复速度 |
|------|------|---------|---------|---------|---------|
| 1 | utilization 0.95→0.85 | ~8GB | 无 | 小 | 即时 |
| 2 | max_seqs 128→64 | ~20GB | 无 | 大 | 即时 |
| 3 | KV量化FP16→FP8 | ~50%KV | 小 | 无 | 即时 |
| 4 | prefix cache | ~20%KV | 无 | 正向 | 即时 |
| 5 | 权重W4A16 | ~60%权重 | 中 | 无 | 需重启 |

## 四、面试加分点

1. **可观测性联动**：止血前先看监控——如果KV利用率<50%但OOM了，说明不是容量问题而是内存泄漏；如果利用率>95%，就是纯粹的容量不足
2. **预防优于治疗**：设置自动扩容策略——当KV Cache利用率连续5分钟>80%时自动扩容GPU节点，而不是等OOM后再处理
3. **优雅降级**：OOM时不应直接拒绝请求，而是触发降级策略——对新请求返回503+Retry-After，对进行中的请求尝试checkpoint后迁移
4. **灰度发布**：止血后变更的参数应该通过灰度发布验证——先对10%流量应用新配置，确认稳定后再全量
5. **事故复盘**：每次OOM事故都要做post-mortem——记录触发场景、处置步骤、影响范围、改进措施，形成runbook供未来参考

## 结构化回答

**30 秒电梯演讲：** OOM紧急处置是推理服务线上事故的标准止血流程——从最小影响的参数调整开始，逐步加码，每步验证后再进下一步——像急诊分诊。

**展开框架：**
1. **五步止血法** — 降utilization→降并发→开量化→开prefix cache→权重量化
2. **每步验证后** — 每步验证后再进下一步，避免叠加变更导致问题难定位
3. **gpu** — gpu_memory_utilization 0.95→0.85 留安全余量

**收尾：** 您想深入聊：gpu_memory_utilization设多少最安全？默认0.9合适吗？


## 视频脚本

> 预计时长：4 分钟 | 由浅入深


| 时间 | 画面/字幕 | 口播台词 | 讲解要点 |
|------|----------|----------|----------|
| 0:00 | 标题卡：OOM紧急处置优先级是什么？ | "像急诊分诊：先量体温吃退烧药（降利用率参数），不行再打点滴（降并发），再不行上呼吸机（开量…" | 开场钩子 |
| 0:20 | 核心概念图 | "OOM紧急处置是推理服务线上事故的标准止血流程——从最小影响的参数调整开始，逐步加码，每步验证后再进下一步" | 核心定义 |
| 0:50 | 五步止血法示意图 | "五步止血法——降utilization→降并发→开量化→开prefix cache→权重量化" | 要点拆解1 |
| 1:30 | 对比/实战案例图 | "对比一下常见误区和工程实践，看真实场景里怎么取舍。" | 实战与对比 |
| 2:20 | 总结卡 | "记住核心要点。下期我们追问：gpu_memory_utilization设多少最安全？默？" | 收尾与钩子 |

## 苏格拉底式面试追问

| 追问层级 | 面试官可能这样问 | 高分回答方向 |
|----------|------------------|--------------|
| 目标追问 | KV Cache OOM紧急处置的第一目标是什么？ | 第一目标是快速恢复服务（保可用），其次才是定位根因——先止血再治病，避免长时间不可用 |
| 证据追问 | 处置优先级怎么排？依据是什么？ | 按'见效快+损失小'排序：降QPS/限流→降batch→降最大长度→开关式降级→重启释放→最后才动模型/配置变更 |
| 边界追问 | 什么处置是可逆无损的，什么是不可逆有损的？ | 限流/降batch/降长度可逆无损；重启丢KV Cache短期延迟增加；切小模型有质量损失；这些影响要心里有数 |
| 反例追问 | OOM了直接重启对吗？ | 不对。重启丢现场无法定位根因，下次还会复现；应先dump现场（日志、监控）再重启，并优先用限流等无损手段 |
| 风险追问 | 紧急处置有什么次生风险？ | 限流导致请求积压、降长度导致用户对话截断、切模型质量下降、重启短时不可用——都要权衡并提前告知业务方 |
| 验证追问 | 处置后怎么验证真的恢复了？ | 监控显存曲线回落、QPS恢复、P99延迟正常、无新增OOM告警、用户投诉无异常 |
| 沉淀追问 | OOM应急预案怎么沉淀？ | 规范：分级预案（限流→降级→重启）、值班SOP、复盘文档、容量水位告警提前预警 |

### 现场对话示例
**面试官**：KV Cache OOM紧急处置的优先级是什么？
**候选人**：先保可用再定位：限流降QPS→降batch→降最大长度→开关式降级→重启释放→最后才动模型配置，按见效快损失小排序。
**面试官**：直接重启对吗？
**候选人**：不对，重启丢现场下次还会复发；要先保留日志和监控现场再重启，优先用限流等无损手段止血。
**面试官**：处置有什么次生风险？
**候选人**：限流积压、降长度截断对话、切模型质量下降、重启短时不可用，要权衡并提前告知业务方，配合监控验证恢复。
