---
id: note-bd3-016
difficulty: L3
category: ai
subcategory: Agent
tags:
  - 字节跳动
  - 面经
  - 二面
feynman:
  essence: Agent循环调用本质是LLM陷入了"尝试-失败-再尝试同一方法"的死锁。解决需要引入状态追踪、终止条件和策略切换
  analogy: '像一个打不开门的维修工——反复用同一把钥匙拧（循环调用）。正确做法是：数一下试了几次→3次不行换把锁→还不行叫开锁公司→最后实在不行报告问题（终止+升级）'
  first_principle: 'Agent的循环调用源于LLM的上下文窗口中没有"我已经试过了"的有效信号。需要在系统层注入状态追踪和硬性终止条件'
  key_points:
    - '硬性终止: max_iterations + timeout'
    - '软性终止: 相同工具+相同参数的重复检测'
    - '策略切换: N次失败后自动降级到不同方案'
    - '连续3次失败: 记录日志 + 转人工/返回默认值'
first_principle:
  essence: Agent的鲁棒性需要"防御性设计"——假设每一步都可能失败
  derivation: 'LLM是不确定性的，工具调用也可能失败。系统的容错设计不能依赖LLM自身的判断，必须在工程层面设置硬性约束'
  conclusion: Agent系统必须实现：最大迭代次数、重复检测、策略降级、失败升级四个安全网
follow_up:
  - 如何设计Agent的观测性(Observability)？
  - Agent的置信度如何估计？
  - 多Agent系统中一个Agent卡住怎么处理？
---

# Agent经常出现循环调用工具无法停止的问题，你会采取哪些解决方案？连续失败三次应如何处理？

> 来源：字节跳动大模型技术面试二面

## 循环调用的根因分析

```
┌─────────────────────────────────────────────────────────┐
│              Agent循环调用的典型场景                      │
│                                                         │
│  Thought: 需要查询用户订单状态                            │
│  Action: query_order("user_123")                        │
│  Observation: Error - Connection timeout                │
│                                                         │
│  Thought: 订单查询失败了，再试一次                        │
│  Action: query_order("user_123")     ← 完全相同!        │
│  Observation: Error - Connection timeout                │
│                                                         │
│  Thought: 再试一次...                                   │
│  Action: query_order("user_123")     ← 死循环!          │
│  Observation: Error - Connection timeout                │
│  ... 无限循环 ...                                        │
│                                                         │
│  根因:                                                   │
│  1. LLM没有"已尝试N次"的计数信号                         │
│  2. 上下文中重复的失败记录导致LLM无法跳转                 │
│  3. 没有工具调用的硬性终止条件                            │
│  4. LLM倾向于"重复已知的唯一方案"                        │
└─────────────────────────────────────────────────────────┘
```

## 四层防御体系

### 第1层：硬性终止条件

```python
class AgentLoop:
    def __init__(self):
        self.max_iterations = 10        # 最大循环次数
        self.max_tool_calls = 20        # 最大工具调用次数
        self.timeout_seconds = 120      # 全局超时
        self.tool_timeout = 15          # 单次工具调用超时
    
    def run(self, task):
        history = []
        
        for i in range(self.max_iterations):
            # ★ 硬性终止: 达到最大迭代次数
            if i >= self.max_iterations - 1:
                return self.handle_max_iterations(task, history)
            
            # LLM推理
            action = self.llm.plan(task, history)
            
            # ★ 硬性终止: 如果LLM说DONE
            if action.type == "final_answer":
                return action.content
            
            # ★ 工具调用超时
            try:
                result = self.call_tool_with_timeout(
                    action, timeout=self.tool_timeout
                )
            except TimeoutError:
                result = {"error": "Tool execution timed out"}
            
            history.append({"action": action, "result": result})
        
        # ★ 到达最大循环次数
        return self.handle_max_iterations(task, history)
```

### 第2层：重复检测

```python
class DuplicateActionDetector:
    def __init__(self, max_retries=3):
        self.action_history = []
        self.max_retries = max_retries
    
    def check_and_block(self, tool_name, params):
        """检测重复调用"""
        
        # 生成调用的指纹
        fingerprint = f"{tool_name}:{hash(json.dumps(params, sort_keys=True))}"
        
        # 统计相同调用次数
        same_count = sum(1 for a in self.action_history 
                        if a == fingerprint)
        
        if same_count >= self.max_retries:
            # ★ 同一调用超过3次 → 阻止并切换策略
            return {
                "blocked": True,
                "reason": f"Tool '{tool_name}' called {same_count} times "
                         f"with same params. Switching strategy."
            }
        
        self.action_history.append(fingerprint)
        return {"blocked": False}
```

### 第3层：策略降级

