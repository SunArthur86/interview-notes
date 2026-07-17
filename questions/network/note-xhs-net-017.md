---
id: note-xhs-net-017
difficulty: L3
category: network
subcategory: RPC/微服务通信
tags:
- 拼多多
- Java服务端
- gRPC
- HTTP
- Protobuf
- 微服务
- 协议选型
- 面经
feynman:
  essence: "gRPC基于HTTP/2+Protobuf，适合微服务间高性能通信；HTTP/REST基于HTTP/1.1+JSON，适合对外API和前后端通信"
  analogy: "gRPC就像军队的加密对讲机——专用频段、压缩编码、双向通话，高效但需要双方都配设备；HTTP就像普通电话——通用、人话可读，但传输效率低"
  key_points:
  - gRPC = HTTP/2 + Protobuf序列化 + IDL（.proto文件）
  - Protobuf二进制序列化比JSON小3-10倍，解析快20-100倍
  - HTTP/2多路复用、头部压缩、双向流
  - gRPC支持四种调用模式：Unary、Server Stream、Client Stream、Bidirectional
  - 选型：内部微服务用gRPC，对外API/前后端用HTTP/REST
first_principle:
  essence: "微服务间通信的核心需求是'高性能+强类型+跨语言'，HTTP/1.1+JSON在每个维度都有瓶颈"
  derivation: "JSON人类可读但机器解析慢(文本序列化) → Protobuf二进制编码 → 更小更快; HTTP/1.1每次请求新建连接+队头阻塞 → HTTP/2多路复用 → 更高效; REST接口无强类型约束 → IDL定义接口契约 → 编译期检查"
  conclusion: "gRPC在序列化效率、传输效率、接口契约三个维度全面优于HTTP/REST，但牺牲了可读性和浏览器直接访问能力"
follow_up:
- gRPC的健康检查机制是什么？
- Protobuf的向后兼容性如何保证？
- gRPC如何做负载均衡？（客户端LB vs 服务端LB）
- gRPC和Dubbo有什么区别？
- HTTP/3相比HTTP/2有什么改进？
memory_points:
- gRPC三件套：HTTP/2（传输）+ Protobuf（序列化）+ IDL（接口定义）
- Protobuf vs JSON：体积小3-10x，解析快20-100x
- HTTP/2三大特性：多路复用、头部压缩(HPACK)、Server Push
- 四种调用模式：Unary(一元)、Server Streaming、Client Streaming、Bidirectional Streaming
---

# 【拼多多 Java服务端】AI助手项目接入层协议选型：HTTP vs gRPC

> 来源：拼多多复活赛一面面经（小红书）— 原题：项目的接入层协议选型是什么，HTTP还是gRPC，原因？gRPC相比HTTP有哪方面的优势？

## 一、费曼类比

```
HTTP/REST 通信:
  客户端: "你好，我想查询用户ID为123的信息，这是JSON格式..."
  服务端: "好的，让我解析这段JSON... 找到了，这是返回的JSON..."
  ↓ 缺点: JSON是文本格式，体积大，每次解析都要字符串处理

gRPC 通信:
  客户端: [二进制压缩数据包, 包含方法名+参数]
  服务端: [直接反序列化为对象, 返回二进制结果]
  ↓ 优势: 二进制紧凑，编译时就知道数据结构，无需运行时解析
```

## 二、第一性原理分析

**为什么微服务间不直接用HTTP/REST？**

