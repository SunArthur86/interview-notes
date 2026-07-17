---
id: note-bz-agent-015
difficulty: L3
category: ai
subcategory: Agent
tags:
- B站面经
- 多Agent
- 架构
- 协作
feynman:
  essence: 多Agent协作系统=把大任务拆给不同专长的Agent，像团队分工——有人负责调研(Researcher)、有人负责写代码(Coder)、有人负责审核(Critic)，通过消息传递协作完成。
  analogy: 像公司项目组——产品经理(规划)、开发(执行)、测试(验证)、运维(部署)，各司其职，通过文档/会议(消息)协作。
  first_principle: 单Agent受限于上下文窗口和单一角色，复杂任务需要专业化分工。多Agent通过角色分离+消息总线实现可扩展的协作。
  key_points:
  - 核心要素：角色定义+通信机制+协作流程
  - 常见模式：主管-工人/辩论/流水线/对等协作
  - 通信：消息总线/共享黑板/直接调用
  - 挑战：冲突、死循环、成本控制
first_principle:
  essence: 复杂性需要专业化——单Agent做所有事会顾此失彼。
  derivation: 单Agent上下文有限，塞太多角色指令会混淆。多Agent让每个Agent专注一个角色（prompt精简、能力强），通过消息传递整合结果。本质是"分治"+ "专业化"。
  conclusion: 多Agent = 角色专业化 + 消息通信 + 分治整合，突破单Agent的能力上限
follow_up:
- 多Agent一定比单Agent好吗？——不一定，简单任务多Agent反而更慢更贵
- Agent间怎么通信？——消息总线/共享状态/直接函数调用
- 怎么防止Agent互相踢皮球？——明确角色边界+终止条件+主管仲裁
memory_points:
- 单Agent瓶颈：上下文有限、角色混淆、无法并行，多Agent实现专业化
- 三要素：角色(Roles)、通信(Communication)、协作流程(Workflow)
- 典型模式：主管-工人分发，流水线串行，多Agent辩论择优
---

# 如何设计一个多 Agent 协作系统架构？

## 一、为什么需要多 Agent

```
单Agent瓶颈：
  1. 上下文窗口有限（塞不下所有角色指令）
  2. 角色混淆（一个prompt干太多事，质量下降）
  3. 难以并行（串行处理慢）
  4. 错误难隔离（一个环节出错影响全局）

多Agent优势：
  ✓ 专业化（每个Agent专注一件事，prompt精炼）
  ✓ 可并行（独立子任务并发）
  ✓ 可扩展（加新能力=加新Agent）
  ✓ 错误隔离（一个Agent失败不影响其他）
```

## 二、多 Agent 系统核心要素

```
┌──────────────────────────────────────────────┐
│            多Agent协作系统三要素                 │
├──────────────────────────────────────────────┤
│  1. 角色 (Roles)                               │
│     每个Agent有明确职责和边界                    │
│     例: Researcher/Coder/Reviewer/Manager     │
├──────────────────────────────────────────────┤
│  2. 通信 (Communication)                       │
│     Agent间如何传递信息                          │
│     例: 消息总线/共享黑板/直接调用               │
├──────────────────────────────────────────────┤
│  3. 协作流程 (Workflow)                         │
│     任务如何在Agent间流转                        │
│     例: 串行/并行/辩论/主管分发                  │
└──────────────────────────────────────────────┘
```

## 三、典型架构模式

### 模式 1：主管-工人（Supervisor-Worker）

```
         ┌──────────┐
         │ Supervisor│ ← 主管：分解任务、分发、汇总
         └────┬─────┘
    ┌─────────┼─────────┐
    ▼         ▼         ▼
┌──────┐ ┌──────┐ ┌──────┐
│Worker│ │Worker│ │Worker│ ← 工人：专注单一子任务
│  1   │ │  2   │ │  3   │
└──────┘ └──────┘ └──────┘

适用：任务可分解，子任务相对独立
例：写报告（主管分派：调研/写作/校对各一个Worker）
```

```python
class Supervisor:
    def run(self, task):
        subtasks = self.decompose(task)
        results = []
        for sub in subtasks:
            worker = self.assign_worker(sub.type)  # 路由到合适工人
            result = worker.execute(sub)
            results.append(result)
        return self.aggregate(results)
```

### 模式 2：流水线（Pipeline）

```
Agent A → Agent B → Agent C → 输出
(调研)    (写作)    (校对)

适用：任务有明确顺序阶段
特点：串行，前一个输出是后一个输入
```

### 模式 3：辩论（Debate）

