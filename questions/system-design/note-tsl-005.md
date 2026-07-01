---
id: note-tsl-005
difficulty: L4
category: system-design
subcategory: 分布式
tags:
- 特斯拉
- 固件校验
- OTA
- 数字签名
- 灰度发布
feynman:
  essence: 固件校验的核心是"完整性验证+兼容性检查+安全签名"。每个固件包用数字签名证明来源可信，用哈希验证内容完整，用版本矩阵检查兼容性，用灰度发布控制风险范围。
  analogy: 像手机系统更新——先验证更新包是不是官方的（数字签名），再检查包有没有损坏（哈希校验），然后确认这个版本适配你的手机型号（兼容性检查），最后先让1%用户升级看看有没有问题（灰度发布）。
  key_points:
  - 数字签名(RSA/ECDSA)验证固件来源
  - SHA-256哈希验证完整性
  - 版本兼容矩阵检查
  - 灰度发布+回滚机制
  - 车端校验+服务端校验双重保障
first_principle:
  essence: 固件安全 = 信任链传递。从编译构建→签名→分发→安装，每一步都需要验证上一步的完整性。任何一环被篡改都可能导致车辆故障。
  derivation: 固件控制车辆核心功能（刹车、转向、ADAS），错误的固件可能导致安全事故。因此校验必须满足：不可伪造（私钥签名）、不可篡改（哈希校验）、可追溯（版本审计）、可回退（降级恢复）。
  conclusion: 架构 = 构建签名(CI/CD+HSM) → CDN分发 → 车端校验(签名+哈希+兼容) → 灰度安装 → 监控回滚。
follow_up:
- 如何防止固件被逆向工程篡改？
- 灰度发布发现问题如何快速回滚百万辆车？
- 固件版本太多如何管理兼容性？
- OTA过程中车辆断电怎么办？
memory_points:
- 核心四要素：来源数字签名验，内容哈希校验，版本靠矩阵，安全靠灰度+回滚
- 构建与分发：构建时HSM私钥签名生成manifest，CDN全球分发固件包
- 车端校验流：验签名→校哈希→查兼容→双分区(A/B)写入→重启验证，自动回滚保平安
---

# 车载固件多版本迭代，如何设计后端校验架构，验证固件完整性、兼容性，避免异常固件导致车辆故障？

## 🎯 本质

| 校验维度 | 目的 | 技术手段 |
|----------|------|----------|
| **来源可信** | 确保固件来自Tesla官方 | RSA/ECDSA 数字签名 |
| **内容完整** | 固件包未被篡改/损坏 | SHA-256 哈希校验 |
| **版本兼容** | 适配车辆硬件/软件版本 | 版本兼容矩阵 |
| **灰度安全** | 控制故障影响范围 | 分批发布 + 自动回滚 |

---

## 🧒 类比

固件校验就像**快递验货流程**：
1. **检查发件人**：确认是官方旗舰店发的，不是骗子（数字签名）
2. **检查包裹**：外包装完好没拆过，封条没破（哈希完整性）
3. **检查型号**：确认这个配件适配你的车型（兼容性检查）
4. **先试装一台**：不是百万台一起装，先装1000台跑跑看（灰度发布）
5. **有问题退货**：装完发现问题，立即恢复原厂件（自动回滚）

---

## 📊 整体架构图

```
┌──────────────────────────────────────────────────────────────────┐
│                      固件构建与签名流水线                           │
│                                                                  │
│  源码 → CI编译 → 固件包(.bin)                                    │
│           │                                                      │
│           ▼                                                      │
│  ┌─────────────────┐    ┌──────────────────┐                    │
│  │  HSM硬件安全模块  │    │  兼容性矩阵生成    │                    │
│  │  私钥签名(RSA)    │    │  车型×ECU×版本    │                    │
│  └────────┬────────┘    └────────┬─────────┘                    │
│           │                      │                                │
│           ▼                      ▼                                │
│  ┌──────────────────────────────────────────┐                    │
│  │  签名固件包 + 元数据(manifest)             │                    │
│  │  {firmwareId, version, sha256, signature, │                    │
│  │   compatibleModels, minVersion, ecuList}   │                    │
│  └────────────────────┬─────────────────────┘                    │
└───────────────────────┼──────────────────────────────────────────┘
                        │
┌───────────────────────▼──────────────────────────────────────────┐
│                     CDN 分发网络                                   │
│           签名固件包全球分发 → 就近下载                              │
└───────────────────────┬──────────────────────────────────────────┘
                        │
┌───────────────────────▼──────────────────────────────────────────┐
│                     车端校验与安装                                  │
│                                                                   │
│  ① 下载固件包                                                     │
│  ② 验证签名（公钥解密 vs 哈希）                                    │
│  ③ 验证SHA-256完整性                                               │
│  ④ 检查兼容性矩阵（车型/ECU/当前版本）                              │
│  ⑤ 双分区写入（A/B partition）                                     │
│  ⑥ 重启验证 → 成功则切换，失败则回滚                                │
└──────────────────────────────────────────────────────────────────┘
```

---

## 🔧 详解

### 1. 固件 Manifest 元数据

```json
{
  "firmwareId": "fw-2024.12.1-model3",
  "version": "2024.12.1",
  "previousMinVersion": "2024.8.0",
  "releaseDate": "2024-06-15T00:00:00Z",
  "compatibleModels": ["model3", "modelY"],
  "ecuTargets": ["autopilot", "infotainment", "bms"],
  "fileSize": 1850000000,
  "sha256": "a3f5e8b2c1d4...",
  "signature": "base64encodedRSA4096signature...",
  "signatureAlgorithm": "RSA-SHA256",
  "rolloutPercent": 1,
  "rollbackAllowed": true
}
```

