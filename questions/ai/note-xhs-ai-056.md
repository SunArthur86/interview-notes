---
id: note-xhs-ai-056
difficulty: L3
category: ai
subcategory: Agent
tags:
- AI接口
- 延迟优化
- 流式返回
- 降级方案
- 缓存
- Token成本
source: 拼多多Java三轮技术面一面
feynman:
  essence: 商品详情页接入AI推荐文案，保证延迟可控的核心是：流式返回（用户先看到部分内容）+ 多级缓存（相似商品命中缓存）+ 超时降级（兜底文案）+ 异步预热。
  analogy: 就像餐厅菜单推荐——如果现做推荐菜（调LLM）要等1分钟，顾客会不耐烦。所以准备三手：已做好的招牌菜（缓存）、先上凉菜再上热菜（流式返回）、万一厨房忙不过来就推荐当日套餐（兜底文案）。
  key_points:
  - 流式返回（SSE）：LLM生成第一个token就返回，用户体感延迟降至200ms
  - 多级缓存：商品特征哈希→缓存命中文案，避免重复调用LLM
  - 超时降级：300ms超时→返回模板文案，500ms→返回静态文案
  - 异步预热：新品上架/夜间低峰预生成文案
  - Token成本控制：prompt精简+max_tokens限制+模型分级（高峰用小模型）
first_principle:
  problem: 商品详情页是电商核心页面，用户停留时间短（平均3-5秒），如果AI文案生成要2-3秒，用户可能已经滑走了。如何在保证文案质量的同时将延迟控制在可接受范围？
  axioms:
  - LLM推理延迟通常1-5秒（取决于模型大小和输入长度）
  - 商品详情页首屏渲染时间预算约500ms-1s
  - 相似商品的推荐文案高度相似（可缓存复用）
  - 用户更在意"有文案"而非"等5秒拿完美文案"
  rebuild: 将LLM调用从同步阻塞改为流式异步 → 短文案先用模板/缓存秒级返回 → LLM在后台生成补充流式推送 → 超时降级到静态文案。三层保障确保用户始终在1秒内看到内容。
follow_up:
  - 流式返回用SSE还是WebSocket？各自优缺点？
  - 缓存的key怎么设计？相似商品怎么命中同一个缓存？
  - 降级文案太千篇一律用户会反感，怎么优化？
  - 大促期间LLM API也可能超时，怎么保证可用性？
  - 文案质量怎么评估？A/B测试怎么做？
memory_points:
  - 三层保障：缓存秒级返回 → 流式LLM补充 → 超时模板兜底
  - 流式返回：SSE（Server-Sent Events）实现，首token延迟<200ms
  - 缓存key：商品品类+价格区间+目标人群特征 → 哈希
  - 降级策略：300ms→动态模板, 500ms→静态文案, 1s→隐藏AI入口
---

# 【拼多多一面】商品详情页接入"智能推荐文案"AI接口，如何设计调用链路保证延迟可控？

## 🎯 一句话本质

保证AI文案延迟可控的核心架构：**多级缓存**（命中即返回）+ **流式返回**（SSE，首token<200ms）+ **超时降级**（兜底文案）+ **异步预热**（低峰期预生成），三层保障确保用户始终在1秒内看到内容。

## 🧒 费曼类比

```
没有优化的AI接口：
  用户打开商品页 → 调LLM生成文案 → 等3秒 → 用户已经滑走了 ❌

优化后的AI接口（三层保障）：
  Layer 1 - 缓存（100ms）：
    "这个商品之前生成过文案吗？" → 命中！直接返回 ✅
  
  Layer 2 - 流式返回（200ms首token）：
    缓存未命中 → 调LLM → 第一个字出来就推送 → 用户开始阅读
    "这个手机续航超强..." → "适合商务出差..." → "拍照效果惊艳..."
    
  Layer 3 - 超时降级（<300ms）：
    LLM 300ms还没出结果 → 返回模板文案："热销好物，限时优惠！"
```

## 📊 完整调用链路架构

