---
id: note-bz-agent-004
difficulty: L3
category: ai
subcategory: Agent
tags:
- B站面经
- Agent
- 搭建
- 架构
feynman:
  essence: 从0搭Agent七步走——选大脑(LLM)→定工具→写Prompt→做记忆→加循环→上安全→测迭代。核心是先跑通最小闭环再逐步增强。
  analogy: 像组装一台能干活的机器人——大脑(LLM)、手(工具)、笔记本(记忆)、操作系统(循环)、保险丝(安全)。
  first_principle: 最小可用Agent=LLM+一个工具+一个循环。先验证这个闭环能跑通，再逐步加记忆/多工具/安全/评估。
  key_points:
  - 七步：选LLM→定工具→写Prompt→做记忆→加循环→上安全→测迭代
  - MVP原则：先用最简单组件跑通闭环
  - 架构分层：接口层/编排层/能力层/安全层
  - 迭代驱动：Bad Case库+评估指标+持续优化
first_principle:
  essence: Agent搭建遵循"闭环优先"原则——任何组件缺失但闭环完整，胜过组件齐全但闭环断裂。
  derivation: Agent价值=自主完成任务，而自主性来自循环。所以第一优先级是让"感知→决策→行动→观察"跑通，哪怕用最弱的LLM和最少的工具。闭环跑通后再优化各环节。
  conclusion: 搭Agent = 先验证OODA闭环 → 再增强组件（模型/工具/记忆/安全）
follow_up:
- 没有GPU怎么搭Agent？——直接调API（OpenAI/Claude/国产），无需自部署
- 用什么框架最快？——LangChain/LlamaIndex快速原型，生产可考虑LangGraph
- Agent上线最难的是什么？——稳定性（概率性输出的不可预测性）
memory_points:
- 最小MVP：1个LLM大脑 + 1个工具 + 1个ReAct循环，50行代码即可跑通
- 搭建四步曲：选大脑（分层模型省钱）、定工具（初期<10个且定义清晰）、写Prompt、做记忆
- 分层模型策略：简单路由用小模型，主推理用强模型，以平衡成本与效果
- 工具治理：工具过多时用RAG按需检索工具描述，而非全塞给LLM
---

# 如何从 0 搭建一个 AI Agent？整体流程是怎样的？

## 一、最小可用 Agent（MVP）架构

```
┌──────────────────────────────────────┐
│            最小Agent MVP              │
│  ┌────────┐                          │
│  │  LLM   │ ← 1个模型（如GPT-4/Claude）│
│  └───┬────┘                          │
│      │ 1个工具                          │
│  ┌───▼────────┐                      │
│  │ web_search │                      │
│  └────────────┘                      │
│      + 1个循环                         │
│  while not done: think → act → obs   │
└──────────────────────────────────────┘
        50行代码就能跑通
```

```python
# MVP Agent（伪代码，~50行）
from openai import OpenAI

def agent(goal, max_steps=5):
    client = OpenAI()
    messages = [{"role": "user", "content": goal}]
    for _ in range(max_steps):
        resp = client.chat.completions.create(
            model="gpt-4",
            messages=messages,
            tools=[{"type": "function", "function": {
                "name": "web_search", "parameters": {"q": "str"}}}]
        )
        msg = resp.choices[0].message
        messages.append(msg)
        if not msg.tool_calls:  # 模型决定回答，结束
            return msg.content
        # 执行工具
        for tc in msg.tool_calls:
            result = web_search(**json.loads(tc.arguments))
            messages.append({"role": "tool", "tool_call_id": tc.id,
                            "content": result})
    return "达到最大步数"
```

## 二、生产级 Agent 七步搭建法

### Step 1：选大脑（LLM）

```
选型考虑：
├── 能力：推理强、工具调用准、长上下文
├── 成本：每token价格 + 调用频率
├── 延迟：首token延迟 + 吞吐
├── 合规：数据出境/备案要求
└── 稳定性：SLA、限流、降级方案

分层模型策略（省钱）：
- 路由/简单判断 → 小模型（GPT-4o-mini/Qwen-7B）
- 主推理 → 强模型（Claude/GPT-4）
- 复杂规划 → 顶级模型（Claude Opus/o1）
```

### Step 2：定工具（Tools）

