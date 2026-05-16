/**
 * Stdio MCP Server for NanoClaw
 * Standalone process that agent teams subagents can inherit.
 * Reads context from environment variables, writes IPC files for the host.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import fs from 'fs';
import path from 'path';
import { CronExpressionParser } from 'cron-parser';

const IPC_DIR = '/workspace/ipc';
const MESSAGES_DIR = path.join(IPC_DIR, 'messages');
const TASKS_DIR = path.join(IPC_DIR, 'tasks');
const FEISHU_REQUESTS_DIR = path.join(IPC_DIR, 'feishu', 'requests');
const FEISHU_RESULTS_DIR = path.join(IPC_DIR, 'feishu', 'results');
const LARK_REQUESTS_DIR = path.join(IPC_DIR, 'lark', 'requests');
const LARK_RESULTS_DIR = path.join(IPC_DIR, 'lark', 'results');

// Context from environment variables (set by the agent runner)
const chatJid = process.env.NANOCLAW_CHAT_JID!;
const groupFolder = process.env.NANOCLAW_GROUP_FOLDER!;
const isMain = process.env.NANOCLAW_IS_MAIN === '1';

function writeIpcFile(dir: string, data: object): string {
  fs.mkdirSync(dir, { recursive: true });

  const filename = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}.json`;
  const filepath = path.join(dir, filename);

  // Atomic write: temp file then rename
  const tempPath = `${filepath}.tmp`;
  fs.writeFileSync(tempPath, JSON.stringify(data, null, 2));
  fs.renameSync(tempPath, filepath);

  return filename;
}

const server = new McpServer({
  name: 'nanoclaw',
  version: '1.0.0',
});

server.tool(
  'send_message',
  "Send a message to the user or group immediately while you're still running. Use this for progress updates or to send multiple messages. You can call this multiple times.",
  {
    text: z.string().describe('The message text to send'),
    sender: z
      .string()
      .optional()
      .describe(
        'Your role/identity name (e.g. "Researcher"). When set, messages appear from a dedicated bot in Telegram.',
      ),
  },
  async (args) => {
    const data: Record<string, string | undefined> = {
      type: 'message',
      chatJid,
      text: args.text,
      sender: args.sender || undefined,
      groupFolder,
      timestamp: new Date().toISOString(),
    };

    writeIpcFile(MESSAGES_DIR, data);

    return { content: [{ type: 'text' as const, text: 'Message sent.' }] };
  },
);

server.tool(
  'schedule_task',
  `Schedule a recurring or one-time task. The task will run as a full agent with access to all tools. Returns the task ID for future reference. To modify an existing task, use update_task instead.

PERSISTENCE - Tasks are stored in SQLite database and persist across service restarts. They do NOT expire automatically. A task continues running until explicitly cancelled via cancel_task, or if it encounters repeated errors that cause it to be paused.

CONTEXT MODE - Choose based on task type:
\u2022 "group": Task runs in the group's conversation context, with access to chat history. Use for tasks that need context about ongoing discussions, user preferences, or recent interactions.
\u2022 "isolated": Task runs in a fresh session with no conversation history. Use for independent tasks that don't need prior context. When using isolated mode, include all necessary context in the prompt itself.

If unsure which mode to use, you can ask the user. Examples:
- "Remind me about our discussion" \u2192 group (needs conversation context)
- "Check the weather every morning" \u2192 isolated (self-contained task)
- "Follow up on my request" \u2192 group (needs to know what was requested)
- "Generate a daily report" \u2192 isolated (just needs instructions in prompt)

MESSAGING BEHAVIOR - The task agent's output is sent to the user or group. It can also use send_message for immediate delivery, or wrap output in <internal> tags to suppress it. Include guidance in the prompt about whether the agent should:
\u2022 Always send a message (e.g., reminders, daily briefings)
\u2022 Only send a message when there's something to report (e.g., "notify me if...")
\u2022 Never send a message (background maintenance tasks)

SCHEDULE VALUE FORMAT (all times are LOCAL timezone):
\u2022 cron: Standard cron expression (e.g., "*/5 * * * *" for every 5 minutes, "0 9 * * *" for daily at 9am LOCAL time)
\u2022 interval: Milliseconds between runs (e.g., "300000" for 5 minutes, "3600000" for 1 hour)
\u2022 once: Local time WITHOUT "Z" suffix (e.g., "2026-02-01T15:30:00"). Do NOT use UTC/Z suffix.`,
  {
    prompt: z
      .string()
      .describe(
        'What the agent should do when the task runs. For isolated mode, include all necessary context here.',
      ),
    schedule_type: z
      .enum(['cron', 'interval', 'once'])
      .describe(
        'cron=recurring at specific times, interval=recurring every N ms, once=run once at specific time',
      ),
    schedule_value: z
      .string()
      .describe(
        'cron: "*/5 * * * *" | interval: milliseconds like "300000" | once: local timestamp like "2026-02-01T15:30:00" (no Z suffix!)',
      ),
    context_mode: z
      .enum(['group', 'isolated'])
      .default('group')
      .describe(
        'group=runs with chat history and memory, isolated=fresh session (include context in prompt)',
      ),
    target_group_jid: z
      .string()
      .optional()
      .describe(
        '(Main group only) JID of the group to schedule the task for. Defaults to the current group.',
      ),
  },
  async (args) => {
    // Validate schedule_value before writing IPC
    if (args.schedule_type === 'cron') {
      try {
        CronExpressionParser.parse(args.schedule_value);
      } catch {
        return {
          content: [
            {
              type: 'text' as const,
              text: `Invalid cron: "${args.schedule_value}". Use format like "0 9 * * *" (daily 9am) or "*/5 * * * *" (every 5 min).`,
            },
          ],
          isError: true,
        };
      }
    } else if (args.schedule_type === 'interval') {
      const ms = parseInt(args.schedule_value, 10);
      if (isNaN(ms) || ms <= 0) {
        return {
          content: [
            {
              type: 'text' as const,
              text: `Invalid interval: "${args.schedule_value}". Must be positive milliseconds (e.g., "300000" for 5 min).`,
            },
          ],
          isError: true,
        };
      }
    } else if (args.schedule_type === 'once') {
      if (
        /[Zz]$/.test(args.schedule_value) ||
        /[+-]\d{2}:\d{2}$/.test(args.schedule_value)
      ) {
        return {
          content: [
            {
              type: 'text' as const,
              text: `Timestamp must be local time without timezone suffix. Got "${args.schedule_value}" — use format like "2026-02-01T15:30:00".`,
            },
          ],
          isError: true,
        };
      }
      const date = new Date(args.schedule_value);
      if (isNaN(date.getTime())) {
        return {
          content: [
            {
              type: 'text' as const,
              text: `Invalid timestamp: "${args.schedule_value}". Use local time format like "2026-02-01T15:30:00".`,
            },
          ],
          isError: true,
        };
      }
    }

    // Non-main groups can only schedule for themselves
    const targetJid =
      isMain && args.target_group_jid ? args.target_group_jid : chatJid;

    const taskId = `task-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    const data = {
      type: 'schedule_task',
      taskId,
      prompt: args.prompt,
      schedule_type: args.schedule_type,
      schedule_value: args.schedule_value,
      context_mode: args.context_mode || 'group',
      targetJid,
      createdBy: groupFolder,
      timestamp: new Date().toISOString(),
    };

    writeIpcFile(TASKS_DIR, data);

    return {
      content: [
        {
          type: 'text' as const,
          text: `Task ${taskId} scheduled: ${args.schedule_type} - ${args.schedule_value}`,
        },
      ],
    };
  },
);

