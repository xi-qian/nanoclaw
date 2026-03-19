# NanoClaw 飞书集成设计文档 v2.0

## 1. 项目概述

### 1.1 目标
在 NanoClaw 中添加飞书（Lark/Feishu）支持，包括：
- **消息通讯**：接收和发送飞书消息（私聊、群聊）
- **文档操作**：创建、读取、更新飞书云文档
- **企业功能**：日历、任务、多维表格等（可选）

### 1.2 参考实现
本文档基于 `openclaw-lark` 项目的实现，该项目由飞书开放平台官方维护，提供了完整的飞书集成功能。

### 1.3 设计决策说明
**问题**：飞书文档工具应该用什么方式实现？

**分析**：
- ❌ 独立的 MCP 服务器 - 过度复杂，需要额外的进程管理
- ❌ 容器内直接调用 API - 安全风险，凭证暴露给容器
- ✅ **扩展现有 nanoclaw MCP** - 复用 IPC 机制，凭证安全，架构一致

**最终方案**：在现有的 `nanoclaw` MCP 服务器（`container/agent-runner/src/ipc-mcp-stdio.ts`）中添加飞书工具，通过 IPC 与 Host 进程的飞书 Channel 通信。

---

## 2. 架构设计原则

### 2.1 NanoClaw 核心原则（必须遵循）

1. **小而可理解**：代码应该简洁明了，易于维护
2. **容器隔离安全**：所有代码执行在容器中，保证安全
3. **为单个用户构建**：不需要多租户支持
4. **定制化 = 代码修改**：最小化配置，最大化代码清晰度
5. **AI 原生**：利用 Claude Code 的能力来简化和自动化
6. **Skills 胜过功能**：作为 skill 提供，而非核心功能

### 2.2 设计权衡

| 方面 | NanoClaw 方式 | OpenClaw-Lark 方式 | 选择 |
|------|--------------|-------------------|------|
| **架构复杂度** | 简单 Channel 接口 | 复杂 Plugin 系统 | ✅ NanoClaw |
| **消息路由** | SQLite 轮询 | 事件驱动 | ✅ NanoClaw（保持一致性） |
| **工具系统** | 扩展 nanoclaw MCP（IPC） | 独立 MCP 服务器 | ✅ NanoClaw（IPC） |
| **认证方式** | 简化 OAuth UAT | 完整 OAuth 流程 | ✅ 简化版 |
| **文档操作** | IPC 工具（凭证在 Host） | 混合 MCP/OAPI | ✅ IPC 工具 |

---

## 3. 系统架构

### 3.1 整体架构

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         NanoClaw Host Process                            │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                           │
│  ┌────────────────┐    ┌──────────────┐    ┌────────────────────────┐   │
│  │ Feishu Channel │───▶│   SQLite     │◀───│    Message Loop        │   │
│  │  (WebSocket +  │    │ messages.db  │    │    (Polling)           │   │
│  │   HTTP API)    │    └──────────────┘    └────────────┬───────────┘   │
│  │                │                                     │                │
│  │ • 消息收发      │                  ┌──────────────────┘                │
│  │ • 文档 API      │                  ▼                                  │
│  │ • 事件处理      │    ┌──────────────────────────────────────┐        │
│  └────────────────┘    │     Router & Message Processing      │        │
│                         └──────────────────┬───────────────────┘        │
│                                            │                            │
│  ┌─────────────────────────────────────────┼────────────────────────┐  │
│  │          IPC Watcher (src/ipc.ts)       │                        │  │
│  │  • 监听 /workspace/ipc/feishu/         │                        │  │
│  │  • 调用 Feishu Channel 执行 API        │                        │  │
│  │  • 返回结果给容器                      │                        │  │
│  └─────────────────────────────────────────┼────────────────────────┘  │
│                                            │                            │
└────────────────────────────────────────────┼────────────────────────────┘
                                             │ IPC Files
                                             ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                    Container (Linux VM)                                  │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                           │