```
瓶颈分析:
┌──────────────┬──────────────────────┬──────────────────────┐
│ 维度         │ HTTP/1.1 + JSON      │ HTTP/2 + Protobuf    │
├──────────────┼──────────────────────┼──────────────────────┤
│ 序列化       │ JSON文本 → 字符串解析 │ Protobuf二进制 → 直接│
│              │ 慢 (反射/字符串操作)  │ 内存映射，快20-100x  │
├──────────────┼──────────────────────┼──────────────────────┤
│ 传输         │ HTTP/1.1 队头阻塞    │ HTTP/2 多路复用      │
│              │ 每请求可能新建连接    │ 单连接并行多请求     │
├──────────────┼──────────────────────┼──────────────────────┤
│ 接口契约     │ Swagger/文档(弱约束)  │ .proto IDL(强约束)   │
│              │ 运行时才发现错误      │ 编译期检查类型安全   │
├──────────────┼──────────────────────┼──────────────────────┤
│ 数据体积     │ JSON文本, 大量引号括号│ Protobuf, 字段编号   │
│              │ {"userId":123} = 14B │ 08 7B = 2B           │
└──────────────┴──────────────────────┴──────────────────────┘
```

## 三、详细答案

### 3.1 gRPC核心架构

```
┌─────────────┐          .proto IDL          ┌─────────────┐
│   Client    │                            │   Server    │
│  (Java)     │                            │  (Go)       │
│             │  ┌──────────────────┐      │             │
│  Stub ←─────┼──│ protoc 编译生成   │──────┼──→ Service  │
│  (强类型)   │  │ user.proto       │      │  (实现接口) │
└─────────────┘  └──────────────────┘      └─────────────┘
      │                                        │
      │         HTTP/2 + Protobuf              │
      └────────────────────────────────────────┘
```

### 3.2 Protobuf序列化优势

```protobuf
// user.proto
syntax = "proto3";
service UserService {
  rpc GetUser (UserRequest) returns (UserResponse);
}
message UserRequest {
  int64 user_id = 1;  // 字段编号而非名称
}
message UserResponse {
  int64 user_id = 1;
  string name = 2;
  int32 age = 3;
}
```

```
JSON序列化对比:
{"userId":123,"name":"Alice","age":25}  → 38 字节
Protobuf: 08 7B 12 05 41 6C 69 63 65 18 19  → 11 字节（小3.5x）
```

### 3.3 HTTP/2 vs HTTP/1.1

```
HTTP/1.1 (队头阻塞):
  请求1 ──────→ 响应1
                    请求2 ──────→ 响应2
                                    请求3 ──────→ 响应3
  ←───── 串行等待 ──────→

HTTP/2 (多路复用):
  请求1 ─┐
  请求2 ─┼── 单一TCP连接，并行发送 ──→ 服务器
  请求3 ─┘                              │
  ←───────── 并行响应 ─────────────────┘
```

### 3.4 gRPC四种调用模式

| 模式 | 场景 | 例子 |
|------|------|------|
| Unary RPC（一元调用） | 普通请求-响应 | 查询用户信息 |
| Server Streaming | 服务端推送 | 实时日志推送、大文件分块 |
| Client Streaming | 客户端流式上传 | 批量数据上传、传感器数据收集 |
| Bidirectional Streaming | 双向流 | 实时聊天、AI对话流 |

## 四、选型决策

| 场景 | 推荐协议 | 原因 |
|------|---------|------|
| 微服务内部通信 | **gRPC** | 高性能、强类型、跨语言 |
| 前后端通信 | HTTP/REST | 浏览器原生支持、可读性 |
| 对外公开API | HTTP/REST | 通用性、客户端多样性 |
| 实时数据流 | **gRPC Streaming** | 双向流、低延迟 |
| 移动端到服务端 | **gRPC** | Protobuf体积小、省流量 |
| AI/ML推理服务 | **gRPC** | 大模型流式输出 |

## 五、实际例子：AI助手项目选型

```
AI助手系统架构:
┌──────────┐     HTTP/REST     ┌──────────────┐     gRPC      ┌──────────────┐
│ 前端/App │ ←──────────────→ │ API Gateway  │ ←──────────→ │ AI Service   │
│ (浏览器) │    JSON, 可读     │ (BFF层)      │  Protobuf    │ (LLM推理)    │
└──────────┘                   └──────────────┘              └──────────────┘
                                       │                            │
                                       │     gRPC                   │ gRPC
                                       ↓                            ↓
                               ┌──────────────┐           ┌──────────────┐
                               │ User Service │           │ RAG Service  │
                               └──────────────┘           └──────────────┘

选型原因:
- 前端到网关: HTTP（浏览器兼容、CDN友好、调试方便）
- 网关到微服务: gRPC（高性能、Protobuf强类型、流式推理输出）
```

