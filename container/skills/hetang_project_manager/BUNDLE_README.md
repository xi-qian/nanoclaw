# hetang_project_manager 打包说明（单独项目管理）

本目录对应 **单独项目管理** skill；由仓库根执行 `python scripts/package_feishu_bitable_skill.py` 生成/更新。

## 布局

- `src/feishu/` — Python 包（与仓库 `src/feishu` 同步）
- `templates/feishu/` — 多维表格 JSON 模板
- `config/feishu.local.json.example` — 应用凭证模板（复制为 **`config/feishu.local.json`** 或 **`feishu.local.json`** 后填写，勿提交密钥）
- `requirements.txt` — 说明文件（**HTTP 仅用标准库 `urllib`，无需 pip 装依赖**；离线 / NanoClaw 等环境可直接运行）

`provision.py` 以本目录为「仓库根」解析 `templates/feishu/...` 路径（`parents[3]` 自 `src/feishu/bitable/provision.py` 起算）。

## 凭证（必选其一）

1. 在本目录执行：`cp config/feishu.local.json.example config/feishu.local.json`，编辑填入 `app_id`、`app_secret`；或把 `feishu.local.json` 放在本目录根。  
2. 或设置环境变量 **`FEISHU_APP_ID`** / **`FEISHU_APP_SECRET`**。  
3. CLI 支持 **`--config /path/to/feishu.local.json`**。

## 运行方式

在任意机器上（**无需访问 PyPI**，仅需 Python 3.9+ 与到飞书 OpenAPI 的网络）：

```bash
cd /path/to/hetang_project_manager   # 本 skill 根目录（含 src/、templates/、SKILL.md）
export PYTHONPATH="$(pwd)/src"
# single_project：任务+成员两表，黄金模板复制
python -m feishu.bitable --from-template --preset single_project --pretty
python -m feishu.drive_permissions --help
```

若已在本仓库执行 `pip install -e .`，可改用 **`feishu-create-single-project`**、`feishu-create-bitable`、`feishu-bitable-handover`。

## 注意

- 重新打包会**删除并覆盖**本目录下的 `src/feishu` 与 `templates/feishu`；勿在二者内存放仅本地修改（应改仓库源文件后再打包）。
- 操作步骤见 skill 目录下 **`SKILL.md`** 与 **`USAGE_single_project.md`**；打包会同步代码与模板，**不会删除**上述 Markdown（若目录内已有副本）。
