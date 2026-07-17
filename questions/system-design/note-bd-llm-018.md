---
id: note-bd-llm-018
difficulty: L5
category: system-design
subcategory: 高并发
tags:
- 字节
- 面经
- 智能客服
- 系统设计
- 多租户
- 可观测性
feynman:
  essence: 智能客服系统 = 多租户RAG + 意图路由 + 回答质量监控三大模块的分布式架构。
  analogy: 就像大型医院——不同科室(产品线)有独立药房(知识库隔离)，不同病人有不同就医权限(多租户)，还有医疗质量监控部(可观测性)。
  first_principle: 企业级AI应用的三个刚需：数据隔离(安全)、权限控制(合规)、质量监控(可运营)。
  key_points:
  - '多产品线: 独立向量库+路由层分发'
  - '多租户: RBAC+数据行级隔离'
  - '知识库隔离: 租户级Collection/namespace'
  - '可观测性: 回答评分+人工审核+AB测试'
  - '架构: Gateway→路由→RAG→LLM→质量监控'
first_principle:
  essence: 企业级 = 安全(隔离) × 合规(权限) × 质量(监控)
  derivation: 多产品线→独立知识库→需要路由→多租户→数据隔离→需要权限→AI回答→可能出错→需要监控→三者构成完整闭环
  conclusion: 智能客服系统设计的核心是多租户隔离+RAG+质量监控的铁三角
follow_up:
- 如何实现实时回答质量评分？
- 知识库更新怎么做灰度发布？
- 如何处理跨产品线的联合查询？
memory_points:
- 核心挑战：多产品线知识隔离、多租户权限控制、LLM回答质量监控。
- 隔离方案：产品线走物理或独立Collection隔离，而租户间靠鉴权与Metadata过滤。
- 质量观测：因为LLM输出具不确定性，所以需构建实时评分与异常检测看板。
---

# 【字节面经】设计一个企业内部的智能客服系统，支持多产品线知识库隔离、多租户权限控制，以及回答质量可观测性监控，请描述整体架构。

## 一、需求拆解与核心挑战

### 1.1 功能需求

| 需求维度 | 具体内容 |
|---------|---------|
| **多产品线知识库隔离** | 产品A(如云服务)、产品B(如办公套件)、产品C(如安全产品)各自维护独立知识库，互不干扰 |
| **多租户权限控制** | 不同企业客户(tenant)只能访问自己的会话历史和被授权的知识库 |
| **回答质量可观测性** | 实时监控回答质量、命中率、幻觉率，支持人工审核与AB测试 |
| **智能问答** | 用户提问→意图识别→知识库检索→LLM生成→质量校验→返回回答 |

### 1.2 非功能需求

- **高可用**：99.95% SLA，单产品线故障不影响其他产品线
- **低延迟**：P99 < 3s（含LLM推理）
- **水平扩展**：支持数百产品线、数千租户、日均百万级请求
- **数据安全**：租户间数据严格隔离，满足等保/GDPR合规
- **可观测**：全链路追踪 + 实时质量看板 + 异常告警

### 1.3 核心挑战

```
挑战1: 知识库隔离 ──→ 产品线A的知识不能泄漏给产品线B的检索
挑战2: 租户隔离   ──→ 租户X的会话/数据对租户Y完全不可见
挑战3: 质量监控   ──→ LLM输出不确定性高，需要多维度的质量度量体系
挑战4: 性能       ──→ RAG多路召回 + LLM推理 + 质量校验 全链路<3s
```

---

## 二、整体架构设计

### 2.1 架构全景图