server.tool(
  'list_tasks',
  "List all scheduled tasks. From main: shows all tasks. From other groups: shows only that group's tasks.",
  {},
  async () => {
    const tasksFile = path.join(IPC_DIR, 'current_tasks.json');

    try {
      if (!fs.existsSync(tasksFile)) {
        return {
          content: [
            { type: 'text' as const, text: 'No scheduled tasks found.' },
          ],
        };
      }

      const allTasks = JSON.parse(fs.readFileSync(tasksFile, 'utf-8'));

      const tasks = isMain
        ? allTasks
        : allTasks.filter(
            (t: { groupFolder: string }) => t.groupFolder === groupFolder,
          );

      if (tasks.length === 0) {
        return {
          content: [
            { type: 'text' as const, text: 'No scheduled tasks found.' },
          ],
        };
      }

      const formatted = tasks
        .map(
          (t: {
            id: string;
            prompt: string;
            schedule_type: string;
            schedule_value: string;
            status: string;
            next_run: string;
          }) =>
            `- [${t.id}] ${t.prompt.slice(0, 50)}... (${t.schedule_type}: ${t.schedule_value}) - ${t.status}, next: ${t.next_run || 'N/A'}`,
        )
        .join('\n');

      return {
        content: [
          { type: 'text' as const, text: `Scheduled tasks:\n${formatted}` },
        ],
      };
    } catch (err) {
      return {
        content: [
          {
            type: 'text' as const,
            text: `Error reading tasks: ${err instanceof Error ? err.message : String(err)}`,
          },
        ],
      };
    }
  },
);

