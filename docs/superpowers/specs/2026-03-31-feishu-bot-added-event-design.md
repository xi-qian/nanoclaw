# Feishu Bot Added to Chat Event Design

## Summary

Add support for the Feishu `im.chat.member.bot.added_v1` event to automatically send welcome messages when the bot is added to a group chat. The welcome behavior is defined by a skill file, allowing customization per group without code changes.

## Requirements

1. Listen for the `im.chat.member.bot.added_v1` event from Feishu
2. Trigger a `bot-welcome` skill when the bot is added to a group
3. Support per-group customized welcome messages and skill triggering
4. Work correctly with container reuse (existing session containers)

## Architecture

### Design Decision: Text-Based Event Message

After reviewing the existing architecture, this design uses a **text-based event message** approach rather than extending TypeScript interfaces. This approach:

- Reuses the existing IPC message flow without modifications
- Works naturally with container reuse
- Requires minimal code changes
- Leverages the existing skill loading mechanism

### Event Flow

```
Feishu WebSocket Event
         │
         ▼
FeishuClient.emit('im.chat.member.bot.added_v1')
         │
         ▼
FeishuChannel.handleBotAddedEvent()
         │ Formats event as text message:
         │ "[BOT_ADDED_TO_CHAT]\nchat_id: oc_xxx\n..."
         ▼
src/index.ts (onMessage callback)
         │ Stores to SQLite → Sends via IPC to container
         │ (same flow as regular messages)
         ▼
agent-runner
         │ Receives as regular text message
         │ bot-welcome skill (loaded via CLAUDE.md) recognizes format
         ▼
Claude API call
         │ Generates welcome message based on group config in skill
         ▼
agent-runner outputs response
         │ Writes to IPC output file
         ▼
Host IPC listener
         │ Reads response
         ▼
router.ts → FeishuChannel.sendMessage()
         │
         ▼
Feishu group receives welcome message
```

## Implementation Details

### 1. Event Message Format

When the bot is added to a chat, format the event as a structured text message:

```
[BOT_ADDED_TO_CHAT]
chat_id: oc_xxx
chat_name: 项目讨论组
operator: 张三
operator_id: ou_xxx
timestamp: 1608725989000
```

This format:
- Starts with `[BOT_ADDED_TO_CHAT]` marker for easy recognition
- Contains all relevant event data as key-value pairs
- Is human-readable and easy for the agent to parse

### 2. Register Event Listener in FeishuClient

**File**: `src/feishu/client.ts`

In the `connect()` method, register the new event listener in the EventDispatcher.

**Important**: Keep consistent with existing event emit pattern (wrap full `data` in `event`):

```typescript
const eventDispatcher = new Lark.EventDispatcher({
  loggerLevel: Lark.LoggerLevel.debug,
}).register({
  'im.message.receive_v1': async (data: any) => {
    log.info({ data: JSON.stringify(data) }, 'Event received from EventDispatcher');
    self.emit('im.message.receive_v1', {
      type: 'im.message.receive_v1',
      event: data,
    });
  },
  'card.action.trigger': async (data: any) => {
    log.info({ data: JSON.stringify(data) }, 'Card action event received');
    self.emit('card.action.trigger', {
      type: 'card.action.trigger',
      event: data,
    });
  },
  // New: Bot added to chat event (same pattern as existing events)
  'im.chat.member.bot.added_v1': async (data: any) => {
    log.info({ data: JSON.stringify(data) }, 'Bot added to chat event received');
    self.emit('im.chat.member.bot.added_v1', {
      type: 'im.chat.member.bot.added_v1',
      event: data,  // Full data object, access header via event.header
    });
  },
});
```

Update the log message at line 191-192 to include the new event type.

### 3. Handle Bot Added Event in FeishuChannel

**File**: `src/channels/feishu.ts`

Add event handler registration in the existing `setupEventHandlers()` method (after line 88):

