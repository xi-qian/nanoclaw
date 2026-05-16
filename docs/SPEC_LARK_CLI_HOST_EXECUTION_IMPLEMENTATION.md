# NanoClaw Lark CLI Host Execution Implementation Breakdown

## 1. 说明

本文档是 [SPEC_LARK_CLI_HOST_EXECUTION.md](/home/yeats/claude_project/nanoclaw-fork/nanoclaw/docs/SPEC_LARK_CLI_HOST_EXECUTION.md) 的实施拆分版。

目标不是重复描述架构，而是把方案拆成：

1. 需要新增哪些文件
2. 需要修改哪些文件
3. 每个文件具体改什么
4. 每个阶段的最小交付物是什么
5. 哪些改动可以并行，哪些必须串行

---

## 2. 实施总顺序

推荐严格按以下顺序推进：

1. 先引入运行资产目录与同步脚本
2. 再实现 host 侧 `lark-cli` 执行器
3. 再接入新的 IPC 协议
4. 再把容器 MCP 工具改成请求 host 执行
5. 再切 skill 分发
6. 再切文档/任务路径
7. 最后清理旧实现

原因：

- 运行资产没就绪前，不应改 host 执行器
- host 执行器没就绪前，不应改容器 MCP
- skill 没切换前，不应大规模删除旧 `feishu-*` 技能

---

## 3. Phase 0：运行资产与同步链路

### 3.1 新增文件

#### `scripts/sync-lark-cli-assets.sh`

用途：

1. 从参考目录 `../../cli` 构建 `lark-cli`
2. 将构建产物复制到 `vendor/lark-cli/bin/lark-cli`
3. 将选定 skill 复制到 `vendor/lark-cli/skills/`

建议行为：

```bash
#!/usr/bin/env bash
set -euo pipefail

REF_DIR="${REF_DIR:-../../cli}"
OUT_DIR="vendor/lark-cli"

ALLOWED_SKILLS=(
  lark-shared
  lark-doc
  lark-task
  lark-drive
  lark-base
  lark-contact
  lark-im
)
```

必须做的事：

1. 检查 `REF_DIR` 是否存在
2. 调用参考仓库的构建脚本或 `go build`
3. 原子方式覆盖 `vendor/lark-cli/bin/lark-cli`
4. 清空并重建 `vendor/lark-cli/skills/`
5. 只复制白名单 skill

#### `vendor/lark-cli/.gitkeep`

如果当前仓库允许提交 vendor 产物，可以直接提交真实二进制和 skills。
如果不允许提交大文件，至少保留目录占位和说明文档。

#### `vendor/lark-cli/README.md`

说明：

1. `vendor/lark-cli` 是 NanoClaw 运行资产
2. 不允许在运行时代码里依赖 `../../cli`
3. 更新 vendor 资产的唯一方式是运行同步脚本

### 3.2 可能修改文件

#### `package.json`

可新增脚本：

```json
{
  "scripts": {
    "sync:lark-cli": "bash scripts/sync-lark-cli-assets.sh"
  }
}
```

### 3.3 本阶段交付物

完成后应满足：

1. 仓库内存在稳定的 `vendor/lark-cli/bin/lark-cli`
2. 仓库内存在稳定的 `vendor/lark-cli/skills/*`
3. 后续代码不再需要直接访问 `../../cli`

---

## 4. Phase 1：Host 侧执行器

### 4.1 新增文件

#### `src/lark-cli-host.ts`

这是核心模块。

建议拆成以下函数：

```ts
export function resolveLarkCliBin(): string;
export function buildLarkCliEnv(): NodeJS.ProcessEnv;
export function validateLarkCliArgv(argv: string[]): void;
export async function runLarkCli(
  req: LarkCliExecRequest,
): Promise<LarkCliExecResult>;
```

##### `resolveLarkCliBin()`

职责：

1. 读取 `NANOCLAW_LARK_CLI_BIN`
2. fallback 到 `vendor/lark-cli/bin/lark-cli`
3. fallback 到 `PATH` 中的 `lark-cli`
4. 找不到时报清晰错误

##### `buildLarkCliEnv()`

职责：

1. 注入 `LARKSUITE_CLI_CONFIG_DIR`
2. 注入
   - `LARKSUITE_CLI_NO_UPDATE_NOTIFIER=1`
   - `LARKSUITE_CLI_NO_SKILLS_NOTIFIER=1`