│  ┌──────────────────────────────────────────────────────────────────┐   │
│  │              Agent (Claude Agent SDK)                            │   │
│  │                                                                   │   │
│  │  可用工具：                                                       │   │
│  │  • Bash, Read, Write, WebSearch, ... (内置)                       │   │
│  │  • schedule_task, send_message (nanoclaw MCP - IPC)             │   │
│  │  • feishu_fetch_doc, feishu_create_doc (nanoclaw MCP - IPC)     │   │
│  │                                                                   │   │
│  └───────────────────────────────────────────────────────────────────┘   │
│          ▲                                                                 │
│          │ stdio                                                          │
│          │                                                                 │
│  ┌───────┴──────────────────────────────────────────────────────────┐    │
│  │     nanoclaw MCP Server (ipc-mcp-stdio.ts)                       │    │
│  │     • schedule_task, send_message, ... (现有)                     │    │
│  │     • feishu_fetch_doc, feishu_create_doc, ... (新增)            │    │
│  └───────────────────────────────────────────────────────────────────┘    │
│                                                                           │
└───────────────────────────────────────────────────────────────────────────┘
```

### 3.2 核心组件

#### 3.2.1 Feishu Channel (`src/channels/feishu.ts`)

实现 `Channel` 接口：

```typescript
interface Channel {
  name: string;
  connect(): Promise<void>;
  sendMessage(jid: string, text: string): Promise<void>;
  isConnected(): boolean;
  ownsJid(jid: string): boolean;
  disconnect(): Promise<void>;
}
```

**职责**：
- 建立 WebSocket 连接接收飞书事件
- 存储消息到 SQLite
- 发送消息到飞书
- **执行飞书 API 调用**（文档操作等）
- 管理连接状态

#### 3.2.2 扩展的 nanoclaw MCP Server (`container/agent-runner/src/ipc-mcp-stdio.ts`)

在现有的 `nanoclaw` MCP 服务器中添加飞书工具：

**现有工具**：
- `schedule_task` - 调度任务
- `send_message` - 发送消息

**新增工具**：
- `feishu_fetch_doc` - 获取文档内容
- `feishu_create_doc` - 创建文档
- `feishu_update_doc` - 更新文档
- `feishu_search_docs` - 搜索文档
- `feishu_send_card` - 发送交互式卡片

#### 3.2.3 IPC Watcher (`src/ipc.ts`)

扩展现有的 IPC Watcher，处理飞书工具的 IPC 请求：

**现有 IPC 类型**：
- `message` - 发送消息
- `task` - 调度任务

**新增 IPC 类型**：
- `feishu_fetch_doc` - 文档获取请求
- `feishu_create_doc` - 文档创建请求
- `feishu_update_doc` - 文档更新请求
- 等等...

---

## 4. 实现方案

### 4.1 阶段一：基础消息通道（MVP）

#### 4.1.1 技术选型

| 组件 | 技术选择 |
|------|---------|
| **飞书 SDK** | `@larksuiteoapi/node-sdk`（与 openclaw-lark 一致） |
| **连接方式** | WebSocket（接收事件） + HTTP API（发送消息） |
| **认证方式** | 简化的 OAuth UAT（User Access Token）流程 |
| **存储** | SQLite（复用现有 messages.db） |
| **工具通信** | IPC 文件（复用现有机制） |

#### 4.1.2 文件结构

```
nanoclaw/
├── src/
│   ├── channels/
│   │   ├── registry.ts           # 现有
│   │   ├── index.ts              # 需要添加 import './feishu.js'
│   │   └── feishu.ts             # 新增：飞书通道实现
│   ├── ipc.ts                    # 修改：添加飞书 IPC 处理
│   ├── router.ts                 # 修改：添加飞书消息格式化
│   └── feishu/                   # 新增：飞书客户端层
│       ├── client.ts             # Lark SDK 客户端封装
│       ├── auth.ts               # 认证处理
│       ├── events.ts             # 事件处理
│       ├── docs.ts               # 文档 API 封装
│       └── types.ts              # 类型定义
├── container/
│   └── agent-runner/
│       └── src/
│           └── ipc-mcp-stdio.ts  # 修改：添加飞书工具
├── store/
│   └── auth/
│       └── feishu/               # 飞书认证状态存储
│           └── credentials.json
└── package.json                  # 添加依赖
```

#### 4.1.3 核心代码结构

**1. 飞书客户端封装 (`src/feishu/client.ts`)**

```typescript
import * as Lark from '@larksuiteoapi/node-sdk';

