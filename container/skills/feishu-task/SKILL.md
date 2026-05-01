---
name: feishu-task
description: |
  飞书任务（Task）操作工具。

  **当以下情况时使用此 Skill**：
  (1) 需要创建、查看、更新、完成、重开飞书任务
  (2) 需要搜索任务、查看我的任务、查看关联任务
  (3) 需要给任务分配执行人、添加关注者
  (4) 需要设置任务提醒
  (5) 需要创建子任务（设置父任务）
  (6) 需要给任务添加评论
  (7) 需要管理任务列表（创建、搜索、成员管理）
  (8) 用户提到"任务"、"task"、"待办"、"todo"

  **重要说明**：
  - 此 Skill 使用 MCP 工具与飞书 Task API 交互
  - 列表/搜索使用 v1 API（Bot 身份可用），创建/更新/完成等使用 v2 API
  - 所有操作需要飞书凭证，已自动注入
  - 不要使用 Bash 命令，使用对应的 MCP 工具
---

# Feishu Task (飞书任务) SKILL

## 操作方式

- 所有操作通过 MCP 工具完成，不需要使用 Bash 命令
- 任务 ID 格式为 GUID（如 `xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx`）
- 用户 ID 使用 open_id（如 `ou_xxx`），应用 ID 使用 `cli_xxx`

---

## 快速索引：意图 → MCP 工具

### 任务操作

| 用户意图 | MCP 工具 | 说明 |
|---------|---------|------|
| 创建任务 | `feishu_task_create` | 创建新任务（标题、描述、截止日期、执行人等） |
| 查看任务 | `feishu_task_get` | 获取任务详情 |
| 更新任务 | `feishu_task_update` | 更新标题、描述、截止日期 |
| 完成任务 | `feishu_task_complete` | 标记任务为已完成 |
| 重开任务 | `feishu_task_reopen` | 重新打开已完成的任务 |
| 搜索任务 | `feishu_task_search` | 按关键词和条件搜索任务 |
| 我的任务 | `feishu_task_get_my_tasks` | 获取分配给我的任务 |
| 关联任务 | `feishu_task_get_related_tasks` | 获取与当前用户相关的任务 |

### 成员与提醒

| 用户意图 | MCP 工具 | 说明 |
|---------|---------|------|
| 分配执行人 | `feishu_task_add_members` | 添加执行人或关注者 |
| 移除成员 | `feishu_task_remove_members` | 移除执行人或关注者 |
| 添加提醒 | `feishu_task_add_reminders` | 设置任务提醒 |
| 移除提醒 | `feishu_task_remove_reminders` | 取消任务提醒 |

### 子任务与评论

| 用户意图 | MCP 工具 | 说明 |
|---------|---------|------|
| 设置父任务 | `feishu_task_set_ancestor` | 建立子任务关系 |
| 添加评论 | `feishu_task_comment` | 给任务添加评论 |
| 订阅事件 | `feishu_task_subscribe_event` | 订阅任务变更通知 |

### 任务列表

| 用户意图 | MCP 工具 | 说明 |
|---------|---------|------|
| 创建任务列表 | `feishu_tasklist_create` | 创建新的任务列表 |
| 查看任务列表 | `feishu_tasklist_get` | 获取任务列表详情 |
| 搜索任务列表 | `feishu_tasklist_search` | 搜索任务列表 |
| 添加到列表 | `feishu_task_add_tasklist` | 将任务添加到任务列表 |
| 添加列表成员 | `feishu_tasklist_add_members` | 添加任务列表成员 |
| 移除列表成员 | `feishu_tasklist_remove_members` | 移除任务列表成员 |

---

## 任务操作详解

### 1. 创建任务

```
feishu_task_create(
  summary: "任务标题",               // 必填
  description: "任务描述",           // 可选
  due: {                             // 可选，截止日期
    timestamp: "1700000000000",      // 毫秒时间戳
    is_all_day: false                // 是否全天
  },
  members: [                         // 可选，成员
    { id: "ou_xxx", role: "assignee", type: "user" },
    { id: "ou_yyy", role: "follower", type: "user" }
  ],
  tasklists: [                       // 可选，所属任务列表
    { tasklist_guid: "xxx" }
  ]
)
```

**返回**：任务对象，包含 `guid`（任务ID）和 `url`（任务链接）

### 2. 获取任务详情

```
feishu_task_get(task_id: "任务GUID")
```

### 3. 更新任务

```
feishu_task_update(
  task_id: "任务GUID",
  task: {
    summary: "新标题",               // 可选
    description: "新描述",           // 可选
    due: { timestamp: "...", is_all_day: false }  // 可选
  },
  update_fields: ["summary"]         // 指定更新的字段
)
```

**update_fields 可选值**：`summary`、`description`、`due`

### 4. 完成任务

```
feishu_task_complete(task_id: "任务GUID")
```

### 5. 重开任务

```
feishu_task_reopen(task_id: "任务GUID")
```

### 6. 搜索任务

```
feishu_task_search(
  query: "关键词",                   // 可选
  creator_ids: ["ou_xxx"],          // 可选，创建者ID列表
  assignee_ids: ["ou_xxx"],         // 可选，执行人ID列表
  follower_ids: ["ou_xxx"],         // 可选，关注者ID列表
  is_completed: false,              // 可选，是否已完成
  due_time: { start: "...", end: "..." }, // 可选，截止日期范围
  page_size: 20,                    // 可选，每页数量
  page_token: ""                    // 可选，分页 token
)
```

