# NanoClaw 飞书集成 + 智谱 API 配置修复文档

本文档记录了为 NanoClaw Fork 配置飞书（Feishu/Lark）集成和智谱 API（https://open.bigmodel.cn）时遇到的所有问题及解决方案。

---

## 环境信息

- **服务名称**: nanoclaw-fork
- **端口**: 3002 (Credential Proxy)
- **工作目录**: `/root/project/nanoclaw-fork/nanoclaw`
- **群组文件夹**: `feishu-main`
- **聊天 JID**: `feishu:oc_93dac2e93467e6c7eff34210368cbdc0`
- **API 地址**: https://open.bigmodel.cn/api/anthropic
- **API 密钥**: `de398026f8f847ed9810c4cb15d3151c.ZJQQ55CPrxyuHjo6`

---

## 问题 0: "鸡生蛋"问题 - 如何注册第一个群组

### 问题描述
NanoClaw 需要群组注册后才能处理消息，但注册群组需要发送 `@Andy register` 命令。这就形成了一个"鸡生蛋"的死循环：
- 没有注册的群组无法触发对话
- 无法触发对话就无法发送 `@Andy register` 命令
- 无法发送命令就无法注册群组

### 原因分析
NanoClaw 有两种群组类型：

1. **主群组（Main Group）** - `isMain: true`
   - **不需要触发器**，所有消息都会被处理
   - 用于主要交互界面（如私聊）

2. **普通群组** - `isMain: false` 或未设置
   - 需要 `@Andy` 触发器才会处理消息
   - 用于群聊场景，避免干扰正常对话

关键代码在 `src/index.ts:155-181`：

```typescript
const isMainGroup = group.isMain === true;

// 对于非主群组，检查是否需要触发器
if (!isMainGroup && group.requiresTrigger !== false) {
  // 需要检测 @Andy 触发器
  const hasTrigger = missedMessages.some(
    (m) => TRIGGER_PATTERN.test(m.content.trim())
  );
  if (!hasTrigger) return true; // 没有触发器就不处理
}
```

### 解决方案：自动注册第一个群组

**文件**: `src/index.ts`

实现了 `maybeAutoRegisterMainGroup()` 函数：

```typescript
/**
 * Auto-register a group as main group if no groups are registered yet.
 * This solves the "chicken-and-egg" problem where the first group
 * cannot be registered without being able to send commands.
 */
function maybeAutoRegisterMainGroup(jid: string, chatName?: string): boolean {
  // 检查是否已有注册的群组
  const registeredCount = Object.keys(registeredGroups).length;
  if (registeredCount > 0) {
    return false; // 已有注册群组，不执行自动注册
  }

  // 从 JID 生成文件夹名
  // 对于飞书: feishu:oc_xxx -> feishu-oc_xxx
  let folder: string;
  if (jid.startsWith('feishu:')) {
    const uniqueId = jid.replace('feishu:', '');
    folder = `feishu-${uniqueId}`;
  } else {
    // 回退方案: 从聊天名称生成安全的文件夹名
    const safeName = (chatName || 'chat')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .slice(0, 30);
    folder = `auto-${safeName}-${Date.now().toString(36)}`;
  }

  // 验证文件夹可以创建
  try {
    resolveGroupFolderPath(folder);
  } catch (err) {
    logger.warn({ jid, folder, err }, 'Cannot auto-register: invalid folder');
    return false;
  }

  // 注册为主群组
  logger.info(
    { jid, chatName, folder },
    'Auto-registering first group as main group',
  );

  registerGroup(jid, {
    name: chatName || 'Main',
    folder: folder,
    trigger: `@${ASSISTANT_NAME}\\b`,
    added_at: new Date().toISOString(),
    isMain: true, // 第一个群组成为主群组
  });

  return true;
}
```

在 `onChatMetadata` 回调中调用：

```typescript
onChatMetadata: (
  chatJid: string,
  timestamp: string,
  name?: string,
  channel?: string,
  isGroup?: boolean,
) => {
  storeChatMetadata(chatJid, timestamp, name, channel, isGroup);

  // 自动注册第一个群组为主群组，解决"鸡生蛋"问题
  maybeAutoRegisterMainGroup(chatJid, name);
},
```

### 工作流程

