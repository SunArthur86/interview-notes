---
id: note-hw-006
difficulty: L5
category: ai
subcategory: Agent
tags:
- 华为
- 面经
- 系统设计
- 大模型应用
- 故障预测
feynman:
  essence: 基于大模型设计服务器自动故障预警/排查/恢复系统，本质是构建一个"会读日志、会推理、会执行"的运维Agent——感知（数据采集）→ 认知（LLM异常检测+根因分析）→ 行动（自动恢复）的全闭环。
  analogy: 像给数据中心配一个24小时不休息的"首席运维官+SRE团队"——它同时盯住所有服务器的指标（眼睛），用积累的运维知识判断哪里要出问题（大脑），还能自动执行预案（手），并且每次故障后复盘改进（学习）。
  first_principle: 传统运维是"规则驱动"（阈值告警→人工排查），扩展性差、滞后。大模型运维是"语义理解驱动"——LLM能理解日志的语义、关联跨系统信号、生成排查假设、调用工具验证。第一性原理是把运维从"模式匹配"升级为"因果推理+工具调用"。
  key_points:
  - 三层架构：感知层(采集) + 认知层(LLM推理) + 执行层(自动恢复)
  - 核心挑战：误报率控制、幻觉抑制、安全执行边界
  - RAG注入历史故障知识库，避免从零推理
  - 人在回路(Human-in-the-loop)处理高危操作
  - 必须有沙箱回滚机制，防止Agent错误执行扩大故障
first_principle:
  essence: 运维的本质是"从海量时序信号中识别异常 + 定位根因 + 执行修复"的因果推理问题
  derivation: 传统监控用固定阈值（CPU>80%告警），无法处理复杂故障（多个指标微妙变化的组合）。LLM的优势是语义理解——能读懂错误日志、关联跨服务信号、基于历史案例推理。但LLM有幻觉风险，所以必须用RAG约束（基于真实知识）+ 工具调用验证（执行只读查询确认）+ 人工审核高危操作。
  conclusion: 系统设计=LLM的认知能力 + RAG的可靠性 + 工具链的执行力 + 人在回路的安全性
follow_up:
- 如何降低LLM运维Agent的幻觉和误报？
- 系统如何处理LLM推理耗时过长与实时告警的矛盾？
- 如何评估这个系统的效果？用什么指标？
memory_points:
- 核心痛点：传统运维阈值告警滞后且排查慢，大模型旨在实现故障提前预测与自动恢复。
- 三层架构：感知层(多源信号) + 认知层(LLM依托 RAG 做根因推理) + 执行层(自动扩缩容)。
- 安全兜底：高危操作必须引入人在回路审核，仅在沙箱执行低风险可逆的预案。
- 数据闭环：故障复盘后形成案例入库，持续扩充 RAG 知识库提升未来排查准确率。
---

# 【华为面经】基于大模型设计服务器自动故障预警、排查和恢复系统

## 一、需求分析与系统目标

### 1.1 问题背景

数据中心运维的核心痛点：

```
传统运维的三大痛点：
1. 预警滞后：阈值告警只在故障发生后触发（CPU>90%才报），无法预测
2. 排查低效：故障发生后，工程师要翻海量日志、关联多系统，耗时数十分钟到数小时
3. 恢复人工依赖：扩容、重启、切流等操作都需要人手动执行，MTTR（平均恢复时间）长

期望的大模型运维系统：
- 预警：提前预测故障（"CPU持续上涨+GC变频繁，30分钟后可能OOM"）
- 排查：自动定位根因（"数据库慢查询导致连接池打满"）
- 恢复：自动执行预案（"已自动扩容并重启异常实例"）
```

### 1.2 系统设计目标

```
┌─────────────────────────────────────────────────────┐
│ 核心指标                                             │
├─────────────────────────────────────────────────────┤
│ • 预测提前量：故障发生前 ≥ 15分钟预警               │
│ • 误报率：< 5%（误报过多会让工程师忽视告警）         │
│ • 根因定位准确率：> 80%（Top-3包含真实根因）         │
│ • 自动恢复成功率：> 70%（安全可逆操作）              │
│ • MTTR降低：从30分钟 → 5分钟                        │
└─────────────────────────────────────────────────────┘
```

