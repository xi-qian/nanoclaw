# Session 上下文持久化设计文档

## 问题分析

### 用户问题

Session 结束后，同一个 group 再次进行对话，是否能看到之前的上下文？

### 当前机制分析

#### 1. Session ID 存储与传递

```
┌─────────────────────────────────────────────────────────────────────────────┐
│ Host (index.ts)                                                             │
│                                                                             │
│  // 从 SQLite 加载 session ID                                               │
│  sessions = getAllSessions();  // { group_folder: session_id }              │
│                                                                             │
│  // 启动容器时传入                                                           │
│  const sessionId = sessions[group.folder];                                  │
│  runContainerAgent({ ..., sessionId, ... });                                │
└─────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    │ stdin: JSON
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│ Container (agent-runner/index.ts)                                           │
│                                                                             │
│  // SDK 恢复会话                                                            │
│  query({                                                                    │
│    options: {                                                               │
│      cwd: '/workspace/group',                                               │
│      resume: sessionId,  // 尝试恢复指定会话                                 │
│    }                                                                        │
│  });                                                                        │
└─────────────────────────────────────────────────────────────────────────────┘
```

#### 2. SDK 会话文件存储位置

```
容器内路径                              Host 映射路径
─────────────────────────────────────────────────────────────────
/workspace/group/.claude/          →   groups/{folder}/.claude/
  └── projects/                            └── projects/
      └── <project-hash>/                      └── <project-hash>/
          ├── sessions-index.json                  ├── sessions-index.json
          └── sessions/                             └── sessions/
              └── {session-id}.jsonl                    └── {session-id}.jsonl
```

**关键发现**：SDK 会话文件存储在工作目录 (`cwd: '/workspace/group'`)，而不是用户目录 (`~/.claude/`)。

#### 3. 当前状态检查

```bash
$ ls groups/feishu-main/
CLAUDE.md  logs/

$ ls groups/feishu-main/.claude/
# 目录不存在！
```

**问题**：会话文件目录不存在，说明：
1. SDK 尚未在此目录创建会话文件，或
2. 容器退出后会话文件未持久化

#### 4. 消息历史 vs Session 上下文

| 数据 | 存储位置 | 作用 | Session 结束后 |
|------|---------|------|---------------|
| **消息历史** | SQLite `messages` 表 | 格式化为 prompt | ✅ 保留，下次对话会包含 |
| **Session ID** | SQLite `sessions` 表 | 标识当前会话 | ✅ 保留 |
| **会话文件 (.jsonl)** | `groups/{folder}/.claude/` | SDK 内部状态 | ❓ 可能丢失 |
| **会话归档** | `groups/{folder}/conversations/` | 压缩后的对话 | ✅ 保留 |

### 核心问题

**当前行为**：
1. 消息历史**保留**在 SQLite，每次对话都会包含历史消息
2. SDK 会话文件**可能丢失**（容器退出后未持久化）
3. Session ID **保留**，但对应的会话文件可能不存在

**结果**：
- 用户可以看到**消息历史**（通过 SQLite）
- 但 Agent 无法恢复**之前会话的完整上下文**（工具调用结果、中间状态等）

---

## 设计目标

### 目标 1：保留消息历史上下文

**当前已实现**：消息历史存储在 SQLite，每次对话都会格式化到 prompt。

**问题**：历史消息过多时，prompt 会超出上下文窗口限制。

### 目标 2：保留 SDK 会话状态

**当前未完全实现**：SDK 会话文件需要持久化存储。

### 目标 3：支持跨会话上下文恢复

用户可以选择：
1. **新会话**：不继承之前的上下文
2. **继续会话**：恢复之前的会话状态

---

## 设计方案

### 方案 A：确保 SDK 会话文件持久化

#### 问题诊断

当前 SDK 工作目录 `/workspace/group` 映射到 `groups/{folder}/`，但 `.claude` 目录不存在。

可能的原因：
1. SDK 使用了不同的会话存储路径
2. 容器退出时目录未同步到 host

#### 解决方案

