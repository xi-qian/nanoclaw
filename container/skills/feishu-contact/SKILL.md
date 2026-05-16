---
name: feishu-contact
description: |
  飞书用户部门查询入口。

  当需要根据消息里的 `sender_id` 或已知 `open_id` 查询用户所属部门时使用本
  Skill。此 Skill 使用专用 MCP 工具 `feishu_get_user_department`，不走
  `lark_cli_run`。
---

# Feishu Contact

## 规则

- 只使用 `feishu_get_user_department`
- 输入使用用户 `open_id`
- 如果需求是文档、Base、云空间、附件下载或发送文件，不要用本 Skill

## 调用方式

```json
{
  "open_id": "ou_xxx"
}
```

如果消息中带有：

```xml
<message sender="用户名" sender_id="ou_xxx" ...>
```

则直接取 `sender_id` 作为 `open_id`。

## 返回结果

工具返回用户所属部门名称列表。用户可能属于多个部门。

## 常见场景

- 想知道发消息的人属于哪个部门
- 按部门做路由、权限判断或通知分组

## 禁止事项

- 不要在 `feishu-doc` 里查询用户部门
- 不要猜测 open_id，必须使用消息里的 `sender_id` 或已知 open_id
