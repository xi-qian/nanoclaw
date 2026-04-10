# 使用说明：创建「项目总管理」多维表格（project_portfolio）

对应模板目录：`templates/feishu/hetang/bitable/project_portfolio/`（荷塘临床 PM 全套：项目、任务、周报、成员）。

**依赖**：Python 3.9+；仅用标准库 `urllib` 访问飞书 OpenAPI，无需 `pip install requests`。可选 `pip install -e .` 安装 CLI 入口。

---

## 应用凭证与环境变量

勿把 `app_id` / `app_secret` 提交仓库。复制仓库根 [`config/feishu.local.json.example`](../../../config/feishu.local.json.example) 为 **`config/feishu.local.json`** 或 **`feishu.local.json`**。

解析顺序：**`--config` 入参** > **`FEISHU_APP_ID` / `FEISHU_APP_SECRET`** > **`FEISHU_CONFIG_PATH`** > 自动查找 `./feishu.local.json`、`./config/feishu.local.json`。实现见 `src/feishu/credentials.py`。

常用环境变量：

- `FEISHU_APP_ID` / `FEISHU_APP_SECRET`  
- `FEISHU_FOLDER_TOKEN`（可选）  
- `FEISHU_BITABLE_APP_TOKEN`（创建后从输出 JSON 取 `app.app_token`）  
- `FEISHU_NEW_OWNER_MEMBER_ID` / `FEISHU_NEW_OWNER_MEMBER_TYPE`（handover）  
- `FEISHU_GRANT_EDIT_OPEN_CHAT_ID`（群场景）

---

## 创建前信息清单

| 项 | 默认 / 约定 |
|----|-------------|
| **表格名称** | `--bitable-name` 或模板默认 **「项目总管理」** |
| **场景** | **默认群协同**；用户明确「个人 / 不要群」才用 **`feishu-bitable-handover --personal`** |
| **新所有者** | 须为具体用户（常为群主 `userid`/`openid`）；不能写成「群」 |
| **群 ID** | 群场景需 `open_chat_id`（`oc_...`）；本机 CLI 不会自动知道当前群，须用户粘贴或 Bot 事件 |

### 为什么不能默认拿到当前群？

本机无「当前会话」；handover **不会**自动解析群主。须显式传入 `open_chat_id` 与 `new_owner_member_id`。Bot 可从 `im.message.receive_v1` 取群 ID；个人场景用发送者 `openid`/`userid`。

---

## 推荐流程：建表（含视图/表单）+ handover

### 模板文件（相对仓库根）

- 结构：[`templates/feishu/hetang/bitable/project_portfolio/clinical_project_pm.bitable.json`](../../../templates/feishu/hetang/bitable/project_portfolio/clinical_project_pm.bitable.json)  
- 视图：[`.../clinical_project_pm.views.json`](../../../templates/feishu/hetang/bitable/project_portfolio/clinical_project_pm.views.json)  
- 表单：[`.../clinical_project_pm.forms.json`](../../../templates/feishu/hetang/bitable/project_portfolio/clinical_project_pm.forms.json)  

根级 **`after_provision`** 会在一次 `--from-template` 后自动套用视图与表单。

**「项目」** 表（**项目总管理 / portfolio**）：**保留**默认网格视图 **「所有项目」**。**「项目状态看板」** 按 **「状态」**（推进中 / 未启动 / 已完成）分组，卡片为各项目行（脚本会尝试 PATCH `records_group`；失败时因模板里 **「状态」** 在 **「项目阶段」** 之前，默认可按状态分列）。仍含 **「项目阶段」** 列供与任务表里程碑对齐。**不会**执行 `delete_default_view_after_provision`。

默认会在 **「项目」** 表创建表单视图 **「项目登记」**：提交后在项目表新增一行；**任务 / 周报 / 成员** 表中 **「所属项目」**（双向关联）的下拉选项会随新记录自动出现，无需改字段配置。已有 Base 若缺该表单，用下文 **`feishu-apply-bitable-forms`** 按更新后的模板补建即可。

### 第一步：创建

```bash
export FEISHU_APP_ID=... FEISHU_APP_SECRET=...
feishu-create-project-portfolio --bitable-name "协同表" --pretty > provision.json
# 或：python -m feishu.bitable --from-template --preset portfolio --bitable-name "协同表" --pretty > provision.json

export FEISHU_BITABLE_APP_TOKEN="$(jq -r '.app.app_token' provision.json)"
```

创建时若要先加群编辑：`export FEISHU_GRANT_EDIT_OPEN_CHAT_ID=oc_xxx` 并加 `--grant-edit-chat-id`，handover 时用 **`--skip-grant-chat`**。

### 第二步（默认必做）：handover

**群**：

```bash
export FEISHU_GRANT_EDIT_OPEN_CHAT_ID="oc_xxxxxxxx"
export FEISHU_NEW_OWNER_MEMBER_TYPE="userid"
export FEISHU_NEW_OWNER_MEMBER_ID="ou_xxxxxxxx"
feishu-bitable-handover --pretty
# 已加过群：feishu-bitable-handover --skip-grant-chat --pretty
```

**个人**：

