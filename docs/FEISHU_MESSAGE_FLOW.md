# 飞书消息执行路径与记忆机制分析

## 概述

本文档分析飞书用户发送一条消息后，NanoClaw 的完整执行路径，重点关注短期记忆和长期记忆如何影响结果。

---

## 执行路径总览

```
┌─────────────────────────────────────────────────────────────────────────────┐
│ 1. 飞书服务器                                                                │
│    用户发送消息 → 飞书 WebSocket 推送事件                                     │
└─────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│ 2. Host - FeishuChannel (src/channels/feishu.ts)                            │
│    WebSocket 接收事件 → 解析消息 → 转换为 NewMessage 格式                     │
│    调用 onMessage(jid, newMessage)                                          │
└─────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│ 3. Host - index.ts 消息循环                                                  │
│    - 存储消息到 SQLite (短期记忆持久化)                                       │
│    - 检查触发条件 (@Andy 或 main group)                                      │
│    - 格式化历史消息为 prompt                                                  │
│    - 调用 runContainerAgent()                                                │
└─────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│ 4. Host - container-runner.ts 容器准备                                       │
│    - 构建 Docker 挂载配置                                                    │
│    - 复制 Skills 到 session 目录                                             │
│    - 挂载目录：                                                              │
│      • /workspace/group → groups/{folder}/ (长期记忆 CLAUDE.md)              │
│      • /home/node/.claude → data/sessions/{folder}/.claude/ (会话记忆)       │
│      • /workspace/ipc → data/ipc/{folder}/ (IPC 通信)                       │
│    - 启动容器                                                                │
└─────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│ 5. Container - agent-runner (container/agent-runner/src/index.ts)           │
│    - 读取 stdin 获取 ContainerInput (prompt, sessionId, 等)                  │
│    - 调用 Claude Agent SDK query()                                           │
│    - SDK 自动加载记忆：                                                      │
│      • /workspace/group/CLAUDE.md (长期记忆)                                 │
│      • /home/node/.claude/ 下的会话文件 (短期记忆)                           │
│      • Skills (指令扩展)                                                     │
│    - 流式输出结果 → stdout                                                   │
└─────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│ 6. Host - 结果处理                                                           │
│    - 解析容器输出                                                             │
│    - 发送回复到飞书                                                           │
│    - 更新 session ID (短期记忆标识)                                          │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 记忆系统详解

### 一、短期记忆 (Session Memory)

#### 1. 定义

短期记忆是指**当前对话会话中的上下文**，包括：
- 对话历史消息
- 当前会话 ID
- Agent 的中间状态

#### 2. 存储位置

| 数据 | 存储位置 | 说明 |
|------|---------|------|
| **消息历史** | `store/nanoclaw.db` (SQLite) | 持久化的消息记录 |
| **Session ID** | `store/nanoclaw.db` → sessions 表 | 标识当前会话 |
| **会话状态文件** | `data/sessions/{folder}/.claude/` | SDK 管理的会话状态 |

#### 3. 消息历史流程

```
用户消息 → FeishuChannel.handleMessageEvent()
                  │
                  ▼
         storeMessage() → SQLite messages 表
                  │
                  ▼
         getMessagesSince() → 获取上次 Agent 响应后的所有消息
                  │
                  ▼
         formatMessages() → 格式化为 XML prompt
                  │
                  ▼
         <messages>
           <message sender="User" timestamp="Mar 21, 9:00 AM">你好</message>
           <message sender="User" timestamp="Mar 21, 9:05 AM">@Andy 帮我...</message>
         </messages>
```

**关键代码** (`src/index.ts:227-247`):

```typescript
const sinceTimestamp = lastAgentTimestamp[chatJid] || '';
const missedMessages = getMessagesSince(
  chatJid,
  sinceTimestamp,
  ASSISTANT_NAME,
);

