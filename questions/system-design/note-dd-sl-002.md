---
id: note-dd-sl-002
difficulty: L3
category: system-design
subcategory: 高并发
tags:
- 滴滴
- 面经
- 短链系统
- HTTP
- Redis
feynman:
  essence: 短链跳转本质是一次 KV 查询 + HTTP 重定向。
  analogy: 就像快递中转站——你寄到一个简短地址，中转站查到真实地址后告诉你转寄到这里。
  first_principle: 短链系统 = 发号器生成短码 + 存储短码到长URL映射 + HTTP重定向跳转
  key_points:
  - 301 永久重定向（可缓存）
  - 302 临时重定向（可统计）
  - 307/308 保持方法
  - Redis 缓存加速
first_principle:
  essence: HTTP 重定向是应用层跳转机制
  derivation: 短码→查KV存储→拿到长URL→设Location头→返回3xx→浏览器自动跳转
  conclusion: 301 vs 302 的选择是可统计性和缓存效率的权衡
follow_up:
- 301 和 302 对 SEO 有什么影响？
- 短链跳转的延迟主要花在哪里？
- 如何统计短链的点击量？
---

# 【滴滴面经】短链跳转的原理是什么？用的是什么 HTTP 状态码？

## 一、短链跳转的本质

短链跳转的底层原理非常清晰：**一次 KV 查询 + 一次 HTTP 重定向**。

```
用户访问短链 → 短链服务查 KV 存储拿到长 URL → 返回 3xx 重定向响应 → 浏览器自动跳转到长 URL
```

核心链路拆解为三步：

1. **解析短码**：从请求 URL 中提取短码（如 `t.cn/abc123x` 中的 `abc123x`）
2. **KV 查询**：用短码作为 key，从 Redis / MySQL 中查到对应的长 URL
3. **HTTP 重定向**：构造 3xx 响应，设置 `Location` 头为长 URL，浏览器自动跳转

---

## 二、HTTP 重定向机制详解

### 2.1 什么是 HTTP 重定向

HTTP 重定向是服务器通过返回 **3xx 状态码**，告诉浏览器"你要的资源在另一个地址，请去那里访问"。浏览器收到 3xx 响应后，**自动**发起新的请求到 `Location` 头指定的 URL，整个过程对用户透明。

### 2.2 HTTP 响应示例

**302 临时重定向响应：**

```http
HTTP/1.1 302 Found
Server: nginx/1.20.1
Content-Type: text/html; charset=UTF-8
Location: https://www.example.com/page?utm_source=campaign&id=12345&token=abc
Cache-Control: no-cache, no-store, max-age=0
Content-Length: 0
```

**301 永久重定向响应：**

```http
HTTP/1.1 301 Moved Permanently
Server: nginx/1.20.1
Location: https://www.example.com/page?utm_source=campaign&id=12345
Cache-Control: max-age=86400
Content-Length: 0
```

> **关键点：** 无论 301 还是 302，浏览器都是通过读取 `Location` 响应头来确定跳转目标。重定向动作由浏览器（或 HTTP 客户端）自动完成，用户无感知。

---

## 三、301 vs 302 深度对比

### 3.1 核心对比表

| 对比维度 | 301 Moved Permanently | 302 Found |
|---------|----------------------|-----------|
| **语义** | 永久重定向 | 临时重定向 |
| **浏览器缓存** | ✅ 会缓存映射关系，后续直接跳转，不再请求短链服务 | ❌ 默认不缓存，每次都请求短链服务 |
| **点击统计** | ❌ 缓存后不回源，**无法精确统计点击量** | ✅ 每次点击都回源，**可精确统计** |
| **SEO 影响** | 页面权重转移到目标 URL | 权重保留在短链域名 |
| **CDN 缓存** | ✅ 可在 CDN 缓存 | ❌ 通常不缓存 |
| **请求方法** | 理论上可能将 POST 改为 GET（历史行为） | 理论上可能将 POST 改为 GET（历史行为） |
| **适用场景** | 域名迁移、永久固定链接 | 营销推广、A/B 测试、需要统计点击 |

### 3.2 为什么短链系统通常选 302？

**核心原因：需要统计每次点击。**