```
┌─────────────────────────────────────────────────────────────────────────┐
│                           用户层 (Web / App / SDK)                       │
└──────────────────────────────┬──────────────────────────────────────────┘
                               │
                    ┌──────────▼──────────┐
                    │   API Gateway        │  ← 租户鉴权 / 限流 / 路由
                    │   (Kong / APISIX)    │
                    └──────────┬──────────┘
                               │
              ┌────────────────┼────────────────┐
              │                │                 │
    ┌─────────▼─────────┐  ┌──▼───────────┐  ┌──▼──────────────┐
    │  会话管理服务       │  │ 意图路由服务   │  │  知识库管理服务   │
    │  Session Service   │  │ Router Svc    │  │  KB Admin Svc   │
    │  (Redis集群)        │  │               │  │                 │
    └─────────┬─────────┘  └──┬──────┬─────┘  └──┬──────────────┘
              │               │      │            │
              │     ┌─────────▼┐  ┌──▼───────────▼──┐
              │     │ 产品线A   │  │  产品线B         │  ... N个产品线
              │     │ RAG流水线 │  │  RAG流水线       │
              │     └────┬─────┘  └──────┬──────────┘
              │          │               │
    ┌─────────▼──────────▼───────────────▼──────────┐
    │              LLM 推理集群                        │
    │     (vLLM / 自部署大模型 / API网关转发)           │
    └──────────────────────┬─────────────────────────┘
                           │
    ┌──────────────────────▼─────────────────────────┐
    │           质量监控层 (Quality Pipeline)           │
    │  实时评分 → 异常检测 → 人工审核 → 反馈闭环        │
    └──────────────────────┬─────────────────────────┘
                           │
    ┌──────────────────────▼─────────────────────────┐
    │              存储与基础设施层                      │
    │  PostgreSQL │ Milvus/Qdrant │ Redis │ Kafka     │
    │  ES (全文检索) │ MinIO(文档) │ ClickHouse(指标)   │
    └────────────────────────────────────────────────┘
```

### 2.2 核心请求链路

```
用户提问
  │
  ▼
① Gateway鉴权 → 提取 tenant_id + product_line
  │
  ▼
② 意图路由 → 判断属于哪个产品线 → 路由到对应RAG Pipeline
  │
  ▼
③ RAG流水线:
   ├─ Query改写 (多轮对话上下文补全)
   ├─ 多路召回 (向量检索 + 全文检索 + 关键词)
   ├─ 重排序 (Cross-Encoder Rerank)
   └─ 上下文组装 (Top-K → Prompt模板)
  │
  ▼
④ LLM推理 → 生成回答 + 引用来源
  │
  ▼
⑤ 质量校验 → 事实一致性校验 → 安全过滤 → 输出
  │
  ▼
⑥ 异步写入 → 会话存储 + 质量指标采集 + (可选)人工审核队列
```

---

## 三、多产品线知识库隔离方案

### 3.1 知识库架构

每个产品线维护**独立的知识库**，物理或逻辑隔离：

```
┌──────────────────────────────────────────────────┐
│              知识库管理 (KB Admin)                  │
│                                                    │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────┐ │
│  │ 产品线A       │  │ 产品线B       │  │ 产品线C  │ │
│  │ 云服务KB      │  │ 办公套件KB    │  │ 安全KB   │ │
│  │              │  │              │  │          │ │
│  │ Collection_A │  │ Collection_B │  │CollectionC│ │
│  │ (Milvus)     │  │ (Milvus)     │  │(Milvus)  │ │
│  └──────────────┘  └──────────────┘  └──────────┘ │
│                                                    │
│  隔离粒度: Milvus Collection / Qdrant Namespace    │
│  权限映射: product_line_id → collection_name       │
└──────────────────────────────────────────────────┘
```

### 3.2 隔离策略选型

| 隔离级别 | 方案 | 优点 | 缺点 | 适用场景 |
|---------|------|------|------|---------|
| **Collection级** | 每产品线一个Collection | 物理隔离强，性能好 | Collection数量有限 | 产品线<100 |
| **Namespace级** | 共享Collection，分区字段过滤 | 灵活，支持多租户叠加 | 隔离稍弱 | 产品线>100 |
| **实例级** | 每产品线独立向量库实例 | 完全物理隔离 | 资源浪费，运维成本高 | 合规要求极高 |

**推荐方案**：Collection级隔离为主，Namespace级为辅。核心产品线独立Collection，小产品线共享Collection用Namespace区分。

### 3.3 文档导入流水线

