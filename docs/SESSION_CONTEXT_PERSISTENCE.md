# Session 上下文持久化设计文档

## 问题分析

### 用户问题

Session 结束后，同一个 group 再次进行对话，是否能看到之前的上下文？

### 实际问题反馈

用户反馈：Agent 表示无法看到之前的历史消息。

---

## 日志分析

### 日志 1：Session ID 指向不存在的会话

```
=== Container Run Log ===
Timestamp: 2026-03-21T04:17:28.158Z

=== Input ===
{
  "prompt": "<context timezone=\"Asia/Shanghai\" />\n<messages>\n    <message sender=\"User\" timestamp=\"Invalid Date\">上面这个表格的员工信息有几条</message>\n</messages>",
  "sessionId": "1af2a611-45ec-4843-9427-d799c39fc93d",
  ...
}

=== Stderr ===
[agent-runner] Agent error: Claude Code returned an error result: No conversation found with session ID: 1af2a611-45ec-4843-9427-d799c39fc93d
```

**问题发现**：
1. **消息历史只有 1 条**：prompt 里只包含最新的 1 条消息
2. **Session ID 无效**：SDK 找不到对应的会话文件

---

## 根本原因分析

### 原因 1：Session 文件目录权限问题

```
问题：projects 目录以 root 用户创建
导致：容器内 node 用户 (uid 1000) 无法写入

$ ls -la data/sessions/feishu-main/.claude/
drwxr-xr-x  2 root root  4096 Mar 21 10:16 projects  ← 权限问题
```

### 原因 2：Session 文件目录位置错误

```
之前错误的位置：
  groups/{folder}/.claude/projects/  ← 错误

正确的位置：
  data/sessions/{folder}/.claude/projects/  ← 正确
```

### 原因 3：Session 不存在时无限重试

```
流程：
1. Host 发送 sessionId 到容器
2. SDK 报错 "No conversation found"
3. 容器返回错误
4. Host 回滚消息游标
5. 下次重试仍用同一个无效 sessionId
6. 死循环
```

---

## Session 机制详解

### SDK Session 存储结构

```
~/.claude/projects/
  <project-hash>/              ← hash of /workspace/group
    sessions/
      <session-id>.jsonl       ← Session transcript (JSONL 格式)
    sessions-index.json        ← Session 索引
  settings.json
```

### NanoClaw 文件映射

| Host 路径 | 容器内路径 | 说明 |
|----------|-----------|------|
| `data/sessions/{folder}/.claude/` | `/home/node/.claude/` | SDK 配置和会话 |
| `data/sessions/{folder}/.claude/projects/` | `/home/node/.claude/projects/` | Session transcript 存储 |
| `data/sessions/{folder}/.claude/settings.json` | `/home/node/.claude/settings.json` | SDK 设置 |
| `data/sessions/{folder}/.claude/skills/` | `/home/node/.claude/skills/` | 技能文件 |

### SQLite Session 存储

```sql
sessions 表:
  group_folder: "feishu-main"
  session_id: "uuid-of-session"
```

---

## 服务重启后的 Session 恢复流程

```
┌─────────────────────────────────────────────────────────────────────┐
│                     服务重启后的 Session 恢复                         │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  1. Host 启动                                                       │
│     └─ 从 SQLite sessions 表读取 session_id                         │
│                                                                     │
│  2. 用户发消息                                                       │
│     └─ Host 发送 sessionId 到容器                                   │
│                                                                     │
│  3. 容器内 SDK                                                       │
│     └─ query({ resume: sessionId })                                 │
│     └─ 从 ~/.claude/projects/<hash>/sessions/<id>.jsonl 加载历史     │
│     └─ Agent 获得完整对话上下文                                      │
│                                                                     │
│  4. Session 文件不存在时（降级处理）                                  │
│     └─ SDK 报错 "No conversation found"                             │
│     └─ 容器捕获错误，清除 sessionId                                  │
│     └─ 以新 session 重试                                            │
│     └─ 返回新的 session_id 给 Host 保存                             │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

---

## 实现状态

**状态：已完成 ✅**

### 阶段 1：SDK 会话文件持久化 ✅

**修改文件**：`src/container-runner.ts`

**关键修复**：

1. **正确的目录位置**：在 `data/sessions/{folder}/.claude/projects/` 创建目录
2. **正确的权限**：设置 `mode: 0o777` 确保 node 用户可写

```typescript
// 创建 SDK session transcript 存储目录
const groupSessionsDir = path.join(DATA_DIR, 'sessions', group.folder, '.claude');
fs.mkdirSync(groupSessionsDir, { recursive: true });

