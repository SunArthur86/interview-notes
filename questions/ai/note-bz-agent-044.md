---
id: note-bz-agent-044
difficulty: L3
category: ai
subcategory: Agent
tags:
- B站面经
- Text2SQL
- Agent
- NL2SQL
feynman:
  essence: Text2SQL在Agent里=把"自然语言查数据"封装为Agent的一个Skill/工具。Agent负责理解意图，Text2SQL负责生成SQL查数据库，再由Agent解读结果。
  analogy: 像有个翻译员——你用大白话说"查上月销量"，翻译员(Text2SQL)转成SQL去数据库查，再把结果翻译回你能懂的话。
  first_principle: 用户不懂SQL但需要查数据。Text2SQL桥接"自然语言"和"结构化查询"，Agent提供意图理解和结果解读。
  key_points:
  - 定位：Text2SQL作为Agent的数据查询工具
  - 流程：意图理解→SQL生成→执行→结果解读
  - 难点：复杂SQL/多表/业务语义
  - 增强：Schema RAG+SQL校验+结果验证
first_principle:
  essence: Text2SQL是"语言翻译"问题——自然语言→SQL。
  derivation: 用户要查数据但不会SQL。Text2SQL用LLM把"上月销量top10"翻译成SQL，执行后返回数据。Agent负责理解用户到底要什么(可能需要追问)，Text2SQL负责精准翻译。
  conclusion: Text2SQL在Agent中 = 自然语言到SQL的翻译工具 + 结果解读
follow_up:
- Text2SQL准确率怎么提升？——Schema感知+few-shot+SQL校验
- 复杂查询怎么办？——分步查询+中间结果+Agent编排
- 怎么防SQL注入？——参数化+只读权限+沙箱
memory_points:
- 定位：作为Agent的数据查询技能，将自然语言转为SQL查询并解读结果。
- 执行五步：Schema检索找相关表→LLM生成SQL→SQL校验(防错/注入)→只读执行→结构化返回。
- 安全底线：必须限制数据库为只读权限，且执行前必须进行SQL合法性校验。
---

# Text2SQL 在 Agent 里怎么用？

## 一、Text2SQL 在 Agent 中的定位

```
┌──────────────────────────────────────────────────┐
│          Text2SQL 作为Agent的数据查询能力           │
├──────────────────────────────────────────────────┤
│                                                    │
│  用户: "上个月销量top10的产品"                      │
│       │                                            │
│       ▼                                            │
│  Agent（理解意图）                                  │
│    "用户要查上月销量排名前10的产品"                  │
│       │                                            │
│       ▼                                            │
│  Text2SQL Skill（生成SQL）                         │
│    SELECT product_name, SUM(qty) as sales          │
│    FROM orders WHERE month='last_month'            │
│    GROUP BY product_name ORDER BY sales DESC       │
│    LIMIT 10                                        │
│       │                                            │
│       ▼                                            │
│  Database（执行）                                   │
│    返回: [{product: "手机A", sales: 5000}, ...]    │
│       │                                            │
│       ▼                                            │
│  Agent（解读结果）                                  │
│    "上月销量第一是手机A(5000件)，其次是..."          │
│                                                    │
└──────────────────────────────────────────────────┘
```

## 二、Text2SQL Skill 的实现

