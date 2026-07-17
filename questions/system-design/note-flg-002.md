---
id: note-flg-002
difficulty: L3
category: system-design
subcategory: 消息队列
tags:
- 幂等
- 消息队列
- 并发
- 飞猪
- 面经
- 笔试题
- 分布式
feynman:
  essence: MQ幂等消费 = 同一业务流水号的消息无论被投递多少次，核心业务只执行一次。实现关键是用"唯一键+去重表"做防重判断，用数据库事务保证"检查+执行"的原子性，用行锁/乐观锁处理并发。
  analogy: 就像超市扫码结账——同一件商品你扫多少次码，系统都只收一次钱。条形码就是"业务流水号"，收银系统检查"这个码扫过了没"就是去重。
  first_principle: 幂等性的本质是"操作的可重入性"——一个操作执行N次和执行1次的效果完全相同。在MQ场景下，重复投递是必然的（网络重试/at-least-once语义），所以消费者必须自己保证幂等。
  key_points:
  - '幂等三方案: 去重表(通用) / 业务状态机(有状态流转) / 数据库唯一约束(简单)'
  - '去重表设计: idempotent_key(PK) + status + created_at + 业务字段'
  - '并发处理: 数据库行锁(SELECT FOR UPDATE) / 乐观锁(版本号) / Redis分布式锁'
  - '事务边界: 去重检查+业务执行在同一事务中(原子性)'
first_principle:
  essence: 重复消费是分布式系统中的必然事件（网络不可靠→at-least-once），消费者必须设计为幂等的。
  derivation: MQ保证消息至少投递一次 → 网络超时/Consumer重启→消息重投 → 同一消息可能被消费多次 → 如果业务不是幂等的(如扣款)→重复扣款 → 所以必须在消费端做幂等控制
  conclusion: 幂等消费 = 唯一键去重 + 原子事务 + 并发控制
follow_up:
- 如果Redis宕机导致分布式锁失效怎么办？
- 批量消息怎么保证幂等效率？
- 幂等去重表越来越大怎么清理？
- 消息处理失败后重试，怎么区分"重复投递"和"首次失败重试"？
memory_points:
- "核心方案: idempotent_key去重表 + 同一DB事务(去重检查+业务执行)"
- "并发控制: SELECT FOR UPDATE悲观锁 / version乐观锁"
- "状态机方案: 状态流转(PENDING→PROCESSING→SUCCESS)天然幂等"
- "注意: 去重记录在事务提交后保留(TTL清理)，不能在事务内删除"
---

# 设计MQ幂等消费函数

## 🎯 本质

同一业务流水号的消息重复投递时，核心业务只执行一次。方案：**唯一键去重表 + 原子事务 + 并发控制**。

## 🧒 费曼类比

超市扫码：同一商品扫多少次只收一次钱。条形码 = 业务流水号，收银系统查"扫过没" = 去重。

## 📊 设计图

```
MQ重复投递场景:
  Producer ──→ [msg-001: 业务流水号TX100, 扣款500元]
  Producer ──→ [msg-001: 业务流水号TX100, 扣款500元] ← 重投!
  Producer ──→ [msg-001: 业务流水号TX100, 扣款500元] ← 又重投!

没有幂等:                       有幂等:
  第1次: 扣500 余额=450            第1次: 查TX100不存在→扣500→记录TX100
  第2次: 扣500 余额=-50 ✗          第2次: 查TX100已存在→跳过
  第3次: 扣500 余额=-550 ✗         第3次: 查TX100已存在→跳过
  结果: 用户被扣3次!               结果: 只扣1次 ✓
```

## 🔧 专业详解

### 数据库表设计

```sql
-- 幂等去重表
CREATE TABLE idempotent_record (
    idempotent_key   VARCHAR(64) PRIMARY KEY COMMENT '业务流水号(唯一键)',
    biz_type         VARCHAR(32) NOT NULL    COMMENT '业务类型',
    status           TINYINT DEFAULT 1       COMMENT '1-处理中 2-成功 3-失败',
    result           TEXT                    COMMENT '处理结果(JSON)',
    created_at       DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at       DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_created (created_at)           COMMENT '用于TTL清理'
) ENGINE=InnoDB;

-- 业务表(以扣款为例)
CREATE TABLE account (
    user_id    BIGINT PRIMARY KEY,
    balance    DECIMAL(10,2) NOT NULL,
    version    INT DEFAULT 0          COMMENT '乐观锁版本号'
);
```

