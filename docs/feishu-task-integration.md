# 飞书任务（Feishu Task）集成

## 概述

NanoClaw 通过 IPC 代理模式实现飞书任务操作。容器内的 Agent 通过 MCP 工具发起请求，主机端的飞书客户端代理执行实际 API 调用。

## 架构

```
容器内 Agent
  ↓ MCP 工具调用（feishu_task_create 等）
  ↓ MCP Server 注册工具 + 参数校验（zod）
container/agent-runner/src/ipc-mcp-stdio.ts
  ↓ 写入 IPC 请求文件
/data/ipc/{group}/feishu/requests/{id}.json
  ↓ 主机 IPC Watcher 轮询
src/ipc.ts → switch(request.type) → task_create 等
  ↓ 调用 FeishuClient 方法
src/feishu/client.ts → this.client.request()
  ↓ HTTP 请求飞书 API
飞书开放平台
```

### v1 / v2 API 分工

飞书 Task API 有两个版本，Bot 身份（tenant_access_token）的支持范围不同：

| API 版本 | 适用操作 | Bot 身份 |
|----------|---------|---------|
| **v2** | 创建、更新、完成、重开、评论、提醒、成员、子任务、订阅、任务列表 | ✅ 可用 |
| **v1** | 列表、搜索 | ✅ 可用 |
| v2 搜索 | task_search (filter)、tasklist_search | ❌ 需要 user_access_token |

**关键结论**：v2 的 `GET /task/v2/tasks`（我的任务）和 `POST /task/v2/tasks/search`（搜索）不支持 Bot 身份，使用 v1 的 `GET /task/v1/tasks` 替代。

## 文件清单

| 文件 | 变更内容 |
|------|---------|
| `container/agent-runner/src/ipc-mcp-stdio.ts` | 新增 21 个 MCP 工具注册（参数校验 + IPC 写入） |
| `src/feishu/client.ts` | 新增 21 个 Task API 方法 |
| `src/ipc.ts` | 新增 21 个 `task_*`/`tasklist_*` IPC 处理 |
| `container/skills/feishu-task/SKILL.md` | 容器技能文档 |
| `groups/global/CLAUDE.md` | 全局群组记忆，添加任务工具参考 |
| `groups/main/CLAUDE.md` | 主控群组记忆，添加任务工具参考 |

## 支持的操作

### 任务核心（v2 API）

| 操作 | MCP 工具 | IPC type | FeishuClient 方法 | HTTP |
|------|---------|----------|-------------------|------|
| 创建 | `feishu_task_create` | `task_create` | `createTask(params)` | POST `/task/v2/tasks` |
| 获取 | `feishu_task_get` | `task_get` | `getTask(taskId)` | GET `/task/v2/tasks/{id}` |
| 更新 | `feishu_task_update` | `task_update` | `updateTask(id, task, fields)` | PATCH `/task/v2/tasks/{id}` |
| 完成 | `feishu_task_complete` | `task_complete` | `completeTask(id)` | PATCH（设置 completed_at） |
| 重开 | `feishu_task_reopen` | `task_reopen` | `reopenTask(id)` | PATCH（设置 completed_at=0） |
| 评论 | `feishu_task_comment` | `task_comment` | `addTaskComment(id, content)` | POST `/task/v2/comments` |
| 子任务 | `feishu_task_set_ancestor` | `task_set_ancestor` | `setTaskAncestor(id, ancestorId?)` | POST |
| 订阅 | `feishu_task_subscribe_event` | `task_subscribe_event` | `subscribeTaskEvent(id, types)` | POST |

### 成员与提醒（v2 API）

| 操作 | MCP 工具 | IPC type | FeishuClient 方法 |
|------|---------|----------|-------------------|
| 添加成员 | `feishu_task_add_members` | `task_add_members` | `addTaskMembers(id, members)` |
| 移除成员 | `feishu_task_remove_members` | `task_remove_members` | `removeTaskMembers(id, members)` |
| 添加提醒 | `feishu_task_add_reminders` | `task_add_reminders` | `addTaskReminders(id, reminders)` |
| 移除提醒 | `feishu_task_remove_reminders` | `task_remove_reminders` | `removeTaskReminders(id, ids)` |

### 列表与搜索（v1 API，Bot 身份可用）

| 操作 | MCP 工具 | IPC type | FeishuClient 方法 | HTTP |
|------|---------|----------|-------------------|------|
| 我的任务 | `feishu_task_get_my_tasks` | `task_get_my_tasks` | `getMyTasks(params)` | GET `/task/v1/tasks` |
| 搜索 | `feishu_task_search` | `task_search` | `searchTask(params)` | GET `/task/v1/tasks` |
| 关联任务 | `feishu_task_get_related_tasks` | `task_get_related_tasks` | `getRelatedTasks(params)` | 同 getMyTasks |

### 任务列表（v2 API）

| 操作 | MCP 工具 | IPC type | FeishuClient 方法 |
|------|---------|----------|-------------------|
| 创建 | `feishu_tasklist_create` | `tasklist_create` | `createTasklist(params)` |
| 获取 | `feishu_tasklist_get` | `tasklist_get` | `getTasklist(id)` |
| 添加任务 | `feishu_task_add_tasklist` | `task_add_tasklist` | `addTaskToTasklist(taskId, guid)` |
| 添加成员 | `feishu_tasklist_add_members` | `tasklist_add_members` | `addTasklistMembers(id, members)` |
| 移除成员 | `feishu_tasklist_remove_members` | `tasklist_remove_members` | `removeTasklistMembers(id, members)` |

