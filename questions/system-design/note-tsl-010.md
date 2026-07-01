---
id: note-tsl-010
difficulty: L3
category: system-design
subcategory: 高并发
tags:
- 特斯拉
- 反馈系统
- NLP分类
- 工单流转
feynman:
  essence: 亿级反馈处理的核心是"AI分类+工单流转+闭环跟踪"。用户提交反馈后，用NLP模型自动分类（Bug/建议/投诉），按类型路由到对应团队，跟踪处理进度直到闭环。
  analogy: 像大型医院的分诊台——病人来了先由分诊护士（AI分类）判断看什么科，然后分到对应诊室（工单流转），看完病还要回访是否治好（闭环跟踪）。
  key_points:
  - NLP自动分类(Bug/建议/投诉/咨询)
  - 工单状态机(提交→分类→处理→验证→关闭)
  - SLA分级(紧急/P1/P2/P3)
  - 闭环跟踪(处理→用户确认→关闭)
  - 数据分析(反馈趋势/热点问题)
first_principle:
  essence: 反馈处理 = 分类(是什么) + 路由(谁处理) + 追踪(处理完了吗) + 闭环(用户满意了吗)。分类是NLP问题，路由是工作流问题，追踪是状态管理问题。
  derivation: 假设日百万反馈，人工分类每人每天200条 → 需500人。用AI预分类准确率90%，人工只审10% → 需50人。降低人力90%。
  conclusion: 架构 = NLP分类引擎 + 工单状态机 + SLA路由 + 闭环通知 + 趋势分析看板。
follow_up:
- AI分类错误率10%，怎么减少误分？
- 紧急Bug如何保证30分钟内响应？
- 如何避免重复反馈淹没团队？
- 反馈数据如何驱动产品改进？
memory_points:
- 处理流水线：快接入 → AI分类去重 → 工单状态机 → 团队流转 → 用户验证闭环
- AI智能引擎：NLP做意图/情感分析，聚类合并相同Bug，P0紧急度评估定级
- 动态路由分发：基于SLA和紧急度，P0走快速通道，工单按队列分配团队处理
---

# 亿级车主提交APP、车载系统反馈，如何设计后端架构，实现反馈分类、流转、处理闭环且实时响应？

## 🎯 本质

```
反馈处理流水线：
提交 → AI分类 → 工单创建 → 路由分发 → 团队处理 → 用户验证 → 闭环关闭
```

---

## 🧒 类比

把反馈系统想象成**智能快递分拣中心**：
1. **收件**：包裹（反馈）从四面八方汇入
2. **自动分拣**：机器扫描面单（AI分类），按目的地分到不同传送带
3. **路由配送**：快递员（处理团队）从自己负责的传送带取件
4. **签收确认**：收件人确认收到（用户验证）
5. **评价反馈**：收件人评价快递服务（满意度回访）

---

## 📊 整体架构图

```
┌──────────────────────────────────────────────────────────────┐
│               反馈提交入口                                     │
│    App内置反馈 / 车机反馈 / 官网表单 / 语音反馈                 │
└──────────────────┬───────────────────────────────────────────┘
                   │
┌──────────────────▼───────────────────────────────────────────┐
│               反馈接入服务 (快速入库)                           │
│    ① 数据清洗(去噪/截断)  ② 写入反馈表  ③ 发送分类事件         │
└──────────────────┬───────────────────────────────────────────┘
                   │ Kafka
┌──────────────────▼───────────────────────────────────────────┐
│               NLP 分类引擎                                    │
│  ┌─────────────┐  ┌──────────────┐  ┌────────────────┐     │
│  │ 意图分类     │  │ 情感分析      │  │ 紧急度评估      │     │
│  │Bug/建议/投诉 │  │ 正面/负面/中性│  │ P0紧急/P1/P2  │     │
│  └─────────────┘  └──────────────┘  └────────────────┘     │
│  ┌──────────────────────────────────────────────┐          │
│  │ 相似度聚类：重复反馈合并(去重)                   │          │
│  └──────────────────────────────────────────────┘          │
└──────────────────┬───────────────────────────────────────────┘
                   │
┌──────────────────▼───────────────────────────────────────────┐
│               工单系统                                        │
│  ┌──────────────┐  ┌──────────────┐  ┌────────────────┐   │
│  │ 工单状态机    │  │ SLA路由分发   │  │ 处理团队工作台  │   │
│  │ 待处理→处理中 │  │ 紧急→快速通道 │  │ 队列/分配/处理   │   │
│  │ →待验证→关闭  │  │ 普通→正常通道 │  │                │   │
│  └──────────────┘  └──────────────┘  └────────────────┘   │
└──────────────────┬───────────────────────────────────────────┘
                   │
┌──────────────────▼───────────────────────────────────────────┐
│               闭环通知 + 趋势分析                              │
│   用户通知(推送/邮件) + BI看板(反馈趋势/热点)                  │
└──────────────────────────────────────────────────────────────┘
```