export class FeishuClient {
  private client: Lark.Client;
  private wsClient: Lark.WSClient | null = null;

  constructor(appId: string, appSecret: string) {
    this.client = new Lark.Client({
      appId,
      appSecret,
      domain: Lark.Domain.Feishu, // 或 Lark.Domain.Lark
    });
  }

  // 建立连接
  async connect(): Promise<void> {
    // WebSocket 连接
  }

  // 发送消息
  async sendMessage(chatId: string, content: string): Promise<void> {
    // HTTP API 调用
  }

  // 文档操作
  async fetchDoc(docId: string, offset?: number, limit?: number): Promise<string> {
    // 调用文档 API
  }

  async createDoc(title: string, markdown: string): Promise<string> {
    // 创建文档
  }

  async updateDoc(docId: string, markdown: string): Promise<void> {
    // 更新文档
  }

  // 关闭连接
  async disconnect(): Promise<void> {
    // 清理资源
  }

  isConnected(): boolean {
    return this.wsClient !== null;
  }
}
```

**2. Channel 实现 (`src/channels/feishu.ts`)**

```typescript
import { registerChannel, ChannelOpts, type Channel } from './registry.js';
import { OnInboundMessage, OnChatMetadata, NewMessage } from '../types.js';
import { existsSync, readFileSync } from 'fs';
import { FeishuClient } from '../feishu/client.js';

const AUTH_PATH = 'store/auth/feishu/credentials.json';

export class FeishuChannel implements Channel {
  name = 'feishu';
  private client: FeishuClient;
  private onMessage: OnInboundMessage;
  private onChatMetadata: OnChatMetadata;

  constructor(opts: ChannelOpts, credentials: any) {
    this.client = new FeishuClient(
      credentials.appId,
      credentials.appSecret
    );
    this.onMessage = opts.onMessage;
    this.onChatMetadata = opts.onChatMetadata;
  }

  async connect(): Promise<void> {
    await this.client.connect();
    // 设置事件监听器，接收消息并存储到 SQLite
  }

  async sendMessage(jid: string, text: string): Promise<void> {
    // 去掉 "feishu:" 前缀
    const chatId = jid.replace(/^feishu:/, '');
    await this.client.sendMessage(chatId, text);
  }

  isConnected(): boolean {
    return this.client.isConnected();
  }

  ownsJid(jid: string): boolean {
    return jid.startsWith('feishu:');
  }

  async disconnect(): Promise<void> {
    await this.client.disconnect();
  }

  // 文档操作方法（供 Host IPC 调用）
  async fetchDoc(docId: string, offset?: number, limit?: number): Promise<any> {
    return await this.client.fetchDoc(docId, offset, limit);
  }

  async createDoc(title: string, markdown: string, options?: any): Promise<any> {
    return await this.client.createDoc(title, markdown, options);
  }

  async updateDoc(docId: string, markdown: string): Promise<any> {
    return await this.client.updateDoc(docId, markdown);
  }

  async searchDocs(query: string): Promise<any> {
    return await this.client.searchDocs(query);
  }
}

// 自注册
registerChannel('feishu', (opts: ChannelOpts) => {
  if (!existsSync(AUTH_PATH)) return null;

  const credentials = JSON.parse(readFileSync(AUTH_PATH, 'utf-8'));
  return new FeishuChannel(opts, credentials);
});
```

**3. 扩展 nanoclaw MCP (`container/agent-runner/src/ipc-mcp-stdio.ts`)**

```typescript
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

// ... 现有代码 ...

const FEISHU_IPC_DIR = '/workspace/ipc/feishu';

// ==================== 飞书文档工具 ====================

