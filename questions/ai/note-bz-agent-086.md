---
id: note-bz-agent-086
difficulty: L3
category: ai
subcategory: Agent
tags:
- B站面经
- 多租户
- 隔离
feynman:
  essence: 对话系统多租户隔离=数据隔离(用户namespace)+资源隔离(配额/限流)+安全隔离(权限/加密)+性能隔离(不影响其他租户)。四层隔离保证互不干扰。
  analogy: 像写字楼——每公司独立办公室(数据)、各自电表(资源)、门禁卡(安全)、隔音墙(性能)。
  first_principle: 多租户共享同一系统，必须保证租户间数据不泄露、资源不抢占、安全不连带。
  key_points:
  - 数据隔离：namespace/user_id过滤
  - 资源隔离：配额/限流/独立部署
  - 安全隔离：权限/加密/审计
  - 性能隔离：不影响其他租户
first_principle:
  essence: 多租户的核心矛盾是"共享资源"与"隔离需求"。
  derivation: 共享(同一套系统)降成本，但租户间不能互相影响(数据/资源/安全/性能)。隔离方案从逻辑隔离(成本低)到物理隔离(成本高)有光谱，按敏感度选择。
  conclusion: 多租户隔离 = 数据+资源+安全+性能 的分层隔离策略
follow_up:
- 逻辑隔离和物理隔离怎么选？——敏感数据物理，普通逻辑
- 大租户怎么处理？——专属资源/独立实例
- 隔离会增加多少成本？——逻辑隔离几乎无额外成本
memory_points:
- 多租户四维隔离：数据、资源、安全、性能必须相互独立互不影响
- 数据隔离三方案：命名空间(高性价比)、行级过滤(加租户ID)、物理隔离(最安全高成本)
- 资源隔离强保障：按租户独立配置QPS限流和Token日配额上限
- 向量记忆隔离：检索强制注入租户ID前缀，防止A搜出B的隐私数据
---

# 对话系统的多租户隔离方案？

## 一、多租户隔离的需求

```
多租户(Multi-tenancy)：多个客户(租户)共享同一系统

必须保证：
  ├─ 数据隔离：租户A看不到租户B的数据
  ├─ 资源隔离：租户A不能耗尽资源影响B
  ├─ 安全隔离：租户A的漏洞不影响B
  └─ 性能隔离：租户A的高负载不拖慢B

典型场景：
  - SaaS客服系统（多家公司共用）
  - 企业内部多部门
  - 云LLM服务（多用户）
```

## 二、四层隔离方案

### Layer 1：数据隔离（最重要）

```python
class TenantDataIsolation:
    """数据层隔离"""
    
    # 方案A: Namespace隔离（推荐，性价比高）
    def get_data(self, tenant_id, key):
        # 每个租户独立namespace
        return self.db.get(f"tenant:{tenant_id}:{key}")
    
    # 方案B: 行级过滤（tenant_id字段）
    def query(self, tenant_id, condition):
        return self.db.query(
            condition,
            filter={"tenant_id": tenant_id}  # 强制过滤
        )
    
    # 方案C: 物理隔离（最安全，成本高）
    # 每个租户独立的数据库/Collection
    def get_db(self, tenant_id):
        return self.tenant_dbs[tenant_id]  # 独立DB实例

# 记忆隔离（Agent场景）
class TenantMemoryIsolation:
    def recall(self, tenant_id, user_id, query):
        # 双重隔离：租户+用户
        return self.vector_db.search(
            query,
            filter={
                "tenant_id": tenant_id,  # 租户隔离
                "user_id": user_id,      # 用户隔离
            }
        )
```

### Layer 2：资源隔离