### 核心消费函数（三种方案）

#### 方案1：去重表 + 悲观锁（推荐通用方案）

```python
import pymysql
from contextlib import contextmanager

class IdempotentConsumer:
    def __init__(self, db_config):
        self.db_config = db_config
    
    @contextmanager
    def get_conn(self):
        conn = pymysql.connect(**self.db_config, autocommit=False)
        try:
            yield conn
            conn.commit()
        except Exception:
            conn.rollback()
            raise
        finally:
            conn.close()
    
    def consume(self, idempotent_key: str, message: dict) -> dict:
        """
        幂等消费函数
        - idempotent_key: 业务流水号(唯一)
        - message: 消息内容
        - 返回: {"status": "success/skipped/failed", "detail": "..."}
        """
        with self.get_conn() as conn:
            cursor = conn.cursor(pymysql.cursors.DictCursor)
            
            try:
                # Step 1: 插入去重记录(利用唯一约束防重)
                cursor.execute(
                    "INSERT INTO idempotent_record (idempotent_key, biz_type, status) "
                    "VALUES (%s, %s, 1)",
                    (idempotent_key, message.get('biz_type', 'default'))
                )
            except pymysql.err.IntegrityError:
                # 唯一键冲突 → 消息已处理过
                cursor.execute(
                    "SELECT status, result FROM idempotent_record "
                    "WHERE idempotent_key = %s", (idempotent_key,)
                )
                existing = cursor.fetchone()
                if existing and existing['status'] == 2:  # 已成功
                    return {"status": "skipped", "detail": "消息已处理"}
                elif existing and existing['status'] == 1:  # 处理中(并发)
                    return {"status": "skipped", "detail": "消息正在处理中"}
                else:  # status=3, 上次失败, 允许重试
                    cursor.execute(
                        "UPDATE idempotent_record SET status=1 "
                        "WHERE idempotent_key=%s AND status=3",
                        (idempotent_key,)
                    )
            
            # Step 2: 执行核心业务(在同一事务中)
            try:
                result = self._do_business(cursor, message)
                
                # Step 3: 更新去重记录为成功
                cursor.execute(
                    "UPDATE idempotent_record SET status=2, result=%s "
                    "WHERE idempotent_key=%s",
                    (str(result), idempotent_key)
                )
                return {"status": "success", "detail": result}
                
            except Exception as e:
                # 标记失败, 允许后续重试
                cursor.execute(
                    "UPDATE idempotent_record SET status=3 "
                    "WHERE idempotent_key=%s", (idempotent_key,)
                )
                raise  # 触发事务回滚
    
    def _do_business(self, cursor, message):
        """核心业务逻辑: 以扣款为例"""
        user_id = message['user_id']
        amount = message['amount']
        
        # 乐观锁扣款
        cursor.execute(
            "SELECT balance, version FROM account WHERE user_id=%s FOR UPDATE",
            (user_id,)
        )
        account = cursor.fetchone()
        if not account or account['balance'] < amount:
            raise ValueError(f"余额不足: balance={account['balance']}, need={amount}")
        
        cursor.execute(
            "UPDATE account SET balance=balance-%s, version=version+1 "
            "WHERE user_id=%s AND version=%s",
            (amount, user_id, account['version'])
        )
        if cursor.rowcount == 0:
            raise ValueError("并发冲突,请重试")
        
        return {"user_id": user_id, "deducted": amount, 
                "remaining": account['balance'] - amount}
```

#### 方案2：状态机（有状态流转的业务）

```python
def consume_with_state_machine(order_id, message):
    """利用业务状态流转天然实现幂等"""
    with get_db() as conn:
        cursor = conn.cursor()
        
        # 查当前状态
        cursor.execute("SELECT status FROM orders WHERE id=%s FOR UPDATE", (order_id,))
        order = cursor.fetchone()
        
        if not order:
            raise ValueError("订单不存在")
        
        # 状态机: 只有PENDING状态才能扣款
        if order['status'] == 'PENDING':
            do_deduct(order_id, message['amount'])
            update_order_status(order_id, 'PAID')
            return "success"
        elif order['status'] == 'PAID':
            return "skipped: already paid"  # 幂等
        else:
            return "skipped: invalid state"
```

#### 方案3：Redis分布式锁（高性能场景）

