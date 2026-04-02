# 多实例问题排查指南

## 问题现象

同一群组出现多个容器同时运行，导致消息被重复处理：

```
$ docker ps | grep nanoclaw
nanoclaw-feishu-oc-xxx-1774881276061   Up 13 minutes
nanoclaw-feishu-oc-xxx-1774881276552   Up 13 minutes
```

容器名后缀是时间戳（`1774881276061` vs `1774881276552`），相差约 500ms，表明是两次不同调用创建的。

## 排查过程

### 1. 检查日志中的容器创建记录

```bash
journalctl -u nanoclaw --since "时间范围" --no-pager | grep "Spawning container"
```

如果只看到一条 "Spawning container" 日志，但实际有两个容器，说明第二个容器可能由另一个进程创建。

### 2. 检查容器进程的父进程 ID

```bash
# 查找容器进程的 PID
ps aux | grep "nanoclaw-feishu-oc-xxx" | grep -v grep

# 检查父进程 ID
ps -o pid,ppid,user,cmd --no-headers -p <容器PID1> <容器PID2>
```

关键发现：两个容器的父进程 ID 不同：
- 第一个容器: PPID = 169613 (systemd 服务)
- 第二个容器: PPID = 3010255 (未知进程)

### 3. 检查所有 nanoclaw 主进程

```bash
ps aux | grep "node.*dist/index" | grep -v grep
```

发现多个进程：
```
hetang-+  169613  ...  /usr/bin/node /home/hetang-test/nanoclaw/dist/index.js  # systemd 服务
hetang-+  3010255  ...  node dist/index.js                                      # 手动运行的实例
hetang-+  172888   ...  node /tmp/dist/index.js                                 # 其他实例
```

**根本原因：多个 nanoclaw 进程实例同时运行，监听同一个飞书应用，导致同一条消息被处理两次。**

### 4. 检查 systemd 服务状态

```bash
systemctl status nanoclaw --no-pager
```

确认 systemd 服务正常运行，PPID 为 1（systemd），表示是系统服务。

## 快速确认方法

### 一行命令检查多实例

```bash
ps aux | grep "node.*dist/index" | grep -v grep | awk '{print $2, $11}' | while read pid path; do
  ppid=$(ps -o ppid --no-headers -p $pid)
  echo "PID: $pid, PPID: $ppid, Path: $path"
done
```

输出示例：
```
PID: 169613, PPID: 1, Path: /usr/bin/node /home/hetang-test/nanoclaw/dist/index.js
PID: 3010255, PPID: 1, Path: node dist/index.js
```

- PPID = 1：表示进程由 systemd 或 init 直接管理（可能是服务或手动启动后父进程退出）
- 多个进程指向同一个工作目录或使用相同配置：会导致消息重复处理

### 检查进程的工作目录

```bash
# 获取进程的工作目录
pwdx <PID>

# 或者通过 lsof
lsof -p <PID> | grep cwd
```

### 检查飞书 WebSocket 连接

如果有多个实例，飞书 WebSocket 会建立多个连接，可能导致：
- 消息重复接收
- 连接不稳定
- 消息处理顺序混乱

## 解决方案

### 1. 停止多余进程

```bash
# 确认 systemd 服务是唯一应该运行的实例
systemctl status nanoclaw

# 停止其他进程
kill -9 <多余进程PID>
```

### 2. 停止相关容器

```bash
# 停止多余的容器
docker stop nanoclaw-feishu-oc-xxx-<时间戳1> nanoclaw-feishu-oc-xxx-<时间戳2>
```

### 3. 确保只通过 systemd 启动服务

```bash
# 启动服务
systemctl start nanoclaw

# 不要手动运行 node dist/index.js
```

## 预防措施

### 1. 使用 systemd 管理服务

systemd 服务配置文件 `/etc/systemd/system/nanoclaw.service`：

```ini
[Unit]
Description=NanoClaw Personal Assistant
After=network.target

[Service]
Type=simple
User=hetang-test
WorkingDirectory=/home/hetang-test/nanoclaw
ExecStart=/usr/bin/node dist/index.js
Restart=on-failure
RestartSec=10

[Install]
WantedBy=multi-user.target
```

### 2. 添加进程锁

可以在代码中添加进程锁，防止同一工作目录启动多个实例：

```typescript
import fs from 'fs';
import path from 'path';

const lockFile = path.join(DATA_DIR, 'nanoclaw.lock');

function acquireLock(): boolean {
  try {
    // 尝试创建锁文件
    const fd = fs.openSync(lockFile, 'wx');
    fs.writeSync(fd, process.pid.toString());
    fs.closeSync(fd);
    return true;
  } catch {
    // 锁文件已存在
    return false;
  }
}

function releaseLock(): void {
  try {
    fs.unlinkSync(lockFile);
  } catch {
    // ignore
  }
}

// 启动时检查
if (!acquireLock()) {
  console.error('Another instance is already running');
  process.exit(1);
}

// 退出时释放
process.on('exit', releaseLock);
process.on('SIGINT', () => { releaseLock(); process.exit(0); });
process.on('SIGTERM', () => { releaseLock(); process.exit(0); });
```

### 3. 监控脚本

可以添加监控脚本定期检查：

