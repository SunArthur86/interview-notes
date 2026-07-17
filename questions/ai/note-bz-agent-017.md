---
id: note-bz-agent-017
difficulty: L3
category: ai
subcategory: Agent
tags:
- B站面经
- 多Agent
- 通信
- 消息总线
- 黑板模式
feynman:
  essence: Multi-Agent连接方式四种——直接调用(紧耦合)、共享黑板(松耦合)、消息总线(事件驱动)、中心化协调(主管制)。从紧到松，灵活性和复杂度递增。
  analogy: 像同事沟通——直接喊话(直接调用)、用共享文档(黑板)、用即时通讯群(消息总线)、通过项目经理协调(中心化)。
  first_principle: Agent连接的本质是信息流动方式。耦合度越高效率越高但灵活性差，耦合度越低越灵活但开销大。
  key_points:
  - 直接调用：紧耦合，简单但不灵活
  - 共享黑板：通过共享状态通信
  - 消息总线：发布订阅，事件驱动
  - 中心化协调：主管统一调度
first_principle:
  essence: Agent通信的耦合度决定了系统的可扩展性和效率。
  derivation: 紧耦合(直接调用)：快但改一个影响全部。松耦合(消息总线)：灵活但有传输开销。选择取决于Agent数量、变动频率、性能要求。
  conclusion: 通信方式 = 耦合度权衡（效率 vs 灵活性）
follow_up:
- 哪种最常用？——消息总线（解耦好，支持动态加入）
- 黑板模式怎么避免冲突？——加锁/版本号/CAS
- 大规模Multi-Agent怎么通信？——分层消息总线+区域路由
memory_points:
- 直接调用：同步阻塞紧耦合，效率最高，适合极少固定Agent
- 共享黑板：Agent读写共享状态，松耦合，适合需协作开发的场景
- 消息总线：发布/订阅模式，完全解耦，支持动态扩展和一对多通信
---

# Multi-Agent 之间的连接（通信）方式有哪几种？

## 一、四种连接方式

```
耦合度：高 ◀────────────────────────────▶ 低
效率：  高 ◀────────────────────────────▶ 低
灵活性：低 ◀────────────────────────────▶ 高

1. 直接调用     2. 共享黑板     3. 消息总线     4. 中心化协调
 (紧耦合)       (共享状态)      (发布订阅)      (主管制)
```

## 二、方式 1：直接调用（Direct Call）

```
Agent A ──直接函数调用──→ Agent B
         (同步等待返回)

特点：
  + 最简单，像普通函数调用
  + 延迟最低
  - 紧耦合（A必须知道B的存在和接口）
  - 同步阻塞
  - 难以扩展（加新Agent要改调用方）
```

```python
class AgentA:
    def __init__(self, agent_b):
        self.agent_b = agent_b  # 直接持有B的引用
    
    def run(self, task):
        result = self.do_part(task)
        return self.agent_b.process(result)  # 直接调用B

# 使用
b = AgentB()
a = AgentA(b)  # 紧耦合
a.run(task)
```

**适用：** Agent 数量少（2-3个）、关系固定、追求性能。

## 三、方式 2：共享黑板（Blackboard）

```
┌──────────────────────────────────┐
│        共享黑板 (Shared State)     │
│  {research: ..., draft: ...}     │
└──┬───────┬───────┬───────────────┘
   │读写    │读写    │读写
   ▼       ▼       ▼
Agent A  Agent B  Agent C

特点：
  + 松耦合（Agent不需知道彼此）
  + 异步（各自读写黑板）
  - 并发冲突（需加锁）
  - 黑板可能膨胀
```

```python
class Blackboard:
    def __init__(self):
        self.data = {}
        self.locks = {}
    
    def write(self, key, value, agent_id):
        with self.locks.setdefault(key, threading.Lock()):
            self.data[key] = {
                "value": value,
                "author": agent_id,
                "version": self.data.get(key, {}).get("version", 0) + 1,
                "ts": time.time()
            }
    
    def read(self, key):
        return self.data.get(key, {}).get("value")

class Researcher:
    def run(self, blackboard):
        data = self.research()
        blackboard.write("research_data", data, "researcher")

class Writer:
    def run(self, blackboard):
        data = blackboard.read("research_data")  # 从黑板读
        draft = self.write(data)
        blackboard.write("draft", draft, "writer")
```

