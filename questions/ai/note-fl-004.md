---
id: note-fl-004
difficulty: L3
category: ai
subcategory: Agent
tags:
- 字节
- 飞连
- 面经
- ClaudeCode
- Memory
feynman:
  essence: Claude Code 的 Memory 分三层——项目级 CLAUDE.md（跟仓库走，团队共享）、用户级 ~/.claude/CLAUDE.md（跟机器走，个人偏好）、会话级 context（关窗即丢）。三层在每次请求拼到 system prompt，但生命周期不同，靠文件路径天然隔离。上下文过长靠 auto-compact（到阈值自动总结历史 + 保留近期消息）。
  analogy: 就像公司规章——公司章程（CLAUDE.md，全公司遵守）、个人工作习惯笔记（~/.claude，只你用）、本次会议记录（会话 context，会开完就丢）。三层不混，各管各的。
  first_principle: 记忆的价值与共享粒度强相关。团队规则必须进 git 才能共享；个人偏好不该污染团队仓库；会话细节关窗就该消失。三种生命周期决定了三种存储位置。
  key_points:
  - 三层：项目级 CLAUDE.md（进git）/ 用户级 ~/.claude/CLAUDE.md（不进git）/ 会话级 context（内存）
  - 职责隔离：团队约定 vs 个人习惯 vs 当前对话
  - 优先级：项目级 > 用户级（团队规矩压过个人喜好）
  - auto-compact：到 90% context window 自动总结历史 + 保留近期 N 轮原文
  - prompt cache（5-min TTL）让长 system prompt 不付每次 input cost
first_principle:
  essence: Memory 分层 = 按生命周期和共享粒度组织记忆
  derivation: 记忆有价值差异 → 团队规则需共享（进git）→ 个人偏好不该共享（不进git）→ 会话细节无需持久（内存）→ 三种生命周期 → 三种存储位置 → 天然隔离
  conclusion: 分层的本质不是"分几层"，而是"按生命周期 + 共享粒度"组织，让该共享的共享、该私有的私有、该消失的消失
follow_up:
- Claude Code 的 memory/ 子目录（auto memory）怎么用 frontmatter 标 type？
- prompt cache 的 5-min TTL 对 long-running session 有什么影响？
- 检索式记忆（按相关性召回）vs 全量塞 prompt 怎么选？
memory_points:
- 三层记忆：项目级(CLAUDE.md进git) > 用户级(~不进git) > 会话级(内存关窗即丢)
- 分层是为了隔离职责与共享粒度：团队约定与个人习惯解耦，防止换人乱套
- 上下文过长应对：触发auto-compact自动摘要，结合5分钟TTL的prompt cache省钱
- 突破上限靠检索：不塞全量历史，向量化后按相关性召回Top-K片段拼prompt
---

# 【字节飞连面经】Claude Code 的 Memory 机制：为什么分层？上下文过长怎么办？

## 一、三层 Memory 结构

```
┌─────────────────────────────────────────────────────────┐
│  项目级 CLAUDE.md（仓库根目录）                            │
│  - 跟代码一起 commit                                       │
│  - 团队共享（团队约定、架构规范、禁忌操作）                  │
│  - 优先级最高                                              │
├─────────────────────────────────────────────────────────┤
│  用户级 ~/.claude/CLAUDE.md（home 目录）                  │
│  - 不进 git                                                │
│  - 个人专属（个人偏好、常用 shortcut）                      │
├─────────────────────────────────────────────────────────┤
│  会话级 context（内存）                                    │
│  - 当前 conversation                                       │
│  - 关掉窗口就丢                                            │
└─────────────────────────────────────────────────────────┘
```

每次请求时三层都拼到 system prompt。

## 二、为什么分层

| 维度 | 项目级 | 用户级 | 会话级 |
|------|--------|--------|--------|
| 职责 | 团队约定 | 个人习惯 | 当前对话 |
| 共享粒度 | 团队共享（进 git） | 个人专属（不进 git） | 不共享 |
| 生命周期 | 随仓库永久 | 跟机器走 | 关窗即丢 |
| 优先级 | 最高 | 中 | 最低 |

**核心收益**：
1. **职责隔离**：团队约定和个人习惯是两套不该耦合的东西；都写一起，换个人就乱套
2. **共享粒度匹配**：`CLAUDE.md` 进 git 团队共享；`~/.claude/CLAUDE.md` 不进 git 个人专属
3. **优先级清晰**：项目级 > 用户级（团队规矩压过个人喜好）

## 三、上下文过长怎么办：三层降级

```
[1] auto-compact（自动）
    │  到阈值（如 90% context window）
    │  自动跑总结，保留最近 N 轮原文 + 历史摘要
    ▼
[2] prompt cache（成本）
    │  Anthropic 5-min TTL prompt cache
    │  让长 system prompt 不付每次 input cost
    ▼
[3] 检索式记忆（上限突破）
       不是把所有历史塞 prompt
       而是按相关性召回（typical 8K 历史 → 召回 2K 相关片段）
```

