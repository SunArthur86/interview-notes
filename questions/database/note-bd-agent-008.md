---
id: note-bd-agent-008
difficulty: L3
category: database
subcategory: Redis
tags:
- 字节
- 面经
- Redis
- MySQL
- 一致性
feynman:
  essence: MySQL是最终数据源，Redis存过程态，用Cache Aside+消息补偿保证最终一致性
  analogy: 就像银行和手机银行——银行柜台(MySQL)是准的，手机银行(Redis)可能有延迟，但最终会对上账
  first_principle: 强一致双写性能差且复杂，最终一致性在业务可接受范围内用最低成本保证数据最终正确
  key_points:
  - MySQL是唯一数据源(Source of Truth)
  - Redis更多存过程态不做强一致双写
  - 读用Cache Aside，写用先写MySQL后删Redis
  - 异常通过MQ重试和定时任务补偿
first_principle:
  essence: 分布式系统CAP定理下，强一致性必然牺牲可用性，业务场景允许最终一致
  derivation: 强一致双写需要2PC/XA事务→性能下降50%+→业务拼团场景不需要→选择最终一致+异步补偿
  conclusion: 最终一致性 = Cache Aside读 + 先DB后Cache写 + MQ补偿兜底
follow_up:
- 先删缓存再写DB会有什么问题？
- 延迟双删方案是什么？
- Canal监听binlog同步可行吗？
memory_points:
- 核心主从：MySQL是唯一数据源，而Redis仅作临时过程态。
- 写策略口诀：先写DB后删Cache。
- 反面论证：因为先删Cache时并发读会把旧数据写回，所以极易造成脏读污染。
- 兜底补偿机制：延迟双删或利用MQ重试机制保证缓存最终必定删除。
---

# Redis和MySQL同时存业务状态时，怎么保证最终一致性？

## 核心原则：MySQL是唯一数据源

```
┌──────────────┐         ┌──────────────┐
│    Redis     │         │    MySQL     │
│  (过程态)    │←───同步───│  (最终态)    │
│  库存预占     │         │  库存实际     │
│  锁单状态     │         │  订单数据     │
│  会话缓存     │         │  支付记录     │
└──────────────┘         └──────────────┘
     ↑                         ↑
   临时数据                   永久数据
   可丢失                     不可丢失
```

## 读策略：Cache Aside（旁路缓存）

```python
def read_data(key):
    # 1. 先读Redis
    data = redis.get(key)
    if data:
        return json.loads(data)
    
    # 2. 未命中，读MySQL
    data = mysql.query("SELECT * FROM t WHERE id = %s", key)
    
    # 3. 回填Redis（设置TTL）
    if data:
        redis.setex(key, 300, json.dumps(data))
    
    return data
```

## 写策略：先写MySQL后删Redis ⭐

```python
def write_data(key, new_value):
    """推荐方案：先DB后删Cache"""
    try:
        # 1. 先写MySQL（事务）
        mysql.execute("UPDATE t SET value=%s WHERE id=%s", 
                      new_value, key)
        mysql.commit()
        
        # 2. 删除Redis缓存（不是更新）
        redis.delete(key)
        
    except Exception as e:
        mysql.rollback()
        raise e
```

### 为什么"先DB后删Cache"而不是"先删Cache后DB"？

```
❌ 先删Cache后写DB的问题：

线程A: 删除Cache ──────────── 写DB ────────
线程B:            读Cache(未命中) ── 读DB(旧值) ── 写Cache(旧值)
                                          ↑
                                    缓存被旧值污染！

✅ 先DB后删Cache的流程：

线程A: 写DB ──── 删除Cache ────
线程B:     读Cache(命中旧值) ──────  (下次读会从DB拿新值)
                                         ↑
                                    最多脏读一个TTL周期
```

## 异常补偿机制

### 1. MQ重试（实时补偿）

```python
def write_with_mq_compensation(key, value):
    """先DB后删Cache + MQ补偿"""
    # 1. 写MySQL
    mysql.execute("UPDATE ...")
    mysql.commit()
    
    # 2. 发MQ消息（异步删Cache）
    mq.send("cache_invalidate", {"key": key})
    
    # 消费者：删除失败重试3次
    # → 3次失败进入DLQ → 定时任务兜底
```

### 2. 定时任务对账（兜底补偿）

```python
def reconciliation_task():
    """每隔5分钟对比Redis和MySQL数据"""
    # 找出差异记录
    hot_keys = redis.scan("stock:*")
    for key in hot_keys:
        redis_val = redis.get(key)
        mysql_val = mysql.query("SELECT stock FROM ...")
        
        if redis_val != mysql_val:
            # 以MySQL为准，修正Redis
            redis.set(key, mysql_val)
            log.warning(f"数据不一致已修正: {key}")
```

### 3. 库存预扣场景的特殊处理

```python
def pre_deduct_with_fallback(item_id, qty):
    """库存预扣 + 落库失败回滚"""
    # 1. Redis预扣（原子操作）
    remaining = redis.eval(DEDUCT_SCRIPT, item_id, qty)
    if remaining < 0:
        return False  # 库存不足
    
    try:
        # 2. 异步落库MySQL
        mysql.execute("UPDATE stock SET qty=qty-%s WHERE id=%s", 
                      qty, item_id)
        mysql.commit()
    except Exception:
        # 3. 落库失败→回滚Redis预扣
        redis.incrby(f"stock:{item_id}", qty)
        return False
    
    return True
```

## 完整一致性保障体系

```
                    写入请求
                       │
                       ▼
              ┌──── MySQL写入 ────┐
              │                    │
              ▼                    ▼
         删除Redis缓存          发MQ消息(异步)
              │                    │
              ▼                    ▼
         成功？              MQ消费者重试
         ├ 是 → 完成         ├ 成功 → 完成
         └ 否 → MQ补偿       └ 失败 → DLQ → 定时对账
                                    │
                                    ▼
                               以MySQL为准修正
```

## 面试回答要点

> "我们MySQL是最终数据源，Redis更多存过程态，不做强一致双写。

> **读**用Cache Aside——先查Redis，未命中查MySQL再回填。

> **写**用先写MySQL后删Redis——为什么不是先删Cache？因为先删后写DB有并发脏读风险，后删最多脏读一个TTL。

> **库存预扣**场景如果落库失败，就释放Redis占用；**支付和结算**链路再通过RabbitMQ重试和定时任务补偿。"

## 面试加分点

1. **明确分工**：MySQL=最终态，Redis=过程态，不做强一致双写
2. **知道为什么后删**：能解释"先删Cache后写DB"的并发脏读问题
3. **补偿体系**：MQ实时补偿 + 定时任务兜底对账
4. **预扣回滚**：落库失败时释放Redis预扣，保证不超卖

## 记忆要点

- 核心主从：MySQL是唯一数据源，而Redis仅作临时过程态。
- 写策略口诀：先写DB后删Cache。
- 反面论证：因为先删Cache时并发读会把旧数据写回，所以极易造成脏读污染。
- 兜底补偿机制：延迟双删或利用MQ重试机制保证缓存最终必定删除。

