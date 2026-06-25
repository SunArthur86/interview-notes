---
id: note-tt-agent-010
difficulty: L3
category: ai
subcategory: Agent
tags:
  - 淘天
  - 面经
  - 二面
  - Human-in-the-loop
  - HITL
  - 人工审核
feynman:
  essence: Human-in-the-loop是在Agent执行链路中设置人工审核断点，在高风险/低置信度/不可逆操作前暂停等待人工确认，平衡自动化效率与安全可控
  analogy: 就像银行的自动审批系统——小额转账自动通过（全自动），大额转账需要短信验证（人工确认），异常交易直接冻结（人工介入）
  first_principle: Agent自主性和安全性是Trade-off。全自主效率高但风险不可控，全人工安全但效率低。HITL在关键节点设置"检查站"，实现80%自动化+20%人工审核
  key_points:
    - 操作前确认：不可逆操作（下单/退款/删除）执行前暂停
    - 低置信度审核：模型置信度低于阈值时转人工
    - 异常兜底：连续失败/超时/安全风险时人工介入
    - 定期抽检：随机抽样审核Agent输出质量
first_principle:
  essence: 人工介入的边际成本应低于错误操作的边际损失
  derivation: '设人工审核成本C_human=2元/次，错误操作损失C_error=500元/次。当模型置信度<阈值τ时，预期损失=P(error)×C_error。当P(error)×500 > 2，即P(error)>0.4%时就值得人工审核'
  conclusion: HITL不是每个节点都加，而是在"错误损失大×出错概率非零"的节点加
follow_up:
  - 人工审核的SLA怎么定？用户等太久怎么办？
  - 如何减少需要人工审核的比例？模型置信度校准怎么做？
  - 批量审核vs实时审核怎么选？
---

# Human-in-the-loop人工断点怎么设计？哪些环节需要人工介入审批？

## 断点设计框架

```
Agent执行链路中的断点类型：

┌─────────────────────────────────────────────────────────┐
│                    Agent执行流程                          │
│                                                         │
│  [意图理解] → [信息检索] → [方案生成] → [⚠️确认] → [执行]  │
│                                         ↑                │
│                                    断点1：操作前确认      │
│                                                         │
│  [意图理解] → [⚠️审核] → [信息检索] → ...                 │
│                  ↑                                       │
│             断点2：低置信度审核                           │
│                                                         │
│  ... → [执行] → [⚠️异常] → [人工接管]                     │
│                     ↑                                    │
│                断点3：异常兜底                             │
│                                                         │
│  [执行完成] → [抽样审核]                                  │
│                    ↑                                    │
│               断点4：定期抽检                             │
└─────────────────────────────────────────────────────────┘
```

## 四类断点详解

### 1. 操作前确认（不可逆操作）

```python
IRREVERSIBLE_ACTIONS = [
    'place_order',       # 下单
    'process_refund',    # 退款
    'delete_data',       # 删除数据
    'modify_account',    # 修改账户
    'transfer_money',    # 转账
    'send_notification', # 发送通知（不可撤回）
]

def check_before_execute(action: str, params: dict) -> dict:
    if action in IRREVERSIBLE_ACTIONS:
        return {
            'need_approval': True,
            'message': f"即将执行{action}，参数：{params}。请确认是否继续？",
            'options': ['确认执行', '取消', '修改参数'],
            'timeout': 300,  # 5分钟超时
        }
    return {'need_approval': False}
```

### 2. 低置信度审核

```python
def confidence_gate(model_output: dict, thresholds: dict) -> dict:
    """模型置信度低于阈值时转人工"""
    confidence = model_output.get('confidence', 0)
    action_type = model_output.get('type', 'general')

    threshold = thresholds.get(action_type, 0.7)

    if confidence < threshold:
        return {
            'need_review': True,
            'reason': f'置信度{confidence:.0%} < 阈值{threshold:.0%}',
            'priority': 'high' if confidence < 0.3 else 'normal',
        }
    return {'need_review': False}
```

### 3. 异常兜底

```python
def exception_handler(error_type: str, context: dict) -> dict:
    """连续失败/超时/安全风险时人工接管"""
    if error_type == 'consecutive_failure':
        return {'escalate': True, 'priority': 'urgent',
                'message': 'Agent连续失败3次，请人工接管'}

    if error_type == 'safety_risk':
        return {'escalate': True, 'priority': 'critical',
                'message': '检测到潜在安全风险，已暂停执行'}

    if error_type == 'budget_exceeded':
        return {'escalate': True, 'priority': 'high',
                'message': 'Token消耗超预算，需人工确认是否继续'}
```

### 4. 定期抽检

```python
import random

def sampling_review(agent_outputs: list, sample_rate: float = 0.05):
    """随机抽样5%的Agent输出进行人工质检"""
    sample_size = max(1, int(len(agent_outputs) * sample_rate))
    sampled = random.sample(agent_outputs, sample_size)
    return {
        'review_queue': sampled,
        'purpose': '质量监控 + 发现Agent盲区',
    }
```

## 面试加分点

1. **分级机制**：不是所有审核都同等优先级——下单确认（用户自助）、安全风险（安全团队介入）、质量抽检（运营团队定期）
2. **异步vs同步**：不可逆操作用同步确认（用户等），质量抽检用异步审核（不打断流程）
3. **置信度校准**：模型输出的置信度可能不准（过度自信），需要用Platt Scaling或Temperature Scaling校准
4. **持续优化**：统计人工审核通过率——如果通过率>95%，说明阈值太保守，可以调低；如果<50%，说明模型质量需提升
