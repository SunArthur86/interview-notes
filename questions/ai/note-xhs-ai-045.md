---
id: note-xhs-ai-045
difficulty: L4
category: ai
subcategory: system-design
tags:
- AIGC
- 异步任务
- 快手
- MQ
- 降级策略
- 幂等
- 面经
feynman:
  essence: "夜间数万创作者批量生成是典型的潮汐流量场景——需要MQ削峰+任务分片+多级降级+幂等保证，不能让突发流量打爆推理集群"
  analogy: "像双11的物流系统：白天订单少时从容处理，半夜突然涌入10万个包裹（潮汐流量）。方案：快递柜暂存(MQ削峰)→分拣线分批处理(任务分片)→分拣线坏了有备选方案(降级)→同一个包裹不重复配送(幂等)"
  key_points:
  - MQ削峰：Kafka/RocketMQ缓冲突发请求，消费者按GPU容量消费
  - 任务分片：按优先级/创作者等级分队列，优质创作者优先
  - 幂等保证：任务ID去重，防止重复生成扣费
  - 多级降级：大模型→小模型→模板→默认内容→拒绝
  - 防雪崩：限流+熔断+自动扩缩容
first_principle:
  essence: "批量AIGC的核心矛盾是：请求到达速率远超GPU处理速率。解法是用队列解耦到达和处理，让消费者按自己的节奏消费"
  derivation: "夜间数万创作者同时点击'一键生成'，瞬间QPS可能达到数万。但GPU推理的QPS有限（单卡A100约10-50 QPS取决于模型大小）。如果同步处理，请求堆积→超时→重试→更多请求→雪崩。引入MQ后，请求先入队（Kafka可承受百万级入队QPS），消费者按GPU容量匀速消费，实现了到达速率和处理速率的解耦"
  conclusion: "批量AIGC不是技术问题而是系统设计问题——解耦+缓冲+降级+幂等四个要素缺一不可"
follow_up:
- MQ选型：Kafka vs RocketMQ vs RabbitMQ？
- 任务优先级怎么实现？优质创作者VIP通道？
- GPU自动扩缩容怎么触发？冷启动延迟怎么处理？
- 幂等key怎么设计？任务ID还是内容hash？
memory_points:
- 四要素：MQ削峰+任务分片+多级降级+幂等
- MQ解耦到达和处理，消费者按GPU容量消费
- 降级链：大模型→小模型→模板→默认→拒绝
- 幂等：任务ID去重防重复生成扣费
---

# 【快手AI大模型】异步批量AIGC任务架构怎么设计？多级降级策略？

> 来源：小红书「快手AI大模型开发面经（强度拉满）」（OCR）

## 一、整体架构

```
┌──────────────────────────────────────────────────────────┐
│              批量AIGC异步高并发系统架构                    │
│                                                          │
│  创作者 ──→ API网关 ──→ MQ(Kafka) ──→ 消费者 ──→ GPU集群  │
│   (万人)     限流        削峰缓冲      按容量消费   批量推理 │
│                              │                          │
│                              ▼                          │
│                         任务分片队列                      │
│                    ┌────────┼────────┐                  │
│                    ▼        ▼        ▼                  │
│                 VIP队列   普通队列  低优先级              │
│                 (P0)      (P1)      (P2)                │
│                                                          │
│  降级链: LLM70B → LLM7B → 模板生成 → 默认内容 → 拒绝     │
│                                                          │
│  幂等: Redis(task_id) → 去重                             │
│  监控: 堆积量/GPU利用率/生成延迟/失败率                   │
└──────────────────────────────────────────────────────────┘
```

## 二、核心组件详解

### MQ削峰 + 任务分片

```python
from kafka import KafkaProducer, KafkaConsumer
import json, hashlib

class AIGCTaskQueue:
    """批量AIGC任务队列——MQ削峰+优先级分片"""
    
    def __init__(self):
        self.producer = KafkaProducer(
            bootstrap_servers=['kafka:9092'],
            value_serializer=lambda v: json.dumps(v).encode()
        )
    
    def submit_task(self, creator_id, task_type, params):
        """提交AIGC任务"""
        # 幂等检查——防止重复提交
        task_id = self.generate_task_id(creator_id, task_type, params)
        if self.redis.exists(f"task:{task_id}"):
            return {"status": "duplicate", "task_id": task_id}
        
        # 优先级判定
        priority = self.get_priority(creator_id)
        topic = f"aigc-{task_type}-p{priority}"
        
        # 发送到对应优先级的MQ topic
        task = {
            "task_id": task_id,
            "creator_id": creator_id,
            "type": task_type,  # script/title/topic
            "params": params,
            "timestamp": now(),
            "priority": priority,
            "retry_count": 0,
        }
        
        self.producer.send(topic, task)
        self.redis.setex(f"task:{task_id}", 3600, "queued")
        
        return {"status": "queued", "task_id": task_id, 
                "estimated_wait": self.estimate_wait(priority)}
    
    def generate_task_id(self, creator_id, task_type, params):
        """生成幂等task_id"""
        content = f"{creator_id}:{task_type}:{json.dumps(params, sort_keys=True)}"
        return hashlib.md5(content.encode()).hexdigest()
    
    def get_priority(self, creator_id):
        """创作者优先级——优质创作者VIP"""
        level = self.redis.hget(f"creator:{creator_id}", "level")
        if level == "diamond": return 0  # 最高优先级
        elif level == "gold": return 1
        else: return 2
```

