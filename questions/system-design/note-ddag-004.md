---
id: note-ddag-004
difficulty: L5
category: system-design
subcategory: 风控系统
tags:
- 风控
- 异常检测
- 检索系统
- 滴滴
- 面经
- 系统设计
- AgenticRAG
feynman:
  essence: 信贷风控检索的核心挑战是"捕捉异常模式而非语义相似"——黑产行为和正常交易在字面语义上很像，但在行为模式上是异常的。传统向量检索按语义相似召回会大量误召回正常交易，需要改为"行为模式编码+异常分数检索+时序特征匹配"的架构。
  analogy: 传统语义检索像用"关键词匹配"抓小偷——搜"买了手机"会召回所有买手机的人(大部分是正常用户)。风控检索像用"行为画像匹配"——不只看买了什么，还看购买时间、频率、设备指纹、支付方式组合，找到"行为模式像已知黑产"的人。
  first_principle: 风控检索的本质不是"找相似的文本"而是"找相似的风险模式"。风险模式是多维时序行为特征，不是静态文本描述，所以不能直接用文本嵌入做检索。
  key_points:
  - '核心转变: 从"语义相似度"到"行为模式相似度"'
  - '特征工程: 交易序列编码 + 设备/网络/时间多维特征 + 频率/金额统计'
  - '检索策略: 行为向量检索 + 规则引擎过滤 + 异常分数排序'
  - '对抗性: 黑产换店铺/品类→需要抽象层特征(行为模式而非具体商品)'
first_principle:
  essence: 检索系统的设计由"什么定义相似"决定。风控场景的相似是"行为模式相似"而非"语义内容相似"。
  derivation: 黑产和正常用户可能买同类商品 → 文本语义相似但风险不同 → 所以不能按商品语义检索 → 需要提取行为特征序列 → 按行为模式相似度检索 → 黑产换品类但行为模式(批量/夜间/新设备)不变 → 所以行为特征要抽象到模式层
  conclusion: 风控检索 = 行为序列编码 + 异常模式匹配 + 动态规则引擎
follow_up:
- 行为模式向量怎么构建？用什么模型？
- 黑产不断变换策略，系统怎么自适应？
- 召回率和误报率怎么平衡？
- 这个系统跟Agentic RAG有什么本质区别？
memory_points:
- "核心挑战: 语义相似≠风险相似，需要从\"文本检索\"转为\"行为模式检索\""
- "特征抽象层: 商品→品类→行为模式(解决黑产换品类)"
- "系统架构: 行为向量检索 + 异常评分 + 规则引擎 + 人工审核"
- "vs Agentic RAG: 一个是\"找相似信息辅助生成\"一个是\"找相似风险辅助决策\""
---

# 设计信贷风控场景的检索系统

## 🎯 本质

从黑产数据库中召回"行为模式相似"的历史案例辅助风控判断。核心挑战：**捕捉的是"异常"而非语义"相似"**，不能直接用文本向量检索。

## 🧒 费曼类比

抓小偷：不能只搜"穿黑衣服的人"（语义匹配→召回太多无辜者），要搜"深夜、戴帽子、在ATM附近徘徊、频繁小额取款"这个行为组合（模式匹配→精准定位）。

## 📊 系统架构

```mermaid
flowchart TD
    EVT["当前交易事件"]
    subgraph FE["特征提取层"]
        F1["交易特征<br/>金额/频率<br/>设备指纹<br/>地理位置"]
        F2["行为序列<br/>时间窗口<br/>操作序列<br/>关联网络"]
        ENC["行为模式编码器<br/>(GraphSAGE/Transformer)"]
        F1 & F2 --> ENC
    end
    subgraph RET["多路检索层"]
        R1["向量检索<br/>(FAISS/Milvus)<br/>行为相似"]
        R2["规则匹配<br/>(复杂规则引擎)<br/>→高风险"]
        R3["时序模式匹配<br/>(DTW/shapelet)"]
        R4["关联网络检索<br/>(图查询)"]
    end
    FUSE["融合排序层<br/>多维评分融合<br/>风险分 = Σ(wi×si)<br/>异常度×相似度×规则匹配度"]
    DEC["决策输出层<br/>高风险 → 拦截+审核<br/>中风险 → 人工复核<br/>低风险 → 放行+监控<br/>+ 召回的Top-K相似案例"]

    EVT --> FE
    ENC -->|行为向量 (256维)| RET
    R1 & R2 & R3 & R4 --> FUSE
    FUSE --> DEC
```

