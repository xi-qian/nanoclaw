# NanoClaw Lark CLI Host Execution Spec

## 1. 背景

NanoClaw 当前的飞书业务能力分成两层：

1. **消息通道层**
   - 由 host 侧 Feishu channel 负责
   - 处理 WebSocket 事件、消息接收、消息发送、聊天元数据
   - 代码入口主要在 `src/channels/feishu.ts`

2. **业务工具层**
   - 由容器内 `nanoclaw` MCP 工具发起请求
   - 经由 IPC 交给 host 侧 `src/ipc.ts`
   - host 再调用 `src/feishu/client.ts` 中的文档、任务、Base 等 API 适配逻辑

该方案的问题是：

- 文档、任务、Base、Drive、Contact 等业务能力由 NanoClaw 自己维护，范围不断扩大
- 业务命令、参数约定、权限约定、身份选择规则与官方 `lark-cli` 逐渐重复
- 技能文档与工具实现分散在 NanoClaw 内部，不利于与官方 Lark skill 体系对齐

与此同时，已有一个可参考的 Lark CLI 代码目录 `../../cli`，其中包含：

- `lark-cli` 二进制的源码实现
- `lark-doc`、`lark-task`、`lark-base` 等技能文档
- 更完整的命令封装、身份模型和参数规则

**重要约束：`../../cli` 只是参考代码目录，不是 NanoClaw 的系统安装目录，也不是运行时依赖。**

本 spec 定义一种新的集成方案：

- **保留 NanoClaw 的 Feishu 消息通道**
- **将飞书业务工具层替换为 host 侧执行 `lark-cli`**
- **保持真实凭证只存在于容器外的 host**

---

## 2. 目标

### 2.1 主要目标

1. 保持现有飞书消息通道能力不变
2. 保持真实 app 凭证、user token、keychain 状态只在 host
3. 将文档、任务、Base、Drive、Contact、IM 附件等业务能力切换到 `lark-cli`
4. 将容器内 skill 文档切换到 `lark-*` 技能体系
5. 运行时不依赖 `../../cli` 相对路径

### 2.2 非目标

1. 不替换 `src/channels/feishu.ts` 的消息收发架构
2. 不在第一阶段实现 `lark-cli` sidecar 模式
3. 不在第一阶段支持容器内直接持有 `lark-cli` 配置或 token
4. 不要求一次性删除所有旧 `feishu_*` 工具，允许兼容迁移期

---

## 3. 关键约束

### 3.1 凭证边界

必须满足以下规则：

1. 真实的 `appId` / `appSecret` 不进入容器
2. `lark-cli` 的配置目录不挂载进容器
3. `lark-cli` 的 user token 不挂载进容器
4. host 执行 `lark-cli` 时使用 host 自己的配置、keychain 和登录状态

### 3.2 运行时路径约束

运行时代码不得直接依赖：

- `../../cli/lark-cli`
- `../../cli/skills/...`

这些路径只允许在**开发期同步脚本**中出现，不允许在主程序运行逻辑中出现。

### 3.3 命令执行约束

1. host 执行 `lark-cli` 时必须使用 argv 数组，不允许 shell 拼接
2. host 只允许执行白名单命令域
3. 默认优先使用 `--format json`
4. 高风险写操作必须支持 `--dry-run` 预览和显式确认策略

---

## 4. 总体方案

### 4.1 核心设计

新的架构分为三层：

1. **消息层**
   - 保持现有 Feishu channel 不变
   - 仍由 `src/channels/feishu.ts` 和 `src/feishu/*` 负责消息通道

2. **工具协议层**
   - 容器内 agent 通过 MCP 工具发起业务请求
   - MCP 工具写 IPC 文件给 host
   - host 读取 IPC 请求并执行 `lark-cli`

3. **Lark CLI 执行层**
   - host 侧新增 `lark-cli` 执行器
   - 负责命令白名单校验、参数构建、执行、超时控制、JSON 解析、错误映射

### 4.2 总体架构图

