# Feishu 文档删除功能更新

## 更新日期
2026-04-10

## 更新内容

### 1. 新增删除文档和删除多维表格功能

添加了 `feishu_delete_doc` 和 `feishu_delete_bitable` MCP 工具，允许 agent 删除飞书文档和多维表格。

**注意**: 删除操作会将文档/多维表格移到回收站，可以从回收站恢复。

### 2. 修复文档创建顺序问题

将飞书文档创建 API 从 `/blocks/convert` 切换到 MCP API (`create-doc`)，解决了文档内容块顺序混乱的问题。

MCP API 会正确处理 Markdown 转换，确保文档块按照 Markdown 内容的原始顺序排列。

### 3. 修复文档获取问题

将文档获取 API 切换到 MCP API (`fetch-doc`)，修复了 URL 解析问题：
- 支持 `/docx/` 和 `/docs/` 两种 URL 格式
- 自动提取文档 ID

## 修改文件清单

| 文件 | 修改说明 |
|------|---------|
| `src/feishu/client.ts` | 添加 MCP API 调用方法 (`callMCPTool`)，重写 `createDoc`/`fetchDoc`/`updateDoc`，添加 `deleteDoc`/`deleteBitable` 方法 |
| `src/channels/feishu.ts` | 添加 `deleteDoc` 和 `deleteBitable` 方法暴露给 IPC |
| `src/ipc.ts` | 添加 `delete_doc` 和 `delete_bitable` IPC 处理器 |
| `container/agent-runner/src/ipc-mcp-stdio.ts` | 添加 `feishu_delete_doc` 和 `feishu_delete_bitable` MCP 工具定义 |
| `container/skills/feishu-doc/SKILL.md` | 更新文档，添加删除操作说明 |

## 新增 MCP 工具

### feishu_delete_doc
删除飞书云文档。

参数:
- `doc_id`: 文档 ID 或完整 URL（支持自动解析）

### feishu_delete_bitable
删除整个多维表格。

参数:
- `app_token`: 多维表格应用 token

## 使用示例

```
# 删除文档
feishu_delete_doc(doc_id="OxkvdjrtZoOnrRxP4q9cnvlwnid")
# 或使用完整 URL
feishu_delete_doc(doc_id="https://feishu.cn/docx/OxkvdjrtZoOnrRxP4q9cnvlwnid")

# 删除多维表格
feishu_delete_bitable(app_token="DqYJb8ZqAanC08sP7otcLrHJnyf")
```

## 技术细节

### MCP API 端点
- Feishu: `https://mcp.feishu.cn/mcp`
- Lark: `https://mcp.larksuite.com/mcp`

### MCP 工具对应关系
| MCP 工具 | IPC type |
|---------|----------|
| `create-doc` | `create_doc` |
| `fetch-doc` | `fetch_doc` |
| `update-doc` | `update_doc` |
| - | `delete_doc` (使用 Drive API) |
| - | `delete_bitable` (使用 Drive API) |

删除操作使用飞书 Drive API (`DELETE /open-apis/drive/v1/files/{token}`) 而非 MCP API，因为 MCP 不提供删除工具。