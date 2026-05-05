import { ChildProcess } from 'child_process';
import { CronExpressionParser } from 'cron-parser';
import fs from 'fs';

import { ASSISTANT_NAME, SCHEDULER_POLL_INTERVAL, TIMEZONE } from './config.js';
import {
  runContainerAgent,
  writeTasksSnapshot,
} from './container-runner.js';
import {
  deleteSession,
  getAllTasks,
  getDueTasks,
  getMessagesSince,
  getTaskById,
  logTaskRun,
  storeMessage,
  updateTask,
  updateTaskAfterRun,
} from './db.js';
import { GroupQueue } from './group-queue.js';
import { resolveGroupFolderPath } from './group-folder.js';
import { logger } from './logger.js';
import { NewMessage, RegisteredGroup, ScheduledTask } from './types.js';

/**
 * Compute the next run time for a recurring task, anchored to the
 * task's scheduled time rather than Date.now() to prevent cumulative
 * drift on interval-based tasks.
 *
 * Co-authored-by: @community-pr-601
 */
export function computeNextRun(task: ScheduledTask): string | null {
  if (task.schedule_type === 'once') return null;

  const now = Date.now();

  if (task.schedule_type === 'cron') {
    const interval = CronExpressionParser.parse(task.schedule_value, {
      tz: TIMEZONE,
    });
    return interval.next().toISOString();
  }

  if (task.schedule_type === 'interval') {
    const ms = parseInt(task.schedule_value, 10);
    if (!ms || ms <= 0) {
      // Guard against malformed interval that would cause an infinite loop
      logger.warn(
        { taskId: task.id, value: task.schedule_value },
        'Invalid interval value',
      );
      return new Date(now + 60_000).toISOString();
    }
    // Anchor to the scheduled time, not now, to prevent drift.
    // Skip past any missed intervals so we always land in the future.
    let next = new Date(task.next_run!).getTime() + ms;
    while (next <= now) {
      next += ms;
    }
    return new Date(next).toISOString();
  }

  return null;
}

export interface SchedulerDependencies {
  registeredGroups: () => Record<string, RegisteredGroup>;
  getSessions: () => Record<string, string>;
  queue: GroupQueue;
  onProcess: (
    groupJid: string,
    proc: ChildProcess,
    containerName: string,
    groupFolder: string,
  ) => void;
  sendMessage: (jid: string, text: string) => Promise<void>;
  processMessages: (
    group: RegisteredGroup,
    chatJid: string,
    messages: NewMessage[],
  ) => Promise<{ status: 'success' | 'error'; outputSentToUser: boolean }>;
  getLastAgentTimestamp: (chatJid: string) => string;
}

