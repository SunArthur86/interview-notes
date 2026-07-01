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

