# Agents Guide

本文记录 NanoClaw 项目的代码目录结构，供 agent 和开发者快速定位模块职责。

## 顶层代码区域

```text
nanoclaw/
├── src/                    # 主控制面应用代码
├── container/
│   ├── agent-runner/       # agent runtime 入口
│   └── skills/             # 提供给 agent runtime 的技能
├── packages/
│   └── monitor/            # 监控 Web UI workspace
├── setup/                  # 安装、校验、服务配置相关 CLI
├── scripts/                # 维护、迁移、调试、手动测试脚本
├── config-examples/        # 配置示例
├── assets/                 # 静态资源
├── docs/                   # 架构文档、计划、规格说明
├── launchd/                # macOS launchd 服务模板
├── groups/                 # 当前 runtime 的本地 group 记忆/配置
├── data/                   # 本地 runtime 数据和 SQLite 文件
├── dist/                   # TypeScript 构建产物；不要手改
└── node_modules/           # 依赖安装目录；不要手改
```

## `src/` 主控制面

```text
src/
├── index.ts                # 主编排器：启动、消息循环、调度、channel 接入
├── config.ts               # 路径、间隔、环境变量和默认配置
├── env.ts                  # 环境加载工具
├── logger.ts               # 共享日志设置
├── types.ts                # 共享 TypeScript 类型
├── db.ts                   # SQLite schema 和数据访问
├── router.ts               # 消息格式化和出站路由
├── ipc.ts                  # host/runtime IPC 和工具请求处理
├── group-queue.ts          # group 级运行队列、生命周期、重试/idle 行为
├── group-folder.ts         # group 文件夹命名和路径校验
├── task-scheduler.ts       # 定时任务和 cron 执行
├── container-runner.ts     # 当前 Docker run 调用和 mount 组装
├── container-runtime.ts    # Docker runtime 发现、清理和辅助函数
├── credential-proxy.ts     # 当前 runtime 使用的 Anthropic credential proxy
├── mount-security.ts       # 额外挂载 allowlist 和阻断路径策略
├── remote-control.ts       # 远程控制 session 管理
├── sender-allowlist.ts     # 发送者过滤策略
├── approval-allowlist.ts   # 审批授权策略
├── webhook-tasks.ts        # webhook task 辅助逻辑
├── timezone.ts             # 时区工具
├── channels/               # channel 注册表和 channel 实现
├── feishu/                 # 飞书 auth/client/types/logger 实现
└── reporter/               # 本地 reporter API 和 monitor WebSocket client
```

测试文件通常与被测模块同目录，命名为 `*.test.ts`。

## `src/channels/`

```text
src/channels/
├── index.ts                # import channel 模块以触发自注册
├── registry.ts             # channel factory 注册表
├── registry.test.ts
└── feishu.ts               # 飞书 channel adapter、webhook/socket 处理
```

## `src/feishu/`

```text
src/feishu/
├── auth.ts                 # 飞书 credential 加载和认证辅助
├── client.ts               # 飞书 OpenAPI client wrapper
├── logger.ts               # 飞书专用日志
├── oauth.ts                # OAuth 辅助逻辑
└── types.ts                # 飞书类型定义
```

## `src/reporter/`

```text
src/reporter/
├── index.ts                # reporter 生命周期
├── local-api.ts            # 本地 monitor/reporting HTTP API
├── types.ts                # reporter 类型
└── ws-client.ts            # central monitor WebSocket client
```

## Agent Runtime

```text
container/agent-runner/
├── package.json
├── tsconfig.json
└── src/
    ├── index.ts            # agent runtime 入口
    └── ipc-mcp-stdio.ts    # IPC-backed tools 的 MCP stdio bridge
```

`container/skills/` 放 runtime skill。多数 skill 目录包含 `SKILL.md`，部分还包含脚本、模板、配置或参考数据：

```text
container/skills/
├── agent-browser/
├── capabilities/
├── feishu-approval/
├── feishu-doc/
├── feishu-task/
├── file-reader/
├── hetang_approval/
├── hetang_project_manager/
├── hetang_task_update/
├── ido-approve-review/
├── pm-persona/
├── pptx/
├── status/
├── trigger-intelligent-approval/
├── weekly-report-reminder/
├── weekly-report-summary/
├── weekly-report-sync/
└── weekly-report-update/
```

## Setup 和运维代码

```text
setup/
├── index.ts                # setup CLI 入口
├── environment.ts          # 环境检查和迁移辅助
├── platform.ts             # 平台检测
├── container.ts            # 容器 runtime 设置
├── groups.ts               # group 发现/列表辅助
├── register.ts             # group 注册
├── mounts.ts               # 额外挂载配置
├── service.ts              # 服务安装辅助
├── status.ts               # setup/status 输出
└── verify.ts               # 安装后校验
```

```text
scripts/
├── auth-feishu.ts          # 飞书认证工具
├── run-migrations.ts       # migration runner
├── check-*.mjs             # 本地数据库/调试检查脚本
├── reset-session.mjs       # session 重置辅助
├── clear-all-sessions.mjs  # 批量 session 清理辅助
├── register-feishu-group.mjs
├── fix-group-registration.mjs
└── test-*                  # 手动集成/调试脚本
```

## Monitor Workspace

```text
packages/monitor/
├── package.json
├── tsconfig.json
└── src/
    ├── index.ts            # monitor 服务入口
    ├── server.ts           # HTTP/WebSocket server wiring
    ├── config.ts           # monitor 配置
    ├── types.ts            # monitor 类型
    ├── api/                # REST API handlers
    ├── db/                 # monitor SQLite schema/access
    ├── ws/                 # WebSocket manager/types
    └── public/             # 静态 dashboard HTML/CSS/JS
```

## 非源码或生成目录

- `dist/` 由 `npm run build` 生成；修改源码请改 `src/`。
- `node_modules/` 是依赖安装目录。
- `data/` 和 `groups/` 是当前部署的本地 runtime 状态。
- `docs/` 是设计、计划和运维文档；架构变更需要同步更新相关文档。
- `repo-tokens/` 是 token 统计示例/输出，不在 runtime 代码路径上。

