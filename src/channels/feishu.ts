/**
 * Feishu Channel
 *
 * 飞书消息通道实现，支持 WebSocket 长连接
 */

import { registerChannel, ChannelOpts, type Channel } from './registry.js';
import type { OnInboundMessage, OnChatMetadata, NewMessage } from '../types.js';
import { FeishuClient } from '../feishu/client.js';
import {
  loadCredentials,
  saveCredentials,
  type FeishuCredentials,
} from '../feishu/auth.js';
import type { FeishuEvent } from '../feishu/types.js';
import { larkLogger } from '../feishu/logger.js';

const log = larkLogger('channel');

/**
 * 飞书通道类
 */
export class FeishuChannel implements Channel {
  name = 'feishu';
  private client: FeishuClient;
  private onMessage: OnInboundMessage;
  private onChatMetadata: OnChatMetadata;
  private credentials: FeishuCredentials;

  constructor(opts: ChannelOpts, credentials: FeishuCredentials) {
    this.credentials = credentials;
    this.client = new FeishuClient(credentials);
    this.onMessage = opts.onMessage;
    this.onChatMetadata = opts.onChatMetadata;

    // 注册 WebSocket 事件处理
    this.setupEventHandlers();
  }

  /**
   * 设置 WebSocket 事件处理器
   */
  private setupEventHandlers(): void {
    // 监听消息接收事件
    this.client.on('im.message.receive_v1', (event: FeishuEvent) => {
      this.handleMessageEvent(event);
    });

    // 监听消息已读事件
    this.client.on('im.message.message_read_v1', (event: FeishuEvent) => {
      log.debug(
        { messageId: event.event?.message?.message_id },
        'Message read event',
      );
    });

    // 监听表情反应事件
    this.client.on('im.message.reaction.created_v1', (event: FeishuEvent) => {
      log.debug(
        { reaction: event.event?.reaction?.emoji },
        'Reaction created event',
      );
    });

    log.info('WebSocket event handlers registered');
  }

  /**
   * 处理消息接收事件
   */
  private handleMessageEvent(event: FeishuEvent): void {
    try {
      if (event.type === 'im.message.receive_v1' && event.event?.message) {
        const msg = event.event.message;
        const chatId = msg.chat_id;
        const chatType = msg.chat_type || 'p2p';

        // 解析消息内容
        const content = JSON.parse(msg.content);
        const text = content.text || '';
        // sender 在事件级别，不在 msg 里
        const senderOpenId =
          event.event?.sender?.sender_id?.open_id ||
          msg.sender?.sender_id?.open_id ||
          '';

        const jid = `feishu:${chatId}`;

        // 先存储 chat 元数据（避免外键约束错误）
        const isGroup = chatType === 'group';
        this.onChatMetadata(jid, msg.create_time, chatId, 'feishu', isGroup);

        // 转换为 NanoClaw 消息格式
        const newMessage: NewMessage = {
          id: msg.message_id,
          chat_jid: jid,
          sender: senderOpenId,
          sender_name: '', // TODO: 需要额外查询用户名
          content: text,
          timestamp: msg.create_time,
          is_from_me: false,
        };

        // 通知消息处理器（会被存储到 SQLite）
        this.onMessage(jid, newMessage);

        log.debug(
          { messageId: msg.message_id, chatId, contentLength: text.length },
          'Message received and processed',
        );
      }
    } catch (error) {
      log.error(
        { error: error instanceof Error ? error.message : String(error) },
        'Failed to handle message event',
      );
    }
  }

  /**
   * 建立连接
   */
  async connect(): Promise<void> {
    try {
      await this.client.connect();
      log.info('Feishu channel connected via WebSocket');
    } catch (error) {
      log.error(
        { error: error instanceof Error ? error.message : String(error) },
        'Failed to connect',
      );
      throw error;
    }
  }

  /**
   * 发送消息
   */
  async sendMessage(jid: string, text: string): Promise<void> {
    try {
      // 去掉 "feishu:" 前缀
      const chatId = jid.replace(/^feishu:/, '');
      await this.client.sendMessage(chatId, text);
      log.debug({ jid, textLength: text.length }, 'Message sent');
    } catch (error) {
      log.error(
        { jid, error: error instanceof Error ? error.message : String(error) },
        'Failed to send message',
      );
      throw error;
    }
  }

  /**
   * 检查连接状态
   */
  isConnected(): boolean {
    return this.client.isConnected();
  }

  /**
   * 检查是否拥有该 JID
   */
  ownsJid(jid: string): boolean {
    return jid.startsWith('feishu:');
  }

  /**
   * 断开连接
   */
  async disconnect(): Promise<void> {
    try {
      await this.client.disconnect();
      log.info('Feishu channel disconnected');
    } catch (error) {
      log.error(
        { error: error instanceof Error ? error.message : String(error) },
        'Failed to disconnect',
      );
    }
  }

