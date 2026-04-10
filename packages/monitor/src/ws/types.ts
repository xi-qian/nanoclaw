// WebSocket message types

// Instance -> Monitor messages
export type ClientMessageType = 'register' | 'heartbeat' | 'container_started' | 'container_stopped';

export interface ClientMessage {
  type: ClientMessageType;
  data: any;
}

// Register message
export interface RegisterMessage {
  type: 'register';
  data: {
    instanceId: string;
    hostname: string;
    version: string;
    startTime: string;
    mainGroup?: string;
    channels: string[];
    apiEndpoint?: string;
  };
}

// Heartbeat message
export interface HeartbeatMessage {
  type: 'heartbeat';
  data: {
    instanceId: string;
    timestamp: string;
    status: 'running' | 'idle' | 'error';
    containers: any[];
    resources?: {
      memoryUsed: number;
      cpuPercent: number;
    };
  };
}

// Container event messages
export interface ContainerEventMessage {
  type: 'container_started' | 'container_stopped';
  data: {
    instanceId: string;
    containerId: string;
    name?: string;
    groupFolder?: string;
    chatJid?: string;
    status: 'running' | 'exited';
    startTime?: string;
  };
}

// Monitor -> Instance messages
export type ServerMessageType = 'get_groups' | 'get_skills' | 'get_memory' | 'restart' | 'stop_container';

export interface ServerMessage {
  type: ServerMessageType;
  requestId: string;
  data?: any;
}

// Response from instance
export interface InstanceResponse {
  requestId: string;
  success: boolean;
  data?: any;
  error?: string;
}