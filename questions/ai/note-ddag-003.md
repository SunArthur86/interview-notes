---
id: note-ddag-003
difficulty: L4
category: ai
subcategory: RAG
tags:
- AgenticRAG
- RAG
- Agent
- 滴滴
- 面经
- 检索策略
feynman:
  essence: 传统RAG是"一次检索→一次生成"的单轮管道，当问题需要多步推理、多源检索、或判断"何时停止检索"时就力不从心。Agentic RAG让LLM成为"检索的决策者"——自主决定查什么、查几次、何时停止、如何综合，从而处理复杂的多跳问题和动态检索场景。
  analogy: 传统RAG像一个只会按菜谱做菜的厨师——给你什么食材就做什么菜。Agentic RAG像一个有判断力的厨师——发现食材不够会自己去买、尝味道不对会调整调料、一道菜需要多个步骤会按顺序完成。
  first_principle: 复杂问题的信息需求是动态的——你无法在提问时就知道需要检索几次、查哪些源。传统RAG的"一次检索"假设信息需求是静态的，而Agentic RAG承认信息需求是逐步揭示的。
  key_points:
  - '传统RAG: query→检索→生成(单轮管道)'
  - 'Agentic RAG: query→规划→迭代检索→判断→综合(多轮闭环)'
  - '核心能力: 自主决定检索策略 + 多跳推理 + 动态终止判断'
  - '预处理摘要解决静态问题，Agentic RAG解决动态问题'
first_principle:
  essence: 信息检索的本质需求是"找到回答问题所需的充分信息"。但充分性的判断依赖于已检索到的内容——这是一个动态的、迭代的过程。
  derivation: 用户提问 → 检索一次 → 评估是否信息充分 → 不够则改写query再检索 → 直到信息充分才生成 → 这个迭代判断过程需要LLM的推理能力 → 所以需要Agent
  conclusion: Agentic RAG的本质是"把检索从固定管道变为LLM自主决策的迭代过程"
follow_up:
- Agentic RAG的延迟比传统RAG高很多，怎么平衡？
- 什么场景下Agentic RAG反而不如传统RAG？
- Agentic RAG怎么评估效果？
- 多跳推理的"跳数"怎么控制？
memory_points:
- '传统RAG单轮(检索到生成) vs Agentic RAG多轮(检索到评估到再检索到生成)'
- '核心差异: 检索策略是预设的 vs 检索策略由LLM动态决定'
- 'Agentic RAG适用: 多跳问题/多源融合/需要推理判断的复杂查询'
- '传统RAG适用: 直接事实问答/简单FAQ/延迟敏感场景'
---

# 为什么需要Agentic RAG？传统RAG加摘要召回不行吗？

## 🎯 本质

预处理摘要解决的是"静态优化"（提前处理好文档），但复杂问题的信息需求是**动态的**——需要多步推理、多源检索、迭代判断"信息是否充分"。Agentic RAG将检索从固定管道升级为LLM自主决策的迭代闭环。

## 🧒 费曼类比

传统RAG = 自动售货机（投币→出货，一步到位）；Agentic RAG = 有经验的采购员（看需求→找供应商→比价→补充采购→直到齐全）。

## 📊 架构对比

```
传统RAG (Pipeline):
┌──────┐    ┌──────┐    ┌──────┐    ┌──────┐
│ Query│───→│Retrieve│──→│Generate│──→│Answer│
└──────┘    └──────┘    └──────┘    └──────┘
  问题: 只检索一次，不管够不够

Agentic RAG (Closed-Loop):
┌──────┐    ┌──────────┐
│ Query│───→│  Agent    │
└──────┘    │  (大脑)   │
            └─────┬────┘
                  │
         ┌────────┼────────┐
         ▼        ▼        ▼
    ┌─────────┐┌────────┐┌────────┐
    │规划:    ││检索:   ││评估:   │
    │需要查   ││执行检索││信息够  │
    │什么?    ││        ││了吗?   │
    └─────────┘└────────┘└────────┘
         │        │        │
         └────────┼────────┘
                  │ 不够 ──→ 改写query → 再检索
                  │ 够了 ──→ 综合生成答案
                  ▼
            ┌──────────┐
            │  Answer  │
            └──────────┘
```

## 🔧 专业详解

### 为什么预处理摘要不够？

预处理摘要确实能解决一部分问题：
- ✅ 文档过长 → 提前摘要压缩
- ✅ 语义模糊 → 提前提取关键词
- ✅ 结构化 → 提前做表格/图表描述

但**无法解决**的问题：

| 问题类型 | 示例 | 为什么摘要不够 |
|---------|------|--------------|
| **多跳推理** | "A公司CEO毕业的大学在哪个城市？" | 需要先查A公司CEO→再查大学→再查城市，3次检索 |
| **条件检索** | "如果退货政策适用，退款多久？不适用呢？" | 需要先判断条件→分支检索 |
| **动态信息需求** | "对比X和Y两个产品的性能差异" | 摘要里不一定有对比信息，需要分别检索后综合 |
| **迭代深化** | "这个bug的根因是什么？" | 需要先查错误日志→定位模块→查模块文档→追根因 |

### Agentic RAG的核心能力