```
      ┌──────────┐
   ┌──│Aggregator│──→ 最终答案
   │  └────┬─────┘
   │       │ 汇总
┌──┴──┐ ┌──┴──┐ ┌──┴──┐
│Agent│ │Agent│ │Agent│  ← 多Agent各给方案，汇总选优
│  1  │ │  2  │ │  3  │
└─────┘ └─────┘ └─────┘

适用：需要多视角/提升可靠性
例：医疗诊断（多专科Agent各自诊断，综合得出结论）
```

### 模式 4：对等协作（Peer-to-Peer）

```
Agent A ←──→ Agent B
   ↕           ↕
Agent C ←──→ Agent D

适用：复杂探索性任务
特点：无固定中心，Agent按需通信
例：软件开发（前端/后端/DBA/测试协作）
```

## 四、通信机制设计

### 1. 消息总线（Event Bus）

```python
class EventBus:
    """发布订阅模式，Agent间解耦通信"""
    def __init__(self):
        self.subscribers = {}
    
    def subscribe(self, event_type, agent):
        self.subscribers.setdefault(event_type, []).append(agent)
    
    def publish(self, event):
        for agent in self.subscribers.get(event.type, []):
            agent.receive(event)

# 使用
bus = EventBus()
bus.subscribe("research_done", writer_agent)
researcher_agent.research(topic)  # 完成后 publish("research_done", data)
```

### 2. 共享黑板（Blackboard）

```python
class Blackboard:
    """共享状态空间，所有Agent可读写"""
    def __init__(self):
        self.state = {}  # 共享数据
    
    def write(self, key, value, agent_id):
        self.state[key] = {"value": value, "by": agent_id, "ts": now()}
    
    def read(self, key):
        return self.state.get(key)

# 多Agent通过黑板协作
blackboard.write("research_data", data, "researcher")
analysis = blackboard.read("research_data")  # writer读取使用
```

## 五、完整设计示例：内容生产系统

```
任务：写一篇技术博客

架构：
                    ┌──────────┐
                    │  Editor  │ ← 主编：规划+质量把关
                    │(主管)    │
                    └────┬─────┘
          ┌─────────────┼─────────────┐
          ▼             ▼             ▼
    ┌──────────┐  ┌──────────┐  ┌──────────┐
    │Researcher│  │  Writer  │  │ Reviewer │
    │ (调研员)  │  │ (撰稿人)  │  │ (审稿人)  │
    └────┬─────┘  └────┬─────┘  └────┬─────┘
         │             │             │
         └──────共享黑板──────────────┘
              (调研结果/草稿/修改意见)

流程：
  1. Editor分解任务：选题→调研→写作→审稿
  2. Researcher调研，结果写入黑板
  3. Writer基于调研写草稿，写入黑板
  4. Reviewer审稿，提出修改意见写入黑板
  5. Writer根据意见修改
  6. Editor确认质量，发布
```

## 六、多 Agent 的挑战与对策

```
┌──────────────┬─────────────────────┬────────────────────┐
│ 挑战          │ 问题                  │ 对策                │
├──────────────┼─────────────────────┼────────────────────┤
│ 死循环        │ A让B做，B让A做       │ 设全局步数上限+环检测│
│ 踢皮球        │ 都说"不归我管"        │ 明确角色边界+主管强制│
│ 成本爆炸      │ N个Agent×M轮         │ 限制Agent数和轮数   │
│ 通信开销      │ 大量上下文传递        │ 共享黑板+摘要传递   │
│ 一致性        │ Agent结论矛盾        │ 仲裁机制+投票       │
│ 调试困难      │ 谁出错了？           │ 全链路Trace         │
└──────────────┴─────────────────────┴────────────────────┘
```

## 七、面试加分点

1. **强调"专业化分工"**：多 Agent 的核心价值是专业化，每个 Agent 专注一件事质量更高
2. **不止说优势**：要承认多 Agent 成本高、调试难，简单任务单 Agent 更好
3. **提通信是关键**：Agent 间如何通信（消息总线/黑板）是架构设计的核心决策

## 记忆要点

- 单Agent瓶颈：上下文有限、角色混淆、无法并行，多Agent实现专业化
- 三要素：角色(Roles)、通信(Communication)、协作流程(Workflow)
- 典型模式：主管-工人分发，流水线串行，多Agent辩论择优


## 苏格拉底式面试追问

> 这组追问模拟面试官层层逼问，每一问先回答"为什么"，再回答"怎么做"，最后回答"如何证明"。

### 第一层：目标与动机

