---
id: note-tsl-012
difficulty: L3
category: system-design
subcategory: 分布式
tags:
- 特斯拉
- 防盗预警
- 实时计算
- IoT
- 推送系统
feynman:
  essence: 防盗预警的核心是"异常行为检测+实时告警推送+轨迹追踪"。车辆传感器数据实时流式处理，检测异常模式（非授权启动/异常移动），秒级触发告警推送给车主，同时记录GPS轨迹。
  analogy: 像智能门铃的安防功能——检测到陌生人在门口徘徊（异常检测），立刻手机弹窗告警（实时推送），同时录制视频保存证据（轨迹记录）。
  key_points:
  - 异常检测规则引擎(启动授权/移动模式)
  - 实时流处理(Kafka+Flink秒级响应)
  - 多通道告警推送(App推送/短信/电话)
  - GPS轨迹实时追踪+历史回放
  - 哨兵模式(视频录制)
first_principle:
  essence: 防盗 = 状态监控(车在做什么) + 异常判断(正不正常) + 告警响应(通知谁做什么)。监控是数据采集问题，判断是规则/模型问题，响应是通信问题。关键在于端到端延迟（异常发生到车主收到告警 < 10秒）。
  derivation: 一辆车每秒产生位置/速度/车门/车窗/IMU等数据。千万辆 → 每秒亿条消息。异常检测必须流式实时处理，不能批量。告警推送必须多通道冗余（App+短信+电话），防任一通道延迟。
  conclusion: 架构 = IoT数据流 + 规则引擎(实时异常检测) + 多通道推送 + GPS轨迹服务 + 哨兵视频。
follow_up:
- 如何区分"误报"（车主自己开走）和"真盗"？
- GPS信号被屏蔽怎么办？
- 防盗系统被黑客禁用怎么办？
- 如何协助警方追踪被盗车辆？
---

# 车辆出现异常启动、移动时触发预警，如何设计后端架构，支持预警信息实时推送、异常轨迹追踪？

## 🎯 本质

```
防盗预警流水线：
传感器数据流 → 异常检测(规则/AI) → 告警判定 → 多通道推送 → 轨迹追踪
    < 1s           < 2s              < 1s        < 5s          持续
                                        总端到端延迟 < 10s
```

---

## 🧒 类比

把防盗系统想象成**银行金库安防**：
1. **红外传感器**（车辆传感器）：时刻监控金库动静
2. **安防中心**（规则引擎）：判断是正常巡检还是异常入侵
3. **警报系统**（多通道推送）：触发警报 → 保安对讲机+电话+广播同时响
4. **监控录像**（GPS轨迹）：记录入侵者移动路径
5. **应急按钮**（远程锁车）：一键锁定金库门

---

## 📊 整体架构图

```
┌──────────────────────────────────────────────────────────────────┐
│                   车辆传感器数据流                                 │
│  GPS / IMU / 车门状态 / 点火信号 / OBD / 摄像头                   │
│         → MQTT → Kafka (实时流)                                   │
└──────────────────┬───────────────────────────────────────────────┘
                   │
┌──────────────────▼───────────────────────────────────────────────┐
│               Flink 实时流处理引擎                                 │
│  ┌──────────────────────────────────────────────────────┐       │
│  │  异常检测规则引擎                                     │       │
│  │                                                      │       │
│  │  Rule 1: 非授权手机KEY启动 → 告警                     │       │
│  │  Rule 2: 哨兵模式下检测到人/车靠近 → 告警              │       │
│  │  Rule 3: 车辆在非驾驶时段移动 → 告警                   │       │
│  │  Rule 4: 车门被撬开（OBD异常信号） → 告警              │       │
│  │  Rule 5: GPS信号突然消失 → 可疑告警                    │       │
│  │  Rule 6: 拖车检测（IMU异常加速度+无点火） → 告警       │       │
│  └──────────────────────┬───────────────────────────────┘       │
└─────────────────────────┬────────────────────────────────────────┘
                          │ 告警事件
┌─────────────────────────▼────────────────────────────────────────┐
│                   告警分发服务                                     │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────────┐   │
│  │ App推送   │  │ 短信通知  │  │ 电话通知  │  │ 远程锁车指令  │   │
│  │ (FCM/APNS)│  │ (SMS)    │  │ (自动拨号)│  │ (需用户授权)  │   │
│  └──────────┘  └──────────┘  └──────────┘  └──────────────┘   │
└─────────────────────────┬────────────────────────────────────────┘
                          │
┌─────────────────────────▼────────────────────────────────────────┐
│                   轨迹追踪服务                                     │
│  GPS轨迹 → Redis GEO (实时位置) + TDengine (历史轨迹)              │
│  哨兵视频 → S3存储 (加密) → 可回放                                  │
└──────────────────────────────────────────────────────────────────┘
```

