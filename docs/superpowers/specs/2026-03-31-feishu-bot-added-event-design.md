# Feishu Bot Added to Chat Event Design

## Summary

Add support for the Feishu `im.chat.member.bot.added_v1` event to automatically send welcome messages when the bot is added to a group chat. The welcome behavior is defined by a skill file, allowing customization per group without code changes.

## Requirements

1. Listen for the `im.chat.member.bot.added_v1` event from Feishu
2. Trigger a `bot-welcome` skill when the bot is added to a group
3. Support per-group customized welcome messages and skill triggering
4. Work correctly with container reuse (existing session containers)

## Architecture

### Event Flow

```
Feishu WebSocket Event
         │
         ▼
FeishuClient.emit('im.chat.member.bot.added_v1')
         │
         ▼
FeishuChannel.handleBotAddedEvent()
         │ Constructs NewMessage { event_type: 'bot_added_to_chat', ... }
         ▼
src/index.ts (onMessage callback)
         │ Stores to SQLite → Sends via IPC to container
         ▼
agent-runner (IPC listener)
         │ SkillCache.matchByTrigger(message)
         │ Matches bot-welcome skill
         │ Injects skill content into system prompt
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

### 1. Extend NewMessage Type

**File**: `src/types.ts`

Add `event_type` and `event_metadata` fields to `NewMessage`:

```typescript
export interface NewMessage {
  id: string;
  chat_jid: string;
  sender: string;
  sender_name: string;
  content: string;
  timestamp: string;
  is_from_me: boolean;
  message_type: 'text' | 'image' | 'file' | 'audio' | 'video' | 'media' | 'post' | 'interactive';
  attachment?: MessageAttachment;

  // Event type (empty for regular messages, set for special events)
  event_type?: 'bot_added_to_chat' | 'user_added_to_chat';

