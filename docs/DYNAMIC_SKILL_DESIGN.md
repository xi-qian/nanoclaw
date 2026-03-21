# 动态 Skill 创建功能设计文档

## 概述

本文档描述如何在 NanoClaw 中实现动态 Skill 创建功能，允许 Agent 在对话过程中将执行过程保存为可复用的 Skill。

---

## 背景与动机

### 当前问题

- **静态 Skill**：当前所有 Skill 由开发者预先创建在 `container/skills/` 目录
- **无法复用**：Agent 在对话中总结的最佳实践无法保存为 Skill
- **维护成本**：每次添加 Skill 需要修改代码并重新部署

### 目标

- 允许 Agent 动态创建 Skill
- 支持 group 级别和 global 级别的 Skill
- 新创建的 Skill 立即可用，无需重启服务
- 保证安全性，防止恶意操作

---

## 现有架构

### Skill 目录结构

```
项目根目录/
├── container/skills/           # 源 Skill（开发者维护，全局）
│   ├── feishu-doc/
│   │   └── SKILL.md
│   ├── capabilities/
│   │   └── SKILL.md
│   └── ...
│
└── data/sessions/{group}/.claude/skills/  # 每个 group 的 Skill 副本
    ├── feishu-doc/
    │   └── SKILL.md
    └── ...
```

### 加载流程

```
启动时:
container/skills/ ──复制──▶ data/sessions/{group}/.claude/skills/
                                    │
                                    │ 挂载到容器
                                    ▼
                         /home/node/.claude/skills/
```

### 限制

| 限制 | 说明 |
|------|------|
| 单向同步 | 只从源目录复制到 session 目录，无反向同步 |
| 静态创建 | Agent 无法创建新 Skill |
| 无 IPC 支持 | 没有 Skill 相关的 IPC 类型 |

---

## 新架构设计

### 整体架构

```
┌─────────────────────────────────────────────────────────────────────────┐
│                          Docker Container                                │
│                                                                          │
│  ┌─────────────────────────────────────────────────────────────────┐    │
│  │ MCP Tool: create_skill                                           │    │
│  │                                                                   │    │
│  │ Agent 调用此工具创建 Skill                                         │    │
│  └─────────────────────────────────────────────────────────────────┘    │
│                              │                                           │
│                              │ 写入 IPC 请求                              │
│                              ▼                                           │
│                      /workspace/ipc/tasks/create-skill.json              │
└─────────────────────────────────────────────────────────────────────────┘
                               │
                               │ IPC 文件系统
                               ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                          Host (IPC Watcher)                              │
│                                                                          │
│  ┌─────────────────────────────────────────────────────────────────┐    │
│  │ src/ipc.ts - processTaskIpc()                                    │    │
│  │                                                                   │    │
│  │ case 'create_skill':                                              │    │
│  │   1. 验证权限                                                     │    │
│  │   2. 验证参数安全性                                               │    │
│  │   3. 写入 Skill 文件                                              │    │
│  │   4. (可选) 同步到其他 group                                      │    │
│  └─────────────────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────────────────┘
```

### Skill 存储位置

| Scope | 存储位置 | 可见性 |
|-------|---------|--------|
| `group` | `data/sessions/{group}/.claude/skills/{name}/SKILL.md` | 仅当前 group |
| `global` | `container/skills/{name}/SKILL.md` + 同步到所有 group | 所有 group |

---

## 接口定义

### MCP 工具：create_skill

**工具名称**：`create_skill`

**描述**：创建一个新的 Skill，保存执行过程供后续复用。创建后可通过 `/skill-name` 触发。

**参数**：

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `name` | string | 是 | Skill 名称，只能包含小写字母、数字和连字符，如 `weekly-report` |
| `description` | string | 是 | Skill 描述，说明何时触发使用 |
| `content` | string | 是 | Skill 内容，Markdown 格式 |
| `scope` | enum | 否 | `group` 或 `global`，默认 `group` |