---

## 🔧 详解

### 1. 异常检测规则引擎

```java
// Flink CEP（复杂事件处理）实现异常检测
public class TheftDetectionJob {

    public static void main(String[] args) throws Exception {
        StreamExecutionEnvironment env =
            StreamExecutionEnvironment.getExecutionEnvironment();

        // 传感器数据流
        DataStream<VehicleEvent> events = env
            .addSource(new FlinkKafkaConsumer<>(
                "vehicle-events",
                new VehicleEventSchema(),
                kafkaProps
            ));

        // 规则1: 非授权启动检测
        Pattern<VehicleEvent, ?> unauthorizedStart = Pattern
            .<VehicleEvent>begin("start")
            .where(e -> e.getType().equals("IGNITION_ON"))
            .followedBy("auth")
            .where(e -> !e.isAuthorizedKey())
            .within(Time.seconds(5));

        CEP.pattern(events, unauthorizedStart)
            .select(pattern -> {
                VehicleEvent start = pattern.get("start");
                return new AlertEvent(
                    start.getVin(),
                    "UNAUTHORIZED_START",
                    "检测到非授权钥匙启动！",
                    AlertLevel.HIGH
                );
            })
            .addSink(new AlertSink());

        // 规则2: 拖车检测（无点火但有位移）
        Pattern<VehicleEvent, ?> towing = Pattern
            .<VehicleEvent>begin("no_ignition")
            .where(e -> !e.isIgnitionOn())
            .followedBy("movement")
            .where(e -> e.getSpeed() > 5.0) // 速度>5km/h
            .timesOrMore(3)  // 连续3次
            .within(Time.minutes(1));

        CEP.pattern(events, towing)
            .select(pattern -> new AlertEvent(
                pattern.get("no_ignition").get(0).getVin(),
                "TOWING_DETECTED",
                "检测到车辆被拖拽移动！",
                AlertLevel.CRITICAL
            ))
            .addSink(new AlertSink());

        env.execute("Theft Detection");
    }
}
```

### 2. 多通道告警推送

```java
@Service
public class AlertPushService {

    @KafkaListener(topics = "vehicle-alerts")
    public void onAlert(AlertEvent alert) {
        String userId = getOwnerByVin(alert.getVin());

        // ① 并行发送多通道通知（不串行等待）
        CompletableFuture.allOf(
            pushAppNotification(userId, alert),      // App推送
            sendSMS(userId, alert),                   // 短信
            triggerPhoneCall(userId, alert)           // 电话（紧急）
        ).join();

        // ② 记录告警日志
        alertMapper.insert(alert);

        // ③ CRITICAL级别 → 自动启动轨迹追踪模式
        if (alert.getLevel() == AlertLevel.CRITICAL) {
            enableTrackingMode(alert.getVin());
            // ④ 请求车主授权远程锁车
            requestRemoteLockAuth(userId, alert.getVin());
        }
    }

    private CompletableFuture<Void> pushAppNotification(
            String userId, AlertEvent alert) {
        return CompletableFuture.runAsync(() -> {
            PushMessage msg = PushMessage.builder()
                .title("⚠️ 车辆安全警报")
                .body(alert.getMessage())
                .priority("high")  // 高优先级推送
                .data(Map.of(
                    "vin", alert.getVin(),
                    "type", alert.getType(),
                    "action", "track"  // 点击查看实时位置
                ))
                .build();
            pushService.send(userId, msg);
        });
    }
}
```