```
原始文档(PDF/Word/Confluence)
  │
  ▼
文档解析 (Unstructured / Apache Tika)
  │
  ▼
智能分块 (语义分块 / 固定窗口分块，可配置overlap)
  │
  ▼
Embedding生成 (BGE / text-embedding-3-large)
  │
  ▼
元数据标注 (product_line_id, doc_id, version, acl_tags)
  │
  ▼
写入对应Collection + Elasticsearch双写
  │
  ▼
索引构建完成 → 灰度上线(影子流量验证)
```

---

## 四、多租户权限控制与数据模型

### 4.1 多租户隔离模型

```
┌──────────────────────────────────────────────────────┐
│                    租户层级模型                         │
│                                                        │
│  Platform (平台)                                       │
│    └── Tenant (企业客户, 如: 企业A, 企业B)              │
│          └── ProductLine (产品线, 如: 云服务, 办公套件)   │
│                └── KnowledgeBase (知识库)               │
│                      └── Document (文档/Chunk)          │
│                                                        │
│  权限模型: RBAC + ABAC                                  │
│  隔离方式: 行级隔离(Row-Level Security)                  │
└──────────────────────────────────────────────────────┘
```

### 4.2 多租户数据模型 (PostgreSQL)

```sql
-- ========== 租户与组织 ==========
CREATE TABLE tenants (
    tenant_id      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_name    VARCHAR(255) NOT NULL,
    tenant_code    VARCHAR(64) UNIQUE NOT NULL,  -- 短码，用于路由
    plan_tier      VARCHAR(32) DEFAULT 'standard', -- standard/premium/enterprise
    status         VARCHAR(32) DEFAULT 'active',
    max_qps        INT DEFAULT 100,
    created_at     TIMESTAMPTZ DEFAULT NOW()
);

-- ========== 产品线 ==========
CREATE TABLE product_lines (
    product_line_id  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id        UUID NOT NULL REFERENCES tenants(tenant_id),
    name             VARCHAR(128) NOT NULL,
    vector_collection VARCHAR(128) NOT NULL,  -- 对应Milvus Collection名
    llm_model_config JSONB,                    -- 该产品线的LLM配置
    enabled          BOOLEAN DEFAULT TRUE,
    UNIQUE(tenant_id, name)
);

-- ========== 知识库 ==========
CREATE TABLE knowledge_bases (
    kb_id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    product_line_id  UUID NOT NULL REFERENCES product_lines(product_line_id),
    name             VARCHAR(255) NOT NULL,
    doc_count        INT DEFAULT 0,
    status           VARCHAR(32) DEFAULT 'active',
    version          VARCHAR(32) DEFAULT 'v1',
    created_at       TIMESTAMPTZ DEFAULT NOW()
);

-- ========== 用户与角色 (RBAC) ==========
CREATE TABLE users (
    user_id      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id    UUID NOT NULL REFERENCES tenants(tenant_id),
    email        VARCHAR(255) NOT NULL,
    display_name VARCHAR(128),
    status       VARCHAR(32) DEFAULT 'active',
    UNIQUE(tenant_id, email)
);

CREATE TABLE roles (
    role_id      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id    UUID NOT NULL REFERENCES tenants(tenant_id),
    role_name    VARCHAR(64) NOT NULL,  -- admin/agent/viewer/end_user
    permissions  JSONB NOT NULL,         -- 权限位图
    UNIQUE(tenant_id, role_name)
);

-- 用户-角色-产品线 三维授权
CREATE TABLE user_role_bindings (
    binding_id       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id          UUID NOT NULL REFERENCES users(user_id),
    role_id          UUID NOT NULL REFERENCES roles(role_id),
    product_line_id  UUID REFERENCES product_lines(product_line_id), -- NULL=全部
    tenant_id        UUID NOT NULL REFERENCES tenants(tenant_id),     -- 冗余加速
    created_at       TIMESTAMPTZ DEFAULT NOW()
);

-- ========== 会话与消息 ==========
CREATE TABLE chat_sessions (
    session_id       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id        UUID NOT NULL REFERENCES tenants(tenant_id),
    user_id          UUID NOT NULL REFERENCES users(user_id),
    product_line_id  UUID NOT NULL REFERENCES product_lines(product_line_id),
    title            VARCHAR(512),
    status           VARCHAR(32) DEFAULT 'active',
    created_at       TIMESTAMPTZ DEFAULT NOW(),
    updated_at       TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE chat_messages (
    message_id    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id    UUID NOT NULL REFERENCES chat_sessions(session_id),
    tenant_id     UUID NOT NULL,  -- 行级隔离必须字段
    role          VARCHAR(16) NOT NULL,  -- user/assistant/system
    content       TEXT NOT NULL,
    citations     JSONB,           -- 引用的知识来源
    quality_score FLOAT,           -- 回答质量评分
    model_used    VARCHAR(64),
    latency_ms    INT,
    created_at    TIMESTAMPTZ DEFAULT NOW()
);

-- ========== 行级安全策略 (PostgreSQL RLS) ==========
ALTER TABLE chat_messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON chat_messages
    USING (tenant_id = current_setting('app.current_tenant_id')::uuid);

-- 每次请求前设置: SET app.current_tenant_id = '<tenant_uuid>';
```