**返回**：

```typescript
// 成功
{ content: [{ type: 'text', text: 'Skill "weekly-report" 创建成功！\n\n触发方式: /weekly-report' }] }

// 失败
{ content: [{ type: 'text', text: '错误信息' }], isError: true }
```

### MCP 工具：update_skill

**工具名称**：`update_skill`

**描述**：更新已存在的 Skill 内容。

**参数**：

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `name` | string | 是 | 要更新的 Skill 名称 |
| `content` | string | 否 | 新的 Skill 内容 |
| `description` | string | 否 | 新的描述 |

### MCP 工具：delete_skill

**工具名称**：`delete_skill`

**描述**：删除指定的 Skill。

**参数**：

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `name` | string | 是 | 要删除的 Skill 名称 |
| `scope` | enum | 否 | `group` 或 `global`，默认 `group` |

### IPC 数据格式

**create_skill 请求**：

```json
{
  "type": "create_skill",
  "name": "weekly-report",
  "description": "每周报告生成。当用户说\"生成周报\"时触发。",
  "content": "# 每周报告生成\n\n## 步骤\n1. 收集数据\n2. 生成报告",
  "scope": "group",
  "groupFolder": "feishu-main",
  "isMain": true,
  "timestamp": "2026-03-21T10:00:00.000Z"
}
```

**update_skill 请求**：

```json
{
  "type": "update_skill",
  "name": "weekly-report",
  "content": "# 更新后的内容",
  "scope": "group",
  "groupFolder": "feishu-main",
  "isMain": true,
  "timestamp": "2026-03-21T11:00:00.000Z"
}
```

**delete_skill 请求**：

```json
{
  "type": "delete_skill",
  "name": "weekly-report",
  "scope": "group",
  "groupFolder": "feishu-main",
  "isMain": true,
  "timestamp": "2026-03-21T12:00:00.000Z"
}
```

---

## Skill 文件格式

### 标准格式

