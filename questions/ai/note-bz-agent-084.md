---
id: note-bz-agent-084
difficulty: L3
category: ai
subcategory: Agent
tags:
- B站面经
- 客服Agent
- FAQ
feynman:
  essence: 智能客服Agent=意图识别(路由)+多技能处理(FAQ/订单/退款)+人工协作(转人工)+持续学习(Bad Case)。FAQ匹配用混合检索(向量+关键词+Rerank)。
  analogy: 像银行大堂经理——先问你要办什么(意图)，引导到对应窗口(技能)，复杂的找主管(人工)，事后总结经验(学习)。
  first_principle: 客服是高频高重复场景，Agent能处理80%常见问题，复杂转人工。核心是准确路由+高效解决+优雅兜底。
  key_points:
  - 架构：意图路由→技能处理→人工协作
  - FAQ匹配：向量+关键词+Rerank混合
  - 人工协作：无缝转接+上下文传递
  - 持续优化：Bad Case驱动迭代
first_principle:
  essence: 客服Agent的价值=自动化高频问题，人工聚焦复杂问题。
  derivation: 80%客服是重复问题(FAQ/查询)，可用Agent自动处理。20%复杂/情绪化问题需人工。Agent的职责是高效处理那80%，并优雅地把20%转给人工。
  conclusion: 客服Agent = 自动化80%高频 + 优雅转接20%复杂 + 持续学习
follow_up:
- FAQ匹配准确率怎么提升？——混合检索+Rerank+Few-shot
- 什么时候转人工？——情绪激动/重复提问/超出能力/用户要求
- 怎么衡量客服Agent效果？——解决率+满意度+转人工率
memory_points:
- 核心路由是意图识别：分流至FAQ匹配、业务API、或人工接管
- 转人工四信号：情绪愤怒、连续失败两次、用户主动要求、业务逻辑极度复杂
- FAQ优化靠RAG混合检索：向量抓语义，BM25抓专有词，Rerank精排提召回
---

# 智能客服 Agent 如何设计？FAQ 匹配算法怎么优化？

## 一、客服 Agent 整体架构

```
┌──────────────────────────────────────────────────┐
│              智能客服Agent架构                       │
├──────────────────────────────────────────────────┤
│                                                    │
│  用户消息                                          │
│      │                                            │
│      ▼                                            │
│  ┌──────────────┐                                │
│  │ 意图识别      │ → 判断用户要干什么               │
│  │ (Intent)     │                                │
│  └──────┬───────┘                                │
│         │                                        │
│    ┌────┼────┬────────┐                          │
│    ▼    ▼    ▼        ▼                          │
│  FAQ  订单  退款    转人工                          │
│  匹配  查询  流程   (复杂/情绪)                    │
│    │    │    │                                    │
│    └────┴────┘                                    │
│         │                                        │
│         ▼                                        │
│  ┌──────────────┐                                │
│  │ 回复生成      │ → 生成友善回复                  │
│  └──────┬───────┘                                │
│         │                                        │
│         ▼                                        │
│  ┌──────────────┐                                │
│  │ 满意度收集    │ → 点赞/点踩/追问                │
│  └──────────────┘                                │
│                                                    │
└──────────────────────────────────────────────────┘
```

## 二、意图识别与路由

```python
class CustomerServiceRouter:
    """意图识别+路由"""
    
    INTENTS = {
        "faq": "常见问题咨询",
        "query_order": "查询订单/物流",
        "refund": "退款/退货",
        "complaint": "投诉/不满",
        "modification": "修改信息",
        "human": "需要人工",
        "chitchat": "闲聊",
    }
    
    def route(self, message, context):
        # 识别意图
        intent = self.recognize(message, context)
        
        # 路由到对应处理器
        handler = self.handlers.get(intent, self.fallback)
        return handler
    
    def should_transfer_human(self, message, context):
        """判断是否需要转人工"""
        signals = [
            self.detect_emotion(message) == "angry",  # 情绪激动
            context.consecutive_failures >= 2,          # 连续失败
            "人工" in message,                          # 用户要求
            context.topic_complexity > THRESHOLD,       # 太复杂
        ]
        return any(signals)
```

## 三、FAQ 匹配算法优化（重点）

