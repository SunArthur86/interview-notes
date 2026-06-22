---
id: note-dd-sl-001
difficulty: L2
category: system-design
subcategory: 高并发
tags:
- 滴滴
- 面经
- 短链系统
- 项目经验
feynman:
  essence: 面试官通过 STAR 法则考察你对项目的全局理解和价值产出。
  analogy: 就像推销一款产品——你要说清楚为什么要做、怎么做、最后赚了多少钱。
  first_principle: 一个项目的价值 = 解决的痛点 × 技术难度 × 可量化的业务效果
  key_points:
  - 业务痛点（长URL不美观/统计困难）
  - 技术选型（发号器+Redis+分库分表）
  - 量化效果（QPS/存储量/响应时间）
first_principle:
  essence: 项目价值 = 技术方案 × 业务收益
  derivation: 长URL→短URL映射→需要发号器+存储+跳转→效果用QPS/RT/存储压缩比衡量
  conclusion: STAR 法则是回答项目题的唯一正确框架
follow_up:
- 项目最大的技术挑战是什么？
- 如果重新做你会怎么改进？
- 这个项目的用户量级是多少？
---

# 【滴滴面经】做短链项目的出发点是什么？用了哪些技术？最后达到了什么效果？

## 一、Situation（业务背景与痛点）

### 1.1 为什么要做短链系统

在营销推广和用户触达场景中，长 URL 存在以下核心痛点：

| 痛点维度 | 具体表现 | 业务影响 |
|---------|---------|---------|
| **成本问题** | 长 URL 平均 80+ 字符，短信按 70 字符/条计费，一条营销短信可能因 URL 过长被拆成多条 | 短信营销成本显著增加 |
| **用户体验** | 长 URL 在微信、微博等平台显示不美观，携带大量参数，用户信任度低 | 点击转化率下降 |
| **数据统计** | 无法精确统计每个推广链接的点击量、来源渠道、设备、地域等维度 | 无法量化推广效果和 ROI |
| **链接管理** | 运营人员创建的推广链接分散各处，无法统一管控生命周期 | 链接失效无人感知、错误跳转风险 |
| **安全合规** | 长 URL 可能携带敏感参数，容易被篡改或泄露信息 | 合规风险 |

### 1.2 需求规模评估

- 日活短链量：百万级新增
- 读 QPS 峰值预估：3 万+
- 写 QPS 峰值预估：2000+
- 存储规模预估：亿级短链映射记录
- 响应时间要求：P99 < 20ms

---

## 二、Task（技术目标）

设计一个**高可用、高性能、可扩展**的短链系统，核心要求：

1. **短码唯一**：生成全局唯一的短码，无碰撞
2. **高 QPS**：跳转接口承受 3 万+ QPS
3. **低延迟**：缓存命中时 RT < 10ms
4. **高可用**：系统可用性 99.99%
5. **可扩展**：支持水平扩容

---

## 三、Action（技术选型与架构设计）

### 3.1 整体架构

```
                      ┌──────────────┐
                      │   Nginx LB   │
                      └──────┬───────┘
                             │
              ┌──────────────┼──────────────┐
              │              │              │
       ┌──────▼──────┐ ┌─────▼─────┐ ┌──────▼──────┐
       │ ShortLink   │ │ ShortLink │ │ ShortLink   │
       │ Service #1  │ │ Service#2 │ │ Service #3  │
       └──────┬──────┘ └─────┬─────┘ └──────┬──────┘
              │              │              │
              └──────────────┼──────────────┘
                             │
                ┌────────────┼────────────┐
                │                         │
         ┌──────▼──────┐          ┌───────▼───────┐
         │ Redis Cluster│          │  MySQL Cluster │
         │ (缓存热点)   │          │  (持久化存储)  │
         │ 3主3从       │          │  分库分表      │
         └─────────────┘          └───────────────┘
                │
         ┌──────▼──────┐
         │  发号器服务  │
         │ (号段模式)   │
         └─────────────┘
```

### 3.2 发号器方案（核心组件）

