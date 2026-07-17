---
id: note-bz-agent-076
difficulty: L4
category: ai
subcategory: Agent
tags:
- B站面经
- Agent
- 高并发
- 防护
- 限流
feynman:
  essence: Agent高并发四层防护=网关限流(挡洪峰)+会话限流(防单用户刷)+模型熔断(保LLM不崩)+工具降级(保后端)。层层设防保证系统稳定。
  analogy: 像大坝防洪——主闸门(网关限流)、分洪道(会话限流)、应急泄洪(熔断)、备用电源(降级)，层层保护。
  first_principle: Agent依赖的LLM/工具都是有容量限制的外部服务，高并发下必须分层限流保护，否则雪崩。
  key_points:
  - 四层：网关限流/会话限流/模型熔断/工具降级
  - 核心：保护脆弱的LLM调用
  - 手段：限流/熔断/降级/队列/缓存
  - 目标：高可用不雪崩
first_principle:
  essence: Agent系统的瓶颈是LLM(贵且慢)，高并发必须保护LLM不被打爆。
  derivation: LLM推理慢(秒级)、贵(每次调用花钱)、有并发上限。直接暴露给高并发→LLM服务过载→超时→重试→更过载→雪崩。必须分层限流，让LLM在安全负载内运行。
  conclusion: 高并发防护 = 分层限流（网关→会话→模型→工具）保护LLM不雪崩
follow_up:
- 限流算法用什么？——令牌桶/滑动窗口
- 熔断怎么判断？——错误率/延迟超阈值
- 降级到什么？——缓存/小模型/规则/告知用户
memory_points:
- 四层防护链路：网关限流、会话限流、模型熔断、工具降级
- 网关挡全局洪峰，会话防单用户恶意刷量
- 模型层必做熔断：因为LLM调用慢且贵，过载不及时熔断会引发连环雪崩
- 工具调用失败时执行降级：保底返回缓存或默认回复以维持系统可用
---

# Agent 高并发如何做防护？（网关限流+会话限流+模型熔断+工具降级）

## 一、为什么 Agent 需要特殊的高并发防护

```
Agent系统的脆弱点：
  1. LLM调用慢（秒级）→ 高并发时请求堆积
  2. LLM调用贵 → 不限流成本爆炸
  3. LLM有并发上限 → 超了报错/超时
  4. 工具调用依赖外部服务 → 可能被拖垮
  5. Agent多轮循环 → 单请求放大N倍负载

不加防护的后果：
  流量高峰 → LLM过载 → 超时 → 用户重试 → 更过载 → 雪崩
```

## 二、四层防护架构

```
┌──────────────────────────────────────────────────┐
│              四层防护架构                           │
├──────────────────────────────────────────────────┤
│                                                    │
│  用户请求                                          │
│      │                                            │
│      ▼                                            │
│  ┌──────────────────────────────────┐            │
│  │ Layer 1: 网关限流 (Gateway)       │            │
│  │ 全局QPS控制，挡住流量洪峰          │            │
│  └──────────────┬───────────────────┘            │
│      │                                            │
│      ▼                                            │
│  ┌──────────────────────────────────┐            │
│  │ Layer 2: 会话限流 (Session)       │            │
│  │ 单用户/会话级限流，防刷            │            │
│  └──────────────┬───────────────────┘            │
│      │                                            │
│      ▼                                            │
│  ┌──────────────────────────────────┐            │
│  │ Layer 3: 模型熔断 (Circuit Break) │            │
│  │ LLM过载时熔断，防止雪崩            │            │
│  └──────────────┬───────────────────┘            │
│      │                                            │
│      ▼                                            │
│  ┌──────────────────────────────────┐            │
│  │ Layer 4: 工具降级 (Degradation)   │            │
│  │ 工具失败时降级，保证可用            │            │
│  └──────────────────────────────────┘            │
│                                                    │
└──────────────────────────────────────────────────┘
```

## 三、各层详解

### Layer 1：网关限流（全局）

