// Same types as monitor, for consistency
export interface InstanceInfo {
  instanceId: string;
  hostname: string;
  version: string;
  startTime: string;
  mainGroup?: string;
  channels: string[];
  apiEndpoint?: string;
}

export interface ContainerInfo {
  containerId: string;
  name: string;
  groupFolder: string;
  chatJid: string;
  status: 'running' | 'exited';
  startTime: string;
  duration?: number;
}

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

export interface GroupInfo {
  jid: string;
  name: string;
  folder: string;
  isMain: boolean;
  trigger: string;
  requiresTrigger: boolean;
}

export interface SkillInfo {
  name: string;
  path: string;
  content: string;
}

export interface MemoryFile {
  name: string;
  path: string;
  content: string;
}