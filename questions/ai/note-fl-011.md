---
id: note-fl-011
difficulty: L3
category: ai
subcategory: 中间件
tags:
- 字节
- 飞连
- 面经
- Redis
- 过期策略
- 淘汰策略
feynman:
  essence: Redis Key 过期不会立刻删——用惰性删除（下次访问才检查）+ 定期删除（每100ms抽样）组合。内存淘汰策略 8 种 maxmemory-policy：noeviction(默认不删)/allkeys-lru/allkeys-lfu/allkeys-random/volatile-lru/volatile-lfu/volatile-random/volatile-ttl。Agent 会话状态选 allkeys-lru 或 volatile-lru——会话本身有时效性，LRU 自然把最久没碰的踢掉。
  analogy: 过期像家里的过期食品——你不会每秒检查每包（太累），而是偶尔翻冰箱（定期删除）+ 拿起来要吃时才看保质期（惰性删除）。淘汰像衣柜满了——丢最久没穿的（LRU）、丢最不常穿的（LFU）、随机丢（random）、按保质期丢（ttl）。
  first_principle: Redis 是内存数据库，内存有限。过期是"主动声明"，淘汰是"被动应对"。两者协同保证 Redis 既不存垃圾也不爆内存。
  key_points:
  - '过期不立刻删：惰性删除(访问时检查) + 定期删除(每100ms抽样) 组合'
  - '8 种淘汰策略：noeviction / allkeys-{lru,lfu,random} / volatile-{lru,lfu,random,ttl}'
  - 'volatile-* 只淘汰设了 TTL 的 key；allkeys-* 淘汰所有'
  - 'LRU 近似（采样N个淘汰最久未用），LFU 按访问频率'
  - 'Agent 会话状态选 allkeys-lru 或 volatile-lru'
first_principle:
  essence: 过期(主动声明) + 淘汰(被动应对) = 内存可控
  derivation: 内存有限 → 必须有机制回收 → 过期是用户主动声明"可删" → 淘汰是 Redis 被动应对"满了得删谁" → 两者协同
  conclusion: 过期策略决定"什么时候删已声明的"，淘汰策略决定"满了删谁"——两个不同问题
follow_up:
- LRU 是严格 LRU 吗？为什么用近似？
- LFU 怎么实现的？衰减机制是什么？
- Agent 会话状态选 volatile-lru 还是 allkeys-lru？
---

# 【字节飞连面经】Redis 过期删除策略 + 内存淘汰策略：Key 过期会立刻删吗？

## 一、Key 过期会立刻删吗？不会

Redis 用 **惰性删除 + 定期删除** 组合：

```
惰性删除：
  下次访问这个 key 时才检查 → 过期就删
  优点：CPU 友好（不主动扫描）
  缺点：过期但永不访问的 key 会占内存（靠定期删除兜底）

定期删除：
  每 100ms 抽样若干个有 TTL 的 key 检查
  过期的删掉
  如果过期 key 比例超过 25%，继续抽样（自适应）
```

**为什么不全量扫描**：百万级 key 全扫一次会阻塞 Redis（单线程）。抽样 + 自适应是性能和准确性的折中。

## 二、内存淘汰策略 8 种（maxmemory-policy）

| 策略 | 范围 | 算法 |
|------|------|------|
| `noeviction` | - | 默认，满了直接报错（写操作失败） |
| `allkeys-lru` | 所有 key | 最久未使用 |
| `allkeys-lfu` | 所有 key | 最少使用频率 |
| `allkeys-random` | 所有 key | 随机 |
| `volatile-lru` | 设了 TTL 的 key | 最久未使用 |
| `volatile-lfu` | 设了 TTL 的 key | 最少使用频率 |
| `volatile-random` | 设了 TTL 的 key | 随机 |
| `volatile-ttl` | 设了 TTL 的 key | TTL 最短（最快过期） |

**volatile-*** 只淘汰设了 TTL 的 key（保护持久数据）；**allkeys-*** 淘汰所有。

## 三、Agent 会话状态选什么

**选 `allkeys-lru` 或 `volatile-lru`**：

- 会话状态本身就设了 TTL（30 min）
- 会话本身有时效性——最久没碰的会话最可能已经结束
- LRU 自然把"僵尸会话"踢掉，保留活跃会话

**为什么不用 LFU**：会话状态访问频率不是"价值"信号（一个刚启动的会话访问少不代表不重要）。

## 四、LRU 是严格 LRU 吗？不是，是近似

Redis 的 LRU 是**近似 LRU**：
- 不维护全局双向链表（内存开销大）
- 淘汰时**采样 N 个 key**（`maxmemory-samples`，默认 5），从 N 个里选最久未用的
- N 越大越接近严格 LRU，但 CPU 开销越大

**Redis 4.0 引入 LFU**：按访问频率淘汰，更适合"热点数据"场景。LFU 有衰减机制（长期不访问频率会降），避免历史热点永远占内存。

## 五、加分点

- 说出 **noeviction 是默认**，但生产环境几乎没人用（满了就写失败）
- 说出 **volatile-ttl** 适合"缓存"场景（最快过期的先踢，延长其他缓存寿命）

## 六、扩展

- **持久化与过期的交互**：RDB 快照不存已过期的 key；AOF 写入时会检查过期
- **主从复制的过期**：从节点不主动删过期 key（等主节点 DEL 命令同步），导致从节点可能读到"过期但未删"的数据——读到后惰性删除
- **Redis 7.0** 的多线程 I/O 对过期策略无影响（过期逻辑仍在主线程）
