import { AuthConfig } from './types.js';

export interface MonitorConfig {
  port: number;
  auth: AuthConfig;
  heartbeatTimeout: number;
  dataDir: string;
}

export function loadConfig(): MonitorConfig {
  return {
    port: parseInt(process.env.MONITOR_PORT || '8080', 10),
    auth: {
      type: (process.env.MONITOR_AUTH_TYPE as 'password' | 'token') || 'password',
      adminUser: process.env.MONITOR_ADMIN_USER || 'admin',
      adminPassword: process.env.MONITOR_ADMIN_PASSWORD,
      token: process.env.MONITOR_AUTH_TOKEN,
    },
    heartbeatTimeout: parseInt(process.env.MONITOR_HEARTBEAT_TIMEOUT || '90', 10),
    dataDir: process.env.MONITOR_DATA_DIR || './data',
  };
}