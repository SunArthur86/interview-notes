---
id: note-tsl-004
difficulty: L4
category: system-design
subcategory: 分布式
tags:
- 特斯拉
- 充电桩
- 调度算法
- 地理空间
- 实时计算
feynman:
  essence: 数万充电桩实时调度的本质是"空间搜索+资源分配"问题。核心：用GeoHash/Redis GEO快速找到附近的空闲桩，用调度算法（贪心/二分匹配）实现就近分配+负载均衡。
  analogy: 像打车软件派单——用户发出充电请求，系统像"调度中心"一样在地图上找最近的空闲充电桩（打车找最近的车），同时考虑排队人数和电价，推荐最优选择。
  key_points:
  - Redis GEO实现O(logN)附近搜索
  - 实时状态通过MQ/长连接同步
  - 调度算法兼顾距离和负载均衡
  - 预约锁防超分配
  - 数据多级缓存降DB压力
first_principle:
  essence: 充电桩调度 = 空间索引（找最近） + 状态管理（查空闲） + 分配策略（做决策）。空间索引是O(N)暴力搜索的瓶颈，必须用空间数据结构（GeoHash/R-Tree）降到O(logN)。
  derivation: 全球数万充电桩，假设单城市1000个。用户请求时遍历1000个桩查距离=O(1000)，加上状态过滤和排序，单请求需10ms+。用Redis GEO的GEORADIUS，降到O(logN)≈0.1ms。
  conclusion: 架构 = Redis GEO空间索引 + 实时状态WebSocket/MQ同步 + 调度算法(距离权重+负载权重) + 分布式锁防超分配。
follow_up:
- 多个用户同时抢占同一个充电桩怎么办？
- 充电桩离线如何快速感知？
- 如何在用电高峰期做动态电价？
- 如何提升偏远地区充电桩利用率？
---

# 全球数万座充电桩实时调度，如何设计后端架构，实现用户就近分配充电桩，提升充电桩整体利用率？

## 🎯 本质

```
输入：用户位置(lat,lng) + 充电需求(功率/时长)
处理：空间搜索(附近桩) + 状态过滤(空闲?) + 调度决策(推荐哪个)
输出：推荐充电桩列表 + 预估等待时间 + 实时电价
```

---

## 🧒 类比

把充电桩调度想象成一个**智能停车场引导系统**：
1. 车辆到达入口 → 系统扫描全停车场（空间搜索）
2. 显示哪些区域有空位（状态过滤）
3. 推荐"最近+最空闲"的区域（调度决策）
4. 到达前自动预约一个车位（防超分配）

---

## 📊 整体架构图

```
┌──────────────────────────────────────────────────────────────┐
│                     车辆 App / 车机端                          │
│           发送位置 + 充电需求 → 接收推荐列表                     │
└────────────────────────┬─────────────────────────────────────┘
                         │ HTTPS / WebSocket
┌────────────────────────▼─────────────────────────────────────┐
│                      API 网关层                                │
│              鉴权 / 限流 / 请求路由                             │
└────────────────────────┬─────────────────────────────────────┘
                         │
┌────────────────────────▼─────────────────────────────────────┐
│                    充电调度服务                                │
│  ┌─────────────┐  ┌──────────────┐  ┌──────────────────┐   │
│  │ 空间搜索模块 │  │ 状态管理模块  │  │ 调度算法模块      │   │
│  │ Redis GEO   │  │ 桩实时状态    │  │ 距离+负载+电价    │   │
│  └─────────────┘  └──────────────┘  └──────────────────┘   │
└──────┬──────────────────┬───────────────────┬───────────────┘
       │                  │                   │
┌──────▼──────┐  ┌───────▼────────┐  ┌──────▼──────────┐
│ Redis GEO   │  │   Kafka/MQ     │  │  MySQL          │
│ 桩坐标+状态  │  │ 桩状态变更流    │  │ 桩元数据/历史    │
│ GEORADIUS   │  │ 实时心跳上报    │  │ 分库分表         │
└─────────────┘  └────────────────┘  └─────────────────┘
       │
┌──────▼──────────────────────────────────────────────────────┐
│              IoT 网关 (数万充电桩心跳上报)                      │
│   桩状态: idle/charging/fault/offline → Kafka → 状态服务      │
└──────────────────────────────────────────────────────────────┘
```