```
301 路径（第二次起）：
  用户 → 浏览器缓存命中 → 直接跳转目标 URL
       ↑ 短链服务被绕过，无法记录这次点击！

302 路径（每次）：
  用户 → 短链服务 → 记录点击（来源IP、UA、时间戳）→ 302跳转
       ↑ 每次点击都经过服务端，可精确统计
```

营销场景的核心诉求是**数据驱动**——需要统计每个短链的点击量、UV、来源渠道、设备类型、地域分布。如果用 301，浏览器缓存后不再回源，统计数据会严重失真。

**但 301 也有其适用场景：**
- 对点击统计无需求的纯跳转场景（如旧域名迁移到新域名）
- 超高频短链，用 301 减少 90% 以上的回源请求，降低服务端压力

### 3.3 补充：307 和 308

| 状态码 | 含义 | 与 301/302 的区别 |
|--------|------|------------------|
| **307** | 临时重定向 | **严格保持请求方法**，POST 不会被改为 GET |
| **308** | 永久重定向 | **严格保持请求方法**，POST 不会被改为 GET |

> 短链系统几乎不会涉及 POST 请求跳转，因此 301/302 是标准选择。307/308 是 HTTP/1.1 后期补充的，主要用于解决 301/302 历史上可能将 POST 改为 GET 的歧义问题。

---

## 四、Redis 缓存查询完整流程

### 4.1 端到端跳转流程图

```
 用户浏览器                    短链服务                  Redis Cluster         MySQL
     │                           │                         │                    │
     │  ① GET https://t.cn/abc   │                         │                    │
     │ ─────────────────────────>│                         │                    │
     │                           │                         │                    │
     │                           │  ② 提取短码 "abc"        │                    │
     │                           │  ③ GET sl:abc           │                    │
     │                           │ ───────────────────────>│                    │
     │                           │                         │                    │
     │                           │      ④ long_url (HIT)   │                    │
     │                           │ <───────────────────────│                    │
     │                           │                         │                    │
     │                           │  ⑤ 异步记录点击日志       │                    │
     │                           │     (source/UA/time)    │                    │
     │                           │                         │                    │
     │  ⑥ HTTP/1.1 302 Found     │                         │                    │
     │     Location: https://... │                         │                    │
     │ <─────────────────────────│                         │                    │
     │                           │                         │                    │
     │  ⑦ GET https://...(目标URL)                         │                    │
     │ ──────────────────────────────────────────────────>│ 目标服务器           │
     │                           │                         │                    │

 若步骤 ④ 缓存未命中 (MISS)：
     │                           │                         │                    │
     │                           │  ④' SELECT long_url FROM short_link           │
     │                           │ ────────────────────────────────────────────>│
     │                           │      long_url (from DB)                       │
     │                           │ <────────────────────────────────────────────│
     │                           │  ④'' SET sl:abc = long_url, TTL 7d            │
     │                           │ ───────────────────────>│                    │
     │                           │                         │                    │
     │                           │  ⑤ 返回 302 重定向       │                    │
```

### 4.2 跳转接口核心代码

```java
@RestController
public class RedirectController {

    @Autowired private StringRedisTemplate redisTemplate;
    @Autowired private ShortLinkMapper shortLinkMapper;
    @Autowired private ClickLogService clickLogService;

    @GetMapping("/{shortCode}")
    public void redirect(@PathVariable String shortCode,
                         HttpServletRequest request,
                         HttpServletResponse response) throws IOException {
        // 1. 先查 Redis 缓存
        String cacheKey = "sl:" + shortCode;
        String longUrl = redisTemplate.opsForValue().get(cacheKey);

        // 2. 缓存未命中，查 MySQL 并回写缓存
        if (longUrl == null) {
            longUrl = shortLinkMapper.getLongUrlByShortCode(shortCode);
            if (longUrl == null) {
                // 短码不存在，返回 404
                response.sendError(HttpServletResponse.SC_NOT_FOUND);
                return;
            }
            // 回写 Redis，设置 TTL 防止脏数据永久存在
            redisTemplate.opsForValue().set(cacheKey, longUrl, 7, TimeUnit.DAYS);
        }

        // 3. 异步记录点击日志（不影响跳转性能）
        clickLogService.asyncLog(
            ClickLog.builder()
                .shortCode(shortCode)
                .ip(request.getRemoteAddr())
                .userAgent(request.getHeader("User-Agent"))
                .referer(request.getHeader("Referer"))
                .timestamp(System.currentTimeMillis())
                .build()
        );

        // 4. 返回 302 临时重定向
        response.setStatus(HttpServletResponse.SC_FOUND); // 302
        response.setHeader("Location", longUrl);
        response.setHeader("Cache-Control", "no-cache, no-store, max-age=0");
    }
}
```

