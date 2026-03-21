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