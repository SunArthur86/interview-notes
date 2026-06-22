---
id: note-mk-011
difficulty: L4
category: ai
subcategory: 桌面AI产品
tags:
- 月之暗面
- 面经
- AI-Native
- 多窗口
- 状态同步
feynman:
  essence: 多窗口协作的核心是把全局任务数据和局部展示状态分开——跨窗口只同步高价值事实（任务状态/产物变更），不同步所有UI细节。冲突时先提示哪个窗口持有编辑权，长任务结果通过全局事件推送。
  analogy: 就像团队协作写文档——核心内容（任务和产物）存在共享服务器上（全局同步），但每个人自己的编辑器界面（字号/主题/滚动位置）各自独立，不互相干扰。
  first_principle: 多窗口本质是多个独立渲染上下文共享同一个数据模型。全部同步会导致性能问题和状态冲突，完全不同步会导致数据不一致。正确的策略是按数据价值分层——高价值事实强同步，低价值UI状态不同步。
  key_points:
  - '全局任务数据和局部展示状态分开'
  - '跨窗口共享只同步高价值事实，不同步所有UI细节'
  - '冲突时先提示哪个窗口持有编辑权'
  - '长任务结果通过全局事件推送'
first_principle:
  essence: 数据价值分层同步策略
  derivation: 窗口间共享所有状态→状态冲突+性能差→只共享事实(任务/产物)→窗口本地管理UI状态(选中/滚动/展开)→冲突通过编辑权仲裁
  conclusion: 多窗口同步的本质是"事实同步、展示独立"——同一份数据可以有多个视图
follow_up:
- 如果桌面端要接文件、网页和本地目录，你先画哪套权限边界？
- 这个产品要接入更多Agent能力时，哪层架构最不能乱？
---

# 【月之暗面面经】如果桌面端支持多窗口协作，前端怎么避免不同窗口状态打架？

## 一、问题本质：多窗口状态冲突

```
场景：用户同时打开两个窗口
  窗口A：正在编辑产物PPT的第3页
  窗口B：同时在编辑同一个PPT的第5页
  → 保存时谁的版本覆盖谁？💥

场景：窗口A正在执行长任务
  窗口B也触发了同一个任务
  → 重复执行，浪费资源 💥

场景：窗口A修改了文件授权
  窗口B不知道，继续使用旧授权
  → 数据不一致 💥
```

## 二、状态分类与同步策略

```
┌──────────────────────────────────────────────────────────────────┐
│                   状态同步分层模型                                  │
├──────────────────────────────────────────────────────────────────┤
│                                                                  │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │ 强同步层（事实数据）                                       │   │
│  │ • 任务状态变更                                            │   │
│  │ • 产物版本变更                                            │   │
│  │ • 权限状态变更                                            │   │
│  │ • 通知状态                                                │   │
│  │ → 变更立即广播到所有窗口                                   │   │
│  └──────────────────────────────────────────────────────────┘   │
│                                                                  │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │ 弱同步层（协作数据）                                       │   │
│  │ • 编辑锁                                                   │   │
│  │ • 在线状态                                                 │   │
│  │ • 光标位置                                                 │   │
│  │ → 变更延迟广播，容忍短暂不一致                               │   │
│  └──────────────────────────────────────────────────────────┘   │
│                                                                  │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │ 不同步层（窗口本地状态）                                    │   │
│  │ • 滚动位置                                                 │   │
│  │ • 选中/悬停态                                              │   │
│  │ • 输入框内容                                               │   │
│  │ • 浮层开关                                                 │   │
│  │ • 主题/字号                                                │   │
│  │ → 完全独立，不跨窗口同步                                    │   │
│  └──────────────────────────────────────────────────────────┘   │
│                                                                  │
└──────────────────────────────────────────────────────────────────┘
```

## 三、实现架构

