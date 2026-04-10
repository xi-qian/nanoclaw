import { WebSocket, WebSocketServer } from 'ws';
import {
  upsertInstance,
  updateInstanceHeartbeat,
  setInstanceOffline,
  getDb,
} from '../db/index.js';
import {
  ClientMessage,
  RegisterMessage,
  HeartbeatMessage,
  ContainerEventMessage,
  ServerMessage,
  InstanceResponse,
} from './types.js';

// Active connections: instanceId -> WebSocket
const connections = new Map<string, WebSocket>();

// Pending requests: requestId -> { resolve, reject, timeout }
const pendingRequests = new Map<
  string,
  { resolve: (value: any) => void; reject: (err: Error) => void; timeout: NodeJS.Timeout }
>();

let wss: WebSocketServer | null = null;

export function createWebSocketServer(port: number): WebSocketServer {
  wss = new WebSocketServer({ port });

  wss.on('connection', (ws, req) => {
    let instanceId: string | null = null;

    console.log('[WS] New connection from', req.socket.remoteAddress);

    ws.on('message', (data) => {
      try {
        const rawMessage = JSON.parse(data.toString());
        // Check if this is a response (has requestId instead of type)
        if (rawMessage.requestId !== undefined) {
          handleInstanceResponse(rawMessage as InstanceResponse);
        } else {
          const message: ClientMessage = rawMessage;
          handleMessage(ws, message, (id) => { instanceId = id; });
        }
      } catch (err) {
        console.error('[WS] Failed to parse message:', err);
      }
    });

    ws.on('close', () => {
      if (instanceId) {
        console.log('[WS] Instance disconnected:', instanceId);
        connections.delete(instanceId);
        setInstanceOffline(instanceId);
      }
    });

    ws.on('error', (err) => {
      console.error('[WS] Connection error:', err);
    });
  });

  console.log('[WS] WebSocket server listening on port', port);
  return wss;
}

function handleMessage(
  ws: WebSocket,
  message: ClientMessage,
  setInstanceId: (id: string) => void
): void {
  switch (message.type) {
    case 'register':
      handleRegister(ws, message as RegisterMessage, setInstanceId);
      break;
    case 'heartbeat':
      handleHeartbeat(message as HeartbeatMessage);
      break;
    case 'container_started':
    case 'container_stopped':
      handleContainerEvent(message as ContainerEventMessage);
      break;
    default:
      console.warn('[WS] Unknown message type:', message.type);
  }
}

function handleRegister(
  ws: WebSocket,
  message: RegisterMessage,
  setInstanceId: (id: string) => void
): void {
  const { instanceId, hostname, version, startTime, mainGroup, channels, apiEndpoint } = message.data;

  console.log('[WS] Instance registering:', instanceId, hostname);

  // Store in database
  upsertInstance({
    instanceId,
    hostname,
    version,
    startTime,
    mainGroup,
    channels,
    apiEndpoint,
  });

  // Track connection
  connections.set(instanceId, ws);
  setInstanceId(instanceId);

  // Send acknowledgment
  ws.send(JSON.stringify({ type: 'register_ack', success: true }));
}

function handleHeartbeat(message: HeartbeatMessage): void {
  const { instanceId, status, containers } = message.data;
  updateInstanceHeartbeat(instanceId, status, containers);
}

function handleContainerEvent(message: ContainerEventMessage): void {
  const { instanceId, containerId, name, groupFolder, chatJid, status, startTime } = message.data;

  // Update container in database
  const stmt = getDb().prepare(`
    INSERT INTO containers (container_id, instance_id, name, group_folder, chat_jid, status, start_time, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(container_id) DO UPDATE SET
      name = excluded.name,
      group_folder = excluded.group_folder,
      chat_jid = excluded.chat_jid,
      status = excluded.status,
      start_time = excluded.start_time,
      updated_at = CURRENT_TIMESTAMP
  `);
  stmt.run(containerId, instanceId, name, groupFolder, chatJid, status, startTime || null);

  console.log('[WS] Container event:', status, containerId, 'on', instanceId);
}

// Send request to instance and wait for response
export async function sendToInstance<T>(
  instanceId: string,
  message: ServerMessage,
  timeoutMs: number = 30000
): Promise<T> {
  const ws = connections.get(instanceId);
  if (!ws || ws.readyState !== WebSocket.OPEN) {
    throw new Error(`Instance ${instanceId} not connected`);
  }

  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      pendingRequests.delete(message.requestId);
      reject(new Error(`Request ${message.requestId} timed out`));
    }, timeoutMs);

    pendingRequests.set(message.requestId, {
      resolve: (value) => {
        clearTimeout(timeout);
        pendingRequests.delete(message.requestId);
        resolve(value);
      },
      reject: (err) => {
        clearTimeout(timeout);
        pendingRequests.delete(message.requestId);
        reject(err);
      },
      timeout,
    });

    ws.send(JSON.stringify(message));
  });
}

// Handle response from instance
export function handleInstanceResponse(response: InstanceResponse): void {
  const pending = pendingRequests.get(response.requestId);
  if (!pending) {
    console.warn('[WS] Received response for unknown request:', response.requestId);
    return;
  }

  if (response.success) {
    pending.resolve(response.data);
  } else {
    pending.reject(new Error(response.error || 'Unknown error'));
  }
}

// Check if instance is connected
export function isInstanceConnected(instanceId: string): boolean {
  const ws = connections.get(instanceId);
  return ws !== undefined && ws.readyState === WebSocket.OPEN;
}

// Get all connected instance IDs
export function getConnectedInstanceIds(): string[] {
  return Array.from(connections.entries())
    .filter(([_, ws]) => ws.readyState === WebSocket.OPEN)
    .map(([id]) => id);
}