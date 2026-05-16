---
name: feishu-doc
description: |
  NanoClaw 内的飞书文档/云空间/多维表格操作入口。

  当用户要创建、读取、更新飞书文档，搜索云空间文件，或创建/操作 Base
  时使用本 Skill。所有实际调用必须通过 MCP 工具 `lark_cli_run` 发到宿主机
  执行 `lark-cli`，不要使用任何 `feishu_*` 文档类 MCP 工具。
---

# Feishu Doc

## 规则

- 只使用 `lark_cli_run`
- `argv` 里不要包含二进制名 `lark-cli`
- 文档类 shortcut 默认直接返回 JSON，不要手动补 `--format json`
- 文档创建/读取/更新统一优先走 `docs`
- 云空间文件搜索、上传、下载走 `drive`
- 多维表格/Base 走 `base`
- 如果只是让你“查看参数结构”或确认子命令，先根据下面示例构造命令；当前不要依赖 `schema`

## 调用模板

```json
{
  "argv": ["docs", "+create", "--api-version", "v2", "--title", "周报", "--content", "# 周报"],
  "expect_json": true,
  "timeout_ms": 30000
}
```

## 常用命令

### 创建文档

```json
{
  "argv": ["docs", "+create", "--api-version", "v2", "--title", "文档标题", "--content", "Markdown 或 DocxXML 内容"]
}
```

如果用户指定父目录、知识库节点或其他高级参数，把对应参数继续追加到 `argv`。

### 读取文档

```json
{
  "argv": ["docs", "+fetch", "--api-version", "v2", "--doc", "文档 token 或 URL"]
}
```

需要局部读取时，继续加 CLI 支持的范围参数；不要自己拼 API。

### 更新文档

```json
{
  "argv": ["docs", "+update", "--api-version", "v2", "--doc", "文档 token 或 URL", "--instruction", "overwrite", "--content", "新内容"]
}
```

如果是替换、插入、追加、按 block 操作，直接改成对应的 `--instruction` 和参数。

### 搜索云空间文档

```json
{
  "argv": ["docs", "+search", "--query", "关键词"]
}
```

### 上传/下载/管理云空间文件

```json
{
  "argv": ["drive", "<子命令>", "..."]
}
```

典型场景：
- 上传文件到云空间
- 下载云空间文件
- 创建文件夹
- 移动/复制/删除文件

### 创建和操作 Base

```json
{
  "argv": ["base", "<子命令>", "..."]
}
```

典型场景：
- `base +base-create`
- `base table-list`
- `base field-list`
- `base record-list`
- `base record-create`
- `base record-update`

## 工作方式

1. 先把用户意图映射成 `docs` / `drive` / `base`
2. 优先使用 shortcut（`+create`、`+fetch`、`+update` 等）
3. 调用 `lark_cli_run`
4. 从返回 JSON 中提炼结果，再回复用户

## 禁止事项

- 不要调用已删除的 `feishu_create_doc`、`feishu_fetch_doc`、`feishu_update_doc` 等旧工具
- 不要假设容器里安装了 `lark-cli`
- 不要让用户在容器里处理飞书凭证