```python
from collections import defaultdict
import time

class GatewayRateLimiter:
    """全局QPS限流，挡住洪峰"""
    
    def __init__(self, max_qps=1000):
        self.max_qps = max_qps
        self.requests = defaultdict(list)  # 时间窗口
    
    def allow(self):
        now = time.time()
        # 清理1秒前的记录
        self.requests['global'] = [
            t for t in self.requests['global'] if now - t < 1
        ]
        if len(self.requests['global']) >= self.max_qps:
            return False  # 超限拒绝
        self.requests['global'].append(now)
        return True

# 超限处理：返回429 + Retry-After
def handle_request(request):
    if not gateway_limiter.allow():
        return Response(429, "服务繁忙，请稍后重试", 
                       headers={"Retry-After": "5"})
```

### Layer 2：会话限流（单用户）

```python
class SessionRateLimiter:
    """防止单用户刷请求"""
    
    LIMITS = {
        "free": {"rpm": 10, "rpd": 100},    # 免费用户
        "pro": {"rpm": 60, "rpd": 1000},    # 付费用户
        "vip": {"rpm": 200, "rpd": 10000},  # VIP
    }
    
    def check(self, user_id, tier):
        limits = self.LIMITS[tier]
        # 每分钟限流
        if self.count_recent(user_id, 60) >= limits["rpm"]:
            return False, "超出每分钟限制"
        # 每天限流
        if self.count_recent(user_id, 86400) >= limits["rpd"]:
            return False, "超出每日限制"
        return True, None
```

### Layer 3：模型熔断

```python
class ModelCircuitBreaker:
    """LLM过载时熔断，防止雪崩"""
    
    def __init__(self):
        self.state = "closed"  # closed/open/half_open
        self.failures = 0
        self.threshold = 10  # 连续失败10次熔断
    
    async def call_llm(self, prompt):
        if self.state == "open":
            # 熔断中，直接降级
            return await self.fallback()
        
        try:
            result = await llm.generate(prompt, timeout=30)
            self.failures = 0  # 成功，重置
            return result
        except (Timeout, OverloadError) as e:
            self.failures += 1
            if self.failures >= self.threshold:
                self.state = "open"  # 开启熔断
                self.schedule_recovery()  # 30秒后半开
            return await self.fallback()
    
    async def fallback(self):
        """熔断时的降级方案"""
        # 1. 用缓存
        if cached := cache.get(prompt_hash):
            return cached
        # 2. 用小模型
        return await small_llm.generate(prompt)
        # 3. 或返回"服务繁忙"
```

### Layer 4：工具降级

```python
class ToolDegradation:
    """工具调用失败时的降级"""
    
    async def call_tool(self, tool, args):
        try:
            return await tool.execute(args, timeout=10)
        except Exception:
            # 分级降级
            return await self.degrade(tool, args)
    
    async def degrade(self, tool, args):
        # Level 1: 用缓存
        if cached := self.cache.get(tool, args):
            return cached
        
        # Level 2: 用简化版
        if simpler := self.get_simpler(tool):
            return await simpler.execute(args)
        
        # Level 3: 返回默认值
        if default := self.get_default(tool):
            return default
        
        # Level 4: 告知失败
        return {"error": "服务暂时不可用", "degraded": True}
```

## 四、配套机制

### 请求队列（削峰填谷）

```python
import asyncio

class RequestQueue:
    """请求排队，控制并发"""
    
    def __init__(self, max_concurrent=100):
        self.semaphore = asyncio.Semaphore(max_concurrent)
    
    async def process(self, request):
        async with self.semaphore:  # 控制并发数
            return await handle(request)
```

### 缓存（减少LLM调用）

```python
class ResponseCache:
    """语义缓存，相似问题复用"""
    
    async def get_or_compute(self, query):
        # 精确缓存
        if cached := self.exact_cache.get(query):
            return cached
        # 语义缓存（相似问题）
        if similar := self.semantic_cache.search(query, threshold=0.95):
            return similar
        # 未命中，调LLM
        result = await llm.generate(query)
        self.cache.set(query, result)
        return result
```

## 五、高并发场景的参数设计