### 3. GPS 轨迹追踪

```java
@Service
public class TrajectoryService {

    // 实时位置：Redis GEO
    public void updateLocation(String vin, double lat, double lng) {
        redis.geoAdd("vehicle:location:realtime", lng, lat, vin);
        redis.expire("vehicle:location:realtime", 3600);
    }

    // 实时追踪：高频上报 + 轨迹记录
    public void enableTrackingMode(String vin) {
        // 切换为高频上报模式（正常1次/分钟 → 追踪时1次/5秒）
        mqttGateway.publish("vehicle/cmd/" + vin,
            JSON.toJSONString(Map.of(
                "action", "enable_tracking",
                "interval", 5,  // 5秒上报一次
                "duration", 3600 // 持续1小时
            ))
        );
    }

    // 历史轨迹查询
    public List<GpsPoint> getTrajectory(String vin, long startTime, long endTime) {
        // 从时序数据库查询
        return tsdbService.queryRange(
            "SELECT vin, lat, lng, speed, ts " +
            "FROM vehicle_gps " +
            "WHERE vin = ? AND ts BETWEEN ? AND ? " +
            "ORDER BY ts",
            vin, startTime, endTime
        );
    }

    // 异常轨迹分析：检测是否驶向高风险区域
    public boolean analyzeRiskTrajectory(String vin) {
        List<GpsPoint> recentPoints = getRecentTrajectory(vin, 300); // 最近5分钟
        double avgSpeed = recentPoints.stream()
            .mapToDouble(GpsPoint::getSpeed).average().orElse(0);

        // 异常行为模式：高速行驶+频繁变道 → 可能被盗后逃逸
        if (avgSpeed > 120) {
            return true;
        }
        return false;
    }
}
```

### 4. 误报过滤机制

```java
// 减少误报：结合多维度判断
@Service
public class AlertValidator {

    public boolean shouldAlert(VehicleEvent event, String vin) {
        // ① 检查是否车主本人操作
        if (isOwnerOperating(vin, event)) {
            return false;  // 车主自己开走，不告警
        }

        // ② 检查是否在已知信任地点
        if (isKnownSafeLocation(vin, event.getLat(), event.getLng())) {
            // 在家/在公司 → 降低告警灵敏度
            return isHighSeverityEvent(event);
        }

        // ③ 检查是否已开启"度假模式"（车主主动授权他人驾驶）
        if (isVacationMode(vin)) {
            VacationAuth auth = getVacationAuth(vin);
            if (auth.getAuthorizedDrivers().contains(event.getDriverId())) {
                return false;
            }
        }

        return true;
    }
}
```

---

## ❓ 发散追问

### Q1：如何区分"误报"（车主自己开走）和"真盗"？

- **数字钥匙校验**：启动时检查手机Key/卡片Key是否授权
- **行为模式分析**：行驶路线/时间/驾驶风格是否与车主习惯一致
- **信任地点**：在家/公司等已知安全地点降低告警灵敏度
- **用户确认**：告警后App弹窗"是您本人在驾驶吗？"→ 用户确认即解除

### Q2：GPS信号被屏蔽怎么办？

1. **多源定位**：GPS + 北斗 + WiFi三角定位 + 基站定位
2. **最后已知位置**：GPS消失前记录最后位置，作为搜索起点
3. **IMU推算**：用惯性导航（加速度计+陀螺仪）推算短时轨迹
4. **GPS屏蔽告警**：GPS信号突然消失 → 本身就是高可疑告警

### Q3：如何协助警方追踪被盗车辆？

- **实时位置共享**：经车主授权后，实时位置可共享给警方系统
- **历史轨迹导出**：提供被盗前后的完整GPS轨迹
- **远程锁车**：车主授权后远程限制车辆速度/锁定
- **哨兵视频**：提供车辆周围环境录像作为证据
