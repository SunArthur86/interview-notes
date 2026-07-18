---
id: note-xhs-ai-037
difficulty: L2
category: ai
subcategory: rag
tags:
- RAG
- 多轮对话
- 上下文管理
- Query改写
- 前端AI
- 面经
feynman:
  essence: "多轮对话的上下文处理有三种策略：拼历史query检索、LLM摘要压缩、query改写补全指代——根据对话长度和token预算选择"
  analogy: "你在跟客服多轮聊天。短对话=把之前的聊天记录都带上（全量拼接）；长对话=让客服先看个摘要（摘要压缩）；最聪明的方式=把'它多少钱'自动改成'iPhone 15多少钱'（query改写补全指代）"
  key_points:
  - 方式一：历史对话拼到当前query里一起检索（适合短对话）
  - 方式二：LLM对历史做摘要作为额外上下文（适合长对话，省token）
  - 方式三：query改写——用LLM把指代不清的query改写完整
  - 核心挑战：指代消解（"它"→具体指代什么）和省略补全
  - 长对话需要摘要+滑动窗口的组合策略
first_principle:
  essence: "多轮对话的检索难题是当前query可能包含指代和省略（如'它多少钱'），直接用这种query检索会失败。需要先消解指代再检索"
  derivation: "单轮对话的query是自包含的（'iPhone 15多少钱'可以直接检索）。但多轮对话中，用户通常用代词和省略（第二轮'它呢'、第三轮'有折扣吗'）。这些query的embedding与文档embedding不匹配——'它'的embedding与任何商品都无关。因此需要在检索前用历史对话补全query的语义，使其变成自包含的查询"
  conclusion: "多轮对话RAG的关键预处理是query改写——把依赖上下文的省略query转化为自包含的检索query"
follow_up:
- query改写用什么模型？大模型还是小模型？
- 摘要压缩会不会丢失关键信息？怎么保证摘要质量？
- 对话窗口设多少轮合适？
- 如果用户在多轮中切换话题怎么处理？
memory_points:
- 三种方式：拼接（短）、摘要（长）、query改写（指代）
- query改写：用历史对话补全指代和省略
- 它多少钱→iPhone 15多少钱（指代消解示例）
- 长对话用摘要+滑动窗口
---

# 【RAG多轮对话】多轮对话怎么处理上下文？

> 来源：小红书「前端 AI 项目必问：为啥不能只用向量检索？」（OCR图片内容）

## 一、问题场景

```
多轮对话示例:

用户: iPhone 15多少钱？          ← 自包含query，可直接检索
AI:   iPhone 15起售价5999元

用户: 它有几种颜色？              ← "它"指代iPhone 15，直接检索会失败
AI:   有黑色、蓝色、绿色、粉色

用户: 蓝色的有现货吗？            ← 省略了"iPhone 15"，检索结果可能混乱
AI:   蓝色iPhone 15目前有现货

用户: 打折吗？                    ← 省略了"蓝色iPhone 15"，完全依赖上下文

问题：从第2轮开始，query不再自包含
      直接用这种query做向量检索 → 召回率暴跌
```

## 二、三种处理策略

### 策略一：历史拼接检索（短对话）

```python
def retrieve_with_history(query, chat_history, retriever, max_turns=3):
    """把最近几轮对话拼接到当前query"""
    # 取最近3轮对话
    recent = chat_history[-max_turns:]
    
    # 拼接成检索query
    combined = ""
    for turn in recent:
        combined += f"用户: {turn['user']}\n"
        combined += f"助手: {turn['assistant']}\n"
    combined += f"用户: {query}"
    
    # 用拼接后的文本做检索
    results = retriever.search(combined)
    return results

# 适合：对话轮数<5，总token<2000
# 问题：历史越长，检索噪声越大
```

### 策略二：LLM摘要压缩（长对话）

```python
def retrieve_with_summary(query, chat_history, llm, retriever):
    """用LLM对历史做摘要，减少token消耗"""
    
    # Step 1: 对历史对话做摘要
    summary = llm.generate(f"""
    请将以下对话摘要为关键信息（100字以内）：
    {chat_history}
    """)
    # 示例摘要: "用户询问iPhone 15的价格(5999元)和颜色(黑/蓝/绿/粉)"
    
    # Step 2: 摘要 + 当前query组合检索
    combined = f"对话摘要: {summary}\n当前问题: {query}"
    results = retriever.search(combined)
    return results

# 适合：对话轮数>5，总token>2000
# 优势：省token，降低检索噪声
```

### 策略三：Query改写（指代消解）—推荐

```python
def rewrite_query(query, chat_history, llm):
    """用LLM改写query，补全指代和省略"""
    
    rewritten = llm.generate(f"""
    根据对话历史，将用户最新问题改写为自包含的查询。
    
    对话历史:
    {chat_history[-3:]}  # 最近3轮
    
    用户最新问题: {query}
    
    改写要求:
    1. 消解所有代词（它→具体指代对象）
    2. 补全省略的主语/宾语
    3. 保持用户原意
    4. 直接输出改写后的query，不要多余文字
    
    示例:
    历史: 用户问"iPhone 15多少钱" → "5999元"
    当前: "它有几种颜色"
    改写: "iPhone 15有几种颜色"
    """)
    return rewritten.strip()

# 完整流程
rewritten = rewrite_query(query, chat_history, llm)
results = retriever.search(rewritten)  # 用改写后的query检索
answer = llm.generate(f"基于检索结果回答: {results}\n问题: {query}")
```

## 三、策略对比