## 二、系统总体架构

```
┌──────────────────────────────────────────────────────────────────┐
│                      运维大模型Agent系统                          │
│                                                                  │
│  ┌────────────┐   ┌────────────────┐   ┌──────────────────────┐ │
│  │ 1.感知层   │ → │  2.认知层(LLM) │ → │  3.执行层            │ │
│  │ Perception │   │  Cognition     │   │  Action              │ │
│  ├────────────┤   ├────────────────┤   ├──────────────────────┤ │
│  │ 指标采集   │   │ 异常检测       │   │ 预案执行             │ │
│  │ 日志聚合   │   │ 根因分析(推理) │   │ 自动扩缩容           │ │
│  │ 调用链追踪 │   │ 恢复方案生成   │   │ 流量切换             │ │
│  │ 告警接入   │   │                │   │ 实例重启             │ │
│  └────────────┘   └────────────────┘   └──────────────────────┘ │
│        ↑                  ↑                      ↓               │
│        │           ┌──────┴──────┐        ┌──────┴──────┐        │
│        │           │ RAG知识库   │        │ 人在回路    │        │
│        │           │ 历史故障库  │        │ 高危审核    │        │
│        │           │ 运维SOP     │        │ 沙箱回滚    │        │
│        │           └─────────────┘        └─────────────┘        │
│        ↓                                                          │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │ 4.学习闭环：故障复盘 → 案例入库 → 知识库扩充            │   │
│  └──────────────────────────────────────────────────────────┘   │
└──────────────────────────────────────────────────────────────────┘
```

## 三、各层详细设计

### 3.1 感知层（数据采集与预处理）

```python
# 多源信号采集
class PerceptionLayer:
    def __init__(self):
        self.metrics_collector = PrometheusClient()    # 时序指标
        self.log_aggregator = ELKClient()              # 日志聚合
        self.tracer = JaegerClient()                   # 调用链
        self.alarm_hub = AlertManagerClient()          # 现有告警

    def collect_context(self, service_id, window_min=30):
        """采集某服务最近30分钟的完整上下文"""
        return {
            # 1. 时序指标（CPU/内存/QPS/延迟/错误率）
            "metrics": self.metrics_collector.query_range(
                f'service="{service_id}"',
                range=f"{window_min}m",
                step="15s",
            ),
            # 2. 错误日志（ERROR/FATAL级别，去重后）
            "error_logs": self.log_aggregator.search(
                f'service:{service_id} AND level:(ERROR OR FATAL)',
                size=100,
                sort="desc",
            ),
            # 3. 慢调用链（延迟>P99的请求）
            "slow_traces": self.tracer.find_slow(
                service=service_id,
                min_duration_ms=1000,
                limit=20,
            ),
            # 4. 拓扑信息（上下游依赖）
            "topology": self.get_service_topology(service_id),
        }
```

**预处理**：LLM上下文有限，必须做信息压缩：
- 指标：用统计摘要（均值/P99/趋势斜率）代替原始序列
- 日志：聚类去重（1000条相同错误→1条+计数）
- 调用链：只保留关键路径

### 3.2 认知层（LLM异常检测+根因分析）

#### 异常检测：预测性预警

```python
class AnomalyDetection:
    def __init__(self, llm, rag):
        self.llm = llm
        self.rag = rag  # 历史故障知识库

    def predict_failure(self, context):
        """基于当前状态预测未来故障"""
        # RAG检索相似历史模式
        similar_cases = self.rag.search(
            query=encode(context),
            filter={"outcome": "failure"},
            top_k=5,
        )

        prompt = f"""
        你是资深SRE工程师。分析以下服务状态，判断是否会在未来30分钟发生故障。

        ## 当前状态
        {format_context(context)}

        ## 历史相似案例（曾导致故障的模式）
        {format_cases(similar_cases)}

        ## 输出要求
        - risk_score: 0-100的风险评分
        - predicted_failure: 预测的故障类型（如OOM/连接池打满/磁盘满）
        - evidence: 判断依据（具体指标）
        - time_to_failure: 预计还有多少分钟
        - confidence: 置信度（high/medium/low）

        严格基于数据，不要臆测。如果没有明确证据，risk_score给低分。
        """
        return self.llm.analyze(prompt, temperature=0.1)  # 低温度减少幻觉
```

