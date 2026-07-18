---
id: note-xhs-ai-041
difficulty: L3
category: ai
subcategory: agent
tags:
- AI-Agent
- 工具调度
- ReAct
- Plan-and-Solve
- 面经
feynman:
  essence: "多工具冲突不能只靠if-else硬编码——需要用ReAct（推理+行动循环）或Plan-and-Solve（先规划再执行）让LLM动态决策工具选择和执行顺序"
  analogy: "if-else调度像固定流程的工厂流水线——每个零件按固定路线走。ReAct像一个有判断力的工人——遇到问题先想想用什么工具、用完看看结果、不对再换一个。Plan-and-Solve像一个项目经理——先列出所有步骤和依赖关系，再按计划执行"
  key_points:
  - if-else硬编码的问题：不灵活、无法应对新需求、维护成本高
  - ReAct：Thought→Action→Observation循环，LLM实时决策
  - Plan-and-Solve：先让LLM生成完整计划（DAG），再按拓扑序执行
  - 动态调度核心：工具选择+执行顺序+并行vs串行决策
  - 常见框架：LangGraph状态机、AutoGPT ReAct、CrewAI角色分工
first_principle:
  essence: "工具调度的本质是任务分解和执行编排。LLM的推理能力使得基于语义的动态调度成为可能，取代传统硬编码逻辑"
  derivation: "传统规则引擎（if-else/Drools）需要人工预先定义所有可能的条件和路径。但用户需求是无限的——'帮我订机票并安排接机'涉及航班查询、预订、酒店、打车等多个工具的编排，用if-else无法穷举所有组合。LLM可以根据用户意图动态选择工具和决定执行顺序，这就是ReAct和Plan-and-Solve的核心价值"
  conclusion: "动态调度的关键是让LLM做「调度决策」而非「执行」——LLM输出'下一步用哪个工具'，框架负责安全执行"
follow_up:
- ReAct和Plan-and-Solve哪个更好？什么场景用哪个？
- LangGraph的状态机怎么实现工具编排？
- 并行工具调用怎么处理结果合并？
- 工具调用的依赖关系怎么表达和处理？
memory_points:
- if-else→不灵活，ReAct→实时决策，Plan-and-Solve→先规划再执行
- ReAct循环：Thought→Action→Observation
- Plan-and-Solve：LLM生成DAG→拓扑序执行
- 核心思想：LLM做调度决策，框架做安全执行
---

# 【AI Agent工程】多工具冲突除了if-else有什么动态调度方案？

> 来源：小红书「Java 后端转 AI Agent 面试吐槽」

## 一、问题——为什么if-else不够

```
传统if-else调度:

用户: "帮我订明天去上海的机票，到了帮我叫个车到酒店"

if ("机票" in query):
    result = book_flight()      # 订机票
    if ("车" in query):
        result = call_taxi()    # 叫车
        if ("酒店" in query):
            result = ...        # 还有酒店?

问题:
  ✗ 无法处理"顺便"、"顺便帮我"等隐含意图
  ✗ 工具之间有依赖（叫车需要航班到达时间）
  ✗ 新增工具需要修改代码（开闭原则违反）
  ✗ 无法并行（查机票和查酒店可以同时做）
  ✗ 无法回滚（订了机票发现没酒店怎么办?）
```

## 二、ReAct模式——推理+行动循环

```
ReAct (Reasoning + Acting) 循环:

用户: "订明天去上海的机票，到了叫车"

┌─ Iteration 1 ──────────────────────────────────┐
│ Thought: 用户需要订机票和叫车。先查航班信息。    │
│ Action: search_flights(date="明天", dest="上海") │
│ Observation: 找到3个航班，最早9:00到达           │
└─────────────────────────────────────────────────┘
           │
           ▼
┌─ Iteration 2 ──────────────────────────────────┐
│ Thought: 航班9:00到达上海。用户还需要叫车。      │
│          需要航班到达时间来预约接机。            │
│ Action: book_flight(flight_id="CA1501")         │
│ Observation: 预订成功，到达时间9:30              │
└─────────────────────────────────────────────────┘
           │
           ▼
┌─ Iteration 3 ──────────────────────────────────┐
│ Thought: 机票已订，到达时间9:30。现在叫车。      │
│ Action: call_taxi(time="9:30", loc="虹桥机场")  │
│ Observation: 预约成功                           │
└─────────────────────────────────────────────────┘
           │
           ▼
┌─ Final ────────────────────────────────────────┐
│ Thought: 所有任务完成，汇总回复用户              │
│ Answer: "已为您预订CA1501航班（9:30到达上海），  │
│         并预约了9:30虹桥机场的接机车辆"          │
└─────────────────────────────────────────────────┘
```