  // Event metadata (for bot_added_to_chat: operator info, chat name)
  event_metadata?: {
    operator_id?: string;      // Operator's open_id
    operator_name?: string;    // Operator's display name
    chat_name?: string;        // Group name
  };
}
```

### 2. Extend FeishuEvent Type

**File**: `src/feishu/types.ts`

Add the `im.chat.member.bot.added_v1` event structure:

```typescript
export interface FeishuEvent {
  type: string;
  header?: {
    event_id: string;
    event_type: string;
    create_time: string;
    token: string;
    app_id: string;
    tenant_key: string;
  };
  event?: {
    // Existing fields...
    message?: { ... };
    sender?: { ... };
    reaction?: { ... };
    action?: { ... };
    context?: { ... };

    // New: Bot added to chat event
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

### 3. Register Event Listener in FeishuClient

**File**: `src/feishu/client.ts`

In the `connect()` method, register the new event listener:

```typescript
const eventDispatcher = new Lark.EventDispatcher({
  loggerLevel: Lark.LoggerLevel.debug,
}).register({
  'im.message.receive_v1': async (data: any) => { ... },
  'card.action.trigger': async (data: any) => { ... },

  // New: Bot added to chat event
  'im.chat.member.bot.added_v1': async (data: any) => {
    log.info({ data: JSON.stringify(data) }, 'Bot added to chat event received');
    self.emit('im.chat.member.bot.added_v1', {
      type: 'im.chat.member.bot.added_v1',
      header: data.header,
      event: data.event,
    });
  },
});
```

### 4. Handle Bot Added Event in FeishuChannel

**File**: `src/channels/feishu.ts`

Add event handler registration and event processing:

```typescript
private setupEventHandlers(): void {
  // Existing handlers...

  // Listen for bot added to chat event
  this.client.on('im.chat.member.bot.added_v1', (event: FeishuEvent) => {
    this.handleBotAddedEvent(event).catch((err) => {
      log.error({ err }, 'Error in bot added event handler');
    });
  });
}

private async handleBotAddedEvent(event: FeishuEvent): Promise<void> {
  try {
    if (event.type === 'im.chat.member.bot.added_v1' && event.event) {
      const chatId = event.event.chat_id;
      const operatorOpenId = event.event.operator_id?.open_id || '';
      const chatName = event.event.name || '';
      const timestamp = event.header?.create_time || Date.now().toString();

      // Get operator name from contact API
      const operatorName = await this.client.getUserName(operatorOpenId);

      const jid = `feishu:${chatId}`;

      // Store chat metadata
      this.onChatMetadata(jid, timestamp, chatId, 'feishu', true);

      // Construct virtual message for the event
      const newMessage: NewMessage = {
        id: `event_${event.header?.event_id || Date.now()}`,
        chat_jid: jid,
        sender: operatorOpenId,
        sender_name: operatorName,
        content: '',
        timestamp: timestamp,
        is_from_me: false,
        message_type: 'text',
        event_type: 'bot_added_to_chat',
        event_metadata: {
          operator_id: operatorOpenId,
          operator_name: operatorName,
          chat_name: chatName,
        },
      };

      // Notify message handler
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

### 5. Skill Cache and Trigger Matching

**New File**: `container/agent-runner/src/skill-cache.ts`

```typescript
import * as fs from 'fs';
import * as path from 'path';

export interface SkillMeta {
  name: string;
  description: string;
  trigger?: string;
  content: string;
  path: string;
}

export class SkillCache {
  private skills: SkillMeta[] = [];
  private skillDir: string;

  constructor(skillDir: string) {
    this.skillDir = skillDir;
  }

  async loadSkills(): Promise<void> {
    this.skills = [];

    const dirs = await fs.promises.readdir(this.skillDir);
    for (const dir of dirs) {
      const skillPath = path.join(this.skillDir, dir, 'SKILL.md');
      try {
        const content = await fs.promises.readFile(skillPath, 'utf-8');
        const meta = this.parseFrontmatter(content, skillPath);
        if (meta) {
          this.skills.push(meta);
        }
      } catch (err) {
        // Skill file doesn't exist or can't be read, skip
      }
    }
  }

  private parseFrontmatter(content: string, skillPath: string): SkillMeta | null {
    const match = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
    if (!match) return null;

    const frontmatter = match[1];
    const body = match[2];

    const lines = frontmatter.split('\n');
    const meta: Partial<SkillMeta> = { content: body, path: skillPath };

    for (const line of lines) {
      const [key, ...valueParts] = line.split(':');
      const value = valueParts.join(':').trim();
      if (key && value) {
        (meta as any)[key.trim()] = value;
      }
    }

    return meta as SkillMeta;
  }

  matchByTrigger(message: any): SkillMeta[] {
    return this.skills.filter(skill => {
      if (!skill.trigger) return false;
      return evaluateTrigger(skill.trigger, message);
    });
  }
}

function evaluateTrigger(trigger: string, message: any): boolean {
  // Support simple comparison expressions:
  // - event_type == 'bot_added_to_chat'
  // - event_type != null
  // - message_type == 'text'

  const context: Record<string, any> = {
    event_type: message.event_type,
    message_type: message.message_type,
    content: message.content,
    sender: message.sender,
    chat_jid: message.chat_jid,
  };

  // Replace field names with context references
  let expr = trigger;
  for (const key of Object.keys(context)) {
    const regex = new RegExp(`\\b${key}\\b`, 'g');
    expr = expr.replace(regex, `context.${key}`);
  }

  // Safely evaluate the expression
  try {
    const fn = new Function('context', `return ${expr}`);
    return !!fn(context);
  } catch {
    return false;
  }
}
```

### 6. Integrate Trigger Matching in Message Handler

**File**: `container/agent-runner/src/message-handler.ts`

Modify the message handling to inject matched skills:

```typescript
import { SkillCache } from './skill-cache.js';

const skillCache = new SkillCache('/workspace/skills');
await skillCache.loadSkills();

async function handleMessage(message: any): Promise<void> {
  // Find skills that match the message via trigger
  const matchedSkills = skillCache.matchByTrigger(message);

  // Build system prompt with matched skills
  let enhancedPrompt = baseSystemPrompt;
  for (const skill of matchedSkills) {
    enhancedPrompt += `\n\n---\n# Skill: ${skill.name}\n\n${skill.content}\n---\n`;
  }

  // Call Claude with enhanced prompt
  const response = await callClaude({
    system: enhancedPrompt,
    messages: [{ role: 'user', content: formatMessage(message) }],
  });

  outputResponse(response);
}
```

### 7. bot-welcome Skill

**New File**: `container/skills/bot-welcome/SKILL.md`

```markdown
---
name: bot-welcome
description: 机器人入群欢迎消息处理
trigger: event_type == 'bot_added_to_chat'
---

# Bot Welcome

当机器人被添加到群聊时，根据群配置发送欢迎消息。

## 入口检查

此技能仅处理 `event_type === 'bot_added_to_chat'` 的事件消息。

## 群组欢迎配置

根据 `chat_jid` 发送对应的欢迎内容：

### 群：feishu:oc_xxx（项目讨论组）

欢迎加入项目讨论组！我是 NanoClaw 助手。

我可以帮你：
- 管理任务和日程
- 创建飞书文档
- 搜索项目信息

发送消息即可与我交互，或使用 `/help` 查看更多指令。

---

### 群：feishu:oc_yyy（测试群）

{% call skill='project-init' %}
自动初始化项目环境。
{% endcall %}

---

## 默认欢迎（未配置的群）

你好！我是 NanoClaw 助手，有什么可以帮助你的？

回复 `/help` 查看可用功能。
```

## Error Handling

### Permission Requirements

The Feishu app requires:
- Permission: `获取群组信息` or `获取与更新群组信息`
- Event subscription: `机器人进群` event enabled in the developer console

If the event is not received, document the required configuration steps.

### Duplicate Add to Group

The bot may be added to the same group multiple times (removed then re-added).

**Behavior**: Trigger welcome logic on every add event, without checking for "first add".

### Unconfigured Group

If `bot-welcome` skill doesn't have a specific configuration for a group.

**Behavior**: Use the default welcome message defined in the skill.

### Invalid Trigger Expression

If a skill's `trigger` syntax is incorrect or evaluation fails.

**Behavior**:
- `evaluateTrigger` catches exceptions and returns `false` (no match)
- Log the error for debugging

### Message Without event_type

Regular messages have `event_type` as `undefined`.

**Behavior**: `trigger: event_type == 'bot_added_to_chat'` returns `false` for `undefined`, preventing false triggers.

## File Changes Summary

| File | Change |
|------|--------|
| `src/types.ts` | Add `event_type` and `event_metadata` to `NewMessage` |
| `src/feishu/types.ts` | Add `im.chat.member.bot.added_v1` event structure |
| `src/feishu/client.ts` | Register bot added event listener in `connect()` |
| `src/channels/feishu.ts` | Add `handleBotAddedEvent()` method |
| `container/agent-runner/src/skill-cache.ts` | **New**: Skill caching and trigger matching |
| `container/agent-runner/src/message-handler.ts` | Integrate trigger matching and skill injection |
| `container/skills/bot-welcome/SKILL.md` | **New**: Bot welcome skill |

## Testing

### Manual Testing

1. Configure event subscription in Feishu developer console
2. Add the bot to a test group
3. Verify welcome message is received
4. Check logs to confirm trigger matching succeeded

### Edge Cases to Test

- Bot removed and re-added to the same group
- Group without specific welcome configuration (should use default)
- Multiple skills with matching triggers