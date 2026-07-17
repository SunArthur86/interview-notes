---
id: note-ai50-013
difficulty: L4
category: ai
subcategory: Agent
tags:
- 某厂
- 面经
- Agent
- LangGraph
- 对话控制
- 安全
feynman:
  essence: 用LangGraph的状态图定义对话转移规则，在关键节点设置安全检查门控，确保Agent不会说不合适的话
  analogy: 就像心理咨询师的工作手册——规定了什么时候该共情、什么时候该转介、遇到自杀倾向必须触发应急流程。LangGraph就是这份手册的代码实现
  first_principle: 开放域LLM对话无法仅靠Prompt保证安全性，必须有确定性的状态机做兜底。状态转移图 + 条件路由 + 安全门控 = 可控的对话流程
  key_points:
  - '状态图定义对话阶段: 共情→评估→干预→总结'
  - '条件路由: 根据情绪检测结果决定下一步'
  - '安全门控: 自杀/自伤关键词触发应急流程'
  - '记忆管理: 长期画像存向量库, 短期上下文存状态'
first_principle:
  essence: 对话安全性需要确定性保证，不能依赖概率模型的自律
  derivation: 心理咨询场景中，一句不恰当的话可能导致严重后果。LLM即使被Prompt约束仍可能生成不安全内容。状态机提供了硬性的流程控制——某些路径是被禁止的，无论模型怎么生成都无法绕过
  conclusion: LangGraph + 安全门控是高敏对话场景的工程必需品，不是可选项
follow_up:
- 情绪检测用什么模型？准确率如何？
- LangGraph和LangChain Agent的区别是什么？
- 如果用户拒绝回答评估问题，怎么处理？
memory_points:
- 核心控制：用状态图（StateGraph）实现安全门控与阶段条件路由
- 安全底线：每个节点必须强制嵌入危机检测，一旦命中（如自伤倾向）立即熔断并转人工
- 状态流转：按'共情倾听→情绪评估(PHQ-9)→认知干预→总结建议'规范对话走向
- 强制干预：在每轮对话后执行Safety_check与Safety_filter双重内容过滤
---

# 心理咨询Agent如何用LangGraph控制对话走向？

## 对话状态图设计

```
                    ┌─────────────┐
          ┌────────→│  检测到危机  │───→ 触发应急流程
          │         │  (自杀倾向)  │     (转介热线/报警)
          │         └─────────────┘
          │
┌──────────────────┐     条件路由      ┌──────────────┐
│   开始: 共情倾听   │─────────────────→│  情绪评估     │
│   "我在这里陪你"   │                  │  PHQ-9/GAD-7 │
└────────┬─────────┘                  └──────┬───────┘
         │                                   │
         │      ┌──────────────┐             │
         │      │   认知干预    │←────────────┘
         │      │  CBT技巧引导  │    评估结果: 轻中度
         │      └──────┬───────┘
         │             │
         │             ▼
         │      ┌──────────────┐
         │      │   总结+建议   │
         │      │  推荐: 写日记  │
         │      └──────────────┘
         │
         ▼
┌──────────────────┐
│  安全门控 (每轮)   │
│  检查: 自伤/用药   │
│  检查: 医疗建议    │
└──────────────────┘
```

## LangGraph 实现