### 4.3 为什么用 302 还要设 Cache-Control: no-cache？

防止**中间代理服务器**（企业代理、运营商代理）自行缓存 302 响应。虽然浏览器默认不缓存 302，但某些代理服务器会做激进的缓存优化，加上 `Cache-Control: no-cache` 可以确保每次点击都回到源站。

---

## 五、浏览器重定向行为详解

### 5.1 浏览器收到 3xx 后的行为

```
浏览器收到 3xx 响应
    │
    ├─ 检查 Location 头是否存在？
    │   ├─ 不存在 → 显示响应体内容（通常是错误页）
    │   └─ 存在 → 提取 URL
    │
    ├─ 判断状态码
    │   ├─ 301 → 永久缓存 short_code → long_url 映射
    │   │        下次直接跳转，不再请求短链服务
    │   └─ 302 → 不缓存，下次仍请求短链服务
    │
    └─ 发起 GET 请求到 Location 指定的 URL
        └─ 用户看到页面跳转完成
```

### 5.2 重定向的性能开销

| 环节 | 耗时 | 说明 |
|------|------|------|
| DNS 解析 | 1~5ms | 短链域名解析（可被浏览器/OS缓存） |
| TCP 建连 | 1~3ms | 三次握手（HTTP Keep-Alive 可复用） |
| 短链服务处理 | 1~5ms | Redis 查询 + 日志异步记录 |
| 返回 302 | <1ms | 构造响应极快 |
| 浏览器再次请求目标 URL | 10~500ms | 取决于目标页面大小 |

> **关键优化点：** 短链跳转本身只增加一次额外 RTT（往返时间），主要延迟在第二步的目标 URL 加载。通过 Redis 缓存命中可将短链服务处理时间控制在 **5ms 以内**。

---

## 六、面试追问准备

### 6.1 301 和 302 对 SEO 有什么影响？

- **301**：搜索引擎会将原 URL 的权重（PageRank）**转移到目标 URL**，适合域名迁移
- **302**：搜索引擎**不会转移权重**，原 URL 保持索引地位，适合临时性跳转

短链系统通常用独立域名（如 `t.cn`），不依赖 SEO 权重传递，所以 302 不影响。

### 6.2 短链跳转的延迟主要花在哪里？

主要不在短链服务（Redis 命中通常 <3ms），而在：

1. **额外的一次 RTT**：用户 → 短链服务 → 返回 302 → 用户再次请求目标 URL
2. **目标页面加载时间**：与短链系统无关

优化手段：CDN 边缘缓存 301 响应，将短链服务处理时间降为 0。

### 6.3 如何统计短链的点击量？

```
点击日志采集架构：

  302 跳转请求 → 异步写入 Kafka → 消费者写入 ClickHouse / HBase
                                      ↓
                                 实时聚合（UV/PV/地域/设备）
```

- **写入路径**：跳转接口中异步投递点击事件到 Kafka，不阻塞 302 响应
- **存储选型**：ClickHouse 适合海量日志的实时聚合分析；HBase 适合明细查询
- **去重逻辑**：UV 统计用 HyperLogLog，兼顾精度与性能

---

## 七、总结

| 问题 | 答案 |
|------|------|
| **跳转原理** | 短码 → KV 查询取长 URL → HTTP 3xx 重定向 → 浏览器自动跳转 |
| **用 301 还是 302？** | **选 302**（需要统计点击量）；纯跳转无统计需求可选 301（省流量） |
| **为什么不用 301？** | 301 被浏览器/CDN 缓存后不再回源，无法统计点击数据 |
| **核心优化** | Redis 缓存加速（命中率 96%+），P99 延迟 <15ms |

> **面试技巧：** 这个问题的考察点是"你不仅知道怎么做，还知道为什么"。301 vs 302 的选择背后是**可统计性**与**缓存效率**的工程权衡。能讲清楚这个 trade-off，就是高级工程师的水准。