---

## 🔧 详解

### 1. 反馈数据模型

```sql
CREATE TABLE feedback (
    id              BIGINT AUTO_INCREMENT PRIMARY KEY,
    user_id         BIGINT NOT NULL,
    source          ENUM('app', 'vehicle', 'web', 'voice'),
    content         TEXT NOT NULL,
    category        ENUM('bug', 'suggestion', 'complaint', 'question', 'praise'),
    sentiment       ENUM('positive', 'neutral', 'negative'),
    urgency         ENUM('P0', 'P1', 'P2', 'P3'),
    cluster_id      VARCHAR(32),       -- 相似反馈聚类ID
    status          ENUM('pending','classified','assigned','processing',
                         'resolved','closed','reopened'),
    assigned_team   VARCHAR(32),
    created_at      TIMESTAMP DEFAULT NOW(),
    INDEX idx_status_urgency (status, urgency),
    INDEX idx_category (category)
);

CREATE TABLE feedback_workorder (
    id              BIGINT AUTO_INCREMENT PRIMARY KEY,
    feedback_id     BIGINT NOT NULL,
    team            VARCHAR(32),
    assignee        VARCHAR(64),
    sla_deadline    TIMESTAMP,
    status          ENUM('open','in_progress','resolved','closed'),
    resolution      TEXT,
    created_at      TIMESTAMP DEFAULT NOW()
);
```

### 2. NLP 分类引擎

```python
# 反馈分类服务 (Python/FastAPI)
from transformers import pipeline

class FeedbackClassifier:
    def __init__(self):
        # 1. 意图分类模型（微调后的BERT）
        self.intent_classifier = pipeline(
            "text-classification",
            model="tesla/feedback-intent-bert",
            device=0  # GPU
        )

        # 2. 情感分析模型
        self.sentiment_analyzer = pipeline(
            "sentiment-analysis",
            model="cardiffnlp/twitter-roberta-base-sentiment"
        )

        # 3. 向量编码（用于相似度聚类）
        from sentence_transformers import SentenceTransformer
        self.encoder = SentenceTransformer('all-MiniLM-L6-v2')

    async def classify(self, feedback_text: str) -> dict:
        # 意图分类
        intent = self.intent_classifier(feedback_text)[0]

        # 情感分析
        sentiment = self.sentiment_analyzer(feedback_text)[0]

        # 紧急度评估（基于关键词+情感）
        urgency = self.assess_urgency(feedback_text, sentiment)

        # 相似度检索（查是否已有类似反馈）
        embedding = self.encoder.encode(feedback_text)
        cluster_id = await self.find_sim_cluster(embedding)

        return {
            "category": intent["label"],       # bug/suggestion/...
            "confidence": intent["score"],
            "sentiment": sentiment["label"],
            "urgency": urgency,
            "cluster_id": cluster_id
        }

    def assess_urgency(self, text, sentiment):
        # P0: 安全相关关键词（刹车失灵/无法加速/方向盘锁死）
        safety_keywords = ["刹车", "失控", "起火", "无法转向", "safety"]
        if any(kw in text.lower() for kw in safety_keywords):
            return "P0"
        # P1: 核心功能受影响（无法充电/无法启动）
        if sentiment["label"] == "negative" and len(text) > 100:
            return "P1"
        return "P2"
```

