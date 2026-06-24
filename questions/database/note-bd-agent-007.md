---
id: note-bd-agent-007
difficulty: L2
category: database
subcategory: Redis
tags:
  - 字节
  - 面经
  - Redis
feynman:
  essence: Redis在高并发业务中主要解决缓存、锁单、分布式锁、库存预扣和热点配置问题
  analogy: 'Redis就像前台的暂存柜——常用东西放这拿得快(缓存)、贵重物品先锁起来(锁单)、多人抢同一个东西先到先得(分布式锁)'
  first_principle: '数据库面向磁盘设计随机IO慢，Redis全内存操作快10-100倍，适合做热点数据的缓冲层'
  key_points:
    - 拼团锁单防止超卖
    - 库存预扣用Redis原子操作
    - 分布式锁控制并发
    - 热点配置和限流阈值缓存
first_principle:
  essence: MySQL单机QPS上限~5000，Redis单机QPS可达10万+，高并发场景必须用Redis做缓冲层
  derivation: '拼团高峰QPS可达数万→MySQL扛不住→先用Redis原子操作预扣库存→异步落库→保护MySQL'
  conclusion: Redis在业务系统中的定位是高并发缓冲层和过程态存储
follow_up:
  - 'Redis和MySQL的数据一致性怎么保证？'
  - '热点Key问题怎么解决？'
  - 'Redis集群模式选主从还是哨兵？'
---

# Redis在业务项目中主要解决了哪些问题？

## Redis核心用途全景

```
┌──────────────────────────────────────────────┐
│              Redis 在业务中的应用              │
├───────────┬───────────┬───────────┬──────────┤
│  缓存     │  分布式锁  │ 库存预扣   │ 消息队列 │
│ ────────  │ ────────  │ ────────  │ ──────── │
│ 热点数据   │ 拼团锁单   │ INCR/DECR │ List     │
│ 配置信息   │ 支付回调   │ Lua脚本   │ Stream   │
│ 限流阈值   │ 秒杀防超卖 │ 过期释放  │ PUB/SUB  │
└───────────┴───────────┴───────────┴──────────┘
```

## 1. 拼团锁单（防超卖）

```python
# 拼团场景：多人同时拼同一个团，需要锁单防止超卖
def lock_group_order(group_id, user_id):
    """用Redis分布式锁实现拼团锁单"""
    lock_key = f"lock:group:{group_id}"
    
    # SET NX EX：不存在才设置，60秒自动过期
    acquired = redis.set(lock_key, user_id, nx=True, ex=60)
    
    if acquired:
        try:
            # 检查拼团是否已满
            current = redis.get(f"group:{group_id}:count")
            if int(current or 0) < max_members:
                redis.incr(f"group:{group_id}:count")
                return True
        finally:
            # 释放锁（Lua脚本保证原子性）
            redis.eval(release_script, 1, lock_key, user_id)
    
    return False  # 锁单失败
```

## 2. 库存预扣（高并发）

```python
# 秒杀/拼团场景：用Redis原子操作做库存预扣
DEDUCT_SCRIPT = """
local stock = redis.call('GET', KEYS[1])
if not stock or tonumber(stock) < tonumber(ARGV[1]) then
    return -1  -- 库存不足
end
redis.call('DECRBY', KEYS[1], ARGV[1])
return tonumber(stock) - tonumber(ARGV[1])
"""

def pre_deduct_stock(item_id, quantity):
    """Lua脚本保证扣减原子性"""
    result = redis.eval(DEDUCT_SCRIPT, 1, 
                        f"stock:{item_id}", quantity)
    if result < 0:
        return False  # 库存不足
    # 异步落库到MySQL
    mq.send("stock_sync", {"item_id": item_id, "qty": quantity})
    return True
```

**为什么不用MySQL直接扣**：
- MySQL行锁→高并发时大量请求排队→响应慢
- Redis内存操作→QPS可达10万+→用户体验好

## 3. 分布式锁（详见Q12-Q13）

```
长链路操作（支付回调、拼团结算）→ Redisson + watchdog自动续期
短耗时操作（库存预占）→ SetNX + 过期时间
```

## 4. 热点配置缓存

```python
# 变化不频繁但读取频繁的数据放Redis
def get_activity_rules(activity_id):
    # 1. 先查Redis
    rules = redis.get(f"rules:{activity_id}")
    if rules:
        return json.loads(rules)
    
    # 2. 未命中查MySQL
    rules = mysql.query("SELECT * FROM rules WHERE activity_id=%s", 
                        activity_id)
    
    # 3. 写入Redis（设置TTL防止数据不一致）
    redis.setex(f"rules:{activity_id}", 300, json.dumps(rules))
    return rules
```

**缓存的数据类型**：

| 数据 | TTL | 更新策略 |
|------|-----|---------|
| 活动规则 | 5min | Cache Aside |
| 黑名单 | 10min | 定时刷新 |
| 限流阈值 | 30min | 后台配置变更时主动删缓存 |
| 商品基础信息 | 1h | 下单时验证 |

## 5. 动态配置中心

```python
# 限流、开关等运行时配置存Redis，不重启即可生效
def check_rate_limit(user_id, api):
    key = f"ratelimit:{api}:{user_id}"
    count = redis.incr(key)
    if count == 1:
        redis.expire(key, 60)  # 1分钟窗口
    
    limit = redis.get(f"config:ratelimit:{api}")  # 动态阈值
    return count <= int(limit or 100)
```

## 数据流向

```
用户请求 → 检查限流(Redis) → 预扣库存(Redis) → 锁单(Redis)
              │                    │                 │
              └──── 消息队列 ──────┴──── 异步落库 ────┘
                                          │
                                     MySQL (最终一致)
```

## 面试加分点

1. **场景驱动**：不是列举Redis数据结构，而是从业务场景出发
2. **原子操作**：强调Lua脚本保证预扣库存的原子性
3. **异步落库**：Redis做过程态，MySQL做最终态，体现架构思维
4. **TTL管理**：不同数据设置不同过期时间，平衡一致性和性能
