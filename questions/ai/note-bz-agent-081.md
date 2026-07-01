---
id: note-bz-agent-081
difficulty: L3
category: ai
subcategory: LLM
tags:
- B站面经
- 幻觉
- RAG
feynman:
  essence: 缓解幻觉=生成前(RAG给事实/Prompt约束)+生成中(低温/CoT)+生成后(自检/校验/人工)。核心是"给事实+约束+验证"。检测靠事实核查/交叉验证/置信度。
  analogy: 像防止说谎——说话前查资料(RAG)、说话时谨慎(Prompt约束)、说完核对(自检)、必要时测谎(检测)。
  first_principle: 幻觉源于LLM"不知道但硬编"。缓解=给它知道的信息(RAG)+让它别说不知道的(约束)+说完检查(验证)。
  key_points:
  - 缓解三阶段：生成前/中/后
  - RAG+Prompt约束最有效
  - 检测：事实核查/交叉验证/置信度
  - 无法完全消除，只能减少
first_principle:
  essence: 幻觉是概率模型的固有特性——不确定时仍生成(而非说不知道)。
  derivation: LLM训练目标是"生成流畅文本"，不是"只说真话"。当知识不足时，它会"合理地编造"(幻觉)。缓解=补知识(RAG)+约束行为(Prompt要求不确定时说不知道)+事后核查。
  conclusion: 幻觉缓解 = 补事实(RAG) + 约束行为(Prompt) + 事后核查(验证)，无法完全消除
follow_up:
- 幻觉能完全消除吗？——不能，只能减少到可接受水平
- 怎么衡量幻觉率？——faithfulness指标+人工标注
- RAG能解决幻觉吗？——减少但不能完全解决(仍可能无视文档编造)
memory_points:
- 幻觉四种类型：事实编造、无视文档(忠实性)、逻辑错误、伪造来源
- 缓解三阶段：生成前靠RAG给事实+Prompt约束；生成中降温度+CoT拆解；生成后交叉自检
- 最有效防幻觉手段是RAG，并在Prompt强制要求“无依据则拒答”
---

# 如何有效缓解 / 检测 / 抑制大模型幻觉？

## 一、幻觉的本质与类型

```
幻觉(Hallucination) = LLM生成不真实/无依据的内容

类型：
┌──────────────────┬──────────────────────────────┐
│ 类型              │ 表现                            │
├──────────────────┼──────────────────────────────┤
│ 事实性幻觉        │ 编造不存在的事实                │
│                  │ "爱因斯坦2020年获得了诺贝尔奖"  │
├──────────────────┼──────────────────────────────┤
│ 忠实性幻觉        │ 无视给定的参考文档编造          │
│                  │ RAG给了正确文档但仍答错         │
├──────────────────┼──────────────────────────────┤
│ 推理幻觉          │ 推理过程错误导致结论错          │
│                  │ 数学计算步骤有误                │
├──────────────────┼──────────────────────────────┤
│ 来源幻觉          │ 编造引用来源                    │
│                  │ "据《Nature》2023年论文..."(不存在)│
└──────────────────┴──────────────────────────────┘
```

## 二、缓解：生成前（预防）

### RAG 提供事实

```python
# 最有效的幻觉缓解手段
def answer_with_rag(question):
    # 检索真实文档
    docs = retriever.search(question)
    
    # 强制基于文档回答
    prompt = f"""
    只基于以下文档回答。不要使用文档外的知识。
    如果文档中没有答案，说"根据提供的信息，我无法回答"。
    
    文档: {docs}
    问题: {question}
    """
    return llm.generate(prompt)
```

### Prompt 约束

```python
ANTI_HALLUCINATION_PROMPT = """
回答规则：
1. 只说你确定的内容
2. 不确定时明确说"我不确定"或"需要查证"
3. 不要编造数字/日期/人名/引用
4. 区分"事实"和"推测"，推测要标注
5. 被问到不知道的，诚实说不知道

自检：回答前问自己"这个信息我有依据吗？"
"""
```

## 三、缓解：生成中（控制）

```python
# 低温减少"创造性"幻觉
config = {
    "temperature": 0.1,    # 低温度=更确定=少幻觉
    "top_p": 0.9,
}

# CoT让推理过程透明（发现推理幻觉）
prompt += "\n请一步一步推理，展示你的思考过程。"

# 结构化输出（减少自由发挥）
prompt += "\n输出格式: {fact: ..., source: ..., confidence: ...}"
```

