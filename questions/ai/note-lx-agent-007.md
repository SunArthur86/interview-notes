---
id: note-lx-agent-007
difficulty: L3
category: ai
subcategory: Agent
tags:
  - 联想
  - 面经
  - 一面
  - 任务分解
  - 多Agent
  - 上下文隔离
feynman:
  essence: 用户一次提多个需求时，Agent需要先拆分成独立子任务，每个子任务在隔离上下文中执行，通过结构化中间结果传递信息，避免互相污染
  analogy: 就像医院分诊——病人说"头痛、脚痛还想体检"，分诊台拆成3个独立科室挂号（任务分解），各科室独立诊断不看其他科的结果（隔离），最后汇总出综合报告（结果整合）
  first_principle: 多任务在同一个上下文中执行会互相干扰——前面任务的工具结果、中间推理会干扰后续任务的判断。隔离执行+结构化传递是最优解
  key_points:
    - 任务拆分：将多需求拆成独立子任务，明确边界
    - 上下文隔离：每个子任务独立会话，不共享中间状态
    - 结构化传递：通过JSON/结构化数据传递结果，不传原始对话
    - 结果整合：主Agent汇总各子任务结果，解决跨任务依赖
first_principle:
  essence: 任务间信息耦合度越低，并行执行的收益越大
  derivation: '用户说"查天气+订机票+写周报"，三个任务完全独立。串行执行需9s（3s×3），并行执行只需3s。但若在同一上下文串行，天气查询的中间结果会占用后续任务的Token空间，影响质量'
  conclusion: 多需求分解 = 任务拆分器 + 隔离执行池 + 结果聚合器
follow_up:
  - 任务间有依赖时（如"查完天气再决定带什么行李"）怎么处理？
  - 如何判断两个任务是否可以并行？
  - 并行子Agent的结果冲突时（如时间矛盾）怎么仲裁？
---

# 用户一次提多个需求时，Agent的任务分解应该怎么做才不会互相污染？

## 问题场景

```
用户输入: "帮我查下明天北京的天气，顺便订一张去北京的机票，
          对了，给我把这周的会议纪要整理一下"

❌ 不做分解（同一上下文执行）：
  步骤1: 查天气 → 返回一大段天气信息
  步骤2: 订机票 → 被天气信息干扰，可能把天气参数误当航班参数
  步骤3: 整理纪要 → 上下文里全是天气和机票信息，纪要质量下降

✅ 做分解（隔离执行）：
  子任务1: 查天气 → 独立执行 → 返回结构化结果
  子任务2: 订机票 → 独立执行 → 返回结构化结果
  子任务3: 整理纪要 → 独立执行 → 返回结构化结果
  主Agent: 汇总三个结果 → 统一回复用户
```

## 分解架构

```python
class TaskDecomposer:
    """主Agent负责任务分解和结果整合"""

    async def process(self, user_input: str) -> str:
        # Step 1: 任务拆分
        subtasks = await self._decompose(user_input)

        # Step 2: 依赖分析
        execution_plan = self._plan_execution(subtasks)

        # Step 3: 执行（并行/串行）
        results = await self._execute_plan(execution_plan)

        # Step 4: 结果整合
        final_response = await self._synthesize(results, user_input)
        return final_response

    async def _decompose(self, user_input: str) -> list:
        """LLM拆分多需求为独立子任务"""
        prompt = f"""将以下用户输入拆分为独立的子任务。

规则：
1. 每个子任务必须目标明确、边界清晰
2. 标注子任务间的依赖关系
3. 每个子任务指定需要的工具

用户输入：{user_input}

输出JSON：
{{
  "subtasks": [
    {{
      "id": "task_1",
      "description": "任务描述",
      "tools": ["weather_api"],
      "depends_on": [],
      "output_schema": {{"city": "str", "temperature": "number", "condition": "str"}}
    }}
  ]
}}"""
        return parse_json(await llm_call(prompt))
```

## 隔离执行

```python
import asyncio

class IsolatedExecutor:
    """每个子任务在独立的上下文中执行"""

    async def execute_all(self, plan: dict) -> dict:
        results = {}

        # 按依赖层级分组执行
        for layer in plan['execution_layers']:
            # 同一层的任务可以并行
            tasks = []
            for subtask in layer:
                tasks.append(self._execute_isolated(subtask, results))

            layer_results = await asyncio.gather(*tasks)
            for subtask, result in zip(layer, layer_results):
                results[subtask['id']] = result

        return results

    async def _execute_isolated(self, subtask: dict, upstream_results: dict):
        """独立上下文执行——不共享对话历史"""
        # 只传入必要的上游结果（结构化数据，非原始对话）
        context = self._extract_minimal_context(subtask, upstream_results)

        # 创建独立的子Agent会话
        sub_agent = SubAgent(
            model='7b',  # 子任务用小模型
            tools=subtask['tools'],
            system_prompt=f"你是一个专注于'{subtask['description']}'的专业助手。",
        )

        result = await sub_agent.run(
            input=context,
            expected_output=subtask['output_schema'],
        )

        # 只返回结构化结果，不返回中间对话
        return {
            'task_id': subtask['id'],
            'status': 'success' if result else 'failed',
            'result': result,
        }
```

## 依赖处理

```python
def _plan_execution(self, subtasks: list) -> dict:
    """拓扑排序处理任务依赖"""
    # 构建依赖图
    layers = []
    remaining = list(subtasks)

    while remaining:
        # 找出无依赖（或依赖已满足）的任务
        ready = [t for t in remaining if all(
            dep in [l['id'] for layer in layers for l in layer]
            for dep in t.get('depends_on', [])
        )]
        if not ready:
            raise ValueError("检测到循环依赖！")

        layers.append(ready)
        remaining = [t for t in remaining if t not in ready]

    return {'execution_layers': layers}
```

## 防污染检查清单

```
✅ 上下文隔离检查：
  □ 每个子Agent使用独立的对话历史？
  □ 子任务间只通过结构化JSON传递数据？
  □ 上游结果只传"必需字段"，不传完整对话？
  □ 子Agent的System Prompt明确限定任务范围？

✅ 结果质量检查：
  □ 并行结果汇总后逻辑是否自洽？
  □ 时间/数量等跨任务数据是否一致？
  □ 子任务失败是否影响其他任务的独立性？
```

## 面试加分点

1. **任务粒度**：不是越细越好——过细的拆分会增加协调开销，粒度应以"能独立完成且有明确输出"为准
2. **Token效率**：隔离执行后每个子任务只需很小的上下文窗口（~1000 Token），可以全部用7B
3. **容错设计**：某个子任务失败不应阻塞其他任务，失败任务的输出标记为null由主Agent降级处理
4. **用户感知**：多任务并行时应有进度反馈（"正在查询天气...✅ 正在搜索机票..."），不能让用户干等
