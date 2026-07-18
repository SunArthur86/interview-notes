---
id: note-yz-001
difficulty: L3
category: ai
subcategory: Agent
tags:
- 宇树科技
- AI Agent
- ReAct
- 循环检测
- Agent调试
- 面经
feynman:
  essence: ReAct循环中Agent可能陷入"思考→行动→观察→思考"的无效死循环——反复调用同一工具或产生相同推理。检测方法是跟踪工具调用序列和推理内容，发现重复模式后通过强制跳出/注入新Prompt/限制最大轮次来中断。
  analogy: 像导航软件不停说"前方掉头"然后又"前方掉头"——一直在转圈。解决方法是导航检测到你在原地打转，强制重新规划路线或停下来问你。
  key_points:
  - 循环检测三要素：工具调用序列去重、推理内容相似度、步数上限
  - 轻量检测：滑动窗口看最近N步是否有重复工具调用
  - 深度检测：embedding相似度比较推理内容
  - 跳出策略：注入反思Prompt、强制切换策略、直接返回部分结果
  - 最大轮次兜底：硬性限制防止无限消耗Token
first_principle:
  essence: Agent循环 = 状态空间中的死循环，检测 = 识别状态重复，跳出 = 注入新信息打破循环
  derivation: ReAct每步产生(Thought,Action,Observation)三元组→如果连续多步的三元组高度相似→判定循环→注入新约束（如"你已尝试过X，请换方法"）打破死循环
  conclusion: 检测是被动防御（识别循环），跳出是主动干预（注入信息/切换策略/强制终止）
follow_up:
- 如何区分"合理的多次调用同一工具"和"无效循环"？（参数不同=合理，参数相同=循环）
- 最大轮次设多少合适？（通常10-20步，按任务复杂度调整）
- Agent陷入循环的根因通常是什么？（Prompt不够清晰/工具描述有歧义/模型能力不足）
- 除了轮次限制还有什么防护？（Token上限/成本限制/超时控制）
memory_points:
- 检测三层：序列去重(最近N步) → 内容相似度(embedding>0.9) → 硬性上限(最大轮次)
- 区分合理重复与循环：参数不同=合理重试，参数相同=无效循环
- 跳出三板斧：注入反思Prompt("你已经试过X了") → 强制切换策略 → 返回部分结果
- 兜底防线：最大轮次(通常15-20) + Token上限 + 超时控制
- 连续失败3次应停止当前路径，回退到上一步换方法
---

# 【宇树科技二面】ReAct 循环中，如何检测并跳出无效的"思考—行动"循环？

> 来源：小红书 宇树科技 AI Agent 三轮面试面经

## 一、ReAct 循环问题是什么

```
正常 ReAct 流程                       陷入循环的 ReAct

Thought: 需要查询天气                    Thought: 需要查询天气
Action: weather_api("北京")             Action: weather_api("北京")  
Observation: 32°C, 晴                   Observation: API超时
Thought: 北京今天很热，回复用户          Thought: 查询失败，再试一次
→ 结束 ✅                              Action: weather_api("北京")     ← 循环！
                                      Observation: API超时
                                      Thought: 查询失败，再试一次
                                      Action: weather_api("北京")     ← 又循环！
                                      ... 无限循环 ❌
```

**常见循环模式**：

| 模式 | 表现 | 根因 |
|------|------|------|
| **工具重复** | 连续调用相同工具+相同参数 | 工具失败但Agent不知换方法 |
| **推理重复** | 产生相同或高度相似的Thought | 模型陷入推理死胡同 |
| **工具震荡** | A→B→A→B 来回切换 | 两个工具结果矛盾 |
| **格式错误** | 不断产生格式错误的输出 | 解析失败→重试→还是错 |

## 二、检测机制——三层防线

### 第一层：工具调用序列去重（轻量、快速）

```python
class LoopDetector:
    def __init__(self, window_size=5, max_repeats=2):
        self.action_history = []  # [(tool_name, params_hash), ...]
        self.window_size = window_size
        self.max_repeats = max_repeats
    
    def check(self, tool_name, params):
        """检查是否出现重复调用"""
        params_hash = hash(json.dumps(params, sort_keys=True))
        current = (tool_name, params_hash)
        
        # 看最近 window_size 步内是否重复
        recent = self.action_history[-self.window_size:]
        repeat_count = recent.count(current)
        
        self.action_history.append(current)
        
        if repeat_count >= self.max_repeats:
            return True, f"工具 {tool_name} 在最近{self.window_size}步内重复调用{repeat_count+1}次"
        return False, None
```