### 3. 工单状态机 + SLA路由

```java
@Service
public class WorkOrderService {

    // SLA规则：不同紧急度 → 不同响应时间
    private static final Map<String, Duration> SLA_RULES = Map.of(
        "P0", Duration.ofMinutes(30),   // 30分钟响应
        "P1", Duration.ofHours(2),      // 2小时响应
        "P2", Duration.ofHours(24),     // 24小时响应
        "P3", Duration.ofDays(3)        // 3天响应
    );

    @KafkaListener(topics = "feedback-classified")
    public void onFeedbackClassified(FeedbackEvent event) {
        // ① 创建工单
        WorkOrder order = new WorkOrder();
        order.setFeedbackId(event.getFeedbackId());
        order.setStatus("open");

        // ② 根据分类+紧急度路由到对应团队
        String team = routeToTeam(event.getCategory(), event.getUrgency());
        order.setTeam(team);

        // ③ 设置SLA截止时间
        Duration sla = SLA_RULES.get(event.getUrgency());
        order.setSlaDeadline(LocalDateTime.now().plus(sla));

        workOrderMapper.insert(order);

        // ④ P0紧急 → 立即推送通知值班工程师
        if ("P0".equals(event.getUrgency())) {
            alertService.sendUrgent(team, order);
        }
    }

    private String routeToTeam(String category, String urgency) {
        if ("P0".equals(urgency)) return "safety-team";        // 安全团队
        if ("bug".equals(category)) return "engineering-team";  // 工程团队
        if ("complaint".equals(category)) return "cs-team";     // 客服团队
        return "general-team";
    }
}
```

### 4. 闭环跟踪

```java
// 处理完成 → 通知用户验证 → 关闭/重开
@Service
public class FeedbackClosureService {

    public void resolveFeedback(Long feedbackId, String resolution) {
        // ① 更新状态为"已解决"
        feedbackMapper.updateStatus(feedbackId, "resolved", resolution);

        // ② 推送通知用户："您的问题已处理，请确认"
        Feedback feedback = feedbackMapper.selectById(feedbackId);
        pushService.send(feedback.getUserId(), Map.of(
            "title", "您的反馈已处理",
            "content", resolution,
            "action", "confirm_or_reopen"
        ));

        // ③ 设置自动关闭时间（7天后无回复自动关闭）
        mq.sendDelay("feedback-auto-close", feedbackId, 7, TimeUnit.DAYS);
    }

    // 用户确认/重开
    public void userRespond(Long feedbackId, boolean satisfied) {
        if (satisfied) {
            feedbackMapper.updateStatus(feedbackId, "closed");
        } else {
            feedbackMapper.updateStatus(feedbackId, "reopened");
            // 重新分配，提高优先级
            workOrderService.reassign(feedbackId, priority + 1);
        }
    }
}
```

---

## ❓ 发散追问

### Q1：AI分类错误率10%，怎么减少误分？

- **人机协作**：AI预分类 + 人工抽检修正，修正结果反馈模型再训练
- **置信度阈值**：低于阈值的分类自动转人工审核
- **规则兜底**：关键关键词（如"刹车失灵"）强制标P0，不走AI

### Q2：紧急Bug如何保证30分钟内响应？

1. **值班机制**：安全团队7×24h轮班，P0工单短信+电话+IM多通道通知
2. **升级机制**：30分钟未响应自动升级到主管
3. **预案库**：常见P0问题有标准化处理预案

### Q3：如何避免重复反馈淹没团队？

- **聚类去重**：NLP向量相似度聚类，相同问题合并为一个工单
- **批量处理**：同一cluster的反馈批量回复统一解决方案
- **FAQ拦截**：高频问题在提交时自动推荐已有答案

## 记忆要点

- 处理流水线：快接入 → AI分类去重 → 工单状态机 → 团队流转 → 用户验证闭环
- AI智能引擎：NLP做意图/情感分析，聚类合并相同Bug，P0紧急度评估定级
- 动态路由分发：基于SLA和紧急度，P0走快速通道，工单按队列分配团队处理

