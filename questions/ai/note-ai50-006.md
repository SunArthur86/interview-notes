---
id: note-ai50-006
difficulty: L3
category: ai
subcategory: Agent
tags:
- 某厂
- 面经
- 幻觉
- Prompt工程
- RAG
feynman:
  essence: 幻觉是模型"编造"不存在的信息，工程上通过输入约束、输出验证和架构设计三层面压制
  analogy: 就像让学生开卷考试——给他教材(RAG)、限定答题范围(Prompt约束)、考完对答案(后处理校验)，三管齐下防止瞎编
  first_principle: 幻觉源于LLM的自回归生成机制——模型基于概率分布预测下一个token，当训练数据中缺乏确切知识时，概率最高的token可能是编造的
  key_points:
  - '输入层: RAG检索 + 高质量Prompt约束'
  - '模型层: 降低temperature + 选择低幻觉模型'
  - '输出层: NLI验证 + 事实校验 + 结构化输出'
  - '系统层: 多轮自检 + Human-in-the-loop'
first_principle:
  essence: 幻觉是自回归语言模型的固有特性，无法消除只能压制
  derivation: LLM生成第t个token时，P(token_t | context)是概率分布。当context不足以确定答案时，高概率token可能不是事实正确的。降低temperature使分布更尖锐但不能根除
  conclusion: 工程上通过"约束输入→控制生成→验证输出"三层防线将幻觉率从30%降到5%以下
follow_up:
- 如何量化测量幻觉率？
- CoT(思维链)会增加还是减少幻觉？
- 模型微调能否减少特定领域的幻觉？
memory_points:
- 三层防线：输入层防发散、模型层降随机、输出层强校验。
- 输入层靠RAG提供真实文档并用Prompt强约束（如要求只基于资料回答并标注来源）。
- 模型层调低temperature（0.1-0.3）并强制JSON结构化输出限制自由发挥；输出层用NLI模型做事实一致性校验。
---

# 防止大模型幻觉的工程和Prompt手段

## 三层防线架构

```
┌─────────────────────────────────────────────┐
│           用户Query                          │
│                 │                            │
│  ┌──────────────▼──────────────┐            │
│  │     输入层防御                │            │
│  │  • RAG检索真实文档            │            │
│  │  • Prompt约束("只基于以下信息") │            │
│  │  • Few-shot示范正确行为       │            │
│  └──────────────┬──────────────┘            │
│                 │                            │
│  ┌──────────────▼──────────────┐            │
│  │     模型层防御                │            │
│  │  • temperature=0.1~0.3       │            │
│  │  • 选择低幻觉模型(GPT-4等)    │            │
│  │  • 结构化输出(JSON Schema)    │            │
│  └──────────────┬──────────────┘            │
│                 │                            │
│  ┌──────────────▼──────────────┐            │
│  │     输出层防御                │            │
│  │  • NLI一致性校验              │            │
│  │  • 事实性校验(查数据库)       │            │
│  │  • 置信度过滤 + 兜底回复      │            │
│  └─────────────────────────────┘            │
└─────────────────────────────────────────────┘
```

## 输入层：Prompt工程

### 1. RAG约束型Prompt

```python
SYSTEM_PROMPT = """你是一个专业的知识助手。请严格遵守以下规则：

1. 只根据下面提供的【参考资料】回答问题
2. 如果参考资料中没有相关信息，请回答"根据现有资料，我无法回答这个问题"
3. 不要编造、推测或补充参考资料中没有的信息
4. 回答时标注信息来源，格式: [来源: 文档名]
5. 对于数字、日期、名称等关键信息，必须与参考资料完全一致

【参考资料】:
{retrieved_documents}

【用户问题】: {user_question}
"""
```

### 2. 结构化输出约束

