---
name: feishu-approval
description: |
  飞书审批操作工具。

  **当以下情况时使用此 Skill**：
  (1) 需要同意、拒绝、转交审批任务
  (2) 需要在审批实例下添加评论
  (3) 需要查询审批实例详情或列表
  (4) 用户提到"审批"、"approve"、"reject"、"转交"、"评论审批"

  **重要说明**：
  - 通过/拒绝/转交前必须先调用 feishu_approval_get_instance 获取 approval_code、task_id 和审批人 user_id
  - 评论操作使用 Bot 身份（自动注入），无需提供 user_id
  - 所有操作需要飞书凭证，已自动注入
  - 不要使用 Bash 命令，使用对应的 MCP 工具
---

# Feishu Approval (飞书审批) SKILL

## 操作方式

- 所有操作通过 MCP 工具完成
- 审批实例 Code 格式：UUID（如 `81D31358-93AF-92D6-7425-01A5D67C4E71`）
- 用户 ID 使用 open_id（如 `ou_xxx`）

---

## 快速索引：意图 → MCP 工具

| 用户意图 | MCP 工具 | 说明 |
|---------|---------|------|
| 查询审批实例详情 | `feishu_approval_get_instance` | 获取 task_list、approval_code 和审批人信息 |
| 同意审批 | `feishu_approval_approve` | 需先查询获取 approval_code/task_id/user_id |
| 拒绝审批 | `feishu_approval_reject` | 需先查询获取 approval_code/task_id/user_id |
| 转交审批 | `feishu_approval_transfer` | 需先查询并指定被转交人 |
| 创建评论 | `feishu_approval_comment` | 使用 Bot 身份（自动） |
| 查询审批列表 | `feishu_approval_query` | 按条件筛选审批实例 |

---

## 通过/拒绝/转交流程（两步调用）

### 步骤 1：查询审批实例

```
feishu_approval_get_instance(instance_code: "审批实例Code")
```

**返回关键信息**：
- `approval_code`: 审批定义 Code（用于 approve/reject/transfer）
- `instance_code`: 审批实例 Code
- `task_list`: 审批任务列表
  - `id`: task_id（审批任务 ID，用于 approve/reject/transfer）
  - `open_id`: 审批人的 open_id（即 user_id 参数）
  - `status`: 任务状态（PENDING/APPROVED/REJECTED/TRANSFERRED/DONE）
- `status`: 审批实例状态（PENDING/APPROVED/REJECTED/CANCELED/DELETED）

**审批人判断逻辑**：
- 从 task_list 中找 status 为 `PENDING` 的任务
- 通常第一个 PENDING 任务是当前待处理节点
- 如果有多个 PENDING 任务，需根据上下文判断（如用户指定了审批人）

### 步骤 2：执行审批操作

```
// 同意审批
feishu_approval_approve(
  approval_code: "从 get_instance 返回的 approval_code",
  instance_code: "审批实例Code",
  user_id: "从 task_list 中获取的 open_id",
  task_id: "从 task_list 中获取的 id",
  comment: "审批意见（可选）"
)

// 拒绝审批
feishu_approval_reject(
  approval_code: "...",
  instance_code: "...",
  user_id: "...",
  task_id: "...",
  comment: "拒绝理由（可选）"
)

// 转交审批
feishu_approval_transfer(
  approval_code: "...",
  instance_code: "...",
  user_id: "当前审批人的 open_id",
  task_id: "...",
  transfer_user_id: "被转交人的 open_id",
  comment: "转交说明（可选）"
)
```

---

## 评论操作

```
feishu_approval_comment(
  instance_id: "审批实例Code",
  content: '{"text": "评论内容"}',  // JSON 字符串格式
  parent_comment_id: "父评论ID（可选，用于回复）"
)
```

**content 格式说明**：
- 必须是 JSON 字符串：`{"text": "评论内容"}`
- 如需 @用户：在 text 中添加 `@username`

**身份说明**：评论使用 Bot 身份，Host 会自动获取 Bot open_id 并注入为 user_id。

**注意**：此工具使用的参数名是 `instance_id`（不是 `instance_code`），但传入的值仍是审批实例 Code。

---

## 查询审批列表

```
feishu_approval_query(
  approval_code: "审批定义Code（可选）",
  instance_status: "PENDING",  // PENDING/RECALL/REJECTED/DELETED/APPROVED/ALL
  user_id: "用户open_id（可选）",
  start_time: 1700000000000,   // 毫秒时间戳，与 end_time 需同时设置
  end_time: 1710000000000,     // 查询跨度不得大于 30 天
  page_size: 20
)
```

**返回**：`instance_list` 数组，每项包含 `approval.code`、`instance.code`、`instance.status`、`instance.start_time` 等字段。

---

## 使用场景示例

### 场景 1：同意审批

```
// 步骤 1：查询实例获取必要参数
feishu_approval_get_instance(instance_code: "81D31358-93AF-92D6-7425-01A5D67C4E71")

// 步骤 2：从返回中提取
// - approval_code = result.approval_code  (如 "7C468A54-8745-2245-9675-08B7C63E7A85")
// - task_id = result.task_list[0].id（找 status=PENDING 的任务）
// - user_id = result.task_list[0].open_id

// 步骤 3：同意审批
feishu_approval_approve(
  approval_code: "7C468A54-8745-2245-9675-08B7C63E7A85",
  instance_code: "81D31358-93AF-92D6-7425-01A5D67C4E71",
  user_id: "ou_123457",
  task_id: "1234",
  comment: "同意，请继续执行"
)
```

### 场景 2：转交审批

```
// 步骤 1-2：同上，获取必要参数

// 步骤 3：转交给其他人
feishu_approval_transfer(
  approval_code: "7C468A54-...",
  instance_code: "81D31358-...",
  user_id: "ou_123457",     // 当前审批人
  task_id: "1234",
  transfer_user_id: "ou_yyy",  // 被转交人
  comment: "转交给张三处理"
)
```

### 场景 3：添加评论

```
// 直接添加评论，无需先查询
feishu_approval_comment(
  instance_id: "81D31358-93AF-92D6-7425-01A5D67C4E71",
  content: '{"text": "我已了解该审批内容，稍后会处理"}'
)
```

---

## 常见错误

| 错误码 | 描述 | 解决方案 |
|--------|------|----------|
| `1390001` | 参数无效 | 检查必填字段和格式 |
| `1390002` | 审批定义 Code 不存在 | 确认 approval_code 正确 |
| `1390003` | 审批实例 Code 不存在 | 确认 instance_code 正确 |
| `1390004` | user_id 或 open_id 不存在 | 确认审批人 ID 正确 |
| `1390009` | 无操作权限 | 在飞书审批管理后台检查审批操作权限配置 |
| `1390010` | 审批任务 ID 不存在 | 先调用 get_instance 获取正确的 task_id |
| `1390018` | 不支持手写签名 | 需在飞书客户端内处理 |
| `1395001` | 服务错误 | 降低请求频率并重试 |

---

## 权限要求

| 操作 | 所需权限 |
|------|---------|
| 查询审批实例 | `approval:approval` 或 `approval:approval:readonly` |
| 同意/拒绝/转交 | `approval:task` |
| 创建评论 | `approval:instance.comment` |
