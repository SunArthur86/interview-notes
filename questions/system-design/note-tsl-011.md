---
id: note-tsl-011
difficulty: L4
category: system-design
subcategory: 分布式
tags:
- 特斯拉
- 储能调度
- 电网交互
- 实时控制
- IoT
feynman:
  essence: 储能调度的核心是"电网需求感知+充放电指令精准下发+状态实时反馈"。系统根据电网负荷信号（峰谷电价/频率调节需求），向数十万设备下发充/放电指令，设备执行后秒级上报状态。
  analogy: 僈电网友好的"超级充电宝"系统——电网上电多了（风电夜晚发电过剩）让设备充电吸电，电网缺电了（夏季空调高峰）让设备放电支援，整个调度中心实时监控每个充电宝的状态。
  key_points:
  - 电网需求信号接入(AGC/峰谷电价/频率调节)
  - 指令下发用MQTT(低延迟+高可靠)
  - 状态反馈实时流(Kafka→时序数据库)
  - 调度算法(优化充放电时间窗口)
  - 安全保护(过充/过放/过温保护)
first_principle:
  essence: 储能调度 = 优化问题(何时充何时放收益最大) + 控制问题(指令如何可靠下发执行) + 安全问题(不能损坏设备)。优化是经济模型，控制是通信问题，安全是工程问题。
  derivation: 假设30万套Powerwall，每套13.5kWh → 总储能4GWh。电网高峰放电4GWh相当于一个中型电厂的调节能力。调度延迟每降低1s，电网频率响应更稳定。MQTT QoS1保证指令可靠到达。
  conclusion: 架构 = 电网信号网关 + 调度优化引擎 + MQTT指令通道 + 实时状态流 + 安全保护层。
follow_up:
- 如何保证充放电指令100%到达每个设备？
- 大规模设备同时充/放电会不会冲击电网？
- 如何防止恶意指令导致设备过充爆炸？
- 设备离线时调度策略怎么调整？
memory_points:
- 核心三步走：采集电网信号 → 调度引擎算最优指令(线性规划) → MQTT精准下发
- 实时反馈：设备状态经MQTT上报，Kafka+Flink流式聚合写时序DB
- 双重防过载：调度算经济最大化，设备端软硬结合防过充/过放/过温保护
---

# 数十万套储能设备根据电网需求充放电，如何设计后端架构，实现调度指令精准下发、状态实时反馈？

## 🎯 本质

| 挑战 | 量化 | 方案 |
|------|------|------|
| **指令下发** | 30万设备毫秒级 | MQTT QoS1 + 批量下发 |
| **状态反馈** | 30万设备每秒上报 | Kafka流 + 时序数据库 |
| **调度优化** | 最大化收益+保护设备 | 线性规划/动态规划 |
| **安全保护** | 防过充/过放/过温 | 硬件保护+软件双重校验 |

---

## 🧒 类比

把储能调度想象成**智能水库管理系统**：
1. **天气预报**（电网信号）：知道明天要下大雨（风电过剩）还是干旱（用电高峰）
2. **水库管理员**（调度引擎）：提前决定什么时候开闸放水（放电）还是蓄水（充电）
3. **水管阀门**（指令通道）：把"开闸"命令发给每个水库（设备）
4. **水位计**（状态反馈）：每个水库实时汇报水位（SOC电量）
5. **安全堤坝**（保护层）：水位超高线自动溢洪（过充保护）

---

## 📊 整体架构图