```typescript
private setupEventHandlers(): void {
  // Existing handlers (lines 63-88)...

  // Listen for bot added to chat event
  this.client.on('im.chat.member.bot.added_v1', (event: FeishuEvent) => {
    this.handleBotAddedEvent(event).catch((err) => {
      log.error({ err }, 'Error in bot added event handler');
    });
  });

  log.info('WebSocket event handlers registered');
}
```

Add the new handler method:

```typescript
/**
 * 处理机器人入群事件
 */
private async handleBotAddedEvent(event: FeishuEvent): Promise<void> {
  try {
    if (event.type === 'im.chat.member.bot.added_v1' && event.event) {
      // Access fields from event.event (data wrapped in event, consistent with other handlers)
      const eventData = event.event;
      const chatId = eventData.chat_id || '';
      const chatName = eventData.name || '';
      const operatorOpenId = eventData.operator_id?.open_id || '';
      const timestamp = event.event?.header?.create_time || Date.now().toString();

      // Get operator name from contact API
      const operatorName = await this.client.getUserName(operatorOpenId);

      const jid = `feishu:${chatId}`;

      // Store chat metadata first
      this.onChatMetadata(jid, timestamp, chatId, 'feishu', true);

      // Format event as structured text message
      const eventMessage = [
        '[BOT_ADDED_TO_CHAT]',
        `chat_id: ${chatId}`,
        `chat_name: ${chatName}`,
        `operator: ${operatorName}`,
        `operator_id: ${operatorOpenId}`,
        `timestamp: ${timestamp}`,
      ].join('\n');

      // Construct message (same structure as regular messages)
      const newMessage: NewMessage = {
        id: `event_${event.event?.header?.event_id || Date.now()}`,
        chat_jid: jid,
        sender: operatorOpenId,
        sender_name: operatorName,
        content: eventMessage,
        timestamp: timestamp,
        is_from_me: false,
        message_type: 'text',
      };

      // Notify message handler (triggers agent via existing flow)
      this.onMessage(jid, newMessage);

      log.info(
        { chatId, chatName, operatorName, operatorOpenId },
        'Bot added to chat event processed',
      );
    }
  } catch (error) {
    log.error(
      { error: error instanceof Error ? error.message : String(error) },
      'Failed to handle bot added event',
    );
  }
}
```

### 4. Update FeishuEvent Type

**File**: `src/feishu/types.ts`

Add `header` field and bot added event fields to the `FeishuEvent` interface.

**Note**: The `event.operator` field already exists in the current types (lines 30-32). Only `header` and the bot-added-specific fields are new.

```typescript
export interface FeishuEvent {
  type: string;

  // NEW: Header field for all events (needed for event_id, create_time, etc.)
  header?: {
    event_id: string;
    event_type: string;
    create_time: string;
    token: string;
    app_id: string;
    tenant_key: string;
  };

  event?: {
    // EXISTING: Already in current types
    operator?: {
      open_id: string;
    };
    sender?: {
      sender_id: {
        open_id: string;
        union_id?: string;
        user_id?: string | null;
      };
      sender_type: string;
      tenant_key: string;
    };
    message?: { ... };
    reaction?: { ... };
    action?: { ... };
    context?: { ... };

    // NEW: Fields for im.chat.member.bot.added_v1 event
    chat_id?: string;
    operator_id?: {
      union_id?: string;
      user_id?: string;
      open_id?: string;
    };
    name?: string;              // Group name
    i18n_names?: {
      zh_cn?: string;
      en_us?: string;
      ja_jp?: string;
    };
    external?: boolean;
    operator_tenant_key?: string;
  };
}
```

### 5. bot-welcome Skill

**New File**: `container/skills/bot-welcome/SKILL.md`

```markdown
# 机器人入群欢迎 Skill

## 触发条件

当收到以 `[BOT_ADDED_TO_CHAT]` 开头的消息时，执行欢迎逻辑。

## 作用

根据群组配置发送欢迎消息，帮助新成员了解机器人功能。

## 消息解析

从消息中提取以下信息：
- `chat_id`: 群组 ID
- `chat_name`: 群名称
- `operator`: 拉机器人进群的操作者
- `timestamp`: 事件时间

## 群组欢迎配置

### 群：oc_xxx（项目讨论组）

发送以下欢迎消息：

```
欢迎加入项目讨论组！我是 NanoClaw 助手。

