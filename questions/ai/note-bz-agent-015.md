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