### 2. 服务端灰度发布控制

```java
@Service
public class FirmwareRolloutService {

    // 灰度发布：逐步扩大推送范围
    public boolean canPush(String firmwareId, String vehicleId) {
        FirmwareManifest fw = getManifest(firmwareId);
        VehicleInfo vehicle = getVehicle(vehicleId);

        // ① 兼容性检查
        if (!fw.getCompatibleModels().contains(vehicle.getModel())) {
            return false;  // 车型不匹配
        }
        if (compareVersion(vehicle.getCurrentVersion(),
                          fw.getPreviousMinVersion()) < 0) {
            return false;  // 当前版本太旧，不支持直接升级
        }

        // ② 灰度百分比检查
        // 用 vehicleId 的哈希值取模，确定性地分配到灰度批次
        int hash = Math.abs(vehicleId.hashCode()) % 100;
        if (hash >= fw.getRolloutPercent()) {
            return false;  // 还没轮到这辆车
        }

        // ③ 区域分批：先推送非核心区域
        if (fw.getRolloutPercent() < 10
            && vehicle.getRegion().equals("core_market")) {
            return false;  // 前10%只推非核心市场
        }

        return true;
    }

    // 监控灰度指标，自动扩大或回滚
    @Scheduled(fixedRate = 60000)
    public void monitorRollout() {
        double errorRate = getInstallErrorRate(currentFirmwareId);
        double crashRate = getPostUpdateCrashRate(currentFirmwareId);

        if (errorRate > 0.05 || crashRate > 0.01) {
            // 错误率超阈值 → 暂停 + 全局回滚
            pauseRollout();
            triggerGlobalRollback(currentFirmwareId);
            alertService.send("CRITICAL: 固件异常, 启动全局回滚");
        } else if (errorRate < 0.001 && currentBatchComplete()) {
            // 指标健康 → 扩大灰度范围
            increaseRolloutPercent();
        }
    }
}
```

### 3. 车端校验流程（核心安全逻辑）

```java
// 车端固件校验器（C/C++/Rust实现，这里是Java伪码）
public class FirmwareVerifier {

    // Tesla 根公钥（出厂时烧录在安全芯片中）
    private static final PublicKey TESLA_ROOT_PUBKEY = loadFromHSM();

    public VerifyResult verify(byte[] firmwareData, FirmwareManifest manifest) {

        // ① 验证签名：用公钥验签
        boolean sigValid = verifySignature(
            firmwareData,
            manifest.getSha256(),    // 实际验的是哈希的签名
            manifest.getSignature(),
            TESLA_ROOT_PUBKEY
        );
        if (!sigValid) {
            return VerifyResult.reject("签名验证失败：固件可能被篡改");
        }

        // ② 验证完整性：重新计算哈希比对
        String actualHash = sha256(firmwareData);
        if (!actualHash.equals(manifest.getSha256())) {
            return VerifyResult.reject("哈希不匹配：固件数据损坏");
        }

        // ③ 兼容性检查
        if (!isCompatible(manifest, getCurrentVehicleInfo())) {
            return VerifyResult.reject("固件不兼容当前车辆配置");
        }

        return VerifyResult.pass();
    }

    private boolean verifySignature(byte[] data, String hash,
            String signature, PublicKey pubkey) {
        try {
            Signature sig = Signature.getInstance("SHA256withRSA");
            sig.initVerify(pubkey);
            sig.update(hexToBytes(hash));
            return sig.verify(base64Decode(signature));
        } catch (Exception e) {
            return false;  // 任何异常都视为验签失败
        }
    }
}
```

### 4. A/B 双分区安全安装

```
车辆存储分区设计：
┌────────────────┬────────────────┬──────────────┐
│  Partition A   │  Partition B   │  Recovery    │
│  (当前活跃)     │  (备用/升级用)  │  (恢复分区)   │
│  fw-2024.8.0   │  (空或旧版本)   │  最小系统     │
└────────────────┴────────────────┴──────────────┘

升级流程：
1. 新固件写入 Partition B（不影响当前运行的 A）
2. 写入完成后校验签名+哈希
3. 重启 → 引导程序尝试从 B 启动
4. B 启动成功 → 标记 B 为活跃，A 为备用
5. B 启动失败/崩溃 → 引导程序自动回退到 A
```

---

## ❓ 发散追问

### Q1：如何防止固件被逆向工程篡改？

1. **安全启动链**：从 BootROM → Bootloader → 内核，每一级验证下一级签名
2. **硬件安全模块（HSM）**：私钥存储在专用安全芯片中，不可读取
3. **代码混淆 + 加密**：固件代码加密存储，运行时解密
4. **防回滚计数器**：硬件计数器防降级到已知有漏洞的旧版本

### Q2：灰度发布发现问题如何快速回滚百万辆车？

- **A/B 分区回滚**：只需切换活跃分区，秒级回退
- **全局回滚指令**：通过蜂窝网络向所有车辆推送紧急回滚命令
- **分优先级**：故障车辆优先回滚，正常车辆排队处理
- **目标时间**：关键安全修复在24h内覆盖99%车辆

### Q3：OTA过程中车辆断电怎么办？

1. **原子写入**：写入B分区过程中断电，A分区不受影响，车辆正常从A启动
2. **断点续传**：固件下载支持断点续传，重新联网后从断点继续
3. **写入校验**：重启后验证B分区完整性，不完整则重新下载

## 记忆要点

- 核心四要素：来源数字签名验，内容哈希校验，版本靠矩阵，安全靠灰度+回滚
- 构建与分发：构建时HSM私钥签名生成manifest，CDN全球分发固件包
- 车端校验流：验签名→校哈希→查兼容→双分区(A/B)写入→重启验证，自动回滚保平安