**适用：** Agent 间需共享中间状态、协作开发（如代码生成）。

## 四、方式 3：消息总线（Message Bus / Event Bus）

```
         ┌─────────────────────┐
         │   消息总线 (Bus)      │
         │  publish/subscribe   │
         └──┬─────┬─────┬──────┘
     publish │     │     │ subscribe
            ▼     ▼     ▼
        Agent A  Agent B  Agent C
        (发布)   (订阅)   (订阅)

特点：
  + 完全解耦（发布者不知订阅者）
  + 可动态加入/退出
  + 支持一对多
  - 异步延迟
  - 消息顺序保证复杂
```

```python
class EventBus:
    def __init__(self):
        self.topics = {}  # topic → [subscribers]
    
    def subscribe(self, topic, agent):
        self.topics.setdefault(topic, []).append(agent)
    
    async def publish(self, topic, message):
        for agent in self.topics.get(topic, []):
            await asyncio.create_task(agent.on_message(message))

# 使用：完全解耦
bus = EventBus()
bus.subscribe("research_done", writer_agent)
bus.subscribe("research_done", fact_checker_agent)

researcher_agent.research(topic)
# 完成后:
await bus.publish("research_done", {"topic": topic, "data": data})
# writer和fact_checker都会收到，互不干扰
```

**适用：** Agent 数量多、关系动态变化、需要可扩展架构。

## 五、方式 4：中心化协调（Centralized Coordinator）

```
            ┌──────────────────┐
            │  Coordinator      │ ← 主管/调度器
            │  (全局调度决策)    │
            └──┬───┬───┬───────┘
               │   │   │
        ┌──────┘   │   └──────┐
        ▼          ▼          ▼
    Agent A    Agent B    Agent C
    (被调度)   (被调度)   (被调度)

特点：
  + 全局最优（主管能看到全貌）
  + 易管理（统一调度）
  - 单点故障（主管挂了全挂）
  - 主管成为瓶颈
```

```python
class Coordinator:
    """中心化调度器"""
    def __init__(self, agents):
        self.agents = agents
        self.task_queue = []
    
    def run(self, goal):
        plan = self.decompose(goal)
        for subtask in plan:
            # 主管决定哪个Agent干这个子任务
            agent = self.route(subtask)
            result = agent.execute(subtask)
            self.update_state(result)
            if result.failed:
                self.adjust_plan()  # 主管动态调整
        return self.finalize()
    
    def route(self, subtask):
        """根据子任务类型路由到合适Agent"""
        for agent in self.agents:
            if agent.can_handle(subtask):
                return agent
```

**适用：** 需要全局优化、任务调度复杂、对一致性要求高。

## 六、四种方式对比

| 维度 | 直接调用 | 共享黑板 | 消息总线 | 中心化协调 |
|------|---------|---------|---------|-----------|
| **耦合度** | 高 | 中 | 低 | 中 |
| **扩展性** | 差 | 中 | 好 | 中 |
| **性能** | 高 | 中 | 中低 | 中 |
| **复杂度** | 低 | 中 | 高 | 中高 |
| **适用规模** | 2-3 | 3-7 | 7+ | 5-15 |

## 七、选型建议

```
Agent数量少（2-3）且固定 → 直接调用
共享中间状态多 → 共享黑板
Agent多且动态 → 消息总线
需全局优化调度 → 中心化协调

混合策略（大型系统）：
  顶层：中心化协调（主管）
  中层：消息总线（部门间通信）
  底层：共享黑板（团队内协作）
```

## 八、面试加分点

1. **耦合度光谱**：把四种方式按耦合度排列，体现体系化理解
2. **没有最优解**：每种方式有 tradeoff，选型看规模和需求
3. **提"黑板模式"**：经典 AI 架构（源自 Hearsay-II 语音识别），多 Agent 协作的基础范式

## 记忆要点

- 直接调用：同步阻塞紧耦合，效率最高，适合极少固定Agent
- 共享黑板：Agent读写共享状态，松耦合，适合需协作开发的场景
- 消息总线：发布/订阅模式，完全解耦，支持动态扩展和一对多通信


