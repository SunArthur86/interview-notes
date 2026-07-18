---
id: note-xhs-ai-042
difficulty: L2
category: ai
subcategory: agent
tags:
- AI-Agent
- 任务规划
- Task-Decomposition
- DAG
- 面经
feynman:
  essence: "复合需求的任务排序本质是构建DAG（有向无环图）——LLM分析任务间的依赖关系，生成拓扑排序，可并行的并行，必须串行的按序执行"
  analogy: "做一顿年夜饭：红烧肉要炖2小时（先开始），蔬菜5分钟搞定（晚点做），汤要趁热喝（最后做）。你需要根据依赖关系和耗时排出最优顺序——Agent也一样，要分析哪些任务有先后依赖，哪些可以同时做"
  key_points:
  - 复合需求=多个子任务 → 需要任务分解+排序
  - 依赖分析：数据依赖（A的输出是B的输入）+ 时序依赖（必须先做A）
  - DAG拓扑排序：找出可并行的子任务
  - LLM做依赖分析：prompt中让LLM标注每个任务的depends_on
  - 错误处理：子任务失败时的回滚和重试策略
first_principle:
  essence: "任务排序的核心是依赖关系分析。如果两个任务无依赖，可以并行；有依赖，必须串行"
  derivation: "用户说'帮我分析竞品并生成报告发给老板'，这包含3个子任务：1) 收集竞品数据 2) 分析数据 3) 发送邮件。依赖关系：2依赖1（需要数据才能分析），3依赖2（需要报告才能发）。1和2之间没有可并行的部分。但如果用户说'分析竞品A和B'，则A和B的数据收集可以并行"
  conclusion: "LLM的推理能力使得语义层面的依赖分析成为可能——不再是硬编码的'步骤1→步骤2'，而是LLM根据任务内容动态判断依赖"
follow_up:
- 子任务拆分错误怎么修正？
- 任务状态怎么事务式回滚？
- LLM做依赖分析的准确率怎么样？
- 有没有更结构化的任务规划方法？（Tree of Thoughts）
memory_points:
- 复合需求→任务分解→DAG→拓扑排序
- 依赖类型：数据依赖+时序依赖
- LLM标注depends_on → 框架做拓扑排序
- 无依赖=并行，有依赖=串行
---

# 【AI Agent工程】复合需求怎么判断任务执行先后顺序？

> 来源：小红书「Java 后端转 AI Agent 面试吐槽」

## 一、问题场景

```
用户: "帮我查竞品定价、整理用户反馈、生成分析报告、发给团队"

子任务:
  ① 查竞品定价     ─── 独立，可立即执行
  ② 整理用户反馈   ─── 独立，可立即执行（与①并行）
  ③ 生成分析报告   ─── 依赖①和②的结果
  ④ 发送邮件给团队  ─── 依赖③的报告

依赖图(DAG):
  ①查定价 ──┐
            ├──→ ③生成报告 ──→ ④发邮件
  ②查反馈 ──┘

执行计划:
  Time 0: ①和②并行执行
  Time 1: 等①和②都完成
  Time 2: ③执行（需要①和②的数据）
  Time 3: ④执行（需要③的报告）
```

## 二、LLM驱动的任务分解与排序

```python
def decompose_and_order(user_request, llm, available_tools):
    """LLM分解任务并标注依赖关系"""
    
    plan = llm.generate(f"""
    用户请求: {user_request}
    可用工具: {[t.name for t in available_tools]}
    
    请分解为子任务并标注依赖关系，输出JSON:
    {{
      "tasks": [
        {{
          "id": 1,
          "description": "任务描述",
          "tool": "工具名",
          "depends_on": [],  // 依赖哪些前置任务的id
          "estimated_time": "30s"
        }}
      ],
      "execution_strategy": "说明哪些可以并行"
    }}
    
    依赖关系判断规则:
    - 数据依赖: 任务B需要任务A的输出 → B depends_on A
    - 时序依赖: 业务上必须先完成A再做B
    - 无依赖: 可并行执行
    """)
    
    return json.loads(plan)


def execute_plan(plan, tool_registry):
    """按DAG拓扑序执行，最大化并行"""
    tasks = {t['id']: t for t in plan['tasks']}
    completed = {}
    results = {}
    
    while tasks:
        # 找出所有依赖已完成的任务
        ready = [
            t for t in tasks.values()
            if all(dep in completed for dep in t.get('depends_on', []))
        ]
        
        if not ready:
            raise Exception("检测到循环依赖!")
        
        # 并行执行所有就绪任务
        with ThreadPoolExecutor(max_workers=len(ready)) as executor:
            futures = {}
            for task in ready:
                tool = tool_registry[task['tool']]
                args = {}
                # 注入依赖任务的输出作为输入
                for dep_id in task.get('depends_on', []):
                    args.update(results[dep_id])
                
                futures[executor.submit(tool, **args)] = task['id']
            
            for future in as_completed(futures):
                task_id = futures[future]
                results[task_id] = future.result()
                completed[task_id] = True
                del tasks[task_id]
    
    return results
```