3. 继承必要 host 环境
4. 移除不安全环境变量

##### `validateLarkCliArgv(argv)`

职责：

1. 校验一级命令是否在白名单中
2. 禁止 `config` / `auth` / `api` / `schema` 等默认禁用命令
3. 拒绝空 argv
4. 拒绝可疑参数注入模式

##### `runLarkCli(req)`

职责：

1. 调用 `validateLarkCliArgv`
2. 自动补充 `--format json`
3. 使用 `spawn` 或 `execFile`
4. 支持 timeout
5. 采集 stdout/stderr
6. 返回统一结构

#### `src/lark-cli-host.test.ts`

测试点：

1. 路径选择优先级
2. 一级命令白名单
3. 禁用命令拒绝
4. timeout 处理
5. JSON 解析成功
6. 非零退出码的错误包装

### 4.2 本阶段建议不改动

以下文件本阶段尽量不要动：

- `src/ipc.ts`
- `container/agent-runner/src/ipc-mcp-stdio.ts`
- `src/container-runner.ts`

先把 host 执行器独立做稳。

### 4.3 本阶段交付物

完成后应满足：

1. 在 host 上能独立执行受控 `lark-cli` 命令
2. 代码完全不需要 Feishu channel 即可测试
3. 单元测试完整

---

## 5. Phase 2：Lark IPC 协议

### 5.1 修改文件

#### `src/ipc.ts`

新增新的 IPC namespace 支持：

```text
data/ipc/{group}/lark/requests/
data/ipc/{group}/lark/results/
```

需要改的点：

1. 在 group IPC 初始化处创建 `lark/requests` 与 `lark/results`
2. 在 watcher 轮询中增加 `lark` 目录扫描
3. 新增 `processLarkIpcRequest()` 或同等逻辑
4. 在该逻辑中调用 `runLarkCli()`

建议新增的内部函数：

```ts
async function processLarkIpcRequest(
  request: any,
  sourceGroup: string,
): Promise<any>;
```

职责：

1. 校验 request shape
2. 若是 `type === "lark_cli_run"`，直接执行
3. 将结果写入 `lark/results`

#### `src/container-runner.ts`

初始化 group IPC 目录时新增：

```text
/workspace/ipc/lark/requests
/workspace/ipc/lark/results
```

当前已有：

- `messages`
- `tasks`
- `input`
- `downloads`

这里要补全 host 与 container 双方一致的目录结构。

### 5.2 新增测试

#### `src/ipc-lark.test.ts`

测试点：

1. host 能发现 `lark/requests/*.json`
2. 能执行并写回 `lark/results/*.json`
3. 异常请求能落错误日志或错误结果

### 5.3 本阶段交付物

完成后应满足：

1. 容器和 host 之间已有一条独立于 `feishu` 的 `lark` IPC 通路
2. host 已能处理通用 `lark_cli_run`

---

## 6. Phase 3：容器侧通用 MCP 工具

### 6.1 修改文件

#### `container/agent-runner/src/ipc-mcp-stdio.ts`

新增一个通用 MCP 工具：

##### `lark_cli_run`

参数建议：

```ts
{
  argv: z.array(z.string()),
  timeout_ms: z.number().optional(),
  expect_json: z.boolean().optional()
}
```

行为：

1. 将请求写入 `/workspace/ipc/lark/requests/`
2. 等待 `/workspace/ipc/lark/results/`
3. 返回结构化结果

##### 内部辅助函数

建议新增：

```ts
async function waitForLarkResult(requestId: string, timeoutMs?: number)
```

不要复用当前 `waitForFeishuResult()` 的目录和命名，避免迁移期混淆。

### 6.2 暂不删除旧工具

本阶段不要删：

- `feishu_fetch_doc`
- `feishu_create_doc`
- `feishu_task_create`

只新增 `lark_cli_run`。

### 6.3 本阶段交付物

完成后应满足：

1. 容器内 agent 已可通过通用工具请求 host 执行 `lark-cli`
2. 尚未破坏现有 `feishu_*` 业务路径

---

## 7. Phase 4：Skill 分发切换

### 7.1 修改文件

#### `src/container-runner.ts`

当前逻辑只同步 `container/skills/`。

需要改成：

1. 保留 `container/skills/`
2. 额外同步 `vendor/lark-cli/skills/`
3. 仅同步白名单 skill

