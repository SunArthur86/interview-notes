---
id: note-xhs-ai-046
difficulty: L3
category: ai
subcategory: agent
tags:
- Function-Calling
- 快手
- 长对话
- 摘要压缩
- 面经
feynman:
  essence: "Function Calling准确率提升靠的是结构化工具描述+Few-shot示例+参数校验重试；长多轮对话压缩靠的是分层摘要+关键信息常驻+滚动窗口"
  analogy: "Function Calling像培训新员工用内部工具——光给说明书不够，还要演示几遍(Few-shot)，员工填错表单时让他重填(校验重试)。长对话压缩像会议纪要——核心决议常驻白板(常驻)，讨论细节定期摘要归档(压缩)"
  key_points:
  - 工具描述结构化：参数名/类型/描述/示例四要素齐全
  - Few-shot示例：给出正确调用的input→output示例
  - 参数校验+重试：校验失败→返回错误信息→LLM修正重试
  - 长对话分层摘要：对话历史→摘要→超长摘要→只保留关键
  - 关键信息常驻：用户偏好/任务状态不受压缩影响
first_principle:
  essence: "Function Calling准确率取决于LLM理解工具描述的程度——描述越精确、示例越丰富，准确率越高"
  derivation: "LLM的function calling本质是：给定工具描述+用户query，生成正确的JSON调用。这个过程的质量取决于：1) 工具描述的清晰度（LLM能否理解参数含义）；2) 是否有示例参考（Few-shot比纯指令有效）；3) 参数约束的严格度（类型/范围/枚举值）。每一项的改进都直接提升准确率"
  conclusion: "Function Calling不是'写了就能用'——需要在工具描述、示例、校验三个层面持续优化，配合量化评估形成闭环"
follow_up:
- Function Calling准确率怎么量化评估？
- 参数校验失败后让LLM重试会不会陷入死循环？
- 对话摘要用什么模型？大模型还是小模型？
- 关键信息常驻会不会占用太多token？
memory_points:
- FC准确率=工具描述+Few-shot+参数校验重试
- 工具描述四要素：参数名/类型/描述/示例
- 长对话压缩：分层摘要+关键信息常驻+滚动窗口
- 摘要用小模型（省成本），生成用大模型
---

# 【快手AI大模型】Function Calling准确率怎么提升？长多轮对话怎么压缩？

> 来源：小红书「快手AI大模型开发面经（强度拉满）」（OCR）

## 一、Function Calling准确率提升

### 问题场景

```
低质量工具描述（准确率~60%）:
  工具: generate_script
  参数: topic (string)

高质量工具描述（准确率~95%）:
  工具: generate_script
  描述: 为短视频生成创作脚本，支持搞笑/知识/生活类内容
  参数:
    - topic (string, required): 脚本主题，如"职场日常"、"美食探店"
    - style (string, optional, enum: ["funny","educational","lifestyle"]): 
      内容风格，默认"lifestyle"
    - duration (int, optional, range: [15, 180]): 视频时长(秒)，默认60
    - language (string, optional): 语言，默认"zh"
  示例:
    输入: "帮我写个探店脚本"
    输出: {"topic":"美食探店","style":"lifestyle","duration":60}
```

### 三步提升方案

```python
class FunctionCallingOptimizer:
    """Function Calling准确率优化器"""
    
    # Step 1: 结构化工具描述
    TOOL_SCHEMA = {
        "name": "generate_script",
        "description": "为短视频生成创作脚本",
        "parameters": {
            "type": "object",
            "properties": {
                "topic": {
                    "type": "string",
                    "description": "脚本主题，如'职场日常'、'美食探店'"
                },
                "style": {
                    "type": "string",
                    "enum": ["funny", "educational", "lifestyle"],
                    "description": "内容风格",
                    "default": "lifestyle"
                },
                "duration": {
                    "type": "integer",
                    "minimum": 15,
                    "maximum": 180,
                    "description": "视频时长(秒)"
                }
            },
            "required": ["topic"]
        }
    }
    
    # Step 2: Few-shot示例（比纯指令有效3-5x）
    FEW_SHOT_EXAMPLES = [
        {
            "user": "帮我写个搞笑的职场脚本",
            "assistant": None,
            "tool_call": {
                "name": "generate_script",
                "arguments": {
                    "topic": "职场日常",
                    "style": "funny",
                    "duration": 60
                }
            }
        },
        {
            "user": "做个3分钟的美食探店",
            "assistant": None,
            "tool_call": {
                "name": "generate_script",
                "arguments": {
                    "topic": "美食探店",
                    "style": "lifestyle",
                    "duration": 180
                }
            }
        }
    ]
    
    # Step 3: 参数校验+智能重试
    def call_with_retry(self, user_input, max_retries=2):
        for attempt in range(max_retries + 1):
            # LLM生成function call
            raw_output = self.llm.generate(
                self.build_prompt(user_input, attempt)
            )
            
            try:
                call = json.loads(raw_output)
                # 严格校验
                validated = self.validate_call(call)
                return validated
            except ValidationError as e:
                if attempt < max_retries:
                    # 告诉LLM哪里错了，让它修正
                    error_feedback = f"""
                    你上次的调用有误:
                    输出: {raw_output}
                    错误: {str(e)}
                    请修正后重新调用。
                    """
                    continue  # 带着错误反馈重试
                else:
                    return {"error": "参数校验失败", "raw": raw_output}
    
    def build_prompt(self, user_input, attempt=0):
        prompt = f"""
        可用工具: {json.dumps(self.TOOL_SCHEMA, ensure_ascii=False)}
        
        示例:
        {self.format_examples()}
        
        用户请求: {user_input}
        """
        if attempt > 0:
            prompt += "\n注意：请确保参数类型和取值范围正确。"
        return prompt
```

