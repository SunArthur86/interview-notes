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

