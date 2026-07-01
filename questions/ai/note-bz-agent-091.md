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

