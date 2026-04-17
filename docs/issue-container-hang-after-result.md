# 问题：容器在运行约 2 分钟后被 SIGKILL 终止

## 问题描述

容器在正常执行查询后，约 2 分钟后被 SIGKILL 强制终止（exit code 137），而非预期的 30 分钟 IDLE_TIMEOUT。

### 时间线证据

从生产日志（`feishu-oc_3fc97b50c18998b89566d61425ac484e`，2026-04-17）：

| 时间 (北京时间) | 事件 |
|-----------------|------|
| 10:44:29 | hetang-test 的容器启动 |
| 10:46:06 | SDK yield result #2，消息成功发送 |
| **10:47:xx** | **qianx 的 nanoclaw 启动** |
| 10:48:04 | 容器退出 (exit code 137 = SIGKILL) |

容器日志显示：
- `runQuery: complete` 性能总结**从未出现**
- 没有任何错误或异常消息
- result #2 后日志完全停止

## 根因分析

### 真正原因：多实例孤儿清理冲突

系统上有**两个用户同时运行 nanoclaw**：

```
qianx    2414457  /data/user/qianxi/nanoclaw/dist/index.js    (10:47 启动)
hetang-+ 3363649  /home/hetang-test/nanoclaw/dist/index.js     (Apr16 启动)
```

`cleanupOrphans()` 函数（`src/container-runtime.ts:104-127`）在启动时会停止所有 `nanoclaw-*` 容器：

```typescript
export function cleanupOrphans(): void {
  const output = execSync(
    `${CONTAINER_RUNTIME_BIN} ps --filter name=nanoclaw- --format '{{.Names}}'`,
    ...
  );
  const orphans = output.trim().split('\n').filter(Boolean);
  for (const name of orphans) {
    execSync(stopContainer(name), { stdio: 'pipe' });
  }
}
```

**问题**：
- 过滤器 `name=nanoclaw-` 匹配**所有用户**的 nanoclaw 容器
- 没有区分容器归属（哪个实例启动的）
- qianx 的实例启动时，误将 hetang-test 的活跃容器当作"孤儿"清理

**终止流程**：
```
docker stop → SIGTERM → 等待 15 秒 grace period → SIGKILL
```

时间吻合：10:47 启动 → 约 1 分钟后 10:48:04 被终止。

### 初步分析（已排除）

最初怀疑 SDK 的 `query()` 迭代器在 yield `result` 后不自动结束。经过验证：
- SDK 确实会等待 AsyncIterable 的下一个输入（这是正常行为）
- 但容器应该等待 30 分钟 IDLE_TIMEOUT 后收到 `_close` sentinel 正常退出
- 实际只等待了约 2 分钟就被外部 SIGKILL 终止

SDK 行为分析仍有参考价值（见附录）。

### 为什么 qianx 的服务在登录时启动？

检查发现 qianx 用户的 **linger 未启用**：

```
$ loginctl user-status qianx
   Linger: no
```

systemd user service 的默认行为：
- **Linger: no** → 服务只在用户登录会话期间运行，退出登录后停止
- **Linger: yes** → 服务持续运行，即使用户退出登录

qianx 在 10:47 登录时，nanoclaw service 重新启动，触发了 `cleanupOrphans()`。

**解决方案**：为需要后台运行的用户启用 lingering：

```bash
# 需要 root 权限
loginctl enable-linger qianx
loginctl enable-linger hetang-test
```

这样 user service 即使在用户退出登录后也会继续运行，避免服务重启导致的孤儿清理冲突。

## 影响范围

### 受影响组件
- `src/container-runtime.ts` - `cleanupOrphans()` 函数

### 受影响场景
- 多用户同时运行 nanoclaw 实例
- 多实例部署在同一 Docker daemon 上

### 用户影响
- 消息功能正常（用户收到完整回复，在 SIGKILL 前已发送）
- 容器被意外终止，无法复用
- 日志噪音：ERROR (exit code 137) 记录
- 可能耗尽并发容器限制

## 修复方案

### 方案：使用 Docker labels 区分容器归属

在容器启动时添加 label 标记实例标识：

**1. 修改 `buildContainerArgs()` 添加 label**

```typescript
// src/container-runner.ts
function buildContainerArgs(
  mounts: VolumeMount[],
  containerName: string,
): string[] {
  const args: string[] = ['run', '-i', '--rm', '--name', containerName];

  // 添加实例标识 label，用于区分不同用户的容器
  const instanceId = process.env.NANOCLAW_INSTANCE_ID || os.userInfo().username;
  args.push('--label', `nanoclaw.instance=${instanceId}`);

  // ... 其他参数 ...
}
```

**2. 修改 `cleanupOrphans()` 使用 label 过滤**

```typescript
// src/container-runtime.ts
export function cleanupOrphans(): void {
  const instanceId = process.env.NANOCLAW_INSTANCE_ID || os.userInfo().username;
  const output = execSync(
    `${CONTAINER_RUNTIME_BIN} ps --filter "name=nanoclaw-" --filter "label=nanoclaw.instance=${instanceId}" --format '{{.Names}}'`,
    ...
  );
  // ... 只清理当前实例的容器 ...
}
```

### 可选：环境变量配置实例 ID

```bash
# .env 或 systemd unit
NANOCLAW_INSTANCE_ID=hetang-test-production
```

这样可以在同一用户下运行多个实例（如生产/测试），也能正确区分。

## 验证清单

修复后：
1. [ ] 重新构建并部署：`npm run build && systemctl --user restart nanoclaw`
2. [ ] 验证容器带有正确的 label：`docker inspect --format '{{.Config.Labels}}' <container>`
3. [ ] 测试多实例场景：启动另一个实例，确认不会误杀当前容器
4. [ ] 确认日志没有意外的 exit code 137（除非真实错误）
5. [ ] 监控容器运行时长，确认正常等待 IDLE_TIMEOUT

## 相关文件

| 文件 | 作用 |
|------|------|
| `src/container-runtime.ts` | `cleanupOrphans()` 孤儿清理，需要修改过滤条件 |
| `src/container-runner.ts` | `buildContainerArgs()` 容器启动参数，需要添加 label |
| `src/index.ts` | 启动入口，调用 `cleanupOrphans()` |

## 附录：SDK 迭代器行为分析

### SDK query() 的设计

SDK 的 `query()` 使用 AsyncIterable 作为 prompt 参数，支持多轮对话：

```typescript
for await (const message of query({ prompt: stream, ... })) {
  // 处理消息
}
```

当 SDK yield `result` 消息后，迭代器**不会自动结束**，而是继续等待 AsyncIterable 提供更多用户输入。这是正常的多轮对话支持行为。

### 验证测试

在容器内创建测试脚本验证：

**测试 A：不调用 stream.end()**
```
[TEST] RESULT RECEIVED - Does iterator auto-end?
[OUTER] Timeout after 20s   <-- 迭代器继续等待
```

**测试 B：调用 stream.end()**
```
[TEST] RESULT RECEIVED, calling stream.end()
[TEST] Iterator ended normally
```

**结论**：调用 `stream.end()` 可以让迭代器正常结束，但这不是本次问题的根因。

### 相关优化（可选）

虽然不是本次问题的根因，但在 result 后调用 `stream.end()` 可以让容器更快进入 IPC 等待状态（而非卡在 SDK 迭代器等待）：

```typescript
// container/agent-runner/src/index.ts
if (message.type === 'result') {
  writeOutput({ status: 'success', result: textResult || null, newSessionId });
  stream.end();  // 让迭代器退出，进入 waitForIpcMessage()
}
```

这个优化可以在修复主要问题后单独考虑。