// 关键：创建 projects 目录，权限必须为 777
// SDK 会在这里创建 <project-hash>/sessions/*.jsonl 文件
const projectsDir = path.join(groupSessionsDir, 'projects');
fs.mkdirSync(projectsDir, { recursive: true, mode: 0o777 });
```

### 阶段 2：Session 错误降级处理 ✅

**修改文件**：`container/agent-runner/src/index.ts`

**处理逻辑**：当 session 不存在时，自动创建新 session 而不是报错退出

```typescript
try {
  const queryResult = await runQuery(prompt, sessionId, ...);
  // ...
} catch (queryError) {
  const errorMsg = queryError instanceof Error ? queryError.message : String(queryError);
  // Session 不存在时，清除并重试
  if (errorMsg.toLowerCase().includes('session') && errorMsg.toLowerCase().includes('not found')) {
    log(`Session not found, clearing and retrying as new session`);
    sessionId = undefined;
    resumeAt = undefined;
    continue; // 重试，这次作为新 session
  }
  throw queryError;
}
```

**删除的错误机制**：

之前在 Host 端 (`src/index.ts`) 有一个错误的 workaround：

```typescript
// 已删除 - 这是错误的处理方式
if (output.error && output.error.toLowerCase().includes('session')) {
  deleteSession(group.folder);  // ❌ 不应该在 Host 端处理
}
```

**原因**：
- Session 是客户端机制，与模型 API 无关
- 应该在容器端处理，而不是 Host 端清除

### 阶段 3：历史消息上下文 ⏸️ 暂时禁用

**状态**：代码已实现但禁用，待 SDK Session 验证后决定是否保留

**原因**：
- SDK Session 机制已可恢复完整对话历史（包括 Agent 的回复）
- 历史消息功能仅在新会话时提供"群聊背景"
- 需要先验证 SDK Session 是否稳定工作

**如果 SDK Session 工作正常**：
- Session 内：SDK 自动维护对话历史
- Session 结束后：通过 `resume` 恢复完整上下文
- 历史消息功能可能不再需要

**修改文件**：
- `src/config.ts` - 添加 `CONTEXT_HISTORY_LIMIT` 配置
- `src/db.ts` - 添加 `getMessagesBefore` 函数
- `src/index.ts` - 新会话时包含历史消息 **[已注释]**
- `src/router.ts` - 添加 `formatMessagesWithHistory` 函数

### 阶段 4：会话控制命令 ✅

**修改文件**：
- `container/agent-runner/src/ipc-mcp-stdio.ts` - `new_session` MCP 工具
- `src/ipc.ts` - 处理 `new_session` IPC

用户可以通过 `new_session` 工具主动清除上下文开始新会话。

---

## 文件修改清单

| 文件 | 修改内容 | 状态 |
|------|---------|------|
| `src/container-runner.ts` | 创建 `projects` 目录，权限 777 | ✅ |
| `container/agent-runner/src/index.ts` | Session 不存在时降级处理 | ✅ |
| `src/index.ts` | 删除错误的 session 清除逻辑 | ✅ |
| `src/config.ts` | 添加 `CONTEXT_HISTORY_LIMIT` 配置 | ⏸️ 禁用 |
| `src/db.ts` | 添加 `getMessagesBefore` 函数 | ⏸️ 禁用 |
| `src/router.ts` | 添加 `formatMessagesWithHistory` | ⏸️ 禁用 |
| `container/agent-runner/src/ipc-mcp-stdio.ts` | `new_session` MCP 工具 | ✅ |
| `src/ipc.ts` | 处理 `new_session` IPC | ✅ |

---

## 预期效果

### 修改前

```
用户: 你可以看到这个群里之前的消息吗？
Agent: 不能，我无法看到这个群组之前的消息历史。
       每次与您的对话都是一个新的会话...