```
┌──────────────────────────────────────────────────────────────────┐
│                   电网信号接入层                                   │
│  ┌────────────┐  ┌──────────────┐  ┌────────────────┐          │
│  │ 实时电价API │  │ AGC频率信号   │  │ 负荷预测数据    │          │
│  │ 峰谷时段    │  │ 频率偏差      │  │ 预测曲线        │          │
│  └─────┬──────┘  └──────┬───────┘  └───────┬────────┘          │
│        └────────────────┼──────────────────┘                     │
└─────────────────────────┼────────────────────────────────────────┘
                          │
┌─────────────────────────▼────────────────────────────────────────┐
│                   调度优化引擎                                     │
│  输入: 电价 + 设备状态(SOC/温度) + 负荷预测                        │
│  输出: 每台设备的充/放电/待机指令 + 功率设定                       │
│  算法: 线性规划(最大化经济收益) + 约束(SOC上下限/功率限制)          │
└─────────────────────────┬────────────────────────────────────────┘
                          │
┌─────────────────────────▼────────────────────────────────────────┐
│                   指令下发层 (MQTT)                                │
│  ┌──────────────────────────────────────────────────┐           │
│  │ MQTT Broker (EMQX集群)                             │           │
│  │ Topic: dispatch/cmd/{deviceId}                     │           │
│  │ QoS: 1 (至少一次,保证到达)                          │           │
│  │ ACK: 设备执行后回报确认                              │           │
│  └──────────────────────────────────────────────────┘           │
└─────────────────────────┬────────────────────────────────────────┘
                          │ TLS双向认证
┌─────────────────────────▼────────────────────────────────────────┐
│                   设备端 (Powerwall/Megapack)                     │
│  接收指令 → 安全校验 → 执行充放电 → 上报状态                       │
└─────────────────────────┬────────────────────────────────────────┘
                          │ MQTT状态上报
┌─────────────────────────▼────────────────────────────────────────┐
│                   状态反馈流                                       │
│  MQTT状态Topic → Kafka → Flink实时流处理 → 时序数据库              │
│  监控: SOC/温度/功率/告警 → 异常自动触发安全停机                   │
└──────────────────────────────────────────────────────────────────┘
```

---

## 🔧 详解

### 1. 调度优化引擎

```java
@Service
public class DispatchOptimizationEngine {

    /**
     * 核心优化：在电价约束下，最大化充放电收益
     * 
     * 目标函数: max Σ (放电价格 × 放电量 - 充电价格 × 充电量)
     * 约束条件:
     *   1. SOC_min ≤ SOC(t) ≤ SOC_max    (电量上下限)
     *   2. -P_max ≤ P(t) ≤ P_max          (功率限制)
     *   3. SOC(24) = SOC(0)               (日终回到初始电量)
     *   4. T(t) ≤ T_max                    (温度安全)
     */
    public DispatchPlan optimize(DeviceState state, GridSignal grid) {
        // 将24小时分为48个时间段(每30分钟一个)
        int slots = 48;

        // 获取未来24h电价预测
        double[] prices = grid.getPriceForecast(slots);

        // 动态规划求最优充放电序列
        double[][] dp = new double[slots + 1][101]; // SOC 0-100%
        int[][] action = new int[slots][101];       // 动作记录

        // ... DP求解过程（略）...

        // 生成调度计划
        DispatchPlan plan = new DispatchPlan();
        for (int t = 0; t < slots; t++) {
            DispatchCommand cmd = new DispatchCommand();
            cmd.setSlot(t);
            cmd.setPower(action[t][currentState.getSoc()]);
            cmd.setMode(cmd.getPower() > 0 ? "DISCHARGE" : "CHARGE");
            plan.addCommand(cmd);
        }

        // 预估收益
        plan.setEstimatedRevenue(calculateRevenue(plan, prices));
        return plan;
    }
}
```

### 2. MQTT 指令下发（可靠投递）