```python
class Text2SQLSkill:
    """Agent的Text2SQL能力"""
    
    def __init__(self, db_schema, llm):
        self.schema = db_schema  # 数据库表结构
        self.llm = llm
    
    def execute(self, natural_query):
        """自然语言 → SQL → 结果 → 解读"""
        
        # Step 1: Schema检索（只给相关的表结构）
        relevant_tables = self.find_relevant_tables(natural_query)
        
        # Step 2: 生成SQL
        sql = self.generate_sql(natural_query, relevant_tables)
        
        # Step 3: SQL校验（防错误/注入）
        if not self.validate_sql(sql):
            return self.handle_invalid(sql)
        
        # Step 4: 执行（只读权限）
        try:
            results = self.db.execute(sql, mode="readonly")
        except Exception as e:
            return self.handle_error(e, natural_query)
        
        # Step 5: 返回结构化结果（Agent再解读）
        return {
            "sql": sql,
            "data": results,
            "row_count": len(results)
        }
    
    def generate_sql(self, query, tables):
        """用LLM生成SQL"""
        prompt = f"""
        根据以下数据库结构，生成SQL查询：
        
        表结构:
        {tables}
        
        用户问题: {query}
        
        要求:
        - 只生成SELECT语句（只读）
        - 用标准SQL语法
        - 复杂查询加注释
        
        示例:
        问题: "销量最高的产品"
        SQL: SELECT product_name FROM sales 
             ORDER BY amount DESC LIMIT 1
        """
        return self.llm.generate(prompt)
```

## 三、增强准确率的方法

### 1. Schema RAG（只给相关表）

```python
def find_relevant_tables(self, query):
    """数据库可能有几百张表，只给相关的"""
    # 把表名+描述+字段向量化
    table_embeddings = {t: embed(t.description) for t in self.all_tables}
    # 检索相关的5-10张表
    relevant = top_k_by_similarity(embed(query), table_embeddings, k=8)
    return relevant
    # 而非把几百张表全塞给LLM（会爆token+降低准确率）
```

### 2. Few-shot 示例

```python
# 提供该业务的典型问答示例
FEW_SHOT_EXAMPLES = """
本业务的常见查询模式：

Q: "上个月各部门预算使用情况"
SQL: SELECT dept, SUM(spent)/SUM(budget) as usage_rate
     FROM budgets WHERE month = DATE_SUB(NOW(), INTERVAL 1 MONTH)
     GROUP BY dept

Q: "同比增长率超过20%的产品"
SQL: SELECT product FROM sales 
     GROUP BY product 
     HAVING (SUM(this_year) - SUM(last_year)) / SUM(last_year) > 0.2
"""
```

### 3. SQL 校验与修复

```python
def validate_and_fix(self, sql):
    """校验SQL合法性，错误时自动修复"""
    # 语法检查
    if not is_valid_syntax(sql):
        # 让LLM修复语法
        sql = self.llm.fix_sql(sql, error=syntax_error)
    
    # 安全检查（防止非SELECT）
    if not is_select_only(sql):
        raise SecurityError("只允许SELECT")
    
    # 表名/字段名校验（防幻觉）
    for table in extract_tables(sql):
        if table not in self.real_tables:
            # LLM可能编造了表名
            sql = self.fix_table_name(sql, table)
    
    return sql
```

### 4. 结果验证

```python
def validate_result(self, query, results):
    """验证结果是否合理"""
    # 空结果
    if len(results) == 0:
        return {"warning": "查询无结果，可能是条件太严或表名错误"}
    
    # 异常值检测
    if has_outlier(results):
        return {"warning": "结果有异常值，请核实SQL"}
    
    return {"ok": True}
```

## 四、Agent 编排 Text2SQL

```python
class DataQueryAgent:
    """Agent编排Text2SQL处理复杂数据查询"""
    
    async def handle(self, user_query):
        # 1. 意图理解（要不要查数据？查什么？）
        intent = self.understand(user_query)
        
        if intent.needs_clarification:
            return await self.clarify(intent)
        
        # 2. 调用Text2SQL
        sql_result = await self.text2sql.execute(intent.data_need)
        
        # 3. 结果不足？多轮查询
        if sql_result.insufficient:
            # Agent决定追问或补充查询
            follow_up = await self.plan_followup(sql_result)
            additional = await self.text2sql.execute(follow_up)
            sql_result = merge(sql_result, additional)
        
        # 4. 结果解读（转成用户易懂的）
        return await self.interpret(user_query, sql_result)
    
    async def interpret(self, query, data):
        """把数据转成自然语言解读"""
        prompt = f"""
        用户问: {query}
        查询结果: {data}
        
        请用简洁的语言解读这个数据，突出关键发现。
        可以用表格/列表让信息更清晰。
        """
        return await self.llm.generate(prompt)
```