server.tool(
  'feishu_fetch_doc',
  '获取飞书云文档内容，返回 Markdown 格式',
  {
    doc_id: z.string().describe('文档 ID 或 URL（自动解析）'),
    offset: z.number().optional().describe('字符偏移量（用于分页，可选）'),
    limit: z.number().optional().describe('返回最大字符数（可选）'),
  },
  async (args) => {
    const requestId = writeIpcFile(FEISHU_IPC_DIR, {
      type: 'fetch_doc',
      doc_id: args.doc_id,
      offset: args.offset,
      limit: args.limit,
      groupFolder,
      timestamp: new Date().toISOString(),
    });

    // 等待 Host 返回结果（轮询 /workspace/ipc/feishu/results/）
    const result = await waitForResult(requestId);

    return {
      content: [{ type: 'text', text: result.content || result.error }],
    };
  },
);

server.tool(
  'feishu_create_doc',
  '从 Markdown 创建飞书云文档',
  {
    title: z.string().describe('文档标题'),
    markdown: z.string().describe('Markdown 内容'),
    folder_token: z.string().optional().describe('父文件夹 token（可选）'),
    wiki_node: z.string().optional().describe('知识库节点 token（可选）'),
  },
  async (args) => {
    const requestId = writeIpcFile(FEISHU_IPC_DIR, {
      type: 'create_doc',
      title: args.title,
      markdown: args.markdown,
      folder_token: args.folder_token,
      wiki_node: args.wiki_node,
      groupFolder,
      timestamp: new Date().toISOString(),
    });

    const result = await waitForResult(requestId);

    return {
      content: [{ type: 'text', text: result.content || result.error }],
    };
  },
);

server.tool(
  'feishu_update_doc',
  '更新飞书云文档内容',
  {
    doc_id: z.string().describe('文档 ID'),
    markdown: z.string().describe('新的 Markdown 内容'),
  },
  async (args) => {
    const requestId = writeIpcFile(FEISHU_IPC_DIR, {
      type: 'update_doc',
      doc_id: args.doc_id,
      markdown: args.markdown,
      groupFolder,
      timestamp: new Date().toISOString(),
    });

    const result = await waitForResult(requestId);

    return {
      content: [{ type: 'text', text: result.content || result.error }],
    };
  },
);

server.tool(
  'feishu_search_docs',
  '搜索飞书云文档',
  {
    query: z.string().describe('搜索关键词'),
    limit: z.number().optional().describe('返回结果数量（默认 10）'),
  },
  async (args) => {
    const requestId = writeIpcFile(FEISHU_IPC_DIR, {
      type: 'search_docs',
      query: args.query,
      limit: args.limit || 10,
      groupFolder,
      timestamp: new Date().toISOString(),
    });

    const result = await waitForResult(requestId);

    return {
      content: [{ type: 'text', text: result.content || result.error }],
    };
  },
);

// ==================== 辅助函数 ====================

function writeIpcFile(dir: string, data: any): string {
  // ... 复用现有实现 ...
}

async function waitForResult(requestId: string): Promise<any> {
  // 轮询 /workspace/ipc/feishu/results/{requestId}.json
  // 超时时间：30 秒
}
```

**4. IPC Watcher 扩展 (`src/ipc.ts`)**

```typescript
// ... 现有代码 ...

// 添加飞书 IPC 目录监听
const FEISHU_IPC_DIR = path.join(DATA_DIR, 'ipc', 'feishu');
const FEISHU_RESULTS_DIR = path.join(FEISHU_IPC_DIR, 'results');