**Q：多 Agent 协作系统把任务拆给不同专长的 Agent，为什么不直接用一个"全能 Agent"做所有事？拆成多个不是增加协调成本吗？**

全能 Agent 的瓶颈是"角色混杂导致顾此失彼"。一个 Agent 同时扮演调研者、编码者、审核者时，prompt 要塞所有角色的指令，LLM 注意力被稀释（每个角色都做不深）；而且角色间会"自我偏见"（自己写的代码自己审，审不出问题）。多 Agent 专精化的好处：1）每个 Agent 的 prompt 聚焦单一角色（编码 Agent 只想编码，审核 Agent 只想找 bug），推理质量更高；2）角色对立（编码 vs 审核）能发现单 Agent 发现不了的问题（交叉验证）；3）可独立优化（编码 Agent 单独迭代不影响审核 Agent）。协调成本确实存在，但对复杂任务，专精化的收益（质量提升）> 协调成本。简单任务单 Agent 更划算（不值得拆）。

### 第二层：证据与定位

**Q：多 Agent 协作时任务失败了，你怎么定位是哪个 Agent 的问题（是 Coder 写错了还是 Reviewer 没审出来）？**

看每个 Agent 的输入输出 trace。多 Agent 系统里每个 Agent 有独立的 trace（输入任务+输出结果），按协作链路回溯：1）如果 Coder 输出的代码有明显 bug，是 Coder 的问题；2）如果 Coder 输出的代码 OK 但 Reviewer 没发现问题（放行了 bug 代码），是 Reviewer 的问题（审核能力弱）；3）如果 Coder 和 Reviewer 都 OK 但最终结果错，可能是协调者（Orchestrator）的"任务分配/结果汇总"逻辑错。定位方法：逐 Agent 审核输入输出，找到第一个"输入正确但输出错误"的 Agent，那就是责任方。多 Agent 的好处是 trace 清晰（每个角色独立可查），比单 Agent 的"黑盒"更易定位。

### 第三层：根因深挖

**Q：多 Agent 协作最常见的失败是"Agent 之间理解不一致"（Coder 写的格式 Reviewer 看不懂），根因是什么？**

根因是"接口契约"没定义清楚。多 Agent 协作本质是函数调用——Agent A 的输出是 Agent B 的输入，如果 A 的输出格式/语义没有明确契约，B 的理解就会偏差。如 Coder 输出一段代码+设计说明，但没说"说明在代码注释里还是单独一段"，Reviewer 可能只看代码不看说明，漏掉关键设计意图。治本：1）定义输出 Schema——每个 Agent 的输出用固定格式（如 JSON：{code, design_doc, test_cases}），下游 Agent 按字段取用；2）接口文档——明确每个 Agent 的输入要求（格式、必填字段）和输出保证（结构、质量），写入系统配置；3）契约测试——下游 Agent 对输入做校验（缺字段报错而非瞎猜），强制上游输出规范。

**Q：既然"接口契约"这么重要，为什么很多多 Agent 系统还是用"自然语言传递消息"，而非结构化 Schema？**

因为自然语言灵活但不可靠，结构化 Schema 可靠但不灵活。自然语言传递（如"Coder 把代码和说明发给 Reviewer"）让 Agent 能传达任意信息（包括设计意图、边界考虑），灵活度高，但 Reviewer 的理解可能偏差。结构化 Schema（固定 JSON 字段）保证理解一致，但限制了信息表达（如"这段代码的 tricky 设计意图"难以塞进固定字段）。折中：1）核心信息结构化（代码、测试用例、明确结论用 Schema 字段）；2）补充信息自然语言（设计意图、特殊情况用 free-text 字段）；3）下游 Agent 的 prompt 强调"优先看结构化字段，free-text 作为参考"。这样兼顾可靠性和灵活性。

### 第四层：方案权衡

**Q：多 Agent 协作 vs 单 Agent 多工具，在"任务完成质量"和"系统复杂度"上怎么权衡？**

质量上多 Agent 通常更高（专精+交叉验证），复杂度也更高（协调、通信、一致性）。权衡维度：1）任务复杂度——简单任务（1-2 步）单 Agent 够，多 Agent 是过度设计；中等复杂度（3-5 步）单 Agent 多工具可接受；高复杂度（多角色、需交叉验证、长流程）多 Agent 明显更优；2）质量要求——容忍 80% 准确率的场景单 Agent 够（成本低），要求 95%+ 的场景多 Agent 交叉验证有必要（如代码审查、医疗诊断）；3）团队能力——多 Agent 系统的设计/调试/运维复杂，团队能力不足时单 Agent 更稳。决策：默认单 Agent（够用就别拆），质量瓶颈出现且无法通过单 Agent 优化解决时，才升级到多 Agent。

