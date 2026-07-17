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

## 苏格拉底式面试追问

> 这组追问模拟面试官层层逼问，每一问先回答"为什么"，再回答"怎么做"，最后回答"如何证明"。

### 第一层：目标与动机

**Q：防止幻觉为什么要在输入/模型/输出三层都做，集中在某一层做透不行吗？**

因为每层的失败模式不同，单层有盲区。输入层（RAG）解决"模型不知道事实"，但如果模型拿到事实还瞎编，输入层管不了；模型层（temperature、结构化）解决"模型发散"，但低 temperature 仍有概率生成错误 token；输出层（NLI 校验）是最后一道关，能拦住前两层漏掉的。三层是纵深防御，任何单层都有 >5% 的漏过率，三层叠加才能把幻觉率压到 <1%。

### 第二层：证据与定位

**Q：你的 RAG 系统仍有 8% 的幻觉率，你怎么定位是 RAG 没检索到、还是模型没用上检索结果？**

看 Faithfulness（RAGAS 指标）和 Context Recall 的组合。如果 Context Recall 高（正确 chunk 在 top-k 里）但 Faithfulness 低，说明检索到了但模型没用，是模型层问题（可能 temperature 太高或 prompt 没强约束）；如果 Context Recall 低且 Faithfulness 低，是检索问题（正确 chunk 没召回）。每个幻觉 case 必须能看到：检索回了哪些 chunk、模型基于哪些 chunk 生成、生成内容里哪些句子没有 chunk 支撑。

### 第三层：根因深挖

**Q：你发现 Faithfulness 低的 case 里，模型明明有正确 context 却编造了 context 里没有的数字。根因是什么？**

根因是模型的"参数知识"压过了"上下文知识"。模型在预训练里见过类似但不准确的数字（如某产品参数），当 context 里的正确数字和参数知识冲突时，模型倾向于采信自己记忆里"更流畅"的版本。治本是在 prompt 里强约束："如果提供的资料里有数字，必须严格引用，禁止用自己的记忆补充"，并在输出层用正则/NLI 校验数字是否与 context 一致。更激进的是做领域微调，让模型学会"服从 context"。

**Q：那为什么不直接把 temperature 调到 0（贪心解码），彻底消除随机性，省得搞三层？**

temperature=0 只保证同一输入同一输出，不保证输出正确。模型如果对某个事实的参数知识本身是错的（预训练数据有误），temperature=0 会稳定地输出那个错的答案。而且 temperature=0 会让答案死板，对于需要适度多样性的场景（如客服话术）体验差。幻觉的根因是知识不准确和 context 利用不足，不是随机性，temperature 只能压住"胡乱发散"那部分，压不住"系统性的知识错误"。

### 第四层：方案权衡

**Q：输出层你用 NLI 模型做事实一致性校验，为什么不直接用另一个 LLM 判断（LLM-as-judge）？**

NLI 模型（如 DeBERTa-v3 微调版）快且便宜，单次推理 <50ms，适合高 QPS 在线校验；LLM-as-judge 精度略高但延迟 1-3 秒、成本高 100 倍，只适合离线评估或低频高价值场景。更关键的是 NLI 模型输出的是连续的 entailment 分数（0-1），可以设阈值（如 <0.7 触发拦截），而 LLM-as-judge 输出的是自然语言判断，还要再解析。工程上 NLI 在线、LLM-as-judge 离线，互补。

**Q：为什么不直接微调模型让它在你的领域不幻觉，一劳永逸，省掉三层工程？**

微调能降低幻觉但不能消除。模型仍会编造训练数据里没覆盖的事实，且微调后的模型对"新知识"（训练后新增的产品/政策）照样幻觉，还得靠 RAG 补。微调的代价是标注数据成本高、训练周期长、模型更新慢，而三层工程是模型无关的、可即时迭代。正确姿势是：通用模型 + 三层工程兜底，当某些领域的幻觉率仍不达标时，针对性微调（如 LoRA）做增量优化，而不是全盘替换工程方案。

### 第五层：验证与沉淀

**Q：你怎么证明三层防线把幻觉率从 20% 压到 2%，而不是评测集偏简单？**

构建对抗性评测集：故意构造"易幻觉"case（context 里数字相近、问题涉及模型预训练里的过时知识、问题诱导模型发散）。在这套高难度集上测三层防线的幻觉率，对比 baseline。同时用 GPT-4 做 LLM-as-judge 复核 NLI 的判断，避免 NLI 漏判。线上监控 Faithfulness 指标（用 RAGAS 每天抽样跑），设告警阈值（Faithfulness <0.9 触发 PagerDuty）。

**Q：这套防幻觉方案怎么沉淀成团队规范？**

固化成"防幻觉 checklist"：RAG 必须接（Context Recall 监控）、prompt 必须含"只基于资料回答"约束、temperature 默认 0.2、输出必过 NLI 校验。封装统一的 `hallucination_guard(query, context, answer)` 函数，返回校验结果和置信度，业务侧一行接入。把"易幻觉 case 库"（数字冲突、过时知识、诱导发散）沉淀成回归测试集，每次模型/prompt 改动自动跑。

## 结构化回答

**30 秒电梯演讲：** 幻觉是模型"编造"不存在的信息，工程上通过输入约束、输出验证和架构设计三层面压制——就像让学生开卷考试。

**展开框架：**
1. **输入层** — RAG检索 + 高质量Prompt约束
2. **模型层** — 降低temperature + 选择低幻觉模型
3. **输出层** — NLI验证 + 事实校验 + 结构化输出

**收尾：** 您想深入聊：如何量化测量幻觉率？


## 视频脚本

> 预计时长：4 分钟 | 由浅入深


| 时间 | 画面/字幕 | 口播台词 | 讲解要点 |
|------|----------|----------|----------|
| 0:00 | 标题卡：防止大模型幻觉的工程和Prompt手段 | "就像让学生开卷考试——给他教材(RAG)、限定答题范围(Prompt约束)、考完对答案(后…" | 开场钩子 |
| 0:20 | 核心概念图 | "幻觉是模型"编造"不存在的信息，工程上通过输入约束、输出验证和架构设计三层面压制" | 核心定义 |
| 0:50 | 输入层示意图 | "输入层——RAG检索 + 高质量Prompt约束" | 要点拆解1 |
| 1:30 | 对比/实战案例图 | "对比一下常见误区和工程实践，看真实场景里怎么取舍。" | 实战与对比 |
| 2:20 | 总结卡 | "记住核心要点。下期我们追问：如何量化测量幻觉率？" | 收尾与钩子 |