## 四、memory/ 子目录（auto memory）

Claude Code 还支持 `memory/` 子目录写入小记忆文件，用 frontmatter 标 type：
- `type=user`：用户偏好
- `type=feedback`：用户反馈
- `type=project`：项目规则
- `type=reference`：参考资料

让 AI 自己决定记什么、怎么归类。

## 五、加分点

说出 Claude Code 在 Opus 4.x 上推荐用对应 model ID，并提到 **prompt cache 5-min TTL** 对 long-running session 的影响：
- 5 分钟内有连续请求 → 命中缓存，省 input cost
- 超过 5 分钟 → 缓存失效，重新计费
- → 适合密集交互场景，不适合低频长间隔

## 六、与 Cursor/Copilot 的区别

诚实说明：Cursor 用 `.cursorrules`（类似 CLAUDE.md 但只有项目级），Copilot 没有持久记忆机制。Claude Code 的三层 + auto memory 是更完整的设计。

## 七、扩展

- **chapter 切分**：长会话主动 mark chapter，未来检索更准
- **检索式记忆的工程实现**：把会话历史向量化存向量库，每轮按当前 query 召回 top-K 相关片段拼 prompt
- **memory 污染问题**：如果 auto memory 写太多低价值内容，反而干扰主任务 → 需要"遗忘机制"（定期清理低引用记忆）

## 记忆要点

- 三层记忆：项目级(CLAUDE.md进git) > 用户级(~不进git) > 会话级(内存关窗即丢)
- 分层是为了隔离职责与共享粒度：团队约定与个人习惯解耦，防止换人乱套
- 上下文过长应对：触发auto-compact自动摘要，结合5分钟TTL的prompt cache省钱
- 突破上限靠检索：不塞全量历史，向量化后按相关性召回Top-K片段拼prompt

## 苏格拉底式面试追问

> 这组追问模拟面试官层层逼问，每一问先回答"为什么"，再回答"怎么做"，最后回答"如何证明"。

### 第一层：目标与动机

**Q：你为什么搞三层 Memory，而不是一个大文件把团队约定、个人偏好、会话记录全塞进去？反正最后都拼到 system prompt。**

因为三层对应三种生命周期和共享粒度，混在一起会互相污染。团队约定（CLAUDE.md）要进 git 让全员共享且可追溯；个人偏好（~/.claude）不该污染团队仓库——你把"我喜欢简洁回答"写进 CLAUDE.md，团队其他人就被迫接受；会话记录关窗就该消失，写进文件是持久污染。分开存储是用文件路径天然做隔离：`./CLAUDE.md` 进 git，`~/.claude/` 在 home 目录不进 git，会话 context 在内存。耦合在一起的代价是换个人就乱套、git diff 噪声爆炸。

### 第二层：证据与定位

**Q：auto-compact 到 90% context window 触发总结。你怎么知道总结后的 context 丢了哪些关键信息？总结质量怎么量化？**

总结必然有损，关键是怎么把损失控制在可接受范围。量化方法：拿一段已知包含 N 个关键事实的长会话（如"用户叫张三、订单号 12345、问题退款"），触发 auto-compact 后问模型这些事实，看召回率（N 个事实里还剩几个）。如果关键事实召回率 < 90%，说明摘要 Prompt 漏了"保留实体和事实"的要求。定位手段是看 auto-compact 的摘要输出本身（Claude Code 的 compact 过程是可见的），检查摘要是否保留了实体、时间、决策结论这类高密度信息，而不是只留了"讨论了退款问题"这种空话。

### 第三层：根因深挖

**Q：auto-compact 是"丢历史保近期"。但如果关键决策在历史早期（比如第 3 轮定的技术方案），一 compact 就丢了。为什么不直接用检索式记忆（向量化召回）替代 auto-compact？**

因为检索式记忆有召回失败风险——如果 query 和早期决策的语义相似度低，召不回来，而 auto-compact 至少保留一个全局摘要。两者不是替代关系，是互补：auto-compact 保"全局骨架 + 近期原文"，检索式记忆补"按需召回历史细节"。具体做法是：auto-compact 产出的摘要进 system prompt（保下限），同时把完整历史向量化存向量库，每轮对话时按当前 query 召回 top-K 相关片段拼进 context（提上限）。纯检索的问题是冷启动时 query 太泛（如"继续"），召不回有效内容。

**Q：那如果同时用 auto-compact + 检索式记忆，为什么不干脆全量把历史塞进 prompt，反正现在模型 context window 都到 200K 了？**

三个原因。一是成本：200K context 的 input cost 是按 token 计的，每轮都塞 200K，密集交互下费用爆炸——这是为什么需要 5-min TTL 的 prompt cache。二是性能：context 越长 attention 计算越慢，首 token 延迟显著上升（lost in the middle 问题），中间段的信息模型反而容易忽略。三是效果：研究表明模型对超长 context 的中间内容利用率下降，召回 top-K 相关片段反而比全量塞更准。所以即使 window 够大，检索式裁剪仍有必要。