```
序列去重检测示意

Step 1: (weather_api, "北京")     → 历史无重复 → 继续
Step 2: (weather_api, "北京")     → 最近5步内出现1次 → 继续
Step 3: (weather_api, "北京")     → 最近5步内出现2次 → 触发！🚨
        max_repeats=2 → 第3次相同调用就报警

注意：参数不同不算重复！
Step 1: (weather_api, "北京")     → 不重复
Step 2: (weather_api, "上海")     → 不重复（参数不同）
Step 3: (weather_api, "广州")     → 不重复（合理多次调用）
```

### 第二层：推理内容相似度检测（深度、精确）

```python
from sentence_transformers import SentenceTransformer
import numpy as np

class SemanticLoopDetector:
    def __init__(self, threshold=0.92, window=4):
        self.model = SentenceTransformer('all-MiniLM-L6-v2')
        self.thoughts = []
        self.threshold = threshold
        self.window = window
    
    def check_thought(self, thought_text):
        """用embedding相似度检测推理内容是否重复"""
        embedding = self.model.encode(thought_text)
        
        # 只看最近N步
        recent = self.thoughts[-self.window:]
        
        for i, prev_emb in enumerate(recent):
            similarity = np.dot(embedding, prev_emb) / (
                np.linalg.norm(embedding) * np.linalg.norm(prev_emb))
            if similarity > self.threshold:
                return True, f"与第{len(self.thoughts)-len(recent)+i}步推理相似度={similarity:.2f}"
        
        self.thoughts.append(embedding)
        return False, None
```

### 第三层：硬性上限（兜底防线）

```python
MAX_STEPS = 20          # 最大推理轮次
MAX_TOKENS = 10000      # 最大Token消耗
MAX_TOOL_FAILURES = 3   # 同一工具连续失败上限

class AgentGuard:
    def __init__(self):
        self.step_count = 0
        self.total_tokens = 0
        self.consecutive_failures = {}  # {tool_name: count}
    
    def should_stop(self, tool_name=None, success=True):
        self.step_count += 1
        
        # 硬性步数上限
        if self.step_count >= MAX_STEPS:
            return True, f"达到最大轮次 {MAX_STEPS}"
        
        # Token上限
        if self.total_tokens >= MAX_TOKENS:
            return True, f"Token消耗超限 {self.total_tokens}"
        
        # 工具连续失败
        if tool_name and not success:
            self.consecutive_failures[tool_name] = \
                self.consecutive_failures.get(tool_name, 0) + 1
            if self.consecutive_failures[tool_name] >= MAX_TOOL_FAILURES:
                return True, f"工具 {tool_name} 连续失败{MAX_TOOL_FAILURES}次"
        elif tool_name and success:
            self.consecutive_failures[tool_name] = 0
        
        return False, None
```

## 三、跳出策略——检测到循环后怎么办

```
┌─────────────────────────────────────────────────┐
│              跳出策略（优先级从高到低）              │
├─────────────────────────────────────────────────┤
│                                                  │
│  1. 注入反思Prompt（首选）                        │
│     → 在上下文中插入："你已尝试过X方法{N}次，       │
│        请换一种完全不同的方法"                     │
│     → 成功率最高，模型能自主调整                    │
│                                                  │
│  2. 强制切换策略                                  │
│     → 清除当前Thought历史                         │
│     → 注入新的行动方向                             │
│     → 如"天气API不可用，请基于常识回答"             │
│                                                  │
│  3. 返回部分结果                                  │
│     → 已收集的信息整理成回答                       │
│     → "基于已有信息，部分回答如下..."              │
│                                                  │
│  4. 直接终止 + 错误上报                           │
│     → 兜底方案，告知用户无法完成                    │
│     → 触发告警，人工介入                           │
│                                                  │
└─────────────────────────────────────────────────┘
```

```python
def break_loop(agent, loop_info, strategy="reflect"):
    if strategy == "reflect":
        # 注入反思Prompt
        reflection = f"""
        ⚠️ 检测到循环：{loop_info}
        你已经尝试了相同的方法但未成功。
        请采取完全不同的策略：
        - 换一个工具
        - 修改请求参数
        - 或者基于已有信息直接给出答案
        """
        agent.inject_message(reflection)
        
    elif strategy == "force_switch":
        # 强制切换：清除历史，注入新方向
        agent.clear_recent_history(steps=3)
        agent.inject_message("之前的尝试失败了，请从不同角度重新分析问题。")
        
    elif strategy == "partial_result":
        # 返回部分结果
        partial = agent.summarize_current_progress()
        return {"status": "partial", "result": partial}
        
    else:
        # 终止
        return {"status": "failed", "reason": loop_info}
```