```python
class FAQMatcher:
    """FAQ匹配：向量+关键词+Rerank混合"""
    
    def __init__(self):
        self.faq_index = VectorIndex()  # FAQ向量索引
        self.bm25 = BM25Index()         # 关键词索引
        self.reranker = CrossEncoder()  # 重排器
    
    def match(self, query, top_k=3):
        # === 第1路：向量检索（语义匹配）===
        dense_results = self.faq_index.search(
            embed(query), k=20
        )
        
        # === 第2路：BM25（关键词精确匹配）===
        sparse_results = self.bm25.search(query, k=20)
        
        # === 融合（RRF）===
        fused = self.rrf_merge(dense_results, sparse_results)
        
        # === Rerank精选 ===
        reranked = self.reranker.rerank(query, fused[:20])
        top_matches = reranked[:top_k]
        
        # === 阈值过滤 ===
        confident = [m for m in top_matches if m.score > 0.75]
        
        if not confident:
            return None  # 没有高置信匹配 → 可能需转人工
        
        return confident[0]  # 返回最佳匹配

# FAQ数据结构
FAQ_ENTRY = {
    "id": "faq_001",
    "question": "怎么修改收货地址？",
    "answer": "订单未发货可在订单详情页修改...",
    "variants": [  # 问法变体（提升召回）
        "改地址", "修改地址", "换收货地址",
        "收货信息错了"
    ],
    "keywords": ["修改", "地址", "收货"],
}
```

### FAQ 优化技巧

```python
# 1. 问法扩展（一个FAQ多种问法）
# 用户可能问："咋改地址"/"地址写错了"/"换收货地"
# 都映射到同一FAQ

# 2. 同义词扩展
SYNONYMS = {
    "退款": ["退钱", "退货", "return", "refund"],
    "物流": ["快递", "发货", "配送"],
}

# 3. 否定意图识别
# "我不想退款" → 不是refund意图
# 需要LLM理解否定语义

# 4. 上下文感知
def match_with_context(query, conversation_history):
    # "那怎么退款呢" → "那"指代上文讨论的商品
    resolved = resolve_coreference(query, history)
    return self.match(resolved)
```

## 四、对话流程管理

```python
class CustomerServiceFlow:
    """管理多轮对话流程"""
    
    async def handle(self, message, session):
        # 1. 检查是否有进行中的流程
        if session.current_flow:
            return await self.continue_flow(session, message)
        
        # 2. 新意图
        intent = self.router.route(message, session)
        
        if intent == "refund":
            return await self.refund_flow(session, message)
        elif intent == "faq":
            return await self.faq_flow(session, message)
        # ...
    
    async def refund_flow(self, session, message):
        """退款流程：多步骤"""
        session.current_flow = "refund"
        
        if session.flow_step == 0:
            # 确认订单
            return "请问您要退哪个订单？请提供订单号"
        elif session.flow_step == 1:
            # 确认原因
            session.order_id = extract_order(message)
            return "请问退款原因是什么？"
        elif session.flow_step == 2:
            # 提交
            result = submit_refund(session.order_id, message)
            session.current_flow = None  # 流程结束
            return f"退款已提交，预计3-5工作日到账"
```

## 五、人工协作

```python
class HumanHandoff:
    """无缝转人工"""
    
    async def transfer(self, session, reason):
        # 1. 打包上下文给人工
        context_package = {
            "user_id": session.user_id,
            "conversation": session.history,
            "summary": self.summarize(session.history),
            "intent": session.last_intent,
            "transfer_reason": reason,
            "user_emotion": self.emotion(session),
            "priority": self.calc_priority(session),
        }
        
        # 2. 分配客服（按技能/负载）
        agent = await self.assign_agent(context_package)
        
        # 3. 通知用户
        return f"正在为您转接人工客服，预计等待{agent.wait_time}分钟。" \
               f"已将您的问题转告客服，请稍候。"
```

## 六、效果指标

```python
cs_metrics = {
    "自助解决率": "Agent独立解决的请求比例（目标>70%）",
    "转人工率": "转人工的请求比例（目标<25%）",
    "首次解决率": "FCR，一次解决的比例（目标>80%）",
    "平均处理时间": "AHT（目标<2分钟）",
    "用户满意度": "CSAT（目标>4.0/5）",
    "FAQ命中率": "FAQ匹配准确率（目标>90%）",
    "转人工准确率": "该转的转了/不该转的没转",
}

# 持续优化
optimization_loop = {
    "收集Bad Case": "记录解决失败/转人工的case",
    "分析原因": "意图识别错/FAQ没匹配上/流程卡住",
    "针对性优化": "补FAQ/改规则/调prompt",
    "回归测试": "确保优化不引入新问题",
}
```