```python
# 强制模型输出结构化JSON，减少自由发挥空间
OUTPUT_SCHEMA = {
    "answer": "基于资料的回答内容",
    "confidence": "high/medium/low",
    "sources": ["引用的文档片段"],
    "uncertain_points": ["不确定的地方"]
}

# 使用JSON Mode或Function Calling强制结构化
response = client.chat.completions.create(
    model="gpt-4",
    messages=[...],
    response_format={"type": "json_object"},
    temperature=0.1
)
```

### 3. Self-Check Prompt

```python
# 生成答案后让模型自检
CHECK_PROMPT = """请检查以下回答是否存在问题：

问题: {question}
回答: {answer}
参考资料: {documents}

请检查:
1. 回答中是否有参考资料不支持的内容？
2. 是否有编造的数字、日期或名称？
3. 回答是否准确反映了参考资料的含义？

如果发现问题，请修正。如果没问题，原样返回。
"""
```

## 模型层：参数调优

| 参数 | 推荐值 | 作用 |
|------|--------|------|
| temperature | 0.1-0.3 | 降低随机性，减少创造性"编造" |
| top_p | 0.85-0.9 | 限制候选token范围 |
| frequency_penalty | 0.3-0.5 | 减少重复编造同一类信息 |
| max_tokens | 根据场景限制 | 防止模型"发散" |
| seed | 固定值 | 可复现，便于调试 |

## 输出层：后处理校验

### NLI一致性校验

```python
from sentence_transformers import CrossEncoder

# 用NLI模型检查answer是否被documents支持
nli_model = CrossEncoder('cross-encoder/nli-deberta-v3-base')

def check_faithfulness(answer, documents):
    """检查答案是否忠于文档"""
    pairs = [(documents, answer)]
    scores = nli_model.predict(pairs)
    # scores: [contradiction, neutral, entailment]
    entailment_score = scores[0][2]
    
    if entailment_score > 0.7:
        return True, "答案被文档支持"
    elif scores[0][0] > 0.5:
        return False, "答案与文档矛盾，可能有幻觉"
    else:
        return None, "无法确定，建议人工审核"
```

### 事实性校验

```python
def fact_check(answer, knowledge_base):
    """对关键事实做数据库校验"""
    # 提取答案中的数值、日期、名称
    entities = extract_entities(answer)
    
    for entity in entities:
        if entity.type == 'number':
            # 查数据库验证数值
            db_value = knowledge_base.lookup(entity)
            if db_value and abs(db_value - entity.value) > 0.01:
                return False, f"数值不匹配: 答案{entity.value}, 实际{db_value}"
    
    return True, "事实校验通过"
```

## 各层效果量化

| 防御层级 | 幻觉率降低 | 实现成本 | 延迟增加 |
|---------|-----------|---------|---------|
| 无防御 | 基准~30% | - | - |
| +RAG约束 | 30%→15% | 低 | +200ms |
| +temperature=0.1 | 15%→12% | 零 | 0 |
| +结构化输出 | 12%→8% | 低 | 0 |
| +Self-Check | 8%→5% | 中(多一次调用) | +1s |
| +NLI校验 | 5%→3% | 中 | +200ms |
| +事实校验 | 3%→<2% | 高 | +100ms |

## 工业级综合方案

```python
def anti_hallucination_pipeline(query, vector_store):
    # 1. RAG检索
    docs = vector_store.search(query, top_k=5)
    
    # 2. 约束生成
    answer = llm.generate(
        prompt=build_constrained_prompt(query, docs),
        temperature=0.1,
        response_format="json"
    )
    
    # 3. Self-Check
    checked = llm.generate(
        prompt=build_check_prompt(query, answer, docs)
    )
    
    # 4. NLI校验
    is_faithful, reason = check_faithfulness(checked, docs)
    
    if not is_faithful:
        return fallback_response(reason)
    
    return checked
```

## 记忆要点

- 三层防线：输入层防发散、模型层降随机、输出层强校验。
- 输入层靠RAG提供真实文档并用Prompt强约束（如要求只基于资料回答并标注来源）。
- 模型层调低temperature（0.1-0.3）并强制JSON结构化输出限制自由发挥；输出层用NLI模型做事实一致性校验。

