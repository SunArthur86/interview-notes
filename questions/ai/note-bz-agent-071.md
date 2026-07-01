---
id: note-bz-agent-071
difficulty: L3
category: ai
subcategory: Prompt
tags:
- B站面经
- Prompt工程
- 版本控制
- 动态组装
feynman:
  essence: Prompt版本控制=像代码一样管理Prompt(git/语义版本/AB测试)。动态组装=根据上下文/用户/场景，运行时拼接不同的Prompt片段。
  analogy: 像管理法律条文——有版本(修订)、有模块(总则/分则)、按场景组合(民事用民法，刑事用刑法)。
  first_principle: Prompt是"资产"不是"写死的字符串"。需要版本管理(可追溯)、模块化(可复用)、动态组装(个性化)。
  key_points:
  - 版本控制：git管理/语义版本/变更日志
  - 模块化：Prompt片段独立管理
  - 动态组装：按上下文拼接
  - AB测试：多版本对比
first_principle:
  essence: Prompt是会演进的活资产，需要软件工程的管理方法。
  derivation: Prompt会随业务迭代而变化(改措辞/加规则/调格式)。硬编码在代码里→难追溯难回滚。版本管理+模块化+动态组装=把Prompt当软件资产管。
  conclusion: Prompt工程化 = 版本管理(可追溯) + 模块化(可复用) + 动态组装(个性化)
follow_up:
- Prompt存哪里？——独立文件/数据库/Prompt管理平台
- 怎么回滚？——版本管理，发现退化立即切回旧版
- 多语言怎么办？——Prompt模板按语言维护
memory_points:
- 管理同代码：独立文件存储，遵循语义化版本号（不兼容变主版）
- 模块化拆分：把Prompt拆为角色、规则、工具、示例等可复用零件
- 动态组装核心：因为用户和任务不同，所以按上下文变量（如身份）按需拼接模块
---

# 如何对 Prompt 做版本控制与动态组装？

## 一、Prompt 版本控制

```
┌──────────────────────────────────────────────┐
│              Prompt 版本管理                     │
├──────────────────────────────────────────────┤
│                                                │
│  1. 独立存储（不硬编码在代码里）                │
│     prompts/                                   │
│     ├── customer_service/                      │
│     │   ├── v1.0/                             │
│     │   ├── v1.1/                             │
│     │   └── v2.0/ (current)                   │
│     ├── coding_assistant/                      │
│     └── analysis/                              │
│                                                │
│  2. 语义版本号                                  │
│     MAJOR: 不兼容变更（输出格式改了）           │
│     MINOR: 向后兼容新增（加了新规则）           │
│     PATCH: 修复（改了措辞）                    │
│                                                │
│  3. 变更日志                                    │
│     v2.0: 重构客服流程，新增退款处理            │
│     v1.1: 优化语气约束                         │
│     v1.0: 初始版本                             │
│                                                │
│  4. Git管理                                     │
│     和代码一样commit/branch/review             │
│                                                │
└──────────────────────────────────────────────┘
```

## 二、模块化 Prompt

```python
# 把长Prompt拆成可复用的模块
PROMPT_MODULES = {
    # 角色模块
    "role_customer_service": "你是XX客服，专业友善...",
    "role_tech_expert": "你是技术专家，严谨精确...",
    
    # 规则模块
    "rules_safety": """
    安全规则：
    - 不输出有害内容
    - 不泄露用户隐私
    """,
    "rules_format": """
    输出格式：
    - 用Markdown
    - 关键信息加粗
    """,
    
    # 工具说明模块
    "tools_search": "可用工具: search(query)搜索信息",
    "tools_database": "可用工具: query_db(sql)查数据库",
    
    # Few-shot模块
    "examples_simple_qa": "...",
    "examples_complex": "...",
}
```

## 三、动态组装

