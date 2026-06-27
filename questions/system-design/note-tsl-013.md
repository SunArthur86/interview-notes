---
id: note-tsl-013
difficulty: L3
category: system-design
subcategory: 高并发
tags:
- 特斯拉
- 物流跟踪
- 实时推送
- 异常预警
feynman:
  essence: 物流跟踪的核心是"多源数据聚合+实时状态推送+异常预警"。从工厂→运输→交付中心的每个节点状态实时采集，聚合后推送给用户，超时/偏离等异常自动告警。
  analogy: 像外卖配送跟踪——餐厅出餐（工厂生产）→骑手取餐（装车运输）→送到楼下（到达交付中心）→你确认收货（提车）。每一步App上都能看到实时位置和预估时间。
  key_points:
  - 物流节点状态机(生产→运输→中转→交付)
  - 多承运商API数据聚合
  - 实时推送(WebSocket/SSE)
  - 异常预警(超时/偏离/延误)
  - 全球多时区/多语言
first_principle:
  essence: 物流跟踪 = 状态采集(货物在哪) + 信息聚合(展示给谁) + 异常检测(有没有问题)。采集是多源API轮询/回调，聚合是数据清洗+状态合并，异常是规则+预测。
  derivation: 全球数万订单在途，每个经过5-8个物流节点。承运商有数十家（船运/铁路/卡车），API格式各异。需要统一的数据接入层适配各家API，用状态机管理标准化的物流节点流转。
  conclusion: 架构 = 多源数据接入(承运商适配) + 状态机(节点流转) + 实时推送 + 异常规则引擎 + 全球化适配。
follow_up:
- 承运商API不稳定/延迟大怎么办？
- 如何精确预估到货时间？
- 海关清关延误如何预警和处理？
- 如何防止物流信息被篡改？
---

# 全球数万笔车辆订单物流实时跟踪，如何设计后端架构，支持物流节点更新、异常预警与轨迹查询？

## 🎯 本质

```
物流跟踪 = 采集(承运商数据) → 聚合(统一状态) → 推送(用户通知) → 预警(异常检测)
```

| 维度 | 挑战 | 方案 |
|------|------|------|
| **数据采集** | 数十家承运商API各异 | 适配器模式 + 定时轮询/回调 |
| **状态管理** | 物流节点多且复杂 | 统一状态机 + 事件驱动 |
| **实时推送** | 用户要实时看到进度 | WebSocket + SSE |
| **异常预警** | 延误/丢失需及时发现 | 规则引擎 + 预测模型 |

---

## 🧒 类比

把物流跟踪想象成**快递公司包裹追踪**：
1. **寄件**（工厂下线）：包裹发出，拿到快递单号
2. **揽收**（装车运输）：快递员取走包裹
3. **中转**（港口/铁路中转）：经过分拣中心
4. **派送**（到达交付中心）：快递员出发送货
5. **签收**（用户提车）：你签收包裹

每一步App上都能看到，超时了自动催单。

---

## 📊 整体架构图

```
┌──────────────────────────────────────────────────────────────────┐
│              多源数据接入层 (承运商适配器)                          │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐       │
│  │ 海运API   │  │ 铁路API   │  │ 卡车API   │  │ 港口API   │       │
│  │(马士基等) │  │(DB等)    │  │(FedEx等) │  │(各港口)  │       │
│  └─────┬────┘  └─────┬────┘  └─────┬────┘  └─────┬────┘       │
│        └─────────────┼─────────────┼─────────────┘              │
│                统一适配 → Kafka                                    │
└──────────────────────┬───────────────────────────────────────────┘
                       │
┌──────────────────────▼───────────────────────────────────────────┐
│              物流状态处理引擎                                       │
│  ┌──────────────┐  ┌──────────────┐  ┌────────────────┐       │
│  │ 状态机管理    │  │ 数据清洗      │  │ ETA预测引擎     │       │
│  │ 生产→运输→   │  │ 去重/合并/   │  │ 基于历史数据    │       │
│  │ 中转→交付    │  │ 时序排序      │  │ 预估到货时间    │       │
│  └──────────────┘  └──────────────┘  └────────────────┘       │
└──────┬────────────────────────────────┬─────────────────────────┘
       │                                │
┌──────▼──────────┐           ┌────────▼──────────────────────────┐
│  实时推送服务     │           │         异常预警引擎               │
│  WebSocket/SSE   │           │  超时预警 / 偏离路线 / 清关延误    │
│  App推送通知      │           │  规则匹配 → 告警 → 客服介入       │
└─────────────────┘           └───────────────────────────────────┘
```

