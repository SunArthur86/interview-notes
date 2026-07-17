---
id: note-bz-agent-091
difficulty: L3
category: ai
subcategory: Agent
tags:
- B站面经
- 项目实战
- 工具调用
- 复杂Agent
feynman:
  essence: 构建带工具调用的复杂Agent=定义工具集→设计编排(ReAct/LangGraph)→加记忆和安全→评估迭代。核心是"工具设计+编排引擎+稳定性保障"三位一体。
  analogy: 像组建特种部队——配装备(工具)、战术手册(编排)、通讯系统(记忆)、安全协议(防护)、实战演练(评估)。
  first_principle: 复杂Agent=LLM大脑+丰富工具+智能编排+记忆状态+安全防护。每个组件都要精心设计，木桶效应明显。
  key_points:
  - 工具：定义/治理/检索
  - 编排：ReAct/Plan-Execute/LangGraph
  - 记忆：短期+长期+任务
  - 安全：权限/审计/降级
  - 评估：闭环迭代
first_principle:
  essence: 复杂Agent是多组件系统，质量取决于最弱的环节。
  derivation: 工具差→选不对。编排差→流程乱。记忆差→不连贯。安全差→出事故。评估缺→无法优化。每个环节都要达标，才能构建可靠的复杂Agent。
  conclusion: 复杂Agent = 工具+编排+记忆+安全+评估 的系统化构建
follow_up:
- 多少个工具算复杂？——10+工具需检索管理
- 怎么保证稳定性？——限流/熔断/降级/人工兜底
- 开发周期多久？——MVP 2周，生产级2-3月
memory_points:
- 因为10+工具全塞给LLM会导致幻觉与上下文溢出，所以必须用RAG思路动态检索并选择Top-K工具
- 核心流程图：理解→计划→执行→观察，在观察节点设置条件分支（继续/完成/转人工）闭环编排
- 高可用记忆系统：Redis负责短期低延迟会话状态，VectorDB负责跨会话的长期经验沉淀
- 红线约束：因为高危操作（发邮件/删库）代价不可逆，所以绝不让LLM直接执行，必须引入Human审核
---

# 实战：带工具调用的复杂 Agent 智能体怎么构建？

## 一、复杂 Agent 的定义

```
复杂Agent特征：
  - 多工具（10+）
  - 多轮推理（5+步）
  - 有记忆（跨会话）
  - 有安全约束（高危操作）
  - 有评估闭环（持续优化）

典型场景：数据分析Agent/编程Agent/调研Agent
```

## 二、构建步骤

### Step 1：工具层设计

```python
class ToolLayer:
    """工具定义+治理"""
    
    TOOLS = [
        # 数据获取类
        Tool("web_search", "搜索互联网", permissions=["user"]),
        Tool("query_db", "查询数据库", permissions=["user"]),
        Tool("read_file", "读取文件", permissions=["user"]),
        
        # 数据处理类
        Tool("python_exec", "执行Python代码", 
             permissions=["user"], sandbox=True),
        Tool("data_analysis", "统计分析"),
        
        # 输出类
        Tool("generate_chart", "生成图表"),
        Tool("write_report", "撰写报告"),
        Tool("send_email", "发送邮件", 
             permissions=["admin"], require_approval=True),  # 高危
        
        # 搜索类
        Tool("vector_search", "知识库检索"),
    ]
    
    # 工具检索（工具多时）
    def select_tools(self, query, top_k=5):
        """RAG检索相关工具，而非全塞给LLM"""
        return self.tool_index.search(query, top_k)
```

### Step 2：编排引擎（LangGraph）

