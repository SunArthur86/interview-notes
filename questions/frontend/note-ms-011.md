---
id: note-ms-011
difficulty: L4
category: frontend
subcategory: AI-Native桌面
tags:
- 月之暗面
- 面经
- 多窗口
- 状态同步
- 桌面产品
feynman:
  essence: 用统一的全局Store + 窗口级局部状态 + 消息总线同步，避免多窗口并发修改导致状态冲突。
  analogy: 就像Git多分支开发——每个窗口是一个工作区(局部状态)，但主干(全局Store)只有一个，通过合并(消息总线)同步。
  first_principle: 多窗口状态管理 = 单一数据源 + 窗口隔离 + 事件同步。
  key_points:
  - 全局Store管理共享状态(任务/产物/权限)
  - 窗口局部状态互不干扰
  - 消息总线(ipc/BroadcastChannel)同步变更
  - 乐观锁/版本号防止并发覆盖
first_principle:
  essence: 多窗口=分布式状态一致性问题
  derivation: 多窗口各自管理→状态不一致→需要单一数据源→全局Store→窗口通过事件同步→版本号防冲突
  conclusion: 多窗口协作的核心是'单一数据源+事件同步+冲突检测'
follow_up:
- Electron多窗口怎么共享状态？
- 窗口间拖拽传递数据怎么实现？
- 多窗口同时编辑同一产物怎么处理？
memory_points:
- 主从架构隔离：主窗口管状态，子窗口只负责 UI 视图展示
- 本地跨窗口通信：通过主进程 IPC 或 BroadcastChannel 广播状态变更
- 冲突解决机制：操作入队列串行处理，底座用乐观锁（版本号）防数据打架
---

# 【月之暗面面经】如果桌面端支持多窗口协作，前端怎么避免不同窗口状态打架？

<!-- ANSWER_BODY_HERE -->

## 记忆要点

- 主从架构隔离：主窗口管状态，子窗口只负责 UI 视图展示
- 本地跨窗口通信：通过主进程 IPC 或 BroadcastChannel 广播状态变更
- 冲突解决机制：操作入队列串行处理，底座用乐观锁（版本号）防数据打架

