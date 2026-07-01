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