```python
from langgraph.graph import StateGraph, END
from typing import Dict, List, Optional
from enum import Enum

class DialogueState(Enum):
    EMPATHY = "empathy"        # 共情倾听
    ASSESSMENT = "assessment"   # 情绪评估
    INTERVENTION = "intervention"  # 认知干预
    SUMMARY = "summary"        # 总结建议
    CRISIS = "crisis"          # 危机处理
    SAFE_FALLBACK = "safe"     # 安全兜底

class ChatState(TypedDict):
    messages: List[dict]           # 短期记忆: 当前对话历史
    user_profile: dict             # 长期画像: 从向量库加载
    dialogue_stage: str            # 当前对话阶段
    risk_level: str                # 风险等级: low/medium/high/crisis
    assessment_score: Optional[int] # 评估分数
    safety_flags: List[str]        # 安全标记

# ===== 定义节点 =====

def empathy_node(state: ChatState) -> ChatState:
    """共情倾听阶段"""
    user_msg = state["messages"][-1]["content"]
    
    # 1. 情绪检测
    emotion = detect_emotion(user_msg)
    
    # 2. 安全检查 (每轮必检!)
    safety = safety_check(user_msg)
    if safety["is_crisis"]:
        state["risk_level"] = "crisis"
        state["dialogue_stage"] = DialogueState.CRISIS.value
        return state
    
    # 3. 生成共情回复
    response = llm.generate(
        system=EMPATHY_PROMPT.format(profile=state["user_profile"]),
        user=user_msg
    )
    
    # 4. 后处理: 过滤不安全内容
    response = safety_filter(response)
    
    state["messages"].append({"role": "assistant", "content": response})
    state["risk_level"] = emotion["risk_level"]
    return state

def assessment_node(state: ChatState) -> ChatState:
    """情绪评估阶段: 用标准化量表"""
    # PHQ-9抑郁量表或GAD-7焦虑量表
    response = llm.generate(
        system=ASSESSMENT_PROMPT,
        user="请用温和的方式引导用户完成PHQ-9量表评估"
    )
    state["assessment_score"] = parse_score(response)
    return state

def crisis_node(state: ChatState) -> ChatState:
    """危机处理: 必须触发应急流程"""
    # 这里的内容是硬编码的，不走LLM生成
    crisis_response = (
        "我注意到你可能正在经历非常困难的时刻。\n"
        "你的安全是最重要的。\n"
        "请立即拨打24小时心理援助热线: 400-161-9995\n"
        "或前往最近的医院急诊科。\n"
        "你不是一个人，有人可以帮助你。"
    )
    state["messages"].append({"role": "assistant", "content": crisis_response})
    state["dialogue_stage"] = END
    return state

# ===== 条件路由 =====

def route_after_empathy(state: ChatState) -> str:
    """根据情绪检测结果决定下一步"""
    if state["risk_level"] == "crisis":
        return "crisis"
    elif state["risk_level"] == "high":
        return "assessment"
    else:
        return "empathy"  # 继续共情倾听

# ===== 构建状态图 =====

workflow = StateGraph(ChatState)

# 添加节点
workflow.add_node("empathy", empathy_node)
workflow.add_node("assessment", assessment_node)
workflow.add_node("intervention", intervention_node)
workflow.add_node("summary", summary_node)
workflow.add_node("crisis", crisis_node)

# 设置入口
workflow.set_entry_point("empathy")

# 添加条件路由
workflow.add_conditional_edges(
    "empathy",
    route_after_empathy,
    {
        "crisis": "crisis",
        "assessment": "assessment",
        "empathy": "empathy",  # 自循环
    }
)

workflow.add_edge("assessment", "intervention")
workflow.add_edge("intervention", "summary")
workflow.add_edge("summary", END)
workflow.add_edge("crisis", END)

# 编译
app = workflow.compile()
```

## 安全门控机制

```python
class SafetyGate:
    """每轮对话的安全检查门控"""
    
    CRISIS_KEYWORDS = [
        "不想活", "自杀", "了结", "结束生命", "活不下去",
        "伤害自己", "自残", "割腕", "吃药了结"
    ]
    
    FORBIDDEN_RESPONSES = [
        "你应该", "你必须", "这很简单", "别人比你更惨",
        "别想太多", "开心点就好"
    ]
    
    MEDICAL_ADVICE_PATTERNS = [
        r"建议.*服用.*mg",
        r"可以.*停药",
        r"不需要.*看医生"
    ]
    
    def check_input(self, user_msg: str) -> dict:
        """检查用户输入"""
        # 危机关键词检测
        for keyword in self.CRISIS_KEYWORDS:
            if keyword in user_msg:
                return {"is_crisis": True, "keyword": keyword}
        
        # 情绪强度评估
        emotion = emotion_classifier.predict(user_msg)
        if emotion["distress_score"] > 0.8:
            return {"is_crisis": True, "reason": "high_distress"}
        
        return {"is_crisis": False}
    
    def filter_output(self, llm_response: str) -> str:
        """过滤LLM输出中的不安全内容"""
        # 检查禁止的回复模式
        for pattern in self.FORBIDDEN_RESPONSES:
            if pattern in llm_response:
                llm_response = llm_response.replace(pattern, "")
        
        # 检查医疗建议
        for pattern in self.MEDICAL_ADVICE_PATTERNS:
            if re.search(pattern, llm_response):
                llm_response += "\n\n(注: 具体用药请咨询专业医生)"
        
        return llm_response
```

## 记忆管理