建议新增常量：

```ts
const VENDORED_LARK_SKILLS = [
  'lark-shared',
  'lark-doc',
  'lark-task',
  'lark-drive',
  'lark-base',
  'lark-contact',
  'lark-im',
];
```

建议新增辅助函数：

```ts
function syncSkillDirectory(src: string, dst: string): void;
```

#### `groups/main/CLAUDE.md`

需要改的点：

1. 删除或降级旧 `feishu_task_*` 操作表
2. 增加对 `lark-doc`、`lark-task` 的说明
3. 提醒 agent 文档读取用 `lark-doc`
4. 提醒任务管理用 `lark-task`

#### `groups/global/CLAUDE.md`

同上。

### 7.2 可能新增文件

#### `container/skills/feishu-doc/SKILL.md`

如果保留该文件，建议改成 wrapper：

1. 告知这是兼容入口
2. 指向 `lark-doc`、`lark-drive`、`lark-base`
3. 不再列出旧 `feishu_*` 工具

#### `container/skills/feishu-task/SKILL.md`

同理，改成 wrapper 到 `lark-task`。

### 7.3 本阶段交付物

完成后应满足：

1. 新会话的容器内能看到 `lark-*` 技能
2. agent 的主要知识来源切到官方技能文档

---

## 8. Phase 5：旧 MCP 工具兼容转译

### 8.1 修改文件

#### `container/agent-runner/src/ipc-mcp-stdio.ts`

将以下旧工具改造成兼容层：

- `feishu_fetch_doc`
- `feishu_create_doc`
- `feishu_update_doc`
- `feishu_search_docs`
- `feishu_task_create`
- `feishu_task_get`
- `feishu_task_update`
- `feishu_task_complete`
- `feishu_task_reopen`
- `feishu_task_get_my_tasks`
- `feishu_task_get_related_tasks`

兼容层原则：

1. MCP 名字暂时不变
2. 但不再写旧 `feishu` request
3. 直接转译成 `lark_cli_run` request

例如：

##### `feishu_fetch_doc`

旧行为：

- 写 `type: "fetch_doc"` 到 `feishu/requests`

新行为：

- 写 `type: "lark_cli_run"` 到 `lark/requests`
- argv 为：

```text
docs +fetch --api-version v2 --doc <doc_id> --format json
```

##### `feishu_task_create`

argv 示例：

```text
task +create --summary <summary> --as bot --format json
```

### 8.2 修改文件

#### `src/ipc.ts`

在兼容迁移期，可以二选一：

1. 保留旧 `feishu` 分支，但内部不再调用 `feishuChannel`，而是调用 `runLarkCli()`
2. 或者更彻底：让容器旧工具直接写 `lark` 请求，host 完全不再接收旧 `feishu` 业务请求

建议：

- 采用方案 2
- host 的业务执行面尽量只保留一个命名空间

### 8.3 本阶段交付物

完成后应满足：

1. 外部用户和旧 skill 不感知底层切换
2. 文档与任务能力已开始走 `lark-cli`

---

## 9. Phase 6：文档路径全量切换

### 9.1 修改文件

#### `container/agent-runner/src/ipc-mcp-stdio.ts`

将文档相关旧工具全部改完：

- `feishu_fetch_doc`
- `feishu_create_doc`
- `feishu_update_doc`
- `feishu_search_docs`

必要时新增更贴近 `lark-doc` 的新工具名，但不强制。

#### `src/feishu/client.ts`

进入废弃状态的文档能力：

- `callMCPTool()`
- `fetchDoc()`
- `createDoc()`
- `updateDoc()`
- `searchDocs()`

本阶段先不要删除，只要不再被主路径依赖即可。

#### `src/channels/feishu.ts`

如果该文件只是简单代理到 `src/feishu/client.ts` 的文档方法，需要确认：

1. 是否还有调用者
2. 若没有，标记为 deprecated

### 9.2 本阶段交付物

完成后应满足：

1. 文档能力主路径不再依赖 `src/feishu/client.ts` 的文档实现
2. 文档 skill 主入口变成 `lark-doc`

---

## 10. Phase 7：任务路径全量切换

### 10.1 修改文件

#### `container/agent-runner/src/ipc-mcp-stdio.ts`

将任务相关旧工具全部改完：

- `feishu_task_*`
- `feishu_tasklist_*`