### 4.3 向量库的租户隔离

```python
# 检索时强制注入 tenant_id + product_line_id 作为过滤条件
def search_kb(query_embedding, tenant_id, product_line_id, top_k=5):
    results = milvus_client.search(
        collection_name=product_line.collection_name,
        data=[query_embedding],
        filter=f"tenant_id == '{tenant_id}' and product_line_id == '{product_line_id}'",
        limit=top_k,
        output_fields=["content", "doc_id", "score"]
    )
    return results
```

> **关键原则**：隔离不能仅靠应用层逻辑，必须在**数据层**也强制执行（RLS + 向量库filter），防止应用Bug导致数据泄漏。

---

## 五、回答质量可观测性体系

### 5.1 质量度量指标

```
┌──────────────────────────────────────────────────────────┐
│                    质量监控指标体系                         │
│                                                            │
│  ┌─────────────┐  ┌──────────────┐  ┌──────────────────┐ │
│  │ 检索质量     │  │  生成质量      │  │  用户体验质量     │ │
│  │             │  │              │  │                  │ │
│  │ · 召回命中率 │  │ · 事实一致性  │  │ · 用户点赞率     │ │
│  │ · Top-1相关 │  │ · 幻觉率      │  │ · 用户点踩率     │ │
│  │ · 检索延迟   │  │ · 引用准确率  │  │ · 会话解决率     │ │
│  │ · 空召回率   │  │ · 回答完整度  │  │ · 人工转接率     │ │
│  └─────────────┘  └──────────────┘  └──────────────────┘ │
│                                                            │
│  ┌──────────────────────────────────────────────────────┐ │
│  │              系统级指标                                │ │
│  │  · P50/P99延迟  · Token消耗  · 错误率  · QPS          │ │
│  └──────────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────┘
```

### 5.2 实时质量评分流水线

```
LLM回答输出
  │
  ├──→ 同步路径: 事实一致性快速校验(规则+小模型) → 阻断严重错误
  │
  └──→ 异步路径: 
        │
        ▼
    Kafka消息队列
        │
        ├──→ 事实一致性评分 (NLI模型: 回答 vs 检索到的知识片段)
        ├──→ 幻觉检测 (SelfCheckGPT / 引用溯源校验)
        ├──→ 安全合规检测 (敏感词/Prompt注入/越狱检测)
        └──→ 综合评分 → 写入ClickHouse
              │
              ├──→ 低于阈值 → 进入人工审核队列
              └──→ 质量看板实时更新 (Grafana)
```

### 5.3 质量评分实现

```python
# 事实一致性评分 — 基于NLI(自然语言推理)
def score_faithfulness(answer: str, retrieved_contexts: list[str]) -> float:
    """
    使用NLI模型判断回答是否被检索到的知识支撑。
    返回 [0, 1] 分数，1 = 完全一致，0 = 完全幻觉。
    """
    # 将回答拆分为原子声明
    claims = split_into_claims(answer)
    supported = 0
    for claim in claims:
        for ctx in retrieved_contexts:
            # NLI: premise=ctx, hypothesis=claim
            score = nli_model.predict(premise=ctx, hypothesis=claim)
            if score['entailment'] > 0.8:
                supported += 1
                break
    return supported / len(claims) if claims else 0.0


# 综合质量评分
def compute_quality_score(response: dict) -> dict:
    return {
        'faithfulness': score_faithfulness(
            response['answer'], response['cited_contexts']
        ),
        'relevance': score_relevance(
            response['query'], response['answer']
        ),
        'citation_accuracy': verify_citations(response['citations']),
        'safety': safety_check(response['answer']),
        'latency_ms': response['latency_ms'],
        'timestamp': datetime.utcnow()
    }
```