## 七、面试加分点

1. **混合 FAQ 匹配**：向量+BM25+Rerank 三路融合——这是业界最佳实践
2. **问法扩展**：一个 FAQ 配多种问法变体——简单但有效的召回提升
3. **人工协作不是失败**：优雅转人工是客服 Agent 的重要能力——20%转人工是正常的

## 记忆要点

- 核心路由是意图识别：分流至FAQ匹配、业务API、或人工接管
- 转人工四信号：情绪愤怒、连续失败两次、用户主动要求、业务逻辑极度复杂
- FAQ优化靠RAG混合检索：向量抓语义，BM25抓专有词，Rerank精排提召回

## 苏格拉底式面试追问

> 这组追问模拟面试官层层逼问，每一问先回答"为什么"，再回答"怎么做"，最后回答"如何证明"。

### 第一层：目标与动机

**Q：你的目标自助解决率 > 70%，但业务方说要做到 90% 省更多客服人力。你怎么说服业务方 70% 是合理的而不是定低了？**

70% 是综合 ROI 的最优点，不是技术做不到更高。强行拉到 90% 会出现两个副作用：一是误答率上升——为了多解决，把本该转人工的复杂/模糊 case 也强行答，答错导致二次客诉，净解决率反而下降。二是用户体验下降——该转人工的不转，用户被 Agent 来回绕，满意度（CSAT）掉。我给业务方算账：70% 自助 + 30% 人工的成本，比 90% 自助但 CSAT 掉导致 10% 流失的损失低。所以 70% 是"自助率 × 准确率 × CSAT"综合最优，不是技术天花板。

### 第二层：证据与定位

**Q：FAQ 命中率从 92% 掉到 85%，你怎么定位是 FAQ 库不全、embedding 模型退化、还是用户问法变了？**

三步归因。第一看未命中样本——如果未命中的问题在 FAQ 库里根本没有对应条目（新业务/新产品的问题），是 FAQ 库不全，要补条目。第二看未命中样本的 embedding 相似度——如果最相似 FAQ 的 cosine 相似度从 0.85 掉到 0.7，是 embedding 模型在新词上表现差（模型对最近流行词/产品新名词的语义理解退化），要更新 embedding 模型或加同义词。第三看用户问法分布——如果最近多了大量"语音转文字"的输入（含错别字、口语化），是输入形态变了，要在召回前加纠错/归一化。三类原因治理手段完全不同，不归因就瞎调。

### 第三层：根因深挖

**Q：你用向量 + BM25 + Rerank 三路，但 Rerank（CrossEncoder）很慢（单次几十毫秒），FAQ 有上万条时 Rerank 成瓶颈，怎么办？**

根因是 Rerank 对全量候选做精排，候选太多就慢。解法是"漏斗式过滤"——向量 + BM25 召回时只取 Top 20（不是全量），Rerank 只对这 20 条做精排，单次 Rerank 耗时 = 20 × 30ms = 600ms，可接受。如果还嫌慢，用更轻的 Rerank 模型（如 bge-reranker-base 比 large 快 3 倍、精度降 2%）。所以 Rerank 慢不是因为方法问题，是因为没控制候选量。正确架构是召回层（快、宽、召回 Top 20）+ Rerank 层（慢、窄、精排 Top 3），漏斗逐层精简，Rerank 永远只处理几十条不是上万条。

**Q：那为什么不直接用向量召回的 Top 1，向量模型现在也很强了，还要 BM25 和 Rerank 干嘛？**

因为向量召回有盲区。向量擅长语义匹配（"咋改地址"匹配"修改收货地址"），但对专有名词、型号、订单号等"字面精确匹配"的场景弱——用户搜"SKU-A123 的保修"，向量可能把它匹配到别的 SKU 的保修（语义相近但型号不同）。BM25 基于字面匹配，能精准命中"SKU-A123"。两路融合（RRF）才能既覆盖语义又覆盖字面。Rerank 的价值是解决"召回进 Top 20 但顺序错"的问题——向量召回的 Top 1 可能不如 Top 3 准，Rerank 用更强的 CrossEncoder 重新排序提精度。三路各有不可替代的价值，不是冗余。

### 第四层：方案权衡

**Q：转人工你用四个信号（情绪/连续失败/用户要求/复杂度），但"连续失败 2 次"就转人工是不是太早？万一第三次就成功了呢？**