---

## 🔧 详解

### 1. Redis GEO 空间索引（核心）

```bash
# 初始化：将充电桩坐标写入 Redis GEO
GEOADD chargers:region:us  -122.0312 37.3318 "station_001"
GEOADD chargers:region:us  -122.0421 37.3325 "station_002"
# ...

# 搜索：找附近 5km 内的充电桩，按距离排序
GEOSEARCH chargers:region:us
  FROMLONLAT -122.0312 37.3318
  BYRADIUS 5 km
  ASC                     # 按距离升序
  COUNT 20                # 最多返回20个
  WITHCOORD WITHDIST      # 返回坐标和距离
```

### 2. 充电桩实时状态管理

```java
// 桩状态数据模型
public enum ChargerStatus {
    IDLE,       // 空闲可用
    OCCUPIED,   // 被占用（正在充电）
    RESERVED,   // 已预约
    FAULT,      // 故障
    OFFLINE     // 离线
}

// 状态同步：充电桩通过IoT网关上报心跳
@Service
public class ChargerStatusService {

    // 心跳超时检测：30s无心跳 → 标记OFFLINE
    @Scheduled(fixedRate = 10000)
    public void checkHeartbeat() {
        long threshold = System.currentTimeMillis() - 30_000;
        // 扫描Redis中所有桩的最后心跳时间
        Set<String> staleChargers = redis.zrangeByScore(
            "chargers:heartbeat", 0, threshold
        );
        for (String chargerId : staleChargers) {
            updateStatus(chargerId, ChargerStatus.OFFLINE);
            alertService.send("充电桩离线: " + chargerId);
        }
    }

    // 状态写入Redis（实时查询用）+ MySQL（持久化用）
    public void updateStatus(String chargerId, ChargerStatus status) {
        // Redis: Hash存储实时状态
        redis.opsForHash().put("chargers:status", chargerId, status.name());
        // Redis: 按状态分集合，加速过滤
        if (status == ChargerStatus.IDLE) {
            redis.opsForSet().add("chargers:idle", chargerId);
        } else {
            redis.opsForSet().remove("chargers:idle", chargerId);
        }
    }
}
```

### 3. 调度算法（距离 + 负载 + 电价）

```java
@Service
public class ChargerDispatchService {

    public List<ChargerRecommendation> recommend(
            double lat, double lng, double powerKW) {

        // ① Redis GEO 搜索附近 10km 桩
        List<GeoResult> nearby = redis.geoSearch(
            "chargers:region", lat, lng, 10, KM, 50
        );

        // ② 过滤：只保留空闲桩 + 功率匹配
        List<ChargerInfo> candidates = nearby.stream()
            .filter(g -> getStatus(g.getId()) == IDLE)
            .filter(g -> getPower(g.getId()) >= powerKW)
            .collect(toList());

        // ③ 综合评分排序
        return candidates.stream()
            .map(c -> score(c, lat, lng))
            .sorted(Comparator.comparingDouble(ChargerRecommendation::getScore).reversed())
            .limit(10)
            .collect(toList());
    }

    // 综合评分 = 距离分 × 0.5 + 负载分 × 0.3 + 电价分 × 0.2
    private ChargerRecommendation score(ChargerInfo c, double lat, double lng) {
        double distScore = 1.0 / (1 + c.getDistanceKm());  // 越近分越高
        double loadScore = 1.0 - c.getQueueCount() * 0.2;  // 排队少分高
        double priceScore = 1.0 / (1 + c.getPricePerKWh()); // 电价低分高

        double total = distScore * 0.5 + loadScore * 0.3 + priceScore * 0.2;
        return new ChargerRecommendation(c, total, distScore, loadScore, priceScore);
    }
}
```