// 监听飞书请求
fs.watch(FEISHU_IPC_DIR, async (eventType, filename) => {
  if (!filename?.endsWith('.json')) return;

  const filePath = path.join(FEISHU_IPC_DIR, filename);
  const request = JSON.parse(fs.readFileSync(filePath, 'utf-8'));

  try {
    // 找到飞书 channel
    const feishuChannel = channels.find((c) => c.name === 'feishu');
    if (!feishuChannel) {
      throw new Error('Feishu channel not found');
    }

    let result;

    // 根据请求类型调用相应方法
    switch (request.type) {
      case 'fetch_doc':
        result = await feishuChannel.fetchDoc(request.doc_id, request.offset, request.limit);
        break;
      case 'create_doc':
        result = await feishuChannel.createDoc(request.title, request.markdown, {
          folder_token: request.folder_token,
          wiki_node: request.wiki_node,
        });
        break;
      case 'update_doc':
        result = await feishuChannel.updateDoc(request.doc_id, request.markdown);
        break;
      case 'search_docs':
        result = await feishuChannel.searchDocs(request.query, request.limit);
        break;
      default:
        throw new Error(`Unknown request type: ${request.type}`);
    }

    // 写入结果文件
    const resultFile = path.join(FEISHU_RESULTS_DIR, `${filename}`);
    fs.writeFileSync(resultFile, JSON.stringify({ success: true, ...result }));

  } catch (error) {
    // 写入错误结果
    const resultFile = path.join(FEISHU_RESULTS_DIR, `${filename}`);
    fs.writeFileSync(resultFile, JSON.stringify({ success: false, error: error.message }));
  }

  // 删除请求文件
  fs.unlinkSync(filePath);
});
```

### 4.2 阶段二：文档操作增强

在 MVP 的基础上，根据需要添加更多工具：

```typescript
// 交互式卡片
server.tool(
  'feishu_send_card',
  '发送飞书交互式卡片（支持按钮、进度更新等）',
  {
    chat_id: z.string().describe('聊天 ID'),
    card_content: z.object({}).describe('卡片配置对象'),
  },
  async (args) => {
    // ... 实现 ...
  },
);

// 富文本消息
server.tool(
  'feishu_send_rich_text',
  '发送飞书富文本消息（支持链接、图片、表情等）',
  {
    chat_id: z.string().describe('聊天 ID'),
    elements: z.array(z.any()).describe('富文本元素数组'),
  },
  async (args) => {
    // ... 实现 ...
  },
);
```

### 4.3 阶段三：企业功能（可选）

根据需求添加：

```typescript
// 日历工具
server.tool('feishu_create_event', '创建日历事件', { ... });
server.tool('feishu_list_events', '列出日历事件', { ... });

// 任务工具
server.tool('feishu_create_task', '创建任务', { ... });
server.tool('feishu_update_task', '更新任务', { ... });

// 多维表格工具
server.tool('feishu_query_bitable', '查询多维表格', { ... });
server.tool('feishu_update_record', '更新记录', { ... });
```

---

## 5. 认证流程设计

### 5.1 简化的 OAuth UAT 流程

参考 openclaw-lark 的 `device-flow` 实现，但简化为：

```
1. 用户运行 /add-feishu skill
2. Skill 引导用户：
   - 创建飞书应用（或使用企业自建应用）
   - 获取 App ID 和 App Secret
   - 配置重定向 URL 和权限
3. Skill 启动设备授权流程：
   - 获取 device_code 和 user_code
   - 显示用户验证 URL
   - 用户在浏览器中完成授权
4. Skill 轮询获取 access_token
5. 凭证保存到 store/auth/feishu/credentials.json
```

### 5.2 凭证存储格式

```json
{
  "appId": "cli_xxxxxxxxx",
  "appSecret": "xxxxxxxxxxxxxxxx",
  "accessToken": "xxxxxxxxxxxxxxxx",
  "refreshToken": "xxxxxxxxxxxxxxxx",
  "expiresAt": "2024-02-01T00:00:00Z",
  "tenantKey": "xxxxxxxxxxxxxxxx"
}
```

---

## 6. 消息格式转换

### 6.1 飞书事件 → NanoClaw 消息

```typescript
interface FeishuEvent {
  type: string;
  event: {
    operator?: {
      open_id: string;
    };
    message?: {
      message_id: string;
      chat_id: string;
      chat_type: string;
      content: string; // JSON 字符串
      create_time: string;
    };
  };
}