这是"用户耐心 vs 解决率"的权衡。我们做过数据：连续失败 2 次后，第三次成功的概率只有 15%，但用户的 CSAT 已经从 4.2 掉到 2.5（因为被绕了三次）。继续尝试把那 15% 救回来，代价是 85% 的用户带着极差体验离开。所以 2 次就转人工是用"放弃 15% 的自助解决"换"85% 用户的体验止损"，净收益正。而且转人工不等于失败——人工接手时带上 Agent 已收集的信息（订单号、问题描述），人工解决更快。所以"2 次转人工"不是早，是体验护栏。具体阈值可以按业务调（简单业务 2 次，复杂流程 3 次），但必须有上限不能无限重试。

**Q：为什么不直接每个用户都配人工，反正客服人力是固定的，Agent 省下来的人力不也还是成本？**

因为 Agent 解决的是"并发峰值"，不是"总人力"。客服的痛点是峰值时段（大促、故障）并发量是平时的 5-10 倍，靠人力堆要养平时用不上的客服（成本高），不堆就峰值时排队（体验差）。Agent 能在峰值时挡掉 70% 的常见问题，让人力只处理复杂的 30%，等于用 Agent 做了"弹性扩容"。而且 Agent 7×24 在线，夜间/凌晨人力不足时 Agent 兜底。所以 Agent 的价值不是"替代人力"，是"削峰填谷 + 离峰兜底"，让有限的人力专注于高价值的复杂 case。

### 第五层：验证与沉淀

**Q：你怎么持续提升 FAQ 命中率，证明优化是长期有效的而不是一次性？**

建立"Bad Case 闭环"。每天把"未命中转人工"和"用户点踩"的 case 自动入库，人工分析根因（FAQ 缺失/问法没覆盖/embedding 差/否定意图没识别），分类统计后按优先级治理（高频根因先治）。治理后跑回归评测集（确保不引入新问题）再上线。关键指标是"FAQ 命中率"和"转人工率"的周趋势——持续优化的系统这两个指标应该稳步改善。如果停滞，说明 Bad Case 闭环断了（没在分析或没在治理），要查流程不是查技术。我之前的项目用这套闭环，FAQ 命中率从 80% 稳步提到 93%，是周迭代积累的不是一次调优。

**Q：客服 Agent 怎么沉淀成可复用的平台？**

抽象成"客服 Agent 中台"，把意图路由/FAQ 匹配/流程管理/转人工/指标采集做成标准能力，各业务线（电商/金融/教育）接入只配置自己的 FAQ 库和业务流程。FAQ 库用统一平台管理（运营能直接增删改问法，不用研发发版），意图和槽位配置化。配套 Bad Case 看板（各业务线看自己的未命中分析和治理进度）。这样客服能力是公司级的，新业务线接入一周上线，不用从零搭 Agent，且各业务线的优化经验（如某类问法的处理技巧）能沉淀到中台共享。

## 结构化回答

**30 秒电梯演讲：** 智能客服Agent=意图识别(路由)+多技能处理(FAQ/订单/退款)+人工协作(转人工)+持续学习(Bad Case)。FAQ匹配用混合检索(向量+关键词+Rerank)。

**展开框架：**
1. **架构** — 意图路由→技能处理→人工协作
2. **FAQ匹配** — 向量+关键词+Rerank混合
3. **人工协作** — 无缝转接+上下文传递

**收尾：** 您想深入聊：FAQ匹配准确率怎么提升？——混合检索+Rerank+Few-shot？


## 视频脚本

> 预计时长：4 分钟 | 由浅入深


| 时间 | 画面/字幕 | 口播台词 | 讲解要点 |
|------|----------|----------|----------|
| 0:00 | 标题卡：智能客服 Agent 如何设计？FAQ 匹配算法… | "像银行大堂经理——先问你要办什么(意图)，引导到对应窗口(技能)，复杂的找主管(人工)，事…" | 开场钩子 |
| 0:20 | 核心概念图 | "智能客服Agent=意图识别(路由)+多技能处理(FAQ/订单/退款)+人工协作(转人工)+持续学习(Bad Case)…" | 核心定义 |
| 0:50 | 架构示意图 | "架构——意图路由→技能处理→人工协作" | 要点拆解1 |
| 1:30 | 对比/实战案例图 | "对比一下常见误区和工程实践，看真实场景里怎么取舍。" | 实战与对比 |
| 2:20 | 总结卡 | "记住核心要点。下期我们追问：FAQ匹配准确率怎么提升？——混合检索+Rerank+Few？" | 收尾与钩子 |
