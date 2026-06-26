---
id: note-bz-agent-042
difficulty: L3
category: ai
subcategory: Agent
tags:
  - B站面经
  - Agent
  - 最佳实践
  - 精装
feynman:
  essence: Agent七步精装=角色定义+工具配置+记忆设计+安全防护+评估闭环+成本控制+持续迭代。把demo级Agent"精装修"成生产级。
  analogy: 像毛坯房精装——地基(架构)有了，但要水电(工具/记忆)、装修(安全/体验)、验收(评估)才能入住(上线)。
  first_principle: Demo Agent能跑≠能用。生产级需要从"能用"到"好用"到"稳定用"，每一步都要精装。
  key_points:
    - 七步：角色/工具/记忆/安全/评估/成本/迭代
    - 核心：从demo到生产级的升级
    - 关键：稳定性和体验
    - 持续：评估闭环驱动迭代
first_principle:
  essence: 生产级Agent = Demo + 工程化（稳定/安全/可观测） + 体验优化。
  derivation: 'Demo验证可行性。生产要求7×24稳定、安全合规、成本可控、体验流畅。这些都要额外工程投入，即"精装"。'
  conclusion: 七步精装 = 把可运行的Demo升级为可上线的生产级Agent
follow_up:
  - 哪步最重要？——评估闭环（没有评估就没有改进）
  - 精装要多久？——Demo1周，精装1-3个月
  - 怎么判断精装完成？——SLA达标+评估通过+成本可控
---

# Hermes Agent 七步精装，让智能体真正会干活？

## 一、七步精装总览

```
┌──────────────────────────────────────────────────┐
│              Agent 七步精装                         │
├──────────────────────────────────────────────────┤
│                                                    │
│  Step 1: 角色定义（Who）                           │
│    明确Agent的身份、能力边界、语气风格              │
│                                                    │
│  Step 2: 工具配置（What）                          │
│    选对工具、写好描述、设置权限                     │
│                                                    │
│  Step 3: 记忆设计（Remember）                      │
│    短期/长期/用户画像，写入和检索策略               │
│                                                    │
│  Step 4: 安全防护（Safe）                          │
│    权限/审计/防注入/高危确认                       │
│                                                    │
│  Step 5: 评估闭环（Evaluate）                      │
│    指标定义+测试集+持续监控                        │
│                                                    │
│  Step 6: 成本控制（Cost）                          │
│    模型路由+缓存+Token优化                         │
│                                                    │
│  Step 7: 持续迭代（Iterate）                       │
│    Bad Case收集+用户反馈+版本更新                  │
│                                                    │
└──────────────────────────────────────────────────┘
```

## 二、各步详解

### Step 1：角色定义

```python
# 精装的角色定义（非简单一句"你是助手"）
AGENT_PERSONA = {
    "identity": "你是XX公司的智能客服",
    "expertise": ["订单查询", "退换货", "产品咨询"],
    "boundaries": {
        "can_do": ["查询", "建议", "发起流程"],
        "cannot_do": ["直接退款（需主管审批）", "承诺补偿"],
    },
    "tone": "专业、友善、简洁",
    "language_style": "口语化但不随意，用'您'",
    "fallback": "不确定或超范围时，诚实告知并转人工"
}
```

### Step 2：工具配置

```python
# 精装的工具（不只是注册，还有治理）
class ToolConfig:
    tools = [
        Tool(name="query_order", desc="...", permissions=["user"]),
        Tool(name="refund", desc="...", permissions=["admin"], 
             require_approval=True),  # 高危需审批
    ]
    
    # 工具路由（按上下文动态加载）
    def get_tools(self, context):
        if context.intent == "order":
            return [self.tools["query_order"]]
        # 而非全部塞给LLM
```

### Step 3：记忆设计

```python
# 精装的记忆系统
class MemoryConfig:
    short_term = {
        "window": 10,  # 最近10轮
        "overflow_strategy": "summarize"  # 超了摘要
    }
    long_term = {
        "storage": "vector_db",
        "write_threshold": 0.6,  # 重要性>0.6才记
        "ttl": 30 * 24 * 3600,   # 30天过期
        "user_isolation": True    # 用户隔离
    }
    profile = {
        "storage": "redis",
        "fields": ["name", "preferences", "history_summary"]
    }
```

### Step 4：安全防护

```python
class SecurityConfig:
    # 输入防护
    input_filters = ["prompt_injection_detection", "sensitive_data_mask"]
    # 权限控制
    permission_check = True
    # 高危操作
    high_risk_actions = ["delete", "pay", "send_external"]
    require_human_confirm = high_risk_actions
    # 审计
    audit_log = True
    audit_fields = ["user", "action", "params", "result", "timestamp"]
```

### Step 5：评估闭环（最关键）

```python
class EvaluationConfig:
    # 核心指标
    metrics = {
        "task_completion_rate": "任务完成率（北极星）",
        "tool_call_accuracy": "工具调用正确率",
        "user_satisfaction": "满意度（点赞率）",
        "avg_steps": "平均步数（效率）",
        "p99_latency": "P99延迟",
        "cost_per_task": "单任务成本"
    }
    
    # 测试集
    test_cases = load_test_suite()  # 100+标准case
    # 持续监控
    online_monitoring = True
    # Bad Case自动收集
    bad_case_collector = True
```

### Step 6：成本控制

```python
class CostConfig:
    # 模型分层
    model_routing = {
        "simple": "gpt-4o-mini",   # 简单任务
        "medium": "gpt-4o",        # 中等
        "complex": "claude-opus"   # 复杂
    }
    # 缓存
    cache = {
        "semantic_cache": True,     # 语义缓存
        "ttl": 3600
    }
    # Token预算
    max_tokens_per_task = 10000
    alert_threshold = 0.8  # 超80%预算告警
```

### Step 7：持续迭代

```python
class IterationConfig:
    # 反馈收集
    feedback_channels = ["thumbs", "survey", "complaint"]
    # Bad Case分析
    weekly_bad_case_review = True
    # A/B测试
    ab_testing = True
    # 版本管理
    versioning = "semantic"  # 语义版本号
    rollback_on_failure = True  # 失败自动回滚
```

## 三、精装前后对比

```
┌──────────────┬──────────────────┬──────────────────────┐
│ 维度          │ 精装前(Demo)        │ 精装后(生产)            │
├──────────────┼──────────────────┼──────────────────────┤
│ 角色          │ "你是助手"          │ 明确身份/边界/语气       │
│ 工具          │ 全部塞给LLM        │ 动态路由+权限治理        │
│ 记忆          │ 无或简单窗口        │ 分层+检索+遗忘          │
│ 安全          │ 无                 │ 多层防护+审计           │
│ 评估          │ 手动看几个case      │ 自动化指标+测试集        │
│ 成本          │ 不计               │ 模型路由+缓存+预算       │
│ 迭代          │ 改了上线           │ A/B测试+灰度+回滚       │
└──────────────┴──────────────────┴──────────────────────┘
```

## 四、面试加分点

1. **七步成体系**：角色→工具→记忆→安全→评估→成本→迭代，覆盖生产级全要素
2. **评估是核心**：没有评估闭环的 Agent 无法持续改进——强调"可度量"
3. **"精装"比喻好**：Demo 是毛坯，生产要精装，每步都不可省
