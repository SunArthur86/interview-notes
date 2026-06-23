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
  - '三层：项目级 CLAUDE.md（进git）/ 用户级 ~/.claude/CLAUDE.md（不进git）/ 会话级 context（内存）'
  - '职责隔离：团队约定 vs 个人习惯 vs 当前对话'
  - '优先级：项目级 > 用户级（团队规矩压过个人喜好）'
  - 'auto-compact：到 90% context window 自动总结历史 + 保留近期 N 轮原文'
  - 'prompt cache（5-min TTL）让长 system prompt 不付每次 input cost'
first_principle:
  essence: Memory 分层 = 按生命周期和共享粒度组织记忆
  derivation: 记忆有价值差异 → 团队规则需共享（进git）→ 个人偏好不该共享（不进git）→ 会话细节无需持久（内存）→ 三种生命周期 → 三种存储位置 → 天然隔离
  conclusion: 分层的本质不是"分几层"，而是"按生命周期 + 共享粒度"组织，让该共享的共享、该私有的私有、该消失的消失
follow_up:
- Claude Code 的 memory/ 子目录（auto memory）怎么用 frontmatter 标 type？
- prompt cache 的 5-min TTL 对 long-running session 有什么影响？
- 检索式记忆（按相关性召回）vs 全量塞 prompt 怎么选？
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
