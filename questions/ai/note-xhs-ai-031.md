---
id: note-xhs-ai-031
difficulty: L3
category: ai
subcategory: inference-optimization
tags:
- AI-Infra
- KVCache
- 可观测性
- 监控
- Prometheus
- 面经
feynman:
  essence: "KV Cache可观测体系是推理服务的健康仪表盘——从显存利用率到业务SLA，四层监控金字塔确保问题无处遁形"
  analogy: "像汽车仪表盘：资源层=油量表（显存），性能层=发动机转速（命中率/重算率），业务层=时速表（P99延迟），异常层=故障灯（OOM/evict告警）。只盯油表（显存利用率）就像只看油表开车——发动机过热都不知道"
  key_points:
  - 四层监控金字塔：资源层→性能层→业务层→异常层
  - KV Cache利用率<15%触发compaction
  - Prefix cache命中率<50%检查prompt标准化
  - P99 TPOT/TTFT vs SLO是业务层核心指标
  - eBPF零开销采样是加分方案
first_principle:
  essence: "推理服务的可观测性遵循Telemetry三支柱（Metrics+Logging+Tracing），但KV Cache引入了传统微服务没有的特殊维度"
  derivation: "传统服务监控关注CPU/内存/QPS/延迟。KV Cache监控需要额外关注：1) Cache的命中率（影响延迟）；2) OOM重计算率（影响正确性）；3) Eviction频率（影响质量）；4) Block table miss率（offloading场景）。这些指标直接反映推理服务的健康度和成本效率"
  conclusion: "完整的KV Cache可观测体系应该能回答：现在的显存用在哪了？命中率够不够？延迟达不达标？什么时候会OOM？"
follow_up:
- Prometheus+Grafana的具体dashboard怎么配置？
- eBPF采样相比传统metric采集有什么优势？
- Block table miss率在什么场景下是关键指标？
- 如何设置自动告警阈值？OOM前提前多久预警？
memory_points:
- 四层金字塔：资源→性能→业务→异常
- KV利用率15%触发compaction，OOM重算>0%即故障
- Prefix cache命中率<50%查prompt标准化
- P99 TPOT/TTFT vs SLO + eBPF零开销采样
---

# 【AI Infra推理优化】如何构建KV Cache可观测体系？关键指标有哪些？

> 来源：小红书「ai infra面试：kv cache夺命追问破局指南下」

## 一、四层监控金字塔

```
                    ┌─────────────┐
                    │  异常层      │  ← Block table miss率
                    │  (告警)      │     Evict触发频次
                    ├─────────────┤
                    │  业务层      │  ← P99 TPOT/TTFT
                    │  (SLA)       │     首token延迟分位数
                    ├─────────────┤
                    │  性能层      │  ← Prefix cache命中率
                    │  (效率)      │     OOM重计算率
                    ├─────────────┤
                    │  资源层      │  ← KV Cache利用率
                    │  (容量)      │     显存占用率
                    └─────────────┘
```

## 二、各层指标详解

### 资源层（容量监控）

| 指标 | 计算方式 | 告警阈值 | 含义 |
|------|---------|---------|------|
| KV Cache利用率 | 已用block/总block | <15%触发compaction | 过低=浪费，过高=OOM风险 |
| 显存占用率 | 已用GPU显存/总量 | >90%告警 | 包含模型权重+KV+激活值 |
| Block碎片率 | 碎片block/总block | >20%触发整理 | PagedAttention场景特有 |

### 性能层（效率监控）

```
关键公式:
  Prefix Cache命中率 = 命中prefix的请求数 / 总请求数
  → <50%说明prompt未标准化，相同system prompt重复计算

  OOM重计算率 = 因OOM丢弃KV后重算的token数 / 总token数
  → >0%即为故障，意味着有请求因显存不足被中断后重新计算

  Batch填充率 = 实际batch大小 / 最大batch大小
  → <60%说明调度器未充分利用GPU并行能力
```

### 业务层（SLA监控）

```
┌─────────────────────────────────────────────┐
│         延迟分位数监控（核心SLA）              │
├──────────┬────────┬────────┬────────┬───────┤
│ 指标     │  P50   │  P95   │  P99   │ SLO   │
├──────────┼────────┼────────┼────────┼───────┤
│ TTFT(ms) │  120   │  300   │  500   │ <500  │
│ TPOT(ms) │   25   │   45   │   80   │ <100  │
│ E2E(s)   │   2.5  │   6.0  │  10.0  │ <15   │
└──────────┴────────┴────────┴────────┴───────┘

TTFT = Time To First Token（首token延迟，衡量prefill效率）
TPOT = Time Per Output Token（每token延迟，衡量decode效率）
```