### 4. 防超分配：预约锁

```java
// 用户选择充电桩后，发起预约（15分钟内有效）
@Service
public class ReservationService {

    public ReserveResult reserve(String userId, String chargerId) {
        String lockKey = "charger:reserve:" + chargerId;

        // ① 分布式锁（Redisson），防多用户同时预约同一桩
        RLock lock = redisson.getLock(lockKey);
        if (!lock.tryLock()) {
            return ReserveResult.fail("该充电桩正在被预约，请稍后重试");
        }

        try {
            // ② 检查状态是否仍为空闲
            ChargerStatus status = getStatus(chargerId);
            if (status != ChargerStatus.IDLE) {
                return ReserveResult.fail("充电桩已被占用");
            }

            // ③ 预约：状态改为 RESERVED，设置15分钟超时
            updateStatus(chargerId, ChargerStatus.RESERVED);
            redis.setex("reserve:" + chargerId, 900, userId);

            // ④ 发送延迟消息：15分钟后自动释放
            mq.sendDelay("reserve-timeout", chargerId, 15, TimeUnit.MINUTES);

            return ReserveResult.success(chargerId);
        } finally {
            lock.unlock();
        }
    }
}
```

---

## 💻 数据模型 + 利用率分析

```sql
-- 充电桩元数据
CREATE TABLE charger_station (
    id              VARCHAR(32) PRIMARY KEY,
    name            VARCHAR(128),
    lat             DECIMAL(10, 7),
    lng             DECIMAL(10, 7),
    power_kw        INT,              -- 充电功率
    connector_type  VARCHAR(16),      -- CCS/NACS/Tesla
    region          VARCHAR(32),
    price_per_kwh   DECIMAL(6, 2)
);

-- 充电会话记录（用于利用率分析）
CREATE TABLE charging_session (
    id              BIGINT AUTO_INCREMENT PRIMARY KEY,
    charger_id      VARCHAR(32) NOT NULL,
    user_id         BIGINT NOT NULL,
    start_time      TIMESTAMP,
    end_time        TIMESTAMP,
    energy_kwh      DECIMAL(10, 2),
    cost            DECIMAL(10, 2),
    INDEX idx_charger_time (charger_id, start_time)
);
```

```java
// 利用率分析：每小时统计各桩使用率
@Scheduled(cron = "0 0 * * * ?")
public void calculateUtilization() {
    // 利用率 = 充电时长 / 总时长
    // 目标：提升整体利用率 > 60%
    String sql = """
        SELECT charger_id,
               SUM(TIMESTAMPDIFF(MINUTE, start_time, end_time)) / 60.0 as hours_used
        FROM charging_session
        WHERE start_time >= DATE_SUB(NOW(), INTERVAL 1 HOUR)
        GROUP BY charger_id
        """;
    // 将利用率写入Redis，供调度算法参考
    // 低利用率桩 → 调度算法提升权重，引导用户前往
}
```

---

## ❓ 发散追问

### Q1：多个用户同时抢占同一个充电桩怎么办？

1. **分布式锁**：Redisson 互斥锁，同一时刻只有一个请求能修改桩状态
2. **状态机校验**：预约前必须检查状态 == IDLE，用 Lua 脚本保证原子性
3. **乐观锁**：CAS 更新（`UPDATE ... WHERE status='IDLE' AND version=?`）

### Q2：如何在用电高峰期做动态电价？

- **实时电价引擎**：基于电网负荷数据，峰时加价、谷时降价
- **Redis 缓存电价**：每15分钟更新一次，毫秒级查询
- **引导调度**：低价时段调度算法提升该桩权重，吸引用户错峰充电

### Q3：如何提升偏远地区充电桩利用率？

1. **动态折扣**：低利用率桩自动降价，通过 App 推送优惠
2. **路径规划引导**：长途出行时推荐沿途充电站
3. **超充网络规划**：基于历史充电数据优化选址
