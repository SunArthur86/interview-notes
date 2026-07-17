---
id: note-bz-agent-034
difficulty: L3
category: ai
subcategory: Agent
tags:
- B站面经
- Skill
- 工具命中率
feynman:
  essence: 工具多命中率低=LLM选不准。提升方法：工具分类索引+描述优化+RAG检索+few-shot示例+调用日志反馈学习。
  analogy: 像超市找商品——有清晰分区(分类)、商品标签(描述)、导购指引(检索)、你买过记住(反馈)，才能快速找到。
  first_principle: 命中率低是因为"选择空间大+描述不精准+上下文不足"。对症：缩小选择空间(检索)、提升描述质量、补充上下文(few-shot)。
  key_points:
  - 原因：选择空间大/描述不精/缺乏示例
  - 解法：分类索引+描述优化+RAG+few-shot+反馈学习
  - 评估：命中率=正确选择/总选择
  - 持续优化：调用日志分析+迭代
first_principle:
  essence: 工具命中率是信息检索准确率问题。
  derivation: 把"选对工具"看作检索问题：query=用户意图，doc=工具描述，目标=检索最相关的。提升检索准确率的标准方法（query改写/语义匹配/rerank/反馈）都适用。
  conclusion: 提升命中率 = 工具描述质量 + 检索准确率 + 示例引导 + 持续反馈
follow_up:
- 怎么评估命中率？——标注正确工具，统计LLM选择一致率
- few-shot示例怎么构造？——从历史正确调用中提取
- 命中率多少算合格？——简单任务>95%，复杂>80%
memory_points:
- 描述优化是基础：需写清功能、正反触发边界与参数示例，降低相似工具混淆
- 缩小选择空间：利用分类索引或RAG动态检索，将候选工具集压缩至5个以内
- 粗排结合精排：先用向量召回Top-10，再用LLM结合Few-shot做精准Rerank
- 闭环反馈学习：从历史日志提取正误模式，自动沉淀优质Few-shot并优化描述
---

# Agent Skill/工具过多，如何提升命中率？

## 一、命中率低的根因分析

```
命中率 = 正确选中的工具 / 应该选的工具

低命中率原因：
  1. 选择空间太大（30个工具，LLM选晕）
  2. 工具描述不精准（描述模糊，LLM不确定）
  3. 相似工具混淆（query_order vs query_history）
  4. 缺少使用示例（LLM不知道什么场景用什么）
  5. 用户意图模糊（LLM理解错需求）
```

## 二、提升命中率的六种方法

### 方法 1：工具描述优化（基础）

```python
# 优化前：模糊
{"name": "search", "description": "搜索数据"}

# 优化后：精准+边界+示例
{"name": "search_order", "description": """
搜索订单。当用户提到'订单''购买记录''我的订单'时使用。
参数：keyword(可模糊匹配商品名/订单号)。
示例触发：'我上周买的手机''查下我的订单'
不要用于：查物流(用track)、退款(用refund)
"""}
```

### 方法 2：工具分类索引（缩小选择空间）

```python
# 建立工具索引，按类别组织
TOOL_INDEX = {
    "查询类": ["search_order", "search_product", "get_balance"],
    "操作类": ["create_order", "cancel_order", "pay"],
    "客服类": ["submit_complaint", "contact_human"],
}

def select_with_index(query):
    # 先判断用哪类
    category = llm.classify(f"用户'{query}'需要哪类工具: {list(TOOL_INDEX)}")
    # 只在该类里选（3-4个工具，命中率高）
    return llm.select_tool(query, TOOL_INDEX[category])
```

### 方法 3：RAG 检索工具（动态缩小）

```python
class ToolRAG:
    def __init__(self, tools):
        # 工具描述embedding建索引
        self.index = VectorIndex()
        for t in tools:
            self.index.add(embed(t.description), t)
    
    def retrieve(self, query, k=5):
        # 检索最相关的k个工具
        return self.index.search(embed(query), k=k)
```

