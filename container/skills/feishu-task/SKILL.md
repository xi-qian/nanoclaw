---
name: feishu-task
description: |
  NanoClaw 内的飞书任务入口。

  当用户要创建、查询、更新、完成、分配、搜索任务时使用本 Skill。
  所有实际调用必须通过 MCP 工具 `lark_cli_run` 发到宿主机执行 `lark-cli`，
  不要使用任何旧的 `feishu_task_*` MCP 工具。
---

# Feishu Task

## 规则

- 只使用 `lark_cli_run`
- `argv` 不包含 `lark-cli`
- 优先使用 `task` 命名空间下的 shortcut
- shortcut 默认输出 JSON，不要手动补 `--format json`
- 不要依赖已经删除的 `feishu_task_*` 工具

## 调用模板

```json
{
  "argv": ["task", "+create", "--summary", "完成部署", "--description", "上线并验证"],
  "expect_json": true,
  "timeout_ms": 30000
}
```

## 常用命令

### 创建任务

```json
{
  "argv": ["task", "+create", "--summary", "任务标题"]
}
```

如果有描述、截止时间、执行人、关注人、清单等信息，继续把对应参数加到 `argv`。

### 查询任务详情

```json
{
  "argv": ["task", "get", "--task-id", "任务 ID"]
}
```

### 更新任务

```json
{
  "argv": ["task", "+update", "--task-id", "任务 ID", "--summary", "新标题"]
}
```

### 完成或重开任务

```json
{
  "argv": ["task", "complete", "--task-id", "任务 ID"]
}
```

```json
{
  "argv": ["task", "reopen", "--task-id", "任务 ID"]
}
```

### 搜索任务

```json
{
  "argv": ["task", "search", "--query", "关键词"]
}
```

### 查询我的任务

```json
{
  "argv": ["task", "+get-my-tasks"]
}
```

## 工作方式

1. 先确认是创建、查询、更新、完成还是搜索
2. 组装 `task ...` 的 `argv`
3. 调用 `lark_cli_run`
4. 从返回 JSON 中提炼任务 ID、标题、状态、截止时间等信息

## 禁止事项

- 不要调用 `feishu_task_create`、`feishu_task_update`、`feishu_task_search` 等旧工具
- 不要在容器里直接执行宿主机命令
- 不要假设容器里有飞书凭证