async function runTask(
  task: ScheduledTask,
  deps: SchedulerDependencies,
): Promise<void> {
  const startTime = Date.now();
  let groupDir: string;
  try {
    groupDir = resolveGroupFolderPath(task.group_folder);
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    updateTask(task.id, { status: 'paused' });
    logger.error(
      { taskId: task.id, groupFolder: task.group_folder, error },
      'Task has invalid group folder',
    );
    logTaskRun({
      task_id: task.id,
      run_at: new Date().toISOString(),
      duration_ms: Date.now() - startTime,
      status: 'error',
      result: null,
      error,
    });
    return;
  }
  fs.mkdirSync(groupDir, { recursive: true });

  logger.info(
    { taskId: task.id, group: task.group_folder, mode: task.context_mode },
    'Running scheduled task',
  );

  const groups = deps.registeredGroups();
  const group = Object.values(groups).find(
    (g) => g.folder === task.group_folder,
  );

  if (!group) {
    logger.error(
      { taskId: task.id, groupFolder: task.group_folder },
      'Group not found for task',
    );
    logTaskRun({
      task_id: task.id,
      run_at: new Date().toISOString(),
      duration_ms: Date.now() - startTime,
      status: 'error',
      result: null,
      error: `Group not found: ${task.group_folder}`,
    });
    return;
  }

  const isMain = group.isMain === true;

  // Update tasks snapshot for container to read
  const tasks = getAllTasks();
  writeTasksSnapshot(
    task.group_folder,
    isMain,
    tasks.map((t) => ({
      id: t.id,
      groupFolder: t.group_folder,
      prompt: t.prompt,
      schedule_type: t.schedule_type,
      schedule_value: t.schedule_value,
      status: t.status,
      next_run: t.next_run,
    })),
  );

  let result: string | null = null;
  let error: string | null = null;

  try {
    if (task.context_mode === 'group') {
      // --- Unified path: synthetic message + history + shared helper ---
      const taskMessage: NewMessage = {
        id: `task_${task.id}_${Date.now()}`,
        chat_jid: task.chat_jid,
        sender: 'system',
        sender_name: 'Scheduled Task',
        content: task.prompt,
        timestamp: new Date().toISOString(),
        is_from_me: true,
        scheduled_task_id: task.id,
      };
      storeMessage(taskMessage);

      const sinceTimestamp = deps.getLastAgentTimestamp(task.chat_jid);
      const historyMessages = getMessagesSince(
        task.chat_jid,
        sinceTimestamp,
        ASSISTANT_NAME,
      );
      const allMessages = [...historyMessages, taskMessage];

      const { status } = await deps.processMessages(
        group,
        task.chat_jid,
        allMessages,
      );

      if (status === 'error') {
        error = 'Agent processing failed';
      }
    } else {
      // --- Isolated path: direct runAgent, fresh session, no history ---
      const output = await runContainerAgent(
        group,
        {
          prompt: task.prompt,
          groupFolder: task.group_folder,
          chatJid: task.chat_jid,
          isMain,
          assistantName: ASSISTANT_NAME,
        },
        (proc, containerName) =>
          deps.onProcess(task.chat_jid, proc, containerName, task.group_folder),
        async (streamedOutput) => {
          if (streamedOutput.result) {
            result = streamedOutput.result;
            await deps.sendMessage(task.chat_jid, streamedOutput.result);
          }
          if (streamedOutput.status === 'success') {
            deps.queue.notifyIdle(task.chat_jid);
          }
          if (streamedOutput.status === 'error') {
            error = streamedOutput.error || 'Unknown error';
            if (streamedOutput.error?.includes('No conversation found')) {
              deleteSession(task.group_folder);
            }
          }
        },
      );

      if (output.status === 'error') {
        error = output.error || 'Unknown error';
        if (output.error?.includes('No conversation found')) {
          deleteSession(task.group_folder);
        }
      } else if (output.result) {
        result = output.result;
      }
    }

    logger.info(
      { taskId: task.id, durationMs: Date.now() - startTime },
      'Task completed',
    );
  } catch (err) {
    error = err instanceof Error ? err.message : String(err);
    logger.error({ taskId: task.id, error }, 'Task failed');
  }

  const durationMs = Date.now() - startTime;

  logTaskRun({
    task_id: task.id,
    run_at: new Date().toISOString(),
    duration_ms: durationMs,
    status: error ? 'error' : 'success',
    result,
    error,
  });

  const nextRun = computeNextRun(task);
  const resultSummary = error
    ? `Error: ${error}`
    : result
      ? result.slice(0, 200)
      : 'Completed';
  updateTaskAfterRun(task.id, nextRun, resultSummary);
}

let schedulerRunning = false;

export function startSchedulerLoop(deps: SchedulerDependencies): void {
  if (schedulerRunning) {
    logger.debug('Scheduler loop already running, skipping duplicate start');
    return;
  }
  schedulerRunning = true;
  logger.info('Scheduler loop started');

  const loop = async () => {
    try {
      const dueTasks = getDueTasks();
      if (dueTasks.length > 0) {
        logger.info({ count: dueTasks.length }, 'Found due tasks');
      }

      for (const task of dueTasks) {
        // Re-check task status in case it was paused/cancelled
        const currentTask = getTaskById(task.id);
        if (!currentTask || currentTask.status !== 'active') {
          continue;
        }

        deps.queue.enqueueTask(currentTask.chat_jid, currentTask.id, () =>
          runTask(currentTask, deps),
        );
      }
    } catch (err) {
      logger.error({ err }, 'Error in scheduler loop');
    }

    setTimeout(loop, SCHEDULER_POLL_INTERVAL);
  };

  loop();
}

/** @internal - for tests only. */
export function _resetSchedulerLoopForTests(): void {
  schedulerRunning = false;
}