### 方法 4：Few-shot 示例引导

```python
# 在工具列表后附上"什么意图选什么工具"的示例
TOOL_EXAMPLES = """
示例：
用户: "我的快递到哪了" → track_logistics
用户: "我要退那个手机" → refund
用户: "帮我看看余额" → get_balance
用户: "你好" → 无需工具
"""

# 这些示例帮LLM建立"意图→工具"的映射
```

### 方法 5：Rerank 精选

```python
def select_tool_with_rerank(query, tools):
    # 第1步：粗检索（召回top-10）
    candidates = tool_index.search(query, k=10)
    
    # 第2步：精排序（LLM从10个中选最好的）
    prompt = f"""
    用户意图: {query}
    候选工具: {[t.brief for t in candidates]}
    
    选出最合适的1个工具，或判断无需工具。
    """
    return llm.select(prompt)
```

### 方法 6：反馈学习（持续优化）

```python
class ToolSelectionLearner:
    """从调用日志中学习，持续优化"""
    
    def learn_from_log(self):
        """分析历史调用，发现模式"""
        logs = self.get_tool_call_logs()
        
        for log in logs:
            if log.was_correct:
                # 正确调用 → 提取为few-shot示例
                self.add_example(log.query, log.tool)
            else:
                # 错误调用 → 分析原因，优化描述
                self.improve_description(log.intended_tool, log.error)
        
        # 更新工具描述和示例库
        self.update_tool_prompts()
```

## 三、综合应用

```python
class HighAccuracyToolSelector:
    """组合多种方法，最大化命中率"""
    
    def select(self, query, context):
        # 1. RAG检索候选（缩小到top-5）
        candidates = self.rag.retrieve(query, k=5)
        
        # 2. 加入few-shot示例
        examples = self.get_relevant_examples(query)
        
        # 3. LLM精选
        selected = self.llm.select(
            query=query,
            tools=candidates,
            examples=examples,
            context=context
        )
        
        # 4. 置信度检查
        if selected.confidence < 0.7:
            return {"action": "clarify", "question": "您是想...还是...？"}
        
        # 5. 记录（用于反馈学习）
        self.log(query, selected)
        
        return selected
```

## 四、命中率评估

```python
def evaluate_hit_rate(test_cases):
    """
    test_cases: [{query, correct_tool}, ...]
    """
    correct = 0
    for case in test_cases:
        predicted = tool_selector.select(case.query)
        if predicted.tool == case.correct_tool:
            correct += 1
        else:
            # 分析错误原因
            log_error(case, predicted)
    
    return correct / len(test_cases)

# 目标：简单意图>95%，复杂>80%
```

## 五、面试加分点

1. **当成检索问题**：工具选择本质是信息检索，IR 的方法（召回+排序+反馈）都适用
2. **组合拳**：单一方法效果有限，描述优化+RAG+few-shot+反馈组合最优
3. **持续学习**：从调用日志中学习是最被忽略但最有效的——工具命中率会随使用越来越好

## 记忆要点

- 描述优化是基础：需写清功能、正反触发边界与参数示例，降低相似工具混淆
- 缩小选择空间：利用分类索引或RAG动态检索，将候选工具集压缩至5个以内
- 粗排结合精排：先用向量召回Top-10，再用LLM结合Few-shot做精准Rerank
- 闭环反馈学习：从历史日志提取正误模式，自动沉淀优质Few-shot并优化描述


## 苏格拉底式面试追问

> 这组追问模拟面试官层层逼问，每一问先回答"为什么"，再回答"怎么做"，最后回答"如何证明"。

### 第一层：目标与动机

**Q：工具多命中率低（LLM 选不准），你列了"分类索引+描述优化+RAG检索+few-shot+日志反馈"五种方法，哪个效果最显著？**