**选项 A1**：验证并确保会话文件存储

检查 SDK 实际的会话文件存储路径：

```bash
# 在容器运行时检查
docker exec <container> find /workspace/group -name "*.jsonl"
docker exec <container> find /home/node/.claude -name "*.jsonl"
```

**选项 A2**：显式创建会话存储目录

```typescript
// src/container-runner.ts
const groupClaudeDir = path.join(groupDir, '.claude');
fs.mkdirSync(groupClaudeDir, { recursive: true });
fs.mkdirSync(path.join(groupClaudeDir, 'projects'), { recursive: true });
```

---

### 方案 B：上下文摘要机制

当会话压缩或结束时，生成上下文摘要，供下次对话使用。

#### 架构设计

```
┌─────────────────────────────────────────────────────────────────────────────┐
│ 上下文摘要流程                                                               │
│                                                                             │
│  会话结束/压缩                                                               │
│       │                                                                     │
│       ▼                                                                     │
│  ┌─────────────┐                                                            │
│  │ 生成摘要    │  - 关键决策                                                 │
│  │             │  - 重要信息                                                 │
│  │             │  - 待办事项                                                 │
│  └──────┬──────┘                                                            │
│         │                                                                   │
│         ▼                                                                   │
│  ┌─────────────┐                                                            │
│  │ 存储摘要    │  groups/{folder}/context-summary.md                        │
│  └──────┬──────┘                                                            │
│         │                                                                   │
│         ▼                                                                   │
│  ┌─────────────┐                                                            │
│  │ 下次加载    │  追加到 CLAUDE.md 或作为独立提示注入                          │
│  └─────────────┘                                                            │
└─────────────────────────────────────────────────────────────────────────────┘
```

#### 摘要文件格式

```markdown
# 上下文摘要 - 2026-03-21

## 最近对话要点

### 2026-03-20
- 用户创建了飞书多维表格 "客户管理表"
- 配置了字段：客户名称、负责人、状态、签约日期
- 首次添加了 10 条测试数据

### 2026-03-19
- 用户偏好设置：使用中文回复、代码示例用 TypeScript

## 待办事项
- [ ] 完成周报模板的定制
- [ ] 配置定时任务自动同步数据

## 重要配置
- 飞书文档模板存放在 /workspace/group/templates/
- API 端点：https://open.bigmodel.cn/api/anthropic
```

#### 实现 Hook

```typescript
// 扩展 PreCompact Hook
function createPreCompactHook(assistantName?: string): HookCallback {
  return async (input, _toolUseId, _context) => {
    const preCompact = input as PreCompactHookInput;

    // 1. 归档对话（已有）
    archiveConversation(preCompact);

    // 2. 生成上下文摘要（新增）
    const summary = await generateContextSummary(preCompact);

    // 3. 追加到摘要文件
    appendToSummaryFile(summary, '/workspace/group/context-summary.md');
  };
}
```

---

### 方案 C：会话恢复选项

为用户提供显式的会话控制选项。

#### 用户命令

```
@Andy /new-session    # 开始新会话，清空上下文
@Andy /continue       # 继续上次会话
@Andy /summary        # 显示上下文摘要
@Andy /forget X       # 忘记最近 X 条消息
```

#### MCP 工具

```typescript
server.tool('new_session', '开始新的对话会话，不继承之前的上下文。', {}, async () => {
  writeIpcFile(TASKS_DIR, {
    type: 'new_session',
    groupFolder,
    timestamp: new Date().toISOString(),
  });
  return { content: [{ type: 'text', text: '新会话已开始。' }] };
});

server.tool('session_summary', '显示当前会话的上下文摘要。', {}, async () => {
  // 读取并返回摘要文件内容
});
```

#### IPC 处理

```typescript
case 'new_session': {
  // 1. 清除 session ID
  delete sessions[sourceGroup];
  deleteSession(sourceGroup);

  // 2. 标记消息游标
  lastAgentTimestamp[sourceGroup] = new Date().toISOString();
  saveState();

  logger.info({ sourceGroup }, 'New session started');
  break;
}
```

