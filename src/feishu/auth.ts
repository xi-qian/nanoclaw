/**
 * Feishu Authentication
 *
 * 飞书认证和凭证管理
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import path from 'path';
import { larkLogger } from './logger.js';

const log = larkLogger('auth');

const AUTH_DIR = path.join(process.cwd(), 'store', 'auth', 'feishu');
const AUTH_FILE = path.join(AUTH_DIR, 'credentials.json');

/**
 * 确保认证目录存在
 */
function ensureAuthDir(): void {
  if (!existsSync(AUTH_DIR)) {
    mkdirSync(AUTH_DIR, { recursive: true });
    log.info({ path: AUTH_DIR }, 'Created auth directory');
  }
}

/**
 * 飞书凭证接口
 */
export interface FeishuCredentials {
  appId: string;
  appSecret: string;
  accessToken?: string;
  refreshToken?: string;
  expiresAt?: string;
  tenantKey?: string;
}

/**
 * 加载飞书凭证
 */
export function loadCredentials(): FeishuCredentials | null {
  try {
    if (!existsSync(AUTH_FILE)) {
      log.warn({ path: AUTH_FILE }, 'Credentials file not found');
      return null;
    }

    const content = readFileSync(AUTH_FILE, 'utf-8');
    const credentials: FeishuCredentials = JSON.parse(content);

    log.info({ appId: credentials.appId }, 'Credentials loaded');

    // 检查 token 是否过期
    if (credentials.expiresAt) {
      const expiresAt = new Date(credentials.expiresAt);
      const now = new Date();
      if (expiresAt <= now) {
        log.warn({ expiresAt: credentials.expiresAt }, 'Access token expired');
        // TODO: 实现刷新逻辑
      }
    }

    return credentials;
  } catch (error) {
    log.error({ error: error instanceof Error ? error.message : String(error) }, 'Failed to load credentials');
    return null;
  }
}

/**
 * 保存飞书凭证
 */
export function saveCredentials(credentials: FeishuCredentials): void {
  try {
    ensureAuthDir();

    const content = JSON.stringify(credentials, null, 2);
    writeFileSync(AUTH_FILE, content, 'utf-8');

    log.info({ appId: credentials.appId }, 'Credentials saved');
  } catch (error) {
    log.error({ error: error instanceof Error ? error.message : String(error) }, 'Failed to save credentials');
    throw error;
  }
}

/**
 * 检查是否已配置凭证
 */
export function hasCredentials(): boolean {
  return existsSync(AUTH_FILE);
}