## 五、复杂查询的分步处理

```
用户: "对比近三年各产品线的增长趋势，找出增长最快的"

Agent分解（太复杂无法一次SQL查）：
  Step 1: 查三年各产品线销量
    SQL: SELECT year, product_line, SUM(qty) FROM sales
         WHERE year >= 2023 GROUP BY year, product_line
  
  Step 2: Agent计算增长率
    基于Step1数据，计算各产品线年增长率
  
  Step 3: 排序找最快
    Agent从计算结果中找增长最快的
  
  Step 4: 生成对比图表+解读
```

## 六、安全与治理

```python
class Text2SQLSecurity:
    """Text2SQL的安全治理"""
    
    # 1. 只读权限
    DB_USER = "readonly_user"  # 只读账号
    
    # 2. SQL白名单
    def check(self, sql):
        assert is_select_only(sql)  # 只允许SELECT
        assert not contains_dangerous_functions(sql)  # 禁危险函数
    
    # 3. 数据脱敏
    def mask_sensitive(self, results):
        for row in results:
            if "phone" in row:
                row["phone"] = mask(row["phone"])  # 138****1234
    
    # 4. 查询限制
    MAX_ROWS = 1000  # 最多返回1000行
    QUERY_TIMEOUT = 30  # 30秒超时
```

## 七、面试加分点

1. **定位为 Skill/工具**：Text2SQL 不是独立的，而是 Agent 的数据查询能力——Agent 负责意图理解和结果解读
2. **Schema RAG**：表多时只给相关的，而非全塞——这是准确率的关键
3. **安全治理**：只读权限+SQL 校验+脱敏，体现生产级思维

## 记忆要点

- 定位：作为Agent的数据查询技能，将自然语言转为SQL查询并解读结果。
- 执行五步：Schema检索找相关表→LLM生成SQL→SQL校验(防错/注入)→只读执行→结构化返回。
- 安全底线：必须限制数据库为只读权限，且执行前必须进行SQL合法性校验。


## 苏格拉底式面试追问

> 这组追问模拟面试官层层逼问，每一问先回答"为什么"，再回答"怎么做"，最后回答"如何证明"。

### 第一层：目标与动机

**Q：Text2SQL 在 Agent 里是"Agent 负责意图，Text2SQL 负责生成 SQL"，为什么不直接让 LLM 一步生成 SQL（而非拆成 Agent+Text2SQL 两层）？**

因为拆分让各层职责清晰、各自优化。1）Agent 层——负责理解用户意图（用户要什么数据/是否需要查数据库/还涉及其他操作如分析），决定"该用 Text2SQL 这个工具"，专注意图理解和任务编排；2）Text2SQL 层——专注 SQL 生成（给定 schema 和 query 生成正确 SQL），可用专门优化（如针对 schema 的 fine-tune/RAG），生成质量高；3）直接生成的弊端——LLM 一步生成 SQL 时，既要理解意图又要懂 schema+SQL 语法，任务耦合，且无法复用（换场景要重训）；拆分后 Text2SQL 可独立优化（如加 schema linking/示例），Agent 可灵活编排（Text2SQL 只是 Agent 的一个工具）。类比：分工比一人全包更专业高效。

### 第二层：证据与定位

**Q：Text2SQL 生成的 SQL 执行结果不对（查出的数据错），怎么定位是 Text2SQL 生成错（SQL 写错）还是 Agent 理解错（不该查这个）？**

