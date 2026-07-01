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