```typescript
// 跨窗口通信机制（Electron/Tauri）
class WindowSyncManager {
  private mainWindow: BrowserWindow;
  private popoutWindows: Map<string, BrowserWindow> = new Map();
  
  // 强同步：立即广播
  broadcastFact(event: FactEvent) {
    // 广播到所有窗口
    for (const [, window] of this.popoutWindows) {
      window.webContents.send('fact-update', event);
    }
    this.mainWindow.webContents.send('fact-update', event);
  }
  
  // 弱同步：节流广播
  private throttleMap = new Map<string, NodeJS.Timeout>();
  broadcastCoop(event: CoopEvent) {
    const key = `${event.type}:${event.targetId}`;
    if (this.throttleMap.has(key)) {
      clearTimeout(this.throttleMap.get(key)!);
    }
    this.throttleMap.set(key, setTimeout(() => {
      this.broadcastToAll('coop-update', event);
    }, 100));  // 100ms节流
  }
}

// 窗口侧监听
class WindowStateReceiver {
  constructor() {
    ipcRenderer.on('fact-update', (_, event: FactEvent) => {
      this.handleFactUpdate(event);
    });
    ipcRenderer.on('coop-update', (_, event: CoopEvent) => {
      this.handleCoopUpdate(event);
    });
  }
  
  private handleFactUpdate(event: FactEvent) {
    switch (event.type) {
      case 'task-status-changed':
        taskStore.updateTaskStatus(event.taskId, event.status);
        break;
      case 'artifact-version-updated':
        artifactStore.updateVersion(event.artifactId, event.version);
        break;
      case 'permission-changed':
        permissionStore.update(event.permissionId, event.changes);
        break;
    }
  }
}
```

## 四、编辑权仲裁

```
┌──────────────────────────────────────────────────────────────────┐
│  编辑权冲突提示                                                   │
├──────────────────────────────────────────────────────────────────┤
│                                                                  │
│  ⚠️ 产物"PPT分析报告"正在窗口 #2 中编辑                          │
│                                                                  │
│  当前编辑者：窗口 #2 (开始于 14:35, 已编辑 3 分钟)                │
│                                                                  │
│  选项：                                                          │
│  [ 等待编辑完成 ]  — 窗口#2保存后自动解锁                         │
│  [ 强制获取编辑权 ] — 窗口#2的未保存更改将丢失                     │
│  [ 以只读模式打开 ] — 只看不改                                    │
│                                                                  │
└──────────────────────────────────────────────────────────────────┘
```

```typescript
// 编辑权管理
class EditLockManager {
  private locks: Map<string, EditLock> = new Map();
  // key: artifactId, value: { windowId, acquiredAt, lastActivityAt }
  
  acquire(artifactId: string, windowId: string): AcquireResult {
    const existing = this.locks.get(artifactId);
    
    if (!existing || existing.windowId === windowId) {
      // 无锁或自己已持有
      this.locks.set(artifactId, {
        windowId,
        acquiredAt: Date.now(),
        lastActivityAt: Date.now(),
      });
      return { success: true };
    }
    
    // 检查锁是否过期（超过5分钟无活动自动释放）
    if (Date.now() - existing.lastActivityAt > 5 * 60 * 1000) {
      this.locks.set(artifactId, {
        windowId,
        acquiredAt: Date.now(),
        lastActivityAt: Date.now(),
      });
      return { success: true };
    }
    
    // 锁被其他窗口持有
    return {
      success: false,
      conflict: {
        holderWindowId: existing.windowId,
        holdingFor: Date.now() - existing.acquiredAt,
      },
    };
  }
  
  // 心跳续约（编辑中定期调用）
  heartbeat(artifactId: string, windowId: string) {
    const lock = this.locks.get(artifactId);
    if (lock && lock.windowId === windowId) {
      lock.lastActivityAt = Date.now();
    }
  }
  
  release(artifactId: string, windowId: string) {
    const lock = this.locks.get(artifactId);
    if (lock && lock.windowId === windowId) {
      this.locks.delete(artifactId);
    }
  }
}
```

## 五、长任务结果的全局推送

```typescript
// 长任务完成时，结果通过全局事件推送到所有窗口
class TaskResultBroadcaster {
  onTaskCompleted(taskId: string, result: TaskResult) {
    // 广播到所有窗口
    windowSync.broadcastFact({
      type: 'task-status-changed',
      taskId,
      status: 'done',
      result,
    });
    
    // 每个窗口自行决定如何展示
    // 窗口A（发起任务）：更新任务中心 + 显示产物
    // 窗口B（其他任务）：更新任务中心角标 + 通知
    // 窗口C（产物面板）：刷新产物列表
  }
}
```

## 六、常见坑

- **全量同步所有状态**：滚动位置、输入框内容都同步，窗口间互相干扰
- **没有编辑权管理**：两个窗口同时编辑同一个产物，最后保存的覆盖前者
- **锁不过期**：窗口崩溃后锁不释放，其他窗口永远无法编辑
- **长任务结果只通知发起窗口**：其他窗口的任务中心看不到最新状态
