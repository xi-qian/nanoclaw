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
  'feishu_fetch_doc',
  '获取飞书云文档内容，返回 Markdown 格式。支持文档 ID 或完整 URL。',
  {
    doc_id: z.string().describe('文档 ID 或完整 URL（支持自动解析）'),
    offset: z
      .number()
      .optional()
      .describe('字符偏移量（用于分页获取大文档，可选）'),
    limit: z
      .number()
      .optional()
      .describe('返回的最大字符数（仅在需要分页时使用）'),
  },
  async (args) => {
    const requestId = writeIpcFile(FEISHU_REQUESTS_DIR, {
      type: 'fetch_doc',
      doc_id: args.doc_id,
      offset: args.offset,
      limit: args.limit,
      groupFolder,
      timestamp: new Date().toISOString(),
    });

    try {
      const result = await waitForFeishuResult(requestId);

      if (result.success) {
        const content = `# ${result.title}\n\n${result.content || '(空文档)'}`;
        return {
          content: [{ type: 'text' as const, text: content }],
        };
      } else {
        return {
          content: [
            { type: 'text' as const, text: `获取文档失败: ${result.error}` },
          ],
          isError: true,
        };
      }
    } catch (error) {
      return {
        content: [
          {
            type: 'text' as const,
            text: `获取文档超时或失败: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
        isError: true,
      };
    }
  },
);

server.tool(
  'feishu_create_doc',
  '从 Markdown 创建飞书云文档。可指定父文件夹或知识库节点。',
  {
    title: z.string().describe('文档标题'),
    markdown: z.string().describe('Markdown 内容'),
    folder_token: z.string().optional().describe('父文件夹 token（可选）'),
    wiki_node: z
      .string()
      .optional()
      .describe('知识库节点 token 或 URL（可选，传入则在该节点下创建文档）'),
  },
  async (args) => {
    const requestId = writeIpcFile(FEISHU_REQUESTS_DIR, {
      type: 'create_doc',
      title: args.title,
      markdown: args.markdown,
      folder_token: args.folder_token,
      wiki_node: args.wiki_node,
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
              text: `文档创建成功!\n\n标题: ${result.title}\n文档 ID: ${result.doc_id}\n链接: ${result.url || '(未返回链接)'}`,
            },
          ],
        };
      } else {
        return {
          content: [
            { type: 'text' as const, text: `创建文档失败: ${result.error}` },
          ],
          isError: true,
        };
      }
    } catch (error) {
      return {
        content: [
          {
            type: 'text' as const,
            text: `创建文档超时或失败: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
        isError: true,
      };
    }
  },
);

server.tool(
  'feishu_update_doc',
  '更新飞书云文档内容。提供文档 ID 和新的 Markdown 内容。',
  {
    doc_id: z.string().describe('文档 ID 或 URL'),
    markdown: z.string().describe('新的 Markdown 内容'),
  },
  async (args) => {
    const requestId = writeIpcFile(FEISHU_REQUESTS_DIR, {
      type: 'update_doc',
      doc_id: args.doc_id,
      markdown: args.markdown,
      groupFolder,
      timestamp: new Date().toISOString(),
    });

    try {
      const result = await waitForFeishuResult(
        requestId,
        DOC_UPDATE_TIMEOUT_MS,
      );

      if (result.success) {
        return {
          content: [{ type: 'text' as const, text: '文档更新成功!' }],
        };
      } else {
        return {
          content: [
            { type: 'text' as const, text: `更新文档失败: ${result.error}` },
          ],
          isError: true,
        };
      }
    } catch (error) {
      return {
        content: [
          {
            type: 'text' as const,
            text: `更新文档超时或失败: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
        isError: true,
      };
    }
  },
);

server.tool(
  'feishu_search_docs',
  '搜索飞书云文档。返回匹配的文档列表。',
  {
    query: z.string().describe('搜索关键词'),
    limit: z.number().optional().describe('返回结果数量（默认 10）'),
  },
  async (args) => {
    const requestId = writeIpcFile(FEISHU_REQUESTS_DIR, {
      type: 'search_docs',
      query: args.query,
      limit: args.limit || 10,
      groupFolder,
      timestamp: new Date().toISOString(),
    });

    try {
      const result = await waitForFeishuResult(requestId);

      if (result.success && Array.isArray(result.results)) {
        if (result.results.length === 0) {
          return {
            content: [{ type: 'text' as const, text: '未找到匹配的文档。' }],
          };
        }

        const formatted = result.results
          .map(
            (r: any) =>
              `- ${r.title}\n  ID: ${r.doc_id}\n  ${r.snippet ? `摘要: ${r.snippet}` : ''}\n  ${r.url ? `链接: ${r.url}` : ''}`,
          )
          .join('\n\n');

        return {
          content: [
            {
              type: 'text' as const,
              text: `找到 ${result.results.length} 个文档:\n\n${formatted}`,
            },
          ],
        };
      } else {
        return {
          content: [
            {
              type: 'text' as const,
              text: `搜索文档失败: ${result.error || '未知错误'}`,
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
            text: `搜索文档超时或失败: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
        isError: true,
      };
    }
  },
);

server.tool(
  'feishu_create_bitable',
  '创建飞书多维表格（Bitable）。返回应用 token 和 URL。',
  {
    name: z.string().describe('多维表格名称'),
  },
  async (args) => {
    const requestId = writeIpcFile(FEISHU_REQUESTS_DIR, {
      type: 'create_bitable',
      name: args.name,
      groupFolder,
      timestamp: new Date().toISOString(),
    });

    try {
      const result = await waitForFeishuResult(requestId);

      if (result.success) {
        return {
          content: [
            {
              type: 'text' as const,
              text: `多维表格创建成功!\n\n名称: ${result.name}\nApp Token: ${result.app_token}\n链接: ${result.app_url || '(未返回链接)'}`,
            },
          ],
        };
      } else {
        return {
          content: [
            {
              type: 'text' as const,
              text: `创建多维表格失败: ${result.error}`,
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
            text: `创建多维表格超时或失败: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
        isError: true,
      };
    }
  },
);

server.tool(
  'feishu_create_bitable_table',
  '在多维表格中创建数据表。需要提供应用 token、表名和字段定义。',
  {
    app_token: z.string().describe('多维表格应用 token'),
    name: z.string().describe('数据表名称'),
    fields: z
      .array(
        z.object({
          field_name: z.string().describe('字段名称'),
          type: z
            .number()
            .describe(
              '字段类型：1=文本, 2=数字, 3=单选, 4=多选, 5=日期, 7=复选框, 11=人员, 15=超链接',
            ),
          property: z
            .any()
            .optional()
            .describe('字段属性，如单选/多选的选项列表'),
        }),
      )
      .describe('字段定义列表'),
  },
  async (args) => {
    const requestId = writeIpcFile(FEISHU_REQUESTS_DIR, {
      type: 'create_bitable_table',
      app_token: args.app_token,
      name: args.name,
      fields: args.fields,
      groupFolder,
      timestamp: new Date().toISOString(),
    });

    try {
      const result = await waitForFeishuResult(requestId);

      if (result.success) {
        return {
          content: [
            {
              type: 'text' as const,
              text: `数据表创建成功!\n\n表名: ${result.name}\nTable ID: ${result.table_id}`,
            },
          ],
        };
      } else {
        return {
          content: [
            { type: 'text' as const, text: `创建数据表失败: ${result.error}` },
          ],
          isError: true,
        };
      }
    } catch (error) {
      return {
        content: [
          {
            type: 'text' as const,
            text: `创建数据表超时或失败: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
        isError: true,
      };
    }
  },
);

server.tool(
  'feishu_list_bitable_tables',
  '列出多维表格中的所有数据表。',
  {
    app_token: z.string().describe('多维表格应用 token'),
  },
  async (args) => {
    const requestId = writeIpcFile(FEISHU_REQUESTS_DIR, {
      type: 'list_bitable_tables',
      app_token: args.app_token,
      groupFolder,
      timestamp: new Date().toISOString(),
    });

    try {
      const result = await waitForFeishuResult(requestId);

      if (result.success) {
        const tables = result.tables || [];
        if (tables.length === 0) {
          return {
            content: [
              { type: 'text' as const, text: '多维表格中没有数据表。' },
            ],
          };
        }

        const formatted = tables
          .map((t: any, i: number) => `${i + 1}. ${t.name} (ID: ${t.table_id})`)
          .join('\n');

        return {
          content: [
            {
              type: 'text' as const,
              text: `找到 ${tables.length} 个数据表:\n\n${formatted}`,
            },
          ],
        };
      } else {
        return {
          content: [
            { type: 'text' as const, text: `列出数据表失败: ${result.error}` },
          ],
          isError: true,
        };
      }
    } catch (error) {
      return {
        content: [
          {
            type: 'text' as const,
            text: `列出数据表超时或失败: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
        isError: true,
      };
    }
  },
);

server.tool(
  'feishu_add_bitable_records',
  '向多维表格数据表中添加记录。支持单条或批量添加（最多 500 条）。',
  {
    app_token: z.string().describe('多维表格应用 token'),
    table_id: z.string().describe('数据表 ID'),
    records: z
      .array(
        z.object({
          fields: z
            .record(z.string(), z.any())
            .describe('字段值，key 为字段名，value 为字段值'),
        }),
      )
      .describe('记录列表，每条记录包含 fields 对象'),
  },
  async (args) => {
    const requestId = writeIpcFile(FEISHU_REQUESTS_DIR, {
      type: 'add_bitable_records',
      app_token: args.app_token,
      table_id: args.table_id,
      records: args.records,
      groupFolder,
      timestamp: new Date().toISOString(),
    });

    try {
      const result = await waitForFeishuResult(requestId);

      if (result.success) {
        return {
          content: [
            {
              type: 'text' as const,
              text: `记录添加成功!\n\n添加记录数: ${result.record_ids?.length || args.records.length}`,
            },
          ],
        };
      } else {
        return {
          content: [
            { type: 'text' as const, text: `添加记录失败: ${result.error}` },
          ],
          isError: true,
        };
      }
    } catch (error) {
      return {
        content: [
          {
            type: 'text' as const,
            text: `添加记录超时或失败: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
        isError: true,
      };
    }
  },
);

server.tool(
  'feishu_list_bitable_records',
  '查询多维表格数据表中的记录。支持过滤、排序和分页。',
  {
    app_token: z.string().describe('多维表格应用 token'),
    table_id: z.string().describe('数据表 ID'),
    view_id: z.string().optional().describe('视图 ID（可选）'),
    filter: z
      .object({
        conjunction: z
          .enum(['and', 'or'])
          .optional()
          .describe('条件之间的逻辑关系，默认为 and'),
        conditions: z
          .array(
            z.object({
              field_name: z.string().describe('字段名称'),
              operator: z
                .enum([
                  'is',
                  'isNot',
                  'contains',
                  'doesNotContain',
                  'isEmpty',
                  'isNotEmpty',
                  'greater',
                  'greaterEqual',
                  'less',
                  'lessEqual',
                  'isAnyOf',
                  'isNoneOf',
                ])
                .describe('操作符'),
              value: z
                .any()
                .optional()
                .describe('字段值（根据操作符类型可以是字符串、数字、数组等）'),
            }),
          )
          .describe('过滤条件数组'),
      })
      .optional()
      .describe('过滤条件（可选）'),
    sort: z
      .array(
        z.object({
          field_name: z.string().describe('排序字段名'),
          desc: z.boolean().optional().describe('是否降序，默认 false'),
        }),
      )
      .optional()
      .describe('排序条件（可选）'),
    page_size: z
      .number()
      .optional()
      .describe('每页记录数（默认 20，最大 500）'),
    page_token: z.string().optional().describe('分页 token（用于获取下一页）'),
  },
  async (args) => {
    const options: any = {};
    if (args.view_id) options.view_id = args.view_id;
    if (args.filter) options.filter = args.filter;
    if (args.sort) options.sort = args.sort;
    if (args.page_size) options.pageSize = args.page_size;
    if (args.page_token) options.pageToken = args.page_token;

    const requestId = writeIpcFile(FEISHU_REQUESTS_DIR, {
      type: 'list_bitable_records',
      app_token: args.app_token,
      table_id: args.table_id,
      options,
      groupFolder,
      timestamp: new Date().toISOString(),
    });

    try {
      const result = await waitForFeishuResult(requestId);

      if (result.success) {
        const records = result.records || [];
        if (records.length === 0) {
          return {
            content: [{ type: 'text' as const, text: '数据表中没有记录。' }],
          };
        }

        const formatted = records
          .map((r: any, i: number) => {
            const fields = Object.entries(r.fields || {})
              .map(([k, v]) => `  ${k}: ${JSON.stringify(v)}`)
              .join('\n');
            return `${i + 1}. Record ID: ${r.record_id}\n${fields}`;
          })
          .join('\n\n');

        const hasMore = result.has_more
          ? `\n\n还有更多记录，使用 page_token: ${result.page_token}`
          : '';
        return {
          content: [
            {
              type: 'text' as const,
              text: `找到 ${records.length} 条记录:\n\n${formatted}${hasMore}`,
            },
          ],
        };
      } else {
        return {
          content: [
            { type: 'text' as const, text: `查询记录失败: ${result.error}` },
          ],
          isError: true,
        };
      }
    } catch (error) {
      return {
        content: [
          {
            type: 'text' as const,
            text: `查询记录超时或失败: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
        isError: true,
      };
    }
  },
);

server.tool(
  'feishu_list_bitable_fields',
  '获取多维表格数据表的字段列表。',
  {
    app_token: z.string().describe('多维表格应用 token'),
    table_id: z.string().describe('数据表 ID'),
  },
  async (args) => {
    const requestId = writeIpcFile(FEISHU_REQUESTS_DIR, {
      type: 'list_bitable_fields',
      app_token: args.app_token,
      table_id: args.table_id,
      groupFolder,
      timestamp: new Date().toISOString(),
    });

    try {
      const result = await waitForFeishuResult(requestId);

      if (result.success) {
        const fields = result.fields || [];
        if (!Array.isArray(fields) || fields.length === 0) {
          return {
            content: [{ type: 'text' as const, text: '数据表中没有字段。' }],
          };
        }

        const typeNames: Record<number, string> = {
          1: '文本',
          2: '数字',
          3: '单选',
          4: '多选',
          5: '日期',
          7: '复选框',
          11: '人员',
          15: '超链接',
          17: '附件',
          18: '关联',
          19: '公式',
          20: '双向关联',
          21: '位置',
          22: '群组',
          23: '条码',
          1001: '创建时间',
          1002: '修改时间',
          1003: '创建人',
          1004: '修改人',
          1005: '自动编号',
        };

        const formatted = (fields as any[])
          .map(
            (f: any) =>
              `- ${f.field_name} (${typeNames[f.type] || `类型${f.type}`})${f.field_id ? ` [${f.field_id}]` : ''}`,
          )
          .join('\n');

        return {
          content: [
            { type: 'text' as const, text: `字段列表:\n\n${formatted}` },
          ],
        };
      } else {
        return {
          content: [
            { type: 'text' as const, text: `获取字段失败: ${result.error}` },
          ],
          isError: true,
        };
      }
    } catch (error) {
      return {
        content: [
          {
            type: 'text' as const,
            text: `获取字段超时或失败: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
        isError: true,
      };
    }
  },
);

server.tool(
  'feishu_update_bitable_record',
  '更新多维表格数据表中的指定记录。',
  {
    app_token: z.string().describe('多维表格应用 token'),
    table_id: z.string().describe('数据表 ID'),
    record_id: z.string().describe('要更新的记录 ID'),
    fields: z
      .record(z.string(), z.any())
      .describe('要更新的字段值，key 为字段名，value 为新值'),
  },
  async (args) => {
    const requestId = writeIpcFile(FEISHU_REQUESTS_DIR, {
      type: 'update_bitable_record',
      app_token: args.app_token,
      table_id: args.table_id,
      record_id: args.record_id,
      fields: args.fields,
      groupFolder,
      timestamp: new Date().toISOString(),
    });

    try {
      const result = await waitForFeishuResult(requestId);

      if (result.success) {
        return {
          content: [
            { type: 'text' as const, text: `记录 ${args.record_id} 更新成功!` },
          ],
        };
      } else {
        return {
          content: [
            { type: 'text' as const, text: `更新记录失败: ${result.error}` },
          ],
          isError: true,
        };
      }
    } catch (error) {
      return {
        content: [
          {
            type: 'text' as const,
            text: `更新记录超时或失败: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
        isError: true,
      };
    }
  },
);

server.tool(
  'feishu_delete_bitable_record',
  '删除多维表格数据表中的指定记录。',
  {
    app_token: z.string().describe('多维表格应用 token'),
    table_id: z.string().describe('数据表 ID'),
    record_id: z.string().describe('要删除的记录 ID'),
  },
  async (args) => {
    const requestId = writeIpcFile(FEISHU_REQUESTS_DIR, {
      type: 'delete_bitable_record',
      app_token: args.app_token,
      table_id: args.table_id,
      record_id: args.record_id,
      groupFolder,
      timestamp: new Date().toISOString(),
    });

    try {
      const result = await waitForFeishuResult(requestId);

      if (result.success) {
        return {
          content: [
            { type: 'text' as const, text: `记录 ${args.record_id} 删除成功!` },
          ],
        };
      } else {
        return {
          content: [
            { type: 'text' as const, text: `删除记录失败: ${result.error}` },
          ],
          isError: true,
        };
      }
    } catch (error) {
      return {
        content: [
          {
            type: 'text' as const,
            text: `删除记录超时或失败: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
        isError: true,
      };
    }
  },
);

server.tool(
  'feishu_delete_doc',
  '删除飞书云文档。文档会被移到回收站，可以从回收站恢复。',
  {
    doc_id: z.string().describe('文档 ID 或完整 URL（支持自动解析）'),
  },
  async (args) => {
    const requestId = writeIpcFile(FEISHU_REQUESTS_DIR, {
      type: 'delete_doc',
      doc_id: args.doc_id,
      groupFolder,
      timestamp: new Date().toISOString(),
    });

    try {
      const result = await waitForFeishuResult(requestId);

      if (result.success) {
        return {
          content: [
            { type: 'text' as const, text: `文档删除成功! 文档已移到回收站。` },
          ],
        };
      } else {
        return {
          content: [
            { type: 'text' as const, text: `删除文档失败: ${result.error}` },
          ],
          isError: true,
        };
      }
    } catch (error) {
      return {
        content: [
          {
            type: 'text' as const,
            text: `删除文档超时或失败: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
        isError: true,
      };
    }
  },
);

server.tool(
  'feishu_delete_bitable',
  '删除整个多维表格。多维表格会被移到回收站，可以从回收站恢复。',
  {
    app_token: z.string().describe('多维表格应用 token'),
  },
  async (args) => {
    const requestId = writeIpcFile(FEISHU_REQUESTS_DIR, {
      type: 'delete_bitable',
      app_token: args.app_token,
      groupFolder,
      timestamp: new Date().toISOString(),
    });

    try {
      const result = await waitForFeishuResult(requestId);

      if (result.success) {
        return {
          content: [
            {
              type: 'text' as const,
              text: `多维表格删除成功! 多维表格已移到回收站。`,
            },
          ],
        };
      } else {
        return {
          content: [
            {
              type: 'text' as const,
              text: `删除多维表格失败: ${result.error}`,
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
            text: `删除多维表格超时或失败: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
        isError: true,
      };
    }
  },
);

// ==================== 云文档权限管理工具 ====================

server.tool(
  'feishu_add_collaborator',
  '添加飞书云文档或多维表格的协作者。可给用户或群组授予编辑、查看等权限。',
  {
    token: z.string().describe('文档/多维表格 token（从 URL 中提取）'),
    file_type: z
      .string()
      .describe('资源类型：docx, bitable, sheet, wiki, slides 等'),
    member_type: z.string().describe('成员标识类型：openid, userid, openchat'),
    member_id: z.string().describe('成员 ID：ou_xxx（用户）或 oc_xxx（群组）'),
    perm: z.string().describe('权限：full_access, edit, comment, view'),
    collaborator_type: z.string().describe('协作者类型：user 或 chat'),
  },
  async (args) => {
    const requestId = writeIpcFile(FEISHU_REQUESTS_DIR, {
      type: 'add_collaborator',
      token: args.token,
      file_type: args.file_type,
      member_type: args.member_type,
      member_id: args.member_id,
      perm: args.perm,
      collaborator_type: args.collaborator_type,
      groupFolder,
      timestamp: new Date().toISOString(),
    });

    try {
      const result = await waitForFeishuResult(requestId);
      if (result.success) {
        return {
          content: [
            {
              type: 'text' as const,
              text: `协作者添加成功!\n\n成员: ${args.member_id}\n权限: ${args.perm}`,
            },
          ],
        };
      } else {
        return {
          content: [
            { type: 'text' as const, text: `添加协作者失败: ${result.error}` },
          ],
          isError: true,
        };
      }
    } catch (error) {
      return {
        content: [
          {
            type: 'text' as const,
            text: `添加协作者超时或失败: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
        isError: true,
      };
    }
  },
);

server.tool(
  'feishu_update_collaborator',
  '更新飞书云文档或多维表格协作者的权限。',
  {
    token: z.string().describe('文档/多维表格 token'),
    file_type: z
      .string()
      .describe('资源类型：docx, bitable, sheet, wiki, slides 等'),
    member_id: z
      .string()
      .describe('协作者成员 ID（从 list_collaborators 获取）'),
    perm: z.string().describe('新权限：full_access, edit, comment, view'),
  },
  async (args) => {
    const requestId = writeIpcFile(FEISHU_REQUESTS_DIR, {
      type: 'update_collaborator',
      token: args.token,
      file_type: args.file_type,
      member_id: args.member_id,
      perm: args.perm,
      groupFolder,
      timestamp: new Date().toISOString(),
    });

    try {
      const result = await waitForFeishuResult(requestId);
      if (result.success) {
        return {
          content: [
            {
              type: 'text' as const,
              text: `协作者权限更新成功!\n\n成员 ID: ${args.member_id}\n新权限: ${args.perm}`,
            },
          ],
        };
      } else {
        return {
          content: [
            {
              type: 'text' as const,
              text: `更新协作者权限失败: ${result.error}`,
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
            text: `更新协作者权限超时或失败: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
        isError: true,
      };
    }
  },
);

server.tool(
  'feishu_list_collaborators',
  '列出飞书云文档或多维表格的所有协作者。',
  {
    token: z.string().describe('文档/多维表格 token'),
    file_type: z
      .string()
      .describe('资源类型：docx, bitable, sheet, wiki, slides 等'),
  },
  async (args) => {
    const requestId = writeIpcFile(FEISHU_REQUESTS_DIR, {
      type: 'list_collaborators',
      token: args.token,
      file_type: args.file_type,
      groupFolder,
      timestamp: new Date().toISOString(),
    });

    try {
      const result = await waitForFeishuResult(requestId);
      if (result.success) {
        const members = (result as any).members || [];
        if (members.length === 0) {
          return {
            content: [{ type: 'text' as const, text: '当前没有协作者。' }],
          };
        }
        const lines = members.map((m: any) => {
          const name = m.name || m.member_id || '未知';
          const perm = m.perm || '未知';
          const type = m.type || '未知';
          return `- ${name} (${type}, 权限: ${perm})`;
        });
        return {
          content: [
            {
              type: 'text' as const,
              text: `协作者列表 (${members.length} 人):\n${lines.join('\n')}`,
            },
          ],
        };
      } else {
        return {
          content: [
            {
              type: 'text' as const,
              text: `获取协作者列表失败: ${result.error}`,
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
            text: `获取协作者列表超时或失败: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
        isError: true,
      };
    }
  },
);

server.tool(
  'feishu_remove_collaborator',
  '删除飞书云文档或多维表格的协作者。',
  {
    token: z.string().describe('文档/多维表格 token'),
    file_type: z
      .string()
      .describe('资源类型：docx, bitable, sheet, wiki, slides 等'),
    member_id: z
      .string()
      .describe('协作者成员 ID（从 list_collaborators 获取）'),
  },
  async (args) => {
    const requestId = writeIpcFile(FEISHU_REQUESTS_DIR, {
      type: 'remove_collaborator',
      token: args.token,
      file_type: args.file_type,
      member_id: args.member_id,
      groupFolder,
      timestamp: new Date().toISOString(),
    });

    try {
      const result = await waitForFeishuResult(requestId);
      if (result.success) {
        return {
          content: [
            {
              type: 'text' as const,
              text: `协作者删除成功!\n\n成员 ID: ${args.member_id}`,
            },
          ],
        };
      } else {
        return {
          content: [
            { type: 'text' as const, text: `删除协作者失败: ${result.error}` },
          ],
          isError: true,
        };
      }
    } catch (error) {
      return {
        content: [
          {
            type: 'text' as const,
            text: `删除协作者超时或失败: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
        isError: true,
      };
    }
  },
);

server.tool(
  'feishu_transfer_owner',
  '转让飞书云文档或多维表格的所有者。Bot 必须是当前所有者或拥有管理权限。',
  {
    token: z.string().describe('文档/多维表格 token'),
    file_type: z
      .string()
      .describe('资源类型：docx, bitable, sheet, wiki, slides 等'),
    new_member_type: z.string().describe('新所有者标识类型：openid 或 userid'),
    new_member_id: z.string().describe('新所有者 ID（ou_xxx）'),
    remove_old_owner: z
      .boolean()
      .optional()
      .describe('是否移除原所有者（默认 false，原所有者保留 full_access）'),
    old_owner_perm: z
      .string()
      .optional()
      .describe(
        '原所有者保留的权限（默认 full_access，仅在 remove_old_owner=false 时有效）',
      ),
  },
  async (args) => {
    const requestId = writeIpcFile(FEISHU_REQUESTS_DIR, {
      type: 'transfer_owner',
      token: args.token,
      file_type: args.file_type,
      new_member_type: args.new_member_type,
      new_member_id: args.new_member_id,
      remove_old_owner: args.remove_old_owner || false,
      old_owner_perm: args.old_owner_perm,
      groupFolder,
      timestamp: new Date().toISOString(),
    });

    try {
      const result = await waitForFeishuResult(requestId);
      if (result.success) {
        return {
          content: [
            {
              type: 'text' as const,
              text: `所有者转让成功!\n\n新所有者: ${args.new_member_id}`,
            },
          ],
        };
      } else {
        return {
          content: [
            { type: 'text' as const, text: `转让所有者失败: ${result.error}` },
          ],
          isError: true,
        };
      }
    } catch (error) {
      return {
        content: [
          {
            type: 'text' as const,
            text: `转让所有者超时或失败: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
        isError: true,
      };
    }
  },
);

// ==================== 卡片消息工具 ====================

server.tool(
  'feishu_send_card',
  '发送飞书交互式卡片消息。卡片支持富文本、按钮等交互元素。',
  {
    chat_id: z
      .string()
      .optional()
      .describe('目标聊天 ID（可选，默认发送到当前会话）'),
    title: z.string().describe('卡片标题'),
    content: z.string().describe('卡片内容（支持 Markdown 格式）'),
    buttons: z
      .array(
        z.object({
          text: z.string().describe('按钮文字'),
          value: z.record(z.string(), z.any()).describe('按钮点击时返回的值'),
          style: z
            .enum(['default', 'primary', 'danger'])
            .optional()
            .describe(
              '按钮样式：default=默认, primary=主要(蓝色), danger=危险(红色)',
            ),
        }),
      )
      .optional()
      .describe('按钮列表（可选，最多4个）'),
  },
  async (args) => {
    // 构建卡片内容
    const cardContent: any = {
      config: {
        wide_screen_mode: true,
      },
      header: {
        title: {
          tag: 'plain_text',
          content: args.title,
        },
        template: 'blue',
      },
      elements: [
        {
          tag: 'markdown',
          content: args.content,
        },
      ],
    };

    // 添加按钮
    if (args.buttons && args.buttons.length > 0) {
      cardContent.elements.push({
        tag: 'action',
        actions: args.buttons.map((btn) => ({
          tag: 'button',
          text: {
            tag: 'plain_text',
            content: btn.text,
          },
          type: btn.style || 'default',
          value: btn.value,
        })),
      });
    }

    const requestId = writeIpcFile(FEISHU_REQUESTS_DIR, {
      type: 'send_card',
      chat_id: args.chat_id || chatJid.replace('feishu:', ''),
      card_content: cardContent,
      groupFolder,
      timestamp: new Date().toISOString(),
    });

    try {
      const result = await waitForFeishuResult(requestId);

      if (result.success) {
        return {
          content: [{ type: 'text' as const, text: '卡片消息发送成功!' }],
        };
      } else {
        return {
          content: [
            { type: 'text' as const, text: `发送卡片失败: ${result.error}` },
          ],
          isError: true,
        };
      }
    } catch (error) {
      return {
        content: [
          {
            type: 'text' as const,
            text: `发送卡片超时或失败: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
        isError: true,
      };
    }
  },
);

server.tool(
  'feishu_send_confirm_card',
  '发送确认卡片，包含确认和取消按钮。用户点击按钮后会触发回调，agent 可以根据用户选择执行相应操作。',
  {
    chat_id: z
      .string()
      .optional()
      .describe('目标聊天 ID（可选，默认发送到当前会话）'),
    title: z.string().describe('卡片标题'),
    content: z.string().describe('卡片内容（支持 Markdown 格式）'),
    confirm_text: z
      .string()
      .optional()
      .default('确认')
      .describe('确认按钮文字（默认"确认"）'),
    cancel_text: z
      .string()
      .optional()
      .default('取消')
      .describe('取消按钮文字（默认"取消"）'),
    action_key: z
      .string()
      .optional()
      .describe('动作标识（可选，用于区分不同的确认操作）'),
  },
  async (args) => {
    const actionKey = args.action_key || `confirm_${Date.now()}`;

    const cardContent: any = {
      config: {
        wide_screen_mode: true,
      },
      header: {
        title: {
          tag: 'plain_text',
          content: args.title,
        },
        template: 'blue',
      },
      elements: [
        {
          tag: 'markdown',
          content: args.content,
        },
        {
          tag: 'action',
          actions: [
            {
              tag: 'button',
              text: {
                tag: 'plain_text',
                content: args.confirm_text || '确认',
              },
              type: 'primary',
              value: { action: actionKey, confirmed: true },
            },
            {
              tag: 'button',
              text: {
                tag: 'plain_text',
                content: args.cancel_text || '取消',
              },
              type: 'default',
              value: { action: actionKey, confirmed: false },
            },
          ],
        },
      ],
    };

    const requestId = writeIpcFile(FEISHU_REQUESTS_DIR, {
      type: 'send_card',
      chat_id: args.chat_id || chatJid.replace('feishu:', ''),
      card_content: cardContent,
      groupFolder,
      timestamp: new Date().toISOString(),
    });

    try {
      const result = await waitForFeishuResult(requestId);

      if (result.success) {
        return {
          content: [
            {
              type: 'text' as const,
              text: '确认卡片发送成功! 等待用户选择...',
            },
          ],
        };
      } else {
        return {
          content: [
            {
              type: 'text' as const,
              text: `发送确认卡片失败: ${result.error}`,
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
            text: `发送确认卡片超时或失败: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
        isError: true,
      };
    }
  },
);

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

// ==================== 飞书任务工具 ====================

server.tool(
  'feishu_task_create',
  '创建飞书任务。可设置标题、描述、截止日期、执行人等。',
  {
    summary: z.string().describe('任务标题（必填）'),
    description: z.string().optional().describe('任务描述'),
    due: z
      .object({
        timestamp: z.string().describe('毫秒时间戳'),
        is_all_day: z.boolean().optional().describe('是否全天'),
      })
      .optional()
      .describe('截止日期'),
    members: z
      .array(
        z.object({
          id: z.string().describe('用户 open_id'),
          role: z
            .enum(['assignee', 'follower'])
            .describe('角色：assignee=执行人, follower=关注者'),
          type: z.string().describe('类型，通常为 user'),
        }),
      )
      .optional()
      .describe('成员列表'),
    tasklists: z
      .array(
        z.object({
          tasklist_guid: z.string().describe('任务列表 GUID'),
        }),
      )
      .optional()
      .describe('所属任务列表'),
  },
  async (args) => {
    const requestId = writeIpcFile(FEISHU_REQUESTS_DIR, {
      type: 'task_create',
      params: args,
      groupFolder,
      timestamp: new Date().toISOString(),
    });

    try {
      const result = await waitForFeishuResult(requestId);
      if (result.success) {
        const task = result.task || result;
        return {
          content: [
            {
              type: 'text' as const,
              text: `任务创建成功!\n\n标题: ${task.summary || args.summary}\n任务 ID: ${task.guid || task.id}\n链接: ${task.url || '(无链接)'}`,
            },
          ],
        };
      } else {
        return {
          content: [
            { type: 'text' as const, text: `创建任务失败: ${result.error}` },
          ],
          isError: true,
        };
      }
    } catch (error) {
      return {
        content: [
          {
            type: 'text' as const,
            text: `创建任务超时或失败: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
        isError: true,
      };
    }
  },
);

server.tool(
  'feishu_task_get',
  '获取飞书任务详情。',
  {
    task_id: z.string().describe('任务 GUID'),
  },
  async (args) => {
    const requestId = writeIpcFile(FEISHU_REQUESTS_DIR, {
      type: 'task_get',
      task_id: args.task_id,
      groupFolder,
      timestamp: new Date().toISOString(),
    });

    try {
      const result = await waitForFeishuResult(requestId);
      if (result.success) {
        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify(result.task || result, null, 2),
            },
          ],
        };
      } else {
        return {
          content: [
            { type: 'text' as const, text: `获取任务失败: ${result.error}` },
          ],
          isError: true,
        };
      }
    } catch (error) {
      return {
        content: [
          {
            type: 'text' as const,
            text: `获取任务超时或失败: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
        isError: true,
      };
    }
  },
);

server.tool(
  'feishu_task_update',
  '更新飞书任务。可修改标题、描述、截止日期等。',
  {
    task_id: z.string().describe('任务 GUID'),
    task: z
      .object({
        summary: z.string().optional().describe('新标题'),
        description: z.string().optional().describe('新描述'),
        due: z
          .object({
            timestamp: z.string(),
            is_all_day: z.boolean().optional(),
          })
          .optional()
          .describe('新截止日期'),
      })
      .describe('要更新的字段'),
    update_fields: z
      .array(z.string())
      .describe('指定更新的字段名，如 ["summary", "description", "due"]'),
  },
  async (args) => {
    const requestId = writeIpcFile(FEISHU_REQUESTS_DIR, {
      type: 'task_update',
      task_id: args.task_id,
      task: args.task,
      update_fields: args.update_fields,
      groupFolder,
      timestamp: new Date().toISOString(),
    });

    try {
      const result = await waitForFeishuResult(requestId);
      if (result.success) {
        return { content: [{ type: 'text' as const, text: `任务更新成功!` }] };
      } else {
        return {
          content: [
            { type: 'text' as const, text: `更新任务失败: ${result.error}` },
          ],
          isError: true,
        };
      }
    } catch (error) {
      return {
        content: [
          {
            type: 'text' as const,
            text: `更新任务超时或失败: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
        isError: true,
      };
    }
  },
);

server.tool(
  'feishu_task_complete',
  '标记飞书任务为已完成。',
  {
    task_id: z.string().describe('任务 GUID'),
  },
  async (args) => {
    const requestId = writeIpcFile(FEISHU_REQUESTS_DIR, {
      type: 'task_complete',
      task_id: args.task_id,
      groupFolder,
      timestamp: new Date().toISOString(),
    });

    try {
      const result = await waitForFeishuResult(requestId);
      if (result.success) {
        return { content: [{ type: 'text' as const, text: `任务已完成!` }] };
      } else {
        return {
          content: [
            { type: 'text' as const, text: `完成任务失败: ${result.error}` },
          ],
          isError: true,
        };
      }
    } catch (error) {
      return {
        content: [
          {
            type: 'text' as const,
            text: `完成任务超时或失败: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
        isError: true,
      };
    }
  },
);

server.tool(
  'feishu_task_reopen',
  '重新打开已完成的飞书任务。',
  {
    task_id: z.string().describe('任务 GUID'),
  },
  async (args) => {
    const requestId = writeIpcFile(FEISHU_REQUESTS_DIR, {
      type: 'task_reopen',
      task_id: args.task_id,
      groupFolder,
      timestamp: new Date().toISOString(),
    });

    try {
      const result = await waitForFeishuResult(requestId);
      if (result.success) {
        return {
          content: [{ type: 'text' as const, text: `任务已重新打开!` }],
        };
      } else {
        return {
          content: [
            { type: 'text' as const, text: `重开任务失败: ${result.error}` },
          ],
          isError: true,
        };
      }
    } catch (error) {
      return {
        content: [
          {
            type: 'text' as const,
            text: `重开任务超时或失败: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
        isError: true,
      };
    }
  },
);

server.tool(
  'feishu_task_search',
  '搜索飞书任务。支持按关键词、创建者、执行人、完成状态等条件搜索。使用 v1 API，Bot 身份可用。',
  {
    query: z.string().optional().describe('搜索关键词'),
    creator_ids: z.array(z.string()).optional().describe('创建者 open_id 列表'),
    assignee_ids: z
      .array(z.string())
      .optional()
      .describe('执行人 open_id 列表'),
    follower_ids: z
      .array(z.string())
      .optional()
      .describe('关注者 open_id 列表'),
    is_completed: z.boolean().optional().describe('是否已完成'),
    due_time: z
      .object({
        start: z.string().optional(),
        end: z.string().optional(),
      })
      .optional()
      .describe('截止日期范围'),
    page_size: z.number().optional().describe('每页数量，默认 20'),
    page_token: z.string().optional().describe('分页 token'),
  },
  async (args) => {
    const requestId = writeIpcFile(FEISHU_REQUESTS_DIR, {
      type: 'task_search',
      params: args,
      groupFolder,
      timestamp: new Date().toISOString(),
    });

    try {
      const result = await waitForFeishuResult(requestId);
      if (result.success) {
        const tasks = result.tasks || [];
        const total = result.total || tasks.length;
        const lines = tasks.map(
          (t: any, i: number) =>
            `${i + 1}. [${t.id || t.guid}] ${t.summary || t.title} (完成: ${t.complete_time ? '是' : '否'})`,
        );
        return {
          content: [
            {
              type: 'text' as const,
              text: `搜索到 ${total} 个任务:\n${lines.join('\n') || '(无结果)'}`,
            },
          ],
        };
      } else {
        return {
          content: [
            { type: 'text' as const, text: `搜索任务失败: ${result.error}` },
          ],
          isError: true,
        };
      }
    } catch (error) {
      return {
        content: [
          {
            type: 'text' as const,
            text: `搜索任务超时或失败: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
        isError: true,
      };
    }
  },
);

server.tool(
  'feishu_task_get_my_tasks',
  '获取分配给我的飞书任务列表。使用 v1 API，Bot 身份可用。',
  {
    page_size: z.number().optional().describe('每页数量，默认 20'),
    page_token: z.string().optional().describe('分页 token'),
    completed: z.boolean().optional().describe('是否已完成，不传则返回全部'),
  },
  async (args) => {
    const requestId = writeIpcFile(FEISHU_REQUESTS_DIR, {
      type: 'task_get_my_tasks',
      params: args,
      groupFolder,
      timestamp: new Date().toISOString(),
    });

    try {
      const result = await waitForFeishuResult(requestId);
      if (result.success) {
        const tasks = result.tasks || [];
        const total = result.total || tasks.length;
        const lines = tasks.map(
          (t: any, i: number) =>
            `${i + 1}. [${t.id || t.guid}] ${t.summary || t.title} (完成: ${t.complete_time ? '是' : '否'})`,
        );
        return {
          content: [
            {
              type: 'text' as const,
              text: `共 ${total} 个任务:\n${lines.join('\n') || '(无任务)'}`,
            },
          ],
        };
      } else {
        return {
          content: [
            {
              type: 'text' as const,
              text: `获取我的任务失败: ${result.error}`,
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
            text: `获取我的任务超时或失败: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
        isError: true,
      };
    }
  },
);

server.tool(
  'feishu_task_get_related_tasks',
  '获取与当前用户相关的飞书任务。使用 v1 API。',
  {
    page_size: z.number().optional().describe('每页数量，默认 20'),
    page_token: z.string().optional().describe('分页 token'),
  },
  async (args) => {
    const requestId = writeIpcFile(FEISHU_REQUESTS_DIR, {
      type: 'task_get_related_tasks',
      params: args,
      groupFolder,
      timestamp: new Date().toISOString(),
    });

    try {
      const result = await waitForFeishuResult(requestId);
      if (result.success) {
        const tasks = result.tasks || [];
        const total = result.total || tasks.length;
        const lines = tasks.map(
          (t: any, i: number) =>
            `${i + 1}. [${t.id || t.guid}] ${t.summary || t.title} (完成: ${t.complete_time ? '是' : '否'})`,
        );
        return {
          content: [
            {
              type: 'text' as const,
              text: `共 ${total} 个相关任务:\n${lines.join('\n') || '(无任务)'}`,
            },
          ],
        };
      } else {
        return {
          content: [
            {
              type: 'text' as const,
              text: `获取相关任务失败: ${result.error}`,
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
            text: `获取相关任务超时或失败: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
        isError: true,
      };
    }
  },
);

server.tool(
  'feishu_task_add_members',
  '给飞书任务添加成员（执行人或关注者）。',
  {
    task_id: z.string().describe('任务 GUID'),
    members: z
      .array(
        z.object({
          id: z.string().describe('用户 open_id'),
          role: z
            .enum(['assignee', 'follower'])
            .describe('角色：assignee=执行人, follower=关注者'),
          type: z.string().describe('类型，通常为 user'),
        }),
      )
      .describe('成员列表'),
  },
  async (args) => {
    const requestId = writeIpcFile(FEISHU_REQUESTS_DIR, {
      type: 'task_add_members',
      task_id: args.task_id,
      members: args.members,
      groupFolder,
      timestamp: new Date().toISOString(),
    });

    try {
      const result = await waitForFeishuResult(requestId);
      if (result.success) {
        return { content: [{ type: 'text' as const, text: `成员添加成功!` }] };
      } else {
        return {
          content: [
            { type: 'text' as const, text: `添加成员失败: ${result.error}` },
          ],
          isError: true,
        };
      }
    } catch (error) {
      return {
        content: [
          {
            type: 'text' as const,
            text: `添加成员超时或失败: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
        isError: true,
      };
    }
  },
);

server.tool(
  'feishu_task_remove_members',
  '移除飞书任务的成员。',
  {
    task_id: z.string().describe('任务 GUID'),
    members: z
      .array(
        z.object({
          id: z.string().describe('用户 open_id'),
          role: z.string().describe('角色'),
          type: z.string().describe('类型'),
        }),
      )
      .describe('要移除的成员列表'),
  },
  async (args) => {
    const requestId = writeIpcFile(FEISHU_REQUESTS_DIR, {
      type: 'task_remove_members',
      task_id: args.task_id,
      members: args.members,
      groupFolder,
      timestamp: new Date().toISOString(),
    });

    try {
      const result = await waitForFeishuResult(requestId);
      if (result.success) {
        return { content: [{ type: 'text' as const, text: `成员移除成功!` }] };
      } else {
        return {
          content: [
            { type: 'text' as const, text: `移除成员失败: ${result.error}` },
          ],
          isError: true,
        };
      }
    } catch (error) {
      return {
        content: [
          {
            type: 'text' as const,
            text: `移除成员超时或失败: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
        isError: true,
      };
    }
  },
);

server.tool(
  'feishu_task_add_reminders',
  '给飞书任务添加提醒。',
  {
    task_id: z.string().describe('任务 GUID'),
    reminders: z
      .array(
        z.object({
          relative_fire_minute: z
            .number()
            .optional()
            .describe('截止前多少分钟提醒'),
          absolute_time: z
            .string()
            .optional()
            .describe('绝对时间（毫秒时间戳）'),
          timezone: z.string().optional().describe('时区'),
        }),
      )
      .describe('提醒列表'),
  },
  async (args) => {
    const requestId = writeIpcFile(FEISHU_REQUESTS_DIR, {
      type: 'task_add_reminders',
      task_id: args.task_id,
      reminders: args.reminders,
      groupFolder,
      timestamp: new Date().toISOString(),
    });

    try {
      const result = await waitForFeishuResult(requestId);
      if (result.success) {
        return { content: [{ type: 'text' as const, text: `提醒添加成功!` }] };
      } else {
        return {
          content: [
            { type: 'text' as const, text: `添加提醒失败: ${result.error}` },
          ],
          isError: true,
        };
      }
    } catch (error) {
      return {
        content: [
          {
            type: 'text' as const,
            text: `添加提醒超时或失败: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
        isError: true,
      };
    }
  },
);

server.tool(
  'feishu_task_remove_reminders',
  '移除飞书任务的提醒。',
  {
    task_id: z.string().describe('任务 GUID'),
    reminder_ids: z.array(z.string()).describe('要移除的提醒 ID 列表'),
  },
  async (args) => {
    const requestId = writeIpcFile(FEISHU_REQUESTS_DIR, {
      type: 'task_remove_reminders',
      task_id: args.task_id,
      reminder_ids: args.reminder_ids,
      groupFolder,
      timestamp: new Date().toISOString(),
    });

    try {
      const result = await waitForFeishuResult(requestId);
      if (result.success) {
        return { content: [{ type: 'text' as const, text: `提醒移除成功!` }] };
      } else {
        return {
          content: [
            { type: 'text' as const, text: `移除提醒失败: ${result.error}` },
          ],
          isError: true,
        };
      }
    } catch (error) {
      return {
        content: [
          {
            type: 'text' as const,
            text: `移除提醒超时或失败: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
        isError: true,
      };
    }
  },
);

server.tool(
  'feishu_task_set_ancestor',
  '设置飞书任务的父任务（建立子任务关系）。',
  {
    task_id: z.string().describe('子任务 GUID'),
    ancestor_task_id: z
      .string()
      .optional()
      .describe('父任务 GUID，不传则取消父子关系'),
  },
  async (args) => {
    const requestId = writeIpcFile(FEISHU_REQUESTS_DIR, {
      type: 'task_set_ancestor',
      task_id: args.task_id,
      ancestor_task_id: args.ancestor_task_id,
      groupFolder,
      timestamp: new Date().toISOString(),
    });

    try {
      const result = await waitForFeishuResult(requestId);
      if (result.success) {
        return {
          content: [{ type: 'text' as const, text: `父子任务关系设置成功!` }],
        };
      } else {
        return {
          content: [
            { type: 'text' as const, text: `设置父任务失败: ${result.error}` },
          ],
          isError: true,
        };
      }
    } catch (error) {
      return {
        content: [
          {
            type: 'text' as const,
            text: `设置父任务超时或失败: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
        isError: true,
      };
    }
  },
);

server.tool(
  'feishu_task_comment',
  '给飞书任务添加评论。',
  {
    task_id: z.string().describe('任务 GUID'),
    content: z.string().describe('评论内容'),
  },
  async (args) => {
    const requestId = writeIpcFile(FEISHU_REQUESTS_DIR, {
      type: 'task_comment',
      task_id: args.task_id,
      content: args.content,
      groupFolder,
      timestamp: new Date().toISOString(),
    });

    try {
      const result = await waitForFeishuResult(requestId);
      if (result.success) {
        return { content: [{ type: 'text' as const, text: `评论添加成功!` }] };
      } else {
        return {
          content: [
            { type: 'text' as const, text: `添加评论失败: ${result.error}` },
          ],
          isError: true,
        };
      }
    } catch (error) {
      return {
        content: [
          {
            type: 'text' as const,
            text: `添加评论超时或失败: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
        isError: true,
      };
    }
  },
);

server.tool(
  'feishu_task_subscribe_event',
  '订阅飞书任务变更事件。',
  {
    task_id: z.string().describe('任务 GUID'),
    event_types: z
      .array(z.string())
      .describe('事件类型列表，如 ["task:updated", "task:completed"]'),
  },
  async (args) => {
    const requestId = writeIpcFile(FEISHU_REQUESTS_DIR, {
      type: 'task_subscribe_event',
      task_id: args.task_id,
      event_types: args.event_types,
      groupFolder,
      timestamp: new Date().toISOString(),
    });

    try {
      const result = await waitForFeishuResult(requestId);
      if (result.success) {
        return { content: [{ type: 'text' as const, text: `事件订阅成功!` }] };
      } else {
        return {
          content: [
            { type: 'text' as const, text: `订阅事件失败: ${result.error}` },
          ],
          isError: true,
        };
      }
    } catch (error) {
      return {
        content: [
          {
            type: 'text' as const,
            text: `订阅事件超时或失败: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
        isError: true,
      };
    }
  },
);

server.tool(
  'feishu_task_add_tasklist',
  '将飞书任务添加到任务列表。',
  {
    task_id: z.string().describe('任务 GUID'),
    tasklist_guid: z.string().describe('任务列表 GUID'),
  },
  async (args) => {
    const requestId = writeIpcFile(FEISHU_REQUESTS_DIR, {
      type: 'task_add_tasklist',
      task_id: args.task_id,
      tasklist_guid: args.tasklist_guid,
      groupFolder,
      timestamp: new Date().toISOString(),
    });

    try {
      const result = await waitForFeishuResult(requestId);
      if (result.success) {
        return {
          content: [{ type: 'text' as const, text: `任务已添加到列表!` }],
        };
      } else {
        return {
          content: [
            { type: 'text' as const, text: `添加到列表失败: ${result.error}` },
          ],
          isError: true,
        };
      }
    } catch (error) {
      return {
        content: [
          {
            type: 'text' as const,
            text: `添加到列表超时或失败: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
        isError: true,
      };
    }
  },
);

server.tool(
  'feishu_tasklist_create',
  '创建飞书任务列表。',
  {
    name: z.string().describe('列表名称'),
    members: z
      .array(
        z.object({
          id: z.string().describe('用户 open_id'),
          type: z.string().describe('类型，通常为 user'),
        }),
      )
      .optional()
      .describe('成员列表'),
  },
  async (args) => {
    const requestId = writeIpcFile(FEISHU_REQUESTS_DIR, {
      type: 'tasklist_create',
      params: args,
      groupFolder,
      timestamp: new Date().toISOString(),
    });

    try {
      const result = await waitForFeishuResult(requestId);
      if (result.success) {
        const tasklist = result.tasklist || result;
        return {
          content: [
            {
              type: 'text' as const,
              text: `任务列表创建成功!\n\n名称: ${tasklist.name || args.name}\n列表 ID: ${tasklist.guid || tasklist.id}`,
            },
          ],
        };
      } else {
        return {
          content: [
            {
              type: 'text' as const,
              text: `创建任务列表失败: ${result.error}`,
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
            text: `创建任务列表超时或失败: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
        isError: true,
      };
    }
  },
);

server.tool(
  'feishu_tasklist_get',
  '获取飞书任务列表详情。',
  {
    tasklist_id: z.string().describe('任务列表 GUID'),
  },
  async (args) => {
    const requestId = writeIpcFile(FEISHU_REQUESTS_DIR, {
      type: 'tasklist_get',
      tasklist_id: args.tasklist_id,
      groupFolder,
      timestamp: new Date().toISOString(),
    });

    try {
      const result = await waitForFeishuResult(requestId);
      if (result.success) {
        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify(result.tasklist || result, null, 2),
            },
          ],
        };
      } else {
        return {
          content: [
            {
              type: 'text' as const,
              text: `获取任务列表失败: ${result.error}`,
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
            text: `获取任务列表超时或失败: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
        isError: true,
      };
    }
  },
);

server.tool(
  'feishu_tasklist_search',
  '搜索飞书任务列表。',
  {
    query: z.string().optional().describe('搜索关键词'),
    page_size: z.number().optional().describe('每页数量，默认 20'),
    page_token: z.string().optional().describe('分页 token'),
  },
  async (args) => {
    const requestId = writeIpcFile(FEISHU_REQUESTS_DIR, {
      type: 'tasklist_search',
      params: args,
      groupFolder,
      timestamp: new Date().toISOString(),
    });

    try {
      const result = await waitForFeishuResult(requestId);
      if (result.success) {
        const items = result.tasklists || [];
        const lines = items.map(
          (t: any, i: number) => `${i + 1}. [${t.guid || t.id}] ${t.name}`,
        );
        return {
          content: [
            {
              type: 'text' as const,
              text: `搜索到 ${items.length} 个任务列表:\n${lines.join('\n') || '(无结果)'}`,
            },
          ],
        };
      } else {
        return {
          content: [
            {
              type: 'text' as const,
              text: `搜索任务列表失败: ${result.error}`,
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
            text: `搜索任务列表超时或失败: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
        isError: true,
      };
    }
  },
);

server.tool(
  'feishu_tasklist_add_members',
  '给飞书任务列表添加成员。',
  {
    tasklist_id: z.string().describe('任务列表 GUID'),
    members: z
      .array(
        z.object({
          id: z.string().describe('用户 open_id'),
          type: z.string().describe('类型，通常为 user'),
          role: z
            .enum(['editor', 'viewer'])
            .optional()
            .describe('角色：editor 或 viewer'),
        }),
      )
      .describe('成员列表'),
  },
  async (args) => {
    const requestId = writeIpcFile(FEISHU_REQUESTS_DIR, {
      type: 'tasklist_add_members',
      tasklist_id: args.tasklist_id,
      members: args.members,
      groupFolder,
      timestamp: new Date().toISOString(),
    });

    try {
      const result = await waitForFeishuResult(requestId);
      if (result.success) {
        return {
          content: [{ type: 'text' as const, text: `列表成员添加成功!` }],
        };
      } else {
        return {
          content: [
            {
              type: 'text' as const,
              text: `添加列表成员失败: ${result.error}`,
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
            text: `添加列表成员超时或失败: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
        isError: true,
      };
    }
  },
);

server.tool(
  'feishu_tasklist_remove_members',
  '移除飞书任务列表的成员。',
  {
    tasklist_id: z.string().describe('任务列表 GUID'),
    members: z
      .array(
        z.object({
          id: z.string().describe('用户 open_id'),
          type: z.string().describe('类型，通常为 user'),
        }),
      )
      .describe('要移除的成员列表'),
  },
  async (args) => {
    const requestId = writeIpcFile(FEISHU_REQUESTS_DIR, {
      type: 'tasklist_remove_members',
      tasklist_id: args.tasklist_id,
      members: args.members,
      groupFolder,
      timestamp: new Date().toISOString(),
    });

    try {
      const result = await waitForFeishuResult(requestId);
      if (result.success) {
        return {
          content: [{ type: 'text' as const, text: `列表成员移除成功!` }],
        };
      } else {
        return {
          content: [
            {
              type: 'text' as const,
              text: `移除列表成员失败: ${result.error}`,
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
            text: `移除列表成员超时或失败: ${error instanceof Error ? error.message : String(error)}`,
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
