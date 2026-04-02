# 飞书发送消息给指定联系人 - 设计文档

## 1. 功能概述

实现给飞书指定联系人发送消息的功能：
- 支持 `open_id` 和 `email` 两种标识方式
- 发送后自动注册单聊为独立 group（folder 命名与群聊一致）

## 2. 飞书 API

### 2.1 发送消息 API

**端点**: `POST /open-apis/im/v1/messages?receive_id_type={type}`

**receive_id_type 可选值**:
| 类型 | 说明 |
|------|------|
| `open_id` | 用户 open_id（推荐） |
| `email` | 用户邮箱 |
| `chat_id` | 群聊 ID（已实现） |

**请求体**:
```json
{
  "receive_id": "ou_xxx 或 user@example.com",
  "msg_type": "text",
  "content": "{\"text\":\"消息内容\"}"
}
```

**响应**:
```json
{
  "code": 0,
  "data": {
    "message_id": "om_xxx",
    "chat_id": "oc_xxx"
  }
}
```

### 2.2 权限要求

- `im:message:send_as_bot` - 发送消息

## 3. IPC 设计

### 3.1 请求格式

```json
{
  "type": "send_to_user",
  "identify_type": "open_id",
  "identify_value": "ou_abc123",
  "user_name": "张三",
  "message": "消息内容",
  "msg_type": "post"
}
```

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `identify_type` | string | 是 | `open_id` 或 `email` |
| `identify_value` | string | 是 | 标识值 |
| `user_name` | string | 否 | 用户姓名（用于显示） |
| `message` | string | 是 | 消息内容 |
| `msg_type` | string | 否 | `text` 或 `post`，默认 `post` |

### 3.2 响应格式

```json
{
  "success": true,
  "message_id": "om_xxx",
  "chat_id": "oc_xxx",
  "user_name": "张三"
}
```

## 4. 单聊自动注册

### 4.1 注册规则

发送成功后，如果返回 `chat_id`，自动注册为独立 group：

| 项目 | 值 |
|------|------|
| **jid** | `feishu:{chat_id}` |
| **folder** | `feishu-{chat_id}`（与群聊一致） |
| **name** | `单聊-{user_name}` |
| **trigger** | 空（单聊不需要触发词） |
| **is_p2p** | `true` |

### 4.2 目录结构

```
data/
├── sessions/
│   ├── feishu-oc_main_group/     # 群聊
│   └── feishu-oc_p2p_user1/      # 单聊（folder 规则一致）
└── ipc/
    ├── feishu-oc_main_group/
    └── feishu-oc_p2p_user1/
```

## 5. 实现代码

### 5.1 FeishuClient 新增方法

```typescript
// src/feishu/client.ts

async sendToUser(
  receiveId: string,
  receiveIdType: 'open_id' | 'email',
  text: string,
  msgType: 'text' | 'post' = 'post'
): Promise<{ message_id: string; chat_id?: string }> {
  const content = msgType === 'post'
    ? JSON.stringify({ zh_cn: { content: [[{ tag: 'md', text }]] } })
    : JSON.stringify({ text });

  const response = await this.client.im.message.create({
    params: { receive_id_type: receiveIdType },
    data: {
      receive_id: receiveId,
      msg_type: msgType,
      content,
    },
  });

  if (response.code !== 0) {
    throw new Error(`发送失败: ${response.msg}`);
  }

  return {
    message_id: response.data?.message_id || '',
    chat_id: response.data?.chat_id,
  };
}
```

### 5.2 IPC 处理

```typescript
// src/ipc.ts - 在 feishu IPC 处理中新增

case 'send_to_user': {
  const { identify_type, identify_value, user_name, message, msg_type } = request;

  // 验证 identify_type
  if (!['open_id', 'email'].includes(identify_type)) {
    throw new Error(`不支持的标识类型: ${identify_type}`);
  }

  // 发送消息
  const sendResult = await feishuChannel.client.sendToUser(
    identify_value,
    identify_type,
    message,
    msg_type || 'post'
  );

  // 自动注册单聊
  if (sendResult.chat_id) {
    const p2pChatJid = `feishu:${sendResult.chat_id}`;

    if (!registeredGroups[p2pChatJid]) {
      const p2pFolder = `feishu-${sendResult.chat_id}`;

      deps.registerGroup(p2pChatJid, {
        name: `单聊-${user_name || identify_value}`,
        folder: p2pFolder,
        trigger: '',
        added_at: new Date().toISOString(),
        is_p2p: true,
        p2p_user: {
          open_id: identify_type === 'open_id' ? identify_value : undefined,
          name: user_name,
        },
        source_group: sourceGroup,
      });

      logger.info({ p2pChatJid, user_name }, 'P2P chat auto-registered');
    }
  }

  result = {
    message_id: sendResult.message_id,
    chat_id: sendResult.chat_id,
    user_name: user_name
  };
  break;
}
```

### 5.3 RegisteredGroup 类型扩展

```typescript
// src/types.ts

export interface RegisteredGroup {
  name: string;
  folder: string;
  trigger: string;
  added_at: string;
  isMain?: boolean;
  requiresTrigger?: boolean;
  containerConfig?: { ... };

  // 单聊字段
  is_p2p?: boolean;
  p2p_user?: {
    open_id?: string;
    name?: string;
  };
  source_group?: string;
}
```

## 6. 容器端 MCP 工具

```typescript
// container/agent-runner/src/tools/feishu.ts

export const feishuSendToUserTool = {
  name: 'feishu_send_to_user',
  description: '发送消息给飞书指定联系人',
  inputSchema: {
    type: 'object',
    properties: {
      identify_type: {
        type: 'string',
        enum: ['open_id', 'email'],
        description: '标识类型'
      },
      identify_value: {
        type: 'string',
        description: 'open_id 或邮箱地址'
      },
      user_name: {
        type: 'string',
        description: '用户姓名（可选，用于显示）'
      },
      message: {
        type: 'string',
        description: '消息内容'
      },
    },
    required: ['identify_type', 'identify_value', 'message']
  },
};
```

## 7. 使用示例

### 7.1 Agent 调用

```typescript
// 发送给指定 open_id
await feishu_send_to_user({
  identify_type: 'open_id',
  identify_value: 'ou_abc123',
  user_name: '张三',
  message: '您的任务已完成'
});

// 发送给指定邮箱
await feishu_send_to_user({
  identify_type: 'email',
  identify_value: 'zhangsan@example.com',
  message: '请确认是否继续'
});
```

### 7.2 定时任务场景

设定任务时用户提供姓名和 open_id：
- 存储：`{ user_name: "张三", user_open_id: "ou_abc123" }`
- 发送时使用 `identify_type: "open_id"`

## 8. 实现步骤

1. **FeishuClient** - 添加 `sendToUser` 方法
2. **IPC 处理** - 添加 `send_to_user` case
3. **types.ts** - 扩展 `RegisteredGroup` 类型
4. **容器工具** - 添加 `feishu_send_to_user` MCP 工具
5. **测试** - 单元测试和集成测试