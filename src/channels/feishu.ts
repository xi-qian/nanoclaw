/**
 * Feishu Channel
 *
 * 飞书消息通道实现，支持 WebSocket 长连接
 */

import crypto from 'crypto';

import { registerChannel, ChannelOpts, type Channel } from './registry.js';
import type {
  OnInboundMessage,
  OnChatMetadata,
  NewMessage,
  CardActionData,
  MessageAttachment,
  RequestContext,
} from '../types.js';
import { FeishuClient } from '../feishu/client.js';
import {
  loadCredentials,
  saveCredentials,
  type FeishuCredentials,
} from '../feishu/auth.js';
import type { FeishuEvent } from '../feishu/types.js';
import { larkLogger } from '../feishu/logger.js';
import { createRequestContext } from '../db.js';
import { REQUEST_CONTEXT_TTL_HOURS } from '../config.js';

const log = larkLogger('channel');

/**
 * 飞书通道类
 */
export class FeishuChannel implements Channel {
  name = 'feishu';
  private client: FeishuClient;
  private onMessage: OnInboundMessage;
  private onChatMetadata: OnChatMetadata;
  private onCardAction?: (
    chatJid: string,
    action: CardActionData,
    sender: string,
  ) => void;
  private credentials: FeishuCredentials;

  constructor(opts: ChannelOpts, credentials: FeishuCredentials) {
    this.credentials = credentials;
    this.client = new FeishuClient(credentials);
    this.onMessage = opts.onMessage;
    this.onChatMetadata = opts.onChatMetadata;
    this.onCardAction = opts.onCardAction;

    // 注册 WebSocket 事件处理
    this.setupEventHandlers();
  }