### 准确率评估

```python
def evaluate_fc_accuracy(test_cases):
    """量化评估Function Calling准确率"""
    results = {"correct": 0, "param_error": 0, 
               "tool_error": 0, "format_error": 0}
    
    for case in test_cases:
        output = agent.call(case["input"])
        expected = case["expected_call"]
        
        if output["name"] != expected["name"]:
            results["tool_error"] += 1
        elif output["arguments"] != expected["arguments"]:
            results["param_error"] += 1
        else:
            results["correct"] += 1
    
    accuracy = results["correct"] / len(test_cases)
    return {"accuracy": accuracy, "details": results}
```

## 二、长多轮对话压缩

### 分层摘要架构

```
创作者反复修改脚本的对话场景:

Round 1: 生成初稿           → 完整保留
Round 2: 修改开头            → 完整保留
Round 3: 调整语气            → 完整保留
Round 4: 换个标题            → 摘要压缩(只保留修改要点)
Round 5: 再改开头            → 摘要压缩
...
Round 20: 最终确认           → 只保留最终稿

分层策略:
┌──────────────────────────────────────────┐
│  Layer 1: 常驻区（不压缩）                │
│  • 用户风格偏好（"幽默+知识型"）          │
│  • 当前任务状态（"第3版脚本修改中"）       │
│  • 关键约束（"不超过60秒"）               │
│  占用: ~200 tokens                        │
├──────────────────────────────────────────┤
│  Layer 2: 近期对话（滚动窗口，不压缩）    │
│  • 最近3-5轮完整对话                      │
│  占用: ~1000 tokens                       │
├──────────────────────────────────────────┤
│  Layer 3: 历史摘要（定期压缩）            │
│  • 每5轮生成一次摘要                      │
│  • 摘要的摘要（超长对话）                  │
│  占用: ~500 tokens                        │
├──────────────────────────────────────────┤
│  Layer 4: 当前脚本内容（常驻）            │
│  • 最新版脚本全文                         │
│  占用: ~500 tokens                        │
└──────────────────────────────────────────┘
总占用: ~2200 tokens（无论对话多长都恒定）
```

```python
class HierarchicalDialogueMemory:
    """分层对话记忆管理器"""
    
    def __init__(self, llm_small, llm_large):
        self.llm_small = llm_small  # 小模型做摘要（省成本）
        self.llm_large = llm_large  # 大模型做生成
        self.permanent = {}         # 常驻信息
        self.recent = []            # 最近5轮
        self.summaries = []         # 历史摘要
        self.current_artifact = ""  # 当前脚本内容
    
    def chat(self, user_input):
        # 组装context
        context = self.assemble_context()
        
        # 大模型生成
        response = self.llm_large.generate(context, user_input)
        
        # 更新记忆
        self.recent.append({"user": user_input, "assistant": response})
        
        # 每超过5轮，压缩最老的对话
        if len(self.recent) > 5:
            old = self.recent.pop(0)
            summary = self.llm_small.summarize(old)
            self.summaries.append(summary)
        
        # 摘要太多时，对摘要做摘要
        if len(self.summaries) > 3:
            mega_summary = self.llm_small.summarize(
                "\n".join(self.summaries)
            )
            self.summaries = [mega_summary]
        
        return response
    
    def assemble_context(self):
        """组装发送给LLM的context"""
        parts = []
        
        # Layer 1: 常驻信息
        if self.permanent:
            parts.append(f"[用户偏好] {json.dumps(self.permanent)}")
        
        # Layer 4: 当前内容
        if self.current_artifact:
            parts.append(f"[当前脚本]\n{self.current_artifact}")
        
        # Layer 3: 历史摘要
        if self.summaries:
            parts.append(f"[历史摘要] {'; '.join(self.summaries)}")
        
        # Layer 2: 近期对话
        for turn in self.recent:
            parts.append(f"用户: {turn['user']}")
            parts.append(f"助手: {turn['assistant']}")
        
        return "\n\n".join(parts)
```

## 三、方案对比

| FC优化策略 | 准确率提升 | 实现复杂度 | 延迟影响 |
|-----------|-----------|-----------|---------|
| 结构化工具描述 | +15-20% | 低 | 0ms |
| Few-shot示例 | +20-30% | 低 | +100ms |
| 参数校验+重试 | +10-15% | 中 | +200ms(重试时) |
| Fine-tune工具选择 | +15-25% | 高 | 0ms |