```python
class CounselingMemory:
    """心理咨询Agent的记忆管理"""
    
    def __init__(self):
        self.short_term = []         # 短期: 当前对话历史(窗口)
        self.long_term = VectorStore()  # 长期: 用户画像和历史
    
    def load_context(self, user_id):
        """加载用户长期画像"""
        profile = self.long_term.search(
            f"user_profile_{user_id}", top_k=1
        )
        return {
            "name": profile.get("name"),
            "history_summary": profile.get("counseling_history"),
            "known_triggers": profile.get("triggers", []),
            "coping_strategies": profile.get("effective_strategies", []),
            "risk_factors": profile.get("risk_factors", [])
        }
    
    def build_context_for_llm(self, user_id, current_msg):
        """构建喂给LLM的完整上下文"""
        profile = self.load_context(user_id)
        recent = self.short_term[-10:]  # 最近10轮对话
        
        context = f"""
【用户画像】:
- 姓名: {profile['name']}
- 咨询历史: {profile['history_summary']}
- 已知触发因素: {', '.join(profile['known_triggers'])}
- 有效的应对策略: {', '.join(profile['coping_strategies'])}

【最近对话】:
{format_messages(recent)}

【当前消息】: {current_msg}
"""
        return context
```

## 记忆要点

- 核心控制：用状态图（StateGraph）实现安全门控与阶段条件路由
- 安全底线：每个节点必须强制嵌入危机检测，一旦命中（如自伤倾向）立即熔断并转人工
- 状态流转：按'共情倾听→情绪评估(PHQ-9)→认知干预→总结建议'规范对话走向
- 强制干预：在每轮对话后执行Safety_check与Safety_filter双重内容过滤

## 苏格拉底式面试追问

> 这组追问模拟面试官层层逼问，每一问先回答"为什么"，再回答"怎么做"，最后回答"如何证明"。

### 第一层：目标与动机

**Q：心理咨询 Agent 为什么要用 LangGraph 的状态图控制，而不是让 LLM 自由对话？自由对话不是更自然吗？**

心理咨询有严格的专业流程和安全底线，自由对话会越界。一是安全——用户表达自伤/伤人倾向时，必须立即熔断转人工，LLM 自由对话可能继续"共情"而错过危机干预窗口，这是致命的；二是有效性——咨询有阶段目标（倾听→评估→干预→总结），LLM 自由对话可能停留在某一阶段（如一直共情不做评估），达不到干预效果。状态图把专业流程编码成强制约束，动机是"专业性和安全性高于自然度"。

### 第二层：证据与定位

**Q：你的 Agent 在 PHQ-9 情绪评估节点给出的分数和量表标准答案不一致，怎么定位是 prompt 问题还是模型理解错了？**

做对照测试：拿同一批标准化的 PHQ-9 量表问答（有标注的 ground truth 分数），让 Agent 打分，对比偏差。如果系统性偏高/偏低，是 prompt 里评分标准描述不清（如"经常"的界定模糊）；如果个别 case 偏差大，看那些 case 的用户表述是否有歧义（如"有时候睡不着"算几分），是模型理解问题。更稳的做法是 prompt 里给出每个选项的明确定义 + few-shot 示例，减少模型自由解释空间。

### 第三层：根因深挖

**Q：危机检测节点漏检了一个明确表达自伤倾向的用户，根因是什么？**

根因可能是检测规则覆盖不全或模型理解偏差。如果是基于关键词的规则检测，用户用隐喻（如"想永远睡过去""解脱"）绕过了关键词；如果是基于 LLM 判断，模型可能把"想死"理解成夸张表达（网络用语"累死了"）而未触发危机。治本是双保险：关键词/正则规则做高 recall 的粗筛（宁可误报不可漏报），LLM 做精判（区分真实危机 vs 夸张表达）；同时定期用对抗性 case（收集真实危机表达的各种变体）回归测试，堵漏。

**Q：那为什么不直接把所有"负面情绪"都判定为危机，宁可误报转人工，省得漏检？**

误报的代价是用户体验和人工成本。心理咨询的转人工会打断对话、增加等待、且人工咨询师资源稀缺（成本高）。如果把"我今天很难过"也转人工，90% 的正常咨询被打断，用户流失，人工资源被低危 case 占满导致真危机接不上。危机检测要追求高 recall（不漏）但同时控 precision（少误报），阈值要基于"漏检代价远高于误报代价"但不等于"无限误报"，用 PHQ-9 第 9 题（自伤条目）做精准确认而非泛化判定。

