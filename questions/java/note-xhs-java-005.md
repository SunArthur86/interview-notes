---
id: note-xhs-java-005
difficulty: L2
category: java
subcategory: microservice
tags:
- Nacos
- 服务注册
- Distro
- Raft
- AP
- CP
- 面经
feynman:
  essence: "Nacos用两种一致性协议——临时实例用Distro(AP)追求可用性，持久实例用Raft(CP)追求一致性。选错协议会导致服务发现出问题"
  analogy: "临时实例像外卖骑手——随时上线下线（AP优先，宁可短暂看到已下线的骑手也不能让系统卡住）。持久实例像实体店——数据必须准确一致（CP优先，宁可短暂不可用也不能数据错乱）。用外卖骑手的方式管理实体店地址=灾难"
  key_points:
  - 临时实例=客户端心跳维持，断连自动摘除→Distro协议(AP)
  - 持久实例=服务端主动探测，永久存储→Raft协议(CP)
  - Distro：AP模式，各节点独立处理写入，异步同步，允许短暂不一致
  - Raft：CP模式，Leader写+半数确认，强一致但Leader选举期间不可用
  - 典型坑：面试中说"都是Raft"→记混了，临时实例是Distro
first_principle:
  essence: "CAP定理：分布式系统在一致性(C)和可用性(A)之间必须权衡。Nacos的设计是让用户根据业务特征选择AP或CP"
  derivation: "服务注册发现的场景中：微服务实例(如Spring Cloud服务)频繁上下线，用AP模式(Distro)即使Nacos某节点宕机也能继续提供服务发现，代价是短暂的不一致（可能看到已下线的实例，但客户端重试即可）。数据库/存储类服务需要精确的实例信息，用CP模式(Raft)保证所有节点看到一致的实例列表，代价是Leader选举期间(几秒)不可用"
  conclusion: "Nacos双协议的设计精髓是：不要用一种协议解决所有问题——临时性服务选AP，持久性服务选CP"
follow_up:
- Distro协议和Raft协议的具体区别是什么？
- Nacos怎么判断一个实例是临时的还是持久的？
- AP模式下客户端拿到已下线实例怎么办？
- Nacos集群最少几个节点？Raft需要奇数节点吗？
memory_points:
- 临时实例→Distro(AP)，持久实例→Raft(CP)
- Distro：各节点独立写入，异步同步
- Raft：Leader写+半数确认
- 典型坑："都是Raft"→错！临时实例是Distro
---

# 【Java微服务】Nacos临时实例vs持久实例的区别？各自的一致性协议？

> 来源：小红书「JAVA大厂二面，Nacos踩坑复盘全整理」

## 一、核心对比

```
┌────────────────────────────────────────────────────┐
│              Nacos实例类型对比                       │
├──────────────┬─────────────────────────────────────┤
│              │  临时实例          │  持久实例       │
├──────────────┼───────────────────┼────────────────┤
│ 生命周期     │ 心跳维持，断连摘除 │ 永久存储       │
│ 健康检查     │ 客户端→发心跳     │ 服务端→主动探测│
│ 一致性协议   │ Distro (AP)       │ Raft (CP)      │
│ 适用场景     │ 微服务实例         │ 数据库/存储    │
│ 典型用户     │ Spring Cloud服务   │ DNS/配置数据   │
│ 摘除行为     │ 心跳超时自动摘除   │ 仅标记不健康   │
└──────────────┴───────────────────┴────────────────┘
```

## 二、两种一致性协议详解

### Distro协议（AP模式）——临时实例

```
Distro: 各节点平等，独立处理+异步同步

Client A注册实例 → Nacos Node 1
                      │
                      │ 1. 立即写入本地
                      │ 2. 立即返回成功给Client A ✓
                      │ 3. 异步同步给其他节点
                      │
                      ├──→ Node 2 (异步, 可能延迟)
                      └──→ Node 3 (异步, 可能延迟)

特点:
  ✓ 写入立即可用（高可用）
  ✗ 短暂不一致（读Node2可能看不到新实例）
  ✓ 适合频繁上下线的微服务场景
```

### Raft协议（CP模式）——持久实例