## 🔧 核心技术方案

### 1. 行为模式编码（替代文本嵌入）

```python
class BehaviorEncoder:
    """将交易行为编码为行为模式向量"""
    
    def encode(self, transaction_event: dict) -> np.ndarray:
        features = []
        
        # 维度1: 交易统计特征 (抽象层——不看具体商品)
        features.extend([
            event['amount_percentile'],        # 金额分位(相对值)
            event['frequency_24h'],            # 24h内交易频率
            event['amount_std_7d'],            # 7天金额标准差
            event['time_since_last_txn'],      # 距上次交易时间
        ])
        
        # 维度2: 设备/网络特征
        features.extend([
            event['device_new'],               # 是否新设备
            event['ip_proxy_probability'],     # 代理IP概率
            event['device_velocity'],          # 设备关联账户数
        ])
        
        # 维度3: 行为序列特征 (时序模式)
        seq = event['recent_actions']  # 最近N步操作序列
        features.extend(self.seq_encoder.encode(seq))  # Transformer编码
        
        # 维度4: 图特征 (关联网络)
        features.extend([
            event['shared_device_count'],      # 共享设备数
            event['shared_payment_count'],     # 共享支付方式数
        ])
        
        return np.array(features)  # 256维行为向量
```

**关键设计：抽象层解决黑产换品类问题**

```
黑产行为: 买iPhone(被检测) → 换买茶叶 → 换买礼品卡
                                ↓
具体商品层: iPhone ≠ 茶叶 ≠ 礼品卡 (语义不相似)
抽象行为层: 高频+夜间+新设备+批量+小额 = 同一行为模式 ✅
```

### 2. 多路检索策略

```python
class RiskRetrievalSystem:
    def retrieve(self, current_event, black_market_db):
        results = []
        
        # Path 1: 行为向量检索 (核心)
        behavior_vec = self.encoder.encode(current_event)
        similar_cases = self.faiss_index.search(
            behavior_vec, top_k=20,
            filter={'risk_type': 'fraud'}  # 只在黑产库中搜索
        )
        results.extend(similar_cases)
        
        # Path 2: 异常模式匹配 (非相似性)
        anomaly_score = self.anomaly_detector.score(behavior_vec)
        if anomaly_score > 0.8:
            # 高异常分 → 不需要"相似"案例，本身就是异常
            results.append({
                'source': 'anomaly',
                'score': anomaly_score,
                'reason': '行为模式偏离正常分布'
            })
        
        # Path 3: 规则引擎 (确定性匹配)
        rule_hits = self.rule_engine.evaluate(current_event)
        # e.g., "同一设备1小时内关联5+新账户" → 高风险
        results.extend(rule_hits)
        
        # Path 4: 关联图谱查询
        graph_risks = self.graph_db.find_suspicious_links(
            current_event['user_id'],
            max_depth=2  # 2跳关联
        )
        results.extend(graph_risks)
        
        return self.fuse_and_rank(results)
```

### 3. 与传统RAG/Agentic RAG的关键差异

| 维度 | 传统RAG | Agentic RAG | 风控检索 |
|------|---------|-------------|---------|
| **"相似"定义** | 语义相似 | 语义相似(多跳) | 行为模式相似 |
| **检索目标** | 找知识 | 找知识(迭代) | 找风险案例 |
| **特征空间** | 文本嵌入 | 文本嵌入 | 行为特征向量 |
| **挑战** | 语义模糊 | 信息不足 | 正常/异常分界模糊 |
| **误召回** | 不相关信息 | 过时信息 | **正常交易(最大风险)** |