1. **首次安装**：系统启动时没有任何注册的群组
2. **收到第一条消息**：当任意群组（如飞书私聊）发送第一条消息时
3. **自动注册**：系统检测到没有注册群组，自动将当前群组注册为主群组
4. **立即可用**：该群组立即可以处理所有消息，不需要触发器

### 后续群组注册
一旦第一个群组注册成功，就可以通过对话来注册其他群组：

1. 在任意群组中发送 `@Andy register`
2. NanoClaw 会自动注册该群组（作为普通群组，需要触发器）

### 手动注册（可选）

如果需要手动注册主群组，可以通过命令行：

```bash
npm run setup register \
  --jid "feishu:oc_93dac2e93467e6c7eff34210368cbdc0" \
  --name "Feishu Main" \
  --folder "feishu-main" \
  --trigger "@Andy" \
  --is-main \
  --channel feishu
```

---

## 问题 1: 飞书 WebSocket 连接错误

### 问题描述
```
Access token not available. Please complete OAuth authentication first.
```

### 原因分析
代码尝试在 WebSocket 连接前获取 access_token，但实际上 Lark WSClient 可以直接使用 appId 和 appSecret 进行连接，不需要预先获取 access_token。

### 解决方案
**文件**: `src/feishu/client.ts`

移除了 access_token 的检查逻辑：

```typescript
async connect(): Promise<void> {
  // 移除了: if (!this.credentials.accessToken) 的检查

  this.wsClient = new Lark.WSClient({
    appId: this.credentials.appId,
    appSecret: this.credentials.appSecret,
    domain: BRAND_TO_DOMAIN[this.brand],
    loggerLevel: Lark.LoggerLevel.debug,
  });

  // ... 其余代码
}
```

---

## 问题 2: 数据库外键约束错误

### 问题描述
```
FOREIGN KEY constraint failed
```

### 原因分析
messages 表通过外键引用 chats 表，但在存储消息之前，聊天记录尚未创建，导致外键约束失败。

### 解决方案
**文件**: `src/channels/feishu.ts`

调整处理顺序，先创建聊天记录，再存储消息：

```typescript
private handleMessageEvent(event: FeishuEvent): void {
  if (event.type === 'im.message.receive_v1' && event.event?.message) {
    const msg = event.event.message;
    const chatId = msg.chat_id;

    // ... 解析消息内容

    // 先存储聊天元数据，避免外键约束错误
    this.onChatMetadata(jid, msg.create_time, chatId, 'feishu', isGroup);

    // 再存储消息
    const newMessage: NewMessage = { /* ... */ };
    this.onMessage(jid, newMessage);
  }
}
```

---

## 问题 3: 发送者字段为空

### 问题描述
数据库中 sender 字段为空字符串。

### 原因分析
sender 信息位于 `event.event.sender`，而不是 `event.event.message.sender`。类型定义不正确。

### 解决方案

**文件**: `src/feishu/types.ts`

添加 sender 字段到事件类型定义：

```typescript
export interface FeishuEvent {
  type: string;
  event?: {
    operator?: { open_id: string; };
    sender?: {  // 添加此字段
      sender_id: {
        open_id: string;
        union_id?: string;
        user_id?: string | null;
      };
      sender_type: string;
      tenant_key: string;
    };
    message?: { /* ... */ };
  };
}
```

**文件**: `src/channels/feishu.ts`

从正确的位置提取发送者信息：

```typescript
const senderOpenId = event.event?.sender?.sender_id?.open_id || '';
```

---

## 问题 4: 405 Not Allowed API 错误（核心问题）

### 问题描述
```
API Error: 405 <html><head><title>405 Not Allowed</title>
```

### 原因分析
nanoclaw-fork 使用了**代理模式**（credential-proxy），容器通过 `http://host.docker.internal:3002` 访问 API，只传递 placeholder 密钥。但智谱 API 不支持这种代理方式。

**原始 nanoclaw 的做法**（参考 `/root/project/nanoclaw/`）：
直接将真实的 API 密钥传递到容器中，不通过代理。

### 解决方案

**文件**: `src/container-runner.ts`

1. 添加 `readEnvFile` 导入：
```typescript
import { readEnvFile } from './env.js';
```

2. 修改 `buildContainerArgs` 函数，直接传递真实 API 密钥：