分层验证。1）Agent 层——看 Agent 是否正确理解意图（如用户问"A 产品销量"，Agent 是否判断该查 sales 表而非 orders 表），如果 Agent 选错工具或理解错意图，是 Agent 问题；2）Text2SQL 层——把 Agent 传给 Text2SQL 的 query 和 schema 打印出来，人工判断"这个 query 该生成什么 SQL"，对比 Text2SQL 实际生成的 SQL，不符是 Text2SQL 问题；3）执行层——SQL 对但结果错（如数据库脏数据/权限问题），是数据库问题。定位方法：trace 每层（Agent 的意图判断→Text2SQL 的 query/schema→生成的 SQL→执行结果），找第一层出错的。常见根因：Text2SQL 的 schema linking 错（选错表/字段）、SQL 语法错（join 条件错）、Agent 意图歧义（用户问的含糊）。

### 第三层：根因深挖

**Q：Text2SQL 的关键挑战是"schema linking"（把用户提到的实体映射到正确的表/字段），schema 错了 SQL 必错，怎么做好 schema linking？**

三步法。1）Schema 理解——把数据库 schema 结构化提供给 LLM（表名/字段名/字段含义/表间关系/示例值），让 LLM 理解每个表字段是什么；2）实体映射——用户提到的实体（如"A 产品的销量"中的"销量"）映射到字段（如 sales.amount），用语义匹配（embedding 相似度）或 LLM 判断（给定 schema 让 LLM 选对应字段）；3）歧义消解——同名/多义字段（如多个表都有 amount）要消歧，用上下文（如用户提了"A 产品"则选 product_sales 表的 amount）或反问用户（高歧义时）。进阶：schema 太大时先检索相关表（向量检索 top-K 表），再做 linking（避免把全 schema 塞给 LLM）。验证：统计 schema linking 准确率（选对字段的比例），低则优化 schema 描述/检索。

**Q：Text2SQL 生成的 SQL 可能有语法错/性能差（如全表扫描），Agent 调用后执行失败/超时，怎么治理？**

三层防护。1）语法校验——Text2SQL 生成 SQL 后先用 SQL parser（如 sqlparse）校验语法，语法错的拒绝执行并让 Text2SQL 重新生成（self-correction）；2）性能检查——对生成的 SQL 做执行计划分析（EXPLAIN），如果发现全表扫描/笛卡尔积等高风险操作，警告或限制（如加 LIMIT/拒绝无 WHERE 的 DELETE）；3）执行兜底——执行时设超时/行数上限（如最多返回 1000 行），防止大查询拖垮数据库；失败时 Agent 告知用户"查询失败，请细化问题"。进阶：收集执行失败的 SQL 和原因，反馈给 Text2SQL 训练（RL/示例补充），让生成质量持续提升。目标：不放过语法错（校验），不执行高风险（检查），不拖垮库（兜底）。

### 第四层：方案权衡

**Q：Text2SQL 可以是"LLM 直接生成"或"专门训练的模型"（fine-tune），两者怎么选？**

按"schema 复杂度和准确率要求"选。1）LLM 直接生成——用通用大模型（如 GPT-4）+ prompt（含 schema+示例）生成 SQL，适合"schema 简单/准确率要求适中"的场景，零训练成本，快速上线；2）专门模型——用 Text2SQL 数据集（如 Spider/BIRD）fine-tune 小模型（如 CodeLlama/SQLCoder），适合"schema 复杂/准确率要求高"的场景，准确率高（专门优化）但需训练数据和成本。决策：schema 表少（<10 表）/ad-hoc 查询用 LLM 直接（快）；schema 复杂（几十上百表）/高频生产查询用专门模型（准）。折中：LLM 直接生成 + 大量 few-shot 示例（来自历史正确 SQL），介于两者之间。

**Q：Text2SQL 在 Agent 里是一个工具（Agent 按需调用），为什么不直接做成独立服务（用户直接和 Text2SQL 交互）？**

