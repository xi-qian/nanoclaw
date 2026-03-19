/**
 * Feishu/Lark Client with WebSocket Support
 *
 * 飞书 SDK 客户端封装，支持 WebSocket 长连接
 * 使用 HTTP 请求直接调用飞书 API
 */

import * as Lark from '@larksuiteoapi/node-sdk';
import type { FeishuCredentials, FeishuDocInfo, CreateDocOptions, LarkBrand, FeishuDocSearchResult } from './types.js';
import type { FeishuEvent } from './types.js';
import { larkLogger } from './logger.js';

const log = larkLogger('client');

/**
 * 品牌到 SDK domain 的映射
 */
const BRAND_TO_DOMAIN: Record<LarkBrand, Lark.Domain> = {
  feishu: Lark.Domain.Feishu,
  lark: Lark.Domain.Lark,
};

/**
 * 事件处理器类型
 */
export type EventHandler = (event: FeishuEvent) => void;

/**
 * 飞书客户端类
 */
export class FeishuClient {
  private client: Lark.Client;
  private wsClient: any = null; // WSClient 类型待确认
  private brand: LarkBrand;
  private credentials: FeishuCredentials;
  private eventHandlers: Map<string, EventHandler[]> = new Map();

  constructor(credentials: FeishuCredentials, brand: LarkBrand = 'feishu') {
    this.credentials = credentials;
    this.brand = brand;

    this.client = new Lark.Client({
      appId: credentials.appId,
      appSecret: credentials.appSecret,
      domain: BRAND_TO_DOMAIN[brand],
    });

    log.info({ brand, appId: credentials.appId }, 'Feishu client created');
  }

  /**
   * 建立 WebSocket 长连接
   */
  async connect(): Promise<void> {
    if (!this.credentials.accessToken) {
      throw new Error('Access token not available. Please complete OAuth authentication first.');
    }

    try {
      log.info('Starting WebSocket connection...');

      // 创建 WebSocket 客户端
      // 注意：根据 SDK 版本，API 可能有所不同
      this.wsClient = new Lark.WSClient({
        appId: this.credentials.appId,
        appSecret: this.credentials.appSecret,
        domain: BRAND_TO_DOMAIN[this.brand],
      });

      // TODO: 设置事件监听器
      // 由于 SDK API 可能不同，这里先做基础连接

      // 启动 WebSocket 连接
      await this.wsClient.start();

      log.info('Feishu WebSocket client connected');
    } catch (error) {
      log.error({ error: error instanceof Error ? error.message : String(error) }, 'Failed to connect WebSocket');

      // 提供更详细的错误信息
      if (error instanceof Error) {
        log.error('WebSocket connection failed. This may require:');
        log.error('1. Valid access_token (run OAuth authentication first)');
        log.error('2. Network connectivity');
        log.error('3. Correct App ID and App Secret');
      }
      throw error;
    }
  }

  /**
   * 注册事件处理器
   */
  on(eventType: string, handler: EventHandler): void {
    if (!this.eventHandlers.has(eventType)) {
      this.eventHandlers.set(eventType, []);
    }
    this.eventHandlers.get(eventType)!.push(handler);
    log.debug({ eventType, handlerCount: this.eventHandlers.get(eventType)!.length }, 'Event handler registered');
  }

  /**
   * 触发事件处理器
   */
  private emit(eventType: string, event: FeishuEvent): void {
    const handlers = this.eventHandlers.get(eventType);
    if (handlers) {
      for (const handler of handlers) {
        try {
          handler(event);
        } catch (error) {
          log.error({ eventType, error: error instanceof Error ? error.message : String(error) }, 'Event handler error');
        }
      }
    }
  }

  /**
   * 发送消息
   */
  async sendMessage(chatId: string, text: string): Promise<void> {
    try {
      const response = await this.client.im.message.create({
        params: {
          receive_id_type: 'chat_id',
        },
        data: {
          receive_id: chatId,
          msg_type: 'text',
          content: JSON.stringify({ text }),
        },
      });

      if (response.code === 0) {
        log.debug({ chatId, messageId: response.data?.message_id }, 'Message sent');
      } else {
        throw new Error(`Failed to send message: ${response.msg}`);
      }
    } catch (error) {
      log.error({ chatId, error: error instanceof Error ? error.message : String(error) }, 'Failed to send message');
      throw error;
    }
  }