```python
from langgraph.graph import StateGraph, END

class ComplexAgent:
    def build(self):
        graph = StateGraph(AgentState)
        
        # 节点
        graph.add_node("understand", self.understand)
        graph.add_node("plan", self.plan)
        graph.add_node("execute", self.execute_tool)
        graph.add_node("observe", self.observe)
        graph.add_node("check_safety", self.safety_check)
        graph.add_node("respond", self.respond)
        graph.add_node("human_review", self.human_review)
        
        # 流程
        graph.set_entry_point("understand")
        graph.add_edge("understand", "plan")
        graph.add_edge("plan", "execute")
        graph.add_edge("execute", "observe")
        
        # 条件分支
        graph.add_conditional_edges("observe", self.next_step, {
            "continue": "plan",       # 继续下一步
            "done": "respond",        # 完成
            "unsafe": "human_review", # 需人工
        })
        
        graph.add_edge("check_safety", "execute")
        graph.add_edge("human_review", "respond")
        
        return graph.compile(checkpointer=MemorySaver())
```

### Step 3：记忆系统

```python
class AgentMemory:
    def __init__(self):
        self.working = []        # 当前任务轨迹
        self.session = RedisStore()  # 会话级
        self.long_term = VectorDB()  # 长期
    
    def remember_task(self, task, result):
        """任务完成后存入长期记忆"""
        if result.success and result.important:
            self.long_term.add({
                "task": task,
                "approach": result.approach,
                "outcome": result.outcome,
                "user_id": self.user_id,
            })
    
    def recall_relevant(self, query):
        """检索相关历史经验"""
        return self.long_term.search(query, 
                                     filter={"user_id": self.user_id})
```

### Step 4：安全层

```python
class SafetyLayer:
    async def check(self, action):
        # 高危操作需人工确认
        HIGH_RISK = ["send_email", "delete_file", "pay"]
        
        if action.tool in HIGH_RISK:
            if not await self.human_approve(action):
                return Reject("未获人工授权")
        
        # 参数校验
        if not self.validate_params(action):
            return Reject("参数非法")
        
        # 沙箱执行
        if action.tool == "python_exec":
            action.sandbox = True  # 隔离执行
        
        return Allow(action)
```

### Step 5：评估闭环

```python
class EvalLoop:
    def evaluate(self, test_cases):
        metrics = {
            "task_completion": 0,    # 任务完成率
            "tool_accuracy": 0,      # 工具调用正确率
            "avg_steps": 0,          # 平均步数
            "safety_violations": 0,  # 安全违规数
            "cost": 0,               # Token成本
        }
        # ... 跑测试集 ...
        return metrics
    
    def optimize(self, bad_cases):
        """基于Bad Case优化"""
        for case in bad_cases:
            if case.error_type == "wrong_tool":
                self.improve_tool_description()
            elif case.error_type == "loop":
                self.adjust_loop_detection()
```

## 三、完整架构

```
┌──────────────────────────────────────────────────┐
│            复杂Agent完整架构                         │
├──────────────────────────────────────────────────┤
│  接口层：API/UI/流式输出                            │
├──────────────────────────────────────────────────┤
│  编排层：LangGraph状态图                            │
│  understand→plan→execute→observe→(loop)→respond  │
├──────────────────────────────────────────────────┤
│  能力层                                             │
│  Memory    │ Tools(10+) │ RAG │ Safety           │
│  (3层)     │ (检索管理) │     │ (权限/审计)       │
├──────────────────────────────────────────────────┤
│  基础设施                                           │
│  LLM网关 │ 向量DB │ Redis │ 监控 │ 日志           │
└──────────────────────────────────────────────────┘
```

## 四、面试加分点

1. **五步构建**：工具→编排→记忆→安全→评估，系统化
2. **工具检索管理**：工具多时用 RAG 选子集，而非全塞——这是复杂 Agent 的关键
3. **安全是底线**：高危操作必须人工确认+沙箱执行——生产级必备

## 记忆要点

- 因为10+工具全塞给LLM会导致幻觉与上下文溢出，所以必须用RAG思路动态检索并选择Top-K工具
- 核心流程图：理解→计划→执行→观察，在观察节点设置条件分支（继续/完成/转人工）闭环编排
- 高可用记忆系统：Redis负责短期低延迟会话状态，VectorDB负责跨会话的长期经验沉淀
- 红线约束：因为高危操作（发邮件/删库）代价不可逆，所以绝不让LLM直接执行，必须引入Human审核

