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


## 苏格拉底式面试追问

> 这组追问模拟面试官层层逼问，每一问先回答"为什么"，再回答"怎么做"，最后回答"如何证明"。

### 第一层：目标与动机

**Q：你说从 0 搭 Agent 要七步（选 LLM、定工具、写 Prompt、做记忆、加循环、上安全、测迭代），为什么是这个顺序？能不能先做记忆再做工具？**

顺序遵循"闭环优先 + 依赖关系"。最小闭环是"LLM 决策→调工具→拿结果→继续决策"，这个闭环里 LLM 和工具是必需的（缺任一跑不通），所以先做。记忆是多轮/跨会话才需要的（单轮闭环不需要记忆），放第四步。安全和测试是闭环跑通后的加固，放最后。如果先做记忆再做工具——记忆没有内容可记（闭环还没跑通，没有交互历史），而且记忆的写入/检索逻辑依赖"Agent 实际会生成什么"，属于过早优化。所以顺序是"先让 Agent 能干活（闭环），再让它干得好（记忆/安全/测试）"，每一步都建立在前一步可验证的基础上。

### 第二层：证据与定位

**Q：七步搭完后，Agent 效果不理想，你怎么定位是哪一步的问题？**

按七步做消融排查。从后往前逐个验证：1）安全/记忆——先禁用记忆（纯单轮）和安全（放开限制）跑一遍，如果效果不变，排除这两步；2）Prompt——换几个 prompt 版本，看效果波动大不大，波动大就是 prompt 问题；3）工具——检查 tool_call_success_rate，低于 80% 是工具描述/参数 schema 问题；4）LLM——换更强/更弱的 base model（如从 7B 换 70B），看效果差距，差距大说明 LLM 能力是瓶颈；5）循环——看平均步数，过多（如 20 步才完成 3 步任务）是规划/循环设计问题。每步消融后记录效果变化，变化最大的就是主因。这个排查要有固定的 eval set，否则无法对比。

### 第三层：根因深挖

**Q：很多团队搭 Agent 卡在第二步"定工具"——工具描述写不好导致 LLM 选不准。这个工具描述到底该怎么写？**

工具描述要让 LLM"一眼看懂这个工具干什么、什么时候该用、参数怎么填"。四个要素：1）功能说明——一句话说清"这个工具做什么"（如"根据股票代码查询实时股价"）；2）使用场景——"什么时候该用这个工具"（如"用户问股价/涨跌/市值时调用"）；3）参数说明——每个参数的类型、含义、示例（如 symbol: 字符串，股票代码如'AAPL'）；4）反例（可选）——"什么时候不该用"（如"问历史股价用另一个工具"）。常见错误：描述太简（"查询工具"——查什么？）、参数没示例（LLM 猜参数格式易错）、多个工具描述相似导致混淆（要用反例区分）。实测：加上 few-shot 示例的描述，tool_call_success_rate 从 70% 提到 90%+。

**Q：既然工具描述这么重要，为什么不直接微调 LLM 让它"记住"所有工具，而非要在 prompt 里写描述？**

微调让 LLM 记住工具有两个硬伤。1）工具是动态的——新增/修改工具后要重新微调，迭代成本高（每次微调几小时+成本）；而 prompt 描述是运行时注入，改描述立刻生效。2）微调会导致"工具过拟合"——LLM 学会了固定工具集的调用模式，换一个新工具（没见过）就不会用，泛化性差；prompt 描述方式下，LLM 靠"读描述理解功能"的零样本能力，新工具也能用。所以工具描述放 prompt 是"灵活性优先"，微调只用于"高频核心工具"（如某业务的 3-5 个核心工具）做 SFT 提升准确率，两者结合——核心工具微调 + 长尾工具 prompt 描述。

### 第四层：方案权衡

**Q：七步里"加循环"和"上安全"哪个更优先？Agent 还没安全防护就上线会不会有风险？**

开发阶段"加循环"优先（没有循环跑不通），上线前"上安全"是硬性前置。两者不矛盾：开发时先用简单循环（while+max_turns）跑通，安全用最简兜底（如限制工具权限、敏感词过滤）；要上线时必须补全安全（prompt injection 防护、工具调用白名单、输出内容审核、速率限制）。没安全就上线的风险：1）prompt injection——用户构造恶意输入让 Agent 调危险工具（如删库）；2）成本失控——Agent 死循环烧 token/API；3）内容合规——Agent 输出有害内容。所以"加循环"是功能开发，"上安全"是上线 gate，时间上是循环先做、安全在上线 checkpoint 前必须完成。