## 苏格拉底式面试追问

> 这组追问模拟面试官层层逼问，每一问先回答"为什么"，再回答"怎么做"，最后回答"如何证明"。

### 第一层：目标与动机

**Q：Multi-Agent 连接方式有四种（直接调用、共享黑板、消息总线、中心化协调），为什么不统一用一种（如消息总线），而要分四种？**

因为耦合度需求不同。直接调用（紧耦合）适合"固定流水线"（A 调 B，调用关系稳定），延迟低但变更难；消息总线（松耦合）适合"动态协作"（Agent 可插拔，发布订阅），灵活但延迟略高。统一用一种会"一刀切"——简单流水线用消息总线是大材小用（多了一层中间件延迟），动态协作用直接调用是僵化（改一个调用关系要改代码）。四种方式对应"紧→松"的耦合度光谱，按系统的"可扩展性需求"选：固定小规模用直接调用，大规模动态用消息总线，共享状态用黑板，需全局控制用中心化协调。

### 第二层：证据与定位

**Q：消息总线模式下，Agent A 发的消息 Agent B 没收到（丢失了），怎么定位是总线问题还是 Agent 问题？**

消息队列都有"投递确认"机制。1）总线层——看消息队列的投递日志（如 Kafka 的 offset 提交记录、Redis PubSub 的订阅日志），确认消息是否被推送给 B；2）Agent 层——看 B 的接收日志，确认是否收到消息、收到后是否处理（还是处理崩溃了）。如果总线推送了但 B 没收到（网络丢包/订阅断开），是基础设施问题；如果 B 收到了但没处理（消费失败/异常），是 B 的代码 bug。实务上用"至少一次投递"+ 消息去重（B 处理前检查 message_id 是否已处理过）保证不丢。重要消息用"事务性消息"（生产者和消费者都确认才算成功）。

### 第三层：根因深挖

**Q：共享黑板模式下，多个 Agent 读写同一块"黑板"（共享状态），并发写冲突怎么处理？**

用乐观锁或悲观锁。1）乐观锁——Agent 读黑板时记版本号，写回时检查版本号是否变了（变了说明有人改过），变了就重读-重算-重写（retry）；适合"冲突少"的场景（多数时候不冲突，乐观锁无锁开销）。2）悲观锁——Agent 写黑板前先加锁，写完释放，其他 Agent 等锁；适合"冲突多"的场景（避免频繁 retry）。3）分区设计——把黑板按字段分区（如 CoderAgent 只写 code 区，ReviewerAgent 只写 review 区），各写各区不冲突，根本避免并发写。实务优先用"分区设计"（无锁无冲突），迫不得已才用锁。黑板模式还要注意"脏读"（Agent A 写一半，Agent B 读到半成品），用"写完标记"（A 写完才置 ready=true，B 只读 ready 的）解决。

**Q：中心化协调（Supervisor 模式）下，Supervisor 是单点，它挂了整个系统就瘫，怎么保证可靠性？**

Supervisor 单点是经典"单点故障"问题。解决：1）主备冗余——跑两个 Supervisor（主+备），主挂了备自动接管（用 Raft/Paxos 做主从一致性），代价是复杂度增加；2）无状态化——Supervisor 不存状态（状态存共享存储如 Redis/ZK），任何实例都能接管，配合负载均衡做到"Supervisor 挂了换个实例继续"；3）降级模式——Supervisor 不可用时，Agent 退化为"自主模式"（各自完成任务不协调，可能质量降但不停服），等 Supervisor 恢复再恢复协调。实务上对可靠性要求高的系统用"无状态 Supervisor + 共享状态存储"，要求一般的用"单 Supervisor + 监控告警+快速重启"。

### 第四层：方案权衡

**Q：四种连接方式，实际项目怎么选？给一个选型决策。**

按"系统规模 + 动态性 + 可靠性需求"选：1）小规模固定流水线（3-5 Agent，调用关系稳定）→ 直接调用（最简单，延迟最低）；2）中等规模、有共享状态（如多 Agent 协作编辑文档）→ 共享黑板（自然支持状态共享）；3）大规模动态系统（Agent 可插拔、发布订阅、解耦）→ 消息总线（最灵活）；4）需要全局控制/任务分配（如复杂工作流编排）→ 中心化协调（Supervisor）。混合场景：核心控制用中心化协调（Supervisor 编排），Agent 间数据传递用消息总线（解耦），共享状态用黑板。从简单起步（直接调用），演进到需要时再升级（黑板→总线→协调），不一开始就上最复杂的。

