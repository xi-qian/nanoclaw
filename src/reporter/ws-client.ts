import WebSocket from 'ws';
import os from 'os';
import { v4 as uuidv4 } from 'uuid';
import { MONITOR_URL, INSTANCE_ID, ASSISTANT_NAME } from '../config.js';
import { InstanceInfo, HeartbeatPayload, ContainerInfo } from './types.js';
import { logger } from '../logger.js';

let ws: WebSocket | null = null;
let instanceId: string;
let heartbeatInterval: NodeJS.Timeout | null = null;

// Callbacks for getting data
let getContainers: () => ContainerInfo[];
let getGroups: () => any[];
let getChannels: () => string[];

export interface ReporterOptions {
  instanceId?: string;
  mainGroup?: string;
  getContainers: () => ContainerInfo[];
  getGroups: () => any[];
  getChannels: () => string[];
}

export function startReporter(options: ReporterOptions): void {
  if (!MONITOR_URL) {
    logger.warn('Monitor URL not configured, reporter disabled');
    return;
  }

  instanceId = options.instanceId || INSTANCE_ID || uuidv4();
  getContainers = options.getContainers;
  getGroups = options.getGroups;
  getChannels = options.getChannels;

  connect(options.mainGroup);
}

function connect(mainGroup?: string): void {
  logger.info({ url: MONITOR_URL }, 'Reporter connecting to monitor...');

  ws = new WebSocket(MONITOR_URL);

  ws.on('open', () => {
    logger.info('Reporter connected to monitor');

    // Register
    const info: InstanceInfo = {
      instanceId,
      hostname: os.hostname(),
      version: process.env.npm_package_version || '1.0.0',
      startTime: new Date().toISOString(),
      mainGroup,
      channels: getChannels(),
      apiEndpoint: `http://localhost:${process.env.NANOCLAW_LOCAL_API_PORT || 3002}`,
    };

    ws!.send(JSON.stringify({ type: 'register', data: info }));

    // Start heartbeat
    startHeartbeat();
  });

  ws.on('message', (data: WebSocket.RawData) => {
    try {
      const message = JSON.parse(data.toString());
      handleMessage(message);
    } catch (err) {
      logger.error({ err }, 'Failed to parse monitor message');
    }
  });

  ws.on('close', () => {
    logger.warn('Reporter disconnected from monitor');
    stopHeartbeat();
    // Reconnect after 5 seconds
    setTimeout(() => connect(mainGroup), 5000);
  });

  ws.on('error', (err) => {
    logger.error({ err }, 'Reporter connection error');
  });
}

function startHeartbeat(): void {
  heartbeatInterval = setInterval(() => {
    if (!ws || ws.readyState !== WebSocket.OPEN) return;

    const payload: HeartbeatPayload = {
      instanceId,
      timestamp: new Date().toISOString(),
      status: 'running',
      containers: getContainers(),
    };

    ws.send(JSON.stringify({ type: 'heartbeat', data: payload }));
  }, 30000); // Every 30 seconds
}

function stopHeartbeat(): void {
  if (heartbeatInterval) {
    clearInterval(heartbeatInterval);
    heartbeatInterval = null;
  }
}

function handleMessage(message: any): void {
  const { type, requestId, data } = message;

  switch (type) {
    case 'register_ack':
      logger.info('Monitor acknowledged registration');
      break;

    case 'get_groups':
      handleGetGroups(requestId);
      break;

    case 'get_skills':
      handleGetSkills(requestId, data?.groupFolder);
      break;

    case 'get_memory':
      handleGetMemory(requestId, data?.groupFolder);
      break;

    case 'update_skill':
      handleUpdateSkill(requestId, data);
      break;

    case 'update_memory':
      handleUpdateMemory(requestId, data);
      break;

    case 'delete_memory':
      handleDeleteMemory(requestId, data);
      break;

    case 'restart':
      handleRestart(requestId);
      break;

    default:
      logger.warn({ type }, 'Unknown message from monitor');
  }
}

function sendResponse(
  requestId: string,
  success: boolean,
  data?: any,
  error?: string,
): void {
  if (!ws || ws.readyState !== WebSocket.OPEN) return;
  ws.send(JSON.stringify({ requestId, success, data, error }));
}

// Handlers - will be implemented in local-api.ts
function handleGetGroups(requestId: string): void {
  try {
    const groups = getGroups();
    sendResponse(requestId, true, groups);
  } catch (err) {
    sendResponse(requestId, false, undefined, (err as Error).message);
  }
}

function handleGetSkills(requestId: string, groupFolder?: string): void {
  // Import from local-api
  import('./local-api.js').then((api) => {
    try {
      const skills = api.getGroupSkills(groupFolder!);
      sendResponse(requestId, true, skills);
    } catch (err) {
      sendResponse(requestId, false, undefined, (err as Error).message);
    }
  });
}

function handleGetMemory(requestId: string, groupFolder?: string): void {
  import('./local-api.js').then((api) => {
    try {
      const memory = api.getGroupMemory(groupFolder!);
      sendResponse(requestId, true, memory);
    } catch (err) {
      sendResponse(requestId, false, undefined, (err as Error).message);
    }
  });
}

function handleUpdateSkill(requestId: string, data: any): void {
  import('./local-api.js').then((api) => {
    try {
      api.updateSkill(data.groupFolder, data.skillName, data.content);
      sendResponse(requestId, true);
    } catch (err) {
      sendResponse(requestId, false, undefined, (err as Error).message);
    }
  });
}

function handleUpdateMemory(requestId: string, data: any): void {
  import('./local-api.js').then((api) => {
    try {
      api.updateMemory(data.groupFolder, data.filename, data.content);
      sendResponse(requestId, true);
    } catch (err) {
      sendResponse(requestId, false, undefined, (err as Error).message);
    }
  });
}

function handleDeleteMemory(requestId: string, data: any): void {
  import('./local-api.js').then((api) => {
    try {
      api.deleteMemory(data.groupFolder, data.filename);
      sendResponse(requestId, true);
    } catch (err) {
      sendResponse(requestId, false, undefined, (err as Error).message);
    }
  });
}

function handleRestart(requestId: string): void {
  sendResponse(requestId, true, { message: 'Restarting...' });
  // Give time for response to be sent
  setTimeout(() => {
    process.exit(0); // systemd will restart
  }, 1000);
}

export function notifyContainerStarted(container: ContainerInfo): void {
  if (!ws || ws.readyState !== WebSocket.OPEN) return;
  ws.send(
    JSON.stringify({
      type: 'container_started',
      data: { instanceId, ...container },
    }),
  );
}

export function notifyContainerStopped(containerId: string): void {
  if (!ws || ws.readyState !== WebSocket.OPEN) return;
  ws.send(
    JSON.stringify({
      type: 'container_stopped',
      data: { instanceId, containerId },
    }),
  );
}

export function stopReporter(): void {
  stopHeartbeat();
  if (ws) {
    ws.close();
    ws = null;
  }
}