#### 根因分析：ReAct推理循环

```python
class RootCauseAnalysis:
    """ReAct模式：推理-行动-观察循环"""

    def __init__(self, llm, tools, rag):
        self.llm = llm
        self.tools = tools  # 只读诊断工具
        self.rag = rag

    def analyze(self, alarm):
        thoughts = []
        for step in range(MAX_STEPS=10):
            # LLM决定下一步行动
            action = self.llm.plan(
                alarm=alarm,
                history=thoughts,
                available_tools=self.tools.names(),
            )

            if action.type == "CONCLUDE":
                # LLM认为已找到根因，输出结论
                return self.format_root_cause(action.reasoning)

            # 执行诊断工具（只读，安全）
            observation = self.tools.execute(
                action.tool,
                action.params,  # 如 query_db(sql), get_trace(trace_id)
            )
            thoughts.append({
                "step": step,
                "thought": action.reasoning,
                "action": action.tool,
                "observation": observation,
            })

        return {"status": "max_steps_reached", "hypotheses": thoughts}
```

#### 根因分析的工具集

```python
# LLM可调用的只读诊断工具（白名单，禁止写操作）
DIAGNOSIS_TOOLS = [
    # 1. 数据库诊断
    Tool("query_slow_sql",
         "查询数据库当前慢SQL",
         params={"db": "str", "threshold_ms": "int"},
         readonly=True),

    # 2. 连接池状态
    Tool("get_connection_pool",
         "查询连接池使用情况",
         params={"service": "str"},
         readonly=True),

    # 3. 资源占用TOP
    Tool("get_top_processes",
         "查询CPU/内存占用TOP进程",
         params={"host": "str", "metric": "str"},
         readonly=True),

    # 4. 配置变更历史
    Tool("get_recent_changes",
         "查询最近配置/发布变更",
         params={"service": "str", "hours": "int"},
         readonly=True),

    # 5. 依赖服务健康
    Tool("check_dependencies",
         "检查上下游服务健康状态",
         params={"service": "str"},
         readonly=True),
]
```

#### 恢复方案生成

```python
class RecoveryPlanner:
    def __init__(self, llm, rag, runbook_registry):
        self.llm = llm
        self.rag = rag
        self.runbooks = runbook_registry  # 标准运维预案库

    def plan_recovery(self, root_cause, context):
        # RAG检索匹配的预案
        matching_runbooks = self.runbooks.search(
            root_cause.type,  # 如 "oom", "connection_pool_full"
            top_k=3,
        )

        prompt = f"""
        基于以下根因，生成恢复方案。

        ## 根因
        {root_cause.description}

        ## 候选预案（SOP）
        {format_runbooks(matching_runbooks)}

        ## 输出恢复步骤
        每步包含：
        - action: 具体操作（扩容/重启/切流/限流）
        - risk_level: low/medium/high
        - reversible: 是否可逆（能否回滚）
        - validation: 如何验证生效
        - rollback: 回滚方案

        优先选择low risk + reversible的操作。
        high risk操作必须标记"需要人工审批"。
        """
        plan = self.llm.generate(prompt, temperature=0)

        # 安全校验：禁止危险操作
        for step in plan.steps:
            if step.action in DANGEROUS_ACTIONS and not step.approved:
                step.require_human = True

        return plan
```

### 3.3 执行层（自动恢复 + 人在回路）

```python
class RecoveryExecutor:
    def __init__(self):
        self.safe_actions = {"scale_out", "clear_cache", "restart_instance"}
        self.dangerous_actions = {"drop_table", "delete_data", "config_change"}

    def execute(self, plan):
        results = []
        for step in plan.steps:
            # 1. 安全性校验
            if step.action in self.dangerous_actions:
                # 高危操作：人在回路
                approval = self.request_human_approval(step)
                if not approval.granted:
                    results.append({"step": step, "status": "SKIPPED"})
                    continue

            # 2. 执行前快照（用于回滚）
            snapshot = self.take_snapshot(step.target)

            try:
                # 3. 执行操作
                result = self.do_action(step)

                # 4. 验证效果
                if self.validate(step.validation):
                    results.append({"step": step, "status": "SUCCESS"})
                else:
                    # 5. 未生效，自动回滚
                    self.rollback(snapshot)
                    results.append({"step": step, "status": "ROLLED_BACK"})

            except Exception as e:
                self.rollback(snapshot)
                results.append({"step": step, "status": "FAILED", "error": str(e)})
                break  # 失败则停止后续步骤

        return results
```

