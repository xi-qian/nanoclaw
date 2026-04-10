/**
 * Feishu/Lark Client with WebSocket Support
 *
 * 飞书 SDK 客户端封装，支持 WebSocket 长连接
 * 使用 HTTP 请求直接调用飞书 API
 */

import * as Lark from '@larksuiteoapi/node-sdk';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import type {
  FeishuCredentials,
  FeishuDocInfo,
  CreateDocOptions,
  LarkBrand,
  FeishuDocSearchResult,
} from './types.js';
import type { FeishuEvent } from './types.js';
import { larkLogger } from './logger.js';

const log = larkLogger('client');

/**
 * 从 Axios / HTTP 错误中取出飞书开放平台常见字段，便于区分「权限 / 参数 / 其它」。
 * 参见：https://open.feishu.cn/document/ukTMukTMukTM/ugjM14COyUjL4ITN
 */
function extractFeishuHttpErrorPayload(error: unknown): {
  httpStatus?: number;
  feishuCode?: number;
  feishuMsg?: string;
  rawBody?: unknown;
} {
  if (!error || typeof error !== 'object') {
    return { rawBody: error };
  }
  const anyErr = error as Record<string, unknown>;
  const response = anyErr.response as
    | { status?: number; data?: unknown }
    | undefined;
  if (!response) {
    return {
      feishuMsg: anyErr.message as string | undefined,
      rawBody: error,
    };
  }
  const data = response.data as Record<string, unknown> | undefined;
  const feishuCode =
    typeof data?.code === 'number'
      ? data.code
      : typeof data?.code === 'string'
        ? parseInt(data.code, 10)
        : undefined;
  const feishuMsg = typeof data?.msg === 'string' ? data.msg : undefined;
  return {
    httpStatus: response.status,
    feishuCode: Number.isNaN(feishuCode as number) ? undefined : feishuCode,
    feishuMsg,
    rawBody: data,
  };
}

function hintForFeishuContactError(
  httpStatus: number | undefined,
  feishuCode: number | undefined,
  feishuMsg: string | undefined,
): string {
  const parts: string[] = [];
  if (httpStatus === 401 || httpStatus === 403) {
    parts.push(
      'HTTP 401/403：多为 token 无效或应用无权限，检查应用是否已发布、tenant_access_token 是否有效',
    );
  }
  if (httpStatus === 400) {
    parts.push(
      'HTTP 400：多为请求参数与 user_id_type 不匹配、或开放平台返回业务错误；请看下方 feishuCode/feishuMsg',
    );
  }
  if (feishuCode === 99991663 || feishuCode === 41050) {
    parts.push(
      '飞书常见无权限类 code：请在开放平台为应用开通「通讯录 / 获取用户基本信息」等权限并重新发布版本',
    );
  }
  if (feishuCode === 41012) {
    parts.push(
      '飞书 41012：用户 ID 无效或与 user_id_type 不一致，属参数/ID 问题而非单纯权限名写错',
    );
  }
  if (feishuMsg?.includes('permission') || feishuMsg?.includes('权限')) {
    parts.push('msg 含权限：以开放平台权限与管理员审核为准');
  }
  if (parts.length === 0) {
    parts.push(
      '对照 open.feishu.cn 文档中 contact/v3/users 错误码；若 feishuCode 为空，把 rawBody 发给飞书支持或查网关返回',
    );
  }
  return parts.join(' ');
}

// ES 模块中 __dirname 的替代
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * 品牌到 SDK domain 的映射
 */
const BRAND_TO_DOMAIN: Record<LarkBrand, Lark.Domain> = {
  feishu: Lark.Domain.Feishu,
  lark: Lark.Domain.Lark,
};

/**
 * 品牌到 MCP 端点的映射
 */