---

## 🔧 详解

### 1. 物流状态机

```java
// 统一的物流节点状态枚举
public enum LogisticsStage {
    ORDER_CONFIRMED(1, "订单确认"),
    IN_PRODUCTION(2, "生产中"),
    PRODUCTION_COMPLETE(3, "生产完成"),
    LOADING(4, "装车待运"),
    IN_TRANSIT_SEA(5, "海运中"),
    IN_TRANSIT_RAIL(6, "铁路运输中"),
    IN_TRANSIT_TRUCK(7, "公路运输中"),
    AT_PORT(8, "到港"),
    CUSTOMS_CLEARANCE(9, "清关中"),
    AT_DELIVERY_CENTER(10, "到达交付中心"),
    READY_FOR_PICKUP(11, "待提车"),
    DELIVERED(12, "已交付");

    public final int order;
    public final String label;
}

// 状态流转服务
@Service
public class LogisticsStateMachine {

    public void transition(String orderId, LogisticsStage newStage, LocationInfo loc) {
        OrderLogistics logistics = getLogistics(orderId);
        LogisticsStage current = logistics.getCurrentStage();

        // 校验状态流转合法性（不能跳过步骤）
        if (newStage.order <= current.order) {
            log.warn("非法状态回退: {} -> {}", current, newStage);
            return;
        }

        // 更新状态
        logistics.setCurrentStage(newStage);
        logistics.setLocation(loc);
        logistics.setUpdatedAt(LocalDateTime.now());

        // 记录节点历史
        logistics.addHistory(new StageHistory(newStage, loc, Instant.now()));

        // 发布状态变更事件
        eventBus.publish(new LogisticsStageChangedEvent(orderId, current, newStage, loc));
    }
}
```

### 2. 承运商数据适配器

```java
// 适配器模式：统一不同承运商API
public interface CarrierAdapter {
    String getCarrierCode();
    List<TrackingEvent> queryTracking(String trackingNumber);
    boolean supportsWebhook();
}

@Component
public class MaerskAdapter implements CarrierAdapter {
    public String getCarrierCode() { return "MAERSK"; }

    // 定时轮询海运状态
    public List<TrackingEvent> queryTracking(String trackingNumber) {
        MaerskResponse resp = maerskClient.getTracking(trackingNumber);
        // 转换为统一的TrackingEvent格式
        return resp.getEvents().stream()
            .map(e -> new TrackingEvent(
                mapToStage(e.getEventType()),  // 映射到统一状态
                new LocationInfo(e.getPort(), e.getLat(), e.getLng()),
                e.getTimestamp(),
                e.getDescription()
            ))
            .collect(toList());
    }
}

// 定时轮询调度器
@Scheduled(fixedRate = 300000) // 每5分钟轮询一次
public void pollAllCarriers() {
    List<ActiveShipment> active = shipmentMapper.findActiveShipments();
    for (ActiveShipment ship : active) {
        CarrierAdapter adapter = adapterFactory.get(ship.getCarrierCode());
        List<TrackingEvent> events = adapter.queryTracking(ship.getTrackingNo());
        events.forEach(e -> logisticsStateMachine.processEvent(ship.getOrderId(), e));
    }
}
```

### 3. 实时推送服务