### 3.4 RAG知识库：约束LLM的可靠性

```python
class OperationsKnowledgeBase:
    """运维知识RAG库，避免LLM臆测"""

    def __init__(self):
        self.sources = {
            # 1. 历史故障案例库（每次故障复盘后入库）
            "incident_cases": VectorStore("incidents/"),

            # 2. 标准运维手册（SOP）
            "runbooks": VectorStore("runbooks/"),

            # 3. 服务架构知识（依赖关系、容量水位）
            "topology": GraphStore("topology/"),

            # 4. 变更历史（发布、配置、扩容记录）
            "change_log": TimeSeriesStore("changes/"),
        }

    def retrieve(self, query, top_k=5):
        """检索相关知识，注入LLM prompt"""
        cases = self.sources["incident_cases"].search(query, top_k)
        runbooks = self.sources["runbooks"].search(query, top_k=2)
        return {"cases": cases, "runbooks": runbooks}
```

### 3.5 学习闭环：故障复盘自动入库

```python
class PostMortemPipeline:
    """故障处理完后，自动复盘并写入知识库"""

    def review_and_learn(self, incident):
        # 1. LLM生成复盘报告
        postmortem = self.llm.generate(f"""
        基于以下故障处理过程，生成复盘报告：
        - 故障现象、根因、处理步骤、耗时
        - 哪些步骤有效、哪些无效
        - 未来如何更早预警、更快恢复

        {incident.full_log}
        """)

        # 2. 提取可复用的模式
        pattern = {
            "symptom_signature": encode(incident.symptoms),
            "root_cause": incident.root_cause,
            "effective_actions": incident.successful_steps,
            "false_hypotheses": incident.failed_hypotheses,
        }

        # 3. 写入知识库，供未来检索
        self.kb.add(pattern)
        # 下次类似故障，RAG能直接命中，无需从零推理
```

## 四、可能遇到的问题与对策

### 4.1 问题1：LLM幻觉导致误报/误操作

```
风险：LLM可能基于不充分的证据做出错误判断
  - 误报：把正常波动判为故障 → 告警疲劳
  - 误操作：错误地重启/扩容 → 引发更大故障

对策：
├── 1. RAG约束：必须基于检索到的历史案例，不允许凭空推理
├── 2. 工具验证：每个假设必须用诊断工具验证（查日志、查指标）
├── 3. 多投票：用多个LLM/prompt投票，不一致时降级为人工
├── 4. 置信度阈值：低置信度判断只预警不执行
└── 5. 人在回路：高危操作必须人工审批
```

### 4.2 问题2：LLM推理延迟 vs 实时性

```
矛盾：LLM推理耗时数秒，但故障预警要求秒级响应

对策（分层架构）：
├── 快通道（规则+轻量模型，秒级）：
│   - 固定阈值告警（CPU>90%）
│   - 时序异常检测（Isolation Forest等轻量模型）
│   - 触发后才进入慢通道
│
└── 慢通道（LLM深度分析，分钟级）：
    - 接收快通道的告警
    - LLM做根因分析+方案生成
    - 适合"事后分析+复杂故障"
```

### 4.3 问题3：执行操作的爆炸半径

```
风险：Agent自动执行恢复操作，可能因错误判断扩大故障

对策（安全执行框架）：
├── 1. 操作分级：
│   ├── 绿色（自动执行）：clear_cache, scale_out
│   ├── 黄色（通知后执行）：restart_instance, traffic_shift
│   └── 红色（人工审批）：db_migration, config_change
│
├── 2. 爆炸半径限制：单次操作影响的服务/实例数有上限
├── 3. 灰度执行：先对1个实例操作，验证后再扩大
├── 4. 自动回滚：操作后验证失败，立即回滚到快照
└── 5. 熔断机制：连续失败N次，自动停止并告警人工
```