```python
# 工具定义要清晰，包含name/desc/parameters
tools = [
    {
        "name": "query_order",
        "description": "查询订单状态。当用户问'我的订单''物流'时使用",
        "parameters": {"order_id": "string", "type": "object"}
    },
    # ... 每个工具都要有清晰的触发说明
]
# 工具数量建议：初期<10个，按需用RAG检索工具描述
```

### Step 3：写 Prompt（System Prompt）

```python
SYSTEM_PROMPT = """
你是XX助手。工作流程：
1. 理解用户意图，判断是否需要查信息
2. 如需查询，调用对应工具
3. 基于工具返回结果，给出准确回答

规则：
- 不确定时主动追问，不要编造
- 工具返回错误时，告知用户并建议替代方案
- 回答简洁，避免冗余
"""
```

### Step 4：做记忆（Memory）

```python
# 短期：对话历史（天然在messages里）
# 长期：向量数据库
from chromadb import Client
memory = Client().create_collection("user_memory")

def remember(user_id, content):
    memory.add(documents=[content], metadatas=[{"user": user_id}])

def recall(user_id, query, top_k=3):
    return memory.query(query_texts=[query], 
                       where={"user": user_id}, n_results=top_k)
```

### Step 5：加循环（Orchestration Loop）

```python
def run_agent(goal, tools, memory, max_steps=10):
    trajectory = []
    for step in range(max_steps):
        thought = llm.plan(goal, trajectory, memory.recall(goal))
        action = llm.act(thought, tools)
        if action.type == "final_answer":
            return action.content
        observation = safe_execute(action)  # 带异常处理
        trajectory.append((thought, action, observation))
        # 死循环检测
        if detect_loop(trajectory): break
    return "未能在步数内完成"
```

### Step 6：上安全（Safety）

```python
# 三层防护
def safe_execute(action):
    # 1. 权限检查：这个工具用户有权限调用吗？
    if not check_permission(user, action): 
        return "无权限"
    # 2. 输入校验：参数合法吗？
    if not validate(action.params): 
        return "参数非法"
    # 3. 高危确认：删除/支付等操作需人工确认
    if action.is_dangerous():
        if not await human_confirm(action):
            return "用户取消"
    # 4. 沙箱执行：限制副作用
    return sandbox_run(action)
```

### Step 7：测迭代（Eval & Iteration）

```python
# 评估指标
metrics = {
    "task_completion_rate": "任务完成率（最重要）",
    "step_efficiency": "平均步数（越少越好）",
    "tool_call_accuracy": "工具调用正确率",
    "cost_per_task": "每个任务token成本",
    "user_satisfaction": "用户满意度/点赞率"
}
# Bad Case库：收集失败case，回归测试
```

## 三、完整生产架构

```
┌─────────────────────────────────────────────────┐
│                  接口层（API/UI）                 │
├─────────────────────────────────────────────────┤
│  编排引擎 Orchestrator                            │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐      │
│  │ 意图理解  │→│ 任务规划  │→│ 循环控制  │      │
│  └──────────┘  └──────────┘  └──────────┘      │
├─────────────────────────────────────────────────┤
│  能力层                                           │
│  ┌────────┐ ┌────────┐ ┌────────┐ ┌────────┐  │
│  │ Memory │ │ Tools  │ │  RAG   │ │ Skill  │  │
│  └────────┘ └────────┘ └────────┘ └────────┘  │
├─────────────────────────────────────────────────┤
│  安全&可观测层                                    │
│  权限│限流│审计│Trace│监控│告警                  │
└─────────────────────────────────────────────────┘
```

## 四、面试加分点

1. **强调 MVP 闭环**：先 50 行跑通最小闭环，证明可行性，再逐步增强
2. **分层选模型**：体现成本意识——简单任务用小模型，复杂任务才上大模型
3. **稳定性是最大挑战**：Agent 是概率系统，要靠工程（重试/降级/兜底/监控）保证可用性

## 记忆要点

- 最小MVP：1个LLM大脑 + 1个工具 + 1个ReAct循环，50行代码即可跑通
- 搭建四步曲：选大脑（分层模型省钱）、定工具（初期<10个且定义清晰）、写Prompt、做记忆
- 分层模型策略：简单路由用小模型，主推理用强模型，以平衡成本与效果
- 工具治理：工具过多时用RAG按需检索工具描述，而非全塞给LLM