### 5.4 人工审核与反馈闭环

```
                    ┌──────────────────┐
                    │  质量评分 < 阈值   │
                    └────────┬─────────┘
                             │
                    ┌────────▼─────────┐
                    │  人工审核队列      │
                    │  (审核后台UI)      │
                    └────────┬─────────┘
                             │
              ┌──────────────┼──────────────┐
              │              │               │
     ┌────────▼───────┐ ┌───▼────────┐ ┌────▼─────────┐
     │ 标记为"好回答"   │ │ 修正回答    │ │ 标记为"坏回答" │
     │ → 加入正样本     │ │ → 更新知识库 │ │ → 分析根因    │
     └────────────────┘ └────────────┘ └──────────────┘
              │              │               │
              └──────────────┼───────────────┘
                             │
                    ┌────────▼─────────┐
                    │  反馈数据集        │
                    │  → 持续微调/RLHF  │
                    │  → 优化Prompt模板  │
                    │  → 补充知识库文档   │
                    └──────────────────┘
```

---

## 六、关键技术决策与容量估算

### 6.1 技术选型

| 组件 | 选型 | 理由 |
|------|------|------|
| API网关 | Kong/APISIX | 多租户路由、限流、插件生态 |
| 向量数据库 | Milvus / Qdrant | 多Collection支持、高性能ANN |
| 全文检索 | Elasticsearch | BM25 + 向量混合检索 |
| 消息队列 | Kafka | 异步质量评分、事件驱动 |
| OLAP | ClickHouse | 质量指标实时聚合分析 |
| 缓存 | Redis Cluster | 会话上下文、Embedding缓存 |
| LLM推理 | vLLM (自部署) | 高吞吐、PagedAttention |
| Embedding | BGE-M3 / OpenAI ada-002 | 多语言、高质量向量 |

### 6.2 容量估算

```
假设: 100个产品线 × 50个租户 × 日均10000次问答

向量库:
  · 每产品线平均10万文档 × 5 chunks/文档 = 50万向量
  · 100产品线 = 5000万向量
  · 每向量1024维 × 4字节 = 4KB → 总计约200GB → Milvus集群3节点

LLM推理:
  · 日均 100×50×10000 = 5000万次请求
  · 峰值QPS约 5000万 / 86400 × 峰谷比3 ≈ 1700 QPS
  · vLLM单节点(A100) 约200 QPS → 需要10节点

质量评分:
  · 异步Kafka消费，不阻塞主链路
  · NLI模型 GPU推理，延迟不影响用户体验
```

### 6.3 高可用设计

```
┌────────────────────────────────────────────┐
│              高可用策略                       │
│                                              │
│  · API Gateway: 多活部署 + 健康检查           │
│  · RAG服务: 无状态 → K8s自动伸缩              │
│  · 向量库: Milvus多副本 + 定期快照            │
│  · LLM推理: 多节点负载均衡 + 降级策略         │
│  · 质量监控: Kafka消费组 → 自动重试           │
│  · 数据库: PostgreSQL主从 + PITR备份         │
│                                              │
│  降级策略:                                    │
│  · LLM不可用 → 降级为模板回答/人工转接        │
│  · 向量库不可用 → 降级为ES全文检索            │
│  · 质量评分不可用 → 跳过异步评分(不阻断回答)  │
└────────────────────────────────────────────┘
```

---

## 七、总结

企业智能客服系统的设计核心是 **「隔离 × 权限 × 质量」** 铁三角：

1. **知识库隔离**：以Collection/Namespace为粒度，实现产品线间的物理/逻辑隔离，配合导入流水线保证数据时效性。
2. **多租户权限**：RBAC + 行级安全策略(RLS)，从应用层到数据层双重保障租户间数据不泄漏。
3. **质量可观测**：构建从检索质量到生成质量的多维度指标体系，实时评分 + 人工审核 + 反馈闭环，持续优化系统表现。