```
Raft: Leader主导，半数确认才提交

Client注册实例 → Nacos Leader
                      │
                      │ 1. Leader写入本地log
                      │ 2. 同步给所有Follower
                      │ 3. 半数Follower确认 → 提交
                      │ 4. 返回成功给Client ✓
                      │
                      ├──→ Follower 1 ✓
                      ├──→ Follower 2 ✓ (半数达成)
                      └──→ Follower 3 (可能未确认)

特点:
  ✓ 强一致性（所有节点看到相同数据）
  ✗ Leader选举期间不可用（几秒）
  ✓ 适合数据一致性要求高的场景
```

## 三、服务注册完整流程

```
┌──────────────────────────────────────────────────┐
│              服务注册完整流程                      │
│                                                   │
│  1. 服务启动                                      │
│     ↓                                             │
│  2. 向Nacos发送注册请求                           │
│     POST /nacos/v1/ns/instance                    │
│     参数: ephemeral=true → 临时实例               │
│     参数: ephemeral=false → 持久实例              │
│     ↓                                             │
│  3. Nacos存储实例信息                             │
│     临时实例 → 内存(Map) + Distro同步             │
│     持久实例 → 磁盘(raft_log) + Raft同步          │
│     ↓                                             │
│  4. 客户端定时拉取服务列表                        │
│     - 长轮询订阅 (推荐, 准实时)                    │
│     - 定时拉取 (间隔10-30s)                       │
│     ↓                                             │
│  5. 健康检查                                      │
│     临时实例: 客户端每5s发心跳                    │
│     持久实例: Nacos每10s TCP/HTTP探测             │
│     ↓                                             │
│  6. 不健康处理                                    │
│     临时实例: 心跳超时(15s)→自动摘除              │
│     持久实例: 探测失败→标记不健康(不摘除)         │
└──────────────────────────────────────────────────┘
```

## 四、配置中心动态刷新

除了`@RefreshScope`注解，Nacos配置变更还有其他感知方式：

```java
// 方式1: @RefreshScope + @Value (Spring Cloud原生)
@RefreshScope
@RestController
public class ConfigController {
    @Value("${app.timeout:3000}")
    private int timeout; // 配置变更时自动刷新
}

// 方式2: 监听ConfigChangeEvent
@EventListener
public void onConfigChange(ConfigChangeEvent event) {
    for (String key : event.getKeysChanged()) {
        System.out.println("配置变更: " + key + " = " + event.getNewValue(key));
    }
}

// 方式3: 实时从Environment获取
@Autowired
private Environment env;

public String getConfig(String key) {
    return env.getProperty(key); // 总是获取最新值
}

// 方式4: @NacosValue (Nacos原生注解)
@NacosValue(value = "${app.timeout:3000}", autoRefreshed = true)
private int timeout;
```

## 五、Nacos vs Eureka核心区别

| 特性 | Nacos | Eureka |
|------|-------|--------|
| 一致性协议 | AP(Distro) + CP(Raft) | 仅AP |
| 配置中心 | 自带 | 无 |
| 健康检查 | 心跳+主动探测 | 仅心跳 |
| 实例类型 | 临时+持久 | 仅临时 |
| 服务发现 | 推(长轮询)+拉 | 拉(定时) |
| 集群部署 | 需要奇数节点(Raft) | 任意节点 |
| 社区维护 | 阿里维护(活跃) | Netflix停更(2.x) |

## 六、面试加分点

1. **CAP场景选择**：能说出具体场景——"电商商品服务用临时实例(AP)，因为实例频繁扩缩容，短暂不一致不影响业务；支付核心服务用持久实例(CP)，因为必须保证实例列表准确"
2. **Distro同步机制**：Distro不是简单的异步复制——它按service维度做数据分片，每个Nacos节点负责一部分service的数据同步，这样即使节点很多同步效率也很高
3. **Raft选举影响**：Raft Leader宕机触发选举，期间持久实例的注册和查询不可用（通常3-5秒）——面试中提到这个具体影响时间加分
4. **Nacos 2.x改进**：Nacos 2.x引入了gRPC长连接替代HTTP短连接，服务注册和配置推送的延迟从秒级降到毫秒级
5. **配置变更监听原理**：Nacos通过长轮询(Long Polling)实现配置实时推送——客户端发起请求后，服务端hold住最多30秒，期间配置变更立即返回，否则30秒后返回空让客户端重新发起