```text
Container Agent
  -> MCP tool
  -> /workspace/ipc/lark/requests/*.json
  -> Host IPC watcher
  -> host-side lark-cli executor
  -> host lark-cli binary
  -> host config dir / keychain / tokens
  -> Lark OpenAPI
  -> /data/ipc/{group}/lark/results/*.json
  -> MCP tool returns result to agent
```

### 4.3 为什么选择 host 执行

相比“容器内安装并直接运行 `lark-cli`”：

- 与 NanoClaw 当前 IPC 代理模式一致
- 凭证边界更清晰
- 不需要先解决 sidecar 特殊构建与代理配置
- 更适合逐步替换现有 `feishu_*` 工具

---

## 5. 运行资产与目录布局

### 5.1 运行资产原则

NanoClaw 运行时需要使用的 `lark-cli` 二进制和 `lark-*` skill，必须由 NanoClaw 自己管理。

参考目录 `../../cli` 只用于：

- 开发时对照命令设计
- 开发时同步二进制和 skill
- 开发时生成 vendor 产物

### 5.2 目标目录布局

```text
nanoclaw/
├── vendor/
│   └── lark-cli/
│       ├── bin/
│       │   └── lark-cli
│       └── skills/
│           ├── lark-shared/
│           ├── lark-doc/
│           ├── lark-task/
│           ├── lark-drive/
│           ├── lark-base/
│           ├── lark-contact/
│           └── lark-im/
├── scripts/
│   └── sync-lark-cli-assets.sh
└── docs/
    └── SPEC_LARK_CLI_HOST_EXECUTION.md
```

### 5.3 Host 配置目录

host 侧 `lark-cli` 配置目录建议独立于用户日常 CLI 环境，使用专用目录，例如：

```text
~/.config/nanoclaw/lark-cli/
```

通过环境变量传给 host 执行器：

- `LARKSUITE_CLI_CONFIG_DIR=<nanoclaw-specific-dir>`

### 5.4 二进制解析优先级

host 执行器查找 `lark-cli` 的优先级必须为：

1. `NANOCLAW_LARK_CLI_BIN`
2. `vendor/lark-cli/bin/lark-cli`
3. `PATH` 中的 `lark-cli`

禁止使用 `../../cli/lark-cli` 作为运行时 fallback。

---

## 6. 模块设计

### 6.1 新增模块

新增：

- `src/lark-cli-host.ts`

职责：

1. 定位 `lark-cli` 二进制
2. 对请求进行白名单校验
3. 构造最终 argv
4. 在 host 执行命令
5. 统一 stdout/stderr/exitCode 解析
6. 对 JSON 输出做结构化封装

建议导出接口：

```ts
export interface LarkCliExecRequest {
  argv: string[];
  timeoutMs?: number;
  cwd?: string;
  expectJson?: boolean;
  env?: Record<string, string>;
}

export interface LarkCliExecResult {
  ok: boolean;
  exitCode: number;
  stdout: string;
  stderr: string;
  json?: unknown;
}

export async function runLarkCli(
  req: LarkCliExecRequest,
): Promise<LarkCliExecResult>;
```

### 6.2 现有模块改造

#### `src/ipc.ts`

新增对 `lark` IPC 命名空间的支持：

- `data/ipc/{group}/lark/requests/`
- `data/ipc/{group}/lark/results/`

同时允许保留现有 `feishu/requests` 目录作为兼容入口，在迁移期将旧请求翻译为新的 `lark-cli` 执行请求。

#### `container/agent-runner/src/ipc-mcp-stdio.ts`

新增通用工具：

- `lark_cli_run`

并逐步把旧的：

- `feishu_fetch_doc`
- `feishu_create_doc`
- `feishu_task_create`
- `feishu_task_get_my_tasks`

改成写 `lark` IPC 请求，而不是旧的 `feishu` API 请求。

#### `src/container-runner.ts`

保留现有 `container/skills` 同步逻辑，新增从 `vendor/lark-cli/skills` 同步选定 `lark-*` skills 到每个 group 的 `.claude/skills`。

#### `groups/main/CLAUDE.md` 与 `groups/global/CLAUDE.md`