架构上采用 **Gateway → 意图路由 → RAG流水线 → LLM推理 → 质量监控** 的分层设计，每一层水平可扩展，通过Kafka解耦同步与异步链路，既保证<3s的响应延迟，又实现了全面的质量可观测。

## 记忆要点

- 核心挑战：多产品线知识隔离、多租户权限控制、LLM回答质量监控。
- 隔离方案：产品线走物理或独立Collection隔离，而租户间靠鉴权与Metadata过滤。
- 质量观测：因为LLM输出具不确定性，所以需构建实时评分与异常检测看板。


## 苏格拉底式面试追问

> 这组追问模拟面试官层层逼问，每一问先回答"为什么"，再回答"怎么做"，最后回答"如何证明"。

### 第一层：目标与动机

**Q：多产品线知识库你为什么用独立 Collection（向量库隔离）而不是共享 Collection + Metadata 过滤？**

因为安全隔离强度不同。共享 Collection + Metadata 过滤是"逻辑隔离"——所有产品线的文档存在同一个向量索引里，查询时用 `filter: product_line=A` 过滤。风险是：① 过滤逻辑有 bug 时跨产品线泄露（查询忘了加 filter）；② 性能——向量检索时要先过滤再检索，数据量大时过滤开销大。独立 Collection 是"物理隔离"——各产品线的向量索引完全独立，查询天然不会跨产品线，安全性高。决策依据：产品线间数据敏感（如"云服务"和"安全产品"的知识库不能混），物理隔离更安全。如果产品线间无敏感度差异且查询频繁跨产品线，用共享 + 过滤更灵活。

### 第二层：证据与定位

**Q：租户 A 的用户反馈"查到了租户 B 的文档"，你怎么定位是权限配置错误还是向量检索泄露？**

查权限链路：
1. 权限校验日志——RAG 检索前是否做了租户鉴权（`tenant_id = A` 的 filter）。如果检索请求没带 tenant filter，是权限层遗漏。
2. 向量检索结果——看返回的文档 metadata 里的 tenant_id，如果是 B 的文档被返回，是 filter 没生效或 Collection 混了。
3. Collection 隔离——如果是独立 Collection 方案，确认租户 A 的查询是否错误地查了租户 B 的 Collection（路由错误）。

### 第三层：根因深挖

**Q：权限校验代码正确（带了 tenant filter），但向量检索还是返回了其他租户的数据，根因是什么？**

最可能是 Metadata 过滤的实现 bug。向量数据库（如 Milvus、Pinecone）的 Metadata 过滤是在向量检索时做的（"先检索 Top-K 再过滤"或"先过滤再检索"）。如果用"先检索后过滤"，Top-K=10 的检索可能返回 10 个向量，过滤后只剩 2 个本租户的，但这 2 个可能不是"本租户里最相关的"（被其他租户的数据挤掉了）。更严重的 bug 是 filter 表达式写错（如 `tenant_id == A` 写成 `tenant_id != B`，漏掉了 tenant_id 为 null 的数据）。根因要查向量库的过滤执行计划和 filter 表达式。

**Q：为什么不直接每个租户一个独立向量库实例（物理隔离最彻底），而要用 Collection 级别隔离？**

因为成本。独立向量库实例意味着每个租户一套 Milvus/Qdrant 集群（至少 3 节点高可用），1000 个租户 = 3000 个节点，成本爆炸。Collection 级别隔离是在同一个向量库里建多个 Collection（逻辑隔离），1000 个租户共享一套集群，成本可控。而且小租户的数据量小（几千条文档），独占一个向量库实例是资源浪费。权衡：大租户（数据敏感 + 数据量大）可以用独立 Collection 甚至独立实例；小租户用共享 Collection + tenant filter。按租户规模分层隔离，成本和安全兼顾。

### 第四层：方案权衡

**Q：回答质量监控你用"实时评分"，怎么评？LLM 输出没有标准答案怎么打分？**

