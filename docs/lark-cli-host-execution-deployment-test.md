# Lark CLI Host Execution 部署测试报告

## 背景

`feature/lark-cli-host-spawn` 分支将飞书文档、任务、Base、Drive 等业务能力从容器内 MCP 工具直调 API 切换为宿主机执行 `lark-cli`。部署到测试实例 `/data/user/qianxi/nanoclaw-test`。

## 部署步骤

1. 代码部署：GitHub pull `feature/lark-cli-host-spawn`
2. `npm install && npm rebuild better-sqlite3 && npm run build`
3. `.env` 新增变量：
   ```
   NANOCLAW_LARK_CLI_BIN=/data/user/qianxi/bin/lark-cli
   NANOCLAW_LARK_CLI_CONFIG_DIR=/data/user/qianxi/nanoclaw-test/lark-cli-config
   NANOCLAW_FEISHU_CREDENTIALS_DIR=/data/user/qianxi/nanoclaw-test/store/auth/feishu
   LOG_LEVEL=debug
   ```
4. `npm run generate:lark-cli-config` — 从 NanoClaw 凭证生成 lark-cli bot 配置
5. `systemctl --user restart nanoclaw-test`

## 测试发现的 bug 及修复

### Bug #1：`--format json` 自动追加破坏 shortcut 命令

`spawn.ts` 的 `withJsonFormat` 对所有命令自动追加 `--format json`，但 `docs +create` 等 shortcut 不支持此参数，导致命令报错退出。

**修复**：
- shortcut（`+` 开头）跳过 `--format json`，它们默认输出 JSON
- 始终尝试将 stdout 解析为 JSON，不再依赖 `expectJson` 开关

### Bug #2：旧 feishu MCP 工具的 skill 文档仍指向已删除的工具

旧 `feishu-doc` / `feishu-task` skill 告知 agent "使用 MCP 工具"，但这些工具已在容器中删除。

**修复**：
- 删除 `ipc-mcp-stdio.ts` 中全部旧 `feishu_*` MCP 工具（~1400 行）
- `feishu-doc`/`feishu-task` SKILL.md 改为 wrapper，重定向到 `lark-doc`/`lark-task`

### Bug #3：容器重启时旧容器阻塞 systemd 停机

systemd restart 时，运行中的 Docker 容器导致服务卡在 `deactivating` 状态。需手动 `docker kill`。

## 文件变更清单

| 文件 | 改动说明 |
|------|----------|
| `src/lark-executor/spawn.ts` | shortcut 命令不再追加 `--format json`；始终尝试 JSON 解析 |
| `container/agent-runner/src/ipc-mcp-stdio.ts` | 删除 `feishu_fetch_doc`、`feishu_create_doc`、`feishu_task_create` 等全部旧 feishu MCP 工具，仅保留 `lark_cli_run` + 通道工具 |
| `container/skills/feishu-doc/SKILL.md` | 改为废弃 wrapper → `lark-doc`/`lark-drive`/`lark-base` |
| `container/skills/feishu-task/SKILL.md` | 改为废弃 wrapper → `lark-task` |

## 测试验证结果

| 场景 | 结果 | 说明 |
|------|------|------|
| Task 创建 | ✅ | `lark-cli task +create` 成功 |
| Doc 创建 | ✅ | `lark-cli docs +create --api-version v2 --content` 成功 |
| Base 创建 | ✅ | `lark-cli base +base-create` 成功，含后续 table-list 操作 |
| 多维表格生成 | ✅ | agent 自动调用 lark-cli 创建 base、添加字段、写入记录 |

debug 日志确认每条飞书业务操作都走 `lark_cli_run → /data/user/qianxi/bin/lark-cli`，无旧路径回退。

## 未解决的注意事项

- `schema` 命令在 `BLOCKED_TOP_LEVEL_COMMANDS` 中，但 lark-task/lark-doc 等技能文档要求 agent 先用 `schema` 查看参数结构。目前不影响 shortcut 使用，但影响原生 API 路径
- 容器重启时 Docker 容器清理非原子，需手动 `docker kill`
