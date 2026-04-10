// Instance information
export interface InstanceInfo {
  instanceId: string;
  hostname: string;
  version: string;
  startTime: string;
  mainGroup?: string;
  channels: string[];
  status: 'running' | 'idle' | 'error';
  lastHeartbeat: string;
  apiEndpoint?: string;
}

// Heartbeat payload
export interface HeartbeatPayload {
  instanceId: string;
  timestamp: string;
  status: 'running' | 'idle' | 'error';
  containers: ContainerInfo[];
  resources?: {
    memoryUsed: number;
    cpuPercent: number;
  };
}

// Container info
export interface ContainerInfo {
  containerId: string;
  name: string;
  groupFolder: string;
  chatJid: string;
  status: 'running' | 'exited';
  startTime: string;
  duration?: number;
}

// Group info
export interface GroupInfo {
  jid: string;
  name: string;
  folder: string;
  isMain: boolean;
  trigger: string;
  requiresTrigger: boolean;
}

// Skill info
export interface SkillInfo {
  name: string;
  path: string;
  content: string;
}

// Memory file
export interface MemoryFile {
  name: string;
  path: string;
  content: string;
}

// Cached data
export interface CachedData {
  instanceId: string;
  type: 'skills' | 'memory' | 'groups';
  groupFolder?: string;
  data: unknown;
  cachedAt: string;
}

// Auth config
export interface AuthConfig {
  type: 'password' | 'token';
  adminUser?: string;
  adminPassword?: string;
  token?: string;
}