// 格式化为 prompt
const prompt = formatMessages(missedMessages, TIMEZONE);
```

#### 4. Session ID 管理

```typescript
// src/index.ts:369-375
const wrappedOnOutput = async (output: ContainerOutput) => {
  if (output.newSessionId) {
    sessions[group.folder] = output.newSessionId;
    setSession(group.folder, output.newSessionId);  // 持久化到 SQLite
  }
  await onOutput(output);
};
```

**Session ID 的作用**：
- Claude Agent SDK 使用它来恢复会话上下文
- 同一 session ID 的多次请求共享对话历史
- 容器重启后可通过 session ID 恢复状态

#### 5. SDK 会话状态

容器内的 SDK 会在 `~/.claude/` 目录下维护会话状态：

```
/home/node/.claude/
├── settings.json           # SDK 设置
├── projects/               # 项目级会话数据
│   └── workspace-group/    # 对应 /workspace/group
│       ├── sessions-index.json  # 会话索引
│       └── sessions/            # 会话文件
│           └── {session-id}.jsonl
└── skills/                 # 可用的 Skills
```

#### 6. 短期记忆的生命周期

```
┌──────────────┐     ┌──────────────┐     ┌──────────────┐
│ 新会话开始    │ ──▶ │ 消息累积     │ ──▶ │ 会话结束     │
│ (无 sessionId)│     │ (session ID  │     │ (容器退出)   │
│              │     │  持续更新)    │     │              │
└──────────────┘     └──────────────┘     └──────────────┘
        │                    │                    │
        ▼                    ▼                    ▼
  首次创建 session     历史消息 + 新消息      会话归档到
  写入 SQLite          合并为 prompt         conversations/
```

---

### 二、长期记忆 (Persistent Memory)

#### 1. 定义

长期记忆是指**跨会话持久化的知识和配置**，包括：
- 群组信息 (CLAUDE.md)
- 全局配置
- Skills
- 用户偏好 (SDK auto-memory)

#### 2. 存储位置

| 记忆类型 | 存储位置 | 挂载路径 | 读写权限 |
|---------|---------|---------|---------|
| **群组记忆** | `groups/{folder}/CLAUDE.md` | `/workspace/group/CLAUDE.md` | 读写 |
| **全局记忆** | `groups/global/CLAUDE.md` | `/workspace/global/CLAUDE.md` | 只读 (非 main) |
| **Skills** | `container/skills/` | `/home/node/.claude/skills/` | 读写 |
| **用户偏好** | `data/sessions/{folder}/.claude/memory/` | `~/.claude/memory/` | 读写 |

#### 3. CLAUDE.md 加载机制

```typescript
// container/agent-runner/src/index.ts:369-374
// 加载全局 CLAUDE.md 作为系统上下文
const globalClaudeMdPath = '/workspace/global/CLAUDE.md';
let globalClaudeMd: string | undefined;
if (!containerInput.isMain && fs.existsSync(globalClaudeMdPath)) {
  globalClaudeMd = fs.readFileSync(globalClaudeMdPath, 'utf-8');
}

// 传递给 SDK
query({
  options: {
    cwd: '/workspace/group',  // SDK 自动加载此目录的 CLAUDE.md
    systemPrompt: globalClaudeMd
      ? { type: 'preset', preset: 'claude_code', append: globalClaudeMd }
      : undefined,
  }
});
```

**加载顺序**：
1. SDK 自动加载 `/workspace/group/CLAUDE.md` (工作目录)
2. SDK 追加 `/workspace/global/CLAUDE.md` (非 main group)
3. SDK 加载 `~/.claude/memory/` 下的用户偏好

#### 4. CLAUDE.md 示例

```markdown
# 飞书主群组

这是一个飞书单聊群组，配置为 NanoClaw 的主群组。

## 群组信息
- JID: feishu:oc_93dac2e93467e6c7eff34210368cbdc0
- 类型: 飞书单聊 (p2p)
- 设置: 主群组 (所有消息都会触发 AI 回复)