### 4.4 问题4：知识库覆盖度不足

```
风险：新类型故障在历史案例库中无匹配，LLM无法有效推理

对策：
├── 1. 冷启动：用公开故障案例库（如SRE书籍、开源postmortem）预填充
├── 2. 持续学习：每次故障复盘自动入库，知识库随时间增长
├── 3. 兜底策略：无匹配案例时，降级为"辅助模式"——只提供分析建议，不自动执行
└── 4. 主动演练：定期混沌工程（注入故障），积累案例
```

## 五、评估指标体系

```
系统效果评估分层指标：

1. 预警层
   ├── 预测准确率：预测的故障实际发生率
   ├── 预测提前量：平均提前多少分钟
   └── 误报率：FAR（False Alarm Rate）

2. 排查层
   ├── 根因命中率：Top-3假设包含真实根因的比例
   ├── 平均定位时间：MTTD（Mean Time To Detect）
   └── 推理步数：平均用多少轮ReAct收敛

3. 恢复层
   ├── 自动恢复成功率：无需人工介入的比例
   ├── 平均恢复时间：MTTR
   └── 回滚率：操作失败需回滚的比例

4. 整体
   ├── 可用性提升：SLA从99.9%→99.95%
   ├── 运维人力节省：on-call工单减少比例
   └── 误操作事故数：必须为0（否则系统不可用）
```

## 六、技术选型与实施路线

```
阶段1（1-2月）：辅助模式
├── 只做感知层 + LLM分析建议
├── 不自动执行，人工根据建议操作
└── 目标：验证LLM诊断准确率

阶段2（3-4月）：半自动模式
├── 加入绿色操作自动执行
├── 黄色/红色操作人工审批
└── 目标：MTTR降低50%

阶段3（5-6月）：知识闭环
├── 故障复盘自动入库
├── 混沌工程持续注入案例
└── 目标：知识库覆盖核心场景90%
```

## 加分点

1. **强调"人在回路"和"安全边界"**：运维系统的第一要求是"do no harm"，比效率更重要的是安全——这一点比单纯炫技更让面试官印象深刻
2. **分层架构思维**：快通道（规则）+ 慢通道（LLM），不是所有事都丢给LLM——体现工程权衡
3. **学习闭环设计**：系统不是静态的，每次故障都让知识库增长，越用越准——这是与传统规则系统的本质区别
4. **量化指标**：用MTTD/MTTR/FAR等SRE标准指标，而非泛泛而谈"提升效率"

## 雷区

- **忽视误操作的灾难性**：运维Agent的错误执行可能直接导致线上事故，必须有沙箱+回滚+审批多重保险
- **过度依赖LLM**：把所有决策丢给LLM，没有规则兜底——LLM延迟和幻觉会拖垮实时性
- **忽视爆炸半径控制**：Agent一次操作影响过多实例，一旦出错就是全局故障
- **缺乏评估闭环**：无法量化系统效果，不知道是真有用还是制造了新问题

## 扩展

- **AIOps行业标准**：Gartner的AIOps平台定义，涵盖监控、分析、自动化三大能力
- **混沌工程**：Netflix Chaos Monkey、ChaosBlade（阿里开源），主动注入故障验证系统韧性
- **ReAct范式**：Reasoning + Acting，让LLM边推理边调用工具，是Agent的核心范式（参考ReAct论文）
- **华为云AIOps实践**：华为自身的运维大模型方案，面试时可结合盘古运维大模型谈

## 记忆要点

- 核心痛点：传统运维阈值告警滞后且排查慢，大模型旨在实现故障提前预测与自动恢复。
- 三层架构：感知层(多源信号) + 认知层(LLM依托 RAG 做根因推理) + 执行层(自动扩缩容)。
- 安全兜底：高危操作必须引入人在回路审核，仅在沙箱执行低风险可逆的预案。
- 数据闭环：故障复盘后形成案例入库，持续扩充 RAG 知识库提升未来排查准确率。