### 第四层：方案权衡

**Q：状态图你定义了"共情→评估→干预→总结"四阶段，为什么是这四步，为什么不允许阶段回退（如从干预回共情）？**

四阶段对应心理咨询的 standard 流程（基于 CBT 认知行为疗法）。共情建立信任 → 评估量化问题 → 干预提供方法 → 总结固化收获，是有理论依据的顺序。不允许随意回退是因为频繁回退（如用户每说一句就重新共情）会破坏流程推进，咨询变成闲聊。但要有条件回退——如果干预阶段发现评估信息不全（如用户提到新的创伤），触发条件路由回到评估补全，再回干预。状态图的边是"条件转移"而非任意跳转。

**Q：为什么不直接用 ReAct 让模型自己决定每轮做什么（共情 or 评估 or 干预），更灵活？**

心理咨询的流程不能让模型自由决策——模型可能为了"讨好用户"一直共情不做干预（回避困难），或者过早进入干预（信任未建立）导致用户抗拒。专业流程是经过几十年临床验证的，模型自由决策的"灵活性"反而是风险。状态图把专业流程硬编码，模型只在每个阶段内部有自由度（如共情怎么说、评估问哪些），阶段转移受约束。这是"专家系统 + LLM"的混合，用专家知识框定边界，用 LLM 填充表达。

### 第五层：验证与沉淀

**Q：你怎么证明这个 Agent 做的心理咨询是"安全且有效"的，而不是只是"能对话"？**

安全性和有效性要分开验证。安全性：构建危机 case 测试集（含自伤/伤人/精神病性症状的表达变体），测危机检测的 recall（目标 100%，漏检不可接受）和误报率（目标 <5%）；有效性：用标准化的咨询效果量表（如咨询前后用户的 PHQ-9 分数变化），对比 Agent 咨询和真人咨询的效果差异，需伦理委员会批准的临床试验。两者都达标才能上线，且上线后持续监控危机拦截率和用户反馈。

**Q：这套对话控制框架怎么沉淀成其他敏感场景（如医疗/法律/金融咨询）的通用能力？**

抽象成"安全门控状态图"框架：节点（对话阶段）和边（条件转移）可配置，每个节点可插 Safety_check（危机/违规检测），熔断动作（转人工/拒绝回答）可配。沉淀"各敏感场景的安全检测规则库"（心理危机/医疗禁忌/法律边界/金融合规）、"状态图模板"（咨询类用四阶段、问答类用两阶段）、"熔断 SLO"（危机 case 100% 拦截、转人工延迟 <30 秒）。新场景接入时配规则和状态图，复用框架。

## 结构化回答

**30 秒电梯演讲：** 用LangGraph的状态图定义对话转移规则，在关键节点设置安全检查门控，确保Agent不会说不合适的话——就像心理咨询师的工作手册。

**展开框架：**
1. **状态图定义对话阶段** — 共情→评估→干预→总结
2. **条件路由** — 根据情绪检测结果决定下一步
3. **安全门控** — 自杀/自伤关键词触发应急流程

**收尾：** 您想深入聊：情绪检测用什么模型？准确率如何？


## 视频脚本

> 预计时长：5 分钟 | 由浅入深


| 时间 | 画面/字幕 | 口播台词 | 讲解要点 |
|------|----------|----------|----------|
| 0:00 | 标题卡：心理咨询Agent如何用LangGraph控制对… | "就像心理咨询师的工作手册——规定了什么时候该共情、什么时候该转介、遇到自杀倾向必须触发应急…" | 开场钩子 |
| 0:20 | 核心概念图 | "用LangGraph的状态图定义对话转移规则，在关键节点设置安全检查门控，确保Agent不会说不合适的话" | 核心定义 |
| 0:50 | 状态图定义对话阶段示意图 | "状态图定义对话阶段——共情→评估→干预→总结" | 要点拆解1 |
| 1:30 | 条件路由示意图 | "条件路由——根据情绪检测结果决定下一步" | 要点拆解2 |
| 2:20 | 对比/实战案例图 | "对比一下常见误区和工程实践，看真实场景里怎么取舍。" | 实战与对比 |
| 3:10 | 总结卡 | "记住核心要点。下期我们追问：情绪检测用什么模型？准确率如何？" | 收尾与钩子 |