### 消费者——批量推理

```python
class AIGCConsumer:
    """MQ消费者——按GPU容量消费+批量推理"""
    
    def __init__(self, gpu_pool):
        self.gpu_pool = gpu_pool  # GPU推理集群
        self.max_batch = 8  # vLLM批量大小
    
    def consume(self):
        """按优先级消费任务"""
        consumer = KafkaConsumer(
            'aigc-script-p0',  # 优先消费VIP
            'aigc-script-p1',
            'aigc-script-p2',
            bootstrap_servers=['kafka:9092'],
            group_id='aigc-worker',
            value_deserializer=lambda v: json.loads(v.decode())
        )
        
        batch = []
        for msg in consumer:
            task = msg.value
            batch.append(task)
            
            # 攒够一个batch或等待超时
            if len(batch) >= self.max_batch:
                self.process_batch(batch)
                batch = []
    
    def process_batch(self, batch):
        """批量推理——利用vLLM的continuous batching"""
        try:
            # vLLM批量推理（高吞吐）
            results = self.gpu_pool.batch_generate(
                prompts=[t['params']['prompt'] for t in batch],
                max_tokens=512,
                temperature=0.8
            )
            
            for task, result in zip(batch, results):
                self.save_result(task, result)
                self.notify_creator(task, result)
                
        except GPUOverloadError:
            # GPU过载 → 触发降级
            self.degrade_batch(batch)
        except Exception as e:
            # 其他错误 → 重试或降级
            self.handle_failure(batch, e)
```

### 多级降级策略

```python
class DegradationChain:
    """大模型接口超时/卡顿的多级降级"""
    
    LEVELS = [
        # Level 0: 70B大模型（质量最高，成本最高）
        {"model": "quickstar-70b", "timeout": 30, "fallback": 1},
        # Level 1: 7B小模型（质量中等，速度快）
        {"model": "quickstar-7b", "timeout": 10, "fallback": 2},
        # Level 2: 模板生成（质量低，但即时）
        {"model": "template", "timeout": 2, "fallback": 3},
        # Level 3: 默认内容（保底）
        {"model": "default", "timeout": 0, "fallback": None},
    ]
    
    def generate(self, prompt, creator_id):
        """逐级降级生成"""
        for i, level in enumerate(self.LEVELS):
            try:
                result = self.try_generate(level, prompt)
                if result:
                    # 记录降级情况
                    if i > 0:
                        self.log_degradation(creator_id, 
                            from_level=i-1, to_level=i)
                    return result
            except TimeoutError:
                continue  # 自动降级到下一级
            except Exception:
                continue
        
        # 所有降级方案都失败
        return {"error": "系统繁忙，请稍后重试", "status": "rejected"}
    
    def try_generate(self, level, prompt):
        """尝试某一降级级别的生成"""
        if level["model"] == "template":
            return self.template_generate(prompt)
        elif level["model"] == "default":
            return self.get_default_content(prompt)
        else:
            return self.llm_generate(
                model=level["model"],
                prompt=prompt,
                timeout=level["timeout"]
            )
```

## 三、防堆积、防雪崩、保证幂等

```
┌────────────────────────────────────────────────┐
│  防堆积:                                        │
│  • MQ积压超过阈值 → 暂停接收新任务（限流）      │
│  • 动态调整消费速率 → 根据GPU利用率自动伸缩     │
│  • 超时任务自动丢弃 → 防止无限重试              │
│                                                │
│  防雪崩:                                        │
│  • 熔断器: 失败率>50% → 暂停消费5分钟           │
│  • 限流: 单创作者QPS限制（防止恶意刷量）        │
│  • 背压: GPU过载 → 通知MQ降低消费速率           │
│                                                │
│  保证幂等:                                      │
│  • 任务ID = hash(creator_id + type + params)   │
│  • Redis SETNX 去重 → 同一任务只执行一次        │
│  • 结果缓存 → 重试时直接返回缓存结果            │
│  • 数据库唯一索引 → 防止重复写入                 │
└────────────────────────────────────────────────┘
```

## 四、方案对比

| 维度 | 同步处理 | 异步MQ | 异步MQ+降级 |
|------|---------|--------|------------|
| 峰值QPS | 低(受GPU限制) | 高(MQ缓冲) | 高+稳定 |
| 用户体验 | 实时但易超时 | 排队等待 | 排队+保底 |
| 系统稳定性 | 易雪崩 | 较稳定 | 极稳定 |
| 成本 | 高(需峰值GPU) | 低(按均值GPU) | 最低 |
| 复杂度 | 低 | 中 | 高 |

## 五、面试加分点