## 苏格拉底式面试追问

> 这组追问模拟面试官层层逼问，每一问先回答"为什么"，再回答"怎么做"，最后回答"如何证明"。

### 第一层：目标与动机

**Q：你说 10+ 工具要用 RAG 检索选 Top-K，但检索工具本身就是一步可能出错的环节（选错了工具后面全错），为什么不直接把所有工具的描述都塞给 LLM 让它自己选？**

因为塞全量工具的代价超过检索出错的风险。10 个工具的 schema 描述大约 2000-3000 token，50 个工具就是 1 万+ token，每次调用都塞会让：上下文窗口被工具描述占满、模型注意力被稀释（Lost in Middle 导致选错）、成本和延迟翻倍。而工具检索的准确率可以做得很高（工具描述是结构化的、数量有限，比文档检索简单），用 embedding 检索 + 工具描述精排，Top-5 命中率能到 95%+。所以权衡是"5% 的工具检索失败风险" vs "100% 的上下文膨胀代价"，前者可通过 Rerank 补救，后者无法缓解。工具多了必须检索，不是可选项。

### 第二层：证据与定位

**Q：Agent 跑着跑着陷入死循环（反复调用同一工具或 plan-execute 来回跳），你怎么检测并打破循环？**

用"状态指纹 + 重复检测"。每一步记录关键状态（当前 plan + 已执行步骤 + 最新观察）的 hash，如果连续两步的状态 hash 相同（或相似度 > 阈值），判定为循环。打破循环的方法：一是设最大步数硬上限（如 max_steps=15，超过强制结束转人工），二是检测到循环时注入"反思"——让 LLM 总结"为什么卡住"并强制换策略（如换工具、换 plan）。根因排查要看循环发生在哪类任务上——如果是某工具返回空导致 LLM 误以为没执行成功而重复调，是工具的返回值不够明确（应返回"已执行，无数据"而非空），要改工具的反馈语义。

### 第三层：根因深挖

**Q：工具调用准确率你说是关键指标，但 LLM 选错工具的根因是什么？是工具描述写得差、还是 LLM 理解能力不够？**

90% 是工具描述写得差，10% 是 LLM 能力。判断方法：把选错工具的 case 拿出来，看工具描述——如果两个工具描述语义重叠（如"查询订单"和"查询订单物流"没写清边界），LLM 在边界 case 摇摆，是描述问题。如果描述清晰（明确写了适用条件）LLM 还是选错，是 LLM 指令跟随能力不够（小模型常见）。解法：描述问题靠重写工具描述（加"适用条件"和"不适用条件"的反例），LLM 能力问题靠换更大模型或用 Few-shot 示例示范工具选择。所以优先排查描述（成本低），描述到位还不行再考虑换模型（成本高）。

**Q：那为什么不直接用规则路由（意图识别决定用哪个工具），硬要让 LLM 选？规则不是 100% 准吗？**

因为工具组合的复杂度让规则不可行。单工具选择规则能做（意图=退款 → 退款工具），但复杂 Agent 是"多步骤、工具组合"——"分析这个月的销售数据并邮件发给老板"需要 query_db + python_exec + generate_chart + send_email 四个工具按顺序组合，且参数依赖（chart 用 db 的结果、email 附 chart）。用规则写死这个组合要穷举所有任务模式，维护爆炸。LLM 的价值是"根据任务动态规划工具组合"，这是规则做不到的。所以规则适合"单工具、意图明确"的简单场景，复杂 Agent 的多工具编排必须 LLM，这是 Agent 存在的意义。

### 第四层：方案权衡

**Q：高危操作你强制人工审核，但每个高危操作都等人审，用户体验差（等几分钟），怎么权衡安全和效率？**