**Q：七步搭 Agent 听起来很完整，为什么很多团队的 Agent 还是做不好？卡在哪一步最多？**

卡在第七步"测迭代"最多，但根源在第三步"写 Prompt"。1）测迭代难——Agent 的行为是非确定性的（LLM 每次输出不同），传统单元测试不适用，要设计"行为评测集"（固定任务+预期完成度），很多团队不知道怎么测就只能"感觉差不多就上线"，效果不稳定。2）Prompt 是根本——Agent 的规划质量、工具选择、输出格式全由 prompt 决定，很多团队的 prompt 是"写一次不迭代"，但 prompt 要根据 eval 结果持续优化（如发现"总选错工具"就在 prompt 里加 few-shot 示例）。真正成熟的团队 70% 的时间花在 prompt 迭代和 eval 闭环上，前六步（搭骨架）反而快。

### 第五层：验证与沉淀

**Q：你怎么验证搭好的 Agent 是"生产级"而不是"Demo 级"？有什么硬性标准？**

五个硬性标准：1）任务完成率——在真实业务 eval set 上>70%（Demo 级常 30-50%）；2）稳定性——同一任务跑 10 次，完成率方差<5%（Demo 级常波动 20%+）；3）成本可控——单任务平均 token 消耗在预算内（如<5000 token），有 max_turns 兜底防爆炸；4）安全合规——通过 prompt injection 测试、敏感内容审核、工具权限审计；5）可观测——有完整的 trace 日志（每轮 Thought/Action/Observation），能定位每次失败的原因。Demo 级通常只有"能跑通 happy path"，生产级要"能处理 edge case + 可监控 + 可回滚"。这五项做成上线 checklist，全部通过才能上线。

**Q：从 0 搭 Agent 的七步方法论怎么沉淀成团队的标准流程（SOP），让新人也能搭出生产级 Agent？**

固化成 Agent 开发 SOP 文档 + 脚手架：1）SOP 文档——七步每步的产出物、检查清单、常见坑（如"第二步工具描述必含功能+场景+参数示例"）；2）脚手架——一个最小可运行的 Agent 模板（含 LLM 接口、工具注册、循环引擎、安全中间件、eval 框架），新人 clone 后改业务逻辑即可；3）eval 闭环——内置 Agent 评测集模板（任务+预期+评分），每次改动自动跑回归；4）上线 checklist——五项硬性标准做成自动化检查脚本。新人按 SOP 七步走，每步用脚手架组件 + 对照 checklist，能从 0 搭出符合团队标准的 Agent，不再依赖"老人经验"。

## 结构化回答

**30 秒电梯演讲：** 从0搭Agent七步走——选大脑(LLM)→定工具→写Prompt→做记忆→加循环→上安全→测迭代。核心是先跑通最小闭环再逐步增强。

**展开框架：**
1. **七步** — 选LLM→定工具→写Prompt→做记忆→加循环→上安全→测迭代
2. **MVP原则** — 先用最简单组件跑通闭环
3. **架构分层** — 接口层/编排层/能力层/安全层

**收尾：** 您想深入聊：没有GPU怎么搭Agent？——直接调API（OpenAI/Claude/国产），无需自部署？


## 视频脚本

> 预计时长：4 分钟 | 由浅入深


| 时间 | 画面/字幕 | 口播台词 | 讲解要点 |
|------|----------|----------|----------|
| 0:00 | 标题卡：如何从 0 搭建一个 AI Agent？整体流程… | "像组装一台能干活的机器人——大脑(LLM)、手(工具)、笔记本(记忆)、操作系统(循环)…" | 开场钩子 |
| 0:20 | 核心概念图 | "从0搭Agent七步走——选大脑(LLM)→定工具→写Prompt→做记忆→加循环→上安全→测迭代。核心是先跑通最小闭环…" | 核心定义 |
| 0:50 | 七步示意图 | "七步——选LLM→定工具→写Prompt→做记忆→加循环→上安全→测迭代" | 要点拆解1 |
| 1:30 | 对比/实战案例图 | "对比一下常见误区和工程实践，看真实场景里怎么取舍。" | 实战与对比 |
| 2:20 | 总结卡 | "记住核心要点。下期我们追问：没有GPU怎么搭Agent？——直接调API（OpenAI/？" | 收尾与钩子 |