```markdown
---
name: weekly-report
description: 每周报告生成。当用户说"生成周报"、"每周报告"时触发。
created_at: 2026-03-21T10:00:00.000Z
created_by: feishu-main
scope: group
---

# 每周报告生成

## 执行步骤

1. **收集数据**
   ```bash
   # 从日志提取数据
   grep "report" /workspace/group/logs/*.log
   ```

2. **生成报告**
   - 使用飞书文档模板
   - 调用 feishu_create_doc 工具

3. **发送通知**
   - 使用 send_message 发送到指定群组

## 注意事项

- 确保飞书凭证已配置
- 报告模板存放在 /workspace/group/templates/

### Frontmatter 字段

| 字段 | 类型 | 说明 |
|------|------|------|
| `name` | string | Skill 名称，用于 `/skill-name` 触发 |
| `description` | string | 描述，用于能力展示和触发识别 |
| `created_at` | ISO 8601 | 创建时间 |
| `created_by` | string | 创建该 Skill 的 group folder |
| `scope` | string | `group` 或 `global` |
| `updated_at` | ISO 8601 | 最后更新时间（可选） |

---

## 脚本文件支持

### 概述

除了 SKILL.md 指令文件，动态 Skill 还可以包含可执行脚本文件，用于封装复杂逻辑、数据处理、API 调用等。

### Skill 目录结构（扩展）

```
data/sessions/{group}/.claude/skills/{skill-name}/
├── SKILL.md           # 必需：Skill 描述和指令
├── scripts/           # 可选：脚本文件目录
│   ├── main.sh        # 主脚本（Bash）
│   ├── helper.py      # 辅助脚本（Python）
│   └── lib/           # 脚本依赖库
│       └── utils.sh
└── data/              # 可选：Skill 数据文件
    └── template.json
```

### 脚本执行架构

```
┌─────────────────────────────────────────────────────────────────────────┐
│                          Docker Container                                │
│                                                                          │
│  /home/node/.claude/skills/{skill-name}/scripts/                        │
│                              │                                           │
│                              │ 脚本文件                                   │
│                              ▼                                           │
│  ┌─────────────────────────────────────────────────────────────────┐    │
│  │ SKILL.md 中的执行指令                                             │    │
│  │                                                                   │    │
│  │ ```bash                                                          │    │
│  │ # 调用 skill 脚本                                                 │    │
│  │ /home/node/.claude/skills/{skill-name}/scripts/main.sh           │    │
│  │ ```                                                              │    │
│  └─────────────────────────────────────────────────────────────────┘    │
│                              │                                           │
│                              │ Bash 执行                                  │
│                              ▼                                           │
│                      脚本运行结果                                        │
└─────────────────────────────────────────────────────────────────────────┘
```

### 接口扩展：create_skill

**新增参数**：

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `scripts` | array | 否 | 脚本文件列表 |

**scripts 数组元素**：

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `filename` | string | 是 | 文件名，如 `main.sh`、`helper.py` |
| `content` | string | 是 | 脚本内容 |
| `executable` | boolean | 否 | 是否设置执行权限，默认 `true` |

**示例请求**：

```json
{
  "type": "create_skill",
  "name": "data-sync",
  "description": "数据同步工具。当用户说\"同步数据\"时触发。",
  "content": "# 数据同步\n\n执行脚本：\n```bash\n/home/node/.claude/skills/data-sync/scripts/sync.sh \"$1\"\n```\n\n参数：\n- `$1`: 数据源名称",
  "scripts": [
    {
      "filename": "sync.sh",
      "content": "#!/bin/bash\nset -e\n\nSOURCE=$1\nSKILL_DIR=\"/home/node/.claude/skills/data-sync\"\n\necho \"Syncing data from $SOURCE...\"\npython3 \"$SKILL_DIR/scripts/fetch.py\" \"$SOURCE\"\necho \"Done!\""
    },
    {
      "filename": "fetch.py",
      "content": "#!/usr/bin/env python3\nimport sys\nimport json\n\nsource = sys.argv[1]\ndata = {\"source\": source, \"status\": \"success\"}\nprint(json.dumps(data))"
    }
  ],
  "scope": "group"
}
```

### MCP 工具更新

```typescript
server.tool(
  'create_skill',
  '创建一个新的 Skill，支持包含可执行脚本文件。',
  {
    name: z.string().regex(/^[a-z0-9-]+$/),
    description: z.string().min(10).max(500),
    content: z.string().min(50).max(65536),
    scope: z.enum(['group', 'global']).optional().default('group'),
    scripts: z.array(z.object({
      filename: z.string().regex(/^[a-zA-Z0-9_-]+\.(sh|py|js|mjs|ts)$/),
      content: z.string().max(102400), // 100KB per script
      executable: z.boolean().optional().default(true),
    })).optional().max(10), // 最多 10 个脚本文件
  },
  async (args) => {
    // ... 参数验证 ...

    const requestId = writeIpcFile(TASKS_DIR, {
      type: 'create_skill',
      name: args.name,
      description: args.description,
      content: args.content,
      scope: args.scope,
      scripts: args.scripts,
      groupFolder,
      isMain,
      timestamp: new Date().toISOString(),
    });

    return {
      content: [{
        type: 'text',
        text: `Skill "${args.name}" 创建成功！\n\n脚本文件: ${args.scripts?.map(s => s.filename).join(', ') || '无'}\n触发方式: /${args.name}`,
      }],
    };
  },
);
```

### IPC 处理更新

```typescript
case 'create_skill': {
  // ... 参数验证和权限检查 ...

  // 创建 Skill 目录
  const skillDir = scope === 'global'
    ? path.join(process.cwd(), 'container', 'skills', skillName)
    : path.join(DATA_DIR, 'sessions', sourceGroup, '.claude', 'skills', skillName);

  fs.mkdirSync(skillDir, { recursive: true });

  // 写入 SKILL.md
  const skillContent = `---
name: ${skillName}
description: ${data.description}
created_at: ${data.timestamp}
created_by: ${sourceGroup}
scope: ${scope}
scripts: ${data.scripts?.map(s => s.filename).join(', ') || 'none'}
---

${data.content}
`;
  fs.writeFileSync(path.join(skillDir, 'SKILL.md'), skillContent);

  // 写入脚本文件
  if (data.scripts && data.scripts.length > 0) {
    const scriptsDir = path.join(skillDir, 'scripts');
    fs.mkdirSync(scriptsDir, { recursive: true });

    for (const script of data.scripts) {
      const scriptPath = path.join(scriptsDir, script.filename);

      // 安全检查：防止路径遍历
      const normalized = path.normalize(script.filename);
      if (normalized !== script.filename || script.filename.includes('..')) {
        logger.warn({ filename: script.filename }, 'Invalid script filename rejected');
        continue;
      }

      // 写入脚本内容
      fs.writeFileSync(scriptPath, script.content, { mode: script.executable !== false ? 0o755 : 0o644 });
      logger.debug({ script: script.filename, skillName }, 'Script file created');
    }
  }

  logger.info({ skillName, scope, sourceGroup, scriptCount: data.scripts?.length || 0 }, 'Skill created via IPC');
  break;
}
```

### 支持的脚本类型

| 扩展名 | 解释器 | 说明 |
|--------|--------|------|
| `.sh` | `/bin/bash` | Bash 脚本 |
| `.py` | `/usr/bin/python3` | Python 脚本 |
| `.js` | `/usr/bin/node` | Node.js 脚本 |
| `.mjs` | `/usr/bin/node` | ES Module 脚本 |
| `.ts` | `tsx` 或 `ts-node` | TypeScript 脚本（需要容器支持） |

### SKILL.md 中调用脚本

在 Skill 内容中，使用绝对路径调用脚本：

```markdown
---
name: data-sync
---

# 数据同步

## 用法

```bash
# 基本用法
/home/node/.claude/skills/data-sync/scripts/sync.sh "source-name"

# 带参数
/home/node/.claude/skills/data-sync/scripts/sync.sh --force
```

## 可用脚本

- `sync.sh` - 主同步脚本
- `fetch.py` - 数据获取脚本
```

### 使用 `allowed-tools` 声明

在 SKILL.md 的 frontmatter 中声明允许的工具：

```yaml
---
name: data-sync
description: 数据同步工具
allowed-tools:
  - Bash(/home/node/.claude/skills/data-sync/scripts/*)
  - Read
  - Write
---
```

### 安全考虑

#### 1. 脚本文件名验证

```typescript
// 只允许安全的文件扩展名
const ALLOWED_EXTENSIONS = ['.sh', '.py', '.js', '.mjs'];
const SCRIPT_FILENAME_PATTERN = /^[a-zA-Z0-9_-]+\.(sh|py|js|mjs|ts)$/;

if (!SCRIPT_FILENAME_PATTERN.test(filename)) {
  throw new Error('脚本文件名无效或扩展名不支持');
}

// 防止路径遍历
if (filename.includes('/') || filename.includes('\\') || filename.includes('..')) {
  throw new Error('脚本文件名不能包含路径分隔符');
}
```

#### 2. 脚本内容检查

```typescript
// 检查危险命令（可选，根据安全策略）
const DANGEROUS_PATTERNS = [
  /rm\s+-rf\s+\//,          // rm -rf /
  />\s*\/dev\/sd/,          // 写入磁盘设备
  /mkfs/,                   // 格式化命令
  /dd\s+if=.*of=\/dev/,     // dd 写入设备
];

for (const pattern of DANGEROUS_PATTERNS) {
  if (pattern.test(content)) {
    throw new Error('脚本包含危险命令，被拒绝');
  }
}
```

#### 3. 脚本大小限制

```typescript
const MAX_SCRIPT_SIZE = 100 * 1024; // 100KB per script
const MAX_TOTAL_SCRIPTS_SIZE = 500 * 1024; // 500KB total

// 检查单个脚本大小
for (const script of scripts) {
  if (script.content.length > MAX_SCRIPT_SIZE) {
    throw new Error(`脚本 ${script.filename} 超过 100KB 限制`);
  }
}

// 检查总大小
const totalSize = scripts.reduce((sum, s) => sum + s.content.length, 0);
if (totalSize > MAX_TOTAL_SCRIPTS_SIZE) {
  throw new Error('脚本总大小超过 500KB 限制');
}
```

#### 4. 脚本执行沙箱

脚本运行在容器内，已有以下隔离：
- 网络命名空间隔离
- 文件系统隔离（只能访问挂载的目录）
- 进程隔离

额外建议：
```typescript
// 在 SKILL.md 中建议使用 set -e 提高脚本可靠性
const scriptTemplate = `#!/bin/bash
set -e  # 遇到错误立即退出
set -u  # 使用未定义变量时报错

# 脚本内容
`;
```

### update_skill 扩展

更新 Skill 时可以同时更新脚本：

```typescript
// update_skill IPC 处理
case 'update_skill': {
  // ... 权限检查 ...

  // 更新 SKILL.md
  if (data.content) {
    fs.writeFileSync(skillPath, updatedContent);
  }

  // 更新脚本文件
  if (data.scripts) {
    const scriptsDir = path.join(skillDir, 'scripts');
    fs.mkdirSync(scriptsDir, { recursive: true });

    // 可选：删除旧脚本，写入新脚本
    // 或者：增量更新
    for (const script of data.scripts) {
      fs.writeFileSync(
        path.join(scriptsDir, script.filename),
        script.content,
        { mode: script.executable !== false ? 0o755 : 0o644 }
      );
    }
  }
  break;
}
```

### delete_skill 扩展

删除 Skill 时同时删除脚本目录：

```typescript
case 'delete_skill': {
  // ... 权限检查 ...

  // 删除整个 skill 目录（包括脚本）
  fs.rmSync(skillDir, { recursive: true, force: true });

  logger.info({ skillName, scope, sourceGroup }, 'Skill deleted via IPC');
  break;
}
```

---

## 权限模型

### 权限矩阵

| 操作 | Main Group | 普通 Group |
|------|-----------|-----------|
| 创建 group skill | ✅ | ✅ |
| 创建 global skill | ✅ | ❌ |
| 更新自己的 group skill | ✅ | ✅ |
| 更新 global skill | ✅ | ❌ |
| 删除自己的 group skill | ✅ | ✅ |
| 删除 global skill | ✅ | ❌ |

### 权限检查逻辑

```typescript
// 创建 global skill
if (scope === 'global' && !isMain) {
  logger.warn({ sourceGroup }, 'Unauthorized global skill creation blocked');
  return;
}

// 更新/删除 skill
const skillCreator = getSkillCreator(skillName);
if (scope === 'global' && !isMain) {
  // 只有 main 可以修改 global skill
  return;
}
if (scope === 'group' && sourceGroup !== skillCreator) {
  // 只有创建者可以修改 group skill
  return;
}
```

---

## 安全考虑

### 1. Skill 名称验证

```typescript
// 只允许小写字母、数字、连字符
const SKILL_NAME_PATTERN = /^[a-z0-9-]+$/;

if (!SKILL_NAME_PATTERN.test(skillName)) {
  throw new Error('Skill 名称只能包含小写字母、数字和连字符');
}

// 防止保留名称冲突
const RESERVED_NAMES = ['capabilities', 'status', 'agent-browser'];
if (RESERVED_NAMES.includes(skillName)) {
  throw new Error('该名称已被系统保留');
}
```

### 2. 路径遍历防护

```typescript
// 防止 ../ 等路径遍历
const normalizedPath = path.normalize(skillName);
if (normalizedPath !== skillName || skillName.includes('..')) {
  throw new Error('无效的 Skill 名称');
}
```

### 3. 内容大小限制

```typescript
const MAX_SKILL_SIZE = 64 * 1024; // 64KB

if (content.length > MAX_SKILL_SIZE) {
  throw new Error('Skill 内容超过 64KB 限制');
}
```

### 4. 数量限制

```typescript
const MAX_SKILLS_PER_GROUP = 50;

const existingSkills = fs.readdirSync(skillsDir);
if (existingSkills.length >= MAX_SKILLS_PER_GROUP) {
  throw new Error('已达到 Skill 数量上限 (50)');
}
```

---

## 实现计划

### 阶段 1：基础功能

1. **MCP 工具** (`container/agent-runner/src/ipc-mcp-stdio.ts`)
   - 添加 `create_skill` 工具
   - 参数验证和错误处理

2. **IPC 处理** (`src/ipc.ts`)
   - 添加 `create_skill` case
   - group scope 支持
   - 安全验证

3. **测试**
   - 创建 group skill
   - 触发使用新创建的 skill

### 阶段 2：扩展功能

1. **Global Skill 支持**
   - 权限检查
   - 同步到所有 group session

2. **管理工具**
   - `update_skill` MCP 工具
   - `delete_skill` MCP 工具

3. **Skill 列表增强**
   - 修改 `/capabilities` 显示动态创建的 skill
   - 添加 `list_skills` MCP 工具

### 阶段 3：增强功能

1. **Skill 版本控制**
   - 保存历史版本
   - 支持回滚

2. **Skill 分享**
   - 导出/导入功能
   - 跨 group 分享

---

## 文件修改清单

| 文件 | 修改内容 |
|------|---------|
| `container/agent-runner/src/ipc-mcp-stdio.ts` | 添加 `create_skill`、`update_skill`、`delete_skill` MCP 工具 |
| `src/ipc.ts` | 添加 IPC 处理逻辑 |
| `src/container-runner.ts` | 可选：添加 skill 同步逻辑 |
| `container/skills/capabilities/SKILL.md` | 更新说明动态 skill 功能 |

---

## 使用示例

### 场景：创建周报生成 Skill

**用户对话**：
> 帮我把这个周报生成流程保存成 skill，以后直接用

**Agent 执行**：
```
使用 create_skill 工具，参数：
{
  "name": "weekly-report",
  "description": "每周报告生成。当用户说\"生成周报\"时触发。",
  "content": "# 每周报告生成\n\n## 步骤\n1. 收集本周数据\n2. 使用飞书模板生成报告\n3. 发送到工作群",
  "scope": "group"
}
```

**返回结果**：
> Skill "weekly-report" 创建成功！
>
> 触发方式: /weekly-report
> 或者直接说 "生成周报"

**后续使用**：
> /weekly-report

Agent 自动执行保存的流程。

### 场景：创建带脚本的数据处理 Skill

**用户对话**：
> 帮我创建一个数据处理 skill，可以批量转换 CSV 文件格式

**Agent 执行**：
```
使用 create_skill 工具，参数：
{
  "name": "csv-converter",
  "description": "CSV 文件格式转换工具。当用户说\"转换CSV\"、\"处理CSV\"时触发。",
  "content": "# CSV 格式转换\n\n## 用法\n\n```bash\n/home/node/.claude/skills/csv-converter/scripts/convert.sh <input.csv> <output.json>\n```\n\n## 参数\n- `input.csv`: 输入的 CSV 文件路径\n- `output.json`: 输出的 JSON 文件路径",
  "scripts": [
    {
      "filename": "convert.sh",
      "content": "#!/bin/bash\nset -e\n\nINPUT=$1\nOUTPUT=$2\n\nif [ -z \"$INPUT\" ] || [ -z \"$OUTPUT\" ]; then\n  echo \"用法: convert.sh <input.csv> <output.json>\"\n  exit 1\nfi\n\npython3 /home/node/.claude/skills/csv-converter/scripts/converter.py \"$INPUT\" \"$OUTPUT\"\necho \"转换完成: $OUTPUT\""
    },
    {
      "filename": "converter.py",
      "content": "#!/usr/bin/env python3\nimport csv\nimport json\nimport sys\n\ndef csv_to_json(csv_path, json_path):\n    with open(csv_path, 'r', encoding='utf-8') as f:\n        reader = csv.DictReader(f)\n        data = list(reader)\n    \n    with open(json_path, 'w', encoding='utf-8') as f:\n        json.dump(data, f, ensure_ascii=False, indent=2)\n\nif __name__ == '__main__':\n    csv_to_json(sys.argv[1], sys.argv[2])"
    }
  ],
  "scope": "group"
}
```

**返回结果**：
> Skill "csv-converter" 创建成功！
>
> 脚本文件: convert.sh, converter.py
> 触发方式: /csv-converter

**后续使用**：
> /csv-converter
> 请帮我转换 /workspace/data.csv 到 output.json

Agent 调用：
```bash
/home/node/.claude/skills/csv-converter/scripts/convert.sh /workspace/data.csv output.json
```

---

## 风险与缓解

| 风险 | 缓解措施 |
|------|---------|
| 恶意 Skill 内容 | 内容大小限制；运行在容器沙箱内 |
| 恶意脚本代码 | 容器隔离；无敏感凭证；文件大小限制 |
| 名称冲突 | 保留名称列表；更新需确认 |
| 权限滥用 | 严格的权限检查；审计日志 |
| 磁盘空间 | Skill 数量限制；脚本总大小限制 |
| 同步延迟 | Global skill 即时同步；下次启动时同步 |
| 脚本执行失败 | 建议使用 `set -e`；错误信息返回用户 |

---

## 附录：代码示例

### create_skill MCP 工具实现

```typescript
// 脚本文件名验证模式
const SCRIPT_FILENAME_PATTERN = /^[a-zA-Z0-9_-]+\.(sh|py|js|mjs|ts)$/;

server.tool(
  'create_skill',
  '创建一个新的 Skill，支持包含可执行脚本文件。',
  {
    name: z.string().regex(
      /^[a-z0-9-]+$/,
      'Skill 名称只能包含小写字母、数字和连字符'
    ).describe('Skill 名称，如 "weekly-report"'),
    description: z.string().min(10).max(500)
      .describe('Skill 描述，说明何时触发使用'),
    content: z.string().min(50).max(65536)
      .describe('Skill 内容，Markdown 格式'),
    scope: z.enum(['group', 'global']).optional().default('group')
      .describe('group=仅当前群组可用，global=所有群组可用'),
    scripts: z.array(z.object({
      filename: z.string().regex(
        SCRIPT_FILENAME_PATTERN,
        '脚本文件名格式无效，支持 .sh, .py, .js, .mjs, .ts'
      ),
      content: z.string().max(102400),
      executable: z.boolean().optional().default(true),
    })).optional().max(10).describe('脚本文件列表（可选）'),
  },
  async (args) => {
    // 检查保留名称
    const reservedNames = ['capabilities', 'status', 'agent-browser'];
    if (reservedNames.includes(args.name)) {
      return {
        content: [{ type: 'text', text: `Skill 名称 "${args.name}" 已被系统保留` }],
        isError: true,
      };
    }

    // 检查 global 权限
    if (args.scope === 'global' && !isMain) {
      return {
        content: [{ type: 'text', text: '只有主群组可以创建全局 Skill' }],
        isError: true,
      };
    }

    // 检查脚本文件大小
    if (args.scripts) {
      const totalSize = args.scripts.reduce((sum, s) => sum + s.content.length, 0);
      if (totalSize > 500 * 1024) {
        return {
          content: [{ type: 'text', text: '脚本总大小超过 500KB 限制' }],
          isError: true,
        };
      }
    }

    const requestId = writeIpcFile(TASKS_DIR, {
      type: 'create_skill',
      name: args.name,
      description: args.description,
      content: args.content,
      scope: args.scope,
      scripts: args.scripts,
      groupFolder,
      isMain,
      timestamp: new Date().toISOString(),
    });

    const scriptInfo = args.scripts?.length
      ? `\n脚本文件: ${args.scripts.map(s => s.filename).join(', ')}`
      : '';

    return {
      content: [{
        type: 'text',
        text: `Skill "${args.name}" 创建请求已提交，即将可用。${scriptInfo}\n\n触发方式: /${args.name}`,
      }],
    };
  },
);
```

### create_skill IPC 处理实现

```typescript
case 'create_skill': {
  const skillName = data.name as string;
  const scope = (data.scope as string) || 'group';

  // 权限检查
  if (scope === 'global' && !isMain) {
    logger.warn({ sourceGroup, skillName }, 'Unauthorized global skill creation blocked');
    break;
  }

  // 安全验证
  if (!/^[a-z0-9-]+$/.test(skillName)) {
    logger.warn({ skillName, sourceGroup }, 'Invalid skill name rejected');
    break;
  }

  // 确定存储路径
  const skillDir = scope === 'global'
    ? path.join(process.cwd(), 'container', 'skills', skillName)
    : path.join(DATA_DIR, 'sessions', sourceGroup, '.claude', 'skills', skillName);

  const skillPath = path.join(skillDir, 'SKILL.md');

  // 检查是否已存在
  if (fs.existsSync(skillPath)) {
    logger.warn({ skillName, sourceGroup }, 'Skill already exists');
    break;
  }

  // 生成 skill 内容
  const scriptList = data.scripts?.map((s: any) => s.filename).join(', ') || 'none';
  const skillContent = `---
name: ${skillName}
description: ${data.description}
created_at: ${data.timestamp}
created_by: ${sourceGroup}
scope: ${scope}
scripts: ${scriptList}
---

${data.content}
`;

  // 写入 SKILL.md
  fs.mkdirSync(skillDir, { recursive: true });
  fs.writeFileSync(skillPath, skillContent);

  // 写入脚本文件
  if (data.scripts && Array.isArray(data.scripts) && data.scripts.length > 0) {
    const scriptsDir = path.join(skillDir, 'scripts');
    fs.mkdirSync(scriptsDir, { recursive: true });

    for (const script of data.scripts) {
      const filename = script.filename as string;
      const content = script.content as string;
      const executable = script.executable !== false;

      // 安全检查：防止路径遍历
      if (filename.includes('/') || filename.includes('\\') || filename.includes('..')) {
        logger.warn({ filename, skillName }, 'Invalid script filename rejected');
        continue;
      }

      const scriptPath = path.join(scriptsDir, filename);
      fs.writeFileSync(scriptPath, content, {
        mode: executable ? 0o755 : 0o644,
      });
      logger.debug({ filename, skillName, executable }, 'Script file created');
    }
  }

  // 如果是 global skill，同步到所有 group
  if (scope === 'global') {
    const sessionsDir = path.join(DATA_DIR, 'sessions');
    try {
      for (const groupFolder of fs.readdirSync(sessionsDir)) {
        const dstDir = path.join(sessionsDir, groupFolder, '.claude', 'skills', skillName);
        fs.mkdirSync(dstDir, { recursive: true });
        // 复制整个目录（包括脚本）
        fs.cpSync(skillDir, dstDir, { recursive: true });
      }
    } catch (err) {
      logger.warn({ err, skillName }, 'Failed to sync global skill to all groups');
    }
  }

  logger.info({ skillName, scope, sourceGroup, scriptCount: data.scripts?.length || 0 }, 'Skill created via IPC');
  break;
}
```