需要移除或降级旧的 `feishu_*` 业务工具说明，改成：

- 优先使用 `lark-doc`
- 优先使用 `lark-task`
- Base 操作用 `lark-base`
- 联系人解析用 `lark-contact`

---

## 7. IPC 协议

### 7.1 IPC 命名空间

新增目录：

```text
data/ipc/{group}/lark/requests/
data/ipc/{group}/lark/results/
```

### 7.2 基础请求类型

#### 7.2.1 `lark_cli_run`

容器写入：

```json
{
  "type": "lark_cli_run",
  "argv": ["docs", "+fetch", "--api-version", "v2", "--doc", "doc_token"],
  "expect_json": true,
  "timeout_ms": 30000,
  "groupFolder": "feishu-main",
  "timestamp": "2026-05-15T10:00:00.000Z"
}
```

host 返回：

```json
{
  "success": true,
  "exit_code": 0,
  "stdout": "{...}",
  "stderr": "",
  "json": {
    "ok": true
  }
}
```

失败返回：

```json
{
  "success": false,
  "exit_code": 1,
  "stdout": "",
  "stderr": "permission denied",
  "error": "lark-cli exited with code 1"
}
```

### 7.3 兼容请求类型

迁移期允许保留现有请求类型：

- `fetch_doc`
- `create_doc`
- `update_doc`
- `search_docs`
- `task_create`
- `task_get`
- `task_update`
- `task_complete`
- `task_get_my_tasks`

但 host 不再直接调用 `feishuChannel.xxx()`；而是在 `src/ipc.ts` 内部把这些旧请求翻译为 `lark_cli_run`。

### 7.4 请求翻译示例

#### `fetch_doc`

输入：

```json
{
  "type": "fetch_doc",
  "doc_id": "doc_token"
}
```

翻译为：

```text
lark-cli docs +fetch --api-version v2 --doc doc_token --format json
```

#### `task_create`

输入：

```json
{
  "type": "task_create",
  "params": {
    "summary": "上线准备"
  }
}
```

翻译为：

```text
lark-cli task +create --summary 上线准备 --as bot --format json
```

---

## 8. 命令白名单与执行策略

### 8.1 允许的服务域

host 执行器只允许以下一级命令：

- `docs`
- `task`
- `drive`
- `base`
- `contact`
- `im`
- `calendar`
- `wiki`

### 8.2 默认禁止的命令

默认禁止：

- `config`
- `auth`
- `profile`
- `update`
- `service`
- `schema`
- `api`
- `event`

原因：

- 会改变 host 的 CLI 状态
- 会引入超出业务工具需求的能力面
- `api` 和 `schema` 会放大注入面与行为不确定性

如需开放，必须通过显式 feature flag 控制。

### 8.3 身份策略

第一阶段默认策略：

1. 没有用户明确要求时，优先 `--as bot`
2. 仅在 host 已配置 user 登录且明确允许的情况下，才允许 `--as user`
3. `--as auto` 不作为外部输入直接暴露给容器

建议在 host 侧增加配置：

- `NANOCLAW_LARK_ALLOW_USER_IDENTITY=0|1`

### 8.4 输出格式策略

host 执行器应在未指定时自动补充：

- `--format json`

必要时兼容某些 shortcut 的自然文本输出，但 host 仍应尽量请求 JSON 结果。

### 8.5 超时策略

默认超时：

- 普通读取：30 秒
- 文档创建/更新：180 秒
- 文件上传下载：180 秒

超过超时后中止子进程并返回结构化错误。

---

## 9. Skill 分发策略

### 9.1 目标

容器内 agent 看到的技能应以 `lark-*` skills 为主，而不是 NanoClaw 自己维护的大量 `feishu-*` 业务技能。

### 9.2 初始同步集合

第一阶段只同步以下技能：

- `lark-shared`
- `lark-doc`
- `lark-task`
- `lark-drive`
- `lark-base`
- `lark-contact`
- `lark-im`

### 9.3 同步规则

`src/container-runner.ts` 需要：