**Q：多 Agent 协作的"协调成本"（通信、同步、一致性）有时比执行成本还高，为什么不退化成"单 Agent 多步骤"避免协调？**

协调成本确实高，但多 Agent 的价值在"角色独立性和对立性"——单 Agent 多步骤无法实现。1）角色独立性——单 Agent 一个 prompt 塞所有角色，注意力稀释；多 Agent 每个 prompt 聚焦，推理更深；2）角色对立性——单 Agent"自己写自己审"有偏见（倾向于认为自己写的对），多 Agent 的不同实例做审核能发现更多问题（不同视角）；3）并行性——多 Agent 可并行（如 3 个审核 Agent 并行审），单 Agent 串行慢。所以协调成本是为"独立性+对立性+并行性"付的代价。如果任务不需要这些（如简单流水线），单 Agent 多步骤更划算；需要时（如高质量代码交付），协调成本值得。

### 第五层：验证与沉淀

**Q：你怎么证明多 Agent 比单 Agent 在你的任务上确实更好，而不是"更复杂但效果一样"？**

AB 测试。固定任务集，对比：1）单 Agent 多工具（一个 Agent 干所有角色）；2）多 Agent 协作（Coder+Reviewer+Critic）。指标：1）任务完成率/质量（如代码 bug 率、文档准确率）——多 Agent 应更高；2）成本（总 LLM 调用次数×token）——多 Agent 通常更高（协调开销）；3）延迟——多 Agent 可能更长（协调同步）。ROI 判断：如果多 Agent 质量提升 15% 但成本翻倍，要看业务价值——如代码场景 bug 减少 15% 带来的维护成本节省 > 多 Agent 的 API 成本，值得；如 FAQ 客服质量提升 5% 但成本翻倍，不值得。结论：高价值高复杂度任务多 Agent 值得，低价值简单任务单 Agent 够。

**Q：多 Agent 协作系统的架构和角色定义怎么沉淀成可复用的模板？**

封装成 MultiAgentOrchestrator 框架：1）角色模板库——常见角色（Researcher/Coder/Reviewer/Critic/Coordinator）的标准 prompt 模板和职责定义，开发者按任务选角色组合；2）协作模式库——串行/并行/仲裁三种模式的标准实现，开发者配置任务流即可；3）接口契约工具——Agent 间消息的 Schema 定义和校验，避免理解偏差；4）trace 和调试工具——多 Agent 协作的链路追踪（哪个 Agent 在哪一步出错）；5）多 Agent 评测集——按任务类型的标准评测，验证多 Agent 是否真的优于单 Agent。这套写入团队 Agent 框架 SOP，新多 Agent 系统复用角色模板和协作模式，不重新设计架构。

## 结构化回答

**30 秒电梯演讲：** 多Agent协作系统=把大任务拆给不同专长的Agent，像团队分工——有人负责调研(Researcher)、有人负责写代码(Coder)、有人负责审核(Critic)，通过消息传递协作完成。

**展开框架：**
1. **核心要素** — 角色定义+通信机制+协作流程
2. **常见模式** — 主管-工人/辩论/流水线/对等协作
3. **通信** — 消息总线/共享黑板/直接调用

**收尾：** 您想深入聊：多Agent一定比单Agent好吗？——不一定，简单任务多Agent反而更慢更贵？


## 视频脚本

> 预计时长：4 分钟 | 由浅入深


| 时间 | 画面/字幕 | 口播台词 | 讲解要点 |
|------|----------|----------|----------|
| 0:00 | 标题卡：如何设计一个多 Agent 协作系统架构？ | "像公司项目组——产品经理(规划)、开发(执行)、测试(验证)、运维(部署)，各司其职，通过…" | 开场钩子 |
| 0:20 | 核心概念图 | "多Agent协作系统=把大任务拆给不同专长的Agent，像团队分工——有人负责调研(Researcher)、有人负责写代…" | 核心定义 |
| 0:50 | 核心要素示意图 | "核心要素——角色定义+通信机制+协作流程" | 要点拆解1 |
| 1:30 | 对比/实战案例图 | "对比一下常见误区和工程实践，看真实场景里怎么取舍。" | 实战与对比 |
| 2:20 | 总结卡 | "记住核心要点。下期我们追问：多Agent一定比单Agent好吗？——不一定，简单任务多A？" | 收尾与钩子 |