发号器是短链系统的"心脏"，负责生成**全局唯一、趋势递增**的 ID。我们采用**号段模式（Segment）**，设计思路参考美团 Leaf-Segment。

**号段模式核心原理：**

```
┌──────────────────────────────────────────────────┐
│               号段表 (id_segment)                  │
│  biz_tag     | max_id | step | description       │
│  short_link  | 2000   | 1000 | 短链发号器         │
└──────────────────────────────────────────────────┘

服务启动或号段用完时，向 DB 申请下一段：
  UPDATE id_segment SET max_id = max_id + step WHERE biz_tag = 'short_link';
  → 获得 [2000, 3000) 号段
  → 内存中用 AtomicLong 从 2000 递增到 2999
  → 号段耗尽后再向 DB 申请新号段
```

**关键技术对比——为什么选号段模式？**

| 方案 | 优点 | 缺点 | 是否采用 |
|------|------|------|---------|
| UUID | 无中心化、实现简单 | 无序、太长(36字符)、索引效率差 | ❌ |
| 数据库自增 ID | 简单、有序 | 单点瓶颈、每次发号一次 DB 请求 | ❌ |
| 雪花算法 Snowflake | 分布式、有序、无 DB 依赖 | 依赖时钟同步、时钟回拨问题 | ✅ 备选降级方案 |
| **号段模式 Segment** | **高性能(DB压力降低千倍)、趋势递增** | DB短暂不可用时无法发号 | **✅ 主方案** |

> 号段模式将 DB 压力从"每次发号一次 DB 请求"降低到"每 1000 次发号一次 DB 请求"，**DB 压力降低 1000 倍**。

**双 Buffer 优化：** 当前号段消耗到 10% 时，异步线程预加载下一个号段，确保发号不中断。

### 3.3 Base62 编码

发号器生成的是 10 进制 `long` 型数字（如 `1234567890L`），需转换为更短的可读字符串。

**Base62 编码字符表：**

```
0-9（10个）+ a-z（26个）+ A-Z（26个）= 62 个字符
```

**容量估算：**

| 短码位数 | 容量 | 说明 |
|---------|------|------|
| 5 位 | 62⁵ ≈ 9.16 亿 | 中小型业务够用 |
| **6 位** | **62⁶ ≈ 568 亿** | **绝大多数业务足够** |
| 7 位 | 62⁷ ≈ 3.5 万亿 | 超大规模 |

**编码核心代码：**

```java
public class Base62 {

    private static final String CHARS =
        "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";

    private static final int RADIX = 62;

    /**
     * 将发号器 long 型 ID 编码为 Base62 短码
     * 示例: 1234567890L → "1eLEwA"
     */
    public static String encode(long num) {
        if (num == 0) return "0";
        StringBuilder sb = new StringBuilder();
        while (num > 0) {
            sb.insert(0, CHARS.charAt((int) (num % RADIX)));
            num /= RADIX;
        }
        return sb.toString();
    }

    /**
     * 将 Base62 短码解码为 long 型 ID（调试/反向查询用）
     */
    public static long decode(String str) {
        long result = 0;
        for (int i = 0; i < str.length(); i++) {
            result = result * RADIX + CHARS.indexOf(str.charAt(i));
        }
        return result;
    }
}
```

### 3.4 Redis + MySQL 分层存储架构

```
读请求路径：

  请求 → ① Redis 缓存 → 命中 → 直接返回长 URL
                         │
                         ↓ 未命中
                    ② MySQL 查询 → 回写 Redis（设置 TTL）→ 返回
```

**MySQL 分库分表策略：**

- 分片键：`short_code` 的 hash 值
- 规模：4 库 × 8 表 = 32 张物理表
- 路由：`database = hash(short_code) % 4`，`table = hash(short_code) / 4 % 8`