1. 继续同步 `container/skills`
2. 再同步 `vendor/lark-cli/skills` 中的允许集合
3. 如果名字冲突，以 NanoClaw 自己的 wrapper skill 优先

### 9.4 NanoClaw wrapper skills

对于少数需要兼容旧习惯的场景，可保留轻量 wrapper skill，例如：

- `feishu-doc` 变成一页跳转说明：提示优先使用 `lark-doc` 与 `lark-drive`
- `feishu-task` 变成一页跳转说明：提示优先使用 `lark-task`

wrapper skill 不应再绑定旧 `feishu_*` MCP 工具语义。

---

## 10. 旧能力到新能力的映射

### 10.1 文档

| 旧工具 | 新命令 / skill |
|--------|----------------|
| `feishu_fetch_doc` | `lark-cli docs +fetch --api-version v2` / `lark-doc` |
| `feishu_create_doc` | `lark-cli docs +create --api-version v2` / `lark-doc` |
| `feishu_update_doc` | `lark-cli docs +update --api-version v2` / `lark-doc` |
| `feishu_search_docs` | `lark-cli drive +search` / `lark-drive` |

### 10.2 任务

| 旧工具 | 新命令 / skill |
|--------|----------------|
| `feishu_task_create` | `lark-cli task +create` / `lark-task` |
| `feishu_task_get` | `lark-cli task tasks get` 或 `lark-task` shortcut |
| `feishu_task_update` | `lark-cli task +update` / `lark-task` |
| `feishu_task_complete` | `lark-cli task +complete` / `lark-task` |
| `feishu_task_reopen` | `lark-cli task +reopen` / `lark-task` |
| `feishu_task_get_my_tasks` | `lark-cli task +get-my-tasks` / `lark-task` |
| `feishu_task_get_related_tasks` | `lark-cli task +get-related-tasks` / `lark-task` |
| `feishu_task_search` | `lark-cli task +search` / `lark-task` |
| `feishu_tasklist_*` | `lark-cli task +tasklist-*` / `lark-task` |

### 10.3 Base / Drive / Contact / IM

| 旧能力 | 新 skill |
|--------|----------|
| bitable app/table/record/field | `lark-base` |
| 文档/文件搜索、权限、上传下载 | `lark-drive` |
| 用户解析、部门查询 | `lark-contact` |
| 附件发送、资源下载、消息文件操作 | `lark-im` |

---

## 11. 迁移计划

### 11.1 Phase 0：准备运行资产

目标：

1. 引入 `vendor/lark-cli/bin/lark-cli`
2. 引入 `vendor/lark-cli/skills/*`
3. 新增 `scripts/sync-lark-cli-assets.sh`

交付物：

- vendor 二进制与 skill
- 运行时路径不再依赖 `../../cli`

### 11.2 Phase 1：引入 host 执行器

目标：

1. 新增 `src/lark-cli-host.ts`
2. 能在 host 上执行固定白名单 `lark-cli` 命令
3. 具备 JSON 输出解析、超时、错误封装能力

交付物：

- `runLarkCli()` 基础能力
- 单元测试

### 11.3 Phase 2：引入通用 IPC

目标：

1. 新增 `lark/requests` 与 `lark/results` 目录
2. 新增 `lark_cli_run` 请求类型
3. 在容器 MCP 中新增 `lark_cli_run`

交付物：

- 容器可请求 host 执行 `lark-cli`

### 11.4 Phase 3：文档和任务迁移

目标：

1. 将 `fetch_doc`、`create_doc`、`update_doc`、`task_create` 等旧请求翻译到 `lark-cli`
2. 保持旧 MCP 工具名短期兼容
3. 将 skill 引导切到 `lark-doc` / `lark-task`

交付物：

- 文档与任务功能迁移完成
- 旧 `src/feishu/client.ts` 对应业务代码进入废弃状态

### 11.5 Phase 4：Base / Drive / Contact / IM 迁移

目标：

1. 迁移 bitable/base 能力到 `lark-base`
2. 迁移文件上传下载与权限能力到 `lark-drive` / `lark-im`
3. 迁移联系人解析能力到 `lark-contact`