```bash
export FEISHU_BITABLE_APP_TOKEN="<app_token>"
export FEISHU_NEW_OWNER_MEMBER_TYPE="openid"
export FEISHU_NEW_OWNER_MEMBER_ID="ou_xxxxxxxx"
feishu-bitable-handover --personal --pretty
# 已加过用户协作者：--personal --skip-grant-user
```

若 `full_access` 加人失败，可试 `--user-collaborator-perm edit`。

---

<a id="何时读取总记忆文件"></a>

## 何时读取总记忆文件

在下列情况下，Agent **应优先加载（读取）** 仓库根 [`memory/feishu_bitable_links.md`](../../../memory/feishu_bitable_links.md)：

- **新会话或上下文丢失**：用户继续操作某次已创建的「项目总管理」表，但对话里没有链接或 `app_token`。  
- **任务针对已有 Base**：例如补视图/表单、再次 handover、权限排查、用 OpenAPI 操作指定 `app_token` 的表、对照模板与线上一致性等，且用户未在本次消息中贴出标识。

**不必**为读取而预先打开该文件的情况：**明确从零新建**多维表格（新 `provision`），且用户未让你「沿用上次那张表」。

读完历史记录后：能唯一匹配则采用该条的链接与（若有）`app_token`；多条同名或无法匹配时，向用户确认或请其粘贴链接/token。

---

<a id="创建完成后记录文档链接"></a>

## 创建完成后：记录文档链接（总记忆 + 对话记忆）

在 **provision** 成功且（若需）**handover** 完成后，Agent **必须**完成以下两项（除非用户明确禁止写入磁盘或记忆）：

### 1. 总记忆文件（仓库内）

- 在仓库根 **`memory/feishu_bitable_links.md`** 末尾 **追加一行**记录（若文件不存在则先创建 `memory/` 与该文件，可按文件内模板格式）。  
- 建议包含：**日期**、**预设**（`portfolio` / `single_project`）、**多维表格显示名称**、**飞书内可打开的链接**（优先；由用户在客户端打开后复制，或按租户规则从 `app_token` 说明如何访问）。  
- `app_token` 是否写入由团队安全策略决定；敏感信息勿提交到公开仓库时可只记链接、不记 token。

文件路径（相对仓库根）：[`memory/feishu_bitable_links.md`](../../../memory/feishu_bitable_links.md)。

### 2. 当前对话记忆 + 产品侧「记忆」

- 在**本轮回复**中 **明确写出** 上述链接（及关键标识），便于用户复制与上下文留存。  
- 若当前环境提供 **记忆 / Memory**（如 Cursor 的会话或项目记忆），将 **同一套信息** 写入，使后续对话无需重新翻日志即可检索到「某次创建的多维表格在哪里」。

> **`single_project` 预设**与 `portfolio` 交付物类型相同，记录规则**一致**。

---

### Python 串行（项目总管理）

```python
from feishu.bitable import FeishuBitableClient, load_template, provision_bitable_from_template, default_template_path
from feishu.drive_permissions import bitable_grant_chat_edit_and_transfer_owner

client = FeishuBitableClient()
template = load_template(default_template_path())
result = provision_bitable_from_template(client, template, bitable_name="协同表")
app_token = result["app"]["app_token"]

result["drive_permissions"] = bitable_grant_chat_edit_and_transfer_owner(
    client, app_token,
    open_chat_id="oc_xxx",
    new_owner_member_type="userid",
    new_owner_member_id="ou_xxx",
)
```

个人：`bitable_grant_user_full_access_and_transfer_owner`（见下「Handover 附录」）。

---

## 流水线说明（默认 1～6 步）

1. `feishu-create-project-portfolio`（或 `--preset portfolio`）→ `app_token`  
2. 按模板建表与字段（含 `post_fields` / `late_post_fields` / `formula_fields`）  
3. `after_provision` 建视图  
4. `after_provision` 建表单  
5～6. handover（群或个人）

仅当用户明确不要改权限时，可省略 5～6。

---

## 何时单独补视图/表单

若自建 `*.bitable.json` 且**无** `after_provision`：先 `provision`，再用手动 CLI；最后仍建议 handover。

| 场景 | 做法 |
|------|------|
| 只缺视图 | `feishu-apply-bitable-views`，`table_ids`：`projects` / `members` / `tasks` / `weekly`（**`single_project` 预设**见 [USAGE_single_project.md](USAGE_single_project.md)，仅需 `tasks` / `members`） |
| 只缺表单 | `feishu-apply-bitable-forms`，成员+周报等见 portfolio 模板（**`single_project`** 用其目录下 `single_project.forms.json`） |
| 改 JSON 重跑 | 同名视图 `skip_if_exists: true` 会 PATCH |

### 补视图示例

```bash
export FEISHU_BITABLE_APP_TOKEN=<app_token>
feishu-apply-bitable-views \
  --config config/feishu.local.json \
  --template templates/feishu/hetang/bitable/project_portfolio/clinical_project_pm.views.json \
  --table-ids-json '{"projects":"tbl...","members":"tbl...","tasks":"tbl...","weekly":"tbl..."}' \
  --pretty
```

