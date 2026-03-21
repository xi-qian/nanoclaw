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
```

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

---

## 风险与缓解

| 风险 | 缓解措施 |
|------|---------|
| 恶意 Skill 内容 | 内容大小限制；不执行任意代码 |
| 名称冲突 | 保留名称列表；更新需确认 |
| 权限滥用 | 严格的权限检查；审计日志 |
| 磁盘空间 | Skill 数量限制；大小限制 |
| 同步延迟 | Global skill 即时同步；下次启动时同步 |

---

## 附录：代码示例

### create_skill MCP 工具实现

```typescript
server.tool(
  'create_skill',
  '创建一个新的 Skill，保存执行过程供后续复用。创建后可通过 /skill-name 触发。',
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
      .describe('group=仅当前群组可用，global=所有群组可用（仅 main 群组可创建）'),
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

    const requestId = writeIpcFile(TASKS_DIR, {
      type: 'create_skill',
      name: args.name,
      description: args.description,
      content: args.content,
      scope: args.scope,
      groupFolder,
      isMain,
      timestamp: new Date().toISOString(),
    });

    return {
      content: [{
        type: 'text',
        text: `Skill "${args.name}" 创建请求已提交，即将可用。\n\n触发方式: /${args.name}`,
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
  const skillContent = `---
name: ${skillName}
description: ${data.description}
created_at: ${data.timestamp}
created_by: ${sourceGroup}
scope: ${scope}
---

${data.content}
`;

  // 写入文件
  fs.mkdirSync(skillDir, { recursive: true });
  fs.writeFileSync(skillPath, skillContent);

  // 如果是 global skill，同步到所有 group
  if (scope === 'global') {
    const sessionsDir = path.join(DATA_DIR, 'sessions');
    try {
      for (const groupFolder of fs.readdirSync(sessionsDir)) {
        const dstDir = path.join(sessionsDir, groupFolder, '.claude', 'skills', skillName);
        fs.mkdirSync(dstDir, { recursive: true });
        fs.copyFileSync(skillPath, path.join(dstDir, 'SKILL.md'));
      }
    } catch (err) {
      logger.warn({ err, skillName }, 'Failed to sync global skill to all groups');
    }
  }

  logger.info({ skillName, scope, sourceGroup }, 'Skill created via IPC');
  break;
}
```