  /**
   * 设置 WebSocket 事件处理器
   */
  private setupEventHandlers(): void {
    // 监听消息接收事件
    this.client.on('im.message.receive_v1', (event: FeishuEvent) => {
      this.handleMessageEvent(event).catch((err) => {
        log.error({ err }, 'Error in message event handler');
      });
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

    // 监听卡片回调事件
    this.client.on('card.action.trigger', (event: FeishuEvent) => {
      this.handleCardActionEvent(event);
    });

    log.info('WebSocket event handlers registered');
  }

  /**
   * 处理消息接收事件
   */
  private async handleMessageEvent(event: FeishuEvent): Promise<void> {
    try {
      if (event.type === 'im.message.receive_v1' && event.event?.message) {
        const msg = event.event.message;
        const chatId = msg.chat_id;
        const chatType = msg.chat_type || 'p2p';
        const messageType = msg.message_type || 'text';

        // 解析消息内容
        const content = JSON.parse(msg.content);
        // sender 在事件级别，不在 msg 里
        const senderOpenId =
          event.event?.sender?.sender_id?.open_id ||
          msg.sender?.sender_id?.open_id ||
          '';

        const jid = `feishu:${chatId}`;

        // 获取用户名称（异步）
        const senderName = await this.client.getUserName(senderOpenId);

        // 先存储 chat 元数据（避免外键约束错误）
        const isGroup = chatType === 'group';
        this.onChatMetadata(jid, msg.create_time, chatId, 'feishu', isGroup);

        // 根据消息类型提取内容和附件
        const { text, attachment } = this.parseMessageContent(
          messageType,
          content,
          msg.message_id,
          msg.mentions,
        );

        // Generate requestId for sender verification tracking
        const requestId = crypto.randomUUID();
        const now = new Date();
        const expiresAt = new Date(
          now.getTime() + REQUEST_CONTEXT_TTL_HOURS * 60 * 60 * 1000,
        );

        // Store request context for permission verification
        createRequestContext({
          request_id: requestId,
          message_id: msg.message_id,
          chat_jid: jid,
          sender_open_id: senderOpenId,
          sender_name: senderName,
          trigger_message: text.slice(0, 500), // Truncate for storage
          created_at: now.toISOString(),
          expires_at: expiresAt.toISOString(),
        } as RequestContext);

        // 转换为 NanoClaw 消息格式
        const newMessage: NewMessage = {
          id: msg.message_id,
          chat_jid: jid,
          sender: senderOpenId,
          sender_name: senderName,
          content: text,
          timestamp: msg.create_time,
          is_from_me: false,
          message_type: messageType as NewMessage['message_type'],
          attachment: attachment,
          requestId,
        };

        // 通知消息处理器（会被存储到 SQLite）
        this.onMessage(jid, newMessage);

        log.debug(
          {
            messageId: msg.message_id,
            chatId,
            senderName,
            messageType,
            hasAttachment: !!attachment,
          },
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
   * 根据消息类型解析内容和附件
   */
  private parseMessageContent(
    messageType: string,
    content: any,
    messageId: string,
    mentions?: Array<{ key: string; name: string }>,
  ): { text: string; attachment?: MessageAttachment } {
    switch (messageType) {
      case 'text': {
        let text = content.text || '';
        // 替换 @提及 占位符为实际用户名
        if (mentions && mentions.length > 0) {
          for (const mention of mentions) {
            text = text.replace(
              new RegExp(
                mention.key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'),
                'g',
              ),
              `@${mention.name}`,
            );
          }
        }
        return { text };
      }

      case 'post':
        // 富文本消息，提取文本内容
        const postText = this.extractPostText(content);
        return { text: postText };

      case 'image':
        return {
          text: '[图片]',
          attachment: {
            type: 'image',
            key: content.image_key,
            message_id: messageId,
          },
        };

      case 'file':
        return {
          text: `[文件] ${content.name || '未知文件'}`,
          attachment: {
            type: 'file',
            key: content.file_key,
            name: content.name,
            size: content.size,
            message_id: messageId,
          },
        };

      case 'audio':
        return {
          text: '[语音消息]',
          attachment: {
            type: 'audio',
            key: content.file_key,
            message_id: messageId,
          },
        };

      case 'media':
        return {
          text: '[视频]',
          attachment: {
            type: 'video',
            key: content.file_key,
            message_id: messageId,
          },
        };

      case 'interactive':
        return { text: '[卡片消息]' };

      default:
        return { text: `[${messageType}消息]` };
    }
  }

  /**
   * 从富文本消息中提取文本内容
   */
  private extractPostText(content: any): string {
    try {
      const zhContent = content.zh_cn || content.en_us || {};
      const postContent = zhContent.content || [];
      const texts: string[] = [];

      for (const paragraph of postContent) {
        for (const element of paragraph) {
          if (element.tag === 'text' && element.text) {
            texts.push(element.text);
          } else if (element.tag === 'md' && element.text) {
            texts.push(element.text);
          } else if (element.tag === 'a' && element.text) {
            texts.push(`[${element.text}](${element.href})`);
          } else if (element.tag === 'at' && element.user_name) {
            texts.push(`@${element.user_name}`);
          }
        }
        texts.push('\n');
      }

      return texts.join('').trim();
    } catch {
      return '';
    }
  }

  /**
   * 处理卡片回调事件
   */
  private handleCardActionEvent(event: FeishuEvent): void {
    try {
      if (event.type === 'card.action.trigger' && event.event) {
        const action = event.event.action;
        const context = event.event.context;

        if (!action || !context) {
          log.warn('Card action event missing action or context');
          return;
        }

        const operatorOpenId = action.open_id;
        const chatId = context.open_chat_id;
        const messageId = context.open_message_id;
        const actionValue = action.value || {};
        const actionOption = action.option;

        log.info(
          {
            operatorOpenId,
            chatId,
            messageId,
            actionValue,
            actionOption,
          },
          'Card action triggered',
        );

        // 通过回调将卡片动作传递给上层处理
        if (this.onCardAction) {
          const jid = `feishu:${chatId}`;
          const cardAction: CardActionData = {
            type: 'button_click',
            value: actionValue,
            source_message_id: messageId,
            option: actionOption,
          };
          this.onCardAction(jid, cardAction, operatorOpenId);
        } else {
          log.warn(
            { chatId, actionValue },
            'Card action received but no handler registered',
          );
        }
      }
    } catch (error) {
      log.error(
        { error: error instanceof Error ? error.message : String(error) },
        'Failed to handle card action event',
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
   * 下载消息中的资源文件
   * @param messageId 消息ID
   * @param fileKey 资源文件 key
   * @param fileName 可选的文件名
   * @param groupFolder 群组文件夹名（用于确定保存路径）
   * @param type 资源类型：image, file, audio, video, media
   * @returns 容器内可访问的文件路径
   */
  async downloadMessageResource(
    messageId: string,
    fileKey: string,
    fileName?: string,
    groupFolder?: string,
    type: 'image' | 'file' | 'audio' | 'video' | 'media' = 'file',
  ): Promise<string> {
    return await this.client.downloadMessageResourceToFile(
      messageId,
      fileKey,
      fileName,
      groupFolder,
      type,
    );
  }

  /**
   * 发送文件给用户
   * @param jid 聊天 JID（格式：feishu:oc_xxx）
   * @param filePath 文件路径（主机路径，通常是 IPC downloads 目录）
   * @param fileType 文件类型：file, image, audio, video, media
   */
  async sendFile(
    jid: string,
    filePath: string,
    fileType: 'file' | 'image' | 'audio' | 'video' | 'media' = 'file',
  ): Promise<{ file_key: string; message_id: string }> {
    try {
      const chatId = jid.replace(/^feishu:/, '');
      const result = await this.client.uploadAndSendFile(
        chatId,
        filePath,
        fileType,
      );
      log.info(
        { jid, filePath, fileType, ...result },
        'File sent successfully',
      );
      return result;
    } catch (error) {
      log.error(
        {
          jid,
          filePath,
          fileType,
          error: error instanceof Error ? error.message : String(error),
        },
        'Failed to send file',
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
   * 发送带按钮的交互式卡片
   * @param chatId 聊天ID
   * @param title 卡片标题
   * @param content 卡片内容（支持 Markdown）
   * @param buttons 按钮列表
   */
  async sendButtonCard(
    chatId: string,
    title: string,
    content: string,
    buttons: Array<{
      text: string;
      value: Record<string, any>;
      style?: 'default' | 'primary' | 'danger';
    }>,
  ): Promise<void> {
    const cardContent = {
      config: {
        wide_screen_mode: true,
      },
      header: {
        title: {
          tag: 'plain_text',
          content: title,
        },
        template: 'blue',
      },
      elements: [
        {
          tag: 'markdown',
          content: content,
        },
        {
          tag: 'action',
          actions: buttons.map((btn) => ({
            tag: 'button',
            text: {
              tag: 'plain_text',
              content: btn.text,
            },
            type: btn.style || 'default',
            value: btn.value,
          })),
        },
      ],
    };

    return await this.sendCard(chatId, cardContent);
  }

  /**
   * 发送确认卡片（带确认/取消按钮）
   */
  async sendConfirmCard(
    chatId: string,
    title: string,
    content: string,
    confirmText: string = '确认',
    cancelText: string = '取消',
    actionKey: string = 'confirm_action',
  ): Promise<void> {
    return await this.sendButtonCard(chatId, title, content, [
      {
        text: confirmText,
        value: { action: actionKey, confirmed: true },
        style: 'primary',
      },
      {
        text: cancelText,
        value: { action: actionKey, confirmed: false },
        style: 'default',
      },
    ]);
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

  // 注意：accessToken 是 user_access_token，仅某些需要用户授权的操作需要
  // 大部分功能（接收/发送消息、创建文档等）使用 SDK 自动管理的 app_access_token
  if (!credentials.accessToken) {
    log.debug(
      'No user_access_token found. App functions will use app_access_token.',
    );
  }

  return channel;
});
