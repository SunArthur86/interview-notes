---
id: note-tx-005
difficulty: L4
category: ai
subcategory: Agent
tags:
- 腾讯
- 面经
- 记忆
- 用户隔离
- 遗忘机制
feynman:
  essence: 多用户记忆隔离=每人的记忆只自己能查。遗忘机制=按时间+频率+相关性给记忆打分，低分的自动淘汰。
  analogy: 记忆系统像酒店——每个客人有独立房间（用户隔离），房间有不同清洁频率：常住客人的房间保留物品（高频访问），退房客人的物品清理（TTL过期），VIP客人的偏好永久记录（永不遗忘）。
  key_points:
  - 命名空间/行级隔离两种方案
  - 公共知识共享+私有记忆隔离
  - 遗忘=TTL+LRU+时间衰减+主动删除
  - 软删除+保留期防误删
first_principle:
follow_up:
- 共享记忆和私有记忆怎么区分？——按来源打标签（system=共享,user=私有）
- 向量数据库怎么做用户隔离？——collection/filter按user_id过滤
- 遗忘会不会误删有用信息？——软删除+保留期+重要标记
---

# 【腾讯面经】你的 Memory 是多用户的吗？有没有做用户隔离？遗忘机制怎么实现？

> 本题三连问，考察 Agent 记忆系统在**多租户场景**下的工程设计能力。回答要覆盖：为什么隔离 → 怎么隔离 → 怎么遗忘 → 怎么防误删，形成完整闭环。对标 P7 级别，需要给出可落地的数据模型和算法。

## 一、为什么必须做用户隔离

多用户 Memory 系统如果不做隔离，会引发三类严重问题：

| 问题类型 | 后果 | 严重程度 |
|---------|------|---------|
| **隐私泄露** | 用户 A 的对话历史/偏好被用户 B 检索到 | 🔴 致命（法律风险） |
| **记忆污染** | 用户 B 的偏好覆盖用户 A，导致回复错乱 | 🔴 严重（体验崩溃） |
| **合规违规** | 违反 GDPR / 个人信息保护法 | 🔴 致命（监管处罚） |

因此，**用户隔离不是可选项，而是多用户 Agent 的法律和技术底线**。

## 二、用户隔离实现方案

### 方案一：命名空间隔离（推荐）

每个用户的记忆存储在独立命名空间下，物理或逻辑分离：

```
memory:{user_id}:short_term    # 短期记忆（Redis Hash）
memory:{user_id}:long_term     # 长期记忆（向量DB Collection）
memory:{user_id}:preferences   # 用户偏好（KV存储）
```

检索时强制带上 user_id 前缀，**从根本上杜绝跨用户查询**：

```python
def retrieve_memory(user_id: str, query: str, top_k: int = 5):
    namespace = f"memory:{user_id}:long_term"
    results = vector_db.search(
        collection=namespace,  # 物理隔离
        query=embed(query),
        top_k=top_k
    )
    return results
```

**优点**：物理隔离，安全性最高；按用户分片易于扩展。
**缺点**：每个用户独立 collection，用户量大时管理开销高。

### 方案二：行级隔离（共享存储 + 过滤）

所有用户记忆存在同一张表/同一个 collection，但每条记录绑定 `user_id`，检索时强制过滤：

```sql
-- PostgreSQL 表结构
CREATE TABLE memories (
    id          BIGSERIAL PRIMARY KEY,
    user_id     VARCHAR(64) NOT NULL,
    content     TEXT NOT NULL,
    embedding   VECTOR(1536),
    metadata    JSONB,
    created_at  TIMESTAMPTZ DEFAULT NOW(),
    -- 关键：user_id + 用户隔离索引
    INDEX idx_user_time (user_id, created_at DESC)
);

-- 检索时强制 WHERE user_id = ?
SELECT * FROM memories
WHERE user_id = $1
  AND content_embedding <=> $2 < 0.3  -- 向量相似度过滤
ORDER BY content_embedding <=> $2
LIMIT 5;
```

向量数据库（如 Milvus）通过 **partition/filter** 实现：

```python
# Milvus 行级隔离
results = collection.search(
    data=[query_embedding],
    expr=f"user_id == '{user_id}'",  # 标量过滤
    output_fields=["content", "metadata"],
    limit=5
)
```

**优点**：存储集中、管理简单、适合中小规模。
**缺点**：依赖过滤的正确性，一旦漏加 filter 就泄露——需在代码层加"隔离护栏"。

### 方案三：共享知识 + 私有记忆分离（最佳实践）

生产系统的推荐架构——**不是所有记忆都要隔离**：

```
┌──────────────────────────────────┐
│       公共知识层（全局共享）       │
│  • 产品文档、FAQ                  │
│  • 通用工具使用说明               │
│  • 系统级 Prompt 模板             │
│  存储独立，所有用户可检索          │
└──────────────┬───────────────────┘
               │ 检索时合并
┌──────────────┴───────────────────┐
│      私有记忆层（按用户隔离）      │
│  • 用户对话历史                    │
│  • 个人偏好（语言/风格/时区）       │
│  • 个人任务/待办                   │
│  存储按 user_id 严格隔离           │
└──────────────────────────────────┘
```