## 自定义 API 配置
- API 地址: https://open.bigmodel.cn/api/anthropic
- 模型: claude-3-5-sonnet-20241022
```

#### 5. Skills 作为指令记忆

Skills 是**可执行的知识扩展**，存储在：
- `container/skills/{skill-name}/SKILL.md` (源文件)
- `data/sessions/{folder}/.claude/skills/{skill-name}/SKILL.md` (副本)

**加载流程**：

```typescript
// src/container-runner.ts:150-160
// 启动时复制 Skills 到 session 目录
const skillsSrc = path.join(process.cwd(), 'container', 'skills');
const skillsDst = path.join(groupSessionsDir, 'skills');
if (fs.existsSync(skillsSrc)) {
  for (const skillDir of fs.readdirSync(skillsSrc)) {
    const srcDir = path.join(skillsSrc, skillDir);
    const dstDir = path.join(skillsDst, skillDir);
    fs.cpSync(srcDir, dstDir, { recursive: true });
  }
}
```

#### 6. SDK Auto-Memory

Claude Code SDK 支持**自动记忆用户偏好**：

```typescript
// src/container-runner.ts:139-141
env: {
  CLAUDE_CODE_DISABLE_AUTO_MEMORY: '0',  // 启用自动记忆
}
```

**存储位置**：`~/.claude/memory/*.md`

**格式示例**：
```markdown
---
name: user-preferences
description: User preferences for this session
---

User prefers:
- Concise responses
- Code examples in TypeScript
- Links to documentation
```

---

## 记忆如何影响结果

### 影响链路图

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           记忆输入层                                         │
│                                                                             │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐        │
│  │ 消息历史     │  │ CLAUDE.md   │  │ Skills      │  │ Auto-Memory │        │
│  │ (短期)      │  │ (长期)      │  │ (指令扩展)   │  │ (用户偏好)   │        │
│  └──────┬──────┘  └──────┬──────┘  └──────┬──────┘  └──────┬──────┘        │
│         │                │                │                │               │
│         │ <messages>     │ 系统提示       │ /skill 触发    │ 偏好注入       │
│         │ 格式           │ 追加           │                │               │
│         ▼                ▼                ▼                ▼               │
└─────────────────────────────────────────────────────────────────────────────┘
                                  │
                                  ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                           Agent 推理层                                       │
│                                                                             │
│  Claude Agent SDK 组合所有记忆：                                             │
│  1. 系统提示 = preset + CLAUDE.md + global/CLAUDE.md                        │
│  2. 用户消息 = <messages> 格式化的历史                                        │
│  3. 可用工具 = Bash, Read, Write, Skills, MCP...                            │
│  4. 用户偏好 = Auto-Memory 注入                                              │
│                                                                             │
│  → 生成响应                                                                  │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 示例分析

**用户消息**：`@Andy 帮我创建一个飞书文档，内容是本周周报`

**记忆组合**：

| 记忆类型 | 内容 | 影响 |
|---------|------|------|
| **消息历史** | 之前用户问过"周报模板在哪" | Agent 知道要用之前的模板 |
| **CLAUDE.md** | "主群组，所有消息触发 AI" | 无需再次验证权限 |
| **feishu-doc Skill** | 如何调用飞书 API | Agent 知道使用 `feishu_create_doc` 工具 |
| **Auto-Memory** | "用户喜欢简洁的回复" | Agent 返回简短确认而非冗长说明 |

---

## 记忆修改方法

### 1. 修改短期记忆

#### 删除消息历史

```sql
-- 连接 SQLite
sqlite3 store/nanoclaw.db

-- 删除特定群组的消息
DELETE FROM messages WHERE chat_jid = 'feishu:oc_xxx';

-- 删除特定时间之前的消息
DELETE FROM messages WHERE timestamp < '2026-03-01';
```

#### 重置 Session ID

```sql
-- 删除 session，下次对话将创建新会话
DELETE FROM sessions WHERE group_folder = 'feishu-main';
```

#### 清理会话状态文件

```bash
# 删除 SDK 维护的会话状态
rm -rf data/sessions/feishu-main/.claude/projects/
```

### 2. 修改长期记忆

#### 修改群组 CLAUDE.md

```bash
# 直接编辑文件
vim groups/feishu-main/CLAUDE.md

# 添加自定义指令
cat >> groups/feishu-main/CLAUDE.md << 'EOF'

## 自定义行为
- 回复时总是使用中文
- 代码示例使用 TypeScript
- 重要信息用粗体标注
EOF
```

#### 修改全局 CLAUDE.md

```bash
# 创建或编辑全局记忆（对所有非 main 群组生效）
vim groups/global/CLAUDE.md
```

#### 添加新 Skill

```bash
# 创建 Skill 目录
mkdir -p container/skills/my-skill

# 创建 SKILL.md
cat > container/skills/my-skill/SKILL.md << 'EOF'
---
name: my-skill
description: 自定义技能描述
---

# 技能说明
执行步骤...
EOF

# 重启服务使 Skill 生效
systemctl --user restart nanoclaw-fork
```

### 3. 通过对话修改记忆

#### 使用 /remember 命令（如果配置）

```
用户: @Andy 记住：以后回复都用中文
Agent: 已记住您的偏好。
```

SDK 的 Auto-Memory 功能会自动保存此偏好。

#### 通过对话建立上下文

```
用户: @Andy 这是我的项目，地址是 /workspace/my-project
Agent: 好的，我记住了项目位置。

# 后续对话中，Agent 会记住这个项目路径
用户: @Andy 帮我看一下项目的结构
Agent: (使用 /workspace/my-project 作为上下文)
```

### 4. 通过 MCP 工具修改

Agent 可以使用 MCP 工具修改记忆：

```typescript
// Agent 调用 Write 工具
Write({
  file_path: "/workspace/group/CLAUDE.md",
  content: "更新后的群组记忆..."
})
```

---

## 记忆生命周期管理

### 会话归档

当会话被压缩 (compact) 时，SDK 会触发 `PreCompact` hook：

```typescript
// container/agent-runner/src/index.ts:145-185
function createPreCompactHook(assistantName?: string): HookCallback {
  return async (input, _toolUseId, _context) => {
    // 归档到 conversations/ 目录
    const conversationsDir = '/workspace/group/conversations';
    fs.mkdirSync(conversationsDir, { recursive: true });

    const date = new Date().toISOString().split('T')[0];
    const filename = `${date}-${summary}.md`;
    const filePath = path.join(conversationsDir, filename);

    fs.writeFileSync(filePath, markdown);
    log(`Archived conversation to ${filePath}`);
  };
}
```

### 记忆清理策略

```bash
# 清理旧对话归档（超过 30 天）
find groups/*/conversations -name "*.md" -mtime +30 -delete

