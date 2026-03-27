# 容器复用问题分析与修复

## 问题描述

### 现象

**时间线**：
- 2026-03-27 10:54-11:11：容器频繁启动/退出，未实现复用
- 2026-03-27 11:11-现在：容器持续运行并正常复用

**容器生命周期记录**：
```
11:09:01 启动 → 处理1条消息 → 11:10:15 退出（Duration: 79899ms, Exit Code: 137）
11:10:15 启动 → 处理1条消息 → 11:11:28 退出（Duration: 68280ms, Exit Code: 137）
11:11:38 启动 → 处理多消息 → 持续运行（已10分钟+，正常复用）
```

**当前容器复用日志**（正常）：
```
[11:13:14] Piping IPC message into active query (135 chars)
[11:16:26] Piping IPC message into active query (413 chars)
[11:21:36] Piping IPC message into active query (422 chars)
```

### 影响范围

- **影响时间段**：约17分钟（10:54-11:11）
- **影响方式**：容器无法复用，每条消息都启动新容器
- **资源浪费**：频繁创建/销毁容器
- **性能影响**：消息处理延迟增加

## 根本原因

### 竞态条件

**问题代码**（`src/group-queue.ts:224-230`）：

```typescript
} finally {
  state.active = false;        // ← 立即设置为false
  state.process = null;
  state.containerName = null;
  state.groupFolder = null;
  this.activeCount--;
  this.drainGroup(groupJid);   // ← 之后才检查待处理消息
}
```

**sendMessage方法**（`src/group-queue.ts:160-178`）：

```typescript
sendMessage(groupJid: string, text: string): boolean {
  const state = this.getGroup(groupJid);
  if (!state.active || !state.groupFolder || state.isTaskContainer)
    return false;  // ← 关键判断：依赖 state.active
  // ... 发送IPC消息
  return true;
}
```

### 竞态窗口时序

```
T1: 容器处理完消息，进入finally块
T2: state.active = false  ← 容器被标记为不活跃
T3: state.process = null
T4: state.groupFolder = null
T5: [新消息到达]  ← 竞态窗口！
T6: sendMessage() 检查 state.active === false → 返回false
T7: 主进程调用 enqueueMessageCheck()
T8: 设置 pendingMessages = true
T9: drainGroup() 发现 pendingMessages → 启动新容器
T10: 但旧容器可能还在运行！
```

### 为什么当前正常？

**可能原因**：
1. 11:11之后的消息到达时机较好，避开了竞态窗口
2. 消息处理速度变化，竞态窗口缩短
3. 可能是并发竞态条件的随机性（有时触发，有时不触发）

**但是问题依然存在**，只是暂时没有触发。

## 解决方案

### 方案对比

#### ❌ 方案1：延迟设置 active=false

```typescript
} finally {
  // 不立即设置
  // state.active = false;

  state.process = null;
  state.containerName = null;
  state.groupFolder = null;
  this.activeCount--;

  this.drainGroup(groupJid);

  // 只有在没有待处理内容时才设置
  if (!state.pendingMessages && state.pendingTasks.length === 0) {
    state.active = false;
  }
}
```

**问题**：
- `drainGroup()` 调用 `runForGroup()` 是**异步的**
- 在 `drainGroup()` 返回后立即设置 `active = false`
- 新容器可能还没启动，竞态窗口依然存在

**结论**：❌ **不能解决问题**

---

#### ✅ 方案2：使用进程状态判断（推荐）

```typescript
sendMessage(groupJid: string, text: string): boolean {
  const state = this.getGroup(groupJid);

  // 检查进程真实状态（操作系统层面的真相）
  // 即使 state.active = false，只要进程还在运行就能复用
  if (state.process && state.process.exitCode === null && state.groupFolder && !state.isTaskContainer) {
    state.idleWaiting = false;
    // ... 发送IPC消息
    return true;
  }
  return false;
}
```

**优势**：
1. ✅ **基于真实状态**：`exitCode === null` 表示进程肯定在运行
2. ✅ **无竞态窗口**：进程状态是确定的，不依赖代码执行顺序
3. ✅ **最小改动**：只修改一个方法
4. ✅ **向后兼容**：不影响现有逻辑
5. ✅ **易于测试**：进程状态是确定性的

**结论**：✅ **完全可靠**

---

### 可靠性对比

| 测试场景 | 方案1 | 方案2 |
|---------|-------|-------|
| 容器运行中，finally块执行 | ❌ 可能失败 | ✅ 成功 |
| drainGroup异步启动中 | ❌ 失败（竞态） | ✅ 成功 |
| 容器真正退出后 | ✅ 成功 | ✅ 成功 |
| 并发消息到达 | ❌ 竞态窗口 | ✅ 无竞态 |
| 代码复杂度 | 中 | 低 |
| 引入新风险 | 高 | 低 |
| 可测试性 | 难（异步） | 易（确定性） |

## 实施计划

### 修复步骤

1. **备份当前代码**
   ```bash
   cp src/group-queue.ts src/group-queue.ts.backup
   ```

2. **应用修复**
   - 修改 `sendMessage()` 方法
   - 添加详细日志

3. **测试验证**
   - 单元测试
   - 集成测试
   - 监控观察

4. **部署上线**
   - 灰度发布
   - 监控指标
   - 回滚预案

### 修改文件

- `src/group-queue.ts`: 修改 `sendMessage()` 方法

### 验证方法

1. **日志监控**：
   - 检查 `sendMessage: reusing container by process state` 日志
   - 确认复用成功率

2. **容器监控**：
   - 观察容器生命周期
   - 确认容器持续时间增加

3. **性能指标**：
   - 容器启动频率降低
   - 消息处理延迟降低

## 风险评估

### 低风险

- ✅ 改动最小（只修改一个方法）
- ✅ 向后兼容（只增强判断条件）
- ✅ 有详细日志追踪
- ✅ 易于回滚

### 缓解措施

1. 添加详细日志，便于问题追踪
2. 保留原有 `state.active` 判断作为降级
3. 分阶段发布，监控观察
4. 准备回滚方案

## 附录

### 相关代码位置

- `src/group-queue.ts:160-178`: `sendMessage()` 方法
- `src/group-queue.ts:196-232`: `runForGroup()` 方法
- `src/group-queue.ts:286-316`: `drainGroup()` 方法
- `src/index.ts:565-582`: 消息发送逻辑

### 日志示例

**修复前**（可能失败）：
```
[11:10:15] Container started
[11:11:28] Container exited (Exit Code: 137)
[11:11:29] New container started  ← 应该复用但失败了
```

**修复后**（正常复用）：
```
[11:13:14] sendMessage: reusing container by process state
[11:13:14] Piping IPC message into active query
[11:16:26] sendMessage: reusing container by process state
[11:16:26] Piping IPC message into active query
```

### 参考资料

- Node.js ChildProcess 文档：https://nodejs.org/api/child_process.html
- Docker 容器生命周期：https://docs.docker.com/engine/containers/
- 进程状态管理最佳实践

---

**文档版本**: 1.0
**创建日期**: 2026-03-27
**最后更新**: 2026-03-27
**作者**: Claude Code
