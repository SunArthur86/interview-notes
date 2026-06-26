---
id: note-bz-agent-036
difficulty: L3
category: ai
subcategory: Agent
tags:
  - B站面经
  - Skill
  - Agent
feynman:
  essence: Skill=Agent的可复用能力封装，本质是"Prompt+工具+流程"的组合包。像一个"技能模块"，调用就能完成一类任务，而非每次从零写prompt。
  analogy: 像游戏的技能系统——"火球术"封装了(施法动作+伤害计算+特效)，玩家一键释放，而非每次手动组合。Skill=Agent的"技能"。
  first_principle: 复杂任务需要"prompt+多工具+特定流程"的组合，每次重新组合低效且不稳定。Skill把这些固化成可复用模块。
  key_points:
    - Skill = Prompt + Tools + Flow 的封装
    - 本质：可复用的能力模块
    - 价值：标准化/可复用/可分享
    - 区别Tool：Tool是单一操作，Skill是多步组合
first_principle:
  essence: Skill是"设计模式"在Agent中的应用——把验证有效的prompt+工具组合，固化为可复用单元。
  derivation: '单个Tool是原子操作。复杂任务需要多个Tool+特定prompt+控制流。如果每次重写，质量不稳定。Skill=把这些固化，像函数一样调用。'
  conclusion: Skill = 封装(Prompt + Tools + Flow)，是Agent的能力复用单元
follow_up:
  - Skill和Tool什么区别？——Tool是单步操作，Skill是多步组合
  - Skill怎么分享复用？——打包成标准格式(如SKILL.md)，社区共享
  - Skill Creator是什么？——自动生成Skill的工具
---

# 什么是 Skill？Agent 架构中 Skill 的本质是什么？

## 一、Skill 的定义

**Skill** = Agent 的**可复用能力模块**，封装了完成某类任务所需的 **Prompt + Tools + 执行流程**。

```
┌──────────────────────────────────────────────┐
│              Skill 的组成                       │
├──────────────────────────────────────────────┤
│                                                │
│  1. 触发条件 (Trigger)                         │
│     什么时候该用这个Skill                       │
│                                                │
│  2. 系统提示词 (Prompt)                        │
│     执行这个任务的行为指导                      │
│                                                │
│  3. 工具依赖 (Tools)                           │
│     这个Skill需要调用哪些工具                   │
│                                                │
│  4. 执行流程 (Flow)                            │
│     步骤编排、条件分支、错误处理                │
│                                                │
│  5. 输入输出Schema                             │
│     接受什么输入，产出什么输出                   │
│                                                │
└──────────────────────────────────────────────┘
```

## 二、Skill vs Tool 的区别

```
┌────────────┬──────────────────┬──────────────────────┐
│ 维度        │ Tool               │ Skill                  │
├────────────┼──────────────────┼──────────────────────┤
│ 粒度        │ 原子操作           │ 多步组合                │
│ 复杂度      │ 单一功能           │ 复杂能力                │
│ 组成        │ 一个函数           │ Prompt+Tools+Flow      │
│ 例子        │ search()/send()   │ "写技术博客"            │
│ 可复用      │ 代码级             │ 能力级（可分享）         │
└────────────┴──────────────────┴──────────────────────┘

例：
  Tool: web_search(q) → 单纯搜索
  Skill: "技术调研" = search + 分析 + 总结 + 生成报告
         （组合了多个Tool + 特定Prompt + 流程）
```

## 三、Skill 的本质：能力封装

```python
# 一个Skill的伪代码示例
class TechnicalResearchSkill:
    """技术调研Skill：从搜索到报告的完整流程"""
    
    name = "technical_research"
    description = "对某技术主题进行调研并生成报告"
    trigger = "用户要求'调研''分析''对比'某技术时"
    
    # 依赖的工具
    tools = ["web_search", "read_url", "write_file"]
    
    # 系统提示词（定义这个Skill的行为）
    system_prompt = """
    你是技术调研专家。流程：
    1. 搜索主题的最新信息
    2. 阅读关键文章提取要点
    3. 对比不同方案的优劣
    4. 生成结构化调研报告
    
    要求：客观、有数据支撑、标注来源
    """
    
    # 执行流程
    def execute(self, topic):
        # Step 1: 搜索
        results = self.tools["web_search"](topic)
        
        # Step 2: 深入阅读
        insights = []
        for url in results[:3]:
            content = self.tools["read_url"](url)
            insights.append(self.llm.extract_keypoints(content))
        
        # Step 3: 综合
        report = self.llm.generate_report(topic, insights)
        
        # Step 4: 保存
        self.tools["write_file"](f"{topic}_报告.md", report)
        
        return report
```

## 四、Skill 的价值

```
1. 标准化
   - 验证有效的流程固化，每次执行质量稳定
   - 不依赖"每次prompt写得好不好"

2. 可复用
   - 一次开发，多次使用
   - 跨项目/跨团队共享

3. 可分享（生态）
   - Skill可以打包成标准格式（如SKILL.md）
   - 社区共享，像"应用商店"
   - 例: Claude的Skills市场

4. 可组合
   - 复杂Skill可以调用简单Skill
   - 像积木一样构建复杂能力

5. 可迭代
   - Skill独立于Agent主逻辑
   - 优化某个Skill不影响整体
```

## 五、Skill 的设计原则

```
┌──────────────────────────────────────────────┐
│              Skill 设计原则                     │
├──────────────────────────────────────────────┤
│                                                │
│  1. 单一职责                                   │
│     一个Skill专注一类任务                       │
│     "写报告"不要既写技术报告又写财务报告         │
│                                                │
│  2. 清晰边界                                   │
│     明确什么场景用、什么场景不用                  │
│     避免与其他Skill职责重叠                      │
│                                                │
│  3. 明确Schema                                 │
│     输入输出格式定义清楚                        │
│     便于和其他Skill/Agent组合                   │
│                                                │
│  4. 容错设计                                   │
│     工具失败有降级方案                          │
│     不确定时返回"需要人工"                       │
│                                                │
│  5. 可测试                                     │
│     有标准测试用例                             │
│     能评估Skill质量                             │
│                                                │
└──────────────────────────────────────────────┘
```

## 六、Skill 生态（以 Claude Code 为例）

```
Claude Code 的 Skill 机制：
  
  SKILL.md 格式：
  ---
  name: pdf-extractor
  description: 从PDF提取表格和文本
  triggers: ["提取PDF", "解析文档"]
  tools: [read_file, python_execute]
  ---
  
  # PDF提取流程
  1. 读取PDF文件
  2. 用pdfplumber提取表格
  3. 清洗数据
  4. 输出结构化结果
  
  价值：
  - 开发者写一次，所有人可用
  - Claude自动根据用户需求匹配Skill
  - 形成"Agent能力市场"
```

## 七、面试加分点

1. **Tool vs Skill 的粒度区别**：Tool 是原子操作，Skill 是能力组合——这个区分是核心
2. **强调"复用"**：Skill 的价值是"一次开发多次使用"，像软件库一样
3. **提生态价值**：Skill 可分享可组合，是 Agent 生态的基础（类比 App 之于手机）
