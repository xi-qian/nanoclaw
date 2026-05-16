---
name: feishu-file
description: |
  飞书消息附件下载与文件发送入口。

  当用户发送了图片、文件、音频、视频，需要下载分析，或者需要把本地生成的
  文件发送给用户时使用本 Skill。此 Skill 使用专用 MCP 工具
  `feishu_download_resource` 和 `feishu_send_file`，不走 `lark_cli_run`。
---

# Feishu File

## 规则

- 下载附件只使用 `feishu_download_resource`
- 给用户发送文件只使用 `feishu_send_file`
- 不要用 `lark_cli_run` 处理消息附件下载或回传文件
- 发送文件前，文件必须放在 `/workspace/ipc/downloads/`

## 下载用户发送的附件

当消息里带有：

- `download_message_id`
- `download_file_key`
- `type=image|file|audio|video|media`

就调用：

```json
{
  "message_id": "om_xxx",
  "file_key": "file_v3_xxx",
  "type": "file"
}
```

对应工具：`feishu_download_resource`

工具返回的是临时文件路径。拿到路径后，再读取或分析该文件。

## 发送文件给用户

先把文件写到：

```text
/workspace/ipc/downloads/文件名
```

再调用：

```json
{
  "file_path": "/workspace/ipc/downloads/report.pdf",
  "file_type": "file"
}
```

对应工具：`feishu_send_file`

文件类型：

- `file`
- `image`
- `audio`
- `video`
- `media`

## 常见场景

- 用户发来 PDF，需要下载后读取内容
- 用户发来图片，需要下载后识别
- 生成了周报 PDF，需要发回给用户
- 生成了截图或图片，需要发回给用户

## 禁止事项

- 不要把 `/tmp` 或其他路径的文件直接交给 `feishu_send_file`
- 不要在 `feishu-doc` 里处理附件下载和发送文件