按"用户需求复杂度"决定。1）独立服务——用户直接说"查 A 产品销量"→ Text2SQL 生成 SQL → 返回数据，适合"单一查数据"场景（简单），无 Agent 编排开销；2）Agent 工具——Agent 理解意图（用户可能不只查数据，还要分析/可视化/导出），按需调用 Text2SQL（查数据）+ 其他工具（分析/导出），适合"复合任务"场景（如"查销量并分析趋势"）。选型：纯查数据用独立服务（简单直接），复合任务用 Agent（灵活编排）。实务：数据平台（纯查询）用独立 Text2SQL，业务助手（查+分析+操作）用 Agent 集成 Text2SQL 作为工具。

### 第五层：验证与沉淀

**Q：你怎么衡量 Text2SQL 在 Agent 里的效果（SQL 生成准不准、整体有没有帮到用户）？**

两个层次指标。1）Text2SQL 层——执行准确率（生成的 SQL 执行结果和 golden 一致的比例，最严格）、SQL 语法正确率（语法对的，松一些）、schema linking 准确率（选对字段的比例），用 Spider/BIRD 等标准集 + 业务真实 query 测；2）Agent 层——任务完成率（用户的数据需求是否满足）、用户满意度（查询结果是否符合预期）、效率（从 query 到结果的平均时长/轮次）。Text2SQL 准但 Agent 编排错（如该查没查）整体也失败，所以要双层次看。还要监控"SQL 执行失败率"（语法/性能问题），高则治理 Text2SQL 生成质量。

**Q：Text2SQL 在 Agent 里的集成怎么沉淀成团队的数据查询能力？**

建 Text2SQL 平台：1）Schema 管理——统一管理各业务库的 schema（表/字段/关系/示例），支持版本化，Text2SQL 动态拉取；2）模型服务——Text2SQL 模型（LLM 或专门模型）作为统一服务，Agent/应用按需调用（传入 query+schema 返回 SQL）；3）质量治理——执行准确率/失败率自动统计，失败 SQL 收集反馈训练，持续提升；4）安全防护——SQL 校验（语法/性能/权限），防注入/防危险操作（如删表）；5）评估集——业务真实 query 标注的评估集，定期评估模型质量。这套写入团队数据平台 SOP，让"自然语言查数据"从"每个应用自己实现"变成"统一平台能力"，Agent/应用按需调用。

## 结构化回答

**30 秒电梯演讲：** Text2SQL在Agent里=把"自然语言查数据"封装为Agent的一个Skill/工具。Agent负责理解意图，Text2SQL负责生成SQL查数据库，再由Agent解读结果。

**展开框架：**
1. **定位** — Text2SQL作为Agent的数据查询工具
2. **流程** — 意图理解→SQL生成→执行→结果解读
3. **难点** — 复杂SQL/多表/业务语义

**收尾：** 您想深入聊：Text2SQL准确率怎么提升？——Schema感知+few-shot+SQL校验？


## 视频脚本

> 预计时长：4 分钟 | 由浅入深


| 时间 | 画面/字幕 | 口播台词 | 讲解要点 |
|------|----------|----------|----------|
| 0:00 | 标题卡：Text2SQL 在 Agent 里怎么用？ | "像有个翻译员——你用大白话说"查上月销量"，翻译员(Text2SQL)转成SQL去数据库查…" | 开场钩子 |
| 0:20 | 核心概念图 | "Text2SQL在Agent里=把"自然语言查数据"封装为Agent的一个Skill/工具。Agent负责理解意图…" | 核心定义 |
| 0:50 | 定位示意图 | "定位——Text2SQL作为Agent的数据查询工具" | 要点拆解1 |
| 1:30 | 对比/实战案例图 | "对比一下常见误区和工程实践，看真实场景里怎么取舍。" | 实战与对比 |
| 2:20 | 总结卡 | "记住核心要点。下期我们追问：Text2SQL准确率怎么提升？——Schema感知+few？" | 收尾与钩子 |