```
  用户打开商品详情页
        │
        ▼
  ┌─────────────────────────────────────────────┐
  │  API Gateway / BFF                            │
  │  1. 解析商品信息（品类、价格、标签）              │
  │  2. 构建缓存Key                                │
  └──────────────────┬──────────────────────────┘
                     │
  ┌──────────────────▼──────────────────────────┐
  │  L1: 本地缓存 (Caffeine, 100ms)               │
  │  Key: hash(品类+价格段+人群标签)                │
  │  命中? ────────────────────────→ 直接返回 ✅    │
  └──────────────────┬──────────────────────────┘
                     │ 未命中
  ┌──────────────────▼──────────────────────────┐
  │  L2: Redis缓存 (50ms)                         │
  │  Key: ai:copy:{product_hash}                  │
  │  TTL: 24小时（文案时效性）                      │
  │  命中? ────────────────────────→ 返回+回填L1 ✅ │
  └──────────────────┬──────────────────────────┘
                     │ 未命中
  ┌──────────────────▼──────────────────────────┐
  │  L3: 超时降级判断 (非阻塞)                      │
  │  注册300ms超时定时器                             │
  │  同时启动：                                     │
  │  ├→ 3a: LLM流式调用 (SSE)                      │
  │  │    首 token < 200ms → 推送前端              │
  │  │    后续 token 持续推送                       │
  │  │    完成 → 回填 L1 + L2 缓存                  │
  │  │                                             │
  │  └→ 3b: 模板文案生成 (< 10ms)                  │
  │       {品类}+{卖点}+{促销} 组合                  │
  │       作为兜底                                  │
  │                                                │
  │  300ms超时?                                    │
  │  ├ LLM已出token → 继续流式推送                  │
  │  └ LLM未出token → 返回模板文案 (3b)             │
  └──────────────────────────────────────────────┘
```

## 🔧 核心实现

### 1. 流式返回（SSE）

```java
@RestController
public class AiCopyController {
    
    @GetMapping(value = "/api/copy/stream", produces = MediaType.TEXT_EVENT_STREAM_VALUE)
    public SseEmitter streamCopy(@RequestParam Long productId,
                                  @RequestParam String userTag) {
        SseEmitter emitter = new SseEmitter(5000L); // 5秒超时
        
        // 异步调用LLM
        CompletableFuture.runAsync(() -> {
            try {
                // 构建prompt（精简版，控制Token）
                String prompt = buildPrompt(productId, userTag);
                
                // 流式调用LLM
                llmClient.streamChat(prompt, maxTokens=100)
                    .onToken(token -> {
                        emitter.send(SseEmitter.event().data(token));
                    })
                    .onComplete(fullText -> {
                        // 回填缓存
                        cacheService.put(buildCacheKey(productId, userTag), fullText);
                        emitter.complete();
                    })
                    .onError(e -> {
                        emitter.send(SseEmitter.event().data("热销好物，限时优惠！"));
                        emitter.complete();
                    });
            } catch (Exception e) {
                emitter.completeWithError(e);
            }
        });
        
        return emitter;
    }
}
```

### 2. 多级缓存

```java
@Service
public class CopyCacheService {
    
    @Autowired private Cache<String, String> localCache; // Caffeine
    @Autowired private RedisTemplate<String, String> redis;
    
    private static final long LOCAL_TTL = 3600;  // 1小时
    private static final long REDIS_TTL = 86400; // 24小时
    
    public String get(Long productId, String userTag) {
        String key = buildCacheKey(productId, userTag);
        
        // L1: 本地缓存
        String cached = localCache.getIfPresent(key);
        if (cached != null) return cached;
        
        // L2: Redis
        cached = redis.opsForValue().get(key);
        if (cached != null) {
            localCache.put(key, cached); // 回填L1
            return cached;
        }
        
        return null; // 缓存未命中
    }
    
    public void put(Long productId, String userTag, String copy) {
        String key = buildCacheKey(productId, userTag);
        localCache.put(key, copy);
        redis.opsForValue().set(key, copy, REDIS_TTL, TimeUnit.SECONDS);
    }
    
    /** 缓存Key设计：品类+价格段+人群标签 → 80%相似商品命中同一缓存 */
    private String buildCacheKey(Long productId, String userTag) {
        Product p = productService.getById(productId);
        // 不用productId做key，用特征哈希——相似商品共享文案
        String features = String.join("|",
            p.getCategory(),           // 手机
            getPriceRange(p.getPrice()), // 3000-5000
            p.getMainFeature(),        // 长续航
            userTag                    // 商务人士
        );
        return "ai:copy:" + DigestUtils.md5Hex(features);
    }
}
```

### 3. 超时降级

```java
@Service
public class CopyService {
    
    public CopyResult getCopy(Long productId, String userTag) {
        // 1. 查缓存
        String cached = cacheService.get(productId, userTag);
        if (cached != null) {
            return CopyResult.cached(cached);
        }
        
        // 2. 非阻塞调LLM + 超时降级
        CompletableFuture<String> llmFuture = CompletableFuture.supplyAsync(() -> 
            llmClient.chat(buildPrompt(productId, userTag), maxTokens=100)
        );
        
        try {
            // 300ms超时
            String copy = llmFuture.get(300, TimeUnit.MILLISECONDS);
            cacheService.put(productId, userTag, copy);
            return CopyResult.llm(copy);
        } catch (TimeoutException e) {
            // 降级：模板文案
            String fallback = templateService.generate(productId);
            // LLM继续在后台执行，完成后回填缓存
            llmFuture.thenAccept(c -> cacheService.put(productId, userTag, c));
            return CopyResult.fallback(fallback);
        } catch (Exception e) {
            return CopyResult.fallback("热销好物，限时优惠！");
        }
    }
}
```

