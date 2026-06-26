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
  derivation: '共享(同一套系统)降成本，但租户间不能互相影响(数据/资源/安全/性能)。隔离方案从逻辑隔离(成本低)到物理隔离(成本高)有光谱，按敏感度选择。'
  conclusion: 多租户隔离 = 数据+资源+安全+性能 的分层隔离策略
follow_up:
  - 逻辑隔离和物理隔离怎么选？——敏感数据物理，普通逻辑
  - 大租户怎么处理？——专属资源/独立实例
  - 隔离会增加多少成本？——逻辑隔离几乎无额外成本
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