server.tool(
  'pause_task',
  'Pause a scheduled task. It will not run until resumed.',
  { task_id: z.string().describe('The task ID to pause') },
  async (args) => {
    const data = {
      type: 'pause_task',
      taskId: args.task_id,
      groupFolder,
      isMain,
      timestamp: new Date().toISOString(),
    };

    writeIpcFile(TASKS_DIR, data);

    return {
      content: [
        {
          type: 'text' as const,
          text: `Task ${args.task_id} pause requested.`,
        },
      ],
    };
  },
);

server.tool(
  'resume_task',
  'Resume a paused task.',
  { task_id: z.string().describe('The task ID to resume') },
  async (args) => {
    const data = {
      type: 'resume_task',
      taskId: args.task_id,
      groupFolder,
      isMain,
      timestamp: new Date().toISOString(),
    };

    writeIpcFile(TASKS_DIR, data);

    return {
      content: [
        {
          type: 'text' as const,
          text: `Task ${args.task_id} resume requested.`,
        },
      ],
    };
  },
);

server.tool(
  'cancel_task',
  'Cancel and delete a scheduled task.',
  { task_id: z.string().describe('The task ID to cancel') },
  async (args) => {
    const data = {
      type: 'cancel_task',
      taskId: args.task_id,
      groupFolder,
      isMain,
      timestamp: new Date().toISOString(),
    };

    writeIpcFile(TASKS_DIR, data);

    return {
      content: [
        {
          type: 'text' as const,
          text: `Task ${args.task_id} cancellation requested.`,
        },
      ],
    };
  },
);

server.tool(
  'new_session',
  'Start a new conversation session, clearing the previous context. Use this when the user wants to start fresh or when the conversation topic changes completely.',
  {},
  async () => {
    const data = {
      type: 'new_session',
      groupFolder,
      timestamp: new Date().toISOString(),
    };

    writeIpcFile(TASKS_DIR, data);

    return {
      content: [
        {
          type: 'text' as const,
          text: 'New session started. Previous conversation context has been cleared.',
        },
      ],
    };
  },
);

server.tool(
  'update_task',
  'Update an existing scheduled task. Only provided fields are changed; omitted fields stay the same.',
  {
    task_id: z.string().describe('The task ID to update'),
    prompt: z.string().optional().describe('New prompt for the task'),
    schedule_type: z
      .enum(['cron', 'interval', 'once'])
      .optional()
      .describe('New schedule type'),
    schedule_value: z
      .string()
      .optional()
      .describe('New schedule value (see schedule_task for format)'),
  },
  async (args) => {
    // Validate schedule_value if provided
    if (
      args.schedule_type === 'cron' ||
      (!args.schedule_type && args.schedule_value)
    ) {
      if (args.schedule_value) {
        try {
          CronExpressionParser.parse(args.schedule_value);
        } catch {
          return {
            content: [
              {
                type: 'text' as const,
                text: `Invalid cron: "${args.schedule_value}".`,
              },
            ],
            isError: true,
          };
        }
      }
    }
    if (args.schedule_type === 'interval' && args.schedule_value) {
      const ms = parseInt(args.schedule_value, 10);
      if (isNaN(ms) || ms <= 0) {
        return {
          content: [
            {
              type: 'text' as const,
              text: `Invalid interval: "${args.schedule_value}".`,
            },
          ],
          isError: true,
        };
      }
    }

    const data: Record<string, string | undefined> = {
      type: 'update_task',
      taskId: args.task_id,
      groupFolder,
      isMain: String(isMain),
      timestamp: new Date().toISOString(),
    };
    if (args.prompt !== undefined) data.prompt = args.prompt;
    if (args.schedule_type !== undefined)
      data.schedule_type = args.schedule_type;
    if (args.schedule_value !== undefined)
      data.schedule_value = args.schedule_value;

    writeIpcFile(TASKS_DIR, data);

    return {
      content: [
        {
          type: 'text' as const,
          text: `Task ${args.task_id} update requested.`,
        },
      ],
    };
  },
);