  /**
   * 发送富文本消息
   */
  async sendRichText(chatId: string, elements: any[]): Promise<void> {
    try {
      const response = await this.client.im.message.create({
        params: {
          receive_id_type: 'chat_id',
        },
        data: {
          receive_id: chatId,
          msg_type: 'post',
          content: JSON.stringify({
            post: {
              zh_cn: elements,
            },
          }),
        },
      });

      if (response.code === 0) {
        log.debug({ chatId, messageId: response.data?.message_id }, 'Rich text message sent');
      } else {
        throw new Error(`Failed to send rich text: ${response.msg}`);
      }
    } catch (error) {
      log.error({ chatId, error: error instanceof Error ? error.message : String(error) }, 'Failed to send rich text');
      throw error;
    }
  }

  /**
   * 发送交互式卡片
   */
  async sendCard(chatId: string, cardContent: any): Promise<void> {
    try {
      const response = await this.client.im.message.create({
        params: {
          receive_id_type: 'chat_id',
        },
        data: {
          receive_id: chatId,
          msg_type: 'interactive',
          content: JSON.stringify(cardContent),
        },
      });

      if (response.code === 0) {
        log.debug({ chatId, messageId: response.data?.message_id }, 'Card message sent');
      } else {
        throw new Error(`Failed to send card: ${response.msg}`);
      }
    } catch (error) {
      log.error({ chatId, error: error instanceof Error ? error.message : String(error) }, 'Failed to send card');
      throw error;
    }
  }

  /**
   * 获取文档内容
   */
  async fetchDoc(docId: string, offset?: number, limit?: number): Promise<FeishuDocInfo> {
    try {
      const actualDocId = this.extractDocId(docId);

      // TODO: 实现完整的文档获取逻辑
      log.warn({ docId: actualDocId }, 'Document fetching not fully implemented, returning mock data');

      return {
        doc_id: actualDocId,
        title: 'Mock Document',
        content: 'This is a placeholder. Document fetching is not yet fully implemented.',
        has_more: false,
      };
    } catch (error) {
      log.error({ docId, error: error instanceof Error ? error.message : String(error) }, 'Failed to fetch doc');
      throw error;
    }
  }

  /**
   * 创建文档
   */
  async createDoc(title: string, markdown: string, options?: CreateDocOptions): Promise<FeishuDocInfo> {
    try {
      log.warn({ title, markdownLength: markdown.length }, 'Document creation not fully implemented');

      return {
        doc_id: 'mock_doc_' + Date.now(),
        title,
        url: 'https://feishu.cn/mock',
      };
    } catch (error) {
      log.error({ title, error: error instanceof Error ? error.message : String(error) }, 'Failed to create doc');
      throw error;
    }
  }

  /**
   * 更新文档
   */
  async updateDoc(docId: string, markdown: string): Promise<void> {
    try {
      const actualDocId = this.extractDocId(docId);
      log.warn({ docId: actualDocId, markdownLength: markdown.length }, 'Document update not implemented');
    } catch (error) {
      log.error({ docId, error: error instanceof Error ? error.message : String(error) }, 'Failed to update doc');
      throw error;
    }
  }

  /**
   * 搜索文档
   */
  async searchDocs(query: string, limit: number = 10): Promise<FeishuDocSearchResult[]> {
    try {
      log.warn({ query, limit }, 'Document search not implemented, returning empty results');

      return [];
    } catch (error) {
      log.error({ query, error: error instanceof Error ? error.message : String(error) }, 'Failed to search docs');
      throw error;
    }
  }

  /**
   * 获取消息历史
   */
  async getMessageHistory(chatId: string, limit: number = 20, beforeId?: string): Promise<any[]> {
    try {
      const response = await this.client.im.message.list({
        params: {
          container_id_type: 'chat',
          container_id: chatId,
          page_size: limit,
          page_token: beforeId,
        },
      });

      if (response.code !== 0) {
        throw new Error(`Failed to get message history: ${response.msg}`);
      }

      return response.data?.items || [];
    } catch (error) {
      log.error({ chatId, error: error instanceof Error ? error.message : String(error) }, 'Failed to get message history');
      throw error;
    }
  }

  /**
   * 检查连接状态
   */
  isConnected(): boolean {
    return this.wsClient !== null && this.credentials.accessToken !== undefined;
  }

  /**
   * 断开连接
   */
  async disconnect(): Promise<void> {
    if (this.wsClient) {
      try {
        await this.wsClient.stop();
        this.wsClient = null;
        log.info('Feishu WebSocket client disconnected');
      } catch (error) {
        log.error({ error: error instanceof Error ? error.message : String(error) }, 'Failed to stop WebSocket');
      }
    }
  }

  /**
   * 从 URL 或字符串中提取文档 ID
   */
  private extractDocId(input: string): string {
    if (input.includes('feishu.cn') || input.includes('feishu.com')) {
      const match = input.match(/\/docs\/([a-zA-Z0-9_-]+)/);
      if (match) {
        return match[1];
      }
    }
    return input;
  }
}
