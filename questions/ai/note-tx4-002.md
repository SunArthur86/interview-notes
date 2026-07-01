---
id: note-tx4-002
difficulty: L4
category: ai
subcategory: Agent
tags:
- 腾讯
- 面经
- Memory
- 多租户
feynman:
  essence: 多用户Agent长期记忆系统需要解决两个核心问题：记忆冲突(同一用户前后说法矛盾)和多租户隔离(防止跨用户数据泄露)
  analogy: 像一个酒店管家服务——住客昨天说要素食今天说要牛排(冲突)，管家不能擅自覆盖，得确认；同时不能把301房的偏好给302房看(隔离)
  first_principle: 记忆的本质是状态管理，冲突是状态不一致问题，隔离是权限控制问题
  key_points:
  - '冲突处理: 不直接覆盖，加时间戳+置信度，冲突时问用户'
  - '多租户隔离: tenant_id+user_id双层过滤，物理分库+权限网关'
  - '记忆生命周期: 创建→去重合并→置信衰减→过期淘汰'
  - '全链路审计: 记忆CRUD全部留日志'
first_principle:
  essence: 记忆系统 = 存储 + 一致性 + 隔离 + 生命周期管理
  derivation: 用户偏好会变 → 前后矛盾 → 不能简单覆盖(丢信息) → 需要版本+置信度 → 冲突时确认 → 多用户 → 需要租户隔离 → 记忆会过时 → 需要TTL淘汰
  conclusion: 生产级Agent记忆系统是分布式状态管理问题，不是简单的向量库查询
follow_up:
- 记忆存在哪？向量库还是关系数据库？
- 记忆膨胀怎么处理？无限增长成本太高
- 如何评估记忆系统对Agent效果的影响？
memory_points:
- 记忆防冲突：新记忆不直接覆盖旧记忆，而是打废弃标并附加时间戳溯源
- 高置信度旧记忆遇冲突时：新记忆高优写入，并异步主动询问用户确认真相
- 多租户防泄露：检索时强制双层过滤(tenant_id + user_id)
- 防越权读取：必须经过权限网关，校验当前会话用户与记忆所有者严格一致
---

# 设计多用户在线 Agent 长期记忆系统，用户前后说法矛盾产生记忆冲突怎么处理？多租户如何防止记忆泄露？

## 记忆冲突处理

### 问题场景

```
Day 1: 用户说 "我喜欢吃辣"
Day 7: 用户说 "我最近不能吃辣，胃不舒服"

❌ 错误做法: 直接覆盖旧记忆 → 丢失历史，无法溯源
✅ 正确做法: 保留两条，用时间戳+置信度管理
```

### 冲突处理方案

```python
class MemoryConflictResolver:
    def resolve(self, old_memory, new_memory, user_id):
        """处理新旧记忆冲突"""

        # 1. 检测冲突：同维度不同值
        if self.is_conflict(old_memory, new_memory):
            # 2. 不覆盖，标记旧记忆为"废弃"但保留
            old_memory.status = "deprecated"
            old_memory.deprecated_at = datetime.now()
            old_memory.deprecated_reason = "superseded"

            # 3. 新记忆高置信度写入
            new_memory.confidence = 0.9
            new_memory.source = "user_explicit"  # 用户明确说的
            new_memory.created_at = datetime.now()

            # 4. 主动向用户确认(异步)
            if old_memory.confidence > 0.7:
                # 旧记忆也是高置信度 → 需要确认
                self.ask_user_confirmation(user_id, old_memory, new_memory)

            # 5. 旧记忆不删除，标记归档
            self.archive(old_memory)

        # 6. 写入前去重合并
        self.deduplicate(user_id, new_memory)
```

### 记忆数据结构

```python
@dataclass
class Memory:
    id: str
    user_id: str
    tenant_id: str
    content: str          # "喜欢吃辣"
    category: str         # "food_preference"
    confidence: float     # 0.0-1.0
    source: str           # user_explicit / inferred / system
    status: str           # active / deprecated / archived
    created_at: datetime
    expires_at: datetime  # TTL
    embedding: List[float]  # 向量表示
    metadata: dict        # 会话ID、上下文等
```