```

### 修改后

```
用户: 你可以看到这个群里之前的消息吗？
Agent: 可以。我们之前讨论过多维表格的创建。
       我记得您创建了一个"客户管理"表格，并添加了测试数据。
       请问有什么我可以继续帮您的？
```

---

## Session 生命周期

### 1. Session 创建/恢复

| 场景 | 触发点 | 行为 |
|------|--------|------|
| **首次对话** | SDK 自动 | 生成新 session_id，存入 SQLite + .jsonl 文件 |
| **后续对话** | Host 读取 SQLite | 传 sessionId 给容器，SDK 从 .jsonl 恢复上下文 |
| **服务重启** | Host 启动时加载 | 从 SQLite 恢复 sessionId，继续之前的会话 |

### 2. Session 重建（新 Session）

| 触发方式 | 位置 | 代码路径 |
|----------|------|----------|
| **自动降级** | 容器端 | SDK 报错 "No conversation found" 时，清除 sessionId 并重试 |
| **手动触发** | MCP 工具 | 用户调用 `new_session` 工具 |

### 3. 手动触发方式

**方式：通过 Agent 调用 MCP 工具**

```
用户: 请开始一个新的对话
Agent: [调用 new_session 工具]
       "New session started. Previous conversation context has been cleared."
```

### 4. 流程图

```
┌─────────────────────────────────────────────────────────────────────┐
│                        Session 生命周期                              │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  ┌──────────────┐                                                   │
│  │ 用户发消息    │                                                   │
│  └──────┬───────┘                                                   │
│         │                                                           │
│         ▼                                                           │
│  ┌──────────────┐     有 sessionId      ┌──────────────┐           │
│  │ SQLite 有    │─────────────────────▶│ 容器尝试恢复  │           │
│  │ sessionId?   │                       │ resume: id   │           │
│  └──────┬───────┘                       └──────┬───────┘           │
│         │ 无                                   │                   │
│         ▼                                      ▼                   │
│  ┌──────────────┐     成功            ┌──────────────┐           │
│  │ 容器创建     │◀────────────────────│ .jsonl 存在? │           │
│  │ 新 session   │                     └──────┬───────┘           │
│  └──────┬───────┘                            │ 不存在             │
│         │                                    ▼                   │
│         │                           ┌──────────────┐           │
│         │                           │ 降级处理：    │           │
│         │                           │ sessionId=   │           │
│         │                           │ undefined    │           │
│         │                           │ 重试新会话   │           │
│         │                           └──────┬───────┘           │
│         │                                  │                   │
│         └──────────────────────────────────┘                   │
│                       │                                           │
│                       ▼                                           │
│              ┌──────────────┐                                    │
│              │ 返回新        │                                    │
│              │ sessionId    │                                    │
│              │ 保存到 SQLite│                                    │
│              └──────────────┘                                    │
│                                                                     │
│  ══════════════════════════════════════════════════════════════════│
│                                                                     │
│  手动触发 new_session:                                              │
│  ┌──────────────┐                                                   │
│  │ 用户调用      │                                                   │
│  │ new_session  │                                                   │
│  └──────┬───────┘                                                   │
│         │                                                           │
│         ▼                                                           │
│  ┌──────────────┐                                                   │
│  │ 删除 SQLite  │                                                   │
│  │ sessionId    │                                                   │
│  └──────┬───────┘                                                   │
│         │                                                           │
│         ▼                                                           │
│  ┌──────────────┐                                                   │
│  │ 清除内存中    │                                                   │
│  │ sessions[]   │                                                   │
│  └──────────────┘                                                   │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

---

## 参考资料

- [Claude Code Session Storage](https://claude-world.com/tutorials/s16-session-storage/) - JSONL transcripts 与 UUID parent-child chains
- SDK Session 文件格式：每行一个 JSON 对象，包含 type、sessionId、timestamp 等字段