按效果排序：1）描述优化——ROI 最高（零额外算力，写清楚功能+场景+示例就能从 60% 提到 80%），必做且先做；2）RAG 检索——工具数 >15 时显著（解决 context 膨胀导致的注意力分散），从全塞的 60% 提到检索的 85%；3）few-shot 示例——对易混淆工具显著（演示正确调用让 LLM 模仿），+5-10%；4）日志反馈——长期最有效（用真实误选样本迭代 prompt/检索模型），但见效慢；5）分类索引——辅助（帮助检索/路由更准），单独作用小。实务优先级：描述优化（立竿见影）→ RAG 检索（工具多时）→ few-shot（易混淆时）→ 日志反馈（持续迭代）。

### 第二层：证据与定位

**Q：你说日志反馈能提升命中率，但怎么从"选错的日志"里学到改进？具体怎么用这些误选样本？**

三种用法。1）prompt 优化——分析误选样本，找"为什么选错"的 pattern（如"A 和 B 工具混淆"），在工具描述里加"反例"（A 工具描述加"不要用于 B 场景"），用误选样本反向优化描述；2）检索模型优化——把误选样本作为"负例"微调工具检索模型（让 embedding 把混淆的工具分开），提升检索 top-K 的准确率；3）分类器优化——如果用工具路由，误选样本重新训练路由分类器（让分类更准）。闭环：线上收集误选日志→人工/自动标注"正确工具"→反向优化（描述/检索模型/分类器）→上线→收集新误选日志，持续迭代。

### 第三层：根因深挖

**Q：工具描述优化是 ROI 最高的方法，但"好描述"的标准是什么？怎么写出 LLM 容易选对的描述？**

四要素 + 反例。1）功能（一句话说清做什么）——"根据订单号查询订单的物流状态"；2）场景（什么时候用）——"用户问物流/快递进度/到哪了时调用"；3）参数示例——"order_id: 字符串，如 'ORD12345'"；4）反例（什么时候不用）——"不要用于查订单详情（用 get_order_detail）；不要用于查所有订单（用 list_orders）"。常见错误：描述太简（"查询工具"——查什么？）、无参数示例（LLM 猜格式易错）、无反例（相似工具混淆）。验证方法：A/B 测试不同描述版本的工具选择准确率，选准确率高的描述。好描述的检验标准："给一个新人看描述，他能不能不犯错地决定用不用这个工具"。

**Q：few-shot 示例能提升命中率，但示例太多会让 prompt 膨胀（和工具多一样的问题），怎么平衡？**

选择性 few-shot。1）只给易混淆工具 few-shot——大多数工具描述清楚就够，只有"功能相似易混淆"的工具加 few-shot（如"查订单列表 vs 查订单详情"加对比示例），减少总示例数；2）动态 few-shot——不把所有示例塞 prompt，按当前 query 检索最相关的 2-3 个示例（如 query 涉及物流，只塞物流工具的示例），动态适配；3）示例精简——每个示例只 1-2 行（"query: 查我的订单 / tool: get_order_detail(order_id='ORD123')"），不冗长。实务：核心易混淆工具固定 few-shot（2-3 个）+ 动态检索 few-shot（按 query 检索），总示例控制在 5-8 个，token 增加可控。

### 第四层：方案权衡

**Q：提升命中率的五种方法，小团队资源有限，怎么选性价比最高的组合？**

按"成本-效果"矩阵选。低成本高效果：描述优化（必做，零算力）、few-shot（低成本，针对易混淆）；中成本高效果：RAG 检索（要建工具索引，工具多时值得）；高成本中效果：日志反馈闭环（要标注+迭代，长期见效）。小团队推荐组合：1）先做描述优化（1 天，立竿见影）+ few-shot（易混淆工具，半天）；2）工具 >15 个时加 RAG 检索（2-3 天搭索引）；3）上线后持续做日志反馈（每周迭代）。这个组合能在 1 周内把命中率从 60% 提到 85%，性价比最高。日志反馈是长期投入，不期望短期见效。

