# 飞书文档和多维表格功能修复记录

## 修复日期
2026-03-20 ~ 2026-03-21

## 问题概述

NanoClaw 的飞书文档和多维表格功能存在多个问题，导致无法正常创建文档、多维表格以及添加数据。

---

## 修复问题清单

### 1. 飞书凭证未传递到容器

**问题描述**：
容器内无法获取飞书的 `FEISHU_APP_ID` 和 `FEISHU_APP_SECRET` 环境变量。

**修复方案**：
在 `src/container-runner.ts` 中添加凭证加载和传递逻辑：

```typescript
// 加载飞书凭证
const FEISHU_CREDENTIALS_FILE = path.join(
  STORE_DIR,
  'auth',
  'feishu',
  'credentials.json',
);

function loadFeishuCredentials(): FeishuCredentials | null {
  // 从文件读取并返回凭证
}

// 在 buildContainerArgs 中传递凭证
const feishuCredentials = loadFeishuCredentials();
if (feishuCredentials) {
  args.push('-e', `FEISHU_APP_ID=${feishuCredentials.appId}`);
  args.push('-e', `FEISHU_APP_SECRET=${feishuCredentials.appSecret}`);
}
```

---

### 2. SKILL.md 路径错误

**问题描述**：
SKILL.md 中使用相对路径 `./dist/feishu/client.js`，但容器工作目录是 `/workspace/group`，不是项目根目录。

**修复方案**：
修改为绝对路径 `/workspace/project/dist/feishu/client.js`。

---

### 3. IPC 路径不匹配

**问题描述**：
- 主机 IPC 监听全局目录 `data/ipc/feishu/`
- 容器写入群组特定目录 `data/ipc/feishu-main/feishu/`

**修复方案**：
修改 `src/ipc.ts`，扫描所有群组的 feishu 子目录：

```typescript
// 遍历所有群组目录
for (const sourceGroup of groupFolders) {
  const feishuDir = path.join(ipcBaseDir, sourceGroup, 'feishu');
  // 处理该群组的飞书请求
}
```

---

### 4. getFeishuChannel 未传递

**问题描述**：
`startIpcWatcher` 缺少 `getFeishuChannel` 参数，无法获取飞书 channel 处理请求。

**修复方案**：
在 `src/index.ts` 中添加参数：

```typescript
startIpcWatcher({
  // ...其他参数
  getFeishuChannel: () => channels.find((ch) => ch.name === 'feishu'),
});
```

---

### 5. 文档内容添加 API 问题

**问题描述**：
- 使用了不存在的 `batch_create` 端点
- SDK 类型定义不匹配

**修复方案**：
使用原始 HTTP 请求逐个创建块：

```typescript
const blockResponse = await this.client.request({
  url: `/open-apis/docx/v1/documents/${documentId}/blocks/${documentId}/children`,
  method: 'POST',
  data: {
    index: i,
    children: [block],
  },
});
```

---

### 6. 多维表格 MCP 工具缺失

**问题描述**：
容器内缺少多维表格相关的 MCP 工具。

**修复方案**：

1. 在 `container/agent-runner/src/ipc-mcp-stdio.ts` 添加三个新工具：
   - `feishu_create_bitable` - 创建多维表格应用
   - `feishu_create_bitable_table` - 创建数据表
   - `feishu_add_bitable_records` - 批量添加记录

2. 在 `src/channels/feishu.ts` 添加对应的代理方法

3. 在 `src/ipc.ts` 添加请求处理逻辑

---

### 7. agent-runner-src 目录未更新

**问题描述**：
`data/sessions/feishu-main/agent-runner-src/` 目录挂载到容器，但文件是旧版本。

**修复方案**：
将最新源文件复制到该目录：

```bash
cp container/agent-runner/src/*.ts data/sessions/feishu-main/agent-runner-src/
```

---

### 8. 多维表格创建 API 端点错误

**问题描述**：
使用 `/open-apis/drive/v1/files/create_folder` 创建多维表格，返回 400 错误。

**修复方案**：
修改为正确的 API 端点 `/open-apis/bitable/v1/apps`：

```typescript
const response = await this.client.request({
  url: '/open-apis/bitable/v1/apps',
  method: 'POST',
  data: { name, folder_token: folderToken },
});
```

---

### 9. 创建数据表返回结构错误

**问题描述**：
代码检查 `response.data?.table`，但实际返回的是 `response.data.table_id`。

**修复方案**：
修改检查逻辑：

```typescript
if (response.code !== 0 || !response.data?.table_id) {
  throw new Error(`Failed to create bitable table: ${response.msg}`);
}
const tableId = response.data.table_id;
```

---

### 10. 飞书文档链接格式错误

