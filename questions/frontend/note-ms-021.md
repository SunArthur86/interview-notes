---
id: note-ms-021
difficulty: L4
category: frontend
subcategory: AI-Native桌面
tags:
- 月之暗面
- 面经
- 平台化
- 架构设计
- AI桌面
feynman:
  essence: 任务编排层最该先平台化——它是所有Agent能力的公共底座，抽象为统一的Task-Context-Product模型后，新增能力只需实现接口。
  analogy: 就像城市基础设施——先修路网(任务编排层)再建楼房(Agent能力)，路修好了到处都能通。
  first_principle: 平台化优先级 = 依赖广度 × 变更频率，被依赖最多且最稳定的层先平台化。
  key_points:
  - '任务编排层: Task/Context/Product统一模型'
  - '产物管理层: 类型无关的预览/编辑/导出'
  - '权限层: 统一授权框架'
  - '日志/追踪层: 全链路可观测性'
first_principle:
  essence: 平台化=提取公共不变量抽象为稳定接口
  derivation: 新增能力→发现重复→任务编排是公共依赖→先抽象→接口稳定→上层能力插件化
  conclusion: 任务编排层是AI桌面产品的'操作系统内核'
follow_up:
- 平台化的API怎么设计？
- 如何保证平台的向后兼容？
- 内部团队怎么共建平台？
---

# 【月之暗面面经】如果产品要扩到更多桌面能力，哪层前端架构最该先做成平台？

<!-- ANSWER_BODY_HERE -->