```bash
#!/bin/bash
# check-single-instance.sh

WORK_DIR="/home/hetang-test/nanoclaw"
EXPECTED_PIDS=$(systemctl show nanoclaw --property MainPID --value)

ACTUAL_PIDS=$(ps aux | grep "node.*dist/index" | grep "$WORK_DIR" | grep -v grep | awk '{print $2}')

if [ $(echo "$ACTUAL_PIDS" | wc -l) -gt 1 ]; then
  echo "WARNING: Multiple nanoclaw instances detected"
  echo "PIDs: $ACTUAL_PIDS"
  echo "Expected systemd PID: $EXPECTED_PIDS"
fi
```

## 相关问题排查记录

### 2026-04-02 事件：固定超时导致重复容器

**时间**: 14:40 - 16:16

**现象**: 同一群组出现 3 个容器同时运行：

```
CONTAINER ID   NAMES                                                              STATUS
4d5a3e45c504   nanoclaw-feishu-oc-53f922a4ce864db1c7420c1a8e4c7ff4-1775112003273   Up About an hour
fe268d9ea0ce   nanoclaw-feishu-oc-53f922a4ce864db1c7420c1a8e4c7ff4-1775114046749   Up 40 minutes
6b8a431bd0d1   nanoclaw-feishu-oc-53f922a4ce864db1c7420c1a8e4c7ff4-1775116120169   Up 5 minutes
```

**原因排查**:

1. 检查日志发现容器持续活跃：
   ```
   15:07:35 - Result #8 输出
   15:11:03 - group-queue.ts 触发超时 "Container processing timeout after 1860000ms"
   15:14:06 - 新消息到达，启动新容器
   15:22:21 - 旧容器仍在输出 Result #9
   ```

2. 分析超时机制发现问题：

   | 层级 | 文件 | 超时时间 | 会重置？ | 触发动作 |
   |------|------|----------|---------|---------|
   | 1 | `index.ts` | IDLE_TIMEOUT (30min) | ✅ 收到 result 时重置 | 关闭 stdin |
   | 2 | `container-runner.ts` | 硬超时 (30min+) | ✅ 收到 OUTPUT_MARKER 时重置 | kill 容器 |
   | 3 | `group-queue.ts` | 固定超时 (31min) | ❌ 不重置 | schedule retry |

3. `group-queue.ts` 的固定超时不会因为用户活跃而重置。即使用户持续对话，31 分钟后也会触发超时。

4. 超时后：
   - 触发 `scheduleRetry`，安排重试
   - 内存状态被清理（`state.process = null`），但 Docker 容器没有被 kill
   - 重试或新消息到达时，启动新容器
   - 旧容器继续运行，形成重复容器

**结论**: `group-queue.ts` 的固定超时与用户活跃冲突，导致持续对话时触发超时并产生重复容器

**解决**: 移除 `group-queue.ts` 的固定超时，依赖前两层机制（IDLE_TIMEOUT 和 container-runner 硬超时）

**代码修改**:

移除 `src/group-queue.ts` 中的 `Promise.race` 超时逻辑：

```javascript
// 修改前
const timeoutMs = CONTAINER_TIMEOUT + 60000;
let timeoutId = setTimeout(() => reject(...), timeoutMs);
await Promise.race([this.processMessagesFn(groupJid), timeoutPromise]);

// 修改后
const success = await this.processMessagesFn(groupJid);
```

**附带修复**：同日发现飞书 `post` 类型消息（富文本）处理问题。

飞书 post 消息可能使用两种格式：
- 标准格式：`{"zh_cn":{"content":[[...]]}}`
- 简化格式：`{"content":[[...]]}`（部分消息类型如卡片转发）

原 `extractPostText` 函数只处理标准格式，导致简化格式的消息内容提取为空，被数据库查询过滤跳过。

**修复**：`src/channels/feishu.ts` 的 `extractPostText` 函数增加对简化格式的支持：

```typescript
// 尝试标准格式（有 zh_cn/en_us 层级）
const zhContent = content.zh_cn || content.en_us || {};
let postContent = zhContent.content || [];

// 如果没有找到，尝试简化格式（直接 content 层级）
if (postContent.length === 0 && Array.isArray(content.content)) {
  postContent = content.content;
}
```

### 2026-03-30 事件：多进程实例

**时间**: 22:34:36

**现象**: 同一群组出现两个容器 `nanoclaw-feishu-oc-xxx-1774881276061` 和 `nanoclaw-feishu-oc-xxx-1774881276552`

**原因排查**:
1. 日志只显示一个 "Spawning container" 事件
2. 检查容器进程父进程 ID，发现两个不同的父进程
3. 发现 PID 3010255 是另一个独立运行的 `node dist/index.js` 进程（19:17 启动）
4. systemd 服务 PID 169613 在 22:34 启动，创建了第一个容器

**结论**: 不是代码 race condition，而是多个进程实例同时运行

**解决**: 停止多余进程 (kill 3010255)，只保留 systemd 服务

## 参考文档

- [DEBUG_CHECKLIST.md](./DEBUG_CHECKLIST.md) - 通用调试检查清单
- [container-reuse-issue-analysis.md](./container-reuse-issue-analysis.md) - 容器复用问题分析