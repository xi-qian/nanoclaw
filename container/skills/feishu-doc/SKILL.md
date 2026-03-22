---
name: feishu-doc
description: |
  飞书（Feishu/Lark）文档、多维表格和知识库操作工具。

  **当以下情况时使用此 Skill**：
  (1) 需要创建、编辑、查看飞书文档
  (2) 需要创建、管理飞书多维表格（Bitable/表格）
  (3) 需要在知识库中创建文档节点
  (4) 用户提到"飞书文档"、"表格"、"知识库"、"wiki"、"bitable"
  (5) 需要批量导入数据到飞书表格
  (6) 用户发送了文件/图片/语音/视频，需要分析内容

  **重要说明**：
  - 此 Skill 使用 MCP 工具与飞书 API 交互
  - 所有操作需要飞书凭证（appId 和 appSecret），已自动注入
  - 不要使用 Bash 命令，使用对应的 MCP 工具
---

# Feishu Doc (飞书文档/表格/知识库) SKILL

## 🚨 执行前必读

### 链接格式（重要）
- ⚠️ **飞书文档链接必须使用 `/docx/` 而不是 `/docs/`**
- 正确格式：`https://feishu.cn/docx/xxxxxxxxxx`
- 错误格式：`https://feishu.cn/docs/xxxxxxxxxx`（会导致链接无法访问）
- 多维表格链接使用 `/base/`：`https://feishu.cn/base/xxxxxxxxxx`

### 操作方式
- **文档操作**：使用 `feishu_create_doc`、`feishu_fetch_doc`、`feishu_update_doc`、`feishu_search_docs` 工具
- **多维表格操作**：使用 `feishu_create_bitable`、`feishu_create_bitable_table`、`feishu_list_bitable_fields`、`feishu_list_bitable_records`、`feishu_add_bitable_records`、`feishu_update_bitable_record`、`feishu_delete_bitable_record` 工具
- **文件下载**：用户发送的图片/文件/语音/视频，使用 `feishu_download_resource` 工具下载后分析
- **不要使用 Bash 命令**，使用对应的 MCP 工具

### 数据格式约束
- ✅ **日期字段**：毫秒时间戳（例如 `1674206443000`）
- ✅ **人员字段**：`[{id: "ou_xxx"}]` 格式
- ✅ **单选字段**：字符串（例如 `"选项1"`）
- ✅ **多选字段**：字符串数组（例如 `["选项1", "选项2"]`）
- ✅ **批量操作上限**：每次最多 500 条记录

---

## 📋 快速索引：意图 → MCP 工具

| 用户意图 | MCP 工具 | 说明 |
|---------|---------|------|
| 创建文档 | `feishu_create_doc` | 从 Markdown 创建飞书文档 |
| 获取文档 | `feishu_fetch_doc` | 获取文档内容 |
| 更新文档 | `feishu_update_doc` | 更新文档内容 |
| 搜索文档 | `feishu_search_docs` | 搜索飞书文档 |
| 创建多维表格 | `feishu_create_bitable` | 创建多维表格应用 |
| 创建数据表 | `feishu_create_bitable_table` | 在多维表格中创建数据表 |
| 列出数据表 | `feishu_list_bitable_tables` | 列出多维表格中的所有数据表 |
| 查看字段 | `feishu_list_bitable_fields` | 获取数据表字段列表 |
| 查询记录 | `feishu_list_bitable_records` | 查询表格记录 |
| 添加记录 | `feishu_add_bitable_records` | 批量添加记录 |
| 更新记录 | `feishu_update_bitable_record` | 更新指定记录 |
| 删除记录 | `feishu_delete_bitable_record` | 删除指定记录 |
| **下载附件** | `feishu_download_resource` | 下载用户发送的图片/文件/语音/视频 |

---

## 📁 文件附件处理

### 消息格式识别

当用户发送文件时，消息会带有附件属性：
```xml
<message sender="用户名" timestamp="..." type="file" filename="文档.pdf" download_message_id="om_xxx" download_file_key="file_v3_xxx">[文件] 文档.pdf</message>
```

属性说明：
- `type`: 消息类型（`image`、`file`、`audio`、`video`）
- `filename`: 文件名（仅文件类型）
- `download_message_id`: 用于调用下载工具的 message_id 参数
- `download_file_key`: 用于调用下载工具的 file_key 参数

### 下载并分析文件

使用 `feishu_download_resource` 工具：
```
feishu_download_resource(
  message_id="download_message_id的值",
  file_key="download_file_key的值"
)
```

**示例工作流**：
```
1. 用户发送文件 → 消息显示: [文件] 报告.pdf
   消息属性: download_message_id="om_xxx" download_file_key="file_v3_xxx"

2. Agent 调用: feishu_download_resource(message_id="om_xxx", file_key="file_v3_xxx")

3. 工具返回: 资源下载成功! 临时文件路径: /tmp/xxx/报告.pdf

4. Agent 使用 Read 工具读取: /tmp/xxx/报告.pdf

5. Agent 分析内容并回复用户
```

### 支持的文件类型

| 类型 | 说明 | 处理建议 |
|------|------|----------|
| `image` | 图片 | 下载后可直接查看或使用视觉模型分析 |
| `file` | 文档/文件 | 下载后读取内容（PDF、Word、Excel 等） |
| `audio` | 语音消息 | 下载后需要转录为文字 |
| `video` | 视频 | 下载后分析内容 |

---

## 🎯 核心操作

### 1. 创建飞书文档