1. **潮汐流量特征**：短视频创作者集中在夜间20:00-24:00活跃——白天GPU利用率<20%，夜间>90%。通过MQ削峰让GPU集群按日均值而非峰值部署，节省60%+的GPU成本
2. **continuous batching**：vLLM的continuous batching（动态批处理）可以在生成过程中动态插入新请求，GPU利用率比静态batching高2-3x——这是批量AIGC高吞吐的关键技术
3. **创作者等级公平调度**：不是简单的FIFO——钻石创作者的任务优先消费（P0队列），普通创作者排P1/P2。这既是业务策略（VIP体验）也是系统保护（防止低价值请求挤占资源）
4. **降级的业务影响**：从70B降到7B模型，生成质量下降可能导致创作者不满——需要通知创作者"系统繁忙，使用快速模式生成"，而不是默默降级。透明度比质量更重要
5. **监控指标**：批量AIGC需要监控的关键指标：MQ积压深度、端到端生成延迟（排队+推理）、降级触发率、GPU利用率、每千次生成成本——这些指标直接反映系统的健康度和经济效益

## 结构化回答

**30 秒电梯演讲：** 夜间数万创作者批量生成是典型的潮汐流量场景——需要MQ削峰+任务分片+多级降级+幂等保证，不能让突发流量打爆推理集群——像双11的物流系统。

**展开框架：**
1. **MQ削峰** — Kafka/RocketMQ缓冲突发请求，消费者按GPU容量消费
2. **任务分片** — 按优先级/创作者等级分队列，优质创作者优先
3. **幂等保证** — 任务ID去重，防止重复生成扣费

**收尾：** 您想深入聊：MQ选型：Kafka vs RocketMQ vs RabbitMQ？


## 视频脚本

> 预计时长：5 分钟 | 由浅入深


| 时间 | 画面/字幕 | 口播台词 | 讲解要点 |
|------|----------|----------|----------|
| 0:00 | 标题卡：异步批量AIGC任务架构怎么设计？多级降级策略？ | "像双11的物流系统：白天订单少时从容处理，半夜突然涌入10万个包裹（潮汐流量）。方案：快递…" | 开场钩子 |
| 0:20 | 核心概念图 | "夜间数万创作者批量生成是典型的潮汐流量场景——需要MQ削峰+任务分片+多级降级+幂等保证，不能让突发流量打爆推理集群" | 核心定义 |
| 0:50 | MQ削峰示意图 | "MQ削峰——Kafka/RocketMQ缓冲突发请求，消费者按GPU容量消费" | 要点拆解1 |
| 1:30 | 任务分片示意图 | "任务分片——按优先级/创作者等级分队列，优质创作者优先" | 要点拆解2 |
| 2:20 | 对比/实战案例图 | "对比一下常见误区和工程实践，看真实场景里怎么取舍。" | 实战与对比 |
| 3:10 | 总结卡 | "记住核心要点。下期我们追问：MQ选型：Kafka vs RocketMQ vs Rabb？" | 收尾与钩子 |

## 苏格拉底式面试追问

| 追问层级 | 面试官可能这样问 | 高分回答方向 |
|----------|------------------|--------------|
| 目标追问 | 异步批量AIGC任务架构的核心目标是什么？ | 解耦提交和处理，应对长耗时AIGC任务（图片/视频生成），保证高吞吐、可靠性和可降级 |
| 证据追问 | 为什么必须异步批处理？同步不行吗？ | AIGC任务耗时几十秒到分钟级，同步会占用连接、超时、阻塞用户；异步用MQ+任务队列解耦，提升吞吐和可靠性 |
| 边界追问 | 多级降级策略具体怎么分？ | L1降并发/限流→L2降质量（小模型/低分辨率）→L3降功能（返回占位/默认结果）→L4熔断保护核心服务 |
| 反例追问 | 所有AIGC任务都异步批处理好吗？ | 不一定。简单快速的任务（小图缩放）同步更快；异步增加复杂度和延迟，要按任务耗时分级处理 |
| 风险追问 | 异步批处理的风险有哪些？ | 任务积压、状态不一致、失败重试风暴、结果丢失、用户体验差（等待焦虑） |
| 验证追问 | 怎么验证架构可靠？ | 压测吞吐和延迟、故障注入测试降级、任务成功率监控、端到端延迟监控 |
| 沉淀追问 | 异步任务架构怎么沉淀？ | 规范：MQ+任务队列+状态机、多级降级、幂等重试、进度查询和通知 |

### 现场对话示例
**面试官**：异步批量AIGC任务架构怎么设计？多级降级策略？
**候选人**：用MQ+任务队列解耦提交和处理应对长耗时任务；多级降级：限流→降质量（小模型）→降功能（默认结果）→熔断保护核心。
**面试官**：为什么必须异步？
**候选人**：AIGC任务耗时几十秒到分钟级，同步占用连接、超时、阻塞用户；异步解耦提升吞吐和可靠性。
**面试官**：降级策略怎么分？
**候选人**：L1限流→L2降质量（小模型低分辨率）→L3降功能（占位默认）→L4熔断，按故障严重程度逐级降级保核心可用。