通过 `source` 字段区分：`system`（共享） vs `user`（私有）。

```python
def retrieve(user_id, query):
    shared = vector_db.search(
        collection="shared_knowledge",
        filter={'source': 'system'},
        query=embed(query), top_k=3
    )
    private = vector_db.search(
        collection="user_memories",
        filter={'user_id': user_id, 'source': 'user'},
        query=embed(query), top_k=5
    )
    return merge_and_rerank(shared, private)
```

## 三、遗忘机制实现

### 为什么需要遗忘

1. **成本控制**：记忆无限增长 → 向量DB 存储和检索成本线性上升
2. **质量保障**：过时/错误的记忆会误导模型，降低回复质量
3. **合规要求**：GDPR 要求支持"被遗忘权"
4. **性能保障**：记忆越多检索越慢，影响 P99 延迟

### 遗忘策略矩阵

| 策略 | 触发条件 | 实现 | 适用场景 |
|------|---------|------|---------|
| **TTL 过期** | 超过设定有效期 | 定时任务清理 | 短期对话记忆 |
| **LRU 淘汰** | 超过容量上限 | 删除最久未访问 | 控制总量 |
| **时间衰减评分** | 定期打分 | 低分自动降级/删除 | 精细化遗忘 |
| **主动遗忘** | 用户请求 | API 调用删除 | GDPR 合规 |
| **质量淘汰** | 标记为低质/错误 | 批量清理 | 维护记忆准确性 |

### 时间衰减评分算法（核心）

```python
import math
from datetime import datetime, timedelta

def memory_score(memory, now: datetime, lambda_decay: float = 0.05):
    """
    综合评分 = 相关性 × 时间衰减 × 访问频率权重 × 重要性
    """
    days_since = (now - memory.last_accessed).days

    # 时间衰减：越久没访问，分越低
    recency = math.exp(-lambda_decay * days_since)

    # 访问频率：log 压缩，避免高频记忆无限放大
    frequency = math.log1p(memory.access_count)

    # 重要性权重（critical=1.0, normal=0.5, low=0.1）
    importance = memory.importance_weight

    # 最终得分
    score = recency * frequency * importance
    return score

# 定时任务：每天凌晨清理低分记忆
def forget_low_score_memories(user_id: str, threshold: float = 0.01):
    candidates = db.query(
        "SELECT * FROM memories WHERE user_id = ? AND is_deleted = false",
        [user_id]
    )
    now = datetime.now()
    for mem in candidates:
        if memory_score(mem, now) < threshold:
            soft_delete(mem.id)  # 软删除，不是物理删除
```

### TTL + LRU 组合策略

```yaml
# 遗忘策略配置示例
forgetting:
  # 分层 TTL
  ttl:
    working_memory: 24h        # 工作记忆 1 天
    episodic_memory: 30d       # 情景记忆 30 天
    semantic_memory: null      # 语义记忆不过期

  # 容量上限（每用户）
  capacity:
    max_memories: 10000
    eviction_policy: LRU       # 超限删最久未访问

  # 衰减参数
  decay:
    lambda: 0.05               # 衰减系数
    cleanup_interval: 24h      # 清理周期
    score_threshold: 0.01      # 低于此分进入软删除队列
```

## 四、防误删机制

遗忘最大的风险是**删掉不该删的**。生产系统必须有多重保护：

### 1. 软删除 + 保留期

```sql
-- 不是 DELETE，而是标记
UPDATE memories
SET is_deleted = true,
    deleted_at = NOW()
WHERE id = ?;

-- 定时任务：30 天后才真正物理删除
DELETE FROM memories
WHERE is_deleted = true
  AND deleted_at < NOW() - INTERVAL '30 days';
```

### 2. 重要性标记（永不遗忘）

```python
class Memory:
    importance: Literal["critical", "normal", "low"]
    # critical: 用户明确告知的关键信息（如过敏史、账号绑定）
    # → 永不衰减、永不过期、只能用户主动删除
```

### 3. 删除前二次确认

```python
def safe_forget(memory_id: str):
    mem = db.get(memory_id)
    if mem.importance == "critical":
        raise ProtectionError("关键记忆不可自动遗忘，需用户确认")
    if mem.access_count > 100:
        # 高频访问记忆，降低遗忘优先级
        log.warning(f"高频记忆 {memory_id} 进入遗忘候选，请人工复核")
    soft_delete(memory_id)
```

## 五、面试加分点

1. **先讲为什么**（隐私+合规+性能），再讲怎么做——体现架构思维。
2. **强调"隔离是安全底线"**，不是优化项——体现工程严谨性。
3. **软删除+保留期**是多数候选人会漏的点，主动提出体现生产经验。
4. **延伸到合规**：提到 GDPR 的 right-to-be-forgotten，体现对法规的认知。
5. **成本意识**：遗忘不只是功能，更是成本控制手段——向量DB 按存储量计费。