按"风险等级 + 可逆性"分级，不是所有高危都实时人审。一级（不可逆 + 高影响，如删库、转账）必须实时人审，用户能理解等待（因为后果严重）。二级（可逆但麻烦，如发邮件给全公司）走"延迟执行 + 撤回窗口"——Agent 先生成草稿，给用户 60 秒撤回窗口，超时自动发，这样不阻塞但留后悔机会。三级（低风险高频，如发邮件给单人）不审核但全量审计（事后可追溯）。所以不是一刀切人审，是按风险分级用不同机制，把"实时人审"留给真正不可逆的操作，其余用"撤回窗口/审计"兼顾效率和安全。

**Q：为什么不直接禁止所有高危工具（不发邮件不删库），Agent 只做查询和分析，不就绝对安全了？**

因为这样 Agent 的价值大打折扣。用户要的是"端到端完成任务"（分析完直接发报告），不是"Agent 给我数据我自己再操作一遍"。如果 Agent 只能读不能写，它退化成"查询工具"，用户还是要手动执行最后一步，自动化价值丧失。所以正确做法不是禁止高危工具，是"允许但加护栏"——沙箱执行（python_exec 在隔离环境）、权限控制（按用户角色限定能用哪些工具）、人工审核（不可逆操作）、全量审计（所有操作可追溯）。安全的目标不是"绝对不出事"（那等于不做事），是"出事可控可追溯"。

### 第五层：验证与沉淀

**Q：你怎么评估复杂 Agent 的整体质量，而不是只看单一指标？**

建多维评估矩阵 + 端到端任务评测。维度包括：任务完成率（端到端做对了）、工具调用准确率（选对工具）、平均步数（效率，太多步可能是绕路）、安全违规数（红线）、成本（Token/费用）。关键是"端到端任务评测集"——100+ 个真实任务（含简单/复杂/边界），每个任务有明确的"成功标准"（如"邮件发送成功且数据准确"），跑全量算整体成功率。单一指标好（如工具准确率高）但任务完成率低，说明某环节（如编排/记忆）拖后腿。多维矩阵能定位木桶的短板，不是只看一块板。

**Q：这套 Agent 架构怎么复用到下个场景？**

沉淀成"Agent 脚手架"（scaffold），把工具层/编排/记忆/安全/评估做成可配置的通用框架。新场景接入只需：定义该场景的工具集、配置编排流程（复用模板）、写评测集。脚手架内置通用能力（工具检索、循环检测、人审流程、审计日志、评估闭环），不用每个项目重写。我之前的实践是把客服 Agent 的脚手架复用到数据分析 Agent，复用了 70% 的代码（安全层、评估层、记忆层通用），只换了工具集和编排逻辑，开发周期从 2 个月缩到 3 周。所以 Agent 能力要平台化沉淀，不是每个项目从零搭。

## 结构化回答




**30 秒电梯演讲：** 像组建特种部队——配装备(工具)、战术手册(编排)、通讯系统(记忆)、安全协议(防护)、实战演练(评估)。

**展开框架：**
1. **工具** — 定义/治理/检索
2. **编排** — ReAct/Plan-Execute/LangGraph
3. **记忆** — 短期+长期+任务

**收尾：** 多少个工具算复杂？





## 视频脚本

> 预计时长：4 分钟 | 由浅入深


| 时间 | 画面/字幕 | 口播台词 | 讲解要点 |
|------|----------|----------|----------|
| 0:00 | 标题卡：实战：带工具调用的复杂 Agent 智能体怎么构… | "像组建特种部队——配装备(工具)、战术手册(编排)、通讯系统(记忆)、安全协议(防护)、实…" | 开场钩子 |
| 0:20 | 核心概念图 | "构建带工具调用的复杂Agent=定义工具集→设计编排(ReAct/LangGraph)→加记忆和安全→评估迭代。核心是"…" | 核心定义 |
| 0:50 | 工具示意图 | "工具——定义/治理/检索" | 要点拆解1 |
| 1:30 | 对比/实战案例图 | "对比一下常见误区和工程实践，看真实场景里怎么取舍。" | 实战与对比 |
| 2:20 | 总结卡 | "记住核心要点。下期我们追问：多少个工具算复杂？——10+工具需检索管理？" | 收尾与钩子 |