server.tool(
  'register_group',
  `Register a new chat/group so the agent can respond to messages there. Main group only.

Use available_groups.json to find the JID for a group. The folder name must be channel-prefixed: "{channel}_{group-name}" (e.g., "whatsapp_family-chat", "telegram_dev-team", "discord_general"). Use lowercase with hyphens for the group name part.`,
  {
    jid: z
      .string()
      .describe(
        'The chat JID (e.g., "120363336345536173@g.us", "tg:-1001234567890", "dc:1234567890123456")',
      ),
    name: z.string().describe('Display name for the group'),
    folder: z
      .string()
      .describe(
        'Channel-prefixed folder name (e.g., "whatsapp_family-chat", "telegram_dev-team")',
      ),
    trigger: z.string().describe('Trigger word (e.g., "@Andy")'),
  },
  async (args) => {
    if (!isMain) {
      return {
        content: [
          {
            type: 'text' as const,
            text: 'Only the main group can register new groups.',
          },
        ],
        isError: true,
      };
    }

    const data = {
      type: 'register_group',
      jid: args.jid,
      name: args.name,
      folder: args.folder,
      trigger: args.trigger,
      timestamp: new Date().toISOString(),
    };

    writeIpcFile(TASKS_DIR, data);

    return {
      content: [
        {
          type: 'text' as const,
          text: `Group "${args.name}" registered. It will start receiving messages immediately.`,
        },
      ],
    };
  },
);

