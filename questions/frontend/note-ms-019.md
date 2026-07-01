---
id: note-ms-019
difficulty: L4
category: frontend
subcategory: AI-Native桌面
tags:
- 月之暗面
- 面经
- 入职规划
- 技术补课
- AI桌面
feynman:
  essence: 三块：1.桌面工程基础(Electron/Tauri/IPC/原生API) 2.AI交互模式(任务编排/产物管理/上下文工程) 3.用户场景理解(真实工作流/痛点/使用数据)。
  analogy: 就像空降一个新厨房——先学厨具(桌面工程)，再学菜谱(AI交互)，最后了解食客口味(用户场景)。
  first_principle: 快速上手AI桌面产品 = 工程基础 × AI能力理解 × 用户同理心。
  key_points:
  - '桌面工程: Electron/Tauri/IPC/原生API/打包'
  - 'AI交互: 任务编排/产物管理/上下文/Agent链路'
  - '用户场景: 真实工作流/使用数据/反馈分析'
first_principle:
  essence: 技术-产品-用户三角能力模型
  derivation: 只补技术→不懂AI设计→只补AI→不懂桌面工程→只补用户→不会实现→三块同步补→快速上手
  conclusion: 前三个月=工程基础+AI交互+用户场景三维补课
follow_up:
- Electron和Tauri怎么选？
- AI交互设计有什么参考产品？
- 如何快速理解用户真实场景？
memory_points:
- 首补桌面底座：摸透 Electron/Tauri 底层机制、多进程通信与内存优化
- 二补AI交互框架：重构流式渲染管线、重写中断恢复与产物落盘生命周期
- 三补业务与调试闭环：建立用户行为埋点体系，跑通可观测性与反馈调优链路
---

# 【月之暗面面经】如果让你接手这类桌面产品，你前三个月先补哪三块？

<!-- ANSWER_BODY_HERE -->

## 记忆要点

- 首补桌面底座：摸透 Electron/Tauri 底层机制、多进程通信与内存优化
- 二补AI交互框架：重构流式渲染管线、重写中断恢复与产物落盘生命周期
- 三补业务与调试闭环：建立用户行为埋点体系，跑通可观测性与反馈调优链路