### 第四层：方案权衡

**Q：auto memory（memory/ 子目录让 AI 自己记笔记）你担心什么风险？为什么不直接关掉让它纯靠 CLAUDE.md？**

风险是 memory 污染——AI 可能记一堆低价值内容（"用户说了谢谢"、"今天天气不错"），这些噪声会挤占 context、干扰主任务。但关掉它等于放弃 AI 的自适应能力，CLAUDE.md 是静态的、人工维护的，无法捕捉"用户每次都要求加注释"这种动态模式。权衡做法是加遗忘机制：memory 文件带 frontmatter 标 type（user/feedback/project/reference）和 timestamp，定期清理低引用（比如 30 天没被召回过）的 memory；高价值的（feedback 类、被多次召回）提升权重。这是"带垃圾回收的记忆"——保留自适应收益，过滤噪声。

**Q：prompt cache 5-min TTL 在 long-running session 里会失效。为什么不要求厂商把 TTL 调到 1 小时，一劳永逸？**

因为缓存是有存储成本的，厂商不可能无限期存所有用户的 context。5-min 是基于统计的——大部分交互是密集的（连续问答），5 分钟能覆盖 90% 的命中场景。调到 1 小时意味着厂商要存 12 倍的缓存数据，成本转嫁到价格上。正确的工程应对是：在 5 分钟内有 idle 风险时，前端发一个轻量的 keepalive 请求保活缓存；或者接受缓存失效的代价，把它算进成本模型。这是厂商和用户的工程博弈，不是单方面能解决的。

### 第五层：验证与沉淀

**Q：你怎么证明三层 Memory 比单层（只有会话 context）效果好？用什么指标？**

核心指标是"跨会话信息复用率"和"重复指令率"。单层 Memory 下，用户每次新会话都要重复交代背景（"我们用的是 React 18"、"代码风格用 4 空格缩进"）；三层 Memory 下，CLAUDE.md 让这些一次配置永久生效。量化方法：统计用户会话中"重复输入的背景信息"占比，三层 Memory 下应显著下降。另一个指标是"任务完成质量"——同样的多轮编程任务，有项目级 CLAUDE.md（含架构规范）时产出的代码是否符合团队规范，用 code review 通过率衡量。

**Q：怎么让团队主动维护 CLAUDE.md，而不是写一次就没人管、过时了也没人更新？**

把 CLAUDE.md 的维护绑到代码变更流程里：一是 CI 检查——当 `src/` 下新增模块或变更架构（如新增框架依赖）时，CI 提示"是否需要更新 CLAUDE.md 的架构规范部分"；二是 review 制度——PR review 时如果 reviewer 发现"这个约定 CLAUDE.md 里没写"，要求补到 CLAUDE.md 再合并；三是定期 review——每季度做一次 CLAUDE.md 审计，对照当前代码库看哪些约定过时、哪些缺失。核心是把 CLAUDE.md 当活文档，和代码同生命周期演进，而不是一次性产物。

## 结构化回答

**30 秒电梯演讲：** Claude Code 的 Memory 分三层——项目级 CLAUDE.md（跟仓库走，团队共享）、用户级 ~/.claude/CLAUDE.md（跟机器走，个人偏好）、会话级 context（关窗即丢）。

**展开框架：**
1. **三层** — 项目级 CLAUDE.md（进git）/ 用户级 ~/.claude/CLAUDE.md（不进git）/ 会话级 context（内存）
2. **职责隔离** — 团队约定 vs 个人习惯 vs 当前对话
3. **优先级** — 项目级 > 用户级（团队规矩压过个人喜好）

**收尾：** 您想深入聊：Claude Code 的 memory/ 子目录（auto memory）怎么用 frontmatter 标 type？


## 视频脚本

> 预计时长：4 分钟 | 由浅入深


| 时间 | 画面/字幕 | 口播台词 | 讲解要点 |
|------|----------|----------|----------|
| 0:00 | 标题卡：Claude Code 的 Memory 机制… | "就像公司规章——公司章程（CLAUDE.md，全公司遵守）、个人工作习惯笔记（~/.…" | 开场钩子 |
| 0:20 | 核心概念图 | "Claude Code 的 Memory 分三层——项目级 CLAUDE.md（跟仓库走，团队共享）、用户级 ~/.…" | 核心定义 |
| 0:50 | 三层示意图 | "三层——项目级 CLAUDE.md（进git）/ 用户级 ~/.claude/CLAUDE.md（不进git）/ 会话级 context（… | 要点拆解1 |
| 1:30 | 对比/实战案例图 | "对比一下常见误区和工程实践，看真实场景里怎么取舍。" | 实战与对比 |
| 2:20 | 总结卡 | "记住核心要点。下期我们追问：Claude Code 的 memory/ 子目录（auto？" | 收尾与钩子 |