三种评分方式：
1. RAG 命中率——检索的文档与问题的相关度（用 embedding 相似度或 rerank 分数）。如果检索的 Top-5 文档与问题的余弦相似度 < 0.7，说明检索质量差，回答可能不准。
2. LLM 评分——用另一个 LLM（评判模型）对回答打分（如 GPT-4 评分 1-5 分），评估"回答是否准确、是否有幻觉、是否完整"。成本高但自动化。
3. 用户反馈——回答后让用户点"有用/没用"或打分， Implicit 反馈（是否追问、是否转人工）也是信号。

**Q：为什么不直接靠人工审核所有回答，保证质量？**

因为量大人少。企业级智能客服日均万级回答，人工审核每条要 1-2 分钟，需要几十个审核员，成本高且延迟（回答先给用户，审核后发现问题已晚）。自动化评分（RAG 命中率 + LLM 评分）能实时评估，低分回答触发"转人工"或"二次校验"，只让 5-10% 的低质量回答走人工审核。人工是兜底（抽检 + 低分复核），不是全量。质量监控是"自动化为主 + 人工为辅"，不是纯人工。

### 第五层：验证与沉淀

**Q：你怎么证明多租户隔离真的安全（租户间不泄露）？**

渗透测试 + 审计：
1. 跨租户渗透——构造"租户 A 的用户请求租户 B 的数据"的测试用例，验证系统拒绝（返回权限错误或空结果）。
2. 权限矩阵测试——遍历所有"租户 × 产品线 × 角色"的权限组合，验证每种组合只能访问授权范围内的数据。
3. 审计日志——所有知识库检索记录"查询者、租户、返回的文档 tenant_id"，定期审计是否有跨租户访问。

**Q：智能客服架构怎么沉淀？**

1. RAG 平台化——把"文档入库 + 向量索引 + 检索 + LLM 生成 + 质量评分"封装成 RAG 平台，各产品线接入只提供文档和 prompt。
2. 多租户中间件——封装"租户鉴权 + Collection 路由 + Metadata 过滤"成通用层，业务无感知多租户复杂度。
3. 质量监控看板——实时展示"回答分数分布、幻觉率、人工介入率、用户满意度"，质量下降自动告警 + 触发知识库或 prompt 优化。


## 结构化回答

**30 秒电梯演讲：** 智能客服系统 就是 多租户RAG + 意图路由 + 回答质量监控三大模块的分布式架构。打个比方，就像大型医院——不同科室(产品线)有独立药房(知识库隔离)，不同病人有不同就医权限(多租户)，还有医疗质量监控部(可观测性)。

**展开框架：**
1. **核心挑战** — 多产品线知识隔离、多租户权限控制、LLM回答质量监控。
2. **隔离方案** — 产品线走物理或独立Collection隔离，而租户间靠鉴权与Metadata过滤。
3. **质量观测** — 因为LLM输出具不确定性，所以需构建实时评分与异常检测看板。

**收尾：** 这块我踩过坑——要不要深入聊：如何实现实时回答质量评分？

## 视频脚本

> 预计时长：4 分钟 | 由浅入深

| 时间 | 画面/字幕 | 口播台词 | 讲解要点 |
|------|----------|----------|----------|
| 0:00 | 标题卡 | "高并发一句话：智能客服系统 就是 多租户RAG + 意图路由 + 回答质量监控三大模块的分布式架构。" | 开场钩子 |
| 0:15 | 架构示意图 | "核心挑战：多产品线知识隔离、多租户权限控制、LLM回答质量监控。" | 核心挑战 |
| 1:08 | 架构示意图分步演示 | "隔离方案：产品线走物理或独立Collection隔离，而租户间靠鉴权与Metadata过滤。" | 隔离方案 |
| 2:01 | 关键代码/伪代码片段 | "质量观测：因为LLM输出具不确定性，所以需构建实时评分与异常检测看板。" | 质量观测 |
| 2:54 | 对比表格 | "多产品线: 独立向量库+路由层分发" | 多产品线 |
| 3:50 | 总结卡 | "核心抓住这条主线，下期咱们接着聊：如何实现实时回答质量评分。" | 收尾 |
