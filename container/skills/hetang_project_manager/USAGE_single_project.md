# 使用说明：`single_project` 预设（**单独项目管理**）

`templates/feishu/hetang/bitable/single_project/` 为 **「任务」「成员」** 两表；创建时从黄金模板完整复制（`cockpit_source_app_token`），视图/表单以黄金 Base 为准。

> **Agent 常见错误**：用户只说「帮我创建项目管理文档」却**没说标题**时，**必须先使用 MCP 工具读取指定的项目总表（`KtdlbOwJeav22zsJakzcMvEPnHb`）中的“项目名称”列**，然后**将列表发给用户让其选择**。**禁止**在未取得用户选择的名称时运行 `feishu-create-single-project`，也**禁止**擅自使用「项目管理文档」等默认名。

---

## 凭证与环境变量

- **`config/feishu.local.json`**（或 **`feishu.local.json`**）填写 `app_id`、`app_secret`；或环境变量 **`FEISHU_APP_ID`** / **`FEISHU_APP_SECRET`**。  
- CLI 支持 **`--config /path/to/feishu.local.json`**。  
- 应用需具备多维表格、云文档协作者等相关 OpenAPI 权限。

---

## 文档名称（必传）

- **必须使用 MCP 工具读取项目总表**：`https://shaehv5cfo.feishu.cn/base/KtdlbOwJeav22zsJakzcMvEPnHb?table=tblW0xITjmuIuTZb`
- **读取列**：“项目名称”列。
- **让用户选择**：将读取到的项目名称列表展示给用户，让用户选择其中一个作为新文档的名称。
- **参数传递**：在用户选择后，将该名称作为 `--bitable-name` 参数传入。
- **禁止行为**：绝对禁止在用户未选择前使用默认名称（如“项目管理文档”）或自行编造名称。
- **回写链接（极其重要）**：创建成功后，**必须**使用 MCP 工具将新文档的链接回写到**项目总表**（app_token 必须是 `KtdlbOwJeav22zsJakzcMvEPnHb`）中对应项目的“项目管理文档链接”列。**警告：绝对禁止将链接写到刚刚新创建的文档中！回写的目标文档必须是项目总表！**

---

## 总表查重与记忆更新

- **创建前查重**：在用户选择了“项目名称”后，**必须**使用 MCP 工具读取项目总表（`KtdlbOwJeav22zsJakzcMvEPnHb`）中该项目对应的“项目管理文档链接”列。
  - **若该列已有链接**：**必须先询问用户**：“该项目已存在项目管理文档（链接），是否需要删除已有的文档重新创建？”
  - **用户同意重新创建**：执行创建命令。创建成功后，将新链接**覆盖写入**总表，并**追加**新记录到本地记忆文件（`memory/feishu_bitable_links.md`）。
  - **用户不同意**：停止创建。

- **记忆文件路径**：**`memory/feishu_bitable_links.md`**。  
- **可存多条**：不同文档名称各一条（或多条历史，按团队约定）；每条记录一次成功创建的 Base。  

### 记忆行格式（建议）

便于 Agent 解析与人工阅读：

```text
- YYYY-MM-DD | single_project | 名称: <与 --bitable-name 一致> | 链接: https://shaehv5cfo.feishu.cn/base/<app_token> | app_token: <app_token>
```

---

## 创建命令

```bash
export FEISHU_APP_ID=... FEISHU_APP_SECRET=...
feishu-create-single-project \
  --bitable-name "某某医院-某某项目全称" \
  --grant-manage-user-id "<userid>" \
  --transfer-owner-user-id "<userid>" \
  --pretty > provision.json
```

等价：`python -m feishu.bitable --from-template --preset single_project --bitable-name "..." ...`

- `--grant-manage-user-id`：授予管理权限（`full_access`）  
- `--transfer-owner-user-id`：将文档归属转移给对话用户（原应用机器人保留 `full_access`）  
- 两者通常传同一用户 ID  

或通过环境变量（**仍须显式传 `--bitable-name`**）：

```bash
export FEISHU_GRANT_MANAGE_USER_ID="<userid>"
export FEISHU_TRANSFER_OWNER_USER_ID="<userid>"
feishu-create-single-project \
  --bitable-name "文档显示名称" \
  --pretty > provision.json
```

成功时 JSON 中含 `"provision_mode": "cockpit_copy"`、`"drive_grant_manage_user"`、`"drive_transfer_owner"`。

**创建完成后必须：** 从结果取 `app.app_token`，拼接链接发给用户，并按上文格式**追加**写入 `memory/feishu_bitable_links.md`。

```bash
export FEISHU_BITABLE_APP_TOKEN="$(jq -r '.app.app_token' provision.json)"
```

---

## 黄金模板配置

当前黄金模板 `app_token` 写死在 **`single_project.bitable.json`** 的 **`cockpit_source_app_token`**。

更换模板：在飞书中准备好新 Base（表名须与模板中 `tables[].name` 一致，通常为「任务」「成员」），更新该字段后重试。

---

## 可选：群场景 Handover（补充）

若创建流程未带群协作，可事后用 **`feishu-bitable-handover`**：群可编辑 + 转所有者，或个人 `full_access` + 转所有者。详见：

```bash
feishu-bitable-handover --help
```

---

## 补视图 / 表单（`table_ids`）

表键：**`tasks`**、**`members`**

```bash
feishu-apply-bitable-views \
  --template templates/feishu/hetang/bitable/single_project/single_project.views.json \
  --table-ids-json '{"tasks":"tbl...","members":"tbl..."}' \
  --pretty

feishu-apply-bitable-forms \
  --template templates/feishu/hetang/bitable/single_project/single_project.forms.json \
  --table-ids-json '{"tasks":"tbl...","members":"tbl..."}' \
  --pretty
```

未传 **`--template`** 时，CLI 默认使用 **`single_project/single_project.views.json`** / **`.forms.json`**。

---

## 何时读取总记忆

针对**已存在**的荷塘单独项目 Base 做补视图、改权限、API 操作等，而上下文中无可靠链接或 `app_token` 时，先读 **`memory/feishu_bitable_links.md`**，按 **名称** 或 **app_token** 匹配条目；无法唯一匹配时再请用户提供。

**注意：创建新文档时的查重不再依赖此文件，而是直接读取项目总表（`KtdlbOwJeav22zsJakzcMvEPnHb`）中的“项目管理文档链接”列。**

---

## Python 加载模板

```python
from feishu.bitable import hetang_bitable_template_path, load_template

template = load_template(hetang_bitable_template_path("single_project"))
```

---

返回主索引：[SKILL.md](SKILL.md)