```java
@Service
public class CommandDispatchService {

    @Autowired private MqttGateway mqttGateway;

    public void sendCommand(DispatchCommand cmd, String deviceId) {
        String topic = "dispatch/cmd/" + deviceId;
        String payload = JSON.toJSONString(cmd);

        // QoS 1: 保证至少一次到达
        MqttMessage msg = new MqttMessage(payload.getBytes());
        msg.setQos(1);
        msg.setId(cmd.getCommandId().intValue()); // 消息ID

        mqttGateway.publish(topic, msg);

        // 设置ACK超时检查
        redis.setex("dispatch:pending:" + deviceId + ":" + cmd.getCommandId(),
                    10, payload); // 10秒未ACK则重发

        // 延迟检查ACK
        mq.sendDelay("dispatch-check-ack",
                     deviceId + ":" + cmd.getCommandId(),
                     10, TimeUnit.SECONDS);
    }

    // ACK超时重发
    @KafkaListener(topics = "dispatch-check-ack")
    public void onAckTimeout(String key) {
        String[] parts = key.split(":");
        String deviceId = parts[0];
        String cmdId = parts[1];

        if (redis.exists("dispatch:pending:" + key)) {
            // 设备未ACK → 重发指令
            DispatchCommand cmd = getCommand(cmdId);
            sendCommand(cmd, deviceId);

            // 记录重试次数，超过3次 → 标记设备离线
            int retries = incrementRetry(key);
            if (retries > 3) {
                markDeviceOffline(deviceId);
            }
        }
    }
}
```

### 3. 实时状态监控

```java
// Kafka流处理：实时监控所有设备状态
@Service
public class DeviceStatusStream {

    @KafkaListener(topics = "dispatch-status")
    public void onStatusUpdate(DeviceStatus status) {
        // ① 写入时序数据库
        tsdbService.insert(status);

        // ② 实时安全检查
        if (status.getTemperature() > 60) {
            // 过温保护 → 紧急停机
            emergencyStop(status.getDeviceId());
            alertService.send("设备过温: " + status.getDeviceId()
                + " 温度=" + status.getTemperature());
        }

        if (status.getSoc() < 5 || status.getSoc() > 95) {
            // SOC越界 → 告警
            alertService.send("SOC异常: " + status.getDeviceId()
                + " SOC=" + status.getSoc());
        }

        // ③ 聚合统计：当前总充/放电功率
        metricsService.record("total_charge_power",
            status.isCharging() ? status.getPower() : 0);
        metricsService.record("total_discharge_power",
            status.isDischarging() ? status.getPower() : 0);
    }
}
```

### 4. 安全保护双层架构

```
软件保护层（后端）:
┌─────────────────────────────────────┐
│ 1. 指令预校验：下发前检查            │
│    - 目标SOC是否在安全范围 [5%, 95%] │
│    - 充电功率是否超过额定值           │
│    - 设备温度是否已超标               │
│ 2. 异常自动停机：检测到过温/过流      │
│ 3. 指令签名：防止伪造指令             │
└──────────────────────┬──────────────┘
                       │
硬件保护层（设备端）:
┌──────────────────────▼──────────────┐
│ 1. BMS硬件保护：不可被软件覆盖       │
│    - 过压/欠压保护                    │
│    - 过流保护                         │
│    - 过温保护（热熔断器）             │
│ 2. 本地安全控制器：独立于主控        │
│ 3. 即使收到恶意指令，硬件层拒绝执行  │
└─────────────────────────────────────┘
```

---

## ❓ 发散追问

### Q1：如何保证充放电指令100%到达每个设备？

- **MQTT QoS1**：至少一次投递 + ACK确认
- **重试机制**：超时未ACK自动重发，最多3次
- **本地缓存**：设备断网时缓存指令，上线后补发
- **批量ACK**：多个指令可批量确认，减少通信开销

### Q2：大规模设备同时充/放电会不会冲击电网？

1. **分批调度**：30万设备分10批，每批间隔1分钟启动
2. **功率爬坡**：每台设备功率缓启动（30秒爬到目标功率）
3. **区域协调**：与电网公司协商，按区域分配充放电时段

### Q3：如何防止恶意指令导致设备过充爆炸？

- **指令签名**：每条指令用RSA签名，设备验签后才执行
- **设备端校验**：即使签名正确，设备也会检查指令合理性（SOC>90%不允许继续充电）
- **硬件BMS**：电池管理系统硬件级保护，软件无法绕过

## 记忆要点

- 核心三步走：采集电网信号 → 调度引擎算最优指令(线性规划) → MQTT精准下发
- 实时反馈：设备状态经MQTT上报，Kafka+Flink流式聚合写时序DB
- 双重防过载：调度算经济最大化，设备端软硬结合防过充/过放/过温保护