```python
class TenantResourceIsolation:
    """资源配额和限流"""
    
    QUOTAS = {
        "free": {"qps": 5, "daily_tokens": 10000},
        "pro": {"qps": 50, "daily_tokens": 100000},
        "enterprise": {"qps": 500, "daily_tokens": 1000000},
    }
    
    def check_quota(self, tenant_id, tenant_tier):
        quota = self.QUOTAS[tenant_tier]
        
        # QPS限流（令牌桶按租户独立）
        if not self.tenant_limiters[tenant_id].allow():
            raise RateLimitError("超出QPS限制")
        
        # 日配额检查
        used = self.get_daily_usage(tenant_id)
        if used >= quota["daily_tokens"]:
            raise QuotaExceededError("超出每日配额")
```

### Layer 3：安全隔离

```python
class TenantSecurityIsolation:
    """权限和安全隔离"""
    
    # 权限隔离
    def check_permission(self, tenant_id, user_id, action):
        # 用户只能操作本租户数据
        if user_id not in self.get_tenant_users(tenant_id):
            return False
        # 角色权限
        return self.rbac.check(user_id, action)
    
    # 加密隔离（敏感租户）
    def encrypt_tenant_data(self, tenant_id, data):
        # 每租户独立密钥
        key = self.kms.get_tenant_key(tenant_id)
        return encrypt(data, key)
    
    # 审计隔离
    def audit(self, tenant_id, action):
        self.logs[tenant_id].append({
            "action": action,
            "timestamp": now(),
            "ip": request.ip,
        })  # 各租户独立审计日志
```

### Layer 4：性能隔离

```python
class TenantPerformanceIsolation:
    """防止一个租户拖慢其他租户"""
    
    # 方案A: 资源池分区
    def get_llm_pool(self, tenant_tier):
        if tenant_tier == "enterprise":
            return self.dedicated_pools[tenant_id]  # 专属资源
        return self.shared_pool  # 共享（但有限流）
    
    # 方案B: 超时隔离
    async def handle(self, tenant_id, request):
        try:
            return await asyncio.wait_for(
                self.process(request),
                timeout=self.get_timeout(tenant_id)
            )
        except TimeoutError:
            # 某租户超时不影响其他
            return "处理超时"
    
    # 方案C: 大租户独立部署
    # enterprise级 → 独立K8s命名空间/独立实例
```

## 三、隔离级别选择

```
┌──────────┬──────────────────┬──────────┬──────────┐
│ 隔离级别  │ 方案                │ 安全性    │ 成本      │
├──────────┼──────────────────┼──────────┼──────────┤
│ 共享一切  │ 同DB同表，字段过滤  │ 低        │ 最低      │
│ +行级隔离 │                    │          │          │
├──────────┼──────────────────┼──────────┼──────────┤
│ 共享DB   │ 同DB不同namespace  │ 中        │ 低        │
│ namespace│ /schema隔离        │          │          │
├──────────┼──────────────────┼──────────┼──────────┤
│ 独立DB   │ 每租户独立数据库    │ 高        │ 中        │
│ 共享实例  │ 共享DB实例          │          │          │
├──────────┼──────────────────┼──────────┼──────────┤
│ 独立实例  │ 每租户独立部署      │ 最高      │ 高        │
│          │ 独立资源池          │          │          │
└──────────┴──────────────────┴──────────┴──────────┘

选型：
  免费/小租户 → 行级隔离（成本低）
  付费租户 → namespace隔离
  大客户/敏感 → 独立DB或独立实例
```

## 四、面试加分点

1. **四层隔离**：数据+资源+安全+性能——全面
2. **分级隔离**：按租户重要度选不同级别——务实（非一刀切）
3. **记忆也要隔离**：Agent 场景的记忆库必须 tenant_id+user_id 双重过滤

## 记忆要点

- 多租户四维隔离：数据、资源、安全、性能必须相互独立互不影响
- 数据隔离三方案：命名空间(高性价比)、行级过滤(加租户ID)、物理隔离(最安全高成本)
- 资源隔离强保障：按租户独立配置QPS限流和Token日配额上限
- 向量记忆隔离：检索强制注入租户ID前缀，防止A搜出B的隐私数据