```python
from langchain.agents import ReActAgent

# ReAct Agent实现
agent = ReActAgent(
    llm=llm,
    tools=[search_flights, book_flight, call_taxi, search_hotels],
    max_iterations=10,  # 防止无限循环
    verbose=True
)

# Agent自主决策工具选择和执行顺序
result = agent.run("订明天去上海的机票，到了叫车到酒店")
```

## 三、Plan-and-Solve模式——先规划再执行

```
Plan-and-Solve 流程:

Step 1: 规划阶段——LLM生成执行计划(DAG)

用户: "订机票+叫车+订酒店"

LLM生成计划:
┌─────────────────────────────────────────┐
│  Plan:                                   │
│  1. search_flights (并行)                │
│  2. search_hotels  (并行)                │
│     ↓ 两者完成后                         │
│  3. book_flight  (依赖: 1的结果)         │
│  4. book_hotel   (依赖: 2的结果)         │
│     ↓ 两者完成后                         │
│  5. call_taxi    (依赖: 3的到达时间)     │
│     ↓                                    │
│  6. summarize   (汇总所有结果)           │
└─────────────────────────────────────────┘

Step 2: 执行阶段——按DAG拓扑序执行

    search_flights ──┐
                     ├──→ book_flight ──┐
    search_hotels  ──┘                   │
                     ├──→ book_hotel  ──┼──→ call_taxi ──→ summarize
                     ┘                   │
                    (并行)               (串行依赖)
```

```python
def plan_and_solve(user_request, llm, tools):
    # Phase 1: 生成计划
    plan = llm.generate(f"""
    用户请求: {user_request}
    可用工具: {[t.name for t in tools]}
    
    生成一个执行计划（JSON格式），包含:
    - steps: 每个步骤用哪个工具
    - dependencies: 步骤之间的依赖关系
    - parallel: 哪些步骤可以并行
    
    示例格式:
    {{
      "steps": [
        {{"id": 1, "tool": "search", "parallel_with": [2]}},
        {{"id": 2, "tool": "search_hotels", "parallel_with": [1]}},
        {{"id": 3, "tool": "book_flight", "depends_on": [1]}},
        {{"id": 4, "tool": "call_taxi", "depends_on": [3]}}
      ]
    }}
    """)
    
    # Phase 2: 执行计划（拓扑排序+并行调度）
    return execute_dag(plan)
```

## 四、LangGraph状态机编排

```python
from langgraph.graph import StateGraph

# 用状态图定义工具编排流程
graph = StateGraph()

# 定义节点（每个节点对应一个工具或决策点）
graph.add_node("understand", understand_intent)
graph.add_node("search_flights", search_flights_tool)
graph.add_node("search_hotels", search_hotels_tool)
graph.add_node("book", book_tool)
graph.add_node("call_taxi", taxi_tool)
graph.add_node("summarize", summarize_results)

# 定义边（转移条件）
graph.add_edge("understand", "search_flights")  # 理解意图→查航班
graph.add_edge("understand", "search_hotels")   # 理解意图→查酒店（并行）
graph.add_conditional_edge("search_flights", 
    lambda s: "book" if s.has_flights else "summarize")
graph.add_edge("book", "call_taxi")
graph.add_edge("call_taxi", "summarize")

# 编译并执行
app = graph.compile()
result = app.invoke({"user_input": "订机票+叫车+酒店"})
```

## 五、方案对比

| 方案 | 原理 | 灵活性 | 可控性 | 复杂度 | 适用场景 |
|------|------|--------|--------|--------|---------|
| if-else | 硬编码规则 | 低 | 高 | 低 | 固定流程 |
| ReAct | 实时推理决策 | 高 | 中 | 中 | 开放域Agent |
| Plan-and-Solve | 先规划DAG再执行 | 高 | 中高 | 中 | 复杂多步任务 |
| LangGraph | 状态机图编排 | 中高 | 高 | 高 | 生产级Agent |
| CrewAI | 多角色分工 | 高 | 中 | 中 | 多Agent协作 |

## 六、面试加分点