```typescript
function buildContainerArgs(
  mounts: VolumeMount[],
  containerName: string,
): string[] {
  const args: string[] = ['run', '-i', '--rm', '--name', containerName];

  args.push('-e', `TZ=${TIMEZONE}`);

  // 读取 API 凭据
  const secrets = readEnvFile([
    'ANTHROPIC_API_KEY',
    'CLAUDE_CODE_OAUTH_TOKEN',
    'ANTHROPIC_AUTH_TOKEN',
    'ANTHROPIC_BASE_URL',
  ]);

  // 直接使用 API 凭据，不通过代理
  const authMode = detectAuthMode();
  const apiBaseUrl = secrets.ANTHROPIC_BASE_URL || 'https://api.anthropic.com';

  args.push('-e', `ANTHROPIC_BASE_URL=${apiBaseUrl}`);

  // 直接传递真实的 API 密钥到容器
  if (authMode === 'api-key' && secrets.ANTHROPIC_API_KEY) {
    args.push('-e', `ANTHROPIC_API_KEY=${secrets.ANTHROPIC_API_KEY}`);
  } else if (authMode === 'oauth') {
    const oauthToken = secrets.CLAUDE_CODE_OAUTH_TOKEN || secrets.ANTHROPIC_AUTH_TOKEN;
    if (oauthToken) {
      args.push('-e', `CLAUDE_CODE_OAUTH_TOKEN=${oauthToken}`);
    }
  }

  // ... 其余代码
}
```

**文件**: `.env`

配置环境变量（同时设置 API_KEY 和 AUTH_TOKEN）：

```bash
ANTHROPIC_API_KEY=de398026f8f847ed9810c4cb15d3151c.ZJQQ55CPrxyuHjo6
ANTHROPIC_AUTH_TOKEN=de398026f8f847ed9810c4cb15d3151c.ZJQQ55CPrxyuHjo6
ANTHROPIC_BASE_URL=https://open.bigmodel.cn/api/anthropic
API_TIMEOUT_MS=3000000
CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1
LOG_LEVEL=debug
```

---

## 问题 5: detectAuthMode 不支持 ANTHROPIC_AUTH_TOKEN

### 问题描述
`detectAuthMode()` 函数只检查 `ANTHROPIC_API_KEY`，导致即使设置了 `ANTHROPIC_AUTH_TOKEN` 也被识别为 OAuth 模式。

### 解决方案
**文件**: `src/credential-proxy.ts`

```typescript
export function detectAuthMode(): AuthMode {
  const secrets = readEnvFile(['ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN']);
  // 支持 ANTHROPIC_AUTH_TOKEN 作为 api-key 模式（智谱 API 兼容）
  const apiKey = secrets.ANTHROPIC_API_KEY || secrets.ANTHROPIC_AUTH_TOKEN;
  return apiKey ? 'api-key' : 'oauth';
}
```

同样更新 `startCredentialProxy` 中的密钥读取逻辑：

```typescript
const apiKey = secrets.ANTHROPIC_API_KEY || secrets.ANTHROPIC_AUTH_TOKEN;
const authMode: AuthMode = apiKey ? 'api-key' : 'oauth';
```

---

## 问题 6: Session 持久化导致的问题

### 问题描述
```
Agent error: Claude Code returned an error result: No conversation found with session ID: xxx
```

### 原因分析
1. 服务重启后，数据库中保存的旧的 session ID
2. 智谱 API 无法识别这些旧的 session
3. 尝试 resume 时失败

### 解决方案

**文件**: `src/index.ts`

添加自动清除错误 session 的逻辑：

```typescript
if (output.status === 'error') {
  logger.error(
    { group: group.name, error: output.error },
    'Container agent error',
  );

  // 如果错误包含 "session"，自动清除 session
  if (output.error && output.error.toLowerCase().includes('session')) {
    logger.info(
      { group: group.name, sessionId: sessions[group.folder] },
      'Session error detected, clearing session',
    );
    delete sessions[group.folder];
    // 从数据库也删除
    const { deleteSession } = await import('./db.js');
    deleteSession(group.folder);
  }

  return 'error';
}
```

**文件**: `src/db.ts`

添加 `deleteSession` 函数：