## 苏格拉底式面试追问

> 这组追问模拟面试官层层逼问，每一问先回答"为什么"，再回答"怎么做"，最后回答"如何证明"。

### 第一层：目标与动机

**Q：多租户隔离你分了四层，为什么不直接给每个租户独立部署（物理隔离），一步到位最安全？**

因为成本和资源利用率。物理隔离（独立实例/独立 DB）每个租户要一套完整资源，100 个租户要 100 套，但大多数租户的流量很小（长尾分布，80% 租户只用 20% 资源），独立部署导致资源利用率极低（单实例利用率可能 < 10%），成本爆炸。SaaS 的商业模式靠的就是"共享资源摊薄成本"，全物理隔离等于失去 SaaS 的成本优势。所以物理隔离只给"大客户 + 敏感数据"（金融/医疗），中小租户走逻辑隔离（namespace/行级过滤），按租户价值分级，不是一刀切。

### 第二层：证据与定位

**Q：线上发生了一次"租户 A 看到了租户 B 的对话历史"的事故，你怎么快速定位是数据隔离哪一层失效？**

按数据链路逐层查。第一查写入时是否带了 tenant_id——看事故数据的存储记录，如果 tenant_id 字段为空或错乱，是写入时没正确注入租户标识（常见于异步任务/消息队列没透传 tenant_id）。第二查读取时的过滤——看查询语句是否带了 tenant_id 过滤，如果是拼接查询漏了 WHERE tenant_id 条件，是查询层 bug。第三查向量记忆检索——如果是 Agent 场景，看向量检索的 filter 是否生效，如果 filter 没传或向量库不支持 filter，是检索隔离失效。三层排查能定位到具体是写入、查询还是检索的隔离漏洞。

### 第三层：根因深挖

**Q：向量记忆隔离你说"强制注入 tenant_id 过滤"，但向量库（如 FAISS/Milvus）的 filter 是后置的（先 ANN 检索再过滤），如果某租户数据少，过滤后可能结果为空，根因和对策是什么？**

根因是"先检索后过滤"导致有效候选被过滤光。假设 ANN 召回 Top 20，其中可能只有 2 条属于该租户，过滤后只剩 2 条，召回不足。对策是"过滤前置"——用支持"filtered ANN"的向量库（Milvus/Qdrant 的 filtered search 是在检索时就带条件，不是后置过滤），保证检索的 Top 20 全是该租户的。如果向量库不支持 filtered ANN，退而求其次的做法是"过采样"——召回 Top 100 再过滤，提升过滤后有足够结果。但根本解法是按租户分 Collection（每个租户独立向量索引），检索时只查对应 Collection，彻底无跨租户泄漏风险，代价是租户多时索引管理复杂。

**Q：那为什么不直接按租户分 Collection（物理隔离向量库），彻底解决问题？**

因为租户数量大时 Collection 管理成本爆炸。1 万个租户要 1 万个 Collection，每个 Collection 都要建索引、维护、加载到内存，资源开销和运维复杂度都不可行。而且大量小租户的 Collection 数据量小（几百条），单独建索引的检索效率反而不如大 Collection + filter（小 Collection 的 ANN 图质量差）。所以分 Collection 只适合"大租户（数据量 > 10 万条）数量少（< 100 个）"的场景。中小租户共享 Collection + filtered ANN 是性价比最优。这是"隔离强度 vs 管理成本"的权衡，按租户规模分级处理。

### 第四层：方案权衡

**Q：资源隔离你用按租户的 QPS 限流，但 LLM 推理是慢调用（单次 5 秒），QPS 限流挡不住"单租户的长请求占用连接池"的问题，怎么权衡？**