---

### 方案 D：智能上下文窗口管理

#### 问题

消息历史过多时，prompt 会超出上下文窗口限制。

#### 解决方案

```
┌─────────────────────────────────────────────────────────────────────────────┐
│ 上下文窗口管理                                                               │
│                                                                             │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │ 消息历史 (SQLite)                                                    │   │
│  │                                                                      │   │
│  │  [消息1] [消息2] ... [消息100] [消息101] ... [消息200]               │   │
│  │                                                                      │   │
│  │  └──────────────────┘                               └─────────────┘ │   │
│  │        │                                                    │       │   │
│  │        ▼                                                    ▼       │   │
│  │   压缩为摘要                                        最近 N 条        │   │
│  │   (context-summary.md)                             包含在 prompt    │   │
│  │                                                                      │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
│  最终 prompt = 摘要 + 最近 N 条消息 + 当前消息                               │
└─────────────────────────────────────────────────────────────────────────────┘
```

#### 实现

```typescript
// src/index.ts
function formatMessagesWithContextLimit(
  messages: NewMessage[],
  maxMessages: number = 50,
  summaryPath: string,
): string {
  if (messages.length <= maxMessages) {
    return formatMessages(messages, TIMEZONE);
  }

  // 读取摘要
  let summary = '';
  if (fs.existsSync(summaryPath)) {
    summary = fs.readFileSync(summaryPath, 'utf-8');
  }

  // 只取最近 N 条消息
  const recentMessages = messages.slice(-maxMessages);

  // 组合
  return `
<summary>
${summary}
</summary>

<recent_messages>
${formatMessages(recentMessages, TIMEZONE)}
</recent_messages>
`;
}
```

---

## 推荐实现顺序

### 阶段 1：验证会话文件存储（优先级最高）

1. 确认 SDK 会话文件的实际存储位置
2. 确保目录正确挂载和持久化
3. 验证 session ID 恢复机制是否工作

### 阶段 2：上下文摘要机制

1. 扩展 PreCompact Hook 生成摘要
2. 实现 `context-summary.md` 存储
3. 在 prompt 中加载摘要

### 阶段 3：会话控制命令

1. 添加 `/new-session` MCP 工具
2. 添加 `/summary` MCP 工具
3. 更新 SKILL.md 说明用法

### 阶段 4：智能上下文管理

1. 实现消息数量限制
2. 自动压缩旧消息为摘要
3. 动态调整上下文窗口

---

## 文件修改清单

| 文件 | 修改内容 | 阶段 |
|------|---------|------|
| `src/container-runner.ts` | 创建 `.claude` 目录 | 1 |
| `container/agent-runner/src/index.ts` | 扩展 PreCompact Hook | 2 |
| `container/agent-runner/src/ipc-mcp-stdio.ts` | 添加会话控制工具 | 3 |
| `src/ipc.ts` | 处理 new_session IPC | 3 |
| `src/index.ts` | 智能上下文管理 | 4 |
| `src/db.ts` | 添加 deleteSession 函数 | 3 |

---

## 当前回答用户问题

**Q: Session 结束后，同一个 group 再进行对话，能否看到之前的上下文？**

**A: 部分可以。**

| 上下文类型 | 是否保留 | 说明 |
|-----------|---------|------|
| **消息历史** | ✅ 是 | 存储在 SQLite，每次对话都会包含 |
| **用户偏好 (Auto-Memory)** | ✅ 是 | 持久化存储 |
| **CLAUDE.md 知识** | ✅ 是 | 永久存储 |
| **SDK 会话状态** | ❓ 可能不 | 会话文件存储位置需验证 |
| **工具调用结果** | ❌ 否 | 随会话结束丢失 |

**实际效果**：
- Agent 可以看到消息历史，了解"用户之前说了什么"
- 但无法恢复之前会话的完整状态（如正在进行的工作、中间计算结果等）

**如需完整上下文恢复**，需要实现方案 B 或方案 C。