| 对话压缩策略 | Token节省 | 信息损失 | 适用场景 |
|-------------|-----------|---------|---------|
| 滑动窗口(截断) | 高 | 高 | 闲聊 |
| 全量摘要 | 高 | 中 | 长对话 |
| 分层摘要(常驻+摘要) | 中 | 低 | 创作场景 |
| 向量检索(按需) | 最高 | 中 | 跨会话 |

## 四、面试加分点

1. **FC评估闭环**：Function Calling的准确率需要持续监控——线上每次调用都记录是否成功，按工具维度统计成功率，低于90%的工具需要优化描述或增加示例
2. **摘要模型选择**：对话摘要不需要强推理能力——用Qwen-7B等小模型做摘要（成本是大模型的1/10），只在最终生成时用大模型。这个分层策略能节省60%+的推理成本
3. **创作者场景特殊性**：短视频创作者会反复修改（"开头再搞笑一点"→"算了还是正式一点"），对话中包含大量试错过程——分层摘要的价值在于：保留修改方向(常驻)但丢弃中间过程(摘要压缩)
4. **当前内容常驻**：创作类Agent的"当前脚本"必须始终在context中——如果被摘要压缩了，LLM就看不到当前内容无法继续修改。这个设计细节是创作场景特有的
5. **token预算管理**：总context预算 = 常驻(200) + 近期(1000) + 摘要(500) + 当前内容(500) = 2200 tokens。无论对话多长，token消耗恒定——这是系统稳定性的保证

## 结构化回答

**30 秒电梯演讲：** Function Calling准确率提升靠的是结构化工具描述+Few-shot示例+参数校验重试；长多轮对话压缩靠的是分层摘要+关键信息常驻+滚动窗口。

**展开框架：**
1. **工具描述结构化** — 参数名/类型/描述/示例四要素齐全
2. **Few-shot示例** — 给出正确调用的input→output示例
3. **参数校验+重试** — 校验失败→返回错误信息→LLM修正重试

**收尾：** 您想深入聊：Function Calling准确率怎么量化评估？


## 视频脚本

> 预计时长：4 分钟 | 由浅入深


| 时间 | 画面/字幕 | 口播台词 | 讲解要点 |
|------|----------|----------|----------|
| 0:00 | 标题卡：Function Calling准确率怎么提升？… | "Function Calling像培训新员工用内部工具——光给说明书不够，还要演示几遍(…" | 开场钩子 |
| 0:20 | 核心概念图 | "Function Calling准确率提升靠的是结构化工具描述+Few-shot示例+参数校验重试；长多轮对话压缩靠的是…" | 核心定义 |
| 0:50 | 工具描述结构化示意图 | "工具描述结构化——参数名/类型/描述/示例四要素齐全" | 要点拆解1 |
| 1:30 | 对比/实战案例图 | "对比一下常见误区和工程实践，看真实场景里怎么取舍。" | 实战与对比 |
| 2:20 | 总结卡 | "记住核心要点。下期我们追问：Function Calling准确率怎么量化评估？" | 收尾与钩子 |

## 苏格拉底式面试追问

| 追问层级 | 面试官可能这样问 | 高分回答方向 |
|----------|------------------|--------------|
| 目标追问 | 提升Function Calling准确率和压缩长多轮对话各自的目标是什么？ | FC准确率：让模型正确选择工具和参数；对话压缩：在保留关键信息的前提下减少token降低成本和延迟 |
| 证据追问 | FC准确率怎么提升？有哪些方法？ | 方法：清晰的工具描述和schema、few-shot示例、工具检索缩小选择范围、微调专用FC模型、参数校验和重试 |
| 边界追问 | 对话压缩到什么程度合适？有信息损失风险吗？ | 压缩要保留关键事实、决策、未完成任务，损失风险存在；一般保留近N轮原文+历史摘要，按任务调 |
| 反例追问 | 压缩越狠越好吗？ | 不是。过度压缩丢关键信息导致模型答非所问、决策错误；要在token节省和信息保留间平衡 |
| 风险追问 | 压缩有什么风险？ | 丢关键上下文、摘要失真、跨主题信息混淆、压缩本身有成本和延迟 |
| 验证追问 | 怎么验证FC准确率和压缩效果？ | FC测试集准确率、压缩前后任务完成率对比、人工badcase、token成本监控 |
| 沉淀追问 | FC和压缩怎么沉淀？ | 规范：工具描述模板、FC微调流程、压缩策略和阈值、评测集回归 |

### 现场对话示例
**面试官**：Function Calling准确率怎么提升？长多轮对话怎么压缩？
**候选人**：FC靠清晰工具描述+schema、few-shot示例、工具检索缩小范围、微调专用模型；压缩用近N轮原文+历史摘要，保留关键事实和未完成任务。
**面试官**：压缩越狠越好吗？
**候选人**：不是，过度压缩丢关键信息导致答非所问、决策错误，要在token节省和信息保留间平衡，按任务调阈值。
**面试官**：FC准确率怎么验证？
**候选人**：FC测试集准确率、参数校验、badcase分析、必要时微调专用FC模型，配合重试和降级兜底。
