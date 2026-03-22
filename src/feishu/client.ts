/**
 * Feishu/Lark Client with WebSocket Support
 *
 * 飞书 SDK 客户端封装，支持 WebSocket 长连接
 * 使用 HTTP 请求直接调用飞书 API
 */

import * as Lark from '@larksuiteoapi/node-sdk';
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
   */
  async fetchDoc(
    docId: string,
    offset?: number,
    limit?: number,
  ): Promise<FeishuDocInfo> {
    try {
      const actualDocId = this.extractDocId(docId);

      // 使用 HTTP 请求获取文档内容
      const response = await this.client.request({
        url: `/open-apis/docx/v1/documents/${actualDocId}/blocks/${actualDocId}`,
        method: 'GET',
        params: {
          page_size: limit ? Math.min(limit, 500) : 100,
          page_token: offset,
        },
      });

      if (response.code !== 0) {
        throw new Error(`Failed to fetch doc: ${response.msg}`);
      }

      return {
        doc_id: actualDocId,
        title: response.data?.title || '',
        content: JSON.stringify(response.data),
        has_more: false,
      };
    } catch (error) {
      log.error(
        {
          docId,
          error: error instanceof Error ? error.message : String(error),
        },
        'Failed to fetch doc',
      );
      throw error;
    }
  }

  /**
   * 创建文档
   */
  async createDoc(
    title: string,
    markdown: string,
    options?: CreateDocOptions,
  ): Promise<FeishuDocInfo> {
    try {
      // Step 1: 创建空文档
      const createResponse = await this.client.request({
        url: '/open-apis/docx/v1/documents',
        method: 'POST',
        data: {
          title: title,
          folder_token: options?.folder_token,
        },
      });

      if (createResponse.code !== 0) {
        throw new Error(`Failed to create document: ${createResponse.msg}`);
      }

      const documentId = createResponse.data?.document?.document_id;
      if (!documentId) {
        throw new Error('No document_id returned from create API');
      }

      // Step 2: 尝试添加内容（非阻塞，失败不影响文档创建成功）
      const blocks = this.markdownToBlocks(markdown);
      if (blocks.length > 0) {
        try {
          // 使用原始请求方法创建块
          for (let i = 0; i < blocks.length; i++) {
            const block = blocks[i];
            const blockResponse = await this.client.request({
              url: `/open-apis/docx/v1/documents/${documentId}/blocks/${documentId}/children`,
              method: 'POST',
              data: {
                index: i,
                children: [block],
              },
            });
            if (blockResponse.code !== 0) {
              log.warn(
                {
                  documentId,
                  index: i,
                  code: blockResponse.code,
                  msg: blockResponse.msg,
                },
                'Failed to add block',
              );
            }
          }
        } catch (blockError) {
          log.warn(
            {
              documentId,
              error:
                blockError instanceof Error
                  ? blockError.message
                  : String(blockError),
            },
            'Document created but failed to add some content',
          );
        }
      }

      // 获取文档 URL
      const url = this.buildDocUrl(documentId, this.brand);

      log.info({ documentId, title, url }, 'Document created successfully');

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
        'Failed to create doc',
      );
      throw error;
    }
  }

  /**
   * 更新文档
   */
  async updateDoc(docId: string, markdown: string): Promise<void> {
    try {
      const actualDocId = this.extractDocId(docId);

      // 简化实现：将 markdown 转换为文档块并追加
      const blocks = this.markdownToBlocks(markdown);

      // 使用批量创建块 API
      await this.client.request({
        url: `/open-apis/docx/v1/documents/${actualDocId}/blocks/${actualDocId}/children/batch_create`,
        method: 'POST',
        data: {
          requests: blocks.map((block) => ({
            create_block: {
              block,
              position: actualDocId,
            },
          })),
          index: -1,
        },
      });

      log.info(
        { docId: actualDocId, blocksCount: blocks.length },
        'Document updated successfully',
      );
    } catch (error) {
      log.error(
        {
          docId,
          error: error instanceof Error ? error.message : String(error),
        },
        'Failed to update doc',
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

  /**
   * 将 Markdown 转换为 Feishu 文档块
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

  /**
   * 删除数据表记录
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
}
