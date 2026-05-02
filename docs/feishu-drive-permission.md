# 飞书云文档权限管理实现

## 概述

为 NanoClaw 的飞书集成添加了 Drive Permission API 支持，使容器内的 agent 可以管理文档和多维表格的协作者权限。

## 实现范围

5 个 Drive Permission 操作，覆盖文档（docx）和多维表格（bitable）：

| 操作 | API | 方法 |
|------|-----|------|
| 添加协作者 | `POST /open-apis/drive/v1/permissions/:token/members` | `addCollaborator` |
| 更新权限 | `PUT /open-apis/drive/v1/permissions/:token/members/:member_id` | `updateCollaborator` |
| 列出协作者 | `GET /open-apis/drive/v1/permissions/:token/members` | `listCollaborators` |
| 删除协作者 | `DELETE /open-apis/drive/v1/permissions/:token/members/:member_id` | `removeCollaborator` |
| 转让所有者 | `POST /open-apis/drive/v1/permissions/:token/members/transfer_owner` | `transferOwner` |

## 身份验证

使用 **bot (tenant_access_token)** 身份，与现有 API 调用方式一致。Bot 必须是文档创建者或拥有管理权限。

## 修改文件

### 1. `src/feishu/client.ts` — API 方法层

在 `Drive Permission Operations` 区域添加 5 个方法，使用 `this.client.request()` 模式（与 `deleteDoc`、`deleteBitable` 一致）：

```typescript
// 调用示例
await client.addCollaborator('token', 'bitable', 'openid', 'ou_xxx', 'edit', 'user');
await client.updateCollaborator('token', 'docx', 'ou_xxx', 'view');
await client.listCollaborators('token', 'bitable');
await client.removeCollaborator('token', 'docx', 'ou_xxx');
await client.transferOwner('token', 'bitable', 'openid', 'ou_xxx');
```

### 2. `src/channels/feishu.ts` — Channel 代理层

添加 5 个代理方法，直接委托给 `this.client`，与现有 `fetchDoc`、`createBitableApp` 等模式一致。

### 3. `src/ipc.ts` — IPC 调度层

在 feishu switch-case 中添加 5 个新的 case：

| IPC type | 调用 |
|----------|------|
| `add_collaborator` | `feishuChannel.addCollaborator(...)` |
| `update_collaborator` | `feishuChannel.updateCollaborator(...)` |
| `list_collaborators` | `feishuChannel.listCollaborators(...)` |
| `remove_collaborator` | `feishuChannel.removeCollaborator(...)` |
| `transfer_owner` | `feishuChannel.transferOwner(...)` |

### 4. `container/agent-runner/src/ipc-mcp-stdio.ts` — MCP 工具层

添加 5 个 MCP tool，遵循现有 IPC 模式（写请求文件 → 轮询结果文件）：

| MCP 工具 | 说明 |
|----------|------|
| `feishu_add_collaborator` | 添加协作者 |
| `feishu_update_collaborator` | 更新权限 |
| `feishu_list_collaborators` | 列出协作者 |
| `feishu_remove_collaborator` | 删除协作者 |
| `feishu_transfer_owner` | 转让所有者 |

### 5. `container/skills/feishu-doc/SKILL.md` — 文档

更新快速索引表和权限管理操作指南，包含参数说明和常见场景示例。

### 6. `src/feishu/client.test.ts` — 测试

添加 7 个单元测试，覆盖所有 5 个方法的正常和异常路径。

## API 参数

### 通用参数

| 参数 | 说明 | 示例 |
|------|------|------|
| `token` | 文档/多维表格 token | 从 URL 提取 |
| `file_type` | 资源类型 | `docx`, `bitable`, `sheet`, `wiki`, `slides` |

### 权限级别

| 值 | 说明 |
|----|------|
| `full_access` | 完全访问（管理权限） |
| `edit` | 可编辑 |
| `comment` | 可评论 |
| `view` | 仅查看 |

### 成员标识

| member_type | 说明 | member_id 格式 |
|-------------|------|---------------|
| `openid` | 用户 open_id | `ou_xxx` |
| `userid` | 用户 user_id | `xxx` |
| `openchat` | 群组 | `oc_xxx` |

## 调用链路

```
Container Agent
  → MCP Tool (ipc-mcp-stdio.ts)
    → IPC 请求文件 (/workspace/ipc/feishu/requests/*.json)
      → Host IPC Watcher (ipc.ts)
        → FeishuChannel (feishu.ts)
          → FeishuClient (client.ts)
            → Lark SDK → 飞书 Drive Permission API
      ← IPC 结果文件 (/workspace/ipc/feishu/results/*.json)
    ← waitForFeishuResult() 轮询
  ← MCP Tool 返回结果
```

## 前置条件

飞书开放平台应用需要开通以下权限：
- `drive:permission` — 云文档权限管理
- Bot 需要是目标文档的创建者或拥有 `full_access` 权限