### 11.6 Phase 5：清理旧实现

可删除：

- `src/feishu/client.ts` 中非消息通道所需的业务方法
- `container/skills/feishu-doc/SKILL.md`
- `container/skills/feishu-task/SKILL.md`
- `src/ipc.ts` 中旧 `feishu` 业务分支

保留：

- `src/channels/feishu.ts`
- 消息发送/接收相关逻辑
- Feishu channel 的凭证与连接管理

---

## 12. 测试策略

### 12.1 单元测试

覆盖：

1. `lark-cli` 路径选择优先级
2. 白名单命令校验
3. 禁止命令校验
4. 超时处理
5. JSON 解析
6. 非零退出码映射

### 12.2 IPC 集成测试

覆盖：

1. 容器工具写入 `lark_cli_run` 请求
2. host 正确读取并执行
3. host 回写结果
4. MCP 工具正确返回结构化错误

### 12.3 兼容测试

覆盖：

1. `feishu_fetch_doc` 仍可用，但底层走 `lark-cli`
2. `feishu_task_create` 仍可用，但底层走 `lark-cli`
3. 旧 skill 文案不导致 agent 选择错误路径

### 12.4 端到端测试

至少验证：

1. 读取文档
2. 创建文档
3. 创建任务
4. 查询我的任务
5. 搜索 Drive 资源

---

## 13. 安全要求

### 13.1 Host 执行器安全要求

1. 必须使用 argv 数组执行，不得使用 shell 拼接
2. 不得允许容器直接执行 `config` / `auth`
3. 不得允许容器读取 `LARKSUITE_CLI_CONFIG_DIR`
4. 不得将 host 的真实 CLI 配置目录挂载到容器
5. 所有执行日志必须保留命令域、退出码、耗时，但不得打印 secret

### 13.2 日志要求

允许记录：

- 命令一级域，如 `docs`, `task`
- 参数摘要
- 耗时
- 退出码

禁止记录：

- access token
- refresh token
- app secret
- 原始认证头

### 13.3 Feature Flag

建议增加：

- `NANOCLAW_LARK_ALLOW_USER_IDENTITY`
- `NANOCLAW_LARK_ENABLE_DIRECT_API`
- `NANOCLAW_LARK_ALLOWED_DOMAINS`

第一阶段默认：

- user identity 关闭
- direct API 关闭
- domains 走硬编码白名单

---

## 14. 验收标准

满足以下条件才算该方案落地完成：

1. NanoClaw 运行时不依赖 `../../cli` 相对目录
2. 真实 `lark-cli` 配置、token、keychain 状态不进入容器
3. 文档与任务的主要业务路径已改为 host 执行 `lark-cli`
4. 容器内已可使用 `lark-doc` 与 `lark-task` 技能
5. 旧 `feishu_*` 业务工具要么兼容转译，要么明确删除
6. 消息通道行为不回归

---

## 15. Open Questions

### 15.1 是否保留旧工具名

选项：

1. 长兼容期：保留 `feishu_*` MCP 工具名，底层全部转译
2. 短兼容期：只保留少数高频工具
3. 直接切换：删除旧工具名，只保留 `lark_cli_run`

建议：

- 先采用短兼容期

### 15.2 是否允许 `schema`

`lark-task` 技能文档大量提到 `schema`。

问题：

- 开放 `schema` 可以提升 agent 自我修正能力
- 但也扩大了 host 可执行命令面

建议：

- 第一阶段禁用
- 如需启用，通过 feature flag 控制只读开放

### 15.3 是否进入 sidecar 模式

本 spec 不要求 sidecar。

后续若需要在容器内直接执行 `lark-cli` 且仍保持凭证在 host，需单独立项，新增 sidecar spec。

---

## 16. 实施摘要

一句话总结本方案：

**NanoClaw 保留自己的 Feishu 消息通道，但将飞书业务能力改为“容器发 IPC，host 执行 vendor 化的 `lark-cli`”，同时确保真实凭证、配置和 token 始终留在容器外。**
