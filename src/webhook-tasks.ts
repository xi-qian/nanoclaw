import fs from 'fs';
import http from 'http';

import { WEBHOOK_TASKS_CONFIG } from './config.js';
import { createTask } from './db.js';
import { logger } from './logger.js';
import { ScheduledTask } from './types.js';

const log = logger.child({ module: 'webhook-tasks' });

export interface WebhookTaskConfig {
  name: string;
  path: string;
  group_folder?: string;
  prompt: string;
  context_mode?: 'group' | 'isolated';
}

export interface WebhookTasksFile {
  tasks: WebhookTaskConfig[];
}

/**
 * Load webhook task definitions from the JSON config file.
 * Returns empty array if file doesn't exist or is invalid.
 */
export function loadWebhookTasks(): WebhookTaskConfig[] {
  try {
    if (!fs.existsSync(WEBHOOK_TASKS_CONFIG)) {
      return [];
    }
    const raw = fs.readFileSync(WEBHOOK_TASKS_CONFIG, 'utf-8');
    const data: WebhookTasksFile = JSON.parse(raw);
    return Array.isArray(data.tasks) ? data.tasks : [];
  } catch (err) {
    log.error({ err }, 'Failed to load webhook tasks config');
    return [];
  }
}

/**
 * Match a request URL path against configured webhook task paths.
 * Returns the matching task config, or undefined.
 */
export function matchWebhookTask(
  urlPath: string,
  tasks: WebhookTaskConfig[],
): WebhookTaskConfig | undefined {
  return tasks.find((t) => urlPath === t.path);
}

/**
 * Replace {paramName} placeholders in a prompt template with
 * values from the params object. Unmatched placeholders remain as-is.
 */
export function interpolatePrompt(
  template: string,
  params: Record<string, string>,
): string {
  return template.replace(/\{(\w+)\}/g, (match, key: string) => {
    return key in params ? params[key] : match;
  });
}

/**
 * Parse URL query parameters from a request URL string.
 */
export function parseQueryParams(urlStr: string): Record<string, string> {
  const params: Record<string, string> = {};
  const idx = urlStr.indexOf('?');
  if (idx === -1) return params;
  const qs = urlStr.slice(idx + 1);
  for (const pair of qs.split('&')) {
    const eqIdx = pair.indexOf('=');
    if (eqIdx === -1) continue;
    const key = decodeURIComponent(pair.slice(0, eqIdx));
    const value = decodeURIComponent(pair.slice(eqIdx + 1));
    params[key] = value;
  }
  return params;
}

/**
 * Extract just the path portion from a URL string (before the ?).
 */
export function extractPath(urlStr: string): string {
  const idx = urlStr.indexOf('?');
  return idx === -1 ? urlStr : urlStr.slice(0, idx);
}

export interface WebhookTaskDeps {
  getMainGroup: () => { jid: string; folder: string } | undefined;
  registeredGroups: () => Record<string, { folder: string }>;
}

/**
 * Handle an incoming webhook task HTTP request.
 * Reads config, matches route, interpolates prompt, creates a
 * one-shot ScheduledTask, and responds.
 */
export function handleWebhookTaskRequest(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  deps: WebhookTaskDeps,
): void {
  const urlStr = req.url || '/';
  const urlPath = extractPath(urlStr);
  const tasks = loadWebhookTasks();
  const task = matchWebhookTask(urlPath, tasks);

  if (!task) {
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: false, error: `Task not found: ${urlPath}` }));
    return;
  }

  // Resolve group_folder — default to main group
  let groupFolder = task.group_folder;
  let chatJid: string;
  if (!groupFolder) {
    const mainGroup = deps.getMainGroup();
    if (!mainGroup) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          ok: false,
          error: 'No main group configured and no group_folder specified',
        }),
      );
      return;
    }
    groupFolder = mainGroup.folder;
    chatJid = mainGroup.jid;
  } else {
    // Look up chat_jid from registered groups by folder
    const groups = deps.registeredGroups();
    const entry = Object.entries(groups).find(
      ([, g]) => g.folder === groupFolder,
    );
    if (!entry) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          ok: false,
          error: `Group folder not found: ${groupFolder}`,
        }),
      );
      return;
    }
    chatJid = entry[0];
  }

  // Interpolate prompt with URL query parameters
  const params = parseQueryParams(urlStr);
  const prompt = interpolatePrompt(task.prompt, params);

  // Create a one-shot task scheduled for now
  const now = new Date();
  const taskId = `webhook_${task.name}_${now.getTime()}`;

  const scheduledTask: Omit<ScheduledTask, 'last_run' | 'last_result'> = {
    id: taskId,
    group_folder: groupFolder,
    chat_jid: chatJid,
    prompt,
    schedule_type: 'once',
    schedule_value: now.toISOString(),
    context_mode: task.context_mode || 'group',
    next_run: now.toISOString(),
    status: 'active',
    created_at: now.toISOString(),
  };

  try {
    createTask(scheduledTask);
    log.info({ taskId, taskName: task.name, prompt }, 'Webhook task created');
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, taskId, message: 'Task triggered' }));
  } catch (err) {
    log.error({ err, taskName: task.name }, 'Failed to create webhook task');
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: false, error: 'Failed to trigger task' }));
  }
}