### 4. 降低误召回的关键设计

```python
def reduce_false_positives(candidates):
    """降低误报率: 正常交易不应被召回"""
    
    filtered = []
    for case in candidates:
        # 排除: 行为相似但已被标记为正常的
        if case.get('label') == 'normal':
            continue
        
        # 排除: 相似度高但异常分数低的
        if case['similarity'] > 0.8 and case['anomaly_score'] < 0.3:
            continue  # 语义像但行为正常
        
        # 加权: 相似度×异常分数
        case['risk_score'] = case['similarity'] * case['anomaly_score']
        filtered.append(case)
    
    return sorted(filtered, key=lambda x: x['risk_score'], reverse=True)
```

## 💡 例子

**场景：用户在深夜用新设备购买3部iPhone，一次性付款**

1. 特征提取：`{amount_percentile: 0.95, frequency_24h: 5, device_new: 1, time: 2AM, ...}`
2. 行为向量编码 → 256维向量
3. 向量检索 → 找到黑产库中"批量购机转卖"的案例(相似度0.87)
4. 异常评分 → 0.91(远超正常分布)
5. 规则匹配 → "新设备+大额+夜间"命中高风险规则
6. 图谱查询 → 该设备关联了3个不同账户
7. 融合排序 → 综合风险分0.89 → **高风险→拦截+人工审核**

## ❓ 苏格拉底式面试追问

1. **"黑产行为模式会演化，你的系统怎么适应？"**
   → 持续学习：新确认的黑产case定期入库→向量索引更新→模型定期重训练→规则引擎动态更新

2. **"向量检索的FAISS在大规模数据下性能如何？"**
   → 百级向量: 暴力搜索; 十万级: IVF; 亿级: IVF+PQ量化。风控场景通常百万级，IVF足够

3. **"这个系统的召回率怎么评估？"**
   → 离线: 标注数据集上算Recall@K; 在线: A/B测试对比拦截率/误报率; 专家审核: 人工抽检Top-K

4. **"跟Agentic RAG相比要做哪些针对性调整？"**
   → 三大调整: ①检索从文本向量改为行为特征向量 ②"相似"从语义改为异常模式 ③加异常评分和规则引擎做多路融合


## 结构化回答

**30 秒电梯演讲：** 信贷风控检索的核心挑战是"捕捉异常模式而非语义相似"——黑产行为和正常交易在字面语义上很像，但在行为模式上是异常的。

**展开框架：**
1. **核心挑战** — 语义相似≠风险相似，需要从"文本检索"转为"行为模式检索"
2. **特征抽象层** — 商品→品类→行为模式(解决黑产换品类)
3. **系统架构** — 行为向量检索 + 异常评分 + 规则引擎 + 人工审核

**收尾：** 这块我踩过坑——要不要深入聊：行为模式向量怎么构建？用什么模型？

## 视频脚本

> 预计时长：4 分钟 | 由浅入深

| 时间 | 画面/字幕 | 口播台词 | 讲解要点 |
|------|----------|----------|----------|
| 0:00 | 标题卡 | "风控系统一句话：信贷风控检索的核心挑战是'捕捉异常模式而非语义相似'——黑产行为和正常交易在字面语义上很像…。" | 开场钩子 |
| 0:15 | 排序算法柱状图动画 | "核心挑战: 语义相似≠风险相似，需要从'文本检索'转为'行为模式检索'" | 核心挑战 |
| 1:08 | 排序算法柱状图动画分步演示 | "特征抽象层: 商品到品类到行为模式(解决黑产换品类)" | 特征抽象层 |
| 2:01 | 关键代码/伪代码片段 | "系统架构: 行为向量检索 + 异常评分 + 规则引擎 + 人工审核" | 系统架构 |
| 2:54 | 对比表格 | "vs Agentic RAG: 一个是'找相似信息辅助生成'一个是'找相似风险辅助决策'" | vs Agentic |
| 3:50 | 总结卡 | "核心抓住这条主线，下期咱们接着聊：行为模式向量怎么构建？用什么模型。" | 收尾 |