const BRAND_TO_MCP_ENDPOINT: Record<LarkBrand, string> = {
  feishu: 'https://mcp.feishu.cn/mcp',
  lark: 'https://mcp.larksuite.com/mcp',
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

  // 速率限制延迟（毫秒）- 飞书文档 API 每秒最多 5 次请求
  private readonly RATE_LIMIT_DELAY = 250;

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
   * 获取 MCP 端点 URL
   */
  private getMcpEndpoint(): string {
    return BRAND_TO_MCP_ENDPOINT[this.brand];
  }

  /**
   * 调用飞书 MCP 工具
   * @param toolName 工具名称（如 create-doc, update-doc）
   * @param args 工具参数
   * @returns 工具返回结果
   */
  private async callMCPTool<T = Record<string, unknown>>(
    toolName: string,
    args: Record<string, unknown>,
  ): Promise<T> {
    try {
      const token = await this.getTenantAccessToken();
      const endpoint = this.getMcpEndpoint();

      const body = {
        jsonrpc: '2.0',
        id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
        method: 'tools/call',
        params: {
          name: toolName,
          arguments: args,
        },
      };

      log.debug({ toolName, args, endpoint }, 'Calling MCP tool');

      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Lark-MCP-TAT': token,
          'X-Lark-MCP-Allowed-Tools': toolName,
        },
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        const errorText = await response.text();
        log.error(
          { toolName, status: response.status, errorText },
          'MCP tool call failed with HTTP error',
        );
        throw new Error(
          `MCP tool ${toolName} failed: HTTP ${response.status} - ${errorText}`,
        );
      }

      const data = (await response.json()) as {
        result?: { content?: Array<{ type: string; text: string }> };
        error?: { message?: string; code?: number };
      };

      // 检查 JSON-RPC 错误
      if (data.error) {
        log.error(
          { toolName, error: data.error },
          'MCP tool returned error',
        );
        throw new Error(
          `MCP tool ${toolName} error: ${data.error.message || JSON.stringify(data.error)}`,
        );
      }

      // 解析结果
      const content = data.result?.content;
      if (content && Array.isArray(content) && content.length > 0) {
        const textItem = content.find((item) => item.type === 'text');
        if (textItem?.text) {
          try {
            const parsed = JSON.parse(textItem.text) as T;
            log.debug({ toolName, result: parsed }, 'MCP tool call successful');
            return parsed;
          } catch {
            // 如果不是 JSON，直接返回文本包装为对象
            return textItem.text as T;
          }
        }
      }

      log.debug({ toolName, result: data.result }, 'MCP tool call successful');
      return data.result as T;
    } catch (error) {
      log.error(
        {
          toolName,
          args,
          error: error instanceof Error ? error.message : String(error),
        },
        'Failed to call MCP tool',
      );
      throw error;
    }
  }

  /**
   * 延迟函数
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * 建立 WebSocket 长连接
   */
  async connect(): Promise<void> {
    try {
      log.info('Starting WebSocket connection...');

      // 创建 WebSocket 客户端（启用调试日志）
      this.wsClient = new Lark.WSClient({
        appId: this.credentials.appId,
        appSecret: this.credentials.appSecret,
        domain: BRAND_TO_DOMAIN[this.brand],
        loggerLevel: Lark.LoggerLevel.debug,
      });

      // 创建事件分发器来处理接收的事件（启用调试日志）
      const self = this;
      const eventDispatcher = new Lark.EventDispatcher({
        loggerLevel: Lark.LoggerLevel.debug,
      }).register({
        'im.message.receive_v1': async (data: any) => {
          log.info(
            { data: JSON.stringify(data) },
            'Event received from EventDispatcher',
          );
          self.emit('im.message.receive_v1', {
            type: 'im.message.receive_v1',
            event: data,
          });
        },
        // 卡片回调事件
        'card.action.trigger': async (data: any) => {
          log.info(
            { data: JSON.stringify(data) },
            'Card action event received from EventDispatcher',
          );
          self.emit('card.action.trigger', {
            type: 'card.action.trigger',
            event: data,
          });
        },
      });
      log.info(
        'EventDispatcher registered for im.message.receive_v1 and card.action.trigger',
      );

      // 启动 WebSocket 连接
      const startParams = { eventDispatcher };
      await this.wsClient.start(startParams);

      log.info('Feishu WebSocket client connected');
    } catch (error) {
      log.error(
        { error: error instanceof Error ? error.message : String(error) },
        'Failed to connect WebSocket',
      );

      // 提供更详细的错误信息
      if (error instanceof Error) {
        log.error('WebSocket connection failed. Please ensure:');
        log.error(
          '1. The app is configured for persistent connection in Feishu console',
        );
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
    log.debug(
      { eventType, handlerCount: this.eventHandlers.get(eventType)!.length },
      'Event handler registered',
    );
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
          log.error(
            {
              eventType,
              error: error instanceof Error ? error.message : String(error),
            },
            'Event handler error',
          );
        }
      }
    }
  }

  /**
   * 添加"正在输入"指示器（通过 emoji reaction）
   * @param messageId 消息ID
   * @returns reaction ID，用于后续删除
   */
  async addTypingIndicator(messageId: string): Promise<string | null> {
    try {
      const response = await this.client.im.messageReaction.create({
        path: {
          message_id: messageId,
        },
        data: {
          reaction_type: {
            emoji_type: 'Typing',
          },
        },
      });

      if (response.code === 0) {
        const reactionId = response.data?.reaction_id || null;
        log.debug(
          { messageId, reactionId },
          'Typing indicator added (emoji reaction)',
        );
        return reactionId;
      } else {
        log.warn(
          { messageId, code: response.code, msg: response.msg },
          'Failed to add typing indicator',
        );
        return null;
      }
    } catch (error) {
      log.debug(
        {
          messageId,
          error: error instanceof Error ? error.message : String(error),
        },
        'Failed to add typing indicator',
      );
      // 静默失败，不影响消息处理
      return null;
    }
  }

  /**
   * 移除"正在输入"指示器
   * @param messageId 消息ID
   * @param reactionId reaction ID
   */
  async removeTypingIndicator(
    messageId: string,
    reactionId: string,
  ): Promise<void> {
    if (!reactionId) return;

    try {
      const response = await this.client.im.messageReaction.delete({
        path: {
          message_id: messageId,
          reaction_id: reactionId,
        },
      });

      if (response.code === 0) {
        log.debug({ messageId, reactionId }, 'Typing indicator removed');
      } else {
        log.warn(
          { messageId, reactionId, code: response.code, msg: response.msg },
          'Failed to remove typing indicator',
        );
      }
    } catch (error) {
      log.debug(
        {
          messageId,
          reactionId,
          error: error instanceof Error ? error.message : String(error),
        },
        'Failed to remove typing indicator',
      );
      // 静默失败
    }
  }

  /**
   * 发送消息（自动转换为飞书富文本格式，支持 Markdown 渲染）
   */
  async sendMessage(chatId: string, text: string): Promise<void> {
    try {
      // 使用富文本消息的 md 标签来支持 Markdown 渲染
      const response = await this.client.im.message.create({
        params: {
          receive_id_type: 'chat_id',
        },
        data: {
          receive_id: chatId,
          msg_type: 'post',
          content: JSON.stringify({
            zh_cn: {
              content: [
                [
                  {
                    tag: 'md',
                    text: text,
                  },
                ],
              ],
            },
          }),
        },
      });

      if (response.code === 0) {
        log.debug(
          { chatId, messageId: response.data?.message_id },
          'Message sent with markdown support',
        );
      } else {
        throw new Error(`Failed to send message: ${response.msg}`);
      }
    } catch (error) {
      log.error(
        {
          chatId,
          error: error instanceof Error ? error.message : String(error),
        },
        'Failed to send message',
      );
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
        log.debug(
          { chatId, messageId: response.data?.message_id },
          'Rich text message sent',
        );
      } else {
        throw new Error(`Failed to send rich text: ${response.msg}`);
      }
    } catch (error) {
      log.error(
        {
          chatId,
          error: error instanceof Error ? error.message : String(error),
        },
        'Failed to send rich text',
      );
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
        log.debug(
          { chatId, messageId: response.data?.message_id },
          'Card message sent',
        );
      } else {
        throw new Error(`Failed to send card: ${response.msg}`);
      }
    } catch (error) {
      log.error(
        {
          chatId,
          error: error instanceof Error ? error.message : String(error),
        },
        'Failed to send card',
      );
      throw error;
    }
  }

  /**
   * 获取文档内容
   * 使用飞书 MCP fetch-doc 工具获取文档的 Markdown 内容
   */
  async fetchDoc(
    docId: string,
    _offset?: number,
    _limit?: number,
  ): Promise<FeishuDocInfo> {
    try {
      const actualDocId = this.extractDocId(docId);

      log.info({ docId: actualDocId }, 'Fetching document via MCP fetch-doc');

      const result = await this.callMCPTool<{
        doc_id?: string;
        markdown?: string;
        length?: number;
        error?: string;
      }>('fetch-doc', { doc_id: actualDocId });

      // 检查是否有错误
      if (result.error) {
        throw new Error(`fetch-doc error: ${result.error}`);
      }

      const documentId = result.doc_id || actualDocId;
      const markdown = result.markdown || '';
      const url = this.buildDocUrl(documentId, this.brand);

      log.info(
        { docId: documentId, length: result.length || markdown.length },
        'Document fetched successfully via MCP',
      );

      return {
        doc_id: documentId,
        title: '',
        content: markdown,
        url,
        has_more: false,
      };
    } catch (error) {
      log.error(
        {
          docId,
          error: error instanceof Error ? error.message : String(error),
        },
        'Failed to fetch doc via MCP',
      );
      throw error;
    }
  }

  /**
   * 创建文档
   * 使用飞书 MCP create-doc 工具，正确处理 Markdown 内容顺序
   */
  async createDoc(
    title: string,
    markdown: string,
    options?: CreateDocOptions,
  ): Promise<FeishuDocInfo> {
    try {
      const args: Record<string, unknown> = {
        title,
        markdown,
      };

      if (options?.folder_token) {
        args.folder_token = options.folder_token;
      }

      log.info({ title, options }, 'Creating document via MCP create-doc');

      const result = await this.callMCPTool<{
        doc_id?: string;
        doc_url?: string;
        task_id?: string;
        error?: string;
      }>('create-doc', args);

      // 检查是否有错误
      if (result.error) {
        throw new Error(`create-doc error: ${result.error}`);
      }

      const documentId = result.doc_id;
      if (!documentId) {
        throw new Error('No doc_id returned from create-doc MCP tool');
      }

      const url = result.doc_url || this.buildDocUrl(documentId, this.brand);

      log.info({ documentId, title, url }, 'Document created successfully via MCP');

      return {
        doc_id: documentId,
        title,
        url,
      };
    } catch (error) {
      log.error(
        {
          title,
          error: error instanceof Error ? error.message : String(error),
        },
        'Failed to create doc via MCP',
      );
      throw error;
    }
  }

  /**
   * 更新文档（追加内容）
   * 使用飞书 MCP update-doc 工具，正确处理 Markdown 内容顺序
   */
  async updateDoc(docId: string, markdown: string): Promise<void> {
    try {
      const actualDocId = this.extractDocId(docId);

      const args: Record<string, unknown> = {
        doc_id: actualDocId,
        mode: 'append',
        markdown,
      };

      log.info({ docId: actualDocId }, 'Updating document via MCP update-doc');

      const result = await this.callMCPTool<{
        success?: boolean;
        error?: string;
      }>('update-doc', args);

      // 检查是否有错误
      if (result.error) {
        throw new Error(`update-doc error: ${result.error}`);
      }

      log.info({ docId: actualDocId }, 'Document updated successfully via MCP');
    } catch (error) {
      log.error(
        {
          docId,
          error: error instanceof Error ? error.message : String(error),
        },
        'Failed to update doc via MCP',
      );
      throw error;
    }
  }

  /**
   * 删除文档
   * 使用飞书 Drive API 将文档移到回收站
   * @param docId 文档 ID 或 URL
   */
  async deleteDoc(docId: string): Promise<void> {
    try {
      const actualDocId = this.extractDocId(docId);

      log.info({ docId: actualDocId }, 'Deleting document');

      const response = await this.client.request({
        url: `/open-apis/drive/v1/files/${actualDocId}`,
        method: 'DELETE',
        params: {
          type: 'docx',
        },
      });

      if (response.code !== 0) {
        throw new Error(`Failed to delete document: ${response.msg}`);
      }

      log.info({ docId: actualDocId }, 'Document deleted successfully');
    } catch (error) {
      log.error(
        {
          docId,
          error: error instanceof Error ? error.message : String(error),
        },
        'Failed to delete document',
      );
      throw error;
    }
  }

  /**
   * 删除多维表格记录
   * @param appToken 多维表格应用 token
   * @param tableId 数据表 ID
   * @param recordId 记录 ID
   */
  async deleteBitableRecord(
    appToken: string,
    tableId: string,
    recordId: string,
  ): Promise<void> {
    try {
      const response = await this.client.bitable.appTableRecord.delete({
        path: {
          app_token: appToken,
          table_id: tableId,
          record_id: recordId,
        },
      });

      if (response.code !== 0) {
        throw new Error(`Failed to delete bitable record: ${response.msg}`);
      }

      log.info({ appToken, tableId, recordId }, 'Bitable record deleted');
    } catch (error) {
      log.error(
        {
          appToken,
          tableId,
          recordId,
          error: error instanceof Error ? error.message : String(error),
        },
        'Failed to delete bitable record',
      );
      throw error;
    }
  }

  /**
   * 删除整个多维表格
   * 使用飞书 Drive API 将多维表格移到回收站
   * @param appToken 多维表格应用 token
   */
  async deleteBitable(appToken: string): Promise<void> {
    try {
      log.info({ appToken }, 'Deleting bitable');

      const response = await this.client.request({
        url: `/open-apis/drive/v1/files/${appToken}`,
        method: 'DELETE',
        params: {
          type: 'bitable',
        },
      });

      if (response.code !== 0) {
        throw new Error(`Failed to delete bitable: ${response.msg}`);
      }

      log.info({ appToken }, 'Bitable deleted successfully');
    } catch (error) {
      log.error(
        {
          appToken,
          error: error instanceof Error ? error.message : String(error),
        },
        'Failed to delete bitable',
      );
      throw error;
    }
  }

  /**
   * 搜索文档
   */
  async searchDocs(
    query: string,
    limit: number = 10,
  ): Promise<FeishuDocSearchResult[]> {
    try {
      log.warn(
        { query, limit },
        'Document search not implemented, returning empty results',
      );

      return [];
    } catch (error) {
      log.error(
        {
          query,
          error: error instanceof Error ? error.message : String(error),
        },
        'Failed to search docs',
      );
      throw error;
    }
  }

  /**
   * 获取消息历史
   */
  async getMessageHistory(
    chatId: string,
    limit: number = 20,
    beforeId?: string,
  ): Promise<any[]> {
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
      log.error(
        {
          chatId,
          error: error instanceof Error ? error.message : String(error),
        },
        'Failed to get message history',
      );
      throw error;
    }
  }

  /**
   * 用户信息缓存
   */
  private userInfoCache: Map<string, { name: string; expireAt: number }> =
    new Map();
  private readonly USER_CACHE_TTL = 3600000; // 1 hour in ms

  /**
   * 获取用户信息（通讯录）
   * https://open.feishu.cn/document/server-docs/contact-v3/user/get
   * 需权限：contact:user.base:readonly 等。
   * 部分租户下仅用 open_id 会 HTTP 400，可再尝试 union_id。
   *
   * @param openId 用户的 open_id
   * @param unionId 可选；与事件中的 sender_id.union_id 一致，用于回退查询
   * @returns 用户名称，获取失败时返回 openId
   */
  async getUserName(openId: string, unionId?: string): Promise<string> {
    if (!openId) return '';

    // Check cache first
    const cached = this.userInfoCache.get(openId);
    if (cached && cached.expireAt > Date.now()) {
      return cached.name;
    }

    const tryContact = async (
      userId: string,
      userIdType: 'open_id' | 'union_id',
    ): Promise<string | null> => {
      try {
        const response = (await this.client.request({
          url: `/open-apis/contact/v3/users/${encodeURIComponent(userId)}`,
          method: 'GET',
          params: {
            user_id_type: userIdType,
          },
        })) as {
          code?: number;
          msg?: string;
          data?: { user?: { name?: string; en_name?: string } };
        };

        log.debug(
          { userId, userIdType, code: response.code, msg: response.msg },
          'Contact user API response',
        );

        if (response.code === 0 && response.data?.user) {
          const user = response.data.user;
          return user.name || user.en_name || null;
        }

        if (response.code !== 0 && response.code !== undefined) {
          log.warn(
            {
              step: 'contact_user_sdk_body',
              userId,
              userIdType,
              feishuCode: response.code,
              feishuMsg: response.msg,
              hint: hintForFeishuContactError(
                undefined,
                response.code,
                response.msg,
              ),
            },
            'Feishu contact user: non-zero business code (HTTP likely 200)',
          );
        }
        return null;
      } catch (error) {
        const { httpStatus, feishuCode, feishuMsg, rawBody } =
          extractFeishuHttpErrorPayload(error);
        const errMsg = error instanceof Error ? error.message : String(error);
        log.warn(
          {
            step: 'contact_user_http',
            userId,
            userIdType,
            httpStatus,
            feishuCode,
            feishuMsg,
            rawBody,
            axiosMessage: errMsg,
            hint: hintForFeishuContactError(httpStatus, feishuCode, feishuMsg),
          },
          'Feishu contact user: HTTP/SDK error (inspect feishuCode/feishuMsg vs permission)',
        );
        return null;
      }
    };

    let name = await tryContact(openId, 'open_id');
    if (!name && unionId) {
      name = await tryContact(unionId, 'union_id');
    }

    if (name) {
      this.userInfoCache.set(openId, {
        name,
        expireAt: Date.now() + this.USER_CACHE_TTL,
      });
      log.info({ openId, unionId, name }, 'User info fetched successfully');
      return name;
    }

    log.warn(
      {
        openId,
        unionId,
        hint: 'Grant contact:user.base:readonly (or contact:contact:readonly_as_app) and re-publish the app; or rely on open_id as display fallback',
      },
      'Could not resolve user name from Feishu contact API',
    );
    return openId;
  }

  /**
   * 下载消息中的资源文件（用户发送的图片、文件、音频、视频等）
   * 使用原生 fetch API 绕过 Lark SDK 的 arraybuffer 处理问题
   * @param messageId 消息ID
   * @param fileKey 资源文件 key
   * @param type 资源类型：image, file, audio, video, media
   * @returns 文件内容（Buffer）
   */
  async downloadMessageResource(
    messageId: string,
    fileKey: string,
    type: 'image' | 'file' | 'audio' | 'video' | 'media' = 'file',
  ): Promise<Buffer> {
    try {
      // 获取 tenant_access_token
      // Lark SDK 内部会自动管理 token，我们通过一个简单的 API 调用来触发 token 刷新
      // 或者直接使用 appId 和 appSecret 获取 token
      const token = await this.getTenantAccessToken();

      // 使用原生 fetch API 下载文件
      // Lark SDK 的 request 方法在处理 arraybuffer 时有 bug
      const url = `https://open.feishu.cn/open-apis/im/v1/messages/${messageId}/resources/${fileKey}?type=${type}`;

      const response = await fetch(url, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (!response.ok) {
        // 尝试解析错误信息
        let errorMsg = `HTTP ${response.status}: ${response.statusText}`;
        try {
          const errorText = await response.text();
          const errorJson = JSON.parse(errorText);
          errorMsg = `Feishu API error: ${errorJson.msg || errorJson.message || errorText}`;
        } catch {
          // ignore
        }
        log.error(
          {
            messageId,
            fileKey,
            type,
            status: response.status,
            statusText: response.statusText,
          },
          'HTTP error downloading resource',
        );
        throw new Error(errorMsg);
      }

      // 读取为 ArrayBuffer
      const arrayBuffer = await response.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);

      log.info(
        {
          messageId,
          fileKey,
          type,
          size: buffer.length,
          contentType: response.headers.get('content-type'),
        },
        'Resource downloaded successfully',
      );

      return buffer;
    } catch (error: any) {
      log.error(
        {
          messageId,
          fileKey,
          type,
          error: error instanceof Error ? error.message : String(error),
        },
        'Failed to download message resource',
      );
      throw error;
    }
  }

  /**
   * 获取 tenant_access_token
   * @returns tenant_access_token
   */
  private async getTenantAccessToken(): Promise<string> {
    try {
      const response = await fetch(
        'https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            app_id: this.credentials.appId,
            app_secret: this.credentials.appSecret,
          }),
        },
      );

      const data = (await response.json()) as {
        code: number;
        msg?: string;
        tenant_access_token?: string;
      };

      if (data.code !== 0) {
        throw new Error(
          `Failed to get tenant_access_token: ${data.msg || 'Unknown error'}`,
        );
      }

      if (!data.tenant_access_token) {
        throw new Error('tenant_access_token not returned');
      }

      return data.tenant_access_token;
    } catch (error) {
      log.error(
        { error: error instanceof Error ? error.message : String(error) },
        'Failed to get tenant_access_token',
      );
      throw error;
    }
  }

  /**
   * 下载消息资源并保存到文件
   * 文件保存到 IPC 目录，以便容器内的 agent 可以访问
   * @param messageId 消息ID
   * @param fileKey 资源文件 key
   * @param fileName 保存的文件名
   * @param groupFolder 群组文件夹名（用于确定保存路径）
   * @param type 资源类型：image, file, audio, video, media
   * @returns 容器内可访问的文件路径
   */
  async downloadMessageResourceToFile(
    messageId: string,
    fileKey: string,
    fileName?: string,
    groupFolder?: string,
    type: 'image' | 'file' | 'audio' | 'video' | 'media' = 'file',
  ): Promise<string> {
    const fs = await import('fs');
    const path = await import('path');

    const buffer = await this.downloadMessageResource(messageId, fileKey, type);

    // 生成安全的文件名
    const safeFileName = fileName || `resource-${Date.now()}`;

    // 如果提供了 groupFolder，保存到 IPC 目录（容器可访问）
    // 否则回退到临时目录（向后兼容）
    let hostFilePath: string;
    let containerPath: string;

    if (groupFolder) {
      // 使用项目根目录下的 data/ipc/{groupFolder}/downloads/
      // 这会被挂载到容器的 /workspace/ipc/downloads/
      const projectRoot = path.resolve(__dirname, '..', '..');
      const downloadsDir = path.join(
        projectRoot,
        'data',
        'ipc',
        groupFolder,
        'downloads',
      );
      fs.mkdirSync(downloadsDir, { recursive: true });
      hostFilePath = path.join(downloadsDir, safeFileName);
      containerPath = `/workspace/ipc/downloads/${safeFileName}`;
    } else {
      // 回退到临时目录（向后兼容）
      const os = await import('os');
      const tmpDir = path.join(os.tmpdir(), 'nanoclaw-feishu-downloads');
      fs.mkdirSync(tmpDir, { recursive: true });
      hostFilePath = path.join(tmpDir, safeFileName);
      containerPath = hostFilePath; // 如果没有 groupFolder，返回原路径
    }

    fs.writeFileSync(hostFilePath, buffer);

    log.info(
      { hostPath: hostFilePath, containerPath, size: buffer.length },
      'Resource saved to file',
    );

    return containerPath;
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
        await this.wsClient.close();
        this.wsClient = null;
        log.info('Feishu WebSocket client disconnected');
      } catch (error) {
        log.error(
          { error: error instanceof Error ? error.message : String(error) },
          'Failed to stop WebSocket',
        );
      }
    }
  }

  /**
   * 从 URL 或字符串中提取文档 ID
   * 支持格式：
   * - https://feishu.cn/docx/xxx
   * - https://feishu.cn/docs/xxx
   * - https://xxx.feishu.cn/docx/xxx
   * - 纯文档 ID
   */
  private extractDocId(input: string): string {
    if (input.includes('feishu.cn') || input.includes('feishu.com')) {
      // 匹配 /docx/xxx 或 /docs/xxx
      const match = input.match(/\/doc(?:x|s)\/([a-zA-Z0-9_-]+)/);
      if (match) {
        return match[1];
      }
    }
    return input.trim();
  }

  /**
   * 将 Markdown 转换为 Feishu 文档块
   * @deprecated 使用 addMarkdownContent 代替，该方法使用飞书官方转换 API
   */
  private markdownToBlocks(markdown: string): any[] {
    const blocks: any[] = [];
    const lines = markdown.split('\n');

    for (const line of lines) {
      if (!line.trim()) {
        // 空行跳过
        continue;
      }

      // 标题 (block_type: 3=heading1, 4=heading2, 5=heading3)
      if (line.startsWith('#')) {
        const match = line.match(/^(#{1,3})\s+(.*)/);
        if (match) {
          const level = match[1].length;
          const text = match[2];
          blocks.push({
            block_type: 2 + level, // 3, 4, or 5
            heading1:
              level === 1
                ? {
                    elements: [{ text_run: { content: text } }],
                  }
                : undefined,
            heading2:
              level === 2
                ? {
                    elements: [{ text_run: { content: text } }],
                  }
                : undefined,
            heading3:
              level === 3
                ? {
                    elements: [{ text_run: { content: text } }],
                  }
                : undefined,
          });
          continue;
        }
      }

      // 无序列表 (block_type: 12)
      if (line.startsWith('- ') || line.startsWith('* ')) {
        const text = line.substring(2);
        blocks.push({
          block_type: 12,
          bullet: {
            elements: [{ text_run: { content: text } }],
          },
        });
        continue;
      }

      // 普通段落 (block_type: 2)
      blocks.push({
        block_type: 2,
        text: {
          elements: [{ text_run: { content: line } }],
        },
      });
    }

    return blocks;
  }

  /**
   * 使用飞书官方转换 API 将 Markdown 内容添加到文档
   * @deprecated 已废弃。飞书的 /blocks/convert API 返回的块顺序是乱的，无法正确保持 Markdown 内容顺序。
   * 请使用 MCP create-doc 或 update-doc 工具代替。
   * 参见：https://open.feishu.cn/document/server-docs/task-v1/markdown-module
   */
  private async addMarkdownContent(
    documentId: string,
    markdown: string,
    options?: { index?: number; parent_block_id?: string },
  ): Promise<void> {
    try {
      // Step 1: 调用转换 API 将 Markdown 转换为文档块
      // 注意：这是独立端点，不需要 document_id
      const convertResponse = await this.client.request({
        url: '/open-apis/docx/v1/documents/blocks/convert',
        method: 'POST',
        data: {
          content_type: 'markdown',
          content: markdown,
        },
      });

      if (convertResponse.code !== 0) {
        throw new Error(
          `Failed to convert markdown: ${convertResponse.msg} (code: ${convertResponse.code})`,
        );
      }

      let blocks = convertResponse.data?.blocks;
      if (!blocks || blocks.length === 0) {
        log.warn({ documentId }, 'No blocks returned from convert API');
        return;
      }

      log.debug(
        { documentId, blocksCount: blocks.length },
        'Markdown converted to blocks successfully',
      );

      // Step 2: 处理块数据，移除只读字段
      // 注意事项：表格块中的 merge_info 为只读属性，需要移除
      blocks = this.cleanBlocksForInsert(blocks);

      // Step 3: 将转换后的块批量添加到文档
      // ⚠️ 单次调用最多可插入 50 个块（严格的 API 限制）
      const BATCH_SIZE = 50;
      for (let i = 0; i < blocks.length; i += BATCH_SIZE) {
        const batch = blocks.slice(i, i + BATCH_SIZE);
        const blockResponse = await this.client.request({
          url: `/open-apis/docx/v1/documents/${documentId}/blocks/${options?.parent_block_id || documentId}/children`,
          method: 'POST',
          data: {
            index: options?.index ?? -1, // -1 表示追加到末尾
            children: batch,
          },
        });

        if (blockResponse.code !== 0) {
          // 记录详细的错误响应
          log.error(
            {
              documentId,
              batchIndex: i,
              code: blockResponse.code,
              msg: blockResponse.msg,
              response: JSON.stringify(blockResponse, null, 2),
            },
            'Failed to create block children - API error response',
          );
          throw new Error(
            `Failed to create block children: ${blockResponse.msg} (code: ${blockResponse.code})`,
          );
        }

        log.debug(
          { documentId, batchIndex: i, batchSize: batch.length },
          'Batch of blocks added successfully',
        );

        // 添加延迟避免速率限制（如果不是最后一批）
        if (i + BATCH_SIZE < blocks.length) {
          await this.sleep(this.RATE_LIMIT_DELAY);
        }
      }

      log.info(
        { documentId, totalBlocks: blocks.length },
        'Markdown content added to document successfully',
      );
    } catch (error) {
      log.error(
        {
          documentId,
          error: error instanceof Error ? error.message : String(error),
          // 如果是 Axios 错误，记录响应数据
          ...(error && typeof error === 'object' && 'response' in error
            ? {
                responseData: JSON.stringify(
                  (error as any).response?.data,
                  null,
                  2,
                ),
              }
            : {}),
        },
        'Failed to add markdown content',
      );
      throw error;
    }
  }

  /**
   * 清理块数据，移除只读字段和其他问题字段
   * @deprecated 已废弃。配合 addMarkdownContent 使用，该方法不再需要。
   * 根据飞书文档要求：
   * - 表格块中的 merge_info 为只读属性，需要移除
   * - parent_id 为空字符串时需要移除（会导致 400 错误）
   * - children 数组最大长度为 50
   * - 某些块类型不能单独创建（如 table_cell、有 children 的块）
   */
  private cleanBlocksForInsert(blocks: any[]): any[] {
    return blocks
      .filter((block: any) => {
        // 过滤掉表格单元格块（block_type 32），它们应该作为表格的一部分
        if (block.block_type === 32) {
          return false;
        }

        // 过滤掉有 children 字段的块（这些不是顶层块）
        // children 是块内部的数据结构，不是用于插入的子块
        if (
          block.children &&
          Array.isArray(block.children) &&
          block.children.length > 0
        ) {
          return false;
        }

        return true;
      })
      .map((block) => {
        const cleaned = { ...block };

        // 移除空的 parent_id 字段（会导致插入失败）
        if (cleaned.parent_id === '') {
          delete cleaned.parent_id;
        }

        // 移除表格块中的 merge_info 字段（只读属性）
        // block_type: 5=table, 31=table, 32=table_cell
        if (cleaned.block_type === 5 && cleaned.table?.merge_info) {
          delete cleaned.table.merge_info;
          log.debug('Removed merge_info from table block');
        }

        if (cleaned.block_type === 31 && cleaned.table?.merge_info) {
          delete cleaned.table.merge_info;
        }

        if (cleaned.block_type === 32 && cleaned.table_cell?.merge_info) {
          delete cleaned.table_cell.merge_info;
        }

        // 移除 children 字段（这些不是用于插入的子块）
        if (cleaned.children) {
          delete cleaned.children;
        }

        return cleaned;
      });
  }

  /**
   * 构建文档 URL
   */
  private buildDocUrl(docId: string, brand: LarkBrand): string {
    const domain = brand === 'lark' ? 'larksuite.com' : 'feishu.cn';
    return `https://${domain}/docx/${docId}`;
  }

  // ---------------------------------------------------------------------------
  // Wiki Operations
  // ---------------------------------------------------------------------------

  /**
   * 创建知识库节点
   */
  async createWikiNode(
    spaceId: string,
    objType:
      | 'doc'
      | 'sheet'
      | 'bitable'
      | 'mindnote'
      | 'file'
      | 'docx'
      | 'slides',
    title: string,
    parentNodeToken?: string,
  ): Promise<{ node_token: string; obj_token: string }> {
    try {
      const response = await this.client.request({
        url: `/open-apis/wiki/v2/spaces/${spaceId}/nodes`,
        method: 'POST',
        data: {
          node_type: 'origin',
          obj_type: objType,
          parent_node_token: parentNodeToken,
          title,
        },
      });

      if (response.code !== 0 || !response.data?.node) {
        throw new Error(`Failed to create wiki node: ${response.msg}`);
      }

      const nodeToken = response.data.node.node_token;
      const objToken = response.data.node.obj_token;

      log.info(
        { spaceId, nodeToken, objToken, title },
        'Wiki node created successfully',
      );

      return { node_token: nodeToken, obj_token: objToken };
    } catch (error) {
      log.error(
        {
          spaceId,
          error: error instanceof Error ? error.message : String(error),
        },
        'Failed to create wiki node',
      );
      throw error;
    }
  }

  /**
   * 列出知识库节点
   */
  async listWikiNodes(
    spaceId: string,
    parentNodeToken?: string,
  ): Promise<any[]> {
    try {
      const params: Record<string, string> = {};
      if (parentNodeToken) {
        params.parent_node_token = parentNodeToken;
      }

      const response = await this.client.request({
        url: `/open-apis/wiki/v2/spaces/${spaceId}/nodes`,
        method: 'GET',
        params,
      });

      if (response.code !== 0) {
        throw new Error(`Failed to list wiki nodes: ${response.msg}`);
      }

      return response.data?.items || [];
    } catch (error) {
      log.error(
        {
          spaceId,
          error: error instanceof Error ? error.message : String(error),
        },
        'Failed to list wiki nodes',
      );
      throw error;
    }
  }

  // ---------------------------------------------------------------------------
  // Bitable (Spreadsheet) Operations
  // ---------------------------------------------------------------------------

  /**
   * 创建多维表格应用
   */
  async createBitableApp(
    name: string,
    folderToken?: string,
  ): Promise<{ app_token: string; app_url: string }> {
    try {
      const response = await this.client.request({
        url: '/open-apis/bitable/v1/apps',
        method: 'POST',
        data: {
          name,
          folder_token: folderToken,
        },
      });

      if (response.code !== 0 || !response.data?.app) {
        throw new Error(
          `Failed to create bitable app: ${response.msg} (code: ${response.code})`,
        );
      }

      const appToken = response.data.app.app_token;
      const domain = this.brand === 'lark' ? 'larksuite.com' : 'feishu.cn';
      const url = `https://${domain}/base/${appToken}`;

      log.info({ appToken, name, url }, 'Bitable app created successfully');

      return { app_token: appToken, app_url: url };
    } catch (error) {
      log.error(
        {
          name,
          error: error instanceof Error ? error.message : String(error),
        },
        'Failed to create bitable app',
      );
      throw error;
    }
  }

  /**
   * 创建数据表
   */
  async createBitableTable(
    appToken: string,
    name: string,
    fields?: any[],
  ): Promise<{ table_id: string; table_name: string }> {
    try {
      const defaultFields = fields || [
        {
          field_name: '标题',
          type: 1, // Text
        },
      ];

      const response = await this.client.request({
        url: `/open-apis/bitable/v1/apps/${appToken}/tables`,
        method: 'POST',
        data: {
          table: {
            name,
            default_view_name: '表格',
            fields: defaultFields,
          },
        },
      });

      if (response.code !== 0 || !response.data?.table_id) {
        throw new Error(
          `Failed to create bitable table: ${response.msg} (code: ${response.code})`,
        );
      }

      const tableId = response.data.table_id;
      const tableName = name;

      log.info(
        { appToken, tableId, tableName },
        'Bitable table created successfully',
      );

      return { table_id: tableId, table_name: tableName };
    } catch (error) {
      log.error(
        {
          appToken,
          name,
          error: error instanceof Error ? error.message : String(error),
        },
        'Failed to create bitable table',
      );
      throw error;
    }
  }

  /**
   * 列出多维表格中的所有数据表
   */
  async listBitableTables(appToken: string): Promise<any[]> {
    try {
      const response = await this.client.bitable.appTable.list({
        path: {
          app_token: appToken,
        },
      });

      if (response.code !== 0) {
        throw new Error(`Failed to list bitable tables: ${response.msg}`);
      }

      const tables = response.data?.items || [];

      log.info(
        { appToken, count: tables.length },
        'Bitable tables listed successfully',
      );

      return tables;
    } catch (error) {
      log.error(
        {
          appToken,
          error: error instanceof Error ? error.message : String(error),
        },
        'Failed to list bitable tables',
      );
      throw error;
    }
  }

  /**
   * 添加记录到数据表
   */
  async addBitableRecord(
    appToken: string,
    tableId: string,
    fields: Record<string, any>,
  ): Promise<{ record_id: string }> {
    try {
      const response = await this.client.bitable.appTableRecord.create({
        path: {
          app_token: appToken,
          table_id: tableId,
        },
        data: {
          fields,
        },
      });

      if (response.code !== 0 || !response.data?.record) {
        throw new Error(`Failed to add bitable record: ${response.msg}`);
      }

      const recordId = response.data.record?.record_id;
      if (!recordId) {
        throw new Error('No record_id returned from create API');
      }

      log.info(
        { appToken, tableId, recordId },
        'Bitable record added successfully',
      );

      return { record_id: recordId };
    } catch (error) {
      log.error(
        {
          appToken,
          tableId,
          error: error instanceof Error ? error.message : String(error),
        },
        'Failed to add bitable record',
      );
      throw error;
    }
  }

  /**
   * 批量添加记录到数据表
   */
  async batchAddBitableRecords(
    appToken: string,
    tableId: string,
    records: Array<{ fields: Record<string, any> }>,
  ): Promise<{ record_ids: string[] }> {
    try {
      // 限制每批最多 500 条
      if (records.length > 500) {
        throw new Error('Batch create limited to 500 records per call');
      }

      const response = await this.client.bitable.appTableRecord.batchCreate({
        path: {
          app_token: appToken,
          table_id: tableId,
        },
        data: {
          records,
        },
      });

      if (response.code !== 0) {
        throw new Error(`Failed to batch add bitable records: ${response.msg}`);
      }

      const recordIds = (response.data?.records || []).map(
        (r: any) => r.record_id,
      );

      log.info(
        { appToken, tableId, count: recordIds.length },
        'Bitable records batch added successfully',
      );

      return { record_ids: recordIds };
    } catch (error) {
      log.error(
        {
          appToken,
          tableId,
          error: error instanceof Error ? error.message : String(error),
        },
        'Failed to batch add bitable records',
      );
      throw error;
    }
  }

  /**
   * 查询数据表记录
   */
  async listBitableRecords(
    appToken: string,
    tableId: string,
    options?: {
      viewId?: string;
      filter?: any;
      sort?: any[];
      pageSize?: number;
      pageToken?: string;
    },
  ): Promise<{ records: any[]; has_more: boolean; page_token?: string }> {
    try {
      // 使用 search API
      const requestData: any = {};
      if (options?.viewId) {
        requestData.view_id = options.viewId;
      }
      if (options?.filter) {
        requestData.filter = options.filter;
      }
      if (options?.sort) {
        requestData.sort = options.sort;
      }
      if (options?.pageSize) {
        requestData.page_size = options.pageSize;
      }
      if (options?.pageToken) {
        requestData.page_token = options.pageToken;
      }

      const response = await this.client.bitable.appTableRecord.search({
        path: {
          app_token: appToken,
          table_id: tableId,
        },
        data: requestData,
      });

      if (response.code !== 0) {
        throw new Error(`Failed to list bitable records: ${response.msg}`);
      }

      return {
        records: response.data?.items || [],
        has_more: response.data?.has_more || false,
        page_token: response.data?.page_token,
      };
    } catch (error) {
      log.error(
        {
          appToken,
          tableId,
          error: error instanceof Error ? error.message : String(error),
        },
        'Failed to list bitable records',
      );
      throw error;
    }
  }

  /**
   * 获取数据表字段列表
   */
  async listBitableFields(appToken: string, tableId: string): Promise<any[]> {
    try {
      const response = await this.client.bitable.appTableField.list({
        path: {
          app_token: appToken,
          table_id: tableId,
        },
      });

      if (response.code !== 0) {
        throw new Error(`Failed to list bitable fields: ${response.msg}`);
      }

      return response.data?.items || [];
    } catch (error) {
      log.error(
        {
          appToken,
          tableId,
          error: error instanceof Error ? error.message : String(error),
        },
        'Failed to list bitable fields',
      );
      throw error;
    }
  }

  /**
   * 更新数据表记录
   */
  async updateBitableRecord(
    appToken: string,
    tableId: string,
    recordId: string,
    fields: Record<string, any>,
  ): Promise<void> {
    try {
      const response = await this.client.bitable.appTableRecord.update({
        path: {
          app_token: appToken,
          table_id: tableId,
          record_id: recordId,
        },
        data: {
          fields,
        },
      });

      if (response.code !== 0) {
        throw new Error(`Failed to update bitable record: ${response.msg}`);
      }

      log.info({ appToken, tableId, recordId }, 'Bitable record updated');
    } catch (error) {
      log.error(
        {
          appToken,
          tableId,
          recordId,
          error: error instanceof Error ? error.message : String(error),
        },
        'Failed to update bitable record',
      );
      throw error;
    }
  }

  // ---------------------------------------------------------------------------
  // File Upload and Send Operations
  // ---------------------------------------------------------------------------

  /**
   * 映射文件扩展名到飞书支持的 file_type
   * 飞书 API 支持的 file_type 值: opus, mp4, pdf, doc, xls, ppt, stream
   * @param ext 文件扩展名（不含点）
   * @returns 飞书支持的 file_type
   */
  private mapFileType(ext: string): string {
    const typeMap: Record<string, string> = {
      // 音频
      opus: 'opus',
      // 视频
      mp4: 'mp4',
      mov: 'mp4',
      avi: 'mp4',
      mkv: 'mp4',
      // 文档
      pdf: 'pdf',
      doc: 'doc',
      docx: 'doc',
      xls: 'xls',
      xlsx: 'xls',
      ppt: 'ppt',
      pptx: 'ppt',
    };

    // 如果扩展名在映射表中，返回对应的飞书类型
    if (typeMap[ext]) {
      return typeMap[ext];
    }

    // 其他所有类型使用 stream
    return 'stream';
  }

  /**
   * 上传文件到飞书并获取 file_key
   * @param filePath 文件路径（主机路径）
   * @param fileType 文件类型：file, image, audio, video, media（仅作为参考，实际会从扩展名推断）
   * @returns file_key 用于发送文件消息
   */
  async uploadFile(
    filePath: string,
    fileType: 'file' | 'image' | 'audio' | 'video' | 'media' = 'file',
  ): Promise<string> {
    try {
      const fs = await import('fs');
      const path = await import('path');

      // 检查文件是否存在
      if (!fs.existsSync(filePath)) {
        throw new Error(`File not found: ${filePath}`);
      }

      // 读取文件
      const fileBuffer = fs.readFileSync(filePath);
      const fileName = path.basename(filePath);

      // 从文件名提取扩展名并映射到飞书支持的 file_type
      // 飞书 API 支持的 file_type 值: opus, mp4, pdf, doc, xls, ppt, stream
      const ext = path.extname(fileName).toLowerCase().replace(/^\./, '');
      const feishuFileType = this.mapFileType(ext);

      // 获取 tenant_access_token
      const token = await this.getTenantAccessToken();

      // 使用 FormData 上传文件（按照飞书 API 文档示例格式）
      const FormData = (await import('form-data')).default;
      const form = new FormData();
      form.append('file_type', feishuFileType);
      form.append('file_name', fileName);
      form.append('file', fileBuffer, { filename: fileName });

      const url = 'https://open.feishu.cn/open-apis/im/v1/files';
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          ...form.getHeaders(),
          'Content-Length': form.getLengthSync().toString(),
        },
        body: form.getBuffer(),
      });

      // 先获取文本响应，再尝试解析 JSON
      const responseText = await response.text();
      let result: any;
      try {
        result = JSON.parse(responseText);
      } catch {
        // 如果不是 JSON，说明 API 返回了错误文本
        log.error(
          {
            filePath,
            fileName,
            feishuFileType,
            status: response.status,
            responseText,
          },
          'Feishu API returned non-JSON response',
        );
        throw new Error(
          `Feishu API error (${response.status}): ${responseText}`,
        );
      }

      if (result.code !== 0) {
        throw new Error(
          `Failed to upload file: ${result.msg} (code: ${result.code})`,
        );
      }

      const fileKey = result.data?.file_key;
      if (!fileKey) {
        throw new Error('No file_key returned from upload API');
      }

      log.info(
        {
          filePath,
          fileName,
          feishuFileType,
          fileKey,
          size: fileBuffer.length,
        },
        'File uploaded successfully',
      );

      return fileKey;
    } catch (error) {
      log.error(
        {
          filePath,
          fileType,
          error: error instanceof Error ? error.message : String(error),
        },
        'Failed to upload file',
      );
      throw error;
    }
  }

  /**
   * 发送消息给指定用户
   * @param receiveId 接收者标识（open_id 或 email）
   * @param receiveIdType 标识类型：open_id 或 email
   * @param text 消息内容
   * @param msgType 消息类型：text 或 post（默认 post，支持 Markdown）
   * @returns 消息 ID 和聊天 ID
   */
  async sendToUser(
    receiveId: string,
    receiveIdType: 'open_id' | 'email',
    text: string,
    msgType: 'text' | 'post' = 'post',
  ): Promise<{ message_id: string; chat_id?: string }> {
    try {
      let content: string;

      if (msgType === 'post') {
        // 富文本消息，支持 Markdown 渲染
        content = JSON.stringify({
          zh_cn: {
            content: [[{ tag: 'md', text }]],
          },
        });
      } else {
        // 纯文本消息
        content = JSON.stringify({ text });
      }

      const response = await this.client.im.message.create({
        params: {
          receive_id_type: receiveIdType,
        },
        data: {
          receive_id: receiveId,
          msg_type: msgType,
          content,
        },
      });

      if (response.code !== 0) {
        throw new Error(`发送失败: ${response.msg} (code: ${response.code})`);
      }

      const messageId = response.data?.message_id || '';
      const chatId = response.data?.chat_id;

      log.info(
        { receiveId, receiveIdType, messageId, chatId },
        'Message sent to user successfully',
      );

      return {
        message_id: messageId,
        chat_id: chatId,
      };
    } catch (error) {
      log.error(
        {
          receiveId,
          receiveIdType,
          error: error instanceof Error ? error.message : String(error),
        },
        'Failed to send message to user',
      );
      throw error;
    }
  }

  /**
   * 发送文件消息
   * @param chatId 聊天 ID
   * @param fileKey 文件 key（通过 uploadFile 获取）
   * @param fileName 文件名（可选）
   */
  async sendFileMessage(
    chatId: string,
    fileKey: string,
    fileName?: string,
  ): Promise<string> {
    try {
      const response = await this.client.im.message.create({
        params: {
          receive_id_type: 'chat_id',
        },
        data: {
          receive_id: chatId,
          msg_type: 'file',
          content: JSON.stringify({
            file_key: fileKey,
          }),
        },
      });

      if (response.code !== 0) {
        throw new Error(`Failed to send file message: ${response.msg}`);
      }

      const messageId = response.data?.message_id;
      log.info(
        { chatId, fileKey, fileName, messageId },
        'File message sent successfully',
      );

      return messageId || '';
    } catch (error) {
      log.error(
        {
          chatId,
          fileKey,
          fileName,
          error: error instanceof Error ? error.message : String(error),
        },
        'Failed to send file message',
      );
      throw error;
    }
  }

  /**
   * 上传并发送文件（组合方法）
   * @param chatId 聊天 ID
   * @param filePath 文件路径（主机路径）
   * @param fileType 文件类型
   */
  async uploadAndSendFile(
    chatId: string,
    filePath: string,
    fileType: 'file' | 'image' | 'audio' | 'video' | 'media' = 'file',
  ): Promise<{ file_key: string; message_id: string }> {
    const fileKey = await this.uploadFile(filePath, fileType);
    const messageId = await this.sendFileMessage(
      chatId,
      fileKey,
      filePath.split('/').pop(),
    );
    return { file_key: fileKey, message_id: messageId };
  }
}