```python
import redis
import json

class RedisIdempotentConsumer:
    def __init__(self):
        self.redis = redis.Redis()
        self.lock_timeout = 30  # 锁超时秒
    
    def consume(self, idempotent_key, message):
        # SET NX 原子操作: 不存在才设置
        acquired = self.redis.set(
            f"idempotent:{idempotent_key}", "1",
            nx=True, ex=self.lock_timeout
        )
        
        if not acquired:
            # key已存在 → 消息已处理或正在处理
            status = self.redis.get(f"idempotent:{idempotent_key}")
            return {"status": "skipped", "detail": f"already processed: {status}"}
        
        try:
            result = self._do_business(message)
            # 标记成功(延长TTL作为成功标记)
            self.redis.set(f"idempotent:{idempotent_key}", "success", ex=86400)
            return {"status": "success", "detail": result}
        except Exception as e:
            # 删除锁, 允许重试
            self.redis.delete(f"idempotent:{idempotent_key}")
            raise
```

### 方案对比

| 方案 | 优点 | 缺点 | 适用场景 |
|------|------|------|---------|
| **去重表+DB事务** | 强一致、可审计 | 性能一般 | 金融/交易(推荐) |
| **状态机** | 无需额外表、业务内聚 | 需要状态流转 | 订单/审批流程 |
| **Redis锁** | 高性能 | 有极端情况丢失 | 日志/通知/非关键 |

## 💡 例子

**飞猪笔试场景**：MQ幂等消费——用户报销审批消息可能重复投递

```
消息: {biz_no: "BX20240101001", user_id: "U001", amount: 500, type: "报销"}
重投: {biz_no: "BX20240101001", user_id: "U001", amount: 500, type: "报销"}

处理流程:
1. INSERT idempotent_record(biz_no="BX20240101001") → 成功(首次)
2. 执行报销: 余额+500 → 更新去重记录status=2 → COMMIT
3. 重投消息到达: INSERT → 唯一键冲突 → 查status=2 → SKIP
```

## ❓ 苏格拉底式面试追问

1. **"去重表越来越大怎么办？"**
   → TTL清理: 定时任务删除30天前的已处理记录 / 分表分库 / 归档到冷存储

2. **"SELECT FOR UPDATE性能差，有替代方案吗？"**
   → 乐观锁(version号) / Redis分布式锁(先挡一层) / 唯一索引(INSERT IF NOT EXISTS)

3. **"消息处理到一半Consumer挂了怎么办？"**
   → 去重记录status=1(处理中) → 重启后MQ重投 → 查到status=1 → 等待或跳过 → 配合超时机制(处理中超30分钟自动标记失败允许重试)

4. **"批量消息(100条)怎么高效幂等？"**
   → 批量INSERT IGNORE / REPLACE INTO → 一次性去重 → 只处理插入成功的记录


## 结构化回答

**30 秒电梯演讲：** MQ幂等消费 就是 同一业务流水号的消息无论被投递多少次，核心业务只执行一次。打个比方，就像超市扫码结账——同一件商品你扫多少次码，系统都只收一次钱。条形码就是"业务流水号"，收银系统检查"这个码扫过了没"就是去重。

**展开框架：**
1. **核心方案** — idempotent_key去重表 + 同一DB事务(去重检查+业务执行)
2. **并发控制** — SELECT FOR UPDATE悲观锁 / version乐观锁
3. **状态机方案** — 状态流转(PENDING→PROCESSING→SUCCESS)天然幂等

**收尾：** 这块我踩过坑——要不要深入聊：如果Redis宕机导致分布式锁失效怎么办？

## 视频脚本

> 预计时长：3 分钟 | 由浅入深

| 时间 | 画面/字幕 | 口播台词 | 讲解要点 |
|------|----------|----------|----------|
| 0:00 | 标题卡 | "消息队列一句话：MQ幂等消费 就是 同一业务流水号的消息无论被投递多少次，核心业务只执行一次。实现关键是用'唯一键+去重表'做防重判断…。" | 开场钩子 |
| 0:15 | Redis Lua 脚本执行截图 | "核心方案: idempotent_key去重表 + 同一DB事务(去重检查+业务执行)" | 核心方案 |
| 1:06 | Redis Lua 脚本执行截图分步演示 | "并发控制: SELECT FOR UPDATE悲观锁 / version乐观锁" | 并发控制 |
| 1:57 | 关键代码/伪代码片段 | "状态机方案: 状态流转(PENDING到PROCESSING到SUCCESS)天然幂等" | 状态机方案 |
| 2:50 | 总结卡 | "核心抓住这条主线，下期咱们接着聊：如果Redis宕机导致分布式锁失效怎么办。" | 收尾 |