我可以帮你：
- 管理任务和日程
- 创建飞书文档
- 搜索项目信息

发送消息即可与我交互，或使用 /help 查看更多指令。
```

### 群：oc_yyy（测试群）

发送欢迎消息后，自动执行项目初始化：

1. 发送欢迎消息
2. 然后按照 project-init 技能的流程，询问用户是否需要初始化项目

### 默认欢迎（未配置的群）

发送以下消息：

```
你好！我是 NanoClaw 助手，有什么可以帮助你的？

回复 /help 查看可用功能。
```

## 执行逻辑

1. 检查消息是否以 `[BOT_ADDED_TO_CHAT]` 开头
2. 解析消息内容，提取 `chat_id`
3. 根据上面的群组配置，发送对应的欢迎消息
4. 如果群组需要触发其他技能，在欢迎消息后继续执行相应操作
```

### 6. Skill Loading Configuration

The `bot-welcome` skill is loaded automatically when the agent processes messages. Skills work by:

1. The skill file (`container/skills/bot-welcome/SKILL.md`) is mounted into the container at `/workspace/skills/bot-welcome/SKILL.md`
2. The group's `CLAUDE.md` file includes a reference to load the skill:
   ```markdown
   # Group Configuration

   使用 bot-welcome 技能处理机器人入群事件。
   ```
3. When the agent receives a `[BOT_ADDED_TO_CHAT]` message, it follows the skill's instructions

**Note**: The agent determines when to apply the skill based on the message content (trigger condition in the skill description).

## Why This Approach Works

### Container Reuse Compatibility

The event message flows through the same IPC path as regular messages:
- Host writes `{type: "message", text: "[BOT_ADDED_TO_CHAT]..."}` to IPC
- agent-runner's `drainIpcInput()` reads it
- Message is pushed to the stream during `runQuery()`
- Works for both new and existing containers

### No IPC Modifications

Uses the existing IPC message format:
```json
{
  "type": "message",
  "text": "[BOT_ADDED_TO_CHAT]\nchat_id: oc_xxx\n..."
}
```

No changes needed to `src/ipc.ts` or `container/agent-runner/src/index.ts`.

### Simplicity

- No new TypeScript interfaces required for event types
- No trigger expression parsing
- No skill caching mechanism needed
- Reuses existing message flow

## Error Handling

### Permission Requirements

The Feishu app requires:
- Permission: `获取群组信息` or `获取与更新群组信息`
- Event subscription: `机器人进群` event enabled in the developer console

If the event is not received, check the developer console configuration.

### Duplicate Add to Group

The bot may be added to the same group multiple times (removed then re-added).

**Behavior**: Trigger welcome logic on every add event. No "first add" check.

### Unconfigured Group

If `bot-welcome` skill doesn't have a specific configuration for a group.

**Behavior**: Use the default welcome message defined in the skill.

### Operator Name Unavailable

If the contact API fails to get the operator's name.

**Behavior**: Use the `open_id` as the operator name fallback.

## File Changes Summary

| File | Change |
|------|--------|
| `src/feishu/types.ts` | Add `header` and bot_added event fields to `FeishuEvent` |
| `src/feishu/client.ts` | Register `im.chat.member.bot.added_v1` listener in EventDispatcher |
| `src/channels/feishu.ts` | Add `handleBotAddedEvent()` method and event registration |
| `container/skills/bot-welcome/SKILL.md` | **New**: Bot welcome skill |

## Testing

### Manual Testing

1. Configure event subscription in Feishu developer console:
   - Enable "机器人进群" event
   - Ensure app has `获取群组信息` permission
2. Add the bot to a test group
3. Verify welcome message is received
4. Check logs to confirm event was processed

### Edge Cases to Test

- Bot removed and re-added to the same group
- Group without specific welcome configuration (should use default)
- Operator name unavailable (should show open_id)
- Container reuse: add bot to a group with existing session