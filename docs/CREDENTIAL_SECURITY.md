# NanoClaw 凭证安全架构

## 概述

本文档描述 NanoClaw 的凭证管理架构，包括设计原则、实现细节、已知安全风险和修复方案。

---

## 设计原则

### 1. 凭证隔离原则

**核心原则**：敏感凭证（API Key、OAuth Token、App Secret 等）不应暴露给运行在容器内的大模型代理。

**原因**：
- 大模型可能执行 `printenv` 或读取 `/proc/self/environ` 获取环境变量
- 对话日志可能记录凭证，导致泄露
- 恶意指令可能窃取凭证

### 2. 代理转发原则

**实现方式**：容器内的工具通过 IPC（进程间通信）将请求转发到 Host，由 Host 使用凭证调用外部 API。

```
┌─────────────────────────────────────────────────────────────────────┐
│                        安全架构                                      │
│                                                                      │
│  容器内工具 ──(IPC 文件)──▶ Host 处理器 ──(真实凭证)──▶ 外部 API     │
│       │                         │                                    │
│   无凭证                      持有凭证                                │
│   无泄露风险                  安全调用                                │
└─────────────────────────────────────────────────────────────────────┘
```

---

## 凭证类型与处理方式

### 1. Anthropic API 凭证

**用途**：调用 Claude API 进行对话

**凭证类型**：
- `ANTHROPIC_API_KEY` - API Key 模式
- `CLAUDE_CODE_OAUTH_TOKEN` / `ANTHROPIC_AUTH_TOKEN` - OAuth 模式

#### 1.1 Credential Proxy 设计

```
┌──────────────────────────────────────────────────────────────────────────┐
│                              Host (NanoClaw)                              │
│                                                                           │
│  ┌────────────────────┐    ┌────────────────────┐                        │
│  │ Credential Proxy   │    │ 真实凭证            │                        │
│  │ :9090              │◀───│ ANTHROPIC_API_KEY   │                        │
│  │                    │    │ CLAUDE_CODE_OAUTH   │                        │
│  │ 注入凭证到请求头    │    └────────────────────┘                        │
│  └────────────────────┘                                                   │
│           ▲                                                               │
│           │ HTTP 请求（无凭证或 placeholder）                             │
└───────────│───────────────────────────────────────────────────────────────┘
            │
┌───────────│───────────────────────────────────────────────────────────────┐
│           ▼                                                               │
│  ┌────────────────────┐    ┌────────────────────┐                        │
│  │ Container          │    │ 环境变量            │                        │
│  │                    │    │ ANTHROPIC_BASE_URL  │                        │
│  │ 设置代理地址        │───▶│ =http://host:9090   │                        │
│  │ 不设置真实凭证      │    │ (placeholder token) │                        │
│  └────────────────────┘    └────────────────────┘                        │
│                                                                           │
│                        Docker Container                                   │
└──────────────────────────────────────────────────────────────────────────┘
```

**Credential Proxy 实现** (`src/credential-proxy.ts`)：

```typescript
// 代理服务器注入真实凭证
if (authMode === 'api-key') {
  // API key 模式：注入 x-api-key
  headers['x-api-key'] = apiKey;
} else {
  // OAuth 模式：替换 Bearer token
  if (headers['authorization']) {
    headers['authorization'] = `Bearer ${oauthToken}`;
  }
}
```

#### 1.2 当前实现问题

**问题位置**：`src/container-runner.ts:282-293`

```typescript
// ⚠️ 当前实现：直接传递凭证给容器（绕过了代理的安全设计）
if (authMode === 'api-key' && secrets.ANTHROPIC_API_KEY) {
  args.push('-e', `ANTHROPIC_API_KEY=${secrets.ANTHROPIC_API_KEY}`);
} else if (authMode === 'oauth') {
  const oauthToken = secrets.CLAUDE_CODE_OAUTH_TOKEN || secrets.ANTHROPIC_AUTH_TOKEN;
  if (oauthToken) {
    args.push('-e', `CLAUDE_CODE_OAUTH_TOKEN=${oauthToken}`);
  }
}
```

**风险**：凭证暴露在容器环境变量中，可被大模型读取。

---

### 2. 飞书 API 凭证

**用途**：调用飞书 API 进行文档、多维表格操作

**凭证类型**：
- `FEISHU_APP_ID` - 应用 ID
- `FEISHU_APP_SECRET` - 应用密钥
- `FEISHU_ACCESS_TOKEN` - 用户访问令牌（OAuth 流程）

#### 2.1 IPC 代理架构

飞书操作通过 IPC 转发，容器内不需要凭证：

```
┌─────────────────────────────────────────────────────────────────────┐
│  Container                                                          │
│  ┌─────────────────────────────┐                                    │
│  │ MCP Tool (feishu_create_doc)│                                    │
│  │                             │                                    │
│  │ 1. 写入 IPC 请求文件         │                                    │
│  │ 2. 等待 IPC 结果文件         │  ❌ 不需要飞书凭证                   │
│  │ 3. 返回结果                  │                                    │
│  └─────────────────────────────┘                                    │
└─────────────────────────────────────────────────────────────────────┘
              │ 写入请求                    读取结果
              ▼                            ▲
         data/ipc/{group}/feishu/requests/
         data/ipc/{group}/feishu/results/
              │                            │
              ▼ 读取请求                    ▲ 写入结果
┌─────────────────────────────────────────────────────────────────────┐
│  Host                                                               │
│  ┌─────────────────────────────┐                                    │
│  │ IPC Watcher (src/ipc.ts)    │                                    │
│  │                             │                                    │
│  │ 1. 读取请求                  │                                    │
│  │ 2. 调用 FeishuChannel        │  ✅ 这里使用飞书凭证                │
│  │ 3. 写入结果                  │                                    │
│  └─────────────────────────────┘                                    │
│                                                                     │
│  ┌─────────────────────────────┐                                    │
│  │ FeishuClient                │                                    │
│  │                             │                                    │
│  │ 持有 appId, appSecret        │                                    │
│  │ 获取 tenant_access_token     │                                    │
│  └─────────────────────────────┘                                    │
└─────────────────────────────────────────────────────────────────────┘
```