### 补表单示例

```bash
feishu-apply-bitable-forms \
  --config config/feishu.local.json \
  --template templates/feishu/hetang/bitable/project_portfolio/clinical_project_pm.forms.json \
  --table-ids-json '{"projects":"tbl...","members":"tbl...","tasks":"tbl...","weekly":"tbl..."}' \
  --pretty
```

---

## 模板 JSON 与 `formula_kind`（项目总管理）

**必读** [`clinical_project_pm.bitable.json`](../../../templates/feishu/hetang/bitable/project_portfolio/clinical_project_pm.bitable.json)：先读再执行，勿臆造字段。

| 键 | 说明 |
|----|------|
| `tables[].fields` | 首列为索引列，须符合[官方限制](https://open.feishu.cn/document/server-docs/docs/bitable-v1/app-table/create) |
| `after_provision` | `views_template` / `forms_template` 相对仓库根 |
| `post_fields` / `late_post_fields` | 延后字段与关联 |
| `formula_fields` | 内置 `formula_kind` 见下 |

**内置 `formula_kind`**：`counta_same_table`、`concat_date_text_user`、`user_field_display`（扩展见 `provision.py`）。

### 更多 CLI 示例

```bash
feishu-create-project-portfolio --pretty
python -m feishu.bitable --from-template --preset portfolio --pretty
python -m feishu.bitable --config /path/to/feishu.local.json --from-template --preset portfolio --pretty
export FEISHU_GRANT_EDIT_OPEN_CHAT_ID="oc_..." 
python -m feishu.bitable --from-template --preset portfolio --pretty
```

个人创建：建表后 `feishu-bitable-handover --personal`；若已 `--grant-edit-user-id`，加 `--skip-grant-user`。

> 无 `--from-template` 的空表**非本场景默认**。

```python
template = load_template("templates/feishu/hetang/bitable/project_portfolio/clinical_project_pm.bitable.json")
```

---

## 附录 A：群主归属 + 全员可编辑（Open API 要点）

1. `app_token`、群主 ID、群 `open_chat_id`。  
2. [增加协作者](https://open.feishu.cn/document/server-docs/docs/permission/permission-member/create)：`openchat` + `edit` + `chat`。  
3. [转移所有者](https://open.feishu.cn/document/server-docs/docs/permission/permission-member/transfer_owner)。  

机器人须在群内；需 `docs:permission.member:create` / `transfer` 等权限。

---

<a id="handover"></a>

## 附录 B：Handover 详解

**包**：`feishu.drive_permissions`。Bot 事件：**`feishu-bitable-handover-from-event`**。

```bash
export FEISHU_BITABLE_APP_TOKEN="<app_token>"
feishu-bitable-handover-from-event --event-file event.json --pretty
```

- `p2p` → 发送者 full_access → 转所有者给该用户  
- `group` → 群主 + 群协作者 → 转给群主  

**群 CLI**：

```bash
export FEISHU_BITABLE_APP_TOKEN="<app_token>"
export FEISHU_GRANT_EDIT_OPEN_CHAT_ID="oc_xxxxxxxx"
export FEISHU_NEW_OWNER_MEMBER_TYPE="userid"
export FEISHU_NEW_OWNER_MEMBER_ID="ou_xxxxxxxx"
feishu-bitable-handover --pretty
```

**个人 CLI**：

```bash
feishu-bitable-handover --config config/feishu.local.json \
  --app-token "xxx" --personal \
  --owner-member-type openid --owner-member-id "ou_xxx" --pretty
```

**Python 个人**：

```python
from feishu.drive_permissions import bitable_grant_user_full_access_and_transfer_owner

out = bitable_grant_user_full_access_and_transfer_owner(
    client, app_token,
    user_member_type="openid",
    user_member_id="ou_xxx",
)
```

| 参数 | 群 | 个人 |
|------|-----|------|
| `open_chat_id` | 需要 | 不需要 |
| owner | 群主等 | 发起用户 |

---

## CLI 对照（项目总管理相关）

| 能力 | 命令 |
|------|------|
| 一键建 Base+表+视图+表单 | **`feishu-create-project-portfolio`** |
| 仅补视图 | `feishu-apply-bitable-views` + portfolio 模板 |
| 仅补表单 | `feishu-apply-bitable-forms` + portfolio 模板 |
| 权限 | `feishu-bitable-handover` / `feishu-bitable-handover-from-event` |

---

## 参考

- [多维表格概述](https://open.feishu.cn/document/server-docs/docs/bitable-v1/bitable-overview)  
- [创建多维表格](https://open.feishu.cn/document/server-docs/docs/bitable-v1/app/create)  
- [新增视图](https://open.feishu.cn/document/server-docs/docs/bitable-v1/app-table-view/create) / [更新视图](https://open.feishu.cn/document/server-docs/docs/bitable-v1/app-table-view/patch)  
- [协作者](https://open.feishu.cn/document/server-docs/docs/permission/permission-member/create) / [转移所有者](https://open.feishu.cn/document/server-docs/docs/permission/permission-member/transfer_owner)  

返回主索引：[SKILL.md](SKILL.md)