function convertToNanoClawMessage(
  event: FeishuEvent,
  chatId: string
): NewMessage {
  const content = JSON.parse(event.event.message.content);
  return {
    id: event.event.message.message_id,
    chat_jid: `feishu:${chatId}`,
    sender: event.event.operator.open_id,
    sender_name: '', // 需要额外查询
    content: content.text || '',
    timestamp: event.event.message.create_time,
    is_from_me: false,
  };
}
```

### 6.2 JID 格式

```
格式：feishu:{chat_id}
示例：
- feishu:oc_xxxxxxxxx (私聊)
- feishu:cn_xxxxxxxxx (群聊)
```

---

## 7. IPC 工具详细设计

### 7.1 工具命名

所有飞书工具使用 `feishu_` 前缀，避免与其他工具冲突。

### 7.2 异步处理流程

```
1. Agent 调用工具（如 feishu_fetch_doc）
2. MCP 服务器写请求文件：/workspace/ipc/feishu/{requestId}.json
3. Host IPC Watcher 检测到文件
4. Host 调用 Feishu Channel 执行 API
5. Host 写结果文件：/workspace/ipc/feishu/results/{requestId}.json
6. MCP 服务器轮询检测结果文件
7. 返回结果给 Agent
```

### 7.3 超时和错误处理

- 请求超时：30 秒
- 结果文件保留时间：5 分钟（之后自动清理）
- 错误格式：`{ success: false, error: "错误消息" }`

---

## 8. 与 NanoClaw 核心集成

### 8.1 修改点

| 文件 | 修改内容 | 修改类型 |
|------|---------|---------|
| `src/channels/index.ts` | 添加 `import './feishu.js';` | 新增 |
| `src/ipc.ts` | 添加飞书 IPC 处理逻辑 | 修改 |
| `src/router.ts` | 添加飞书消息格式化 | 修改 |
| `container/agent-runner/src/ipc-mcp-stdio.ts` | 添加飞书工具 | 修改 |
| `package.json` | 添加 `@larksuiteoapi/node-sdk` | 修改 |

### 8.2 依赖添加

```json
{
  "dependencies": {
    "@larksuiteoapi/node-sdk": "^1.59.0"
  }
}
```

---

## 9. Skill 实现

### 9.1 `/add-feishu` Skill

创建 `.claude/skills/add-feishu/SKILL.md`：

```markdown
# Add Feishu Channel to NanoClaw

安装飞书（Lark/Feishu）通道支持。

## 步骤

1. **准备飞书应用**
   - 访问飞书开放平台 https://open.feishu.cn/
   - 创建企业自建应用
   - 获取 App ID 和 App Secret
   - 配置权限：
     - im:message（获取与发送消息）
     - doc:document（文档操作）
     - （可选）其他权限

2. **添加代码**
   - 创建 src/channels/feishu.ts
   - 创建 src/feishu/ 目录和相关文件
   - 修改 src/ipc.ts（添加飞书 IPC 处理）
   - 修改 container/agent-runner/src/ipc-mcp-stdio.ts（添加工具）
   - 更新 package.json
   - 更新 src/channels/index.ts

3. **配置认证**
   - 创建 store/auth/feishu/credentials.json
   - 填入 App ID 和 App Secret

4. **编译并重启**
   - npm run build
   - npm start

## 验证

- 在飞书中向机器人发送 "@Andy 测试消息"
- 检查日志确认连接成功
- 尝试文档操作："@Andy 创建一个测试文档"

## 工具说明

