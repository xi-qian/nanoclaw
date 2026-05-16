---
name: feishu-doc
description: |
  NanoClaw 内的飞书文档/云空间/多维表格入口。

  当用户要创建、读取、更新、删除飞书文档，搜索和管理云空间文件，创建或维护
  Base，多维表格记录增删改查，或管理文档/多维表格协作者权限与所有者转移时
  使用本 Skill。文档类能力统一通过 MCP 工具 `lark_cli_run` 发到宿主机执行
  `lark-cli`。

  如果需求是“下载用户发来的附件 / 给用户发送文件”，不要用本 Skill，改用
  `feishu-file`。如果需求是“查询用户部门”，改用 `feishu-contact`。
---

# Feishu Doc

## 规则

- 文档、Drive、Base、权限管理统一只使用 `lark_cli_run`
- `argv` 里不要包含二进制名 `lark-cli`
- 优先使用 shortcut；shortcut 默认输出 JSON，不要手动补 `--format json`
- 文档创建、读取、更新、删除优先走 `docs`
- 云空间文件搜索、上传、下载、删除、权限管理优先走 `drive`
- Base 创建、表/字段/记录管理优先走 `base`
- 如果只是附件下载、发送文件、查询用户部门，立刻切换到其他 skill，不要在这里处理

## 调用模板

```json
{
  "argv": ["docs", "+create", "--api-version", "v2", "--title", "周报", "--content", "# 周报"],
  "expect_json": true,
  "timeout_ms": 30000
}
```

## 常见场景

### 创建文档

```json
{
  "argv": ["docs", "+create", "--api-version", "v2", "--title", "文档标题", "--content", "Markdown 或 DocxXML 内容"]
}
```

### 读取文档

```json
{
  "argv": ["docs", "+fetch", "--api-version", "v2", "--doc", "文档 token 或 URL"]
}
```

### 更新文档

```json
{
  "argv": ["docs", "+update", "--api-version", "v2", "--doc", "文档 token 或 URL", "--instruction", "overwrite", "--content", "新内容"]
}
```

局部编辑时，直接改成对应的 `--instruction`，例如 `str_replace`、`block_insert_after`、`block_replace`、`block_delete`。

### 搜索文档或云空间资源

```json
{
  "argv": ["docs", "+search", "--query", "关键词"]
}
```

或者：

```json
{
  "argv": ["drive", "+search", "--query", "关键词"]
}
```

### 删除文档或文件

文档/文件/文件夹删除优先走 Drive：

```json
{
  "argv": ["drive", "+delete", "--token", "资源 token", "--type", "docx"]
}
```

资源类型按实际对象填写，例如 `docx`、`bitable`、`file`、`folder`。

### 上传/下载/移动云空间文件

```json
{
  "argv": ["drive", "<子命令或 shortcut>", "..."]
}
```

典型场景：
- `drive +upload`
- `drive +download`
- `drive +move`
- `drive +create-folder`

### 创建和操作 Base

```json
{
  "argv": ["base", "<子命令或 shortcut>", "..."]
}
```

典型场景：
- `base +base-create`
- `base table-list`
- `base field-list`
- `base record-list`
- `base record-create`
- `base record-update`
- `base +record-delete`
- `base +table-delete`

### 管理协作者权限

增加协作者：

```json
{
  "argv": [
    "drive",
    "permission.members",
    "create",
    "--params",
    "{\"token\":\"资源 token\",\"type\":\"docx\"}",
    "--data",
    "{\"member_type\":\"openid\",\"member_id\":\"ou_xxx\",\"perm\":\"edit\",\"type\":\"user\"}"
  ]
}
```

适用对象：`docx`、`bitable`、`sheet`、`file`、`folder`、`wiki`、`slides`。

### 转让所有者

```json
{
  "argv": [
    "drive",
    "permission.members",
    "transfer_owner",
    "--params",
    "{\"token\":\"资源 token\",\"type\":\"bitable\"}",
    "--data",
    "{\"member_type\":\"openid\",\"member_id\":\"ou_xxx\"}"
  ]
}
```

涉及 owner 转移时必须明确确认用户意图，不要擅自执行。

## 工作方式

1. 先把用户意图映射成 `docs` / `drive` / `base`
2. 优先使用 shortcut；没有 shortcut 再用原生命令
3. 调用 `lark_cli_run`
4. 从返回 JSON 中提炼链接、token、状态、权限结果，再回复用户

## 禁止事项

- 不要调用旧的 `feishu_create_doc`、`feishu_fetch_doc`、`feishu_update_doc`、`feishu_delete_doc`
- 不要调用旧的 Base/权限类 `feishu_*` MCP 工具
- 不要假设容器里安装了 `lark-cli`
- 不要在这个 skill 里处理附件下载、发送文件、查询用户部门
