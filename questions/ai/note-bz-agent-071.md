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

## 苏格拉底式面试追问

> 这组追问模拟面试官层层逼问，每一问先回答"为什么"，再回答"怎么做"，最后回答"如何证明"。

### 第一层：目标与动机

**Q：你为什么坚持 Prompt 要独立存储走 git，而不是直接放在代码里加配置中心热更？放在代码里 code review 还更严格，不是更可控吗？**

因为 Prompt 的变更频率和代码不同步。Prompt 改一个措辞、加一条规则是按天/按周迭代的，但代码是按双周发版的。如果 Prompt 绑在代码里，改一句 Prompt 要等一个发版窗口，业务响应太慢。放配置中心能热更，但丢了 git 的可追溯和 diff 能力——Prompt 的退化往往就是某次小改动引入的，没有 commit 历史就查不到。所以我的方案是 Prompt 独立存 git + 配置中心拉取热更，既有版本可追溯又有热更能力。

### 第二层：证据与定位

**Q：你用语义化版本号，但 Prompt 又不是 API，怎么判断什么改动算 MAJOR 不兼容变更？**

判断标准不是凭感觉，是看下游解析逻辑是否要改。如果改了输出格式（比如把 `sentiment` 字段从枚举改成 free text），下游 `json.loads` 后的字段处理要改，这就是 MAJOR，版本号 1.x → 2.0。如果只是改 Prompt 措辞让回答更专业、输出 schema 没变，下游代码不用动，就是 MINOR 或 PATCH。我会维护一个"下游契约测试"——用旧版的预期输出做 golden case，新版本跑这些 case，字段结构对不上就强制升 MAJOR。

### 第三层：根因深挖

**Q：你做 A/B 测试时新版本 Prompt 评测准确率高 3%，但线上 metrics 反而下降了，根因是什么？**

最可能是评测集和线上分布不一致。评测集往往是早期标注的、偏向典型 case，而线上有大量长尾输入——新 Prompt 在典型 case 上优化了，但在长尾上反而劣化。根因是评测集偏置（selection bias）。定位方法是看线上失败 case 分布：如果失败集中在评测集没覆盖的输入类型（比如含错别字、超长输入），就是评测集不够。补法是把线上失败样本采样进评测集，再做下一轮 A/B。

**Q：那为什么不直接拿线上全量流量做评判，还要费劲维护离线评测集？**

因为线上 metrics 是混淆变量。线上准确率受召回、路由、天气、节假日流量分布影响，A/B 只能把流量分桶（5% vs 5%），样本量小、噪声大，3% 的提升可能统计上不显著。离线评测集是固定 200-500 条、固定种子、固定模型版本，能做配对显著性检验（p-value < 0.05），结论可信。线上 A/B 只在离线通过后才做，用来验证真实环境下的鲁棒性。

### 第四层：方案权衡

**Q：动态组装你说是按上下文拼模块，但如果一个客服场景有 10 个模块，每次组装都拼全，Token 数爆炸又慢，你怎么取舍？**

不全拼，按需选模块。核心是"组装引擎"根据意图分类结果决定用哪几个模块。比如意图识别出来是"退款咨询"，就拼【退款规则模块 + 退款流程示例 + 安全省词】，不拼【售前咨询模块、产品介绍模块】。这样单次 Prompt Token 控在 800-1500 之间。取舍标准是召回率 vs Token 成本的平衡：模块漏拼会导致能力缺失，所以我用意图分类的置信度兜底——置信度 < 0.7 时拼"全量模块"保召回，> 0.7 时拼"精选模块"省 Token。

**Q：为什么不直接把所有模块塞进 Prompt 让模型自己选，反正大模型上下文够长？**

三个原因。一是成本——Token 是按输入算钱的，每次塞 4000 Token 的全量模块，比精选 1000 Token 贵 4 倍。二是效果——上下文越长模型越容易"中间遗忘"，无关模块会干扰目标模块的指令跟随。三是延迟——首字延迟（TTFT）随输入 Token 线性增长，塞满会让 TTFT 从 500ms 涨到 2s。所以"够长"不代表"该塞满"，按需组装是成本/效果/延迟的最优解。

### 第五层：验证与沉淀

**Q：你怎么证明这套版本管理真的减少了线上事故，而不是增加了流程负担？**

对比引入前后的两个指标：一是从"Prompt 改动到上线"的平均时长，二是因 Prompt 变更导致的线上事故数。我之前的项目数据是：引入 git+评测后，上线时长从 3 天降到 4 小时（因为不用排发版窗口），线上事故从每月 2-3 次（措辞改坏没回滚）降到每季度 1 次（评测集拦住了退化）。证明逻辑是：流程没有拖慢迭代速度，反而因为可热更更快；评测护栏把退化挡在了上线前。

**Q：这套机制怎么让新人快速上手不踩坑？**

沉淀一份《Prompt 变更 SOP》+ 模板仓库。SOP 规定：改 Prompt 必须带评测集回归报告、必须升版本号、必须写 changelog。模板仓库预置了【角色/规则/示例/格式】四个标准模块的写法范例、评测集的 schema、CI 脚本。新人照着改一个 Prompt 就能跑通全流程，不用记规则，靠工具护栏。

## 结构化回答



**30 秒电梯演讲：** 像管理法律条文——有版本(修订)、有模块(总则/分则)、按场景组合(民事用民法，刑事用刑法)。

**展开框架：**
1. **版本控制** — git管理/语义版本/变更日志
2. **模块化** — Prompt片段独立管理
3. **动态组装** — 按上下文拼接

**收尾：** Prompt存哪里？




## 视频脚本

> 预计时长：4 分钟 | 由浅入深


| 时间 | 画面/字幕 | 口播台词 | 讲解要点 |
|------|----------|----------|----------|
| 0:00 | 标题卡：如何对 Prompt 做版本控制与动态组装？ | "像管理法律条文——有版本(修订)、有模块(总则/分则)、按场景组合(民事用民法，刑事用刑法…" | 开场钩子 |
| 0:20 | 核心概念图 | "Prompt版本控制=像代码一样管理Prompt(git/语义版本/AB测试)。动态组装=根据上下文/用户/场景，运行时…" | 核心定义 |
| 0:50 | 版本控制示意图 | "版本控制——git管理/语义版本/变更日志" | 要点拆解1 |
| 1:30 | 对比/实战案例图 | "对比一下常见误区和工程实践，看真实场景里怎么取舍。" | 实战与对比 |
| 2:20 | 总结卡 | "记住核心要点。下期我们追问：Prompt存哪里？——独立文件/数据库/Prompt管理平？" | 收尾与钩子 |