### 4. 异步预热

```java
@Scheduled(cron = "0 0 2 * * ?") // 凌晨2点
public void preheatCopy() {
    // 1. 查找今日预计热销商品
    List<Long> hotProducts = productService.getTodayHotProducts(1000);
    
    // 2. 为每个商品预生成文案
    for (Long productId : hotProducts) {
        for (String userTag : Arrays.asList("student", "business", "family")) {
            if (cacheService.get(productId, userTag) == null) {
                String copy = llmClient.chat(buildPrompt(productId, userTag));
                cacheService.put(productId, userTag, copy);
            }
        }
    }
}
```

## 📋 延迟预算分配

| 环节 | 时间预算 | 累计 | 说明 |
|------|---------|------|------|
| 网关+BFF | 20ms | 20ms | 路由+鉴权 |
| 缓存查询(L1+L2) | 50ms | 70ms | Caffeine+Redis |
| 缓存命中直接返回 | - | **70ms** | 80%流量走这里 |
| LLM首Token(SSE) | 200ms | 270ms | 流式推送开始 |
| LLM完整生成 | 1500ms | 1570ms | 后台异步完成 |
| 超时降级返回 | 300ms | **300ms** | 兜底模板 |

## ❓ 苏格拉底式面试追问

1. **"你的缓存Key用的是商品特征哈希，那两个完全不同的商品但特征相同会命中同一文案，这合理吗？"**
   → 对于文案场景可以接受（同品类同价位的卖点相似），但需要在文案中加入商品名称区分

2. **"流式返回用SSE，如果用户网络不稳定断开了，LLM还在继续生成，这部分Token算谁的？"**
   → 客户端断开后服务端检测到SSE断开，取消LLM请求。Token计费看LLM API是否支持取消

3. **"大促期间LLM API限流了，你的降级方案还有效吗？"**
   → 大促前增加预热覆盖率到95%+，大促期间90%走缓存。剩余10%走模板降级

4. **"拼多多有几亿商品，全部预热需要多少成本？怎么选择预热哪些？"**
   → 只预热Top 10000热销商品，长尾商品按需生成

5. **"SSE在大规模并发下有什么问题？和WebSocket比呢？"**
   → SSE是单向推送够用。WebSocket双向但更重。SSE在Nginx层可能遇到缓冲问题需要配置proxy_buffering off

## 结构化回答

**30 秒电梯演讲：** 商品详情页接入AI推荐文案，保证延迟可控的核心是：流式返回（用户先看到部分内容）+ 多级缓存（相似商品命中缓存）+ 超时降级（兜底文案）+ 异步预热。

**展开框架：**
1. **流式返回（SSE）** — LLM生成第一个token就返回，用户体感延迟降至200ms
2. **多级缓存** — 商品特征哈希→缓存命中文案，避免重复调用LLM
3. **超时降级** — 300ms超时→返回模板文案，500ms→返回静态文案

**收尾：** 您想深入聊：流式返回用SSE还是WebSocket？各自优缺点？


## 视频脚本

> 预计时长：4 分钟 | 由浅入深


| 时间 | 画面/字幕 | 口播台词 | 讲解要点 |
|------|----------|----------|----------|
| 0:00 | 标题卡：商品详情页接入"智能推荐文案"AI接口，如何设计… | "就像餐厅菜单推荐——如果现做推荐菜（调LLM）要等1分钟，顾客会不耐烦。所以准备三手：已做…" | 开场钩子 |
| 0:20 | 核心概念图 | "商品详情页接入AI推荐文案，保证延迟可控的核心是：流式返回（用户先看到部分内容）+ 多级缓存（相似商品命中缓存）+ 超时…" | 核心定义 |
| 0:50 | 流式返回（SSE）示意图 | "流式返回（SSE）——LLM生成第一个token就返回，用户体感延迟降至200ms" | 要点拆解1 |
| 1:30 | 对比/实战案例图 | "对比一下常见误区和工程实践，看真实场景里怎么取舍。" | 实战与对比 |
| 2:20 | 总结卡 | "记住核心要点。下期我们追问：流式返回用SSE还是WebSocket？各自优缺点？" | 收尾与钩子 |