## 四、缓解：生成后（验证）

### 自我验证（Self-Check）

```python
def generate_with_self_check(question):
    # 1. 生成初始答案
    answer = llm.generate(question)
    
    # 2. 让LLM自检
    check_prompt = f"""
    问题: {question}
    答案: {answer}
    
    请检查答案中的每个事实声明：
    - 哪些是你确定的？
    - 哪些可能不准确？
    - 有无编造的信息？
    """
    check_result = llm.generate(check_prompt)
    
    # 3. 根据自检修正
    if check_result.has_issues:
        return llm.revise(answer, check_result.issues)
    return answer
```

### 交叉验证（Cross-Check）

```python
def cross_validate(question, n=3):
    # 生成多个答案
    answers = [llm.generate(question, temperature=0.7) for _ in range(n)]
    
    # 比较一致性
    # 多个答案一致的部分 → 可信
    # 不一致的部分 → 可能是幻觉，标注不确定
    return reconcile(answers)
```

### 外部事实核查

```python
def fact_check(response):
    """用外部工具验证事实"""
    claims = extract_claims(response)  # 提取事实声明
    
    for claim in claims:
        # 用搜索引擎验证
        search_results = web_search(claim)
        if not is_supported(claim, search_results):
            # 标记为"未经验证"
            claim.add_warning("此信息未经外部验证")
    
    return response
```

## 五、检测幻觉的方法

```python
class HallucinationDetector:
    """检测生成内容的幻觉"""
    
    def detect(self, response, context=None):
        methods = []
        
        # 方法1: Faithfulness（有context时）
        if context:
            faith = self.faithfulness_score(response, context)
            # 答案中每个claim是否在context有支持
            methods.append(("faithfulness", faith))
        
        # 方法2: 置信度分析
        logprobs = self.get_logprobs(response)
        confidence = self.analyze_confidence(logprobs)
        # 低logprob的部分可能是不确定的(幻觉)
        methods.append(("confidence", confidence))
        
        # 方法3: 一致性检测
        consistency = self.check_consistency(response)
        # 多次生成，看关键事实是否一致
        methods.append(("consistency", consistency))
        
        # 方法4: 引用验证
        citations = self.verify_citations(response)
        methods.append(("citations", citations))
        
        return aggregate(methods)
```

## 六、各方法的局限

```
┌──────────────────┬──────────────────────────────┐
│ 方法              │ 局限                            │
├──────────────────┼──────────────────────────────┤
│ RAG              │ 文档本身可能有错/检索不到       │
│ Prompt约束        │ LLM可能不遵守                  │
│ 低温              │ 降低创造性，不能消除幻觉        │
│ 自检              │ LLM可能"自信地错"(检不出)      │
│ 交叉验证          │ 多次错则验证失效               │
│ 事实核查          │ 不是所有事实都能搜到           │
└──────────────────┴──────────────────────────────┘

结论：没有单一方法能完全消除幻觉
      → 多层防护 + 接受残余风险 + 人工兜底
```

## 七、不同场景的幻觉容忍度

```
┌──────────────┬──────────┬──────────────────────┐
│ 场景          │ 容忍度    │ 防护等级              │
├──────────────┼──────────┼──────────────────────┤
│ 医疗/法律/金融 │ 极低     │ RAG+人工审核+免责声明│
│ 客服/查询      │ 低       │ RAG+事实核查         │
│ 创意写作      │ 中高     │ Prompt约束即可       │
│ 闲聊          │ 高       │ 基本不防护           │
└──────────────┴──────────┴──────────────────────┘

原则：风险越高，防护越重；风险低可放宽（避免过度工程）
```

## 八、面试加分点

1. **三阶段缓解**：生成前(RAG/Prompt)+生成中(低温/CoT)+生成后(自检/核查)
2. **无法完全消除**：幻觉是概率模型固有特性，只能减少——实事求是
3. **场景化容忍**：医疗零容忍vs闲聊高容忍——按风险分级防护

## 记忆要点

- 幻觉四种类型：事实编造、无视文档(忠实性)、逻辑错误、伪造来源
- 缓解三阶段：生成前靠RAG给事实+Prompt约束；生成中降温度+CoT拆解；生成后交叉自检
- 最有效防幻觉手段是RAG，并在Prompt强制要求“无依据则拒答”

