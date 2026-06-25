---
id: note-tx3-001
difficulty: L4
category: ai
subcategory: Agent
tags:
  - 腾讯
  - 微信读书
  - 三面
  - 面经
  - 上下文管理
  - Claude Code
  - 长文本创作
feynman:
  essence: 用AI写书不是把全书塞进上下文，而是建立"项目圣经"+分章文件+按需检索+子Agent全局检查的架构。/compact只是应急手段，不是主策略
  analogy: 就像写毕业论文——你不会把所有参考文献一字不差记在脑子里（塞满上下文），而是建一个研究笔记库（bible.md），每章只看需要的文献（按需检索），让同学帮你通读全文找问题（subagent）
  first_principle: 写书的核心矛盾是"全书总量远超单次上下文"与"每章需保持全书一致性"。解法不是硬撑上下文，而是换架构思维——把长内容拆成文件，把记忆换成按需检索
  key_points:
    - 项目圣经（bible.md）：全书大纲+人物设定+世界观+文风要求
    - CLAUDE.md自动加载：每次新会话自动读取项目配置
    - 每章独立文件+摘要：写完生成200字摘要供后续章节参考
    - 按章开新会话：每次只带入最小信息集
    - Subagent全局检查：扫描所有章节只汇报结论
    - /compact定位：应急补救而非主策略
first_principle:
  essence: AI辅助创作的本质是"在有限上下文窗口内管理长周期、大体量内容"，这是架构问题不是Prompt问题
  derivation: '假设一本小说20万字、50章，每章4000字。GPT-4上下文128K≈10万字。显然无法装入全书。但写每章时需要：大纲(2000字)+人物设定(5000字)+前章摘要(200字×N章)+本章大纲(500字)。N=5时总计≈8500字，完全够用'
  conclusion: AI写书 = 文件化拆分 + 按需检索 + 分层记忆 + 子Agent质检，/compact只在上溢时应急
follow_up:
  - 人物设定在后续章节出现矛盾怎么办？如何自动检测？
  - 如果需要跨章节伏笔（第1章埋线索，第30章揭晓），怎么保证不被遗忘？
  - 这种方法适用于其他长文本场景（如技术文档、法律合同）吗？
---

# 用AI辅助写一本书，内容很长容易超过上下文长度，你怎么处理？

> 腾讯微信读书大模型开发岗三面场景题。面试官追问：/compact压缩上下文可以，但还有更好的手段吗？

## /compact的问题

```
/compact能做什么：
  ✅ 压缩当前会话历史 → 释放Token空间
  ✅ 应急手段，上下文快满了先压一压

/compact不能做什么：
  ❌ 解决全书一致性（压缩后对前文记忆变模糊）
  ❌ 防止人物性格漂移、设定遗忘
  ❌ 处理跨章节伏笔和逻辑链条

核心问题：/compact解决的是"放不下"，没解决"怎么用得好"
```

## 正确架构：文件化 + 按需检索

```
项目目录结构：
book-project/
├── CLAUDE.md          ← Claude Code自动读取的项目配置
├── bible.md           ← 项目圣经（全书核心设定）
├── chapters/
│   ├── ch01.md        ← 第1章正文
│   ├── ch01_sum.md    ← 第1章摘要（200字）
│   ├── ch02.md
│   ├── ch02_sum.md
│   └── ...
├── characters/
│   ├── protagonist.md ← 主角设定卡
│   ├── antagonist.md  ← 反派设定卡
│   └── ...
├── outline.md         ← 全书大纲
└── checklist.md       ← 伏笔/线索检查清单
```

## 第一步：建立项目圣经