| 策略 | 适用场景 | Token消耗 | 检索效果 | 额外延迟 |
|------|---------|-----------|---------|---------|
| 历史拼接 | 短对话(<5轮) | 高 | 中等 | 0ms |
| LLM摘要 | 长对话(>5轮) | 低 | 中等 | +300ms |
| Query改写 | 所有场景 | 低 | 高 | +200ms |
| 摘要+改写 | 超长对话 | 低 | 高 | +500ms |

## 四、组合策略（生产级方案）

```
对话轮数判断
     │
     ├── < 3轮 → Query改写（轻量）
     │
     ├── 3-10轮 → Query改写 + 历史拼接
     │              （改写后的query + 最近2轮原文）
     │
     └── > 10轮 → Query改写 + 摘要
                    （改写后的query + 历史摘要）
```

```python
def adaptive_retrieve(query, chat_history, llm, retriever):
    turns = len(chat_history)
    
    # 总是用query改写
    rewritten = rewrite_query(query, chat_history, llm)
    
    if turns <= 3:
        # 短对话：直接用改写后的query检索
        return retriever.search(rewritten)
    
    elif turns <= 10:
        # 中等对话：改写query + 最近2轮原文
        context = str(chat_history[-2:]) + rewritten
        return retriever.search(context)
    
    else:
        # 长对话：改写query + 历史摘要
        summary = llm.summarize(chat_history)
        return retriever.search(f"{summary}\n{rewritten}")
```

## 五、面试加分点

1. **topic switch检测**：用户可能突然换话题（从iPhone聊到MacBook），需要检测topic switch后重置上下文窗口——可以用embedding相似度判断query与历史的语义距离
2. **缓存改写结果**：相同(历史+query)组合的改写结果可以缓存——特别是客服场景中高频问题，避免重复调用LLM改写
3. **小模型做改写**：query改写不需要强推理能力，用7B模型（如Qwen-7B）而非70B模型做改写，延迟降50%，效果差异不大
4. **指代消解评估**：可以用Coreference Resolution benchmark评估改写质量——改写后的query与人工标注的ground truth对比
5. **流式输出兼容**：query改写需要等LLM生成完改写结果后才能检索，增加了首token延迟——可以先返回一个"正在查询..."的placeholder，改写完成后流式输出检索结果

## 结构化回答

**30 秒电梯演讲：** 多轮对话的上下文处理有三种策略：拼历史query检索、LLM摘要压缩、query改写补全指代——根据对话长度和token预算选择。

**展开框架：**
1. **方式一** — 历史对话拼到当前query里一起检索（适合短对话）
2. **方式二** — LLM对历史做摘要作为额外上下文（适合长对话，省token）
3. **方式三** — query改写——用LLM把指代不清的query改写完整

**收尾：** 您想深入聊：query改写用什么模型？大模型还是小模型？


## 视频脚本

> 预计时长：3 分钟 | 由浅入深


| 时间 | 画面/字幕 | 口播台词 | 讲解要点 |
|------|----------|----------|----------|
| 0:00 | 标题卡：多轮对话怎么处理上下文？ | "你在跟客服多轮聊天。短对话=把之前的聊天记录都带上（全量拼接）；长对话=让客服先看个摘要（…" | 开场钩子 |
| 0:20 | 核心概念图 | "多轮对话的上下文处理有三种策略：拼历史query检索、LLM摘要压缩、query改写补全指代——根据对话长度和token…" | 核心定义 |
| 0:55 | 方式一示意图 | "方式一——历史对话拼到当前query里一起检索（适合短对话）" | 要点拆解1 |
| 1:30 | 对比/实战案例图 | "对比一下常见误区和工程实践，看真实场景里怎么取舍。" | 实战与对比 |

## 苏格拉底式面试追问

| 追问层级 | 面试官可能这样问 | 高分回答方向 |
|----------|------------------|--------------|
| 目标追问 | RAG多轮对话处理上下文的核心目标是什么？ | 正确理解多轮指代和省略（'它/这个'指什么），把多轮对话转成单轮可检索的query，保证检索召回正确上下文 |
| 证据追问 | 怎么处理指代消解？有哪些方案？ | 方案：用LLM做query rewrite把当前问题补全成独立query；用对话历史拼接做hybrid查询；维护对话状态机跟踪实体 |
| 边界追问 | 多少轮以内可以拼接历史，多少轮必须压缩？ | 取决于模型上下文窗口和延迟要求，一般近3-5轮拼接，超过窗口或延迟敏感时压缩摘要历史 |
| 反例追问 | 简单拼接所有历史query检索够不够？ | 不够。指代未消解时检索会跑偏（'它'指代不明），且历史过长稀释当前query信号，召回质量下降 |
| 风险追问 | 多轮上下文处理的风险有哪些？ | 指代消解错误导致检索跑偏、历史过长延迟增加、压缩摘要丢信息、跨主题切换时旧上下文干扰 |
| 验证追问 | 怎么验证多轮处理效果？ | 多轮对话评测集、人工badcase、对话连贯性评分、A/B测试用户满意度 |
| 沉淀追问 | 多轮对话方案怎么沉淀？ | 规范：默认query rewrite、轮次和压缩阈值、多轮评测集、badcase监控 |

### 现场对话示例
**面试官**：RAG多轮对话怎么处理上下文？
**候选人**：核心是指代消解和query补全——用LLM做query rewrite把'它/这个'补全成独立query再检索，避免指代不明跑偏。
**面试官**：简单拼接所有历史query检索行吗？
**候选人**：不行，指代未消解会跑偏，历史过长稀释当前query信号，必须先rewrite再检索。
**面试官**：历史太长怎么办？
**候选人**：近3-5轮拼接，超过窗口或延迟敏感时压缩成摘要，跨主题切换时清理旧上下文避免干扰。