## 多租户记忆隔离

### 双层索引隔离

```python
class MultiTenantMemoryStore:
    def search(self, query_embedding, tenant_id, user_id, top_k=5):
        # 强制携带双过滤条件
        results = self.vector_db.search(
            vector=query_embedding,
            filter={
                "tenant_id": tenant_id,  # 第一层：租户隔离
                "user_id": user_id,      # 第二层：用户隔离
                "status": "active"       # 只查有效记忆
            },
            top_k=top_k
        )
        return results

    def write(self, memory: Memory):
        # 写入时强制绑定tenant_id
        assert memory.tenant_id is not None
        assert memory.user_id is not None
        self.vector_db.upsert(memory)
```

### 权限网关

```python
class MemoryAccessGateway:
    def read_memory(self, session_user_id, memory_id):
        memory = self.store.get(memory_id)

        # 鉴权：校验当前会话用户与记忆所有者一致
        if memory.user_id != session_user_id:
            raise PermissionDenied("跨用户记忆访问被拦截")

        # 校验租户
        if memory.tenant_id != self.current_tenant:
            raise PermissionDenied("跨租户访问被拦截")

        # 审计日志
        self.audit_log.record(
            action="READ", user_id=session_user_id,
            memory_id=memory_id, timestamp=datetime.now()
        )
        return memory
```

### 数据分层存储

```
┌─────────────────────────────────────────┐
│  热数据 (Redis)                         │
│  当前会话记忆、高频访问偏好              │
│  TTL: 24h                               │
├─────────────────────────────────────────┤
│  温数据 (PostgreSQL + pgvector)         │
│  用户长期偏好、历史交互摘要              │
│  按tenant_id分表                        │
├─────────────────────────────────────────┤
│  冷数据 (S3 + 索引)                     │
│  归档记忆、审计日志                      │
│  按月归档                               │
└─────────────────────────────────────────┘
```

## 记忆生命周期管理

```python
class MemoryLifecycleManager:
    def decay_confidence(self, memory):
        """置信度随时间衰减"""
        age_days = (datetime.now() - memory.created_at).days
        # 时效类记忆(地址、订单)快速衰减
        if memory.category in ["address", "order_preference"]:
            memory.confidence *= math.exp(-age_days / 30)  # 30天半衰期
        # 稳定偏好(口味、语言)慢速衰减
        elif memory.category in ["food_preference", "language"]:
            memory.confidence *= math.exp(-age_days / 365)  # 1年半衰期

    def cleanup_expired(self):
        """定期清理过期/低置信度记忆"""
        # 1. TTL过期 → 归档
        expired = self.store.query(expires_at__lt=datetime.now())
        for m in expired:
            m.status = "archived"

        # 2. 低置信度 → 删除(释放空间)
        low_conf = self.store.query(confidence__lt=0.1, status="active")
        for m in low_conf:
            self.store.delete(m.id)

        # 3. 重复记忆合并
        self.merge_duplicates()
```

## 完整安全审计

```python
# 所有记忆操作留日志
AUDIT_EVENTS = [
    "MEMORY_CREATED",    # 新增
    "MEMORY_READ",       # 读取
    "MEMORY_UPDATED",    # 修改
    "MEMORY_DEPRECATED", # 废弃
    "MEMORY_ARCHIVED",   # 归档
    "MEMORY_DELETED",    # 删除
    "ACCESS_DENIED",     # 越权拦截
]

# 审计日志支持事后溯源
# 例：发现用户投诉"我的偏好被改了"→ 查审计日志 → 定位到哪次会话改的
```

## 记忆要点

- 记忆防冲突：新记忆不直接覆盖旧记忆，而是打废弃标并附加时间戳溯源
- 高置信度旧记忆遇冲突时：新记忆高优写入，并异步主动询问用户确认真相
- 多租户防泄露：检索时强制双层过滤(tenant_id + user_id)
- 防越权读取：必须经过权限网关，校验当前会话用户与记忆所有者严格一致