**注意**：搜索使用 v1 API，Bot 身份（tenant_access_token）可直接调用。

### 7. 我的任务

```
feishu_task_get_my_tasks(
  page_size: 20,                    // 可选
  page_token: "",                   // 可选
  completed: false                  // 可选
)
```

### 8. 关联任务

```
feishu_task_get_related_tasks(
  task_id: "任务GUID",              // 可选，指定任务
  page_size: 20,                    // 可选
  page_token: ""                    // 可选
)
```

---

## 成员与提醒操作

### 添加成员

```
feishu_task_add_members(
  task_id: "任务GUID",
  members: [
    { id: "ou_xxx", role: "assignee", type: "user" },
    { id: "ou_yyy", role: "follower", type: "user" }
  ]
)
```

**role 可选值**：`assignee`（执行人）、`follower`（关注者）

### 移除成员

```
feishu_task_remove_members(
  task_id: "任务GUID",
  members: [
    { id: "ou_xxx", role: "assignee", type: "user" }
  ]
)
```

### 添加提醒

```
feishu_task_add_reminders(
  task_id: "任务GUID",
  reminders: [
    { relative_fire_minute: 60 },     // 截止前60分钟
    { absolute_time: "1700000000000", timezone: "Asia/Shanghai" }
  ]
)
```

**提醒类型**：
- `relative_fire_minute`：相对截止时间的分钟数（如 15 = 15分钟，60 = 1小时，1440 = 1天）
- `absolute_time`：绝对时间（毫秒时间戳）

### 移除提醒

```
feishu_task_remove_reminders(
  task_id: "任务GUID",
  reminder_ids: ["reminder_id_1", "reminder_id_2"]
)
```

---

## 子任务与评论

### 设置父任务

```
feishu_task_set_ancestor(
  task_id: "子任务GUID",
  ancestor_task_id: "父任务GUID"     // 留空则取消父子关系
)
```

### 添加评论

```
feishu_task_comment(
  task_id: "任务GUID",
  content: "评论内容"
)
```

### 订阅事件

```
feishu_task_subscribe_event(
  task_id: "任务GUID",
  event_types: ["task:updated", "task:completed"]
)
```

**event_types 可选值**：`task:updated`、`task:completed`、`task:deleted`、`task:restored`、`task:comment_added`

---

## 任务列表操作

### 创建任务列表

```
feishu_tasklist_create(
  name: "列表名称",
  members: [                         // 可选
    { id: "ou_xxx", type: "user" }
  ]
)
```

### 查看任务列表

```
feishu_tasklist_get(tasklist_id: "列表GUID")
```

### 搜索任务列表

```
feishu_tasklist_search(
  query: "关键词",                   // 可选
  page_size: 20,                    // 可选
  page_token: ""                    // 可选
)
```

**注意**：任务列表搜索使用 v2 API，需要 user_access_token。如遇权限错误，可通过任务的 `tasklists` 字段获取关联的列表信息。

### 添加任务到列表

```
feishu_task_add_tasklist(
  task_id: "任务GUID",
  tasklist_guid: "列表GUID"
)
```

### 管理列表成员

```
// 添加成员
feishu_tasklist_add_members(
  tasklist_id: "列表GUID",
  members: [{ id: "ou_xxx", type: "user" }]
)

// 移除成员
feishu_tasklist_remove_members(
  tasklist_id: "列表GUID",
  member_ids: ["ou_xxx"]
)
```

---

## 常见使用场景

### 场景1：创建并分配任务

```
// 步骤1：创建任务
feishu_task_create(
  summary: "完成Q2报告",
  description: "整理Q2销售数据并生成报告",
  due: { timestamp: "1717200000000", is_all_day: true },
  members: [{ id: "ou_xxx", role: "assignee", type: "user" }]
)

// 步骤2：设置提醒
feishu_task_add_reminders(
  task_id: "返回的任务GUID",
  reminders: [{ relative_time: 86400 }]  // 截止前1天提醒
)
```

### 场景2：查看和完成任务

```
// 步骤1：搜索我的未完成任务
feishu_task_get_my_tasks(completed: false)

// 步骤2：查看任务详情
feishu_task_get(task_id: "任务GUID")

// 步骤3：完成任务
feishu_task_complete(task_id: "任务GUID")
```

### 场景3：创建子任务

```
// 步骤1：创建父任务
feishu_task_create(summary: "项目上线")

// 步骤2：创建子任务
feishu_task_create(summary: "准备部署文档")

// 步骤3：设置父子关系
feishu_task_set_ancestor(
  task_id: "子任务GUID",
  ancestor_task_id: "父任务GUID"
)
```

---

## 常见错误

| 错误 | 原因 | 解决方案 |
|------|------|----------|
| `1470400` | 参数无效 | 检查必填字段和格式 |
| `1470403` | 无权限 | 检查应用是否有 task:task:read/write 权限 |
| `1470404` | 任务不存在 | 确认任务 GUID 正确且未被删除 |
| `1470610` | 执行人超限 | 单个任务最多50个执行人 |
| `1470611` | 关注者超限 | 单个任务最多50个关注者 |
| `1470613` | 提醒已存在 | 先移除旧提醒再添加新提醒 |

---

## 权限要求

| 操作 | 所需权限 |
|------|---------|
| 读取任务 | `task:task:read` |
| 创建/更新/删除任务 | `task:task:write` |
| 读取任务列表 | `task:tasklist:read` |
| 管理任务列表 | `task:tasklist:write` |
| 添加评论 | `task:comment:write` |