```typescript
export function deleteSession(groupFolder: string): void {
  db.prepare('DELETE FROM sessions WHERE group_folder = ?').run(groupFolder);
}
```

---

## 问题 7: IPC 文件权限问题

### 问题描述
```
Failed to process input file xxx.json: EACCES: permission denied, unlink '/workspace/ipc/input/xxx.json'
```

容器陷入无限循环，不断尝试删除 IPC 文件但权限不足。

### 原因分析
1. 服务以 root 用户运行
2. 容器以 node 用户 (uid 1000) 运行
3. IPC 目录以 root:root 755 权限创建
4. 容器内的 node 用户无法删除 root 创建的文件

### 解决方案

**文件**: `src/container-runner.ts`

在创建 IPC 目录时设置 777 权限：

```typescript
const groupIpcDir = resolveGroupIpcPath(group.folder);
fs.mkdirSync(path.join(groupIpcDir, 'messages'), { recursive: true, mode: 0o777 });
fs.mkdirSync(path.join(groupIpcDir, 'tasks'), { recursive: true, mode: 0o777 });
fs.mkdirSync(path.join(groupIpcDir, 'input'), { recursive: true, mode: 0o777 });
```

修复现有目录权限：

```bash
chmod -R 777 /root/project/nanoclaw-fork/nanoclaw/data/ipc/feishu-main/
```

---

## 最终验证

### 容器环境变量（正确配置）
```bash
ANTHROPIC_BASE_URL=https://open.bigmodel.cn/api/anthropic
ANTHROPIC_API_KEY=de398026f8f847ed9810c4cb15d3151c.ZJQQ55CPrxyuHjo6
```

### 测试结果

**第一条消息**：
- 输入: "这是测试历史信息的输入，请列出三条你的功能"
- AI 正常回复，列出飞书文档管理、定时任务调度、网页浏览等功能

**第二条消息**：
- 输入: "你回复的第二条功能是什么"
- AI 正确记住上下文，回复："我回复的第二条功能是：⏰ 定时任务调度"

✅ 会话记忆功能正常工作

---

## 关键学习点

1. **智谱 API 不支持代理模式**
   - 必须直接传递真实的 API 密钥到容器
   - 不能使用 credential-proxy 的 placeholder 模式

2. **参考成功配置**
   - 原始 nanoclaw (`/root/project/nanoclaw/`) 使用直接密钥传递方式
   - 配置文件中同时设置 `ANTHROPIC_API_KEY` 和 `ANTHROPIC_AUTH_TOKEN`

3. **文件权限管理**
   - 容器以 node 用户运行时，需要确保挂载的目录有写入权限
   - 使用 `mode: 0o777` 创建目录确保容器用户可以读写

4. **Session 自动恢复**
   - 检测 session 错误并自动清除
   - 自动重试机制确保服务可用性

5. **环境变量配置**
   - 需要同时设置 `ANTHROPIC_API_KEY` 和 `ANTHROPIC_AUTH_TOKEN`
   - 确保 `detectAuthMode()` 能正确识别 API key 模式

---

## 服务管理

```bash
# 构建项目
npm run build

# 重启服务
systemctl --user restart nanoclaw-fork

# 查看日志
journalctl --user -u nanoclaw-fork -f

# 清除会话
node -e "
const Database = require('better-sqlite3');
const db = new Database('/root/project/nanoclaw-fork/nanoclaw/store/messages.db');
db.prepare('DELETE FROM sessions WHERE group_folder = ?').run('feishu-main');
"

# 修复 IPC 权限
chmod -R 777 /root/project/nanoclaw-fork/nanoclaw/data/ipc/feishu-main/
```

---

## 问题 8: 自动注册创建重复群组

### 问题描述
自动注册功能在服务重启时会创建新的群组，导致：
- 原有的`feishu-main`群组被新的自动注册群组替换
- Session历史丢失
- 消息被路由到错误的群组

### 原因分析
自动注册功能只检查内存中的`registeredGroups`，没有检查数据库中是否已存在该JID的群组。

### 解决方案

**文件**: `src/index.ts`

修改`maybeAutoRegisterMainGroup`函数，先检查数据库：

