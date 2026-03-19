/**
 * Feishu OAuth UAT (User Access Token)
 *
 * 飞书 OAuth 设备授权流程实现
 * 使用 HTTP 请求直接调用飞书 API
 */

import type { FeishuCredentials } from './types.js';
import { larkLogger } from './logger.js';

const log = larkLogger('oauth');

// 飞书 API 端点
const FEISHU_API_BASE = 'https://open.feishu.cn/open-apis/v1';

/**
 * 设备授权响应
 */
interface DeviceAuthResponse {
  device_code: string;
  user_code: string;
  verification_uri: string;
  expires_in: number;
  interval: number;
}

/**
 * Token 响应
 */
interface TokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
  refresh_token: string;
  scope: string;
}

/**
 * OAuth UAT 客户端
 */
export class FeishuOAuthClient {
  private appId: string;
  private appSecret: string;

  constructor(credentials: FeishuCredentials) {
    this.appId = credentials.appId;
    this.appSecret = credentials.appSecret;
  }

  /**
   * 步骤 1: 启动设备授权流程
   */
  async startDeviceAuth(): Promise<DeviceAuthResponse> {
    try {
      const response = await fetch(`${FEISHU_API_BASE}/authen/user_device_auth/create`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          app_id: this.appId,
          app_secret: this.appSecret,
        }),
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const data = await response.json() as { code?: number; msg?: string; data?: { device_code?: string; user_code?: string; expires_in?: number; interval?: number } };

      if (data.code !== 0) {
        throw new Error(`Failed to start device auth: ${data.msg}`);
      }

      const authData = data.data!;

      log.info(
        {
          deviceCode: authData.device_code,
          userCode: authData.user_code,
        },
        'Device auth started',
      );

      return {
        device_code: authData.device_code!,
        user_code: authData.user_code!,
        verification_uri: 'https://open.feishu.cn/device/activate/user',
        expires_in: authData.expires_in || 1800,
        interval: authData.interval || 5,
      };
    } catch (error) {
      log.error(
        { error: error instanceof Error ? error.message : String(error) },
        'Failed to start device auth',
      );
      throw error;
    }
  }

  /**
   * 步骤 2: 轮询获取 access_token
   */
  async pollAccessToken(
    deviceCode: string,
    options?: {
      maxAttempts?: number;
      interval?: number;
    },
  ): Promise<TokenResponse> {
    const maxAttempts = options?.maxAttempts || 60;
    const interval = options?.interval || 5;

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      try {
        log.debug({ attempt: attempt + 1, deviceCode }, 'Polling for access token');

        const response = await fetch(`${FEISHU_API_BASE}/authen/user_device_auth/poll`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            app_id: this.appId,
            app_secret: this.appSecret,
            device_code: deviceCode,
            grant_type: 'device_code',
          }),
        });

        if (!response.ok) {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        const data = await response.json() as { code?: number; msg?: string; data?: { access_token?: string; token_type?: string; expires_in?: number; refresh_token?: string; scope?: string } };

        if (data.code !== 0) {
          // 某些错误码表示需要继续等待
          if (data.code === 403 || data.code === 4001) {
            // 403: 等待用户授权
            // 4001: 设备码过期
            log.debug('Waiting for user to complete authorization...');
            await this.sleep(interval * 1000);
            continue;
          } else if (data.code === 4004) {
            throw new Error('Device code expired');
          }
        }

        // 成功获取 token
        if (data.code === 0 && data.data?.access_token) {
          const tokenData = data.data;

          log.info('Access token obtained successfully');

          return {
            access_token: tokenData.access_token!,
            token_type: tokenData.token_type || 'Bearer',
            expires_in: tokenData.expires_in || 7200,
            refresh_token: tokenData.refresh_token || '',
            scope: tokenData.scope || '',
          };
        }
      } catch (error) {
        // 网络错误或超时，继续轮询
        if (attempt < maxAttempts - 1) {
          log.warn({ attempt: attempt + 1, error: error instanceof Error ? error.message : String(error) }, 'Polling error, retrying...');
          await this.sleep(interval * 1000);
          continue;
        }
        log.error({ error: error instanceof Error ? error.message : String(error) }, 'Polling failed after all attempts');
        throw error;
      }
    }

    throw new Error('Authorization timeout - user did not complete authorization in time');
  }

  /**
   * 完整的 OAuth 流程：启动授权并等待用户完成
   */
  async authenticate(): Promise<{ credentials: FeishuCredentials; tokens: TokenResponse }> {
    // 步骤 1: 启动设备授权
    const deviceAuth = await this.startDeviceAuth();

    console.log('\n========================================');
    console.log('📱 飞书授权 - 请在浏览器中完成授权');
    console.log('========================================');
    console.log(`\n1. 访问验证页面:\n   ${deviceAuth.verification_uri}`);
    console.log(`\n2. 输入授权码:\n   ${deviceAuth.user_code}`);
    console.log(`\n授权码 ${deviceAuth.user_code} 有效期: ${Math.floor(deviceAuth.expires_in / 60)} 分钟`);
    console.log('\n提示: 请确保在飞书开放平台为您的应用启用了以下权限:');
    console.log('  - im:message (获取与发送消息)');
    console.log('  - im:message:send_as_bot (以机器人身份发送)');
    console.log('  - im:chat (访问聊天信息)');
    console.log('\n========================================\n');

    log.info({ userCode: deviceAuth.user_code }, 'Waiting for user authorization...');

    // 步骤 2: 轮询获取 access_token
    const tokens = await this.pollAccessToken(deviceAuth.device_code, {
      maxAttempts: Math.floor(deviceAuth.expires_in / 5),
      interval: deviceAuth.interval,
    });

    // 计算过期时间
    const expiresAt = new Date(Date.now() + tokens.expires_in * 1000).toISOString();

    // 更新凭证
    const updatedCredentials: FeishuCredentials = {
      appId: this.appId,
      appSecret: this.appSecret,
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token,
      expiresAt,
    };

    console.log('\n========================================');
    console.log('✅ 授权成功！');
    console.log(`Access Token 有效期: ${tokens.expires_in} 秒 (${Math.floor(tokens.expires_in / 60)} 分钟)`);
    console.log('========================================\n');

    return {
      credentials: updatedCredentials,
      tokens,
    };
  }

  /**
   * 辅助：睡眠函数
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