```python
class StrategyDegradation:
    """N次失败后自动降级到不同方案"""
    
    def __init__(self):
        self.failure_count = {}
    
    def get_strategy(self, task_type, current_failure_count):
        """根据失败次数选择降级策略"""
        
        strategies = {
            0: "primary",       # 首选方案
            1: "retry_with_fix", # 修复后重试
            2: "alternative",    # 替代方案
            3: "degraded",       # 降级方案
        }
        
        if current_failure_count >= 3:
            return strategies.get(3)
        return strategies.get(current_failure_count, "degraded")
    
    def execute_degraded(self, task, failure_history):
        """
        连续3次失败后的降级处理:
        
        方案A: 返回缓存的/默认的答案
        方案B: 换一个更简单的方法
        方案C: 转人工处理
        方案D: 返回"暂时无法处理"
        """
        # 1. 尝试从缓存获取
        cached = self.cache.get(task.id)
        if cached:
            return cached
        
        # 2. 尝试简化任务
        simplified = self.simplify_task(task)
        if simplified != task:
            return self.agent.run(simplified)
        
        # 3. 记录失败 + 转人工
        self.log_failure(task, failure_history)
        return {
            "status": "escalated",
            "message": "抱歉，暂时无法处理此请求，已转人工服务。",
            "ticket_id": self.create_ticket(task)
        }
```

### 第4层：Prompt工程引导

```python
# 在System Prompt中加入循环预防指令
ANTI_LOOP_PROMPT = """
重要规则:
1. 如果同一个工具以相同参数调用超过2次且都失败，请立即更换策略
2. 如果所有可用工具都尝试过且失败，请直接回答用户"暂时无法处理"
3. 不要重复已经失败的操作，尝试分析失败原因后再重试
4. 你已经执行了 {step_count} 步，最多允许 {max_steps} 步
5. 最近失败的工具有: {failed_tools}
"""
```

## 连续3次失败的处理流程

```
┌──────────────────────────────────────────────────────┐
│            连续3次失败的处理决策                        │
│                                                      │
│  第1次失败                                            │
│    → 记录失败原因                                     │
│    → 分析错误类型(超时/参数错误/权限不足)              │
│    → 自动修复(如重试/修正参数)                         │
│                                                      │
│  第2次失败                                            │
│    → 切换替代工具                                     │
│    → 通知LLM前一次失败的原因                           │
│    → 在Prompt中加入失败历史                           │
│                                                      │
│  第3次失败 ★                                          │
│    → 立即终止当前任务路径                              │
│    → 执行降级策略:                                    │
│       A. 返回默认/兜底回答                             │
│       B. 转人工客服                                   │
│       C. 保存任务状态, 稍后异步重试                     │
│    → 记录Bad Case到分析库                              │
│    → 触发告警通知                                     │
└──────────────────────────────────────────────────────┘
```

```python
class FailureHandler:
    """连续失败的统一处理器"""
    
    def handle_failures(self, task, failures):
        """
        failures: List[Failure] - 已记录的失败列表
        """
        failure_count = len(failures)
        
        if failure_count == 1:
            # 第1次: 分析+重试
            return self.analyze_and_retry(task, failures[-1])
        
        elif failure_count == 2:
            # 第2次: 切换工具
            alternative = self.find_alternative_tool(failures[-1])
            if alternative:
                return self.try_alternative(task, alternative)
            return self.escalate(task)
        
        elif failure_count >= 3:
            # 第3次: 降级处理
            return self.degrade(task, failures)
    
    def degrade(self, task, failures):
        """降级处理策略"""
        failure_summary = "\n".join([
            f"- {f.tool_name}: {f.error}" for f in failures
        ])
        
        # 1. 尝试用LLM直接回答(不调用工具)
        direct_answer = self.llm.generate(f"""
        任务: {task}
        以下工具调用均失败:
        {failure_summary}
        
        请在不使用工具的情况下，基于你的知识尽力回答。
        如果无法回答，请明确告知。
        """)
        
        if direct_answer.confidence > 0.6:
            return direct_answer
        
        # 2. 创建工单转人工
        return {
            "status": "human_handoff",
            "reason": "连续3次工具调用失败",
            "failures": failure_summary,
            "ticket_id": self.create_ticket(task, failures)
        }
```

## 监控与改进

```python
# 循环调用监控指标
metrics = {
    "avg_iterations_per_task": "平均每任务迭代次数(目标<5)",
    "max_iterations_hit_rate": "达到最大迭代次数的比例(目标<5%)",
    "tool_failure_rate": "工具调用失败率(目标<10%)",
    "degradation_rate": "降级处理比例(目标<3%)",
    "duplicate_call_rate": "重复调用比例(目标<2%)",
}

# Bad Case闭环分析
class BadCaseCollector:
    def collect(self, task, failures, resolution):
        """收集循环调用的Bad Case用于后续优化"""
        bad_case = {
            "task": task,
            "failure_chain": failures,
            "final_resolution": resolution,
            "timestamp": now(),
            "root_cause": self.analyze_root_cause(failures),
        }
        self.bad_case_store.add(bad_case)
        
        # 定期分析 → 优化Prompt/工具配置
```

**面试加分点**：提到LangGraph的`recursion_limit`参数可以硬性限制Agent循环次数；提到ReAct论文建议在Observation中注入"We've tried X times"的提示信息；提到CrewAI的多Agent系统通过"Router Agent"检测单个Agent的异常并重新分配任务；提到AutoGen的"Stop"消息类型可以让任何参与者终止对话；提到实际生产环境中应该实现"断路器模式"(Circuit Breaker)——当某个工具连续失败超过阈值时暂时禁用该工具。