```
┌──────────────┬──────────────────────────────────┐
│ 参数          │ 建议值                              │
├──────────────┼──────────────────────────────────┤
│ 全局QPS       │ LLM并发上限的70%（留buffer）       │
│ 单用户RPM     │ free:10, pro:60, vip:200          │
│ LLM超时       │ 30秒（超了熔断）                   │
│ 工具超时      │ 10秒                              │
│ 熔断阈值      │ 连续10次失败或错误率>50%           │
│ 熔断恢复      │ 30秒后半开试探                     │
│ 队列长度      │ max_concurrent的2倍               │
│ 缓存TTL      │ 1小时（根据业务）                 │
└──────────────┴──────────────────────────────────┘
```

## 六、面试加分点

1. **四层防护**：网关→会话→模型→工具，层层设防——体系化
2. **核心是保护 LLM**：LLM 是最脆弱最贵的，所有防护围绕它
3. **降级而非报错**：熔断/降级保证"返回点什么"而非崩溃——用户体验优先

## 记忆要点

- 四层防护链路：网关限流、会话限流、模型熔断、工具降级
- 网关挡全局洪峰，会话防单用户恶意刷量
- 模型层必做熔断：因为LLM调用慢且贵，过载不及时熔断会引发连环雪崩
- 工具调用失败时执行降级：保底返回缓存或默认回复以维持系统可用

## 苏格拉底式面试追问

> 这组追问模拟面试官层层逼问，每一问先回答"为什么"，再回答"怎么做"，最后回答"如何证明"。

### 第一层：目标与动机

**Q：你把防护拆成网关/会话/模型/工具四层，为什么不直接在模型调用那一层做所有限流？多一层多一次开销。**

因为四层防护的对象不同，合并会有盲区。网关层挡的是全局洪峰（DDoS、爬虫），保护的是整个服务不挂；会话层挡的是单用户刷量（一个人狂发请求），保护的是公平性；模型层挡的是 LLM 的 RPM/TPM 配额，保护的是不触发厂商 429；工具层挡的是外部依赖（DB、搜索 API）被拖垮。如果在模型层统一做，就管不了"还没到模型层服务就因为连接数爆炸而挂了"的情况。四层是纵深防御，每层挡不同维度的风险，不是冗余。

### 第二层：证据与定位

**Q：线上 Agent 突然大面积超时，你怎么快速判断是哪一层堵了？**

看四层各自的指标链路。网关层看入口 QPS 和拒绝率——如果拒绝率高是网关限流生效（正常防护）。会话层看单用户请求分布——如果某几个 user_id 占了 80% QPS，是恶意刷量。模型层看 LLM 调用的 P99 延迟和 429 比例——如果 429 多是触发了厂商配额，如果延迟飙到 30s 是模型本身慢。工具层看外部调用的失败率——如果搜索 API 超时率 > 30%，是工具拖垮。按链路从外到内排查，哪层指标异常就定位到哪层，不用猜。

### 第三层：根因深挖

**Q：模型层熔断你说必做，但熔断后用户拿不到结果体验差，为什么不能只限流不熔断？**

因为 LLM 调用是慢且贵的，限流挡不住"已进入但处理不完"的堆积。LLM 单次调用 5-10 秒，如果只限流（QPS=100）不熔断，100 个请求同时进 LLM，每个占一个连接 10 秒，10 秒内累积 1000 个在途请求，连接池和内存先爆。熔断的作用是"故障时快速失败"——检测到 LLM 错误率 > 50% 或延迟 P99 > 30s，立即熔断让新请求直接走降级（返回缓存），把已堆积的请求快速清空，避免雪崩。限流是慢性控制，熔断是急症抢救，缺一不可。

**Q：那为什么不直接把限流阈值调到 LLM 扛得住的程度（比如 QPS=10），不就不用熔断了？**

因为会严重牺牲正常吞吐。LLM 厂商的 RPM 配额是波动的（高峰期给你降配），静态阈值 QPS=10 在低谷期浪费配额，在高峰期又不够。而且 LLM 偶发的慢查询（一次 30s）会让 QPS=10 的队列瞬间堆积，限流挡不住"单次变慢"引发的级联。熔断是针对"异常状态"的动态开关，比静态阈值更能应对波动。正确架构是限流压平均负载 + 熔断挡异常尖峰，不是二选一。

### 第四层：方案权衡

