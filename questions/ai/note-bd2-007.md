---
id: note-bd2-007
difficulty: L3
category: ai
subcategory: Agent
tags:
  - 字节
  - 面经
  - Agent
  - Benchmark
  - 评估
  - UTBench
feynman:
  essence: 'Benchmark通过标准化的任务集和评分规则，量化衡量Agent/模型的生成质量和综合能力'
  analogy: '就像高考——同一套卷子、同一个评分标准，用分数横向比较不同学生的水平。Benchmark就是AI的"高考"'
  first_principle: '模型能力是多维度的(推理、编码、对话、工具使用)，单一指标无法全面评估。Benchmark通过多任务、多维度的标准化测试提供全面的能力画像'
  key_points:
    - 'UTBench: 针对工具使用能力的Benchmark，测试Agent调用工具的准确性和效率'
    - '通用Benchmark: MMLU(知识), HumanEval(编码), GSM8K(数学), MATH(高级数学)'
    - 'Agent Benchmark: AgentBench, GAIA, ToolBench, WebArena'
    - '评估方法: 准确率、通过率、人工评分、LLM-as-Judge'
first_principle:
  essence: '评估是优化的前提——没有度量就没有改进'
  derivation: '你无法改进一个无法衡量的东西。Benchmark提供了可比较、可复现、可追踪的量化指标，是Agent迭代的基础'
  conclusion: '选择合适的Benchmark比盲目优化更重要——评估什么决定了改进什么'
follow_up:
  - 'UTBench和AgentBench有什么区别？'
  - '如何防止模型在Benchmark上"刷分"而不真正提升能力？'
  - '自建评估数据集要注意什么？'
---

# UTBench等Benchmark如何衡量模型生成效果？

## 主流Benchmark全景

```
┌──────────────────────────────────────────────────┐
│              AI Benchmark 全景图                    │
│                                                    │
│  ┌─ 基础能力 ──────────────────────────────┐      │
│  │ MMLU     : 57科目多选, 测知识广度         │      │
│  │ GSM8K    : 小学数学应用题, 测数学推理      │      │
│  │ HumanEval: Python编程, 测代码生成         │      │
│  │ MATH     : 高中竞赛数学, 测高级推理        │      │
│  └────────────────────────────────────────┘      │
│                                                    │
│  ┌─ Agent能力 ─────────────────────────────┐      │
│  │ AgentBench : 多场景Agent能力(电商/游戏/DB)│      │
│  │ GAIA       : 通用AI助手, 需要多步推理     │      │
│  │ ToolBench  : 工具调用能力(RapidAPI)       │      │
│  │ WebArena   : 网页操作Agent               │      │
│  │ UTBench    : 工具使用Benchmark            │      │
│  └────────────────────────────────────────┘      │
│                                                    │
│  ┌─ 对齐与安全 ────────────────────────────┐      │
│  │ TruthfulQA: 测幻觉和事实准确性            │      │
│  │ HellaSwag : 常识推理                      │      │
│  │ MT-Bench  : 多轮对话质量                  │      │
│  └────────────────────────────────────────┘      │
└──────────────────────────────────────────────────┘
```

## UTBench 详解