```markdown
<!-- bible.md: 精简到几百~一两千字，每次完整带入上下文 -->

# 项目圣经

## 世界观
- 时代：近未来2077年
- 背景：AI觉醒后的人类社会分裂为"拥抱派"和"抵抗派"

## 核心人物
- 林晓：女，28岁，AI伦理学家，表面拥抱派实则中立
- 零号：男，外表25岁的第一个觉醒AI，温和但隐藏目的

## 文风要求
- 第三人称限制视角，主要跟随林晓
- 对话简洁有力，避免大段独白
- 悬疑节奏，每章结尾留钩子

## 全书大纲
- 第一幕（Ch1-10）：发现→调查→震惊
- 第二幕（Ch11-30）：对抗→合作→背叛
- 第三幕（Ch31-50）：真相→抉择→结局
```

```markdown
<!-- CLAUDE.md: 每次新会话自动读取 -->

# 写作规则

1. 写每章前先读 bible.md 和前一章摘要
2. 每章3000-5000字
3. 写完后生成200字摘要存为 chXX_sum.md
4. 人物对话必须符合 characters/ 中的设定
5. 发现伏笔冲突时更新 checklist.md
```

## 第二步：每章一个文件 + 摘要

```python
# 每章写作的上下文组装策略
def build_chapter_context(chapter_num: int) -> str:
    context_parts = []

    # 1. 项目圣经（每次完整带入，约1000字）
    context_parts.append(read_file('bible.md'))

    # 2. 当前章大纲（约500字）
    context_parts.append(get_chapter_outline(chapter_num))

    # 3. 最近3章摘要（200字×3=600字）
    for i in range(max(1, chapter_num-3), chapter_num):
        context_parts.append(read_file(f'chapters/ch{i:02d}_sum.md'))

    # 4. 本章涉及角色的设定卡（按需加载）
    characters = get_characters_in_chapter(chapter_num)
    for char in characters:
        context_parts.append(read_file(f'characters/{char}.md'))

    # 总计：1000+500+600+500 ≈ 2600字（远小于上下文窗口）
    return '\n---\n'.join(context_parts)
```

## 第三步：按章开新会话

```bash
# 写第15章：开新会话，只带入最小信息集
# CLAUDE.md会自动加载
claude-code --session new

> "请读 bible.md、ch14_sum.md、ch13_sum.md、ch12_sum.md，
>  然后按大纲写第15章。本章主要角色：林晓、零号。
>  读 characters/林晓.md 和 characters/零号.md。"
```

**关键原则**：用完就清——写完一章、生成摘要、关闭会话。不要在一个会话里连续写多章。

## 第四步：全局检查交给Subagent

```python
# 用子Agent扫描所有章节，只把结论汇报回来
def global_consistency_check():
    checks = [
        ("人物一致性", "扫描所有chapters/ch*.md，检查林晓的性格描述是否有矛盾"),
        ("伏笔完整性", "对比checklist.md，检查所有伏笔是否都已回收"),
        ("时间线一致", "检查所有章节中的时间描述是否自洽"),
        ("文风统一", "检查文风是否符合bible.md中的要求"),
    ]

    results = []
    for check_name, prompt in checks:
        # 子Agent处理大量文件，只返回结论（节省主上下文）
        result = run_subagent(
            task=prompt,
            file_scope="chapters/*.md",
            max_context="full",  # 子Agent可以用完整个上下文
        )
        results.append(f"## {check_name}\n{result}")

    # 只把摘要结论汇报回主会话
    return '\n'.join(results)
```

## /compact在体系中的定位

```
位置：应急补救（不是主策略）
时机：单章写作中，如果工具调用过多导致上下文上溢
前提：bible.md和关键信息已持久化到文件
风险：压缩可能丢失细节，需要后续检查

/compact ❌ 不是"写书的核心策略"
/compact ✅ 是"单章执行中的应急手段"
```

## 面试加分点

1. **架构思维**：面试官想听到的是你有没有把"写书"当成工程问题来思考——上下文超限只是表象
2. **分层记忆**：项目圣经=长期记忆，章节摘要=短期记忆，角色卡=实体记忆
3. **可扩展性**：这种方法不仅适用于写书，也适用于长周期项目（如代码重构、技术文档撰写）
4. **成本意识**：按需检索比全量塞入更省Token，每章约2600字 vs 全书20万字