使用 `feishu_create_doc` 工具：
- `title`: 文档标题
- `markdown`: Markdown 格式的内容

### 2. 获取文档内容

使用 `feishu_fetch_doc` 工具：
- `doc_id`: 文档 ID 或完整 URL

### 3. 更新文档

使用 `feishu_update_doc` 工具：
- `doc_id`: 文档 ID
- `markdown`: 要追加的 Markdown 内容

### 4. 搜索文档

使用 `feishu_search_docs` 工具：
- `query`: 搜索关键词
- `limit`: 返回结果数量（可选）

---

## 📊 多维表格操作

### 1. 创建多维表格应用

使用 `feishu_create_bitable` 工具：
- `name`: 多维表格名称

**返回**：`app_token`（后续操作需要）和 `app_url`

### 2. 创建数据表

使用 `feishu_create_bitable_table` 工具：
- `app_token`: 上一步返回的 app_token
- `name`: 数据表名称
- `fields`: 字段定义数组

**字段类型对照表**：
| type | 类型 | 说明 |
|------|------|------|
| 1 | 文本 | 普通文本 |
| 2 | 数字 | 数值 |
| 3 | 单选 | 需配置 `property.options` |
| 4 | 多选 | 需配置 `property.options` |
| 5 | 日期 | 毫秒时间戳 |
| 7 | 复选框 | 布尔值 |
| 11 | 人员 | `[{id: "ou_xxx"}]` |
| 15 | 超链接 | `{link: "url", text: "文本"}` |

**示例字段定义**：
```json
[
  {"field_name": "客户名称", "type": 1},
  {"field_name": "负责人", "type": 11},
  {"field_name": "状态", "type": 3, "property": {"options": [{"name": "进行中"}, {"name": "已完成"}]}},
  {"field_name": "签约日期", "type": 5}
]
```

### 3. 列出数据表

使用 `feishu_list_bitable_tables` 工具：
- `app_token`: 多维表格 app_token

**返回**：数据表列表，包含表名和 table_id

### 4. 批量添加记录

使用 `feishu_add_bitable_records` 工具：
- `app_token`: 多维表格 app_token
- `table_id`: 数据表 table_id
- `records`: 记录数组

**示例**：
```json
{
  "app_token": "appxxxxxxxxxxxx",
  "table_id": "tblxxxxxxxxxxxx",
  "records": [
    {"fields": {"客户名称": "字节跳动", "状态": "进行中"}},
    {"fields": {"客户名称": "腾讯", "状态": "已完成"}}
  ]
}
```

### 5. 查询数据表字段

使用 `feishu_list_bitable_fields` 工具：
- `app_token`: 多维表格 app_token
- `table_id`: 数据表 table_id

**返回**：字段列表，包含字段名、类型和字段 ID

### 6. 查询数据表记录

使用 `feishu_list_bitable_records` 工具：
- `app_token`: 多维表格 app_token
- `table_id`: 数据表 table_id
- `view_id`: 视图 ID（可选）
- `filter`: 过滤条件（可选）
- `sort`: 排序条件（可选）
- `page_size`: 每页记录数（可选）
- `page_token`: 分页 token（可选）

**过滤条件示例**：
```
CurrentValue.[客户名称]="字节跳动"
```

**排序条件示例**：
```json
[{"field_name": "签约日期", "desc": true}]
```

### 7. 更新记录

使用 `feishu_update_bitable_record` 工具：
- `app_token`: 多维表格 app_token
- `table_id`: 数据表 table_id
- `record_id`: 要更新的记录 ID
- `fields`: 要更新的字段值

**示例**：
```json
{
  "app_token": "appxxxxxxxxxxxx",
  "table_id": "tblxxxxxxxxxxxx",
  "record_id": "recxxxxxxxxxxxx",
  "fields": {"状态": "已完成"}
}
```

### 8. 删除记录

使用 `feishu_delete_bitable_record` 工具：
- `app_token`: 多维表格 app_token
- `table_id`: 数据表 table_id
- `record_id`: 要删除的记录 ID

---

## 📖 完整示例：创建客户管理表

**步骤 1**：创建多维表格应用
```
使用 feishu_create_bitable 工具，参数 name="客户管理表"
```
记录返回的 `app_token`

**步骤 2**：创建数据表
```
使用 feishu_create_bitable_table 工具，参数：
- app_token: "上一步的 app_token"
- name: "客户列表"
- fields: [
    {"field_name": "客户名称", "type": 1},
    {"field_name": "负责人", "type": 11},
    {"field_name": "状态", "type": 3, "property": {"options": [{"name": "进行中"}, {"name": "已完成"}]}},
    {"field_name": "签约日期", "type": 5}
  ]
```
记录返回的 `table_id`

**步骤 3**：添加数据
```
使用 feishu_add_bitable_records 工具，参数：
- app_token: "app_token"
- table_id: "table_id"
- records: [
    {"fields": {"客户名称": "字节跳动", "状态": "进行中", "签约日期": 1674206443000}},
    {"fields": {"客户名称": "腾讯", "状态": "已完成", "签约日期": 1675416243000}}
  ]
```

---

## 🔧 常见错误与排查

| 错误码 | 原因 | 解决方案 |
|-------|------|----------|
| `99991663` | 无权限 | 检查飞书应用权限配置 |
| `1254064` | 日期格式错误 | 使用毫秒时间戳 |
| `1254066` | 人员字段格式错误 | 使用 `[{id: "ou_xxx"}]` 格式 |
| `1254104` | 批量操作超限 | 每批不超过 500 条 |