```python
class PromptAssembler:
    """根据上下文动态组装Prompt"""
    
    def assemble(self, context: dict) -> str:
        """
        context = {
            "user_role": "vip",        # 用户类型
            "task_type": "refund",     # 任务类型
            "language": "zh",          # 语言
            "available_tools": [...],  # 可用工具
            "history": [...],          # 对话历史
        }
        """
        parts = []
        
        # 1. 角色（按用户类型选）
        role = self.select_role(context["user_role"])
        parts.append(role)
        
        # 2. 任务特定指令
        task_prompt = self.task_prompts[context["task_type"]]
        parts.append(task_prompt)
        
        # 3. 工具说明（按实际可用工具）
        tools = self.format_tools(context["available_tools"])
        parts.append(tools)
        
        # 4. 安全规则（总是包含）
        parts.append(PROMPT_MODULES["rules_safety"])
        
        # 5. 语言特定规则
        if context["language"] != "zh":
            parts.append(self.language_rules[context["language"]])
        
        # 6. 个性化（VIP用户特殊处理）
        if context["user_role"] == "vip":
            parts.append("这是VIP用户，提供更优先的服务...")
        
        return "\n\n".join(parts)
```

## 四、版本管理与A/B测试

```python
class PromptManager:
    """Prompt管理平台"""
    
    def get_prompt(self, name, version="latest"):
        """获取指定版本的Prompt"""
        if version == "latest":
            return self.registry.get_latest(name)
        return self.registry.get(name, version)
    
    def ab_test(self, name, version_a, version_b, traffic_split=0.5):
        """A/B测试两个版本"""
        def get_version(user_id):
            # 按用户ID分流（同一用户始终同一版本）
            return version_a if hash(user_id) % 2 == 0 else version_b
        
        return get_version
    
    def rollback(self, name, to_version):
        """回滚到旧版本"""
        self.registry.set_current(name, to_version)
        alert(f"Prompt {name} 回滚到 {to_version}")
```

## 五、运行时动态组装示例

```python
# 场景：客服系统，根据用户类型和问题动态组装

async def get_response(user, message):
    # 1. 分析上下文
    context = {
        "user_role": user.tier,           # free/vip/enterprise
        "task_type": classify(message),    # query/refund/complaint
        "language": user.locale,
        "available_tools": get_user_tools(user),
        "history": get_recent_messages(user),
    }
    
    # 2. 动态组装Prompt
    prompt = prompt_assembler.assemble(context)
    
    # 3. A/B测试（如果有）
    version = ab_tester.get_version("customer_service", user.id)
    prompt = prompt_manager.get_prompt("customer_service", version)
    
    # 4. 调用LLM
    response = await llm.chat(prompt + f"\n用户: {message}")
    
    return response

# 不同用户/场景 → 不同Prompt，而非一个Prompt打天下
```

## 六、Prompt 管理平台架构

```
┌──────────────────────────────────────────────────┐
│            Prompt 管理平台                          │
├──────────────────────────────────────────────────┤
│                                                    │
│  编辑层：可视化编辑Prompt + 模块管理               │
│                                                    │
│  版本层：版本管理 + 变更日志 + 审批                │
│                                                    │
│  测试层：A/B测试 + 回归测试 + 评估                 │
│                                                    │
│  部署层：灰度发布 + 回滚 + 监控                    │
│                                                    │
│  存储层：Prompt仓库（DB + Git）                    │
│                                                    │
└──────────────────────────────────────────────────┘

价值：
  - 非技术人员可编辑Prompt（产品/运营）
  - 版本可追溯，出问题可回滚
  - A/B测试数据驱动优化
  - 模块复用减少重复
```

## 七、面试加分点

1. **Prompt 是资产**：和代码一样需要版本管理——这个认知很关键
2. **动态组装**：不同场景不同 Prompt，而非一个打天下——体现工程化
3. **A/B 测试**：Prompt 优化要数据驱动，不能拍脑袋——体现实证思维

## 记忆要点

- 管理同代码：独立文件存储，遵循语义化版本号（不兼容变主版）
- 模块化拆分：把Prompt拆为角色、规则、工具、示例等可复用零件
- 动态组装核心：因为用户和任务不同，所以按上下文变量（如身份）按需拼接模块