QPS 限流要和"并发数限流"结合。QPS 限流控的是速率（每秒请求数），并发数限流控的是在途请求数（同时有多少个请求在处理）。LLM 场景必须限并发——单租户即使 QPS=10，如果每个请求 5 秒，意味着同时在途 50 个请求占着连接。我的做法是令牌桶控 QPS + 信号量控并发（max_concurrent 按租户 tier 配置，如 free=2、pro=10、enterprise=50）。超并发的请求排队或拒绝。两个维度叠加才能真正隔离资源，单 QPS 不够。

**Q：为什么不直接给大租户独立资源池（独立 GPU/独立实例），还要在共享池里搞限流？**

因为大租户的流量也是波动的。独立资源池要按"峰值"配资源（不然峰值时不够），但大多数时间资源闲置（利用率 < 30%），浪费严重。共享池 + 优先级调度更高效——大租户在共享池里有高优先级（资源紧张时优先满足），峰值时临时抢占小租户的份额，低谷时释放给小租户用。这样资源利用率能到 70%+。只有"超大租户 + 强隔离合规要求"（如金融客户合同写明独立部署）才上独立资源池。所以独立资源池是合规/合同驱动的，不是技术最优——技术最优是共享池 + 优先级调度。

### 第五层：验证与沉淀

**Q：你怎么证明多租户隔离真的有效，A 真的看不到 B 的数据，而不是"看起来隔离了"？**

做"跨租户渗透测试"。构造自动化测试：以租户 A 的身份尝试访问租户 B 的数据（直接查 B 的会话 ID、构造带 B 的 tenant_id 的查询、在向量检索里故意不带 filter），验证每个尝试都被拒绝。这套测试覆盖所有数据访问入口（API/查询/检索/导出），跑在 CI 里每次发版回归。另外做"混沌测试"——模拟故障场景（如 filter 条件被代码改动漏掉），验证有兜底机制（如默认 deny、全量审计告警）。有渗透测试 + 混沌测试，隔离才是被验证的，不是自以为隔离了。

**Q：这套多租户方案怎么沉淀成中台？**

抽象成"租户管理中台"，封装数据隔离（自动注入 tenant_id、查询自动加 filter）、资源隔离（按 tier 的限流/配额配置化）、安全隔离（密钥管理/审计日志）、性能隔离（优先级调度）。业务服务接入只需声明"这是个多租户服务"，框架自动处理隔离，开发者不用在每个查询手写 tenant_id 过滤（人总会漏）。配套租户管理后台（运营能开通/停用租户、调整 tier、查看用量）。这样隔离能力是框架级保证的，不依赖每个开发者自觉，从根上杜绝"漏了 filter 导致泄露"。

## 结构化回答



**30 秒电梯演讲：** 像写字楼——每公司独立办公室(数据)、各自电表(资源)、门禁卡(安全)、隔音墙(性能)。

**展开框架：**
1. **数据隔离** — namespace/user_id过滤
2. **资源隔离** — 配额/限流/独立部署
3. **安全隔离** — 权限/加密/审计

**收尾：** 逻辑隔离和物理隔离怎么选？




## 视频脚本

> 预计时长：4 分钟 | 由浅入深


| 时间 | 画面/字幕 | 口播台词 | 讲解要点 |
|------|----------|----------|----------|
| 0:00 | 标题卡：对话系统的多租户隔离方案？ | "像写字楼——每公司独立办公室(数据)、各自电表(资源)、门禁卡(安全)、隔音墙(性能)。" | 开场钩子 |
| 0:20 | 核心概念图 | "对话系统多租户隔离=数据隔离(用户namespace)+资源隔离(配额/限流)+安全隔离(权限/加密)+性能隔离(不影响…" | 核心定义 |
| 0:50 | 数据隔离示意图 | "数据隔离——namespace/user_id过滤" | 要点拆解1 |
| 1:30 | 对比/实战案例图 | "对比一下常见误区和工程实践，看真实场景里怎么取舍。" | 实战与对比 |
| 2:20 | 总结卡 | "记住核心要点。下期我们追问：逻辑隔离和物理隔离怎么选？——敏感数据物理，普通逻辑？" | 收尾与钩子 |