#### `src/feishu/client.ts`

进入废弃状态的任务能力：

- `createTask()`
- `getTask()`
- `updateTask()`
- `completeTask()`
- `reopenTask()`
- `searchTask()`
- `getMyTasks()`
- `getRelatedTasks()`
- `createTasklist()`
- `getTasklist()`
- `searchTasklist()`
- 成员、提醒、评论相关方法

本阶段先不要删，只要不再是主路径。

### 10.2 本阶段交付物

完成后应满足：

1. 任务与任务清单能力主路径改为 `lark-task`
2. `src/feishu/client.ts` 不再承担任务业务主逻辑

---

## 11. Phase 8：Base / Drive / Contact / IM 迁移

### 11.1 修改文件

#### `container/agent-runner/src/ipc-mcp-stdio.ts`

逐步替换以下旧工具：

- bitable / collaborator / owner transfer
- download resource
- send file
- get user department

替换为：

- `lark-base`
- `lark-drive`
- `lark-contact`
- `lark-im`

#### `src/feishu/client.ts`

对应废弃：

- Base 相关方法
- 文件资源收发相关方法
- 联系人/部门查询相关方法

### 11.2 本阶段交付物

完成后应满足：

1. 绝大多数飞书业务能力都已切到 `lark-cli`
2. NanoClaw 自己只保留消息通道和少数平台桥接能力

---

## 12. Phase 9：旧实现清理

### 12.1 删除候选

以下文件或代码段可考虑删除：

#### `src/feishu/client.ts`

删除条件：

1. 文档路径无调用
2. 任务路径无调用
3. Base / Drive / Contact / IM 无调用
4. 只剩消息通道必须的能力

#### `container/skills/feishu-doc/SKILL.md`

删除条件：

1. wrapper 不再需要
2. 所有主路径已稳定使用 `lark-doc`

#### `container/skills/feishu-task/SKILL.md`

同上。

#### `src/ipc.ts` 中旧 `feishu` 业务 switch

删除条件：

1. 没有任何容器工具再写旧 `feishu` 业务请求

### 12.2 收尾动作

1. 更新文档
2. 更新调试手册
3. 更新 README 中飞书业务说明
4. 清理过期测试

---

## 13. 并行化建议

### 13.1 可并行

可以并行做：

1. `scripts/sync-lark-cli-assets.sh`
2. `src/lark-cli-host.ts`
3. `src/lark-cli-host.test.ts`
4. `vendor/lark-cli/README.md`

### 13.2 不建议并行

以下改动最好串行：

1. `src/ipc.ts` 的 `lark` namespace 引入
2. `container/agent-runner/src/ipc-mcp-stdio.ts` 的 `lark_cli_run`
3. skill 分发改造
4. 旧工具兼容转译

原因：

- 这些改动共享协议和目录结构
- 容易因命名不一致导致调试困难

---

## 14. 每阶段的完成定义

### Phase 0 Done

- `vendor/lark-cli/bin/lark-cli` 存在
- `vendor/lark-cli/skills/*` 存在
- 有同步脚本

### Phase 1 Done

- host 可独立执行受控 `lark-cli`
- 单测通过

### Phase 2 Done

- `lark/requests` 与 `lark/results` 路径可用
- host 能处理 `lark_cli_run`

### Phase 3 Done

- 容器可调用 `lark_cli_run`

### Phase 4 Done

- 容器会话可看到 `lark-*` skill

### Phase 5 Done

- 旧高频工具兼容转译完成

### Phase 6 Done

- 文档主路径切到 `lark-doc`

### Phase 7 Done

- 任务主路径切到 `lark-task`

### Phase 8 Done

- 其他飞书业务能力基本切到 `lark-cli`

### Phase 9 Done

- 旧业务实现完成清理

---

## 15. 推荐首批实施范围

如果只做第一轮最小可用改造，建议只覆盖：

1. `vendor` 运行资产
2. `src/lark-cli-host.ts`
3. `lark_cli_run`
4. `feishu_fetch_doc` 兼容转译
5. `feishu_task_create` 兼容转译
6. `lark-doc` / `lark-task` skill 同步

这样可以最快验证三件事：

1. host 凭证边界是否保持住
2. `lark-cli` 执行链路是否稳定
3. agent 是否会开始使用 `lark-*` 技能而不是旧技能