  // ==================== 文档操作方法（供 Host IPC 调用） ====================

  /**
   * 获取文档内容
   */
  async fetchDoc(docId: string, offset?: number, limit?: number): Promise<any> {
    return await this.client.fetchDoc(docId, offset, limit);
  }

  /**
   * 创建文档
   */
  async createDoc(
    title: string,
    markdown: string,
    options?: any,
  ): Promise<any> {
    return await this.client.createDoc(title, markdown, options);
  }

  /**
   * 更新文档
   */
  async updateDoc(docId: string, markdown: string): Promise<any> {
    return await this.client.updateDoc(docId, markdown);
  }

  /**
   * 搜索文档
   */
  async searchDocs(query: string, limit?: number): Promise<any> {
    return await this.client.searchDocs(query, limit || 10);
  }

  // ==================== 多维表格操作方法 ====================

  /**
   * 创建多维表格应用
   */
  async createBitableApp(name: string): Promise<any> {
    return await this.client.createBitableApp(name);
  }

  /**
   * 创建多维表格数据表
   */
  async createBitableTable(
    appToken: string,
    name: string,
    fields: any[],
  ): Promise<any> {
    return await this.client.createBitableTable(appToken, name, fields);
  }

  /**
   * 列出多维表格中的所有数据表
   */
  async listBitableTables(appToken: string): Promise<any[]> {
    return await this.client.listBitableTables(appToken);
  }

  /**
   * 添加多维表格记录
   */
  async addBitableRecord(
    appToken: string,
    tableId: string,
    fields: Record<string, any>,
  ): Promise<any> {
    return await this.client.addBitableRecord(appToken, tableId, fields);
  }

  /**
   * 批量添加多维表格记录
   */
  async batchAddBitableRecords(
    appToken: string,
    tableId: string,
    records: Array<{ fields: Record<string, any> }>,
  ): Promise<any> {
    return await this.client.batchAddBitableRecords(appToken, tableId, records);
  }

  /**
   * 查询多维表格记录
   */
  async listBitableRecords(
    appToken: string,
    tableId: string,
    options?: any,
  ): Promise<any> {
    return await this.client.listBitableRecords(appToken, tableId, options);
  }

  /**
   * 获取多维表格字段列表
   */
  async listBitableFields(appToken: string, tableId: string): Promise<any[]> {
    return await this.client.listBitableFields(appToken, tableId);
  }

  /**
   * 更新多维表格记录
   */
  async updateBitableRecord(
    appToken: string,
    tableId: string,
    recordId: string,
    fields: Record<string, any>,
  ): Promise<void> {
    return await this.client.updateBitableRecord(
      appToken,
      tableId,
      recordId,
      fields,
    );
  }

  /**
   * 删除多维表格记录
   */
  async deleteBitableRecord(
    appToken: string,
    tableId: string,
    recordId: string,
  ): Promise<void> {
    return await this.client.deleteBitableRecord(appToken, tableId, recordId);
  }

  /**
   * 发送富文本消息
   */
  async sendRichText(chatId: string, elements: any[]): Promise<void> {
    return await this.client.sendRichText(chatId, elements);
  }

  /**
   * 发送交互式卡片
   */
  async sendCard(chatId: string, cardContent: any): Promise<void> {
    return await this.client.sendCard(chatId, cardContent);
  }

  /**
   * 获取消息历史
   */
  async getMessageHistory(
    chatId: string,
    limit?: number,
    beforeId?: string,
  ): Promise<any> {
    return await this.client.getMessageHistory(chatId, limit, beforeId);
  }

  /**
   * 执行 OAuth 认证流程
   */
  async authenticate(): Promise<void> {
    const { FeishuOAuthClient } = await import('../feishu/oauth.js');
    const oauthClient = new FeishuOAuthClient(this.credentials);

    log.info('Starting OAuth UAT authentication flow...');

    const { credentials: updatedCredentials, tokens } =
      await oauthClient.authenticate();

    // 更新凭证
    this.credentials = updatedCredentials;
    await saveCredentials(updatedCredentials);

    log.info('OAuth authentication completed successfully');
    log.info(`Access token expires in ${tokens.expires_in} seconds`);
  }
}

// ==================== 自注册 ====================

registerChannel('feishu', (opts: ChannelOpts) => {
  const credentials = loadCredentials();

  if (!credentials) {
    log.warn('Feishu credentials not found, skipping channel registration');
    return null;
  }

  const channel = new FeishuChannel(opts, credentials);

  // 如果没有 access_token，提示用户进行认证
  if (!credentials.accessToken) {
    log.warn('No access_token found. Please run authentication first.');
    // 注意：这里不阻止通道创建，允许稍后手动认证
  }

  return channel;
});
