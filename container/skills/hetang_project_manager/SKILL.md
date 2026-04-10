---
name: hetang-project-manager
description: >-
  Feishu Bitable (hetang): single_project — **创建前必须先向用户询问并取得文档显示名称**（未回答则停止，禁止默认名）；
  成功后写入 memory/feishu_bitable_links.md；同名须先问是否删旧记录。见 USAGE_single_project.md。
---

# hetang_project_manager（单独项目管理 Skill）

本目录是飞书多维表格（Bitable）**荷塘单独项目管理**场景的 **Agent Skill 入口**。

> **硬门禁（创建）**：用户只说「创建项目管理文档」「建一个项目表」等而**未给出文档标题**时，**必须**先使用 MCP 工具读取指定的项目总表（`https://shaehv5cfo.feishu.cn/base/KtdlbOwJeav22zsJakzcMvEPnHb?table=tblW0xITjmuIuTZb`，app_token: `KtdlbOwJeav22zsJakzcMvEPnHb`, table_id: `tblW0xITjmuIuTZb`）中的“项目名称”列，并将列表发给用户让其**选择**。**在用户明确选择名称之前，禁止运行 `feishu-create-single-project`、禁止用「项目管理文档」或模板默认名代替。** 名称到手后，再按下方原则继续（查记忆同名 → 要 userid → 执行命令）。

## 使用说明

所有创建步骤、命令、handover、记忆文件规范见：

**→ [USAGE_single_project.md](USAGE_single_project.md)**

---

## Agent 执行原则

### 新建文档

0. **文档名称第一优先**：用户意图为「新建」时，**第一步永远是读取项目总表并让用户选择文档名称**；在用户给出具体名称之前，**不得执行任何创建命令**。
1. **每次新建都会产生一个全新的文档**，绝对不能使用记忆文件或历史记录中的任何 `app_token`。新建命令执行完后返回的 JSON 里才是本次新文档的 `app_token`。
2. **名称须为用户选择后的最终标题**，传入 **`--bitable-name "<名称>"`**；**禁止**在未获名称时使用 `项目管理文档`、模板 `bitable_name` 或任何占位符。
3. **创建前检查总表链接（查重）**：
   - 使用 MCP 工具读取项目总表（`KtdlbOwJeav22zsJakzcMvEPnHb`）中，用户所选项目对应的“项目管理文档链接”列。
   - **如果该列已有链接**，**必须先询问用户**：“该项目已存在项目管理文档（链接），是否需要删除已有的文档重新创建？”
   - 用户确认重新创建：则执行创建命令，创建成功后更新记忆文件（`memory/feishu_bitable_links.md`），并**更新/覆盖**项目总表中的“项目管理文档链接”。
   - 用户拒绝：则**停止创建**。
4. 记忆文件**允许多条**不同名称的项目管理文档记录；每条对应一次成功创建的 Base。
5. 创建完成后**必须**同时传 **`--grant-manage-user-id`** 和 **`--transfer-owner-user-id`**（同一用户 ID），将文档归属强制转移给对话用户并授予管理权限。**缺少用户 ID 时须先向用户索取，不可跳过。**
6. **创建完成后必须立即将文档链接发送给用户**，并执行以下两步记录操作：
   - **追加写入记忆文件**：从返回 JSON 取 `app.app_token`，拼接 `https://shaehv5cfo.feishu.cn/base/<app_token>`，与文档名称、日期一并记入 [`memory/feishu_bitable_links.md`](../../../memory/feishu_bitable_links.md)（格式见 USAGE）。
   - **回写至项目总表（极其重要）**：使用 MCP 工具，将该新文档链接写入到**项目总表**（app_token 必须是 `KtdlbOwJeav22zsJakzcMvEPnHb`，table_id 是 `tblW0xITjmuIuTZb`）中对应项目的“项目管理文档链接”列中。**警告：绝对禁止将链接写到刚刚新创建的文档中！回写的目标文档必须是项目总表！**
7. 黄金模板 token（见 `single_project.bitable.json` 的 `cockpit_source_app_token`）是**复制的来源**，不是新文档的地址，**不可将其作为新文档链接发给用户**。

### 操作已有文档

8. 任务针对**已存在**的文档时，先读取记忆文件 `memory/feishu_bitable_links.md` 按名称或 `app_token` 匹配；文件中无记录时再请用户提供链接或 token。

---

## 依赖（摘要）

- Python **3.9+**；HTTP 仅用标准库 `urllib`，无需 `requests`。
- 凭证：`config/feishu.local.json` 或环境变量；详见 USAGE_single_project.md。
- 可选 `pip install -e .` 安装控制台脚本。

## 本仓库索引

- **Python 源码**：仓库根 `src/feishu/`。
- **模板路径**：`templates/feishu/hetang/bitable/single_project/`。

## 参考（开放平台）

- [多维表格概述](https://open.feishu.cn/document/server-docs/docs/bitable-v1/bitable-overview)
- [创建多维表格](https://open.feishu.cn/document/server-docs/docs/bitable-v1/app/create)
- [协作者](https://open.feishu.cn/document/server-docs/docs/permission/permission-member/create) / [转移所有者](https://open.feishu.cn/document/server-docs/docs/permission/permission-member/transfer_owner)