**Q：工具调用失败你走降级返回缓存，但缓存可能是过时数据（比如实时股价），返回错的比报错还糟，你怎么权衡？**

按数据时效性分级降级，不是无脑返回缓存。强实时数据（股价、库存）——缓存有效期 < 1 分钟，过期就报错不降级，因为错的比没有更糟。弱实时数据（商品信息、用户画像）——缓存有效期 10-30 分钟，可降级返回缓存并标注"数据可能有延迟"。静态数据（历史文章、产品参数）——几乎不过期，降级返回缓存无副作用。降级策略要和数据特性绑定，每类工具调用标明"可降级/不可降级/降级有效期"，在配置中心管理，不是一刀切。

**Q：为什么不直接对所有工具失败都报错让用户重试，而是费力做分级降级？**

因为报错重试会放大负载，形成二次雪崩。工具失败如果直接报错，用户大概率重试（Agent 场景尤其，用户觉得是偶发），重试流量叠加原始流量，把本来就压力大的外部服务进一步压垮。分级降级的核心是"吸收失败、不向上传递压力"——可降级的直接返回缓存让请求闭环，不产生重试；不可降级的报错但加退避（提示用户"稍后再试"而非"重试"），降低重试率。这是面向失败的系统设计，比"报错让用户处理"鲁棒得多。

### 第五层：验证与沉淀

**Q：你怎么验证四层防护在真实流量峰值下真的生效，而不是纸上谈兵？**

做故障注入演练（混沌工程）。定期（每月）在准生产环境注入四类故障：模拟 LLM 延迟飙到 30s、模拟 LLM 返回 500、模拟工具调用超时、模拟 10 倍正常 QPS 的流量洪峰。观察四层防护的触发顺序和恢复时间。通过的标准是：服务在故障下不整体不可用（降级生效）、故障恢复后 1 分钟内恢复正常吞吐、无雪崩级联。演练有录像和指标曲线，证明防护不是配置了而是真能扛。

**Q：这套防护怎么沉淀成团队标准？**

抽象成"Agent 防护 SDK"，封装四层的限流/熔断/降级逻辑，对外暴露配置项（阈值、降级策略、熔断条件）。新 Agent 服务接入只填配置不写防护代码。配套一个防护配置模板（按服务等级分：核心交易级/普通业务级/内部工具级），每级预设阈值。这样防护能力是平台化的，不是每个 Agent 团队自己重复造轮子，也避免有人漏接某一层防护。

## 结构化回答

**30 秒电梯演讲：** Agent高并发四层防护=网关限流(挡洪峰)+会话限流(防单用户刷)+模型熔断(保LLM不崩)+工具降级(保后端)。层层设防保证系统稳定。

**展开框架：**
1. **四层** — 网关限流/会话限流/模型熔断/工具降级
2. **核心** — 保护脆弱的LLM调用
3. **手段** — 限流/熔断/降级/队列/缓存

**收尾：** 您想深入聊：限流算法用什么？——令牌桶/滑动窗口？


## 视频脚本

> 预计时长：5 分钟 | 由浅入深


| 时间 | 画面/字幕 | 口播台词 | 讲解要点 |
|------|----------|----------|----------|
| 0:00 | 标题卡：Agent 高并发如何做防护？（网关限流+会话限… | "像大坝防洪——主闸门(网关限流)、分洪道(会话限流)、应急泄洪(熔断)、备用电源(降级)…" | 开场钩子 |
| 0:20 | 核心概念图 | "Agent高并发四层防护=网关限流(挡洪峰)+会话限流(防单用户刷)+模型熔断(保LLM不崩)+工具降级(保后端)。层层…" | 核心定义 |
| 0:50 | 四层示意图 | "四层——网关限流/会话限流/模型熔断/工具降级" | 要点拆解1 |
| 1:30 | 核心示意图 | "核心——保护脆弱的LLM调用" | 要点拆解2 |
| 2:20 | 对比/实战案例图 | "对比一下常见误区和工程实践，看真实场景里怎么取舍。" | 实战与对比 |
| 3:10 | 总结卡 | "记住核心要点。下期我们追问：限流算法用什么？——令牌桶/滑动窗口？" | 收尾与钩子 |