async function waitForLarkResult(
  requestId: string,
  timeoutMs: number = 30000,
): Promise<any> {
  const startTime = Date.now();
  const resultFile = path.join(LARK_RESULTS_DIR, requestId);

  while (Date.now() - startTime < timeoutMs) {
    if (fs.existsSync(resultFile)) {
      const result = JSON.parse(fs.readFileSync(resultFile, 'utf-8'));
      try {
        fs.unlinkSync(resultFile);
      } catch {}
      return result;
    }

    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  throw new Error(
    `Timeout waiting for lark IPC result after ${timeoutMs / 1000}s`,
  );
}

server.tool(
  'lark_cli_run',
  'Run an allowlisted host-side lark-cli command via NanoClaw IPC. Use this for vendored lark-cli skills so real Lark credentials remain outside the container.',
  {
    argv: z
      .array(z.string())
      .min(1)
      .describe('lark-cli argv, without the binary name'),
    expect_json: z
      .boolean()
      .optional()
      .describe(
        'Whether NanoClaw should request and parse JSON output. Defaults to true.',
      ),
    timeout_ms: z
      .number()
      .int()
      .positive()
      .optional()
      .describe('Timeout in milliseconds. Defaults to 30000.'),
  },
  async (args) => {
    const requestId = writeIpcFile(LARK_REQUESTS_DIR, {
      type: 'lark_cli_run',
      argv: args.argv,
      expect_json: args.expect_json,
      timeout_ms: args.timeout_ms,
      groupFolder,
      timestamp: new Date().toISOString(),
    });

    try {
      const result = await waitForLarkResult(
        requestId,
        args.timeout_ms ?? 30000,
      );
      const hasJson = result.json !== undefined;
      const text = hasJson
        ? JSON.stringify(result.json, null, 2)
        : result.stdout ||
          (result.success
            ? 'lark-cli command succeeded with no output.'
            : result.stderr || `lark-cli exited with code ${result.exit_code}`);

      return {
        content: [{ type: 'text' as const, text }],
        structuredContent: result,
        isError: !result.success,
      };
    } catch (error) {
      return {
        content: [
          {
            type: 'text' as const,
            text: `lark-cli IPC failed: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
        isError: true,
      };
    }
  },
);

// ==================== 飞书工具 ====================

/**
 * 等待飞书 IPC 结果（带超时）
 */
async function waitForFeishuResult(
  requestId: string,
  timeoutMs: number = 30000,
): Promise<any> {
  const startTime = Date.now();
  const resultFile = path.join(FEISHU_RESULTS_DIR, requestId);

  while (Date.now() - startTime < timeoutMs) {
    if (fs.existsSync(resultFile)) {
      const result = JSON.parse(fs.readFileSync(resultFile, 'utf-8'));
      // 删除结果文件
      try {
        fs.unlinkSync(resultFile);
      } catch {}
      return result;
    }
    // 等待 100ms 后重试
    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  throw new Error(
    `Timeout waiting for feishu IPC result after ${timeoutMs / 1000}s`,
  );
}

// 文档创建超时时间：由于速率限制（250ms/块），大文档需要更长时间
const DOC_CREATE_TIMEOUT_MS = 180000; // 3 分钟
const DOC_UPDATE_TIMEOUT_MS = 180000; // 3 分钟

server.tool(
  'feishu_download_resource',
  `下载飞书消息中的资源文件（用户发送的图片、文件、音频、视频等）。

使用场景：
- 用户发送了图片，需要分析图片内容
- 用户发送了文件，需要读取文件内容
- 用户发送了语音消息，需要转录文字
- 用户发送了视频，需要处理视频

返回值：临时文件路径，可以直接读取文件内容。

重要：type 参数必须与消息的 type 属性一致！
- image: 图片消息
- file: 文件消息
- audio: 语音消息
- video: 视频消息
- media: 媒体消息`,
  {
    message_id: z
      .string()
      .describe('消息 ID（从消息的 download_message_id 属性获取）'),
    file_key: z
      .string()
      .describe('资源文件 key（从消息的 download_file_key 属性获取）'),
    file_name: z
      .string()
      .optional()
      .describe('保存的文件名（可选，默认自动生成）'),
    type: z
      .enum(['image', 'file', 'audio', 'video', 'media'])
      .default('file')
      .describe('资源类型，必须与消息的 type 属性一致'),
  },
  async (args) => {
    const requestId = writeIpcFile(FEISHU_REQUESTS_DIR, {
      type: 'download_resource',
      message_id: args.message_id,
      file_key: args.file_key,
      file_name: args.file_name,
      resource_type: args.type,
      groupFolder,
      timestamp: new Date().toISOString(),
    });

    try {
      const result = await waitForFeishuResult(requestId);

      if (result.success && result.file_path) {
        return {
          content: [
            {
              type: 'text' as const,
              text: `资源下载成功!\n\n临时文件路径: ${result.file_path}\n\n你可以使用 Read 工具读取文件内容，或者使用其他工具处理该文件。`,
            },
          ],
        };
      } else {
        return {
          content: [
            {
              type: 'text' as const,
              text: `下载资源失败: ${result.error || '未知错误'}`,
            },
          ],
          isError: true,
        };
      }
    } catch (error) {
      return {
        content: [
          {
            type: 'text' as const,
            text: `下载资源超时或失败: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
        isError: true,
      };
    }
  },
);

server.tool(
  'feishu_send_file',
  `发送文件给飞书用户。

使用场景：
- 生成了报告文件（PDF、Word 等）需要发送给用户
- 创建了图片需要发送给用户
- 录制了音频需要发送给用户
- 生成了视频需要发送给用户

文件路径说明：
- 文件必须在 /workspace/ipc/downloads/ 目录下
- 如果文件在其他位置，需要先复制到该目录

文件类型说明：
- file: 通用文件（PDF、Word、Excel 等）
- image: 图片（PNG、JPG、GIF 等）
- audio: 音频（MP3、WAV 等）
- video: 视频（MP4、MOV 等）
- media: 其他媒体文件`,
  {
    chat_id: z
      .string()
      .optional()
      .describe('目标聊天 ID（可选，默认发送到当前聊天）'),
    file_path: z
      .string()
      .describe(
        '文件路径（必须是容器内可访问的路径，如 /workspace/ipc/downloads/xxx.pdf）',
      ),
    file_type: z
      .enum(['file', 'image', 'audio', 'video', 'media'])
      .default('file')
      .describe('文件类型'),
  },
  async (args) => {
    // 如果没有指定 chat_id，使用当前聊天
    const targetChatId = args.chat_id || chatJid;

    // 验证文件路径（必须是容器内可访问的路径）
    if (!args.file_path.startsWith('/workspace/')) {
      return {
        content: [
          {
            type: 'text' as const,
            text: `文件路径必须在 /workspace/ 目录下。当前路径: ${args.file_path}`,
          },
        ],
        isError: true,
      };
    }

    const requestId = writeIpcFile(FEISHU_REQUESTS_DIR, {
      type: 'send_file',
      chat_id: targetChatId,
      file_path: args.file_path,
      file_type: args.file_type,
      groupFolder,
      timestamp: new Date().toISOString(),
    });

    try {
      const result = await waitForFeishuResult(
        requestId,
        DOC_CREATE_TIMEOUT_MS,
      );

      if (result.success) {
        return {
          content: [
            {
              type: 'text' as const,
              text: `文件发送成功!\n\n文件类型: ${args.file_type}\n文件路径: ${args.file_path}`,
            },
          ],
        };
      } else {
        return {
          content: [
            {
              type: 'text' as const,
              text: `发送文件失败: ${result.error || '未知错误'}`,
            },
          ],
          isError: true,
        };
      }
    } catch (error) {
      return {
        content: [
          {
            type: 'text' as const,
            text: `发送文件超时或失败: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
        isError: true,
      };
    }
  },
);

server.tool(
  'feishu_send_to_user',
  `发送消息给飞书指定联系人。

使用场景：
- 定时任务通知指定用户
- 向用户发送私聊消息
- 主动联系用户（而不是等待用户先发消息）

标识类型说明：
- open_id: 用户的 open_id（推荐，格式如 "ou_xxx"）
- email: 用户邮箱地址

消息类型说明：
- post: 富文本消息（默认），支持 Markdown 格式
- text: 纯文本消息

注意：
- 发送成功后会自动注册单聊，后续可以直接通过 chat_id 发送消息
- 如果用户不存在或无权限，会返回错误`,
  {
    identify_type: z
      .enum(['open_id', 'email'])
      .describe('标识类型：open_id 或 email'),
    identify_value: z
      .string()
      .describe('标识值：open_id（如 "ou_xxx"）或邮箱地址'),
    user_name: z.string().optional().describe('用户姓名（可选，用于显示）'),
    message: z.string().describe('消息内容'),
    msg_type: z
      .enum(['text', 'post'])
      .optional()
      .default('post')
      .describe('消息类型：text=纯文本, post=富文本（默认，支持 Markdown）'),
  },
  async (args) => {
    const requestId = writeIpcFile(FEISHU_REQUESTS_DIR, {
      type: 'send_to_user',
      identify_type: args.identify_type,
      identify_value: args.identify_value,
      user_name: args.user_name,
      message: args.message,
      msg_type: args.msg_type || 'post',
      groupFolder,
      timestamp: new Date().toISOString(),
    });

    try {
      const result = await waitForFeishuResult(requestId);

      if (result.success) {
        const chatInfo = result.chat_id ? `\n聊天 ID: ${result.chat_id}` : '';
        return {
          content: [
            {
              type: 'text' as const,
              text: `消息发送成功!\n\n消息 ID: ${result.message_id}${chatInfo}\n接收者: ${result.user_name || args.identify_value}`,
            },
          ],
        };
      } else {
        return {
          content: [
            {
              type: 'text' as const,
              text: `发送消息失败: ${result.error || '未知错误'}`,
            },
          ],
          isError: true,
        };
      }
    } catch (error) {
      return {
        content: [
          {
            type: 'text' as const,
            text: `发送消息超时或失败: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
        isError: true,
      };
    }
  },
);

server.tool(
  'feishu_get_user_department',
  `获取飞书用户的部门名称列表。

使用场景：
- 根据用户消息中的 sender_id 查询用户所属部门
- 了解用户的组织架构信息
- 根据部门进行权限判断或分组处理

参数说明：
- open_id: 用户的 open_id（格式如 "ou_xxx"）

返回值：
- 用户所属的部门名称列表（可能有多个部门）

注意：
- 需要飞书应用有通讯录相关权限（contact:user.base:readonly, contact:department.base:readonly）
- 如果用户不存在或无权限，返回空列表`,
  {
    open_id: z
      .string()
      .describe(
        '用户的 open_id（格式如 "ou_xxx"，可以从消息的 sender_id 属性获取）',
      ),
  },
  async (args) => {
    const requestId = writeIpcFile(FEISHU_REQUESTS_DIR, {
      type: 'get_user_department',
      open_id: args.open_id,
      groupFolder,
      timestamp: new Date().toISOString(),
    });

    try {
      const result = await waitForFeishuResult(requestId);

      if (result.success) {
        const departments = result.departments || [];
        if (departments.length === 0) {
          return {
            content: [
              {
                type: 'text' as const,
                text: `用户 ${args.open_id} 没有部门信息，或无法获取部门信息（可能缺少权限）`,
              },
            ],
          };
        }
        return {
          content: [
            {
              type: 'text' as const,
              text: `用户 ${args.open_id} 所属部门:\n${departments.map((d: string, i: number) => `${i + 1}. ${d}`).join('\n')}`,
            },
          ],
        };
      } else {
        return {
          content: [
            {
              type: 'text' as const,
              text: `获取用户部门失败: ${result.error || '未知错误'}`,
            },
          ],
          isError: true,
        };
      }
    } catch (error) {
      return {
        content: [
          {
            type: 'text' as const,
            text: `获取用户部门超时或失败: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
        isError: true,
      };
    }
  },
);


// Start the stdio server transport
const transport = new StdioServerTransport();
await server.connect(transport);