## 三、子任务拆分错误的修正

```python
class SelfCorrectingPlanner:
    """带自我修正的任务规划器"""
    
    def plan_with_correction(self, request, llm, tools, max_retries=3):
        for attempt in range(max_retries):
            plan = self.decompose(request, llm, tools)
            
            # 验证计划合理性
            issues = self.validate_plan(plan, tools)
            if not issues:
                return plan
            
            # 让LLM修正
            plan = self.decompose(f"""
            原始请求: {request}
            上次计划有以下问题: {issues}
            请修正并重新生成计划。
            """, llm, tools)
        
        return plan  # 返回最后的尝试
    
    def validate_plan(self, plan, tools):
        """验证计划的合理性"""
        issues = []
        
        # 检查工具是否存在
        for task in plan['tasks']:
            if task['tool'] not in [t.name for t in tools]:
                issues.append(f"任务{task['id']}: 工具'{task['tool']}'不存在")
        
        # 检查循环依赖
        if self.has_cycle(plan):
            issues.append("检测到循环依赖")
        
        # 检查缺失依赖
        for task in plan['tasks']:
            for dep in task.get('depends_on', []):
                if dep not in [t['id'] for t in plan['tasks']]:
                    issues.append(f"任务{task['id']}: 依赖的{dep}不存在")
        
        return issues
```

## 四、任务状态事务式管理

```python
class TaskTransaction:
    """事务式任务管理——支持回滚"""
    
    def __init__(self):
        self.checkpoints = []  # 保存每步状态
        self.compensations = []  # 补偿操作（逆向）
    
    def execute_step(self, task, tool):
        """执行一步并保存检查点"""
        # 保存前置状态
        self.checkpoints.append({
            'task_id': task['id'],
            'state_before': self.get_current_state()
        })
        
        # 注册补偿操作（回滚用）
        if task.get('compensable'):
            self.compensations.append(
                tool.get_compensation()  # 如: 发了邮件→撤回
            )
        
        # 执行
        result = tool.execute(**task['args'])
        return result
    
    def rollback(self, to_step=None):
        """回滚到指定步骤"""
        target = to_step or len(self.checkpoints) - 1
        for cp in reversed(self.checkpoints[target:]):
            # 执行补偿操作
            if self.compensations:
                compensation = self.compensations.pop()
                compensation.execute()
            # 恢复状态
            self.restore_state(cp['state_before'])
```

## 五、方案对比

| 方案 | 原理 | 排序准确率 | 并行能力 | 回滚支持 | 适用场景 |
|------|------|-----------|---------|---------|---------|
| 固定流程 | 硬编码顺序 | 100% | 无 | 无 | 固定业务 |
| LLM单次分解 | LLM一次性生成DAG | 70-80% | 有 | 无 | 简单复合需求 |
| LLM+校验+修正 | 分解+验证+重试 | 85-90% | 有 | 无 | 中等复杂度 |
| ReAct逐步决策 | 每步实时决策 | 90%+ | 有限 | 有 | 开放域任务 |
| Plan+ReAct混合 | 先规划后执行+异常处理 | 95%+ | 有 | 有 | 生产级Agent |

## 六、面试加分点