```sql
CREATE TABLE short_link_0 (
    id           BIGINT       PRIMARY KEY           COMMENT '发号器全局ID',
    short_code   VARCHAR(10)  NOT NULL UNIQUE       COMMENT 'Base62短码',
    long_url     TEXT         NOT NULL              COMMENT '原始长URL',
    app_id       VARCHAR(32)  NOT NULL              COMMENT '业务应用标识',
    status       TINYINT      DEFAULT 1             COMMENT '1有效 0失效',
    expire_time  DATETIME     DEFAULT NULL          COMMENT '过期时间',
    create_time  DATETIME     DEFAULT CURRENT_TIMESTAMP,
    update_time  DATETIME     DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_short_code (short_code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='短链映射表';
```

### 3.5 写入流程（创建短链）

```java
@Service
public class ShortLinkService {

    @Autowired private IdGenerator idGenerator;
    @Autowired private ShortLinkMapper shortLinkMapper;
    @Autowired private StringRedisTemplate redisTemplate;

    public String createShortLink(String longUrl, String appId) {
        // 1. 发号器获取全局唯一 ID
        long id = idGenerator.nextId("short_link");
        // 2. Base62 编码生成短码
        String shortCode = Base62.encode(id);
        // 3. 写入 MySQL
        ShortLinkDO link = new ShortLinkDO(id, shortCode, longUrl, appId);
        shortLinkMapper.insert(link);
        // 4. 写入 Redis 缓存（TTL 7天）
        redisTemplate.opsForValue().set(
            "sl:" + shortCode, longUrl, 7, TimeUnit.DAYS
        );
        return shortCode;
    }
}
```

---

## 四、Result（量化效果）

| 指标 | 优化前（直连 DB） | 优化后（Redis + MySQL） | 提升 |
|------|------------------|----------------------|------|
| **读 QPS** | ~2,000 | ~30,000+ | **15 倍** |
| **P99 响应时间** | ~50ms | < 15ms | **3.3 倍** |
| **缓存命中率** | — | 96%+ | — |
| **短码长度** | 长 URL 平均 80 字符 | 6~7 字符 | **压缩比 ~12:1** |
| **短信营销成本** | 基准 | 降低约 35% | **显著降本** |
| **系统可用性** | — | 99.99% | — |

**关键数据解读：**

- **Redis 单节点 QPS** 约 10 万，3 主 3 从集群理论 QPS 约 30 万，实际限流在 3 万级保证稳定性
- **缓存命中率 96%** 意味着仅 4% 请求回源 MySQL，DB 实际 QPS 约 1200，远在安全水位
- **短链 6~7 字符 vs 长 URL 80 字符**，在短信场景中每条消息节省约 73 字符，显著减少短信拆条

---

## 五、面试追问准备

### 5.1 项目最大的技术挑战是什么？

**发号器的高可用问题。** 号段模式依赖 DB，DB 故障时无法发号。解决方案：

1. **双 Buffer 预加载**：当前号段消耗到 10% 时，异步预加载下一个号段，保证平滑切换
2. **降级方案**：DB 不可用时，自动切换到雪花算法（Snowflake）兜底，等 DB 恢复后切回

### 5.2 如果重新做会怎么改进？

1. **引入布隆过滤器**：拦截不存在的短码请求，防止缓存穿透打穿 DB
2. **CDN 边缘缓存**：对 301 永久跳转的短链，在 CDN 层缓存，减少回源请求
3. **多级缓存**：本地缓存（Caffeine，1ms）→ Redis（3ms）→ MySQL（10ms）
4. **短码预生成池**：提前批量生成短码放入池中，写入时直接分配，进一步降低写入延迟

### 5.3 用户量级

- 日新增短链：百万级
- 总存储量：亿级映射记录
- 累计日均点击量：千万级

---

## 六、总结

短链系统的核心价值链路：

```
业务痛点 (长URL成本高/不可统计)
        ↓
技术方案 (发号器 + Base62 + Redis + MySQL分库分表)
        ↓
量化效果 (QPS ↑15倍, RT ↓3倍, 成本 ↓35%)
```

> **面试技巧：** STAR 法则的精髓是 **Why（为什么做）→ How（怎么做）→ What results（效果如何）**。每个环节都要有数据支撑，让面试官感受到你对项目的全局掌控力和量化思维。