**Q：为什么不所有多 Agent 系统都用消息总线（最解耦、最流行），而要保留"直接调用"这种紧耦合方式？**

因为消息总线有"延迟和复杂度开销"。1）延迟——直接调用是函数级（同进程，微秒级），消息总线是网络级（跨进程/跨机，毫秒到几十毫秒），对延迟敏感场景（如实时对话 Agent）差距显著；2）复杂度——消息总线要部署/运维中间件（Kafka/Redis）、处理订阅/发布/序列化，对小系统是过度工程；3）可观测性——直接调用的调用栈清晰（trace 直观），消息总线的异步发布订阅让链路追踪变难（消息流向不直观）。所以小规模低延迟系统用直接调用（够用且优），大规模需要解耦的系统用消息总线（值得这个开销）。两者不矛盾，按规模选。

### 第五层：验证与沉淀

**Q：你怎么证明你选的连接方式是合适的，而不是"能跑但不是最优"？**

压测和演进验证。1）延迟压测——同任务在不同连接方式下跑，对比端到端延迟。如果消息总线比直接调用慢 10 倍且任务是小规模固定的，说明选错了（该用直接调用）；2）扩展性测试——增加 Agent 数量（从 3 到 10 到 30），看系统是否扛得住。直接调用在 Agent 多时调用关系爆炸（N² 连线），消息总线天然扛扩展；3）演进信号——如果频繁要"改调用关系/加新 Agent"且每次都改代码，说明紧耦合（直接调用）不够用，该升级到松耦合（消息总线）。这些信号提示选型是否合适，必要时迁移。

**Q：四种连接方式的实现经验怎么沉淀成框架的可配置能力？**

封装成 CommunicationLayer 抽象：1）统一接口——Agent 间通信用统一 API（send/receive/broadcast），底层实现可切换（直接调用/黑板/总线/协调）；2）配置驱动——开发者通过配置选连接方式（`comm_mode: message_bus`），不改 Agent 代码；3）混合支持——同一系统不同层用不同方式（Supervisor 用中心化协调，Agent 间数据用总线），框架支持混合；4）可靠性组件——内置锁/幂等/重试/主备，开发者配可靠性级别即可。这套写入团队 Agent 框架 SOP，新系统按规模选连接方式，且能随规模演进（从小规模直接调用平滑迁移到消息总线）。

## 结构化回答




**30 秒电梯演讲：** 像同事沟通——直接喊话(直接调用)、用共享文档(黑板)、用即时通讯群(消息总线)、通过项目经理协调(中心化)。

**展开框架：**
1. **直接调用** — 紧耦合，简单但不灵活
2. **共享黑板** — 通过共享状态通信
3. **消息总线** — 发布订阅，事件驱动

**收尾：** 哪种最常用？





## 视频脚本

> 预计时长：4 分钟 | 由浅入深


| 时间 | 画面/字幕 | 口播台词 | 讲解要点 |
|------|----------|----------|----------|
| 0:00 | 标题卡：Multi-Agent 之间的连接（通信）方式有… | "像同事沟通——直接喊话(直接调用)、用共享文档(黑板)、用即时通讯群(消息总线)、通过项目…" | 开场钩子 |
| 0:20 | 核心概念图 | "Multi-Agent连接方式四种——直接调用(紧耦合)、共享黑板(松耦合)、消息总线(事件驱动)、中心化协调(主管制)…" | 核心定义 |
| 0:50 | 直接调用示意图 | "直接调用——紧耦合，简单但不灵活" | 要点拆解1 |
| 1:30 | 对比/实战案例图 | "对比一下常见误区和工程实践，看真实场景里怎么取舍。" | 实战与对比 |
| 2:20 | 总结卡 | "记住核心要点。下期我们追问：哪种最常用？——消息总线（解耦好，支持动态加入）？" | 收尾与钩子 |