## 六、扩展知识

- **gRPC健康检查**: gRPC Health Checking Protocol（标准化的健康检查机制）
- **gRPC拦截器**: 类似Filter，可用于日志、认证、链路追踪
- **Protobuf向后兼容**: 新增字段用新编号、不删除旧字段（标记reserved）
- **gRPC-Web**: 允许浏览器直接调用gRPC（通过代理转换）

## 七、苏格拉底式面试提问

1. **"你说gRPC用Protobuf，那Protobuf到底是怎么做到比JSON小的？"** — 引出varint编码、字段编号替代字段名
2. **"gRPC基于HTTP/2，那为什么浏览器不能直接调用gRPC？"** — 引出浏览器HTTP/2支持限制、gRPC-Web代理方案
3. **"你的AI助手用gRPC做流式输出，如果客户端断连了怎么处理？"** — 引出context cancel、超时机制、重连策略
4. **"gRPC的性能优势在大规模生产环境真的明显吗？瓶颈通常在哪？"** — 引出序列化只是链路一部分，网络IO、业务逻辑可能才是瓶颈
5. **"如果团队中Java和Go混合开发，gRPC的跨语言能力具体怎么体现？"** — 引出.proto IDL作为接口契约、protoc多语言插件

## 八、面试加分点

1. **结合项目场景回答** — "我们的AI助手前端用HTTP，内部推理服务用gRPC Streaming，因为需要流式返回大模型输出"
2. **量化对比** — Protobuf体积小3-10x，解析快20-100x
3. **知道gRPC四种模式** — 特别是Streaming模式在AI场景的应用
4. **理解HTTP/2底层** — 多路复用、头部压缩(HPACK)
5. **能说出gRPC缺点** — 调试不直观（二进制）、浏览器不支持原生调用、服务治理生态不如Dubbo成熟


## 结构化回答

**30 秒电梯演讲：** gRPC基于HTTP/2+Protobuf，适合微服务间高性能通信；HTTP/REST基于HTTP/1.1+JSON，适合对外API和前后端通信。打个比方，gRPC就像军队的加密对讲机——专用频段、压缩编码、双向通话，高效但需要双方都配设备；HTTP就像普通电话——通用、人话可读，但传输效率低。

**展开框架：**
1. **gRPC三件套** — HTTP/2（传输）+ Protobuf（序列化）+ IDL（接口定义）
2. **Protobuf vs** — 体积小3-10x，解析快20-100x
3. **HTTP/2三大特性** — 多路复用、头部压缩(HPACK)、Server Push

**收尾：** 这块我踩过坑——要不要深入聊：gRPC的健康检查机制是什么？

## 视频脚本

> 预计时长：3 分钟 | 由浅入深

| 时间 | 画面/字幕 | 口播台词 | 讲解要点 |
|------|----------|----------|----------|
| 0:00 | 标题卡 | "RPC/微服务通信一句话：gRPC基于HTTP/2+Protobuf，适合微服务间高性能通信；HTTP/REST基于HTTP/1.1+JSON…。" | 开场钩子 |
| 0:15 | HTTP 请求/响应报文结构图 | "gRPC三件套：HTTP/2（传输）+ Protobuf（序列化）+ IDL（接口定义）" | gRPC三件套 |
| 1:06 | HTTP 请求/响应报文结构图分步演示 | "Protobuf vs JSON：体积小3-10x，解析快20-100x" | Protobuf vs |
| 1:57 | 关键代码/伪代码片段 | "HTTP/2三大特性：多路复用、头部压缩(HPACK)、Server Push" | HTTP/2三大特性 |
| 2:50 | 总结卡 | "核心抓住这条主线，下期咱们接着聊：gRPC的健康检查机制是什么。" | 收尾 |