```java
@Service
public class LogisticsPushService {

    @EventListener
    public void onStageChanged(LogisticsStageChangedEvent event) {
        String userId = getOwnerByOrder(event.getOrderId());

        // ① WebSocket实时推送（用户正在看App）
        wsService.sendToUser(userId, Map.of(
            "type", "logistics_update",
            "orderId", event.getOrderId(),
            "stage", event.getNewStage().name(),
            "stageLabel", event.getNewStage().getLabel(),
            "location", event.getLocation(),
            "eta", calculateETA(event)
        ));

        // ② 关键节点App推送通知
        if (isKeyMilestone(event.getNewStage())) {
            pushService.send(userId, PushMessage.builder()
                .title("🚗 订单状态更新")
                .body(event.getNewStage().getLabel())
                .data(Map.of("orderId", event.getOrderId()))
                .build());
        }

        // ③ 更新Redis缓存（供查询用）
        redis.opsForValue().set(
            "logistics:latest:" + event.getOrderId(),
            JSON.toJSONString(event),
            7, TimeUnit.DAYS
        );
    }

    private boolean isKeyMilestone(LogisticsStage stage) {
        return stage == PRODUCTION_COMPLETE
            || stage == IN_TRANSIT_SEA
            || stage == AT_DELIVERY_CENTER
            || stage == READY_FOR_PICKUP;
    }
}
```

### 4. 异常预警引擎

```java
@Service
public class LogisticsAlertEngine {

    // 规则1: 节点超时预警
    @Scheduled(cron = "0 0 * * * ?") // 每小时检查
    public void checkTimeoutAlerts() {
        List<OrderLogistics> inTransit = logisticsMapper.findInTransit();

        for (OrderLogistics logi : inTransit) {
            Duration elapsed = Duration.between(
                logi.getStageStartTime(), Instant.now()
            );
            Duration expected = getExpectedDuration(logi.getCurrentStage());

            if (elapsed.toHours() > expected.toHours() * 1.5) {
                // 超过预期时间1.5倍 → 预警
                alertService.send(LogisticsAlert.builder()
                    .orderId(logi.getOrderId())
                    .type("STAGE_TIMEOUT")
                    .severity("WARNING")
                    .message("物流节点超时: " + logi.getCurrentStage()
                        + " 已停留 " + elapsed.toHours() + "h"
                        + " 预期 " + expected.toHours() + "h")
                    .build());
            }
        }
    }

    // 规则2: 清关延误专项预警
    @Scheduled(cron = "0 0 */2 * * ?") // 每2小时检查
    public void checkCustomsDelay() {
        List<OrderLogistics> customs = logisticsMapper.findByStage(CUSTOMS_CLEARANCE);
        for (OrderLogistics logi : customs) {
            long hoursInCustoms = Duration.between(
                logi.getStageStartTime(), Instant.now()
            ).toHours();

            if (hoursInCustoms > 72) {
                // 清关超72小时 → 高优先级预警，客服介入
                alertService.send(LogisticsAlert.builder()
                    .orderId(logi.getOrderId())
                    .type("CUSTOMS_DELAY")
                    .severity("HIGH")
                    .message("清关延误: " + hoursInCustoms + "h")
                    .action("ASSIGN_CS")  // 分配客服处理
                    .build());
            }
        }
    }
}
```

---

## ❓ 发散追问

### Q1：承运商API不稳定/延迟大怎么办？

1. **多级缓存**：最新状态缓存Redis，历史数据在DB
2. **降级策略**：API不可用时返回最后已知状态，标注"数据可能有延迟"
3. **异步轮询**：不阻塞用户请求，后台异步更新
4. **Webhook优先**：优先用承运商主动推送（Webhook），减少轮询压力

### Q2：如何精确预估到货时间？

- **历史均值**：同航线/路线的历史平均时长
- **实时调整**：根据当前进度动态修正ETA
- **外部因素**：考虑天气/港口拥堵/节假日等因素
- **机器学习**：用历史数据训练ETA预测模型，准确率逐步提升

### Q3：海关清关延误如何预警和处理？

1. **预警**：清关超72h自动告警，超5天升级处理
2. **信息同步**：实时查询海关系统状态，推送给用户
3. **客服介入**：自动创建工单，客服联系海关/报关行跟进
4. **补偿方案**：严重延误提供补偿（如免费升级交付/积分补偿）
