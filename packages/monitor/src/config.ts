import { AuthConfig } from './types.js';

export interface MonitorConfig {
  port: number;
  auth: AuthConfig;
  heartbeatTimeout: number;
  dataDir: string;
}

export function loadConfig(): MonitorConfig {
  const authTypeRaw = process.env.MONITOR_AUTH_TYPE || 'password';
  const validAuthTypes = ['password', 'token'] as const;
  if (!validAuthTypes.includes(authTypeRaw as typeof validAuthTypes[number])) {
    throw new Error(`Invalid MONITOR_AUTH_TYPE: ${authTypeRaw}. Must be one of: ${validAuthTypes.join(', ')}`);
  }
  const authType = authTypeRaw as 'password' | 'token';

  const config: MonitorConfig = {
    port: parseInt(process.env.MONITOR_PORT || '8080', 10),
    auth: {
      type: authType,
      adminUser: process.env.MONITOR_ADMIN_USER || 'admin',
      adminPassword: process.env.MONITOR_ADMIN_PASSWORD,
      token: process.env.MONITOR_AUTH_TOKEN,
    },
    heartbeatTimeout: parseInt(process.env.MONITOR_HEARTBEAT_TIMEOUT || '90', 10),
    dataDir: process.env.MONITOR_DATA_DIR || './data',
  };

  // Validate auth config
  if (config.auth.type === 'password' && !config.auth.adminPassword) {
    throw new Error('MONITOR_ADMIN_PASSWORD is required when MONITOR_AUTH_TYPE is "password"');
  }
  if (config.auth.type === 'token' && !config.auth.token) {
    throw new Error('MONITOR_AUTH_TOKEN is required when MONITOR_AUTH_TYPE is "token"');
  }

  return config;
}