#### 2.2 容器内 MCP 工具实现

`container/agent-runner/src/ipc-mcp-stdio.ts`：

```typescript
server.tool('feishu_create_doc', '从 Markdown 创建飞书云文档', {
  title: z.string(),
  markdown: z.string(),
}, async (args) => {
  // 只写入 IPC 文件，不直接调用 API
  const requestId = writeIpcFile(FEISHU_REQUESTS_DIR, {
    type: 'create_doc',
    title: args.title,
    markdown: args.markdown,
    groupFolder,
  });

  // 等待 Host 返回结果
  const result = await waitForFeishuResult(requestId);
  return { content: [{ type: 'text', text: `文档创建成功: ${result.url}` }] };
});
```

#### 2.3 Host 端凭证使用

`src/feishu/client.ts`：

```typescript
export class FeishuClient {
  private credentials: FeishuCredentials;

  constructor(credentials: FeishuCredentials) {
    this.credentials = credentials;
  }

  // 获取 tenant_access_token
  private async getAccessToken(): Promise<string> {
    const response = await this.client.request({
      url: '/open-apis/auth/v3/tenant_access_token/internal',
      method: 'POST',
      data: {
        app_id: this.credentials.appId,
        app_secret: this.credentials.appSecret,
      },
    });
    return response.tenant_access_token;
  }
}
```

#### 2.4 安全修复 (2026-03-21)

**修复前**：凭证被注入到容器环境变量

```typescript
// ⚠️ 不安全的实现（已移除）
const feishuCredentials = loadFeishuCredentials();
if (feishuCredentials) {
  args.push('-e', `FEISHU_APP_ID=${feishuCredentials.appId}`);
  args.push('-e', `FEISHU_APP_SECRET=${feishuCredentials.appSecret}`);
}
```

**修复后**：移除凭证注入

```typescript
// ✅ 安全实现
// NOTE: Feishu credentials are NOT passed to the container.
// All Feishu operations are proxied through IPC to the host, where the
// actual API calls happen. This keeps credentials secure and prevents
// exposure to the agent.
```

---

## 安全状态总结

| 凭证类型 | 设计方式 | 当前实现 | 安全状态 |
|---------|---------|---------|---------|
| **Anthropic API Key** | Credential Proxy 注入 | 直接注入环境变量 | ⚠️ 存在暴露风险 |
| **Anthropic OAuth Token** | Credential Proxy 替换 | 直接注入环境变量 | ⚠️ 存在暴露风险 |
| **飞书 App 凭证** | IPC 代理转发 | ~~直接注入~~ **已移除** | ✅ 安全 |

---

## 建议后续优化

### Anthropic API 凭证安全化

修改 `src/container-runner.ts`，使用 Credential Proxy 而不是直接注入：

```typescript
// 建议实现：通过代理保护凭证
const proxyUrl = `http://${PROXY_BIND_HOST}:${CREDENTIAL_PROXY_PORT}`;

if (authMode === 'api-key') {
  // 设置代理地址
  args.push('-e', `ANTHROPIC_BASE_URL=${proxyUrl}`);
  // 设置 placeholder，代理会替换为真实凭证
  args.push('-e', 'ANTHROPIC_API_KEY=placeholder');
} else {
  // OAuth 模式
  args.push('-e', `ANTHROPIC_BASE_URL=${proxyUrl}`);
  args.push('-e', 'CLAUDE_CODE_OAUTH_TOKEN=placeholder');
}
```

**效果**：
- 大模型读取环境变量只能看到 `placeholder`
- 真实凭证只在 Host 的 Credential Proxy 中
- HTTP 请求经过代理时自动注入凭证

---

## 凭证存储位置

| 凭证 | 存储位置 | 访问权限 |
|-----|---------|---------|
| Anthropic API Key | `.env` 文件 | Host only |
| Anthropic OAuth Token | `.env` 文件 | Host only |
| 飞书 App 凭证 | `data/auth/feishu/credentials.json` | Host only |
| 飞书 Access Token | `data/auth/feishu/credentials.json` | Host only |

**安全措施**：
- `.env` 文件不挂载到容器
- `data/auth/` 目录不挂载到容器
- `src/mount-security.ts` 中定义了敏感目录黑名单

---

## 相关文件

| 文件 | 用途 |
|-----|------|
| `src/credential-proxy.ts` | HTTP 代理，注入 Anthropic API 凭证 |
| `src/container-runner.ts` | 容器启动配置，凭证注入逻辑 |
| `src/ipc.ts` | IPC 请求处理，飞书操作转发 |
| `src/feishu/client.ts` | 飞书 API 客户端，使用凭证调用 API |
| `src/mount-security.ts` | 挂载安全检查，敏感目录保护 |
| `container/agent-runner/src/ipc-mcp-stdio.ts` | 容器内 MCP 工具，通过 IPC 转发请求 |