```typescript
function maybeAutoRegisterMainGroup(jid: string, chatName?: string): boolean {
  // 检查数据库中是否已有该JID的群组
  const existingGroup = getRegisteredGroup(jid);
  if (existingGroup) {
    // 群组已在数据库中，加载到内存
    logger.info({ jid, folder: existingGroup.folder }, 'Group already registered, loading into memory');
    registeredGroups[jid] = existingGroup;
    return false;
  }

  // 检查是否已有其他群组注册
  const registeredCount = Object.keys(registeredGroups).length;
  if (registeredCount > 0) {
    return false; // 已有注册群组
  }

  // ... 继续自动注册逻辑
}
```

---

## 容器生命周期与Session持久化

### Container生命周期

**重要发现**: 不是每个消息都创建新容器！

#### 容器启动时机
- 当有新消息到达且当前没有活跃容器时
- 系统调用`processGroupMessages()` → `runAgent()` → 启动Docker容器

#### 容器持续运行
- 容器启动后监听`/workspace/ipc/input/`目录
- **后续消息通过IPC传递给同一个容器**
- 容器通过`MessageStream`保持活跃，不会立即退出

#### 空闲超时机制
```typescript
export const IDLE_TIMEOUT = 1800000; // 30分钟
```
- 容器在30分钟无活动后会自动停止
- 容器使用`--rm`标志，停止后自动删除

#### 容器命令
```bash
docker run -i --rm --name nanoclaw-{group}-{timestamp} ...
```
- `-i`: 保持stdin开放
- `--rm`: 退出后自动删除

### Session持久化验证

通过日志分析验证了Session的正确性：

**测试场景**: 发送3条连续消息
1. "测试消息，请列出10个成语"
2. "你写的第五个成语是什么"
3. "这是测试容器的消息，请按照消息顺序回复1、2、3"

**验证结果**:
```
容器名称: nanoclaw-feishu-main-1773991670287
Session ID: 306e065f-ee7e-49dc-8544-c0ea395f261b
状态: 所有消息在同一容器中处理 ✅
记忆功能: AI正确记住之前对话内容 ✅
```

**容器日志**:
```
[agent-runner] Starting query (session: new, resumeAt: latest)...
[agent-runner] Session initialized: 306e065f-ee7e-49dc-8544-c0ea395f261b
[agent-runner] Piping IPC message into active query (133 chars)
[agent-runner] Session initialized: 306e065f-ee7e-49dc-8544-c0ea395f261b
[agent-runner] Piping IPC message into active query (146 chars)
```

**关键发现**:
1. ✅ **容器复用**: 所有消息在同一个容器中处理
2. ✅ **Session持久化**: Session ID在整个对话中保持一致
3. ✅ **IPC机制**: 后续消息通过IPC传递给活跃容器
4. ✅ **上下文记忆**: AI能记住之前对话的内容

### 容器生命周期总结

| 阶段 | 描述 | 时间 |
|------|------|------|
| **启动** | 有新消息且无活跃容器时 | 首次消息 |
| **运行** | 持续处理通过IPC传入的消息 | 持续 |
| **空闲** | 30分钟无活动后停止 | 30分钟超时 |
| **停止** | 收到`_close`信号或空闲超时 | 自动 |
| **清理** | `--rm`标志自动删除容器 | 自动 |

---

## 文件修改清单

1. `src/feishu/client.ts` - 移除 access_token 检查
2. `src/feishu/types.ts` - 添加 sender 字段
3. `src/channels/feishu.ts` - 调整处理顺序和 sender 提取
4. `src/container-runner.ts` - 直接传递 API 密钥、修复 IPC 目录权限（mode: 0o777）
5. `src/credential-proxy.ts` - 支持 ANTHROPIC_AUTH_TOKEN
6. `src/index.ts` - 添加 session 自动清除逻辑、优化自动注册功能
7. `src/db.ts` - 添加 deleteSession 函数
8. `.env` - 配置 API 凭据

---

## 系统状态

✅ 飞书 WebSocket 连接正常
✅ 消息接收和存储正常
✅ 智谱 API 集成正常
✅ Session 持久化功能正常（已验证）
✅ 容器生命周期管理正常
✅ IPC 文件权限正常
✅ 自动错误恢复机制正常
✅ 自动注册功能优化完成

**文档生成时间**: 2026-03-20
**文档版本**: 2.0
**最后更新**: 添加容器生命周期和Session持久化验证