# 清理旧日志
find groups/*/logs -name "*.log" -mtime +7 -delete

# 清理旧会话状态
find data/sessions/*/.claude/projects -type f -mtime +30 -delete
```

---

## 记忆系统架构图

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              Host (NanoClaw)                                 │
│                                                                             │
│  ┌─────────────┐     ┌─────────────┐     ┌─────────────┐                   │
│  │ SQLite      │     │ 文件系统     │     │ IPC Watcher │                   │
│  │ nanoclaw.db │     │ groups/     │     │             │                   │
│  │             │     │ data/       │     │             │                   │
│  └──────┬──────┘     └──────┬──────┘     └──────┬──────┘                   │
│         │                   │                   │                          │
│         │ 消息历史          │ CLAUDE.md         │ IPC 请求                 │
│         │ sessions          │ Skills            │                          │
│         ▼                   ▼                   ▼                          │
└─────────────────────────────────────────────────────────────────────────────┘
          │                   │                   │
          │ 挂载              │ 挂载              │ 挂载
          ▼                   ▼                   ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                           Docker Container                                   │
│                                                                             │
│  /workspace/group/          /home/node/.claude/     /workspace/ipc/         │
│  ├── CLAUDE.md              ├── settings.json       ├── messages/          │
│  ├── conversations/         ├── skills/             ├── tasks/             │
│  │   └── 2026-03-21-*.md    │   └── feishu-doc/     └── input/             │
│  └── logs/                  ├── memory/                                    │
│      └── container-*.log    │   └── user-prefs.md                          │
│                             └── projects/                                   │
│                                 └── sessions/                               │
│                                     └── {id}.jsonl                          │
│                                                                             │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │ Claude Agent SDK                                                     │   │
│  │                                                                      │   │
│  │  记忆加载：                                                          │   │
│  │  1. CLAUDE.md → 系统提示                                            │   │
│  │  2. sessions/*.jsonl → 对话历史                                     │   │
│  │  3. skills/ → 可用工具                                              │   │
│  │  4. memory/ → 用户偏好                                              │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 关键配置

### SDK 记忆相关环境变量

```typescript
// src/container-runner.ts:131-142
env: {
  // 启用 Agent Teams（子代理编排）
  CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS: '1',

  // 从额外挂载目录加载 CLAUDE.md
  CLAUDE_CODE_ADDITIONAL_DIRECTORIES_CLAUDE_MD: '1',

  // 启用自动记忆（用户偏好持久化）
  CLAUDE_CODE_DISABLE_AUTO_MEMORY: '0',
}
```

### 容器工作目录

```typescript
// container/agent-runner/src/index.ts:395
query({
  options: {
    cwd: '/workspace/group',  // SDK 在此目录查找 CLAUDE.md
  }
});
```

---

## 总结

| 记忆类型 | 作用 | 存储位置 | 修改方式 |
|---------|------|---------|---------|
| **短期记忆** | 当前对话上下文 | SQLite + SDK 会话文件 | SQL / 删除文件 |
| **长期记忆** | 跨会话知识 | CLAUDE.md | 编辑文件 |
| **指令记忆** | 可执行知识扩展 | Skills | 编辑 / 创建 Skill |
| **用户偏好** | 个人设置 | Auto-Memory | 对话中说明 / 编辑文件 |