**问题描述**：
生成的文档链接使用 `/docs/` 而不是 `/docx/`，导致链接无法访问。

**修复方案**：

1. 修改 `src/feishu/client.ts` 中的 `buildDocUrl` 方法：

```typescript
private buildDocUrl(docId: string, brand: LarkBrand): string {
  const domain = brand === 'lark' ? 'larksuite.com' : 'feishu.cn';
  return `https://${domain}/docx/${docId}`;  // 改为 /docx/
}
```

2. 更新 SKILL.md 添加链接格式注意事项：

```markdown
### 链接格式（重要）
- ⚠️ **飞书文档链接必须使用 `/docx/` 而不是 `/docs/`**
- 正确格式：`https://feishu.cn/docx/xxxxxxxxxx`
- 错误格式：`https://feishu.cn/docs/xxxxxxxxxx`
- 多维表格链接使用 `/base/`：`https://feishu.cn/base/xxxxxxxxxx`
```

---

## 文件修改清单

| 文件 | 修改内容 |
|------|---------|
| `src/container-runner.ts` | ~~添加飞书凭证加载和传递~~ **已移除**（安全修复） |
| `src/ipc.ts` | 修复 IPC 路径扫描，添加多维表格请求处理 |
| `src/index.ts` | 添加 getFeishuChannel 参数 |
| `src/channels/feishu.ts` | 添加多维表格操作方法 |
| `src/feishu/client.ts` | 修复 API 端点、返回结构、链接格式 |
| `container/agent-runner/src/ipc-mcp-stdio.ts` | 添加多维表格 MCP 工具 |
| `container/skills/feishu-doc/SKILL.md` | 重写，强调使用 MCP 工具和链接格式 |
| `data/sessions/feishu-main/agent-runner-src/*.ts` | 更新源文件 |

---

## 测试验证

### 文档创建测试
```bash
node -e "
const { FeishuClient } = require('./dist/feishu/client.js');
const client = new FeishuClient({ appId: '...', appSecret: '...' });
client.createDoc('测试文档', '# 测试\n内容');
"
# 结果：成功创建文档，链接格式正确
```

### 多维表格完整流程测试
```bash
# 1. 创建多维表格 -> 成功
# 2. 创建数据表 -> 成功
# 3. 批量添加记录 -> 成功
# 结果：https://feishu.cn/base/LMvobcpBtaLkCJsdJPlcbKn5nxc
```

---

## 注意事项

1. **重新构建容器**：修改 `container/agent-runner/src/` 后需要运行 `./container/build.sh`
2. **更新 agent-runner-src**：修改源文件后需要同步到 `data/sessions/feishu-main/agent-runner-src/`
3. **重启服务**：修改代码后需要 `systemctl --user restart nanoclaw-fork`
4. **权限配置**：飞书应用需要开通文档和多维表格相关权限

---

## 安全修复 (2026-03-21)

### 问题：凭证暴露风险

**问题描述**：
飞书凭证（`FEISHU_APP_ID` 和 `FEISHU_APP_SECRET`）作为环境变量注入到容器，存在以下风险：
- 大模型可通过 `printenv` 或读取 `/proc/self/environ` 获取凭证
- 对话日志可能记录凭证，导致泄露
- 恶意指令可能窃取凭证

**原因分析**：
凭证注入是早期设计遗留。实际上容器内的 MCP 工具通过 IPC 转发请求到 Host，所有 API 调用在 Host 端执行，容器内不需要凭证。

```
容器 MCP 工具 → IPC 文件 → Host IPC Watcher → 飞书 API
                    │
              凭证在此使用
              容器不需要凭证
```

**修复方案**：
移除 `src/container-runner.ts` 中的飞书凭证注入代码：

```typescript
// 移除前（不安全）
const feishuCredentials = loadFeishuCredentials();
if (feishuCredentials) {
  args.push('-e', `FEISHU_APP_ID=${feishuCredentials.appId}`);
  args.push('-e', `FEISHU_APP_SECRET=${feishuCredentials.appSecret}`);
}

// 移除后（安全）
// Feishu operations are proxied through IPC to the host.
// Credentials are never exposed to the container.
```

**同时移除**：
- `FEISHU_CREDENTIALS_FILE` 常量
- `FeishuCredentials` 接口（本地定义）
- `loadFeishuCredentials()` 函数

**验证**：`npm run build` 编译通过，功能不受影响

---

## 多维表格功能完善 (2026-03-21)

### 问题：多维表格 MCP 工具不完整

**问题描述**：
多维表格只有创建和添加记录功能，缺少读取和更新操作：
- 无法列出数据表
- 无法查询记录
- 无法获取字段列表
- 无法更新/删除记录

**修复方案**：

1. **新增 MCP 工具** (`container/agent-runner/src/ipc-mcp-stdio.ts`)：
   - `feishu_list_bitable_tables` - 列出多维表格中的所有数据表
   - `feishu_list_bitable_fields` - 获取数据表字段列表
   - `feishu_list_bitable_records` - 查询表格记录（支持过滤、排序、分页）
   - `feishu_update_bitable_record` - 更新指定记录
   - `feishu_delete_bitable_record` - 删除指定记录

2. **新增 Client 方法** (`src/feishu/client.ts`)：
   - `listBitableTables(appToken)` - 调用 `/open-apis/bitable/v1/apps/{app_token}/tables`
   - `listBitableFields(appToken, tableId)` - 获取字段列表
   - `updateBitableRecord(appToken, tableId, recordId, fields)` - 更新记录
   - `deleteBitableRecord(appToken, tableId, recordId)` - 删除记录

3. **新增 Channel 方法** (`src/channels/feishu.ts`)：
   - 代理上述 Client 方法

4. **新增 IPC 处理** (`src/ipc.ts`)：
   - 处理 `list_bitable_tables`、`list_bitable_fields`、`list_bitable_records`、`update_bitable_record`、`delete_bitable_record` 请求

5. **更新 SKILL.md** (`container/skills/feishu-doc/SKILL.md`)：
   - 添加新工具的使用说明和示例

**测试验证**：
```
用户: 查询员工信息表有多少条记录
Agent: 成功列出 10 条记录，包含在职/离职状态

用户: 把孙八的状态改为已离职
Agent: 成功更新记录，状态从"在职"改为"已离职"
```

---

### 问题：agent-runner-src 同步逻辑错误

**问题描述**：
`src/container-runner.ts` 中只有当目录不存在时才复制源代码：
```typescript
if (!fs.existsSync(groupAgentRunnerDir) && fs.existsSync(agentRunnerSrc)) {
  fs.cpSync(agentRunnerSrc, groupAgentRunnerDir, { recursive: true });
}
```
导致代码更新后不会同步到运行时目录。

**修复方案**：
移除目录存在检查，每次启动时都同步最新代码：
```typescript
// Always sync if source directory exists (updates on code changes)
if (fs.existsSync(agentRunnerSrc)) {
  fs.cpSync(agentRunnerSrc, groupAgentRunnerDir, { recursive: true });
}
```

---

### 问题：WebSocket 断开方法错误

**问题描述**：
服务停止时报错：`this.wsClient.stop is not a function`

**原因分析**：
Lark SDK 的 `WSClient` 类使用 `close()` 方法断开连接，不是 `stop()`。

**修复方案** (`src/feishu/client.ts`)：
```typescript
// 修复前
await this.wsClient.stop();

// 修复后
await this.wsClient.close();
```

---

## 完整的多维表格 MCP 工具列表

| 工具 | 功能 | 状态 |
|------|------|------|
| `feishu_create_bitable` | 创建多维表格应用 | ✅ |
| `feishu_create_bitable_table` | 创建数据表 | ✅ |
| `feishu_list_bitable_tables` | 列出所有数据表 | ✅ 新增 |
| `feishu_list_bitable_fields` | 获取字段列表 | ✅ 新增 |
| `feishu_list_bitable_records` | 查询表格记录 | ✅ 新增 |
| `feishu_add_bitable_records` | 批量添加记录 | ✅ |
| `feishu_update_bitable_record` | 更新指定记录 | ✅ 新增 |
| `feishu_delete_bitable_record` | 删除指定记录 | ✅ 新增 |

---

## 文件修改清单（更新）

| 文件 | 修改内容 |
|------|---------|
| `src/container-runner.ts` | 修复 agent-runner-src 同步逻辑 |
| `src/feishu/client.ts` | 新增 listBitableTables 等方法，修复 WebSocket close 方法 |
| `src/channels/feishu.ts` | 新增多维表格操作代理方法 |
| `src/ipc.ts` | 新增多维表格 IPC 请求处理 |
| `container/agent-runner/src/ipc-mcp-stdio.ts` | 新增 5 个多维表格 MCP 工具 |
| `container/skills/feishu-doc/SKILL.md` | 更新工具列表和使用说明 |

---

## 卡片消息与 Markdown 渲染修复 (2026-03-22)

### 问题 1：Markdown 消息显示原始格式

**问题描述**：
飞书消息使用 `text` 类型发送 Markdown 内容，导致飞书客户端显示原始 Markdown 文本，而不是渲染后的格式化文本。

**原因分析**：
飞书 API 的 `text` 消息类型不支持 Markdown 渲染。需要使用 `post` 类型并在内容中使用 `md` 标签才能实现 Markdown 格式化显示。

**修复方案** (`src/channels/feishu.ts`)：

```typescript
// 修复前 - text 类型不支持 Markdown 渲染
const response = await this.client.im.message.create({
  params: { receive_id_type: 'chat_id' },
  data: {
    receive_id: chatId,
    msg_type: 'text',
    content: JSON.stringify({ text: text }),
  },
});

// 修复后 - post 类型支持 Markdown 渲染
const response = await this.client.im.message.create({
  params: { receive_id_type: 'chat_id' },
  data: {
    receive_id: chatId,
    msg_type: 'post',
    content: JSON.stringify({
      zh_cn: { content: [[{ tag: 'md', text: text }]] }
    }),
  },
});
```

---

### 问题 2：缺少交互式卡片支持

**问题描述**：
NanoClaw 无法发送飞书交互式卡片消息，也无法接收卡片按钮回调。

**修复方案**：

1. **添加卡片数据类型** (`src/types.ts`)：
```typescript
export interface CardActionData {
  type: 'button_click' | 'select' | 'form_submit';
  value: Record<string, any>;
  source_message_id?: string;
  option?: string;
}
```

2. **添加 Channel 卡片方法** (`src/channels/feishu.ts`)：
   - `sendCard()` - 发送自定义卡片
   - `sendButtonCard()` - 发送带按钮的卡片
   - `sendConfirmCard()` - 发送确认卡片

3. **添加卡片回调处理**：
   - 监听 `card.action.trigger` WebSocket 事件
   - 将卡片动作转换为虚拟消息，注入到消息队列

4. **添加卡片 IPC 处理** (`src/ipc.ts`)：
   - `send_card` - 发送自定义卡片
   - `send_button_card` - 发送带按钮卡片

5. **添加卡片 MCP 工具** (`container/agent-runner/src/ipc-mcp-stdio.ts`)：
   - `feishu_send_card` - Agent 发送卡片消息
   - `feishu_send_confirm_card` - Agent 发送确认卡片

**卡片回调流程**：
```
用户点击按钮 → 飞书 WebSocket 推送 card.action.trigger 事件
                     │
                     ▼
         FeishuChannel.handleCardActionEvent()
                     │
                     ▼
         创建虚拟消息 (Virtual Message)
                     │
                     ▼
         存储到 SQLite + 加入消息队列
                     │
                     ▼
         Agent 处理虚拟消息，根据 value 执行操作
```

**平台配置要求**：
需要在飞书开发者后台订阅 `card.action.trigger` 事件，否则卡片按钮点击会返回错误码 200340。

---

### 问题 3：时间戳格式不一致

**问题描述**：
卡片回调生成的虚拟消息使用 ISO 格式时间戳（如 `2026-03-21T16:23:23.254Z`），而飞书消息使用毫秒格式（如 `1774110483868`），导致消息过滤逻辑异常。

**原因分析**：
`getNewMessages()` 通过比较时间戳字符串来过滤消息。ISO 格式字符串与毫秒格式字符串的比较结果不正确（ISO 字符串在字典序上更大），导致新消息被错误过滤。

**修复方案** (`src/index.ts`)：
```typescript
// 修复前 - 使用 ISO 格式
timestamp: new Date().toISOString(),

// 修复后 - 使用毫秒格式
timestamp: Date.now().toString(),
```

**数据清理**：
```sql
-- 删除错误时间格式的消息
DELETE FROM messages WHERE timestamp LIKE '2026-%';

-- 重置 router_state 的时间戳
UPDATE router_state SET
  last_timestamp = '1774112352056',
  last_agent_timestamp = '{"feishu:oc_xxx":"1774112352056"}';
```

---

## 文件修改清单（本次更新）

| 文件 | 修改内容 |
|------|---------|
| `src/channels/feishu.ts` | Markdown 渲染修复，添加卡片发送和回调处理 |
| `src/types.ts` | 添加 CardActionData 接口 |
| `src/channels/registry.ts` | 添加 onCardAction 回调参数 |
| `src/index.ts` | 添加卡片回调处理逻辑，修复时间戳格式 |
| `src/ipc.ts` | 添加卡片发送 IPC 处理 |
| `src/db.ts` | 添加 card_action 列 |
| `container/agent-runner/src/ipc-mcp-stdio.ts` | 添加卡片发送 MCP 工具 |

---

## 新增 MCP 工具

| 工具 | 功能 | 状态 |
|------|------|------|
| `feishu_send_card` | 发送交互式卡片 | ✅ 新增 |
| `feishu_send_confirm_card` | 发送确认卡片（带确认/取消按钮） | ✅ 新增 |

---

## 注意事项

1. **飞书平台配置**：需要在开发者后台订阅 `card.action.trigger` 事件
2. **时间戳格式**：所有时间戳必须使用毫秒格式，保持与飞书 API 一致
3. **容器重建**：修改 `container/agent-runner/src/` 后需要运行 `./container/build.sh`

---

## 自动注册群组 (2026-03-22)

### 问题：需要手动注册群组

**问题描述**：
每次添加新群组都需要手动执行注册命令，操作繁琐。

**修复方案**：
添加 `AUTO_REGISTER_GROUPS` 配置项，默认启用自动注册功能。

**配置项** (`src/config.ts`)：
```typescript
export const AUTO_REGISTER_GROUPS = process.env.AUTO_REGISTER_GROUPS !== 'false';
// 默认: true (启用自动注册)
```

**触发词规则**：
| 聊天类型 | 需要触发词 |
|---------|-----------|
| 单聊 (p2p) | 否 |
| 群聊 (非主群组) | 是 (`@Andy`) |
| 群聊 (主群组) | 否 |

**禁用方法**：
在 `.env` 中设置 `AUTO_REGISTER_GROUPS=false`

---

## 获取用户名 (2026-03-22)

### 问题：消息只显示用户 open_id

**问题描述**：
Agent 收到的消息中 `sender_name` 为空或显示为 open_id（如 `ou_xxxxx`），无法识别用户。

**修复方案**：
在 `FeishuClient` 中添加 `getUserName` 方法，调用飞书 API 获取用户信息。

**实现** (`src/feishu/client.ts`)：
```typescript
async getUserName(openId: string): Promise<string> {
  // 1. 检查缓存（1小时有效期）
  // 2. 调用飞书 API: GET /open-apis/contact/v3/users/:user_id
  // 3. 返回用户名称，失败时返回 open_id
}
```

**所需权限**（任选其一）：
- `contact:user.base:readonly` - 获取用户基本信息（推荐）
- `contact:contact:readonly_as_app` - 以应用身份读取通讯录

**权限配置步骤**：
1. 打开飞书开发者后台
2. 选择应用 → 权限管理 → API权限
3. 开通 `contact:user.base:readonly` 权限
4. 自建应用还需在数据权限中配置通讯录权限范围

---

## 文件修改清单（最新更新）

| 文件 | 修改内容 |
|------|---------|
| `src/config.ts` | 添加 AUTO_REGISTER_GROUPS 配置项 |
| `src/index.ts` | 自动注册逻辑，区分单聊/群聊触发词需求 |
| `src/feishu/client.ts` | 添加 getUserName 方法（含缓存） |
| `src/channels/feishu.ts` | 调用 getUserName 获取发送者名称 |

---

## 配置清单

| 配置项 | 说明 | 默认值 |
|-------|------|-------|
| `AUTO_REGISTER_GROUPS` | 自动注册新群组 | `true` |
| `AUTO_REGISTER_GROUPS=false` | 禁用自动注册 | - |

## 飞书应用权限清单

| 权限 | 用途 | 必须 |
|-----|------|-----|
| `im:message` | 发送消息 | ✅ |
| `im:message:send_as_bot` | 以机器人身份发送 | ✅ |
| `card.action.trigger` | 卡片回调事件 | 卡片功能需要 |
| `contact:user.base:readonly` | 获取用户信息 | 用户名显示需要 |
| `docx:document` | 文档操作 | 文档功能需要 |
| `bitable:app` | 多维表格操作 | 表格功能需要 |

---

## 文件消息支持 (2026-03-22)

### 问题：不支持用户发送的文件/图片/语音

**问题描述**：
用户发送的图片、文件、语音等消息类型，Agent 只能看到占位符文本（如 `[图片]`），无法获取实际内容进行分析处理。

**修复方案**：

1. **扩展消息数据结构** (`src/types.ts`)：
```typescript
export interface NewMessage {
  // ... 其他字段
  message_type?: 'text' | 'image' | 'file' | 'audio' | 'media' | 'post' | 'interactive';
  attachment?: MessageAttachment;
}

export interface MessageAttachment {
  type: 'image' | 'file' | 'audio' | 'video';
  key: string;           // 资源 key（用于下载）
  name?: string;         // 文件名
  size?: number;         // 文件大小
  message_id?: string;   // 消息ID（用于下载用户发送的资源）
}
```

2. **处理不同消息类型** (`src/channels/feishu.ts`)：
   - `text`: 普通文本
   - `post`: 富文本，提取文本内容
   - `image`: 图片，提取 image_key
   - `file`: 文件，提取 file_key 和文件名
   - `audio`: 语音，提取 file_key
   - `media`: 视频，提取 file_key

3. **添加资源下载能力** (`src/feishu/client.ts`)：
   - `downloadMessageResource()`: 下载资源到 Buffer
   - `downloadMessageResourceToFile()`: 下载资源到临时文件

4. **添加 IPC 处理** (`src/ipc.ts`)：
   - `download_resource`: 下载消息中的资源文件

5. **添加 MCP 工具** (`container/agent-runner/src/ipc-mcp-stdio.ts`)：
   - `feishu_download_resource`: Agent 下载资源文件

**使用示例**：

用户发送图片后，消息结构如下：
```json
{
  "id": "om_xxx",
  "content": "[图片]",
  "message_type": "image",
  "attachment": {
    "type": "image",
    "key": "img_v2_xxx",
    "message_id": "om_xxx"
  }
}
```

Agent 可以调用工具下载图片：
```
feishu_download_resource(message_id="om_xxx", file_key="img_v2_xxx")
```

返回临时文件路径，Agent 可以使用 Read 工具读取或进行其他处理。

---

## 新增 MCP 工具（更新）

| 工具 | 功能 | 状态 |
|------|------|------|
| `feishu_download_resource` | 下载消息中的资源文件（图片/文件/语音/视频） | ✅ 新增 |

---

## 文件修改清单（本次更新）

| 文件 | 修改内容 |
|------|---------|
| `src/types.ts` | 添加 MessageAttachment 接口，扩展 NewMessage |
| `src/feishu/types.ts` | 添加 message_type 字段 |
| `src/channels/feishu.ts` | 处理不同消息类型，提取附件信息 |
| `src/feishu/client.ts` | 添加下载资源文件方法 |
| `src/ipc.ts` | 添加 download_resource IPC 处理 |
| `container/agent-runner/src/ipc-mcp-stdio.ts` | 添加 feishu_download_resource 工具 |

---

## 文件下载路径修复 (2026-03-22)

### 问题：下载的文件容器无法访问

**问题描述**：
`feishu_download_resource` 工具下载文件到主机 `/tmp` 目录，但容器无法访问该路径，导致 agent 无法读取下载的文件。

**原因分析**：
```
Host: 下载文件到 /tmp/nanoclaw-feishu-downloads/xxx.pdf
Container: 无法访问主机的 /tmp 目录
```

**修复方案**：
将文件保存到 IPC 目录，该目录已挂载到容器：

```
Host 路径: data/ipc/{groupFolder}/downloads/xxx.pdf
容器路径: /workspace/ipc/downloads/xxx.pdf
```

**代码修改** (`src/feishu/client.ts`)：
```typescript
async downloadMessageResourceToFile(
  messageId: string,
  fileKey: string,
  fileName?: string,
  groupFolder?: string,  // 新增参数
): Promise<string> {
  // 如果提供了 groupFolder，保存到 IPC 目录
  if (groupFolder) {
    const downloadsDir = path.join(
      projectRoot,
      'data',
      'ipc',
      groupFolder,
      'downloads',
    );
    // 返回容器可访问的路径
    return `/workspace/ipc/downloads/${safeFileName}`;
  }
  // 否则回退到临时目录
}
```

---

## 消息格式修复 (2026-03-22)

### 问题：Agent 无法看到附件信息

**问题描述**：
用户发送文件后，agent 只能看到 `[文件] xxx.pdf` 这样的文本，不知道如何下载文件。

**原因分析**：
`formatMessages` 函数只输出消息内容，不包含 `message_type` 和 `attachment` 字段。

**修复方案**：

1. **更新消息格式** (`src/router.ts`)：
```xml
<message sender="用户名" timestamp="..."
         type="file"
         filename="文档.pdf"
         download_message_id="om_xxx"
         download_file_key="file_v3_xxx">
  [文件] 文档.pdf
</message>
```

2. **数据库字段** (`src/db.ts`)：
   - 添加 `message_type` 和 `attachment` 列
   - 更新 `storeMessage` 存储这些字段
   - 更新 `getNewMessages`、`getMessagesSince`、`getMessagesBefore` 检索这些字段

3. **更新 SKILL.md**：
   - 添加文件附件处理文档
   - 说明如何使用 `feishu_download_resource` 工具

---

## 文件修改清单（本次更新）

| 文件 | 修改内容 |
|------|---------|
| `src/router.ts` | 消息格式添加附件属性 |
| `src/db.ts` | 添加 message_type/attachment 列和存储/检索逻辑 |
| `src/feishu/client.ts` | 下载文件保存到 IPC 目录 |
| `src/channels/feishu.ts` | downloadMessageResource 添加 groupFolder 参数 |
| `src/ipc.ts` | 下载请求传递 groupFolder |
| `container/skills/feishu-doc/SKILL.md` | 添加文件附件处理文档 |

---

## Lark SDK ArrayBuffer Bug 修复 (2026-03-22)

### 问题：文件下载返回空数据

**问题描述**：
调用 `feishu_download_resource` 下载文件时，虽然 API 返回 200，但实际数据为空：
- `response.data` 为 `undefined`
- `response` 对象带有数字索引键（"0", "1", "2"...）

**原因分析**：
Lark SDK 的 `request` 方法在处理 `responseType: 'arraybuffer'` 时存在 bug。当 API 返回二进制数据时，SDK 将其错误地转换为一个带数字索引的对象，而不是正确的 ArrayBuffer。

**调试日志**：
```
responseType: "object"
hasData: false
dataType: "undefined"
isBuffer: false
keys: ["0", "1", "2", "3", ...]  // 应该是二进制数据，不是数字索引
```

**修复方案**：
使用原生 `fetch` API 绕过 Lark SDK 的 bug：

```typescript
async downloadMessageResource(
  messageId: string,
  fileKey: string,
  type: 'image' | 'file' | 'audio' | 'video' | 'media' = 'file',
): Promise<Buffer> {
  // 获取 tenant_access_token
  const token = await this.getTenantAccessToken();

  // 使用原生 fetch API 下载文件
  const url = `https://open.feishu.cn/open-apis/im/v1/messages/${messageId}/resources/${fileKey}?type=${type}`;
  const response = await fetch(url, {
    method: 'GET',
    headers: { Authorization: `Bearer ${token}` },
  });

  const arrayBuffer = await response.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

// 新增方法：获取 tenant_access_token
private async getTenantAccessToken(): Promise<string> {
  const response = await fetch(
    'https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        app_id: this.credentials.appId,
        app_secret: this.credentials.appSecret,
      }),
    },
  );
  const data = await response.json();
  return data.tenant_access_token;
}
```

**额外修复**：
- ES 模块兼容：用 `import.meta.url` 替代 `__dirname`

**验证结果**：
```
Result: { "success": true, "file_path": "/workspace/ipc/downloads/test.pdf" }
Downloaded file exists: data/ipc/feishu-main/downloads/test.pdf
File size: 1221880 bytes
```

---

## 文件修改清单（本次更新）

| 文件 | 修改内容 |
|------|---------|
| `src/feishu/client.ts` | 使用原生 fetch 下载文件，添加 getTenantAccessToken 方法，修复 ES 模块兼容 |
| `src/channels/feishu.ts` | downloadMessageResource 添加 type 参数 |
| `src/ipc.ts` | 下载请求传递 resource_type |
| `container/agent-runner/src/ipc-mcp-stdio.ts` | feishu_download_resource 添加 type 参数 |

---

## 完整的文件下载流程

```
1. 用户发送文件
      ↓
2. FeishuChannel 接收消息，提取 attachment 信息
      ↓
3. 消息格式化为 XML，包含 download_message_id 和 download_file_key
      ↓
4. Agent 看到消息，调用 feishu_download_resource 工具
      ↓
5. MCP 工具写入 IPC 请求文件
      ↓
6. Host IPC watcher 处理请求
      ↓
7. FeishuClient.downloadMessageResource() 下载文件
   - 获取 tenant_access_token
   - 使用 fetch API 下载二进制数据
      ↓
8. 文件保存到 data/ipc/{group}/downloads/
      ↓
9. 返回容器路径 /workspace/ipc/downloads/xxx
      ↓
10. Agent 使用 Read 工具读取文件内容
```

---

## PDF/DOCX 文件内容提取 (2026-03-22)

### 问题：Agent 无法提取 PDF 和 DOCX 文件内容

**问题描述**：
用户发送 PDF 或 DOCX 文件后，虽然文件可以成功下载，但 Agent 无法提取文件内容进行分析。

**原因分析**：
1. Container 镜像缺少文档处理工具（`pdftotext`、`pandoc`）
2. Agent 的 Bash 权限被 skill 的 `allowed-tools` 限制
3. `.claude` 目录权限不足，导致 session 环境无法创建

**修复方案**：

1. **添加文档处理工具** (`container/Dockerfile`)：
```dockerfile
RUN apt-get update && apt-get install -y \
    # ... 其他依赖
    poppler-utils \    # pdftotext - PDF 文本提取
    pandoc \           # 文档格式转换（支持 DOCX、EPUB、ODT 等）
    && rm -rf /var/lib/apt/lists/*
```

2. **添加 file-reader skill** (`container/skills/file-reader/SKILL.md`)：
   - 提供 PDF 文本提取说明
   - 提供 DOCX/EPUB/ODT 转换说明
   - 配置 `allowed-tools: Bash(pdftotext:*), Bash(pandoc:*)`

3. **移除 agent-browser skill 的 Bash 限制**：
```markdown
# 修复前
allowed-tools: Bash(agent-browser:*)  # 只允许执行 agent-browser 命令

# 修复后
# 移除 allowed-tools，使用全局 Bash 权限
```

4. **修复目录权限** (`src/container-runner.ts`)：
```typescript
// 修复前
fs.mkdirSync(groupSessionsDir, { recursive: true });

// 修复后
fs.mkdirSync(groupSessionsDir, { recursive: true, mode: 0o777 });
```

**验证结果**：
```
用户发送 PDF 文件
      ↓
Agent 下载文件到 /workspace/ipc/downloads/xxx.pdf
      ↓
Agent 执行: pdftotext /workspace/ipc/downloads/xxx.pdf -
      ↓
成功提取 PDF 文本内容
```

---

## 文件修改清单（本次更新）

| 文件 | 修改内容 |
|------|---------|
| `container/Dockerfile` | 添加 poppler-utils 和 pandoc |
| `container/skills/file-reader/SKILL.md` | 新增文件内容提取 skill |
| `container/skills/agent-browser/SKILL.md` | 移除 allowed-tools 限制 |
| `src/container-runner.ts` | 修复 .claude 目录权限 |

---

## 可用的文档处理命令

| 命令 | 用途 | 示例 |
|------|------|------|
| `pdftotext` | PDF 转文本 | `pdftotext file.pdf -` |
| `pandoc` | DOCX/EPUB/ODT 转文本 | `pandoc file.docx -t plain` |

---

## 完整的文件处理流程

```
1. 用户发送 PDF/DOCX 文件
      ↓
2. Agent 调用 feishu_download_resource 下载文件
      ↓
3. 文件保存到 /workspace/ipc/downloads/xxx.pdf
      ↓
4. Agent 执行 Bash 命令提取内容:
   - PDF: pdftotext /workspace/ipc/downloads/xxx.pdf -
   - DOCX: pandoc /workspace/ipc/downloads/xxx.docx -t plain
      ↓
5. Agent 分析提取的文本内容
      ↓
6. Agent 回复用户
```

---

## 文档创建速率限制修复 (2026-03-22)

### 问题：文档内容不完整

**问题描述**：
最近生成的两个飞书文档都不完整，日志显示大量错误：
1. **404 错误**：`batch_create` API 端点不存在
2. **429 错误**：速率限制导致内容添加失败

**原因分析**：

1. **`batch_create` API 不存在**：
   - `updateDoc` 方法使用了 `/children/batch_create` 端点
   - 飞书 API 没有这个端点，返回 404 Not Found
   - 日志：`statusCode: 404, data: '404 page not found'`

2. **速率限制触发**：
   - `createDoc` 方法逐个创建块（每个块一个 API 请求）
   - 当文档内容很多时，请求过快触发 429 Too Many Requests
   - 日志：`status: 429, statusText: 'Too Many Requests'`

**修复方案**：

1. **移除不存在的 `batch_create` 调用** (`src/feishu/client.ts`)：
```typescript
// 修复前 - 使用不存在的 batch_create 端点
await this.client.request({
  url: `/open-apis/docx/v1/documents/${actualDocId}/blocks/${actualDocId}/children/batch_create`,
  // ... 返回 404
});

// 修复后 - 逐个创建块
for (let i = 0; i < blocks.length; i++) {
  const block = blocks[i];
  await this.client.request({
    url: `/open-apis/docx/v1/documents/${actualDocId}/blocks/${actualDocId}/children`,
    method: 'POST',
    data: { index: -1, children: [block] },
  });
  // 添加延迟避免速率限制
  if (i < blocks.length - 1) {
    await this.sleep(this.RATE_LIMIT_DELAY);
  }
}
```

2. **添加速率限制延迟**：
```typescript
// 添加常量
private readonly RATE_LIMIT_DELAY = 250; // 250ms = 4次/秒

// 添加延迟方法
private sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// 在循环中添加延迟
if (i < blocks.length - 1) {
  await this.sleep(this.RATE_LIMIT_DELAY);
}
```

**修复效果**：
- 文档创建时逐块添加，每次请求间隔 250ms
- 避免触发飞书 API 速率限制（每秒最多 5 次请求）
- 文档内容完整添加

---

## 文件修改清单（本次更新）

| 文件 | 修改内容 |
|------|---------|
| `src/feishu/client.ts` | 修复 updateDoc 使用正确的 API，添加速率限制延迟 |

---

## 注意事项

1. **速率限制**：飞书文档 API 每秒最多 5 次请求，当前设置 250ms 延迟（4 次/秒）
2. **大文档**：如果文档内容很多（几十个块），创建时间会较长，但能确保内容完整
3. **错误处理**：单个块添加失败不会影响其他块，文档仍会创建成功