## 关键 API 参数

### 完成任务（非 POST，而是 PATCH）

```json
// completeTask
PATCH /open-apis/task/v2/tasks/{id}
{
  "task": { "completed_at": "1777640000000" },
  "update_fields": ["completed_at"]
}

// reopenTask
PATCH /open-apis/task/v2/tasks/{id}
{
  "task": { "completed_at": "0" },
  "update_fields": ["completed_at"]
}
```

> **注意**：不是 POST `/tasks/{id}/complete`，该路径返回 404。

### 评论（resource_id 而非 task_id）

```json
POST /open-apis/task/v2/comments
{
  "content": "评论内容",
  "resource_id": "任务GUID",
  "resource_type": "task"
}
```

### 提醒（relative_fire_minute，分钟数）

```json
POST /open-apis/task/v2/tasks/{id}/add_reminders
{
  "reminders": [{ "relative_fire_minute": 60 }]  // 截止前60分钟
}
```

> **注意**：字段是 `relative_fire_minute`（分钟），不是 `relative_time`（秒）。

### 清单成员（role 仅支持 editor/viewer）

```json
POST /open-apis/task/v2/tasklists/{id}/add_members
{
  "members": [{ "id": "ou_xxx", "type": "user", "role": "editor" }]
}
```

### 清单成员移除（members 数组，不是 member_ids）

```json
POST /open-apis/task/v2/tasklists/{id}/remove_members
{
  "members": [{ "id": "ou_xxx", "type": "user" }]
}
```

### 清单归档删除

```json
PATCH /open-apis/task/v2/tasklists/{id}
{
  "tasklist": { "archive_tasklist": true },
  "update_fields": ["archive_tasklist"]
}
```

> update_fields 仅支持：`name`、`owner`、`archive_tasklist`。

## 权限要求

飞书开放平台需要开通以下权限：

| 权限 | 用途 |
|------|------|
| `task:task:read` | 读取任务 |
| `task:task:write` | 创建/更新/完成/成员/提醒 |
| `task:tasklist:read` | 读取任务列表 |
| `task:tasklist:write` | 创建/管理任务列表 |
| `task:comment:write` | 添加评论 |
| `contact:user.id:readonly` | 通过 open_id 识别用户 |

**权限变更后必须发布新版本才生效。**

### 应用可见范围

Bot 只能操作**应用可见范围内**的用户。如果 add_members 返回 1470500 或 member id 为空，检查：

1. 飞书开放平台 → 应用 → **可用范围**
2. 确认目标用户在可见范围内（设为"全部员工"或添加对应用户）
3. 确认 open_id 正确（可通过 `GET /contact/v3/users/{id}` 验证，能返回姓名则可见）

## 测试方法

### 快速验证脚本

```bash
node -e "
const APP_ID = 'your_app_id';
const APP_SECRET = 'your_app_secret';
const USER_ID = 'ou_xxx';  // 在应用可见范围内的用户

async function run() {
  // 1. 获取 token
  const tRes = await fetch('https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ app_id: APP_ID, app_secret: APP_SECRET }),
  });
  const { tenant_access_token: token } = await tRes.json();
  const headers = { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' };

  // 2. 创建任务
  const res = await fetch('https://open.feishu.cn/open-apis/task/v2/tasks?user_id_type=open_id', {
    method: 'POST', headers,
    body: JSON.stringify({ summary: '测试任务' }),
  });
  const data = await res.json();
  console.log('Create:', data.code, data.data?.task?.guid);

  // 3. 列表任务 (v1)
  const listRes = await fetch('https://open.feishu.cn/open-apis/task/v1/tasks?page_size=10', {
    headers: { 'Authorization': 'Bearer ' + token },
  });
  const listData = await listRes.json();
  console.log('List:', listData.code, 'count:', listData.data?.items?.length);
}
run();
"
```

### 全量测试

运行 25 个接口的完整测试套件，覆盖所有操作：

```bash
# 修改 APP_ID、APP_SECRET、USER_ID 后运行
# USER_ID 必须在应用可见范围内
node test-task-api.mjs
```

测试覆盖：

1. **清单**：创建 → 获取 → 添加成员 → 移除成员 → 归档
2. **任务**：创建（含用户 assignee）→ 获取 → 更新 → 评论 → 添加提醒 → 移除提醒 → 完成 → 重开 → 添加成员 → 移除成员 → 子任务 → 订阅事件
3. **v1 列表**：getMyTasks → searchTask
4. **清理**：完成任务 → 归档清单

### 常见错误排查

| 错误码 | 原因 | 解决 |
|-------|------|------|
| 99991663 | Invalid access token | v2 列表/搜索接口不支持 Bot 身份，改用 v1 |
| 1470403 | 权限不足 | 检查应用是否有对应权限并已发布 |
| 1470404 | 资源不存在 | 确认 task/tasklist GUID 正确 |
| 1470500 | 内部错误 | 通常是用户不在应用可见范围，或参数格式问题 |
| 99992402 | 参数校验失败 | 检查请求体字段名和格式 |

### v1 vs v2 返回格式差异

| 字段 | v1 | v2 |
|------|----|----|
| 任务 ID | `id` | `guid` |
| 创建者 | `creator_id` | `creator.id` |
| 完成时间 | `complete_time`（秒级） | `completed_at`（毫秒级） |
| 任务列表 | 不返回 `tasklists` | `tasklists[].tasklist_guid` |
| 截止日期 | `due.time`（秒级） | `due.timestamp`（毫秒级） |
