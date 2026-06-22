---
id: note-ms-020
difficulty: L4
category: frontend
subcategory: AI-Native桌面
tags:
- 月之暗面
- 面经
- Demo到商用
- 翻车点
- AI桌面
feynman:
  essence: 翻车点：1.长任务稳定性(超时/断线/内存泄漏) 2.产物质量不稳定(幻觉/格式错误) 3.权限安全(文件误操作) 4.性能(大文件/多任务卡顿) 5.多窗口状态混乱。
  analogy: 就像Demo车到量产车——Demo只管能跑(功能)，量产要管耐久(稳定性)、安全(权限)、油耗(性能)、流水线(工程化)。
  first_principle: Demo→商用的核心差距 = 稳定性 × 安全性 × 性能 × 可运维性。
  key_points:
  - '长任务: 超时/断线/内存泄漏/进度丢失'
  - '产物质量: 幻觉/格式错误/不可控输出'
  - '权限安全: 文件误操作/数据泄露'
  - '性能: 大文件/多任务/上下文膨胀'
  - '多窗口状态混乱/竞态条件'
first_principle:
  essence: Demo验证可行性商用验证可靠性
  derivation: Demo→理想环境→商用→真实用户/大数据/长时间运行→边界条件/异常处理/性能/安全→翻车点
  conclusion: Demo到商用的本质是从'能用'到'好用且安全'的工程化跨越
follow_up:
- 长任务的内存泄漏怎么排查？
- AI产物质量怎么系统性保障？
- 商用级别的监控告警怎么设计？
---

# 【月之暗面面经】AI-Native 桌面产品从 Demo 到商用，前端最容易在哪些点翻车？

<!-- ANSWER_BODY_HERE -->