1. **DAG优化**：不只是拓扑排序——关键路径法(CPM)可以找出最长路径，优化整体执行时间。如3个并行任务分别耗时30s/60s/10s，总时间取决于60s的那个（瓶颈）
2. **动态重规划**：执行中发现某个子任务失败或结果不符合预期，需要动态重规划——不是简单重试，而是可能改变后续步骤（如航班订不到→改查火车）
3. **任务优先级**：当资源有限（如只能同时执行3个工具）时，需要优先级队列——基于紧急度、用户偏好、SLA等动态排序
4. **Java后端类比**：Spring Batch的Step/Job概念可以类比——每个子任务是一个Step，复合需求是一个Job，DAG对应Job的Step编排。提及这个类比让Java转型者更容易理解
5. **评估指标**：任务规划质量用「完成率」（所有子任务成功完成的比例）、「并行效率」（实际并行度/理论最大并行度）、「端到端延迟」三个维度评估

## 结构化回答



**30 秒电梯演讲：** 做一顿年夜饭：红烧肉要炖2小时（先开始），蔬菜5分钟搞定（晚点做），汤要趁热喝（最后做）。你需要根据依赖关系和耗时排出最优顺序——Agent也一样，要分析哪些任务有先后依赖，哪些可以同时做

**展开框架：**
1. **复合** — 复合需求=多个子任务 → 需要任务分解+排序
2. **依赖分析** — 数据依赖（A的输出是B的输入）+ 时序依赖（必须先做A）
3. **DAG拓扑排序** — 找出可并行的子任务

**收尾：** 子任务拆分错误怎么修正？




## 视频脚本

> 预计时长：3 分钟 | 由浅入深


| 时间 | 画面/字幕 | 口播台词 | 讲解要点 |
|------|----------|----------|----------|
| 0:00 | 标题卡：复合需求怎么判断任务执行先后顺序？ | "做一顿年夜饭：红烧肉要炖2小时（先开始），蔬菜5分钟搞定（晚点做），汤要趁热喝（最后做）。…" | 开场钩子 |
| 0:20 | 核心概念图 | "复合需求的任务排序本质是构建DAG（有向无环图）——LLM分析任务间的依赖关系，生成拓扑排序，可并行的并行，必须串行的按…" | 核心定义 |
| 0:55 | 复合需求示意图 | "复合需求——复合需求=多个子任务 → 需要任务分解+排序" | 要点拆解1 |
| 1:30 | 对比/实战案例图 | "对比一下常见误区和工程实践，看真实场景里怎么取舍。" | 实战与对比 |

## 苏格拉底式面试追问

| 追问层级 | 面试官可能这样问 | 高分回答方向 |
|----------|------------------|--------------|
| 目标追问 | 判断复合需求任务执行顺序的核心目标是什么？ | 正确识别任务间的依赖关系（前置/并行/串行），保证执行顺序正确且效率最高 |
| 证据追问 | 怎么识别任务依赖关系？有哪些方法？ | 方法：用LLM做任务分解和依赖分析、DAG有向无环图建模、拓扑排序确定执行顺序、识别并行机会 |
| 边界追问 | 什么任务能并行，什么必须串行？ | 无数据依赖的任务可并行（如查多个独立信息）；有数据依赖的必须串行（如先查询再用结果计算） |
| 反例追问 | LLM一次性分解所有任务可靠吗？ | 不一定。复杂任务分解可能出错、依赖识别不准；需要校验DAG无环、必要时人工确认或分步分解 |
| 风险追问 | 顺序判断错误有什么后果？ | 依赖未满足导致任务失败、数据不一致、重复执行浪费资源、用户体验差 |
| 验证追问 | 怎么验证顺序判断正确？ | 构造复合任务测试集、对比人工标注顺序、监控任务失败率、依赖冲突告警 |
| 沉淀追问 | 任务编排怎么沉淀？ | 规范：DAG建模+拓扑排序、依赖校验、并行优化、失败回滚 |

### 现场对话示例
**面试官**：复合需求怎么判断任务执行先后顺序？
**候选人**：用LLM做任务分解和依赖分析、DAG有向无环图建模、拓扑排序确定执行顺序、识别无依赖任务并行优化。
**面试官**：什么任务能并行什么必须串行？
**候选人**：无数据依赖的可并行（查多个独立信息），有数据依赖的必须串行（先查询再用结果），用DAG识别依赖关系。
**面试官**：LLM分解可靠吗？
**候选人**：不一定，复杂任务可能分解出错或依赖识别不准，需要校验DAG无环、必要时人工确认或分步分解，配合失败回滚。