**Q：工具命中率优化到 90% 后，剩下的 10% 错误怎么处理？硬提升到 99% 成本太高。**

工程兜底。1）决策校验——选完工具后校验（参数完整/权限/意图匹配），拦住"明显错"的（如查天气选了删库工具），校验能再过滤 3-5%；2）执行后反馈——工具执行后看结果是否合理（如查订单返回空可能 order_id 错），不合理时让 LLM 重新选择（自我纠正），再纠 2-3%；3）转人工——剩下确实处理不了的（<5%）转人工，保证用户体验。所以不需要硬提升到 99%，90% 选择准确率 + 校验+自我纠正+转人工兜底，综合用户体验可达 95%+。最后 5% 转人工是合理的（成本远低于把准确率从 90% 提到 99% 的训练成本）。

### 第五层：验证与沉淀

**Q：你怎么持续监控工具命中率，发现"某天突然下降"（如新加了工具导致混淆）？**

实时监控 + 回归测试。1）实时监控——线上统计工具选择准确率（通过"用户是否满意/是否需要重新调用"反推，或抽检标注），打到 dashboard，下降超 5% 告警；2）回归测试——每次新增工具/改描述，跑固定标注集（几百个 query 的正确工具标注），对比命中率，下降则阻止上线；3）新工具影响分析——新增工具时分析"它和现有工具的混淆度"（embedding 相似度），相似度高的提前优化描述（加反例）。这套监控让命中率"可视、可控、可回归"，新工具上线不会悄悄拉低整体。

**Q：工具命中率优化的五种方法怎么沉淀成框架的默认能力？**

封装成 ToolSelector 组件（增强版）：1）描述质量校验——工具注册时校验描述是否含"功能+场景+参数示例"，不达标拒绝注册；2）RAG 检索——内置工具向量索引，自动按 query 检索 top-K；3）few-shot 管理——支持工具级 few-shot 配置，易混淆工具自动加载示例；4）决策校验——内置参数/权限/意图校验；5）日志反馈闭环——自动收集误选样本，提供迭代工具（反向优化描述/微调检索模型）。开发者注册工具+配 few-shot，框架自动跑检索+校验+监控。这套写入团队 Agent 框架 SOP，新 Agent 工具命中率开箱即用且持续优化。

## 结构化回答

**30 秒电梯演讲：** 工具多命中率低=LLM选不准。提升方法：工具分类索引+描述优化+RAG检索+few-shot示例+调用日志反馈学习——像超市找商品。

**展开框架：**
1. **原因** — 选择空间大/描述不精/缺乏示例
2. **解法** — 分类索引+描述优化+RAG+few-shot+反馈学习
3. **评估** — 命中率=正确选择/总选择

**收尾：** 您想深入聊：怎么评估命中率？——标注正确工具，统计LLM选择一致率？


## 视频脚本

> 预计时长：4 分钟 | 由浅入深


| 时间 | 画面/字幕 | 口播台词 | 讲解要点 |
|------|----------|----------|----------|
| 0:00 | 标题卡：Agent Skill/工具过多，如何提升命中率… | "像超市找商品——有清晰分区(分类)、商品标签(描述)、导购指引(检索)、你买过记住(反馈)…" | 开场钩子 |
| 0:20 | 核心概念图 | "工具多命中率低=LLM选不准。提升方法：工具分类索引+描述优化+RAG检索+few-shot示例+调用日志反馈学习。" | 核心定义 |
| 0:50 | 原因示意图 | "原因——选择空间大/描述不精/缺乏示例" | 要点拆解1 |
| 1:30 | 对比/实战案例图 | "对比一下常见误区和工程实践，看真实场景里怎么取舍。" | 实战与对比 |
| 2:20 | 总结卡 | "记住核心要点。下期我们追问：怎么评估命中率？——标注正确工具，统计LLM选择一致率？" | 收尾与钩子 |