Agent 可用的飞书工具：
- `feishu_fetch_doc` - 获取文档内容
- `feishu_create_doc` - 创建文档
- `feishu_update_doc` - 更新文档
- `feishu_search_docs` - 搜索文档
```

---

## 10. 测试计划

### 10.1 单元测试

- [ ] FeishuClient 连接和断开
- [ ] 消息格式转换
- [ ] JID 解析和匹配
- [ ] IPC 工具输入验证
- [ ] 文档 API 调用

### 10.2 集成测试

- [ ] 接收飞书消息 → SQLite → Message Loop
- [ ] Agent 响应 → Router → 飞书发送
- [ ] Agent 调用 feishu_fetch_doc → IPC → Host → API → 返回结果
- [ ] 文档创建和读取流程
- [ ] 权限验证

### 10.3 端到端测试

- [ ] 私聊对话
- [ ] 群聊对话
- [ ] 文档协作："@Andy 帮我总结这篇文档"
- [ ] 文档创建："@Andy 创建一个会议纪要模板"
- [ ] 定时任务触发文档操作

---

## 11. 安全考虑

### 11.1 凭证安全

- ✅ 凭证存储在 `store/auth/feishu/`（不提交到 git）
- ✅ 容器隔离：凭证只在 Host 进程中，不传给容器
- ✅ IPC 工具通过文件通信，凭证不暴露给容器

### 11.2 消息安全

- ✅ 只处理已注册的群/私聊
- ✅ 触发词机制防止误触发
- ✅ 容器隔离限制文件系统访问

### 11.3 IPC 安全

- ✅ IPC 文件权限限制（只有容器和 Host 进程可读写）
- ✅ 请求超时机制防止僵尸请求
- ✅ 结果文件自动清理

### 11.4 权限最小化

建议的飞书应用权限：
- `im:message`（消息收发）
- `im:message:send_as_bot`（以机器人身份发送）
- `doc:document`（文档操作）
- `doc:document:readonly`（文档读取）
- （可选）日历、任务等权限

---

## 12. 性能优化

### 12.1 连接管理

- WebSocket 长连接接收事件
- HTTP 短连接发送消息
- 断线自动重连（指数退避）

### 12.2 消息缓存

- 用户名映射缓存（减少 API 调用）
- 群信息缓存
- 消息去重（基于 message_id）

### 12.3 IPC 优化

- 请求文件批量处理
- 结果文件异步写入
- 轮询间隔优化（避免频繁文件系统访问）

### 12.4 并发控制

- 复用 NanoClaw 的 GroupQueue 机制
- 每个 Group 独立队列
- 全局并发限制

---

## 13. 与 OpenClaw-Lark 的差异总结

| 方面 | OpenClaw-Lark | NanoClaw 飞书（新方案） |
|------|--------------|----------------------|
| **架构** | Plugin 系统 | Channel + IPC |
| **消息路由** | 事件驱动 | SQLite 轮询 |
| **工具实现** | 独立 MCP 服务器 | 扩展 nanoclaw MCP（IPC） |
| **凭证安全** | Host 进程 | Host 进程 ✅ |
| **认证** | 完整 OAuth | 简化 OAuth |
| **配置** | 复杂配置 | 环境变量 + JSON |
| **多账户** | 支持 | 不支持 |
| **代码量** | ~15,000 行 | ~2,500 行（预计） |
| **依赖** | openclaw/sdk | 仅飞书 SDK |
| **进程数** | 2+ (Host + MCP) | 1 (Host) ✅ |
| **架构复杂度** | 高 | 低 ✅ |

**关键改进**：
- ✅ 无需额外的 MCP 服务器进程
- ✅ 完全复用现有的 IPC 机制
- ✅ 凭证安全性不变（仍在 Host）
- ✅ 代码更简洁，更易维护

---

## 14. 实施路线图

### Phase 1: 基础通道（2-3 天）
- [ ] 实现 FeishuChannel 类
- [ ] WebSocket 事件接收
- [ ] 消息存储到 SQLite
- [ ] 基础消息发送
- [ ] 更新 src/router.ts

### Phase 2: IPC 工具（2-3 天）
- [ ] 扩展 ipc-mcp-stdio.ts（添加 4 个基础工具）
- [ ] 修改 src/ipc.ts（添加飞书 IPC 处理）
- [ ] 实现异步结果返回机制
- [ ] 测试 IPC 流程

### Phase 3: 文档 API（1-2 天）
- [ ] 实现 FeishuClient 文档方法
- [ ] 测试文档创建、读取、更新
- [ ] 测试搜索功能

### Phase 4: 认证 Skill（1-2 天）
- [ ] 实现 /add-feishu skill
- [ ] OAuth UAT 流程
- [ ] 凭证存储和刷新

### Phase 5: 测试和优化（1-2 天）
- [ ] 单元测试
- [ ] 集成测试
- [ ] 性能优化
- [ ] 错误处理完善

### Phase 6: 可选功能（按需）
- [ ] 交互式卡片
- [ ] 富文本消息
- [ ] 日历集成
- [ ] 任务管理
- [ ] 多维表格

**总计：7-12 天（MVP：5-7 天）**

---

## 15. 参考资料

### 15.1 代码仓库
- **NanoClaw**: `/home/yeats/claude_project/nanoclaw-fork/nanoclaw`
- **OpenClaw-Lark**: `/home/yeats/claude_project/nanoclaw-fork/openclaw-lark`

### 15.2 文档
- [NanoClaw SPEC](./SPEC.md)
- [NanoClaw REQUIREMENTS](./REQUIREMENTS.md)
- [飞书开放平台文档](https://open.larksuite.com/document/)
- [@larksuiteoapi/node-sdk](https://www.npmjs.com/package/@larksuiteoapi/node-sdk)

### 15.3 关键文件
- `src/channels/registry.ts` - Channel 注册机制
- `src/types.ts` - Channel 接口定义
- `src/ipc.ts` - IPC Watcher 实现
- `src/router.ts` - 消息路由
- `container/agent-runner/src/ipc-mcp-stdio.ts` - nanoclaw MCP 服务器
- `openclaw-lark/src/core/lark-client.ts` - Lark SDK 使用示例
- `openclaw-lark/src/tools/mcp/doc/` - 文档操作参考

---

## 16. 附录：工具清单

### 16.1 MVP 工具（优先级：高）

| 工具名 | 描述 | 参数 | 返回值 |
|--------|------|------|--------|
| `feishu_fetch_doc` | 获取文档内容 | doc_id, offset?, limit? | { title, content, has_more } |
| `feishu_create_doc` | 创建文档 | title, markdown, folder_token?, wiki_node? | { doc_id, url } |
| `feishu_update_doc` | 更新文档 | doc_id, markdown | { success } |
| `feishu_search_docs` | 搜索文档 | query, limit? | [{ title, doc_id, snippet }, ...] |

### 16.2 扩展工具（优先级：中）

| 工具名 | 描述 | 参数 | 返回值 |
|--------|------|------|--------|
| `feishu_send_card` | 发送交互式卡片 | chat_id, card_content | { message_id } |
| `feishu_send_rich_text` | 发送富文本 | chat_id, elements | { message_id } |
| `feishu_get_message_history` | 获取消息历史 | chat_id, limit, before_id? | [{ id, content, sender }, ...] |

### 16.3 企业功能工具（优先级：低）

| 工具名 | 描述 | 类别 |
|--------|------|------|
| `feishu_create_event` | 创建日历事件 | 日历 |
| `feishu_list_events` | 列出日历事件 | 日历 |
| `feishu_create_task` | 创建任务 | 任务 |
| `feishu_update_task` | 更新任务 | 任务 |
| `feishu_query_bitable` | 查询多维表格 | 多维表格 |
| `feishu_update_record` | 更新记录 | 多维表格 |

---

## 17. 常见问题

### Q1: 为什么不使用独立的 MCP 服务器？

**A**: 独立的 MCP 服务器会：
- 增加进程管理复杂度
- 需要额外的配置和启动逻辑
- 与现有架构不一致

通过扩展现有的 `nanoclaw` MCP，我们可以：
- 复用成熟的 IPC 机制
- 保持架构简洁一致
- 凭证安全（仍在 Host 进程）

### Q2: IPC 文件通信会不会太慢？

**A**: 对于飞书 API 调用场景：
- API 本身耗时通常在几十到几百毫秒
- IPC 文件读写耗时 < 1ms
- 总体性能影响可忽略

如果未来需要更高性能，可以考虑：
- 使用 Unix Domain Socket
- 使用共享内存
- 但目前文件 IPC 已经足够

### Q3: 容器内的 Agent 如何知道飞书工具可用？

**A**:
- MCP 服务器会自动向 Agent 宣告可用工具
- Agent 可以通过 `list_tools` 命令查看
- 工具描述会出现在 Agent 的系统提示中

### Q4: 如果飞书 API 调用失败怎么办？

**A**:
- Host 捕获异常
- 写入错误结果文件：`{ success: false, error: "..." }`
- MCP 服务器返回错误信息给 Agent
- Agent 可以根据错误信息决定是否重试

---

*文档版本：2.0*
*创建日期：2026-03-19*
*最后更新：2026-03-19*
*作者：基于 openclaw-lark 和 nanoclaw 分析*
*主要变更：将独立的 MCP 服务器改为扩展 nanoclaw MCP（IPC 方式）*