```python
class AgenticRAG:
    def answer(self, query: str) -> str:
        # Step 1: 规划 — 分析问题需要哪些信息
        plan = self.llm.plan(query)
        # e.g., "需要: 1)A公司CEO是谁 2)CEO的毕业院校 3)院校所在城市"
        
        collected_info = []
        
        for step in plan.steps:
            # Step 2: 检索 — 根据当前需要动态检索
            search_query = self.rewrite_query(step, collected_info)
            chunks = self.retrieve(search_query)
            
            # Step 3: 评估 — 信息是否足够回答这一步?
            enough = self.llm.evaluate(step, chunks, collected_info)
            
            if not enough:
                # Step 4: 补充 — 改写query或换数据源
                alt_query = self.rewrite_query(step, chunks, strategy='expand')
                more_chunks = self.retrieve(alt_query)
                chunks.extend(more_chunks)
            
            collected_info.append(extract_answer(step, chunks))
        
        # Step 5: 综合 — 融合多步信息生成最终答案
        return self.llm.synthesize(query, collected_info)
```

### 传统RAG vs Agentic RAG对比

| 维度 | 传统RAG | Agentic RAG |
|------|---------|-------------|
| **检索次数** | 1次 | 1-N次（动态） |
| **延迟** | 低（1-3秒） | 高（5-30秒） |
| **复杂问题处理** | 弱 | 强 |
| **简单问题处理** | 够用 | 过度设计 |
| **成本** | 低 | 高（多次LLM调用） |
| **可控性** | 高（固定管道） | 低（Agent自主决策） |
| **适用场景** | FAQ/直接事实问答 | 多跳推理/复杂分析 |

### 实际架构：何时用Agentic RAG

```python
def routing_rag(query: str) -> str:
    """智能路由: 简单问题走传统RAG，复杂问题走Agentic"""
    
    # 用轻量模型判断问题复杂度
    complexity = classify_complexity(query)
    
    if complexity == 'simple':
        # "退款政策是什么?" → 传统RAG
        return traditional_rag(query)
    
    elif complexity == 'multi_hop':
        # "A公司CEO毕业的学校排名多少?" → Agentic RAG
        return agentic_rag(query)
    
    elif complexity == 'comparative':
        # "对比X和Y的优劣" → 多路检索+综合
        return multi_source_rag(query)
```

## 💡 例子

**场景：用户问"虾皮的退货政策比Lazada严格吗？"**

- **预处理摘要+传统RAG**：
  - 检索"虾皮退货政策" → 返回虾皮退货摘要
  - 检索"Lazada退货政策" → 返回Lazada退货摘要
  - 问题：两个摘要是分开的，LLM可能无法有效对比

- **Agentic RAG**：
  1. Plan: 需要①虾皮退货条件 ②Lazada退货条件 ③对比维度
  2. 检索①→"虾皮：7天退货，需商品完好"
  3. 检索②→"Lazada：15天退货，需原包装"
  4. 评估→"需要更具体的限制条件对比"
  5. 补充检索→"虾皮定制商品不可退" / "Lazada生鲜不可退"
  6. 综合→"Lazada退货窗口更长(15天vs7天)，但虾皮对定制商品限制更严。总体Lazada更宽松。"

## ❓ 苏格拉底式面试追问

1. **"Agentic RAG的延迟是传统RAG的5-10倍，用户能接受吗？"**
   → 分级处理：简单问题路由到传统RAG(2秒)，复杂问题才用Agentic(10秒) + 流式输出让用户感知响应在进行

2. **"Agent会不会陷入无限检索循环？"**
   → 设置最大迭代次数(如5轮) + 每轮评估检索增益(新信息量<阈值则停止) + 超时机制

3. **"你说读和写都搞不定，具体是什么场景？"**
   → 读：复杂多跳问题一次检索信息不够 → 写：生成后需要验证并补充修正 → 传统RAG的管道结构无法支持这种迭代

4. **"Agentic RAG和ReAct有什么区别？"**
   → ReAct是一种通用的Agent推理框架(Thought→Action→Observation)，Agentic RAG是ReAct在检索场景的特化应用

## 结构化回答

**30 秒电梯演讲：** 传统RAG是"一次检索→一次生成"的单轮管道，当问题需要多步推理、多源检索、或判断"何时停止检索"时就力不从心。Agentic RAG让LLM成为"检索的决策者"——自主决定查什么、查几次、何时停止、如何综合。

**展开框架：**
1. **传统RAG** — query→检索→生成(单轮管道)
2. **Agentic RAG** — query→规划→迭代检索→判断→综合(多轮闭环)
3. **核心能力** — 自主决定检索策略 + 多跳推理 + 动态终止判断

**收尾：** 您想深入聊：Agentic RAG的延迟比传统RAG高很多，怎么平衡？


## 视频脚本

> 预计时长：5 分钟 | 由浅入深


| 时间 | 画面/字幕 | 口播台词 | 讲解要点 |
|------|----------|----------|----------|
| 0:00 | 标题卡：为什么需要Agentic RAG？传统RAG加摘… | "传统RAG像一个只会按菜谱做菜的厨师——给你什么食材就做什么菜。Agentic RAG像一…" | 开场钩子 |
| 0:20 | 核心概念图 | "传统RAG是"一次检索→一次生成"的单轮管道，当问题需要多步推理、多源检索、或判断"何时停止检索"时就力不从心。…" | 核心定义 |
| 0:50 | 传统RAG示意图 | "传统RAG——query→检索→生成(单轮管道)" | 要点拆解1 |
| 1:30 | Agentic RAG示意图 | "Agentic RAG——query→规划→迭代检索→判断→综合(多轮闭环)" | 要点拆解2 |
| 2:20 | 对比/实战案例图 | "对比一下常见误区和工程实践，看真实场景里怎么取舍。" | 实战与对比 |
| 3:10 | 总结卡 | "记住核心要点。下期我们追问：Agentic RAG的延迟比传统RAG高很多，怎么平衡？" | 收尾与钩子 |