```python
"""
UTBench (Utility Tool Benchmark) 核心评估维度:

1. 工具选择准确率: 给定任务，Agent是否选对了工具
2. 参数构造准确率: 工具参数是否正确
3. 调用时机准确率: 是否在正确的时机调用工具
4. 结果解析准确率: 是否正确理解工具返回值
5. 多工具编排: 是否能正确组合多个工具
"""

class UTBenchEvaluator:
    """UTBench风格的评估器"""
    
    def __init__(self):
        self.test_cases = [
            {
                "id": "utb_001",
                "task": "查询北京明天的天气",
                "available_tools": ["get_weather", "search_web", "calculator"],
                "expected_tool": "get_weather",
                "expected_params": {"city": "北京", "date": "明天"},
                "expected_output_type": "weather_info"
            },
            {
                "id": "utb_002", 
                "task": "计算(123+456)*7",
                "available_tools": ["get_weather", "search_web", "calculator"],
                "expected_tool": "calculator",
                "expected_params": {"expression": "(123+456)*7"},
                "expected_output_type": "number"
            }
        ]
    
    def evaluate(self, agent):
        """评估Agent的工具使用能力"""
        results = {
            "tool_selection": [],    # 工具选择准确率
            "param_accuracy": [],    # 参数准确率
            "timing_accuracy": [],   # 调用时机
            "output_parse": [],      # 结果解析
            "multi_tool": []         # 多工具编排
        }
        
        for case in self.test_cases:
            agent_output = agent.run(case["task"], case["available_tools"])
            
            # 1. 工具选择
            correct_tool = agent_output.tool == case["expected_tool"]
            results["tool_selection"].append(correct_tool)
            
            # 2. 参数准确率
            param_score = self._compare_params(
                agent_output.params, case["expected_params"]
            )
            results["param_accuracy"].append(param_score)
            
            # 3. 结果解析
            correct_parse = self._check_output_type(
                agent_output.result, case["expected_output_type"]
            )
            results["output_parse"].append(correct_parse)
        
        # 计算总分
        return {
            dim: f"{sum(scores)/len(scores)*100:.1f}%"
            for dim, scores in results.items()
        }
```

## Benchmark 评估方法对比

| 方法 | 原理 | 优点 | 缺点 |
|------|------|------|------|
| 精确匹配 | 输出与标准答案完全一致 | 客观，可自动化 | 无法处理多种正确答案 |
| 单元测试 | 运行生成的代码看是否通过 | 客观，可靠 | 仅适用于代码 |
| LLM-as-Judge | 用GPT-4评分 | 灵活，可评主观题 | 评判者自身有偏见 |
| 人工评分 | 专家打分 | 最可靠 | 昂贵，慢 |
| 偏好对比 | 两个输出比较选优者 | 相对评估更可靠 | 无法给绝对分数 |

## 如何构建自建评估集

```python
class CustomBenchmark:
    """自建Benchmark的最佳实践"""
    
    def __init__(self, domain: str):
        self.domain = domain  # 如: "心理咨询", "代码审核"
        self.test_cases = []
    
    def add_case(self, task, expected_output, tools=None, difficulty="L2"):
        """添加测试用例"""
        self.test_cases.append({
            "id": f"custom_{len(self.test_cases)+1:03d}",
            "domain": self.domain,
            "task": task,
            "expected_output": expected_output,
            "tools": tools or [],
            "difficulty": difficulty,
            "evaluation_criteria": self._generate_criteria(task, expected_output)
        })
    
    def _generate_criteria(self, task, expected):
        """用LLM生成评估标准"""
        return llm.generate(f"""
为以下任务生成评估标准:
任务: {task}
期望输出: {expected}

输出3-5个评估维度，每个维度1-10分:
1. 
2. 
3. 
""")
    
    def evaluate(self, agent, method="llm_judge"):
        """评估Agent"""
        results = []
        for case in self.test_cases:
            output = agent.run(case["task"])
            
            if method == "exact_match":
                score = 1.0 if output == case["expected_output"] else 0.0
            elif method == "llm_judge":
                score = self._llm_judge(output, case)
            
            results.append({
                "case_id": case["id"],
                "score": score,
                "difficulty": case["difficulty"]
            })
        
        return self._summarize(results)
```

## 面试回答模板

> "utbench这类Benchmark衡量模型生成效果，核心是**标准化任务集+自动化评分**。我会从几个维度回答:

1. **评估什么**: 工具选择准确率、参数构造质量、调用时机判断、结果解析能力、多工具编排
2. **怎么评**: 精确匹配(客观题)、单元测试(代码题)、LLM-as-Judge(主观题)、人工抽查
3. **局限**: Benchmark可能被针对性优化(刷分)，真实场景分布可能偏离测试集
4. **实践**: 自建领域评估集 > 通用Benchmark，持续更新测试用例"
