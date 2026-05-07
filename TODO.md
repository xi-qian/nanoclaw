# TODO

## enqueueTask 容器复用优化

**现状**: `group-queue.ts` 的 `enqueueTask()` 在容器 idle 时写 `_close` 哨兵杀掉容器，
然后通过 `drainGroup` 重新创建容器来执行任务。

**期望**: group 模式的定时任务应复用当前 idle 容器——把任务 prompt 格式化成 IPC 消息
发进现有容器（类似 `sendMessage`），同一个容器和 SDK 会话连续处理，无额外启动开销。

**修改点**: `src/group-queue.ts:117-124` — 当 `state.active && state.idleWaiting` 时，
不调用 `closeStdin`，改为通过 IPC 发送格式化后的任务提示词。

**影响**: 低——当前功能正确，只是每次任务多 3-5 秒容器重建开销。