## 四、面试加分点

1. **三层检测体系**：序列去重（快）→ embedding相似度（准）→ 硬性上限（兜底）
2. **区分合理重复**：参数不同=合理多次调用，参数相同=无效循环
3. **反思Prompt效果最好**：注入"你已试过X"比强制终止更能让模型自主调整
4. **根因分析**：循环的根因通常是Prompt不清晰/工具描述歧义/模型推理能力不足
5. **工程化防护**：最大轮次+Token上限+超时控制+成本监控的多维度兜底

## 结构化回答

**30 秒电梯演讲：** ReAct循环中Agent可能陷入"思考→行动→观察→思考"的无效死循环——反复调用同一工具或产生相同推理。检测方法是跟踪工具调用序列和推理内容，发现重复模式后通过强制跳出/注入新Prompt/限制最大轮次来中断。

**展开框架：**
1. **循环检测三要素** — 工具调用序列去重、推理内容相似度、步数上限
2. **轻量检测** — 滑动窗口看最近N步是否有重复工具调用
3. **深度检测** — embedding相似度比较推理内容

**收尾：** 您想深入聊：如何区分"合理的多次调用同一工具"和"无效循环"？（参数不同=合理，参数相同=循环）？


## 视频脚本

> 预计时长：4 分钟 | 由浅入深


| 时间 | 画面/字幕 | 口播台词 | 讲解要点 |
|------|----------|----------|----------|
| 0:00 | 标题卡：ReAct 循环中，如何检测并跳出无效的"思考… | "像导航软件不停说"前方掉头"然后又"前方掉头"——一直在转圈。解决方法是导航检测到你在原地…" | 开场钩子 |
| 0:20 | 核心概念图 | "ReAct循环中Agent可能陷入"思考→行动→观察→思考"的无效死循环——反复调用同一工具或产生相同推理。检测方法是跟…" | 核心定义 |
| 0:50 | 循环检测三要素示意图 | "循环检测三要素——工具调用序列去重、推理内容相似度、步数上限" | 要点拆解1 |
| 1:30 | 对比/实战案例图 | "对比一下常见误区和工程实践，看真实场景里怎么取舍。" | 实战与对比 |
| 2:20 | 总结卡 | "记住核心要点。下期我们追问：如何区分"合理的多次调用同一工具"和"无效循环"？（参数不同？" | 收尾与钩子 |

## 苏格拉底式面试追问

| 追问层级 | 面试官可能这样问 | 高分回答方向 |
|----------|------------------|--------------|
| 目标追问 | 检测并跳出ReAct无效循环的核心目标是什么？ | 识别Agent陷入'思考-行动'空转（重复调用、无进展、死循环），及时中断避免浪费token和时间 |
| 证据追问 | 怎么判定是无效循环？有哪些信号？ | 信号：相同或相似thought/action重复出现、observation未带来新信息、步数超阈值、目标未推进；用相似度+计数+进展检测 |
| 边界追问 | 正常多步推理和无效循环怎么区分？ | 正常推理每步有新信息和进展、action多样化；无效循环是重复无进展；要看observation是否带来新信息和目标推进 |
| 反例追问 | 简单设最大步数够不够？ | 不够。最大步数只能兜底，无法区分'正常长任务'和'无效循环'；要做进展检测和重复识别精准跳出 |
| 风险追问 | 误判跳出的风险有哪些？ | 正常长任务被误中断、用户目标未完成、跳出后无降级方案；要设计合理的降级（人工介入、返回部分结果） |
| 验证追问 | 怎么验证检测有效？ | 构造无效循环测试集、对比检测前后token消耗、监控跳出准确率、用户满意度 |
| 沉淀追问 | 循环检测怎么沉淀？ | 规范：多信号检测（重复+步数+进展）、降级策略、监控告警、日志可追溯 |

### 现场对话示例
**面试官**：ReAct循环中如何检测并跳出无效的'思考-行动'循环？
**候选人**：用多信号检测：thought/action相似度重复、observation无新信息、步数超阈值、目标未推进，命中就中断避免浪费token。
**面试官**：简单设最大步数够吗？
**候选人**：不够，最大步数只兜底无法区分正常长任务和无效循环；要做进展检测和重复识别精准跳出，配合降级方案。
**面试官**：误判跳出怎么办？
**候选人**：正常长任务可能被误中断，要设计降级——人工介入、返回部分结果、让用户确认是否继续，并监控跳出准确率持续优化。
