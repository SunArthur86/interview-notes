---
id: note-lx-agent-006
difficulty: L3
category: ai
subcategory: Agent
tags:
  - 联想
  - 面经
  - 一面
  - 多Agent
  - 模型分配
  - 成本优化
feynman:
  essence: 主Agent和子Agent不一定用同一模型。主Agent负责任务路由和编排（需强推理→大模型），子Agent负责具体执行（简单任务→小模型），通过差异化分配优化成本和质量
  analogy: 就像公司架构——CEO（主Agent，32B）负责战略决策和资源分配，各部门经理（子Agent，14B）负责执行具体任务，实习生（子Agent，7B）做简单重复工作
  first_principle: 不同子任务的难度差异很大，统一用大模型浪费成本，统一用小模型质量不达标。差异化分配是最优解
  key_points:
    - 主Agent需要强推理：意图理解、任务拆分、结果整合→32B
    - 执行类子Agent：搜索、提取、翻译→7B/14B
    - 验证类子Agent：质量检查、安全审核→14B
    - 分配依据：任务复杂度×质量要求×成本约束
first_principle:
  essence: 模型能力与成本正相关，按任务难度匹配模型能力是最优策略
  derivation: '主Agent做1次路由决策（需32B，成本¥8），3个子Agent各做1次执行（7B够用，成本¥0.5×3=¥1.5）。总计¥9.5。如果全用32B：4×8=¥32。如果全用7B：路由决策质量不够，整体成功率下降15%'
  conclusion: 模型分配 = 主Agent保质量 + 子Agent控成本，通过任务路由实现差异化
follow_up:
  - 主Agent路由决策失误怎么发现和纠正？
  - 子Agent结果质量不达标时，是否升级到更大模型？
  - 不同厂商模型（GPT-4/Claude/GLM）混用可行吗？
---

# 主Agent和子Agent的模型该怎么分配，为什么不一定都用同一个大模型？

## 分配原则

```
多Agent系统中的模型分层：

┌──────────────────────────────────┐
│         主Agent (Router)          │
│         模型: 32B / GPT-4         │
│         职责: 意图理解+任务拆分     │
│               +结果整合+质量把关    │
│         要求: 强推理+全局视野       │
└──────────┬───────────┬───────────┘
           │           │
     ┌─────▼───┐  ┌───▼─────┐  ┌────────┐
     │子Agent A │  │子Agent B │  │子Agent C│
     │7B/14B    │  │7B/14B   │  │14B/32B  │
     │搜索执行   │  │数据处理  │  │质量验证  │
     │高频简单  │  │结构化    │  │需判断力  │
     └─────────┘  └─────────┘  └────────┘
```

## 分配决策框架

```python
class ModelAssignmentPolicy:
    """根据子任务特征分配模型"""

    def assign(self, subtask: dict) -> str:
        complexity = subtask['complexity']    # simple/medium/complex
        quality_req = subtask['quality_req']  # high/medium/low
        frequency = subtask['frequency']      # high/low

        # 决策矩阵
        if complexity == 'complex' or quality_req == 'high':
            return 'qwen-32b'   # 复杂推理/高质量要求
        elif complexity == 'medium':
            return 'qwen-14b'   # 中等任务
        else:
            return 'qwen-7b'    # 简单高频任务

    def get_assignment_table(self):
        return {
            # 子Agent角色 → 推荐模型 → 理由
            '搜索执行Agent': '7B',
              # 任务简单（调API+格式化），7B准确率>95%，成本最低
            '信息提取Agent': '7B',
              # 结构化提取（NER/分类），7B足够
            '翻译Agent': '14B',
              # 翻译需要理解语义，14B质量更好
            '摘要Agent': '14B',
              # 需要理解全文逻辑，14B更可靠
            '质量验证Agent': '32B',
              # 质量验证需要批判性思维，32B判断更准
            '安全审核Agent': '32B',
              # 安全相关不能出错，用最强模型
            '创意生成Agent': '32B',
              # 创意需要发散思维，32B更有多样性
            '主Agent(路由)': '32B',
              # 路由决策影响全局，必须用最强模型
        }
```

## 动态升级机制

```python
class AdaptiveModelAgent:
    """子Agent结果质量不达标时自动升级模型"""

    async def execute_with_escalation(self, task: dict):
        # Level 1: 先用小模型尝试
        result = await self.call_model('7b', task)

        # 质量自评
        quality_score = await self.assess_quality(result)

        if quality_score >= 0.85:
            return result  # 质量够用

        # Level 2: 升级到14B
        result = await self.call_model('14b', task)
        quality_score = await self.assess_quality(result)

        if quality_score >= 0.85:
            return result

        # Level 3: 最终用32B兜底
        return await self.call_model('32b', task)
```

## 成本对比

```
场景：日均10万次请求，5个子Agent

全用32B：  10万 × 5 × ¥8 = ¥4,000,000/天  ❌ 太贵
全用7B：   10万 × 5 × ¥0.5 = ¥250,000/天  ❌ 质量不够
差异化分配：
  主Agent(32B): 10万 × ¥8 = ¥800,000
  搜索Agent(7B): 10万 × ¥0.5 = ¥50,000
  提取Agent(7B): 10万 × ¥0.5 = ¥50,000
  摘要Agent(14B): 10万 × ¥2 = ¥200,000
  验证Agent(32B): 10万 × ¥8 = ¥800,000
  总计: ¥1,900,000/天  ✅ 节省52.5%
```

## 面试加分点

1. **不是越小越好**：关键路径上的Agent（路由、验证、安全）绝不能省模型，省下的成本不够一次事故的损失
2. **混合厂商**：主Agent用GPT-4（推理强），子Agent用开源模型（成本低），通过统一API抽象层管理
3. **监控指标**：每个子Agent独立监控成功率、延迟、成本，发现退化及时调整模型
4. **A/B测试**：换模型必须做A/B测试，确保质量不下降再全量切换
