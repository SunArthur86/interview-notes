---
id: note-ms-009
difficulty: L4
category: frontend
subcategory: AI-Native桌面
tags:
- 月之暗面
- 面经
- 任务中心
- Agent
- 架构设计
feynman:
  essence: 任务中心的关键对象：Task(任务)、Context(上下文)、Product(产物)、Permission(权限)、Log(日志)。
  analogy: 就像项目管理系统的核心对象——任务(做什么)、资源(用什么)、交付物(产出什么)、权限(谁能做)、记录(做了什么)。
  first_principle: 任务中心 = 任务生命周期管理 + 上下文管理 + 产物管理 + 权限控制 + 可观测性。
  key_points:
  - 'Task: id/状态/优先级/类型'
  - 'Context: 输入引用/摘要/历史版本'
  - 'Product: 产物类型/路径/版本/预览'
  - 'Permission: 授权范围/操作粒度'
  - 'Log: 执行链路/耗时/成本/错误'
first_principle:
  essence: 任务中心是Agent系统的领域模型
  derivation: Agent执行→需要管理任务全生命周期→涉及输入/执行/产出/权限/日志→抽象为5大领域对象→统一管理
  conclusion: 任务中心设计=DDD领域驱动设计在AI Agent中的应用
follow_up:
- 任务状态机怎么设计？
- 产物版本管理用什么方案？
- 任务中心的UI怎么组织？
---

# 【月之暗面面经】如果让你设计桌面 Agent 的任务中心，会有哪些关键对象？

<!-- ANSWER_BODY_HERE -->