1. **ReAct vs Plan-and-Solve选择**：ReAct适合探索性任务（不知道需要几步），Plan-and-Solve适合确定流程（知道大致步骤但需要LLM填参数）。生产中可以先用Plan-and-Solve做规划，用ReAct处理执行中的异常
2. **并行执行的收益**：查机票和查酒店可以并行——节省50%延迟。但并行结果合并需要设计好context，不能简单拼接——面试中提到并行优化和结果合并策略加分
3. **事务性回滚**：Agent执行多步操作可能需要事务性——订了机票但酒店订失败时需要回滚机票。传统数据库ACID概念可以迁移到Agent设计——提及"Agent事务"概念让面试官眼前一亮
4. **工具优先级**：当多个工具都匹配用户意图时（如搜索引擎 vs 知识库），需要优先级机制——可以基于历史成功率、响应延迟、用户偏好动态排序
5. **Java后端转型误区**：Java开发者习惯用策略模式/责任链模式做调度，但这些是编译期确定的——Agent场景需要运行时动态决策，ReAct/Plan-and-Solve是更合适的范式

## 结构化回答

**30 秒电梯演讲：** 多工具冲突不能只靠if-else硬编码——需要用ReAct（推理+行动循环）或Plan-and-Solve（先规划再执行）让LLM动态决策工具选择和执行顺序。

**展开框架：**
1. **if-else硬编码的问题** — 不灵活、无法应对新需求、维护成本高
2. **ReAct** — Thought→Action→Observation循环，LLM实时决策
3. **Plan-and-Solve** — 先让LLM生成完整计划（DAG），再按拓扑序执行

**收尾：** 您想深入聊：ReAct和Plan-and-Solve哪个更好？什么场景用哪个？


## 视频脚本

> 预计时长：4 分钟 | 由浅入深


| 时间 | 画面/字幕 | 口播台词 | 讲解要点 |
|------|----------|----------|----------|
| 0:00 | 标题卡：多工具冲突除了if-else有什么动态调度方案？ | "if-else调度像固定流程的工厂流水线——每个零件按固定路线走。ReAct像一个有判断力…" | 开场钩子 |
| 0:20 | 核心概念图 | "多工具冲突不能只靠if-else硬编码——需要用ReAct（推理+行动循环）或Plan-and-Solve（先规划再执行…" | 核心定义 |
| 0:50 | if-else硬编码的问题示意图 | "if-else硬编码的问题——不灵活、无法应对新需求、维护成本高" | 要点拆解1 |
| 1:30 | 对比/实战案例图 | "对比一下常见误区和工程实践，看真实场景里怎么取舍。" | 实战与对比 |
| 2:20 | 总结卡 | "记住核心要点。下期我们追问：ReAct和Plan-and-Solve哪个更好？什么场景用？" | 收尾与钩子 |

## 苏格拉底式面试追问

| 追问层级 | 面试官可能这样问 | 高分回答方向 |
|----------|------------------|--------------|
| 目标追问 | 多工具动态调度想解决什么问题？ | if-else硬编码无法适应工具数量增长和复杂场景，动态调度让Agent根据意图智能选择工具，提升扩展性和准确性 |
| 证据追问 | 动态调度有哪些方案？各自依据是什么？ | 方案：LLM Function Calling（模型决策）、向量检索工具召回（语义匹配）、路由分类器（小模型分类）、强化学习（历史反馈优化） |
| 边界追问 | 工具数量多少需要动态调度？少量能不能if-else？ | 工具少（<10）且稳定if-else够；工具多、动态变化、组合复杂时必须动态调度 |
| 反例追问 | 动态调度一定比if-else好吗？什么场景if-else更优？ | 工具少且稳定、延迟敏感、可解释性要求高的场景if-else更优（确定性强、延迟低）；动态调度有延迟和不确定性 |
| 风险追问 | 动态调度的风险有哪些？ | 调度错误选错工具、延迟增加、可解释性差、依赖LLM能力、调试困难 |
| 验证追问 | 怎么验证动态调度有效？ | 调度准确率测试集、对比if-else基线、延迟监控、badcase分析 |
| 沉淀追问 | 工具调度怎么沉淀？ | 规范：按工具规模选型、调度准确率监控、降级到if-else兜底、调度日志可追溯 |

### 现场对话示例
**面试官**：多工具冲突除了if-else有什么动态调度方案？
**候选人**：方案有LLM Function Calling模型决策、向量检索工具语义召回、路由分类器小模型分类、强化学习历史反馈优化，按工具规模和场景选。
**面试官**：动态调度一定比if-else好吗？
**候选人**：不一定，工具少且稳定、延迟敏感、可解释性要求高的场景if-else更优（确定性强延迟低），动态调度有延迟和不确定性。
**面试官**：动态调度有什么风险？
**候选人**：选错工具、延迟增加、可解释性差、依赖LLM能力、调试困难，需要调度准确率监控和if-else降级兜底。