### 异常层（告警监控）

| 指标 | 触发条件 | 紧急程度 | 处置建议 |
|------|---------|---------|---------|
| Block table miss率 | >5%（offloading场景） | 高 | 增加预取步数 |
| Evict触发频次 | >10次/分钟 | 高 | 降低并发或扩容 |
| OOM事件 | >0 | 紧急 | 降gpu_memory_utilization |
| 请求超时率 | >1% | 中 | 检查batch调度策略 |

## 三、Grafana Dashboard配置示例

```yaml
# prometheus alerting rules
groups:
- name: kv_cache_alerts
  rules:
  - alert: KVCacheUtilizationLow
    expr: kv_cache_utilization < 0.15
    for: 5m
    annotations:
      summary: "KV Cache利用率过低，触发compaction"
      
  - alert: OOMRecomputationDetected
    expr: rate(oom_recompute_total[1m]) > 0
    for: 1m
    annotations:
      summary: "检测到OOM重计算，立即排查"
      
  - alert: PrefixCacheHitRateLow
    expr: prefix_cache_hit_rate < 0.50
    for: 10m
    annotations:
      summary: "Prefix cache命中率低，检查prompt标准化"
      
  - alert: P99TPOTSLOBreach
    expr: histogram_quantile(0.99, tpot_seconds_bucket) > 0.1
    for: 5m
    annotations:
      summary: "P99 TPOT超过100ms SLO"
```

## 四、eBPF零开销采样方案

```
传统方案 vs eBPF方案:

传统: 应用代码内嵌metric采集 → 每次请求增加~50μs开销
eBPF: 内核态BPF程序挂载 → <1μs开销，对推理延迟零影响

eBPF挂载点:
  → GPU驱动syscall tracepoint（监控CUDA API调用）
  → 网络syscall（监控请求/响应延迟）
  → 内存映射事件（监控KV Cache页面换入换出）
```

## 五、面试加分点

1. **端到端视角**：不只监控GPU侧指标，还要从用户视角监控端到端延迟（请求发出到完整响应），区分网络延迟、排队延迟、计算延迟
2. **成本可观测**：引入"每千token成本"指标（GPU小时费用/实际吞吐量），量化推理服务的经济效益
3. **容量规划**：基于历史KV Cache利用率趋势做容量预测——当利用率持续>80%时提前扩容，而不是等OOM
4. **A/B测试可观测**：不同模型版本/量化策略上线时，需要对比监控指标变化，不能只看单点指标
5. **Prometheus+Grafana模板**：提及具体dashboard面板设计——KV Cache热力图（哪些block被频繁访问）、时间序列趋势图、实时告警面板

## 结构化回答

**30 秒电梯演讲：** KV Cache可观测体系是推理服务的健康仪表盘——从显存利用率到业务SLA，四层监控金字塔确保问题无处遁形——像汽车仪表盘：资源层=油量表（显存）。

**展开框架：**
1. **四层监控金字塔** — 资源层→性能层→业务层→异常层
2. **KV Cache** — KV Cache利用率<15%触发compaction
3. **Prefix** — Prefix cache命中率<50%检查prompt标准化

**收尾：** 您想深入聊：Prometheus+Grafana的具体dashboard怎么配置？


## 视频脚本

> 预计时长：4 分钟 | 由浅入深


| 时间 | 画面/字幕 | 口播台词 | 讲解要点 |
|------|----------|----------|----------|
| 0:00 | 标题卡：如何构建KV Cache可观测体系？关键指标有哪… | "像汽车仪表盘：资源层=油量表（显存），性能层=发动机转速（命中率/重算率），业务层=时速表…" | 开场钩子 |
| 0:20 | 核心概念图 | "KV Cache可观测体系是推理服务的健康仪表盘——从显存利用率到业务SLA，四层监控金字塔确保问题无处遁形" | 核心定义 |
| 0:50 | 四层监控金字塔示意图 | "四层监控金字塔——资源层→性能层→业务层→异常层" | 要点拆解1 |
| 1:30 | 对比/实战案例图 | "对比一下常见误区和工程实践，看真实场景里怎么取舍。" | 实战与对比 |
| 2:20 | 总结卡 | "记住核心要点。下期我们追问：Prometheus+Grafana的具体dashboard？" | 收尾与钩子 |
